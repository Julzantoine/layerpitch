-- LayerPitch — GRANT de base manquants, trouvés au test réel via le navigateur (PostgREST) :
-- "permission denied for table tracks". RLS restreint les LIGNES visibles mais ne suffit pas seule
-- — Postgres exige aussi le privilège de table sous-jacent. Les tables ayant été créées via une
-- connexion Postgres directe (pas via le flux habituel du dashboard Supabase), les GRANT par
-- défaut que Supabase applique normalement n'ont jamais été posés.
--
-- SELECT à anon+authenticated sur tout le schéma public : sans danger, RLS filtre déjà
-- correctement les lignes visibles table par table (lecture publique pour le contenu, lecture
-- restreinte au propriétaire pour profiles/composer_profiles/buyer_profiles/pack_purchases/
-- album_purchases — voir 20260831102636_rls_policies.sql). INSERT/UPDATE/DELETE direct NON
-- accordés : toute écriture passe par les RPC upsert_* (SECURITY DEFINER, s'exécutent avec les
-- privilèges du propriétaire de la fonction, pas de l'appelant — confirmé par les tests RPC déjà
-- passés avant ce correctif).
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant select on tables to anon, authenticated;
