-- LayerPitch — Adaptive OST (étape A.7, 26/09/2026) : la version du compositeur devient obligatoire pour vendre.
--
-- Décision de Jules-Antoine (26/09) : un album a la version du compositeur de CHAQUE morceau avant d'être mis en vente,
-- pour que « Écouter l'album » ne saute jamais rien chez le fan (page fan mes-albums.html).
--   1. upsert_album : reprise à l'identique de 20260921080000, plus le contrôle final ci-dessous (album en vente = au
--      moins un morceau, et une prise « layerpitch-take » dans album_tracks.default_settings pour chacun).
--   2. set_album_track_default_settings : n'accepte plus qu'une prise valide de CE morceau (check_take, 20260925010000) --
--      il servait avant à des « réglages par défaut », remplacés le 25/09 par la prise du compositeur. Plus aucun moyen
--      d'effacer la version d'un morceau d'un album en vente.
-- Données existantes : rien n'est modifié. Un album déjà en vente sans toutes ses versions le reste jusqu'à sa prochaine
-- sauvegarde, qui sera alors refusée tant qu'il manque une version (ou qu'on ne le retire pas de la vente).
-- Verrous bêta (is_admin) inchangés : à retirer au lancement, comme prévu.

create or replace function public.upsert_album(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_album_id text := payload->>'id';
  v_seller_id uuid := auth.uid();
  v_composer_id uuid := public.current_composer_id();
  v_existing_seller uuid;
  -- has_trackIds distingue "le payload ne parle pas des pistes" de "le payload dit explicitement qu'il
  -- n'y en a plus" ([]) — sans ça, un appel partiel (ex. renommer) viderait silencieusement l'album.
  v_has_track_ids boolean := payload ? 'trackIds';
  v_track_ids text[];
  v_idx int := 0;
  v_id text;
begin
  if v_seller_id is null then
    raise exception 'Non autorisé : connexion requise';
  end if;
  -- VERROU BÊTA (21 septembre, décision de Jules-Antoine) : la fonction album n'est ouverte qu'aux
  -- comptes admin pour l'instant. À RETIRER quand les albums s'ouvrent aux compositeurs — même
  -- logique que le verrou « pack buyable » (20260907090000), un rappel de lancement à part entière.
  if not public.is_admin() then
    raise exception 'Non autorisé : la fonction album est réservée aux administrateurs pendant la bêta';
  end if;
  if v_composer_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte (la vente d''album côté studio n''est pas encore disponible)';
  end if;
  if v_album_id is null or v_album_id = '' then raise exception 'payload.id manquant'; end if;

  select seller_id into v_existing_seller from public.albums where id = v_album_id;
  if v_existing_seller is not null and v_existing_seller <> v_seller_id then
    raise exception 'Non autorisé : cet album appartient à un autre vendeur';
  end if;

  if v_has_track_ids then
    select coalesce(array_agg(t), array[]::text[]) into v_track_ids
    from jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb)) t;

    if array_length(v_track_ids, 1) > 0 then
      if exists (
        select 1 from unnest(v_track_ids) tid
        where not exists (select 1 from public.tracks tr where tr.id = tid and tr.owner_id = v_composer_id)
      ) then
        raise exception 'Non autorisé : une ou plusieurs pistes n''appartiennent pas à ce compositeur';
      end if;
    end if;
  end if;

  -- Les champs absents du payload ne sont jamais écrasés (un formulaire partiel ne doit pas effacer
  -- l'illustration, la présentation ou le prix réglés ailleurs). `title` reste toujours écrasé :
  -- une absence voudrait dire un titre vide, pas "ne pas toucher". Colonnes qualifiées `albums.` :
  -- "ambiguous column reference" sinon, `excluded` et la table cible étant toutes deux en portée.
  insert into public.albums (
    id, seller_id, seller_role, title, illustration, illustration_original_name,
    presentation_fr, presentation_en, price_usd_cents, buyable, updated_at
  )
  values (
    v_album_id, v_seller_id, 'composer', coalesce(payload->>'title', ''), payload->>'illustration',
    payload->>'illustrationOriginalName', coalesce(payload->>'presentationFr', ''),
    coalesce(payload->>'presentationEn', ''), (payload->>'priceUsdCents')::int,
    coalesce((payload->>'buyable')::boolean, false), now()
  )
  on conflict (id) do update set
    title = excluded.title,
    illustration = coalesce(excluded.illustration, albums.illustration),
    illustration_original_name = coalesce(excluded.illustration_original_name, albums.illustration_original_name),
    presentation_fr = case when payload ? 'presentationFr' then excluded.presentation_fr else albums.presentation_fr end,
    presentation_en = case when payload ? 'presentationEn' then excluded.presentation_en else albums.presentation_en end,
    price_usd_cents = case when payload ? 'priceUsdCents' then excluded.price_usd_cents else albums.price_usd_cents end,
    buyable = case when payload ? 'buyable' then excluded.buyable else albums.buyable end,
    updated_at = now();

  -- Un album mis en vente doit avoir un prix minimum (0 est valide : prix libre pur). Vérifié APRÈS
  -- fusion avec l'existant, pour couvrir aussi un payload qui n'envoie que `buyable`. L'exception
  -- annule toute la transaction.
  if exists (select 1 from public.albums where id = v_album_id and buyable and price_usd_cents is null) then
    raise exception 'Un album mis en vente doit avoir un prix minimum (0 autorisé)';
  end if;

  if v_has_track_ids then
    -- Retire seulement les pistes qui ne font plus partie de l'album — pas un delete-all suivi d'un
    -- réinsert complet, qui effacerait les réglages par défaut par piste (album_tracks.default_settings,
    -- à venir) même pour une piste qui reste entre deux sauvegardes.
    delete from public.album_tracks
    where album_id = v_album_id and track_id <> all(v_track_ids);

    v_idx := 0;
    for v_id in select unnest(v_track_ids)
    loop
      insert into public.album_tracks (album_id, track_id, position) values (v_album_id, v_id, v_idx)
      on conflict (album_id, track_id) do update set position = excluded.position;
      v_idx := v_idx + 1;
    end loop;
  end if;

  -- Vente (26/09, décision de Jules-Antoine) : un album en vente doit avoir au moins un morceau, et CHAQUE morceau sa
  -- version du compositeur (sa prise, album_tracks.default_settings) -- sinon « Écouter l'album » sauterait des morceaux
  -- chez le fan. Vérifié après la mise à jour des pistes, pour couvrir aussi un morceau ajouté à un album déjà en vente.
  if exists (select 1 from public.albums where id = v_album_id and buyable) then
    if not exists (select 1 from public.album_tracks where album_id = v_album_id) then
      raise exception 'Un album mis en vente doit contenir au moins un morceau';
    end if;
    if exists (select 1 from public.album_tracks where album_id = v_album_id
               and (default_settings->>'kind') is distinct from 'layerpitch-take') then
      raise exception 'Un album mis en vente doit avoir la version du compositeur de chaque morceau';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_album_id);
end;
$$;

revoke all on function public.upsert_album(jsonb) from public, anon;
grant execute on function public.upsert_album(jsonb) to authenticated;

create or replace function public.set_album_track_default_settings(p_album_id text, p_track_id text, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  -- VERROU BÊTA, jumeau de celui d'upsert_album (à retirer au même moment).
  if not public.is_admin() then
    raise exception 'Non autorisé : la fonction album est réservée aux administrateurs pendant la bêta';
  end if;
  -- Version du compositeur = une prise de CE morceau (même contrôle que les versions du fan).
  perform public.check_take(p_settings, p_track_id);
  update public.album_tracks at
  set default_settings = p_settings
  where at.album_id = p_album_id and at.track_id = p_track_id
    and exists (select 1 from public.albums a where a.id = at.album_id and a.seller_id = auth.uid());
  if not found then
    raise exception 'Non autorisé : morceau introuvable dans cet album, ou album appartenant à un autre vendeur';
  end if;
end;
$$;

revoke all on function public.set_album_track_default_settings(text, text, jsonb) from public, anon;
grant execute on function public.set_album_track_default_settings(text, text, jsonb) to authenticated;
