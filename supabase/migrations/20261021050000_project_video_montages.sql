-- Versions vidéo dans l'espace Projet (21/10, étape 2 ; étape 1 = AdReels, migrations 20261021020000 à 040000).
--
-- Un montage vidéo devient un objet du Projet (kind 'montage') : on le pose dans le Moodboard ou l'onglet Vidéos, et chaque membre le
-- regarde avec le même lecteur que les AdReels : menu « Version vidéo » (même instant) et étiquette « ce qui joue », lus en direct
-- (get_public_video_montage) -- une version retouchée dans l'outil de Versioning apparaît dans le Projet sans rien refaire.
-- Seul l'auteur du montage peut l'ajouter ; le Projet n'en garde qu'un lien (comme un morceau ou un pack).

alter table public.project_assets add column if not exists montage_id text references public.video_captures(id) on delete cascade; -- montage supprimé : l'objet disparaît du Projet
create unique index if not exists project_assets_montage_uq on public.project_assets(project_id, montage_id) where montage_id is not null;
alter table public.project_assets drop constraint if exists project_assets_kind_check;
alter table public.project_assets add constraint project_assets_kind_check check (kind in ('link', 'image', 'audio', 'video', 'file', 'note', 'track', 'pack', 'album', 'montage'));

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
  if v_kind = 'montage' and not exists (select 1 from public.video_captures c where c.id = v_montage and c.owner_id = public.current_composer_id()) then
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

create or replace function public.add_project_asset(p_project_id uuid, p jsonb, p_pin boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb; v_id uuid; v_existed boolean := false; v_msg uuid := nullif(p->>'fromMessageId', '')::uuid;
begin
  perform public.assert_project_role(p_project_id);
  v := public.check_project_asset(p_project_id, p);
  if v_msg is not null and not exists (select 1 from public.project_messages where id = v_msg and project_id = p_project_id) then
    raise exception 'Message introuvable dans ce Projet';
  end if;
  select id into v_id from public.project_assets where project_id = p_project_id and (
    (v->>'url' is not null and url = v->>'url') or (v->>'fileId' is not null and file_id = (v->>'fileId')::uuid)
    or (v->>'trackId' is not null and track_id = v->>'trackId') or (v->>'packId' is not null and pack_id = v->>'packId')
    or (v->>'albumId' is not null and album_id = v->>'albumId') or (v->>'montageId' is not null and montage_id = v->>'montageId'));
  if v_id is not null then
    v_existed := true;
  else
    insert into public.project_assets (project_id, kind, origin, title, body, url, file_id, track_id, pack_id, album_id, montage_id, from_message_id, created_by)
    values (p_project_id, v->>'kind', v->>'origin', left(coalesce(p->>'title', ''), 300), coalesce(p->>'body', ''), v->>'url',
            (v->>'fileId')::uuid, v->>'trackId', v->>'packId', v->>'albumId', v->>'montageId', v_msg, auth.uid())
    returning id into v_id;
    perform public.log_project_activity(p_project_id, 'asset_added', jsonb_build_object('kind', v->>'kind', 'title', coalesce(p->>'title', '')));
  end if;
  if p_pin then perform public.pin_project_asset(v_id, true); end if;
  update public.projects set updated_at = now() where id = p_project_id;
  return jsonb_build_object('id', v_id, 'existed', v_existed);
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
        'url', x.url, 'fileId', x.file_id, 'fileName', f.original_name, 'fileSize', f.size_bytes, 'mimeType', f.mime_type, 'trackId', x.track_id, 'packId', x.pack_id,
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
