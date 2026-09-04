// api/connect.js — LayerPitch, Stripe Connect compositeur (versement automatique à la vente,
// chantier 4 septembre).
//
// startConnectOnboarding() appelle l'Edge Function create-connect-onboarding-link puis redirige
// vers Stripe. myConnectStatus() lit composer_profiles directement (RLS : own profile only) --
// jamais d'appel à l'API Stripe depuis le client, toujours l'état local synchronisé par le webhook
// (account.updated). saveMyBillingProfile()/getMyBillingProfile() : profil de facturation
// déclaratif requis pour qu'un pack devienne achetable (voir create-checkout-session).

(function () {
  function getClient() { return window.LayerPitchSupabaseClient.getClient(); }

  async function startConnectOnboarding({ returnUrl, refreshUrl } = {}) {
    const { data, error } = await getClient().functions.invoke('create-connect-onboarding-link', {
      body: { returnUrl, refreshUrl },
    });
    if (error) return { ok: false, error: await window.LayerPitchAuth.describeFunctionError(error) };
    if (!data || !data.url) return { ok: false, error: data && data.error ? data.error : 'Réponse inattendue.' };
    window.location.href = data.url;
    return { ok: true };
  }

  async function myConnectStatus() {
    const { data, error } = await getClient()
      .from('composer_profiles')
      .select('stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled')
      .maybeSingle();
    if (error) return { status: null, error: error.message };
    if (!data) return { status: null, error: null };
    return {
      status: {
        connected: !!data.stripe_connect_account_id,
        chargesEnabled: !!data.stripe_connect_charges_enabled,
        payoutsEnabled: !!data.stripe_connect_payouts_enabled,
      },
      error: null,
    };
  }

  async function getMyBillingProfile() {
    const { data, error } = await getClient()
      .from('composer_profiles')
      .select('billing_status, billing_legal_name, billing_address, billing_siret, billing_vat_number, billing_vat_applicable')
      .maybeSingle();
    if (error) return { profile: null, error: error.message };
    return { profile: data || null, error: null };
  }

  async function saveMyBillingProfile({ status, legalName, address, siret, vatNumber, vatApplicable }) {
    const { error } = await getClient().rpc('update_my_billing_profile', {
      p_status: status, p_legal_name: legalName, p_address: address,
      p_siret: siret || null, p_vat_number: vatNumber || null, p_vat_applicable: !!vatApplicable,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  window.LayerPitchConnect = { startConnectOnboarding, myConnectStatus, getMyBillingProfile, saveMyBillingProfile };
})();
