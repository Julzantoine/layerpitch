-- LayerPitch — espace Projet, étape 1 (cadrage du 28/09, layerpitch-docs/2026-09-28-cadrage-reserve-projet-et-vitrines.md §2) :
-- la RÉSERVE de contenus unique d'un Projet et le Moodboard.
--
--   * project_assets — un objet par chose réelle dans le Projet (lien, image, audio, vidéo, document, note, morceau, pack,
--     album). origin = external (référence : lien YouTube, Spotify…) | own (ébauche, fichier maison) | layerpitch
--     (morceau, pack, album) : distinction référence / ébauche demandée par le cadrage du 11/09 §5.1. Pas de doublon :
--     le même lien, fichier, morceau ou pack ajouté deux fois renvoie l'objet existant. Un lien YouTube / Vimeo est un
--     objet VIDÉO, qu'il arrive par le Moodboard ou par l'onglet Vidéos (même objet, mêmes notes).
--   * project_moodboard_pins — ce qui est épinglé au Moodboard, dans son ordre ; starred = sélection ★ pour la
--     pré-vitrine (ex-in_pitch). « Retirer du Moodboard » enlève l'épingle, « Supprimer du Projet » supprime l'objet (Q2).
--   * project_annotations — les notes pointent vers l'OBJET (target_type 'asset') et le suivent dans toutes les sections ;
--     at_part = partie d'un morceau adaptatif (intro, segment…) à côté de at_seconds.
--   * project_snapshots — une version fige la liste des épingles (pas le contenu des objets).
--   * vitrine : ses entrées pointent vers des objets (le format lu par vitrine.html ne change pas).
--
-- Reprise de l'existant : project_items → objets + épingles (même ordre, ★ conservées), project_videos → objets vidéo,
-- notes, versions et vitrine re-pointées ; project_items et project_videos sont supprimées, ainsi que leurs fonctions.
-- Les sections Musique (project_shared_packs, project_albums : droits de partage / d'offre, D21) restent inchangées.

-- ---- La réserve ----
create table public.project_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('link', 'image', 'audio', 'video', 'file', 'note', 'track', 'pack', 'album')),
  origin text not null check (origin in ('external', 'own', 'layerpitch')),
  title text not null default '',
  body text not null default '',
  url text,
  file_id uuid references public.project_files(id) on delete cascade,
  track_id text references public.tracks(id) on delete cascade,
  pack_id text references public.packs(id) on delete cascade,
  album_id text references public.albums(id) on delete cascade,
  preview jsonb,
  from_message_id uuid references public.project_messages(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (case kind
    when 'link' then url is not null
    when 'video' then (file_id is not null) <> (url is not null)
    when 'image' then file_id is not null
    when 'audio' then file_id is not null
    when 'file' then file_id is not null
    when 'track' then track_id is not null
    when 'pack' then pack_id is not null
    when 'album' then album_id is not null
    else true end)
);
create index project_assets_project_idx on public.project_assets(project_id, created_at);
create unique index project_assets_url_uq on public.project_assets(project_id, url) where url is not null;
create unique index project_assets_file_uq on public.project_assets(project_id, file_id) where file_id is not null;
create unique index project_assets_track_uq on public.project_assets(project_id, track_id) where track_id is not null;
create unique index project_assets_pack_uq on public.project_assets(project_id, pack_id) where pack_id is not null;
create unique index project_assets_album_uq on public.project_assets(project_id, album_id) where album_id is not null;

create table public.project_moodboard_pins (
  project_id uuid not null references public.projects(id) on delete cascade,
  asset_id uuid not null references public.project_assets(id) on delete cascade,
  position int not null default 0,
  starred boolean not null default false,
  pinned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, asset_id)
);
create index project_moodboard_pins_idx on public.project_moodboard_pins(project_id, position);

