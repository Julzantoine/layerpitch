-- LayerPitch — réimport des invitations directes passées (16 septembre, suite à
-- 20260916080000_backfill_invites_from_access_requests.sql).
--
-- Les inscriptions publiques étant désactivées côté projet (Décision 4), tout compte auth.users
-- existant a forcément été créé par une invitation admin (generateLink({type:'invite'}),
-- invite-tester) -- directe ou via demande d'accès. Le backfill précédent couvrait les secondes
-- (via access_requests.invited_at) ; celui-ci couvre les premières : tout compte qui n'a encore
-- aucune ligne dans invites. Date approximative (auth.users.created_at, date de création du
-- compte) faute de trace de la date exacte de clic sur "Inviter" -- généralement le même jour en
-- pratique. Exclut le compte admin lui-même (pas un testeur invité).

insert into public.invites (email, user_id, invited_by, access_request_id, created_at)
select
  u.email,
  u.id,
  (select id from auth.users where email = 'julzantoine@yahoo.com'),
  null,
  u.created_at
from auth.users u
where u.email is not null
  and u.email <> 'julzantoine@yahoo.com'
  and not exists (select 1 from public.invites i where i.user_id = u.id);
