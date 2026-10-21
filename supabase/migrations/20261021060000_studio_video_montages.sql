-- Montages, versions vidéo et bibliothèque vidéo d'un STUDIO (21/10, étape 3 ; décidé par Jules-Antoine).
--
-- Les membres d'un studio sont les parties d'une seule entité : un montage fait par un membre appartient au STUDIO (owner_studio_id),
-- tout membre peut le retoucher, il vit dans la bibliothèque vidéo du studio (et les Projets) et reste au studio si son auteur part.
-- Ses fichiers comptent dans le quota du studio (studio_storage_gb, comme les fichiers des Projets du studio). Un compositeur qui quitte
-- un studio et veut que son travail ne soit plus utilisé doit supprimer ses vidéos avant de partir.
--
-- Mise en œuvre : chaque ligne appartient soit à un compositeur (owner_id), soit à un studio (owner_studio_id), jamais aux deux.
-- Les fonctions prennent p_studio (faux par défaut : rien ne change pour les compositeurs) ; vrai = « au nom du studio du compte
-- connecté » (current_studio_id). Droits : test_in_game / versioning pour un compositeur, studio_test_in_game / studio_versioning pour un
-- studio (même échelle : « saved » = enregistrer), et le nombre de montages enregistrés d'un studio (saved_montages).

-- ---- 1. Tables : propriétaire compositeur OU studio ----
alter table public.composer_videos add column if not exists owner_studio_id uuid references public.studio_profiles(id) on delete cascade;
alter table public.composer_videos alter column owner_id drop not null;
alter table public.composer_videos drop constraint if exists composer_videos_one_owner;
alter table public.composer_videos add constraint composer_videos_one_owner check ((owner_id is null) <> (owner_studio_id is null));
create index if not exists composer_videos_studio_idx on public.composer_videos(owner_studio_id, created_at desc) where owner_studio_id is not null;

alter table public.video_captures add column if not exists owner_studio_id uuid references public.studio_profiles(id) on delete cascade;
alter table public.video_captures alter column owner_id drop not null;
alter table public.video_captures drop constraint if exists video_captures_one_owner;
alter table public.video_captures add constraint video_captures_one_owner check ((owner_id is null) <> (owner_studio_id is null));

alter table public.video_capture_versions add column if not exists owner_studio_id uuid references public.studio_profiles(id) on delete cascade;
alter table public.video_capture_versions alter column owner_id drop not null;
alter table public.video_capture_versions drop constraint if exists video_capture_versions_one_owner;
alter table public.video_capture_versions add constraint video_capture_versions_one_owner check ((owner_id is null) <> (owner_studio_id is null));

alter table public.video_export_history add column if not exists owner_studio_id uuid references public.studio_profiles(id) on delete cascade;
alter table public.video_export_history alter column owner_id drop not null;
alter table public.video_export_history drop constraint if exists video_export_history_one_owner;
alter table public.video_export_history add constraint video_export_history_one_owner check ((owner_id is null) <> (owner_studio_id is null));

-- ---- 2. Briques communes ----
-- Qui agit : le compositeur connecté, ou (p_studio) le studio du compte connecté.
create or replace function public.video_actor_composer(p_studio boolean) returns uuid language sql stable security definer set search_path = public as $$
  select case when coalesce(p_studio, false) then null else public.current_composer_id() end
$$;
create or replace function public.video_actor_studio(p_studio boolean) returns uuid language sql stable security definer set search_path = public as $$
  select case when coalesce(p_studio, false) then public.current_studio_id() else null end
$$;
create or replace function public.video_owned(p_owner uuid, p_owner_studio uuid, p_composer uuid, p_studio uuid) returns boolean language sql immutable as $$
  select (p_composer is not null and p_owner = p_composer) or (p_studio is not null and p_owner_studio = p_studio)
