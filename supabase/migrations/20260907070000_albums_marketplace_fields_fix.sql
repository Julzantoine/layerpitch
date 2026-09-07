-- Correctif de 20260907060000_albums_marketplace_fields.sql : ce fichier a été appliqué en base
-- avec son contenu initial (buy_url/free_download_enabled, façon Bandcamp) avant d'être corrigé sur
-- disque vers le vrai choix acté le 7 septembre (prix natif fixé par le vendeur, pas d'intégration
-- Bandcamp) -- le suivi des migrations se fait par nom de fichier, pas par contenu, donc la
-- correction sur disque n'a pas été rejouée automatiquement. Ce fichier répare l'écart : retire les
-- deux colonnes façon lien externe, ajoute le prix natif (même mécanique que packs.price_usd_cents).
-- `buyable` et `tags` restent inchangés, corrects dans les deux versions.
alter table public.albums
  drop column buy_url,
  drop column free_download_enabled,
  add column price_usd_cents int;
