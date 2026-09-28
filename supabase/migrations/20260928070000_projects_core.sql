-- LayerPitch — chantier profils et permissions, étape 5b (28 septembre) : Projets, le socle.
-- Références : layerpitch-docs/2026-09-11-projet-cadrage.md (espaces, accès uniforme, invités gratuits) et
-- layerpitch-docs/2026-09-27-cadrage-profils-permissions.md (D20, D24, D35-D39).
--
-- Un Projet = un espace de travail de préproduction partagé entre un compositeur et un studio (et leurs invités).
--   * Propriétaire : un COMPOSITEUR (quota « projects » : Warrior 1, Boss 5) ou un STUDIO (quota « studio_projects » :
--     Indie 1, AA 5, AAA illimité). Créer = payant (D20) ; les invités, eux, ne paient jamais (boucle de croissance).
--   * Accès UNIFORME (11/09 §4) : tout membre lit et écrit tout ; l'administrateur (créateur, ou propriétaire du studio
--     pour un Projet de studio) peut en plus inviter, retirer, archiver, supprimer. Pour un Projet de studio, toute
--     l'équipe du studio (D14/D37) en fait partie d'office.
--   * Coexistence (D35) : morceaux, packs, albums restent la propriété de leur auteur ; le Projet n'a que des liens vers
--     eux (étape 5c) et ses propres objets.
--   * Stockage (D39) : les fichiers d'un Projet comptent sur le propriétaire, dans le MÊME quota que la bibliothèque
--     vidéo (compositeur : video_storage_gb ; studio : studio_storage_gb, nouvelle ligne de matrice Indie 20 / AA 100 Go).
-- Ce fichier : projets, membres et invitations, rôle d'accès, fil de discussion avec recherche, activité, notifications,
-- fichiers (réservation avant envoi, comme la vidéo). Espaces (moodboard, vidéos annotées, packs, vitrine, versions) :
-- 20260928080000. Tout est admin seulement tant que le feu vert 'projects' est fermé (matrice).

-- ---- Matrice : stockage du studio ----
insert into public.features (key, kind, value_type, description, flag_key) values
  ('studio_storage_gb', 'studio', 'quota', 'Stockage des fichiers (Projets) du studio, en Go', 'studio_space');
insert into public.plan_entitlements (plan, feature, allowed, amount) values
  ('solodev', 'studio_storage_gb', false, 0), ('indie', 'studio_storage_gb', true, 20),
  ('aa', 'studio_storage_gb', true, 100), ('aaa', 'studio_storage_gb', true, null);

-- ---- Projets et membres ----
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  description text not null default '',
  owner_kind text not null check (owner_kind in ('composer', 'studio')),
  owner_profile_id uuid references public.profiles(id) on delete cascade,     -- compositeur propriétaire
  owner_studio_id uuid references public.studio_profiles(id) on delete cascade, -- studio propriétaire
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check ((owner_kind = 'composer' and owner_profile_id is not null and owner_studio_id is null)
      or (owner_kind = 'studio' and owner_studio_id is not null and owner_profile_id is null))
);
create index projects_owner_profile_idx on public.projects(owner_profile_id);
create index projects_owner_studio_idx on public.projects(owner_studio_id);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email text not null,
  profile_id uuid references public.profiles(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'active')),
  invited_by uuid references public.profiles(id),
  invited_at timestamptz not null default now(),
  joined_at timestamptz
);
create unique index project_members_email_idx on public.project_members (project_id, lower(email));
create index project_members_profile_idx on public.project_members (profile_id);

