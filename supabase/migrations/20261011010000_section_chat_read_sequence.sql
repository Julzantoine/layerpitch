-- LayerPitch — Tchat par section : « non lu » fondé sur un ordre monotone, plus sur des horodatages.
-- Avant : message.created_at > follow.last_read_at (deux now()). Quand le suivi et le message tombent dans la même
-- milliseconde (ou la même transaction, où now() est figé), les deux dates sont égales et le message n'était pas compté.
-- Maintenant : chaque message reçoit un numéro croissant (seq) ; le suivi retient le dernier numéro lu (last_read_seq).
-- created_at et last_read_at restent (affichage, pagination) mais ne décident plus du « non lu ».

create sequence if not exists public.project_section_messages_seq;
alter table public.project_section_messages add column if not exists seq bigint;
-- Existant : numéroté dans l'ordre chronologique.
update public.project_section_messages m set seq = o.n
  from (select id, nextval('public.project_section_messages_seq') as n
          from (select id from public.project_section_messages order by created_at, id) x) o
  where m.id = o.id and m.seq is null;
alter table public.project_section_messages alter column seq set default nextval('public.project_section_messages_seq');
alter table public.project_section_messages alter column seq set not null;
alter sequence public.project_section_messages_seq owned by public.project_section_messages.seq;
create unique index if not exists project_section_messages_seq_idx on public.project_section_messages (seq);

alter table public.project_section_follows add column if not exists last_read_seq bigint not null default 0;
-- Existant : lu jusqu'au dernier message déjà antérieur ou égal à last_read_at.
update public.project_section_follows f set last_read_seq = coalesce(
  (select max(m.seq) from public.project_section_messages m where m.section_id = f.section_id and m.created_at <= f.last_read_at), 0);

-- Le dernier numéro d'un canal (0 s'il est vide).
create or replace function public.section_last_seq(p_section_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$ select coalesce(max(seq), 0) from public.project_section_messages where section_id = p_section_id $$;
revoke all on function public.section_last_seq(uuid) from public, anon, authenticated;

-- Suivre : on part de l'état actuel du canal (rien de non lu).
create or replace function public.set_section_follow(p_section_id uuid, p_follow boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id);
begin
  perform public.assert_project_sections_access(r.project_id);
  if p_follow then
    insert into public.project_section_follows (section_id, profile_id, last_read_seq)
      values (p_section_id, auth.uid(), public.section_last_seq(p_section_id)) on conflict do nothing;
  else
    delete from public.project_section_follows where section_id = p_section_id and profile_id = auth.uid();
  end if;
end;
$$;
grant execute on function public.set_section_follow(uuid, boolean) to authenticated;

create or replace function public.mark_section_read(p_section_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id);
begin
  perform public.assert_project_sections_access(r.project_id);
  update public.project_section_follows
     set last_read_at = clock_timestamp(), last_read_seq = public.section_last_seq(p_section_id)
   where section_id = p_section_id and profile_id = auth.uid();
end;
$$;
grant execute on function public.mark_section_read(uuid) to authenticated;

-- Écrire : on suit le canal et il est lu jusqu'à son propre message.
create or replace function public.post_section_message(p_section_id uuid, p_body text, p_attachments jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id); v_id uuid; v_seq bigint; v_body text := btrim(coalesce(p_body, ''));
  e jsonb; f record; v_asset uuid; i int := 0; v_n int := jsonb_array_length(coalesce(p_attachments, '[]'::jsonb));
begin
  perform public.assert_project_sections_access(r.project_id);
  if v_body = '' and v_n = 0 then raise exception 'Message vide'; end if;
  if length(v_body) > 4000 then raise exception 'Message trop long (4000 caractères au plus)'; end if;
  if v_n > 10 then raise exception '10 pièces jointes au plus par message'; end if;
  insert into public.project_section_messages (section_id, author_id, body) values (p_section_id, auth.uid(), v_body) returning id, seq into v_id, v_seq;
  for e in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    select * into f from public.project_files where id = nullif(e->>'fileId', '')::uuid and project_id = r.project_id and status = 'ready';
    if not found then raise exception 'Pièce jointe introuvable dans ce Projet'; end if;
    select id into v_asset from public.project_assets where project_id = r.project_id and file_id = f.id;
    if v_asset is null then
      insert into public.project_assets (project_id, kind, origin, title, file_id, created_by)
      values (r.project_id,
              case when f.mime_type like 'image/%' then 'image' when f.mime_type like 'audio/%' then 'audio' when f.mime_type like 'video/%' then 'video' else 'file' end,
              'own', left(coalesce(nullif(trim(e->>'title'), ''), f.original_name, ''), 300), f.id, auth.uid())
      returning id into v_asset;
    end if;
    insert into public.project_section_message_assets (message_id, asset_id, position) values (v_id, v_asset, i) on conflict do nothing;
    -- rangé automatiquement dans la section du canal (sans le retirer d'ailleurs)
    insert into public.project_section_assets (section_id, asset_id, added_by) values (p_section_id, v_asset, auth.uid()) on conflict do nothing;
    i := i + 1;
  end loop;
  insert into public.project_section_follows (section_id, profile_id, last_read_seq) values (p_section_id, auth.uid(), v_seq)
    on conflict (section_id, profile_id) do update set last_read_at = clock_timestamp(), last_read_seq = greatest(public.project_section_follows.last_read_seq, v_seq);
  return v_id;
end;
$$;
grant execute on function public.post_section_message(uuid, text, jsonb) to authenticated;

create or replace function public.section_chat_state(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_sections_access(p_project_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('sectionId', f.section_id, 'followed', true,
      'unread', (select count(*) from public.project_section_messages m where m.section_id = f.section_id and m.author_id is distinct from auth.uid() and m.seq > f.last_read_seq))), '[]'::jsonb)
    from public.project_section_follows f join public.project_sections s on s.id = f.section_id
    where s.project_id = p_project_id and f.profile_id = auth.uid());
end;
$$;
grant execute on function public.section_chat_state(uuid) to authenticated;

create or replace function public.my_section_updates()
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
    select jsonb_build_object('projectId', p.id, 'title', p.title, 'sectionId', s.id, 'sectionTitle', s.title, 'unread', n.cnt,
      'lastMessage', (select jsonb_build_object('authorEmail', (select email from auth.users where id = m.author_id), 'excerpt', left(m.body, 120), 'createdAt', m.created_at)
                        from public.project_section_messages m where m.section_id = s.id and m.author_id is distinct from v_me and m.seq > f.last_read_seq order by m.seq desc limit 1),
      'latestAt', (select max(m.created_at) from public.project_section_messages m where m.section_id = s.id and m.author_id is distinct from v_me and m.seq > f.last_read_seq)) u
    from public.project_section_follows f
    join public.project_sections s on s.id = f.section_id
    join public.projects p on p.id = s.project_id
    cross join lateral (select count(*) as cnt from public.project_section_messages m where m.section_id = s.id and m.author_id is distinct from v_me and m.seq > f.last_read_seq) n
    where f.profile_id = v_me and n.cnt > 0 and p.archived_at is null
      and public.project_role(p.id, v_me) is not null
      and public.feature_released('projects', v_me) and public.feature_released('project_sections', v_me)
  ) t);
end;
$$;
grant execute on function public.my_section_updates() to authenticated;
