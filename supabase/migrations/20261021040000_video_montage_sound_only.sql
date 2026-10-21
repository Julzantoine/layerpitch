-- Vidéo muette une fois, une musique par version (21/10, décidé par Jules-Antoine).
--
-- Jusqu'ici chaque export d'un montage ou d'une version était un fichier vidéo complet : l'image (identique à chaque fois) recopiée
-- avec la nouvelle musique. Désormais, dans les pages LayerPitch (AdReels, espace Projet) :
--   - le montage garde UNE vidéo muette (base_video_id, composer_videos.kind = 'capture_base') ;
--   - chaque export (le montage et chacune de ses versions) n'est plus qu'un fichier SON (kind = 'capture_audio', son seul dans un
--     conteneur .mp4, comme le reste de la bibliothèque) avec ses étiquettes ;
--   - le lecteur public joue l'image muette et le son de la version choisie ensemble, synchronisés.
-- L'historique (3 derniers exports) ne garde donc que des sons : il ne prend presque rien. La vraie vidéo complète (pour télécharger ou
-- publier ailleurs) se fabrique toujours depuis l'outil de capture, à la demande. Les anciens exports vidéo complets restent lus tels quels.

alter table public.composer_videos drop constraint if exists composer_videos_kind_check;
alter table public.composer_videos add constraint composer_videos_kind_check check (kind in ('upload', 'capture_export', 'capture_audio', 'capture_base'));

alter table public.video_captures add column if not exists base_video_id text references public.composer_videos(id) on delete set null;

-- Vidéo muette d'un montage (le propriétaire seulement) : lire, puis poser.
create or replace function public.video_capture_base(p_capture_id text)
returns text language sql stable security definer set search_path = public as $$
  select base_video_id from public.video_captures where id = p_capture_id and owner_id = public.current_composer_id()
$$;
create or replace function public.set_video_capture_base(p_capture_id text, p_video_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null then raise exception 'Non autorisé'; end if;
  if p_video_id is not null and not exists (select 1 from public.composer_videos where id = p_video_id and owner_id = v_owner_id) then
    raise exception 'Vidéo introuvable';
  end if;
  update public.video_captures set base_video_id = p_video_id where id = p_capture_id and owner_id = v_owner_id;
end;
$$;

-- Une vidéo muette de montage sert aussi : jamais effacée par le nettoyage des historiques.
create or replace function public.video_still_used(p_video_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.video_captures where last_export_video_id = p_video_id or base_video_id = p_video_id)
      or exists (select 1 from public.video_capture_versions where last_export_video_id = p_video_id)
      or exists (select 1 from public.video_export_history where video_id = p_video_id)
      or exists (select 1 from public.ad_reels where blocks::text like '%' || p_video_id || '%')
$$;

-- Liste des montages : avec leur vidéo muette (le bloc vidéo du Backstage retrouve un montage par elle).
create or replace function public.list_my_video_captures(p_pack_id text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_owner_id uuid := public.current_composer_id(); v_result jsonb;
begin
  if v_owner_id is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'packId', pack_id, 'title', title, 'videoFilename', video_filename,
    'lastExportVideoId', last_export_video_id, 'baseVideoId', base_video_id,
    'createdAt', created_at, 'updatedAt', updated_at
  ) order by updated_at desc), '[]'::jsonb)
  into v_result
  from public.video_captures
  where owner_id = v_owner_id and (p_pack_id is null or pack_id = p_pack_id);
  return v_result;
end;
$$;

-- Bibliothèque : les sons des versions ne sont pas des vidéos (pas dans les sélecteurs), mais comptent dans le quota (usedBytes).
create or replace function public.list_my_videos()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_videos jsonb; v_interrupted jsonb; v_used bigint; v_quota_gb int;
begin
  if v_owner_id is null then
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
  from public.composer_videos where owner_id = v_owner_id;
  select max_video_storage_gb into v_quota_gb from public.effective_plan_quotas(v_owner_id);
  return jsonb_build_object('videos', v_videos, 'interrupted', v_interrupted, 'usedBytes', v_used, 'quotaGb', v_quota_gb);
end;
$$;

-- Lecture publique : la vidéo muette du montage (baseUrl) et, pour chaque version, son fichier et sa nature
-- ('audio' = son seul, joué sur l'image muette ; 'video' = ancien export complet, lu tel quel).
create or replace function public.get_public_video_montage(p_capture_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_capture public.video_captures;
  v_versions jsonb;
  v_base text;
begin
  select * into v_capture from public.video_captures where id = p_capture_id;
  if not found then return null; end if;
  select base || file into v_base from public.composer_videos where id = v_capture.base_video_id;
  select coalesce(jsonb_agg(x.item order by x.ord, x.created_at), '[]'::jsonb) into v_versions
  from (
    select 0 as ord, v_capture.created_at as created_at,
      jsonb_build_object('key', 'original', 'title', null, 'url', cv.base || cv.file, 'kind', case when cv.kind = 'capture_audio' then 'audio' else 'video' end,
        'cues', coalesce(v_capture.last_export_cues, '[]'::jsonb)) as item
    from public.composer_videos cv where cv.id = v_capture.last_export_video_id
    union all
    select 1, ver.created_at,
      jsonb_build_object('key', ver.id, 'title', ver.title, 'url', cv.base || cv.file, 'kind', case when cv.kind = 'capture_audio' then 'audio' else 'video' end,
        'cues', coalesce(ver.last_export_cues, '[]'::jsonb))
    from public.video_capture_versions ver
    join public.composer_videos cv on cv.id = ver.last_export_video_id
    where ver.capture_id = p_capture_id
  ) x;
  return jsonb_build_object('id', v_capture.id, 'title', v_capture.title, 'baseUrl', v_base, 'versions', v_versions);
end;
$$;

revoke all on function public.video_capture_base(text), public.set_video_capture_base(text, text) from public, anon;
grant execute on function public.video_capture_base(text), public.set_video_capture_base(text, text) to authenticated;
revoke all on function public.video_still_used(text) from public, anon, authenticated;
grant execute on function public.get_public_video_montage(text) to anon, authenticated;
