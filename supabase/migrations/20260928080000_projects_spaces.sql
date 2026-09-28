-- LayerPitch — chantier profils et permissions, étape 5c (28 septembre) : les espaces d'un Projet (D36 : tout le cadrage
-- du 11/09 + annotations sur la timeline d'une vidéo, façon SoundCloud ; D21 : packs amenés par un compositeur invité ;
-- D38 : le tableau accepte tout contenu, morceaux adaptatifs compris). Socle (projets, membres, rôle, fichiers) :
-- 20260928070000.
--
--   * project_items — le tableau de préproduction (« Moodboard » : nom provisoire, jugé réducteur) : liens (YouTube,
--     Spotify…), images, ébauches audio, documents, notes, morceaux et packs LayerPitch. Coexistence (D35) : un morceau
--     ou un pack n'y entre que par son propriétaire (ou un pack déjà partagé dans le Projet) ; le Projet n'en garde qu'un
--     lien. in_pitch = sélection pour la « pré-vitrine » destinée aux éditeurs (11/09 §5.1, §7).
--   * project_videos — captures de gameplay envoyées (fichier du Projet) ou liens YouTube/Vimeo.
--   * project_annotations — note adressée (ou non) à un membre, accrochée à un élément, une vidéo, un message, un
--     morceau ; at_seconds = instant précis sur la timeline (vidéo ou audio) ; résolue / non résolue ; notification au
--     destinataire.
--   * project_shared_packs — pack amené par son compositeur : « partager » (écoute, essai sur vidéo, achat ou crédits
--     depuis le Projet) ou « offrir » (acquis par le studio propriétaire du Projet : achat à 0 €, tracé, source 'gift').
--   * project_albums — album rattaché au Projet par son vendeur (l'album garde sa vie propre : 11/09 §5.2).
--   * project_snapshots — versions du tableau (figer avant une modification risquée, revenir en arrière : 11/09 §6.2).
--   * project_showcase / project_showcase_entries — la VITRINE (11/09 §5.3) : page publique pour les joueurs (lien depuis
--     Steam), sans connexion (règle « pages publiques jamais verrouillées »), publiée par un administrateur du Projet.

alter table public.pack_purchases add column source text not null default 'stripe' check (source in ('stripe', 'gift'));
comment on column public.pack_purchases.source is 'stripe = achat payé ; gift = pack offert par son compositeur dans un Projet (D21, achat à 0 €, sans facture).';

-- ---- Tableau de préproduction ----
create table public.project_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('link', 'image', 'audio', 'file', 'note', 'track', 'pack')),
  title text not null default '',
  body text not null default '',
  url text,
  file_id uuid references public.project_files(id) on delete set null,
  track_id text references public.tracks(id) on delete set null,
  pack_id text references public.packs(id) on delete set null,
  position int not null default 0,
  in_pitch boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index project_items_idx on public.project_items(project_id, position);

-- Validation commune d'un élément (création et modification). Renvoie les colonnes normalisées.
create or replace function public.check_project_item(p_project_id uuid, p jsonb)
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
  v_mime text;
begin
  if v_kind not in ('link', 'image', 'audio', 'file', 'note', 'track', 'pack') then raise exception 'Type d''élément inconnu'; end if;
  if v_kind = 'link' and (v_url is null or v_url !~* '^https?://') then raise exception 'Lien invalide (http:// ou https://)'; end if;
  if v_kind in ('image', 'audio', 'file') then
    select mime_type into v_mime from public.project_files where id = v_file and project_id = p_project_id;
    if v_mime is null then raise exception 'Fichier introuvable dans ce Projet'; end if;
    if v_kind = 'image' and v_mime not like 'image/%' then raise exception 'Ce fichier n''est pas une image'; end if;
    if v_kind = 'audio' and v_mime not like 'audio/%' then raise exception 'Ce fichier n''est pas un fichier audio'; end if;
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
  return jsonb_build_object('kind', v_kind, 'url', case when v_kind = 'link' then v_url end,
    'fileId', case when v_kind in ('image', 'audio', 'file') then v_file end,
    'trackId', case when v_kind = 'track' then v_track end, 'packId', case when v_kind = 'pack' then v_pack end);
