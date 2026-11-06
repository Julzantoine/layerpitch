-- LayerPitch — feu vert du bouton « Retirer « … » des noms » (06/11, retour de Peter K).
--
-- Vertical aléatoire : dans un pool, un clic retire le début commun des noms des variantes
-- (« Jazz Lo BS Dirty South Blender » -> « Dirty South Blender »). Seuls les libellés changent,
-- pas les fichiers. Aucune table ni colonne. Admin seulement jusqu'au feu vert :
--   select public.set_feature_released('trim_common_names', true);
insert into public.feature_flags (key, description) values
  ('trim_common_names', 'Retirer le début commun des noms des variantes d''un pool en un clic (06/11, retour de Peter K) ; admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;
