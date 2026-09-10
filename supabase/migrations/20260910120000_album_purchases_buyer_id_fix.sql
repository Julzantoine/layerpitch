-- LayerPitch — album_purchases.studio_id renommé buyer_id.
--
-- Le renommage buyer_profiles -> studio_profiles du 2 septembre (20260902200000) a suivi
-- mécaniquement le renommage de table et renommé aussi album_purchases.buyer_id en studio_id, sans
-- reprendre la question business à ce moment-là (son propre commentaire le dit explicitement :
-- "reste un choix produit pour Jules-Antoine, pas une décision prise unilatéralement").
--
-- L'architecture Adaptive OST (playlists/Figer, discutée le 10 septembre) tranche cette question :
-- les albums sont achetés par des FANS (fan_profiles, 20260901180000 — profil qui porte cet usage
-- "façon Bandcamp"), pas par des studios. pack_purchases.studio_id n'est PAS concerné : les packs
-- restent un achat studio, seul album_purchases avait ce nom trompeur. On corrige avant de bâtir
-- playlists/playlist_tracks par-dessus, qui référencent cette colonne pour vérifier qu'un fan
-- possède bien la piste qu'il ajoute à une playlist.

alter table public.album_purchases rename column studio_id to buyer_id;

drop policy "own album purchases" on public.album_purchases;
create policy "own album purchases" on public.album_purchases for select using (auth.uid() = buyer_id);

-- Nécessaire pour la jointure de vérification de propriété (album_purchases x album_tracks) que
-- add_track_to_playlist() va exécuter à chaque ajout de piste — absent jusqu'ici, aucun appelant
-- n'en avait besoin.
create index album_purchases_buyer_id_idx on public.album_purchases(buyer_id);
create index album_tracks_track_id_idx on public.album_tracks(track_id);
