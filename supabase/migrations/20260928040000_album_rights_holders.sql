-- LayerPitch — chantier profils et permissions, étape 4a (28 septembre) : co-ayants droit d'un album (D4, D5, D6 du
-- cadrage layerpitch-docs/2026-09-27-cadrage-profils-permissions.md).
--
-- À la mise en vente, le vendeur (compositeur OU studio) déclare s'il est seul propriétaire ou s'il partage les droits.
-- Partagé : il indique chaque co-ayant droit (e-mail + part) et reconnaît l'avertissement (répartition à négocier entre
-- ayants droit, LayerPitch non responsable). Chaque co-ayant droit est invité par e-mail (Edge Function
-- invite-rights-holder), crée son compte si besoin, puis ACCEPTE ou REFUSE sa part, en choisissant la casquette qui
-- reçoit l'argent (compositeur ou studio).
--   * accepté -> partage automatique à chaque vente (étape 4b : paiement puis transferts séparés Stripe) ;
--   * injoignable -> le vendeur peut choisir « je reverse moi-même sa part » (self_pay) : la vente ouvre, tout l'argent
--     va au vendeur ; si le co-ayant droit accepte plus tard, les ventes suivantes sont partagées ;
--   * refusé -> vente bloquée (et retirée de la vente si elle était ouverte) jusqu'à une nouvelle répartition acceptée.
-- Aucune mise de côté d'argent par LayerPitch (D5).
-- Parts en points de base (1/100 de %) : 3000 = 30 %. La part du vendeur = le reste.

alter table public.albums
  add column rights_declaration text not null default 'sole' check (rights_declaration in ('sole', 'shared')),
  add column rights_ack_at timestamptz;
comment on column public.albums.rights_declaration is 'sole = le vendeur est seul propriétaire ; shared = droits partagés avec les lignes de album_rights_holders (D4-D6).';
comment on column public.albums.rights_ack_at is 'Moment où le vendeur a reconnu l''avertissement : répartition à négocier entre ayants droit, LayerPitch non responsable d''erreurs.';

create table public.album_rights_holders (
  id uuid primary key default gen_random_uuid(),
  album_id text not null references public.albums(id) on delete cascade,
  holder_email text not null,
  holder_profile_id uuid references public.profiles(id) on delete set null,
  payout_role text check (payout_role in ('composer', 'studio')),
  share_bps int not null check (share_bps between 1 and 9999),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'refused', 'self_pay')),
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (album_id, holder_email)
);
create index album_rights_holders_email_idx on public.album_rights_holders (lower(holder_email));
alter table public.album_rights_holders enable row level security;
-- Aucune politique : lecture et écriture uniquement par les RPC ci-dessous.

create or replace function public.album_rights_settled(p_album_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when a.rights_declaration = 'sole' then true
              else exists (select 1 from public.album_rights_holders h where h.album_id = a.id)
                   and not exists (select 1 from public.album_rights_holders h where h.album_id = a.id and h.status in ('pending', 'refused'))
         end
  from public.albums a where a.id = p_album_id;
$$;

-- Le compte connecté peut-il vendre cet album (vendeur + droit de la matrice selon la casquette) ?
create or replace function public.assert_album_seller(p_album_id text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text;
begin
  select seller_role into v_role from public.albums where id = p_album_id and seller_id = auth.uid();
  if v_role is null then raise exception 'Non autorisé : cet album appartient à un autre vendeur'; end if;
  if not public.i_can(case v_role when 'studio' then 'studio_sell_albums' else 'sell_albums' end) then
    raise exception 'Non autorisé : la vente d''album n''est pas ouverte pour ce compte';
  end if;
end;
$$;

create or replace function public.album_rights_json(p_album_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'declaration', a.rights_declaration, 'ackAt', a.rights_ack_at, 'settled', public.album_rights_settled(a.id),
    'sellerShareBps', 10000 - coalesce((select sum(h.share_bps) from public.album_rights_holders h where h.album_id = a.id), 0),
    'holders', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'email', h.holder_email, 'shareBps', h.share_bps,
        'status', h.status, 'payoutRole', h.payout_role, 'invitedAt', h.invited_at, 'respondedAt', h.responded_at,
        'hasAccount', h.holder_profile_id is not null or exists (select 1 from auth.users u where lower(u.email) = lower(h.holder_email)))
        order by h.invited_at) from public.album_rights_holders h where h.album_id = a.id), '[]'::jsonb))
  from public.albums a where a.id = p_album_id;
