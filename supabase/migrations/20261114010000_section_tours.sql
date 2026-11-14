-- LayerPitch — visites de section du Backstage (14/11).
--
-- 1) Feu vert « section_tours » : à la première arrivée dans une section du Backstage, une bulle propose une mini-visite.
--    Admin seulement jusqu'au feu vert :
--      select public.set_feature_released('section_tours', true);
-- 2) home_prefs accepte une clé de plus, section_tours_seen : liste des sections déjà proposées (identifiants d'onglet, 20 au plus), FUSIONNÉE avec l'existante.
insert into public.feature_flags (key, description) values
  ('section_tours', 'Visites de section du Backstage (14/11) — bulle proposée à la première arrivée dans Contenu, Apparence, Bibliothèque, Sfx, Packs, Analytics, admin seulement jusqu''au feu vert.')
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
    if k in ('tour_done', 'tour_dismissed', 'help_off') then
      if jsonb_typeof(v) <> 'boolean' then raise exception '% doit être vrai ou faux', k; end if;
      clean := clean || jsonb_build_object(k, v);
    elsif k = 'menu_hidden' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 30 then raise exception 'menu_hidden : 30 éléments au plus'; end if;
      clean := clean || jsonb_build_object(k, v);
    elsif k = 'section_tours_seen' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20 then raise exception 'section_tours_seen : 20 éléments au plus'; end if;
      -- Fusion (jamais de remplacement) : le Backstage et la page Projets écrivent chacun de leur côté, aucune ne doit effacer l'autre.
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