end;
$$;
revoke execute on function public.check_project_item(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.check_project_item(uuid, jsonb) to service_role;

create or replace function public.add_project_item(p_project_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb; v_id uuid;
begin
  perform public.assert_project_role(p_project_id);
  v := public.check_project_item(p_project_id, p);
  insert into public.project_items (project_id, kind, title, body, url, file_id, track_id, pack_id, position, created_by)
  values (p_project_id, v->>'kind', coalesce(p->>'title', ''), coalesce(p->>'body', ''), v->>'url', (v->>'fileId')::uuid,
          v->>'trackId', v->>'packId', coalesce((select max(position) + 1 from public.project_items where project_id = p_project_id), 0), auth.uid())
  returning id into v_id;
  perform public.log_project_activity(p_project_id, 'item_added', jsonb_build_object('kind', v->>'kind', 'title', coalesce(p->>'title', '')));
  return v_id;
end;
$$;

-- Modification : titre, texte, sélection pour la pré-vitrine. (Changer la nature d'un élément = en créer un autre.)
create or replace function public.update_project_item(p_item_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_project uuid;
begin
  select project_id into v_project from public.project_items where id = p_item_id;
  if v_project is null then raise exception 'Élément introuvable'; end if;
  perform public.assert_project_role(v_project);
  update public.project_items set
    title = case when p ? 'title' then coalesce(p->>'title', '') else title end,
    body = case when p ? 'body' then coalesce(p->>'body', '') else body end,
    in_pitch = case when p ? 'inPitch' then coalesce((p->>'inPitch')::boolean, false) else in_pitch end,
    updated_at = now()
  where id = p_item_id;
  update public.projects set updated_at = now() where id = v_project;
end;
$$;

create or replace function public.delete_project_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select * into r from public.project_items where id = p_item_id;
  if not found then raise exception 'Élément introuvable'; end if;
  perform public.assert_project_role(r.project_id);
  delete from public.project_items where id = p_item_id;
  perform public.log_project_activity(r.project_id, 'item_removed', jsonb_build_object('kind', r.kind, 'title', r.title));
end;
$$;

-- Nouvel ordre complet (liste de tous les ids du tableau).
create or replace function public.reorder_project_items(p_project_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare i int;
begin
  perform public.assert_project_role(p_project_id);
  if (select count(*) from public.project_items where project_id = p_project_id) <> coalesce(array_length(p_ids, 1), 0)
     or exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.project_items where id = x and project_id = p_project_id)) then
    raise exception 'Ordre incomplet : envoie tous les éléments du tableau';
  end if;
  for i in 1 .. array_length(p_ids, 1) loop
    update public.project_items set position = i - 1 where id = p_ids[i];
  end loop;
end;
$$;

-- ---- Vidéos ----
create table public.project_videos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('upload', 'link')),
  file_id uuid references public.project_files(id) on delete cascade,
  url text,
  title text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'upload' and file_id is not null) or (kind = 'link' and url is not null))
);
create index project_videos_idx on public.project_videos(project_id, created_at);

