-- LayerPitch — feu vert « protection par défaut des nouveaux morceaux » (retour bêta du 11/11, décision du 12/11).
--
-- À la PREMIÈRE publication d'un morceau, le Backstage le protège automatiquement (fichiers dans le stockage privé, liens
-- temporaires, plus de téléchargement direct). Les morceaux déjà en base ne changent pas. Aucune table ni colonne.
-- Prérequis : migration 20261112010000 (un morceau protégé reste audible dans n'importe quel pack) et Edge Function
-- copy-track-files redéployée (copie d'un morceau protégé). Admin seulement jusqu'au feu vert :
--   select public.set_feature_released('protect_by_default', true);
insert into public.feature_flags (key, description) values
  ('protect_by_default', 'Protection par défaut des nouveaux morceaux (12/11) — protégés dès leur première publication (pas de téléchargement direct) ; admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;
