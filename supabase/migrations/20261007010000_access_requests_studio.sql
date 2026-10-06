-- Demandes d'invitation des studios (7/10) : une 3e « intention », « studio », à côté de « beta » et « waitlist ».
-- Jusqu'ici le formulaire de la page Studios partait en « beta » avec « [STUDIO] » en tête du message. L'Edge Function
-- submit-access-request écrit directement dans la table (l'ancienne RPC submit_access_request n'est plus appelable) : seule la
-- contrainte de la colonne intent change. Les demandes existantes ne sont pas touchées.
alter table public.access_requests drop constraint if exists access_requests_intent_check;
alter table public.access_requests add constraint access_requests_intent_check
  check (intent is null or intent in ('beta', 'waitlist', 'studio'));
