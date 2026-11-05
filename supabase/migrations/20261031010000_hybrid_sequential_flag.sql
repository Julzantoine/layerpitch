-- LayerPitch — feu vert du séquentiel hybride (31/10), et retrait du layering additif à sections.
--
-- Nouveau mode de morceau : des sections qui s'enchaînent, chacune étant un morceau de la bibliothèque avec son propre mode.
-- Aucune table ni colonne : tout vit dans tracks.mode et tracks.sections ({ id, label, trackId, maxLoops }). Admin seulement jusqu'au
-- feu vert : select public.set_feature_released('hybrid_sequential', true);
-- Le mode additif à sections (20261030010000) est retiré du code ; aucun morceau enregistré ne l'utilisait au 31/10.
insert into public.feature_flags (key, description) values
  ('hybrid_sequential', 'Séquentiel hybride (31/10) — sections enchaînées, chacune étant un morceau de la bibliothèque avec son propre mode ; admin seulement.')
on conflict (key) do nothing;
delete from public.feature_flags where key = 'additive_sections';
