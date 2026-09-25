// api/albums.js — LayerPitch, albums (Adaptive OST) via SDK Supabase
//
// Lecture directe (RLS "public read" sur albums ; "own album purchases" sur album_purchases : chaque
// compte ne voit que ses propres achats). Écriture via les RPC upsert_album / claim_test_album
// (supabase/migrations/20260921080000), puis versions figées et réglages du fan (20260925010000, 20260921090000)
// — jamais d'INSERT/UPDATE direct, aucun GRANT ne le permet.

(function () {
  // Client Supabase partagé (api/supabase-client.js) — voir ce fichier pour le pourquoi.
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  const ALBUM_SELECT = `*, album_tracks(track_id, position)`;

  function reshapeAlbum(row) {
    if (!row) return null;
    const trackIds = [...(row.album_tracks || [])].sort((a, b) => a.position - b.position).map(r => r.track_id);
    return {
      id: row.id, sellerId: row.seller_id, sellerRole: row.seller_role, title: row.title,
      illustration: row.illustration, illustrationOriginalName: row.illustration_original_name,
      presentationFr: row.presentation_fr, presentationEn: row.presentation_en,
      // Prix MINIMUM en centimes USD (prix libre : le fan peut payer davantage) — null = pas de prix.
      priceUsdCents: row.price_usd_cents, buyable: row.buyable, tags: row.tags, trackIds,
    };
  }

  // Albums d'un vendeur (compte). sellerId = auth.uid() du compositeur connecté — sans lui, la liste
  // contiendrait les albums de tout le monde (lecture publique), voir le même piège dans listPacks.
  async function listAlbums(opts) {
    let query = getClient().from('albums').select(ALBUM_SELECT);
    if (opts && opts.sellerId) query = query.eq('seller_id', opts.sellerId);
    const { data, error } = await query;
    if (error) return { albums: null, error: error.message };
    return { albums: data.map(reshapeAlbum), error: null };
  }

  async function upsertAlbum(payload) {
    const { data, error } = await getClient().rpc('upsert_album', { payload });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  }

  // Achat factice de la bêta (aucun paiement) — refusé côté serveur dès que
  // platform_flags.test_purchases_enabled passe à false.
  async function claimTestAlbum(albumId) {
    const { data, error } = await getClient().rpc('claim_test_album', { p_album_id: albumId });
    if (error) return { ok: false, error: error.message };
    return { ok: true, alreadyOwned: !!(data && data.alreadyOwned) };
  }

  // Achats du compte connecté (la RLS filtre déjà sur auth.uid()), avec le titre de l'album.
  async function listMyPurchases() {
    const { data, error } = await getClient()
      .from('album_purchases')
      .select('album_id, purchased_at, price_paid, is_test, albums(id, title)')
      .order('purchased_at', { ascending: false });
    if (error) return { purchases: null, error: error.message };
    return {
      purchases: data.map(r => ({
        albumId: r.album_id, purchasedAt: r.purchased_at, pricePaid: r.price_paid, isTest: r.is_test,
        title: r.albums ? r.albums.title : '',
      })),
      error: null,
    };
  }

  // Drapeaux globaux (lecture publique) — le client s'en sert pour afficher ou non « Obtenir (test) ».
  async function getPlatformFlags() {
    const { data, error } = await getClient().from('platform_flags').select('test_purchases_enabled').maybeSingle();
    if (error) return { flags: null, error: error.message };
    return { flags: { testPurchasesEnabled: !!(data && data.test_purchases_enabled) }, error: null };
  }

  // ---- Côté fan : versions figées (supabase/migrations/20260925010000) ----
  // Une version = une PRISE d'un morceau (journal du lecteur, LayerPlayerCore.getTrackTake), immuable ; seul son nom
  // se modifie. Réservé au propriétaire de l'album (vérifié côté serveur).

  // Morceaux de l'album dans l'ordre, avec la version officielle du vendeur (sa prise, ou null), et les versions du
  // fan, les plus récentes d'abord.
  async function getMyAlbumVersions(albumId) {
    const { data, error } = await getClient().rpc('get_my_album_versions', { p_album_id: albumId });
    if (error) return { tracks: null, versions: null, error: error.message };
    return { tracks: data.tracks || [], versions: data.versions || [], error: null };
  }

  async function saveMyTrackVersion(albumId, trackId, name, take) {
    const { data, error } = await getClient().rpc('save_my_track_version', { p_album_id: albumId, p_track_id: trackId, p_name: name || '', p_take: take });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data };
  }

  async function renameMyTrackVersion(versionId, name) {
    const { error } = await getClient().rpc('rename_my_track_version', { p_version_id: versionId, p_name: name || '' });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  async function deleteMyTrackVersion(versionId) {
    const { error } = await getClient().rpc('delete_my_track_version', { p_version_id: versionId });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  // ---- Côté fan : réglages mémorisés d'une session à l'autre (migration 20260921090000, pour plus tard) ----
  async function getMyAlbumSettings(albumId) {
    const { data, error } = await getClient().rpc('get_my_album_settings', { p_album_id: albumId });
    if (error) return { settings: null, error: error.message };
    return { settings: data || [], error: null };
  }

  async function setMyAlbumTrackSettings(albumId, trackId, settings) {
    const { error } = await getClient().rpc('set_my_album_track_settings', { p_album_id: albumId, p_track_id: trackId, p_settings: settings || {} });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  async function resetMyAlbumTrackSettings(albumId, trackId) {
    const { error } = await getClient().rpc('reset_my_album_track_settings', { p_album_id: albumId, p_track_id: trackId });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  // ---- Côté vendeur : version officielle d'un morceau dans son album ----
  // C'est une prise du vendeur (décision du 25/09), rangée dans album_tracks.default_settings. Réservé aux admins
  // pendant la bêta (verrou serveur de set_album_track_default_settings, à lever au lancement).
  async function setAlbumTrackOfficialTake(albumId, trackId, take) {
    const { error } = await getClient().rpc('set_album_track_default_settings', { p_album_id: albumId, p_track_id: trackId, p_settings: take });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  window.LayerPitchAlbums = {
    listAlbums, upsertAlbum, claimTestAlbum, listMyPurchases, getPlatformFlags,
    getMyAlbumVersions, saveMyTrackVersion, renameMyTrackVersion, deleteMyTrackVersion,
    getMyAlbumSettings, setMyAlbumTrackSettings, resetMyAlbumTrackSettings, setAlbumTrackOfficialTake,
  };
})();
