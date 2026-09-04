// supabase/functions/stripe-webhook/index.ts — LayerPitch, étape 4 (achat unitaire) + Stripe
// Billing compositeur (chantier 4b) + Stripe Connect/facturation légale (chantier 4 septembre).
//
// Reçoit les événements Stripe (paiement/abonnement confirmé côté Stripe, pas côté client — un
// client ne doit jamais pouvoir déclarer lui-même "j'ai payé"). Écrit avec la clé service_role
// (aucun contexte utilisateur dans un appel webhook).
//
// Vérification de signature : deux secrets possibles, l'un après l'autre. Stripe ne permet pas de
// recevoir les événements "sur le compte" (checkout.session.completed, customer.subscription.*) et
// les événements "Connect" (account.updated) sur un seul endpoint configuré -- il faut deux entrées
// d'endpoint côté dashboard Stripe (portées différentes), chacune avec son propre secret de
// signature, mais rien n'empêche les deux de pointer vers cette même URL/ce même fichier.
//
// Quatre cas distincts, tous idempotents par construction :
// - checkout.session.completed en mode 'payment' (packId/studioId dans les metadata) : achat
//   unitaire studio, upsert dans pack_purchases sur stripe_payment_intent_id (unique côté Stripe),
//   puis génération de la facture/attestation de vente (voir generateInvoiceForPurchase) --
//   seulement si l'upsert a réellement inséré une nouvelle ligne (pas un renvoi Stripe du même
//   événement), pour ne jamais générer deux factures pour un même achat.
// - checkout.session.completed en mode 'subscription' (composerAuthId/plan dans les metadata) :
//   Stripe Billing compositeur, écrit composer_profiles.plan -- idempotent par nature (un même
//   composer_profile ne peut avoir qu'un seul plan, un renvoi du même événement écrit deux fois la
//   même valeur, sans conséquence).
// - customer.subscription.deleted : annulation d'abonnement (y compris échec de paiement après
//   plusieurs tentatives côté Stripe) -- repli sur plan = 'free'. Scope volontairement simple pour
//   ce premier passage, pas de gestion fine de l'état 'past_due'.
// - account.updated (Stripe Connect) : synchronise stripe_connect_charges_enabled/payouts_enabled
//   sur composer_profiles -- seul écrivain de ces deux colonnes (voir migration 20260904120000).

import Stripe from 'npm:stripe@22.6.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

// ---- Facturation légale : calcul TVA (simplification volontaire, à valider par un expert-
// comptable avant mise en production réelle -- voir docs/infrastructure.md/le plan de ce chantier
// pour le détail. Ne valide pas le n° de TVA intracommunautaire auprès de VIES, ne gère pas les
// taux OSS par pays de destination pour un B2C hors France -- suffisant pour un premier passage
// technique, pas une garantie de conformité fiscale exhaustive). ----
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV',
  'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);
const FRANCE_VAT_RATE = 0.20;

function computeVat(sellerVatApplicable: boolean, buyerCountry: string | null, buyerHasValidVatId: boolean) {
  if (!sellerVatApplicable) {
    return { rate: null as number | null, mention: 'TVA non applicable, art. 293 B du CGI (franchise en base)' };
  }
  if (!buyerCountry || !EU_COUNTRIES.has(buyerCountry)) {
    return { rate: 0, mention: 'Exonération de TVA — exportation hors Union européenne' };
  }
  if (buyerCountry !== 'FR' && buyerHasValidVatId) {
    return { rate: 0, mention: 'Autoliquidation par le preneur — art. 283-2 du CGI (livraison intracommunautaire B2B)' };
  }
  return { rate: FRANCE_VAT_RATE, mention: null as string | null };
}

