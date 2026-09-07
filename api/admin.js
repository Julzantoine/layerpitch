// api/admin.js — LayerPitch, lecture agrégée admin (statistiques, liste de comptes, boîte de
// réception des compositeurs) via RPC SECURITY DEFINER gated is_admin() (docs/infrastructure.md,
// "Rôle admin... actée le 3 septembre"). Écritures de suspension : voir api/auth.js (Edge Function
// dédiée) — service_role bypass RLS, pas de RPC pour cette partie-là.

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

  // Boîte de réception des compositeurs (admin_messages, remplace l'ancien bandeau plein écran
  // platform_settings — 7 septembre, retour de Jules-Antoine : une boîte qui déclenche une notif
  // plutôt qu'un bandeau qui écrase le message précédent). Historique complet, broadcast à tous les
  // compositeurs (pas de ciblage individuel — décision actée le 7 septembre). Lecture directe (RLS
  // "public read", même convention que platform_settings) : pas besoin de RPC, is_admin() n'entre
  // en jeu que pour l'écriture.
  async function listAdminMessages() {
    const { data, error } = await getClient().from('admin_messages').select('id, body, created_at').order('created_at', { ascending: false }).limit(50);
    if (error) return { messages: null, error: error.message };
    return {
      messages: (data || []).map(m => ({ id: m.id, body: m.body || {}, createdAt: m.created_at })),
      error: null,
    };
  }

  // messages : { <code langue>: <texte> }, ex. { fr: '...', en: '...' } — même structure ouverte au
  // nombre de langues que l'ancien bandeau.
  async function sendAdminMessage(messages) {
    const { error } = await getClient().rpc('admin_send_message', { p_messages: messages });
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  }

  async function deleteAdminMessage(id) {
    const { error } = await getClient().rpc('admin_delete_message', { p_id: id });
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  }

  window.LayerPitchAdmin = { getStats, listAccounts, listAdminMessages, sendAdminMessage, deleteAdminMessage };
})();
