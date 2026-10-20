-- Relier l'export direct d'un montage à ce montage (21/10, demandé par Jules-Antoine).
--
-- Avant : une version vidéo (video_capture_versions) retenait la vidéo de la bibliothèque qu'elle avait produite (last_export_video_id),
-- mais l'export DIRECT du montage (sa première musique) ne retenait rien. Le bloc vidéo d'un AdReel, qui propose de choisir la version
-- affichée parmi celles d'un même montage, ne pouvait donc pas proposer la « musique d'origine ». Désormais le montage retient aussi sa
-- dernière vidéo déposée dans la bibliothèque. Aucune donnée existante n'est modifiée (colonne vide au départ).

alter table public.video_captures
  add column if not exists last_export_video_id text references public.composer_videos(id) on delete set null;

-- Lecture : même fonction qu'avant, avec la vidéo d'export du montage en plus.
create or replace function public.list_my_video_captures(p_pack_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_result jsonb;
begin
  if v_owner_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'packId', pack_id, 'title', title, 'videoFilename', video_filename,
    'lastExportVideoId', last_export_video_id,
    'createdAt', created_at, 'updatedAt', updated_at
  ) order by updated_at desc), '[]'::jsonb)
  into v_result
  from public.video_captures
  where owner_id = v_owner_id and (p_pack_id is null or pack_id = p_pack_id);

  return v_result;
end;
$$;

-- Écriture : le propriétaire du montage note la vidéo qu'il vient d'en déposer dans sa bibliothèque (null = oublier le lien).
create or replace function public.set_video_capture_export(p_capture_id text, p_video_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null then
    raise exception 'Non autorisé';
  end if;
  if p_video_id is not null and not exists (select 1 from public.composer_videos where id = p_video_id and owner_id = v_owner_id) then
    raise exception 'Vidéo introuvable';
  end if;
  -- (updated_at inchangé : relier un export n'est pas une modification du montage, il ne remonte pas dans la liste)
  update public.video_captures set last_export_video_id = p_video_id
  where id = p_capture_id and owner_id = v_owner_id;
end;
$$;

revoke all on function public.set_video_capture_export(text, text) from public, anon;
grant execute on function public.set_video_capture_export(text, text) to authenticated;
