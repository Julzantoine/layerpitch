-- LayerPitch — AdReels à lien privé (6 octobre) : mot de passe ou lien magique, décoché par défaut (« public »).
-- Pour une grande entreprise : seul qui a le lien (ou le mot de passe) voit la page.
--
-- Ce qui change :
--   * ad_reels.access_mode : 'public' (défaut, comportement actuel) | 'password' | 'magic'.
--   * Le secret n'est JAMAIS dans ad_reels : table ad_reel_access (illisible côté navigateur), mot de passe salé et haché (SHA-256 répété),
--     lien magique = jeton long aléatoire, seul son haché est gardé (le lien n'est montré qu'une fois, à sa création).
--   * La lecture publique de ad_reels et ad_reel_tracks ne renvoie plus que les AdReels publics (et, pour son compositeur, les siens).
--     La page d'un AdReel privé le demande par get_private_ad_reel(), qui vérifie le secret (avec un frein : 10 échecs / 10 minutes).
--   * Les fichiers audio PROTÉGÉS d'un morceau ne sont écoutables « publiquement » que via un AdReel public ; via un AdReel privé il faut
--     le secret (can_hear_track à 3 paramètres, passé par l'Edge Function track-audio-url).
--   * Aperçu des liens partagés (WhatsApp, LinkedIn...) : un AdReel privé ne montre que le nom du compositeur, rien de son contenu.
-- Fonction réservée par feu vert admin (clé 'private_links'), comme les autres nouveautés.

alter table public.ad_reels add column access_mode text not null default 'public' check (access_mode in ('public', 'password', 'magic'));
comment on column public.ad_reels.access_mode is 'public | password | magic. Le secret vit dans ad_reel_access, jamais ici.';

create table public.ad_reel_access (
  owner_id uuid not null,
  ad_reel_id text not null,
  salt text not null,
  iterations int not null,
  secret_hash text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, ad_reel_id),
  foreign key (owner_id, ad_reel_id) references public.ad_reels(owner_id, id) on delete cascade
);
alter table public.ad_reel_access enable row level security;  -- aucune politique : seules les fonctions ci-dessous y touchent
revoke all on public.ad_reel_access from anon, authenticated;

create table public.ad_reel_access_failures (
  owner_id uuid not null,
  ad_reel_id text not null,
  at timestamptz not null default now()
);
create index ad_reel_access_failures_idx on public.ad_reel_access_failures (owner_id, ad_reel_id, at);
alter table public.ad_reel_access_failures enable row level security;
revoke all on public.ad_reel_access_failures from anon, authenticated;

-- ---- Feu vert + palier ----
insert into public.feature_flags (key, description) values
  ('private_links', 'AdReels à lien privé : mot de passe ou lien magique (6/10) — set_ad_reel_access.');
insert into public.features (key, kind, value_type, description, flag_key) values
  ('private_links', 'composer', 'switch', 'Protéger un AdReel par mot de passe ou lien magique', 'private_links');
insert into public.plan_entitlements (plan, feature, allowed, amount, level) values
  ('free', 'private_links', false, null, null),
  ('starter', 'private_links', true, null, null),
  ('pro', 'private_links', true, null, null);

-- ---- Lecture publique : seulement les AdReels publics (et les siens) ----
drop policy "public read" on public.ad_reels;
create policy "public read" on public.ad_reels for select
  using (access_mode = 'public' or owner_id = public.current_composer_id());
drop policy "public read" on public.ad_reel_tracks;
create policy "public read" on public.ad_reel_tracks for select
  using (exists (select 1 from public.ad_reels ar where ar.owner_id = ad_reel_tracks.owner_id and ar.id = ad_reel_tracks.ad_reel_id));

-- ---- Hachage (interne) ----
create or replace function public.ad_reel_secret_hash(p_salt text, p_secret text, p_iterations int)
returns text
language plpgsql
immutable
as $$
declare h bytea := sha256(convert_to(p_salt || ':' || p_secret, 'utf8')); i int;
begin
  for i in 2..greatest(p_iterations, 1) loop
    h := sha256(h || convert_to(p_salt, 'utf8'));
  end loop;
  return encode(h, 'hex');
end;
$$;
revoke execute on function public.ad_reel_secret_hash(text, text, int) from public, anon, authenticated;

