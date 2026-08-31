// api/adreels.js — LayerPitch, CRUD AdReels via SDK Supabase (Décision 2, docs/infrastructure.md)
//
// Lecture directe (RLS "public read"). Écriture via la RPC upsert_ad_reel (remplace atomiquement
// ad_reel_tracks à chaque appel — voir supabase/migrations pour le détail).

(function () {
  const SUPABASE_URL = 'https://ypygllyjfynrnvapufow.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bpjR1M-no9BaxD6QjwcNlQ_og_IgcRb';

  let client = null;
  function getClient() {
    if (!client) {
      if (!window.supabase || !window.supabase.createClient) {
        throw new Error('SDK Supabase non chargé — ajouter le <script> UMD avant api/adreels.js.');
      }
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    }
    return client;
  }

  const AD_REEL_SELECT = `*, ad_reel_tracks(track_id, position)`;

  function reshapeAdReel(row) {
    if (!row) return null;
    const trackIds = [...(row.ad_reel_tracks || [])].sort((a, b) => a.position - b.position).map(r => r.track_id);
    return {
      id: row.id, folderId: row.folder_id, label: row.label, lang: row.lang, blocks: row.blocks,
      profile: row.profile, testimonials: row.testimonials, trackIds, trackOverrides: row.track_overrides,
    };
  }

  async function listAdReels() {
    const { data, error } = await getClient().from('ad_reels').select(AD_REEL_SELECT);
    if (error) return { adReels: null, error: error.message };
    return { adReels: data.map(reshapeAdReel), error: null };
  }

  async function getAdReel(id) {
    const { data, error } = await getClient().from('ad_reels').select(AD_REEL_SELECT).eq('id', id).maybeSingle();
    if (error) return { adReel: null, error: error.message };
    return { adReel: reshapeAdReel(data), error: null };
  }

  async function upsertAdReel(payload) {
    const { data, error } = await getClient().rpc('upsert_ad_reel', { payload });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  }

  window.LayerPitchAdReels = { listAdReels, getAdReel, upsertAdReel };
})();
