-- Projet vidéo : changer le pack d'un montage (09/11, « modifiables » : le pack se choisit à la création, on peut en changer ensuite).
-- save_video_capture ne touche jamais au pack d'un montage existant ; cette fonction est le seul chemin. Mêmes règles que sa création :
-- compositeur = ses propres packs ; studio = packs que l'équipe possède.
create or replace function public.set_video_capture_pack(p_capture_id text, p_pack_id text, p_studio boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.video_actor_composer(p_studio); v_s uuid := public.video_actor_studio(p_studio); v_pack_owner uuid;
begin
  if v_c is null and v_s is null then raise exception 'Non autorisé'; end if;
  if p_pack_id is null or p_pack_id = '' then raise exception 'pack_id manquant'; end if;
  if v_c is not null then
    select owner_id into v_pack_owner from public.packs where id = p_pack_id;
    if v_pack_owner is null or v_pack_owner <> v_c then raise exception 'Non autorisé : ce pack n''est pas à toi'; end if;
  elsif not public.team_owns_pack(p_pack_id) then
    raise exception 'Non autorisé : ce pack n''appartient pas à ton studio';
  end if;
  update public.video_captures set pack_id = p_pack_id, updated_at = now()
  where id = p_capture_id and public.video_owned(owner_id, owner_studio_id, v_c, v_s);
  if not found then raise exception 'Montage introuvable'; end if;
end;
$$;
grant execute on function public.set_video_capture_pack(text, text, boolean) to authenticated;