$$;
-- Droits : enregistrer un montage, versionner (palier « saved »).
create or replace function public.video_can_save(p_studio boolean) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.i_level(case when coalesce(p_studio, false) then 'studio_test_in_game' else 'test_in_game' end), '') = 'saved'
$$;
create or replace function public.video_can_version(p_studio boolean) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.i_level(case when coalesce(p_studio, false) then 'studio_versioning' else 'versioning' end), '') = 'saved'
$$;

-- Stockage d'un studio : fichiers de ses Projets + sa bibliothèque vidéo (sons et vidéos muettes des montages compris).
create or replace function public.owner_storage_used(p_kind text, p_owner uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select sum(v.size_bytes) from public.composer_videos v join public.composer_profiles cp on cp.id = v.owner_id
                   where p_kind = 'composer' and cp.profile_id = p_owner), 0)
       + coalesce((select sum(v.size_bytes) from public.composer_videos v where p_kind = 'studio' and v.owner_studio_id = p_owner), 0)
       + coalesce((select sum(f.size_bytes) from public.project_files f join public.projects p on p.id = f.project_id
                   where (p_kind = 'composer' and p.owner_kind = 'composer' and p.owner_profile_id = p_owner)
                      or (p_kind = 'studio' and p.owner_kind = 'studio' and p.owner_studio_id = p_owner)), 0);
$$;

-- Réservation d'un envoi vidéo AU NOM D'UN STUDIO (appelée par create-media-signed-url, rôle service) : quota du studio
-- (studio_storage_gb), même mécanique que reserve_video_upload pour un compositeur. null = autorisé, sinon le message.
create or replace function public.reserve_video_upload_studio(p_studio_id uuid, p_path text, p_size bigint)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_id text; v_file text; v_existing record; v_ent record; v_used bigint;
begin
  if p_studio_id is null then return 'Non autorisé.'; end if;
  if p_path is null or p_path !~ '^video/[^/]+/[^/]+$' then return 'Chemin vidéo invalide.'; end if;
  if p_size is null or p_size <= 0 then return 'Taille du fichier manquante.'; end if;
  v_id := split_part(p_path, '/', 2); v_file := split_part(p_path, '/', 3);
  perform pg_advisory_xact_lock(hashtext('storage-quota:studio:' || p_studio_id::text));
  select owner_id, owner_studio_id into v_existing from public.composer_videos where id = v_id;
  if found and v_existing.owner_studio_id is distinct from p_studio_id then return 'Ce fichier ne t''appartient pas.'; end if;
  select * into v_ent from public.entitlement((select profile_id from public.studio_profiles where id = p_studio_id), 'studio_storage_gb', false);
  if not coalesce(v_ent.allowed, false) or (v_ent.amount is not null and v_ent.amount = 0) then
    return 'Le stockage n''est pas inclus dans l''offre de ton studio.';
  end if;
  if v_ent.amount is not null then
    v_used := public.owner_storage_used('studio', p_studio_id) - coalesce((select size_bytes from public.composer_videos where id = v_id), 0);
    if v_used + p_size > v_ent.amount * 1024 * 1024 * 1024 then
      return format('Quota de stockage du studio dépassé (%s Go).', v_ent.amount::int);
    end if;
  end if;
  insert into public.composer_videos (id, owner_id, owner_studio_id, kind, title, base, file, mime_type, size_bytes, upload_status, updated_at)
  values (v_id, null, p_studio_id, 'upload', '', 'https://media.layerpitch.com/video/' || v_id || '/', v_file, 'video/mp4', p_size, 'uploading', now())
  on conflict (id) do update set file = excluded.file, base = excluded.base, size_bytes = excluded.size_bytes, upload_status = 'uploading', updated_at = now();
  return null;
end;
$$;

