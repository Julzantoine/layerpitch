-- Vignette d'un montage vidéo (19/11) : UNE image par montage, choisie dans l'atelier, affichée partout où le montage est lu
-- (espace Projet, vitrines, AdReels...) par le lecteur à versions, avant le début de la lecture (attribut « poster » de la vidéo).
-- Ce n'est pas une vignette par version : c'est le visuel du montage, quelle que soit la version écoutée.
--
-- cover_url : adresse complète d'une image déjà envoyée sur le stockage média (images/<dossier du propriétaire>/montage-<id>.<ext>),
-- même principe que la pochette d'un album. Le fichier lui-même est envoyé par create-media-signed-url, qui impose son dossier ;
-- ici on ne garde que l'adresse, après avoir vérifié qu'elle pointe bien vers le dossier d'images du média.

alter table public.video_captures add column if not exists cover_url text;

-- Poser (ou, avec NULL, retirer) la vignette d'un montage qui m'appartient (ou à mon studio : p_studio).
create or replace function public.set_video_capture_cover(p_capture_id text, p_cover_url text, p_studio boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé'; end if;
  if p_cover_url is not null and p_cover_url !~ '^https://media\.layerpitch\.com/images/[^/\s]+/montage-[^/\s]+\.(jpg|jpeg|png|webp)$' then
    raise exception 'Adresse d''image invalide';
  end if;
  update public.video_captures set cover_url = p_cover_url
    where id = p_capture_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
  if not found then raise exception 'Montage introuvable'; end if;
end;
$$;

-- Lecture de la vignette par son propriétaire (l'atelier l'affiche à côté du nom du montage).
create or replace function public.get_video_capture_cover(p_capture_id text, p_studio boolean default false)
returns text language sql stable security definer set search_path = public as $$
  select cover_url from public.video_captures where id = p_capture_id
    and public.video_owned(owner_id, owner_studio_id, public.video_actor_composer(p_studio), public.video_actor_studio(p_studio))
$$;

revoke all on function public.set_video_capture_cover(text, text, boolean), public.get_video_capture_cover(text, boolean) from public, anon;
grant execute on function public.set_video_capture_cover(text, text, boolean), public.get_video_capture_cover(text, boolean) to authenticated;

-- Lecture publique d'un montage : recopiée de 20261021040000, une seule ligne ajoutée (coverUrl). Rien d'autre n'est divulgué.
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
  return jsonb_build_object('id', v_capture.id, 'title', v_capture.title, 'baseUrl', v_base, 'coverUrl', v_capture.cover_url, 'versions', v_versions);
end;
$$;
grant execute on function public.get_public_video_montage(text) to anon, authenticated;
