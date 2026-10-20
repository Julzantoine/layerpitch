-- Versions vidéo visibles partout, toujours à jour (21/10, décidé par Jules-Antoine).
--
-- Un AdReel (puis l'espace Projet) pointe vers un MONTAGE, plus vers un fichier vidéo : le spectateur choisit la version dans un menu
-- (musique d'origine, musique 2…), et une étiquette sur la vidéo dit ce qui joue (couche, boucle, section, stinger). Quand on retouche
-- et réexporte dans l'outil de Versioning, le montage ou la version retient sa nouvelle vidéo ET ses nouvelles étiquettes : tous les
-- endroits qui l'affichent suivent, sans republier.
--
-- 1. Les étiquettes (« cues ») sont calculées par l'outil de capture au moment de l'export, avec la même logique que l'incrustation de
--    l'export complet, et rangées à côté de la vidéo exportée : [{ start, end, text, kind: 'state' | 'stinger' | 'fx', row }].
-- 2. get_public_video_montage() : lecture publique (sans compte) des versions EXPORTÉES d'un montage, pour le lecteur des pages publiques.
--    Ne renvoie que ce qui s'affiche (titre, adresse de la vidéo, étiquettes) ; l'identifiant d'un montage est aléatoire et n'est connu
--    que des pages où son auteur l'a placé.

alter table public.video_captures add column if not exists last_export_cues jsonb;
alter table public.video_capture_versions add column if not exists last_export_cues jsonb;

-- Export direct du montage : vidéo + étiquettes (remplace la version à deux paramètres du 21/10, migration 20261021010000).
drop function if exists public.set_video_capture_export(text, text);
create or replace function public.set_video_capture_export(p_capture_id text, p_video_id text, p_cues jsonb default null)
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
  if p_cues is not null and jsonb_typeof(p_cues) <> 'array' then raise exception 'étiquettes invalides'; end if;
  update public.video_captures set last_export_video_id = p_video_id, last_export_cues = p_cues
  where id = p_capture_id and owner_id = v_owner_id;
end;
$$;

-- Export d'une version vidéo : vidéo + étiquettes (mêmes droits qu'avant : palier versioning « saved », migration 20260928020000).
drop function if exists public.set_video_capture_version_export(text, text);
create or replace function public.set_video_capture_version_export(p_id text, p_video_id text, p_cues jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null or coalesce(public.i_level('versioning'), '') <> 'saved' then
    raise exception 'Non autorisé';
  end if;
  if p_video_id is not null and not exists (select 1 from public.composer_videos where id = p_video_id and owner_id = v_owner_id) then
    raise exception 'Vidéo introuvable';
  end if;
  if p_cues is not null and jsonb_typeof(p_cues) <> 'array' then raise exception 'étiquettes invalides'; end if;
  update public.video_capture_versions set last_export_video_id = p_video_id, last_export_cues = p_cues, updated_at = now()
  where id = p_id and owner_id = v_owner_id;
end;
$$;

-- Lecture publique d'un montage : ses versions exportées (la musique d'origine d'abord, puis les versions dans l'ordre de création).
create or replace function public.get_public_video_montage(p_capture_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_capture public.video_captures;
  v_versions jsonb;
begin
  select * into v_capture from public.video_captures where id = p_capture_id;
  if not found then return null; end if;
  select coalesce(jsonb_agg(x.item order by x.ord, x.created_at), '[]'::jsonb) into v_versions
  from (
    select 0 as ord, v_capture.created_at as created_at,
      jsonb_build_object('key', 'original', 'title', null, 'url', cv.base || cv.file, 'cues', coalesce(v_capture.last_export_cues, '[]'::jsonb)) as item
    from public.composer_videos cv where cv.id = v_capture.last_export_video_id
    union all
    select 1, ver.created_at,
      jsonb_build_object('key', ver.id, 'title', ver.title, 'url', cv.base || cv.file, 'cues', coalesce(ver.last_export_cues, '[]'::jsonb))
    from public.video_capture_versions ver
    join public.composer_videos cv on cv.id = ver.last_export_video_id
    where ver.capture_id = p_capture_id
  ) x;
  return jsonb_build_object('id', v_capture.id, 'title', v_capture.title, 'versions', v_versions);
end;
$$;

revoke all on function public.set_video_capture_export(text, text, jsonb) from public, anon;
revoke all on function public.set_video_capture_version_export(text, text, jsonb) from public, anon;
grant execute on function public.set_video_capture_export(text, text, jsonb) to authenticated;
grant execute on function public.set_video_capture_version_export(text, text, jsonb) to authenticated;
grant execute on function public.get_public_video_montage(text) to anon, authenticated;
