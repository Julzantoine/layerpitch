-- LayerPitch — Accueil de l'Espace studio (14 novembre 2026).
--
-- Feu vert « studio_home » : l'onglet Accueil en tête de l'Espace studio (studio.html), page d'arrivée par défaut.
-- Admin seulement jusqu'à ouverture :
--      select public.set_feature_released('studio_home', true);
-- Aucune autre table ni fonction : l'Accueil studio lit ce qui existe déjà (palier, crédits, montages vidéo, boîte aux lettres).

insert into public.feature_flags (key, description) values
  ('studio_home', 'Accueil de l''Espace studio (14/11) — page d''arrivée avec question du jour, boîte aux lettres, montages récents, palier et nouveautés ; admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;
