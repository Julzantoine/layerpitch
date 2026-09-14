-- LayerPitch — ouvre le moteur de capture/rescore ET la bibliothèque vidéo à TOUT compositeur
-- connecté, 16 septembre 2026. Jusqu'ici gardés par is_admin() (seul Jules-Antoine pouvait y toucher,
-- prototype construit le jour même). Décision de Jules-Antoine : accessible depuis le Backstage à
-- "tout compositeur bêta" -- la plateforme reste 100% invitation aujourd'hui, donc ça revient
-- concrètement à tout compositeur qui a déjà un compte. AUCUN palier Rookie/Warrior/Boss n'existe
-- encore ailleurs dans le produit -- pas construit par anticipation ici non plus.
--
-- POINT EXPLICITEMENT TEMPORAIRE (dit par Jules-Antoine lui-même, 16 septembre) : "ça changera au
-- moment du lancement et il faudra filtrer par abonnement." Quand le palier réel existera, remplacer
-- le simple `v_owner_id is not null` ci-dessous par la vraie règle de palier pour chaque fonction :
-- video_captures (save/list/get/delete) -> Boss uniquement (voir
-- decisions/2026-09-15-capture-tiers-sauvegarde.md) ; composer_videos (list/upsert/delete) -> déjà
-- gérée par le quota effective_plan_quotas().max_video_storage_gb dans upsert_video (0 Go Rookie =
-- refus de fait dès le premier octet, pas besoin d'une vérification de palier séparée ici).
--
-- Durcissement ajouté au passage, nécessaire maintenant que ce n'est plus réservé à l'admin qui
-- possède tout : `save_video_capture`/`upsert_video` vérifient désormais que `pack_id` (quand fourni)
-- appartient bien au compositeur appelant -- absent jusqu'ici (sans conséquence tant que seul
-- l'admin, propriétaire de fait de tout, pouvait appeler ces fonctions).

create or replace function public.save_video_capture(
  p_id text,
  p_pack_id text,
  p_title text,
  p_video_filename text,
  p_events jsonb,
  p_lane_overrides jsonb default '{}'::jsonb,
  p_collapsed_groups jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_existing_owner uuid;
  v_pack_owner uuid;
  v_now timestamptz := now();
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if p_id is null or p_id = '' then raise exception 'id manquant'; end if;
  if p_pack_id is null or p_pack_id = '' then raise exception 'pack_id manquant'; end if;

  select owner_id into v_pack_owner from public.packs where id = p_pack_id;
  if v_pack_owner is not null and v_pack_owner <> v_owner_id then
    raise exception 'Non autorisé : ce pack appartient à un autre compositeur';
  end if;

  select owner_id into v_existing_owner from public.video_captures where id = p_id;
  if v_existing_owner is not null and v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : cette prise appartient à un autre compositeur';
  end if;

  insert into public.video_captures (id, owner_id, pack_id, title, video_filename, events, lane_overrides, collapsed_groups, updated_at)
  values (p_id, v_owner_id, p_pack_id, coalesce(p_title, ''), p_video_filename,
    coalesce(p_events, '[]'::jsonb), coalesce(p_lane_overrides, '{}'::jsonb), coalesce(p_collapsed_groups, '{}'::jsonb), v_now)
  on conflict (id) do update set
    title = excluded.title, video_filename = excluded.video_filename,
    events = excluded.events, lane_overrides = excluded.lane_overrides, collapsed_groups = excluded.collapsed_groups,
    updated_at = v_now;

  return jsonb_build_object('ok', true, 'id', p_id, 'updatedAt', v_now);
end;
$$;

create or replace function public.list_my_video_captures(p_pack_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_result jsonb;
begin
  if v_owner_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'packId', pack_id, 'title', title, 'videoFilename', video_filename,
    'createdAt', created_at, 'updatedAt', updated_at
  ) order by updated_at desc), '[]'::jsonb)
  into v_result
  from public.video_captures
  where owner_id = v_owner_id and (p_pack_id is null or pack_id = p_pack_id);

  return v_result;
end;
$$;

