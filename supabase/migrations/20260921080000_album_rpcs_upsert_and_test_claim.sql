-- LayerPitch — vente d'Adaptive OST : les deux RPC dont dépend tout le reste (backstage compositeur,
-- bibliothèque fan). Suite de 20260921070000_albums_seller_model.sql.
--
-- upsert_album est repris de la branche claude/adaptive-ost-architecture-sy68is (20260910140000), adapté
-- au modèle vendeur et étendu au prix/vente. La branche d'origine ne sera PAS fusionnée telle quelle
-- (75 commits de retard sur main) : son socle est ramené morceau par morceau.

-- ============================================================================
-- upsert_album — créer / modifier un album
-- ============================================================================
-- Même convention que upsert_track/upsert_pack : create -> le compte appelant devient vendeur ;
-- update -> seller_id doit correspondre à l'appelant ; seller_id et seller_role ne changent jamais.
--
-- Vendeur = COMPOSITEUR uniquement pour l'instant : le compte doit avoir un composer_profile, et les
-- pistes doivent lui appartenir. Le côté studio (quelles pistes un studio peut placer dans son album ?
-- — probablement celles d'un pack exclusif acheté, ou d'un Projet) n'est pas tranché : on refuse
-- explicitement plutôt que d'inventer une règle.
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

  return jsonb_build_object('ok', true, 'id', v_album_id);
end;
$$;

revoke all on function public.upsert_album(jsonb) from public, anon;
grant execute on function public.upsert_album(jsonb) to authenticated;

-- ============================================================================
-- claim_test_album — achat factice de la bêta (aucun Stripe)
-- ============================================================================
-- Permet aux testeurs d'éprouver tout le parcours (créer, publier, posséder, régler, Figer) sans que
-- le paiement soit câblé. Garde-fous :
--  - interrupteur SERVEUR platform_flags.test_purchases_enabled (à couper au lancement public) ;
--  - l'album doit être en vente (buyable), comme pour un vrai achat ;
--  - is_test = true sur la ligne créée, pour ne jamais la confondre avec un revenu réel ;
--  - idempotent : réclamer deux fois le même album ne crée pas de doublon.
create or replace function public.claim_test_album(p_album_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer uuid := auth.uid();
  v_buyable boolean;
begin
  if v_buyer is null then
    raise exception 'Non autorisé : connexion requise';
  end if;
  if not coalesce((select test_purchases_enabled from public.platform_flags where id), false) then
    raise exception 'Les achats de test ne sont plus disponibles';
  end if;

  select buyable into v_buyable from public.albums where id = p_album_id;
  if not found then raise exception 'Album introuvable'; end if;
  if not v_buyable then raise exception 'Cet album n''est pas en vente'; end if;

  if exists (select 1 from public.album_purchases where buyer_id = v_buyer and album_id = p_album_id) then
    return jsonb_build_object('ok', true, 'albumId', p_album_id, 'alreadyOwned', true);
  end if;

  insert into public.album_purchases (buyer_id, album_id, price_paid, is_test)
  values (v_buyer, p_album_id, 0, true);

  return jsonb_build_object('ok', true, 'albumId', p_album_id, 'alreadyOwned', false);
end;
$$;

revoke all on function public.claim_test_album(text) from public, anon;
grant execute on function public.claim_test_album(text) to authenticated;
