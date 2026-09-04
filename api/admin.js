// api/admin.js — LayerPitch, lecture agrégée admin (statistiques, liste de comptes, bandeau
// d'annonce) via RPC SECURITY DEFINER gated is_admin() (docs/infrastructure.md, "Rôle admin...
// actée le 3 septembre). Écritures de suspension : voir api/auth.js (Edge Function dédiée) —
// service_role bypass RLS, pas de RPC pour cette partie-là.

(function () {
  // Client Supabase partagé (api/supabase-client.js) — voir ce fichier pour le pourquoi.
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  // Statistiques agrégées v1 (docs/infrastructure.md, correction du 3 septembre) : comptages et
  // moyennes sur les tables catalogue existantes uniquement — pas de "tendances de modes de
  // lecture" (reporté, aucune table d'événements aujourd'hui).
  async function getStats() {
    const { data, error } = await getClient().rpc('admin_get_stats');
    if (error) return { stats: null, error: error.message };
    return { stats: data, error: null };
  }

  async function listAccounts(search) {
    const { data, error } = await getClient().rpc('admin_list_accounts', { p_search: search || null });
    if (error) return { accounts: null, error: error.message };
    return {
      accounts: (data || []).map(row => ({
        profileId: row.profile_id, email: row.email, createdAt: row.created_at,
        isComposer: row.is_composer, composerHandle: row.composer_handle,
        isStudio: row.is_studio, isFan: row.is_fan,
        suspended: row.suspended, bannedUntil: row.banned_until,
      })),
      error: null,
    };
  }

  // Bandeau multilingue, structure ouverte au nombre de langues (docs/infrastructure.md, retour du
  // 3 septembre après premier test réel) : messages = { <code langue>: <texte> }, une clé par
  // langue — ajouter une langue au bandeau plus tard n'a pas besoin de toucher ce fichier.
  async function getPlatformNotice() {
    const { data, error } = await getClient().from('platform_settings').select('notice_messages, notice_updated_at').eq('id', true).maybeSingle();
    if (error) return { notice: null, error: error.message };
    return {
      notice: data ? { messages: data.notice_messages || {}, updatedAt: data.notice_updated_at } : null,
      error: null,
    };
  }

  // messages : { <code langue>: <texte> }, ex. { fr: '...', en: '...' }.
  async function setPlatformNotice(messages) {
    const { error } = await getClient().rpc('set_platform_notice', { p_messages: messages });
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  }

  window.LayerPitchAdmin = { getStats, listAccounts, getPlatformNotice, setPlatformNotice };
})();
