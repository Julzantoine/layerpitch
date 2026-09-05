// api/settings.js — LayerPitch, CRUD réglages personnels + réseaux sociaux via SDK Supabase
// (Décision 2, docs/infrastructure.md)
//
// `settings`/`socials` sont personnels par compositeur depuis le 1er septembre (une ligne par
// `owner_id`, plus un singleton global — trouvé en préparant l'authentification des testeurs,
// confirmé par Jules-Antoine : ces réglages ne doivent jamais être partagés entre compositeurs).
// Lecture via filtre `owner_id` (RLS reste "public read", cohérent avec le reste du schéma — le
// site public doit rester consultable sans compte). Écriture via les RPC upsert_settings/
// upsert_socials, ownership vérifiée côté serveur comme les autres RPC upsert_*.

(function () {
  // Client Supabase partagé (api/supabase-client.js) — voir ce fichier pour le pourquoi.
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  // ownerId obligatoire (plus de singleton global — voir en-tête de fichier).
  async function getSettings(ownerId) {
    if (!ownerId) throw new Error('getSettings() : ownerId obligatoire (réglages personnels par compositeur).');
    const { data, error } = await getClient().from('settings').select('*').eq('owner_id', ownerId).maybeSingle();
    if (error) return { settings: null, error: error.message };
    if (!data) return { settings: null, error: null };
    return {
      settings: {
        publishedAt: data.published_at,
        implementationSkills: data.implementation_skills,
        noAiCertifiedGlobal: data.no_ai_certified_global,
        customFonts: data.custom_fonts,
        waveformStyle: data.waveform_style,
      },
      error: null,
    };
  }

  async function listSocials(ownerId) {
    if (!ownerId) throw new Error('listSocials() : ownerId obligatoire (réglages personnels par compositeur).');
    const { data, error } = await getClient().from('socials').select('*').eq('owner_id', ownerId).order('position');
    if (error) return { socials: null, error: error.message };
    return { socials: data.map(row => ({ id: row.id, platform: row.platform, url: row.url })), error: null };
  }

  // payload : { publishedAt, implementationSkills, noAiCertifiedGlobal, customFonts, waveformStyle } — même forme
  // que la partie correspondante de data.json.
  async function upsertSettings(payload) {
    const { data, error } = await getClient().rpc('upsert_settings', { payload });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  }

  // payload : { socials: [{id, platform, url}, ...] } — remplace la liste complète du compositeur.
  async function upsertSocials(payload) {
    const { data, error } = await getClient().rpc('upsert_socials', { payload });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  }

  window.LayerPitchSettings = { getSettings, listSocials, upsertSettings, upsertSocials };
})();
