-- LayerPitch — corrige 20260911162000_admin_messages_targeting.sql : create or replace function
-- avec une signature différente (ajout de p_recipient_id) crée une NOUVELLE surcharge en
-- PostgreSQL (l'identité d'une fonction inclut ses types de paramètres) au lieu de remplacer
-- l'ancienne -- admin_send_message(jsonb) et admin_send_message(jsonb, uuid default null)
-- coexistaient, ambiguës pour tout appel PostgREST avec seulement p_messages (api/admin.js).
-- Trouvé en vérifiant pg_proc juste après la migration précédente, jamais réellement invoqué en
-- prod entre les deux migrations.

drop function if exists public.admin_send_message(jsonb);
