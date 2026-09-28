-- LayerPitch — chantier profils et permissions, étape 5a (28 septembre) : équipes studio (D14, D37 du cadrage
-- layerpitch-docs/2026-09-27-cadrage-profils-permissions.md). Membres : SoloDev 1 / Indie 3 / AA 10 / AAA sur devis
-- (fonction team_members de la matrice, propriétaire compris).
--
-- Modèle (provisoire, D37) : le PROPRIÉTAIRE (studio_profiles.profile_id) paie et gère l'équipe (inviter, retirer,
-- transférer la propriété) ; les MEMBRES ont le même accès que lui : bibliothèque (achats de toute l'équipe), crédits,
-- packs custom, Projets. Un compte appartient à UN SEUL studio, comme propriétaire ou comme membre.
--   * account_studio_id(compte) : le studio du compte (propriétaire ou membre actif) — utilisé partout à la place de
--     « studio_profiles.profile_id = moi » ;
--   * profile_plan / entitlement : le palier studio et le contrat AAA (exception saisie sur le propriétaire) valent
--     pour toute l'équipe ;
--   * current_studio_id, ensure_studio_profile, my_owned_assets : version équipe.
-- Invitation par e-mail (Edge Function invite-team-member), acceptation sur invitation.html.

create table public.studio_members (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio_profiles(id) on delete cascade,
  email text not null,
  profile_id uuid references public.profiles(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'active')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz
);
create unique index studio_members_studio_email_idx on public.studio_members (studio_id, lower(email));
create unique index studio_members_one_team_idx on public.studio_members (profile_id) where status = 'active';
alter table public.studio_members enable row level security;
-- Aucune politique : tout passe par les RPC ci-dessous.

create or replace function public.account_studio_id(p_profile_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select sp.id from public.studio_profiles sp where sp.profile_id = p_profile_id),
    (select m.studio_id from public.studio_members m where m.profile_id = p_profile_id and m.status = 'active' limit 1));
$$;
revoke execute on function public.account_studio_id(uuid) from public, anon, authenticated;
grant execute on function public.account_studio_id(uuid) to service_role;

