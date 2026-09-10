-- LayerPitch — Adaptive OST : playlists, playlist_tracks, playlist_freezes.
--
-- Premier chantier de code du sujet "Adaptive OST" (réflexion d'architecture menée le 10 septembre,
-- une question à la fois — voir le fil de discussion). Décisions actées qui façonnent ce schéma :
--
-- 1. "Figer" = snapshot de réglages (cette migration), pas un rendu audio réel. "Imprimer" (rendu
--    réel, source d'un éventuel pressage vinyle) est une action séparée, différée, hors périmètre.
-- 2. Playlists cross-albums façon Bandcamp Playlists (lancées en beta mai 2025) : une playlist
--    n'est pas rattachée à un seul album acheté, elle peut mélanger des pistes de plusieurs
--    Adaptive OST différentes — la vérification de propriété se fait piste par piste, à l'ajout
--    (voir add_track_to_playlist ci-dessous), pas au niveau de la playlist entière.
-- 3. Les réglages de mix (mute/solo/volume/intensité, cf. getTrackSettings/applyTrackSettings dans
--    player.js) sont locaux au couple (playlist, piste), pas globaux au couple (fan, piste) : la
--    même piste peut sonner différemment selon la playlist où elle apparaît.
-- 4. Statut de droits par piste : abandonné (voir la discussion) — aucune colonne ici, le geste
--    d'activer albums.buyable vaut déclaration, encadré par les CGU.
--
-- playlists.profile_id référence profiles(id) directement (comme album_purchases.buyer_id depuis
-- 20260910120000), pas fan_profiles(id) : fan_profiles ne porte aujourd'hui aucune colonne propre
-- utile ici, et cette indirection n'apporterait rien (tout profil a un fan_profile par construction,
-- 20260901180000).
--
-- Écriture réservée aux RPC ci-dessous (SECURITY DEFINER), pas de policy INSERT/UPDATE/DELETE : même
-- convention que le reste du projet (20260831112717 — "toute écriture passe par les RPC upsert_*",
-- authenticated n'a jamais de GRANT INSERT/UPDATE/DELETE direct sur une table).

create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index playlists_profile_id_idx on public.playlists(profile_id);

create table public.playlist_tracks (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id text not null references public.tracks(id) on delete cascade,
  position int not null default 0,
  -- Forme laissée à player.js (getTrackSettings/applyTrackSettings), pas de contrainte ici — même
  -- principe que tracks.layers/sections/loops (Décision 1 du schéma initial) : structure propre à
  -- l'usage, sans intégrité référentielle critique à valider côté base.
  settings jsonb not null default '{}'::jsonb,
  primary key (playlist_id, track_id)
);

-- Historique des "Figer" : une entrée par figeage, jamais modifiée ni recréée à la même position —
-- append-only par construction (aucune fonction update/delete fournie sur cette table).
create table public.playlist_freezes (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  name text not null default '',
  -- Snapshot construit côté serveur par freeze_playlist() à partir de l'état réel de
  -- playlist_tracks au moment de l'appel, jamais soumis par le client -- évite qu'un fan fige un
  -- état qu'il n'a pas réellement atteint via l'UI. Forme : [{trackId, position, settings}, ...].
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index playlist_freezes_playlist_id_idx on public.playlist_freezes(playlist_id);

alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.playlist_freezes enable row level security;

create policy "own playlists" on public.playlists for select using (auth.uid() = profile_id);
create policy "own playlist tracks" on public.playlist_tracks for select using (
  exists (select 1 from public.playlists p where p.id = playlist_tracks.playlist_id and p.profile_id = auth.uid())
);
create policy "own playlist freezes" on public.playlist_freezes for select using (
  exists (select 1 from public.playlists p where p.id = playlist_freezes.playlist_id and p.profile_id = auth.uid())
);

-- ============================================================================
create or replace function public.create_playlist(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Non autorisé : compte non authentifié';
  end if;
  insert into public.playlists (profile_id, name) values (auth.uid(), coalesce(p_name, ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- ============================================================================
create or replace function public.rename_playlist(p_playlist_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.playlists set name = coalesce(p_name, ''), updated_at = now()
  where id = p_playlist_id and profile_id = auth.uid();
  if not found then
    raise exception 'Non autorisé : playlist introuvable ou appartenant à un autre compte';
  end if;
end;
$$;

-- ============================================================================
create or replace function public.delete_playlist(p_playlist_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.playlists where id = p_playlist_id and profile_id = auth.uid();
  if not found then
    raise exception 'Non autorisé : playlist introuvable ou appartenant à un autre compte';
  end if;
end;
$$;

-- ============================================================================
-- Vérifie piste par piste que le fan possède bien l'album source (Décision 2 ci-dessus) : une
-- playlist cross-albums ne peut pas se contenter d'un contrôle unique au niveau playlist.
create or replace function public.add_track_to_playlist(p_playlist_id uuid, p_track_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owns_playlist boolean;
  v_owns_track boolean;
  v_next_position int;
begin
  select exists(select 1 from public.playlists where id = p_playlist_id and profile_id = auth.uid())
    into v_owns_playlist;
  if not v_owns_playlist then
    raise exception 'Non autorisé : playlist introuvable ou appartenant à un autre compte';
  end if;

  select exists(
    select 1 from public.album_purchases ap
    join public.album_tracks at on at.album_id = ap.album_id
    where ap.buyer_id = auth.uid() and at.track_id = p_track_id
  ) into v_owns_track;
  if not v_owns_track then
    raise exception 'Non autorisé : cette piste ne provient d''aucune Adaptive OST achetée par ce compte';
  end if;

  select coalesce(max(position) + 1, 0) into v_next_position
  from public.playlist_tracks where playlist_id = p_playlist_id;

  insert into public.playlist_tracks (playlist_id, track_id, position)
  values (p_playlist_id, p_track_id, v_next_position)
  on conflict (playlist_id, track_id) do nothing;
end;
$$;

-- ============================================================================
create or replace function public.remove_track_from_playlist(p_playlist_id uuid, p_track_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.playlist_tracks
  where playlist_id = p_playlist_id and track_id = p_track_id
    and exists (select 1 from public.playlists p where p.id = playlist_id and p.profile_id = auth.uid());
  if not found then
    raise exception 'Non autorisé : piste introuvable dans cette playlist, ou playlist appartenant à un autre compte';
  end if;
end;
$$;

-- ============================================================================
-- Réglages de mix (level/mutedVoices/soloedVoices/layerVolumes, cf. player.js getTrackSettings) —
-- écrasés entièrement à chaque appel, pas de fusion partielle : le client envoie toujours l'état
-- complet renvoyé par getTrackSettings(), jamais un diff.
create or replace function public.set_playlist_track_settings(p_playlist_id uuid, p_track_id text, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.playlist_tracks pt
  set settings = coalesce(p_settings, '{}'::jsonb)
  where pt.playlist_id = p_playlist_id and pt.track_id = p_track_id
    and exists (select 1 from public.playlists p where p.id = pt.playlist_id and p.profile_id = auth.uid());
  if not found then
    raise exception 'Non autorisé : piste introuvable dans cette playlist, ou playlist appartenant à un autre compte';
  end if;
  update public.playlists set updated_at = now() where id = p_playlist_id;
end;
$$;

-- ============================================================================
create or replace function public.reorder_playlist_tracks(p_playlist_id uuid, p_track_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owns_playlist boolean;
  v_track_id text;
  v_idx int := 0;
begin
  select exists(select 1 from public.playlists where id = p_playlist_id and profile_id = auth.uid())
    into v_owns_playlist;
  if not v_owns_playlist then
    raise exception 'Non autorisé : playlist introuvable ou appartenant à un autre compte';
  end if;

  foreach v_track_id in array p_track_ids
  loop
    update public.playlist_tracks set position = v_idx
    where playlist_id = p_playlist_id and track_id = v_track_id;
    v_idx := v_idx + 1;
  end loop;
  update public.playlists set updated_at = now() where id = p_playlist_id;
end;
$$;

-- ============================================================================
-- "Figer" (Décision 1 ci-dessus) : snapshot construit ici, côté serveur, à partir de l'état réel de
-- playlist_tracks — jamais à partir d'un JSON soumis par le client.
create or replace function public.freeze_playlist(p_playlist_id uuid, p_name text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owns_playlist boolean;
  v_snapshot jsonb;
  v_id uuid;
begin
  select exists(select 1 from public.playlists where id = p_playlist_id and profile_id = auth.uid())
    into v_owns_playlist;
  if not v_owns_playlist then
    raise exception 'Non autorisé : playlist introuvable ou appartenant à un autre compte';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'trackId', track_id, 'position', position, 'settings', settings
  ) order by position), '[]'::jsonb)
  into v_snapshot
  from public.playlist_tracks where playlist_id = p_playlist_id;

  insert into public.playlist_freezes (playlist_id, name, snapshot)
  values (p_playlist_id, coalesce(p_name, ''), v_snapshot)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_playlist(text) to authenticated;
grant execute on function public.rename_playlist(uuid, text) to authenticated;
grant execute on function public.delete_playlist(uuid) to authenticated;
grant execute on function public.add_track_to_playlist(uuid, text) to authenticated;
grant execute on function public.remove_track_from_playlist(uuid, text) to authenticated;
grant execute on function public.set_playlist_track_settings(uuid, text, jsonb) to authenticated;
grant execute on function public.reorder_playlist_tracks(uuid, text[]) to authenticated;
grant execute on function public.freeze_playlist(uuid, text) to authenticated;
