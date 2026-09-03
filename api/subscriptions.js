// api/subscriptions.js — LayerPitch, abonnement compositeur (chantier 4b, docs/infrastructure.md
// — décisions du 3 septembre : essai reverse trial, tarification mensuelle/annuelle).
//
// subscribeToPlan() appelle l'Edge Function create-subscription-checkout-session (jamais Stripe
// directement — le prix doit toujours venir de Postgres, jamais du client) puis redirige vers
// Stripe Checkout. getTrialStatus() lit le palier/essai du compte connecté (RPC get_trial_status).
// La confirmation d'abonnement elle-même n'est jamais écrite par le client — seul le webhook
// Stripe (stripe-webhook) écrit composer_profiles.plan.

(function () {
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  // Démarre une souscription payante : ouvre une session Stripe Checkout et redirige le
  // navigateur. plan : 'starter' | 'pro'. interval : 'month' | 'year'.
  async function subscribeToPlan(plan, interval, { successUrl, cancelUrl } = {}) {
    const { data, error } = await getClient().functions.invoke('create-subscription-checkout-session', {
      body: { plan, interval, successUrl, cancelUrl },
    });
    // error.message du SDK pour une Edge Function en échec est générique ("Edge Function returned
    // a non-2xx status code") -- describeFunctionError() (api/auth.js) relit le vrai message JSON
    // renvoyé par la fonction, même correctif que celui trouvé le 1er septembre pour invite-tester.
    if (error) return { ok: false, error: await window.LayerPitchAuth.describeFunctionError(error) };
    if (!data || !data.url) return { ok: false, error: data && data.error ? data.error : 'Réponse inattendue.' };
    window.location.href = data.url; // redirection vers Stripe Checkout
    return { ok: true };
  }

  // Passe directement au palier Free (aucune interaction Stripe) — RPC choose_free_plan().
  async function choosePlanFree() {
    const { error } = await getClient().rpc('choose_free_plan');
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  // Palier réel + fin d'essai (reverse trial) du compte connecté — RPC get_trial_status().
  async function getTrialStatus() {
    const { data, error } = await getClient().rpc('get_trial_status');
    if (error) return { status: null, error: error.message };
    const row = Array.isArray(data) ? data[0] : data;
    return {
      status: row ? { plan: row.plan, trialEndsAt: row.trial_ends_at } : null,
      error: null,
    };
  }

  window.LayerPitchSubscriptions = { subscribeToPlan, choosePlanFree, getTrialStatus };
})();
