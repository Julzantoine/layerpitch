-- LayerPitch — Versioning de l'outil vidéo (26 septembre 2026) : les « versions vidéo » d'un montage.
--
-- Une version vidéo = un montage sauvegardé (video_captures) + une table de remplacement (morceau X -> morceau Y,
-- Sfx A -> Sfx B), rejouée par capture-retarget.js au moment de l'écoute ou du rendu. Elle NE recopie PAS le
-- journal : retoucher la frise du montage profite à toutes ses versions (décision Q5 du cadrage,
-- layerpitch-docs/2026-09-26-cadrage-variantes-video.md). Une ligne par version (décision Q1 : fiche à part --
-- nom propre, dernière vidéo rendue, listable / supprimable une par une).
--
-- substitutions (jsonb) : { "tracks": { "<id d'origine>": { "to": "<id>", "snapToImage": bool } },
--                           "sfx":    { "<id d'origine>": "<id>" | null } }  -- null = « à choisir » (l'original joue)
--
-- Gating : ADMIN SEULEMENT pour l'instant (règle du 23/09 : toute nouveauté reste réservée à l'admin jusqu'au feu vert
-- de Jules-Antoine, voir layerpitch-docs/feux-verts-admin.md). Au feu vert, retirer la condition `public.is_admin()`
-- des quatre fonctions ci-dessous ; au lancement, la remplacer par la règle de palier (même que video_captures : Boss).
-- Même patron de sécurité que video_captures : RLS activée SANS policy, accès uniquement par ces fonctions.

create table public.video_capture_versions (
  id text primary key,
  capture_id text not null references public.video_captures(id) on delete cascade,
  owner_id uuid not null references public.composer_profiles(id) on delete cascade,
  title text not null default '',
  substitutions jsonb not null default '{}'::jsonb,
  last_export_video_id text references public.composer_videos(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index video_capture_versions_capture_idx on public.video_capture_versions(capture_id, created_at);

alter table public.video_capture_versions enable row level security;

-- Créer ou mettre à jour une version vidéo (le montage doit appartenir à l'appelant).
create or replace function public.save_video_capture_version(
  p_id text,
  p_capture_id text,
  p_title text,
  p_substitutions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_capture_owner uuid;
  v_existing public.video_capture_versions;
  v_now timestamptz := now();
begin
  if v_owner_id is null or not public.is_admin() then
    raise exception 'Non autorisé';
  end if;
  if p_id is null or p_id = '' then raise exception 'id manquant'; end if;
  if jsonb_typeof(coalesce(p_substitutions, '{}'::jsonb)) <> 'object' then raise exception 'substitutions invalides'; end if;

  select owner_id into v_capture_owner from public.video_captures where id = p_capture_id;
  if v_capture_owner is null or v_capture_owner <> v_owner_id then
    raise exception 'Montage introuvable';
  end if;

  select * into v_existing from public.video_capture_versions where id = p_id;
  if v_existing.id is not null and (v_existing.owner_id <> v_owner_id or v_existing.capture_id <> p_capture_id) then
    raise exception 'Non autorisé : cette version appartient à un autre montage';
  end if;

  insert into public.video_capture_versions (id, capture_id, owner_id, title, substitutions, updated_at)
  values (p_id, p_capture_id, v_owner_id, coalesce(p_title, ''), coalesce(p_substitutions, '{}'::jsonb), v_now)
  on conflict (id) do update set
    title = excluded.title, substitutions = excluded.substitutions, updated_at = v_now;

  return jsonb_build_object('ok', true, 'id', p_id, 'updatedAt', v_now);
end;
$$;

-- Les versions vidéo d'un montage, dans l'ordre de création.
create or replace function public.list_video_capture_versions(p_capture_id text)
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
  if v_owner_id is null or not public.is_admin() then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'captureId', capture_id, 'title', title, 'substitutions', substitutions,
    'lastExportVideoId', last_export_video_id, 'createdAt', created_at, 'updatedAt', updated_at
  ) order by created_at), '[]'::jsonb)
  into v_result
  from public.video_capture_versions
  where capture_id = p_capture_id and owner_id = v_owner_id;
  return v_result;
end;
$$;

-- Dernière vidéo rendue pour une version (rangée dans la bibliothèque vidéo, composer_videos, du même compositeur).
create or replace function public.set_video_capture_version_export(p_id text, p_video_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null or not public.is_admin() then
    raise exception 'Non autorisé';
  end if;
  if p_video_id is not null and not exists (select 1 from public.composer_videos where id = p_video_id and owner_id = v_owner_id) then
    raise exception 'Vidéo introuvable';
  end if;
  update public.video_capture_versions set last_export_video_id = p_video_id, updated_at = now()
  where id = p_id and owner_id = v_owner_id;
end;
$$;

create or replace function public.delete_video_capture_version(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null or not public.is_admin() then
    raise exception 'Non autorisé';
  end if;
  delete from public.video_capture_versions where id = p_id and owner_id = v_owner_id;
end;
$$;

revoke all on function public.save_video_capture_version(text, text, text, jsonb), public.list_video_capture_versions(text),
  public.set_video_capture_version_export(text, text), public.delete_video_capture_version(text) from public, anon;
grant execute on function public.save_video_capture_version(text, text, text, jsonb) to authenticated;
grant execute on function public.list_video_capture_versions(text) to authenticated;
grant execute on function public.set_video_capture_version_export(text, text) to authenticated;
grant execute on function public.delete_video_capture_version(text) to authenticated;
