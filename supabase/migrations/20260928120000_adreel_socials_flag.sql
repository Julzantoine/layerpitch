-- LayerPitch — feu vert du bloc « Réseaux sociaux » des AdReels (28/09).
--
-- Le bloc reprend les liens de la rubrique Réseaux sociaux du Backstage (table socials, déjà publique) et ne garde
-- que les identifiants cochés dans le JSON des blocs de l'AdReel : aucune nouvelle table ni colonne. Seul l'ajout d'un
-- bloc est réservé à l'admin (bouton caché dans le Backstage) jusqu'au feu vert :
--   select public.set_feature_released('adreel_socials', true);
insert into public.feature_flags (key, description) values
  ('adreel_socials', 'Bloc « Réseaux sociaux » des AdReels (28/09) — bouton d''ajout du Backstage, admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;
