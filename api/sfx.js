// api/sfx.js — LayerPitch, CRUD Sfx via SDK Supabase (Décision 2, docs/infrastructure.md)
//
// Lecture directe (RLS "public read"). Écriture via la RPC upsert_sfx (Session C, ajoutée le
// 1er septembre — construite plus tard que upsert_track/upsert_pack/upsert_ad_reel, faute de
// besoin avant la conversion des Sfx dans le backstage en ligne).

(function () {
  // Client Supabase partagé (api/supabase-client.js) — voir ce fichier pour le pourquoi.
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  // Reconstruit la forme attendue par player.js/index.html (mêmes noms de champs que data.json).
  function reshapeSfx(row) {
    if (!row) return null;
    return {
      id: row.id, folderId: row.folder_id, title: row.title,
      descriptionFr: row.description_fr, descriptionEn: row.description_en,
      rrMode: row.rr_mode, duckMainTrack: row.duck_main_track, base: row.base,
      alternatives: row.alternatives,
    };
  }

  // opts.ownerId : voir le commentaire équivalent dans api/tracks.js (listTracks) — même correctif
  // d'isolation multi-compositeur.
  async function listSfx(opts) {
    let query = getClient().from('sfx_library').select('*');
    if (opts && opts.ownerId) query = query.eq('owner_id', opts.ownerId);
    const { data, error } = await query;
    if (error) return { sfx: null, error: error.message };
    return { sfx: data.map(reshapeSfx), error: null };
  }

  async function getSfx(id) {
    const { data, error } = await getClient().from('sfx_library').select('*').eq('id', id).maybeSingle();
    if (error) return { sfx: null, error: error.message };
    return { sfx: reshapeSfx(data), error: null };
  }

  // Voir le commentaire équivalent dans api/tracks.js (listTrackFolders) — même raison d'être.
  async function listSfxFolders(opts) {
    let query = getClient().from('sfx_folders').select('*');
    if (opts && opts.ownerId) query = query.eq('owner_id', opts.ownerId);
    const { data, error } = await query;
    if (error) return { folders: null, error: error.message };
    return { folders: data.map(f => ({ id: f.id, label: f.label })), error: null };
  }

  // payload : même forme qu'un Sfx de data.json (voir reshapeSfx ci-dessus pour le mapping inverse).
  async function upsertSfx(payload) {
    const { data, error } = await getClient().rpc('upsert_sfx', { payload });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  }

  window.LayerPitchSfx = { listSfx, getSfx, listSfxFolders, upsertSfx };
})();
