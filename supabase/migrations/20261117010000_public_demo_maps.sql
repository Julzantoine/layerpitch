-- Démo publique : la carte de niveau du Projet de démonstration est lisible sans compte (17/11).
-- Jusqu'ici get_public_demo() ne rendait pas les cartes : l'onglet « Carte » de la démo essayait de les lister avec un compte
-- (list_project_maps) et affichait « Démonstration en lecture seule ». Même principe que le reste de la démo : une fonction de
-- lecture seule, appelable sans compte, qui ne rend que les cartes du Projet marqué public_demo (rien d'autre, aucune écriture).

create or replace function public.get_public_demo_maps()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when p.id is null then null else
    (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'data', m.data, 'updatedAt', m.updated_at) order by m.created_at), '[]'::jsonb)
     from public.project_maps m where m.project_id = p.id) end
  from (select 1) x left join public.projects p on p.public_demo;
$$;
revoke execute on function public.get_public_demo_maps() from public, anon;
grant execute on function public.get_public_demo_maps() to anon, authenticated;
