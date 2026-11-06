-- LayerPitch — feu vert de la sélection multiple dans les listes à dossiers (05/11).
--
-- Bibliothèque de morceaux, bibliothèque Sfx, Gérer les AdReels : Cmd/Ctrl + clic et Maj + clic
-- sélectionnent plusieurs lignes ; clic droit « Créer un dossier avec la sélection » ; glisser une ligne
-- choisie déplace toute la sélection. Aucune table ni colonne. Admin seulement jusqu'au feu vert :
--   select public.set_feature_released('multi_select_folders', true);
insert into public.feature_flags (key, description) values
  ('multi_select_folders', 'Sélection multiple dans les listes à dossiers (05/11) — Cmd/Maj + clic, clic droit « Créer un dossier avec la sélection », glisser plusieurs lignes ; admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;
