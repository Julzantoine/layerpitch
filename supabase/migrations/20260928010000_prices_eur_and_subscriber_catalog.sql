-- LayerPitch — chantier profils et permissions, étape 2a (28 septembre) : tout en euros (D30), grille de prix des
-- packs (D31), catalogue abonnés (D15). Référence : layerpitch-docs/2026-09-27-cadrage-profils-permissions.md.
--
-- 1. packs.price_usd_cents -> price_eur_cents, albums.price_usd_cents -> price_eur_cents. Les montants sont repris
--    tels quels en euros (bêta : ventes factices), puis les prix de packs hors grille sont ramenés au palier le plus
--    proche (les 9,99 posés le 31/08 deviennent 10 €).
-- 2. Grille de prix d'un pack (D31) : 0 € (gratuit) ; 1 à 100 € par pas de 1 € ; 110 à 200 € par pas de 10 € ;
--    250 à 500 € par pas de 50 €. Contrainte en base + contrôle dans upsert_pack (message clair).
-- 3. packs.subscriber_credits : NULL = hors catalogue abonnés ; 1, 2 ou 4 crédits (1 crédit = 10 €, D31). Un pack
--    gratuit n'entre pas dans le catalogue. Réglable seulement si la matrice l'accorde (feu vert subscriber_catalog :
--    admin seulement pour l'instant) ; sinon la valeur existante est conservée, comme pour « en vente ».
-- 4. upsert_pack : réglage du prix et des crédits ; « en vente » passe par la matrice (sell_packs) au lieu d'un test
--    is_admin() écrit en dur — même effet aujourd'hui (feu vert fermé = admin seulement).
-- 5. upsert_album : colonne en euros, clé priceEurCents, verrou bêta porté par la matrice (sell_albums).
-- 6. i_can(fonction) : raccourci « le compte connecté a-t-il droit à cette fonction ? » pour les RPC.
-- Code à déployer avec : Backstage, pack.html, api/packs.js, api/albums.js, Edge Functions create-checkout-session
-- (devise 'eur') et stripe-webhook (factures en €).

create or replace function public.i_can(p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select e.allowed from public.entitlement(auth.uid(), p_feature, false) e), false);
$$;
revoke execute on function public.i_can(text) from public, anon, authenticated;
grant execute on function public.i_can(text) to service_role;

-- ---- 1. Euros ----
alter table public.packs rename column price_usd_cents to price_eur_cents;
alter table public.albums rename column price_usd_cents to price_eur_cents;
alter table public.albums rename constraint albums_price_usd_cents_nonneg to albums_price_eur_cents_nonneg;
comment on column public.albums.price_eur_cents is 'Prix MINIMUM en centimes d''euro (prix libre : le fan peut payer davantage). NULL = pas de prix fixé.';

-- ---- 2. Grille de prix des packs ----
create or replace function public.is_valid_pack_price(p_cents int)
returns boolean
language sql
immutable
as $$
  select p_cents is null
      or p_cents = 0
      or (p_cents between 100 and 10000 and p_cents % 100 = 0)
      or (p_cents between 11000 and 20000 and p_cents % 1000 = 0)
      or (p_cents between 25000 and 50000 and p_cents % 5000 = 0);
$$;

update public.packs set price_eur_cents = case
    when price_eur_cents <= 0 then 0
    when price_eur_cents < 10500 then least(10000, greatest(100, round(price_eur_cents / 100.0) * 100))
    when price_eur_cents <= 22500 then least(20000, greatest(11000, round(price_eur_cents / 1000.0) * 1000))
    else least(50000, greatest(25000, round(price_eur_cents / 5000.0) * 5000))
  end
where not public.is_valid_pack_price(price_eur_cents);

alter table public.packs add constraint packs_price_eur_cents_grid check (public.is_valid_pack_price(price_eur_cents));
comment on column public.packs.price_eur_cents is 'Prix à l''unité en centimes d''euro, choisi dans la grille (is_valid_pack_price) : 0, 1-100 € par 1 €, 110-200 € par 10 €, 250-500 € par 50 €. NULL = pas de prix.';

-- ---- 3. Catalogue abonnés ----
alter table public.packs add column subscriber_credits int check (subscriber_credits in (1, 2, 4));
alter table public.packs add constraint packs_free_not_in_subscriber_catalog
  check (subscriber_credits is null or coalesce(price_eur_cents, 0) > 0);
comment on column public.packs.subscriber_credits is 'Coût du pack dans le catalogue abonnés (1, 2 ou 4 crédits ; 1 crédit = 10 € pour le compositeur). NULL = hors catalogue. Interdit pour un pack gratuit.';

