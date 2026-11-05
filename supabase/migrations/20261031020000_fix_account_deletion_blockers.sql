-- Suppression de compte : correction de account_deletion_blockers (31/10). « v := v || 'last_admin' » faisait lire le texte
-- comme un tableau par Postgres (« malformed array literal ») : account_deletion_status renvoyait une erreur 400 sur chaque
-- page pour le seul administrateur, et aucun des trois blocages ne donnait son vrai message. Le texte est maintenant typé.
-- « create or replace » conserve les droits posés par 20260929070000 (service_role seulement).
create or replace function public.account_deletion_blockers(p_profile uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text[] := array[]::text[];
begin
  if exists (select 1 from public.profiles where id = p_profile and deleted_at is not null) then v := v || 'already_deleted'::text; end if;
  if exists (select 1 from public.admins where profile_id = p_profile) and (select count(*) from public.admins) = 1 then v := v || 'last_admin'::text; end if;
  if exists (select 1 from public.studio_profiles sp join public.studio_members m on m.studio_id = sp.id
             where sp.profile_id = p_profile and m.status = 'active' and m.profile_id is not null and m.profile_id <> p_profile) then v := v || 'studio_team'::text; end if;
  return v;
end;
$$;
