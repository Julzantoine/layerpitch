// api/playlists.js — LayerPitch, playlists du fan (Adaptive OST) via SDK Supabase
//
// Une entrée de playlist = une VERSION précise d'un morceau (version du fan, ou version du compositeur si versionId est
// null), de n'importe quel album que le fan possède (décisions du 26/09). Tout passe par les RPC de
// supabase/migrations/20260926030000_fan_playlists.sql -- aucune écriture directe.

(function () {
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }
  const done = error => (error ? { ok: false, error: error.message } : { ok: true });

  // Playlists du compte, avec leurs entrées dans l'ordre : [{ id, name, items: [{ id, albumId, trackId, versionId }] }].
  async function getMyPlaylists() {
    const { data, error } = await getClient().rpc('get_my_playlists');
    if (error) return { playlists: null, error: error.message };
    return { playlists: data || [], error: null };
  }

  async function createMyPlaylist(name) {
    const { data, error } = await getClient().rpc('create_my_playlist', { p_name: name || '' });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data };
  }

  async function renameMyPlaylist(playlistId, name) {
    const { error } = await getClient().rpc('rename_my_playlist', { p_playlist_id: playlistId, p_name: name || '' });
    return done(error);
  }

  async function deleteMyPlaylist(playlistId) {
    const { error } = await getClient().rpc('delete_my_playlist', { p_playlist_id: playlistId });
    return done(error);
  }

  // versionId null = version du compositeur.
  async function addToMyPlaylist(playlistId, albumId, trackId, versionId) {
    const { data, error } = await getClient().rpc('add_to_my_playlist', {
      p_playlist_id: playlistId, p_album_id: albumId, p_track_id: trackId, p_version_id: versionId || null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data };
  }

  async function removeFromMyPlaylist(itemId) {
    const { error } = await getClient().rpc('remove_from_my_playlist', { p_item_id: itemId });
    return done(error);
  }

  // itemIds : toutes les entrées de la playlist, dans le nouvel ordre.
  async function reorderMyPlaylist(playlistId, itemIds) {
    const { error } = await getClient().rpc('reorder_my_playlist', { p_playlist_id: playlistId, p_item_ids: itemIds });
    return done(error);
  }

  window.LayerPitchPlaylists = {
    getMyPlaylists, createMyPlaylist, renameMyPlaylist, deleteMyPlaylist, addToMyPlaylist, removeFromMyPlaylist, reorderMyPlaylist,
  };
})();