-- ---- 4. upsert_pack ----
create or replace function public.upsert_pack(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack_id text := payload->>'id';
  v_owner_id uuid := public.current_composer_id();
  v_existing_owner uuid;
  -- « En vente » et catalogue abonnés : droits lus dans la matrice (28/09), plus un test is_admin() en dur.
  v_can_sell boolean := public.i_can('sell_packs');
  v_can_catalog boolean := public.i_can('subscriber_catalog');
  v_price int;
  v_credits int;
  v_idx int;
  v_id text;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_pack_id is null or v_pack_id = '' then raise exception 'payload.id manquant'; end if;

  select owner_id into v_existing_owner from public.packs where id = v_pack_id;
  if v_existing_owner is not null and v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : ce pack appartient à un autre compositeur';
  end if;
  -- Prix (grille D31) et crédits (D15/D31) : seulement si le payload en parle ; sinon on garde l'existant.
  if payload ? 'priceEurCents' then
    v_price := (payload->>'priceEurCents')::int;
    if not public.is_valid_pack_price(v_price) then
      raise exception 'Prix hors grille : 0 €, 1 à 100 € par 1 €, 110 à 200 € par 10 €, 250 à 500 € par 50 €';
    end if;
  end if;
  if payload ? 'subscriberCredits' then
    v_credits := (payload->>'subscriberCredits')::int;
    if v_credits is not null and v_credits not in (1, 2, 4) then
      raise exception 'Coût en crédits : 1, 2 ou 4';
    end if;
  end if;

  -- Valeurs FINALES (payload fusionné avec l'existant) : utilisées telles quelles à l'insertion ET à la mise à jour,
  -- car Postgres vérifie les contraintes de table sur la ligne proposée avant même de détecter le conflit.
  v_price := case when payload ? 'priceEurCents' then v_price
                  else (select p.price_eur_cents from public.packs p where p.id = v_pack_id) end;
  v_credits := case when v_can_catalog and payload ? 'subscriberCredits' then v_credits
                    else (select p.subscriber_credits from public.packs p where p.id = v_pack_id) end;
  -- Garde-fou lisible (la contrainte packs_free_not_in_subscriber_catalog le double).
  if v_credits is not null and coalesce(v_price, 0) = 0 then
    raise exception 'Un pack gratuit ne peut pas entrer dans le catalogue abonnés';
  end if;

  perform public.assert_refs_owned('tracks', (select coalesce(array_agg(x), array[]::text[]) from jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb)) x), v_owner_id, 'morceau');
  perform public.assert_refs_owned('sfx_library', (select coalesce(array_agg(x), array[]::text[]) from jsonb_array_elements_text(coalesce(payload->'sfxIds', '[]'::jsonb)) x), v_owner_id, 'Sfx');

  insert into public.packs (id, owner_id, title, illustration, illustration_original_name, watermark,
    watermark_original_name, presentation_fr, presentation_en, buyable, buy_url,
    free_download_enabled, video_test_mode_enabled, bg_color, text_color, font, linked_ad_reel_id, tags,
    price_eur_cents, subscriber_credits, updated_at)
  values (
    v_pack_id, v_owner_id, coalesce(payload->>'title',''), payload->>'illustration', payload->>'illustrationOriginalName',
    payload->>'watermark', payload->>'watermarkOriginalName', coalesce(payload->>'presentationFr',''),
    coalesce(payload->>'presentationEn',''),
    case when v_can_sell then coalesce((payload->>'buyable')::boolean,false) else false end,
    coalesce(payload->>'buyUrl',''), coalesce((payload->>'freeDownloadEnabled')::boolean,false),
    coalesce((payload->>'videoTestModeEnabled')::boolean,false), payload->>'bgColor', payload->>'textColor',
    payload->>'font', nullif(payload->>'linkedAdReelId',''),
    coalesce((select array_agg(t) from jsonb_array_elements_text(coalesce(payload->'tags','[]'::jsonb)) t), '{}'),
    v_price, v_credits,
    now()
  )
  on conflict (id) do update set
    title = excluded.title, illustration = excluded.illustration,
    illustration_original_name = excluded.illustration_original_name, watermark = excluded.watermark,
    watermark_original_name = excluded.watermark_original_name, presentation_fr = excluded.presentation_fr,
    presentation_en = excluded.presentation_en,
    buyable = case when v_can_sell then excluded.buyable else public.packs.buyable end,
    price_eur_cents = excluded.price_eur_cents, subscriber_credits = excluded.subscriber_credits,
    buy_url = excluded.buy_url,
    free_download_enabled = excluded.free_download_enabled, video_test_mode_enabled = excluded.video_test_mode_enabled,
    bg_color = excluded.bg_color, text_color = excluded.text_color, font = excluded.font,
    linked_ad_reel_id = excluded.linked_ad_reel_id, tags = excluded.tags, updated_at = now();

  delete from public.pack_tracks where pack_id = v_pack_id;
  delete from public.pack_sfx where pack_id = v_pack_id;

  v_idx := 0;
  for v_id in select jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb))
  loop
    insert into public.pack_tracks (pack_id, track_id, position) values (v_pack_id, v_id, v_idx);
    v_idx := v_idx + 1;
  end loop;
  v_idx := 0;
  for v_id in select jsonb_array_elements_text(coalesce(payload->'sfxIds', '[]'::jsonb))
  loop
    insert into public.pack_sfx (pack_id, sfx_id, position) values (v_pack_id, v_id, v_idx);
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_pack_id);
end;
$$;