create or replace function public.add_project_video(p_project_id uuid, p_kind text, p_file_id uuid, p_url text, p_title text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_mime text;
begin
  perform public.assert_project_role(p_project_id);
  if p_kind = 'upload' then
    select mime_type into v_mime from public.project_files where id = p_file_id and project_id = p_project_id;
    if v_mime is null or v_mime not like 'video/%' then raise exception 'Vidéo introuvable dans ce Projet'; end if;
  elsif p_kind = 'link' then
    -- Lien YouTube ou Vimeo seulement : ce sont les deux lecteurs dont la page sait lire l'instant courant (annotations).
    if coalesce(p_url, '') !~* '^https://(www\.)?(youtube\.com/watch\?v=|youtu\.be/|vimeo\.com/)' then
      raise exception 'Lien YouTube ou Vimeo attendu';
    end if;
  else raise exception 'Type de vidéo inconnu'; end if;
  insert into public.project_videos (project_id, kind, file_id, url, title, created_by)
  values (p_project_id, p_kind, case when p_kind = 'upload' then p_file_id end, case when p_kind = 'link' then p_url end, coalesce(p_title, ''), auth.uid())
  returning id into v_id;
  perform public.log_project_activity(p_project_id, 'video_added', jsonb_build_object('title', coalesce(p_title, '')));
  return v_id;
end;
$$;

create or replace function public.delete_project_video(p_video_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_path text;
begin
  select * into r from public.project_videos where id = p_video_id;
  if not found then raise exception 'Vidéo introuvable'; end if;
  perform public.assert_project_role(r.project_id);
  select path into v_path from public.project_files where id = r.file_id;
  delete from public.project_videos where id = p_video_id;
  delete from public.project_files where id = r.file_id;
  perform public.log_project_activity(r.project_id, 'video_removed', jsonb_build_object('title', r.title));
  return v_path; -- fichier à effacer du stockage (NULL pour un lien)
end;
$$;

-- ---- Annotations (adressées, résolues, sur la timeline) ----
create table public.project_annotations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  addressee_id uuid references public.profiles(id) on delete set null,
  target_type text not null check (target_type in ('item', 'video', 'message', 'track', 'project')),
  target_id text,
  at_seconds numeric check (at_seconds is null or at_seconds >= 0),
  body text not null check (length(body) between 1 and 4000),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index project_annotations_idx on public.project_annotations(project_id, target_type, target_id);

create or replace function public.add_project_annotation(p_project_id uuid, p_target_type text, p_target_id text, p_at_seconds numeric, p_body text, p_addressee uuid default null)
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
    when 'item' then exists (select 1 from public.project_items where id::text = p_target_id and project_id = p_project_id)
    when 'video' then exists (select 1 from public.project_videos where id::text = p_target_id and project_id = p_project_id)
    when 'message' then exists (select 1 from public.project_messages where id::text = p_target_id and project_id = p_project_id)
    when 'track' then exists (select 1 from public.project_items where project_id = p_project_id and track_id = p_target_id)
    when 'project' then true
    else false end;
  if not v_ok then raise exception 'Cible introuvable dans ce Projet'; end if;
  if p_addressee is not null and public.project_role(p_project_id, p_addressee) is null then
    raise exception 'Le destinataire ne fait pas partie du Projet';
  end if;
  insert into public.project_annotations (project_id, author_id, addressee_id, target_type, target_id, at_seconds, body)
  values (p_project_id, auth.uid(), p_addressee, p_target_type, nullif(p_target_id, ''), p_at_seconds, trim(p_body))
  returning id into v_id;
  -- Une note adressée prévient son destinataire (badge dans la page ; l'e-mail part de la page, voir notify-project).
  if p_addressee is not null and p_addressee <> auth.uid() then
    insert into public.project_notifications (profile_id, project_id, kind, payload)
    values (p_addressee, p_project_id, 'annotation', jsonb_build_object('annotationId', v_id, 'targetType', p_target_type, 'targetId', p_target_id,
      'atSeconds', p_at_seconds, 'excerpt', left(trim(p_body), 140), 'authorEmail', (select email from auth.users where id = auth.uid())));
  end if;
  perform public.log_project_activity(p_project_id, 'annotation_added', jsonb_build_object('targetType', p_target_type));
  return v_id;
end;
$$;

create or replace function public.resolve_project_annotation(p_annotation_id uuid, p_resolved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_project uuid;
begin
  select project_id into v_project from public.project_annotations where id = p_annotation_id;
  if v_project is null then raise exception 'Annotation introuvable'; end if;
  perform public.assert_project_role(v_project);
  update public.project_annotations set resolved_at = case when p_resolved then now() end, resolved_by = case when p_resolved then auth.uid() end
   where id = p_annotation_id;
end;
$$;

create or replace function public.delete_project_annotation(p_annotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select * into r from public.project_annotations where id = p_annotation_id;
  if not found or not (coalesce(r.author_id = auth.uid(), false) or public.project_role(r.project_id, auth.uid()) = 'admin') then
    raise exception 'Annotation introuvable';
  end if;
  delete from public.project_annotations where id = p_annotation_id;
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
      'atSeconds', a.at_seconds, 'body', a.body, 'resolved', a.resolved_at is not null, 'createdAt', a.created_at,
      'authorEmail', (select u.email from auth.users u where u.id = a.author_id), 'mine', a.author_id = auth.uid(),
      'addresseeId', a.addressee_id, 'addresseeEmail', (select u.email from auth.users u where u.id = a.addressee_id))
      order by a.at_seconds nulls last, a.created_at), '[]'::jsonb)
    from public.project_annotations a
    where a.project_id = p_project_id
      and (p_target_type is null or a.target_type = p_target_type)
      and (p_target_id is null or a.target_id = p_target_id));
end;
$$;

-- ---- Packs amenés par un compositeur (D21) ----
create table public.project_shared_packs (
  project_id uuid not null references public.projects(id) on delete cascade,
  pack_id text not null references public.packs(id) on delete cascade,
  shared_by uuid references public.profiles(id) on delete set null,
  mode text not null check (mode in ('share', 'offer')),
  created_at timestamptz not null default now(),
  primary key (project_id, pack_id)
);

create or replace function public.share_pack_in_project(p_project_id uuid, p_pack_id text, p_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare p record; v_beneficiary uuid;
begin
  perform public.assert_project_role(p_project_id);
  if p_mode not in ('share', 'offer') then raise exception 'Mode attendu : share ou offer'; end if;
  if not exists (select 1 from public.packs where id = p_pack_id and owner_id = public.current_composer_id()) then
    raise exception 'Tu ne peux amener que tes propres packs';
  end if;
  select * into p from public.projects where id = p_project_id;
  if p_mode = 'offer' then
    -- Offert au STUDIO propriétaire du Projet : acquis par le studio (compte propriétaire), pas par une personne.
    if p.owner_kind <> 'studio' then raise exception 'On n''offre un pack qu''au studio propriétaire d''un Projet'; end if;
    select profile_id into v_beneficiary from public.studio_profiles where id = p.owner_studio_id;
    if not exists (select 1 from public.pack_purchases where studio_id = v_beneficiary and pack_id = p_pack_id) then
      insert into public.pack_purchases (studio_id, pack_id, price_paid, source) values (v_beneficiary, p_pack_id, 0, 'gift');
    end if;
  end if;
  insert into public.project_shared_packs (project_id, pack_id, shared_by, mode) values (p_project_id, p_pack_id, auth.uid(), p_mode)
  on conflict (project_id, pack_id) do update set mode = case when public.project_shared_packs.mode = 'offer' then 'offer' else excluded.mode end;
  perform public.log_project_activity(p_project_id, case p_mode when 'offer' then 'pack_offered' else 'pack_shared' end,
    jsonb_build_object('packId', p_pack_id, 'title', (select title from public.packs where id = p_pack_id)));
end;
$$;

-- Retirer un pack PARTAGÉ (un pack offert reste acquis par le studio : on ne reprend pas un cadeau).
create or replace function public.unshare_pack_from_project(p_project_id uuid, p_pack_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  perform public.assert_project_role(p_project_id);
  select * into r from public.project_shared_packs where project_id = p_project_id and pack_id = p_pack_id;
  if not found then raise exception 'Pack introuvable dans ce Projet'; end if;
  if not (coalesce(r.shared_by = auth.uid(), false) or public.project_role(p_project_id, auth.uid()) = 'admin') then
    raise exception 'Seul le compositeur qui l''a partagé ou l''administrateur du Projet peut le retirer';
  end if;
  delete from public.project_shared_packs where project_id = p_project_id and pack_id = p_pack_id;
end;
$$;

-- ---- Albums rattachés ----
create table public.project_albums (
  project_id uuid not null references public.projects(id) on delete cascade,
  album_id text not null references public.albums(id) on delete cascade,
  linked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, album_id)
);

create or replace function public.link_album_to_project(p_project_id uuid, p_album_id text, p_linked boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_project_role(p_project_id);
  if not exists (select 1 from public.albums where id = p_album_id and seller_id = auth.uid()) then
    raise exception 'Seul le vendeur de l''album peut le rattacher';
  end if;
  if p_linked then
    insert into public.project_albums (project_id, album_id, linked_by) values (p_project_id, p_album_id, auth.uid()) on conflict do nothing;
  else
    delete from public.project_albums where project_id = p_project_id and album_id = p_album_id;
  end if;
  perform public.log_project_activity(p_project_id, case when p_linked then 'album_linked' else 'album_unlinked' end, jsonb_build_object('albumId', p_album_id));
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
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'title', i.title, 'body', i.body, 'url', i.url,
        'fileId', i.file_id, 'fileName', f.original_name, 'mimeType', f.mime_type, 'trackId', i.track_id, 'packId', i.pack_id,
        'trackTitle', t.title, 'packTitle', k.title, 'inPitch', i.in_pitch, 'createdAt', i.created_at,
        'authorEmail', (select u.email from auth.users u where u.id = i.created_by)) order by i.position), '[]'::jsonb)
      from public.project_items i left join public.project_files f on f.id = i.file_id
      left join public.tracks t on t.id = i.track_id left join public.packs k on k.id = i.pack_id where i.project_id = p_project_id),
    'videos', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'kind', v.kind, 'fileId', v.file_id, 'url', v.url, 'title', v.title,
        'createdAt', v.created_at, 'annotations', (select count(*) from public.project_annotations a where a.target_type = 'video' and a.target_id = v.id::text))
        order by v.created_at), '[]'::jsonb) from public.project_videos v where v.project_id = p_project_id),
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

