-- Sécurité (audit du 16/11) — points mineurs M1, M4, M5.
--
-- M1. Liens privés (AdReel à mot de passe / lien magique) et liens de relecture : le frein (10 erreurs en 10 minutes)
--     comptait les erreurs de TOUT LE MONDE sur un même lien. N'importe qui connaissant l'adresse pouvait donc envoyer un
--     faux mot de passe par minute et empêcher indéfiniment le vrai destinataire d'ouvrir le lien. Désormais :
--       - le frein compte les erreurs PAR VISITEUR (adresse IP) : un fâcheux ne bloque que lui-même ;
--       - un plafond global, beaucoup plus haut (100 erreurs en 10 minutes, toutes adresses confondues), reste en place
--         contre une attaque répartie sur de nombreuses adresses.
-- M4. L'ancienne fonction submit_access_request(text, text, text) restait appelable sans compte (droit du groupe
--     PUBLIC, qui contient anon et authenticated). Fermée.
-- M5. Envoi de fichiers : un identifiant de morceau / Sfx / vidéo pas encore en base valait « autorisé » pour n'importe
--     quel compositeur. Le premier qui envoie sous un identifiant le réserve (media_prefix_claims) ; les autres sont
--     refusés tant que la ligne n'existe pas, puis c'est le propriétaire de la ligne qui fait foi.

-- ---- Adresse IP du visiteur (dernier segment de x-forwarded-for, posé par le proxy de confiance ; même règle que
--      log_analytics_event, audit du 11/09). NULL hors d'un appel PostgREST.
create or replace function public.request_client_ip()
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_xff text;
  v_parts text[];
begin
  v_xff := current_setting('request.headers', true)::json->>'x-forwarded-for';
  if v_xff is null or v_xff = '' then return null; end if;
  v_parts := string_to_array(v_xff, ',');
  return nullif(left(btrim(v_parts[array_length(v_parts, 1)]), 64), '');
exception when others then
  return null;
end;
$$;

-- ---- M1 : AdReels privés ----
alter table public.ad_reel_access_failures add column if not exists ip text;
create index if not exists ad_reel_access_failures_ip_idx on public.ad_reel_access_failures (owner_id, ad_reel_id, ip, at);

create or replace function public.check_ad_reel_secret(p_owner uuid, p_id text, p_secret text)
returns text  -- 'ok' | 'wrong' | 'throttled' | 'none'
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_ip text := coalesce(public.request_client_ip(), 'inconnue');
begin
  select * into a from public.ad_reel_access where owner_id = p_owner and ad_reel_id = p_id;
  if not found then return 'none'; end if;
  -- Frein par visiteur, puis plafond global (voir en-tête).
  if (select count(*) from public.ad_reel_access_failures
      where owner_id = p_owner and ad_reel_id = p_id and ip = v_ip and at > now() - interval '10 minutes') >= 10
     or (select count(*) from public.ad_reel_access_failures
      where owner_id = p_owner and ad_reel_id = p_id and at > now() - interval '10 minutes') >= 100 then
    return 'throttled';
  end if;
  if p_secret is not null and p_secret <> '' and public.ad_reel_secret_hash(a.salt, p_secret, a.iterations) = a.secret_hash then return 'ok'; end if;
  insert into public.ad_reel_access_failures (owner_id, ad_reel_id, ip) values (p_owner, p_id, v_ip);
  delete from public.ad_reel_access_failures where at < now() - interval '1 day';
  return 'wrong';
end;
$$;
revoke execute on function public.check_ad_reel_secret(uuid, text, text) from public, anon, authenticated;

-- ---- M1 : liens de relecture ----
alter table public.video_review_access_failures add column if not exists ip text;
create index if not exists video_review_access_failures_ip_idx on public.video_review_access_failures (capture_id, ip, at);

create or replace function public.video_review_capture(p_slug text, p_secret text)
returns text language plpgsql security definer set search_path = public as $$
declare
  l public.video_review_links;
  v_ip text := coalesce(public.request_client_ip(), 'inconnue');
begin
  if p_slug is null then return null; end if;
  select * into l from public.video_review_links where slug = p_slug and enabled;
  if not found then return null; end if;
  if (select count(*) from public.video_review_access_failures
      where capture_id = l.capture_id and ip = v_ip and at > now() - interval '10 minutes') >= 10
     or (select count(*) from public.video_review_access_failures
      where capture_id = l.capture_id and at > now() - interval '10 minutes') >= 100 then
    raise exception 'trop d''essais, réessayez dans quelques minutes' using hint = 'throttled';
  end if;
  if p_secret is not null and p_secret <> '' and public.ad_reel_secret_hash(l.salt, p_secret, l.iterations) = l.secret_hash then return l.capture_id; end if;
  insert into public.video_review_access_failures (capture_id, ip) values (l.capture_id, v_ip);
  delete from public.video_review_access_failures where at < now() - interval '1 day';
  return null;
end;
$$;
revoke all on function public.video_review_capture(text, text) from public, anon, authenticated;

-- ---- M4 ----
revoke execute on function public.submit_access_request(text, text, text) from public, anon, authenticated;

-- ---- M5 : réservation des dossiers d'envoi ----
create table if not exists public.media_prefix_claims (
  kind text not null check (kind in ('tracks', 'sfx_library', 'composer_videos')),
  entity_id text not null,
  composer_id uuid references public.composer_profiles(id) on delete cascade,
  studio_id uuid references public.studio_profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (kind, entity_id),
  check ((composer_id is null) <> (studio_id is null))
);
alter table public.media_prefix_claims enable row level security;
revoke all on public.media_prefix_claims from anon, authenticated;

-- Appelée par create-media-signed-url (clé de service) quand l'entité n'existe pas encore en base. Vrai si ce compte
-- détient (ou vient d'obtenir) la réservation, faux si un autre compte l'a déjà.
create or replace function public.claim_media_prefix(p_kind text, p_entity_id text, p_composer_id uuid, p_studio_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.media_prefix_claims;
begin
  if p_kind is null or p_entity_id is null or p_entity_id = '' or ((p_composer_id is null) = (p_studio_id is null)) then
    return false;
  end if;
  insert into public.media_prefix_claims (kind, entity_id, composer_id, studio_id)
  values (p_kind, p_entity_id, p_composer_id, p_studio_id)
  on conflict (kind, entity_id) do nothing;
  select * into c from public.media_prefix_claims where kind = p_kind and entity_id = p_entity_id;
  return c.composer_id is not distinct from p_composer_id and c.studio_id is not distinct from p_studio_id;
end;
$$;
revoke all on function public.claim_media_prefix(text, text, uuid, uuid) from public, anon, authenticated;
