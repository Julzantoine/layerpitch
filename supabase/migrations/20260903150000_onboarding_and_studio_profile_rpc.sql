-- LayerPitch — flux d'inscription (docs/infrastructure.md, chantier "flux d'inscription").
--
-- profiles.onboarding_completed : marque qu'un compte a déjà vu/passé l'écran d'accueil
-- (bienvenue.html), pour ne jamais le lui reproposer. Backfillé à true pour tous les comptes déjà
-- en usage (Jules-Antoine + les deux comptes de test compositeur) -- aucun d'eux ne doit voir
-- l'écran au prochain login, il n'existait pas encore quand ces comptes ont été créés.
alter table public.profiles add column onboarding_completed boolean not null default false;
update public.profiles set onboarding_completed = true;

-- ensure_studio_profile() : copie conforme d'ensure_composer_profile()
-- (20260901160000_ensure_composer_profile_rpc.sql), même patron, ciblant studio_profiles.
-- Construite maintenant même si aucun écran ne l'appelle encore (la bêta reste réservée aux
-- compositeurs, voir bienvenue.html) : coût faible aujourd'hui, réutilisée telle quelle le jour où
-- l'écran de choix à trois options (Compositeur/Studio/Fan) sera construit.
create or replace function public.ensure_studio_profile()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Non autorisé : aucune session active';
  end if;

  select id into v_id from public.studio_profiles where profile_id = v_uid;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.studio_profiles (profile_id) values (v_uid) returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.ensure_studio_profile() to authenticated;
