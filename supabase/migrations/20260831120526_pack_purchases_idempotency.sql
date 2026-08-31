-- LayerPitch — garantie d'idempotence au niveau base pour les achats (étape 4). Stripe garantit la
-- livraison "au moins une fois" des événements webhook, jamais "exactement une fois" — la
-- vérification applicative dans stripe-webhook (SELECT avant INSERT) laisse une fenêtre de course
-- si deux livraisons du même événement sont traitées en parallèle. Cette contrainte est le vrai
-- filet de sécurité contre un achat compté deux fois pour un seul paiement Stripe.
alter table public.pack_purchases
  add constraint pack_purchases_stripe_intent_unique unique (stripe_payment_intent_id);
