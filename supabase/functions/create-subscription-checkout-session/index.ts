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

    const { plan, interval, successUrl, cancelUrl, role } = await req.json();
    // Casquette (28/09, chantier profils et permissions) : compositeur (starter/pro, comportement d'avant) ou studio
    // (indie/aa ; AAA sur devis, jamais en libre-service). Un abonnement par profil (D1).
    const isStudio = role === 'studio';
    const allowedPlans = isStudio ? ['indie', 'aa'] : ['starter', 'pro'];
    if (!allowedPlans.includes(plan)) {
      return new Response(JSON.stringify({ error: `plan invalide (${allowedPlans.join(' ou ')} attendu).` }), {
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
      .from('plans')
      .select('code, public_name, price_eur_cents_monthly, price_eur_cents_yearly')
      .eq('code', plan).eq('kind', isStudio ? 'studio' : 'composer')
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
    let studioId: string | null = null;
    if (isStudio) {
      // Seul le PROPRIÉTAIRE du studio paie (D37) : un membre d'équipe ne peut pas souscrire au nom du studio.
      const { data: studio, error: studioError } = await callerClient.rpc('my_studio');
      if (studioError || !studio || !studio.isOwner) {
        return new Response(JSON.stringify({ error: 'Seul le propriétaire du studio peut choisir son palier.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      studioId = studio.id;
    } else {
      const { data: composerId, error: composerError } = await callerClient.rpc('ensure_composer_profile');
      if (composerError || !composerId) {
        return new Response(JSON.stringify({ error: composerError?.message || 'Impossible de provisionner le profil compositeur.' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    // Bundle (D19) : compositeur à −50 % tant que son compte a un palier studio payant actif. Coupon Stripe créé une fois
    // dans le tableau de bord (50 %, durée « forever »), id dans le secret STRIPE_BUNDLE_COUPON_ID. Stripe refuse de
    // cumuler une réduction imposée et la saisie d'un code promo : pas de code promo dans ce cas.
    const bundleCoupon = Deno.env.get('STRIPE_BUNDLE_COUPON_ID');
    let bundle = false;
    if (!isStudio && bundleCoupon) {
      const { data: hasStudio } = await adminClient.rpc('account_has_paid_studio', { p_profile_id: composerAuthId });
      bundle = !!hasStudio;
    }
    const metadata: Record<string, string> = isStudio
      ? { kind: 'studio', studioId: studioId!, ownerAuthId: composerAuthId, plan, interval }
      : { kind: 'composer', composerAuthId, plan, interval, bundle: bundle ? '1' : '0' };

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
            name: `LayerPitch ${isStudio ? 'Studio' : 'Compositeur'} — ${quota.public_name} (${interval === 'month' ? 'mensuel' : 'annuel'})`,
            tax_code: 'txcd_10103001',
          },
          unit_amount: unitAmount,
          recurring: { interval },
        },
        quantity: 1,
      }],
      ...(bundle ? { discounts: [{ coupon: bundleCoupon! }] } : { allow_promotion_codes: true }),
      client_reference_id: composerAuthId,
      // Métadonnées sur la SESSION (lues par le webhook à checkout.session.completed) ET sur l'abonnement (relues aux
      // renouvellements et à la résiliation). Correctif du 28/09 : jusqu'ici seules celles de l'abonnement étaient posées,
      // et le webhook lisait session.metadata.plan -- le palier compositeur n'aurait jamais été mis à jour après paiement.
      metadata,
      subscription_data: { metadata },
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
