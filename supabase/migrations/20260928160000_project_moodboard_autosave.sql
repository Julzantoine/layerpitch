-- LayerPitch — espace Projet, étape 4 (cadrage du 28/09 §2, retour 5) : sauvegarde automatique du Moodboard.
--
--   * projects.auto_snapshot : Jamais / Chaque jour / Chaque semaine (weekly par défaut), réglé par un administrateur du
--     Projet. Une tâche quotidienne (pg_cron, 4 h 15) fige le Moodboard de chaque Projet dont c'est le tour, SEULEMENT s'il
--     a changé depuis la dernière version (manuelle ou auto), puis ne garde que les 10 dernières versions auto. Les
--     versions manuelles ne sont jamais supprimées.
--   * get_project_content renvoie aussi autoSnapshot.
-- Les notes « partie + instant » sur les morceaux et l'audio utilisent at_part / at_seconds (colonnes de l'étape 1).

alter table public.projects add column auto_snapshot text not null default 'weekly' check (auto_snapshot in ('off', 'daily', 'weekly'));

create or replace function public.set_project_auto_snapshot(p_project_id uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_project_role(p_project_id, true);
  if p_mode not in ('off', 'daily', 'weekly') then raise exception 'Réglage attendu : off, daily ou weekly'; end if;
  update public.projects set auto_snapshot = p_mode where id = p_project_id;
  perform public.log_project_activity(p_project_id, 'autosave_set', jsonb_build_object('mode', p_mode));
end;
$$;

-- Épingles actuelles, au même format que project_snapshots.data.
create or replace function public.project_moodboard_state(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('assetId', asset_id, 'starred', starred) order by position, created_at), '[]'::jsonb)
  from public.project_moodboard_pins where project_id = p_project_id;
$$;

-- Tâche quotidienne. Renvoie le nombre de versions auto créées.
create or replace function public.run_project_auto_snapshots()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare p record; v_state jsonb; v_last jsonb; v_last_auto timestamptz; v_count int := 0;
begin
  for p in select id, auto_snapshot from public.projects where archived_at is null and auto_snapshot <> 'off' loop
    select max(created_at) into v_last_auto from public.project_snapshots where project_id = p.id and kind = 'auto';
    -- Marge de 4 h : la tâche passe chaque jour à la même heure, à quelques minutes près.
    if v_last_auto is not null and v_last_auto > now() - (case p.auto_snapshot when 'daily' then interval '20 hours' else interval '6 days 20 hours' end) then
      continue;
    end if;
    v_state := public.project_moodboard_state(p.id);
    select data into v_last from public.project_snapshots where project_id = p.id order by created_at desc limit 1;
    if v_state = '[]'::jsonb or v_state = coalesce(v_last, '[]'::jsonb) then continue; end if; -- rien de neuf à figer
    insert into public.project_snapshots (project_id, label, kind, data)
    values (p.id, 'Sauvegarde auto du ' || to_char(now(), 'DD/MM/YYYY'), 'auto', v_state);
    delete from public.project_snapshots where id in (
      select id from public.project_snapshots where project_id = p.id and kind = 'auto' order by created_at desc offset 10);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.run_project_auto_snapshots() from public, anon, authenticated;
grant execute on function public.run_project_auto_snapshots() to service_role;
revoke execute on function public.project_moodboard_state(uuid) from public, anon, authenticated;
revoke execute on function public.set_project_auto_snapshot(uuid, text) from public, anon;
grant execute on function public.set_project_auto_snapshot(uuid, text) to authenticated;
select cron.schedule('project-moodboard-autosave', '15 4 * * *', 'select public.run_project_auto_snapshots()');

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
        'notes', (select count(*) from public.project_annotations a where a.target_type = 'asset' and a.target_id = x.id::text))
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
    'openAnnotations', (select count(*) from public.project_annotations where project_id = p_project_id and resolved_at is null),
    'autoSnapshot', (select auto_snapshot from public.projects where id = p_project_id)
  );
end;
$$;
