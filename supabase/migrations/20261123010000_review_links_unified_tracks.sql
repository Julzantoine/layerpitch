-- LayerPitch — Relecture client commune vidéo + morceau, commentaires horodatés sur un morceau avec l'état du lecteur (23 novembre 2026).
--
-- Idée tirée de l'analyse de DropCue (commentaires horodatés sur la forme d'onde). Décisions de Jules-Antoine (23/11) :
--   - un MORCEAU seul (pas l'AdReel), à l'adresse /relecture/<nom> (même espace de noms que la vidéo) ;
--   - UN LIEN PAR CLIENT (précision du 23/11) : un même morceau peut avoir plusieurs liens (studio A, studio B…), chacun avec ses
--     propres commentaires, invisibles des autres liens (review_comments.link_id) ; le compositeur voit tout, rangé par lien. Les
--     commentaires n'apparaissent jamais sur un AdReel, un pack ni aucune page publique ;
--   - commentaires SANS COMPTE, comme la relecture vidéo : clé magique (#k=) ou mot de passe, même empreinte, même frein ;
--   - on retient le MOMENT et l'ÉTAT du lecteur (boucle, section, emplacement, intensité, couches coupées, événements, curseurs) :
--     colonne review_comments.state, lue par le lecteur (wrapper.lpReview.apply) pour réécouter dans cet état ;
--   - le compositeur est PRÉVENU : cloche (my_review_updates) + e-mail récapitulatif (Edge Function review-notify) ; cela comble
--     aussi le manque de la relecture vidéo (aucune notification jusqu'ici) ;
--   - un SEUL système de relecture (choix « le plus propre, le moins de dette ») : les tables vidéo deviennent communes
--     (review_links / review_comments / review_access_failures), un lien vise SOIT un montage SOIT un morceau. La sécurité
--     (secret, frein) et l'enregistrement d'un lien n'existent qu'une fois (review_link_open / review_link_save) ;
--   - les morceaux protégés s'écoutent avec la preuve du lien (can_hear_track_by_review / can_hear_sfx_by_review, track-audio-url) ;
--   - admin seulement jusqu'au feu vert : select public.set_feature_released('track_review', true);
--
-- La relecture vidéo ne change pas de comportement : mêmes fonctions client (get_video_review, add_video_review_comment,
-- set_video_review_decision) et compositeur (get/set_video_review_link, list_video_review_comments) ; seules les réponses,
-- « traité » et suppressions deviennent communes (reply_review_comment, resolve_review_comment, delete_review_comment).
-- Aucune donnée perdue : les liens et commentaires vidéo existants sont gardés (déjà lus et déjà « envoyés par e-mail »).

insert into public.feature_flags (key, description) values
  ('track_review', 'Relecture client d''un morceau (23/11) — lien /relecture/<nom>, commentaires horodatés avec l''état du lecteur, admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;

-- ---- 1. Tables communes ----
alter table public.video_review_links rename to review_links;
alter table public.video_review_comments rename to review_comments;
alter table public.video_review_access_failures rename to review_access_failures;
alter table public.review_links rename constraint video_review_links_slug_unique to review_links_slug_unique;
alter table public.review_links rename constraint video_review_links_slug_check to review_links_slug_check;
alter table public.review_links rename constraint video_review_links_mode_check to review_links_mode_check;
alter index public.video_review_comments_capture_idx rename to review_comments_capture_idx;
alter index public.video_review_access_failures_idx rename to review_access_failures_old_idx;

-- Un lien : un identifiant propre, et SOIT un montage SOIT un morceau.
alter table public.review_links add column id uuid not null default gen_random_uuid();
alter table public.review_links drop constraint video_review_links_pkey;
alter table public.review_links add constraint review_links_pkey primary key (id);
alter table public.review_links alter column capture_id drop not null;
alter table public.review_links add constraint review_links_capture_unique unique (capture_id);
alter table public.review_links add column track_id text references public.tracks(id) on delete cascade;
create index review_links_track_idx on public.review_links(track_id);
alter table public.review_links add column label text check (label is null or char_length(label) <= 60); -- pour qui (« Studio A »), vu du compositeur seulement
alter table public.review_links add constraint review_links_one_target check (num_nonnulls(capture_id, track_id) = 1);
alter table public.review_links add column last_emailed_at timestamptz; -- dernier e-mail récapitulatif envoyé au propriétaire

-- Un commentaire : sur un montage OU un morceau, et rattaché au LIEN par lequel il est arrivé (un client ne voit que les commentaires
-- de son lien) ; état du lecteur au moment du commentaire (morceau).
alter table public.review_comments add column link_id uuid references public.review_links(id) on delete cascade;
update public.review_comments c set link_id = l.id from public.review_links l where l.capture_id = c.capture_id;
delete from public.review_comments where link_id is null;
alter table public.review_comments alter column link_id set not null;
create index review_comments_link_idx on public.review_comments(link_id, created_at);
alter table public.review_comments alter column capture_id drop not null;
alter table public.review_comments add column track_id text references public.tracks(id) on delete cascade;
alter table public.review_comments add constraint review_comments_one_target check (num_nonnulls(capture_id, track_id) = 1);
alter table public.review_comments add column state jsonb check (state is null or (jsonb_typeof(state) = 'object' and length(state::text) <= 8000));
create index review_comments_track_idx on public.review_comments(track_id, created_at);

-- Frein : compté par lien (et non plus par montage).
alter table public.review_access_failures add column link_id uuid references public.review_links(id) on delete cascade;
update public.review_access_failures f set link_id = l.id from public.review_links l where l.capture_id = f.capture_id;
delete from public.review_access_failures where link_id is null;
alter table public.review_access_failures alter column link_id set not null;
alter table public.review_access_failures drop column capture_id;
drop index if exists public.review_access_failures_old_idx;
create index review_access_failures_idx on public.review_access_failures (link_id, at);

-- Avis au propriétaire (cloche + e-mail) : un nouveau commentaire du client, ou une décision sur une version vidéo.
create table public.review_notices (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.review_links(id) on delete cascade,
  comment_id uuid references public.review_comments(id) on delete cascade,
  kind text not null check (kind in ('comment', 'decision')),
  author text not null default '',
  excerpt text not null default '',
  created_at timestamptz not null default now(),
  seen_at timestamptz,     -- le propriétaire a ouvert les commentaires
  emailed_at timestamptz   -- parti dans un e-mail récapitulatif (ou rendu inutile parce que déjà vu)
);
create index review_notices_link_idx on public.review_notices (link_id, created_at);
alter table public.review_notices enable row level security;
revoke all on public.review_notices from anon, authenticated;

-- ---- 2. Cœur commun (interne) ----

-- Le lien (nom, secret) s'il va ensemble et qu'il est actif, sinon NULL. Lève « throttled » seulement quand le frein est déjà plein
-- (rien n'est alors enregistré). Un mauvais secret est noté (10 par 10 minutes et par lien).
create or replace function public.review_link_open(p_slug text, p_secret text)
returns public.review_links language plpgsql security definer set search_path = public as $$
declare l public.review_links;
begin
  if p_slug is null then return null; end if;
  select * into l from public.review_links where slug = p_slug and enabled;
  if not found then return null; end if;
  if (select count(*) from public.review_access_failures where link_id = l.id and at > now() - interval '10 minutes') >= 10 then
    raise exception 'trop d''essais, réessayez dans quelques minutes' using hint = 'throttled';
  end if;
  if p_secret is not null and p_secret <> '' and public.ad_reel_secret_hash(l.salt, p_secret, l.iterations) = l.secret_hash then return l; end if;
  insert into public.review_access_failures (link_id) values (l.id);
  delete from public.review_access_failures where at < now() - interval '1 day';
  return null;
end;
$$;

-- Montage relu par (nom, secret), ou NULL (lien de morceau, mauvais secret, lien inactif).
create or replace function public.video_review_capture(p_slug text, p_secret text)
returns text language plpgsql security definer set search_path = public as $$
declare l public.review_links := public.review_link_open(p_slug, p_secret);
begin
  return l.capture_id;
end;
$$;

-- Morceau relu par (nom, secret), ou NULL.
create or replace function public.track_review_track(p_slug text, p_secret text)
returns text language plpgsql security definer set search_path = public as $$
declare l public.review_links := public.review_link_open(p_slug, p_secret);
begin
  return l.track_id;
end;
$$;

-- Crée ou règle un lien (la vérification du propriétaire est faite AVANT, par l'appelant) : activer / désactiver, renommer, changer de
-- mode, nouvelle clé magique (p_rotate), nouveau mot de passe. Le secret NEUF d'un lien magique est renvoyé (« secret ») cette seule fois.
-- Montage : son lien unique (p_capture_id). Morceau : le lien p_link_id, ou un NOUVEAU lien si p_link_id est NULL (un par client).
create or replace function public.review_link_save(
  p_link_id uuid, p_capture_id text, p_track_id text, p_enabled boolean, p_slug text, p_mode text, p_password text, p_rotate boolean, p_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_link public.review_links; v_exists boolean;
  v_slug text; v_mode text; v_new_secret boolean; v_token text; v_salt text; v_iter int; v_hash text;
begin
  if num_nonnulls(p_capture_id, p_track_id) <> 1 then raise exception 'cible du lien invalide'; end if;
  if p_capture_id is not null then
    select * into v_link from public.review_links where capture_id = p_capture_id;
  else
    select * into v_link from public.review_links where p_link_id is not null and id = p_link_id and track_id = p_track_id;
    if p_link_id is not null and not found then raise exception 'Lien introuvable'; end if;
  end if;
  v_exists := found;
  v_slug := case when p_slug is null then v_link.slug else lower(btrim(p_slug)) end;
  if v_slug is null then raise exception 'adresse manquante' using hint = 'slug'; end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) not between 3 and 60 then raise exception 'adresse invalide (3 à 60 lettres minuscules, chiffres et tirets)' using hint = 'slug'; end if;
  if exists (select 1 from public.review_links where slug = v_slug and (not v_exists or id <> v_link.id)) then raise exception 'adresse déjà prise' using hint = 'taken'; end if;
  v_mode := coalesce(p_mode, v_link.access_mode, 'magic');
  if v_mode not in ('magic', 'password') then raise exception 'mode inconnu'; end if;
  -- Un secret neuf : à la création, sur demande, au changement de mode, ou quand un mot de passe est donné.
  v_new_secret := not v_exists or coalesce(p_rotate, false) or v_mode is distinct from v_link.access_mode or (v_mode = 'password' and p_password is not null);
  if v_new_secret then
    v_salt := replace(gen_random_uuid()::text, '-', '');
    if v_mode = 'password' then
      if p_password is null or length(p_password) < 6 then raise exception 'Mot de passe trop court (6 caractères au moins)' using hint = 'short'; end if;
      v_iter := 10000; v_hash := public.ad_reel_secret_hash(v_salt, p_password, v_iter);
    else
      v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      v_iter := 1; v_hash := public.ad_reel_secret_hash(v_salt, v_token, v_iter);
    end if;
  end if;
  if not v_exists then
    insert into public.review_links (capture_id, track_id, slug, enabled, access_mode, salt, iterations, secret_hash, label)
    values (p_capture_id, p_track_id, v_slug, coalesce(p_enabled, true), v_mode, v_salt, v_iter, v_hash, nullif(left(btrim(coalesce(p_label, '')), 60), '')) returning * into v_link;
  else
    update public.review_links set
      slug = v_slug, enabled = coalesce(p_enabled, enabled), access_mode = v_mode,
      label = case when p_label is null then label else nullif(left(btrim(p_label), 60), '') end,
      salt = case when v_new_secret then v_salt else salt end,
      iterations = case when v_new_secret then v_iter else iterations end,
      secret_hash = case when v_new_secret then v_hash else secret_hash end,
      updated_at = now()
    where id = v_link.id returning * into v_link;
    if v_new_secret then delete from public.review_access_failures where link_id = v_link.id; end if;
  end if;
  return jsonb_build_object('id', v_link.id, 'slug', v_link.slug, 'enabled', v_link.enabled, 'mode', v_link.access_mode, 'label', v_link.label, 'secret', v_token);
end;
$$;

-- Un commentaire en JSON (même forme partout).
create or replace function public.review_comment_json(c public.review_comments)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', c.id, 'versionKey', c.version_key, 'parentId', c.parent_id, 't', c.t, 'author', c.author,
    'fromOwner', c.from_owner, 'body', c.body, 'resolved', c.resolved, 'createdAt', c.created_at, 'state', c.state, 'linkId', c.link_id)
$$;

-- Quotas d'un client : 30 commentaires toutes les 10 minutes et 500 au total par lien.
create or replace function public.review_quota_full(p_link_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (select count(*) from public.review_comments where link_id = p_link_id and not from_owner and created_at > now() - interval '10 minutes') >= 30
      or (select count(*) from public.review_comments where link_id = p_link_id) >= 500
$$;

-- Le propriétaire a ouvert les commentaires d'un lien : tout est lu (et n'a plus besoin de partir par e-mail).
create or replace function public.review_mark_seen(p_capture_id text, p_track_id text)
returns void language sql security definer set search_path = public as $$
  update public.review_notices n set seen_at = now(), emailed_at = coalesce(n.emailed_at, now())
    from public.review_links l
   where n.link_id = l.id and n.seen_at is null
     and ((p_capture_id is not null and l.capture_id = p_capture_id) or (p_track_id is not null and l.track_id = p_track_id))
$$;

-- Peut-on gérer ce commentaire (répondre, « traité », supprimer) ? Montage : mêmes règles que le Versioning ; morceau : son
-- compositeur, avec le feu vert track_review.
create or replace function public.review_comment_manageable(p_comment public.review_comments, p_studio boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_cap record;
begin
  if p_comment.capture_id is not null then
    if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then return false; end if;
    select owner_id, owner_studio_id into v_cap from public.video_captures where id = p_comment.capture_id;
    return found and public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s);
  end if;
  return public.track_review_mine(p_comment.track_id);
end;
$$;

-- Ce morceau est-il au compositeur connecté, avec la relecture ouverte pour lui ?
create or replace function public.track_review_mine(p_track_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_composer_id() is not null
     and public.feature_released('track_review', auth.uid())
     and exists (select 1 from public.tracks t where t.id = p_track_id and t.owner_id = public.current_composer_id())
$$;

revoke all on function public.review_link_open(text, text), public.video_review_capture(text, text), public.track_review_track(text, text),
  public.review_link_save(uuid, text, text, boolean, text, text, text, boolean, text), public.review_comment_json(public.review_comments),
  public.review_quota_full(uuid), public.review_mark_seen(text, text), public.review_comment_manageable(public.review_comments, boolean),
  public.track_review_mine(text) from public, anon, authenticated;

-- ---- 3. Côté client (sans compte) ----

-- Ce que la page peut savoir avant d'avoir le secret : le mode d'accès et le genre de lien (vidéo ou morceau). NULL = pas de lien actif.
create or replace function public.get_review_access(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('mode', access_mode, 'kind', case when track_id is not null then 'track' else 'video' end)
    from public.review_links where slug = p_slug and enabled
$$;
-- Ancien nom (pages relecture.html encore en cache) : liens vidéo seulement.
create or replace function public.get_video_review_access(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('mode', access_mode) from public.review_links where slug = p_slug and enabled and capture_id is not null
$$;

-- Vidéo (recopiée de 20261110020000, nouvelles tables).
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
  select coalesce(jsonb_agg(public.review_comment_json(c) order by c.created_at), '[]'::jsonb) into v_comments
  from public.review_comments c
  where c.capture_id = v_cap
    and (c.version_key = 'original' or exists (select 1 from public.video_capture_versions ver where ver.id = c.version_key and ver.capture_id = v_cap and ver.review_status <> 'draft'));
  return jsonb_build_object('title', v_capture.title, 'baseUrl', v_base, 'versions', v_versions, 'comments', v_comments);
end;
$$;

create or replace function public.add_video_review_comment(p_slug text, p_secret text, p_version_key text, p_t numeric, p_author text, p_body text, p_parent_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_link public.review_links := public.review_link_open(p_slug, p_secret);
  v_cap text := v_link.capture_id;
  v_author text := left(btrim(coalesce(p_author, '')), 40);
  v_body text := left(btrim(coalesce(p_body, '')), 2000);
  v_t numeric := coalesce(p_t, 0);
  v_parent public.review_comments;
  v_id uuid;
begin
  if v_cap is null then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if v_author = '' then raise exception 'prénom manquant'; end if;
  if v_body = '' then raise exception 'commentaire vide'; end if;
  if v_t < 0 or v_t > 86400 then raise exception 'instant invalide'; end if;
  if p_parent_id is not null then
    select * into v_parent from public.review_comments where id = p_parent_id and capture_id = v_cap and parent_id is null;
    if not found then raise exception 'commentaire introuvable'; end if;
    p_version_key := v_parent.version_key; v_t := v_parent.t;
  end if;
  if p_version_key is null or not (p_version_key = 'original'
     or exists (select 1 from public.video_capture_versions ver where ver.id = p_version_key and ver.capture_id = v_cap and ver.review_status <> 'draft')) then
    raise exception 'version introuvable';
  end if;
  if public.review_quota_full(v_link.id) then raise exception 'trop de commentaires'; end if;
  insert into public.review_comments (link_id, capture_id, version_key, parent_id, t, author, from_owner, body)
  values (v_link.id, v_cap, p_version_key, p_parent_id, v_t, v_author, false, v_body) returning id into v_id;
  insert into public.review_notices (link_id, comment_id, kind, author, excerpt) values (v_link.id, v_id, 'comment', v_author, left(v_body, 200));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.set_video_review_decision(p_slug text, p_secret text, p_version_id text, p_decision text, p_author text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_link public.review_links := public.review_link_open(p_slug, p_secret);
  v_cap text := v_link.capture_id;
  v_author text := left(btrim(coalesce(p_author, '')), 40);
  v_title text;
begin
  if v_cap is null then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if v_author = '' then raise exception 'prénom manquant'; end if;
  if p_decision is null or p_decision not in ('approved', 'changes_requested') then raise exception 'décision invalide'; end if;
  update public.video_capture_versions
     set review_status = p_decision, review_status_at = now(), review_status_by = v_author
   where id = p_version_id and capture_id = v_cap and review_status <> 'draft'
   returning title into v_title;
  if not found then raise exception 'version introuvable'; end if;
  insert into public.review_notices (link_id, kind, author, excerpt) values (v_link.id, 'decision', v_author, p_decision || ':' || left(coalesce(v_title, ''), 150));
  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

-- Morceau : ce que voit le client (l'identifiant du morceau, que la page lit comme une page publique, et les commentaires).
-- Seuls les commentaires de CE lien (un client ne voit jamais ceux d'un autre client).
create or replace function public.get_track_review(p_slug text, p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_link public.review_links := public.review_link_open(p_slug, p_secret); v_track text := v_link.track_id; v_title text; v_comments jsonb;
begin
  if v_track is null then return null; end if;
  select title into v_title from public.tracks where id = v_track;
  select coalesce(jsonb_agg(public.review_comment_json(c) order by c.created_at), '[]'::jsonb) into v_comments
    from public.review_comments c where c.link_id = v_link.id;
  return jsonb_build_object('kind', 'track', 'trackId', v_track, 'title', v_title, 'comments', v_comments);
end;
$$;

-- Un commentaire du client sur un morceau (ou une réponse) : instant + état du lecteur (objet JSON, 8 000 caractères au plus).
create or replace function public.add_track_review_comment(p_slug text, p_secret text, p_t numeric, p_state jsonb, p_author text, p_body text, p_parent_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_link public.review_links := public.review_link_open(p_slug, p_secret);
  v_track text := v_link.track_id;
  v_author text := left(btrim(coalesce(p_author, '')), 40);
  v_body text := left(btrim(coalesce(p_body, '')), 2000);
  v_t numeric := coalesce(p_t, 0);
  v_state jsonb := p_state;
  v_parent public.review_comments;
  v_id uuid;
begin
  if v_track is null then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if v_author = '' then raise exception 'prénom manquant'; end if;
  if v_body = '' then raise exception 'commentaire vide'; end if;
  if v_t < 0 or v_t > 86400 then raise exception 'instant invalide'; end if;
  if v_state is not null and (jsonb_typeof(v_state) <> 'object' or length(v_state::text) > 8000) then raise exception 'état invalide'; end if;
  if p_parent_id is not null then
    select * into v_parent from public.review_comments where id = p_parent_id and link_id = v_link.id and parent_id is null;
    if not found then raise exception 'commentaire introuvable'; end if;
    v_t := v_parent.t; v_state := null;
  end if;
  if public.review_quota_full(v_link.id) then raise exception 'trop de commentaires'; end if;
  insert into public.review_comments (link_id, track_id, version_key, parent_id, t, state, author, from_owner, body)
  values (v_link.id, v_track, 'original', p_parent_id, v_t, v_state, v_author, false, v_body) returning id into v_id;
  insert into public.review_notices (link_id, comment_id, kind, author, excerpt) values (v_link.id, v_id, 'comment', v_author, left(v_body, 200));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.get_review_access(text), public.get_video_review_access(text), public.get_video_review(text, text),
  public.add_video_review_comment(text, text, text, numeric, text, text, uuid), public.set_video_review_decision(text, text, text, text, text),
  public.get_track_review(text, text), public.add_track_review_comment(text, text, numeric, jsonb, text, text, uuid) from public;
grant execute on function public.get_review_access(text), public.get_video_review_access(text), public.get_video_review(text, text),
  public.add_video_review_comment(text, text, text, numeric, text, text, uuid), public.set_video_review_decision(text, text, text, text, text),
  public.get_track_review(text, text), public.add_track_review_comment(text, text, numeric, jsonb, text, text, uuid) to anon, authenticated;

-- ---- 4. Écoute des morceaux protégés avec la preuve du lien (track-audio-url) ----
-- Le morceau relu, et les morceaux de ses sections s'il est un séquentiel hybride ; leurs Sfx attachés.
create or replace function public.track_review_tracks(p_track_id text)
returns setof text language sql stable security definer set search_path = public as $$
  select p_track_id
  union
  select s->>'trackId' from public.tracks t, jsonb_array_elements(case when jsonb_typeof(t.sections) = 'array' then t.sections else '[]'::jsonb end) s
   where t.id = p_track_id and t.mode = 'hybrid-sequential' and s->>'trackId' is not null
$$;
revoke all on function public.track_review_tracks(text) from public, anon, authenticated;

create or replace function public.can_hear_track_by_review(p_track_id text, p_slug text, p_secret text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_track text;
begin
  if public.can_hear_track(p_track_id) then return true; end if;
  if p_slug is null or p_secret is null then return false; end if;
  v_track := public.track_review_track(p_slug, p_secret);
  return v_track is not null and p_track_id in (select public.track_review_tracks(v_track));
end;
$$;
create or replace function public.can_hear_sfx_by_review(p_sfx_id text, p_slug text, p_secret text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_track text;
begin
  if public.can_hear_sfx(p_sfx_id) then return true; end if;
  if p_slug is null or p_secret is null then return false; end if;
  v_track := public.track_review_track(p_slug, p_secret);
  return v_track is not null and exists (select 1 from public.track_sfx ts where ts.sfx_id = p_sfx_id and ts.track_id in (select public.track_review_tracks(v_track)));
end;
$$;
revoke execute on function public.can_hear_track_by_review(text, text, text), public.can_hear_sfx_by_review(text, text, text) from public;
grant execute on function public.can_hear_track_by_review(text, text, text), public.can_hear_sfx_by_review(text, text, text) to anon, authenticated;

-- ---- 5. Côté propriétaire ----

-- Vidéo (recopiées de 20261109030000 / 20261109020000, nouvelles tables).
create or replace function public.get_video_review_link(p_capture_id text, p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_cap record; v_link public.review_links;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then return null; end if;
  select owner_id, owner_studio_id into v_cap from public.video_captures where id = p_capture_id;
  if not found or not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then return null; end if;
  select * into v_link from public.review_links where capture_id = p_capture_id;
  if not found then return null; end if;
  return jsonb_build_object('slug', v_link.slug, 'enabled', v_link.enabled, 'mode', v_link.access_mode);
end;
$$;

create or replace function public.set_video_review_link(
  p_capture_id text, p_enabled boolean default null, p_slug text default null, p_mode text default null,
  p_password text default null, p_rotate boolean default false, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_cap record;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then raise exception 'Non autorisé'; end if;
  select owner_id, owner_studio_id into v_cap from public.video_captures where id = p_capture_id;
  if not found or not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then raise exception 'Montage introuvable'; end if;
  return public.review_link_save(null, p_capture_id, null, p_enabled, p_slug, p_mode, p_password, p_rotate, null);
end;
$$;

-- Tous les commentaires du montage (versions retirées ou repassées en brouillon comprises). Les ouvrir vaut lecture des avis.
create or replace function public.list_video_review_comments(p_capture_id text, p_studio boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_cap record; v_result jsonb;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then return '[]'::jsonb; end if;
  select owner_id, owner_studio_id into v_cap from public.video_captures where id = p_capture_id;
  if not found or not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(public.review_comment_json(c) order by c.created_at), '[]'::jsonb) into v_result
  from public.review_comments c
  where c.capture_id = p_capture_id
    and (c.version_key = 'original' or exists (select 1 from public.video_capture_versions ver where ver.id = c.version_key and ver.capture_id = p_capture_id));
  perform public.review_mark_seen(p_capture_id, null);
  return v_result;
end;
$$;

-- Morceau.
-- Les liens du morceau (un par client) : { id, slug, label, enabled, mode, comments, unseen }, jamais le secret.
create or replace function public.list_track_review_links(p_track_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.track_review_mine(p_track_id) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'slug', l.slug, 'label', l.label, 'enabled', l.enabled, 'mode', l.access_mode, 'createdAt', l.created_at,
      'comments', (select count(*) from public.review_comments c where c.link_id = l.id and c.parent_id is null and not c.from_owner),
      'unseen', (select count(*) from public.review_notices n where n.link_id = l.id and n.seen_at is null)) order by l.created_at), '[]'::jsonb)
    into v_result from public.review_links l where l.track_id = p_track_id;
  return v_result;
end;
$$;

-- Crée un lien (p_link_id NULL : nom obligatoire) ou règle un lien existant du morceau.
create or replace function public.set_track_review_link(
  p_track_id text, p_link_id uuid default null, p_enabled boolean default null, p_slug text default null, p_mode text default null,
  p_password text default null, p_rotate boolean default false, p_label text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.track_review_mine(p_track_id) then raise exception 'Non autorisé'; end if;
  if p_link_id is null and (select count(*) from public.review_links where track_id = p_track_id) >= 50 then raise exception 'trop de liens pour ce morceau (50 au plus)'; end if;
  return public.review_link_save(p_link_id, null, p_track_id, p_enabled, p_slug, p_mode, p_password, p_rotate, p_label);
end;
$$;

-- Supprimer un lien de morceau : ses commentaires et avis partent avec lui ; l'adresse est libérée.
create or replace function public.delete_track_review_link(p_link_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_track text;
begin
  select track_id into v_track from public.review_links where id = p_link_id;
  if v_track is null then return; end if;
  if not public.track_review_mine(v_track) then raise exception 'Non autorisé'; end if;
  delete from public.review_links where id = p_link_id;
end;
$$;

create or replace function public.list_track_review_comments(p_track_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.track_review_mine(p_track_id) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(public.review_comment_json(c) order by c.created_at), '[]'::jsonb) into v_result
    from public.review_comments c where c.track_id = p_track_id;
  perform public.review_mark_seen(null, p_track_id);
  return v_result;
end;
$$;

-- Communs : répondre, « traité » / « à traiter », supprimer (modération ; les réponses partent avec).
-- p_studio : la relecture d'un montage de studio (Versioning du studio) ; sans effet pour un morceau.

create or replace function public.reply_review_comment(p_parent_id uuid, p_body text, p_author text, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_parent public.review_comments; v_id uuid;
  v_body text := left(btrim(coalesce(p_body, '')), 2000); v_author text := left(btrim(coalesce(p_author, '')), 40);
begin
  if v_body = '' then raise exception 'réponse vide'; end if;
  if v_author = '' then v_author := '—'; end if;
  select * into v_parent from public.review_comments where id = p_parent_id and parent_id is null;
  if not found then raise exception 'commentaire introuvable'; end if;
  if not public.review_comment_manageable(v_parent, p_studio) then raise exception 'Non autorisé'; end if;
  insert into public.review_comments (link_id, capture_id, track_id, version_key, parent_id, t, author, from_owner, body)
  values (v_parent.link_id, v_parent.capture_id, v_parent.track_id, v_parent.version_key, p_parent_id, v_parent.t, v_author, true, v_body) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.resolve_review_comment(p_id uuid, p_resolved boolean, p_studio boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_com public.review_comments;
begin
  select * into v_com from public.review_comments where id = p_id;
  if not found then raise exception 'commentaire introuvable'; end if;
  if not public.review_comment_manageable(v_com, p_studio) then raise exception 'Non autorisé'; end if;
  update public.review_comments set resolved = coalesce(p_resolved, true) where id = p_id;
end;
$$;

create or replace function public.delete_review_comment(p_id uuid, p_studio boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_com public.review_comments;
begin
  select * into v_com from public.review_comments where id = p_id;
  if not found then return; end if;
  if not public.review_comment_manageable(v_com, p_studio) then raise exception 'Non autorisé'; end if;
  delete from public.review_comments where id = p_id;
end;
$$;

-- Anciens noms vidéo : de simples relais, pour l'atelier encore en ligne (capture-versioning.js d'avant cette fusion) le temps que le
-- nouveau code soit publié. À supprimer par une migration suivante une fois main déployé (voir layerpitch-docs, relecture des morceaux).
create or replace function public.reply_video_review_comment(p_parent_id uuid, p_body text, p_author text, p_studio boolean default false)
returns jsonb language sql security definer set search_path = public as $$ select public.reply_review_comment(p_parent_id, p_body, p_author, p_studio) $$;
create or replace function public.resolve_video_review_comment(p_id uuid, p_resolved boolean, p_studio boolean default false)
returns void language sql security definer set search_path = public as $$ select public.resolve_review_comment(p_id, p_resolved, p_studio) $$;
create or replace function public.delete_video_review_comment(p_id uuid, p_studio boolean default false)
returns void language sql security definer set search_path = public as $$ select public.delete_review_comment(p_id, p_studio) $$;
revoke all on function public.reply_video_review_comment(uuid, text, text, boolean), public.resolve_video_review_comment(uuid, boolean, boolean),
  public.delete_video_review_comment(uuid, boolean) from public, anon;
grant execute on function public.reply_video_review_comment(uuid, text, text, boolean), public.resolve_video_review_comment(uuid, boolean, boolean),
  public.delete_video_review_comment(uuid, boolean) to authenticated;

-- Cloche : les liens dont je suis propriétaire avec du neuf (commentaires de client, décisions), un résumé par lien.
create or replace function public.my_review_updates()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.current_composer_id(); v_s uuid := public.current_studio_id(); v_result jsonb;
begin
  if v_c is null and v_s is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(x order by x->>'latestAt' desc), '[]'::jsonb) into v_result from (
    select jsonb_build_object(
      'linkId', l.id, 'kind', case when l.track_id is not null then 'track' else 'video' end,
      'targetId', coalesce(l.track_id, l.capture_id), 'title', coalesce(t.title, vc.title, ''), 'slug', l.slug, 'label', l.label, 'packId', vc.pack_id,
      'comments', count(*) filter (where n.kind = 'comment'), 'decisions', count(*) filter (where n.kind = 'decision'),
      'latestAt', max(n.created_at),
      'lastAuthor', (array_agg(n.author order by n.created_at desc))[1], 'lastExcerpt', (array_agg(n.excerpt order by n.created_at desc))[1],
      'lastKind', (array_agg(n.kind order by n.created_at desc))[1]) as x
    from public.review_notices n
    join public.review_links l on l.id = n.link_id
    left join public.tracks t on t.id = l.track_id
    left join public.video_captures vc on vc.id = l.capture_id
    where n.seen_at is null
      and ((l.track_id is not null and v_c is not null and t.owner_id = v_c and public.feature_released('track_review', auth.uid()))
        or (l.capture_id is not null and ((v_c is not null and vc.owner_id = v_c) or (v_s is not null and vc.owner_studio_id = v_s))))
    group by l.id, t.title, vc.title, vc.pack_id
  ) s;
  return v_result;
end;
$$;

revoke all on function public.get_video_review_link(text, boolean), public.set_video_review_link(text, boolean, text, text, text, boolean, boolean),
  public.list_video_review_comments(text, boolean), public.list_track_review_links(text), public.set_track_review_link(text, uuid, boolean, text, text, text, boolean, text), public.delete_track_review_link(uuid),
  public.list_track_review_comments(text), public.reply_review_comment(uuid, text, text, boolean), public.resolve_review_comment(uuid, boolean, boolean),
  public.delete_review_comment(uuid, boolean), public.my_review_updates() from public, anon;
grant execute on function public.get_video_review_link(text, boolean), public.set_video_review_link(text, boolean, text, text, text, boolean, boolean),
  public.list_video_review_comments(text, boolean), public.list_track_review_links(text), public.set_track_review_link(text, uuid, boolean, text, text, text, boolean, text), public.delete_track_review_link(uuid),
  public.list_track_review_comments(text), public.reply_review_comment(uuid, text, text, boolean), public.resolve_review_comment(uuid, boolean, boolean),
  public.delete_review_comment(uuid, boolean), public.my_review_updates() to authenticated;

-- ---- 6. E-mail récapitulatif (Edge Function review-notify, clé de service seulement) ----
-- Prend les avis pas encore vus ni envoyés d'un lien actif. Sans p_leaving (un commentaire vient d'arriver), rien si un e-mail est
-- parti pour ce lien il y a moins de 10 minutes : les suivants attendent le prochain envoi (le client quitte la page, p_leaving, ou
-- un commentaire arrive plus de 10 minutes après). Les avis pris sont marqués envoyés ; en cas d'échec, release_review_notices.
create or replace function public.claim_review_notices(p_slug text, p_leaving boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_link public.review_links; v_owner uuid; v_title text; v_notices jsonb; v_lang text; v_pack text;
begin
  select * into v_link from public.review_links where slug = p_slug and enabled;
  if not found then return null; end if;
  if not exists (select 1 from public.review_notices where link_id = v_link.id and emailed_at is null and seen_at is null) then return null; end if;
  if not coalesce(p_leaving, false) and v_link.last_emailed_at is not null and v_link.last_emailed_at > now() - interval '10 minutes' then return null; end if;
  with taken as (
    update public.review_notices set emailed_at = now()
     where link_id = v_link.id and emailed_at is null and seen_at is null
    returning id, kind, author, excerpt, created_at
  )
  select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'author', author, 'excerpt', excerpt, 'createdAt', created_at) order by created_at)
    into v_notices from taken;
  update public.review_links set last_emailed_at = now() where id = v_link.id;
  if v_link.track_id is not null then
    select cp.profile_id, t.title into v_owner, v_title from public.tracks t join public.composer_profiles cp on cp.id = t.owner_id where t.id = v_link.track_id;
  else
    select coalesce(cp.profile_id, sp.profile_id), vc.title, vc.pack_id into v_owner, v_title, v_pack
      from public.video_captures vc
      left join public.composer_profiles cp on cp.id = vc.owner_id
      left join public.studio_profiles sp on sp.id = vc.owner_studio_id
     where vc.id = v_link.capture_id;
  end if;
  select lang into v_lang from public.profiles where id = v_owner;
  return jsonb_build_object('ownerProfileId', v_owner, 'lang', v_lang, 'kind', case when v_link.track_id is not null then 'track' else 'video' end,
    'targetId', coalesce(v_link.track_id, v_link.capture_id), 'title', coalesce(v_title, ''), 'slug', v_link.slug, 'label', v_link.label, 'packId', v_pack, 'notices', coalesce(v_notices, '[]'::jsonb));
end;
$$;

create or replace function public.release_review_notices(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update public.review_notices set emailed_at = null where id = any(p_ids) and seen_at is null
$$;

revoke all on function public.claim_review_notices(text, boolean), public.release_review_notices(uuid[]) from public, anon, authenticated;
grant execute on function public.claim_review_notices(text, boolean), public.release_review_notices(uuid[]) to service_role;
