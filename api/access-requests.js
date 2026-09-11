// api/access-requests.js — LayerPitch, demandes d'accès à la bêta fermée (6 septembre).
//
// submitAccessRequest() : appelle l'Edge Function submit-access-request (pas la RPC
// submit_access_request seule -- toujours en base mais plus appelée par le front) : l'insertion
// seule ne suffit plus, un email de confirmation part aussi à la personne qui demande l'accès,
// dans sa langue (lang), ce qu'une simple fonction SQL ne peut pas faire (pas de secret Resend
// accessible depuis là). Utilisée par bienvenue.html (connexion refusée faute d'invitation) et,
// pour la lecture/traitement des demandes en attente, par le panneau admin du backstage.
// Voir supabase/migrations/20260906010000_access_requests.sql et
// supabase/functions/submit-access-request/index.ts.

(function () {
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  async function submitAccessRequest(email, source, intent, lang) {
    const { data, error } = await getClient().functions.invoke('submit-access-request', {
      body: { email, source, intent: intent || null, lang: lang || 'fr' },
    });
    if (error) return { ok: false, error: await window.LayerPitchAuth.describeFunctionError(error) };
    return { ok: !!(data && data.ok), error: data && data.error ? data.error : null };
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

  // Écarte une demande sans l'inviter (doublon, spam, déjà traitée autrement) -- distinct de
  // markAccessRequestInvited(), qui garde la ligne (invited_at) plutôt que de la supprimer.
  async function deleteAccessRequest(id) {
    const { error } = await getClient().rpc('admin_delete_access_request', { p_id: id });
    return { ok: !error, error: error ? error.message : null };
  }

  window.LayerPitchAccessRequests = { submitAccessRequest, getPendingAccessRequests, markAccessRequestInvited, deleteAccessRequest };
})();
