-- LayerPitch — centre de notifications commun (28/09, demande de Jules-Antoine : « dispo partout, une notif quand il y a
-- des modifs quelque part »). La même cloche sur toutes les pages (barre commune layerpitch-shell.js) et dans le Backstage.
--
--   * project_reads : date de ta dernière visite de chaque Projet (en base, pour que ça suive d'un appareil à l'autre),
--     posée par mark_project_seen à l'ouverture du Projet. Membres actuels : posée à maintenant (pas de fausse alerte
--     sur tout l'historique au premier affichage).
--   * my_project_updates() : pour chaque Projet dont tu es membre (non archivé), depuis ta dernière visite : nouveaux
--     messages des autres (+ le dernier), modifications des autres (journal d'activité, les 3 dernières), notes qui te
--     sont adressées et pas encore lues. Seulement les Projets où il y a du neuf.

create table public.project_reads (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (profile_id, project_id)
);
alter table public.project_reads enable row level security;

insert into public.project_reads (profile_id, project_id)
select distinct m.profile_id, m.project_id from (
  select p.created_by as profile_id, p.id as project_id from public.projects p
  union select pm.profile_id, pm.project_id from public.project_members pm where pm.status = 'active' and pm.profile_id is not null
) m on conflict do nothing;

create or replace function public.mark_project_seen(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_project_role(p_project_id);
  insert into public.project_reads (profile_id, project_id, last_seen_at) values (auth.uid(), p_project_id, now())
  on conflict (profile_id, project_id) do update set last_seen_at = now();
end;
$$;

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
      'latestAt', greatest(
        (select max(created_at) from public.project_messages m where m.project_id = p.id and m.author_id is distinct from v_me and m.created_at > s.since),
        (select max(created_at) from public.project_activity a where a.project_id = p.id and a.actor_id is distinct from v_me and a.created_at > s.since),
        (select max(created_at) from public.project_notifications n where n.profile_id = v_me and n.project_id = p.id and n.read_at is null))
    ) u
    from public.projects p
    cross join lateral (select coalesce((select last_seen_at from public.project_reads r where r.profile_id = v_me and r.project_id = p.id), p.created_at) as since) s
    where p.archived_at is null and public.project_role(p.id, v_me) is not null
  ) t where (u->>'newMessages')::int + (u->>'changes')::int + (u->>'addressedNotes')::int > 0);
end;
$$;

revoke execute on function public.mark_project_seen(uuid), public.my_project_updates() from public, anon;
grant execute on function public.mark_project_seen(uuid), public.my_project_updates() to authenticated;
