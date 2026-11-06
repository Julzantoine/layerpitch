-- Marqueurs de la frise de l'atelier vidéo (05/11, demande de Jules-Antoine : « mettre des marqueurs sur la frise »).
--
-- Un marqueur = un repère nommé posé sur la frise d'un montage (double-clic sur la règle des temps ou clic droit dans la frise) :
-- { "id", "t" (secondes), "label" }. Pur repère visuel pour le monteur : il ne joue aucun son et n'apparaît pas dans la vidéo exportée,
-- d'où une colonne à part plutôt qu'un « événement » de plus dans events (les événements pilotent le rendu audio et sa durée).
--
-- save_video_capture prend p_markers en DERNIER paramètre (les appels existants, positionnels ou nommés, restent valables) ;
-- p_markers absent (null) = les marqueurs déjà enregistrés sont gardés tels quels.

alter table public.video_captures add column if not exists markers jsonb not null default '[]'::jsonb;

drop function if exists public.save_video_capture(text, text, text, text, jsonb, jsonb, jsonb, boolean);
create or replace function public.save_video_capture(
  p_id text, p_pack_id text, p_title text, p_video_filename text, p_events jsonb,
  p_lane_overrides jsonb default '{}'::jsonb, p_collapsed_groups jsonb default '{}'::jsonb, p_studio boolean default false,
  p_markers jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
  v_row record; v_pack_owner uuid; v_now timestamptz := now(); v_max numeric;
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé : aucun compte compositeur ou studio'; end if;
  if not public.video_can_save(p_studio) then raise exception 'Non autorisé : enregistrer un montage n''est pas inclus dans cette offre'; end if;
  if p_id is null or p_id = '' then raise exception 'id manquant'; end if;
  if p_pack_id is null or p_pack_id = '' then raise exception 'pack_id manquant'; end if;
  if v_c is not null then
    select owner_id into v_pack_owner from public.packs where id = p_pack_id;
    if v_pack_owner is not null and v_pack_owner <> v_c then raise exception 'Non autorisé : ce pack appartient à un autre compositeur'; end if;
  end if;
  select owner_id, owner_studio_id into v_row from public.video_captures where id = p_id;
  if found then
    -- Montage existant : son propriétaire (le compositeur, ou n'importe quel membre de son studio) le retouche.
    if not public.video_owned(v_row.owner_id, v_row.owner_studio_id, v_c, v_s) then raise exception 'Non autorisé : cette prise appartient à un autre compte'; end if;
  elsif v_s is not null then
    -- Nouveau montage d'un studio : sur un pack que l'équipe possède (acheté ou obtenu).
    if not public.team_owns_pack(p_pack_id) then raise exception 'Non autorisé : ce pack n''appartient pas à ton studio'; end if;
    -- Nombre de montages enregistrés d'un studio (saved_montages : 10 en Indie, illimité au-delà).
    select e.amount into v_max from public.entitlement(auth.uid(), 'saved_montages', false) e where e.allowed;
    if v_max is not null and (select count(*) from public.video_captures where owner_studio_id = v_s) >= v_max then
      raise exception 'Nombre maximal de montages enregistrés atteint pour ton studio (%)', v_max::int;
    end if;
  end if;
  insert into public.video_captures (id, owner_id, owner_studio_id, pack_id, title, video_filename, events, lane_overrides, collapsed_groups, markers, updated_at)
  values (p_id, v_c, v_s, p_pack_id, coalesce(p_title, ''), p_video_filename,
    coalesce(p_events, '[]'::jsonb), coalesce(p_lane_overrides, '{}'::jsonb), coalesce(p_collapsed_groups, '{}'::jsonb), coalesce(p_markers, '[]'::jsonb), v_now)
  on conflict (id) do update set
    title = excluded.title, video_filename = excluded.video_filename,
    events = excluded.events, lane_overrides = excluded.lane_overrides, collapsed_groups = excluded.collapsed_groups,
    markers = case when p_markers is null then video_captures.markers else excluded.markers end, updated_at = v_now;
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
    'markers', v_row.markers,
    'createdAt', v_row.created_at, 'updatedAt', v_row.updated_at);
end;
$$;


revoke all on function public.save_video_capture(text, text, text, text, jsonb, jsonb, jsonb, boolean, jsonb), public.get_video_capture(text, boolean) from public, anon;
grant execute on function public.save_video_capture(text, text, text, text, jsonb, jsonb, jsonb, boolean, jsonb), public.get_video_capture(text, boolean) to authenticated;
