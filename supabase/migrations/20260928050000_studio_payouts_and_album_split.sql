-- LayerPitch — chantier profils et permissions, étape 4b (28 septembre) : versement Stripe côté studio et vente d'album
-- partagée entre plusieurs bénéficiaires (D5, D6 ; « paiement puis transferts séparés » Stripe, vérifié le 27/09).
--
-- 1. studio_profiles reçoit la même identité de versement et de facturation que composer_profiles (compte Stripe
--    Connect Standard, profil de facturation déclaratif, numérotation propre) : le studio vend l'OST de son jeu (D2) et
--    peut être co-ayant droit (casquette « studio », D6). Une identité PAR PROFIL, pas par compte : un compte peut être
--    à la fois compositeur freelance et studio (deux entités légales différentes).
-- 2. Partage d'une vente d'album : album_sale_split() donne, pour un album en vente, chaque bénéficiaire (vendeur +
--    co-ayants droit ACCEPTÉS), sa casquette, sa part et son compte Stripe ; la part d'un co-ayant droit « je reverse
--    moi-même » revient au vendeur (D5). La commission LayerPitch est celle du palier du VENDEUR (D6), prise sur le total.
-- 3. album_payouts : un transfert Stripe par bénéficiaire et par achat (trace, idempotence, reprise en cas d'échec).
-- 4. invoices s'ouvre aux albums et aux studios : un document (facture ou attestation) PAR BÉNÉFICIAIRE, pour sa part,
--    émis au nom de chacun (mandat de facturation). purchase_id (pack) et composer_id deviennent facultatifs ; une
--    contrainte garantit qu'un document vise exactement un achat et exactement un vendeur.
-- Les Edge Functions correspondantes (create-album-checkout-session, stripe-webhook, create-connect-onboarding-link) sont
-- écrites mais NON TESTÉES avec Stripe au 28/09 : à essayer en mode test Stripe avant toute vente réelle. TVA d'un album
-- partagé entre plusieurs vendeurs : à valider avec l'expert-comptable (voir la note TVA B2C déjà ouverte).

-- ---- 1. Identité de versement et de facturation du studio ----
alter table public.studio_profiles
  add column stripe_connect_account_id text unique,
  add column stripe_connect_charges_enabled boolean not null default false,
  add column stripe_connect_payouts_enabled boolean not null default false,
  add column billing_status text check (billing_status in ('professionnel', 'particulier')),
  add column billing_legal_name text,
  add column billing_address text,
  add column billing_siret text,
  add column billing_vat_number text,
  add column billing_vat_applicable boolean,
  add column invoice_sequence_next int not null default 1;

create or replace function public.update_my_studio_billing_profile(
  p_status text, p_legal_name text, p_address text, p_siret text, p_vat_number text, p_vat_applicable boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : aucune session active'; end if;
  if p_status not in ('professionnel', 'particulier') then raise exception 'Statut invalide (professionnel ou particulier attendu)'; end if;
  update public.studio_profiles
     set billing_status = p_status, billing_legal_name = p_legal_name, billing_address = p_address,
         billing_siret = p_siret, billing_vat_number = p_vat_number, billing_vat_applicable = p_vat_applicable
   where profile_id = auth.uid();
  if not found then raise exception 'Aucun profil studio pour ce compte'; end if;
end;
$$;
revoke execute on function public.update_my_studio_billing_profile(text, text, text, text, text, boolean) from public, anon;
grant execute on function public.update_my_studio_billing_profile(text, text, text, text, text, boolean) to authenticated;

create or replace function public.next_studio_invoice_number(p_studio_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_number int;
begin
  update public.studio_profiles set invoice_sequence_next = invoice_sequence_next + 1
   where id = p_studio_id returning invoice_sequence_next - 1 into v_number;
  if v_number is null then raise exception 'studio_profiles introuvable pour p_studio_id'; end if;
  return v_number;
end;
$$;
revoke execute on function public.next_studio_invoice_number(uuid) from public, anon, authenticated;
grant execute on function public.next_studio_invoice_number(uuid) to service_role;

-- ---- 2. Partage d'une vente d'album ----
-- Une ligne par bénéficiaire. billing_ok = profil de facturation rempli ; ready = compte Stripe prêt à recevoir.
create or replace function public.album_sale_split(p_album_id text)
returns table (profile_id uuid, role text, share_bps int, stripe_account_id text, ready boolean, billing_ok boolean, is_seller boolean)
language sql
stable
security definer
set search_path = public
as $$
  with a as (select * from public.albums where id = p_album_id),
  bene as (
    select a.seller_id as profile_id, a.seller_role as role,
           10000 - coalesce((select sum(h.share_bps) from public.album_rights_holders h where h.album_id = a.id and h.status = 'accepted'), 0) as share_bps,
           true as is_seller
    from a
    union all
    select h.holder_profile_id, h.payout_role, h.share_bps, false
    from public.album_rights_holders h join a on a.id = h.album_id
    where h.status = 'accepted' and a.rights_declaration = 'shared'
  )
  select b.profile_id, b.role, b.share_bps::int,
         coalesce(cp.stripe_connect_account_id, sp.stripe_connect_account_id),
         coalesce(cp.stripe_connect_charges_enabled, sp.stripe_connect_charges_enabled, false),
         coalesce(cp.billing_status, sp.billing_status) is not null and coalesce(cp.billing_legal_name, sp.billing_legal_name) is not null,
         b.is_seller
  from bene b
  left join public.composer_profiles cp on b.role = 'composer' and cp.profile_id = b.profile_id
  left join public.studio_profiles sp on b.role = 'studio' and sp.profile_id = b.profile_id
  order by b.is_seller desc, b.share_bps desc;
$$;
revoke execute on function public.album_sale_split(text) from public, anon, authenticated;
grant execute on function public.album_sale_split(text) to service_role;

-- Commission de la vente d'un album : palier du vendeur, selon sa casquette (compositeur : commission_rate ; studio :
-- studio_commission_rate). Jamais l'aperçu admin.
create or replace function public.album_commission_rate(p_album_id text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select e.amount from public.albums a
  cross join lateral public.entitlement(a.seller_id, case a.seller_role when 'studio' then 'studio_commission_rate' else 'commission_rate' end, false) e
  where a.id = p_album_id;
$$;
revoke execute on function public.album_commission_rate(text) from public, anon, authenticated;
grant execute on function public.album_commission_rate(text) to service_role;

-- ---- 3. Transferts par bénéficiaire ----
-- Contrainte (pas un index partiel) : le webhook s'en sert pour l'idempotence (upsert on_conflict). Les achats de test
-- (sans paiement, stripe_payment_intent_id vide) restent possibles en nombre : plusieurs NULL sont autorisés.
alter table public.album_purchases add constraint album_purchases_stripe_intent_unique unique (stripe_payment_intent_id);

create table public.album_payouts (
  id uuid primary key default gen_random_uuid(),
  album_purchase_id uuid not null references public.album_purchases(id) on delete cascade,
  beneficiary_profile_id uuid not null references public.profiles(id),
  beneficiary_role text not null check (beneficiary_role in ('composer', 'studio')),
  share_bps int not null,
  amount_cents int not null,
  stripe_account_id text,
  stripe_transfer_id text,
  status text not null default 'pending' check (status in ('pending', 'transferred', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  unique (album_purchase_id, beneficiary_profile_id, beneficiary_role)
);
alter table public.album_payouts enable row level security;
-- Chaque bénéficiaire voit ses propres versements ; écriture par le webhook (service_role) seulement.
create policy "own album payouts" on public.album_payouts for select using (beneficiary_profile_id = auth.uid());

-- ---- 4. Factures : albums et studios ----
alter table public.invoices alter column purchase_id drop not null;
alter table public.invoices alter column composer_id drop not null;
alter table public.invoices
  add column album_purchase_id uuid references public.album_purchases(id) on delete cascade,
  add column studio_id uuid references public.studio_profiles(id) on delete cascade,
  add column beneficiary_profile_id uuid references public.profiles(id);
alter table public.invoices add constraint invoices_one_purchase check ((purchase_id is null) <> (album_purchase_id is null));
alter table public.invoices add constraint invoices_one_seller check ((composer_id is null) <> (studio_id is null));
create unique index invoices_album_beneficiary_idx on public.invoices (album_purchase_id, beneficiary_profile_id) where album_purchase_id is not null;

create policy "own issued invoices (studio)" on public.invoices
  for select using (studio_id in (select id from public.studio_profiles where profile_id = auth.uid()));
create policy "own purchased album invoices (buyer)" on public.invoices
  for select using (album_purchase_id in (select id from public.album_purchases where buyer_id = auth.uid()));
