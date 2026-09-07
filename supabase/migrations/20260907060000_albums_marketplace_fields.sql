-- Branchement pour la future Marketplace Adaptive OST maison (docs/extensions-roadmap.md §5.6,
-- catégories "Albums de compositeur" / "OST officielles"). Aucune UI construite ici (pas de
-- backstage, pas de page publique, pas de RPC d'écriture) -- uniquement les colonnes qui rendent la
-- table `albums` (provisionnée vide depuis le 31 août) prête à recevoir la mécanique d'achat le jour
-- où ce chantier sera repris, sans migration supplémentaire à refaire à ce moment-là.
--
-- Pas d'intégration Bandcamp (tranché le 7 septembre) : prix fixé par le vendeur, même mécanique que
-- `packs` (price_usd_cents + buyable), pas un simple lien externe comme `collections`. USD comme
-- `packs.price_usd_cents` (achat unitaire), pas EUR comme `plan_quotas` (abonnement) -- même
-- distinction déjà actée le 3 septembre pour ne pas mélanger les deux décisions de devise.
-- Commission : aucune nouvelle colonne -- réutilise `plan_quotas.commission_rate`, déjà en place et
-- déjà câblée à Stripe Connect pour les packs (15 % free / 5 % starter / 1 % pro), le même mécanisme
-- s'appliquera aux albums sans rien ajouter ici.
-- `tags` : même principe que `packs.tags` (Phase 2, vraie Marketplace organisée avec catalogue/filtres).
alter table public.albums
  add column price_usd_cents int,
  add column buyable boolean not null default false,
  add column tags text[] not null default '{}';
