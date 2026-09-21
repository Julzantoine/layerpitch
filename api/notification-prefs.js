// api/notification-prefs.js — LayerPitch, préférences de notification par email (21 septembre).
//
// Quand Jules-Antoine envoie une annonce depuis le panneau admin, un email part aux testeurs
// (Edge Function notify-admin-message). Deux préférences de compte servent à ça : la langue du
// backstage (pour écrire l'email dans la bonne langue -- jusqu'ici uniquement en localStorage) et
// la possibilité de ne plus recevoir ces emails. Voir
// supabase/migrations/20260921020000_announcement_emails.sql.

(function () {
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  // Enregistre la langue du backstage sur le compte. Silencieux en cas d'échec : c'est un confort
  // (email dans la bonne langue), jamais quelque chose qui doit gêner l'ouverture du backstage.
  async function syncMyLang(lang) {
    if (lang !== 'fr' && lang !== 'en') return;
    try { await getClient().rpc('set_my_lang', { p_lang: lang }); } catch (e) { /* voir ci-dessus */ }
  }

  async function getMyPrefs() {
    const { data, error } = await getClient().rpc('get_my_notification_prefs');
    if (error) return { prefs: null, error: error.message };
    const row = Array.isArray(data) ? data[0] : data;
    return { prefs: row ? { emailAnnouncements: row.email_announcements !== false, lang: row.lang || null } : null, error: null };
  }

  async function setEmailAnnouncements(enabled) {
    const { error } = await getClient().rpc('set_my_email_announcements', { p_enabled: !!enabled });
    return { ok: !error, error: error ? error.message : null };
  }

  window.LayerPitchNotificationPrefs = { syncMyLang, getMyPrefs, setEmailAnnouncements };
})();