-- Lien YouTube / Vimeo : les deux lecteurs dont la page sait lire l'instant courant (notes sur la timeline).
create or replace function public.project_video_url(p_url text)
returns boolean
language sql
immutable
as $$ select coalesce(p_url, '') ~* '^https://(www\.|m\.)?(youtube\.com/watch\?v=|youtu\.be/|vimeo\.com/)' $$;

-- ---- Reprise de l'existant ----
-- Correspondance ancien élément / ancienne vidéo -> objet, gardée le temps de la migration pour re-pointer les notes.
create table public._project_asset_map (old_type text, old_id uuid, asset_id uuid); -- supprimée en fin de migration

do $$
declare r record; v_id uuid; v_kind text; v_origin text;
begin
  -- Vidéos d'abord : un lien YouTube présent à la fois sur le tableau et dans Vidéos devient un seul objet vidéo.
  for r in select * from public.project_videos order by created_at loop
    select id into v_id from public.project_assets where project_id = r.project_id
      and ((r.kind = 'link' and url = r.url) or (r.kind = 'upload' and file_id = r.file_id));
    if v_id is null then
      insert into public.project_assets (project_id, kind, origin, title, url, file_id, created_by, created_at, updated_at)
      values (r.project_id, 'video', case when r.kind = 'link' then 'external' else 'own' end, r.title,
              case when r.kind = 'link' then r.url end, case when r.kind = 'upload' then r.file_id end, r.created_by, r.created_at, r.created_at)
      returning id into v_id;
    end if;
    insert into public._project_asset_map values ('video', r.id, v_id);
  end loop;

  for r in select * from public.project_items order by project_id, position loop
    v_kind := case when r.kind = 'link' and public.project_video_url(r.url) then 'video' else r.kind end;
    v_origin := case when r.kind in ('track', 'pack') then 'layerpitch' when r.kind = 'link' then 'external' else 'own' end;
    v_id := null;
    if r.url is not null then select id into v_id from public.project_assets where project_id = r.project_id and url = r.url;
    elsif r.file_id is not null then select id into v_id from public.project_assets where project_id = r.project_id and file_id = r.file_id;
    elsif r.track_id is not null then select id into v_id from public.project_assets where project_id = r.project_id and track_id = r.track_id;
    elsif r.pack_id is not null then select id into v_id from public.project_assets where project_id = r.project_id and pack_id = r.pack_id;
    end if;
    -- Élément dont le fichier, le morceau ou le pack a disparu (colonnes remises à NULL) : rien à reprendre.
    if v_id is null and ((r.kind in ('image', 'audio', 'file') and r.file_id is null) or (r.kind = 'track' and r.track_id is null)
                         or (r.kind = 'pack' and r.pack_id is null) or (r.kind = 'link' and r.url is null)) then
      continue;
    end if;
    if v_id is null then
      insert into public.project_assets (project_id, kind, origin, title, body, url, file_id, track_id, pack_id, created_by, created_at, updated_at)
      values (r.project_id, v_kind, v_origin, r.title, r.body, r.url, r.file_id, r.track_id, r.pack_id, r.created_by, r.created_at, r.updated_at)
      returning id into v_id;
    else
      -- Même chose des deux côtés : on garde le titre de la vidéo s'il existe, et le commentaire du tableau.
      update public.project_assets set title = case when title = '' then r.title else title end,
        body = case when body = '' then r.body else body end where id = v_id;
    end if;
    insert into public._project_asset_map values ('item', r.id, v_id);
    insert into public.project_moodboard_pins (project_id, asset_id, position, starred, pinned_by, created_at)
    values (r.project_id, v_id, r.position, r.in_pitch, r.created_by, r.created_at)
    on conflict (project_id, asset_id) do update set starred = public.project_moodboard_pins.starred or excluded.starred;
  end loop;
end $$;

