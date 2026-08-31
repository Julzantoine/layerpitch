-- LayerPitch — colonnes manquantes sur segment_slots, trouvées par le script de vérification de
-- fidélité de migration (scripts/verify-postgres-migration.js) sur un vrai morceau (Robot Adventure,
-- bmsrox5psn3r4k) : `bpm` et `customCutFadeSec` existent dans data.json et sont lus par player.js
-- (slotTiming(), voir lignes ~1215-1224) mais absents du schéma initial. `beatsPerBar` ajoutée en
-- même temps par cohérence — même override par emplacement, même fonction slotTiming(), pas encore
-- rencontrée dans les données existantes mais utilisée par le code de la même façon que `bpm`.

alter table public.segment_slots
  add column bpm numeric,
  add column beats_per_bar int,
  add column custom_cut_fade_sec numeric;
