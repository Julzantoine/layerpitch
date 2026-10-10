-- LayerPitch — feu vert des leçons guidées du Backstage (08/10).
--
-- Sépare les leçons (menu « Tutoriel » de la barre du haut + leçons par mode) de la visite guidée, qui garde son propre
-- feu vert 'in_app_tour'. Aucune table ni colonne. Admin seulement jusqu'au feu vert :
--   select public.set_feature_released('in_app_lessons', true);
insert into public.feature_flags (key, description) values
  ('in_app_lessons', 'Leçons guidées du Backstage (08/10) — menu « Tutoriel » de la barre du haut et leçons par mode, admin seulement jusqu''au feu vert (la visite guidée a le sien : in_app_tour).')
on conflict (key) do nothing;