-- Rôle d'un compte dans un Projet : 'admin', 'member' ou NULL (aucun accès).
create or replace function public.project_role(p_project_id uuid, p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.id is null or p_profile_id is null then null
    when p.created_by = p_profile_id then 'admin'
    when p.owner_kind = 'studio' and exists (select 1 from public.studio_profiles sp where sp.id = p.owner_studio_id and sp.profile_id = p_profile_id) then 'admin'
    when p.owner_kind = 'studio' and public.account_studio_id(p_profile_id) = p.owner_studio_id then 'member'
    when exists (select 1 from public.project_members m where m.project_id = p.id and m.profile_id = p_profile_id and m.status = 'active') then 'member'
    else null
  end
  from (select * from public.projects where id = p_project_id) p
  right join (select 1) one on true;
$$;
revoke execute on function public.project_role(uuid, uuid) from public, anon, authenticated;
grant execute on function public.project_role(uuid, uuid) to service_role;

create or replace function public.assert_project_role(p_project_id uuid, p_admin boolean default false)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text := public.project_role(p_project_id, auth.uid());
begin
  if v_role is null then raise exception 'Projet introuvable'; end if;
  if p_admin and v_role <> 'admin' then raise exception 'Réservé à l''administrateur du Projet'; end if;
  -- Feu vert : pendant la bêta, seul l'admin LayerPitch entre dans les Projets (matrice : projects / studio_projects).
  if not public.feature_released('projects', auth.uid()) then raise exception 'Les Projets ne sont pas encore ouverts'; end if;
  return v_role;
end;
$$;
revoke execute on function public.assert_project_role(uuid, boolean) from public, anon, authenticated;
grant execute on function public.assert_project_role(uuid, boolean) to service_role;

-- ---- Activité et notifications ----
create table public.project_activity (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index project_activity_idx on public.project_activity (project_id, created_at desc);

create table public.project_notifications (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index project_notifications_idx on public.project_notifications (profile_id, created_at desc);

create or replace function public.log_project_activity(p_project_id uuid, p_kind text, p_payload jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.project_activity (project_id, actor_id, kind, payload) values (p_project_id, auth.uid(), p_kind, coalesce(p_payload, '{}'::jsonb));
  update public.projects set updated_at = now() where id = p_project_id;
$$;
revoke execute on function public.log_project_activity(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_project_activity(uuid, text, jsonb) to service_role;

-- ---- Création, lecture, modification ----
create or replace function public.create_project(p_title text, p_description text default '', p_as_studio boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio uuid;
  v_ent record;
  v_count int;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if p_as_studio then
    v_studio := public.account_studio_id(auth.uid());
    if v_studio is null then raise exception 'Aucun profil studio pour ce compte'; end if;
    select * into v_ent from public.entitlement(auth.uid(), 'studio_projects', false);
    select count(*) into v_count from public.projects where owner_studio_id = v_studio and archived_at is null;
  else
    if public.current_composer_id() is null then raise exception 'Aucun profil compositeur pour ce compte'; end if;
    select * into v_ent from public.entitlement(auth.uid(), 'projects', false);
    select count(*) into v_count from public.projects where owner_kind = 'composer' and owner_profile_id = auth.uid() and archived_at is null;
  end if;
  if not coalesce(v_ent.allowed, false) then raise exception 'Créer un Projet n''est pas inclus dans ton palier' using hint = 'plan'; end if;
  if v_ent.amount is not null and v_count >= v_ent.amount then
    raise exception 'Limite atteinte : % Projet(s) actif(s) pour ton palier', v_ent.amount::int using hint = 'quota';
  end if;
  insert into public.projects (title, description, owner_kind, owner_profile_id, owner_studio_id, created_by)
  values (coalesce(nullif(trim(p_title), ''), 'Projet sans nom'), coalesce(p_description, ''),
          case when p_as_studio then 'studio' else 'composer' end,
          case when p_as_studio then null else auth.uid() end, v_studio, auth.uid())
  returning id into v_id;
  insert into public.project_activity (project_id, actor_id, kind) values (v_id, auth.uid(), 'project_created');
  return v_id;
end;
$$;

create or replace function public.list_my_projects()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', p.title, 'description', p.description, 'ownerKind', p.owner_kind,
    'role', public.project_role(p.id, auth.uid()), 'archived', p.archived_at is not null, 'updatedAt', p.updated_at,
    'unread', (select count(*) from public.project_notifications n where n.project_id = p.id and n.profile_id = auth.uid() and n.read_at is null)
  ) order by p.updated_at desc), '[]'::jsonb)
  from public.projects p
  where auth.uid() is not null and public.feature_released('projects', auth.uid()) and public.project_role(p.id, auth.uid()) is not null;
$$;

create or replace function public.get_project(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text := public.assert_project_role(p_project_id);
begin
  return (select jsonb_build_object(
    'id', p.id, 'title', p.title, 'description', p.description, 'ownerKind', p.owner_kind, 'role', v_role,
    'archived', p.archived_at is not null, 'createdAt', p.created_at, 'updatedAt', p.updated_at,
    'members', (
      select coalesce(jsonb_agg(x order by x->>'email'), '[]'::jsonb) from (
        select jsonb_build_object('profileId', a.profile_id, 'email', (select u.email from auth.users u where u.id = a.profile_id),
               'status', 'active', 'source', 'team', 'role', public.project_role(p.id, a.profile_id), 'me', a.profile_id = auth.uid()) x
        from public.studio_accounts(p.owner_studio_id) a where p.owner_kind = 'studio'
        union all
        select jsonb_build_object('profileId', p.created_by, 'email', (select u.email from auth.users u where u.id = p.created_by),
               'status', 'active', 'source', 'owner', 'role', 'admin', 'me', p.created_by = auth.uid())
        where p.owner_kind = 'composer'
        union all
        select jsonb_build_object('id', m.id, 'profileId', m.profile_id, 'email', m.email, 'status', m.status, 'source', 'guest',
               'role', case when m.status = 'active' then 'member' end, 'me', m.profile_id = auth.uid())
        from public.project_members m where m.project_id = p.id
      ) s(x))
  ) from public.projects p where p.id = p_project_id);
end;
$$;

create or replace function public.update_project(p_project_id uuid, p_title text, p_description text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_project_role(p_project_id);
  update public.projects set title = coalesce(nullif(trim(p_title), ''), title), description = coalesce(p_description, description), updated_at = now()
   where id = p_project_id;
  perform public.log_project_activity(p_project_id, 'project_updated');
end;
$$;

create or replace function public.archive_project(p_project_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_project_role(p_project_id, true);
  update public.projects set archived_at = case when p_archived then now() else null end where id = p_project_id;
  perform public.log_project_activity(p_project_id, case when p_archived then 'project_archived' else 'project_restored' end);
end;
$$;

create or replace function public.delete_project(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_paths text[];
begin
  perform public.assert_project_role(p_project_id, true);
  -- Chemins des fichiers à effacer du stockage (fait par le client avec une URL signée, voir create-project-file-url).
  select coalesce(array_agg(path), array[]::text[]) into v_paths from public.project_files where project_id = p_project_id;
  delete from public.projects where id = p_project_id;
  return jsonb_build_object('ok', true, 'filePaths', to_jsonb(v_paths));
end;
$$;

-- ---- Invités (gratuits, D20) ----
create or replace function public.invite_project_member(p_project_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_email text := lower(trim(coalesce(p_email, ''))); v_id uuid;
begin
  perform public.assert_project_role(p_project_id, true);
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresse e-mail invalide'; end if;
  if exists (select 1 from public.project_members where project_id = p_project_id and lower(email) = v_email) then
    raise exception 'Cette personne est déjà invitée';
  end if;
  insert into public.project_members (project_id, email, invited_by) values (p_project_id, v_email, auth.uid()) returning id into v_id;
  perform public.log_project_activity(p_project_id, 'member_invited', jsonb_build_object('email', v_email));
  return v_id;
end;
$$;

create or replace function public.remove_project_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select * into r from public.project_members where id = p_member_id;
  if not found then raise exception 'Membre introuvable'; end if;
  if not (coalesce(r.profile_id = auth.uid(), false) or public.project_role(r.project_id, auth.uid()) = 'admin') then
    raise exception 'Membre introuvable';
  end if;
  delete from public.project_members where id = p_member_id;
  insert into public.project_activity (project_id, actor_id, kind, payload) values (r.project_id, auth.uid(), 'member_removed', jsonb_build_object('email', r.email));
end;
$$;

create or replace function public.my_project_invitations()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'projectId', p.id, 'projectTitle', p.title, 'invitedAt', m.invited_at,
      'inviterEmail', (select u.email from auth.users u where u.id = m.invited_by)) order by m.invited_at desc), '[]'::jsonb)
  from public.project_members m join public.projects p on p.id = m.project_id
  where auth.uid() is not null and m.status = 'invited'
    and lower(m.email) = (select lower(email) from auth.users where id = auth.uid());
$$;

create or replace function public.respond_project_invitation(p_member_id uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select * into r from public.project_members where id = p_member_id and status = 'invited';
  if not found or not coalesce(lower(r.email) = (select lower(email) from auth.users where id = auth.uid()), false) then
    raise exception 'Invitation introuvable';
  end if;
  if not p_accept then delete from public.project_members where id = p_member_id; return null; end if;
  update public.project_members set status = 'active', profile_id = auth.uid(), joined_at = now() where id = p_member_id;
  insert into public.project_activity (project_id, actor_id, kind) values (r.project_id, auth.uid(), 'member_joined');
  return r.project_id;
end;
$$;

-- ---- Fil de discussion (le « neutre » du 11/09) : tchat + recherche ----
create table public.project_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (length(body) between 1 and 8000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  search tsvector generated always as (to_tsvector('simple', body)) stored
);
create index project_messages_idx on public.project_messages (project_id, created_at desc);
create index project_messages_search_idx on public.project_messages using gin (search);

create or replace function public.post_project_message(p_project_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public.assert_project_role(p_project_id);
  if coalesce(trim(p_body), '') = '' then raise exception 'Message vide'; end if;
  insert into public.project_messages (project_id, author_id, body) values (p_project_id, auth.uid(), trim(p_body)) returning id into v_id;
  update public.projects set updated_at = now() where id = p_project_id;
  return v_id;
end;
$$;

create or replace function public.edit_project_message(p_message_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.project_messages set body = trim(p_body), edited_at = now()
   where id = p_message_id and author_id = auth.uid() and coalesce(trim(p_body), '') <> '';
  if not found then raise exception 'Message introuvable (seul son auteur le modifie)'; end if;
end;
$$;

create or replace function public.delete_project_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select * into r from public.project_messages where id = p_message_id;
  if not found or not (coalesce(r.author_id = auth.uid(), false) or public.project_role(r.project_id, auth.uid()) = 'admin') then
    raise exception 'Message introuvable';
  end if;
  delete from public.project_messages where id = p_message_id;
end;
$$;

-- Messages, du plus récent au plus ancien, par pages (p_before = date du plus ancien déjà affiché) ; p_query = recherche
-- plein texte (mots entiers, style moteur de recherche).
create or replace function public.list_project_messages(p_project_id uuid, p_before timestamptz default null, p_limit int default 50, p_query text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_role(p_project_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'createdAt', m.created_at, 'editedAt', m.edited_at,
      'authorId', m.author_id, 'authorEmail', (select u.email from auth.users u where u.id = m.author_id), 'mine', m.author_id = auth.uid())
      order by m.created_at desc), '[]'::jsonb)
    from (select * from public.project_messages m
          where m.project_id = p_project_id
            and (p_before is null or m.created_at < p_before)
            and (coalesce(trim(p_query), '') = '' or m.search @@ websearch_to_tsquery('simple', p_query))
          order by m.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) m);
end;
$$;

create or replace function public.list_project_activity(p_project_id uuid, p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_role(p_project_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('kind', a.kind, 'payload', a.payload, 'createdAt', a.created_at,
      'actorEmail', (select u.email from auth.users u where u.id = a.actor_id)) order by a.created_at desc), '[]'::jsonb)
    from (select * from public.project_activity where project_id = p_project_id order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) a);
end;
$$;

create or replace function public.my_project_notifications(p_unread_only boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'projectId', n.project_id, 'projectTitle', p.title, 'kind', n.kind,
      'payload', n.payload, 'read', n.read_at is not null, 'createdAt', n.created_at) order by n.created_at desc), '[]'::jsonb)
  from (select * from public.project_notifications where profile_id = auth.uid() and (not p_unread_only or read_at is null)
        order by created_at desc limit 200) n
  left join public.projects p on p.id = n.project_id;
$$;

create or replace function public.mark_project_notifications_read(p_project_id uuid default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.project_notifications set read_at = now()
   where profile_id = auth.uid() and read_at is null and (p_project_id is null or project_id = p_project_id);
$$;

-- ---- Fichiers (images, audio, vidéo) : réservés avant l'envoi, comptés sur le propriétaire (D39) ----
create table public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  path text not null unique,
  original_name text not null default '',
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  status text not null default 'uploading' check (status in ('uploading', 'ready')),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index project_files_project_idx on public.project_files(project_id);

-- Octets utilisés par un propriétaire : sa bibliothèque vidéo (compositeur) + les fichiers de tous ses Projets.
create or replace function public.owner_storage_used(p_kind text, p_owner uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select sum(v.size_bytes) from public.composer_videos v join public.composer_profiles cp on cp.id = v.owner_id
                   where p_kind = 'composer' and cp.profile_id = p_owner), 0)
       + coalesce((select sum(f.size_bytes) from public.project_files f join public.projects p on p.id = f.project_id
                   where (p_kind = 'composer' and p.owner_kind = 'composer' and p.owner_profile_id = p_owner)
                      or (p_kind = 'studio' and p.owner_kind = 'studio' and p.owner_studio_id = p_owner)), 0);
$$;
revoke execute on function public.owner_storage_used(text, uuid) from public, anon, authenticated;
grant execute on function public.owner_storage_used(text, uuid) to service_role;

-- Types acceptés (même prudence que le stockage média du 27/09 : jamais de HTML ni de SVG exécutable) et taille max.
create or replace function public.project_file_rule(p_ext text)
returns table (mime text, max_bytes bigint)
language sql
immutable
as $$
  select m, mb::bigint * 1024 * 1024 from (values
    ('jpg', 'image/jpeg', 20), ('jpeg', 'image/jpeg', 20), ('png', 'image/png', 20), ('webp', 'image/webp', 20), ('gif', 'image/gif', 20),
    ('ogg', 'audio/ogg', 150), ('mp3', 'audio/mpeg', 150), ('wav', 'audio/wav', 300), ('m4a', 'audio/mp4', 150), ('flac', 'audio/flac', 300),
    ('mp4', 'video/mp4', 2048), ('webm', 'video/webm', 2048), ('pdf', 'application/pdf', 30)
  ) t(e, m, mb) where e = lower(p_ext);
$$;

-- Appelée par le client (via l'Edge Function create-project-file-url qui signe ensuite l'envoi avec CETTE taille).
create or replace function public.reserve_project_file(p_project_id uuid, p_name text, p_size bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  v_ext text := lower(substring(coalesce(p_name, '') from '\.([A-Za-z0-9]+)$'));
  v_rule record;
  v_ent record;
  v_quota_owner uuid;
  v_kind text;
  v_used bigint;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  perform public.assert_project_role(p_project_id);
  select * into p from public.projects where id = p_project_id;
  select * into v_rule from public.project_file_rule(v_ext);
  if v_rule.mime is null then raise exception 'Type de fichier non accepté (.%)', coalesce(v_ext, '?'); end if;
  if p_size is null or p_size <= 0 then raise exception 'Taille du fichier manquante'; end if;
  if p_size > v_rule.max_bytes then raise exception 'Fichier trop lourd (maximum % Mo)', v_rule.max_bytes / 1024 / 1024; end if;

  -- Quota du PROPRIÉTAIRE du Projet (pas de l'invité qui envoie) : un envoi à la fois par propriétaire pour ce calcul.
  if p.owner_kind = 'studio' then
    v_kind := 'studio'; v_quota_owner := p.owner_studio_id;
    select * into v_ent from public.entitlement((select profile_id from public.studio_profiles where id = p.owner_studio_id), 'studio_storage_gb', false);
  else
    v_kind := 'composer'; v_quota_owner := p.owner_profile_id;
    select * into v_ent from public.entitlement(p.owner_profile_id, 'video_storage_gb', false);
  end if;
  perform pg_advisory_xact_lock(hashtext('storage-quota:' || v_kind || ':' || v_quota_owner::text));
  if not coalesce(v_ent.allowed, false) or (v_ent.amount is not null and v_ent.amount = 0) then
    raise exception 'Le stockage de fichiers n''est pas inclus dans le palier du propriétaire de ce Projet' using hint = 'quota';
  end if;
  if v_ent.amount is not null then
    v_used := public.owner_storage_used(v_kind, v_quota_owner);
    if v_used + p_size > v_ent.amount * 1024 * 1024 * 1024 then
      raise exception 'Quota de stockage du propriétaire dépassé (% Go)', v_ent.amount::int using hint = 'quota';
    end if;
  end if;
  v_path := 'projects/' || p_project_id::text || '/' || v_id::text || '.' || v_ext;
  insert into public.project_files (id, project_id, path, original_name, mime_type, size_bytes, uploaded_by)
  values (v_id, p_project_id, v_path, coalesce(p_name, ''), v_rule.mime, p_size, auth.uid());
  return jsonb_build_object('fileId', v_id, 'path', v_path, 'mimeType', v_rule.mime, 'size', p_size);
end;
$$;

create or replace function public.complete_project_file(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_project uuid;
begin
  select project_id into v_project from public.project_files where id = p_file_id;
  if v_project is null then raise exception 'Fichier introuvable'; end if;
  perform public.assert_project_role(v_project);
  update public.project_files set status = 'ready' where id = p_file_id;
end;
$$;

-- Supprime la ligne et renvoie le chemin à effacer du stockage (auteur de l'envoi ou administrateur du Projet).
create or replace function public.delete_project_file(p_file_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select * into r from public.project_files where id = p_file_id;
  if not found then raise exception 'Fichier introuvable'; end if;
  perform public.assert_project_role(r.project_id);
  if not (coalesce(r.uploaded_by = auth.uid(), false) or public.project_role(r.project_id, auth.uid()) = 'admin') then
    raise exception 'Seul l''auteur de l''envoi ou l''administrateur du Projet peut supprimer ce fichier';
  end if;
  delete from public.project_files where id = p_file_id;
  return r.path;
end;
$$;

-- Lecture d'un fichier par l'Edge Function (qui signe une URL de lecture courte) : chemin si le compte a accès.
create or replace function public.project_file_path_for(p_file_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare r record;
begin
  select * into r from public.project_files where id = p_file_id and status = 'ready';
  if not found then return null; end if;
  if public.project_role(r.project_id, auth.uid()) is null then return null; end if;
  return r.path;
end;
$$;

-- Le quota vidéo du compositeur compte désormais aussi les fichiers de ses Projets (D39 : un seul quota de stockage).
create or replace function public.reserve_video_upload(p_composer_id uuid, p_path text, p_size bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_file text;
  v_existing_owner uuid;
  v_quota_gb int;
  v_used bigint;
  v_profile uuid := (select profile_id from public.composer_profiles where id = p_composer_id);
begin
  if p_composer_id is null then return 'Non autorisé.'; end if;
  if p_path is null or p_path !~ '^video/[^/]+/[^/]+$' then return 'Chemin vidéo invalide.'; end if;
  if p_size is null or p_size <= 0 then return 'Taille du fichier manquante.'; end if;
  v_id := split_part(p_path, '/', 2);
  v_file := split_part(p_path, '/', 3);
  perform pg_advisory_xact_lock(hashtext('storage-quota:composer:' || coalesce(v_profile::text, p_composer_id::text)));
  select owner_id into v_existing_owner from public.composer_videos where id = v_id;
  if v_existing_owner is not null and v_existing_owner <> p_composer_id then
    return 'Ce fichier ne t''appartient pas.';
  end if;
  select max_video_storage_gb into v_quota_gb from public.effective_plan_quotas(p_composer_id);
  if v_quota_gb is not null then
    if v_quota_gb = 0 then return 'La bibliothèque vidéo n''est pas incluse dans ton offre.'; end if;
    v_used := public.owner_storage_used('composer', v_profile)
            - coalesce((select size_bytes from public.composer_videos where id = v_id), 0);
    if v_used + p_size > v_quota_gb::bigint * 1024 * 1024 * 1024 then
      return format('Quota de stockage dépassé (%s Go, vidéos et fichiers de tes Projets compris).', v_quota_gb);
    end if;
  end if;
  insert into public.composer_videos (id, owner_id, kind, title, base, file, mime_type, size_bytes, upload_status, updated_at)
  values (v_id, p_composer_id, 'upload', '', 'https://media.layerpitch.com/video/' || v_id || '/', v_file, 'video/mp4',
          p_size, 'uploading', now())
  on conflict (id) do update set
    file = excluded.file, base = excluded.base, size_bytes = excluded.size_bytes, upload_status = 'uploading', updated_at = now();
  return null;
end;
$$;

-- ---- Accès ----
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_activity enable row level security;
alter table public.project_notifications enable row level security;
alter table public.project_messages enable row level security;
alter table public.project_files enable row level security;
-- Aucune politique : tout passe par les RPC ci-dessus (rôle vérifié à chaque appel).

revoke execute on function public.create_project(text, text, boolean), public.list_my_projects(), public.get_project(uuid),
  public.update_project(uuid, text, text), public.archive_project(uuid, boolean), public.delete_project(uuid),
  public.invite_project_member(uuid, text), public.remove_project_member(uuid), public.my_project_invitations(),
  public.respond_project_invitation(uuid, boolean), public.post_project_message(uuid, text), public.edit_project_message(uuid, text),
  public.delete_project_message(uuid), public.list_project_messages(uuid, timestamptz, int, text), public.list_project_activity(uuid, int),
  public.my_project_notifications(boolean), public.mark_project_notifications_read(uuid), public.reserve_project_file(uuid, text, bigint),
  public.complete_project_file(uuid), public.delete_project_file(uuid), public.project_file_path_for(uuid) from public, anon;
grant execute on function public.create_project(text, text, boolean), public.list_my_projects(), public.get_project(uuid),
  public.update_project(uuid, text, text), public.archive_project(uuid, boolean), public.delete_project(uuid),
  public.invite_project_member(uuid, text), public.remove_project_member(uuid), public.my_project_invitations(),
  public.respond_project_invitation(uuid, boolean), public.post_project_message(uuid, text), public.edit_project_message(uuid, text),
  public.delete_project_message(uuid), public.list_project_messages(uuid, timestamptz, int, text), public.list_project_activity(uuid, int),
  public.my_project_notifications(boolean), public.mark_project_notifications_read(uuid), public.reserve_project_file(uuid, text, bigint),
  public.complete_project_file(uuid), public.delete_project_file(uuid), public.project_file_path_for(uuid) to authenticated;
