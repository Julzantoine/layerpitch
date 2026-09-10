// api/playlists.js — LayerPitch, Adaptive OST : playlists fan (bibliothèque + "Figer")
//
// Toute écriture passe par les RPC (supabase/migrations/20260910120100_playlists_schema.sql) —
// même convention que le reste du projet (api/tracks.js : "toute écriture passe par les RPC
// upsert_*", aucun GRANT INSERT/UPDATE/DELETE direct sur les tables). Lecture : directe via le SDK
// (RLS "own playlists"/"own playlist tracks"/"own playlist freezes").
//
// Nécessite le SDK Supabase + api/supabase-client.js chargés en amont (voir api/auth.js pour le
// détail des <script> requis).

(function () {
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  // Playlists du compte connecté, avec leurs pistes (settings = état de mix courant, cf.
  // player.js getTrackSettings/applyTrackSettings — pas les objets tracks complets : à hydrater
  // séparément via LayerPitchTracks.listTracksByIds(), les pistes d'une playlist cross-albums
  // pouvant appartenir à n'importe quel compositeur).
  async function myPlaylists() {
    const { data, error } = await getClient()
      .from('playlists')
      .select('id, name, created_at, updated_at, playlist_tracks(track_id, position, settings)')
      .order('created_at', { ascending: true });
    if (error) return { playlists: null, error: error.message };
    return {
      playlists: data.map(p => ({
        id: p.id, name: p.name, createdAt: p.created_at, updatedAt: p.updated_at,
        tracks: [...(p.playlist_tracks || [])]
          .sort((a, b) => a.position - b.position)
          .map(t => ({ trackId: t.track_id, position: t.position, settings: t.settings || {} })),
      })),
      error: null,
    };
  }

  // Adaptive OST possédées par le compte connecté (RLS "own album purchases" — album_purchases.
  // buyer_id, corrigé le 10 septembre : les albums sont achetés par des fans, pas des studios).
  // album_tracks(track_id) : de quoi peupler le sélecteur "ajouter une piste à cette playlist" sans
  // second aller-retour.
  async function myAlbumPurchases() {
    const { data, error } = await getClient()
      .from('album_purchases')
      .select('id, album_id, purchased_at, price_paid, albums(id, title, illustration, album_tracks(track_id, position))')
      .order('purchased_at', { ascending: false });
    if (error) return { purchases: null, error: error.message };
    return {
      purchases: data.map(r => ({
        purchaseId: r.id, albumId: r.album_id, purchasedAt: r.purchased_at, pricePaid: r.price_paid,
        album: r.albums ? {
          id: r.albums.id, title: r.albums.title, illustration: r.albums.illustration,
          trackIds: [...(r.albums.album_tracks || [])].sort((a, b) => a.position - b.position).map(t => t.track_id),
        } : null,
      })),
      error: null,
    };
  }

  async function createPlaylist(name) {
    const { data, error } = await getClient().rpc('create_playlist', { p_name: name || '' });
    if (error) return { playlistId: null, error: error.message };
    return { playlistId: data, error: null };
  }

  async function renamePlaylist(playlistId, name) {
    const { error } = await getClient().rpc('rename_playlist', { p_playlist_id: playlistId, p_name: name || '' });
    return { ok: !error, error: error ? error.message : null };
  }

  async function deletePlaylist(playlistId) {
    const { error } = await getClient().rpc('delete_playlist', { p_playlist_id: playlistId });
    return { ok: !error, error: error ? error.message : null };
  }

  // Refusé côté RPC (pas seulement côté UI) si ce compte n'a pas acheté l'album source de cette
  // piste — voir add_track_to_playlist() dans la migration pour le détail du contrôle.
  async function addTrackToPlaylist(playlistId, trackId) {
    const { error } = await getClient().rpc('add_track_to_playlist', { p_playlist_id: playlistId, p_track_id: trackId });
    return { ok: !error, error: error ? error.message : null };
  }

  async function removeTrackFromPlaylist(playlistId, trackId) {
    const { error } = await getClient().rpc('remove_track_from_playlist', { p_playlist_id: playlistId, p_track_id: trackId });
    return { ok: !error, error: error ? error.message : null };
  }

  // settings : forme renvoyée par window.LayerPlayerCore.getTrackSettings(trackId) — toujours
  // l'état complet, jamais un diff (voir le commentaire de la RPC).
  async function setPlaylistTrackSettings(playlistId, trackId, settings) {
    const { error } = await getClient().rpc('set_playlist_track_settings', {
      p_playlist_id: playlistId, p_track_id: trackId, p_settings: settings || {},
    });
    return { ok: !error, error: error ? error.message : null };
  }

  async function reorderPlaylistTracks(playlistId, trackIds) {
    const { error } = await getClient().rpc('reorder_playlist_tracks', { p_playlist_id: playlistId, p_track_ids: trackIds });
    return { ok: !error, error: error ? error.message : null };
  }

  // "Figer" : construit le snapshot côté serveur à partir de playlist_tracks (jamais un JSON
  // envoyé par ce module) — voir freeze_playlist() dans la migration.
  async function freezePlaylist(playlistId, name) {
    const { data, error } = await getClient().rpc('freeze_playlist', { p_playlist_id: playlistId, p_name: name || '' });
    if (error) return { freezeId: null, error: error.message };
    return { freezeId: data, error: null };
  }

  async function listPlaylistFreezes(playlistId) {
    const { data, error } = await getClient()
      .from('playlist_freezes').select('id, name, snapshot, created_at')
      .eq('playlist_id', playlistId).order('created_at', { ascending: false });
    if (error) return { freezes: null, error: error.message };
    return {
      freezes: data.map(f => ({ id: f.id, name: f.name, snapshot: f.snapshot, createdAt: f.created_at })),
      error: null,
    };
  }

  window.LayerPitchPlaylists = {
    myPlaylists, myAlbumPurchases, createPlaylist, renamePlaylist, deletePlaylist,
    addTrackToPlaylist, removeTrackFromPlaylist, setPlaylistTrackSettings, reorderPlaylistTracks,
    freezePlaylist, listPlaylistFreezes,
  };
})();
