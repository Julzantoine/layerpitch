-- Renommer une vidéo de la bibliothèque (6/11, demande de Jules-Antoine) : seul le titre change, jamais le fichier.
create or replace function public.rename_video(p_id text, p_title text, p_studio boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio);
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé'; end if;
  update public.composer_videos set title = left(coalesce(p_title, ''), 200), updated_at = now()
  where id = p_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
end;
$$;
grant execute on function public.rename_video(text, text, boolean) to authenticated;
