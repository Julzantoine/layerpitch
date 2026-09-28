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
//   sur composer_profiles ET studio_profiles (28/09) -- seul écrivain de ces colonnes (voir migration 20260904120000).
// - checkout.session.completed avec metadata.kind = 'album' (28/09) : achat d'album partagé -- voir handleAlbumPurchase.

import Stripe from 'npm:stripe@22.6.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

// ---- Facturation légale : calcul TVA. Depuis le 10 septembre, hybride : Stripe Tax pour les
// compositeurs assujettis (voir resolveStripeComputedVat plus bas), franchise en base gérée à part
// pour les autres -- remplace l'ancien calcul EU/autoliquidation fait main (jamais validé par un
// expert-comptable, conservé nulle part, voir git history si besoin de le retrouver). ----

// Franchise en base (art. 293 B du CGI) : jamais de TVA, quel que soit l'acheteur -- décision
// déclarée par le compositeur lui-même (composer_profiles.billing_vat_applicable), indépendante de
// Stripe Tax (voir plus bas, hybride acté le 10 septembre).
function franchiseEnBaseVat() {
  return { rate: null as number | null, mention: 'TVA non applicable, art. 293 B du CGI (franchise en base)' };
}

// Compositeur assujetti à la TVA : lit le calcul déjà fait par Stripe Tax (automatic_tax, activé
// côté create-checkout-session UNIQUEMENT pour ces compositeurs-là) plutôt que de le refaire à la
// main -- remplace l'ancien computeVat() (règles EU/autoliquidation approximatives, jamais validées
// par un comptable). total_details.breakdown n'est pas inclus par défaut dans la charge utile du
// webhook, d'où le rechargement explicite avec expand.
//
// À VÉRIFIER avec un vrai achat test Stripe avant mise en production réelle (comme le reste de ce
// chantier) : la forme exacte de tax_rate_details/taxability_reason ci-dessous est écrite d'après
// la documentation Stripe, pas rejouée contre un vrai événement reçu par ce projet. Le repli
// (breakdown absent/vide, ou taxability_reason non reconnu) affiche la TVA telle que Stripe l'a
// calculée sans mention légale particulière plutôt que de deviner -- à corriger si un vrai test
// révèle une valeur non couverte ici.
async function resolveStripeComputedVat(stripe: Stripe, sessionId: string): Promise<{ rate: number | null; mention: string | null }> {
  const expanded = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['total_details.breakdown'] });
  // deno-lint-ignore no-explicit-any -- forme exacte non garantie par les types du SDK stripe npm
  // pour ce champ imbriqué (total_details.breakdown.taxes[]), voir note ci-dessus sur la
  // vérification à faire contre un vrai événement.
  const tax = (expanded.total_details as any)?.breakdown?.taxes?.[0] as
    { amount: number; tax_rate_details?: { percentage_decimal?: string }; taxability_reason?: string } | undefined;
  if (!tax || !tax.tax_rate_details) {
    return { rate: 0, mention: 'Aucune TVA calculée par Stripe pour cette vente (à vérifier manuellement si inattendu)' };
  }
  const rate = tax.tax_rate_details.percentage_decimal != null ? Number(tax.tax_rate_details.percentage_decimal) / 100 : 0;
  const reason = tax.taxability_reason || '';
  if (reason === 'reverse_charge') {
    return { rate: 0, mention: 'Autoliquidation par le preneur — art. 283-2 du CGI (livraison intracommunautaire B2B)' };
  }
  if (['zero_rated', 'not_subject_to_tax', 'product_exempt', 'customer_exempt', 'not_collecting'].includes(reason)) {
    return { rate: 0, mention: 'Exonération de TVA (calcul Stripe Tax — hors Union européenne ou cas assimilé)' };
  }
  return { rate, mention: null };
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

  if (params.amountHt != null) line(`Montant HT : ${params.amountHt.toFixed(2)} €`, { gap: 16 });
  if (params.vatRate != null) {
    line(`TVA (${(params.vatRate * 100).toFixed(0)}%) : ${(params.amountVat || 0).toFixed(2)} €`, { gap: 16 });
  } else if (params.vatMention) {
    line(params.vatMention, { size: 9, gap: 16 });
  }
  line(`Total TTC : ${params.amountTtc.toFixed(2)} €`, { f: bold, size: 13, gap: 20 });

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
  // Seau PRIVÉ réservé aux factures (27/09), jamais R2_BUCKET : ce dernier est servi publiquement sur
  // media.layerpitch.com, et le chemin d'une facture se devine (id public du compositeur + numéro qui se suit).
  // Pas de repli sur le seau public si le secret manque : la facture échoue (achat gardé, voir plus bas).
  const bucket = Deno.env.get('R2_INVOICES_BUCKET');
  if (!bucket) throw new Error('Secret R2_INVOICES_BUCKET absent : facture non enregistrée (jamais dans le seau public).');
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
  stripe: Stripe,
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
  const buyerVatId = (buyerDetails?.tax_ids || []).find((t) => t.value)?.value || null;
  // Hybride (10 septembre) : Stripe Tax uniquement pour un compositeur assujetti (automatic_tax
  // activé côté create-checkout-session seulement dans ce cas) -- la franchise en base reste gérée
  // indépendamment de Stripe, jamais influencée par le pays/statut de l'acheteur.
  const vat = seller.billing_vat_applicable
    ? await resolveStripeComputedVat(stripe, session.id)
    : franchiseEnBaseVat();

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

