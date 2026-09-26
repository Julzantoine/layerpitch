-- LayerPitch — Adaptive OST : playlists du fan (demande de Jules-Antoine du 26 septembre 2026).
--
-- Décisions du 26/09 :
--   - une entrée de playlist = une VERSION précise d'un morceau : une version du fan (album_track_versions) ou la
--     version du compositeur (version_id null = album_tracks.default_settings) ; deux versions du même morceau peuvent
--     cohabiter dans une playlist ;
--   - une playlist mélange librement les morceaux de TOUS les albums que le fan possède.
-- Suppressions en cascade : une version du fan supprimée, un morceau retiré de son album ou un album supprimé
-- disparaissent des playlists (clés étrangères), sans RPC à appeler.
-- Remplace la conception du 10/09 (branche archivée, 20260910120100_playlists_schema.sql, jamais appliquée : réglages
-- par morceau et playlist_freezes) -- rien n'en est repris, la notion de version l'a rendue inutile.
--
-- Écriture uniquement par RPC SECURITY DEFINER, lecture aussi (get_my_playlists) ; RLS activée sans aucune politique
-- d'écriture. Accès gouverné par la possession des albums (owns_album) : en bêta, seuls les admins possèdent des albums,
-- donc pas de verrou supplémentaire à lever au lancement.

create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.playlists is 'Playlists d''un fan : des versions de morceaux de ses albums, dans l''ordre qu''il choisit.';
create index if not exists playlists_buyer_idx on public.playlists(buyer_id, created_at);

create table if not exists public.playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  position int not null default 0,
  album_id text not null,
  track_id text not null,
  -- null = version du compositeur (album_tracks.default_settings de ce morceau dans cet album).
  version_id uuid references public.album_track_versions(id) on delete cascade,
  added_at timestamptz not null default now(),
  foreign key (album_id, track_id) references public.album_tracks(album_id, track_id) on delete cascade
);
comment on table public.playlist_items is 'Entrées d''une playlist : une version précise (celle du fan, ou celle du compositeur si version_id est null) d''un morceau d''un album.';
create index if not exists playlist_items_playlist_idx on public.playlist_items(playlist_id, position);

alter table public.playlists enable row level security;
alter table public.playlist_items enable row level security;
drop policy if exists "own playlists" on public.playlists;
create policy "own playlists" on public.playlists for select using (auth.uid() = buyer_id);
drop policy if exists "own playlist items" on public.playlist_items;
create policy "own playlist items" on public.playlist_items for select
  using (exists (select 1 from public.playlists p where p.id = playlist_id and p.buyer_id = auth.uid()));

-- Garde commune : la playlist existe et appartient au compte appelant.
create or replace function public.check_my_playlist(p_playlist_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not exists (select 1 from public.playlists where id = p_playlist_id and buyer_id = auth.uid()) then
    raise exception 'Playlist introuvable';
  end if;
end;
$$;

-- Toutes les playlists du compte, avec leurs entrées dans l'ordre. Les entrées d'un album que le compte ne possède
-- plus (remboursement, par exemple) sont écartées.
create or replace function public.get_my_playlists()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'createdAt', p.created_at, 'updatedAt', p.updated_at,
      'items', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', i.id, 'albumId', i.album_id, 'trackId', i.track_id, 'versionId', i.version_id, 'addedAt', i.added_at
        ) order by i.position, i.added_at), '[]'::jsonb)
        from public.playlist_items i
        where i.playlist_id = p.id and public.owns_album(i.album_id)
      )
    ) order by p.created_at), '[]'::jsonb)
    from public.playlists p where p.buyer_id = auth.uid()
  );
end;
$$;