-- ---- Vérification d'un secret (interne) : frein à 10 échecs par 10 minutes et par AdReel ----
create or replace function public.check_ad_reel_secret(p_owner uuid, p_id text, p_secret text)
returns text  -- 'ok' | 'wrong' | 'throttled' | 'none'
language plpgsql
security definer
set search_path = public
as $$
declare a record;
begin
  select * into a from public.ad_reel_access where owner_id = p_owner and ad_reel_id = p_id;
  if not found then return 'none'; end if;
  if (select count(*) from public.ad_reel_access_failures where owner_id = p_owner and ad_reel_id = p_id and at > now() - interval '10 minutes') >= 10 then
    return 'throttled';
  end if;
  if p_secret is not null and p_secret <> '' and public.ad_reel_secret_hash(a.salt, p_secret, a.iterations) = a.secret_hash then return 'ok'; end if;
  insert into public.ad_reel_access_failures (owner_id, ad_reel_id) values (p_owner, p_id);
  delete from public.ad_reel_access_failures where at < now() - interval '1 day';
  return 'wrong';
end;
$$;
revoke execute on function public.check_ad_reel_secret(uuid, text, text) from public, anon, authenticated;

-- ---- Le compositeur règle l'accès de son AdReel ----
-- p_mode 'public' : retire la protection. 'password' : p_password (6 caractères au moins). 'magic' : crée un jeton (renvoyé UNE fois).
create or replace function public.set_ad_reel_access(p_ad_reel_id text, p_mode text, p_password text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_composer_id();
  v_salt text := replace(gen_random_uuid()::text, '-', '');
  v_token text;
begin
  if v_me is null then raise exception 'Non autorisé : aucun profil compositeur associé à ce compte'; end if;
  if p_mode not in ('public', 'password', 'magic') then raise exception 'Mode inconnu'; end if;
  -- VERROU BÊTA (6/10) : à retirer au feu vert de Jules-Antoine (barrière 'private_links' ; remettre un AdReel en public reste toujours permis).
  if p_mode <> 'public' and not public.i_can('private_links') then raise exception 'Non autorisé : lien privé réservé aux paliers payants'; end if;
  if not exists (select 1 from public.ad_reels where owner_id = v_me and id = p_ad_reel_id) then
    raise exception 'AdReel introuvable : publie-le d''abord' using hint = 'unpublished';
  end if;
  if p_mode = 'public' then
    delete from public.ad_reel_access where owner_id = v_me and ad_reel_id = p_ad_reel_id;
    update public.ad_reels set access_mode = 'public' where owner_id = v_me and id = p_ad_reel_id;
    return jsonb_build_object('mode', 'public');
  end if;
  if p_mode = 'password' then
    if p_password is null or length(p_password) < 6 then raise exception 'Mot de passe trop court (6 caractères au moins)' using hint = 'short'; end if;
    insert into public.ad_reel_access (owner_id, ad_reel_id, salt, iterations, secret_hash)
      values (v_me, p_ad_reel_id, v_salt, 10000, public.ad_reel_secret_hash(v_salt, p_password, 10000))
      on conflict (owner_id, ad_reel_id) do update set salt = excluded.salt, iterations = excluded.iterations, secret_hash = excluded.secret_hash, created_at = now();
    update public.ad_reels set access_mode = 'password' where owner_id = v_me and id = p_ad_reel_id;
    return jsonb_build_object('mode', 'password');
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.ad_reel_access (owner_id, ad_reel_id, salt, iterations, secret_hash)
    values (v_me, p_ad_reel_id, v_salt, 1, public.ad_reel_secret_hash(v_salt, v_token, 1))
    on conflict (owner_id, ad_reel_id) do update set salt = excluded.salt, iterations = excluded.iterations, secret_hash = excluded.secret_hash, created_at = now();
  update public.ad_reels set access_mode = 'magic' where owner_id = v_me and id = p_ad_reel_id;
  return jsonb_build_object('mode', 'magic', 'token', v_token);
end;
$$;
revoke execute on function public.set_ad_reel_access(text, text, text) from public, anon;
grant execute on function public.set_ad_reel_access(text, text, text) to authenticated;

-- ---- La page publique : mode d'accès d'un AdReel (n'expose rien d'autre) ----
create or replace function public.get_ad_reel_access_mode(p_owner_id uuid, p_ad_reel_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select access_mode from public.ad_reels where owner_id = p_owner_id and id = p_ad_reel_id;
$$;
grant execute on function public.get_ad_reel_access_mode(uuid, text) to anon, authenticated;

-- ---- La page publique : l'AdReel privé, contre le secret ----
-- Réponse : { ok: true, adReel: { ...ligne ad_reels, ad_reel_tracks: [...] } } | { ok: false, error: 'wrong' | 'throttled' | 'none' }
create or replace function public.get_private_ad_reel(p_owner_id uuid, p_ad_reel_id text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_check text; v_row jsonb;
begin
  if not exists (select 1 from public.ad_reels where owner_id = p_owner_id and id = p_ad_reel_id and access_mode <> 'public') then
    return jsonb_build_object('ok', false, 'error', 'none');
  end if;
  v_check := public.check_ad_reel_secret(p_owner_id, p_ad_reel_id, p_secret);
  if v_check <> 'ok' then return jsonb_build_object('ok', false, 'error', v_check); end if;
  select to_jsonb(ar) - 'access_mode' into v_row from public.ad_reels ar where ar.owner_id = p_owner_id and ar.id = p_ad_reel_id;
  v_row := v_row || jsonb_build_object('ad_reel_tracks', coalesce(
    (select jsonb_agg(jsonb_build_object('track_id', art.track_id, 'position', art.position) order by art.position)
       from public.ad_reel_tracks art where art.owner_id = p_owner_id and art.ad_reel_id = p_ad_reel_id), '[]'::jsonb));
  return jsonb_build_object('ok', true, 'adReel', v_row);
end;
$$;
grant execute on function public.get_private_ad_reel(uuid, text, text) to anon, authenticated;

-- ---- Audio protégé : un AdReel PRIVÉ ne rend pas ses morceaux écoutables par tous ----
-- can_hear_track de 20260929050000, seule différence : la clause « AdReel » ne compte que les AdReels publics.
create or replace function public.can_hear_track(p_track_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_protected boolean; v_owner uuid;
begin
  select t.protected, t.owner_id into v_protected, v_owner from public.tracks t where t.id = p_track_id;
  if not found then return false; end if;
  if not v_protected then return true; end if;
  if exists (select 1 from public.ad_reel_tracks art join public.ad_reels ar on ar.owner_id = art.owner_id and ar.id = art.ad_reel_id
             where art.track_id = p_track_id and ar.access_mode = 'public') then return true; end if;
  if exists (select 1 from public.pack_tracks pt join public.packs p on p.id = pt.pack_id where pt.track_id = p_track_id and p.buyable) then return true; end if;
  if exists (select 1 from public.album_tracks at join public.albums a on a.id = at.album_id
             where at.track_id = p_track_id and at.removed_at is null and a.buyable
               and (a.listen_mode = 'all' or (a.listen_mode = 'selected' and at.free_listen))) then return true; end if;
  if v_uid is null then return false; end if;
  if v_owner is not null and v_owner = public.current_composer_id() then return true; end if;
  if exists (select 1 from public.album_tracks at join public.albums a on a.id = at.album_id
             where at.track_id = p_track_id and (a.seller_id = v_uid or public.is_album_contributor(a.id))) then return true; end if;
  if exists (select 1 from public.album_purchases ap where ap.buyer_id = v_uid and public.album_track_visible_to_me(ap.album_id, p_track_id)) then return true; end if;
  if exists (select 1 from public.pack_tracks pt join public.pack_purchases pp on pp.pack_id = pt.pack_id
             where pt.track_id = p_track_id
               and (pp.studio_id = v_uid
                    or pp.studio_id in (select sa.profile_id from public.studio_accounts(public.current_studio_id()) sa))) then return true; end if;
  return false;
end;
$$;
revoke execute on function public.can_hear_track(text) from public;
grant execute on function public.can_hear_track(text) to anon, authenticated;

-- Même question, avec le secret d'un AdReel privé qui contient ce morceau.
create or replace function public.can_hear_track(p_track_id text, p_ad_reel_id text, p_secret text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_owner uuid;
begin
  if public.can_hear_track(p_track_id) then return true; end if;
  if p_ad_reel_id is null or p_secret is null then return false; end if;
  select owner_id into v_owner from public.tracks where id = p_track_id;
  if v_owner is null then return false; end if;
  if not exists (select 1 from public.ad_reel_tracks where owner_id = v_owner and ad_reel_id = p_ad_reel_id and track_id = p_track_id) then return false; end if;
  return public.check_ad_reel_secret(v_owner, p_ad_reel_id, p_secret) = 'ok';
end;
$$;
revoke execute on function public.can_hear_track(text, text, text) from public;
grant execute on function public.can_hear_track(text, text, text) to anon, authenticated;

-- Sfx : la clause « bloc Sfx d'un AdReel » ne compte que les AdReels publics ; version 3 paramètres comme pour les morceaux.
create or replace function public.can_hear_sfx(p_sfx_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_protected boolean; v_owner uuid;
begin
  select s.protected, s.owner_id into v_protected, v_owner from public.sfx_library s where s.id = p_sfx_id;
  if not found then return false; end if;
  if not v_protected then return true; end if;
  if exists (select 1 from public.ad_reels r, jsonb_array_elements(r.blocks) b
             where r.access_mode = 'public' and b->>'type' = 'sfx' and jsonb_typeof(b->'sfxIds') = 'array' and (b->'sfxIds') ? p_sfx_id) then return true; end if;
  if exists (select 1 from public.pack_sfx ps join public.packs p on p.id = ps.pack_id where ps.sfx_id = p_sfx_id and p.buyable) then return true; end if;
  if v_uid is null then
    return exists (select 1 from public.track_sfx ts where ts.sfx_id = p_sfx_id and public.can_hear_track(ts.track_id));
  end if;
  if v_owner is not null and v_owner = public.current_composer_id() then return true; end if;
  if exists (select 1 from public.pack_sfx ps join public.pack_purchases pp on pp.pack_id = ps.pack_id
             where ps.sfx_id = p_sfx_id
               and (pp.studio_id = v_uid or pp.studio_id in (select sa.profile_id from public.studio_accounts(public.current_studio_id()) sa))) then return true; end if;
  return exists (select 1 from public.track_sfx ts where ts.sfx_id = p_sfx_id and public.can_hear_track(ts.track_id));
end;
$$;
revoke execute on function public.can_hear_sfx(text) from public;
grant execute on function public.can_hear_sfx(text) to anon, authenticated;

create or replace function public.can_hear_sfx(p_sfx_id text, p_ad_reel_id text, p_secret text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_owner uuid;
begin
  if public.can_hear_sfx(p_sfx_id) then return true; end if;
  if p_ad_reel_id is null or p_secret is null then return false; end if;
  select owner_id into v_owner from public.sfx_library where id = p_sfx_id;
  if v_owner is null then return false; end if;
  if not exists (select 1 from public.ad_reels r, jsonb_array_elements(r.blocks) b
                 where r.owner_id = v_owner and r.id = p_ad_reel_id and b->>'type' = 'sfx'
                   and jsonb_typeof(b->'sfxIds') = 'array' and (b->'sfxIds') ? p_sfx_id) then return false; end if;
  return public.check_ad_reel_secret(v_owner, p_ad_reel_id, p_secret) = 'ok';
end;
$$;
revoke execute on function public.can_hear_sfx(text, text, text) from public;
grant execute on function public.can_hear_sfx(text, text, text) to anon, authenticated;

-- ---- Aperçu des liens partagés : rien du contenu d'un AdReel privé ----
-- La fonction actuelle est gardée sous un autre nom (non appelable de l'extérieur) ; get_share_preview la précède d'un contrôle.
alter function public.get_share_preview(text, text, text, text) rename to get_share_preview_unfiltered;
revoke execute on function public.get_share_preview_unfiltered(text, text, text, text) from public, anon, authenticated;

create or replace function public.get_share_preview(p_kind text, p_handle text, p_ref text default null, p_alt text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_link jsonb; v_owner uuid; v_ar text;
begin
  if p_kind = 'adreel' then
    v_link := public.resolve_public_link(p_handle, p_ref);
    if v_link is not null then
      v_owner := (v_link ->> 'ownerId')::uuid;
      v_ar := coalesce(nullif(p_alt, ''), v_link ->> 'adReelId', 'main');
      if exists (select 1 from public.ad_reels where owner_id = v_owner and id = v_ar and access_mode <> 'public') then
        return jsonb_build_object('kind', 'adreel', 'title', v_link ->> 'handle', 'descriptionFr', null, 'descriptionEn', null, 'image', null, 'lang', 'fr');
      end if;
    end if;
  end if;
  return public.get_share_preview_unfiltered(p_kind, p_handle, p_ref, p_alt);
end;
$$;
grant execute on function public.get_share_preview(text, text, text, text) to anon, authenticated;
