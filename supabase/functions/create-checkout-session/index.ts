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
    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: pack, error: packError } = await adminClient
      .from('packs')
      .select('id, title, price_usd_cents, buyable')
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
      // paramètre explicitement est rejeté par l'API dans ce cas.
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
