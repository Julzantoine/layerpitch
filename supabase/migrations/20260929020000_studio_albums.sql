-- LayerPitch — vente d'OST par un studio (29/09, décision de Jules-Antoine : « on entre le moins possible dans les
-- considérations de qui appartient à qui ; le compositeur crée un album avec ses musiques, le studio crée un album avec
-- des musiques qu'il a ou invite un compositeur à créer l'album pour lui, et l'album reste celui du studio »).
--
--   * Un album de studio : albums.seller_role = 'studio', seller_id = le compte du studio (c'est lui qui fixe le prix, met
--     en vente, encaisse, est facturé ; la part d'un compositeur passe par les co-ayants droit déjà construits).
--     upsert_studio_album : titre, pochette, présentation, prix, mise en vente ; morceaux pris parmi ceux que le studio
--     a (my_owned_assets : packs achetés).
--   * Compositeurs invités (album_contributors) : invités par e-mail, ils ACCEPTENT ; ils ajoutent LEURS morceaux
--     (set_album_contributor_tracks) et fixent LEUR version officielle, mais ne touchent ni au prix, ni à la mise en
--     vente, ni à l'argent. Chaque morceau garde la trace de qui l'a ajouté (album_tracks.added_by, null = le vendeur) :
--     chacun ne modifie que les siens.
--   * Sortie libre : le compositeur invité peut quitter l'album (leave_album) et le studio retirer un compositeur
--     (remove_album_contributor). Les morceaux concernés sont retirés de l'album ; ceux qui l'ont déjà obtenu les gardent
--     (removed_at, comme pour un morceau décoché). Si l'album en vente ne remplit plus les conditions (au moins un
--     morceau, chacun avec sa version officielle), il repasse hors vente.
--   * album_sale_problem(album) : les conditions de mise en vente, en un seul endroit (utilisées ici ; upsert_album garde
--     les siennes, identiques).
-- Le tout est réservé aux comptes dont la matrice ouvre « sell_albums » (admin pendant la bêta).

alter table public.album_tracks add column added_by uuid references public.profiles(id) on delete set null;
comment on column public.album_tracks.added_by is 'Compte qui a ajouté ce morceau à l''album : null = le vendeur (cas historique), sinon un compositeur invité (albums de studio, 29/09). Chacun ne modifie que les siens.';

create table public.album_contributors (
  id uuid primary key default gen_random_uuid(),
  album_id text not null references public.albums(id) on delete cascade,
  email text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'removed')),
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (album_id, email)
);
create index album_contributors_email_idx on public.album_contributors (lower(email));
create index album_contributors_profile_idx on public.album_contributors (profile_id);
alter table public.album_contributors enable row level security;
-- Aucune politique : lecture et écriture uniquement par les fonctions ci-dessous.

-- Conditions de mise en vente d'un album : un message, ou null si tout est bon.
create or replace function public.album_sale_problem(p_album_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.albums where id = p_album_id and buyable and price_eur_cents is null) then
    return 'Un album mis en vente doit avoir un prix minimum (0 autorisé)';
  end if;
  if not public.album_rights_settled(p_album_id) then
    return 'Vente impossible : un co-ayant droit n''a pas encore accepté la répartition (ou l''a refusée)';
  end if;
  if not exists (select 1 from public.album_tracks where album_id = p_album_id and removed_at is null) then
    return 'Un album mis en vente doit contenir au moins un morceau';
  end if;
  if exists (select 1 from public.album_tracks where album_id = p_album_id and removed_at is null
             and (default_settings->>'kind') is distinct from 'layerpitch-take') then
    return 'Un album mis en vente doit avoir la version officielle de chaque morceau';
  end if;
  return null;
end;
$$;
revoke execute on function public.album_sale_problem(text) from public, anon, authenticated;
grant execute on function public.album_sale_problem(text) to service_role;

