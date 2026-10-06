-- LayerPitch — Carte de niveau d'un Projet (6 octobre) : on dessine un niveau (début, lieux, quêtes, boss, PNJ, trésors, parcours),
-- puis on y dépose des sons de la bibliothèque. Une carte = un document JSON (éléments + liens), plusieurs cartes par Projet.
--
--   data = { roomTone: ref|null, roomToneDb, defaults: { transition: { style, sec, sync } },
--            nodes: [{ id, type, label, x, y, note, side, anchor: { kind: 'node'|'edge', id }, sounds: { main: [ref], combat: [ref], room: [ref] }, transition: { style, sec, sync, stinger: ref } | null }],
--            edges: [{ id, from, to, label, enemy, sounds, transition }] }
--   ref  = { kind: 'track'|'sfx'|'asset', id, title }
-- Tables fermées (comme tout le Projet) : lecture et écriture par les fonctions ci-dessous, droits vérifiés à chaque appel.
-- Réservé à l'admin LayerPitch jusqu'au feu vert 'level_map'.

create table public.project_maps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null default '',
  data jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index project_maps_project_idx on public.project_maps (project_id, created_at);
alter table public.project_maps enable row level security;
revoke all on public.project_maps from anon, authenticated;

insert into public.feature_flags (key, description) values
  ('level_map', 'Carte de niveau des Projets : éléments, parcours, sons déposés (6/10) — list/save/delete_project_map.');

