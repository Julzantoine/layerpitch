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
  async function getStats(period) {
    const { data, error } = await getClient().rpc('admin_get_stats', { p_period: period || null });
    if (error) return { stats: null, error: error.message };
    return { stats: data, error: null };
  }

  // Courbe d'evolution dans le temps (22 septembre) : mêmes métriques que "nouveaux sur la
  // période" ci-dessus, mais regroupées par semaine/mois plutôt qu'un seul total — voir
  // admin_get_growth_series() (aucune table d'événements, uniquement created_at déjà existant).
  async function getGrowthSeries(granularity, periods) {
    const { data, error } = await getClient().rpc('admin_get_growth_series', {
      p_granularity: granularity || 'week',
      p_periods: periods || 12,
    });
    if (error) return { growth: null, error: error.message };
    return { growth: data, error: null };
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
  // platform_settings — 7 septembre). Historique complet, messages diffusés ET personnels : lu par
  // admin_list_messages() (8 octobre) plutôt qu'en direct, car la règle de lecture de la table ne
  // montre à un compte que les messages diffusés ou adressés à lui -- un message adressé à un autre
  // compte serait invisible (et impossible à supprimer) pour l'admin qui l'a envoyé.
  async function listAdminMessages() {
    const { data, error } = await getClient().rpc('admin_list_messages');
    if (error) return { messages: null, error: error.message };
    return {
      messages: (data || []).map(m => ({
        id: m.id, body: m.body || {}, title: m.title || {}, createdAt: m.created_at,
        existingAccountsOnly: !!m.existing_accounts_only,
        recipientId: m.recipient_id || null, recipientEmail: m.recipient_email || null, emailNotify: !!m.email_notify,
      })),
      error: null,
    };
  }

  // messages : { <code langue>: <texte> }, ex. { fr: '...', en: '...' } — même structure ouverte au
  // nombre de langues que l'ancien bandeau. existingAccountsOnly (20 septembre) : le message reste
  // une seule ligne diffusée mais n'est visible que des comptes créés avant l'envoi (voir
  // supabase/migrations/20260920010000_admin_messages_existing_accounts_only.sql).
  // titles (21 septembre, optionnel) : même forme { <code langue>: <titre> } ; les langues laissées
  // vides sont écartées, et si aucune n'est renseignée le paramètre n'est pas envoyé du tout (le
  // message retombe sur le titre générique côté backstage).
  // recipientIds (8 octobre, optionnel) : liste d'identifiants de compte ; vide ou absente = message
  // diffusé à tous (comportement historique). Sinon un message personnel par compte (admin_send_message
  // accepte un seul p_recipient_id), envoyés un par un : si l'un échoue les autres déjà partis le
  // restent, et la réponse dit combien sont partis (sent) pour que l'admin ne les renvoie pas.
  // Un envoi ciblé n'est jamais « comptes existants uniquement » (sans objet pour un compte précis).
  // emailNotify (8 octobre) : pour un envoi ciblé seulement, demande aussi l'e-mail de notification
  // (sans effet sur une diffusion, qui en envoie toujours un).
  async function sendAdminMessage(messages, existingAccountsOnly, titles, recipientIds, emailNotify) {
    const cleanTitles = {};
    Object.keys(titles || {}).forEach(code => { const t = String(titles[code] || '').trim(); if (t) cleanTitles[code] = t; });
    const targets = Array.isArray(recipientIds) && recipientIds.length > 0 ? recipientIds : [null];
    let sent = 0;
    for (const recipientId of targets) {
      const params = { p_messages: messages, p_existing_accounts_only: recipientId ? false : !!existingAccountsOnly };
      if (recipientId) { params.p_recipient_id = recipientId; if (emailNotify) params.p_email_notify = true; }
      if (Object.keys(cleanTitles).length > 0) params.p_titles = cleanTitles;
      const { error } = await getClient().rpc('admin_send_message', params);
      if (error) return { ok: false, error: error.message, sent };
      sent++;
    }
    return { ok: true, error: null, sent };
  }

  async function deleteAdminMessage(id) {
    const { error } = await getClient().rpc('admin_delete_message', { p_id: id });
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  }

  // Rapport des AdReels de tous les compositeurs (4/10) : chiffres et liens, sans e-mail ni contenu (admin_adreels_report).
  async function getAdReelsReport() {
    const { data, error } = await getClient().rpc('admin_adreels_report');
    if (error) return { report: null, error: error.message };
    return { report: data || [], error: null };
  }

  window.LayerPitchAdmin = { getAdReelsReport, getStats, getGrowthSeries, listAccounts, listAdminMessages, sendAdminMessage, deleteAdminMessage };
})();
