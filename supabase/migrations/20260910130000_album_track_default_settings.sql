-- LayerPitch — Adaptive OST : réglages par défaut, par album.
--
-- Décision du 10 septembre (discussion Adaptive OST, suite de 20260910120100) : le studio doit
-- pouvoir proposer une Adaptive OST avec des choix par défaut (mix, intensité, maxChainLoops...),
-- que l'implémenteur peut tester en conditions avant que l'OST ne soit vendue — sans ça, tout fan
-- démarre d'un état neutre du moteur, jamais choisi par personne côté studio/compositeur.
--
-- Porté par album_tracks (l'association album+piste), pas par tracks seule : même raisonnement
-- que pour les réglages fan (locaux à playlist+piste, pas globaux à fan+piste, 20260910120100) —
-- la même piste peut avoir une ambiance par défaut différente selon le jeu/l'album où elle est
-- vendue. Forme laissée à player.js (getTrackSettings/applyTrackSettings), comme
-- playlist_tracks.settings.
alter table public.album_tracks
  add column default_settings jsonb not null default '{}'::jsonb;

-- Écriture réservée au compositeur propriétaire de l'album (même convention que le reste du
-- projet — toute écriture passe par une RPC SECURITY DEFINER, aucun GRANT direct sur la table).
-- Réutilise current_composer_id() (20260831231500).
create or replace function public.set_album_track_default_settings(p_album_id text, p_track_id text, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  update public.album_tracks at
  set default_settings = coalesce(p_settings, '{}'::jsonb)
  where at.album_id = p_album_id and at.track_id = p_track_id
    and exists (select 1 from public.albums a where a.id = at.album_id and a.owner_id = v_owner_id);
  if not found then
    raise exception 'Non autorisé : piste introuvable dans cet album, ou album appartenant à un autre compositeur';
  end if;
end;
$$;

grant execute on function public.set_album_track_default_settings(text, text, jsonb) to authenticated;

-- add_track_to_playlist() (20260910120100) initialisait playlist_tracks.settings à '{}' -- part
-- désormais des réglages par défaut de l'album via lequel ce fan possède la piste, plutôt que d'un
-- état neutre du moteur. Cas de bord (rare) : la même piste possédée via plusieurs albums achetés
-- -- l'achat le plus ancien gagne, choix arbitraire mais déterministe.
create or replace function public.add_track_to_playlist(p_playlist_id uuid, p_track_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owns_playlist boolean;
  v_default_settings jsonb;
  v_next_position int;
begin
  select exists(select 1 from public.playlists where id = p_playlist_id and profile_id = auth.uid())
    into v_owns_playlist;
  if not v_owns_playlist then
    raise exception 'Non autorisé : playlist introuvable ou appartenant à un autre compte';
  end if;

  select at.default_settings into v_default_settings
  from public.album_purchases ap
  join public.album_tracks at on at.album_id = ap.album_id
  where ap.buyer_id = auth.uid() and at.track_id = p_track_id
  order by ap.purchased_at asc
  limit 1;

  if v_default_settings is null then
    raise exception 'Non autorisé : cette piste ne provient d''aucune Adaptive OST achetée par ce compte';
  end if;

  select coalesce(max(position) + 1, 0) into v_next_position
  from public.playlist_tracks where playlist_id = p_playlist_id;

  insert into public.playlist_tracks (playlist_id, track_id, position, settings)
  values (p_playlist_id, p_track_id, v_next_position, v_default_settings)
  on conflict (playlist_id, track_id) do nothing;
end;
$$;
