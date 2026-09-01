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
  // construisent leur propre objet champ par champ) : nécessaire aux pages publiques pour
  // découvrir le compositeur d'un AdReel avant de charger le reste de son catalogue scopé — voir
  // le commentaire d'isolation multi-compositeur dans api/tracks.js (listTracks).
  function reshapeAdReel(row) {
    if (!row) return null;
    const trackIds = [...(row.ad_reel_tracks || [])].sort((a, b) => a.position - b.position).map(r => r.track_id);
    return {
      id: row.id, ownerId: row.owner_id, folderId: row.folder_id, label: row.label, lang: row.lang, blocks: row.blocks,
      profile: row.profile, testimonials: row.testimonials, trackIds, trackOverrides: row.track_overrides,
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

  async function getAdReel(id) {
    const { data, error } = await getClient().from('ad_reels').select(AD_REEL_SELECT).eq('id', id).maybeSingle();
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

  window.LayerPitchAdReels = { listAdReels, getAdReel, upsertAdReel, listAdReelFolders };
})();
