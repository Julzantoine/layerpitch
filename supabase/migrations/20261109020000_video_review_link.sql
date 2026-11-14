-- LayerPitch — Versioning vidéo : lien de relecture client + commentaires à l'image près (9 novembre 2026, idées tirées de Pibox).
--
-- Décisions de Jules-Antoine (9/11) :
--   - UN lien secret par montage : le client voit toutes les versions marquées « Envoyée au client » (ou plus loin), compare, et
--     commente sur celle qu'il regarde. Le lien se désactive et se renouvelle (l'ancien meurt).
--   - Tout porteur du lien peut commenter, en donnant un prénom (pas de compte).
--   - Le client peut « Valider » ou « Demander des modifs » : la version passe toute seule au statut correspondant (par qui : review_status_by).
--   - Les commentaires reviennent au compositeur (liste + marqueurs sur la frise de l'atelier) ; il répond et marque « traité ».
--
-- Sécurité : RLS activée SANS policy sur les deux tables (accès uniquement par ces fonctions). Les fonctions « client » (anon) ne
-- font confiance qu'au jeton ; les fonctions « compositeur » suivent la même barrière que le reste du Versioning (video_can_version :
-- admin seulement jusqu'au feu vert). Un lien n'existe donc que si un admin l'a créé.

-- ---- 1. Qui a changé le statut (le client, ou NULL = le compositeur) ----
alter table public.video_capture_versions add column if not exists review_status_by text;

create or replace function public.set_video_capture_version_status(p_id text, p_status text, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
  v_now timestamptz := now();
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
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

create or replace function public.list_video_capture_versions(p_capture_id text, p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_result jsonb;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'captureId', capture_id, 'title', title, 'substitutions', substitutions,
    'lastExportVideoId', last_export_video_id, 'createdAt', created_at, 'updatedAt', updated_at,
    'status', review_status, 'statusAt', review_status_at, 'statusBy', review_status_by
  ) order by created_at), '[]'::jsonb)
  into v_result
  from public.video_capture_versions
  where capture_id = p_capture_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
  return v_result;
end;
$$;

