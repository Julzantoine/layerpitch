// api/purchases.js — LayerPitch, achats de packs (étape 4, docs/infrastructure.md)
//
// buyPack() appelle l'Edge Function create-checkout-session (jamais Stripe directement — le prix
// doit toujours venir de Postgres, jamais du client) puis redirige vers Stripe Checkout.
// myPurchases() lit pack_purchases directement (RLS : chacun ne voit que ses propres achats).
// La confirmation d'achat elle-même n'est jamais écrite par le client — seul le webhook Stripe
// (stripe-webhook, déclenché par Stripe après paiement réel) écrit dans pack_purchases.

(function () {
  // Client Supabase partagé (api/supabase-client.js) — voir ce fichier pour le pourquoi.
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  // Démarre un achat : ouvre une session Stripe Checkout pour ce pack et redirige le navigateur.
  // successUrl/cancelUrl optionnels (défauts côté Edge Function).
  async function buyPack(packId, { successUrl, cancelUrl } = {}) {
    const { data, error } = await getClient().functions.invoke('create-checkout-session', {
      body: { packId, successUrl, cancelUrl },
    });
    if (error) return { ok: false, error: error.message };
    if (!data || !data.url) return { ok: false, error: data && data.error ? data.error : 'Réponse inattendue.' };
    window.location.href = data.url; // redirection vers Stripe Checkout
    return { ok: true };
  }

  // Bibliothèque acheteur : packs achetés par l'utilisateur connecté (RLS : own purchases only).
  async function myPurchases() {
    const { data, error } = await getClient()
      .from('pack_purchases')
      .select('id, pack_id, purchased_at, price_paid, packs(id, title, illustration)')
      .order('purchased_at', { ascending: false });
    if (error) return { purchases: null, error: error.message };
    return {
      purchases: data.map(r => ({
        purchaseId: r.id, packId: r.pack_id, purchasedAt: r.purchased_at, pricePaid: r.price_paid,
        pack: r.packs ? { id: r.packs.id, title: r.packs.title, illustration: r.packs.illustration } : null,
      })),
      error: null,
    };
  }

  window.LayerPitchPurchases = { buyPack, myPurchases };
})();
