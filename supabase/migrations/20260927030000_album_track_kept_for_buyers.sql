-- LayerPitch — Adaptive OST : un morceau retiré d'un album déjà obtenu reste pour ceux qui l'ont obtenu.
--
-- Décision de Jules-Antoine (27/09) : le compositeur décoche un morceau d'un album et enregistre. Si personne n'a encore
-- obtenu l'album, le morceau en sort comme avant. Sinon, il est seulement marqué retiré (album_tracks.removed_at) :
--   - ceux qui ont obtenu l'album AVANT le retrait le gardent (écoute, atelier, versions, playlists, téléchargement) ;
--   - les futurs acheteurs ne l'ont pas ; il ne compte plus dans la règle de mise en vente (20260926020000) ;
--   - recoché plus tard, il revient pour tout le monde ;
--   - upsert_album renvoie keptForBuyers (morceaux retirés à l'instant mais gardés) : le Backstage l'annonce au compositeur.
-- Fonctions reprises à l'identique de leur dernière version, plus le filtre album_track_visible_to_me :
-- upsert_album (20260926020000), get_my_album_versions et save_my_track_version (20260925010000),
-- get_my_album_settings et set_my_album_track_settings (20260921090000), get_my_playlists et add_to_my_playlist
-- (20260926030000). Le morceau reste aussi « gardé pour les fans » s'il est supprimé du catalogue (20260927020000 :
-- sa ligne album_tracks existe toujours).

alter table public.album_tracks add column if not exists removed_at timestamptz;
comment on column public.album_tracks.removed_at is 'Retiré de l''album par le vendeur après que l''album a été obtenu : gardé pour ceux qui l''ont obtenu avant cette date, absent pour les suivants (27/09).';

-- Un morceau d'album est visible pour le compte appelant s'il fait partie de l'album, ou s'il en a été retiré APRÈS que
-- ce compte a obtenu l'album.
create or replace function public.album_track_visible_to_me(p_album_id text, p_track_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.album_tracks at
    where at.album_id = p_album_id and at.track_id = p_track_id
      and (at.removed_at is null or exists (
        select 1 from public.album_purchases ap
        where ap.buyer_id = auth.uid() and ap.album_id = at.album_id and ap.purchased_at < at.removed_at))
  );
$$;

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

create or replace function public.get_my_album_versions(p_album_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not public.owns_album(p_album_id) then raise exception 'Non autorisé : tu ne possèdes pas cet album'; end if;
  return jsonb_build_object(
    'tracks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'trackId', at.track_id, 'position', at.position,
        'official', case when at.default_settings->>'kind' = 'layerpitch-take' then at.default_settings else null end
      ) order by at.position), '[]'::jsonb)
      from public.album_tracks at where at.album_id = p_album_id and public.album_track_visible_to_me(at.album_id, at.track_id)
    ),
    'versions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'trackId', v.track_id, 'name', v.name, 'take', v.take, 'createdAt', v.created_at
      ) order by v.created_at desc), '[]'::jsonb)
      from public.album_track_versions v where v.buyer_id = auth.uid() and v.album_id = p_album_id and public.album_track_visible_to_me(v.album_id, v.track_id)
    )
  );
end;
$$;

create or replace function public.save_my_track_version(p_album_id text, p_track_id text, p_name text, p_take jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not public.owns_album(p_album_id) then raise exception 'Non autorisé : tu ne possèdes pas cet album'; end if;
  if not public.album_track_visible_to_me(p_album_id, p_track_id) then
    raise exception 'Ce morceau ne fait pas partie de cet album';
  end if;
  perform public.check_take(p_take, p_track_id);
  insert into public.album_track_versions (buyer_id, album_id, track_id, name, take)
  values (auth.uid(), p_album_id, p_track_id, left(coalesce(trim(p_name), ''), 120), p_take)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.get_my_album_settings(p_album_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not public.owns_album(p_album_id) then
    raise exception 'Non autorisé : tu ne possèdes pas cet album';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'trackId', at.track_id,
      'position', at.position,
      'settings', coalesce(s.settings, at.default_settings),
      'isCustom', s.settings is not null
    ) order by at.position), '[]'::jsonb)
    from public.album_tracks at
    left join public.album_track_settings s
      on s.buyer_id = auth.uid() and s.album_id = at.album_id and s.track_id = at.track_id
    where at.album_id = p_album_id and public.album_track_visible_to_me(at.album_id, at.track_id)
  );
end;
$$;

create or replace function public.set_my_album_track_settings(p_album_id text, p_track_id text, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not public.owns_album(p_album_id) then
    raise exception 'Non autorisé : tu ne possèdes pas cet album';
  end if;
  if not public.album_track_visible_to_me(p_album_id, p_track_id) then
    raise exception 'Ce morceau ne fait pas partie de cet album';
  end if;
  insert into public.album_track_settings (buyer_id, album_id, track_id, settings, updated_at)
  values (auth.uid(), p_album_id, p_track_id, coalesce(p_settings, '{}'::jsonb), now())
  on conflict (buyer_id, album_id, track_id) do update
    set settings = excluded.settings, updated_at = now();
end;
$$;

create or replace function public.get_my_playlists()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'createdAt', p.created_at, 'updatedAt', p.updated_at,
      'items', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', i.id, 'albumId', i.album_id, 'trackId', i.track_id, 'versionId', i.version_id, 'addedAt', i.added_at
        ) order by i.position, i.added_at), '[]'::jsonb)
        from public.playlist_items i
        where i.playlist_id = p.id and public.owns_album(i.album_id) and public.album_track_visible_to_me(i.album_id, i.track_id)
      )
    ) order by p.created_at), '[]'::jsonb)
    from public.playlists p where p.buyer_id = auth.uid()
  );
end;
$$;

create or replace function public.add_to_my_playlist(p_playlist_id uuid, p_album_id text, p_track_id text, p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public.check_my_playlist(p_playlist_id);
  if not public.owns_album(p_album_id) then raise exception 'Non autorisé : tu ne possèdes pas cet album'; end if;
  if not public.album_track_visible_to_me(p_album_id, p_track_id) then raise exception 'Ce morceau ne fait pas partie de cet album'; end if;
  if p_version_id is null then
    if not exists (select 1 from public.album_tracks where album_id = p_album_id and track_id = p_track_id
                   and default_settings->>'kind' = 'layerpitch-take') then
      raise exception 'Ce morceau n''a pas de version du compositeur';
    end if;
  elsif not exists (select 1 from public.album_track_versions where id = p_version_id and buyer_id = auth.uid()
                    and album_id = p_album_id and track_id = p_track_id) then
    raise exception 'Version introuvable';
  end if;
  if (select count(*) from public.playlist_items where playlist_id = p_playlist_id) >= 500 then
    raise exception 'Playlist pleine (500 morceaux au maximum)';
  end if;
  insert into public.playlist_items (playlist_id, position, album_id, track_id, version_id)
  values (p_playlist_id, coalesce((select max(position) + 1 from public.playlist_items where playlist_id = p_playlist_id), 0),
          p_album_id, p_track_id, p_version_id)
  returning id into v_id;
  update public.playlists set updated_at = now() where id = p_playlist_id;
  return v_id;
end;
$$;

revoke all on function public.album_track_visible_to_me(text, text) from public, anon, authenticated;
