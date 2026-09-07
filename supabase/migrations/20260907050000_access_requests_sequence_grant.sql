-- LayerPitch — corrige un droit manquant sur access_requests (7 septembre, suite).
--
-- submit-access-request (Edge Function, service_role) insère directement dans access_requests,
-- contrairement à l'ancienne RPC submit_access_request() qui était SECURITY DEFINER (donc
-- s'exécutait avec les droits de son propriétaire, jamais bloquée par ce genre de permission).
-- Sans ce GRANT, l'insertion échoue avec "permission denied for sequence
-- access_requests_id_seq" : service_role a le droit d'écrire dans la table mais pas d'utiliser
-- la séquence qui génère sa clé primaire bigserial.
grant usage, select on sequence public.access_requests_id_seq to service_role;
