-- LayerPitch — portail client Stripe (28 septembre, décision de Jules-Antoine : option A).
-- Avant : ni résiliation, ni changement de palier, ni changement de carte n'étaient possibles (compositeurs comme
-- studios), et « changer de palier » ouvrait un SECOND abonnement. Désormais :
--   - un seul abonnement par profil (create-subscription-checkout-session refuse s'il y en a déjà un actif) ;
--   - « Gérer mon abonnement » ouvre le portail Stripe (create-billing-portal-session) : résilier (fin de période),
--     changer de palier (au prorata), carte, reçus ;
--   - le webhook suit customer.subscription.updated (palier, résiliation programmée).
-- Les prix Stripe sont créés automatiquement depuis la table plans (module _shared/stripe-plans.ts) : la base reste la
-- seule source des prix.

-- 1. Compositeur : même suivi que le studio (état, client Stripe) ; les deux : date de fin programmée (résiliation).
alter table public.composer_profiles
  add column subscription_status text not null default 'none' check (subscription_status in ('none', 'active', 'canceled')),
  add column stripe_customer_id text,
  add column subscription_cancel_at timestamptz;
alter table public.studio_profiles
  add column subscription_cancel_at timestamptz;
comment on column public.composer_profiles.subscription_cancel_at is 'Résiliation programmée dans le portail Stripe : l''abonnement reste actif jusqu''à cette date. NULL = pas de résiliation en cours. Écrit par le webhook.';
comment on column public.studio_profiles.subscription_cancel_at is 'Résiliation programmée dans le portail Stripe : l''abonnement reste actif jusqu''à cette date. NULL = pas de résiliation en cours. Écrit par le webhook.';

-- Abonnements compositeur déjà payés avant ce suivi.
update public.composer_profiles set subscription_status = 'active'
where stripe_subscription_id is not null and plan in ('starter', 'pro');

-- 2. Montée de palier en cours de mois (Indie → AA) : la DIFFÉRENCE de crédits tout de suite, une seule fois par
-- période et par palier atteint (clé d'idempotence = période). Une descente ne retire rien. Lit les quotas des paliers
-- ENREGISTRÉS (pas l'accès admin ni la bêta : c'est la différence entre deux abonnements payés).
create or replace function public.grant_studio_upgrade_credits(p_studio_id uuid, p_from_plan text, p_to_plan text, p_period text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_from numeric; v_to numeric; v_diff int;
begin
  select coalesce(max(amount) filter (where allowed), 0) into v_from from public.plan_entitlements where plan = p_from_plan and feature = 'monthly_credits' and variant = '';
  select coalesce(max(amount) filter (where allowed), 0) into v_to from public.plan_entitlements where plan = p_to_plan and feature = 'monthly_credits' and variant = '';
  v_diff := greatest(0, coalesce(v_to, 0) - coalesce(v_from, 0))::int;
  if v_diff = 0 then return 0; end if;
  insert into public.studio_credit_ledger (studio_id, delta, reason, period, note)
  values (p_studio_id, v_diff, 'grant', 'upgrade:' || p_period || ':' || p_to_plan, 'Montée de palier : différence de crédits du mois')
  on conflict do nothing;
  return v_diff;
end;
$$;
revoke execute on function public.grant_studio_upgrade_credits(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.grant_studio_upgrade_credits(uuid, text, text, text) to service_role;

-- 3. État des abonnements du compte connecté, pour afficher « Gérer mon abonnement » au bon endroit.
create or replace function public.my_billing()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'composer', (select jsonb_build_object('plan', cp.plan, 'active', cp.subscription_status = 'active',
                   'cancelAt', cp.subscription_cancel_at, 'canManage', cp.stripe_customer_id is not null)
                 from public.composer_profiles cp where cp.profile_id = auth.uid()),
    'studio', (select jsonb_build_object('plan', sp.plan, 'active', sp.subscription_status = 'active',
                 'cancelAt', sp.subscription_cancel_at, 'isOwner', sp.profile_id = auth.uid(),
                 'canManage', sp.profile_id = auth.uid() and sp.stripe_customer_id is not null)
               from public.studio_profiles sp where sp.id = public.account_studio_id(auth.uid()))
  );
$$;
revoke execute on function public.my_billing() from public, anon;
grant execute on function public.my_billing() to authenticated;

-- 4. my_credits : la résiliation programmée apparaît aussi dans l'espace studio.
create or replace function public.my_credits()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (select public.account_studio_id(auth.uid()) as id)
  select case when s.id is null then null else jsonb_build_object(
    'balance', public.studio_credit_balance(s.id),
    'monthly', (select e.amount from public.entitlement(auth.uid(), 'monthly_credits', false) e where e.allowed),
    'subscription', (select jsonb_build_object('status', sp.subscription_status, 'periodEnd', sp.subscription_period_end, 'plan', sp.plan,
                       'cancelAt', sp.subscription_cancel_at) from public.studio_profiles sp where sp.id = s.id),
    'history', coalesce((select jsonb_agg(jsonb_build_object('delta', l.delta, 'reason', l.reason, 'createdAt', l.created_at,
        'packTitle', (select title from public.packs where id = l.pack_id), 'actorEmail', (select email from auth.users where id = l.actor_id))
        order by l.created_at desc) from (select * from public.studio_credit_ledger where studio_id = s.id order by created_at desc limit 50) l), '[]'::jsonb)
  ) end from s;
$$;
revoke execute on function public.my_credits() from public, anon;
grant execute on function public.my_credits() to authenticated;
