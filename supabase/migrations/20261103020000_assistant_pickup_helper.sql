-- Import par assistant — aide à la fonction serveur « pending-import-files » (ramassage dans le Backstage, 3/11).
-- Compositeur d'un compte connecté, seulement si le feu vert 'assistant_import' est ouvert pour lui ; réservé à service_role.
create or replace function public.assistant_composer_for_profile(p_profile uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cp.id from public.composer_profiles cp
   where cp.profile_id = p_profile and public.feature_released('assistant_import', p_profile);
$$;
revoke all on function public.assistant_composer_for_profile(uuid) from public, anon, authenticated;
grant execute on function public.assistant_composer_for_profile(uuid) to service_role;
