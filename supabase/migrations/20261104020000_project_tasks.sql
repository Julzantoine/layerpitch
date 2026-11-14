-- LayerPitch — Onglet « Tâches » d'un Projet (4 novembre, cadrage layerpitch-docs/2026-11-04-projet-onglet-taches-cadrage.md).
-- Une liste partagée par toute l'équipe : case à cocher, titre, précisions, personne assignée, échéance (date seule), section
-- facultative, et un lien vers UN élément du Projet (objet de la réserve, section, carte de niveau avec éventuellement un de ses
-- points). Tous les membres créent, modifient et cochent ; seuls l'auteur de la tâche et les admins du Projet la suppriment.
-- Assigner quelqu'un d'autre le prévient (cloche, notification 'task_assigned') ; créer / cocher / supprimer laisse une trace
-- dans Activité. Pas de notification d'échéance pour l'instant (il faudrait une fonction planifiée).
-- Tables fermées comme tout le Projet. Réservé à l'admin LayerPitch jusqu'au feu vert 'project_tasks'.
-- La colonne position sert à l'ordre manuel et, plus tard, à la vue en colonnes.

create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  section_id uuid references public.project_sections(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  notes text not null default '' check (length(notes) <= 4000),
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null,
  assignee_id uuid references public.profiles(id) on delete set null,
  due_date date,
  link_type text check (link_type in ('asset', 'section', 'map')),
  link_id uuid,
  link_sub text check (link_sub is null or length(link_sub) <= 80), -- carte : identifiant du point (nœud) visé
  position integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((link_type is null) = (link_id is null))
);
create index project_tasks_project_idx on public.project_tasks (project_id, done, position);
create index project_tasks_assignee_idx on public.project_tasks (assignee_id) where assignee_id is not null;
alter table public.project_tasks enable row level security;
revoke all on public.project_tasks from anon, authenticated;

insert into public.feature_flags (key, description) values
  ('project_tasks', 'Onglet « Tâches » des Projets : liste partagée, assignation, échéance, lien vers un élément (4/11) — list/create/update/delete_project_task, set_project_task_done.');

