-- LayerPitch — Sections d'un Projet (7 octobre, étape 1) : organiser un gros Projet. Des sections libres (arbre sans limite de
-- profondeur), un objet de la réserve peut être dans plusieurs sections (ce sont des liens, rien n'est copié), un objet dans aucune
-- section est « non classé ». Tous les membres organisent. Supprimer une section ne supprime aucun objet : ses sous-sections
-- remontent d'un cran et ses objets restent dans la réserve. get_project_content n'est pas touchée : le navigateur lit les sections
-- à part (list_project_sections). Tables fermées comme tout le Projet. Réservé à l'admin LayerPitch jusqu'au feu vert 'project_sections'.

create table public.project_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.project_sections(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 120),
  position integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index project_sections_project_idx on public.project_sections (project_id, parent_id, position);
alter table public.project_sections enable row level security;
revoke all on public.project_sections from anon, authenticated;

create table public.project_section_assets (
  section_id uuid not null references public.project_sections(id) on delete cascade,
  asset_id uuid not null references public.project_assets(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (section_id, asset_id)
);
create index project_section_assets_asset_idx on public.project_section_assets (asset_id);
alter table public.project_section_assets enable row level security;
revoke all on public.project_section_assets from anon, authenticated;

insert into public.feature_flags (key, description) values
  ('project_sections', 'Sections des Projets : arbre libre, objets dans plusieurs sections, « non classé » (7/10) — list/create/rename/move/delete_project_section, set_asset_sections, add/remove_assets_*.');

-- Droit commun : membre du Projet + feu vert (ou admin). Renvoie le rôle.
create or replace function public.assert_project_sections_access(p_project_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text := public.assert_project_role(p_project_id);
begin
  if not public.feature_released('project_sections', auth.uid()) then
    raise exception 'Les sections ne sont pas encore ouvertes' using hint = 'locked';
  end if;
  return v_role;
end;
$$;
revoke execute on function public.assert_project_sections_access(uuid) from public, anon, authenticated;

-- Une section du Projet : la rend (ou « Section introuvable »).
create or replace function public.project_section_row(p_section_id uuid)
returns public.project_sections
language plpgsql
stable
security definer
set search_path = public
as $$
declare r public.project_sections;
begin
  select * into r from public.project_sections where id = p_section_id;
  if not found then raise exception 'Section introuvable'; end if;
  return r;
end;
$$;
revoke execute on function public.project_section_row(uuid) from public, anon, authenticated;

-- { sections: [{ id, parentId, title, position }], links: [{ sectionId, assetId }] }
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
    'sections', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'parentId', s.parent_id, 'title', s.title, 'position', s.position) order by s.position, s.created_at), '[]'::jsonb)
                 from public.project_sections s where s.project_id = p_project_id),
    'links', (select coalesce(jsonb_agg(jsonb_build_object('sectionId', l.section_id, 'assetId', l.asset_id)), '[]'::jsonb)
              from public.project_section_assets l join public.project_sections s on s.id = l.section_id where s.project_id = p_project_id));
end;
$$;
grant execute on function public.list_project_sections(uuid) to authenticated;

