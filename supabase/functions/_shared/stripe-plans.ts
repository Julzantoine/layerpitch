// _shared/stripe-plans.ts — LayerPitch, prix d'abonnement Stripe tirés de la table plans (28/09, portail client).
//
// Le portail client Stripe ne sait changer de palier qu'entre des Produits/Prix enregistrés dans Stripe (pas avec les
// prix « à la volée » utilisés jusqu'ici). Plutôt que de saisir ces prix à la main dans le tableau de bord (deux sources
// de vérité), ils sont créés ici, à la demande, depuis la table plans :
//   - un Produit par palier, id fixe « lp_<profil>_<palier> » (ex. lp_studio_indie) ;
//   - un Prix par intervalle, repéré par sa lookup_key « lp_<profil>_<palier>_<month|year> ».
// Si le montant en base change, un nouveau Prix reprend la lookup_key (transfer_lookup_key) et l'ancien est archivé :
// les NOUVEAUX abonnés paient le nouveau prix, les abonnés existants gardent le leur (usage Stripe standard).
// Même mécanique pour la configuration du portail (une par profil, repérée par ses métadonnées).
import Stripe from 'npm:stripe@22.6.0';

type Kind = 'composer' | 'studio';
type Interval = 'month' | 'year';
export type PlanRow = { code: string; kind: Kind; public_name: string; price_eur_cents_monthly: number | null; price_eur_cents_yearly: number | null };

// Paliers payants en libre-service (AAA : sur devis, hors portail).
export const SELF_SERVE: Record<Kind, string[]> = { composer: ['starter', 'pro'], studio: ['indie', 'aa'] };

// TVA (décision du 28/09) : prix COMPOSITEUR affichés TTC (TVA comprise dans le prix, beaucoup de compositeurs sont en
// micro-entreprise et ne récupèrent pas la TVA) ; prix STUDIO affichés HT (TVA ajoutée au paiement, usage entre
// entreprises). Changer ce choix crée de nouveaux Prix au prochain appel (les abonnés existants gardent le leur).
export const TAX_BEHAVIOR: Record<Kind, 'inclusive' | 'exclusive'> = { composer: 'inclusive', studio: 'exclusive' };

export const lookupKey = (kind: Kind, code: string, interval: Interval) => `lp_${kind}_${code}_${interval}`;

// Palier et intervalle d'un Prix LayerPitch (null si ce n'est pas un des nôtres).
export function parseLookupKey(key: string | null | undefined): { kind: Kind; code: string; interval: Interval } | null {
  const m = /^lp_(composer|studio)_([a-z]+)_(month|year)$/.exec(key || '');
  return m ? { kind: m[1] as Kind, code: m[2], interval: m[3] as Interval } : null;
}

async function ensureProduct(stripe: Stripe, plan: PlanRow): Promise<string> {
  const id = `lp_${plan.kind}_${plan.code}`;
  const name = `LayerPitch ${plan.kind === 'studio' ? 'Studio' : 'Compositeur'} — ${plan.public_name}`;
  try {
    const p = await stripe.products.retrieve(id);
    if (p.name !== name || !p.active) await stripe.products.update(id, { name, active: true });
  } catch (e) {
    if ((e as { code?: string })?.code !== 'resource_missing') throw e;
    // Code de taxe « logiciel en tant que service, usage professionnel » (même choix qu'avant, voir
    // create-subscription-checkout-session).
    await stripe.products.create({ id, name, tax_code: 'txcd_10103001', metadata: { layerpitch_kind: plan.kind, layerpitch_plan: plan.code } });
  }
  return id;
}

// Id du Prix Stripe à jour pour ce palier et cet intervalle (créé ou remplacé si besoin).
export async function ensurePrice(stripe: Stripe, plan: PlanRow, interval: Interval): Promise<string> {
  const amount = interval === 'month' ? plan.price_eur_cents_monthly : plan.price_eur_cents_yearly;
  if (!amount) throw new Error(`Prix non renseigné pour ${plan.code} (${interval}).`);
  const key = lookupKey(plan.kind, plan.code, interval);
  const found = await stripe.prices.list({ lookup_keys: [key], limit: 1 });
  const current = found.data[0];
  if (current && current.active && current.unit_amount === amount && current.currency === 'eur' && current.recurring?.interval === interval
      && current.tax_behavior === TAX_BEHAVIOR[plan.kind]) {
    return current.id;
  }
  const product = await ensureProduct(stripe, plan);
  const created = await stripe.prices.create({
    product, currency: 'eur', unit_amount: amount, recurring: { interval }, tax_behavior: TAX_BEHAVIOR[plan.kind],
    lookup_key: key, transfer_lookup_key: true,
    metadata: { layerpitch_kind: plan.kind, layerpitch_plan: plan.code, layerpitch_interval: interval },
  }, { idempotencyKey: `${key}_${amount}_${TAX_BEHAVIOR[plan.kind]}_${current?.id || "new"}` });
  if (current && current.id !== created.id) await stripe.prices.update(current.id, { active: false });
  return created.id;
}

// Configuration du portail client pour un profil : résilier (fin de période), changer de palier (prorata facturé tout de
// suite), carte bancaire, reçus, adresse de facturation et n° de TVA. Mise à jour à chaque ouverture (prix à jour).
export async function ensurePortalConfiguration(stripe: Stripe, kind: Kind, plans: PlanRow[], returnUrl: string): Promise<string> {
  const products: { product: string; prices: string[] }[] = [];
  for (const code of SELF_SERVE[kind]) {
    const plan = plans.find(p => p.kind === kind && p.code === code);
    if (!plan) continue;
    const prices = [];
    for (const interval of ['month', 'year'] as Interval[]) {
      const amount = interval === 'month' ? plan.price_eur_cents_monthly : plan.price_eur_cents_yearly;
      if (amount) prices.push(await ensurePrice(stripe, plan, interval));
    }
    if (prices.length) products.push({ product: `lp_${kind}_${code}`, prices });
  }
  const params: Stripe.BillingPortal.ConfigurationCreateParams = {
    business_profile: {
      headline: kind === 'studio' ? 'LayerPitch — abonnement studio' : 'LayerPitch — abonnement compositeur',
    },
    default_return_url: returnUrl,
    features: {
      customer_update: { enabled: true, allowed_updates: ['name', 'address', 'tax_id'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true, mode: 'at_period_end',
        cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'unused', 'switched_service', 'other'] },
      },
      subscription_update: {
        enabled: products.length > 0, default_allowed_updates: ['price'], products, proration_behavior: 'always_invoice',
      },
    },
    metadata: { layerpitch_kind: kind },
  };
  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const mine = existing.data.find(c => c.metadata?.layerpitch_kind === kind);
  if (mine) {
    await stripe.billingPortal.configurations.update(mine.id, params as Stripe.BillingPortal.ConfigurationUpdateParams);
    return mine.id;
  }
  const created = await stripe.billingPortal.configurations.create(params);
  return created.id;
}
