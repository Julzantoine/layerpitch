-- LayerPitch — facturation légale automatisée des ventes de packs (mandat de facturation,
-- article 289 du Code général des impôts) : le compositeur est le mandant (vendeur légal),
-- LayerPitch le mandataire qui émet le document en son nom, sans transfert de responsabilité
-- fiscale -- modèle "agence" (eBay/Amazon Marketplace/Leboncoin Pro), pas le modèle Etsy (TVA
-- absente des documents, vendeurs contraints de reconstruire leur facturation eux-mêmes --
-- exactement le "bordel" que Jules-Antoine veut éviter).
--
-- Identité vendeur déclarative (pas de lecture de l'API Stripe Connect) : pour un compte Standard,
-- la plateforme perd l'accès à l'objet `persons` une fois l'Account Link généré, et la lisibilité
-- de business_profile/company dans ce cas n'est pas garantie avec certitude par la documentation
-- Stripe -- même principe déclaratif que composer_profiles.student_tier_declared.
--
-- Distinction facture/attestation de vente tranchée par billing_status : un particulier n'a pas le
-- droit d'émettre une facture, une attestation de vente doit être produite à la place.
--
-- Numérotation séquentielle PAR COMPOSITEUR (pas une séquence globale LayerPitch) -- cohérent avec
-- la pratique du mandat de facturation, où le mandataire utilise une séquence distincte par
-- mandant. invoice_sequence_next incrémenté via next_invoice_number(), UPDATE ... RETURNING
-- atomique -- pas de race condition entre deux ventes simultanées du même compositeur.

alter table public.composer_profiles
  add column billing_status text check (billing_status in ('professionnel', 'particulier')),
  add column billing_legal_name text,
  add column billing_address text,
  add column billing_siret text,
  add column billing_vat_number text,
  add column billing_vat_applicable boolean,
  add column invoice_sequence_next int not null default 1;

-- Une facture/attestation par achat. seller_snapshot/buyer_snapshot COPIENT l'identité légale au
-- moment de l'émission plutôt que de référencer composer_profiles/la session Stripe en direct --
-- l'identité (adresse, statut TVA) peut changer après la vente, le document doit rester figé sur
-- l'état réel au moment de la transaction, jamais recalculé rétroactivement par un JOIN vivant.
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.pack_purchases(id) on delete cascade,
  composer_id uuid not null references public.composer_profiles(id) on delete cascade,
  invoice_number text not null,
  document_type text not null check (document_type in ('facture', 'attestation_vente')),
  pdf_storage_path text not null,
  seller_snapshot jsonb not null,
  buyer_snapshot jsonb not null,
  amount_ht numeric,
  vat_rate numeric,
  amount_vat numeric,
  amount_ttc numeric not null,
  created_at timestamptz not null default now()
);

create unique index invoices_purchase_id_idx on public.invoices(purchase_id);
create index invoices_composer_id_idx on public.invoices(composer_id);

alter table public.invoices enable row level security;

-- Lecture : le compositeur voit les factures de ses propres ventes (copie légale qu'il doit
-- pouvoir consulter -- obligation du mandataire de rendre accessible un exemplaire au mandant),
-- l'acheteur voit la facture de ses propres achats (via pack_purchases.studio_id = profiles.id du
-- compte connecté). Écriture réservée à service_role (stripe-webhook), jamais de policy INSERT
-- côté client -- même principe que pack_purchases lui-même.
create policy "own issued invoices (composer)" on public.invoices
  for select using (
    composer_id in (select id from public.composer_profiles where profile_id = auth.uid())
  );

create policy "own purchased invoices (buyer)" on public.invoices
  for select using (
    purchase_id in (select id from public.pack_purchases where studio_id = auth.uid())
  );

-- Lien retour depuis l'achat -- pas strictement nécessaire (invoices.purchase_id suffit pour un
-- lookup), mais évite un second aller-retour depuis api/purchases.js (myPurchases()) qui doit
-- pouvoir afficher directement le lien de téléchargement de chaque achat. Nullable : la génération
-- de facture est asynchrone (déclenchée dans stripe-webhook après l'upsert pack_purchases réussi)
-- et peut échouer sans faire échouer le webhook lui-même (le paiement a eu lieu, l'achat est acquis
-- même si la facture doit être régénérée manuellement plus tard).
alter table public.pack_purchases add column invoice_id uuid references public.invoices(id);

-- SECURITY DEFINER : appelée par stripe-webhook avec l'identité service_role, mais le compteur
-- appartient à composer_profiles (RLS "own profile" en lecture seule côté client) -- même patron
-- que les autres RPC d'écriture de ce projet, jamais de GRANT UPDATE direct sur la colonne.
create or replace function public.next_invoice_number(p_composer_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number int;
begin
  update public.composer_profiles
    set invoice_sequence_next = invoice_sequence_next + 1
    where id = p_composer_id
    returning invoice_sequence_next - 1 into v_number;
  if v_number is null then
    raise exception 'composer_profiles introuvable pour p_composer_id';
  end if;
  return v_number;
end;
$$;

-- Pas de GRANT authenticated : appelée uniquement depuis stripe-webhook (service_role), jamais
-- depuis un client -- contrairement aux autres RPC de ce projet qui accordent authenticated.

-- Écriture du profil de facturation par le compositeur connecté -- RLS "own composer profile"
-- (20260831102636_rls_policies.sql) n'autorise qu'une lecture de sa propre ligne, aucun GRANT
-- UPDATE côté client (même trou que profiles avant mark_onboarding_complete() -- corrigé ici dès
-- le départ plutôt que découvert au premier test réel). billing_siret non validé ici (format,
-- existence réelle) -- déclaratif, comme student_tier_declared.
create or replace function public.update_my_billing_profile(
  p_status text, p_legal_name text, p_address text, p_siret text, p_vat_number text, p_vat_applicable boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Non autorisé : aucune session active';
  end if;
  if p_status not in ('professionnel', 'particulier') then
    raise exception 'Statut invalide (professionnel ou particulier attendu)';
  end if;
  update public.composer_profiles
    set billing_status = p_status,
        billing_legal_name = p_legal_name,
        billing_address = p_address,
        billing_siret = p_siret,
        billing_vat_number = p_vat_number,
        billing_vat_applicable = p_vat_applicable
    where profile_id = v_uid;
end;
$$;

grant execute on function public.update_my_billing_profile(text, text, text, text, text, boolean) to authenticated;
