-- LayerPitch — vente d'Adaptive OST : l'album appartient à un VENDEUR (compositeur OU studio), pas à un
-- compositeur seulement (décision du 21 septembre, layerpitch-docs/decisions/2026-09-21-vente-adaptive-ost-cadrage.md).
--
-- Avant : albums.owner_id -> composer_profiles(id), donc un studio ne pouvait pas vendre d'OST
-- (cas "OST officielle d'un jeu", extensions-roadmap.md 5.6). Après : albums.seller_id -> profiles(id)
-- (le COMPTE), plus seller_role ('composer' | 'studio') qui dit avec quelle casquette le compte vend.
-- Un même compte pouvant cumuler les profils compositeur et studio (Décision 4), le rôle ne se déduit
-- pas du compte seul : il doit être stocké. C'est l'option B validée avec Jules-Antoine.
--
-- Cette migration ne construit que le socle côté compositeur : upsert_album (20260921080000) n'accepte
-- pour l'instant que seller_role = 'composer'. Le côté studio (quelles pistes un studio peut mettre
-- dans son album, compte Stripe Connect studio) reste à construire — la colonne l'autorise déjà.

-- ---- albums : owner_id (compositeur) -> seller_id (compte) + seller_role ----
alter table public.albums
  add column seller_id uuid references public.profiles(id) on delete cascade,
  add column seller_role text check (seller_role in ('composer', 'studio'));

update public.albums a
set seller_id = cp.profile_id, seller_role = 'composer'
from public.composer_profiles cp
where cp.id = a.owner_id;

alter table public.albums
  alter column seller_id set not null,
  alter column seller_role set not null;

drop index public.albums_owner_id_idx;
alter table public.albums drop column owner_id;
create index albums_seller_id_idx on public.albums(seller_id);

comment on column public.albums.seller_id is 'Compte vendeur (profiles.id). Ne change jamais après la création. Le rôle avec lequel il vend est dans seller_role.';
comment on column public.albums.seller_role is 'Casquette du vendeur : ''composer'' (album de compositeur) ou ''studio'' (OST officielle d''un jeu). Un compte peut avoir les deux profils, d''où la colonne.';

-- Prix libre avec minimum, façon Bandcamp ("€3 or more") : la colonne existante devient le MINIMUM.
-- Pas de renommage : elle est déjà lue par le code de vente, et 0 reste valide (prix libre pur).
alter table public.albums
  add constraint albums_price_usd_cents_nonneg check (price_usd_cents is null or price_usd_cents >= 0);
comment on column public.albums.price_usd_cents is 'Prix MINIMUM en centimes USD (prix libre : le fan peut payer davantage). NULL = pas de prix fixé.';

-- ---- album_purchases : studio_id -> buyer_id (les albums sont achetés par des FANS) ----
-- Le renommage du 2 septembre (20260902200000) a suivi mécaniquement buyer_profiles -> studio_profiles
-- et renommé aussi cette colonne. pack_purchases.studio_id n'est PAS concerné : les packs restent un
-- achat studio.
alter table public.album_purchases rename column studio_id to buyer_id;

drop policy "own album purchases" on public.album_purchases;
create policy "own album purchases" on public.album_purchases for select using (auth.uid() = buyer_id);

create index album_purchases_buyer_id_idx on public.album_purchases(buyer_id);

-- Un achat de test (bêta, sans Stripe) doit rester distinguable d'un vrai achat pour toujours :
-- comptabilité, statistiques vendeur, nettoyage au lancement public.
alter table public.album_purchases add column is_test boolean not null default false;
comment on column public.album_purchases.is_test is 'true = achat factice de la bêta (claim_test_album), aucun paiement Stripe derrière. À exclure de tout calcul de revenu.';

-- ---- Interrupteur bêta de l'achat factice ----
-- Côté serveur (pas une simple constante JS comme PURCHASES_ENABLED) : sinon n'importe quel client
-- pourrait appeler la RPC après le lancement public. À passer à false à l'ouverture officielle
-- (même moment que le verrou "pack buyable admin-only", voir layerpitch_pack_buyable_beta_only_lock).
--
-- Nouvelle table `platform_flags` : l'ancien singleton `platform_settings` a été supprimé le
-- 7 septembre (20260907060000, remplacé par la boîte de messages admin) et plus aucun réglage global
-- n'existait depuis. Même idiome "ligne unique" que lui ; un nouveau drapeau global futur = une
-- colonne de plus ici, pas une nouvelle table. Nom différent exprès pour ne pas laisser croire que
-- l'ancienne table est revenue.
create table public.platform_flags (
  id boolean primary key default true,
  constraint platform_flags_singleton check (id),
  test_purchases_enabled boolean not null default true
);
comment on table public.platform_flags is 'Drapeaux globaux de plateforme. Ligne unique (id=true). Écriture uniquement par service_role / SQL direct (aucune policy d''écriture) — un futur RPC admin pourra l''exposer.';
comment on column public.platform_flags.test_purchases_enabled is 'Bêta : autorise claim_test_album() (obtenir un album gratuitement pour le tester). DOIT passer à false au lancement public.';
insert into public.platform_flags (id) values (true);

alter table public.platform_flags enable row level security;
-- Lecture publique : le client doit savoir s'il affiche le bouton "Obtenir (test)".
create policy "public read" on public.platform_flags for select using (true);
