// pay-credit-downloads — LayerPitch, paiement des compositeurs pour les packs pris avec des crédits (chantier profils et
// permissions, étape 6c, 28/09 ; D15, D31 : le compositeur est payé COMME UNE VENTE — valeur du niveau, 10 € par crédit,
// moins la commission de son palier).
//
// Parcourt credit_payouts en attente (status 'pending', créés par take_pack_with_credits) et fait pour chacun un transfert
// Stripe depuis le solde de LayerPitch vers le compte Connect du compositeur (clé d'idempotence = id du versement : jamais
// deux fois). L'argent vient des abonnements studio déjà encaissés. Un compositeur sans compte Stripe prêt reste en
// attente (réessayé à la prochaine exécution) ; une erreur Stripe passe le versement en 'failed' (reprise manuelle).
// Qui peut l'appeler : la tâche planifiée (clé service_role) ou un admin LayerPitch.
// À PLANIFIER (une fois par jour, par exemple) avec pg_cron + pg_net, comme le courriel d'annonce, ou à lancer à la main.
// NON TESTÉE AVEC STRIPE au 28/09. Factures de ces ventes (mandat de facturation, acheteur = le studio) : à ajouter avec
// l'expert-comptable (même générateur que les packs), non construit ici.
import Stripe from 'npm:stripe@22.6.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (token !== serviceKey) {
      const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
      const { data: isAdmin } = await callerClient.rpc('is_admin');
      if (!isAdmin) return json({ error: 'Non autorisé.' }, 403);
    }
    const adminClient = createClient(supabaseUrl, serviceKey);
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-03-31.basil' });
    const { data: pending, error } = await adminClient.from('credit_payouts')
      .select('id, amount_cents, composer_id, pack_purchase_id').eq('status', 'pending').order('created_at').limit(200);
    if (error) return json({ error: error.message }, 500);
    const result = { transferred: 0, waiting: 0, failed: 0 };
    for (const p of pending || []) {
      const { data: composer } = await adminClient.from('composer_profiles')
        .select('stripe_connect_account_id, stripe_connect_charges_enabled').eq('id', p.composer_id).maybeSingle();
      if (!composer?.stripe_connect_account_id || !composer.stripe_connect_charges_enabled) { result.waiting++; continue; }
      try {
        if (p.amount_cents > 0) {
          const transfer = await stripe.transfers.create({
            amount: p.amount_cents, currency: 'eur', destination: composer.stripe_connect_account_id,
            metadata: { kind: 'credit_download', creditPayoutId: p.id, packPurchaseId: p.pack_purchase_id },
          }, { idempotencyKey: `credit_payout_${p.id}` });
          await adminClient.from('credit_payouts').update({ status: 'transferred', stripe_transfer_id: transfer.id }).eq('id', p.id);
        } else {
          await adminClient.from('credit_payouts').update({ status: 'transferred' }).eq('id', p.id);
        }
        result.transferred++;
      } catch (e) {
        await adminClient.from('credit_payouts').update({ status: 'failed', error: String((e as Error)?.message || e).slice(0, 500) }).eq('id', p.id);
        result.failed++;
      }
    }
    return json({ ok: true, ...result });
  } catch (e) {
    console.error('pay-credit-downloads:', e);
    return json({ error: 'Erreur interne.' }, 500);
  }
});