-- ---- 2. Tables ----
create table public.video_review_links (
  capture_id text primary key references public.video_captures(id) on delete cascade,
  token text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.video_review_links enable row level security;

create table public.video_review_comments (
  id uuid primary key default gen_random_uuid(),
  capture_id text not null references public.video_captures(id) on delete cascade,
  version_key text not null,                                  -- 'original' ou l'identifiant d'une version vidéo
  parent_id uuid references public.video_review_comments(id) on delete cascade, -- réponse : le commentaire auquel elle répond
  t numeric not null default 0 check (t >= 0 and t <= 86400), -- seconde dans la vidéo (une réponse reprend celle de son parent)
  author text not null check (char_length(author) between 1 and 40),
  from_owner boolean not null default false,                  -- écrit par le compositeur (réponse) plutôt que par le client
  body text not null check (char_length(body) between 1 and 2000),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index video_review_comments_capture_idx on public.video_review_comments(capture_id, created_at);
alter table public.video_review_comments enable row level security;

-- Montage relu par un jeton valide et actif (sinon NULL).
create or replace function public.video_review_capture(p_token text)
returns text language sql stable security definer set search_path = public as $$
  select capture_id from public.video_review_links where token = p_token and enabled and p_token is not null and char_length(p_token) >= 32
$$;
revoke all on function public.video_review_capture(text) from public, anon, authenticated;

-- ---- 3. Côté client (sans compte, par le jeton) ----

-- Ce que voit le client : la vidéo muette, la musique d'origine et les versions sorties du brouillon (avec leur statut), et les commentaires.
create or replace function public.get_video_review(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cap text := public.video_review_capture(p_token);
  v_capture public.video_captures; v_versions jsonb; v_comments jsonb; v_base text;
begin
  if v_cap is null then return null; end if;
  select * into v_capture from public.video_captures where id = v_cap;
  select base || file into v_base from public.composer_videos where id = v_capture.base_video_id;
  select coalesce(jsonb_agg(x.item order by x.ord, x.created_at), '[]'::jsonb) into v_versions
  from (
    select 0 as ord, v_capture.created_at as created_at,
      jsonb_build_object('key', 'original', 'title', null, 'url', cv.base || cv.file, 'kind', case when cv.kind = 'capture_audio' then 'audio' else 'video' end,
        'cues', coalesce(v_capture.last_export_cues, '[]'::jsonb), 'status', null, 'statusBy', null) as item
    from public.composer_videos cv where cv.id = v_capture.last_export_video_id
    union all
    select 1, ver.created_at,
      jsonb_build_object('key', ver.id, 'title', ver.title, 'url', cv.base || cv.file, 'kind', case when cv.kind = 'capture_audio' then 'audio' else 'video' end,
        'cues', coalesce(ver.last_export_cues, '[]'::jsonb), 'status', ver.review_status, 'statusBy', ver.review_status_by)
    from public.video_capture_versions ver
    join public.composer_videos cv on cv.id = ver.last_export_video_id
    where ver.capture_id = v_cap and ver.review_status <> 'draft'
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

-- Un commentaire du client (ou une réponse à un commentaire). Garde-fous : longueurs, versions visibles seulement, quotas.
create or replace function public.add_video_review_comment(p_token text, p_version_key text, p_t numeric, p_author text, p_body text, p_parent_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cap text := public.video_review_capture(p_token);
  v_author text := left(btrim(coalesce(p_author, '')), 40);
  v_body text := left(btrim(coalesce(p_body, '')), 2000);
  v_t numeric := coalesce(p_t, 0);
  v_parent public.video_review_comments;
  v_id uuid;
begin
  if v_cap is null then raise exception 'Lien invalide'; end if;
  if v_author = '' then raise exception 'prénom manquant'; end if;
  if v_body = '' then raise exception 'commentaire vide'; end if;
  if v_t < 0 or v_t > 86400 then raise exception 'instant invalide'; end if;
  if p_parent_id is not null then
    select * into v_parent from public.video_review_comments where id = p_parent_id and capture_id = v_cap and parent_id is null;
    if not found then raise exception 'commentaire introuvable'; end if;
    p_version_key := v_parent.version_key; v_t := v_parent.t;
  end if;
  if p_version_key is null or not (p_version_key = 'original'
     or exists (select 1 from public.video_capture_versions ver where ver.id = p_version_key and ver.capture_id = v_cap and ver.review_status <> 'draft')) then
    raise exception 'version introuvable';
  end if;
  -- Quotas : 30 commentaires de client toutes les 10 minutes et 500 au total par montage.
  if (select count(*) from public.video_review_comments where capture_id = v_cap and not from_owner and created_at > now() - interval '10 minutes') >= 30
     or (select count(*) from public.video_review_comments where capture_id = v_cap) >= 500 then
    raise exception 'trop de commentaires';
  end if;
  insert into public.video_review_comments (capture_id, version_key, parent_id, t, author, from_owner, body)
  values (v_cap, p_version_key, p_parent_id, v_t, v_author, false, v_body) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Décision du client sur une version : « Valider » ou « Demander des modifs ». Le statut change tout seul, avec son prénom.
create or replace function public.set_video_review_decision(p_token text, p_version_id text, p_decision text, p_author text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cap text := public.video_review_capture(p_token);
  v_author text := left(btrim(coalesce(p_author, '')), 40);
begin
  if v_cap is null then raise exception 'Lien invalide'; end if;
  if v_author = '' then raise exception 'prénom manquant'; end if;
  if p_decision is null or p_decision not in ('approved', 'changes_requested') then raise exception 'décision invalide'; end if;
  update public.video_capture_versions
     set review_status = p_decision, review_status_at = now(), review_status_by = v_author
   where id = p_version_id and capture_id = v_cap and review_status <> 'draft';
  if not found then raise exception 'version introuvable'; end if;
  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

revoke all on function public.get_video_review(text), public.add_video_review_comment(text, text, numeric, text, text, uuid),
  public.set_video_review_decision(text, text, text, text) from public;
grant execute on function public.get_video_review(text), public.add_video_review_comment(text, text, numeric, text, text, uuid),
  public.set_video_review_decision(text, text, text, text) to anon, authenticated;

-- ---- 4. Côté compositeur (ou studio) ----

-- Le lien du montage, s'il existe : { token, enabled }.
create or replace function public.get_video_review_link(p_capture_id text, p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_cap record; v_link public.video_review_links;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then return null; end if;
  select owner_id, owner_studio_id into v_cap from public.video_captures where id = p_capture_id;
  if not found or not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then return null; end if;
  select * into v_link from public.video_review_links where capture_id = p_capture_id;
  if not found then return null; end if;
  return jsonb_build_object('token', v_link.token, 'enabled', v_link.enabled);
end;
$$;

-- Crée le lien (première fois), l'active / le désactive, ou le renouvelle (p_rotate : nouveau jeton, l'ancien ne marche plus).
create or replace function public.set_video_review_link(p_capture_id text, p_enabled boolean, p_rotate boolean default false, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_cap record; v_link public.video_review_links;
  v_new text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then raise exception 'Non autorisé'; end if;
  select owner_id, owner_studio_id into v_cap from public.video_captures where id = p_capture_id;
  if not found or not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then raise exception 'Montage introuvable'; end if;
  select * into v_link from public.video_review_links where capture_id = p_capture_id;
  if not found then
    insert into public.video_review_links (capture_id, token, enabled) values (p_capture_id, v_new, coalesce(p_enabled, true)) returning * into v_link;
  else
    update public.video_review_links set enabled = coalesce(p_enabled, enabled), token = case when p_rotate then v_new else token end, updated_at = now()
     where capture_id = p_capture_id returning * into v_link;
  end if;
  return jsonb_build_object('token', v_link.token, 'enabled', v_link.enabled);
end;
$$;

-- Tous les commentaires du montage (versions retirées ou repassées en brouillon comprises : le compositeur voit tout).
create or replace function public.list_video_review_comments(p_capture_id text, p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_cap record; v_result jsonb;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then return '[]'::jsonb; end if;
  select owner_id, owner_studio_id into v_cap from public.video_captures where id = p_capture_id;
  if not found or not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'versionKey', c.version_key, 'parentId', c.parent_id, 't', c.t, 'author', c.author,
    'fromOwner', c.from_owner, 'body', c.body, 'resolved', c.resolved, 'createdAt', c.created_at
  ) order by c.created_at), '[]'::jsonb) into v_result
  from public.video_review_comments c
  where c.capture_id = p_capture_id
    and (c.version_key = 'original' or exists (select 1 from public.video_capture_versions ver where ver.id = c.version_key and ver.capture_id = p_capture_id));
  return v_result;
end;
$$;

-- Réponse du compositeur à un commentaire du client.
create or replace function public.reply_video_review_comment(p_parent_id uuid, p_body text, p_author text, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_parent public.video_review_comments; v_cap record; v_id uuid;
  v_body text := left(btrim(coalesce(p_body, '')), 2000); v_author text := left(btrim(coalesce(p_author, '')), 40);
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then raise exception 'Non autorisé'; end if;
  if v_body = '' then raise exception 'réponse vide'; end if;
  if v_author = '' then v_author := '—'; end if;
  select * into v_parent from public.video_review_comments where id = p_parent_id and parent_id is null;
  if not found then raise exception 'commentaire introuvable'; end if;
  select owner_id, owner_studio_id into v_cap from public.video_captures where id = v_parent.capture_id;
  if not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then raise exception 'Non autorisé'; end if;
  insert into public.video_review_comments (capture_id, version_key, parent_id, t, author, from_owner, body)
  values (v_parent.capture_id, v_parent.version_key, p_parent_id, v_parent.t, v_author, true, v_body) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- « Traité » / « à traiter » sur un commentaire du client.
create or replace function public.resolve_video_review_comment(p_id uuid, p_resolved boolean, p_studio boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_com public.video_review_comments; v_cap record;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then raise exception 'Non autorisé'; end if;
  select * into v_com from public.video_review_comments where id = p_id;
  if not found then raise exception 'commentaire introuvable'; end if;
  select owner_id, owner_studio_id into v_cap from public.video_captures where id = v_com.capture_id;
  if not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then raise exception 'Non autorisé'; end if;
  update public.video_review_comments set resolved = coalesce(p_resolved, true) where id = p_id;
end;
$$;

-- Supprimer un commentaire (modération) ; ses réponses partent avec lui.
create or replace function public.delete_video_review_comment(p_id uuid, p_studio boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_com public.video_review_comments; v_cap record;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then raise exception 'Non autorisé'; end if;
  select * into v_com from public.video_review_comments where id = p_id;
  if not found then return; end if;
  select owner_id, owner_studio_id into v_cap from public.video_captures where id = v_com.capture_id;
  if not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then raise exception 'Non autorisé'; end if;
  delete from public.video_review_comments where id = p_id;
end;
$$;

revoke all on function public.get_video_review_link(text, boolean), public.set_video_review_link(text, boolean, boolean, boolean),
  public.list_video_review_comments(text, boolean), public.reply_video_review_comment(uuid, text, text, boolean),
  public.resolve_video_review_comment(uuid, boolean, boolean), public.delete_video_review_comment(uuid, boolean) from public, anon;
grant execute on function public.get_video_review_link(text, boolean), public.set_video_review_link(text, boolean, boolean, boolean),
  public.list_video_review_comments(text, boolean), public.reply_video_review_comment(uuid, text, text, boolean),
  public.resolve_video_review_comment(uuid, boolean, boolean), public.delete_video_review_comment(uuid, boolean) to authenticated;