create or replace function public.create_my_playlist(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  if (select count(*) from public.playlists where buyer_id = auth.uid()) >= 200 then
    raise exception 'Nombre maximum de playlists atteint (200)';
  end if;
  insert into public.playlists (buyer_id, name) values (auth.uid(), left(coalesce(trim(p_name), ''), 120))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rename_my_playlist(p_playlist_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_my_playlist(p_playlist_id);
  update public.playlists set name = left(coalesce(trim(p_name), ''), 120), updated_at = now() where id = p_playlist_id;
end;
$$;

create or replace function public.delete_my_playlist(p_playlist_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_my_playlist(p_playlist_id);
  delete from public.playlists where id = p_playlist_id;
end;
$$;

-- Ajoute une version à la fin de la playlist. p_version_id null = version du compositeur (qui doit exister).
create or replace function public.add_to_my_playlist(p_playlist_id uuid, p_album_id text, p_track_id text, p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public.check_my_playlist(p_playlist_id);
  if not public.owns_album(p_album_id) then raise exception 'Non autorisé : tu ne possèdes pas cet album'; end if;
  if p_version_id is null then
    if not exists (select 1 from public.album_tracks where album_id = p_album_id and track_id = p_track_id
                   and default_settings->>'kind' = 'layerpitch-take') then
      raise exception 'Ce morceau n''a pas de version du compositeur';
    end if;
  elsif not exists (select 1 from public.album_track_versions where id = p_version_id and buyer_id = auth.uid()
                    and album_id = p_album_id and track_id = p_track_id) then
    raise exception 'Version introuvable';
  end if;
  if (select count(*) from public.playlist_items where playlist_id = p_playlist_id) >= 500 then
    raise exception 'Playlist pleine (500 morceaux au maximum)';
  end if;
  insert into public.playlist_items (playlist_id, position, album_id, track_id, version_id)
  values (p_playlist_id, coalesce((select max(position) + 1 from public.playlist_items where playlist_id = p_playlist_id), 0),
          p_album_id, p_track_id, p_version_id)
  returning id into v_id;
  update public.playlists set updated_at = now() where id = p_playlist_id;
  return v_id;
end;
$$;

create or replace function public.remove_from_my_playlist(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_playlist uuid;
begin
  select playlist_id into v_playlist from public.playlist_items where id = p_item_id;
  if v_playlist is null then raise exception 'Entrée introuvable'; end if;
  perform public.check_my_playlist(v_playlist);
  delete from public.playlist_items where id = p_item_id;
  update public.playlists set updated_at = now() where id = v_playlist;
end;
$$;

-- Nouvel ordre complet : p_item_ids doit contenir exactement les entrées de la playlist (sinon refus, rien ne bouge).
create or replace function public.reorder_my_playlist(p_playlist_id uuid, p_item_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_my_playlist(p_playlist_id);
  if coalesce(array_length(p_item_ids, 1), 0) <> (select count(*) from public.playlist_items where playlist_id = p_playlist_id)
     or (select count(distinct x) from unnest(p_item_ids) x) <> coalesce(array_length(p_item_ids, 1), 0)
     or exists (select 1 from unnest(p_item_ids) x where not exists (
       select 1 from public.playlist_items i where i.id = x and i.playlist_id = p_playlist_id)) then
    raise exception 'Ordre invalide : la liste ne correspond pas aux entrées de la playlist';
  end if;
  update public.playlist_items i set position = o.ord - 1
  from unnest(p_item_ids) with ordinality as o(item_id, ord)
  where i.id = o.item_id;
  update public.playlists set updated_at = now() where id = p_playlist_id;
end;
$$;

revoke all on function public.check_my_playlist(uuid), public.get_my_playlists(), public.create_my_playlist(text),
  public.rename_my_playlist(uuid, text), public.delete_my_playlist(uuid), public.add_to_my_playlist(uuid, text, text, uuid),
  public.remove_from_my_playlist(uuid), public.reorder_my_playlist(uuid, uuid[]) from public, anon;
grant execute on function public.get_my_playlists() to authenticated;
grant execute on function public.create_my_playlist(text) to authenticated;
grant execute on function public.rename_my_playlist(uuid, text) to authenticated;
grant execute on function public.delete_my_playlist(uuid) to authenticated;
grant execute on function public.add_to_my_playlist(uuid, text, text, uuid) to authenticated;
grant execute on function public.remove_from_my_playlist(uuid) to authenticated;
grant execute on function public.reorder_my_playlist(uuid, uuid[]) to authenticated;