-- Retire d'un album les morceaux ajoutés par un compte : supprimés, ou seulement marqués retirés si l'album a déjà été
-- obtenu (ceux qui l'ont gardent le morceau). Si l'album est en vente et ne tient plus, il repasse hors vente.
-- Renvoie vrai si l'album a été retiré de la vente.
create or replace function public.remove_album_tracks_added_by(p_album_id text, p_uid uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_unpublished boolean := false;
begin
  if exists (select 1 from public.album_purchases where album_id = p_album_id) then
    update public.album_tracks set removed_at = now() where album_id = p_album_id and added_by = p_uid and removed_at is null;
  else
    delete from public.album_tracks where album_id = p_album_id and added_by = p_uid;
  end if;
  if exists (select 1 from public.albums where id = p_album_id and buyable) and public.album_sale_problem(p_album_id) is not null then
    update public.albums set buyable = false, updated_at = now() where id = p_album_id;
    v_unpublished := true;
  end if;
  return v_unpublished;
end;
$$;
revoke execute on function public.remove_album_tracks_added_by(text, uuid) from public, anon, authenticated;
grant execute on function public.remove_album_tracks_added_by(text, uuid) to service_role;

-- L'appelant est un compositeur invité (accepté) de cet album.
create or replace function public.is_album_contributor(p_album_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.album_contributors c where c.album_id = p_album_id and c.profile_id = auth.uid() and c.status = 'accepted');
$$;
revoke execute on function public.is_album_contributor(text) from public, anon, authenticated;
grant execute on function public.is_album_contributor(text) to service_role;

-- ---- Album de studio : création et réglages par le studio ----
-- payload : { id, title, illustration?, illustrationOriginalName?, presentationFr?, presentationEn?, priceEurCents?, buyable?,
--             trackIds? (les morceaux du STUDIO : ceux de ses packs achetés) }
create or replace function public.upsert_studio_album(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_album_id text := payload->>'id';
  v_uid uuid := auth.uid();
  v_existing_seller uuid;
  v_existing_role text;
  v_track_ids text[];
  v_id text;
  v_problem text;
begin
  if v_uid is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not public.i_can('studio_sell_albums') then
    raise exception 'Non autorisé : la vente d''albums par un studio est réservée aux administrateurs pendant la bêta';
  end if;
  if public.current_studio_id() is null then raise exception 'Non autorisé : aucun profil studio associé à ce compte'; end if;
  if v_album_id is null or v_album_id = '' then raise exception 'payload.id manquant'; end if;
  select seller_id, seller_role into v_existing_seller, v_existing_role from public.albums where id = v_album_id;
  if v_existing_seller is not null and (v_existing_seller <> v_uid or v_existing_role <> 'studio') then
    raise exception 'Non autorisé : cet album appartient à un autre vendeur';
  end if;

  if payload ? 'trackIds' then
    select coalesce(array_agg(t), array[]::text[]) into v_track_ids from jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb)) t;
    if exists (select 1 from unnest(v_track_ids) tid where not exists (select 1 from public.my_owned_assets() o where o.kind = 'track' and o.id = tid)) then
      raise exception 'Un morceau de la liste ne fait pas partie de tes packs';
    end if;
    -- Un morceau déjà ajouté par un compositeur invité ne se met pas en double.
    if exists (select 1 from public.album_tracks at where at.album_id = v_album_id and at.track_id = any(v_track_ids) and at.added_by is not null and at.added_by <> v_uid) then
      raise exception 'Un de ces morceaux a déjà été ajouté à l''album par un compositeur invité';
    end if;
  end if;

  insert into public.albums (id, seller_id, seller_role, title, illustration, illustration_original_name, presentation_fr, presentation_en, price_eur_cents, buyable, updated_at)
  values (v_album_id, v_uid, 'studio', coalesce(payload->>'title', ''), payload->>'illustration', payload->>'illustrationOriginalName',
          coalesce(payload->>'presentationFr', ''), coalesce(payload->>'presentationEn', ''), (payload->>'priceEurCents')::int,
          coalesce((payload->>'buyable')::boolean, false), now())
  on conflict (id) do update set
    title = excluded.title,
    illustration = coalesce(excluded.illustration, albums.illustration),
    illustration_original_name = coalesce(excluded.illustration_original_name, albums.illustration_original_name),
    presentation_fr = case when payload ? 'presentationFr' then excluded.presentation_fr else albums.presentation_fr end,
    presentation_en = case when payload ? 'presentationEn' then excluded.presentation_en else albums.presentation_en end,
    price_eur_cents = case when payload ? 'priceEurCents' then excluded.price_eur_cents else albums.price_eur_cents end,
    buyable = case when payload ? 'buyable' then excluded.buyable else albums.buyable end,
    updated_at = now();

  if payload ? 'trackIds' then
    -- Seuls les morceaux du studio (ajoutés par lui, ou historiques) bougent ; ceux des invités restent.
    if exists (select 1 from public.album_purchases where album_id = v_album_id) then
      update public.album_tracks set removed_at = now()
      where album_id = v_album_id and (added_by is null or added_by = v_uid) and track_id <> all(v_track_ids) and removed_at is null;
    else
      delete from public.album_tracks where album_id = v_album_id and (added_by is null or added_by = v_uid) and track_id <> all(v_track_ids);
    end if;
    for v_id in select unnest(v_track_ids) loop
      insert into public.album_tracks (album_id, track_id, position, added_by)
      values (v_album_id, v_id, coalesce((select max(position) + 1 from public.album_tracks where album_id = v_album_id), 0), v_uid)
      on conflict (album_id, track_id) do update set removed_at = null;
    end loop;
  end if;

  if exists (select 1 from public.albums where id = v_album_id and buyable) then
    v_problem := public.album_sale_problem(v_album_id);
    if v_problem is not null then raise exception '%', v_problem using hint = case when v_problem like 'Vente impossible%' then 'rights' else '' end; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_album_id);
