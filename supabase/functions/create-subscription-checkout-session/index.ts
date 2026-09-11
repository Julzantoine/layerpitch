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

// Autorise uniquement les origines LayerPitch connues plutôt que '*' -- ces fonctions manipulent
// paiement/facturation/média/admin ; un JWT qui fuit ailleurs ne doit pas pouvoir être rejoué
// depuis n'importe quel site (durci 11 septembre, audit sécurité). Ne s'appuie sur aucun cookie
// (auth par Authorization: Bearer uniquement) -- ce durcissement est une défense en profondeur,
// pas la protection principale.
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

// Valide successUrl/cancelUrl/returnUrl/refreshUrl fournis par le client contre les origines
// LayerPitch connues avant de les transmettre à Stripe -- sans ça, un appel forgé pourrait rediriger
// le navigateur d'un acheteur/compositeur vers n'importe quel site juste après un paiement réel ou
// une étape Connect, un moment de haute confiance idéal pour du phishing (durci 11 septembre, audit
// sécurité).
function safeReturnUrl(url: unknown, fallback: string): string {
  if (typeof url !== 'string') return fallback;
  try {
    return ALLOWED_ORIGINS.has(new URL(url).origin) ? url : fallback;
  } catch {
    return fallback;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
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
      .select('plan, price_eur_cents_monthly, price_eur_cents_yearly')
      .eq('plan', plan)
      .maybeSingle();
    if (quotaError || !quota) {
      return new Response(JSON.stringify({ error: 'Palier introuvable.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const unitAmount = interval === 'month' ? quota.price_eur_cents_monthly : quota.price_eur_cents_yearly;
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
      // Code de taxe vérifié contre la documentation Stripe (catégorie "Software as a service"),
      // txcd_10401100 (utilisé pour l'achat unitaire) était spécifique à un téléchargement
      // numérique définitif, incorrect pour un abonnement récurrent. txcd_10103001 = usage
      // professionnel (les compositeurs utilisent LayerPitch pour leur activité, pas en usage
      // personnel) -- la distinction pro/perso n'a d'effet que sur les ventes US.
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `LayerPitch — ${plan === 'pro' ? 'Pro' : 'Starter'} (${interval === 'month' ? 'mensuel' : 'annuel'})`,
            tax_code: 'txcd_10103001',
          },
          unit_amount: unitAmount,
          recurring: { interval },
        },
        quantity: 1,
      }],
      allow_promotion_codes: true,
      client_reference_id: composerAuthId,
      subscription_data: { metadata: { composerAuthId, plan, interval } },
      success_url: safeReturnUrl(successUrl, 'http://localhost:8420/bienvenue.html?subscribed=1'),
      cancel_url: safeReturnUrl(cancelUrl, 'http://localhost:8420/bienvenue.html?subscribed=0'),
    });

    return new Response(JSON.stringify({ ok: true, url: session.url }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // Erreur interne inattendue : détail loggé côté serveur, jamais renvoyé au client (durci 11
    // septembre, audit sécurité -- évite de fuir un nom de colonne/contrainte Postgres ou un autre
    // détail interne).
    console.error('create-subscription-checkout-session:', e);
    return new Response(JSON.stringify({ error: 'Erreur interne. Réessaie dans un instant.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