-- ---- Versions du tableau (11/09 §6.2) ----
create table public.project_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  label text not null default '',
  data jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.create_project_snapshot(p_project_id uuid, p_label text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public.assert_project_role(p_project_id);
  if (select count(*) from public.project_snapshots where project_id = p_project_id) >= 100 then
    raise exception 'Limite de 100 versions par Projet : supprime les plus anciennes';
  end if;
  insert into public.project_snapshots (project_id, label, data, created_by)
  values (p_project_id, coalesce(nullif(trim(p_label), ''), to_char(now(), 'DD/MM/YYYY HH24:MI')),
          (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'title', title, 'body', body, 'url', url, 'fileId', file_id,
             'trackId', track_id, 'packId', pack_id, 'inPitch', in_pitch) order by position), '[]'::jsonb)
           from public.project_items where project_id = p_project_id), auth.uid())
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
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label, 'createdAt', s.created_at, 'count', jsonb_array_length(s.data),
      'authorEmail', (select u.email from auth.users u where u.id = s.created_by)) order by s.created_at desc), '[]'::jsonb)
    from public.project_snapshots s where s.project_id = p_project_id);
end;
$$;

-- Revenir à une version : le tableau actuel est d'abord figé (« avant retour à … »), puis remplacé. Les éléments dont le
-- fichier, le morceau ou le pack n'existe plus sont ignorés.
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
  delete from public.project_items where project_id = r.project_id;
  for e in select * from jsonb_array_elements(r.data) loop
    if (e->>'kind' in ('image', 'audio', 'file') and not exists (select 1 from public.project_files where id = (e->>'fileId')::uuid))
       or (e->>'kind' = 'track' and not exists (select 1 from public.tracks where id = e->>'trackId'))
       or (e->>'kind' = 'pack' and not exists (select 1 from public.packs where id = e->>'packId')) then
      continue;
    end if;
    insert into public.project_items (project_id, kind, title, body, url, file_id, track_id, pack_id, in_pitch, position, created_by)
    values (r.project_id, e->>'kind', coalesce(e->>'title', ''), coalesce(e->>'body', ''), e->>'url', nullif(e->>'fileId', '')::uuid,
            nullif(e->>'trackId', ''), nullif(e->>'packId', ''), coalesce((e->>'inPitch')::boolean, false), i, auth.uid());
    i := i + 1;
  end loop;
  perform public.log_project_activity(r.project_id, 'snapshot_restored', jsonb_build_object('label', r.label));
