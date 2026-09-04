// supabase/functions/create-checkout-session/index.ts — LayerPitch, étape 4 (logique d'achat)
// (docs/infrastructure.md, Partie B — "Achat de pack depuis l'AdReel", achat unitaire one-time)
//
// Détient la clé secrète Stripe — jamais exposée côté client (même principe que invite-tester pour
// la clé Admin Supabase, Décision 2 : "Edge Functions réservées aux seuls cas nécessitant un
// secret serveur ou un appel externe"). Appelée depuis un futur api/purchases.js, jamais
// directement.
//
// Le prix vient de Postgres (jamais du client) — un visiteur ne doit pas pouvoir manipuler le
// montant facturé en modifiant la requête. Prix actuels posés le 31 août : valeurs de TEST
// provisoires (9,99 $ partout), pas une vraie décision de pricing — voir la migration
// 20260831120422_pack_pricing.sql.
//
// Stripe Connect (chantier versement automatique + facturation légale, 4 septembre) : la vente
// verse automatiquement sa part au compositeur (application_fee_amount / transfer_data.destination
// -- charges de destination, LayerPitch reste merchant of record) et collecte l'identité de
// l'acheteur (billing_address_collection / tax_id_collection) pour la facture générée dans
// stripe-webhook après paiement. Bloqué sans repli si le compositeur n'a pas de compte Connect
// actif OU pas de profil de facturation complet -- une vente sans identité vendeur ne doit pas
// pouvoir avoir lieu, sous peine de bloquer la génération de la facture après coup.

import Stripe from 'npm:stripe@22.6.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Non authentifié.' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser(jwt);
    if (callerError || !callerData.user) {
      return new Response(JSON.stringify({ error: 'Jeton invalide.' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const studioId = callerData.user.id;

    const { packId, successUrl, cancelUrl } = await req.json();
    if (!packId || typeof packId !== 'string') {
      return new Response(JSON.stringify({ error: 'packId manquant ou invalide.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Client service_role : seul point de vérité pour le prix, jamais celui fourni par le client.
    // composer_profiles embarqué via owner_id (FK packs -> composer_profiles) : évite un second
    // aller-retour pour vérifier Connect/facturation du vendeur.
    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: pack, error: packError } = await adminClient
      .from('packs')
      .select(`
        id, title, price_usd_cents, buyable, owner_id,
        composer_profiles (
          id, stripe_connect_account_id, stripe_connect_charges_enabled,
          billing_status, billing_legal_name, billing_siret, billing_vat_applicable
        )
      `)
      .eq('id', packId)
      .maybeSingle();
    if (packError || !pack) {
      return new Response(JSON.stringify({ error: 'Pack introuvable.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!pack.buyable || !pack.price_usd_cents) {
      return new Response(JSON.stringify({ error: 'Ce pack n\'est pas achetable.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const owner = pack.composer_profiles as {
      id: string; stripe_connect_account_id: string | null; stripe_connect_charges_enabled: boolean;
      billing_status: string | null; billing_legal_name: string | null; billing_siret: string | null;
      billing_vat_applicable: boolean | null;
    } | null;
    if (!owner || !owner.stripe_connect_account_id || !owner.stripe_connect_charges_enabled) {
      return new Response(JSON.stringify({ error: 'Ce compositeur n\'a pas encore activé les paiements — achat impossible pour le moment.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Facture/attestation générée après paiement (stripe-webhook) -- une vente ne doit jamais
    // pouvoir précéder une identité vendeur déclarée, sous peine de bloquer sa génération après
    // coup. Un particulier reste vendable (attestation de vente, pas de facture) tant que
    // billing_status est renseigné -- seuls billing_legal_name/billing_address sont requis dans
    // les deux cas, billing_siret seulement pour un professionnel (vérifié côté formulaire, pas
    // reredondé ici pour rester simple).
    if (!owner.billing_status || !owner.billing_legal_name) {
      return new Response(JSON.stringify({ error: 'Ce compositeur n\'a pas encore complété son profil de facturation — achat impossible pour le moment.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Commission via effective_plan_quotas(), jamais plan_quotas.commission_rate en direct --
    // cette RPC applique déjà les dérogations essai/admin/étudiant, les lire à côté casserait ces
    // trois cas silencieusement.
    const { data: quotaRows, error: quotaError } = await adminClient.rpc('effective_plan_quotas', { p_composer_id: owner.id });
    const quota = Array.isArray(quotaRows) ? quotaRows[0] : quotaRows;
    if (quotaError || !quota) {
      return new Response(JSON.stringify({ error: 'Impossible de calculer la commission pour ce compositeur.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const applicationFeeAmount = Math.round(pack.price_usd_cents * Number(quota.commission_rate));

    // apiVersion explicite requis ≥ 2025-03-31.basil pour Managed Payments (activé sur ce compte)
    // — le SDK stripe npm envoie toujours une version figée par défaut (celle de sa propre
    // release, pas celle du compte), omettre apiVersion ne suffit pas : "2024-12-18.acacia" était
    // toujours utilisée même sans le préciser, avec le SDK v17. Mis à jour vers stripe@22.6.0 en
    // même temps (dernière version stable au 31 août) pour rester aligné SDK/API.
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-03-31.basil' });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Pas de payment_method_types : Managed Payments (activé sur ce compte, choisi le 31 août
      // lors de la config Stripe) gère lui-même les moyens de paiement disponibles — passer ce
      // paramètre explicitement est rejeté par l'API dans ce cas. À revérifier : compatibilité de
      // billing_address_collection/tax_id_collection avec Managed Payments (même vigilance que
      // celle qui avait révélé l'incompatibilité payment_method_types en son temps).
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      line_items: [{
        price_data: {
          currency: 'usd',
          // txcd_10401100 : "Digital Audio Works - downloaded - non subscription - with permanent
          // rights" — requis par Managed Payments, code Stripe vérifié pour ce cas d'usage exact
          // (pack audio téléchargé, achat unitaire, accès permanent).
          product_data: { name: pack.title, tax_code: 'txcd_10401100' },
          unit_amount: pack.price_usd_cents,
        },
        quantity: 1,
      }],
      // Charges de destination : le compositeur reçoit automatiquement sa part sur son propre
      // compte Connect, LayerPitch garde application_fee_amount -- pas de on_behalf_of (le relevé
      // de l'acheteur affiche LayerPitch, pas le compositeur), sauf si Stripe l'exige pour un
      // compte connecté hors de la région de la plateforme (décision actée : basculer sur
      // on_behalf_of seulement si ce blocage est réellement rencontré en test, pas anticipé ici).
      payment_intent_data: {
        application_fee_amount: applicationFeeAmount,
        transfer_data: { destination: owner.stripe_connect_account_id },
      },
      client_reference_id: studioId,
      metadata: { packId: pack.id, studioId },
      success_url: successUrl || 'http://localhost:8420/auth-test.html?purchase=success',
      cancel_url: cancelUrl || 'http://localhost:8420/auth-test.html?purchase=cancelled',
    });

    return new Response(JSON.stringify({ ok: true, url: session.url }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
