// api/adreels.js — LayerPitch, CRUD AdReels via SDK Supabase (Décision 2, docs/infrastructure.md)
//
// Lecture directe (RLS "public read"). Écriture via la RPC upsert_ad_reel (remplace atomiquement
// ad_reel_tracks à chaque appel — voir supabase/migrations pour le détail).

(function () {
  // Client Supabase partagé (api/supabase-client.js) — voir ce fichier pour le pourquoi.
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  const AD_REEL_SELECT = `*, ad_reel_tracks(track_id, position)`;

  // ownerId exposé (absent de data.json, jamais réinjecté dans les payloads d'écriture qui
  // construisent leur propre objet champ par champ) — utile à l'affichage/au backstage, plus
  // nécessaire pour découvrir le compositeur d'un AdReel (l'identité vient maintenant du handle
  // dans l'URL, résolue avant tout appel Postgres — voir api/composers.js, 404.html).
  function reshapeAdReel(row) {
    if (!row) return null;
    const trackIds = [...(row.ad_reel_tracks || [])].sort((a, b) => a.position - b.position).map(r => r.track_id);
    return {
      id: row.id, ownerId: row.owner_id, folderId: row.folder_id, label: row.label, lang: row.lang, blocks: row.blocks,
      profile: row.profile, testimonials: row.testimonials, trackIds, trackOverrides: row.track_overrides,
      allowIndexing: row.allow_indexing !== false,
      slug: row.slug || null, // nom dans l'adresse publique (/<nom>/<slug>, 27/09)
      accessMode: row.access_mode || 'public', // 'public' | 'password' | 'magic' (6/10) ; absent de la ligne renvoyée aux visiteurs
    };
  }

  // opts.ownerId : voir le commentaire équivalent dans api/tracks.js (listTracks) — même correctif
  // d'isolation multi-compositeur.
  async function listAdReels(opts) {
    let query = getClient().from('ad_reels').select(AD_REEL_SELECT);
    if (opts && opts.ownerId) query = query.eq('owner_id', opts.ownerId);
    const { data, error } = await query;
    if (error) return { adReels: null, error: error.message };
    return { adReels: data.map(reshapeAdReel), error: null };
  }

  // ownerId obligatoire depuis le renommage de clé (owner_id, id) — un id d'AdReel seul (ex. 'main')
  // n'identifie plus une ligne unique, tous compositeurs confondus.
  async function getAdReel(id, ownerId) {
    const { data, error } = await getClient().from('ad_reels').select(AD_REEL_SELECT).eq('id', id).eq('owner_id', ownerId).maybeSingle();
    if (error) return { adReel: null, error: error.message };
    return { adReel: reshapeAdReel(data), error: null };
  }

  // Voir le commentaire équivalent dans api/tracks.js (listTrackFolders) — même raison d'être.
  async function listAdReelFolders(opts) {
    let query = getClient().from('ad_reel_folders').select('*');
    if (opts && opts.ownerId) query = query.eq('owner_id', opts.ownerId);
    const { data, error } = await query;
    if (error) return { folders: null, error: error.message };
    return { folders: data.map(f => ({ id: f.id, label: f.label })), error: null };
  }

  async function upsertAdReel(payload) {
    const { data, error } = await getClient().rpc('upsert_ad_reel', { payload });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  }

  // Suppression réelle en base (25/09, voir 20260925020000_delete_my_catalog_items.sql) -- appelée par publishAll()
  // pour chaque élément présent en base au chargement mais retiré depuis dans le Backstage. Idempotente côté
  // serveur. blocked = true : refus volontaire (élément déjà acheté), pas une panne -- rien n'a été effacé.
  async function deleteAdReel(id) {
    const { error } = await getClient().rpc('delete_my_ad_reel', { p_id: id });
    if (error) return { ok: false, blocked: error.hint === 'blocked_sold', error: error.message };
    return { ok: true, blocked: false, error: null };
  }

  // Lien privé (6/10, migration 20261006010000). Page publique : mode d'accès d'un AdReel, puis l'AdReel contre le secret
  // (mot de passe tapé, ou jeton du lien magique). error : 'none' | 'wrong' | 'throttled' | message technique.
  async function getAdReelAccessMode(ownerId, adReelId) {
    const { data, error } = await getClient().rpc('get_ad_reel_access_mode', { p_owner_id: ownerId, p_ad_reel_id: adReelId });
    if (error) return { mode: null, error: error.message };
    return { mode: data || null, error: null };
  }
  async function getPrivateAdReel(ownerId, adReelId, secret) {
    const { data, error } = await getClient().rpc('get_private_ad_reel', { p_owner_id: ownerId, p_ad_reel_id: adReelId, p_secret: secret || '' });
    if (error) return { adReel: null, error: error.message };
    if (!data || !data.ok) return { adReel: null, error: (data && data.error) || 'none' };
    const adReel = reshapeAdReel(data.adReel);
    adReel.accessMode = 'private';
    return { adReel, error: null };
  }
  // Backstage : règle l'accès d'un AdReel déjà publié. mode 'public' | 'password' | 'magic' ; le jeton d'un lien magique n'est renvoyé qu'ici.
  async function setAdReelAccess(adReelId, mode, password) {
    const { data, error } = await getClient().rpc('set_ad_reel_access', { p_ad_reel_id: adReelId, p_mode: mode, p_password: password || null });
    if (error) return { ok: false, error: error.message, hint: error.hint || null };
    return { ok: true, mode: data.mode, token: data.token || null };
  }

  window.LayerPitchAdReels = { listAdReels, getAdReel, upsertAdReel, deleteAdReel, listAdReelFolders, getAdReelAccessMode, getPrivateAdReel, setAdReelAccess };
})();