$$;

-- p_holders : [{ email, shareBps }]. Renvoie l'état + les ids à inviter (nouveaux ou part modifiée).
create or replace function public.set_album_rights(p_album_id text, p_declaration text, p_holders jsonb, p_ack boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_email text := (select lower(email) from auth.users where id = auth.uid());
  v_h jsonb;
  v_email text;
  v_share int;
  v_total int := 0;
  v_emails text[] := array[]::text[];
  v_to_invite uuid[] := array[]::uuid[];
  v_id uuid;
  v_unlisted boolean := false;
  r record;
begin
  perform public.assert_album_seller(p_album_id);
  if p_declaration not in ('sole', 'shared') then raise exception 'Déclaration attendue : sole ou shared'; end if;

  if p_declaration = 'sole' then
    delete from public.album_rights_holders where album_id = p_album_id;
    update public.albums set rights_declaration = 'sole', rights_ack_at = null where id = p_album_id;
    return public.album_rights_json(p_album_id) || jsonb_build_object('toInvite', '[]'::jsonb, 'unlisted', false);
  end if;

  if not coalesce(p_ack, false) then
    raise exception 'Merci de reconnaître l''avertissement : la répartition se négocie entre ayants droit' using hint = 'ack';
  end if;
  if jsonb_typeof(p_holders) <> 'array' or jsonb_array_length(p_holders) = 0 then
    raise exception 'Indique au moins un co-ayant droit';
  end if;
  for v_h in select * from jsonb_array_elements(p_holders) loop
    v_email := lower(trim(coalesce(v_h->>'email', '')));
    v_share := (v_h->>'shareBps')::int;
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresse e-mail invalide : %', v_email; end if;
    if v_email = v_seller_email then raise exception 'Tu ne peux pas être ton propre co-ayant droit'; end if;
    if v_email = any(v_emails) then raise exception 'Adresse en double : %', v_email; end if;
    if v_share is null or v_share < 1 or v_share > 9999 then raise exception 'Part invalide pour % (entre 0,01 %% et 99,99 %%)', v_email; end if;
    v_emails := v_emails || v_email;
    v_total := v_total + v_share;
  end loop;
  if v_total >= 10000 then raise exception 'La somme des parts des co-ayants droit doit laisser une part au vendeur (moins de 100 %%)'; end if;

  delete from public.album_rights_holders where album_id = p_album_id and lower(holder_email) <> all(v_emails);
  for v_h in select * from jsonb_array_elements(p_holders) loop
    v_email := lower(trim(v_h->>'email'));
    v_share := (v_h->>'shareBps')::int;
    select * into r from public.album_rights_holders where album_id = p_album_id and lower(holder_email) = v_email;
    if not found then
      insert into public.album_rights_holders (album_id, holder_email, share_bps) values (p_album_id, v_email, v_share) returning id into v_id;
      v_to_invite := v_to_invite || v_id;
    elsif r.share_bps <> v_share then
      -- Nouvelle part = nouvelle proposition : à valider de nouveau, quel que soit l'état précédent.
      update public.album_rights_holders set share_bps = v_share, status = 'pending', invited_at = now(), responded_at = null where id = r.id;
      v_to_invite := v_to_invite || r.id;
    end if;
  end loop;
  update public.albums set rights_declaration = 'shared', rights_ack_at = now() where id = p_album_id;

  if exists (select 1 from public.albums where id = p_album_id and buyable) and not public.album_rights_settled(p_album_id) then
    update public.albums set buyable = false where id = p_album_id;
    v_unlisted := true;
  end if;
  return public.album_rights_json(p_album_id) || jsonb_build_object('toInvite', to_jsonb(v_to_invite), 'unlisted', v_unlisted);
end;
$$;

create or replace function public.list_album_rights(p_album_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.albums where id = p_album_id and seller_id = auth.uid()) then
    raise exception 'Non autorisé : cet album appartient à un autre vendeur';
  end if;
  return public.album_rights_json(p_album_id);
end;
$$;

-- Co-ayant droit injoignable : le vendeur lui reversera sa part lui-même (D5). Jamais après un refus.
create or replace function public.mark_rights_holder_self_pay(p_holder_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_album text; v_status text;
begin
  select album_id, status into v_album, v_status from public.album_rights_holders where id = p_holder_id;
  if v_album is null then raise exception 'Co-ayant droit introuvable'; end if;
  perform public.assert_album_seller(v_album);
  if v_status <> 'pending' then
    raise exception 'Seul un co-ayant droit qui n''a pas encore répondu peut être réglé par toi-même (un refus bloque la vente)';
  end if;
  update public.album_rights_holders set status = 'self_pay', responded_at = now() where id = p_holder_id;
  return public.album_rights_json(v_album);
end;
$$;

-- Invitations reçues par le compte connecté (par e-mail, ou déjà rattachées à son compte).
create or replace function public.my_rights_invitations()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id, 'albumId', a.id, 'albumTitle', a.title, 'albumIllustration', a.illustration,
    'sellerRole', a.seller_role,
    'sellerName', coalesce(
      (select nullif(ad.profile->>'title', '') from public.composer_profiles cp join public.ad_reels ad on ad.owner_id = cp.id
        where cp.profile_id = a.seller_id order by (ad.id = 'main') desc limit 1),
      (select u.email from auth.users u where u.id = a.seller_id)),
    'shareBps', h.share_bps, 'status', h.status, 'payoutRole', h.payout_role, 'invitedAt', h.invited_at
  ) order by h.invited_at desc), '[]'::jsonb)
  from public.album_rights_holders h join public.albums a on a.id = h.album_id
  where auth.uid() is not null
    and (h.holder_profile_id = auth.uid() or lower(h.holder_email) = (select lower(email) from auth.users where id = auth.uid()));
