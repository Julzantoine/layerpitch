-- LayerPitch — feu vert de la frise de transition (14/11).
--
-- Éditeur de transition (embranchement vertical et séquentiel) : frise temps/mesures avec deux repères glissables, « Fondu » (début du
-- fondu de la boucle quittée) et « Boucle » (entrée de la suivante). Aucune table ni colonne : les deux réglages vivent dans le JSON de la
-- transition (fadeOutBeat / nextInBeat). Le moteur les applique dès qu'ils existent ; seul l'éditeur est caché. Admin seulement jusqu'au feu vert :
--   select public.set_feature_released('transition_timeline', true);
insert into public.feature_flags (key, description) values
  ('transition_timeline', 'Frise de transition (14/11) — repères Fondu / Boucle sur une grille de temps, embranchement vertical et séquentiel ; admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;
