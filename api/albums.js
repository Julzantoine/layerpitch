// api/albums.js — LayerPitch, albums (Adaptive OST) via SDK Supabase
//
// Lecture directe (RLS "public read" sur albums ; "own album purchases" sur album_purchases : chaque
// compte ne voit que ses propres achats). Écriture via les RPC upsert_album / claim_test_album
// (supabase/migrations/20260921080000) — jamais d'INSERT/UPDATE direct, aucun GRANT ne le permet.

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

  window.LayerPitchAlbums = { listAlbums, upsertAlbum, claimTestAlbum, listMyPurchases, getPlatformFlags };
})();
