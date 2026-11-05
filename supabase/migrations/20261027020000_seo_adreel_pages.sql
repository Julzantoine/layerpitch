-- LayerPitch — AdReels trouvables sur Google et par les IA de recherche (27/10, chantier SEO/GEO).
--
-- Les pages publiques se construisent en JavaScript et les adresses /<nom>/ répondent « 404 » (rattrapées par 404.html) :
-- Google les écarte, les robots des IA n'y voient rien. Le Worker Cloudflare (cloudflare/apercu-liens-worker.mjs) sert
-- désormais aux MOTEURS DE RECHERCHE une vraie page (code 200) avec le même contenu que celle des visiteurs, et publie un
-- plan du site des AdReels (/sitemap-adreels.xml). Ces deux fonctions publiques lui donnent ce qu'il lui faut.
--
-- Qui est concerné : un AdReel public (access_mode = 'public') dont la case existante « Indexable par les moteurs de
-- recherche » est cochée (ad_reels.allow_indexing, migration 20260916050000, cochée par défaut — décision de Jules-Antoine
-- du 27/10 : on la garde telle quelle). Aucune table ni colonne nouvelle.
-- Admin seulement jusqu'au feu vert (seuls les AdReels des comptes admin sont servis aux moteurs) :
--   select public.set_feature_released('search_indexing', true);

insert into public.feature_flags (key, description) values
  ('search_indexing', 'AdReels trouvables par Google et les IA de recherche (27/10) — le Worker Cloudflare sert une vraie page aux moteurs et publie /sitemap-adreels.xml, pour les AdReels publics dont la case « Indexable » est cochée ; admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;

-- Adresse publique d'un AdReel, identique à computeAdReelUrl() du Backstage : /<nom>/, /<nom>/<adresse> ou /<nom>/?adreel=<code>.
create or replace function public.seo_adreel_path(p_handle text, p_id text, p_slug text)
returns text
language sql
immutable
as $$
  select case when p_id = 'main' then '/' || p_handle || '/'
              when nullif(p_slug, '') is not null then '/' || p_handle || '/' || p_slug
              else '/' || p_handle || '/?adreel=' || p_id end;
$$;

-- AdReel servi aux moteurs ? (public, case cochée, compositeur avec un nom, feu vert ouvert pour lui)
create or replace function public.seo_adreel_allowed(p_owner uuid, p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ad_reels ar join public.composer_profiles cp on cp.id = ar.owner_id
    where ar.owner_id = p_owner and ar.id = p_id and ar.access_mode = 'public' and ar.allow_indexing
      and cp.handle is not null and public.feature_released('search_indexing', cp.profile_id));
$$;
revoke execute on function public.seo_adreel_allowed(uuid, text) from public, anon, authenticated;

-- Page d'un AdReel pour les moteurs : l'aperçu public (titre, description, image, langue) + adresse officielle + titres des
-- morceaux. null si l'AdReel n'est pas servi aux moteurs (le Worker laisse alors passer la requête comme avant).
create or replace function public.get_seo_adreel_page(p_handle text, p_ref text default null, p_alt text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_link jsonb := public.resolve_public_link(p_handle, coalesce(p_ref, ''));
  v_owner uuid;
  v_ar text;
  r record;
  v_tracks jsonb;
begin
  if v_link is null then return null; end if;
  -- Adresse /<nom>/<inconnue> : pas de repli sur l'AdReel principal.
  if nullif(p_ref, '') is not null and v_link ->> 'adReelId' is null and nullif(p_alt, '') is null then return null; end if;
  v_owner := (v_link ->> 'ownerId')::uuid;
  v_ar := coalesce(nullif(p_alt, ''), v_link ->> 'adReelId', 'main');
  if not public.seo_adreel_allowed(v_owner, v_ar) then return null; end if;
  select id, slug, updated_at into r from public.ad_reels where owner_id = v_owner and id = v_ar;
  select coalesce(jsonb_agg(t.title order by art.position), '[]'::jsonb) into v_tracks
    from public.ad_reel_tracks art join public.tracks t on t.id = art.track_id and t.owner_id = art.owner_id
    where art.owner_id = v_owner and art.ad_reel_id = v_ar and trim(t.title) <> '';
  return public.get_share_preview('adreel', p_handle, coalesce(p_ref, ''), v_ar)
    || jsonb_build_object('handle', v_link ->> 'handle', 'path', public.seo_adreel_path(v_link ->> 'handle', r.id, r.slug),
                          'tracks', v_tracks, 'updatedAt', r.updated_at);
end;
$$;
grant execute on function public.get_seo_adreel_page(text, text, text) to anon, authenticated;

-- Plan du site des AdReels servis aux moteurs : [{ path, updatedAt }].
create or replace function public.list_seo_adreels()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('path', public.seo_adreel_path(cp.handle, ar.id, ar.slug), 'updatedAt', ar.updated_at)
                            order by cp.handle, ar.id), '[]'::jsonb)
  from public.ad_reels ar join public.composer_profiles cp on cp.id = ar.owner_id
  where public.seo_adreel_allowed(ar.owner_id, ar.id);
$$;
grant execute on function public.list_seo_adreels() to anon, authenticated;