end;
$$;

-- ---- Vitrine publique (11/09 §5.3) ----
create table public.project_showcases (
  project_id uuid primary key references public.projects(id) on delete cascade,
  published boolean not null default false,
  title text not null default '',
  intro text not null default '',
  steam_url text,
  updated_at timestamptz not null default now()
);
create table public.project_showcase_entries (
  project_id uuid not null references public.project_showcases(project_id) on delete cascade,
  kind text not null check (kind in ('track', 'video', 'image')),
  ref_id text not null,
  position int not null default 0,
  primary key (project_id, kind, ref_id)
);

-- entries : [{ kind: 'track' | 'video' | 'image', refId }] — uniquement des éléments du Projet : morceau présent sur le
-- tableau, vidéo du Projet (lien YouTube/Vimeo : un fichier envoyé reste privé), image du tableau.
create or replace function public.save_project_showcase(p_project_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare e jsonb; i int := 0;
begin
  perform public.assert_project_role(p_project_id, true);
  if coalesce(p->>'steamUrl', '') <> '' and p->>'steamUrl' !~* '^https://' then raise exception 'Lien Steam invalide'; end if;
  insert into public.project_showcases (project_id, published, title, intro, steam_url, updated_at)
  values (p_project_id, coalesce((p->>'published')::boolean, false), coalesce(p->>'title', ''), coalesce(p->>'intro', ''), nullif(p->>'steamUrl', ''), now())
  on conflict (project_id) do update set published = excluded.published, title = excluded.title, intro = excluded.intro,
    steam_url = excluded.steam_url, updated_at = now();
  delete from public.project_showcase_entries where project_id = p_project_id;
  for e in select * from jsonb_array_elements(coalesce(p->'entries', '[]'::jsonb)) loop
    if not (case e->>'kind'
      when 'track' then exists (select 1 from public.project_items where project_id = p_project_id and track_id = e->>'refId')
      when 'video' then exists (select 1 from public.project_videos where project_id = p_project_id and id::text = e->>'refId' and kind = 'link')
      when 'image' then exists (select 1 from public.project_items where project_id = p_project_id and id::text = e->>'refId' and kind = 'image')
      else false end) then
      raise exception 'Élément de vitrine introuvable dans le Projet (%)', e->>'kind';
    end if;
    insert into public.project_showcase_entries (project_id, kind, ref_id, position) values (p_project_id, e->>'kind', e->>'refId', i)
    on conflict do nothing;
    i := i + 1;
  end loop;
  perform public.log_project_activity(p_project_id, 'showcase_saved', jsonb_build_object('published', coalesce((p->>'published')::boolean, false)));
end;
$$;

-- Lecture PUBLIQUE (sans compte) d'une vitrine publiée. Les images sont servies par get-project-file-url (lecture signée),
-- qui accepte une image publiée dans une vitrine publique.
create or replace function public.get_project_showcase(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when s.project_id is null or (not s.published and public.project_role(s.project_id, auth.uid()) is null) then null
  else jsonb_build_object('projectId', s.project_id, 'published', s.published, 'title', s.title, 'intro', s.intro, 'steamUrl', s.steam_url,
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'refId', e.ref_id,
        'title', case e.kind when 'track' then (select title from public.tracks where id = e.ref_id)
                             when 'video' then (select title from public.project_videos where id::text = e.ref_id)
                             else (select title from public.project_items where id::text = e.ref_id) end,
        'url', case e.kind when 'video' then (select url from public.project_videos where id::text = e.ref_id) end,
        'fileId', case e.kind when 'image' then (select file_id from public.project_items where id::text = e.ref_id) end)
      order by e.position), '[]'::jsonb) from public.project_showcase_entries e where e.project_id = s.project_id))
  end
  from (select 1) one left join public.project_showcases s on s.project_id = p_project_id;