create or replace function public.get_video_capture(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_row public.video_captures;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé';
  end if;

  select * into v_row from public.video_captures where id = p_id and owner_id = v_owner_id;
  if v_row.id is null then
    raise exception 'Prise introuvable';
  end if;

  return jsonb_build_object(
    'id', v_row.id, 'packId', v_row.pack_id, 'title', v_row.title, 'videoFilename', v_row.video_filename,
    'events', v_row.events, 'laneOverrides', v_row.lane_overrides, 'collapsedGroups', v_row.collapsed_groups,
    'createdAt', v_row.created_at, 'updatedAt', v_row.updated_at
  );
end;
$$;

create or replace function public.delete_video_capture(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null then
    raise exception 'Non autorisé';
  end if;
  delete from public.video_captures where id = p_id and owner_id = v_owner_id;
end;
$$;

create or replace function public.list_my_videos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_videos jsonb;
  v_quota_gb int;
begin
  if v_owner_id is null then
    return jsonb_build_object('videos', '[]'::jsonb, 'quotaGb', null);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind, 'packId', pack_id, 'title', title, 'base', base, 'file', file,
    'originalName', original_name, 'mimeType', mime_type, 'sizeBytes', size_bytes,
    'durationSeconds', duration_seconds, 'createdAt', created_at, 'updatedAt', updated_at
  ) order by created_at desc), '[]'::jsonb)
  into v_videos
  from public.composer_videos where owner_id = v_owner_id;

  select max_video_storage_gb into v_quota_gb from public.effective_plan_quotas(v_owner_id);

  return jsonb_build_object('videos', v_videos, 'quotaGb', v_quota_gb);
end;
$$;

create or replace function public.upsert_video(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_id text := payload->>'id';
  v_existing_owner uuid;
  v_pack_id text := nullif(payload->>'packId', '');
  v_pack_owner uuid;
  v_new_size bigint := coalesce((payload->>'sizeBytes')::bigint, 0);
  v_quota_gb int;
  v_used_bytes bigint;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_id is null or v_id = '' then raise exception 'id manquant'; end if;
  if coalesce(payload->>'file', '') = '' then raise exception 'file manquant'; end if;

  if v_pack_id is not null then
    select owner_id into v_pack_owner from public.packs where id = v_pack_id;
    if v_pack_owner is not null and v_pack_owner <> v_owner_id then
      raise exception 'Non autorisé : ce pack appartient à un autre compositeur';
    end if;
  end if;

  select owner_id into v_existing_owner from public.composer_videos where id = v_id;
  if v_existing_owner is not null and v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : cette vidéo appartient à un autre compositeur';
  end if;

  -- Quota de stockage (plan_quotas.max_video_storage_gb) -- null = illimité (palier pro/Boss ou
  -- admin, voir effective_plan_quotas), 0 = Rookie/free (refus de fait dès le premier octet, pas
  -- besoin d'une vérification de palier séparée pour bloquer Rookie). Recalculé sur le total RÉEL
  -- en base, jamais fait confiance au payload.
  select max_video_storage_gb into v_quota_gb from public.effective_plan_quotas(v_owner_id);
  if v_quota_gb is not null then
    select coalesce(sum(size_bytes), 0) into v_used_bytes from public.composer_videos
      where owner_id = v_owner_id and id <> v_id;
    if v_used_bytes + v_new_size > v_quota_gb::bigint * 1024 * 1024 * 1024 then
      raise exception 'Quota de stockage vidéo dépassé (% Go)', v_quota_gb;
    end if;
  end if;

  insert into public.composer_videos (id, owner_id, kind, pack_id, title, base, file, original_name, mime_type, size_bytes, duration_seconds, updated_at)
  values (
    v_id, v_owner_id, coalesce(payload->>'kind', 'upload'), v_pack_id,
    coalesce(payload->>'title', ''), coalesce(payload->>'base', ''), payload->>'file',
    payload->>'originalName', payload->>'mimeType', nullif(payload->>'sizeBytes', '')::bigint,
    nullif(payload->>'durationSeconds', '')::numeric, now()
  )
  on conflict (id) do update set
    kind = excluded.kind, pack_id = excluded.pack_id, title = excluded.title, base = excluded.base,
    file = excluded.file, original_name = excluded.original_name, mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes, duration_seconds = excluded.duration_seconds, updated_at = now();

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.delete_video(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null then
    raise exception 'Non autorisé';
  end if;
  delete from public.composer_videos where id = p_id and owner_id = v_owner_id;
end;
$$;
