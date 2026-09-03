// supabase/functions/stripe-webhook/index.ts — LayerPitch, étape 4 (achat unitaire) + Stripe
// Billing compositeur (chantier 4b, docs/infrastructure.md — décisions du 3 septembre).
//
// Reçoit les événements Stripe (paiement/abonnement confirmé côté Stripe, pas côté client — un
// client ne doit jamais pouvoir déclarer lui-même "j'ai payé"). Vérifie la signature via
// STRIPE_WEBHOOK_SECRET (Stripe Dashboard > Developers > Webhooks > cet endpoint > Signing
// secret). Écrit avec la clé service_role (aucun contexte utilisateur dans un appel webhook).
//
// Deux cas distincts, tous deux idempotents par construction :
// - checkout.session.completed en mode 'payment' (packId/studioId dans les metadata) : achat
//   unitaire studio, upsert dans pack_purchases sur stripe_payment_intent_id (unique côté Stripe).
// - checkout.session.completed en mode 'subscription' (composerAuthId/plan dans les metadata) :
//   Stripe Billing compositeur, écrit composer_profiles.plan -- idempotent par nature (un même
//   composer_profile ne peut avoir qu'un seul plan, un renvoi du même événement écrit deux fois la
//   même valeur, sans conséquence).
// - customer.subscription.deleted : annulation d'abonnement (y compris échec de paiement après
//   plusieurs tentatives côté Stripe) -- repli sur plan = 'free'. Scope volontairement simple pour
//   ce premier passage, pas de gestion fine de l'état 'past_due'.

import Stripe from 'npm:stripe@22.6.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();

  // apiVersion explicite ≥ 2025-03-31.basil requis pour Managed Payments — voir
  // create-checkout-session pour le détail (le SDK stripe npm fige toujours une version par
  // défaut, ne pas la préciser ne suffit pas).
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-03-31.basil' });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, signature!, Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    );
  } catch (e) {
    return new Response(`Signature invalide : ${String(e && e.message || e)}`, { status: 400 });
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

    // Sinon : achat unitaire studio (mode 'payment'), comportement inchangé.
    const packId = session.metadata?.packId;
    const studioId = session.metadata?.studioId || session.client_reference_id;

    if (packId && studioId) {
      // Idempotence : upsert sur la contrainte unique stripe_payment_intent_id (voir migration
      // 20260831120526) — Stripe peut renvoyer le même événement plusieurs fois, ignoreDuplicates
      // fait qu'un deuxième envoi du même paiement n'écrit rien de plus, sans race condition entre
      // un SELECT et un INSERT séparés.
      const { error: insertError } = await adminClient.from('pack_purchases').upsert({
        studio_id: studioId,
        pack_id: packId,
        price_paid: (session.amount_total || 0) / 100,
        stripe_payment_intent_id: session.payment_intent as string,
      }, { onConflict: 'stripe_payment_intent_id', ignoreDuplicates: true });
      // Ne jamais avaler silencieusement une erreur d'écriture ici (trouvé en test réel : un achat
      // payé chez Stripe mais jamais enregistré côté LayerPitch, sans aucune trace). 500 fait que
      // Stripe considère la livraison échouée et réessaie automatiquement (garanti "at least once").
      if (insertError) {
        console.error('pack_purchases upsert failed:', insertError.message);
        return new Response(JSON.stringify({ error: insertError.message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
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

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
