-- LayerPitch — bibliothèque vidéo compositeur (section "Vidéo" du Backstage), 16 septembre 2026.
--
-- Deux origines pour une vidéo ici : 'upload' (le compositeur importe son propre fichier, ex. une
-- vidéo de gameplay) et 'capture_export' (généré par le moteur de capture/rescore de pack.html,
-- voir video_captures/20260916010000_video_captures.sql -- CETTE table-ci ne stocke jamais la vidéo
-- elle-même, seulement les événements d'une prise ; une fois exportée en vrai .mp4, le fichier fini
-- atterrit ici s'il est envoyé dans la bibliothèque). `pack_id` optionnel relie un export à son pack
-- d'origine, sans contrainte pour un simple upload.
--
-- Même patron `base + file` que tracks/sfx_library (base recalculée à chaque publication côté
-- client, voir MEDIA_BASE dans layerpitch-backstage.html) -- pas une URL complète stockée en base.
--
-- Gating actuel : is_admin() uniquement (même situation que video_captures et le reste du chantier
-- capture vidéo -- aucun palier Rookie/Warrior/Boss n'existe encore ailleurs dans le produit).
--
-- Clarifié le 16 septembre (après une confusion de ma part entre deux mécanismes distincts) :
-- `plan_quotas.max_video_storage_gb` (0 Go free/Rookie, 20 Go starter/Warrior, 100 Go pro/Boss,
-- posé le 3 septembre) régit CETTE bibliothèque-ci (composer_videos, uploads + exports rangés) --
-- Warrior peut bien y stocker des vidéos (des reels notamment). Ce que Warrior N'A PAS le droit de
-- faire, c'est sauvegarder une PRISE DE CAPTURE d'une session à l'autre (video_captures, chantier
-- séparé, voir decisions/2026-09-15-capture-tiers-sauvegarde.md -- réservé à Boss). Les deux tables
-- ont des règles de palier différentes et ne doivent pas être confondues : composer_videos =
-- stockage vidéo général (dès Warrior), video_captures = persistance du projet de montage capturé
-- (Boss uniquement). Le quota ci-dessous reste donc correct tel quel, aucune valeur à changer.

create table public.composer_videos (
  id text primary key,
  owner_id uuid not null references public.composer_profiles(id) on delete cascade,
  kind text not null default 'upload' check (kind in ('upload', 'capture_export')),
  pack_id text references public.packs(id) on delete set null,
  title text not null default '',
  base text not null default '',
  file text not null,
  original_name text,
  mime_type text,
  size_bytes bigint,
  duration_seconds numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index composer_videos_owner_idx on public.composer_videos(owner_id, created_at desc);

alter table public.composer_videos enable row level security;
-- RLS activée SANS policy directe -- accès exclusivement via les fonctions SECURITY DEFINER
-- ci-dessous, même patron que video_captures/analytics_events.

-- ============================================================================
-- Lecture
-- ============================================================================

-- Renvoie la liste ET le quota dans le même appel (évite un aller-retour RPC séparé pour le quota,
-- et le client n'a besoin de connaître ni son propre composer_id ni la forme de effective_plan_quotas).
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
  if not public.is_admin() or v_owner_id is null then
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
grant execute on function public.list_my_videos() to authenticated;

-- ============================================================================
-- Écriture (métadonnées seulement -- le fichier lui-même est déjà sur R2 au moment de cet appel,
-- voir r2PutFile/create-media-signed-url côté client, même mécanisme que l'upload audio existant)
-- ============================================================================

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
  v_new_size bigint := coalesce((payload->>'sizeBytes')::bigint, 0);
  v_quota_gb int;
  v_used_bytes bigint;
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : bibliothèque vidéo réservée aux comptes admin pour l''instant';
  end if;
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_id is null or v_id = '' then raise exception 'id manquant'; end if;
  if coalesce(payload->>'file', '') = '' then raise exception 'file manquant'; end if;

  select owner_id into v_existing_owner from public.composer_videos where id = v_id;
  if v_existing_owner is not null and v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : cette vidéo appartient à un autre compositeur';
  end if;

  -- Quota de stockage (plan_quotas.max_video_storage_gb, voir le commentaire en tête de fichier sur
  -- le point non tranché avec Jules-Antoine) -- null = illimité (palier pro / admin, voir
  -- effective_plan_quotas). Recalculé sur le total RÉEL en base, jamais fait confiance au payload.
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
    v_id, v_owner_id, coalesce(payload->>'kind', 'upload'), nullif(payload->>'packId', ''),
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
grant execute on function public.upsert_video(jsonb) to authenticated;

-- ============================================================================
-- Suppression (métadonnées seulement -- le fichier R2 est supprimé séparément côté client via
-- r2DeleteFile/create-media-signed-url AVANT cet appel, même ordre que le reste du média existant)
-- ============================================================================

create or replace function public.delete_video(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
begin
  if not public.is_admin() or v_owner_id is null then
    raise exception 'Non autorisé';
  end if;
  delete from public.composer_videos where id = p_id and owner_id = v_owner_id;
end;
$$;
grant execute on function public.delete_video(text) to authenticated;
