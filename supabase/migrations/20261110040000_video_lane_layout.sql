-- LayerPitch — Pistes de la frise propres à chaque version : masquées et ajoutées (10 novembre 2026).
--
-- Demande de Jules-Antoine : « supprimer les pistes qui ne me servent pas dans la frise, et en rajouter d'autres avec d'autres morceaux (du pack d'origine,
-- ou de ma bibliothèque, ou d'autres packs achetés) ». Chaque version alternative a sa propre liste.
-- Une colonne dédiée `lane_layout` (plutôt que des clés réservées dans lane_overrides, qui ne contient que des noms de pistes) :
--   { "hidden": [ "<id de morceau du pack à ne pas afficher>", … ], "extra": [ "<id de morceau ajouté depuis la bibliothèque>", … ] }
-- Aucune donnée existante n'est réécrite : NULL / '{}' = le comportement d'avant (tous les morceaux du pack, aucun ajout).
-- save_* : p_lane_layout null = on garde ce qui est en base.

alter table public.video_captures add column if not exists lane_layout jsonb not null default '{}'::jsonb;
alter table public.video_capture_versions add column if not exists lane_layout jsonb;

alter table public.video_captures drop constraint if exists video_captures_lane_layout_check;
alter table public.video_captures add constraint video_captures_lane_layout_check check (jsonb_typeof(lane_layout) = 'object');
alter table public.video_capture_versions drop constraint if exists video_capture_versions_lane_layout_check;
alter table public.video_capture_versions add constraint video_capture_versions_lane_layout_check check (lane_layout is null or jsonb_typeof(lane_layout) = 'object');

-- Montage : save_video_capture (même corps qu'en 20261105010000, plus p_lane_layout en dernier paramètre) et get_video_capture.
drop function if exists public.save_video_capture(text, text, text, text, jsonb, jsonb, jsonb, boolean, jsonb);
create or replace function public.save_video_capture(
  p_id text, p_pack_id text, p_title text, p_video_filename text, p_events jsonb,
  p_lane_overrides jsonb default '{}'::jsonb, p_collapsed_groups jsonb default '{}'::jsonb, p_studio boolean default false,
  p_markers jsonb default null, p_lane_layout jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
  v_row record; v_pack_owner uuid; v_now timestamptz := now(); v_max numeric;
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé : aucun compte compositeur ou studio'; end if;
  if not public.video_can_save(p_studio) then raise exception 'Non autorisé : enregistrer un montage n''est pas inclus dans cette offre'; end if;
  if p_id is null or p_id = '' then raise exception 'id manquant'; end if;
  if p_pack_id is null or p_pack_id = '' then raise exception 'pack_id manquant'; end if;
  if p_lane_layout is not null and jsonb_typeof(p_lane_layout) <> 'object' then raise exception 'pistes invalides'; end if;
  if v_c is not null then
    select owner_id into v_pack_owner from public.packs where id = p_pack_id;
    if v_pack_owner is not null and v_pack_owner <> v_c then raise exception 'Non autorisé : ce pack appartient à un autre compositeur'; end if;
  end if;
  select owner_id, owner_studio_id into v_row from public.video_captures where id = p_id;
  if found then
    if not public.video_owned(v_row.owner_id, v_row.owner_studio_id, v_c, v_s) then raise exception 'Non autorisé : cette prise appartient à un autre compte'; end if;
  elsif v_s is not null then
    if not public.team_owns_pack(p_pack_id) then raise exception 'Non autorisé : ce pack n''appartient pas à ton studio'; end if;
    select e.amount into v_max from public.entitlement(auth.uid(), 'saved_montages', false) e where e.allowed;
    if v_max is not null and (select count(*) from public.video_captures where owner_studio_id = v_s) >= v_max then
      raise exception 'Nombre maximal de montages enregistrés atteint pour ton studio (%)', v_max::int;
    end if;
  end if;
  insert into public.video_captures (id, owner_id, owner_studio_id, pack_id, title, video_filename, events, lane_overrides, collapsed_groups, markers, lane_layout, updated_at)
  values (p_id, v_c, v_s, p_pack_id, coalesce(p_title, ''), p_video_filename,
    coalesce(p_events, '[]'::jsonb), coalesce(p_lane_overrides, '{}'::jsonb), coalesce(p_collapsed_groups, '{}'::jsonb), coalesce(p_markers, '[]'::jsonb), coalesce(p_lane_layout, '{}'::jsonb), v_now)
  on conflict (id) do update set
    title = excluded.title, video_filename = excluded.video_filename,
    events = excluded.events, lane_overrides = excluded.lane_overrides, collapsed_groups = excluded.collapsed_groups,
    markers = case when p_markers is null then video_captures.markers else excluded.markers end,
    lane_layout = case when p_lane_layout is null then video_captures.lane_layout else excluded.lane_layout end,
    updated_at = v_now;
  return jsonb_build_object('ok', true, 'id', p_id, 'updatedAt', v_now);
end;
$$;

create or replace function public.get_video_capture(p_id text, p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_row public.video_captures;
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé'; end if;
  select * into v_row from public.video_captures where id = p_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
  if v_row.id is null then raise exception 'Prise introuvable'; end if;
  return jsonb_build_object(
    'id', v_row.id, 'packId', v_row.pack_id, 'title', v_row.title, 'videoFilename', v_row.video_filename,
    'events', v_row.events, 'laneOverrides', v_row.lane_overrides, 'collapsedGroups', v_row.collapsed_groups,
    'markers', v_row.markers, 'laneLayout', v_row.lane_layout,
    'createdAt', v_row.created_at, 'updatedAt', v_row.updated_at);
end;
$$;

-- Versions alternatives : save_video_capture_version (même corps qu'en 20261110010000, plus p_lane_layout) et list_video_capture_versions.
drop function if exists public.save_video_capture_version(text, text, text, jsonb, boolean, jsonb, jsonb, jsonb, jsonb);
create or replace function public.save_video_capture_version(
  p_id text, p_capture_id text, p_title text, p_substitutions jsonb, p_studio boolean default false,
  p_events jsonb default null, p_lane_overrides jsonb default null, p_collapsed_groups jsonb default null, p_markers jsonb default null,
  p_lane_layout jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
  v_cap record; v_existing public.video_capture_versions; v_now timestamptz := now();
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then raise exception 'Non autorisé'; end if;
  if p_id is null or p_id = '' then raise exception 'id manquant'; end if;
  if jsonb_typeof(coalesce(p_substitutions, '{}'::jsonb)) <> 'object' then raise exception 'substitutions invalides'; end if;
  if p_events is not null and jsonb_typeof(p_events) <> 'array' then raise exception 'événements invalides'; end if;
  if p_lane_overrides is not null and jsonb_typeof(p_lane_overrides) <> 'object' then raise exception 'noms de pistes invalides'; end if;
  if p_collapsed_groups is not null and jsonb_typeof(p_collapsed_groups) <> 'object' then raise exception 'groupes invalides'; end if;
  if p_markers is not null and jsonb_typeof(p_markers) <> 'array' then raise exception 'marqueurs invalides'; end if;
  if p_lane_layout is not null and jsonb_typeof(p_lane_layout) <> 'object' then raise exception 'pistes invalides'; end if;
  select owner_id, owner_studio_id into v_cap from public.video_captures where id = p_capture_id;
  if not found or not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then raise exception 'Montage introuvable'; end if;
  select * into v_existing from public.video_capture_versions where id = p_id;
  if v_existing.id is not null and (not public.video_owned(v_existing.owner_id, v_existing.owner_studio_id, v_c, v_s) or v_existing.capture_id <> p_capture_id) then
    raise exception 'Non autorisé : cette version appartient à un autre montage';
  end if;
  insert into public.video_capture_versions (id, capture_id, owner_id, owner_studio_id, title, substitutions, events, lane_overrides, collapsed_groups, markers, lane_layout, updated_at)
  values (p_id, p_capture_id, v_c, v_s, coalesce(p_title, ''), coalesce(p_substitutions, '{}'::jsonb), p_events, p_lane_overrides, p_collapsed_groups, p_markers, p_lane_layout, v_now)
  on conflict (id) do update set
    title = excluded.title,
    substitutions = excluded.substitutions,
    events = coalesce(excluded.events, public.video_capture_versions.events),
    lane_overrides = coalesce(excluded.lane_overrides, public.video_capture_versions.lane_overrides),
    collapsed_groups = coalesce(excluded.collapsed_groups, public.video_capture_versions.collapsed_groups),
    markers = coalesce(excluded.markers, public.video_capture_versions.markers),
    lane_layout = coalesce(excluded.lane_layout, public.video_capture_versions.lane_layout),
    updated_at = v_now;
  return jsonb_build_object('ok', true, 'id', p_id, 'updatedAt', v_now);
end;
$$;

create or replace function public.list_video_capture_versions(p_capture_id text, p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_result jsonb;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'captureId', capture_id, 'title', title, 'substitutions', substitutions,
    'lastExportVideoId', last_export_video_id, 'createdAt', created_at, 'updatedAt', updated_at,
    'status', review_status, 'statusAt', review_status_at, 'statusBy', review_status_by,
    'events', events, 'laneOverrides', lane_overrides, 'collapsedGroups', collapsed_groups, 'markers', markers, 'laneLayout', lane_layout
  ) order by created_at), '[]'::jsonb)
  into v_result
  from public.video_capture_versions
  where capture_id = p_capture_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
  return v_result;
end;
$$;

revoke all on function public.save_video_capture(text, text, text, text, jsonb, jsonb, jsonb, boolean, jsonb, jsonb), public.get_video_capture(text, boolean) from public, anon;
grant execute on function public.save_video_capture(text, text, text, text, jsonb, jsonb, jsonb, boolean, jsonb, jsonb), public.get_video_capture(text, boolean) to authenticated;
revoke all on function public.save_video_capture_version(text, text, text, jsonb, boolean, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_video_capture_version(text, text, text, jsonb, boolean, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