-- Droit commun : membre du Projet + feu vert (ou admin). Renvoie le rôle.
create or replace function public.assert_project_tasks_access(p_project_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text := public.assert_project_role(p_project_id);
begin
  if not public.feature_released('project_tasks', auth.uid()) then
    raise exception 'Les tâches ne sont pas encore ouvertes' using hint = 'locked';
  end if;
  return v_role;
end;
$$;
revoke execute on function public.assert_project_tasks_access(uuid) from public, anon, authenticated;

create or replace function public.project_task_row(p_task_id uuid)
returns public.project_tasks
language plpgsql
stable
security definer
set search_path = public
as $$
declare r public.project_tasks;
begin
  select * into r from public.project_tasks where id = p_task_id;
  if not found then raise exception 'Tâche introuvable'; end if;
  return r;
end;
$$;
revoke execute on function public.project_task_row(uuid) from public, anon, authenticated;

-- Vérifie les champs d'une tâche (ceux présents dans p) contre le Projet : section, personne assignée, élément lié.
create or replace function public.check_project_task_fields(p_project_id uuid, p jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_type text; v_id uuid; v_ok boolean;
begin
  if p ? 'title' and (length(btrim(coalesce(p->>'title', ''))) = 0 or length(btrim(p->>'title')) > 200) then
    raise exception 'Le titre d''une tâche fait de 1 à 200 caractères';
  end if;
  if p ? 'notes' and length(coalesce(p->>'notes', '')) > 4000 then raise exception 'Précisions : 4000 caractères au plus'; end if;
  if nullif(p->>'sectionId', '') is not null and not exists (select 1 from public.project_sections where id = (p->>'sectionId')::uuid and project_id = p_project_id) then
    raise exception 'Section introuvable';
  end if;
  if nullif(p->>'assigneeId', '') is not null and public.project_role(p_project_id, (p->>'assigneeId')::uuid) is null then
    raise exception 'La personne assignée ne fait pas partie du Projet';
  end if;
  if p ? 'link' and jsonb_typeof(p->'link') = 'object' then
    v_type := p->'link'->>'type'; v_id := nullif(p->'link'->>'id', '')::uuid;
    -- (un CASE dans la condition d'un IF trompe PL/pgSQL, qui s'arrête au premier THEN : on passe par une variable)
    v_ok := case v_type
        when 'asset' then exists (select 1 from public.project_assets where id = v_id and project_id = p_project_id)
        when 'section' then exists (select 1 from public.project_sections where id = v_id and project_id = p_project_id)
        when 'map' then exists (select 1 from public.project_maps where id = v_id and project_id = p_project_id)
        else false end;
    if v_id is null or not coalesce(v_ok, false) then
      raise exception 'Élément lié introuvable dans ce Projet';
    end if;
  end if;
end;
$$;
revoke execute on function public.check_project_task_fields(uuid, jsonb) from public, anon, authenticated;

-- Prévient la personne assignée (sauf si c'est soi-même).
create or replace function public.notify_project_task_assignee(p_task public.project_tasks)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_task.assignee_id is null or p_task.assignee_id = auth.uid() then return; end if;
  insert into public.project_notifications (profile_id, project_id, kind, payload)
  values (p_task.assignee_id, p_task.project_id, 'task_assigned', jsonb_build_object('taskId', p_task.id, 'title', p_task.title,
    'dueDate', p_task.due_date, 'authorEmail', (select email from auth.users where id = auth.uid())));
end;
$$;
revoke execute on function public.notify_project_task_assignee(public.project_tasks) from public, anon, authenticated;

-- [{ id, sectionId, title, notes, done, doneAt, doneByEmail, assigneeId, assigneeEmail, dueDate, link: { type, id, sub } | null,
--    position, authorEmail, mine, canDelete, createdAt, updatedAt }] : à faire d'abord (par position), puis faites (plus récentes d'abord).
create or replace function public.list_project_tasks(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text := public.assert_project_tasks_access(p_project_id);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'sectionId', t.section_id, 'title', t.title, 'notes', t.notes,
      'done', t.done, 'doneAt', t.done_at, 'doneByEmail', (select email from auth.users where id = t.done_by),
      'assigneeId', t.assignee_id, 'assigneeEmail', (select email from auth.users where id = t.assignee_id),
      'dueDate', t.due_date, 'link', case when t.link_type is null then null else jsonb_build_object('type', t.link_type, 'id', t.link_id, 'sub', t.link_sub) end,
      'position', t.position, 'authorEmail', (select email from auth.users where id = t.created_by),
      'mine', t.created_by = auth.uid(), 'canDelete', t.created_by = auth.uid() or v_role = 'admin',
      'createdAt', t.created_at, 'updatedAt', t.updated_at)
      order by t.done, case when t.done then null else t.position end, t.done_at desc nulls last, t.created_at), '[]'::jsonb)
    from public.project_tasks t where t.project_id = p_project_id);
end;
$$;
grant execute on function public.list_project_tasks(uuid) to authenticated;

