-- LayerPitch — Adaptive OST : un morceau (ou un Sfx) supprimé mais déjà obtenu par des fans est RETIRÉ, pas refusé.
--
-- Décision de Jules-Antoine (27/09), sur le modèle du « privé » de Bandcamp : le compositeur supprime un morceau
-- d'un album obtenu (ou sur lequel des fans ont des versions) -> le morceau disparaît de son catalogue, de ses packs et
-- de ses AdReels, mais reste en coulisses pour les fans : écoute, atelier (nouvelles versions), versions, téléchargement.
-- Remplace le refus « blocked_sold » du 25/09 (20260925020000) pour les morceaux ; même chose pour un Sfx attaché à un
-- tel morceau (l'atelier du fan en a besoin). Un élément que personne n'a obtenu se supprime comme avant.
-- Les packs vendus restent refusés (inchangé).
--
--   - tracks.retired_at / sfx_library.retired_at : non nul = retiré. Le Backstage ne les liste plus (api/tracks.js,
--     api/sfx.js) ; la lecture par identifiant (page fan) les trouve toujours.
--   - delete_my_track / delete_my_sfx renvoient désormais 'deleted' ou 'retired' (le Backstage l'annonce, et garde
--     les fichiers d'un élément retiré).
--   - media_path_kept_for_fans : ce qu'appelle l'Edge Function create-media-signed-url avant tout effacement audio --
--     fichiers utilisés par une prise (20260927010000) OU appartenant à un morceau / Sfx gardé pour les fans.

alter table public.tracks add column if not exists retired_at timestamptz;
alter table public.sfx_library add column if not exists retired_at timestamptz;
comment on column public.tracks.retired_at is 'Retiré par son compositeur mais gardé pour les fans qui l''ont obtenu (27/09). Plus listé dans son catalogue ; toujours lisible par identifiant.';
comment on column public.sfx_library.retired_at is 'Retiré par son compositeur mais gardé : attaché à un morceau gardé pour des fans (27/09).';

-- Un morceau est gardé pour les fans s'il est déjà retiré, s'il fait partie d'un album obtenu (achats de test compris),
-- ou si des fans ont des réglages ou des versions dessus.
create or replace function public.track_kept_for_fans(p_track_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tracks where id = p_track_id and retired_at is not null)
      or exists (select 1 from public.album_tracks at join public.album_purchases ap on ap.album_id = at.album_id where at.track_id = p_track_id)
      or exists (select 1 from public.album_track_versions where track_id = p_track_id)
      or exists (select 1 from public.album_track_settings where track_id = p_track_id);
$$;

create or replace function public.sfx_kept_for_fans(p_sfx_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.sfx_library where id = p_sfx_id and retired_at is not null)
      or exists (select 1 from public.track_sfx ts where ts.sfx_id = p_sfx_id and public.track_kept_for_fans(ts.track_id));
$$;

drop function if exists public.delete_my_track(text);
create function public.delete_my_track(p_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_existing_owner uuid;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  select owner_id into v_existing_owner from public.tracks where id = p_id;
  if not found then return 'deleted'; end if;
  if v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : ce morceau appartient à un autre compositeur';
  end if;
  if public.track_kept_for_fans(p_id) then
    -- Retiré : plus dans le catalogue ni sur les pages publiques du compositeur ; tout le reste (emplacements, boucles,
    -- Sfx attachés, albums, versions) reste en place pour les fans.
    update public.tracks set retired_at = coalesce(retired_at, now()) where id = p_id;
    delete from public.pack_tracks where track_id = p_id;
    delete from public.ad_reel_tracks where track_id = p_id;
    -- Ses Sfx deviennent eux aussi « gardés » (sfx_kept_for_fans) : une suppression ultérieure les retirera.
    return 'retired';
  end if;
  -- Cascade existante : emplacements, transitions, liens Sfx/packs/AdReels/albums (non obtenus) du morceau.
  delete from public.tracks where id = p_id and owner_id = v_owner_id;
  return 'deleted';
end;
$$;

drop function if exists public.delete_my_sfx(text);
create function public.delete_my_sfx(p_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_existing_owner uuid;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  select owner_id into v_existing_owner from public.sfx_library where id = p_id;
  if not found then return 'deleted'; end if;
  if v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : ce Sfx appartient à un autre compositeur';
  end if;
  if public.sfx_kept_for_fans(p_id) then
    update public.sfx_library set retired_at = coalesce(retired_at, now()) where id = p_id;
    delete from public.pack_sfx where sfx_id = p_id;
    return 'retired';
  end if;
  delete from public.sfx_library where id = p_id and owner_id = v_owner_id;
  return 'deleted';
end;
$$;

-- Appelée par l'Edge Function create-media-signed-url (rôle service) avant tout effacement d'un fichier audio/… :
-- p_needles[1] = chemin brut (audio/<morceau>/… ou audio/sfx-<Sfx>/…), les suivants = autres formes du chemin dans les
-- prises (voir media_path_used_by_versions).
create or replace function public.media_path_kept_for_fans(p_needles text[])
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_path text := p_needles[1];
  v_id text;
begin
  if public.media_path_used_by_versions(p_needles) then return true; end if;
  v_id := substring(v_path from '^audio/sfx-([^/]+)/');
  if v_id is not null then return public.sfx_kept_for_fans(v_id); end if;
  v_id := substring(v_path from '^audio/([^/]+)/');
  if v_id is not null then return public.track_kept_for_fans(v_id); end if;
  return false;
end;
$$;

revoke all on function public.track_kept_for_fans(text), public.sfx_kept_for_fans(text), public.media_path_kept_for_fans(text[])
  from public, anon, authenticated;
grant execute on function public.media_path_kept_for_fans(text[]) to service_role;
revoke execute on function public.delete_my_track(text), public.delete_my_sfx(text) from public, anon;
grant execute on function public.delete_my_track(text) to authenticated;
grant execute on function public.delete_my_sfx(text) to authenticated;
