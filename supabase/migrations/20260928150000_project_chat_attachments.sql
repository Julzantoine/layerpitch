-- LayerPitch — espace Projet, étape 3 (cadrage du 28/09 §3) : le tchat.
--
--   * Pièces jointes : un fichier joint à un message (image, audio, vidéo, document) devient un objet de la réserve au
--     moment de l'envoi (origine « ébauche maison », from_message_id = le message), relié au message par
--     project_message_assets. Même chemin que les autres fichiers : réservation, quota du propriétaire, seau privé.
--     Un message peut ne contenir que des pièces jointes (texte vide).
--   * Supprimer un message ne supprime pas ses pièces jointes : ce sont des objets du Projet (retrouvables par
--     « Depuis le Projet… »), seul le lien au message disparaît.
--   * « Ranger dans… » : un lien d'un message est rangé par add_project_asset avec fromMessageId (sur décision d'un
--     membre, jamais automatiquement).

alter table public.project_messages drop constraint project_messages_body_check;
alter table public.project_messages add constraint project_messages_body_check check (length(body) <= 8000);

create table public.project_message_assets (
  message_id uuid not null references public.project_messages(id) on delete cascade,
  asset_id uuid not null references public.project_assets(id) on delete cascade,
  position int not null default 0,
  primary key (message_id, asset_id)
);
alter table public.project_message_assets enable row level security;

-- p_attachments : [{ fileId, title? }] (10 au plus), fichiers déjà envoyés dans ce Projet (reserve + complete).
drop function public.post_project_message(uuid, text);
create or replace function public.post_project_message(p_project_id uuid, p_body text, p_attachments jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; e jsonb; f record; v_asset uuid; i int := 0; v_n int := jsonb_array_length(coalesce(p_attachments, '[]'::jsonb));
begin
  perform public.assert_project_role(p_project_id);
  if coalesce(trim(p_body), '') = '' and v_n = 0 then raise exception 'Message vide'; end if;
  if v_n > 10 then raise exception '10 pièces jointes au plus par message'; end if;
  insert into public.project_messages (project_id, author_id, body) values (p_project_id, auth.uid(), coalesce(trim(p_body), '')) returning id into v_id;
  for e in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    select * into f from public.project_files where id = nullif(e->>'fileId', '')::uuid and project_id = p_project_id and status = 'ready';
    if not found then raise exception 'Pièce jointe introuvable dans ce Projet'; end if;
    select id into v_asset from public.project_assets where project_id = p_project_id and file_id = f.id;
    if v_asset is null then
      insert into public.project_assets (project_id, kind, origin, title, file_id, from_message_id, created_by)
      values (p_project_id,
              case when f.mime_type like 'image/%' then 'image' when f.mime_type like 'audio/%' then 'audio' when f.mime_type like 'video/%' then 'video' else 'file' end,
              'own', left(coalesce(nullif(trim(e->>'title'), ''), f.original_name, ''), 300), f.id, v_id, auth.uid())
      returning id into v_asset;
    end if;
    insert into public.project_message_assets (message_id, asset_id, position) values (v_id, v_asset, i) on conflict do nothing;
    i := i + 1;
  end loop;
  update public.projects set updated_at = now() where id = p_project_id;
  return v_id;
end;
$$;

-- Messages, du plus récent au plus ancien, avec leurs pièces jointes (objets de la réserve).
create or replace function public.list_project_messages(p_project_id uuid, p_before timestamptz default null, p_limit int default 50, p_query text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_role(p_project_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'createdAt', m.created_at, 'editedAt', m.edited_at,
      'authorId', m.author_id, 'authorEmail', (select u.email from auth.users u where u.id = m.author_id), 'mine', m.author_id = auth.uid(),
      'attachments', (select coalesce(jsonb_agg(jsonb_build_object('assetId', x.id, 'kind', x.kind, 'title', x.title, 'fileId', x.file_id,
          'fileName', f.original_name, 'mimeType', f.mime_type) order by ma.position), '[]'::jsonb)
        from public.project_message_assets ma join public.project_assets x on x.id = ma.asset_id
        left join public.project_files f on f.id = x.file_id where ma.message_id = m.id))
      order by m.created_at desc), '[]'::jsonb)
    from (select * from public.project_messages m
          where m.project_id = p_project_id
            and (p_before is null or m.created_at < p_before)
            and (coalesce(trim(p_query), '') = '' or m.search @@ websearch_to_tsquery('simple', p_query))
          order by m.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) m);
end;
$$;

-- add_project_asset : p.fromMessageId (facultatif) = « rangé depuis ce message du tchat ».
create or replace function public.add_project_asset(p_project_id uuid, p jsonb, p_pin boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb; v_id uuid; v_existed boolean := false; v_msg uuid := nullif(p->>'fromMessageId', '')::uuid;
begin
  perform public.assert_project_role(p_project_id);
  v := public.check_project_asset(p_project_id, p);
  if v_msg is not null and not exists (select 1 from public.project_messages where id = v_msg and project_id = p_project_id) then
    raise exception 'Message introuvable dans ce Projet';
  end if;
  select id into v_id from public.project_assets where project_id = p_project_id and (
    (v->>'url' is not null and url = v->>'url') or (v->>'fileId' is not null and file_id = (v->>'fileId')::uuid)
    or (v->>'trackId' is not null and track_id = v->>'trackId') or (v->>'packId' is not null and pack_id = v->>'packId')
    or (v->>'albumId' is not null and album_id = v->>'albumId'));
  if v_id is not null then
    v_existed := true;
  else
    insert into public.project_assets (project_id, kind, origin, title, body, url, file_id, track_id, pack_id, album_id, from_message_id, created_by)
    values (p_project_id, v->>'kind', v->>'origin', left(coalesce(p->>'title', ''), 300), coalesce(p->>'body', ''), v->>'url',
            (v->>'fileId')::uuid, v->>'trackId', v->>'packId', v->>'albumId', v_msg, auth.uid())
    returning id into v_id;
    perform public.log_project_activity(p_project_id, 'asset_added', jsonb_build_object('kind', v->>'kind', 'title', coalesce(p->>'title', '')));
  end if;
  if p_pin then perform public.pin_project_asset(v_id, true); end if;
  update public.projects set updated_at = now() where id = p_project_id;
  return jsonb_build_object('id', v_id, 'existed', v_existed);
end;
$$;

revoke execute on function public.post_project_message(uuid, text, jsonb) from public, anon;
grant execute on function public.post_project_message(uuid, text, jsonb) to authenticated;
