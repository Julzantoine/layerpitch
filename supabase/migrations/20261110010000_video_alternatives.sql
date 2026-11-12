-- LayerPitch — Versions alternatives d'un montage vidéo : chaque alternative a sa propre frise (10 novembre 2026).
--
-- Décisions de Jules-Antoine (10/11) :
--   - Une « version alternative » est une copie COMPLÈTE du montage (événements, noms de pistes, groupes repliés, marqueurs), ensuite libre :
--     on peut y déplacer, enlever, ajouter des pistes et des marqueurs sans toucher aux autres alternatives.
--   - L'alternative n° 1 est le montage lui-même (video_captures) ; les alternatives suivantes sont les lignes de video_capture_versions.
--   - Les versions existantes ne sont PAS modifiées par cette migration : tant que `events` est NULL, une version reste ce qu'elle était
--     (le montage + des remplacements de morceaux, `substitutions`). Elle reçoit sa propre frise à sa première retouche (conversion côté atelier,
--     là où la logique de remplacement existe déjà : capture-retarget.js).
--   - Les marqueurs portent déjà un identifiant ({ id, t, label }) : la copie le garde, ce qui permettra « bouger aussi les marqueurs des autres
--     alternatives » sans rien ajouter.
--   - Les révisions (#1.1, #1.2 : un instantané figé à chaque envoi au client) viendront avec la relecture client (étape suivante).
--
-- Sécurité : inchangée (RLS sans policy, accès par ces fonctions ; mêmes barrières video_can_version / video_owned qu'avant).
-- Cette migration ne fait qu'AJOUTER des colonnes NULL et élargir deux fonctions (paramètres facultatifs) : rien n'est réécrit.

alter table public.video_capture_versions
  add column if not exists events jsonb,
  add column if not exists lane_overrides jsonb,
  add column if not exists collapsed_groups jsonb,
  add column if not exists markers jsonb;

-- Un montage ne doit pas dépasser une taille raisonnable (même ordre de grandeur que video_captures).
alter table public.video_capture_versions drop constraint if exists video_capture_versions_events_check;
alter table public.video_capture_versions add constraint video_capture_versions_events_check check (
  (events is null or jsonb_typeof(events) = 'array')
  and (lane_overrides is null or jsonb_typeof(lane_overrides) = 'object')
  and (collapsed_groups is null or jsonb_typeof(collapsed_groups) = 'object')
  and (markers is null or jsonb_typeof(markers) = 'array')
);

-- Créer ou mettre à jour une version (alternative). Les quatre paramètres de frise sont facultatifs : NULL = on garde ce qui est en base
-- (une version « à l'ancienne » reste telle quelle tant qu'on ne les envoie pas).
drop function if exists public.save_video_capture_version(text, text, text, jsonb, boolean);
create or replace function public.save_video_capture_version(
  p_id text, p_capture_id text, p_title text, p_substitutions jsonb, p_studio boolean default false,
  p_events jsonb default null, p_lane_overrides jsonb default null, p_collapsed_groups jsonb default null, p_markers jsonb default null
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
  select owner_id, owner_studio_id into v_cap from public.video_captures where id = p_capture_id;
  if not found or not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then raise exception 'Montage introuvable'; end if;
  select * into v_existing from public.video_capture_versions where id = p_id;
  if v_existing.id is not null and (not public.video_owned(v_existing.owner_id, v_existing.owner_studio_id, v_c, v_s) or v_existing.capture_id <> p_capture_id) then
    raise exception 'Non autorisé : cette version appartient à un autre montage';
  end if;
  insert into public.video_capture_versions (id, capture_id, owner_id, owner_studio_id, title, substitutions, events, lane_overrides, collapsed_groups, markers, updated_at)
  values (p_id, p_capture_id, v_c, v_s, coalesce(p_title, ''), coalesce(p_substitutions, '{}'::jsonb), p_events, p_lane_overrides, p_collapsed_groups, p_markers, v_now)
  on conflict (id) do update set
    title = excluded.title,
    substitutions = excluded.substitutions,
    events = coalesce(excluded.events, public.video_capture_versions.events),
    lane_overrides = coalesce(excluded.lane_overrides, public.video_capture_versions.lane_overrides),
    collapsed_groups = coalesce(excluded.collapsed_groups, public.video_capture_versions.collapsed_groups),
    markers = coalesce(excluded.markers, public.video_capture_versions.markers),
    updated_at = v_now;
  return jsonb_build_object('ok', true, 'id', p_id, 'updatedAt', v_now);
end;
$$;

-- La liste des versions renvoie aussi la frise propre de chaque alternative (NULL pour une version « à l'ancienne »).
create or replace function public.list_video_capture_versions(p_capture_id text, p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_result jsonb;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'captureId', capture_id, 'title', title, 'substitutions', substitutions,
    'lastExportVideoId', last_export_video_id, 'createdAt', created_at, 'updatedAt', updated_at,
    'status', review_status, 'statusAt', review_status_at, 'statusBy', review_status_by,
    'events', events, 'laneOverrides', lane_overrides, 'collapsedGroups', collapsed_groups, 'markers', markers
  ) order by created_at), '[]'::jsonb)
  into v_result
  from public.video_capture_versions
  where capture_id = p_capture_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
  return v_result;
end;
$$;

revoke all on function public.save_video_capture_version(text, text, text, jsonb, boolean, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_video_capture_version(text, text, text, jsonb, boolean, jsonb, jsonb, jsonb, jsonb) to authenticated;
