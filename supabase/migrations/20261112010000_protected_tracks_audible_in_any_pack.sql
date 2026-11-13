-- LayerPitch — retour bêta du 11/11 (Hugo) : les morceaux deviennent protégés PAR DÉFAUT à leur première publication.
-- Problème que ça révèle : can_hear_track() n'ouvrait l'écoute publique d'un morceau protégé que pour un pack EN VENTE (p.buyable).
-- Or la vente de packs est réservée aux admins pendant la bêta, et un pack gratuit (ou envoyé à un studio par son lien) se lit
-- sur sa page publique : avec la protection par défaut, ces pages seraient devenues muettes, sans message.
-- Décision de Jules-Antoine (12/11) : un morceau placé dans un pack reste audible par la page du pack, comme un morceau placé dans
-- un AdReel public (le compositeur l'y a mis : écoute publique voulue). Seule la clause « pack » change : plus de condition buyable.
-- Le téléchargement direct reste impossible (liens signés de courte durée, Edge Function track-audio-url).

create or replace function public.can_hear_track(p_track_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_protected boolean; v_owner uuid;
begin
  select t.protected, t.owner_id into v_protected, v_owner from public.tracks t where t.id = p_track_id;
  if not found then return false; end if;
  if not v_protected then return true; end if;
  if exists (select 1 from public.ad_reel_tracks art join public.ad_reels ar on ar.owner_id = art.owner_id and ar.id = art.ad_reel_id
             where art.track_id = p_track_id and ar.access_mode = 'public') then return true; end if;
  -- Pack (en vente ou non) : la page du pack l'écoute publiquement.
  if exists (select 1 from public.pack_tracks pt where pt.track_id = p_track_id) then return true; end if;
  if exists (select 1 from public.album_tracks at join public.albums a on a.id = at.album_id
             where at.track_id = p_track_id and at.removed_at is null and a.buyable
               and (a.listen_mode = 'all' or (a.listen_mode = 'selected' and at.free_listen))) then return true; end if;
  if v_uid is null then return false; end if;
  if v_owner is not null and v_owner = public.current_composer_id() then return true; end if;
  if exists (select 1 from public.album_tracks at join public.albums a on a.id = at.album_id
             where at.track_id = p_track_id and (a.seller_id = v_uid or public.is_album_contributor(a.id))) then return true; end if;
  if exists (select 1 from public.album_purchases ap where ap.buyer_id = v_uid and public.album_track_visible_to_me(ap.album_id, p_track_id)) then return true; end if;
  if exists (select 1 from public.pack_tracks pt join public.pack_purchases pp on pp.pack_id = pt.pack_id
             where pt.track_id = p_track_id
               and (pp.studio_id = v_uid
                    or pp.studio_id in (select sa.profile_id from public.studio_accounts(public.current_studio_id()) sa))) then return true; end if;
  return false;
end;
$$;
revoke execute on function public.can_hear_track(text) from public;
grant execute on function public.can_hear_track(text) to anon, authenticated;
