-- LayerPitch — Stripe Connect compositeur : versement automatique de la part du compositeur à
-- chaque vente de pack, LayerPitch gardant sa commission (commission_rate, plan_quotas, déjà posé
-- le 3 septembre mais totalement inerte jusqu'ici — aucun code de paiement ne le lit).
--
-- Modèle retenu (voir docs/infrastructure.md pour le détail) : comptes Stripe Connect Standard
-- (le compositeur crée/relie son propre compte Stripe, tableau de bord Stripe complet, KYC/fiscal
-- géré par Stripe -- même modèle que Bandcamp 2025-2026) + charges de destination sur la Checkout
-- Session existante (application_fee_amount / transfer_data.destination) -- LayerPitch reste
-- merchant of record (contrôle centralisé de la politique de remboursement), le split se fait au
-- moment même de la vente, aucun virement manuel ni facturation compositeur (contrainte actée par
-- Jules-Antoine : "je ne vais pas commencer à faire des virements aux gens").
--
-- stripe_connect_account_id est l'EXCEPTION au principe "webhook seul écrivain de l'état Stripe
-- dérivé" (composer_profiles.plan, par ex.) : il n'existe aucun événement webhook équivalent à
-- "un compte Connect vient d'être créé" -- il est donc écrit directement par la nouvelle Edge
-- Function create-connect-onboarding-link (service_role), au moment de l'appel
-- stripe.accounts.create(). Cette exception NE S'ÉTEND PAS à charges_enabled/payouts_enabled,
-- qui restent, eux, écrits UNIQUEMENT par stripe-webhook (account.updated) -- jamais par le
-- client, jamais par cette Edge Function.

alter table public.composer_profiles
  add column stripe_connect_account_id text unique,
  add column stripe_connect_charges_enabled boolean not null default false,
  add column stripe_connect_payouts_enabled boolean not null default false;

-- Lookup par account_id côté webhook (account.updated ne porte que l'id du compte connecté, pas
-- le composer_profile.id) -- index explicite plutôt que de compter sur celui implicite de UNIQUE
-- pour rendre l'intention lisible.
create index composer_profiles_stripe_connect_account_id_idx
  on public.composer_profiles(stripe_connect_account_id)
  where stripe_connect_account_id is not null;

-- Aucun GRANT UPDATE ajouté (RLS existante : lecture "own composer profile" seulement, voir
-- 20260831102636_rls_policies.sql) -- ces trois colonnes suivent le même principe que
-- composer_profiles.plan : jamais écrites par un GRANT direct côté client.
