-- LayerPitch — Interface simple / avancée du Backstage (14 novembre 2026).
--
-- Cadrage validé par Jules-Antoine le 14/11 : layerpitch-docs/2026-11-14-interface-simple-avancee-cadrage.md
--
-- 1. Feu vert « simple_advanced_ui » : le mode simple (les éléments classés « avancé » sont masqués, avec un repère
--    « N options avancées masquées · Afficher ») et l'interrupteur Interface simple / avancée dans l'Accueil.
--    Admin seulement jusqu'à ouverture :
--      select public.set_feature_released('simple_advanced_ui', true);
-- ATTENTION (14/11) : la migration 20261114010000_section_tours redéfinit aussi set_my_home_prefs (clé section_tours_seen). Les deux versions
--    ont donc les DEUX clés ; celle-ci est datée après, elle s'applique en dernier.
-- 2. Le choix de la personne vit dans ses préférences d'Accueil (profiles.home_prefs, déjà là) sous la clé « ui_advanced »
--    (vrai = interface avancée ; absent ou faux = interface simple, le niveau de départ de tout le monde). Aucune colonne
--    nouvelle : on ajoute seulement cette clé à la liste de celles que set_my_home_prefs accepte.

insert into public.feature_flags (key, description) values
  ('simple_advanced_ui', 'Interface simple / avancée du Backstage (14/11) — masque les éléments avancés avec un repère « N options avancées masquées » et un interrupteur dans l''Accueil ; admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;

comment on column public.profiles.home_prefs is 'Préférences de l''Accueil du Backstage : {tour_done, tour_dismissed, help_off, ui_advanced: booléens ; recent: jusqu''à 3 éléments {kind, id, title, at} ; menu_hidden: liste d''identifiants d''entrées de menu masquées}. Écrite par set_my_home_prefs (fusion).';

create or replace function public.set_my_home_prefs(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean jsonb := '{}'::jsonb;
  k text;
  v jsonb;
  result jsonb;
begin
  if auth.uid() is null then raise exception 'Non autorisé'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Réglages invalides'; end if;
  if length(p::text) > 2000 then raise exception 'Réglages trop longs'; end if;
  for k, v in select * from jsonb_each(p) loop
    if k in ('tour_done', 'tour_dismissed', 'help_off', 'ui_advanced') then
      if jsonb_typeof(v) <> 'boolean' then raise exception '% doit être vrai ou faux', k; end if;
      clean := clean || jsonb_build_object(k, v);
    elsif k = 'menu_hidden' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 30 then raise exception 'menu_hidden : 30 éléments au plus'; end if;
      clean := clean || jsonb_build_object(k, v);
    elsif k = 'section_tours_seen' then
      -- Clé de la migration 20261114010000_section_tours (branche des visites de section) : reprise telle quelle ici, car chaque migration
      -- redéfinit la fonction ENTIÈRE ; la dernière appliquée gagne, et celle-ci est datée après l'autre, donc elle garde les deux clés.
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20 then raise exception 'section_tours_seen : 20 éléments au plus'; end if;
      clean := clean || jsonb_build_object(k, (
        select coalesce(jsonb_agg(distinct e), '[]'::jsonb) from (
          select jsonb_array_elements_text(coalesce((select home_prefs -> 'section_tours_seen' from public.profiles where id = auth.uid()), '[]'::jsonb)) as e
          union
          select jsonb_array_elements_text(v)
        ) u));
    elsif k = 'recent' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 3 then raise exception 'recent : 3 éléments au plus'; end if;
      clean := clean || jsonb_build_object(k, v);
    end if;
    -- toute autre clé est ignorée
  end loop;
  update public.profiles set home_prefs = coalesce(home_prefs, '{}'::jsonb) || clean where id = auth.uid()
    returning home_prefs into result;
  return coalesce(result, '{}'::jsonb);
end;
$$;
revoke execute on function public.set_my_home_prefs(jsonb) from public, anon;
grant execute on function public.set_my_home_prefs(jsonb) to authenticated;
