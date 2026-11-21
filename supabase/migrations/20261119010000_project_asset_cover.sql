-- LayerPitch — Vignette au choix sur chaque objet du Projet (19 novembre 2026).
--
-- Un objet épinglé au Moodboard a toujours une vignette automatique (aperçu du lien, l'image elle-même, visuel de catégorie).
-- Ce champ permet d'y poser en plus une image choisie : cover_file_id pointe vers un fichier déjà envoyé dans le même Projet
-- (project_files, même chaîne d'envoi que les images). Si le fichier est supprimé, la vignette redevient automatique.
-- Réglable par tout membre, comme le titre et le commentaire (update_project_asset accepte maintenant 'coverFileId').

alter table public.project_assets
  add column if not exists cover_file_id uuid references public.project_files(id) on delete set null;

create or replace function public.update_project_asset(p_asset_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_project uuid; v_cover uuid;
begin
  select project_id into v_project from public.project_assets where id = p_asset_id;
  if v_project is null then raise exception 'Objet introuvable'; end if;
  perform public.assert_project_role(v_project);
  if p ? 'coverFileId' and nullif(p->>'coverFileId', '') is not null then
    v_cover := (p->>'coverFileId')::uuid;
    if not exists (select 1 from public.project_files where id = v_cover and project_id = v_project and status = 'ready') then
      raise exception 'Image de vignette introuvable dans ce Projet';
    end if;
  end if;
  update public.project_assets set
    title = case when p ? 'title' then left(coalesce(p->>'title', ''), 300) else title end,
    body = case when p ? 'body' then coalesce(p->>'body', '') else body end,
    cover_file_id = case when p ? 'coverFileId' then v_cover else cover_file_id end,
    updated_at = now()
  where id = p_asset_id;
  update public.projects set updated_at = now() where id = v_project;
end;
$$;

create or replace function public.get_project_content(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_role(p_project_id);
  return jsonb_build_object(
    'assets', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'origin', x.origin, 'title', x.title, 'body', x.body,
        'url', x.url, 'fileId', x.file_id, 'coverFileId', x.cover_file_id, 'fileName', f.original_name, 'fileSize', f.size_bytes, 'mimeType', f.mime_type, 'trackId', x.track_id, 'packId', x.pack_id,
        'albumId', x.album_id, 'montageId', x.montage_id, 'montageTitle', vc.title, 'trackTitle', t.title, 'packTitle', k.title, 'albumTitle', al.title, 'preview', x.preview,
        'createdAt', x.created_at, 'authorEmail', (select u.email from auth.users u where u.id = x.created_by),
        'pinned', pin.asset_id is not null, 'starred', coalesce(pin.starred, false),
        'notes', (select count(*) from public.project_annotations a where a.target_type = 'asset' and a.target_id = x.id::text
          and (not a.private or a.author_id = auth.uid())))
        order by x.created_at), '[]'::jsonb)
      from public.project_assets x
      left join public.project_files f on f.id = x.file_id left join public.tracks t on t.id = x.track_id
      left join public.packs k on k.id = x.pack_id left join public.albums al on al.id = x.album_id
      left join public.video_captures vc on vc.id = x.montage_id
      left join public.project_moodboard_pins pin on pin.asset_id = x.id and pin.project_id = x.project_id
      where x.project_id = p_project_id),
    'moodboard', (select coalesce(jsonb_agg(p.asset_id order by p.position, p.created_at), '[]'::jsonb)
      from public.project_moodboard_pins p where p.project_id = p_project_id),
    'packs', (select coalesce(jsonb_agg(jsonb_build_object('packId', s.pack_id, 'title', k.title, 'illustration', k.illustration, 'mode', s.mode,
        'priceEurCents', k.price_eur_cents, 'subscriberCredits', k.subscriber_credits, 'mine', s.shared_by = auth.uid(),
        'sharedByEmail', (select u.email from auth.users u where u.id = s.shared_by)) order by s.created_at), '[]'::jsonb)
      from public.project_shared_packs s join public.packs k on k.id = s.pack_id where s.project_id = p_project_id),
    'albums', (select coalesce(jsonb_agg(jsonb_build_object('albumId', a.id, 'title', a.title, 'illustration', a.illustration, 'buyable', a.buyable)), '[]'::jsonb)
      from public.project_albums pa join public.albums a on a.id = pa.album_id where pa.project_id = p_project_id),
    'openAnnotations', (select count(*) from public.project_annotations where project_id = p_project_id and resolved_at is null
      and (not private or author_id = auth.uid())),
    'autoSnapshot', (select auto_snapshot from public.projects where id = p_project_id)
  );
end;
$$;