-- ---- 3. Bibliothèque vidéo ----
create or replace function public.upsert_video(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_studio boolean := coalesce((payload->>'asStudio')::boolean, false);
  v_c uuid := public.video_actor_composer(v_studio);
  v_s uuid := public.video_actor_studio(v_studio);
  v_id text := payload->>'id';
  v_row record;
  v_pack_id text := nullif(payload->>'packId', '');
  v_pack_owner uuid;
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé : aucun compte compositeur ou studio'; end if;
  if v_id is null or v_id = '' then raise exception 'id manquant'; end if;
  if v_pack_id is not null and v_c is not null then
    select owner_id into v_pack_owner from public.packs where id = v_pack_id;
    if v_pack_owner is not null and v_pack_owner <> v_c then raise exception 'Non autorisé : ce pack appartient à un autre compositeur'; end if;
  end if;
  select owner_id, owner_studio_id into v_row from public.composer_videos where id = v_id;
  if not found then raise exception 'Envoi vidéo introuvable : relance l''import'; end if;
  if not public.video_owned(v_row.owner_id, v_row.owner_studio_id, v_c, v_s) then raise exception 'Non autorisé : cette vidéo appartient à un autre compte'; end if;
  update public.composer_videos set
    kind = coalesce(payload->>'kind', kind), pack_id = v_pack_id, title = coalesce(payload->>'title', ''),
    original_name = payload->>'originalName', duration_seconds = nullif(payload->>'durationSeconds', '')::numeric,
    upload_status = 'ready', updated_at = now()
  where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

drop function if exists public.delete_video(text);
create or replace function public.delete_video(p_id text, p_studio boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé'; end if;
  delete from public.composer_videos where id = p_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
end;
$$;

drop function if exists public.list_my_videos();
create or replace function public.list_my_videos(p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
  v_videos jsonb; v_interrupted jsonb; v_used bigint; v_quota_gb int; v_ent record;
begin
  if v_c is null and v_s is null then
    return jsonb_build_object('videos', '[]'::jsonb, 'interrupted', '[]'::jsonb, 'usedBytes', 0, 'quotaGb', null);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind, 'packId', pack_id, 'title', title, 'base', base, 'file', file,
    'originalName', original_name, 'mimeType', mime_type, 'sizeBytes', size_bytes,
    'durationSeconds', duration_seconds, 'createdAt', created_at, 'updatedAt', updated_at
  ) order by created_at desc) filter (where upload_status = 'ready' and kind <> 'capture_audio'), '[]'::jsonb),
  coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'base', base, 'file', file, 'sizeBytes', size_bytes, 'updatedAt', updated_at
  ) order by created_at desc) filter (where upload_status = 'uploading'), '[]'::jsonb),
  coalesce(sum(size_bytes), 0)
  into v_videos, v_interrupted, v_used
  from public.composer_videos where public.video_owned(owner_id, owner_studio_id, v_c, v_s);
  if v_c is not null then
    select max_video_storage_gb into v_quota_gb from public.effective_plan_quotas(v_c);
  else
    -- Studio : quota commun (fichiers des Projets + bibliothèque vidéo), compté en entier.
    select * into v_ent from public.entitlement((select profile_id from public.studio_profiles where id = v_s), 'studio_storage_gb', false);
    v_quota_gb := case when not coalesce(v_ent.allowed, false) then 0 else v_ent.amount::int end;
    v_used := public.owner_storage_used('studio', v_s);
  end if;
  return jsonb_build_object('videos', v_videos, 'interrupted', v_interrupted, 'usedBytes', v_used, 'quotaGb', v_quota_gb);
end;
$$;

