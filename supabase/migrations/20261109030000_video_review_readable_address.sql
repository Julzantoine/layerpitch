-- LayerPitch — Lien de relecture client : adresse lisible + accès par mot de passe ou lien magique (9 novembre 2026).
--
-- Décisions de Jules-Antoine (9/11) :
--   - Adresse lisible : /relecture/<nom>, nom UNIQUE sur tout le site (comme /vitrine/<nom>), choisi par le compositeur.
--   - On réutilise le principe des AdReels privés (migration 20261006010000) : le nom seul ne donne rien, il faut un secret —
--       * « lien magique » (défaut) : clé aléatoire longue placée dans le lien après « #k= » (jamais envoyée à un serveur) ; seule son empreinte est
--         gardée, la clé n'est montrée qu'UNE fois, à la création ; la perdre = en créer une nouvelle (l'ancienne meurt) ;
--       * « mot de passe » : 6 caractères au moins, salé et haché (10 000 tours), donné au client à part.
--     Frein : 10 secrets faux par 10 minutes et par lien (puis « trop d'essais »).
--
-- Remplace le jeton en clair de la migration 20261109020000 (livrée le jour même, aucun lien envoyé à un client). Un éventuel lien déjà créé
-- est conservé : son ancien jeton devient sa clé magique (empreinte), son nom lisible est « relecture-<début de l'identifiant du montage> ».
--
-- Les fonctions « client » ne lèvent JAMAIS d'erreur sur un mauvais secret (elles répondent ok:false) : une erreur annulerait l'enregistrement
-- de l'essai raté, et le frein ne compterait rien.

-- ---- 1. Table des liens ----
alter table public.video_review_links
  add column if not exists slug text,
  add column if not exists access_mode text not null default 'magic',
  add column if not exists salt text,
  add column if not exists iterations int,
  add column if not exists secret_hash text;

update public.video_review_links set salt = replace(gen_random_uuid()::text, '-', ''), iterations = 1 where secret_hash is null;
update public.video_review_links
   set secret_hash = public.ad_reel_secret_hash(salt, token, 1),
       slug = coalesce(slug, 'relecture-' || substr(regexp_replace(lower(capture_id), '[^a-z0-9]', '', 'g'), 1, 10))
 where secret_hash is null;

alter table public.video_review_links alter column slug set not null;
alter table public.video_review_links alter column salt set not null;
alter table public.video_review_links alter column iterations set not null;
alter table public.video_review_links alter column secret_hash set not null;
alter table public.video_review_links add constraint video_review_links_slug_unique unique (slug);
alter table public.video_review_links add constraint video_review_links_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60);
alter table public.video_review_links add constraint video_review_links_mode_check check (access_mode in ('magic', 'password'));

-- Anciennes fonctions (jeton en clair) : remplacées plus bas, avant de retirer la colonne.
drop function if exists public.get_video_review(text);
drop function if exists public.add_video_review_comment(text, text, numeric, text, text, uuid);
drop function if exists public.set_video_review_decision(text, text, text, text);
drop function if exists public.get_video_review_link(text, boolean);
drop function if exists public.set_video_review_link(text, boolean, boolean, boolean);
drop function if exists public.video_review_capture(text);
alter table public.video_review_links drop column token;

-- Essais ratés (frein).
create table public.video_review_access_failures (
  capture_id text not null,
  at timestamptz not null default now()
);
create index video_review_access_failures_idx on public.video_review_access_failures (capture_id, at);
alter table public.video_review_access_failures enable row level security;
revoke all on public.video_review_access_failures from anon, authenticated;

-- ---- 2. Adresse réservée : /relecture ----
create or replace function public.handle_is_reserved(p_handle text)
returns boolean
language sql
immutable
as $$
  select p_handle = any(array[
    'index','pack','collection','admin','admin-beta-console','admin-analytics','bienvenue','landing','landing-en',
    'layerpitch-backstage','library','mes-albums','mon-compte','video-test','video-engine-prototype','404',
    'api','audio','images','fonts','video','vendor','sandbox','scripts','supabase','docs','data','u','landing-assets',
    'node_modules','assets','static','www','app','beta','layerpitch','help','aide','support','contact','login','signup',
    'vitrine','projet','projets','studio','catalogue','tarifs','invitation','album','shop',
    'compositeurs','composers','annuaire','directory','relecture'
  ]);
$$;

-- ---- 3. Vérification du secret (interne) ----
-- Renvoie l'identifiant du montage si (nom, secret) vont ensemble et que le lien est actif, sinon NULL. Lève « throttled » seulement quand le frein
-- est déjà plein (rien n'est alors enregistré, donc l'annulation ne coûte rien).
create or replace function public.video_review_capture(p_slug text, p_secret text)
returns text language plpgsql security definer set search_path = public as $$
declare l public.video_review_links;
begin
  if p_slug is null then return null; end if;
  select * into l from public.video_review_links where slug = p_slug and enabled;
  if not found then return null; end if;
  if (select count(*) from public.video_review_access_failures where capture_id = l.capture_id and at > now() - interval '10 minutes') >= 10 then
    raise exception 'trop d''essais, réessayez dans quelques minutes' using hint = 'throttled';
  end if;
  if p_secret is not null and p_secret <> '' and public.ad_reel_secret_hash(l.salt, p_secret, l.iterations) = l.secret_hash then return l.capture_id; end if;
  insert into public.video_review_access_failures (capture_id) values (l.capture_id);
  delete from public.video_review_access_failures where at < now() - interval '1 day';
  return null;
end;
$$;
revoke all on function public.video_review_capture(text, text) from public, anon, authenticated;

-- ---- 4. Côté client (sans compte) ----

-- Ce que la page peut savoir avant d'avoir le secret : le mode d'accès d'un lien actif (rien d'autre). NULL = pas de lien actif à ce nom.
create or replace function public.get_video_review_access(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('mode', access_mode) from public.video_review_links where slug = p_slug and enabled
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

create or replace function public.add_video_review_comment(p_slug text, p_secret text, p_version_key text, p_t numeric, p_author text, p_body text, p_parent_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cap text := public.video_review_capture(p_slug, p_secret);
  v_author text := left(btrim(coalesce(p_author, '')), 40);
  v_body text := left(btrim(coalesce(p_body, '')), 2000);
  v_t numeric := coalesce(p_t, 0);
  v_parent public.video_review_comments;
  v_id uuid;
begin
  if v_cap is null then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
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

create or replace function public.set_video_review_decision(p_slug text, p_secret text, p_version_id text, p_decision text, p_author text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cap text := public.video_review_capture(p_slug, p_secret);
  v_author text := left(btrim(coalesce(p_author, '')), 40);
begin
  if v_cap is null then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if v_author = '' then raise exception 'prénom manquant'; end if;
  if p_decision is null or p_decision not in ('approved', 'changes_requested') then raise exception 'décision invalide'; end if;
  update public.video_capture_versions
     set review_status = p_decision, review_status_at = now(), review_status_by = v_author
   where id = p_version_id and capture_id = v_cap and review_status <> 'draft';
  if not found then raise exception 'version introuvable'; end if;
  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

revoke all on function public.get_video_review_access(text), public.get_video_review(text, text),
  public.add_video_review_comment(text, text, text, numeric, text, text, uuid), public.set_video_review_decision(text, text, text, text, text) from public;
grant execute on function public.get_video_review_access(text), public.get_video_review(text, text),
  public.add_video_review_comment(text, text, text, numeric, text, text, uuid), public.set_video_review_decision(text, text, text, text, text) to anon, authenticated;

-- ---- 5. Côté compositeur (ou studio) ----

-- Le lien du montage : { slug, enabled, mode } (jamais le secret, dont on ne garde que l'empreinte).
create or replace function public.get_video_review_link(p_capture_id text, p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_cap record; v_link public.video_review_links;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then return null; end if;
  select owner_id, owner_studio_id into v_cap from public.video_captures where id = p_capture_id;
  if not found or not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then return null; end if;
  select * into v_link from public.video_review_links where capture_id = p_capture_id;
  if not found then return null; end if;
  return jsonb_build_object('slug', v_link.slug, 'enabled', v_link.enabled, 'mode', v_link.access_mode);
end;
$$;

-- Crée le lien (nom obligatoire la première fois) ou le règle : activer / désactiver, renommer, changer de mode, nouvelle clé magique
-- (p_rotate), nouveau mot de passe. Le secret NEUF d'un lien magique est renvoyé (« secret ») cette seule fois.
create or replace function public.set_video_review_link(
  p_capture_id text, p_enabled boolean default null, p_slug text default null, p_mode text default null,
  p_password text default null, p_rotate boolean default false, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
  v_cap record; v_link public.video_review_links; v_exists boolean;
  v_slug text; v_mode text; v_new_secret boolean; v_token text; v_salt text; v_iter int; v_hash text;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then raise exception 'Non autorisé'; end if;
  select owner_id, owner_studio_id into v_cap from public.video_captures where id = p_capture_id;
  if not found or not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then raise exception 'Montage introuvable'; end if;
  select * into v_link from public.video_review_links where capture_id = p_capture_id;
  v_exists := found;
  v_slug := case when p_slug is null then v_link.slug else lower(btrim(p_slug)) end;
  if v_slug is null then raise exception 'adresse manquante' using hint = 'slug'; end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) not between 3 and 60 then raise exception 'adresse invalide (3 à 60 lettres minuscules, chiffres et tirets)' using hint = 'slug'; end if;
  if exists (select 1 from public.video_review_links where slug = v_slug and capture_id <> p_capture_id) then raise exception 'adresse déjà prise' using hint = 'taken'; end if;
  v_mode := coalesce(p_mode, v_link.access_mode, 'magic');
  if v_mode not in ('magic', 'password') then raise exception 'mode inconnu'; end if;
  -- Un secret neuf est nécessaire : à la création, sur demande, au changement de mode, ou quand un mot de passe est donné.
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
    insert into public.video_review_links (capture_id, slug, enabled, access_mode, salt, iterations, secret_hash)
    values (p_capture_id, v_slug, coalesce(p_enabled, true), v_mode, v_salt, v_iter, v_hash);
  else
    update public.video_review_links set
      slug = v_slug, enabled = coalesce(p_enabled, enabled), access_mode = v_mode,
      salt = case when v_new_secret then v_salt else salt end,
      iterations = case when v_new_secret then v_iter else iterations end,
      secret_hash = case when v_new_secret then v_hash else secret_hash end,
      updated_at = now()
    where capture_id = p_capture_id;
    if v_new_secret then delete from public.video_review_access_failures where capture_id = p_capture_id; end if;
  end if;
  select * into v_link from public.video_review_links where capture_id = p_capture_id;
  return jsonb_build_object('slug', v_link.slug, 'enabled', v_link.enabled, 'mode', v_link.access_mode, 'secret', v_token);
end;
$$;

revoke all on function public.get_video_review_link(text, boolean),
  public.set_video_review_link(text, boolean, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.get_video_review_link(text, boolean),
  public.set_video_review_link(text, boolean, text, text, text, boolean, boolean) to authenticated;