-- Crée une section (à la racine si p_parent_id est nul), à la fin de sa fratrie. Rend { id }.
create or replace function public.create_project_section(p_project_id uuid, p_title text, p_parent_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_title text := btrim(coalesce(p_title, '')); v_pos integer;
begin
  perform public.assert_project_sections_access(p_project_id);
  if length(v_title) = 0 or length(v_title) > 120 then raise exception 'Le nom d''une section fait de 1 à 120 caractères'; end if;
  if (select count(*) from public.project_sections where project_id = p_project_id) >= 300 then raise exception 'Trois cents sections au plus par Projet'; end if;
  if p_parent_id is not null and not exists (select 1 from public.project_sections where id = p_parent_id and project_id = p_project_id) then raise exception 'Section parente introuvable'; end if;
  select coalesce(max(position) + 1, 0) into v_pos from public.project_sections where project_id = p_project_id and parent_id is not distinct from p_parent_id;
  insert into public.project_sections (project_id, parent_id, title, position, created_by) values (p_project_id, p_parent_id, v_title, v_pos, auth.uid()) returning id into v_id;
  perform public.log_project_activity(p_project_id, 'section_created', jsonb_build_object('title', v_title));
  return jsonb_build_object('id', v_id);
end;
$$;
grant execute on function public.create_project_section(uuid, text, uuid) to authenticated;

create or replace function public.rename_project_section(p_section_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id); v_title text := btrim(coalesce(p_title, ''));
begin
  perform public.assert_project_sections_access(r.project_id);
  if length(v_title) = 0 or length(v_title) > 120 then raise exception 'Le nom d''une section fait de 1 à 120 caractères'; end if;
  update public.project_sections set title = v_title where id = p_section_id;
end;
$$;
grant execute on function public.rename_project_section(uuid, text) to authenticated;

-- Déplace une section sous un autre parent (nul = à la racine) et/ou à une place donnée parmi ses sœurs (0 = en premier).
-- Refuse de la mettre sous elle-même ou sous une de ses descendantes.
create or replace function public.move_project_section(p_section_id uuid, p_parent_id uuid default null, p_position integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id); v_ids uuid[]; v_cur uuid;
begin
  perform public.assert_project_sections_access(r.project_id);
  if p_parent_id is not null then
    if not exists (select 1 from public.project_sections where id = p_parent_id and project_id = r.project_id) then raise exception 'Section parente introuvable'; end if;
    -- anti-cycle : on remonte depuis le futur parent ; si on croise la section déplacée, c'est un cycle
    v_cur := p_parent_id;
    while v_cur is not null loop
      if v_cur = p_section_id then raise exception 'Une section ne peut pas entrer dans elle-même ni dans une de ses sous-sections'; end if;
      select parent_id into v_cur from public.project_sections where id = v_cur;
    end loop;
  end if;
  -- les sœurs de la destination, sans la section déplacée, dans l'ordre ; on y insère la section à la place voulue
  select coalesce(array_agg(id order by position, created_at), '{}') into v_ids
    from public.project_sections where project_id = r.project_id and parent_id is not distinct from p_parent_id and id <> p_section_id;
  v_ids := v_ids[1:least(greatest(coalesce(p_position, coalesce(array_length(v_ids, 1), 0)), 0), coalesce(array_length(v_ids, 1), 0))]
           || p_section_id
           || v_ids[least(greatest(coalesce(p_position, coalesce(array_length(v_ids, 1), 0)), 0), coalesce(array_length(v_ids, 1), 0)) + 1:coalesce(array_length(v_ids, 1), 0)];
  update public.project_sections set parent_id = p_parent_id where id = p_section_id;
  update public.project_sections s set position = o.i - 1 from unnest(v_ids) with ordinality as o(id, i) where s.id = o.id;
end;
$$;
grant execute on function public.move_project_section(uuid, uuid, integer) to authenticated;

-- Supprime la section : ses sous-sections remontent chez son parent, ses objets restent dans la réserve (liens retirés seulement).
create or replace function public.delete_project_section(p_section_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id);
begin
  perform public.assert_project_sections_access(r.project_id);
  update public.project_sections set parent_id = r.parent_id where parent_id = p_section_id;
  delete from public.project_sections where id = p_section_id;
  perform public.log_project_activity(r.project_id, 'section_deleted', jsonb_build_object('title', r.title));
end;
$$;
grant execute on function public.delete_project_section(uuid) to authenticated;

-- Fixe les sections d'un objet (remplace la liste : un objet sans section = non classé). Les sections doivent être du même Projet.
create or replace function public.set_asset_sections(p_asset_id uuid, p_section_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_project uuid; v_ids uuid[] := coalesce(p_section_ids, '{}');
begin
  select project_id into v_project from public.project_assets where id = p_asset_id;
  if v_project is null then raise exception 'Objet introuvable'; end if;
  perform public.assert_project_sections_access(v_project);
  if exists (select 1 from unnest(v_ids) u(id) where not exists (select 1 from public.project_sections s where s.id = u.id and s.project_id = v_project)) then raise exception 'Section introuvable'; end if;
  delete from public.project_section_assets where asset_id = p_asset_id and section_id <> all (v_ids);
  insert into public.project_section_assets (section_id, asset_id, added_by) select distinct u.id, p_asset_id, auth.uid() from unnest(v_ids) u(id) where true on conflict do nothing;
end;
$$;
grant execute on function public.set_asset_sections(uuid, uuid[]) to authenticated;

-- Ajoute des objets à une section (sans retirer leurs autres sections). Les objets doivent être du même Projet.
create or replace function public.add_assets_to_section(p_section_id uuid, p_asset_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id); v_ids uuid[] := coalesce(p_asset_ids, '{}');
begin
  perform public.assert_project_sections_access(r.project_id);
  if exists (select 1 from unnest(v_ids) u(id) where not exists (select 1 from public.project_assets a where a.id = u.id and a.project_id = r.project_id)) then raise exception 'Objet introuvable'; end if;
  insert into public.project_section_assets (section_id, asset_id, added_by) select p_section_id, u.id, auth.uid() from (select distinct id from unnest(v_ids) x(id)) u where true on conflict do nothing;
end;
$$;
grant execute on function public.add_assets_to_section(uuid, uuid[]) to authenticated;

-- Retire des objets d'une section (ils restent dans la réserve ; sans autre section ils redeviennent « non classés »).
create or replace function public.remove_assets_from_section(p_section_id uuid, p_asset_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id);
begin
  perform public.assert_project_sections_access(r.project_id);
  delete from public.project_section_assets where section_id = p_section_id and asset_id = any (coalesce(p_asset_ids, '{}'));
end;
$$;
grant execute on function public.remove_assets_from_section(uuid, uuid[]) to authenticated;