-- ---- 4. Montages ----
drop function if exists public.save_video_capture(text, text, text, text, jsonb, jsonb, jsonb);
create or replace function public.save_video_capture(
  p_id text, p_pack_id text, p_title text, p_video_filename text, p_events jsonb,
  p_lane_overrides jsonb default '{}'::jsonb, p_collapsed_groups jsonb default '{}'::jsonb, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
  v_row record; v_pack_owner uuid; v_now timestamptz := now(); v_max numeric;
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé : aucun compte compositeur ou studio'; end if;
  if not public.video_can_save(p_studio) then raise exception 'Non autorisé : enregistrer un montage n''est pas inclus dans cette offre'; end if;
  if p_id is null or p_id = '' then raise exception 'id manquant'; end if;
  if p_pack_id is null or p_pack_id = '' then raise exception 'pack_id manquant'; end if;
  if v_c is not null then
    select owner_id into v_pack_owner from public.packs where id = p_pack_id;
    if v_pack_owner is not null and v_pack_owner <> v_c then raise exception 'Non autorisé : ce pack appartient à un autre compositeur'; end if;
  end if;
  select owner_id, owner_studio_id into v_row from public.video_captures where id = p_id;
  if found then
    -- Montage existant : son propriétaire (le compositeur, ou n'importe quel membre de son studio) le retouche.
    if not public.video_owned(v_row.owner_id, v_row.owner_studio_id, v_c, v_s) then raise exception 'Non autorisé : cette prise appartient à un autre compte'; end if;
  elsif v_s is not null then
    -- Nouveau montage d'un studio : sur un pack que l'équipe possède (acheté ou obtenu).
    if not public.team_owns_pack(p_pack_id) then raise exception 'Non autorisé : ce pack n''appartient pas à ton studio'; end if;
    -- Nombre de montages enregistrés d'un studio (saved_montages : 10 en Indie, illimité au-delà).
    select e.amount into v_max from public.entitlement(auth.uid(), 'saved_montages', false) e where e.allowed;
    if v_max is not null and (select count(*) from public.video_captures where owner_studio_id = v_s) >= v_max then
      raise exception 'Nombre maximal de montages enregistrés atteint pour ton studio (%)', v_max::int;
    end if;
  end if;
  insert into public.video_captures (id, owner_id, owner_studio_id, pack_id, title, video_filename, events, lane_overrides, collapsed_groups, updated_at)
  values (p_id, v_c, v_s, p_pack_id, coalesce(p_title, ''), p_video_filename,
    coalesce(p_events, '[]'::jsonb), coalesce(p_lane_overrides, '{}'::jsonb), coalesce(p_collapsed_groups, '{}'::jsonb), v_now)
  on conflict (id) do update set
    title = excluded.title, video_filename = excluded.video_filename,
    events = excluded.events, lane_overrides = excluded.lane_overrides, collapsed_groups = excluded.collapsed_groups, updated_at = v_now;
  return jsonb_build_object('ok', true, 'id', p_id, 'updatedAt', v_now);
end;
$$;

drop function if exists public.list_my_video_captures(text);
create or replace function public.list_my_video_captures(p_pack_id text default null, p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_result jsonb;
begin
  if v_c is null and v_s is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'packId', pack_id, 'title', title, 'videoFilename', video_filename,
    'lastExportVideoId', last_export_video_id, 'baseVideoId', base_video_id,
    'createdAt', created_at, 'updatedAt', updated_at
  ) order by updated_at desc), '[]'::jsonb)
  into v_result
  from public.video_captures
  where public.video_owned(owner_id, owner_studio_id, v_c, v_s) and (p_pack_id is null or pack_id = p_pack_id);
  return v_result;
end;
$$;

