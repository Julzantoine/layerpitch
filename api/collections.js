// api/collections.js — LayerPitch, CRUD Collections via SDK Supabase (Décision 2,
// docs/infrastructure.md)
//
// Lecture directe (RLS "public read"). Écriture via la RPC upsert_collection (Session C, ajoutée
// le 1er septembre — même retard que upsert_sfx, voir api/sfx.js).

(function () {
  // Client Supabase partagé (api/supabase-client.js) — voir ce fichier pour le pourquoi.
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  const COLLECTION_SELECT = `*, collection_packs(pack_id, position)`;

  // Reconstruit la forme attendue par player.js/index.html (mêmes noms de champs que data.json).
  function reshapeCollection(row) {
    if (!row) return null;
    const packIds = [...(row.collection_packs || [])].sort((a, b) => a.position - b.position).map(r => r.pack_id);
    return {
      id: row.id, ownerId: row.owner_id, title: row.title, illustration: row.illustration,
      illustrationOriginalName: row.illustration_original_name,
      presentationFr: row.presentation_fr, presentationEn: row.presentation_en,
      bgColor: row.bg_color, textColor: row.text_color, font: row.font,
      buyable: row.buyable, buyUrl: row.buy_url, freeDownloadEnabled: row.free_download_enabled,
      packIds,
    };
  }

  // opts.ownerId : voir le commentaire équivalent dans api/tracks.js (listTracks) — même correctif
  // d'isolation multi-compositeur.
  async function listCollections(opts) {
    let query = getClient().from('collections').select(COLLECTION_SELECT);
    if (opts && opts.ownerId) query = query.eq('owner_id', opts.ownerId);
    const { data, error } = await query;
    if (error) return { collections: null, error: error.message };
    return { collections: data.map(reshapeCollection), error: null };
  }

  async function getCollection(id) {
    const { data, error } = await getClient().from('collections').select(COLLECTION_SELECT).eq('id', id).maybeSingle();
    if (error) return { collection: null, error: error.message };
    return { collection: reshapeCollection(data), error: null };
  }

  // payload : même forme qu'une collection de data.json (voir reshapeCollection ci-dessus).
  async function upsertCollection(payload) {
    const { data, error } = await getClient().rpc('upsert_collection', { payload });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  }

  window.LayerPitchCollections = { listCollections, getCollection, upsertCollection };
})();