-- Comptes de l'équipe d'un studio (propriétaire + membres actifs).
create or replace function public.studio_accounts(p_studio_id uuid)
returns table (profile_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select sp.profile_id from public.studio_profiles sp where sp.id = p_studio_id
  union
  select m.profile_id from public.studio_members m where m.studio_id = p_studio_id and m.status = 'active' and m.profile_id is not null;
$$;
revoke execute on function public.studio_accounts(uuid) from public, anon, authenticated;
grant execute on function public.studio_accounts(uuid) to service_role;

create or replace function public.current_studio_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.account_studio_id(auth.uid());
$$;

-- Le studio du compte connecté (pour les pages) : id, propriétaire ou non.
create or replace function public.my_studio()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when s.id is null then null else jsonb_build_object('id', s.id, 'isOwner', sp.profile_id = auth.uid()) end
  from (select public.account_studio_id(auth.uid()) as id) s
  left join public.studio_profiles sp on sp.id = s.id;
$$;
revoke execute on function public.my_studio() from public, anon;
grant execute on function public.my_studio() to authenticated;

-- Activation : un membre d'équipe n'a pas besoin de son propre studio (il retrouve celui de l'équipe).
create or replace function public.ensure_studio_profile()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Non autorisé : aucune session active'; end if;
  v_id := public.account_studio_id(auth.uid());
  if v_id is not null then return v_id; end if;
  insert into public.studio_profiles (profile_id) values (auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

-- Bibliothèque de l'équipe : morceaux et Sfx des packs achetés par N'IMPORTE QUEL compte de l'équipe.
create or replace function public.my_owned_assets()
returns table (kind text, id text, title text, pack_id text, pack_title text)
language sql
stable
security definer
set search_path = public
as $$
  with team as (
    select a.profile_id from public.studio_accounts(public.account_studio_id(auth.uid())) a
    union select auth.uid()
  ),
  bought as (select distinct pp.pack_id from public.pack_purchases pp where pp.studio_id in (select profile_id from team))
  select 'track', t.id, t.title, b.pack_id, pk.title
  from bought b join public.pack_tracks pt on pt.pack_id = b.pack_id join public.tracks t on t.id = pt.track_id
  join public.packs pk on pk.id = b.pack_id
  union all
  select 'sfx', s.id, s.title, b.pack_id, pk.title
  from bought b join public.pack_sfx ps on ps.pack_id = b.pack_id join public.sfx_library s on s.id = ps.sfx_id
  join public.packs pk on pk.id = b.pack_id
  order by 5, 3;
$$;

-- Achats de packs de l'équipe (pour la bibliothèque du studio), avec l'adresse de qui a acheté.
create or replace function public.my_team_purchases()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with team as (
    select a.profile_id from public.studio_accounts(public.account_studio_id(auth.uid())) a
    union select auth.uid()
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'purchaseId', pp.id, 'packId', pp.pack_id, 'purchasedAt', pp.purchased_at, 'pricePaid', pp.price_paid,
    'boughtBy', (select u.email from auth.users u where u.id = pp.studio_id), 'mine', pp.studio_id = auth.uid(),
    'pack', jsonb_build_object('id', pk.id, 'title', pk.title, 'illustration', pk.illustration)
  ) order by pp.purchased_at desc), '[]'::jsonb)
  from public.pack_purchases pp join public.packs pk on pk.id = pp.pack_id
  where auth.uid() is not null and pp.studio_id in (select profile_id from team);
$$;
revoke execute on function public.my_team_purchases() from public, anon;
grant execute on function public.my_team_purchases() to authenticated;

-- L'équipe du compte connecté possède-t-elle ce pack ? (outil vidéo de la page du pack, D10)
create or replace function public.team_owns_pack(p_pack_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.my_owned_assets() o where o.pack_id = p_pack_id)
      or exists (select 1 from public.pack_purchases pp where pp.pack_id = p_pack_id and pp.studio_id = auth.uid());
$$;
revoke execute on function public.team_owns_pack(text) from public, anon;
grant execute on function public.team_owns_pack(text) to authenticated;

-- ---- Gestion de l'équipe ----
create or replace function public.my_team()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (select public.account_studio_id(auth.uid()) as id)
  select case when s.id is null then null else jsonb_build_object(
    'studioId', s.id,
    'isOwner', sp.profile_id = auth.uid(),
    'owner', jsonb_build_object('email', (select u.email from auth.users u where u.id = sp.profile_id), 'me', sp.profile_id = auth.uid()),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'email', m.email, 'status', m.status,
        'me', m.profile_id = auth.uid(), 'invitedAt', m.invited_at, 'joinedAt', m.joined_at) order by m.invited_at)
      from public.studio_members m where m.studio_id = s.id), '[]'::jsonb),
    'quota', (select e.amount from public.entitlement(sp.profile_id, 'team_members', false) e),
    'allowed', coalesce((select e.allowed from public.entitlement(auth.uid(), 'team_members', false) e), false)
  ) end
  from s left join public.studio_profiles sp on sp.id = s.id;
$$;
revoke execute on function public.my_team() from public, anon;
grant execute on function public.my_team() to authenticated;

