-- LayerPitch — nom public d'un studio (29/09, demande de Jules-Antoine : « il faut que le studio ait un nom »).
--
--   * studio_profiles.display_name : le nom affiché (page d'album, invitations de compositeurs, e-mails, invitations
--     d'équipe). Distinct de billing_legal_name (raison sociale, pour les factures, jamais affichée publiquement).
--   * set_my_studio_name(nom) : réservé au propriétaire du studio ; my_studio() renvoie aussi le nom.
--   * Un album de studio ne peut pas être mis en vente tant que le studio n'a pas de nom (album_sale_problem).
--   * get_public_album : le vendeur d'un album de studio = le nom du studio.
--   * my_album_invitations / my_album_contributions / my_team_invitations : nom du studio en plus de l'e-mail.

alter table public.studio_profiles add column display_name text check (display_name is null or char_length(display_name) between 1 and 80);
comment on column public.studio_profiles.display_name is 'Nom public du studio (page d''album, invitations). Différent de billing_legal_name (facturation).';

create or replace function public.set_my_studio_name(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_name text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  if v_name is null then raise exception 'Donne un nom à ton studio'; end if;
  if char_length(v_name) > 80 then raise exception 'Nom trop long (80 caractères au plus)'; end if;
  update public.studio_profiles set display_name = v_name where profile_id = auth.uid();
  if not found then raise exception 'Seul le propriétaire du studio peut changer son nom'; end if;
  return v_name;
end;
$$;
revoke execute on function public.set_my_studio_name(text) from public, anon;
grant execute on function public.set_my_studio_name(text) to authenticated;

create or replace function public.my_studio()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when s.id is null then null else jsonb_build_object('id', s.id, 'isOwner', sp.profile_id = auth.uid(), 'name', sp.display_name) end
  from (select public.account_studio_id(auth.uid()) as id) s
  left join public.studio_profiles sp on sp.id = s.id;
$$;

-- Conditions de mise en vente (reprise de 20260929020000) + nom du studio pour un album de studio.
create or replace function public.album_sale_problem(p_album_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.albums a where a.id = p_album_id and a.seller_role = 'studio'
             and not exists (select 1 from public.studio_profiles sp where sp.profile_id = a.seller_id and nullif(sp.display_name, '') is not null)) then
    return 'Donne d''abord un nom à ton studio';
  end if;
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

create or replace function public.get_public_album(p_album_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare a record; v_name text;
begin
  select * into a from public.albums where id = p_album_id and buyable;
  if not found then return null; end if;
  if a.seller_role = 'studio' then
    select sp.display_name into v_name from public.studio_profiles sp where sp.profile_id = a.seller_id;
  else
    select coalesce(nullif((select r.profile->>'title' from public.ad_reels r join public.composer_profiles c on c.id = r.owner_id
                            where c.profile_id = a.seller_id order by (r.id = 'main') desc, r.created_at limit 1), ''),
                    (select c.handle from public.composer_profiles c where c.profile_id = a.seller_id))
      into v_name;
  end if;
  return jsonb_build_object(
    'id', a.id, 'title', a.title, 'illustration', a.illustration,
    'presentationFr', a.presentation_fr, 'presentationEn', a.presentation_en,
    'priceEurCents', a.price_eur_cents, 'tags', a.tags,
    'sellerName', coalesce(v_name, ''), 'sellerRole', coalesce(a.seller_role, 'composer'),
    'tracks', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title) order by at.position), '[]'::jsonb)
               from public.album_tracks at join public.tracks t on t.id = at.track_id
               where at.album_id = a.id and at.removed_at is null));
end;
$$;

create or replace function public.my_album_invitations()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'albumId', a.id, 'albumTitle', a.title, 'invitedAt', c.invited_at,
    'studioEmail', (select u.email from auth.users u where u.id = a.seller_id),
    'studioName', (select sp.display_name from public.studio_profiles sp where sp.profile_id = a.seller_id)) order by c.invited_at desc), '[]'::jsonb)
  from public.album_contributors c join public.albums a on a.id = c.album_id
  where c.status = 'pending' and lower(c.email) = lower((select u.email from auth.users u where u.id = auth.uid()));
$$;

create or replace function public.my_album_contributions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('albumId', a.id, 'title', a.title, 'illustration', a.illustration, 'buyable', a.buyable,
    'studioEmail', (select u.email from auth.users u where u.id = a.seller_id),
    'studioName', (select sp.display_name from public.studio_profiles sp where sp.profile_id = a.seller_id),
    'tracks', (select coalesce(jsonb_agg(jsonb_build_object('trackId', at.track_id, 'title', t.title, 'hasOfficial', (at.default_settings->>'kind') = 'layerpitch-take',
        'duration', (at.default_settings->>'duration')::numeric) order by at.position), '[]'::jsonb)
      from public.album_tracks at join public.tracks t on t.id = at.track_id
      where at.album_id = a.id and at.added_by = auth.uid() and at.removed_at is null)) order by a.updated_at desc), '[]'::jsonb)
  from public.album_contributors c join public.albums a on a.id = c.album_id
  where c.profile_id = auth.uid() and c.status = 'accepted';
$$;

create or replace function public.my_team_invitations()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'studioId', m.studio_id, 'invitedAt', m.invited_at,
      'ownerEmail', (select u.email from auth.users u where u.id = sp.profile_id),
      'studioName', coalesce(sp.display_name, sp.billing_legal_name, (select u.email from auth.users u where u.id = sp.profile_id)))
    order by m.invited_at desc), '[]'::jsonb)
  from public.studio_members m join public.studio_profiles sp on sp.id = m.studio_id
  where auth.uid() is not null and m.status = 'invited'
    and lower(m.email) = (select lower(email) from auth.users where id = auth.uid());
$$;
