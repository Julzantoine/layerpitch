// api/invoices.js — LayerPitch, facturation légale des ventes de packs (mandat de facturation,
// art. 289 du CGI — chantier 4 septembre, voir stripe-webhook pour la génération).
//
// getInvoiceForPurchase(sessionId) : pour le polling de la page de succès pack.html juste après un
// paiement -- la génération de facture est asynchrone (déclenchée dans le webhook Stripe, jamais
// immédiate côté navigateur). getMyIssuedInvoices() : côté compositeur, ses propres factures
// émises (RLS "own issued invoices").

(function () {
  function getClient() { return window.LayerPitchSupabaseClient.getClient(); }

  // session_id n'est pas stocké directement sur pack_purchases/invoices -- on retrouve l'achat via
  // stripe_payment_intent_id, lui-même dérivé de la session par Stripe (payment_intent), donc on
  // passe par pack_purchases pour le lookup plutôt que de dupliquer session_id en base.
  async function getInvoiceForPurchase(stripePaymentIntentId) {
    const { data: purchase, error: purchaseError } = await getClient()
      .from('pack_purchases')
      .select('id, invoice_id')
      .eq('stripe_payment_intent_id', stripePaymentIntentId)
      .maybeSingle();
    if (purchaseError) return { invoice: null, error: purchaseError.message };
    if (!purchase || !purchase.invoice_id) return { invoice: null, error: null };
    const { data: invoice, error: invoiceError } = await getClient()
      .from('invoices')
      .select('id, invoice_number, document_type, pdf_storage_path')
      .eq('id', purchase.invoice_id)
      .maybeSingle();
    if (invoiceError) return { invoice: null, error: invoiceError.message };
    return { invoice: invoice || null, error: null };
  }

  async function getMyIssuedInvoices() {
    const { data, error } = await getClient()
      .from('invoices')
      .select('id, invoice_number, document_type, pdf_storage_path, amount_ttc, created_at')
      .order('created_at', { ascending: false });
    if (error) return { invoices: [], error: error.message };
    return { invoices: data || [], error: null };
  }

  window.LayerPitchInvoices = { getInvoiceForPurchase, getMyIssuedInvoices };
})();
