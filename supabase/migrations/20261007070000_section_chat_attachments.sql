-- LayerPitch — Tchat par section, suite (7 octobre) :
--   1. Pièces jointes dans les canaux de section, comme dans le tchat général : un fichier joint devient un objet de la réserve du Projet
--      (même chemin : réservation + envoi, puis rattaché ici) ET est rangé automatiquement dans la section du canal. Supprimer un
--      message ne supprime pas ses pièces jointes (ce sont des objets du Projet).
--   2. my_section_updates() : alimente la cloche commune du site avec les canaux de section suivis qui ont du neuf (messages des autres
--      depuis ma dernière lecture du canal). Fonction à part : my_project_updates (cloche des Projets) n'est pas touchée.

alter table public.project_section_messages drop constraint project_section_messages_body_check;
alter table public.project_section_messages add constraint project_section_messages_body_check check (length(body) <= 4000);

create table public.project_section_message_assets (
  message_id uuid not null references public.project_section_messages(id) on delete cascade,
  asset_id uuid not null references public.project_assets(id) on delete cascade,
  position int not null default 0,
  primary key (message_id, asset_id)
);
alter table public.project_section_message_assets enable row level security;
revoke all on public.project_section_message_assets from anon, authenticated;

-- p_attachments : [{ fileId, title? }] (10 au plus), fichiers déjà envoyés dans ce Projet (reserve + complete).
drop function public.post_section_message(uuid, text);
create or replace function public.post_section_message(p_section_id uuid, p_body text, p_attachments jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id); v_id uuid; v_body text := btrim(coalesce(p_body, ''));
  e jsonb; f record; v_asset uuid; i int := 0; v_n int := jsonb_array_length(coalesce(p_attachments, '[]'::jsonb));
begin
  perform public.assert_project_sections_access(r.project_id);
  if v_body = '' and v_n = 0 then raise exception 'Message vide'; end if;
  if length(v_body) > 4000 then raise exception 'Message trop long (4000 caractères au plus)'; end if;
  if v_n > 10 then raise exception '10 pièces jointes au plus par message'; end if;
  insert into public.project_section_messages (section_id, author_id, body) values (p_section_id, auth.uid(), v_body) returning id into v_id;
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
  insert into public.project_section_follows (section_id, profile_id) values (p_section_id, auth.uid())
    on conflict (section_id, profile_id) do update set last_read_at = now();
  return v_id;
end;
$$;
grant execute on function public.post_section_message(uuid, text, jsonb) to authenticated;

create or replace function public.list_section_messages(p_section_id uuid, p_before timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id);
begin
  perform public.assert_project_sections_access(r.project_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'createdAt', m.created_at, 'authorId', m.author_id,
      'authorEmail', (select u.email from auth.users u where u.id = m.author_id), 'mine', m.author_id = auth.uid(),
      'attachments', (select coalesce(jsonb_agg(jsonb_build_object('assetId', x.id, 'kind', x.kind, 'title', x.title, 'fileId', x.file_id,
          'fileName', f.original_name, 'mimeType', f.mime_type) order by ma.position), '[]'::jsonb)
        from public.project_section_message_assets ma join public.project_assets x on x.id = ma.asset_id
        left join public.project_files f on f.id = x.file_id where ma.message_id = m.id)) order by m.created_at desc), '[]'::jsonb)
    from (select * from public.project_section_messages where section_id = p_section_id and (p_before is null or created_at < p_before) order by created_at desc limit 50) m);
end;
$$;
grant execute on function public.list_section_messages(uuid, timestamptz) to authenticated;

-- Pour la cloche : un élément par canal suivi qui a du neuf. [{ projectId, title, sectionId, sectionTitle, unread, lastMessage, latestAt }]
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
                        from public.project_section_messages m where m.section_id = s.id and m.author_id is distinct from v_me and m.created_at > f.last_read_at order by m.created_at desc limit 1),
      'latestAt', (select max(m.created_at) from public.project_section_messages m where m.section_id = s.id and m.author_id is distinct from v_me and m.created_at > f.last_read_at)) u
    from public.project_section_follows f
    join public.project_sections s on s.id = f.section_id
    join public.projects p on p.id = s.project_id
    cross join lateral (select count(*) as cnt from public.project_section_messages m where m.section_id = s.id and m.author_id is distinct from v_me and m.created_at > f.last_read_at) n
    where f.profile_id = v_me and n.cnt > 0 and p.archived_at is null
      and public.project_role(p.id, v_me) is not null
      and public.feature_released('projects', v_me) and public.feature_released('project_sections', v_me)
  ) t);
end;
$$;
grant execute on function public.my_section_updates() to authenticated;