// ---- Facturation légale : génération du PDF (mentions minimales art. 242 nonies A CGI annexe
// II : numéro, date, identité vendeur/acheteur, description, montants HT/TVA/TTC). ----
async function buildInvoicePdf(params: {
  documentType: 'facture' | 'attestation_vente';
  invoiceNumber: string;
  packTitle: string;
  seller: { legalName: string; address: string | null; siret: string | null; vatNumber: string | null };
  buyer: { name: string | null; email: string | null; address: string | null; vatNumber: string | null };
  amountHt: number | null;
  vatRate: number | null;
  vatMention: string | null;
  amountVat: number | null;
  amountTtc: number;
}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 800;
  const line = (text: string, opts: { size?: number; f?: typeof font; gap?: number } = {}) => {
    page.drawText(text, { x: 50, y, size: opts.size || 11, font: opts.f || font, color: rgb(0.1, 0.1, 0.1) });
    y -= opts.gap || 18;
  };

  line(params.documentType === 'facture' ? 'FACTURE' : 'ATTESTATION DE VENTE', { size: 18, f: bold, gap: 28 });
  line(`Numéro : ${params.invoiceNumber}`, { gap: 16 });
  line(`Date : ${new Date().toLocaleDateString('fr-FR')}`, { gap: 28 });

  line('Vendeur (mandant)', { f: bold, gap: 16 });
  line(params.seller.legalName, { gap: 14 });
  if (params.seller.address) line(params.seller.address, { gap: 14 });
  if (params.seller.siret) line(`SIRET : ${params.seller.siret}`, { gap: 14 });
  if (params.seller.vatNumber) line(`N° TVA : ${params.seller.vatNumber}`, { gap: 14 });
  y -= 10;

  line('Émis par (mandataire)', { f: bold, gap: 16 });
  line('LayerPitch, pour le compte du vendeur ci-dessus (mandat de facturation, art. 289 du CGI)', { size: 9, gap: 20 });

  line('Acheteur', { f: bold, gap: 16 });
  if (params.buyer.name) line(params.buyer.name, { gap: 14 });
  if (params.buyer.email) line(params.buyer.email, { gap: 14 });
  if (params.buyer.address) line(params.buyer.address, { gap: 14 });
  if (params.buyer.vatNumber) line(`N° TVA : ${params.buyer.vatNumber}`, { gap: 14 });
  y -= 16;

  line('Désignation', { f: bold, gap: 16 });
  line(params.packTitle, { gap: 24 });

  if (params.amountHt != null) line(`Montant HT : ${params.amountHt.toFixed(2)} $`, { gap: 16 });
  if (params.vatRate != null) {
    line(`TVA (${(params.vatRate * 100).toFixed(0)}%) : ${(params.amountVat || 0).toFixed(2)} $`, { gap: 16 });
  } else if (params.vatMention) {
    line(params.vatMention, { size: 9, gap: 16 });
  }
  line(`Total TTC : ${params.amountTtc.toFixed(2)} $`, { f: bold, size: 13, gap: 20 });

  return await doc.save();
}

