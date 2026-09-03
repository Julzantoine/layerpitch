// supabase/functions/create-subscription-checkout-session/index.ts — LayerPitch, Stripe Billing
// compositeur (chantier 4b, docs/infrastructure.md — décisions du 3 septembre).
//
// Fonction séparée de create-checkout-session (achat unitaire studio) : aucune donnée en commun
// (palier/intervalle choisis par un compositeur, pas un packId/studioId) -- mélanger les deux
// dans un seul fichier avec un paramètre de mode ajouterait de la complexité conditionnelle sans
// bénéfice réel (Décision 2, docs/infrastructure.md : une Edge Function par cas d'usage net).
//
// Pas d'essai côté Stripe (trial_period_days) : l'essai reverse trial est géré entièrement en
// base (composer_profiles.trial_ends_at) avant même que Stripe n'entre en jeu -- souscrire ici
// signifie déjà avoir choisi de payer, l'abonnement facture donc immédiatement.
//
// Le prix vient de Postgres (jamais du client), même principe que create-checkout-session --
// price_data calculé dynamiquement plutôt qu'un Prix Stripe pré-créé, exactement le même
// mécanisme déjà en place et vérifié en prod pour l'achat unitaire.

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
    const composerAuthId = callerData.user.id;

    const { plan, interval, successUrl, cancelUrl } = await req.json();
    if (plan !== 'starter' && plan !== 'pro') {
      return new Response(JSON.stringify({ error: 'plan invalide (starter ou pro attendu).' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (interval !== 'month' && interval !== 'year') {
      return new Response(JSON.stringify({ error: 'interval invalide (month ou year attendu).' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Client service_role : seul point de vérité pour le prix, jamais celui fourni par le client.
    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: quota, error: quotaError } = await adminClient
      .from('plan_quotas')
      .select('plan, price_usd_cents_monthly, price_usd_cents_yearly')
      .eq('plan', plan)
      .maybeSingle();
    if (quotaError || !quota) {
      return new Response(JSON.stringify({ error: 'Palier introuvable.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const unitAmount = interval === 'month' ? quota.price_usd_cents_monthly : quota.price_usd_cents_yearly;
    if (!unitAmount) {
      return new Response(JSON.stringify({ error: 'Prix non renseigné pour ce palier/intervalle.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Le compositeur doit exister avant de souscrire -- ensure_composer_profile() est déjà appelé
    // ailleurs dans le parcours d'inscription (bienvenue.html), mais on ne le suppose pas ici :
    // un abonnement doit toujours pouvoir s'associer à un vrai composer_profile.
    const { data: composerId, error: composerError } = await callerClient.rpc('ensure_composer_profile');
    if (composerError || !composerId) {
      return new Response(JSON.stringify({ error: composerError?.message || 'Impossible de provisionner le profil compositeur.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // apiVersion explicite requis ≥ 2025-03-31.basil pour Managed Payments -- voir
    // create-checkout-session pour le détail.
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-03-31.basil' });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      // TODO code de taxe à vérifier avant la première vraie souscription -- txcd_10401100 (utilisé
      // pour l'achat unitaire) est spécifique à un téléchargement numérique définitif, probablement
      // incorrect pour un abonnement SaaS récurrent. Non renseigné ici volontairement plutôt que
      // deviné -- à confirmer contre la documentation Stripe (catégorie "Software as a Service").
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `LayerPitch — ${plan === 'pro' ? 'Pro' : 'Starter'} (${interval === 'month' ? 'mensuel' : 'annuel'})` },
          unit_amount: unitAmount,
          recurring: { interval },
        },
        quantity: 1,
      }],
      allow_promotion_codes: true,
      client_reference_id: composerAuthId,
      subscription_data: { metadata: { composerAuthId, plan, interval } },
      success_url: successUrl || 'http://localhost:8420/bienvenue.html?subscribed=1',
      cancel_url: cancelUrl || 'http://localhost:8420/bienvenue.html?subscribed=0',
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
