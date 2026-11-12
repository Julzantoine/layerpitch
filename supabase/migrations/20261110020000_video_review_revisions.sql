-- LayerPitch — Révisions figées pour la relecture client (10 novembre 2026).
--
-- Décisions de Jules-Antoine (10/11) : à chaque ENVOI au client, ce que voit le client est figé : une « révision » (#2.1, #2.2… : numéro de la version
-- alternative, puis rang de l'envoi). Le client voit la dernière révision de chaque version que le compositeur a envoyée, et peut ouvrir les anciennes.
-- Republier le montage ou une version ensuite ne change rien chez le client tant qu'on n'a pas renvoyé.
--   - « Envoyer » = passer une version au statut « envoyée » (le menu de statut existant). Cela fige aussi l'original (version n° 1) s'il a changé.
--   - Les versions restées « brouillon » ne sont jamais montrées au client (inchangé) : c'est la case à cocher « quelles versions envoyer ».
--   - Les vidéos d'une révision ne sont jamais effacées par le nettoyage des historiques (video_still_used).
--   - Les anciens envois (avant cette migration) n'ont pas de révision : le client voit alors l'export en cours, comme avant.
-- Sécurité : table sans policy (accès par fonctions seulement) ; le lien client, la clé magique et le mot de passe ne changent pas.

create table if not exists public.video_review_revisions (
  id bigserial primary key,
  capture_id text not null references public.video_captures(id) on delete cascade,
  version_key text not null, -- 'original' ou l'identifiant d'une version
  seq int not null,
  video_id text not null,
  cues jsonb,
  created_at timestamptz not null default now(),
  unique (capture_id, version_key, seq)
);
alter table public.video_review_revisions enable row level security;

-- Fige une révision (interne, jamais appelée depuis le navigateur). Sans changement depuis la dernière révision : rien.
create or replace function public.video_freeze_revision(p_capture_id text, p_key text, p_video text, p_cues jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_last public.video_review_revisions;
begin
  if p_video is null then return; end if;
  select * into v_last from public.video_review_revisions where capture_id = p_capture_id and version_key = p_key order by seq desc limit 1;
  if v_last.id is not null and v_last.video_id = p_video and v_last.cues is not distinct from p_cues then return; end if;
  insert into public.video_review_revisions (capture_id, version_key, seq, video_id, cues)
  values (p_capture_id, p_key, coalesce(v_last.seq, 0) + 1, p_video, p_cues);
end;
$$;

-- Une vidéo référencée par une révision sert encore.
create or replace function public.video_still_used(p_video_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.video_captures where last_export_video_id = p_video_id or base_video_id = p_video_id)
      or exists (select 1 from public.video_capture_versions where last_export_video_id = p_video_id)
      or exists (select 1 from public.video_export_history where video_id = p_video_id)
      or exists (select 1 from public.video_review_revisions where video_id = p_video_id)
      or exists (select 1 from public.ad_reels where blocks::text like '%' || p_video_id || '%')
$$;

-- Passer une version à « envoyée » fige sa révision, et celle de l'original s'il a changé.
create or replace function public.set_video_capture_version_status(p_id text, p_status text, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
  v_now timestamptz := now(); v_ver public.video_capture_versions; v_cap public.video_captures;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then raise exception 'Non autorisé'; end if;
  if p_status is null or p_status not in ('draft', 'sent', 'changes_requested', 'approved') then raise exception 'statut invalide'; end if;
  update public.video_capture_versions
     set review_status = p_status, review_status_at = v_now, review_status_by = null
   where id = p_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s)
     and review_status is distinct from p_status;
  if not found and not exists (select 1 from public.video_capture_versions where id = p_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s)) then
    raise exception 'Version introuvable';
  end if;
  if p_status = 'sent' then
    select * into v_ver from public.video_capture_versions where id = p_id;
    select * into v_cap from public.video_captures where id = v_ver.capture_id;
    perform public.video_freeze_revision(v_ver.capture_id, p_id, v_ver.last_export_video_id, v_ver.last_export_cues);
    perform public.video_freeze_revision(v_ver.capture_id, 'original', v_cap.last_export_video_id, v_cap.last_export_cues);
  end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- Ce que voit le client : pour chaque version envoyée, sa dernière révision (ou l'export en cours si elle n'en a pas encore), le numéro de la
-- version alternative (n : l'original = 1, puis par ordre de création), le rang de la révision affichée (seq) et toutes les révisions.
create or replace function public.video_review_revisions_json(p_capture_id text, p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'seq', r.seq, 'url', cv.base || cv.file, 'kind', case when cv.kind = 'capture_audio' then 'audio' else 'video' end,
    'cues', coalesce(r.cues, '[]'::jsonb), 'createdAt', r.created_at
  ) order by r.seq desc), '[]'::jsonb)
  from public.video_review_revisions r join public.composer_videos cv on cv.id = r.video_id
  where r.capture_id = p_capture_id and r.version_key = p_key
