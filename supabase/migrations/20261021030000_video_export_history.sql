-- Historique des exports d'un montage et de ses versions vidéo (21/10, décidé par Jules-Antoine).
--
-- « Mettre à jour la vidéo partout » (migration 20261021020000) remplace la vidéo d'un montage ou d'une version. L'ancienne n'était
-- reliée à rien. Désormais :
--   - chaque montage et chaque version garde ses 3 derniers exports (video_history_keep()), avec leurs étiquettes, et on peut y revenir
--     (restore_video_export) : la vidéo choisie redevient celle affichée partout ;
--   - au-delà, le plus ancien est effacé de la bibliothèque, sauf s'il sert encore ailleurs (export en cours d'un montage ou d'une
--     version, autre historique, ou placé à la main dans un bloc vidéo d'un AdReel) ;
--   - à la mise à jour, on peut renoncer à garder l'ancienne (p_keep_old = false), pour ne pas prendre de place ;
--   - clear_video_export_history() efface tous les historiques d'un coup (quota atteint).
-- Les fonctions renvoient les fichiers à effacer du stockage (removed: [{ id, path }]) : la page les efface ensuite (même mécanisme
-- d'URL signée que la bibliothèque vidéo), comme pour la suppression d'une vidéo.

create table if not exists public.video_export_history (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.composer_profiles(id) on delete cascade,
  capture_id text not null references public.video_captures(id) on delete cascade,
  version_id text references public.video_capture_versions(id) on delete cascade,
  video_id text not null references public.composer_videos(id) on delete cascade,
  cues jsonb,
  created_at timestamptz not null default now()
);
create index if not exists video_export_history_target_idx on public.video_export_history(capture_id, version_id, created_at desc);
alter table public.video_export_history enable row level security; -- aucun accès direct : seulement les fonctions ci-dessous

create or replace function public.video_history_keep() returns int language sql immutable as $$ select 3 $$;

-- Une vidéo de la bibliothèque sert-elle encore quelque part ?
create or replace function public.video_still_used(p_video_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.video_captures where last_export_video_id = p_video_id)
      or exists (select 1 from public.video_capture_versions where last_export_video_id = p_video_id)
      or exists (select 1 from public.video_export_history where video_id = p_video_id)
      or exists (select 1 from public.ad_reels where blocks::text like '%' || p_video_id || '%')
$$;

-- Efface de la bibliothèque les vidéos données qui ne servent plus ; renvoie leurs chemins de stockage.
create or replace function public.video_drop_unused(p_owner uuid, p_ids text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_removed jsonb := '[]'::jsonb; r record;
begin
  for r in select id, base, file from public.composer_videos where owner_id = p_owner and id = any(coalesce(p_ids, '{}')) loop
    if not public.video_still_used(r.id) then
      delete from public.composer_videos where id = r.id;
      v_removed := v_removed || jsonb_build_object('id', r.id, 'path', replace(r.base, 'https://media.layerpitch.com/', '') || r.file);
    end if;
  end loop;
  return v_removed;
end;
$$;

-- Range l'export remplacé dans l'historique (ou le lâche) puis garde les N derniers ; renvoie les vidéos à effacer.
create or replace function public.video_history_push(p_owner uuid, p_capture_id text, p_version_id text, p_old_video text, p_old_cues jsonb, p_keep_old boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_drop text[] := '{}';
begin
  if p_old_video is null then return '[]'::jsonb; end if;
  if coalesce(p_keep_old, true) then
    insert into public.video_export_history (owner_id, capture_id, version_id, video_id, cues) values (p_owner, p_capture_id, p_version_id, p_old_video, p_old_cues);
    with old as (
      select id, video_id from public.video_export_history
      where capture_id = p_capture_id and version_id is not distinct from p_version_id
      order by created_at desc, id desc offset public.video_history_keep()
    ), del as (delete from public.video_export_history h using old where h.id = old.id returning old.video_id)
    select coalesce(array_agg(video_id), '{}') into v_drop from del;
  else
    v_drop := array[p_old_video];
  end if;
  return public.video_drop_unused(p_owner, v_drop);
end;
$$;

-- Export direct du montage : vidéo + étiquettes, ancienne vidéo rangée dans l'historique (ou lâchée).
drop function if exists public.set_video_capture_export(text, text, jsonb);
create or replace function public.set_video_capture_export(p_capture_id text, p_video_id text, p_cues jsonb default null, p_keep_old boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_cap public.video_captures;
begin
  if v_owner_id is null then raise exception 'Non autorisé'; end if;
  if p_video_id is not null and not exists (select 1 from public.composer_videos where id = p_video_id and owner_id = v_owner_id) then
    raise exception 'Vidéo introuvable';
  end if;
  if p_cues is not null and jsonb_typeof(p_cues) <> 'array' then raise exception 'étiquettes invalides'; end if;
  select * into v_cap from public.video_captures where id = p_capture_id and owner_id = v_owner_id;
  if not found then raise exception 'Montage introuvable'; end if;
  update public.video_captures set last_export_video_id = p_video_id, last_export_cues = p_cues where id = p_capture_id;
  if v_cap.last_export_video_id is not distinct from p_video_id then return jsonb_build_object('removed', '[]'::jsonb); end if;
  return jsonb_build_object('removed', public.video_history_push(v_owner_id, p_capture_id, null, v_cap.last_export_video_id, v_cap.last_export_cues, p_keep_old));
end;
$$;

-- Export d'une version vidéo : même chose (droits : palier versioning « saved », comme avant).
drop function if exists public.set_video_capture_version_export(text, text, jsonb);
create or replace function public.set_video_capture_version_export(p_id text, p_video_id text, p_cues jsonb default null, p_keep_old boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_ver public.video_capture_versions;
begin
  if v_owner_id is null or coalesce(public.i_level('versioning'), '') <> 'saved' then raise exception 'Non autorisé'; end if;
  if p_video_id is not null and not exists (select 1 from public.composer_videos where id = p_video_id and owner_id = v_owner_id) then
    raise exception 'Vidéo introuvable';
  end if;
  if p_cues is not null and jsonb_typeof(p_cues) <> 'array' then raise exception 'étiquettes invalides'; end if;
  select * into v_ver from public.video_capture_versions where id = p_id and owner_id = v_owner_id;
  if not found then raise exception 'Version introuvable'; end if;
  update public.video_capture_versions set last_export_video_id = p_video_id, last_export_cues = p_cues, updated_at = now() where id = p_id;
  if v_ver.last_export_video_id is not distinct from p_video_id then return jsonb_build_object('removed', '[]'::jsonb); end if;
  return jsonb_build_object('removed', public.video_history_push(v_owner_id, v_ver.capture_id, p_id, v_ver.last_export_video_id, v_ver.last_export_cues, p_keep_old));
end;
$$;

-- Historique d'un montage (le montage lui-même et ses versions), du plus récent au plus ancien.
create or replace function public.list_video_export_history(p_capture_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'versionId', h.version_id, 'videoId', h.video_id, 'url', v.base || v.file,
      'sizeBytes', v.size_bytes, 'createdAt', h.created_at) order by h.created_at desc, h.id desc), '[]'::jsonb)
    from public.video_export_history h join public.composer_videos v on v.id = h.video_id
    where h.capture_id = p_capture_id and h.owner_id = v_owner_id);
end;
$$;

-- Revenir à un export de l'historique : il redevient la vidéo affichée partout, la vidéo actuelle passe dans l'historique.
create or replace function public.restore_video_export(p_history_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner_id uuid := public.current_composer_id();
  h public.video_export_history;
begin
  if v_owner_id is null then raise exception 'Non autorisé'; end if;
  select * into h from public.video_export_history where id = p_history_id and owner_id = v_owner_id;
  if not found then raise exception 'Export introuvable'; end if;
  delete from public.video_export_history where id = h.id;
  if h.version_id is null then
    return public.set_video_capture_export(h.capture_id, h.video_id, h.cues, true);
  end if;
  return public.set_video_capture_version_export(h.version_id, h.video_id, h.cues, true);
end;
$$;

-- Place prise par les historiques du compte (pour le bouton de nettoyage de la bibliothèque vidéo).
create or replace function public.my_video_history_usage()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null then return jsonb_build_object('count', 0, 'bytes', 0); end if;
  return (select jsonb_build_object('count', count(*), 'bytes', coalesce(sum(v.size_bytes), 0))
    from public.video_export_history h join public.composer_videos v on v.id = h.video_id where h.owner_id = v_owner_id);
end;
$$;

-- Effacer tous les historiques du compte (quota atteint) : les vidéos qui ne servent plus sont retirées de la bibliothèque.
create or replace function public.clear_video_export_history()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_ids text[];
begin
  if v_owner_id is null then raise exception 'Non autorisé'; end if;
  with del as (delete from public.video_export_history where owner_id = v_owner_id returning video_id)
  select coalesce(array_agg(distinct video_id), '{}') into v_ids from del;
  return jsonb_build_object('removed', public.video_drop_unused(v_owner_id, v_ids));
end;
$$;

revoke all on function public.video_still_used(text), public.video_drop_unused(uuid, text[]),
  public.video_history_push(uuid, text, text, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.set_video_capture_export(text, text, jsonb, boolean), public.set_video_capture_version_export(text, text, jsonb, boolean),
  public.list_video_export_history(text), public.restore_video_export(bigint), public.my_video_history_usage(), public.clear_video_export_history() from public, anon;
grant execute on function public.set_video_capture_export(text, text, jsonb, boolean), public.set_video_capture_version_export(text, text, jsonb, boolean),
  public.list_video_export_history(text), public.restore_video_export(bigint), public.my_video_history_usage(), public.clear_video_export_history() to authenticated;
