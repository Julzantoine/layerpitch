-- LayerPitch — feu vert de la visite guidée du Backstage (08/10).
--
-- Aucune table ni colonne : la visite (bulles posées tour à tour sur les zones du Backstage) et le menu « Visite guidée »
-- sont affichés selon ce feu vert, admin seulement jusqu'au feu vert :
--   select public.set_feature_released('in_app_tour', true);
insert into public.feature_flags (key, description) values
  ('in_app_tour', 'Visite guidée du Backstage (08/10) — lancement à la première connexion et entrée « Visite guidée » du menu du compte, admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;