// ---- Achat d'album partagé (chantier profils et permissions, étape 4b, 28/09) ----
// Session créée par create-album-checkout-session (metadata.kind = 'album', instantané de la répartition dans
// metadata.split = « profil|c ou s|parts ; … », commission du palier du vendeur dans metadata.commissionBps).
// 1. album_purchases (idempotent sur stripe_payment_intent_id) ; 2. seulement si l'achat est nouveau : un transfert
// Stripe par bénéficiaire (source_transaction = le paiement, clé d'idempotence par bénéficiaire), tracé dans
// album_payouts ; 3. un document (facture ou attestation) par bénéficiaire, pour SA part du prix payé.
// Un transfert ou une facture qui échoue ne fait pas échouer le webhook (l'achat est acquis) : l'échec est noté dans
// album_payouts.status = 'failed' pour reprise manuelle.
type SplitEntry = { profileId: string; role: 'composer' | 'studio'; shareBps: number };
function parseSplit(raw: string | undefined): SplitEntry[] {
  return String(raw || '').split(';').filter(Boolean).map(x => {
    const [profileId, r, bps] = x.split('|');
    return { profileId, role: r === 's' ? 'studio' : 'composer', shareBps: Number(bps) } as SplitEntry;
  }).filter(e => e.profileId && e.shareBps > 0);
}
// Montants en centimes : commission sur le total, reste partagé selon les parts ; les centimes d'arrondi vont au vendeur
// (première entrée de l'instantané).
function splitAmounts(totalCents: number, commissionBps: number, split: SplitEntry[]) {
  const commission = Math.round(totalCents * commissionBps / 10000);
  const distributable = totalCents - commission;
  const amounts = split.map(e => Math.floor(distributable * e.shareBps / 10000));
  const rest = distributable - amounts.reduce((a, b) => a + b, 0);
  if (amounts.length) amounts[0] += rest;
  return { commission, amounts };
}
async function beneficiaryProfile(adminClient: ReturnType<typeof createClient>, e: SplitEntry) {
  const table = e.role === 'studio' ? 'studio_profiles' : 'composer_profiles';
  const { data } = await adminClient.from(table)
    .select('id, stripe_connect_account_id, billing_status, billing_legal_name, billing_address, billing_siret, billing_vat_number, billing_vat_applicable')
    .eq('profile_id', e.profileId).maybeSingle();
  return data as null | { id: string; stripe_connect_account_id: string | null; billing_status: string | null; billing_legal_name: string | null;
    billing_address: string | null; billing_siret: string | null; billing_vat_number: string | null; billing_vat_applicable: boolean | null };
}
async function handleAlbumPurchase(adminClient: ReturnType<typeof createClient>, stripe: Stripe, session: Stripe.Checkout.Session): Promise<Response | null> {
  const md = session.metadata || {};
  const albumId = md.albumId;
  const buyerId = md.buyerId || session.client_reference_id;
  if (!albumId || !buyerId) return null;
  const totalCents = session.amount_total || 0;
  const { data: rows, error: insertError } = await adminClient.from('album_purchases').upsert({
    buyer_id: buyerId, album_id: albumId, price_paid: totalCents / 100,
    stripe_payment_intent_id: session.payment_intent as string, is_test: false,
  }, { onConflict: 'stripe_payment_intent_id', ignoreDuplicates: true }).select('id');
  if (insertError) {
    console.error('album_purchases upsert failed:', insertError.message);
    return new Response(JSON.stringify({ error: insertError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const purchase = rows && rows[0];
  if (!purchase) return null; // renvoi du même événement : déjà traité

  const split = parseSplit(md.split);
  const { amounts } = splitAmounts(totalCents, Number(md.commissionBps || 0), split);
  const pi = await stripe.paymentIntents.retrieve(session.payment_intent as string);
  const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
  const { data: album } = await adminClient.from('albums').select('title').eq('id', albumId).maybeSingle();
  const vatFromStripe = session.automatic_tax?.enabled ? await resolveStripeComputedVat(stripe, session.id).catch(() => null) : null;

  for (let i = 0; i < split.length; i++) {
    const e = split[i];
    const amount = amounts[i];
    const profile = await beneficiaryProfile(adminClient, e);
    const base = { album_purchase_id: purchase.id, beneficiary_profile_id: e.profileId, beneficiary_role: e.role, share_bps: e.shareBps, amount_cents: amount, stripe_account_id: profile?.stripe_connect_account_id || null };
    const { data: payoutRows } = await adminClient.from('album_payouts').upsert(base, { onConflict: 'album_purchase_id,beneficiary_profile_id,beneficiary_role', ignoreDuplicates: true }).select('id');
    const payoutId = payoutRows && payoutRows[0] && payoutRows[0].id;
    try {
      if (!profile?.stripe_connect_account_id) throw new Error('compte Stripe du bénéficiaire introuvable');
      if (!chargeId) throw new Error('paiement Stripe introuvable');
      if (amount > 0) {
        const transfer = await stripe.transfers.create({
          amount, currency: 'eur', destination: profile.stripe_connect_account_id, source_transaction: chargeId,
          transfer_group: md.transferGroup || undefined,
          metadata: { albumId, albumPurchaseId: purchase.id, beneficiary: e.profileId, role: e.role },
        }, { idempotencyKey: `album_${session.payment_intent}_${e.profileId}_${e.role}` });
        if (payoutId) await adminClient.from('album_payouts').update({ stripe_transfer_id: transfer.id, status: 'transferred' }).eq('id', payoutId);
      } else if (payoutId) {
        await adminClient.from('album_payouts').update({ status: 'transferred' }).eq('id', payoutId);
      }
    } catch (err) {
      console.error('album transfer failed:', (err as Error)?.message || err);
      if (payoutId) await adminClient.from('album_payouts').update({ status: 'failed', error: String((err as Error)?.message || err).slice(0, 500) }).eq('id', payoutId);
    }
    // Document du bénéficiaire pour SA part du prix payé (avant commission : la commission est la rémunération du
    // mandataire, facturée à part). TVA : calcul Stripe si le bénéficiaire est assujetti, sinon franchise en base.
    try {
      if (!profile || !profile.billing_status || !profile.billing_legal_name) throw new Error('profil de facturation incomplet');
      const shareTtc = Math.round(totalCents * e.shareBps / 10000) / 100;
      const vat = profile.billing_vat_applicable && vatFromStripe ? vatFromStripe : franchiseEnBaseVat();
      const amountHt = vat.rate != null ? shareTtc / (1 + vat.rate) : null;
      const amountVat = amountHt != null && vat.rate != null ? shareTtc - amountHt : null;
      const rpcName = e.role === 'studio' ? 'next_studio_invoice_number' : 'next_invoice_number';
      const rpcArg = e.role === 'studio' ? { p_studio_id: profile.id } : { p_composer_id: profile.id };
      const { data: n, error: nError } = await adminClient.rpc(rpcName, rpcArg);
      if (nError || n == null) throw new Error(nError?.message || 'numérotation impossible');
      const invoiceNumber = `LP-${profile.id.slice(0, 8)}-${String(n).padStart(5, '0')}`;
      const documentType: 'facture' | 'attestation_vente' = profile.billing_status === 'professionnel' ? 'facture' : 'attestation_vente';
      const buyer = session.customer_details;
      const pdf = await buildInvoicePdf({
        documentType, invoiceNumber,
        packTitle: `Album « ${album?.title || albumId} » — part de ${(e.shareBps / 100).toLocaleString('fr-FR')} %`,
        seller: { legalName: profile.billing_legal_name, address: profile.billing_address, siret: profile.billing_siret, vatNumber: profile.billing_vat_number },
        buyer: {
          name: buyer?.name || null, email: buyer?.email || null,
          address: buyer?.address ? [buyer.address.line1, buyer.address.postal_code, buyer.address.city, buyer.address.country].filter(Boolean).join(', ') : null,
          vatNumber: (buyer?.tax_ids || []).find((t) => t.value)?.value || null,
        },
        amountHt, vatRate: vat.rate, vatMention: vat.mention, amountVat, amountTtc: shareTtc,
      });
      const storagePath = `invoices/${profile.id}/${invoiceNumber}.pdf`;
      await uploadInvoiceToR2(pdf, storagePath);
      const { error: invError } = await adminClient.from('invoices').insert({
        album_purchase_id: purchase.id, beneficiary_profile_id: e.profileId,
        composer_id: e.role === 'composer' ? profile.id : null, studio_id: e.role === 'studio' ? profile.id : null,
        invoice_number: invoiceNumber, document_type: documentType, pdf_storage_path: storagePath,
        seller_snapshot: profile, buyer_snapshot: buyer, amount_ht: amountHt, vat_rate: vat.rate, amount_vat: amountVat, amount_ttc: shareTtc,
      });
      if (invError) throw new Error(invError.message);
    } catch (err) {
      console.error('album invoice failed:', (err as Error)?.message || err);
    }
  }
  return null;
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

    // Achat d'album (partagé entre plusieurs bénéficiaires, étape 4b du chantier profils et permissions, 28/09).
    if (session.metadata?.kind === 'album') {
      const albumResponse = await handleAlbumPurchase(adminClient, stripe, session);
      return albumResponse || new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
          await generateInvoiceForPurchase(adminClient, newPurchase, session, stripe);
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
    // Compte Stripe d'un STUDIO (28/09) : même synchronisation (un même compte Stripe n'appartient qu'à un seul profil).
    const { error: studioConnectError } = await adminClient
      .from('studio_profiles')
      .update({ stripe_connect_charges_enabled: !!account.charges_enabled, stripe_connect_payouts_enabled: !!account.payouts_enabled })
      .eq('stripe_connect_account_id', account.id);
    if (studioConnectError) {
      console.error('studio_profiles stripe_connect update failed:', studioConnectError.message);
      return new Response(JSON.stringify({ error: studioConnectError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
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
