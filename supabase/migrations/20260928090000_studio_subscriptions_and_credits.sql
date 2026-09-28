-- LayerPitch — chantier profils et permissions, étape 6b (28 septembre) : abonnements studio et crédits
-- (D15, D16, D18, D19, D31 du cadrage layerpitch-docs/2026-09-27-cadrage-profils-permissions.md).
--
-- 1. Abonnement STUDIO (Indie 39 €, AA 129 €/mois ; AAA sur devis) : état stocké sur studio_profiles (écrit par le
--    webhook Stripe, jamais par le client). Abonnement COMPOSITEUR : on garde désormais l'id Stripe de l'abonnement,
--    pour pouvoir lui appliquer / retirer la réduction du bundle (D19 : compositeur à −50 % tant qu'un palier studio
--    payant est actif sur le même compte).
-- 2. Crédits (D15, D18, D31) : un journal par studio (studio_credit_ledger) ; le solde = la somme. Dotation à chaque
--    période payée (invoice.paid, idempotente par période) ; reportés sans limite tant que le studio reste abonné ;
--    après une résiliation, le solde expire 28 jours après la fin de la dernière période payée (tâche quotidienne).
-- 3. Prendre un pack avec ses crédits (take_pack_with_credits) : pack du catalogue abonnés, pas déjà dans la bibliothèque
--    de l'équipe, solde suffisant. Le pack entre dans la bibliothèque (pack_purchases.source = 'credits', 0 €) et le
--    compositeur est payé COMME UNE VENTE : valeur du niveau (1 crédit = 10 €, D31) moins la commission de SON palier
--    (credit_payouts, versé par l'Edge Function pay-credit-downloads). Feu vert 'subscriber_catalog' (admin pendant la bêta).

-- ---- 1. Abonnements ----
alter table public.studio_profiles
  add column subscription_status text not null default 'none' check (subscription_status in ('none', 'active', 'canceled')),
  add column subscription_period_end timestamptz,
  add column stripe_customer_id text,
  add column stripe_subscription_id text;
alter table public.composer_profiles
  add column stripe_subscription_id text,
  add column bundle_discount_active boolean not null default false;
comment on column public.composer_profiles.bundle_discount_active is 'Réduction du bundle (−50 %, D19) actuellement appliquée à l''abonnement Stripe du compositeur. Écrit par le webhook.';

-- Le compte a-t-il un palier studio PAYANT actif (bundle) ? Propriétaire ou membre de l'équipe : c'est le studio qui paie.
create or replace function public.account_has_paid_studio(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.studio_profiles sp
                 where sp.id = public.account_studio_id(p_profile_id) and sp.plan in ('indie', 'aa', 'aaa') and sp.subscription_status = 'active');
$$;
revoke execute on function public.account_has_paid_studio(uuid) from public, anon, authenticated;
grant execute on function public.account_has_paid_studio(uuid) to service_role;

-- ---- 2. Crédits ----
alter table public.pack_purchases drop constraint pack_purchases_source_check;
alter table public.pack_purchases add constraint pack_purchases_source_check check (source in ('stripe', 'gift', 'credits'));

create table public.studio_credit_ledger (
  id bigint generated always as identity primary key,
  studio_id uuid not null references public.studio_profiles(id) on delete cascade,
  delta int not null,
  reason text not null check (reason in ('grant', 'download', 'expiry', 'adjust')),
  period text,                                   -- période de dotation (ex. '2026-10-01'), pour l'idempotence
  pack_id text references public.packs(id) on delete set null,
  pack_purchase_id uuid references public.pack_purchases(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create unique index studio_credit_grant_once on public.studio_credit_ledger (studio_id, period) where reason = 'grant';
create index studio_credit_ledger_idx on public.studio_credit_ledger (studio_id, created_at desc);
alter table public.studio_credit_ledger enable row level security;

create or replace function public.studio_credit_balance(p_studio_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(delta), 0)::int from public.studio_credit_ledger where studio_id = p_studio_id;
$$;
revoke execute on function public.studio_credit_balance(uuid) from public, anon, authenticated;
grant execute on function public.studio_credit_balance(uuid) to service_role;

-- Dotation d'une période (webhook invoice.paid). Idempotente : une seule dotation par studio et par période.
create or replace function public.grant_studio_credits(p_studio_id uuid, p_period text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_owner uuid; v_amount numeric;
begin
  select profile_id into v_owner from public.studio_profiles where id = p_studio_id;
  if v_owner is null then raise exception 'Studio introuvable'; end if;
  select e.amount into v_amount from public.entitlement(v_owner, 'monthly_credits', false) e where e.allowed;
  if coalesce(v_amount, 0) <= 0 then return 0; end if;
  insert into public.studio_credit_ledger (studio_id, delta, reason, period, note)
  values (p_studio_id, v_amount::int, 'grant', p_period, 'Dotation de la période') on conflict do nothing;
  return v_amount::int;
end;
$$;
revoke execute on function public.grant_studio_credits(uuid, text) from public, anon, authenticated;
grant execute on function public.grant_studio_credits(uuid, text) to service_role;

-- Expiration (D18) : 28 jours après la fin de la dernière période payée d'un abonnement résilié. Tâche quotidienne.
create or replace function public.expire_lapsed_studio_credits()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_count int := 0; v_balance int;
begin
  for r in select id from public.studio_profiles
           where subscription_status = 'canceled' and subscription_period_end is not null and subscription_period_end + interval '28 days' < now()
  loop
    v_balance := public.studio_credit_balance(r.id);
    if v_balance > 0 then
      insert into public.studio_credit_ledger (studio_id, delta, reason, note) values (r.id, -v_balance, 'expiry', 'Expiration : abonnement résilié depuis plus de 28 jours');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.expire_lapsed_studio_credits() from public, anon, authenticated;
grant execute on function public.expire_lapsed_studio_credits() to service_role;
select cron.schedule('expire-studio-credits', '30 3 * * *', 'select public.expire_lapsed_studio_credits()');

-- ---- 3. Prendre un pack avec ses crédits ; rémunération du compositeur ----
create table public.credit_payouts (
  id uuid primary key default gen_random_uuid(),
  pack_purchase_id uuid not null unique references public.pack_purchases(id) on delete cascade,
  composer_id uuid not null references public.composer_profiles(id),
  credits int not null,
  gross_cents int not null,          -- valeur du niveau : crédits × 10 €
  commission_rate numeric not null,  -- palier du compositeur au moment du téléchargement
  amount_cents int not null,         -- versé au compositeur
  status text not null default 'pending' check (status in ('pending', 'transferred', 'failed')),
  stripe_transfer_id text,
  invoice_id uuid references public.invoices(id),
  error text,
  created_at timestamptz not null default now()
);
alter table public.credit_payouts enable row level security;
create policy "own credit payouts (composer)" on public.credit_payouts for select
  using (composer_id in (select id from public.composer_profiles where profile_id = auth.uid()));

create or replace function public.take_pack_with_credits(p_pack_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio uuid := public.account_studio_id(auth.uid());
  v_ent record;
  k record;
  v_balance int;
  v_purchase uuid;
  v_rate numeric;
  v_gross int;
begin
  if v_studio is null then raise exception 'Il faut un espace studio pour utiliser des crédits'; end if;
  select * into v_ent from public.entitlement(auth.uid(), 'monthly_credits', false);
  if not coalesce(v_ent.allowed, false) then raise exception 'Les crédits ne sont pas inclus dans ton palier' using hint = 'plan'; end if;
  select * into k from public.packs where id = p_pack_id;
  if not found or k.subscriber_credits is null or not k.buyable then raise exception 'Ce pack n''est pas dans le catalogue abonnés'; end if;
  if exists (select 1 from public.my_owned_assets() o where o.pack_id = p_pack_id)
     or exists (select 1 from public.pack_purchases pp where pp.pack_id = p_pack_id and pp.studio_id in (select profile_id from public.studio_accounts(v_studio))) then
    raise exception 'Ce pack est déjà dans la bibliothèque de ton studio';
  end if;
  perform pg_advisory_xact_lock(hashtext('studio-credits:' || v_studio::text)); -- deux prises simultanées ne passent pas sous le solde
  v_balance := public.studio_credit_balance(v_studio);
  if v_balance < k.subscriber_credits then
    raise exception 'Crédits insuffisants : % disponible(s), % nécessaire(s)', v_balance, k.subscriber_credits using hint = 'balance';
  end if;
  insert into public.pack_purchases (studio_id, pack_id, price_paid, source) values (auth.uid(), p_pack_id, 0, 'credits') returning id into v_purchase;
  insert into public.studio_credit_ledger (studio_id, delta, reason, pack_id, pack_purchase_id, actor_id)
  values (v_studio, -k.subscriber_credits, 'download', p_pack_id, v_purchase, auth.uid());
  -- Compositeur payé comme une vente : valeur du niveau moins la commission de SON palier (sans aperçu admin).
  select e.amount into v_rate from public.composer_profiles cp cross join lateral public.entitlement(cp.profile_id, 'commission_rate', false) e where cp.id = k.owner_id;
  v_gross := k.subscriber_credits * 1000;
  insert into public.credit_payouts (pack_purchase_id, composer_id, credits, gross_cents, commission_rate, amount_cents)
  values (v_purchase, k.owner_id, k.subscriber_credits, v_gross, coalesce(v_rate, 0), v_gross - round(v_gross * coalesce(v_rate, 0))::int);
  return jsonb_build_object('ok', true, 'balance', v_balance - k.subscriber_credits, 'purchaseId', v_purchase);
end;
$$;
revoke execute on function public.take_pack_with_credits(text) from public, anon;
grant execute on function public.take_pack_with_credits(text) to authenticated;

-- Solde et historique du studio du compte connecté (propriétaire ou membre).
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
    'subscription', (select jsonb_build_object('status', sp.subscription_status, 'periodEnd', sp.subscription_period_end, 'plan', sp.plan) from public.studio_profiles sp where sp.id = s.id),
    'history', coalesce((select jsonb_agg(jsonb_build_object('delta', l.delta, 'reason', l.reason, 'createdAt', l.created_at,
        'packTitle', (select title from public.packs where id = l.pack_id), 'actorEmail', (select email from auth.users where id = l.actor_id))
        order by l.created_at desc) from (select * from public.studio_credit_ledger where studio_id = s.id order by created_at desc limit 50) l), '[]'::jsonb)
  ) end from s;
$$;
revoke execute on function public.my_credits() from public, anon;
grant execute on function public.my_credits() to authenticated;