-- Droit commun : membre du Projet + feu vert (ou admin). Renvoie le rôle.
create or replace function public.assert_project_map_access(p_project_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text := public.assert_project_role(p_project_id);
begin
  if not public.feature_released('level_map', auth.uid()) then
    raise exception 'La carte de niveau n''est pas encore ouverte' using hint = 'locked';
  end if;
  return v_role;
end;
$$;
revoke execute on function public.assert_project_map_access(uuid) from public, anon, authenticated;

-- Une référence de son : { kind: 'track'|'sfx'|'asset', id, title } ; un son « asset » doit être dans ce Projet.
create or replace function public.validate_map_ref(p_project_id uuid, r jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_asset uuid;
begin
  if jsonb_typeof(r) <> 'object' or coalesce(r->>'kind', '') not in ('track', 'sfx', 'asset') or coalesce(r->>'id', '') = '' or length(r->>'id') > 80 then
    raise exception 'Référence de son invalide';
  end if;
  if r->>'kind' = 'asset' then
    begin v_asset := (r->>'id')::uuid; exception when others then raise exception 'Référence de son invalide'; end;
    if not exists (select 1 from public.project_assets a where a.id = v_asset and a.project_id = p_project_id and a.kind in ('track', 'audio')) then
      raise exception 'Un son déposé n''est pas dans ce Projet';
    end if;
  end if;
end;
$$;
revoke execute on function public.validate_map_ref(uuid, jsonb) from public, anon, authenticated;

-- Réglage de transition : { style?, sec?, sync?, stinger? } (vide ou absent = celui de la carte).
create or replace function public.validate_map_transition(p_project_id uuid, t jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if t is null or t = 'null'::jsonb then return; end if;
  if jsonb_typeof(t) <> 'object' then raise exception 'Transition invalide'; end if;
  if t ? 'style' and coalesce(t->>'style', '') not in ('crossfade', 'cut', 'fadeout') then raise exception 'Style de transition inconnu'; end if;
  if t ? 'sync' and coalesce(t->>'sync', '') not in ('immediate', 'beat', 'bar', 'bars2', 'bars4') then raise exception 'Synchro de transition inconnue'; end if;
  if t ? 'sec' and t->'sec' <> 'null'::jsonb and (jsonb_typeof(t->'sec') <> 'number' or (t->>'sec')::numeric < 0 or (t->>'sec')::numeric > 30) then raise exception 'Durée de transition invalide (0 à 30 secondes)'; end if;
  if t ? 'stinger' and t->'stinger' <> 'null'::jsonb then perform public.validate_map_ref(p_project_id, t->'stinger'); end if;
end;
$$;
revoke execute on function public.validate_map_transition(uuid, jsonb) from public, anon, authenticated;

-- Les sons d'un élément ou d'un parcours : { main: [ref], combat: [ref], room: [ref] } (12 au plus par emplacement, un seul fond propre).
create or replace function public.validate_map_sounds(p_project_id uuid, s jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_slot text; r jsonb; v_max int;
begin
  if s is null or s = 'null'::jsonb then return; end if;
  if jsonb_typeof(s) <> 'object' then raise exception 'Sons invalides'; end if;
  for v_slot in select * from jsonb_object_keys(s) loop
    if v_slot not in ('main', 'combat', 'room') then raise exception 'Emplacement de son inconnu'; end if;
    v_max := case when v_slot = 'room' then 1 else 12 end; -- calculé à part : un CASE ... THEN dans le IF perturbe l'analyse de plpgsql
    if jsonb_typeof(s->v_slot) <> 'array' or jsonb_array_length(s->v_slot) > v_max then raise exception 'Sons invalides'; end if;
    for r in select * from jsonb_array_elements(s->v_slot) loop perform public.validate_map_ref(p_project_id, r); end loop;
  end loop;
end;
$$;
revoke execute on function public.validate_map_sounds(uuid, jsonb) from public, anon, authenticated;

-- Vérifie la forme d'une carte (limites, types, références) -- une carte mal formée est refusée, jamais « réparée ».
create or replace function public.validate_project_map(p_project_id uuid, p_data jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare n jsonb; e jsonb; v_ids text[] := '{}'; v_edge_ids text[] := '{}'; v_starts int := 0;
begin
  if jsonb_typeof(p_data) <> 'object' or jsonb_typeof(p_data->'nodes') <> 'array' or jsonb_typeof(p_data->'edges') <> 'array' then raise exception 'Carte invalide'; end if;
  if pg_column_size(p_data) > 400000 then raise exception 'Carte trop volumineuse'; end if;
  if jsonb_array_length(p_data->'nodes') > 300 or jsonb_array_length(p_data->'edges') > 600 then raise exception 'Carte trop grande (300 éléments et 600 parcours au plus)'; end if;
  -- Réglages de la carte : fond d'ambiance (un son + niveau en dB) et transition par défaut.
  if p_data ? 'roomTone' and p_data->'roomTone' <> 'null'::jsonb then perform public.validate_map_ref(p_project_id, p_data->'roomTone'); end if;
  if p_data ? 'roomToneDb' and p_data->'roomToneDb' <> 'null'::jsonb and (jsonb_typeof(p_data->'roomToneDb') <> 'number' or (p_data->>'roomToneDb')::numeric < -60 or (p_data->>'roomToneDb')::numeric > 0) then
    raise exception 'Niveau du fond d''ambiance invalide (-60 à 0 dB)';
  end if;
  if p_data ? 'defaults' and p_data->'defaults' <> 'null'::jsonb then
    if jsonb_typeof(p_data->'defaults') <> 'object' then raise exception 'Réglages invalides'; end if;
    perform public.validate_map_transition(p_project_id, p_data->'defaults'->'transition');
  end if;
  for n in select * from jsonb_array_elements(p_data->'nodes') loop
    if coalesce(n->>'id', '') !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'Identifiant d''élément invalide'; end if;
    if n->>'id' = any (v_ids) then raise exception 'Identifiant d''élément en double'; end if;
    v_ids := v_ids || (n->>'id');
    if coalesce(n->>'type', '') not in ('start', 'place', 'quest', 'boss', 'npc', 'treasure') then raise exception 'Type d''élément inconnu (%)', n->>'type'; end if;
    if n->>'type' = 'start' then v_starts := v_starts + 1; end if;
    if jsonb_typeof(n->'x') <> 'number' or jsonb_typeof(n->'y') <> 'number' then raise exception 'Position invalide'; end if;
    if length(coalesce(n->>'label', '')) > 120 or length(coalesce(n->>'note', '')) > 2000 then raise exception 'Texte trop long'; end if;
    perform public.validate_map_sounds(p_project_id, n->'sounds');
    perform public.validate_map_transition(p_project_id, n->'transition');
    if n ? 'anchor' and n->'anchor' <> 'null'::jsonb and coalesce(n->'anchor'->>'kind', '') not in ('node', 'edge') then raise exception 'Accroche invalide'; end if;
  end loop;
  if v_starts > 1 then raise exception 'Une carte n''a qu''un seul début de niveau'; end if;
  for e in select * from jsonb_array_elements(p_data->'edges') loop
    if coalesce(e->>'id', '') !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'Identifiant de parcours invalide'; end if;
    if e->>'id' = any (v_edge_ids) then raise exception 'Identifiant de parcours en double'; end if;
    v_edge_ids := v_edge_ids || (e->>'id');
    if not ((e->>'from') = any (v_ids) and (e->>'to') = any (v_ids)) or e->>'from' = e->>'to' then raise exception 'Un parcours relie deux éléments qui n''existent pas'; end if;
    if length(coalesce(e->>'label', '')) > 120 then raise exception 'Texte trop long'; end if;
    perform public.validate_map_sounds(p_project_id, e->'sounds');
    perform public.validate_map_transition(p_project_id, e->'transition');
  end loop;
  -- Une accroche (quête annexe) doit viser un élément ou un parcours de la même carte.
  for n in select * from jsonb_array_elements(p_data->'nodes') loop
    if n ? 'anchor' and n->'anchor' <> 'null'::jsonb then
      if not ((n->'anchor'->>'kind' = 'node' and (n->'anchor'->>'id') = any (v_ids) and (n->'anchor'->>'id') <> n->>'id')
              or (n->'anchor'->>'kind' = 'edge' and (n->'anchor'->>'id') = any (v_edge_ids))) then
        raise exception 'Une quête annexe est accrochée à quelque chose qui n''existe pas';
      end if;
    end if;
  end loop;
end;
$$;
revoke execute on function public.validate_project_map(uuid, jsonb) from public, anon, authenticated;

create or replace function public.list_project_maps(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_map_access(p_project_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'data', m.data, 'updatedAt', m.updated_at) order by m.created_at), '[]'::jsonb)
          from public.project_maps m where m.project_id = p_project_id);
end;
$$;
grant execute on function public.list_project_maps(uuid) to authenticated;

-- p : { id?, title, data }. Tous les membres dessinent. Dernier enregistrement gagnant ; l'activité du Projet garde la trace.
create or replace function public.save_project_map(p_project_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_data jsonb := coalesce(p->'data', '{"nodes":[],"edges":[]}'::jsonb); v_title text := left(coalesce(p->>'title', ''), 120);
begin
  perform public.assert_project_map_access(p_project_id);
  perform public.validate_project_map(p_project_id, v_data);
  if v_id is null then
    if (select count(*) from public.project_maps where project_id = p_project_id) >= 30 then raise exception 'Trente cartes au plus par Projet'; end if;
    insert into public.project_maps (project_id, title, data, created_by) values (p_project_id, v_title, v_data, auth.uid()) returning id into v_id;
    perform public.log_project_activity(p_project_id, 'map_created', jsonb_build_object('title', v_title));
  else
    update public.project_maps set title = v_title, data = v_data, updated_at = now() where id = v_id and project_id = p_project_id;
    if not found then raise exception 'Carte introuvable'; end if;
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;
grant execute on function public.save_project_map(uuid, jsonb) to authenticated;

create or replace function public.delete_project_map(p_map_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select * into r from public.project_maps where id = p_map_id;
  if not found then raise exception 'Carte introuvable'; end if;
  perform public.assert_project_map_access(r.project_id);
  delete from public.project_maps where id = p_map_id;
  perform public.log_project_activity(r.project_id, 'map_deleted', jsonb_build_object('title', r.title));
end;
$$;
grant execute on function public.delete_project_map(uuid) to authenticated;
