// create-album-checkout-session — LayerPitch, achat d'un album (Adaptive OST) à prix libre, partagé entre le vendeur et
// ses co-ayants droit acceptés (chantier profils et permissions, étape 4b, 28/09 ; D5, D6, D30 du cadrage
// layerpitch-docs/2026-09-27-cadrage-profils-permissions.md).
//
// Modèle Stripe « paiement puis transferts séparés » (separate charges and transfers, vérifié dans la doc Stripe le
// 27/09, disponible en France) : l'acheteur paie LayerPitch ; au paiement confirmé, stripe-webhook transfère à chaque
// bénéficiaire sa part (source_transaction = le paiement, donc jamais avant que les fonds soient disponibles). LayerPitch
// ne garde jamais l'argent d'un tiers au-delà de ce délai (D5 : pas de mise de côté).
//
// Répartition : commission LayerPitch = palier du VENDEUR, sur le total (D6) ; le reste est partagé selon les parts
// (album_sale_split : vendeur + co-ayants droit acceptés ; la part d'un « je reverse moi-même » revient au vendeur).
// Tous les bénéficiaires doivent avoir un compte Stripe prêt et un profil de facturation : sinon refus, avec le nom de
// ce qui manque. Les frais Stripe sont prélevés sur le solde de LayerPitch (couverts par la commission).
// Instantané de la répartition dans les métadonnées de la session (relu par le webhook) : une répartition modifiée
// entre le paiement et sa confirmation ne change pas une vente déjà payée.
// Visiteur SANS compte (29/09) : { email } au lieu du jeton ; l'achat est rattaché après paiement (compte créé si besoin par
// stripe-webhook, lien de connexion envoyé par e-mail). Ouvert seulement avec le feu vert 'album_checkout' (album_checkout_status).
// NON TESTÉE AVEC STRIPE au 28/09 : à déployer puis essayer en mode test avant toute vente réelle. TVA d'un album à
// plusieurs vendeurs : à valider avec l'expert-comptable (Stripe Tax activé seulement si le VENDEUR est assujetti,
// comme pour les packs).
import Stripe from 'npm:stripe@22.6.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set([
  'https://beta.layerpitch.com',
  'https://layerpitch.com',
  'https://www.layerpitch.com',
  'http://localhost:8420',
]);
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://beta.layerpitch.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}
function safeReturnUrl(url: unknown, fallback: string): string {
  if (typeof url !== 'string') return fallback;
  try { return ALLOWED_ORIGINS.has(new URL(url).origin) ? url : fallback; } catch { return fallback; }
}
const MAX_PRICE_CENTS = 100000; // plafond du prix libre (1 000 €), garde-fou contre une faute de frappe

