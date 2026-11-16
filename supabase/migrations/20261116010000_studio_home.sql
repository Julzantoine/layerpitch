-- LayerPitch — Accueil de l'espace studio (16 novembre 2026).
--
-- Cadrage validé par Jules-Antoine : layerpitch-docs/2026-11-16-accueil-studio-cadrage.md
--
-- 1. Feu vert « studio_home » : l'onglet Accueil de l'espace studio (studio.html). Admin seulement jusqu'à ouverture :
--      select public.set_feature_released('studio_home', true);
-- 2. set_my_home_prefs accepte une clé de plus : studio_tour_dismissed (le rappel du tutoriel Projet effacé par la croix).
--    Reprend la fonction ENTIÈRE de la migration 20261114050000 (clés ui_advanced et section_tours_seen comprises : la dernière
--    migration appliquée gagne, donc celle-ci ne doit rien retirer).
--    et deux clés pour « Personnaliser la page d'accueil » : home_cards_hidden (Backstage) et studio_cards_hidden (espace studio).
-- 3. my_projects_latest_messages() : mes projets (même droits que list_my_projects) avec leur DERNIER message, du plus
--    récemment discuté au moins récemment. Sert à la fenêtre de tchat de l'Accueil (projet au dernier message en date)
--    et à la carte « Continuer ». Lecture seule, rien n'est exposé que le membre ne voie déjà dans le tchat du Projet.

insert into public.feature_flags (key, description) values
  ('studio_home', 'Accueil de l''espace studio (16/11) — page d''arrivée du studio : choix du mode Projet, fenêtre de tchat, cartes ; admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;

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
    if k in ('tour_done', 'tour_dismissed', 'help_off', 'ui_advanced', 'studio_tour_dismissed') then
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
    elsif k in ('home_cards_hidden', 'studio_cards_hidden') then
      -- « Personnaliser la page d'accueil » (16/11) : identifiants des cartes que la personne masque.
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20 then raise exception '% : 20 éléments au plus', k; end if;
      clean := clean || jsonb_build_object(k, v);
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

create or replace function public.my_projects_latest_messages()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by (x->>'lastAt') desc nulls last, (x->>'updatedAt') desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', p.id, 'title', p.title, 'role', public.project_role(p.id, auth.uid()), 'updatedAt', p.updated_at,
      'unread', (select count(*) from public.project_notifications n where n.project_id = p.id and n.profile_id = auth.uid() and n.read_at is null),
      'lastAt', m.created_at, 'lastBody', left(m.body, 200),
      'lastAuthor', (select u.email from auth.users u where u.id = m.author_id)
    ) x
    from public.projects p
    left join lateral (
      select pm.created_at, pm.body, pm.author_id from public.project_messages pm
      where pm.project_id = p.id order by pm.created_at desc limit 1
    ) m on true
    where auth.uid() is not null and p.archived_at is null
      and public.feature_released('projects', auth.uid()) and public.project_role(p.id, auth.uid()) is not null
  ) s;
$$;
revoke execute on function public.my_projects_latest_messages() from public, anon;
grant execute on function public.my_projects_latest_messages() to authenticated;