-- ---- 5. upsert_album ----
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
  v_kept text[] := array[]::text[];
begin
  if v_seller_id is null then
    raise exception 'Non autorisé : connexion requise';
  end if;
  -- VERROU BÊTA (21/09) désormais porté par la matrice (28/09) : fonction sell_albums, feu vert 'sell_albums'.
  -- Tant que le feu vert est fermé, seul l'admin passe ; l'ouvrir (set_feature_released) suffit au lancement.
  if not public.i_can('sell_albums') then
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
    presentation_fr, presentation_en, price_eur_cents, buyable, updated_at
  )
  values (
    v_album_id, v_seller_id, 'composer', coalesce(payload->>'title', ''), payload->>'illustration',
    payload->>'illustrationOriginalName', coalesce(payload->>'presentationFr', ''),
    coalesce(payload->>'presentationEn', ''), (payload->>'priceEurCents')::int,
    coalesce((payload->>'buyable')::boolean, false), now()
  )
  on conflict (id) do update set
    title = excluded.title,
    illustration = coalesce(excluded.illustration, albums.illustration),
    illustration_original_name = coalesce(excluded.illustration_original_name, albums.illustration_original_name),
    presentation_fr = case when payload ? 'presentationFr' then excluded.presentation_fr else albums.presentation_fr end,
    presentation_en = case when payload ? 'presentationEn' then excluded.presentation_en else albums.presentation_en end,
    price_eur_cents = case when payload ? 'priceEurCents' then excluded.price_eur_cents else albums.price_eur_cents end,
    buyable = case when payload ? 'buyable' then excluded.buyable else albums.buyable end,
    updated_at = now();

  -- Un album mis en vente doit avoir un prix minimum (0 est valide : prix libre pur). Vérifié APRÈS
  -- fusion avec l'existant, pour couvrir aussi un payload qui n'envoie que `buyable`. L'exception
  -- annule toute la transaction.
  if exists (select 1 from public.albums where id = v_album_id and buyable and price_eur_cents is null) then
    raise exception 'Un album mis en vente doit avoir un prix minimum (0 autorisé)';
  end if;

  if v_has_track_ids then
    -- Retire seulement les pistes qui ne font plus partie de l'album — pas un delete-all suivi d'un
    -- réinsert complet, qui effacerait les réglages par défaut par piste (album_tracks.default_settings,
    -- à venir) même pour une piste qui reste entre deux sauvegardes.
    -- Morceau décoché (27/09, décision de Jules-Antoine) : si l'album a déjà été obtenu, la ligne reste, marquée
    -- retirée -- ceux qui l'ont obtenu avant gardent le morceau (versions, playlists), les futurs acheteurs ne l'ont pas.
    -- Sinon, suppression comme avant.
    if exists (select 1 from public.album_purchases where album_id = v_album_id) then
      with k as (
        update public.album_tracks set removed_at = now()
        where album_id = v_album_id and track_id <> all(v_track_ids) and removed_at is null
        returning track_id
      ) select coalesce(array_agg(track_id), array[]::text[]) into v_kept from k;
    else
      delete from public.album_tracks
      where album_id = v_album_id and track_id <> all(v_track_ids);
    end if;

    v_idx := 0;
    for v_id in select unnest(v_track_ids)
    loop
      insert into public.album_tracks (album_id, track_id, position) values (v_album_id, v_id, v_idx)
      on conflict (album_id, track_id) do update set position = excluded.position, removed_at = null; -- recoché : de retour pour tous
      v_idx := v_idx + 1;
    end loop;
  end if;

  -- Vente (26/09, décision de Jules-Antoine) : un album en vente doit avoir au moins un morceau, et CHAQUE morceau sa
  -- version du compositeur (sa prise, album_tracks.default_settings) -- sinon « Écouter l'album » sauterait des morceaux
  -- chez le fan. Vérifié après la mise à jour des pistes, pour couvrir aussi un morceau ajouté à un album déjà en vente.
  if exists (select 1 from public.albums where id = v_album_id and buyable) then
    if not exists (select 1 from public.album_tracks where album_id = v_album_id and removed_at is null) then
      raise exception 'Un album mis en vente doit contenir au moins un morceau';
    end if;
    if exists (select 1 from public.album_tracks where album_id = v_album_id and removed_at is null
               and (default_settings->>'kind') is distinct from 'layerpitch-take') then
      raise exception 'Un album mis en vente doit avoir la version du compositeur de chaque morceau';
    end if;
  end if;

  -- keptForBuyers : morceaux retirés à l'instant mais gardés pour les acheteurs existants (message au compositeur).
  return jsonb_build_object('ok', true, 'id', v_album_id, 'keptForBuyers', to_jsonb(v_kept));
end;
$$;