$$;

-- Accepter (en choisissant la casquette qui reçoit l'argent) ou refuser sa part.
create or replace function public.respond_rights_invitation(p_holder_id uuid, p_accept boolean, p_payout_role text default 'composer')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := (select lower(email) from auth.users where id = auth.uid());
  r record;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select * into r from public.album_rights_holders where id = p_holder_id;
  -- coalesce indispensable : holder_profile_id est vide tant que personne n'a répondu, et « vide = moi » vaut NULL,
  -- ce qui ferait passer n'importe quel compte (faille trouvée par le test, corrigée avant livraison).
  if not found or not (coalesce(r.holder_profile_id = auth.uid(), false) or coalesce(lower(r.holder_email) = v_email, false)) then
    raise exception 'Invitation introuvable';
  end if;
  if r.status not in ('pending', 'self_pay') then raise exception 'Tu as déjà répondu à cette invitation'; end if;
  if p_accept and p_payout_role not in ('composer', 'studio') then raise exception 'Casquette attendue : composer ou studio'; end if;
  update public.album_rights_holders
     set status = case when p_accept then 'accepted' else 'refused' end,
         holder_profile_id = auth.uid(),
         payout_role = case when p_accept then p_payout_role else null end,
         responded_at = now()
   where id = p_holder_id;
  -- Refus : l'album ne peut plus rester en vente.
  if not p_accept then update public.albums set buyable = false where id = r.album_id; end if;
  return jsonb_build_object('ok', true, 'status', case when p_accept then 'accepted' else 'refused' end);
end;
$$;

revoke execute on function public.album_rights_settled(text), public.assert_album_seller(text), public.album_rights_json(text) from public, anon, authenticated;
grant execute on function public.album_rights_settled(text), public.assert_album_seller(text), public.album_rights_json(text) to service_role;
revoke execute on function public.set_album_rights(text, text, jsonb, boolean), public.list_album_rights(text),
  public.mark_rights_holder_self_pay(uuid), public.my_rights_invitations(), public.respond_rights_invitation(uuid, boolean, text) from public, anon;
grant execute on function public.set_album_rights(text, text, jsonb, boolean), public.list_album_rights(text),
  public.mark_rights_holder_self_pay(uuid), public.my_rights_invitations(), public.respond_rights_invitation(uuid, boolean, text) to authenticated;

-- upsert_album : même fonction qu'en 20260928010000, plus le contrôle des co-ayants droit à la mise en vente.
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
  -- Co-ayants droit (D4-D6, 28/09) : droits partagés = chaque co-ayant droit a accepté, ou le vendeur a choisi de lui
  -- reverser sa part lui-même (injoignable). En attente ou refusé : pas de mise en vente.
  if exists (select 1 from public.albums where id = v_album_id and buyable) and not public.album_rights_settled(v_album_id) then
    raise exception 'Vente impossible : un co-ayant droit n''a pas encore accepté la répartition (ou l''a refusée)' using hint = 'rights';
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