drop function if exists public.get_video_capture(text);
create or replace function public.get_video_capture(p_id text, p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_row public.video_captures;
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé'; end if;
  select * into v_row from public.video_captures where id = p_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
  if v_row.id is null then raise exception 'Prise introuvable'; end if;
  return jsonb_build_object(
    'id', v_row.id, 'packId', v_row.pack_id, 'title', v_row.title, 'videoFilename', v_row.video_filename,
    'events', v_row.events, 'laneOverrides', v_row.lane_overrides, 'collapsedGroups', v_row.collapsed_groups,
    'createdAt', v_row.created_at, 'updatedAt', v_row.updated_at);
end;
$$;

drop function if exists public.delete_video_capture(text);
create or replace function public.delete_video_capture(p_id text, p_studio boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé'; end if;
  delete from public.video_captures where id = p_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
end;
$$;

-- ---- 5. Versions vidéo ----
drop function if exists public.save_video_capture_version(text, text, text, jsonb);
create or replace function public.save_video_capture_version(p_id text, p_capture_id text, p_title text, p_substitutions jsonb, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
  v_cap record; v_existing public.video_capture_versions; v_now timestamptz := now();
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then raise exception 'Non autorisé'; end if;
  if p_id is null or p_id = '' then raise exception 'id manquant'; end if;
  if jsonb_typeof(coalesce(p_substitutions, '{}'::jsonb)) <> 'object' then raise exception 'substitutions invalides'; end if;
  select owner_id, owner_studio_id into v_cap from public.video_captures where id = p_capture_id;
  if not found or not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then raise exception 'Montage introuvable'; end if;
  select * into v_existing from public.video_capture_versions where id = p_id;
  if v_existing.id is not null and (not public.video_owned(v_existing.owner_id, v_existing.owner_studio_id, v_c, v_s) or v_existing.capture_id <> p_capture_id) then
    raise exception 'Non autorisé : cette version appartient à un autre montage';
  end if;
  insert into public.video_capture_versions (id, capture_id, owner_id, owner_studio_id, title, substitutions, updated_at)
  values (p_id, p_capture_id, v_c, v_s, coalesce(p_title, ''), coalesce(p_substitutions, '{}'::jsonb), v_now)
  on conflict (id) do update set title = excluded.title, substitutions = excluded.substitutions, updated_at = v_now;
  return jsonb_build_object('ok', true, 'id', p_id, 'updatedAt', v_now);
end;
$$;

drop function if exists public.list_video_capture_versions(text);
create or replace function public.list_video_capture_versions(p_capture_id text, p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_result jsonb;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'captureId', capture_id, 'title', title, 'substitutions', substitutions,
    'lastExportVideoId', last_export_video_id, 'createdAt', created_at, 'updatedAt', updated_at
  ) order by created_at), '[]'::jsonb)
  into v_result
  from public.video_capture_versions
  where capture_id = p_capture_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
  return v_result;
end;
$$;

drop function if exists public.delete_video_capture_version(text);
create or replace function public.delete_video_capture_version(p_id text, p_studio boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then raise exception 'Non autorisé'; end if;
  delete from public.video_capture_versions where id = p_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
end;
$$;

-- ---- 6. Exports, vidéo muette, historique ----
drop function if exists public.video_drop_unused(uuid, text[]);
create or replace function public.video_drop_unused(p_owner uuid, p_owner_studio uuid, p_ids text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_removed jsonb := '[]'::jsonb; r record;
begin
  for r in select id, base, file from public.composer_videos
    where public.video_owned(owner_id, owner_studio_id, p_owner, p_owner_studio) and id = any(coalesce(p_ids, '{}')) loop
    if not public.video_still_used(r.id) then
      delete from public.composer_videos where id = r.id;
      v_removed := v_removed || jsonb_build_object('id', r.id, 'path', replace(r.base, 'https://media.layerpitch.com/', '') || r.file);
    end if;
  end loop;
  return v_removed;
end;
$$;

drop function if exists public.video_history_push(uuid, text, text, text, jsonb, boolean);
create or replace function public.video_history_push(p_owner uuid, p_owner_studio uuid, p_capture_id text, p_version_id text, p_old_video text, p_old_cues jsonb, p_keep_old boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_drop text[] := '{}';
begin
  if p_old_video is null then return '[]'::jsonb; end if;
  if coalesce(p_keep_old, true) then
    insert into public.video_export_history (owner_id, owner_studio_id, capture_id, version_id, video_id, cues) values (p_owner, p_owner_studio, p_capture_id, p_version_id, p_old_video, p_old_cues);
    with old as (
      select id, video_id from public.video_export_history
      where capture_id = p_capture_id and version_id is not distinct from p_version_id
      order by created_at desc, id desc offset public.video_history_keep()
    ), del as (delete from public.video_export_history h using old where h.id = old.id returning old.video_id)
    select coalesce(array_agg(video_id), '{}') into v_drop from del;
  else
    v_drop := array[p_old_video];
  end if;
  return public.video_drop_unused(p_owner, p_owner_studio, v_drop);
end;
$$;

drop function if exists public.set_video_capture_export(text, text, jsonb, boolean);
create or replace function public.set_video_capture_export(p_capture_id text, p_video_id text, p_cues jsonb default null, p_keep_old boolean default true, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_cap public.video_captures;
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé'; end if;
  if p_video_id is not null and not exists (select 1 from public.composer_videos where id = p_video_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s)) then
    raise exception 'Vidéo introuvable';
  end if;
  if p_cues is not null and jsonb_typeof(p_cues) <> 'array' then raise exception 'étiquettes invalides'; end if;
  select * into v_cap from public.video_captures where id = p_capture_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
  if not found then raise exception 'Montage introuvable'; end if;
  update public.video_captures set last_export_video_id = p_video_id, last_export_cues = p_cues where id = p_capture_id;
  if v_cap.last_export_video_id is not distinct from p_video_id then return jsonb_build_object('removed', '[]'::jsonb); end if;
  return jsonb_build_object('removed', public.video_history_push(v_c, v_s, p_capture_id, null, v_cap.last_export_video_id, v_cap.last_export_cues, p_keep_old));
end;
$$;

drop function if exists public.set_video_capture_version_export(text, text, jsonb, boolean);
create or replace function public.set_video_capture_version_export(p_id text, p_video_id text, p_cues jsonb default null, p_keep_old boolean default true, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_ver public.video_capture_versions;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then raise exception 'Non autorisé'; end if;
  if p_video_id is not null and not exists (select 1 from public.composer_videos where id = p_video_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s)) then
    raise exception 'Vidéo introuvable';
  end if;
  if p_cues is not null and jsonb_typeof(p_cues) <> 'array' then raise exception 'étiquettes invalides'; end if;
  select * into v_ver from public.video_capture_versions where id = p_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
  if not found then raise exception 'Version introuvable'; end if;
  update public.video_capture_versions set last_export_video_id = p_video_id, last_export_cues = p_cues, updated_at = now() where id = p_id;
  if v_ver.last_export_video_id is not distinct from p_video_id then return jsonb_build_object('removed', '[]'::jsonb); end if;
  return jsonb_build_object('removed', public.video_history_push(v_c, v_s, v_ver.capture_id, p_id, v_ver.last_export_video_id, v_ver.last_export_cues, p_keep_old));
end;
$$;

drop function if exists public.video_capture_base(text);
create or replace function public.video_capture_base(p_capture_id text, p_studio boolean default false)
returns text language sql stable security definer set search_path = public as $$
  select base_video_id from public.video_captures where id = p_capture_id
    and public.video_owned(owner_id, owner_studio_id, public.video_actor_composer(p_studio), public.video_actor_studio(p_studio))
$$;
drop function if exists public.set_video_capture_base(text, text);
create or replace function public.set_video_capture_base(p_capture_id text, p_video_id text, p_studio boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé'; end if;
  if p_video_id is not null and not exists (select 1 from public.composer_videos where id = p_video_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s)) then
    raise exception 'Vidéo introuvable';
  end if;
  update public.video_captures set base_video_id = p_video_id where id = p_capture_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
end;
$$;

drop function if exists public.list_video_export_history(text);
create or replace function public.list_video_export_history(p_capture_id text, p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
begin
  if v_c is null and v_s is null then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'versionId', h.version_id, 'videoId', h.video_id, 'url', v.base || v.file,
      'sizeBytes', v.size_bytes, 'createdAt', h.created_at) order by h.created_at desc, h.id desc), '[]'::jsonb)
    from public.video_export_history h join public.composer_videos v on v.id = h.video_id
    where h.capture_id = p_capture_id and public.video_owned(h.owner_id, h.owner_studio_id, v_c, v_s));
end;
$$;

drop function if exists public.restore_video_export(bigint);
create or replace function public.restore_video_export(p_history_id bigint, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); h public.video_export_history;
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé'; end if;
  select * into h from public.video_export_history where id = p_history_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
  if not found then raise exception 'Export introuvable'; end if;
  delete from public.video_export_history where id = h.id;
  if h.version_id is null then return public.set_video_capture_export(h.capture_id, h.video_id, h.cues, true, p_studio); end if;
  return public.set_video_capture_version_export(h.version_id, h.video_id, h.cues, true, p_studio);
end;
$$;

drop function if exists public.my_video_history_usage();
create or replace function public.my_video_history_usage(p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
begin
  if v_c is null and v_s is null then return jsonb_build_object('count', 0, 'bytes', 0); end if;
  return (select jsonb_build_object('count', count(*), 'bytes', coalesce(sum(v.size_bytes), 0))
    from public.video_export_history h join public.composer_videos v on v.id = h.video_id where public.video_owned(h.owner_id, h.owner_studio_id, v_c, v_s));
end;
$$;

drop function if exists public.clear_video_export_history();
create or replace function public.clear_video_export_history(p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_ids text[];
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé'; end if;
  with del as (delete from public.video_export_history where public.video_owned(owner_id, owner_studio_id, v_c, v_s) returning video_id)
  select coalesce(array_agg(distinct video_id), '{}') into v_ids from del;
  return jsonb_build_object('removed', public.video_drop_unused(v_c, v_s, v_ids));
end;
$$;

-- ---- 7. Projets : un membre d'un studio ajoute un montage de son studio ----
create or replace function public.video_montage_mine(p_capture_id text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.video_captures c where c.id = p_capture_id
    and ((c.owner_id is not null and c.owner_id = public.current_composer_id()) or (c.owner_studio_id is not null and c.owner_studio_id = public.current_studio_id())))
$$;

-- Un montage du studio (ou le sien) peut être posé dans un Projet.
create or replace function public.check_project_asset(p_project_id uuid, p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text := p->>'kind';
  v_url text := nullif(trim(coalesce(p->>'url', '')), '');
  v_file uuid := nullif(p->>'fileId', '')::uuid;
  v_track text := nullif(p->>'trackId', '');
  v_pack text := nullif(p->>'packId', '');
  v_album text := nullif(p->>'albumId', '');
  v_montage text := nullif(p->>'montageId', '');
  v_origin text := p->>'origin';
  v_mime text;
begin
  if v_kind not in ('link', 'image', 'audio', 'video', 'file', 'note', 'track', 'pack', 'album', 'montage') then raise exception 'Type d''objet inconnu'; end if;
  if v_kind = 'link' and (v_url is null or v_url !~* '^https?://[^\s/]+\.[^\s]+$') then raise exception 'Lien invalide (http:// ou https://)'; end if;
  -- Un lien YouTube / Vimeo est une vidéo, d'où qu'il vienne (onglet Vidéos, Moodboard, tchat).
  if v_kind = 'link' and public.project_video_url(v_url) then v_kind := 'video'; end if;
  if v_kind = 'video' and v_file is null and not public.project_video_url(v_url) then raise exception 'Lien YouTube ou Vimeo attendu'; end if;
  if v_kind in ('image', 'audio', 'file') or (v_kind = 'video' and v_file is not null) then
    select mime_type into v_mime from public.project_files where id = v_file and project_id = p_project_id;
    if v_mime is null then raise exception 'Fichier introuvable dans ce Projet'; end if;
    if v_kind = 'image' and v_mime not like 'image/%' then raise exception 'Ce fichier n''est pas une image'; end if;
    if v_kind = 'audio' and v_mime not like 'audio/%' then raise exception 'Ce fichier n''est pas un fichier audio'; end if;
    if v_kind = 'video' and v_mime not like 'video/%' then raise exception 'Vidéo introuvable dans ce Projet'; end if;
    v_url := null;
  end if;
  -- Morceau : seulement par son compositeur (coexistence, D35) — le Projet n'en garde qu'un lien.
  if v_kind = 'track' and not exists (select 1 from public.tracks t where t.id = v_track and t.owner_id = public.current_composer_id()) then
    raise exception 'Tu ne peux ajouter que tes propres morceaux';
  end if;
  -- Pack : son compositeur, ou un pack déjà partagé / offert dans ce Projet.
  if v_kind = 'pack' and not (exists (select 1 from public.packs k where k.id = v_pack and k.owner_id = public.current_composer_id())
                              or exists (select 1 from public.project_shared_packs s where s.project_id = p_project_id and s.pack_id = v_pack)) then
    raise exception 'Tu ne peux ajouter que tes propres packs, ou un pack déjà partagé dans ce Projet';
  end if;
  -- Montage vidéo (versions vidéo, 21/10) : seulement par son auteur ; le Projet n'en garde qu'un lien, toujours à jour.
  if v_kind = 'montage' and not public.video_montage_mine(v_montage) then -- le sien, ou celui de son studio
    raise exception 'Tu ne peux ajouter que tes propres montages vidéo';
  end if;
  -- Album : seulement s'il est rattaché au Projet (par son vendeur, section Musique).
  if v_kind = 'album' and not exists (select 1 from public.project_albums a where a.project_id = p_project_id and a.album_id = v_album) then
    raise exception 'Album non rattaché à ce Projet';
  end if;
  v_origin := case when v_kind in ('track', 'pack', 'album', 'montage') then 'layerpitch'
                   when v_kind in ('link') or (v_kind = 'video' and v_file is null) then 'external'
                   when v_origin in ('external', 'own') then v_origin else 'own' end;
  return jsonb_build_object('kind', v_kind, 'origin', v_origin,
    'url', case when v_kind in ('link', 'video') then v_url end,
    'fileId', case when v_kind in ('image', 'audio', 'file', 'video') then v_file end,
    'trackId', case when v_kind = 'track' then v_track end, 'packId', case when v_kind = 'pack' then v_pack end,
    'albumId', case when v_kind = 'album' then v_album end, 'montageId', case when v_kind = 'montage' then v_montage end);
end;
$$;

-- ---- Droits ----
revoke all on function public.video_actor_composer(boolean), public.video_actor_studio(boolean), public.video_can_save(boolean), public.video_can_version(boolean),
  public.video_drop_unused(uuid, uuid, text[]), public.video_history_push(uuid, uuid, text, text, text, jsonb, boolean), public.video_montage_mine(text) from public, anon, authenticated;
revoke all on function public.reserve_video_upload_studio(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.reserve_video_upload_studio(uuid, text, bigint) to service_role;
revoke all on function public.delete_video(text, boolean), public.list_my_videos(boolean),
  public.save_video_capture(text, text, text, text, jsonb, jsonb, jsonb, boolean), public.list_my_video_captures(text, boolean), public.get_video_capture(text, boolean),
  public.delete_video_capture(text, boolean), public.save_video_capture_version(text, text, text, jsonb, boolean), public.list_video_capture_versions(text, boolean),
  public.delete_video_capture_version(text, boolean), public.set_video_capture_export(text, text, jsonb, boolean, boolean),
  public.set_video_capture_version_export(text, text, jsonb, boolean, boolean), public.video_capture_base(text, boolean), public.set_video_capture_base(text, text, boolean),
  public.list_video_export_history(text, boolean), public.restore_video_export(bigint, boolean), public.my_video_history_usage(boolean),
  public.clear_video_export_history(boolean) from public, anon;
grant execute on function public.delete_video(text, boolean), public.list_my_videos(boolean),
  public.save_video_capture(text, text, text, text, jsonb, jsonb, jsonb, boolean), public.list_my_video_captures(text, boolean), public.get_video_capture(text, boolean),
  public.delete_video_capture(text, boolean), public.save_video_capture_version(text, text, text, jsonb, boolean), public.list_video_capture_versions(text, boolean),
  public.delete_video_capture_version(text, boolean), public.set_video_capture_export(text, text, jsonb, boolean, boolean),
  public.set_video_capture_version_export(text, text, jsonb, boolean, boolean), public.video_capture_base(text, boolean), public.set_video_capture_base(text, text, boolean),
  public.list_video_export_history(text, boolean), public.restore_video_export(bigint, boolean), public.my_video_history_usage(boolean),
  public.clear_video_export_history(boolean) to authenticated;