-- ---- Notes : vers l'objet ----
alter table public.project_annotations add column at_part text check (at_part is null or length(at_part) <= 80);
alter table public.project_annotations drop constraint project_annotations_target_type_check;
update public.project_annotations a set target_type = 'asset', target_id = m.asset_id::text
  from public._project_asset_map m where a.target_type = m.old_type and a.target_id = m.old_id::text;
update public.project_annotations a set target_type = 'asset', target_id = x.id::text
  from public.project_assets x where a.target_type = 'track' and x.project_id = a.project_id and x.track_id = a.target_id;
delete from public.project_annotations where target_type in ('item', 'video', 'track'); -- cible disparue avant la migration
alter table public.project_annotations add constraint project_annotations_target_type_check check (target_type in ('asset', 'message', 'project'));

-- ---- Versions : la liste des épingles ----
alter table public.project_snapshots add column kind text not null default 'manual' check (kind in ('manual', 'auto'));
do $$
declare s record; e jsonb; v_id uuid; v_pins jsonb;
begin
  for s in select * from public.project_snapshots loop
    v_pins := '[]'::jsonb;
    for e in select * from jsonb_array_elements(s.data) loop
      v_id := null;
      select id into v_id from public.project_assets x where x.project_id = s.project_id and (
        (e->>'url' is not null and x.url = e->>'url') or (e->>'fileId' is not null and x.file_id::text = e->>'fileId')
        or (e->>'trackId' is not null and x.track_id = e->>'trackId') or (e->>'packId' is not null and x.pack_id = e->>'packId')
        or (e->>'kind' = 'note' and x.kind = 'note' and x.title = coalesce(e->>'title', '') and x.body = coalesce(e->>'body', '')))
        limit 1;
      -- Élément supprimé depuis la version : on le recrée dans la réserve (sinon revenir à la version le perdrait),
      -- sauf si son fichier, son morceau ou son pack n'existe plus.
      if v_id is null and (e->>'kind' in ('link', 'note')
          or (e->>'kind' in ('image', 'audio', 'file') and exists (select 1 from public.project_files where id::text = e->>'fileId'))
          or (e->>'kind' = 'track' and exists (select 1 from public.tracks where id = e->>'trackId'))
          or (e->>'kind' = 'pack' and exists (select 1 from public.packs where id = e->>'packId'))) then
        begin
          insert into public.project_assets (project_id, kind, origin, title, body, url, file_id, track_id, pack_id, created_by)
          values (s.project_id, case when e->>'kind' = 'link' and public.project_video_url(e->>'url') then 'video' else e->>'kind' end,
                  case when e->>'kind' in ('track', 'pack') then 'layerpitch' when e->>'kind' = 'link' then 'external' else 'own' end,
                  coalesce(e->>'title', ''), coalesce(e->>'body', ''), e->>'url', nullif(e->>'fileId', '')::uuid,
                  nullif(e->>'trackId', ''), nullif(e->>'packId', ''), s.created_by)
          returning id into v_id;
        exception when others then v_id := null;
        end;
      end if;
      if v_id is not null and not v_pins @> jsonb_build_array(jsonb_build_object('assetId', v_id)) then
        v_pins := v_pins || jsonb_build_array(jsonb_build_object('assetId', v_id, 'starred', coalesce((e->>'inPitch')::boolean, false)));
      end if;
    end loop;
    update public.project_snapshots set data = v_pins where id = s.id;
  end loop;
end $$;

-- ---- Vitrine : ses entrées pointent vers des objets ----
create table public.project_showcase_assets (
  project_id uuid not null references public.project_showcases(project_id) on delete cascade,
  asset_id uuid not null references public.project_assets(id) on delete cascade,
  position int not null default 0,
  primary key (project_id, asset_id)
);
insert into public.project_showcase_assets (project_id, asset_id, position)
select e.project_id, x.id, min(e.position)
from public.project_showcase_entries e
join public.project_assets x on x.project_id = e.project_id and (
  (e.kind = 'track' and x.track_id = e.ref_id)
  or (e.kind in ('video', 'image') and x.id = (select m.asset_id from public._project_asset_map m where m.old_id::text = e.ref_id and m.old_type = case e.kind when 'video' then 'video' else 'item' end)))
