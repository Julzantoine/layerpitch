-- LayerPitch — suppression réelle en base des morceaux, Sfx, packs, collections et AdReels retirés dans le Backstage.
--
-- Bug trouvé le 25 septembre (compte tuto contact@layerpitch.com : deux "My first adaptive track" supprimés qui
-- revenaient à chaque rechargement) : depuis l'abandon de la publication GitHub (data.json réécrit en entier, donc
-- un élément retiré disparaissait de lui-même), publishAll() ne fait plus que des upsert_* -- aucune écriture ne
-- supprimait jamais rien, et aucune policy DELETE n'existe pour anon/authenticated (20260831102636). Tout élément
-- "supprimé" restait en base et revenait au chargement suivant, fichiers audio déjà effacés de R2 en prime.
--
-- Une RPC par type, même modèle que upsert_* : security definer, appartenance vérifiée via current_composer_id().
-- Idempotentes : un id introuvable (déjà supprimé, ou jamais publié) ne lève rien.
--
-- Règle décidée avec Jules-Antoine le 25 septembre : un élément déjà ACHETÉ n'est jamais supprimé -- refus avec un
-- message clair (HINT = code lisible par le Backstage), rien n'est effacé.
--   - morceau : présent dans un album acheté (achats de test de la bêta compris), ou portant des réglages/versions
--     de fans (album_track_settings / album_track_versions -- ON DELETE CASCADE les effacerait sinon en silence) ;
--   - pack : au moins un achat (pack_purchases.pack_id n'a pas de ON DELETE : la base refusait déjà, avec une
--     erreur de clé étrangère illisible pour un compositeur).

create or replace function public.delete_my_track(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_existing_owner uuid;
  v_has_fan_data boolean := false;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  select owner_id into v_existing_owner from public.tracks where id = p_id;
  if not found then return; end if;
  if v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : ce morceau appartient à un autre compositeur';
  end if;

  if exists (
    select 1 from public.album_tracks at
    join public.album_purchases ap on ap.album_id = at.album_id
    where at.track_id = p_id
  ) then
    raise exception 'Ce morceau fait partie d''un album déjà acheté : il ne peut pas être supprimé.'
      using hint = 'blocked_sold';
  end if;

  -- album_track_versions (20260925010000) peut ne pas encore exister en base : requêtes dynamiques gardées par
  -- to_regclass, pour que cette migration s'applique dans n'importe quel ordre.
  if to_regclass('public.album_track_settings') is not null then
    execute 'select exists (select 1 from public.album_track_settings where track_id = $1)' into v_has_fan_data using p_id;
  end if;
  if not v_has_fan_data and to_regclass('public.album_track_versions') is not null then
    execute 'select exists (select 1 from public.album_track_versions where track_id = $1)' into v_has_fan_data using p_id;
  end if;
  if v_has_fan_data then
    raise exception 'Des fans ont enregistré leurs réglages ou versions sur ce morceau : il ne peut pas être supprimé.'
      using hint = 'blocked_sold';
  end if;

  -- Cascade existante : emplacements, transitions, liens Sfx/packs/AdReels/albums (non achetés) du morceau.
  delete from public.tracks where id = p_id and owner_id = v_owner_id;
end;
$$;

create or replace function public.delete_my_pack(p_id text)
returns void
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
  select owner_id into v_existing_owner from public.packs where id = p_id;
  if not found then return; end if;
  if v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : ce pack appartient à un autre compositeur';
  end if;
  if exists (select 1 from public.pack_purchases where pack_id = p_id) then
    raise exception 'Ce pack a déjà été acheté : il ne peut pas être supprimé.'
      using hint = 'blocked_sold';
  end if;
  delete from public.packs where id = p_id and owner_id = v_owner_id;
end;
$$;

create or replace function public.delete_my_sfx(p_id text)
returns void
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
  if not found then return; end if;
  if v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : ce Sfx appartient à un autre compositeur';
  end if;
  delete from public.sfx_library where id = p_id and owner_id = v_owner_id;
end;
$$;

create or replace function public.delete_my_collection(p_id text)
returns void
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
  select owner_id into v_existing_owner from public.collections where id = p_id;
  if not found then return; end if;
  if v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : cette collection appartient à un autre compositeur';
  end if;
  delete from public.collections where id = p_id and owner_id = v_owner_id;
end;
$$;

-- ad_reels : id unique PAR compositeur (20260903120000) -- le couple (owner_id, id) suffit, pas de contrôle
-- d'appartenance séparé : un AdReel d'un autre compositeur portant le même id n'est simplement jamais touché.
create or replace function public.delete_my_ad_reel(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  delete from public.ad_reels where id = p_id and owner_id = v_owner_id;
end;
$$;

revoke execute on function public.delete_my_track(text) from public, anon;
revoke execute on function public.delete_my_pack(text) from public, anon;
revoke execute on function public.delete_my_sfx(text) from public, anon;
revoke execute on function public.delete_my_collection(text) from public, anon;
revoke execute on function public.delete_my_ad_reel(text) from public, anon;
grant execute on function public.delete_my_track(text) to authenticated;
grant execute on function public.delete_my_pack(text) to authenticated;
grant execute on function public.delete_my_sfx(text) to authenticated;
grant execute on function public.delete_my_collection(text) to authenticated;
grant execute on function public.delete_my_ad_reel(text) to authenticated;
