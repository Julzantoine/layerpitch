-- LayerPitch — Lien d'une section vers une carte de niveau (7 octobre, étape 4). Un simple lien : la section affiche « Carte : … »
-- avec un bouton qui ouvre cette carte ; rien d'autre ne change (pas de reprise des sons). Supprimer la carte retire le lien.
-- list_project_sections (20261007030000) rend en plus mapId. Même feu vert que les sections.

alter table public.project_sections add column map_id uuid references public.project_maps(id) on delete set null;

create or replace function public.list_project_sections(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_sections_access(p_project_id);
  return jsonb_build_object(
    'sections', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'parentId', s.parent_id, 'title', s.title, 'position', s.position, 'mapId', s.map_id) order by s.position, s.created_at), '[]'::jsonb)
                 from public.project_sections s where s.project_id = p_project_id),
    'links', (select coalesce(jsonb_agg(jsonb_build_object('sectionId', l.section_id, 'assetId', l.asset_id)), '[]'::jsonb)
              from public.project_section_assets l join public.project_sections s on s.id = l.section_id where s.project_id = p_project_id));
end;
$$;
grant execute on function public.list_project_sections(uuid) to authenticated;

-- Relie la section à une carte du même Projet (p_map_id nul = retire le lien).
create or replace function public.set_section_map(p_section_id uuid, p_map_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id);
begin
  perform public.assert_project_sections_access(r.project_id);
  if p_map_id is not null and not exists (select 1 from public.project_maps where id = p_map_id and project_id = r.project_id) then raise exception 'Carte introuvable'; end if;
  update public.project_sections set map_id = p_map_id where id = p_section_id;
end;
$$;
grant execute on function public.set_section_map(uuid, uuid) to authenticated;
