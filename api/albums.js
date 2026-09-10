// api/albums.js — LayerPitch, Adaptive OST : réglages par défaut côté studio
// (supabase/migrations/20260910130000_album_track_default_settings.sql)
//
// Un seul point d'écriture pour l'instant : les défauts que le studio propose au fan avant toute
// personnalisation (mix/intensité/maxChainLoops — même forme que
// window.LayerPlayerCore.getTrackSettings()). Pas encore de véritable UI de test "en conditions"
// côté backstage (chantier séparé, à construire) ; ce module pose le point d'appel RPC que cette
// UI utilisera. Réservé au compositeur propriétaire de l'album — la RPC vérifie owner_id elle-même.

(function () {
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  async function setAlbumTrackDefaultSettings(albumId, trackId, settings) {
    const { error } = await getClient().rpc('set_album_track_default_settings', {
      p_album_id: albumId, p_track_id: trackId, p_settings: settings || {},
    });
    return { ok: !error, error: error ? error.message : null };
  }

  window.LayerPitchAlbums = { setAlbumTrackDefaultSettings };
})();
