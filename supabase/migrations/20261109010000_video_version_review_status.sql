-- LayerPitch — Versioning vidéo : statut de relecture d'une version vidéo (9 novembre 2026, idée tirée de Pibox).
--
-- Quatre statuts, choisis par Jules-Antoine : draft (brouillon) -> sent (envoyée au client) -> changes_requested
-- (modifs demandées) -> approved (validée). Changé à la main par le compositeur (ou le studio) ; plus tard, le lien de
-- relecture client pourra le changer tout seul. On garde la date du dernier changement de statut.
--
-- Même gating que le reste du Versioning (video_can_version) : aucune règle nouvelle.

alter table public.video_capture_versions
  add column if not exists review_status text not null default 'draft',
  add column if not exists review_status_at timestamptz;

alter table public.video_capture_versions drop constraint if exists video_capture_versions_review_status_check;
alter table public.video_capture_versions add constraint video_capture_versions_review_status_check
  check (review_status in ('draft', 'sent', 'changes_requested', 'approved'));

-- Changer le statut d'une version (le compositeur ou le studio propriétaire seulement).
create or replace function public.set_video_capture_version_status(p_id text, p_status text, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
  v_now timestamptz := now();
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then raise exception 'Non autorisé'; end if;
  if p_status is null or p_status not in ('draft', 'sent', 'changes_requested', 'approved') then raise exception 'statut invalide'; end if;
  update public.video_capture_versions
     set review_status = p_status, review_status_at = v_now
   where id = p_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s)
     and review_status is distinct from p_status;
  if not found and not exists (select 1 from public.video_capture_versions where id = p_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s)) then
    raise exception 'Version introuvable';
  end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

revoke all on function public.set_video_capture_version_status(text, text, boolean) from public, anon;
grant execute on function public.set_video_capture_version_status(text, text, boolean) to authenticated;

-- La liste renvoie maintenant aussi le statut (même signature qu'avant : create or replace suffit).
create or replace function public.list_video_capture_versions(p_capture_id text, p_studio boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_result jsonb;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'captureId', capture_id, 'title', title, 'substitutions', substitutions,
    'lastExportVideoId', last_export_video_id, 'createdAt', created_at, 'updatedAt', updated_at,
    'status', review_status, 'statusAt', review_status_at
  ) order by created_at), '[]'::jsonb)
  into v_result
  from public.video_capture_versions
  where capture_id = p_capture_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
  return v_result;
end;
$$;
