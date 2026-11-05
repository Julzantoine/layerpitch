-- LayerPitch — feu vert du layering additif à sections (30/10).
--
-- Nouveau mode de morceau : des sections qui s'enchaînent, chacune avec ses couches et son propre niveau d'intensité.
-- Aucune table ni colonne (tout vit dans tracks.mode et tracks.sections). Admin seulement jusqu'au feu vert :
--   select public.set_feature_released('additive_sections', true);
insert into public.feature_flags (key, description) values
  ('additive_sections', 'Layering additif à sections (30/10) — sections enchaînées, chacune avec ses couches et son propre niveau d''intensité ; admin seulement.')
on conflict (key) do nothing;
