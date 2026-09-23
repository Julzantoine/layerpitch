// api/analytics.js — LayerPitch, tableau de bord analytique compositeur (chantier du 5 septembre,
// système propriétaire Postgres -- remplace une première piste envisagée, l'API Umami Cloud,
// abandonnée avant d'être codée : accès API réservé à son plan payant, dépendance externe hors de
// la philosophie du reste de LayerPitch. Voir supabase/migrations/20260905010000_composer_analytics_events.sql).
//
// getMyAnalytics() et logAnalyticsEvent() appellent directement des RPC Postgres (get_my_analytics /
// log_analytics_event) -- pas d'Edge Function, pas de secret à gérer, cohérent avec le reste du
// produit (RPC pour la logique métier). Le gating par palier (Free = aucune donnée, Starter =
// sessions seulement, Pro = détail complet) est fait DANS get_my_analytics(), pas ici -- ce module
// se contente de relayer ce qu'elle renvoie.

(function () {
  function getClient() { return window.LayerPitchSupabaseClient.getClient(); }

  // { from, to } (ISO) optionnels -- honorés par la fonction seulement pour le palier Pro (seul
  // palier avec filtre temporel dans la grille validée), ignorés sinon.
  async function getMyAnalytics({ from, to } = {}) {
    const { data, error } = await getClient().rpc('get_my_analytics', { p_from: from || null, p_to: to || null });
    if (error) return { analytics: null, error: error.message };
    if (!data || !data.ok) return { analytics: null, error: 'Réponse inattendue.' };
    return { analytics: data, error: null };
  }

  // Fire-and-forget depuis les pages publiques, jamais authentifié (RPC accessible à `anon`), jamais
  // bloquant -- même philosophie que trackPublicEvent (player.js), qui l'appelle. ownerId (déjà
  // résolu par loadSiteData(), voir index.html/pack.html) lève l'ambiguïté d'id d'AdReel entre deux
  // compositeurs (ex. 'main') côté base -- un indice vérifié contre une vraie ligne, jamais gobé tel
  // quel (voir la fonction SQL). Optionnel : absent sur le chemin historique sans handle.
  async function logAnalyticsEvent(entityType, entityId, sessionId, eventName, detail, device, ownerId) {
    try {
      await getClient().rpc('log_analytics_event', {
        p_entity_type: entityType, p_entity_id: entityId, p_session_id: sessionId,
        p_event_name: eventName, p_detail: detail || {}, p_device: device || null,
        p_owner_id: ownerId || null,
      });
    } catch (e) { /* jamais bloquant */ }
  }


  // Vue d'ensemble dans le temps + détail d'un AdReel/pack (23 septembre, refonte de la page
  // Analytics du backstage). Le gating par palier est fait dans les fonctions SQL (Free : verrouillé ;
  // Starter : visites seulement ; Pro : lectures, morceaux, interactions) -- ce module relaie.
  // bucket : 'hour' | 'day' | 'week' | 'month' ; tz : fuseau IANA du navigateur (jours alignés sur
  // l'heure locale du compositeur).
  function localTimeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
  }
  async function getMyAnalyticsOverview({ from, to, bucket, tz } = {}) {
    const { data, error } = await getClient().rpc('get_my_analytics_overview', {
      p_from: from || null, p_to: to || null, p_bucket: bucket || 'day', p_tz: tz || localTimeZone(),
    });
    if (error) return { overview: null, error: error.message };
    if (!data || !data.ok) return { overview: null, error: 'Réponse inattendue.' };
    return { overview: data, error: null };
  }
  async function getMyAnalyticsEntity(type, id, { from, to, bucket, tz } = {}) {
    const { data, error } = await getClient().rpc('get_my_analytics_entity', {
      p_type: type, p_id: id, p_from: from || null, p_to: to || null, p_bucket: bucket || 'day', p_tz: tz || localTimeZone(),
    });
    if (error) return { entity: null, error: error.message };
    if (!data || !data.ok) return { entity: null, error: 'Réponse inattendue.' };
    return { entity: data, error: null };
  }

  window.LayerPitchAnalytics = { getMyAnalytics, getMyAnalyticsOverview, getMyAnalyticsEntity, logAnalyticsEvent };
})();
