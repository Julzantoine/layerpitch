-- LayerPitch — effets sonores (Sfx) protégés (29/09, suite des morceaux protégés ; packs). Même principe que les morceaux :
-- fichiers dans le seau privé (audio/sfx-<id>/<fichier>, R2_PROJECTS_BUCKET), liens signés délivrés par track-audio-url
-- ({ sfxId }), déplacement par set-track-protection ({ sfxId }).
--   * Les packs restent CONSULTABLES par défaut (c'est leur raison d'être, décision du 29/09) : un Sfx protégé d'un pack en
--     vente s'écoute donc sur la page du pack ; ce qui est protégé, c'est l'accès direct aux fichiers.
--   * can_hear_sfx(sfx) : non protégé -> oui ; protégé -> son compositeur ; présent dans un bloc Sfx d'un AdReel ; dans un
--     pack en vente ; dans un pack acheté (compte ou équipe du studio) ; ou utilisé par un morceau que l'appelant peut écouter.

alter table public.sfx_library add column protected boolean not null default false;
comment on column public.sfx_library.protected is 'Fichiers audio dans le seau privé (liens signés, voir can_hear_sfx). Réglé par l''Edge Function set-track-protection.';

create or replace function public.can_hear_sfx(p_sfx_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_protected boolean; v_owner uuid;
begin
  select s.protected, s.owner_id into v_protected, v_owner from public.sfx_library s where s.id = p_sfx_id;
  if not found then return false; end if;
  if not v_protected then return true; end if;
  -- Écoute publique voulue : bloc Sfx d'un AdReel, pack en vente.
  if exists (select 1 from public.ad_reels r, jsonb_array_elements(r.blocks) b
             where b->>'type' = 'sfx' and jsonb_typeof(b->'sfxIds') = 'array' and (b->'sfxIds') ? p_sfx_id) then return true; end if;
  if exists (select 1 from public.pack_sfx ps join public.packs p on p.id = ps.pack_id where ps.sfx_id = p_sfx_id and p.buyable) then return true; end if;
  if v_uid is null then
    -- Sans compte : seulement via un morceau lui-même écoutable publiquement.
    return exists (select 1 from public.track_sfx ts where ts.sfx_id = p_sfx_id and public.can_hear_track(ts.track_id));
  end if;
  if v_owner is not null and v_owner = public.current_composer_id() then return true; end if;
  if exists (select 1 from public.pack_sfx ps join public.pack_purchases pp on pp.pack_id = ps.pack_id
             where ps.sfx_id = p_sfx_id
               and (pp.studio_id = v_uid or pp.studio_id in (select sa.profile_id from public.studio_accounts(public.current_studio_id()) sa))) then return true; end if;
  return exists (select 1 from public.track_sfx ts where ts.sfx_id = p_sfx_id and public.can_hear_track(ts.track_id));
end;
$$;
revoke execute on function public.can_hear_sfx(text) from public;
grant execute on function public.can_hear_sfx(text) to anon, authenticated;

create or replace function public.set_sfx_protected(p_sfx_id text, p_protected boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sfx_library set protected = p_protected where id = p_sfx_id;
  if not found then raise exception 'Sfx introuvable'; end if;
end;
$$;
revoke execute on function public.set_sfx_protected(text, boolean) from public, anon, authenticated;
grant execute on function public.set_sfx_protected(text, boolean) to service_role;