end;
$$;
revoke execute on function public.upsert_studio_album(jsonb) from public, anon;
grant execute on function public.upsert_studio_album(jsonb) to authenticated;

-- ---- Invitations de compositeurs ----
create or replace function public.invite_album_contributor(p_album_id text, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_email text := lower(trim(coalesce(p_email, ''))); v_id uuid; v_profile uuid;
begin
  if not exists (select 1 from public.albums where id = p_album_id and seller_id = auth.uid() and seller_role = 'studio') then
    raise exception 'Non autorisé : seul le studio vendeur invite des compositeurs sur son album';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresse e-mail invalide'; end if;
  select id into v_profile from auth.users where lower(email) = v_email;
  insert into public.album_contributors (album_id, email, profile_id) values (p_album_id, v_email, v_profile)
  on conflict (album_id, email) do update set status = case when album_contributors.status = 'accepted' then 'accepted' else 'pending' end,
    profile_id = coalesce(album_contributors.profile_id, excluded.profile_id), invited_at = now(), responded_at = null
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.list_album_contributors(p_album_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'email', c.email, 'status', c.status, 'invitedAt', c.invited_at, 'respondedAt', c.responded_at,
    'trackCount', (select count(*) from public.album_tracks at where at.album_id = c.album_id and at.added_by = c.profile_id and at.removed_at is null))
    order by c.invited_at), '[]'::jsonb)
  from public.album_contributors c
  where c.album_id = p_album_id and c.status <> 'removed'
    and exists (select 1 from public.albums a where a.id = p_album_id and a.seller_id = auth.uid());
$$;

-- Invitations en attente pour le compte connecté (par e-mail).
create or replace function public.my_album_invitations()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'albumId', a.id, 'albumTitle', a.title, 'invitedAt', c.invited_at,
    'studioEmail', (select u.email from auth.users u where u.id = a.seller_id)) order by c.invited_at desc), '[]'::jsonb)
  from public.album_contributors c join public.albums a on a.id = c.album_id
  where c.status = 'pending' and lower(c.email) = lower((select u.email from auth.users u where u.id = auth.uid()));
$$;

create or replace function public.respond_album_invitation(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.album_contributors c set status = case when p_accept then 'accepted' else 'declined' end, profile_id = auth.uid(), responded_at = now()
  where c.id = p_id and c.status = 'pending' and lower(c.email) = lower((select u.email from auth.users u where u.id = auth.uid()));
  if not found then raise exception 'Invitation introuvable'; end if;
end;
$$;

-- Albums de studio où le compte connecté est compositeur invité (Backstage, onglet Albums).
create or replace function public.my_album_contributions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('albumId', a.id, 'title', a.title, 'illustration', a.illustration, 'buyable', a.buyable,
    'studioEmail', (select u.email from auth.users u where u.id = a.seller_id),
    'tracks', (select coalesce(jsonb_agg(jsonb_build_object('trackId', at.track_id, 'title', t.title, 'hasOfficial', (at.default_settings->>'kind') = 'layerpitch-take',
        'duration', (at.default_settings->>'duration')::numeric) order by at.position), '[]'::jsonb)
      from public.album_tracks at join public.tracks t on t.id = at.track_id
      where at.album_id = a.id and at.added_by = auth.uid() and at.removed_at is null)) order by a.updated_at desc), '[]'::jsonb)
  from public.album_contributors c join public.albums a on a.id = c.album_id
  where c.profile_id = auth.uid() and c.status = 'accepted';
$$;