group by e.project_id, x.id;

-- ---- Fin des anciennes tables ----
drop function public.add_project_item(uuid, jsonb);
drop function public.update_project_item(uuid, jsonb);
drop function public.delete_project_item(uuid);
drop function public.reorder_project_items(uuid, uuid[]);
drop function public.check_project_item(uuid, jsonb);
drop function public.add_project_video(uuid, text, uuid, text, text);
drop function public.delete_project_video(uuid);
drop function public.add_project_annotation(uuid, text, text, numeric, text, uuid);
drop table public.project_showcase_entries;
drop table public.project_items;
drop table public.project_videos;
drop table public._project_asset_map;

-- ---- Objets : validation, ajout, modification, suppression ----
-- Renvoie les colonnes normalisées d'un nouvel objet (kind, origin, url, fileId, trackId, packId, albumId).
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
  v_origin text := p->>'origin';
  v_mime text;
begin
  if v_kind not in ('link', 'image', 'audio', 'video', 'file', 'note', 'track', 'pack', 'album') then raise exception 'Type d''objet inconnu'; end if;
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
  -- Album : seulement s'il est rattaché au Projet (par son vendeur, section Musique).
  if v_kind = 'album' and not exists (select 1 from public.project_albums a where a.project_id = p_project_id and a.album_id = v_album) then
    raise exception 'Album non rattaché à ce Projet';
  end if;
  v_origin := case when v_kind in ('track', 'pack', 'album') then 'layerpitch'
                   when v_kind in ('link') or (v_kind = 'video' and v_file is null) then 'external'
                   when v_origin in ('external', 'own') then v_origin else 'own' end;
  return jsonb_build_object('kind', v_kind, 'origin', v_origin,
    'url', case when v_kind in ('link', 'video') then v_url end,
    'fileId', case when v_kind in ('image', 'audio', 'file', 'video') then v_file end,
    'trackId', case when v_kind = 'track' then v_track end, 'packId', case when v_kind = 'pack' then v_pack end,
    'albumId', case when v_kind = 'album' then v_album end);
