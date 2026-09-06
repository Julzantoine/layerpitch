// api/access-requests.js — LayerPitch, demandes d'accès à la bêta fermée (6 septembre).
//
// submitAccessRequest() : appelable sans session (RPC anon), utilisée à la fois par bienvenue.html
// (tentative de connexion refusée faute d'invitation) et par le panneau admin du backstage pour la
// lecture/traitement des demandes en attente. Voir supabase/migrations/20260906010000_access_requests.sql.

(function () {
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  async function submitAccessRequest(email, source, intent) {
    const { error } = await getClient().rpc('submit_access_request', { p_email: email, p_source: source, p_intent: intent || null });
    return { ok: !error, error: error ? error.message : null };
  }

  // Admin uniquement (is_admin(), vérifié côté RPC) -- renvoie [] silencieusement pour un compte
  // non-admin plutôt qu'une erreur, la RPC elle-même filtrant déjà via is_admin() dans son WHERE.
  async function getPendingAccessRequests() {
    const { data, error } = await getClient().rpc('get_pending_access_requests');
    if (error) return { requests: [], error: error.message };
    return { requests: data || [], error: null };
  }

  async function markAccessRequestInvited(id) {
    const { error } = await getClient().rpc('mark_access_request_invited', { p_id: id });
    return { ok: !error, error: error ? error.message : null };
  }

  window.LayerPitchAccessRequests = { submitAccessRequest, getPendingAccessRequests, markAccessRequestInvited };
})();
