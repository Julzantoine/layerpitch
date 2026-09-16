-- LayerPitch — réimport ponctuel des invitations passées dans le nouvel historique `invites`
-- (16 septembre, suite à 20260916070000_invites.sql).
--
-- Seules les invitations parties d'une demande d'accès (access_requests.invited_at renseigné)
-- laissent une trace récupérable -- une invitation envoyée directement (sans demande préalable)
-- avant aujourd'hui n'a jamais été enregistrée nulle part, donc irrécupérable. user_id retrouvé
-- par correspondance d'email avec auth.users (best effort -- reste NULL si l'email a changé
-- depuis, get_invites() affichera alors "En attente" même si la personne a bien rejoint).
-- Idempotent (not exists sur access_request_id) : peut être relancé sans dupliquer.

insert into public.invites (email, user_id, invited_by, access_request_id, created_at)
select
  ar.email,
  u.id,
  (select id from auth.users where email = 'julzantoine@yahoo.com'),
  ar.id,
  ar.invited_at
from public.access_requests ar
left join auth.users u on lower(u.email) = lower(ar.email)
where ar.invited_at is not null
  and not exists (select 1 from public.invites i where i.access_request_id = ar.id);
