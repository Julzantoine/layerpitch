// supabase/functions/create-connect-onboarding-link/index.ts — LayerPitch, Stripe Connect
// compositeur (versement automatique de la part du compositeur à chaque vente, voir migration
// 20260904120000).
//
// Crée le compte Stripe Connect Standard du compositeur s'il n'en a pas encore (Stripe reconnaît
// un compte existant par email, comme Bandcamp), puis un Account Link d'onboarding et renvoie son
// URL pour redirection côté client. Ré-appelable : si un account_id existe déjà (onboarding
// commencé mais pas terminé, ou "gérer mon compte" une fois actif), on ne recrée pas de compte, on
// génère juste un nouveau lien.
//
// Écrit stripe_connect_account_id directement (service_role) -- SEULE exception au principe
// "webhook seul écrivain de l'état Stripe dérivé" (voir composer_profiles.plan) : il n'existe pas
// d'événement webhook équivalent à "un compte Connect vient d'être créé". charges_enabled/
// payouts_enabled restent, eux, écrits uniquement par stripe-webhook (account.updated) -- jamais
// par cette fonction.

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
    const composerEmail = callerData.user.email;

    const { returnUrl, refreshUrl } = await req.json().catch(() => ({}));

    // Le compositeur doit exister avant de connecter Stripe -- même garde-fou que
    // create-subscription-checkout-session (ensure_composer_profile() déjà appelé ailleurs dans le
    // parcours d'inscription, mais on ne le suppose pas ici).
    const { data: composerId, error: composerError } = await callerClient.rpc('ensure_composer_profile');
    if (composerError || !composerId) {
      return new Response(JSON.stringify({ error: composerError?.message || 'Impossible de provisionner le profil compositeur.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: profile, error: profileError } = await adminClient
      .from('composer_profiles')
      .select('id, stripe_connect_account_id')
      .eq('id', composerId)
      .maybeSingle();
    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Profil compositeur introuvable.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // apiVersion explicite requis ≥ 2025-03-31.basil pour Managed Payments -- voir
    // create-checkout-session pour le détail.
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-03-31.basil' });

    let accountId = profile.stripe_connect_account_id;
    if (!accountId) {
      // type: 'standard' -- pas de `capabilities` ici : Stripe négocie lui-même les capacités
      // requises pendant son propre onboarding (Standard, pas Custom). `email` permet à Stripe de
      // reconnaître un compte Stripe existant côté compositeur, comme Bandcamp.
      const account = await stripe.accounts.create({ type: 'standard', email: composerEmail });
      accountId = account.id;
      const { error: writeError } = await adminClient
        .from('composer_profiles')
        .update({ stripe_connect_account_id: accountId })
        .eq('id', composerId);
      if (writeError) {
        console.error('stripe_connect_account_id write failed:', writeError.message);
        return new Response(JSON.stringify({ error: writeError.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: refreshUrl || 'http://localhost:8420/layerpitch-backstage.html?connect=refresh',
      return_url: returnUrl || 'http://localhost:8420/layerpitch-backstage.html?connect=return',
    });

    return new Response(JSON.stringify({ ok: true, url: accountLink.url }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
