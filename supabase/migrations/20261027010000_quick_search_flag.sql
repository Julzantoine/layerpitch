-- LayerPitch — feu vert de la recherche rapide du Backstage (27/10).
--
-- Cmd+P / Ctrl+P ouvre une fenêtre de recherche (onglets, morceaux, Sfx, AdReels, packs, collections, albums).
-- Aucune table ni colonne. Admin seulement jusqu'au feu vert :
--   select public.set_feature_released('quick_search', true);
insert into public.feature_flags (key, description) values
  ('quick_search', 'Recherche rapide du Backstage (27/10) — Cmd+P / Ctrl+P pour sauter à un onglet, un morceau, un Sfx, un AdReel, un pack, une collection ou un album ; admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;
