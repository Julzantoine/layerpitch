-- LayerPitch — « Envoyer au client » : figer aussi la version n° 1 (le montage) sans passer par une autre version (10 novembre 2026).
-- Complète 20261110020000 : quand le compositeur envoie seulement le montage, sa révision (#1.1, #1.2…) est figée par cette fonction.
create or replace function public.freeze_video_review_original(p_capture_id text, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_cap public.video_captures;
begin
  if (v_c is null and v_s is null) or not public.video_can_version(p_studio) then raise exception 'Non autorisé'; end if;
  select * into v_cap from public.video_captures where id = p_capture_id;
  if not found or not public.video_owned(v_cap.owner_id, v_cap.owner_studio_id, v_c, v_s) then raise exception 'Montage introuvable'; end if;
  perform public.video_freeze_revision(p_capture_id, 'original', v_cap.last_export_video_id, v_cap.last_export_cues);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.freeze_video_review_original(text, boolean) from public, anon;
grant execute on function public.freeze_video_review_original(text, boolean) to authenticated;
