-- LayerPitch — RPC ensure_composer_profile (préparation auth testeurs, docs/infrastructure.md)
--
-- Aucune politique RLS INSERT n'existe sur composer_profiles (seulement "own composer profile" en
-- lecture) — un compositeur ne peut donc pas créer sa propre ligne directement depuis le client.
-- Pour ce début de bêta (100% compositeurs, pas encore de profils multiples/Fan/Game dev),
-- création automatique à la première connexion plutôt qu'une étape d'activation manuelle séparée —
-- à revisiter une fois le modèle de profils multiples (extensions-roadmap.md 5.4) réellement
-- construit pour le grand public.

create or replace function public.ensure_composer_profile()
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

  select id into v_id from public.composer_profiles where profile_id = v_uid;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.composer_profiles (profile_id) values (v_uid) returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.ensure_composer_profile() to authenticated;