create or replace function public.invite_team_member(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ent record;
  v_count int;
  v_id uuid;
begin
  select sp.id into v_studio from public.studio_profiles sp where sp.profile_id = auth.uid();
  if v_studio is null then raise exception 'Seul le propriétaire du studio peut inviter des membres'; end if;
  select * into v_ent from public.entitlement(auth.uid(), 'team_members', false);
  if not coalesce(v_ent.allowed, false) then raise exception 'Les équipes ne sont pas ouvertes pour ce compte'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresse e-mail invalide'; end if;
  if v_email = (select lower(email) from auth.users where id = auth.uid()) then raise exception 'Tu fais déjà partie de ton studio'; end if;
  if exists (select 1 from public.studio_members where studio_id = v_studio and lower(email) = v_email) then
    raise exception 'Cette personne est déjà invitée ou membre';
  end if;
  select 1 + count(*) into v_count from public.studio_members where studio_id = v_studio; -- propriétaire compris
  if v_ent.amount is not null and v_count >= v_ent.amount then
    raise exception 'Limite atteinte : % membre(s) pour ton palier, propriétaire compris', v_ent.amount::int using hint = 'quota';
  end if;
  insert into public.studio_members (studio_id, email) values (v_studio, v_email) returning id into v_id;
  return v_id;
end;
$$;

-- Retirer un membre (propriétaire) ou quitter l'équipe (le membre lui-même).
create or replace function public.remove_team_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select m.*, sp.profile_id as owner_id into r from public.studio_members m join public.studio_profiles sp on sp.id = m.studio_id where m.id = p_member_id;
  if not found or not (coalesce(r.owner_id = auth.uid(), false) or coalesce(r.profile_id = auth.uid(), false)) then
    raise exception 'Membre introuvable';
  end if;
  delete from public.studio_members where id = p_member_id;
end;
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
      'studioName', coalesce(sp.billing_legal_name, (select u.email from auth.users u where u.id = sp.profile_id)))
    order by m.invited_at desc), '[]'::jsonb)
  from public.studio_members m join public.studio_profiles sp on sp.id = m.studio_id
  where auth.uid() is not null and m.status = 'invited'
    and lower(m.email) = (select lower(email) from auth.users where id = auth.uid());
$$;

