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

  // Version du compositeur de chaque morceau : seulement son type et sa durée (la prise entière peut peser plusieurs
  // centaines de Ko ; elle se lit à part, getAlbumTrackOfficialTake, quand on veut l'écouter).
  const ALBUM_SELECT = `*, album_tracks(track_id, position, official_kind:default_settings->>kind, official_duration:default_settings->>duration)`;

  function reshapeAlbum(row) {
    if (!row) return null;
    const trackIds = [...(row.album_tracks || [])].sort((a, b) => a.position - b.position).map(r => r.track_id);
    // Morceaux qui ont leur version du compositeur -> durée en secondes (condition de mise en vente, 26/09).
    const officialDurations = {};
    (row.album_tracks || []).forEach(r => { if (r.official_kind === 'layerpitch-take') officialDurations[r.track_id] = Number(r.official_duration) || 0; });
    return {
      id: row.id, sellerId: row.seller_id, sellerRole: row.seller_role, title: row.title,
      illustration: row.illustration, illustrationOriginalName: row.illustration_original_name,
      presentationFr: row.presentation_fr, presentationEn: row.presentation_en,
      // Prix MINIMUM en centimes d'euro (prix libre : le fan peut payer davantage) — null = pas de prix.
      priceEurCents: row.price_eur_cents, buyable: row.buyable, tags: row.tags, trackIds, officialDurations,
    };
  }

  // Albums d'un vendeur (compte). sellerId = auth.uid() du compositeur connecté — sans lui, la liste
  // contiendrait les albums de tout le monde (lecture publique), voir le même piège dans listPacks.
  async function listAlbums(opts) {
    let query = getClient().from('albums').select(ALBUM_SELECT);
    if (opts && opts.sellerId) query = query.eq('seller_id', opts.sellerId);
    const { data, error } = await query;
    if (error) return { albums: null, error: error.message };
    // Morceaux retirés d'un album déjà obtenu (27/09, album_tracks.removed_at) : gardés pour les acheteurs existants,
    // mais plus dans l'album pour le vendeur ni pour les futurs acheteurs. Lus à part et sans bloquer : la colonne
    // n'existe qu'une fois la migration 20260927030000 appliquée.
    const removed = await getClient().from('album_tracks').select('album_id, track_id').not('removed_at', 'is', null);
    const gone = new Set(removed.error ? [] : removed.data.map(r => r.album_id + '|' + r.track_id));
    return { albums: data.map(row => Object.assign({}, row, { album_tracks: (row.album_tracks || []).filter(t => !gone.has(row.id + '|' + t.track_id)) })).map(reshapeAlbum), error: null };
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

  // Achats du compte connecté (la RLS filtre déjà sur auth.uid()), avec le titre, la pochette et la présentation de
  // l'album (page fan, mes-albums.html).
  async function listMyPurchases() {
    const { data, error } = await getClient()
      .from('album_purchases')
      .select('album_id, purchased_at, price_paid, is_test, albums(id, title, illustration, presentation_fr, presentation_en)')
      .order('purchased_at', { ascending: false });
    if (error) return { purchases: null, error: error.message };
    return {
      purchases: data.map(r => ({
        albumId: r.album_id, purchasedAt: r.purchased_at, pricePaid: r.price_paid, isTest: r.is_test,
        title: r.albums ? r.albums.title : '',
        illustration: r.albums ? r.albums.illustration : null,
        presentationFr: r.albums ? r.albums.presentation_fr || '' : '', presentationEn: r.albums ? r.albums.presentation_en || '' : '',
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

  // Prise complète de la version du compositeur (pour l'écouter dans le Backstage) ; null s'il n'y en a pas.
  async function getAlbumTrackOfficialTake(albumId, trackId) {
    const { data, error } = await getClient().from('album_tracks').select('default_settings')
      .eq('album_id', albumId).eq('track_id', trackId).maybeSingle();
    if (error) return { take: null, error: error.message };
    const t = data && data.default_settings;
    return { take: t && t.kind === 'layerpitch-take' ? t : null, error: null };
  }

  // ---- Co-ayants droit (étape 4a, 28/09, migration 20260928040000) ----
  async function getAlbumRights(albumId) {
    const { data, error } = await getClient().rpc('list_album_rights', { p_album_id: albumId });
    return error ? { rights: null, error: error.message } : { rights: data, error: null };
  }
  async function setAlbumRights(albumId, declaration, holders, ack) {
    const { data, error } = await getClient().rpc('set_album_rights', { p_album_id: albumId, p_declaration: declaration, p_holders: holders, p_ack: !!ack });
    return error ? { rights: null, error: error.message } : { rights: data, error: null };
  }
  async function markRightsHolderSelfPay(holderId) {
    const { data, error } = await getClient().rpc('mark_rights_holder_self_pay', { p_holder_id: holderId });
    return error ? { rights: null, error: error.message } : { rights: data, error: null };
  }
  // E-mail d'invitation (Edge Function invite-rights-holder) ; en cas d'échec d'envoi, actionLink permet de transmettre le lien soi-même.
  async function inviteRightsHolder(albumId, holderId, redirectTo) {
    const { data, error } = await getClient().functions.invoke('invite-rights-holder', { body: { albumId, holderId, redirectTo } });
    if (error) {
      let body = null;
      try { body = error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) {}
      return { ok: false, error: (body && body.error) || await window.LayerPitchAuth.describeFunctionError(error), actionLink: body && body.actionLink };
    }
    return data && data.ok ? { ok: true } : { ok: false, error: (data && data.error) || 'Réponse inattendue.' };
  }
  async function myRightsInvitations() {
    const { data, error } = await getClient().rpc('my_rights_invitations');
    return error ? { invitations: [], error: error.message } : { invitations: data || [], error: null };
  }
  async function respondRightsInvitation(holderId, accept, payoutRole) {
    const { error } = await getClient().rpc('respond_rights_invitation', { p_holder_id: holderId, p_accept: !!accept, p_payout_role: payoutRole || 'composer' });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  window.LayerPitchAlbums = {
    getAlbumRights, setAlbumRights, markRightsHolderSelfPay, inviteRightsHolder, myRightsInvitations, respondRightsInvitation,
    listAlbums, upsertAlbum, claimTestAlbum, listMyPurchases, getPlatformFlags,
    getMyAlbumVersions, saveMyTrackVersion, renameMyTrackVersion, deleteMyTrackVersion,
    getMyAlbumSettings, setMyAlbumTrackSettings, resetMyAlbumTrackSettings, setAlbumTrackOfficialTake, getAlbumTrackOfficialTake,
  };
})();
