-- LayerPitch — Accueil (dashboard) du Backstage (13 novembre 2026).
--
-- Cadrage validé par Jules-Antoine le 13/11 : layerpitch-docs/2026-11-13-accueil-dashboard-cadrage.md
--
-- 1. Feu vert « home_dashboard » : l'onglet Accueil (page d'arrivée du Backstage). Admin seulement jusqu'à ouverture :
--      select public.set_feature_released('home_dashboard', true);
-- 2. Une colonne « préférences d'accueil » sur le compte (profiles.home_prefs, jsonb, vide au départ) :
--      tour_done / tour_dismissed (visite guidée faite, ou rappel effacé par la croix), recent (les 3 derniers éléments
--      touchés, pour la carte « Continuer »), help_off (aide contextuelle coupée), menu_hidden (entrées du menu masquées par
--      la personne, « Personnaliser le menu »).
--    Rien ne change pour les comptes existants : colonne vide = Accueil par défaut.
-- 3. Une fonction pour l'écrire : set_my_home_prefs(p) FUSIONNE les réglages (les autres clés sont gardées), n'accepte que
--    les clés ci-dessus, ne touche que la ligne de la personne connectée.

insert into public.feature_flags (key, description) values
  ('home_dashboard', 'Accueil du Backstage (13/11) — page d''arrivée avec rappels, question du jour, boîte aux lettres et cartes ; admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;

alter table public.profiles add column home_prefs jsonb not null default '{}'::jsonb;
comment on column public.profiles.home_prefs is 'Préférences de l''Accueil du Backstage : {tour_done, tour_dismissed, help_off: booléens ; recent: jusqu''à 3 éléments {kind, id, title, at} ; menu_hidden: liste d''identifiants d''entrées de menu masquées}. Écrite par set_my_home_prefs (fusion).';

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