end;
$$;
revoke execute on function public.check_project_asset(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.check_project_asset(uuid, jsonb) to service_role;

-- p : { kind, url | fileId | trackId | packId | albumId, title, body, origin? } ; p_pin = l'épingler aussi au Moodboard.
-- Renvoie { id, existed } : existed = true quand la même chose était déjà dans le Projet (pas de doublon).
create or replace function public.add_project_asset(p_project_id uuid, p jsonb, p_pin boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb; v_id uuid; v_existed boolean := false;
begin
  perform public.assert_project_role(p_project_id);
  v := public.check_project_asset(p_project_id, p);
  select id into v_id from public.project_assets where project_id = p_project_id and (
    (v->>'url' is not null and url = v->>'url') or (v->>'fileId' is not null and file_id = (v->>'fileId')::uuid)
    or (v->>'trackId' is not null and track_id = v->>'trackId') or (v->>'packId' is not null and pack_id = v->>'packId')
    or (v->>'albumId' is not null and album_id = v->>'albumId'));
  if v_id is not null then
    v_existed := true;
  else
    insert into public.project_assets (project_id, kind, origin, title, body, url, file_id, track_id, pack_id, album_id, created_by)
    values (p_project_id, v->>'kind', v->>'origin', left(coalesce(p->>'title', ''), 300), coalesce(p->>'body', ''), v->>'url',
            (v->>'fileId')::uuid, v->>'trackId', v->>'packId', v->>'albumId', auth.uid())
    returning id into v_id;
    perform public.log_project_activity(p_project_id, 'asset_added', jsonb_build_object('kind', v->>'kind', 'title', coalesce(p->>'title', '')));
  end if;
  if p_pin then perform public.pin_project_asset(v_id, true); end if;
  update public.projects set updated_at = now() where id = p_project_id;
  return jsonb_build_object('id', v_id, 'existed', v_existed);
end;
$$;

-- Modification : titre et commentaire. (Changer la nature d'un objet = en créer un autre.)
create or replace function public.update_project_asset(p_asset_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_project uuid;
begin
  select project_id into v_project from public.project_assets where id = p_asset_id;
  if v_project is null then raise exception 'Objet introuvable'; end if;
  perform public.assert_project_role(v_project);
  update public.project_assets set
    title = case when p ? 'title' then left(coalesce(p->>'title', ''), 300) else title end,
    body = case when p ? 'body' then coalesce(p->>'body', '') else body end,
    updated_at = now()
  where id = p_asset_id;
  update public.projects set updated_at = now() where id = v_project;
end;
$$;

-- Supprimer du Projet : l'objet, ses épingles, ses notes, et son fichier envoyé (chemin rendu pour l'effacer du stockage).
-- Un morceau, un pack ou un album LayerPitch n'est jamais supprimé chez son auteur : le Projet n'en perd que le lien.
create or replace function public.delete_project_asset(p_asset_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_path text;
begin
  select * into r from public.project_assets where id = p_asset_id;
  if not found then raise exception 'Objet introuvable'; end if;
  perform public.assert_project_role(r.project_id);
  select path into v_path from public.project_files where id = r.file_id;
  delete from public.project_annotations where project_id = r.project_id and target_type = 'asset' and target_id = r.id::text;
  delete from public.project_assets where id = p_asset_id;
  if r.file_id is not null then delete from public.project_files where id = r.file_id; end if;
  perform public.log_project_activity(r.project_id, 'asset_removed', jsonb_build_object('kind', r.kind,
    'title', coalesce(nullif(r.title, ''), (select title from public.tracks where id = r.track_id), (select title from public.packs where id = r.pack_id), '')));
  return v_path;
end;
$$;

-- ---- Moodboard : épingler, ★, ordre ----
create or replace function public.pin_project_asset(p_asset_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select * into r from public.project_assets where id = p_asset_id;
  if not found then raise exception 'Objet introuvable'; end if;
  perform public.assert_project_role(r.project_id);
  if p_pinned then
    insert into public.project_moodboard_pins (project_id, asset_id, position, pinned_by)
    values (r.project_id, r.id, coalesce((select max(position) + 1 from public.project_moodboard_pins where project_id = r.project_id), 0), auth.uid())
    on conflict (project_id, asset_id) do nothing;
  else
    delete from public.project_moodboard_pins where project_id = r.project_id and asset_id = r.id;
  end if;
  update public.projects set updated_at = now() where id = r.project_id;
end;
$$;

create or replace function public.star_project_asset(p_asset_id uuid, p_starred boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_project uuid;
begin
  select project_id into v_project from public.project_moodboard_pins where asset_id = p_asset_id;
  if v_project is null then raise exception 'Objet absent du Moodboard'; end if;
  perform public.assert_project_role(v_project);
  update public.project_moodboard_pins set starred = coalesce(p_starred, false) where asset_id = p_asset_id and project_id = v_project;
end;
$$;

-- Nouvel ordre complet du Moodboard (tous les objets épinglés).
create or replace function public.reorder_moodboard(p_project_id uuid, p_asset_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare i int;
begin
  perform public.assert_project_role(p_project_id);
  if (select count(*) from public.project_moodboard_pins where project_id = p_project_id) <> coalesce(array_length(p_asset_ids, 1), 0)
     or exists (select 1 from unnest(p_asset_ids) x where not exists (select 1 from public.project_moodboard_pins where asset_id = x and project_id = p_project_id)) then
    raise exception 'Ordre incomplet : envoie tous les objets du Moodboard';
  end if;
  for i in 1 .. array_length(p_asset_ids, 1) loop
    update public.project_moodboard_pins set position = i - 1 where project_id = p_project_id and asset_id = p_asset_ids[i];
  end loop;
end;
$$;

-- ---- Notes (vers un objet, un message ou le Projet) ----
create or replace function public.add_project_annotation(p_project_id uuid, p_target_type text, p_target_id text, p_at_seconds numeric, p_body text,
  p_addressee uuid default null, p_at_part text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_ok boolean;
begin
  perform public.assert_project_role(p_project_id);
  if coalesce(trim(p_body), '') = '' then raise exception 'Annotation vide'; end if;
  v_ok := case p_target_type
    when 'asset' then exists (select 1 from public.project_assets where id::text = p_target_id and project_id = p_project_id)
    when 'message' then exists (select 1 from public.project_messages where id::text = p_target_id and project_id = p_project_id)
    when 'project' then true
    else false end;
  if not v_ok then raise exception 'Cible introuvable dans ce Projet'; end if;
  if p_addressee is not null and public.project_role(p_project_id, p_addressee) is null then
    raise exception 'Le destinataire ne fait pas partie du Projet';
  end if;
  insert into public.project_annotations (project_id, author_id, addressee_id, target_type, target_id, at_seconds, at_part, body)
  values (p_project_id, auth.uid(), p_addressee, p_target_type, nullif(p_target_id, ''), p_at_seconds, nullif(trim(coalesce(p_at_part, '')), ''), trim(p_body))
  returning id into v_id;
  -- Une note adressée prévient son destinataire (badge dans la page ; l'e-mail part de la page, voir project-notify).
  if p_addressee is not null and p_addressee <> auth.uid() then
    insert into public.project_notifications (profile_id, project_id, kind, payload)
    values (p_addressee, p_project_id, 'annotation', jsonb_build_object('annotationId', v_id, 'targetType', p_target_type, 'targetId', p_target_id,
      'atSeconds', p_at_seconds, 'atPart', p_at_part, 'excerpt', left(trim(p_body), 140), 'authorEmail', (select email from auth.users where id = auth.uid())));
  end if;
  perform public.log_project_activity(p_project_id, 'annotation_added', jsonb_build_object('targetType', p_target_type));
  return v_id;
end;
$$;

create or replace function public.list_project_annotations(p_project_id uuid, p_target_type text default null, p_target_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_role(p_project_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'targetType', a.target_type, 'targetId', a.target_id,
      'atSeconds', a.at_seconds, 'atPart', a.at_part, 'body', a.body, 'resolved', a.resolved_at is not null, 'createdAt', a.created_at,
      'authorEmail', (select u.email from auth.users u where u.id = a.author_id), 'mine', a.author_id = auth.uid(),
      'addresseeId', a.addressee_id, 'addresseeEmail', (select u.email from auth.users u where u.id = a.addressee_id))
      order by a.at_seconds nulls last, a.created_at), '[]'::jsonb)
    from public.project_annotations a
    where a.project_id = p_project_id
      and (p_target_type is null or a.target_type = p_target_type)
      and (p_target_id is null or a.target_id = p_target_id));
end;
$$;

-- ---- Contenu complet d'un Projet (une lecture pour la page) ----
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
        'url', x.url, 'fileId', x.file_id, 'fileName', f.original_name, 'mimeType', f.mime_type, 'trackId', x.track_id, 'packId', x.pack_id,
        'albumId', x.album_id, 'trackTitle', t.title, 'packTitle', k.title, 'albumTitle', al.title, 'preview', x.preview,
        'createdAt', x.created_at, 'authorEmail', (select u.email from auth.users u where u.id = x.created_by),
        'pinned', pin.asset_id is not null, 'starred', coalesce(pin.starred, false),
        'notes', (select count(*) from public.project_annotations a where a.target_type = 'asset' and a.target_id = x.id::text))
        order by x.created_at), '[]'::jsonb)
      from public.project_assets x
      left join public.project_files f on f.id = x.file_id left join public.tracks t on t.id = x.track_id
      left join public.packs k on k.id = x.pack_id left join public.albums al on al.id = x.album_id
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
    'openAnnotations', (select count(*) from public.project_annotations where project_id = p_project_id and resolved_at is null)
  );
end;
$$;

-- ---- Versions du Moodboard : la liste des épingles ----
create or replace function public.create_project_snapshot(p_project_id uuid, p_label text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public.assert_project_role(p_project_id);
  if (select count(*) from public.project_snapshots where project_id = p_project_id and kind = 'manual') >= 100 then
    raise exception 'Limite de 100 versions par Projet : supprime les plus anciennes';
  end if;
  insert into public.project_snapshots (project_id, label, kind, data, created_by)
  values (p_project_id, coalesce(nullif(trim(p_label), ''), to_char(now(), 'DD/MM/YYYY HH24:MI')), 'manual',
          (select coalesce(jsonb_agg(jsonb_build_object('assetId', asset_id, 'starred', starred) order by position, created_at), '[]'::jsonb)
           from public.project_moodboard_pins where project_id = p_project_id), auth.uid())
  returning id into v_id;
  perform public.log_project_activity(p_project_id, 'snapshot_created', jsonb_build_object('label', p_label));
  return v_id;
end;
$$;

create or replace function public.list_project_snapshots(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_role(p_project_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label, 'kind', s.kind, 'createdAt', s.created_at, 'count', jsonb_array_length(s.data),
      'authorEmail', (select u.email from auth.users u where u.id = s.created_by)) order by s.created_at desc), '[]'::jsonb)
    from public.project_snapshots s where s.project_id = p_project_id);
end;
$$;

-- Revenir à une version : le Moodboard actuel est d'abord figé (« avant retour à … »), puis ses épingles remplacées. Les
-- objets supprimés du Projet depuis sont ignorés ; aucun objet n'est supprimé (ils restent dans la réserve).
create or replace function public.restore_project_snapshot(p_snapshot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record; e jsonb; i int := 0;
begin
  select * into r from public.project_snapshots where id = p_snapshot_id;
  if not found then raise exception 'Version introuvable'; end if;
  perform public.assert_project_role(r.project_id);
  perform public.create_project_snapshot(r.project_id, 'Avant retour à « ' || r.label || ' »');
  delete from public.project_moodboard_pins where project_id = r.project_id;
  for e in select * from jsonb_array_elements(r.data) loop
    if not exists (select 1 from public.project_assets where id = (e->>'assetId')::uuid and project_id = r.project_id) then continue; end if;
    insert into public.project_moodboard_pins (project_id, asset_id, position, starred, pinned_by)
    values (r.project_id, (e->>'assetId')::uuid, i, coalesce((e->>'starred')::boolean, false), auth.uid())
    on conflict do nothing;
    i := i + 1;
  end loop;
  perform public.log_project_activity(r.project_id, 'snapshot_restored', jsonb_build_object('label', r.label));
end;
$$;

-- ---- Vitrine (format lu par vitrine.html inchangé) ----
-- Un objet peut-il être public ? Morceau, image, vidéo YouTube / Vimeo (une vidéo ENVOYÉE reste privée).
create or replace function public.project_asset_publishable(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.project_assets x where x.id = p_asset_id
    and (x.kind in ('track', 'image') or (x.kind = 'video' and x.url is not null)));
$$;

-- entries : [{ assetId }] — objets du Projet publiables (voir project_asset_publishable).
create or replace function public.save_project_showcase(p_project_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare e jsonb; i int := 0; v_asset uuid;
begin
  perform public.assert_project_role(p_project_id, true);
  if coalesce(p->>'steamUrl', '') <> '' and p->>'steamUrl' !~* '^https://' then raise exception 'Lien Steam invalide'; end if;
  insert into public.project_showcases (project_id, published, title, intro, steam_url, updated_at)
  values (p_project_id, coalesce((p->>'published')::boolean, false), coalesce(p->>'title', ''), coalesce(p->>'intro', ''), nullif(p->>'steamUrl', ''), now())
  on conflict (project_id) do update set published = excluded.published, title = excluded.title, intro = excluded.intro,
    steam_url = excluded.steam_url, updated_at = now();
  delete from public.project_showcase_assets where project_id = p_project_id;
  for e in select * from jsonb_array_elements(coalesce(p->'entries', '[]'::jsonb)) loop
    v_asset := nullif(e->>'assetId', '')::uuid;
    if v_asset is null or not exists (select 1 from public.project_assets where id = v_asset and project_id = p_project_id)
       or not public.project_asset_publishable(v_asset) then
      raise exception 'Élément de vitrine introuvable dans le Projet, ou privé';
    end if;
    insert into public.project_showcase_assets (project_id, asset_id, position) values (p_project_id, v_asset, i) on conflict do nothing;
    i := i + 1;
  end loop;
  perform public.log_project_activity(p_project_id, 'showcase_saved', jsonb_build_object('published', coalesce((p->>'published')::boolean, false)));
end;
$$;

-- Lecture PUBLIQUE (sans compte) d'une vitrine publiée. entries : { kind: track | video | image, refId, assetId, title, url, fileId }.
create or replace function public.get_project_showcase(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when s.project_id is null or (not s.published and public.project_role(s.project_id, auth.uid()) is null) then null
  else jsonb_build_object('projectId', s.project_id, 'published', s.published, 'title', s.title, 'intro', s.intro, 'steamUrl', s.steam_url,
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'assetId', x.id,
        'refId', case x.kind when 'track' then x.track_id else x.id::text end,
        'title', case when x.kind = 'track' then (select title from public.tracks where id = x.track_id) else x.title end,
        'url', case x.kind when 'video' then x.url end,
        'fileId', case x.kind when 'image' then x.file_id end)
      order by e.position), '[]'::jsonb)
      from public.project_showcase_assets e join public.project_assets x on x.id = e.asset_id
      where e.project_id = s.project_id and public.project_asset_publishable(x.id)))
  end
  from (select 1) one left join public.project_showcases s on s.project_id = p_project_id;
$$;

-- Une image fait-elle partie d'une vitrine PUBLIÉE ? (lecture publique de ce seul fichier, Edge Function project-file-url)
create or replace function public.project_file_is_public(p_file_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select f.path from public.project_files f
  join public.project_assets x on x.file_id = f.id and x.kind = 'image'
  join public.project_showcase_assets e on e.asset_id = x.id
  join public.project_showcases s on s.project_id = e.project_id and s.published
  where f.id = p_file_id and f.status = 'ready' limit 1;
$$;

alter table public.project_assets enable row level security;
alter table public.project_moodboard_pins enable row level security;
alter table public.project_showcase_assets enable row level security;

revoke execute on function public.add_project_asset(uuid, jsonb, boolean), public.update_project_asset(uuid, jsonb), public.delete_project_asset(uuid),
  public.pin_project_asset(uuid, boolean), public.star_project_asset(uuid, boolean), public.reorder_moodboard(uuid, uuid[]),
  public.add_project_annotation(uuid, text, text, numeric, text, uuid, text) from public, anon;
grant execute on function public.add_project_asset(uuid, jsonb, boolean), public.update_project_asset(uuid, jsonb), public.delete_project_asset(uuid),
  public.pin_project_asset(uuid, boolean), public.star_project_asset(uuid, boolean), public.reorder_moodboard(uuid, uuid[]),
  public.add_project_annotation(uuid, text, text, numeric, text, uuid, text) to authenticated;
revoke execute on function public.project_asset_publishable(uuid) from public, anon, authenticated;
grant execute on function public.project_asset_publishable(uuid) to service_role;