$$;

-- Une image fait-elle partie d'une vitrine PUBLIÉE ? (lecture publique de ce seul fichier)
create or replace function public.project_file_is_public(p_file_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select f.path from public.project_files f
  join public.project_items i on i.file_id = f.id and i.kind = 'image'
  join public.project_showcase_entries e on e.kind = 'image' and e.ref_id = i.id::text
  join public.project_showcases s on s.project_id = e.project_id and s.published
  where f.id = p_file_id and f.status = 'ready' limit 1;
$$;

alter table public.project_items enable row level security;
alter table public.project_videos enable row level security;
alter table public.project_annotations enable row level security;
alter table public.project_shared_packs enable row level security;
alter table public.project_albums enable row level security;
alter table public.project_snapshots enable row level security;
alter table public.project_showcases enable row level security;
alter table public.project_showcase_entries enable row level security;

revoke execute on function public.add_project_item(uuid, jsonb), public.update_project_item(uuid, jsonb), public.delete_project_item(uuid),
  public.reorder_project_items(uuid, uuid[]), public.add_project_video(uuid, text, uuid, text, text), public.delete_project_video(uuid),
  public.add_project_annotation(uuid, text, text, numeric, text, uuid), public.resolve_project_annotation(uuid, boolean),
  public.delete_project_annotation(uuid), public.list_project_annotations(uuid, text, text), public.share_pack_in_project(uuid, text, text),
  public.unshare_pack_from_project(uuid, text), public.link_album_to_project(uuid, text, boolean), public.get_project_content(uuid),
  public.create_project_snapshot(uuid, text), public.list_project_snapshots(uuid), public.restore_project_snapshot(uuid),
  public.save_project_showcase(uuid, jsonb) from public, anon;
grant execute on function public.add_project_item(uuid, jsonb), public.update_project_item(uuid, jsonb), public.delete_project_item(uuid),
  public.reorder_project_items(uuid, uuid[]), public.add_project_video(uuid, text, uuid, text, text), public.delete_project_video(uuid),
  public.add_project_annotation(uuid, text, text, numeric, text, uuid), public.resolve_project_annotation(uuid, boolean),
  public.delete_project_annotation(uuid), public.list_project_annotations(uuid, text, text), public.share_pack_in_project(uuid, text, text),
  public.unshare_pack_from_project(uuid, text), public.link_album_to_project(uuid, text, boolean), public.get_project_content(uuid),
  public.create_project_snapshot(uuid, text), public.list_project_snapshots(uuid), public.restore_project_snapshot(uuid),
  public.save_project_showcase(uuid, jsonb) to authenticated;
revoke execute on function public.get_project_showcase(uuid) from public;
grant execute on function public.get_project_showcase(uuid) to anon, authenticated;
revoke execute on function public.project_file_is_public(uuid) from public, anon, authenticated;
grant execute on function public.project_file_is_public(uuid) to service_role;