// ---- Facturation légale : upload R2 (mêmes identifiants que le bucket layerpitch-media déjà en
// place, mais séparés en secrets Edge Function -- le backstage les saisit côté navigateur en
// localStorage, jamais accessibles depuis un contexte serveur). aws4fetch : signature SigV4
// minimale, sans dépendance système, cohérent avec un environnement Deno Edge Function. ----
async function uploadInvoiceToR2(pdfBytes: Uint8Array, storagePath: string) {
  const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
  const client = new AwsClient({
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    service: 's3',
    region: 'auto',
  });
  const bucket = Deno.env.get('R2_BUCKET')!;
  const url = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${storagePath}`;
  const res = await client.fetch(url, { method: 'PUT', body: pdfBytes, headers: { 'Content-Type': 'application/pdf' } });
  if (!res.ok) throw new Error(`Upload R2 échoué (${res.status}) : ${await res.text()}`);
}

// ---- Orchestration : appelée après un upsert pack_purchases réussi qui a réellement inséré une
// nouvelle ligne (jamais sur un renvoi Stripe du même événement). N'échoue jamais le webhook --
// le paiement a eu lieu, l'achat est acquis même si la facture doit être régénérée manuellement
// plus tard (pas construit dans ce chantier, juste ne pas fermer la porte -- voir le plan). ----
async function generateInvoiceForPurchase(
  adminClient: ReturnType<typeof createClient>,
  purchase: { id: string; pack_id: string; price_paid: number },
  session: Stripe.Checkout.Session,
) {
  const { data: pack, error: packError } = await adminClient
    .from('packs')
    .select(`
      title, owner_id,
      composer_profiles ( id, billing_status, billing_legal_name, billing_address, billing_siret, billing_vat_number, billing_vat_applicable )
    `)
    .eq('id', purchase.pack_id)
    .maybeSingle();
  if (packError || !pack) throw new Error(packError?.message || 'Pack introuvable pour la génération de facture.');
  const seller = pack.composer_profiles as {
    id: string; billing_status: string | null; billing_legal_name: string | null; billing_address: string | null;
    billing_siret: string | null; billing_vat_number: string | null; billing_vat_applicable: boolean | null;
  } | null;
  if (!seller || !seller.billing_status || !seller.billing_legal_name) {
    throw new Error('Profil de facturation compositeur incomplet — devrait être impossible (bloqué à la création de la session).');
  }

  const buyerDetails = session.customer_details;
  const buyerCountry = buyerDetails?.address?.country || null;
  const buyerVatId = (buyerDetails?.tax_ids || []).find((t) => t.value)?.value || null;
  const vat = computeVat(!!seller.billing_vat_applicable, buyerCountry, !!buyerVatId);

  const amountTtc = purchase.price_paid;
  const amountHt = vat.rate != null ? amountTtc / (1 + vat.rate) : null;
  const amountVat = amountHt != null && vat.rate != null ? amountTtc - amountHt : null;

  const { data: invoiceNumberRaw, error: numberError } = await adminClient.rpc('next_invoice_number', { p_composer_id: seller.id });
  if (numberError || invoiceNumberRaw == null) throw new Error(numberError?.message || 'Échec de numérotation de facture.');
  const invoiceNumber = `LP-${seller.id.slice(0, 8)}-${String(invoiceNumberRaw).padStart(5, '0')}`;
  const documentType: 'facture' | 'attestation_vente' = seller.billing_status === 'professionnel' ? 'facture' : 'attestation_vente';

  const pdfBytes = await buildInvoicePdf({
    documentType,
    invoiceNumber,
    packTitle: pack.title,
    seller: {
      legalName: seller.billing_legal_name,
      address: seller.billing_address,
      siret: seller.billing_siret,
      vatNumber: seller.billing_vat_number,
    },
    buyer: {
      name: buyerDetails?.name || null,
      email: buyerDetails?.email || null,
      address: buyerDetails?.address
        ? [buyerDetails.address.line1, buyerDetails.address.postal_code, buyerDetails.address.city, buyerDetails.address.country].filter(Boolean).join(', ')
        : null,
      vatNumber: buyerVatId,
    },
    amountHt, vatRate: vat.rate, vatMention: vat.mention, amountVat, amountTtc,
  });

  const storagePath = `invoices/${seller.id}/${invoiceNumber}.pdf`;
  await uploadInvoiceToR2(pdfBytes, storagePath);

  const { data: invoiceRow, error: invoiceError } = await adminClient
    .from('invoices')
    .insert({
      purchase_id: purchase.id,
      composer_id: seller.id,
      invoice_number: invoiceNumber,
      document_type: documentType,
      pdf_storage_path: storagePath,
      seller_snapshot: seller,
      buyer_snapshot: buyerDetails,
      amount_ht: amountHt,
      vat_rate: vat.rate,
      amount_vat: amountVat,
      amount_ttc: amountTtc,
    })
    .select('id')
    .single();
  if (invoiceError || !invoiceRow) throw new Error(invoiceError?.message || 'Échec d\'insertion de la facture.');

  await adminClient.from('pack_purchases').update({ invoice_id: invoiceRow.id }).eq('id', purchase.id);
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();

  // apiVersion explicite ≥ 2025-03-31.basil requis pour Managed Payments — voir
  // create-checkout-session pour le détail (le SDK stripe npm fige toujours une version par
  // défaut, ne pas la préciser ne suffit pas).
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-03-31.basil' });
  const platformSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
  const connectSecret = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET'); // second endpoint côté
  // dashboard Stripe ("Listen to → Events on Connected accounts"), secret distinct -- Stripe ne
  // permet pas un seul endpoint pour les deux portées, mais les deux peuvent pointer vers cette
  // même URL.
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, platformSecret);
  } catch (platformErr) {
    if (!connectSecret) {
      return new Response(`Signature invalide : ${String(platformErr && platformErr.message || platformErr)}`, { status: 400 });
    }
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature!, connectSecret);
    } catch (connectErr) {
      return new Response(`Signature invalide : ${String(connectErr && connectErr.message || connectErr)}`, { status: 400 });
    }
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.mode === 'subscription') {
      const composerAuthId = session.metadata?.composerAuthId || session.client_reference_id;
      const plan = session.metadata?.plan;
      if (composerAuthId && (plan === 'starter' || plan === 'pro')) {
        const { error: planError } = await adminClient
          .from('composer_profiles')
          .update({ plan })
          .eq('profile_id', composerAuthId);
        if (planError) {
          console.error('composer_profiles.plan update failed:', planError.message);
          return new Response(JSON.stringify({ error: planError.message }), {
            status: 500, headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Sinon : achat unitaire studio (mode 'payment').
    const packId = session.metadata?.packId;
    const studioId = session.metadata?.studioId || session.client_reference_id;

    if (packId && studioId) {
      // Idempotence : upsert sur la contrainte unique stripe_payment_intent_id (voir migration
      // 20260831120526) — Stripe peut renvoyer le même événement plusieurs fois, ignoreDuplicates
      // fait qu'un deuxième envoi du même paiement n'écrit rien de plus, sans race condition entre
      // un SELECT et un INSERT séparés. .select() ajouté : une ligne renvoyée = insertion réelle
      // (RETURNING ne renvoie rien sur un conflit ignoré) -- signal utilisé pour ne générer la
      // facture qu'une seule fois, jamais sur un renvoi du même événement.
      const { data: purchaseRows, error: insertError } = await adminClient.from('pack_purchases').upsert({
        studio_id: studioId,
        pack_id: packId,
        price_paid: (session.amount_total || 0) / 100,
        stripe_payment_intent_id: session.payment_intent as string,
      }, { onConflict: 'stripe_payment_intent_id', ignoreDuplicates: true }).select('id, pack_id, price_paid');
      // Ne jamais avaler silencieusement une erreur d'écriture ici (trouvé en test réel : un achat
      // payé chez Stripe mais jamais enregistré côté LayerPitch, sans aucune trace). 500 fait que
      // Stripe considère la livraison échouée et réessaie automatiquement (garanti "at least once").
      if (insertError) {
        console.error('pack_purchases upsert failed:', insertError.message);
        return new Response(JSON.stringify({ error: insertError.message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
      const newPurchase = purchaseRows && purchaseRows[0];
      if (newPurchase) {
        try {
          await generateInvoiceForPurchase(adminClient, newPurchase, session);
        } catch (invoiceErr) {
          // Ne fait volontairement PAS échouer le webhook : le paiement a eu lieu, l'achat est
          // acquis même si la facture doit être régénérée manuellement plus tard (mécanisme de
          // reprise pas construit dans ce chantier, juste pas fermé). Loggé distinctement pour
          // rester repérable.
          console.error('generateInvoiceForPurchase failed:', invoiceErr && (invoiceErr as Error).message || invoiceErr);
        }
      }
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;
    const composerAuthId = subscription.metadata?.composerAuthId;
    if (composerAuthId) {
      const { error: cancelError } = await adminClient
        .from('composer_profiles')
        .update({ plan: 'free' })
        .eq('profile_id', composerAuthId);
      if (cancelError) {
        console.error('composer_profiles plan reset failed:', cancelError.message);
        return new Response(JSON.stringify({ error: cancelError.message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  }

  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account;
    const { error: connectError } = await adminClient
      .from('composer_profiles')
      .update({
        stripe_connect_charges_enabled: !!account.charges_enabled,
        stripe_connect_payouts_enabled: !!account.payouts_enabled,
      })
      .eq('stripe_connect_account_id', account.id);
    // Idempotent par construction (deux mêmes valeurs réécrites sans effet). Ne pas avaler
    // silencieusement une erreur d'écriture ici, même raison que pack_purchases plus haut : un
    // compte devenu réellement charges_enabled côté Stripe mais jamais reflété côté LayerPitch
    // bloquerait silencieusement toutes les ventes de ce compositeur.
    if (connectError) {
      console.error('composer_profiles stripe_connect update failed:', connectError.message);
      return new Response(JSON.stringify({ error: connectError.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
