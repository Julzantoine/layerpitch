// api/albums.js — LayerPitch, Adaptive OST côté studio
//
// upsert_album (20260910140000) : strict minimum pour qu'un compositeur puisse créer un album et y
// rattacher SES pistes -- pas un vrai chantier "gestion d'album" (pas d'illustration, pas de
// présentation soignée), juste ce qu'il faut pour que backstage-adaptive-ost.html ait quelque
// chose à afficher. set_album_track_default_settings (20260910130000) : les défauts que le studio
// propose au fan avant toute personnalisation (même forme que
// window.LayerPlayerCore.getTrackSettings()). Écriture réservée au compositeur propriétaire de
// l'album -- les RPC vérifient owner_id elles-mêmes.

(function () {
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  // Reprend le mapping camelCase <-> snake_case des autres modules api/*.js (cf. api/tracks.js
  // reshapeTrack) -- forme attendue par backstage-adaptive-ost.html, pas les noms de colonnes bruts.
  function reshapeAlbum(row) {
    if (!row) return null;
    return {
      id: row.id, title: row.title, illustration: row.illustration,
      tracks: [...(row.album_tracks || [])]
        .sort((a, b) => a.position - b.position)
        .map(t => ({ trackId: t.track_id, position: t.position, defaultSettings: t.default_settings || {} })),
    };
  }

  // Albums du compositeur connecté (opts.ownerId = composer_profiles.id, cf.
  // LayerPitchAuth.getMyComposerId()) -- pas de RLS par propriétaire sur albums (lecture publique,
  // comme tracks/packs), le filtre se fait ici côté requête.
  async function myAlbums(ownerId) {
    if (!ownerId) return { albums: [], error: null };
    const { data, error } = await getClient()
      .from('albums')
      .select('id, title, illustration, album_tracks(track_id, position, default_settings)')
      .eq('owner_id', ownerId);
    if (error) return { albums: null, error: error.message };
    return { albums: data.map(reshapeAlbum), error: null };
  }

  // payload : {id, title, illustration?, presentationFr?, presentationEn?, trackIds: [...]}.
  // Réservé au compositeur propriétaire -- la RPC refuse tout autre appelant, et refuse toute
  // piste n'appartenant pas à ce même compositeur (voir la migration pour le détail).
  async function upsertAlbum(payload) {
    const { data, error } = await getClient().rpc('upsert_album', { payload });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  }

  async function setAlbumTrackDefaultSettings(albumId, trackId, settings) {
    const { error } = await getClient().rpc('set_album_track_default_settings', {
      p_album_id: albumId, p_track_id: trackId, p_settings: settings || {},
    });
    return { ok: !error, error: error ? error.message : null };
  }

  window.LayerPitchAlbums = { myAlbums, upsertAlbum, setAlbumTrackDefaultSettings };
})();
