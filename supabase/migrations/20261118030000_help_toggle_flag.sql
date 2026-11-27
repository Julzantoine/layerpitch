-- LayerPitch — Bouton « ? » d'aide contextuelle, toujours visible (18 novembre 2026).
--
-- Le « ? » posé à côté du bouton de repli de la barre latérale (Backstage et pages d'espace) allume ou éteint les bulles
-- d'aide ; c'est le même réglage que « Aide contextuelle » dans les Réglages rapides de l'Accueil (profiles.home_prefs.help_off,
-- clé déjà acceptée par set_my_home_prefs : aucune autre modification de base). Admin seulement jusqu'à ouverture :
--   select public.set_feature_released('help_toggle', true);

insert into public.feature_flags (key, description) values
  ('help_toggle', 'Bouton « ? » (18/11) — allume / éteint les bulles d''aide depuis la barre latérale, sur toutes les pages ; admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;
