-- LayerPitch — mark_onboarding_complete() en RPC plutôt qu'un GRANT UPDATE direct sur profiles.
--
-- Trouvé au premier vrai test (jules_escande@hotmail.com, bienvenue.html) : "permission denied for
-- table profiles" — la policy RLS "own profile update" (20260831102636_rls_policies.sql) existe,
-- mais aucun GRANT UPDATE de base n'a jamais été posé sur profiles pour authenticated (RLS filtre
-- les lignes, encore faut-il le privilège de table sous-jacent -- même famille de correctif que
-- 20260831112717_grants.sql). Corriger en ouvrant ce GRANT casserait le principe déjà acté et
-- documenté dans ce même fichier : "INSERT/UPDATE/DELETE direct NON accordés : toute écriture
-- passe par les RPC upsert_* (SECURITY DEFINER)". Cohérent avec ce principe plutôt que d'y déroger
-- pour ce seul cas : une RPC étroite, pas un GRANT ouvert.
create or replace function public.mark_onboarding_complete()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Non autorisé : aucune session active';
  end if;
  update public.profiles set onboarding_completed = true where id = v_uid;
end;
$$;

grant execute on function public.mark_onboarding_complete() to authenticated;
