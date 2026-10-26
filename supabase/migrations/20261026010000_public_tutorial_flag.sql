-- LayerPitch — feu vert du tutoriel PUBLIC (26/10).
--
-- Ouvre le mode tutoriel (?tuto : faux serveur local, compte fictif, rien d'enregistré) à toute personne SANS compte.
-- Tant que ce feu vert est fermé, seules les personnes connectées (bêta-testeurs, admins) y entrent. La table feature_flags est
-- en lecture publique : la page lit le feu vert sans connexion. Aucune table ni colonne. Pour ouvrir :
--   select public.set_feature_released('public_tutorial', true);
insert into public.feature_flags (key, description) values
  ('public_tutorial', 'Tutoriel public (26/10) — leçons « Moteur audio » jouables sans compte (bac à sable local, rien d''enregistré), fermé tant que le feu vert n''est pas donné.')
on conflict (key) do nothing;
