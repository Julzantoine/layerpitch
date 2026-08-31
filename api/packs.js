// api/packs.js — LayerPitch, CRUD packs via SDK Supabase (Décision 2, docs/infrastructure.md)
//
// Lecture directe (RLS "public read"). Écriture via la RPC upsert_pack (remplace atomiquement
// pack_tracks/pack_sfx à chaque appel — voir supabase/migrations pour le détail).

(function () {
  const SUPABASE_URL = 'https://ypygllyjfynrnvapufow.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bpjR1M-no9BaxD6QjwcNlQ_og_IgcRb';

  let client = null;
  function getClient() {
    if (!client) {
      if (!window.supabase || !window.supabase.createClient) {
        throw new Error('SDK Supabase non chargé — ajouter le <script> UMD avant api/packs.js.');
      }
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    }
    return client;
  }

  const PACK_SELECT = `*, pack_tracks(track_id, position), pack_sfx(sfx_id, position)`;

  function reshapePack(row) {
    if (!row) return null;
    const trackIds = [...(row.pack_tracks || [])].sort((a, b) => a.position - b.position).map(r => r.track_id);
    const sfxIds = [...(row.pack_sfx || [])].sort((a, b) => a.position - b.position).map(r => r.sfx_id);
    return {
      id: row.id, title: row.title, illustration: row.illustration,
      illustrationOriginalName: row.illustration_original_name, watermark: row.watermark,
      watermarkOriginalName: row.watermark_original_name, presentationFr: row.presentation_fr,
      presentationEn: row.presentation_en, buyable: row.buyable, buyUrl: row.buy_url,
      freeDownloadEnabled: row.free_download_enabled, videoTestModeEnabled: row.video_test_mode_enabled,
      bgColor: row.bg_color, textColor: row.text_color, font: row.font, trackIds, sfxIds,
      linkedAdReelId: row.linked_ad_reel_id, tags: row.tags, priceUsdCents: row.price_usd_cents,
    };
  }

  async function listPacks() {
    const { data, error } = await getClient().from('packs').select(PACK_SELECT);
    if (error) return { packs: null, error: error.message };
    return { packs: data.map(reshapePack), error: null };
  }

  async function getPack(id) {
    const { data, error } = await getClient().from('packs').select(PACK_SELECT).eq('id', id).maybeSingle();
    if (error) return { pack: null, error: error.message };
    return { pack: reshapePack(data), error: null };
  }

  async function upsertPack(payload) {
    const { data, error } = await getClient().rpc('upsert_pack', { payload });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  }

  window.LayerPitchPacks = { listPacks, getPack, upsertPack };
})();
