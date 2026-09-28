-- LayerPitch — Projets : notes « juste pour moi » (28/09, retour de l'essai réel de Jules-Antoine : à côté de « Pour tout le
-- monde » et d'un membre précis). Une note privée n'est visible que par son auteur : absente des listes, des compteurs
-- (notes d'un objet, « notes à traiter ») et du journal d'activité des autres membres ; elle n'est adressée à personne.

alter table public.project_annotations add column private boolean not null default false;
alter table public.project_annotations add constraint project_annotations_private_no_addressee check (not private or addressee_id is null);

drop function public.add_project_annotation(uuid, text, text, numeric, text, uuid, text);
create or replace function public.add_project_annotation(p_project_id uuid, p_target_type text, p_target_id text, p_at_seconds numeric, p_body text,
  p_addressee uuid default null, p_at_part text default null, p_private boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_ok boolean; v_private boolean := coalesce(p_private, false);
begin
  perform public.assert_project_role(p_project_id);
  if coalesce(trim(p_body), '') = '' then raise exception 'Annotation vide'; end if;
  if v_private and p_addressee is not null then raise exception 'Une note privée n''est adressée à personne'; end if;
  v_ok := case p_target_type
    when 'asset' then exists (select 1 from public.project_assets where id::text = p_target_id and project_id = p_project_id)
    when 'message' then exists (select 1 from public.project_messages where id::text = p_target_id and project_id = p_project_id)
    when 'project' then true
    else false end;
  if not v_ok then raise exception 'Cible introuvable dans ce Projet'; end if;
  if p_addressee is not null and public.project_role(p_project_id, p_addressee) is null then
    raise exception 'Le destinataire ne fait pas partie du Projet';
  end if;
  insert into public.project_annotations (project_id, author_id, addressee_id, target_type, target_id, at_seconds, at_part, body, private)
  values (p_project_id, auth.uid(), p_addressee, p_target_type, nullif(p_target_id, ''), p_at_seconds, nullif(trim(coalesce(p_at_part, '')), ''), trim(p_body), v_private)
  returning id into v_id;
  -- Une note adressée prévient son destinataire (badge dans la page ; l'e-mail part de la page, voir project-notify).
  if p_addressee is not null and p_addressee <> auth.uid() then
    insert into public.project_notifications (profile_id, project_id, kind, payload)
    values (p_addressee, p_project_id, 'annotation', jsonb_build_object('annotationId', v_id, 'targetType', p_target_type, 'targetId', p_target_id,
      'atSeconds', p_at_seconds, 'atPart', p_at_part, 'excerpt', left(trim(p_body), 140), 'authorEmail', (select email from auth.users where id = auth.uid())));
  end if;
  if not v_private then perform public.log_project_activity(p_project_id, 'annotation_added', jsonb_build_object('targetType', p_target_type)); end if;
  return v_id;
end;
$$;
revoke execute on function public.add_project_annotation(uuid, text, text, numeric, text, uuid, text, boolean) from public, anon;
grant execute on function public.add_project_annotation(uuid, text, text, numeric, text, uuid, text, boolean) to authenticated;

create or replace function public.list_project_annotations(p_project_id uuid, p_target_type text default null, p_target_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_role(p_project_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'targetType', a.target_type, 'targetId', a.target_id,
      'atSeconds', a.at_seconds, 'atPart', a.at_part, 'body', a.body, 'resolved', a.resolved_at is not null, 'createdAt', a.created_at,
      'authorEmail', (select u.email from auth.users u where u.id = a.author_id), 'mine', a.author_id = auth.uid(), 'private', a.private,
      'addresseeId', a.addressee_id, 'addresseeEmail', (select u.email from auth.users u where u.id = a.addressee_id))
      order by a.at_seconds nulls last, a.created_at), '[]'::jsonb)
    from public.project_annotations a
    where a.project_id = p_project_id
      and (not a.private or a.author_id = auth.uid())
      and (p_target_type is null or a.target_type = p_target_type)
      and (p_target_id is null or a.target_id = p_target_id));
end;
$$;

-- Résoudre : une note privée seulement par son auteur (les autres ne la voient pas).
create or replace function public.resolve_project_annotation(p_annotation_id uuid, p_resolved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select * into r from public.project_annotations where id = p_annotation_id;
  if not found or (r.private and r.author_id is distinct from auth.uid()) then raise exception 'Annotation introuvable'; end if;
  perform public.assert_project_role(r.project_id);
  update public.project_annotations set resolved_at = case when p_resolved then now() end, resolved_by = case when p_resolved then auth.uid() end
   where id = p_annotation_id;
end;
$$;

create or replace function public.get_project_content(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_role(p_project_id);
  return jsonb_build_object(
    'assets', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'origin', x.origin, 'title', x.title, 'body', x.body,
        'url', x.url, 'fileId', x.file_id, 'fileName', f.original_name, 'mimeType', f.mime_type, 'trackId', x.track_id, 'packId', x.pack_id,
        'albumId', x.album_id, 'trackTitle', t.title, 'packTitle', k.title, 'albumTitle', al.title, 'preview', x.preview,
        'createdAt', x.created_at, 'authorEmail', (select u.email from auth.users u where u.id = x.created_by),
        'pinned', pin.asset_id is not null, 'starred', coalesce(pin.starred, false),
        'notes', (select count(*) from public.project_annotations a where a.target_type = 'asset' and a.target_id = x.id::text
          and (not a.private or a.author_id = auth.uid())))
        order by x.created_at), '[]'::jsonb)
      from public.project_assets x
      left join public.project_files f on f.id = x.file_id left join public.tracks t on t.id = x.track_id
      left join public.packs k on k.id = x.pack_id left join public.albums al on al.id = x.album_id
      left join public.project_moodboard_pins pin on pin.asset_id = x.id and pin.project_id = x.project_id
      where x.project_id = p_project_id),
    'moodboard', (select coalesce(jsonb_agg(p.asset_id order by p.position, p.created_at), '[]'::jsonb)
      from public.project_moodboard_pins p where p.project_id = p_project_id),
    'packs', (select coalesce(jsonb_agg(jsonb_build_object('packId', s.pack_id, 'title', k.title, 'illustration', k.illustration, 'mode', s.mode,
        'priceEurCents', k.price_eur_cents, 'subscriberCredits', k.subscriber_credits, 'mine', s.shared_by = auth.uid(),
        'sharedByEmail', (select u.email from auth.users u where u.id = s.shared_by)) order by s.created_at), '[]'::jsonb)
      from public.project_shared_packs s join public.packs k on k.id = s.pack_id where s.project_id = p_project_id),
    'albums', (select coalesce(jsonb_agg(jsonb_build_object('albumId', a.id, 'title', a.title, 'illustration', a.illustration, 'buyable', a.buyable)), '[]'::jsonb)
      from public.project_albums pa join public.albums a on a.id = pa.album_id where pa.project_id = p_project_id),
    'openAnnotations', (select count(*) from public.project_annotations where project_id = p_project_id and resolved_at is null
      and (not private or author_id = auth.uid())),
    'autoSnapshot', (select auto_snapshot from public.projects where id = p_project_id)
  );
end;
$$;
