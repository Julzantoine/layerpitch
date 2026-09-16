// api/invites.js — LayerPitch, historique des invitations bêta envoyées (16 septembre).
//
// getInvites() lit la RPC get_invites (admin uniquement, vérifié côté RPC via is_admin()) --
// chaque ligne est enregistrée par l'Edge Function invite-tester elle-même juste après l'envoi
// réussi de l'email (voir api/auth.js inviteTester()), jamais depuis ce fichier.
// Voir supabase/migrations/20260916070000_invites.sql.

(function () {
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  // Admin uniquement -- renvoie [] silencieusement pour un compte non-admin, la RPC elle-même
  // filtrant déjà via is_admin() dans son WHERE (même principe que getPendingAccessRequests).
  async function getInvites() {
    const { data, error } = await getClient().rpc('get_invites');
    if (error) return { invites: [], error: error.message };
    return { invites: data || [], error: null };
  }

  window.LayerPitchInvites = { getInvites };
})();
