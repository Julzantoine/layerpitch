// create-billing-portal-session — LayerPitch, « Gérer mon abonnement » (28/09, portail client Stripe, option A).
//
// Ouvre le portail client Stripe pour l'abonnement COMPOSITEUR ou STUDIO du compte connecté : résilier (effet en fin de
// période), changer de palier (prorata facturé tout de suite), carte bancaire, reçus. Les changements reviennent par le
// webhook (customer.subscription.updated / deleted). Studio : seul le PROPRIÉTAIRE gère l'abonnement (D37).
// La configuration du portail (une par profil) et les Prix Stripe sont tenus à jour depuis la table plans
// (_shared/stripe-plans.ts).
import Stripe from 'npm:stripe@22.6.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ensurePortalConfiguration, type PlanRow } from '../_shared/stripe-plans.ts';

// Mêmes origines autorisées que les autres fonctions de paiement (durcissement du 11/09).
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
  try {
    return ALLOWED_ORIGINS.has(new URL(url).origin) ? url : fallback;
  } catch {
    return fallback;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Non authentifié.' }, 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser(jwt);
    if (callerError || !callerData.user) return json({ error: 'Jeton invalide.' }, 401);
    const userId = callerData.user.id;

    const { role, returnUrl } = await req.json();
    const isStudio = role === 'studio';
    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    let customerId: string | null = null;
    if (isStudio) {
      const { data: studio } = await callerClient.rpc('my_studio');
      if (!studio || !studio.isOwner) return json({ error: 'Seul le propriétaire du studio gère son abonnement.' }, 403);
      const { data: sp } = await adminClient.from('studio_profiles').select('stripe_customer_id').eq('id', studio.id).maybeSingle();
      customerId = sp?.stripe_customer_id || null;
    } else {
      const { data: cp } = await adminClient.from('composer_profiles').select('stripe_customer_id').eq('profile_id', userId).maybeSingle();
      customerId = cp?.stripe_customer_id || null;
    }
    if (!customerId) return json({ error: 'Aucun abonnement Stripe à gérer pour ce compte.' }, 404);

    const back = safeReturnUrl(returnUrl, `https://beta.layerpitch.com/${isStudio ? 'studio.html' : 'mon-compte.html'}`);
    const { data: plans, error: plansError } = await adminClient.from('plans')
      .select('code, kind, public_name, price_eur_cents_monthly, price_eur_cents_yearly').eq('kind', isStudio ? 'studio' : 'composer');
    if (plansError) return json({ error: 'Paliers introuvables.' }, 500);
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-03-31.basil' });
    const configuration = await ensurePortalConfiguration(stripe, isStudio ? 'studio' : 'composer', (plans || []) as PlanRow[], back);
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, configuration, return_url: back });
    return json({ ok: true, url: session.url });
  } catch (e) {
    console.error('create-billing-portal-session:', e);
    return json({ error: 'Erreur interne. Réessaie dans un instant.' }, 500);
  }
});
