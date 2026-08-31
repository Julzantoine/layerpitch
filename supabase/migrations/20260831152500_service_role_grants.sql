-- LayerPitch — GRANT manquants pour service_role, trouvés au test réel de create-checkout-session
-- ("permission denied for table packs", hint Postgres explicite). Même cause que
-- 20260831112717_grants.sql (tables créées via connexion Postgres directe, hors du flux habituel
-- du dashboard Supabase qui pose normalement ces GRANT automatiquement) — oubli du rôle
-- service_role dans cette migration précédente, qui ne couvrait que anon/authenticated.
--
-- service_role contourne déjà RLS (BYPASSRLS) mais a quand même besoin du privilège de table de
-- base — les deux mécanismes sont indépendants en Postgres.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
