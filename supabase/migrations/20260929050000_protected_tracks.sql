-- LayerPitch — morceaux protégés (29/09, décision de Jules-Antoine : « il faut protéger l'album », choix PAR MORCEAU).
--
--   * tracks.protected : les fichiers audio du morceau sont dans un seau R2 PRIVÉ (même chemin audio/<id>/<fichier>, seau
--     R2_PROJECTS_BUCKET) et ne se lisent que par des liens signés de courte durée (Edge Function track-audio-url).
--     Le déplacement des fichiers (public <-> privé) est fait par set-track-protection, qui règle ensuite ce drapeau.
--   * can_hear_track(morceau) : qui peut obtenir ces liens. Un morceau protégé reste écoutable :
--       - par son compositeur ; par le vendeur d'un album qui le contient et par les compositeurs invités de cet album ;
--       - par un acheteur d'un album qui le contient (y compris s'il en a été retiré après l'achat) ;
--       - par tout le monde s'il est en écoute libre d'un album en vente ;
--       - par tout le monde s'il figure dans un AdReel (le compositeur l'y a mis : écoute publique voulue) ;
--       - par l'acheteur d'un pack qui le contient (et l'équipe du studio), et par tout le monde tant qu'il est dans un
--         pack en vente (la page du pack l'écoute publiquement : les packs sont un chantier à part).
--     Un morceau non protégé : toujours vrai (fichiers publics).
-- Aucune restriction sur les AdReels : un morceau protégé peut y figurer.

alter table public.tracks add column protected boolean not null default false;
comment on column public.tracks.protected is 'Fichiers audio dans le seau privé (liens signés, voir can_hear_track). Réglé par l''Edge Function set-track-protection.';

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
  -- Écoute publique voulue : AdReel, pack en vente, écoute libre d'un album en vente.
  if exists (select 1 from public.ad_reel_tracks where track_id = p_track_id) then return true; end if;
  if exists (select 1 from public.pack_tracks pt join public.packs p on p.id = pt.pack_id where pt.track_id = p_track_id and p.buyable) then return true; end if;
  if exists (select 1 from public.album_tracks at join public.albums a on a.id = at.album_id
             where at.track_id = p_track_id and at.removed_at is null and a.buyable
               and (a.listen_mode = 'all' or (a.listen_mode = 'selected' and at.free_listen))) then return true; end if;
  if v_uid is null then return false; end if;
  -- Le compositeur du morceau.
  if v_owner is not null and v_owner = public.current_composer_id() then return true; end if;
  -- Vendeur ou compositeur invité d'un album qui le contient.
  if exists (select 1 from public.album_tracks at join public.albums a on a.id = at.album_id
             where at.track_id = p_track_id and (a.seller_id = v_uid or public.is_album_contributor(a.id))) then return true; end if;
  -- Acheteur d'un album qui le contient (retiré après l'achat : gardé).
  if exists (select 1 from public.album_purchases ap where ap.buyer_id = v_uid and public.album_track_visible_to_me(ap.album_id, p_track_id)) then return true; end if;
  -- Acheteur d'un pack qui le contient (compte ou équipe du studio).
  if exists (select 1 from public.pack_tracks pt join public.pack_purchases pp on pp.pack_id = pt.pack_id
             where pt.track_id = p_track_id
               and (pp.studio_id = v_uid
                    or pp.studio_id in (select sa.profile_id from public.studio_accounts(public.current_studio_id()) sa))) then return true; end if;
  return false;
end;
$$;
revoke execute on function public.can_hear_track(text) from public;
grant execute on function public.can_hear_track(text) to anon, authenticated;

-- Réservé à l'Edge Function set-track-protection (service_role), qui déplace d'abord les fichiers.
create or replace function public.set_track_protected(p_track_id text, p_protected boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tracks set protected = p_protected where id = p_track_id;
  if not found then raise exception 'Morceau introuvable'; end if;
end;
$$;
revoke execute on function public.set_track_protected(text, boolean) from public, anon, authenticated;
grant execute on function public.set_track_protected(text, boolean) to service_role;