create or replace function public.respond_team_invitation(p_member_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select * into r from public.studio_members where id = p_member_id and status = 'invited';
  if not found or not coalesce(lower(r.email) = (select lower(email) from auth.users where id = auth.uid()), false) then
    raise exception 'Invitation introuvable';
  end if;
  if not p_accept then delete from public.studio_members where id = p_member_id; return; end if;
  if public.account_studio_id(auth.uid()) is not null then
    raise exception 'Tu fais déjà partie d''un studio (le tien ou une autre équipe) : un compte appartient à un seul studio' using hint = 'one_team';
  end if;
  update public.studio_members set status = 'active', profile_id = auth.uid(), joined_at = now() where id = p_member_id;
end;
$$;

-- Transférer la propriété à un membre actif : il devient propriétaire (et payeur), l'ancien propriétaire devient membre.
create or replace function public.transfer_studio_ownership(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_old uuid := auth.uid(); v_old_email text;
begin
  select m.* into r from public.studio_members m join public.studio_profiles sp on sp.id = m.studio_id
   where m.id = p_member_id and m.status = 'active' and sp.profile_id = v_old;
  if not found then raise exception 'Seul le propriétaire peut transférer la propriété, à un membre actif'; end if;
  select email into v_old_email from auth.users where id = v_old;
  delete from public.studio_members where id = p_member_id;
  update public.studio_profiles set profile_id = r.profile_id where id = r.studio_id;
  insert into public.studio_members (studio_id, email, profile_id, status, joined_at) values (r.studio_id, coalesce(v_old_email, ''), v_old, 'active', now());
end;
$$;

revoke execute on function public.invite_team_member(text), public.remove_team_member(uuid), public.my_team_invitations(),
  public.respond_team_invitation(uuid, boolean), public.transfer_studio_ownership(uuid) from public, anon;
grant execute on function public.invite_team_member(text), public.remove_team_member(uuid), public.my_team_invitations(),
  public.respond_team_invitation(uuid, boolean), public.transfer_studio_ownership(uuid) to authenticated;

-- ---- Droits : le palier et le contrat du studio valent pour toute l'équipe ----
create or replace function public.profile_plan(p_profile_id uuid, p_kind text, p_with_preview boolean default true)
returns table (plan text, source text)
language sql
stable
security definer
set search_path = public
as $$
  with prof as (
    select cp.plan as stored, cp.trial_ends_at, cp.profile_id
    from public.composer_profiles cp where p_kind = 'composer' and cp.profile_id = p_profile_id
    union all
    -- Studio : celui dont le compte est propriétaire OU membre actif (équipes, 28/09) — le palier est celui du studio.
    select sp.plan, null::timestamptz, p_profile_id
    from public.studio_profiles sp where p_kind = 'studio' and sp.id = public.account_studio_id(p_profile_id)
  ),
  adm as (select a.* from public.admins a where a.profile_id = p_profile_id)
  select
    case
      when p_with_preview and auth.uid() = p_profile_id and p_kind = 'composer' and (select preview_tier from adm) is not null then (select preview_tier from adm)
      when p_with_preview and auth.uid() = p_profile_id and p_kind = 'studio' and (select preview_studio_plan from adm) is not null then (select preview_studio_plan from adm)
      when exists (select 1 from adm) then case p_kind when 'composer' then 'pro' else 'aaa' end
      when public.beta_full_access() then case p_kind when 'composer' then 'pro' else 'aa' end
      when prof.trial_ends_at > now() then 'pro'
      else prof.stored
    end,
    case
      when p_with_preview and auth.uid() = p_profile_id and p_kind = 'composer' and (select preview_tier from adm) is not null then 'preview'
      when p_with_preview and auth.uid() = p_profile_id and p_kind = 'studio' and (select preview_studio_plan from adm) is not null then 'preview'
      when exists (select 1 from adm) then 'admin'
      when public.beta_full_access() then 'beta'
      when prof.trial_ends_at > now() then 'trial'
      else 'plan'
    end
  from prof;
$$;

create or replace function public.entitlement(p_profile_id uuid, p_feature text, p_with_preview boolean default true)
returns table (plan text, allowed boolean, amount numeric, level text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_plan text;
  v_source text;
  v_student boolean := false;
  v_override_profile uuid := p_profile_id;
  r record;
begin
  select f.kind into v_kind from public.features f where f.key = p_feature;
  if v_kind is null then raise exception 'Fonction inconnue : %', p_feature; end if;

  select pp.plan, pp.source into v_plan, v_source from public.profile_plan(p_profile_id, v_kind, p_with_preview) pp;
  if v_plan is null then return; end if;

  if v_source = 'plan' and v_kind = 'composer' then
    select cp.student_tier_declared into v_student from public.composer_profiles cp where cp.profile_id = p_profile_id;
  end if;

  select e.allowed, e.amount, e.level into r
  from public.plan_entitlements e
  where e.plan = v_plan and e.feature = p_feature
    and e.variant in ('', case when v_student then 'student' else '' end)
  order by e.variant desc   -- la variante 'student' passe avant la ligne de base
  limit 1;

  plan := v_plan;
  if found then allowed := r.allowed; amount := r.amount; level := r.level;
  else allowed := false; amount := 0; level := null;
  end if;

  -- Contrat d'un studio (AAA sur devis) : saisi sur le compte PROPRIÉTAIRE du studio, valable pour toute l'équipe.
  if v_kind = 'studio' then
    select sp.profile_id into v_override_profile from public.studio_profiles sp where sp.id = public.account_studio_id(p_profile_id);
  end if;
  if v_source = 'plan' then
    select o.allowed, o.amount, o.level into r from public.account_entitlement_overrides o
    where o.profile_id = v_override_profile and o.feature = p_feature;
    if found then allowed := r.allowed; amount := r.amount; level := r.level; end if;
  end if;

  if (select f.flag_key from public.features f where f.key = p_feature) is not null
     and not public.feature_released((select f.flag_key from public.features f where f.key = p_feature), p_profile_id) then
    allowed := false;
    if (select f.value_type from public.features f where f.key = p_feature) = 'quota' then amount := 0; end if;
    level := null;
  end if;

  return next;
end;
$$;
