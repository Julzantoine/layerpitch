-- LayerPitch — sauvegarde côté serveur des prises du moteur de capture/rescore vidéo (pack.html),
-- décidée le 16 septembre : Jules-Antoine a explicitement écarté la première piste envisagée
-- (télécharger/réimporter un fichier JSON) comme trop de friction pour le compositeur -- voir
-- decisions/2026-09-15-capture-tiers-sauvegarde.md (docs privés) pour le principe Rookie/Warrior/Boss.
--
-- Gating actuel : is_admin() uniquement, comme le reste de l'outil de capture (pack.html n'expose le
-- panneau qu'aux admins pour l'instant, palier Boss pas encore implémenté nulle part dans le produit).
-- Quand le palier Boss existera réellement, remplacer la condition `public.is_admin()` ci-dessous par
-- une vérification de palier composer_effective_tier() = 'boss' (même patron que
-- composer_analytics_events, 20260905010000) -- ne pas construire cette vérification par anticipation,
-- rien à quoi la rattacher n'existe encore.
--
-- Vidéo importée NON stockée (choix délibéré, pas un oubli) : seul `video_filename` est conservé à
-- titre indicatif, pour que le compositeur retrouve de quel fichier il s'agissait -- il doit
-- réimporter le même fichier vidéo local à chaque reprise. Évite de stocker des fichiers vidéo
-- volumineux côté serveur pour une fonctionnalité encore en prototype ; à revoir si Jules-Antoine
-- demande un jour une reprise sans avoir à repointer le fichier.

create table public.video_captures (
  id text primary key,
  owner_id uuid not null references public.composer_profiles(id) on delete cascade,
  pack_id text not null references public.packs(id) on delete cascade,
  title text not null default '',
  video_filename text,
  events jsonb not null default '[]'::jsonb,
  lane_overrides jsonb not null default '{}'::jsonb,
  collapsed_groups jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index video_captures_owner_pack_idx on public.video_captures(owner_id, pack_id, updated_at desc);

-- RLS activée SANS policy directe : accès exclusivement via les fonctions SECURITY DEFINER ci-dessous
-- (même patron que analytics_events, 20260905010000) -- jamais de select/insert/update direct via
-- l'API REST, même authentifié.
alter table public.video_captures enable row level security;

-- ============================================================================
-- Écriture (créer ou mettre à jour une prise sauvegardée)
-- ============================================================================

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
  v_now timestamptz := now();
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : capture vidéo réservée aux comptes admin pour l''instant';
  end if;
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if p_id is null or p_id = '' then raise exception 'id manquant'; end if;
  if p_pack_id is null or p_pack_id = '' then raise exception 'pack_id manquant'; end if;

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
grant execute on function public.save_video_capture(text, text, text, text, jsonb, jsonb, jsonb) to authenticated;

-- ============================================================================
-- Lecture (liste allégée pour le sélecteur de reprise + détail complet pour charger une prise)
-- ============================================================================

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
  if not public.is_admin() or v_owner_id is null then
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
grant execute on function public.list_my_video_captures(text) to authenticated;

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
  if not public.is_admin() or v_owner_id is null then
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
grant execute on function public.get_video_capture(text) to authenticated;

-- ============================================================================
-- Suppression
-- ============================================================================

create or replace function public.delete_video_capture(p_id text)
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
  delete from public.video_captures where id = p_id and owner_id = v_owner_id;
end;
$$;
grant execute on function public.delete_video_capture(text) to authenticated;