$$;

create or replace function public.get_video_review(p_slug text, p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cap text := public.video_review_capture(p_slug, p_secret);
  v_capture public.video_captures; v_versions jsonb; v_comments jsonb; v_base text;
begin
  if v_cap is null then return null; end if;
  select * into v_capture from public.video_captures where id = v_cap;
  select base || file into v_base from public.composer_videos where id = v_capture.base_video_id;
  select coalesce(jsonb_agg(x.item order by x.ord, x.created_at), '[]'::jsonb) into v_versions
  from (
    select 0 as ord, v_capture.created_at as created_at,
      jsonb_build_object('key', 'original', 'title', null, 'n', 1, 'seq', sel.seq, 'revisions', public.video_review_revisions_json(v_cap, 'original'),
        'url', cv.base || cv.file, 'kind', case when cv.kind = 'capture_audio' then 'audio' else 'video' end,
        'cues', coalesce(sel.cues, '[]'::jsonb), 'status', null, 'statusBy', null) as item
    from (
      select coalesce(r.video_id, v_capture.last_export_video_id) as vid, coalesce(r.cues, v_capture.last_export_cues) as cues, r.seq
      from (select 1) d left join lateral (select * from public.video_review_revisions where capture_id = v_cap and version_key = 'original' order by seq desc limit 1) r on true
    ) sel join public.composer_videos cv on cv.id = sel.vid
    union all
    select 1, ver.created_at,
      jsonb_build_object('key', ver.id, 'title', ver.title, 'n', ver.n, 'seq', sel.seq, 'revisions', public.video_review_revisions_json(v_cap, ver.id),
        'url', cv.base || cv.file, 'kind', case when cv.kind = 'capture_audio' then 'audio' else 'video' end,
        'cues', coalesce(sel.cues, '[]'::jsonb), 'status', ver.review_status, 'statusBy', ver.review_status_by)
    from (select vv.*, 1 + row_number() over (order by vv.created_at, vv.id) as n from public.video_capture_versions vv where vv.capture_id = v_cap) ver
    cross join lateral (
      select coalesce(r.video_id, ver.last_export_video_id) as vid, coalesce(r.cues, ver.last_export_cues) as cues, r.seq
      from (select 1) d left join lateral (select * from public.video_review_revisions where capture_id = v_cap and version_key = ver.id order by seq desc limit 1) r on true
    ) sel
    join public.composer_videos cv on cv.id = sel.vid
    where ver.review_status <> 'draft'
  ) x;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'versionKey', c.version_key, 'parentId', c.parent_id, 't', c.t, 'author', c.author,
    'fromOwner', c.from_owner, 'body', c.body, 'resolved', c.resolved, 'createdAt', c.created_at
  ) order by c.created_at), '[]'::jsonb) into v_comments
  from public.video_review_comments c
  where c.capture_id = v_cap
    and (c.version_key = 'original' or exists (select 1 from public.video_capture_versions ver where ver.id = c.version_key and ver.capture_id = v_cap and ver.review_status <> 'draft'));
  return jsonb_build_object('title', v_capture.title, 'baseUrl', v_base, 'versions', v_versions, 'comments', v_comments);
end;
$$;

revoke all on function public.video_freeze_revision(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.video_review_revisions_json(text, text) from public, anon, authenticated;
revoke all on function public.video_still_used(text) from public, anon, authenticated;
