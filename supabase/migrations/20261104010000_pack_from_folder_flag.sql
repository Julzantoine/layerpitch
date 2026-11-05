-- LayerPitch — feu vert « Créer un pack avec ce dossier » (04/11).
--
-- Bouton dans l'en-tête des dossiers (bibliothèque de morceaux et bibliothèque Sfx) : crée un nouveau pack, copie unique,
-- avec les morceaux du dossier et les Sfx qui leur sont attachés (ou les Sfx du dossier). Aucune table ni colonne :
-- le pack est un pack ordinaire. Admin seulement jusqu'au feu vert :
--   select public.set_feature_released('pack_from_folder', true);
insert into public.feature_flags (key, description) values
  ('pack_from_folder', 'Créer un pack avec ce dossier (04/11) — bouton sur les dossiers de morceaux et de Sfx ; admin seulement.')
on conflict (key) do nothing;
