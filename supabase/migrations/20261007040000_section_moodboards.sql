-- LayerPitch — Moodboard par section (7 octobre, étape 2). Le Moodboard général reste celui d'aujourd'hui (project_moodboard_pins) ;
-- chaque section a en plus le sien : ses propres épingles (ordre, ★, retrait), sur les mêmes objets de la réserve. Épingler le même objet
-- dans deux Moodboards, c'est deux épingles indépendantes (la retirer d'un Moodboard ne touche pas l'autre) ; l'objet, lui, est partagé.
-- Épingler dans une section range aussi l'objet dans cette section ; le retirer de la section retire son épingle.
-- Même feu vert que les sections ('project_sections'). Tables fermées comme tout le Projet.

create table public.project_section_pins (
  section_id uuid not null references public.project_sections(id) on delete cascade,
  asset_id uuid not null references public.project_assets(id) on delete cascade,
  position integer not null default 0,
  starred boolean not null default false,
  pinned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (section_id, asset_id)
);
create index project_section_pins_asset_idx on public.project_section_pins (asset_id);
alter table public.project_section_pins enable row level security;
revoke all on public.project_section_pins from anon, authenticated;

-- [{ sectionId, assetId, position, starred }] pour tout le Projet.
create or replace function public.list_section_pins(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_sections_access(p_project_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('sectionId', k.section_id, 'assetId', k.asset_id, 'position', k.position, 'starred', k.starred) order by k.section_id, k.position), '[]'::jsonb)
          from public.project_section_pins k join public.project_sections s on s.id = k.section_id where s.project_id = p_project_id);
end;
$$;
grant execute on function public.list_section_pins(uuid) to authenticated;

-- Épingle (ou retire) un objet du Moodboard d'une section. Épingler range aussi l'objet dans la section.
create or replace function public.pin_asset_in_section(p_section_id uuid, p_asset_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id);
begin
  perform public.assert_project_sections_access(r.project_id);
  if not exists (select 1 from public.project_assets where id = p_asset_id and project_id = r.project_id) then raise exception 'Objet introuvable'; end if;
  if p_pinned then
    insert into public.project_section_assets (section_id, asset_id, added_by) values (p_section_id, p_asset_id, auth.uid()) on conflict do nothing;
    insert into public.project_section_pins (section_id, asset_id, position, pinned_by)
      values (p_section_id, p_asset_id, coalesce((select max(position) + 1 from public.project_section_pins where section_id = p_section_id), 0), auth.uid()) on conflict do nothing;
  else
    delete from public.project_section_pins where section_id = p_section_id and asset_id = p_asset_id;
  end if;
end;
$$;
grant execute on function public.pin_asset_in_section(uuid, uuid, boolean) to authenticated;

create or replace function public.star_section_pin(p_section_id uuid, p_asset_id uuid, p_starred boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id);
begin
  perform public.assert_project_sections_access(r.project_id);
  update public.project_section_pins set starred = coalesce(p_starred, false) where section_id = p_section_id and asset_id = p_asset_id;
  if not found then raise exception 'Cet objet n''est pas épinglé dans ce Moodboard'; end if;
end;
$$;
grant execute on function public.star_section_pin(uuid, uuid, boolean) to authenticated;

-- Nouvel ordre du Moodboard d'une section (les épingles citées passent en premier, dans cet ordre ; les autres suivent).
create or replace function public.reorder_section_pins(p_section_id uuid, p_asset_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id); v_ids uuid[];
begin
  perform public.assert_project_sections_access(r.project_id);
  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select id, 0 as o, i from unnest(coalesce(p_asset_ids, '{}')) with ordinality as u(id, i) where exists (select 1 from public.project_section_pins k where k.section_id = p_section_id and k.asset_id = u.id)
    union all
    select k.asset_id, 1, k.position from public.project_section_pins k where k.section_id = p_section_id and k.asset_id <> all (coalesce(p_asset_ids, '{}'))
  ) x(id, o, i) ;
  update public.project_section_pins k set position = o.i - 1 from unnest(v_ids) with ordinality as o(id, i) where k.section_id = p_section_id and k.asset_id = o.id;
end;
$$;
grant execute on function public.reorder_section_pins(uuid, uuid[]) to authenticated;

-- Sortir un objet d'une section retire aussi son épingle dans le Moodboard de cette section (remplace les versions de 20261007030000).
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
  delete from public.project_section_pins where asset_id = p_asset_id and section_id <> all (v_ids);
  delete from public.project_section_assets where asset_id = p_asset_id and section_id <> all (v_ids);
  insert into public.project_section_assets (section_id, asset_id, added_by) select distinct u.id, p_asset_id, auth.uid() from unnest(v_ids) u(id) where true on conflict do nothing;
end;
$$;
grant execute on function public.set_asset_sections(uuid, uuid[]) to authenticated;

create or replace function public.remove_assets_from_section(p_section_id uuid, p_asset_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id);
begin
  perform public.assert_project_sections_access(r.project_id);
  delete from public.project_section_pins where section_id = p_section_id and asset_id = any (coalesce(p_asset_ids, '{}'));
  delete from public.project_section_assets where section_id = p_section_id and asset_id = any (coalesce(p_asset_ids, '{}'));
end;
$$;
grant execute on function public.remove_assets_from_section(uuid, uuid[]) to authenticated;