type Beneficiary = { profile_id: string; role: 'composer' | 'studio'; share_bps: number; stripe_account_id: string | null; ready: boolean; billing_ok: boolean; is_seller: boolean };

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, authHeader ? { global: { headers: { Authorization: authHeader } } } : undefined);
    // Le jeton d'un visiteur sans compte est la clé publique : getUser échoue -> achat « invité » (adresse e-mail demandée).
    const { data: callerData } = authHeader ? await callerClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, '')) : { data: { user: null } };
    let buyerId: string | null = callerData?.user?.id ?? null;

    const { albumId, amountCents, successUrl, cancelUrl, email } = await req.json().catch(() => ({}));
    const amount = Math.round(Number(amountCents));
    if (!albumId || !Number.isFinite(amount)) return json({ error: 'albumId et amountCents requis.' }, 400);
    const guestEmail = typeof email === 'string' ? email.trim().slice(0, 200) : '';
    if (!buyerId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) return json({ error: 'Adresse e-mail requise pour acheter sans compte.' }, 400);
    const { data: checkoutOpen } = await callerClient.rpc('album_checkout_status');
    if (!checkoutOpen || !checkoutOpen.open) return json({ error: 'L\'achat d\'albums n\'est pas encore ouvert.' }, 403);

    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (!buyerId) { const { data: existing } = await adminClient.rpc('user_id_by_email', { p_email: guestEmail }); if (existing) buyerId = existing as string; }
    const { data: album } = await adminClient.from('albums').select('id, title, buyable, price_eur_cents, seller_id, seller_role').eq('id', albumId).maybeSingle();
    if (!album || !album.buyable || album.price_eur_cents == null) return json({ error: 'Cet album n\'est pas en vente.' }, 400);
    if (amount < album.price_eur_cents) return json({ error: 'Montant inférieur au prix minimum de l\'album.' }, 400);
    if (amount <= 0) return json({ error: 'Album gratuit : pas de paiement nécessaire.' }, 400);
    if (amount > MAX_PRICE_CENTS) return json({ error: 'Montant trop élevé.' }, 400);
    if (buyerId && album.seller_id === buyerId) return json({ error: 'Tu ne peux pas acheter ton propre album.' }, 400);
    if (buyerId) {
      const { data: owned } = await adminClient.from('album_purchases').select('id').eq('album_id', albumId).eq('buyer_id', buyerId).limit(1);
      if (owned && owned.length) return json({ error: 'Tu possèdes déjà cet album.' }, 409);
    }

    const { data: settled } = await adminClient.rpc('album_rights_settled', { p_album_id: albumId });
    if (!settled) return json({ error: 'Vente suspendue : un co-ayant droit n\'a pas encore accepté la répartition.' }, 409);
    const { data: splitRows, error: splitError } = await adminClient.rpc('album_sale_split', { p_album_id: albumId });
    const split = (splitRows || []) as Beneficiary[];
    if (splitError || !split.length) return json({ error: 'Répartition introuvable.' }, 500);
    const notReady = split.filter(b => !b.ready || !b.stripe_account_id || !b.billing_ok);
    if (notReady.length) {
      return json({ error: `Vente pas encore possible : ${notReady.length} bénéficiaire(s) n'ont pas activé leur versement Stripe ou rempli leur profil de facturation.` }, 409);
    }
    const { data: rate } = await adminClient.rpc('album_commission_rate', { p_album_id: albumId });
    const commissionBps = Math.round(Number(rate || 0) * 10000);

    // Vendeur assujetti à la TVA : Stripe Tax, comme pour les packs (create-checkout-session).
    const sellerTable = album.seller_role === 'studio' ? 'studio_profiles' : 'composer_profiles';
    const { data: sellerProfile } = await adminClient.from(sellerTable).select('billing_vat_applicable').eq('profile_id', album.seller_id).maybeSingle();

    // Instantané compact (limite Stripe : 500 caractères par métadonnée) : « profil|c ou s|parts ; … ».
    const snapshot = split.map(b => `${b.profile_id}|${b.role === 'studio' ? 's' : 'c'}|${b.share_bps}`).join(';');
    if (snapshot.length > 480) return json({ error: 'Trop de co-ayants droit pour un paiement en ligne (limite technique).' }, 400);

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-03-31.basil' });
    const transferGroup = `album_${albumId}_${crypto.randomUUID()}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ...(buyerId ? { client_reference_id: buyerId } : { customer_email: guestEmail }),
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      automatic_tax: { enabled: !!(sellerProfile && sellerProfile.billing_vat_applicable) },
      line_items: [{
        price_data: {
          currency: 'eur',
          // Même code fiscal que les packs : œuvre audio téléchargée, droits permanents.
          product_data: { name: album.title, tax_code: 'txcd_10401100' },
          unit_amount: amount,
          tax_behavior: 'inclusive',
        },
        quantity: 1,
      }],
      payment_intent_data: { transfer_group: transferGroup },
      metadata: { kind: 'album', albumId, ...(buyerId ? { buyerId } : { buyerEmail: guestEmail }), split: snapshot, commissionBps: String(commissionBps), transferGroup },
      success_url: safeReturnUrl(successUrl, 'https://beta.layerpitch.com/mes-albums.html?purchased=1'),
      cancel_url: safeReturnUrl(cancelUrl, 'https://beta.layerpitch.com/mes-albums.html'),
    });
    return json({ ok: true, url: session.url });
  } catch (e) {
    console.error('create-album-checkout-session:', e);
    return json({ error: 'Erreur interne. Réessaie dans un instant.' }, 500);
  }
});
