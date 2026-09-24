-- Correctif de 20260907060000_albums_marketplace_fields.sql : ce fichier a été appliqué en base
-- avec son contenu initial (buy_url/free_download_enabled, façon Bandcamp) avant d'être corrigé sur
-- disque vers le vrai choix acté le 7 septembre (prix natif fixé par le vendeur, pas d'intégration
-- Bandcamp) -- le suivi des migrations se fait par nom de fichier, pas par contenu, donc la
-- correction sur disque n'a pas été rejouée automatiquement. Ce fichier répare l'écart : retire les
-- deux colonnes façon lien externe, ajoute le prix natif (même mécanique que packs.price_usd_cents).
-- `buyable` et `tags` restent inchangés, corrects dans les deux versions.
--
-- Rendu idempotent le 24/09 (revue de code) : sur une base NEUVE, 20260907060000 est rejoué dans sa version corrigée
-- (sans buy_url ni free_download_enabled), et ce correctif échouait -- impossible de reconstruire la base depuis zéro.
-- `if exists` / `if not exists` : aucun effet sur la base de production (déjà corrigée), reconstruction possible.
alter table public.albums
  drop column if exists buy_url,
  drop column if exists free_download_enabled,
  add column if not exists price_usd_cents int;