-- p = { title, notes?, sectionId?, assigneeId?, dueDate? (AAAA-MM-JJ), link?: { type: 'asset'|'section'|'map', id, sub? } }. Rend { id }.
-- Une nouvelle tâche arrive en tête de la liste « à faire ».
create or replace function public.create_project_task(p_project_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_tasks; v_link jsonb := case when jsonb_typeof(p->'link') = 'object' then p->'link' end;
begin
  perform public.assert_project_tasks_access(p_project_id);
  p := coalesce(p, '{}'::jsonb);
  if not p ? 'title' then raise exception 'Le titre d''une tâche fait de 1 à 200 caractères'; end if;
  perform public.check_project_task_fields(p_project_id, p);
  if (select count(*) from public.project_tasks where project_id = p_project_id) >= 2000 then raise exception 'Deux mille tâches au plus par Projet'; end if;
  insert into public.project_tasks (project_id, section_id, title, notes, assignee_id, due_date, link_type, link_id, link_sub, position, created_by)
  values (p_project_id, nullif(p->>'sectionId', '')::uuid, btrim(p->>'title'), coalesce(p->>'notes', ''), nullif(p->>'assigneeId', '')::uuid,
    nullif(p->>'dueDate', '')::date, v_link->>'type', nullif(v_link->>'id', '')::uuid, nullif(left(v_link->>'sub', 80), ''),
    coalesce((select min(position) - 1 from public.project_tasks where project_id = p_project_id and not done), 0), auth.uid())
  returning * into r;
  perform public.notify_project_task_assignee(r);
  perform public.log_project_activity(p_project_id, 'task_created', jsonb_build_object('title', r.title));
  return jsonb_build_object('id', r.id);
end;
$$;
grant execute on function public.create_project_task(uuid, jsonb) to authenticated;

-- Modifie seulement les champs présents dans p (mêmes clés qu'à la création ; une valeur vide ou nulle efface le champ).
-- Changer la personne assignée prévient la nouvelle.
create or replace function public.update_project_task(p_task_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_tasks := public.project_task_row(p_task_id); v_new public.project_tasks; v_link jsonb;
begin
  perform public.assert_project_tasks_access(r.project_id);
  p := coalesce(p, '{}'::jsonb);
  perform public.check_project_task_fields(r.project_id, p);
  v_link := case when jsonb_typeof(p->'link') = 'object' then p->'link' end;
  update public.project_tasks set
    title = case when p ? 'title' then btrim(p->>'title') else title end,
    notes = case when p ? 'notes' then coalesce(p->>'notes', '') else notes end,
    section_id = case when p ? 'sectionId' then nullif(p->>'sectionId', '')::uuid else section_id end,
    assignee_id = case when p ? 'assigneeId' then nullif(p->>'assigneeId', '')::uuid else assignee_id end,
    due_date = case when p ? 'dueDate' then nullif(p->>'dueDate', '')::date else due_date end,
    link_type = case when p ? 'link' then v_link->>'type' else link_type end,
    link_id = case when p ? 'link' then nullif(v_link->>'id', '')::uuid else link_id end,
    link_sub = case when p ? 'link' then nullif(left(v_link->>'sub', 80), '') else link_sub end,
    updated_at = now()
  where id = p_task_id returning * into v_new;
  if v_new.assignee_id is distinct from r.assignee_id then perform public.notify_project_task_assignee(v_new); end if;
end;
$$;
grant execute on function public.update_project_task(uuid, jsonb) to authenticated;

-- Coche / décoche. Une tâche rouverte revient en tête de la liste « à faire ».
create or replace function public.set_project_task_done(p_task_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_tasks := public.project_task_row(p_task_id);
begin
  perform public.assert_project_tasks_access(r.project_id);
  if r.done = coalesce(p_done, false) then return; end if;
  if p_done then
    update public.project_tasks set done = true, done_at = now(), done_by = auth.uid(), updated_at = now() where id = p_task_id;
  else
    update public.project_tasks set done = false, done_at = null, done_by = null, updated_at = now(),
      position = coalesce((select min(position) - 1 from public.project_tasks where project_id = r.project_id and not done), 0)
    where id = p_task_id;
  end if;
  perform public.log_project_activity(r.project_id, case when p_done then 'task_done' else 'task_reopened' end, jsonb_build_object('title', r.title));
end;
$$;
grant execute on function public.set_project_task_done(uuid, boolean) to authenticated;

-- Ordre manuel de la liste « à faire » : p_task_ids dans l'ordre voulu (les tâches absentes gardent leur place relative, après).
create or replace function public.reorder_project_tasks(p_project_id uuid, p_task_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_project_tasks_access(p_project_id);
  update public.project_tasks t set position = o.i - 1
    from unnest(coalesce(p_task_ids, '{}')) with ordinality as o(id, i) where t.id = o.id and t.project_id = p_project_id;
  update public.project_tasks t set position = coalesce(array_length(p_task_ids, 1), 0) + t.position
    where t.project_id = p_project_id and not (t.id = any (coalesce(p_task_ids, '{}')));
end;
$$;
grant execute on function public.reorder_project_tasks(uuid, uuid[]) to authenticated;

-- Supprimer : l'auteur de la tâche ou un admin du Projet.
create or replace function public.delete_project_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_tasks := public.project_task_row(p_task_id); v_role text;
begin
  v_role := public.assert_project_tasks_access(r.project_id);
  if r.created_by is distinct from auth.uid() and v_role <> 'admin' then
    raise exception 'Seuls l''auteur de la tâche et les admins du Projet peuvent la supprimer';
  end if;
  delete from public.project_tasks where id = p_task_id;
  perform public.log_project_activity(r.project_id, 'task_deleted', jsonb_build_object('title', r.title));
end;
$$;
grant execute on function public.delete_project_task(uuid) to authenticated;

revoke execute on function public.list_project_tasks(uuid), public.create_project_task(uuid, jsonb), public.update_project_task(uuid, jsonb),
  public.set_project_task_done(uuid, boolean), public.reorder_project_tasks(uuid, uuid[]), public.delete_project_task(uuid) from public, anon;

-- Cloche : my_project_updates compte aussi les tâches qui te sont assignées et pas encore vues (assignedTasks).
-- Reprise telle quelle de 20260928190000_notification_center.sql, avec ce seul compteur en plus.
create or replace function public.my_project_updates()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(u order by u->>'latestAt' desc), '[]'::jsonb) from (
    select jsonb_build_object('projectId', p.id, 'title', p.title,
      'newMessages', (select count(*) from public.project_messages m where m.project_id = p.id and m.author_id is distinct from v_me and m.created_at > s.since),
      'lastMessage', (select jsonb_build_object('authorEmail', (select email from auth.users where id = m.author_id), 'excerpt', left(m.body, 120), 'createdAt', m.created_at)
                        from public.project_messages m where m.project_id = p.id and m.author_id is distinct from v_me and m.created_at > s.since order by m.created_at desc limit 1),
      'changes', (select count(*) from public.project_activity a where a.project_id = p.id and a.actor_id is distinct from v_me and a.created_at > s.since),
      'lastChanges', (select coalesce(jsonb_agg(x order by x->>'createdAt' desc), '[]'::jsonb) from (
                        select jsonb_build_object('kind', a.kind, 'payload', a.payload, 'createdAt', a.created_at, 'actorEmail', (select email from auth.users where id = a.actor_id)) x
                        from public.project_activity a where a.project_id = p.id and a.actor_id is distinct from v_me and a.created_at > s.since
                        order by a.created_at desc limit 3) c),
      'addressedNotes', (select count(*) from public.project_notifications n where n.profile_id = v_me and n.project_id = p.id and n.read_at is null and n.kind = 'annotation'),
      'assignedTasks', (select count(*) from public.project_notifications n where n.profile_id = v_me and n.project_id = p.id and n.read_at is null and n.kind = 'task_assigned'),
      'latestAt', greatest(
        (select max(created_at) from public.project_messages m where m.project_id = p.id and m.author_id is distinct from v_me and m.created_at > s.since),
        (select max(created_at) from public.project_activity a where a.project_id = p.id and a.actor_id is distinct from v_me and a.created_at > s.since),
        (select max(created_at) from public.project_notifications n where n.profile_id = v_me and n.project_id = p.id and n.read_at is null))
    ) u
    from public.projects p
    cross join lateral (select coalesce((select last_seen_at from public.project_reads r where r.profile_id = v_me and r.project_id = p.id), p.created_at) as since) s
    where p.archived_at is null and public.project_role(p.id, v_me) is not null
  ) t where (u->>'newMessages')::int + (u->>'changes')::int + (u->>'addressedNotes')::int + (u->>'assignedTasks')::int > 0);
end;
$$;
revoke execute on function public.my_project_updates() from public, anon;
grant execute on function public.my_project_updates() to authenticated;