-- Le compositeur invité fixe LES SIENS : morceaux de son catalogue, remplacés en bloc (les autres morceaux ne bougent pas).
create or replace function public.set_album_contributor_tracks(p_album_id text, p_track_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_composer uuid := public.current_composer_id(); v_id text; v_unpublished boolean := false;
begin
  if not public.i_can('sell_albums') then raise exception 'Non autorisé : la fonction album est réservée aux administrateurs pendant la bêta'; end if;
  if not public.is_album_contributor(p_album_id) then raise exception 'Non autorisé : tu n''es pas compositeur invité de cet album'; end if;
  if v_composer is null then raise exception 'Non autorisé : aucun profil compositeur associé à ce compte'; end if;
  p_track_ids := coalesce(p_track_ids, array[]::text[]);
  if exists (select 1 from unnest(p_track_ids) tid where not exists (select 1 from public.tracks t where t.id = tid and t.owner_id = v_composer)) then
    raise exception 'Non autorisé : un des morceaux ne fait pas partie de ton catalogue';
  end if;
  if exists (select 1 from public.album_tracks at where at.album_id = p_album_id and at.track_id = any(p_track_ids) and at.added_by is distinct from v_uid and at.removed_at is null) then
    raise exception 'Un de ces morceaux est déjà dans l''album';
  end if;
  if exists (select 1 from public.album_purchases where album_id = p_album_id) then
    update public.album_tracks set removed_at = now() where album_id = p_album_id and added_by = v_uid and track_id <> all(p_track_ids) and removed_at is null;
  else
    delete from public.album_tracks where album_id = p_album_id and added_by = v_uid and track_id <> all(p_track_ids);
  end if;
  for v_id in select unnest(p_track_ids) loop
    insert into public.album_tracks (album_id, track_id, position, added_by)
    values (p_album_id, v_id, coalesce((select max(position) + 1 from public.album_tracks where album_id = p_album_id), 0), v_uid)
    on conflict (album_id, track_id) do update set removed_at = null, added_by = v_uid;
  end loop;
  -- Un album en vente auquel on ajoute un morceau sans version officielle n'est plus vendable en l'état : hors vente.
  if exists (select 1 from public.albums where id = p_album_id and buyable) and public.album_sale_problem(p_album_id) is not null then
    update public.albums set buyable = false, updated_at = now() where id = p_album_id;
    v_unpublished := true;
  end if;
  return jsonb_build_object('ok', true, 'unpublished', v_unpublished);
end;
$$;

create or replace function public.leave_album(p_album_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_unpublished boolean;
begin
  if not public.is_album_contributor(p_album_id) then raise exception 'Tu n''es pas compositeur invité de cet album'; end if;
  v_unpublished := public.remove_album_tracks_added_by(p_album_id, auth.uid());
  update public.album_contributors set status = 'removed', responded_at = now() where album_id = p_album_id and profile_id = auth.uid();
  return jsonb_build_object('ok', true, 'unpublished', v_unpublished);
end;
$$;

create or replace function public.remove_album_contributor(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c record; v_unpublished boolean := false;
begin
  select c2.* into c from public.album_contributors c2 join public.albums a on a.id = c2.album_id where c2.id = p_id and a.seller_id = auth.uid();
  if not found then raise exception 'Invitation introuvable'; end if;
  if c.profile_id is not null then v_unpublished := public.remove_album_tracks_added_by(c.album_id, c.profile_id); end if;
  update public.album_contributors set status = 'removed', responded_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'unpublished', v_unpublished);
end;
$$;

-- Version officielle d'un morceau : le vendeur pour les siens (et l'historique), le compositeur invité pour les siens.
create or replace function public.set_album_track_default_settings(p_album_id text, p_track_id text, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not public.i_can('sell_albums') then
    raise exception 'Non autorisé : la fonction album est réservée aux administrateurs pendant la bêta';
  end if;
  perform public.check_take(p_settings, p_track_id);
  update public.album_tracks at
  set default_settings = p_settings
  where at.album_id = p_album_id and at.track_id = p_track_id
    and ((at.added_by = auth.uid() and (exists (select 1 from public.albums a where a.id = at.album_id and a.seller_id = auth.uid()) or public.is_album_contributor(at.album_id)))
      or (at.added_by is null and exists (select 1 from public.albums a where a.id = at.album_id and a.seller_id = auth.uid())));
  if not found then
    raise exception 'Non autorisé : morceau introuvable dans cet album, ou ajouté par un autre compte';
  end if;
end;
$$;

revoke execute on function public.invite_album_contributor(text, text), public.list_album_contributors(text), public.my_album_invitations(),
  public.respond_album_invitation(uuid, boolean), public.my_album_contributions(), public.set_album_contributor_tracks(text, text[]),
  public.leave_album(text), public.remove_album_contributor(uuid), public.set_album_track_default_settings(text, text, jsonb) from public, anon;
grant execute on function public.invite_album_contributor(text, text), public.list_album_contributors(text), public.my_album_invitations(),
  public.respond_album_invitation(uuid, boolean), public.my_album_contributions(), public.set_album_contributor_tracks(text, text[]),
  public.leave_album(text), public.remove_album_contributor(uuid), public.set_album_track_default_settings(text, text, jsonb) to authenticated;
