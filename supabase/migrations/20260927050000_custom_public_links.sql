-- LayerPitch — adresses publiques personnalisables (demande de Jules-Antoine du 27/09).
--
-- Décisions du 27/09 :
--   - le compositeur choisit son NOM dans l'adresse (beta.layerpitch.com/<nom>/, jusqu'ici tiré de son email) ET le
--     nom de chaque AdReel (beta.layerpitch.com/<nom>/<adreel>, au lieu de ?adreel=<code>) ;
--   - un lien déjà partagé ne casse JAMAIS : l'ancien nom (du compositeur ou de l'AdReel) reste réservé à ce
--     compositeur et mène à la nouvelle adresse, pour toujours.
-- Réservé à l'admin pendant la bêta (is_admin() dans set_my_handle / set_my_ad_reel_slug, à retirer au feu vert) ; la
-- RÉSOLUTION des adresses, elle, fonctionne pour tout le monde.
--
-- Pages : 404.html traduit /<nom>/<adreel> en index.html?u=<nom>&s=<adreel> ; index.html appelle resolve_public_link
-- puis remet l'adresse à jour dans la barre si elle a changé. pack/collection passent par resolve_composer_handle,
-- qui reconnaît désormais aussi les anciens noms.

alter table public.ad_reels add column if not exists slug text;
alter table public.ad_reels drop constraint if exists ad_reels_slug_format;
alter table public.ad_reels add constraint ad_reels_slug_format check (slug is null or slug ~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$');
create unique index if not exists ad_reels_owner_slug_idx on public.ad_reels(owner_id, slug) where slug is not null;

-- Anciens noms de compositeur : réservés à leur ancien titulaire, mènent à son adresse actuelle.
create table if not exists public.composer_handle_aliases (
  handle text primary key,
  composer_id uuid not null references public.composer_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- Anciens noms d'AdReel, par compositeur : mènent à l'AdReel qui les portait.
create table if not exists public.ad_reel_slug_aliases (
  owner_id uuid not null,
  slug text not null,
  ad_reel_id text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, slug),
  foreign key (owner_id, ad_reel_id) references public.ad_reels(owner_id, id) on delete cascade
);
alter table public.composer_handle_aliases enable row level security;
alter table public.ad_reel_slug_aliases enable row level security;

-- Noms interdits : tout ce que le site sert lui-même à la racine (pages, dossiers) -- sinon GitHub Pages répondrait
-- avant 404.html et l'adresse ne mènerait jamais au compositeur.
create or replace function public.handle_is_reserved(p_handle text)
returns boolean
language sql
immutable
as $$
  select p_handle = any(array[
    'index','pack','collection','admin','admin-beta-console','admin-analytics','bienvenue','landing','landing-en',
    'layerpitch-backstage','library','mes-albums','mon-compte','video-test','video-engine-prototype','404',
    'api','audio','images','fonts','video','vendor','sandbox','scripts','supabase','docs','data','u','landing-assets',
    'node_modules','assets','static','www','app','beta','layerpitch','help','aide','support','contact','login','signup'
  ]);
$$;

-- Nom de compositeur (actuel ou ancien) -> compositeur. Remplace la version du 03/09 : reconnaît aussi les anciens noms.
create or replace function public.resolve_composer_handle(p_handle text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select id from public.composer_profiles where handle = lower(p_handle)),
    (select composer_id from public.composer_handle_aliases where handle = lower(p_handle))
  );
$$;
grant execute on function public.resolve_composer_handle(text) to anon, authenticated;

-- Adresse publique complète -> { ownerId, handle (actuel), adReelId, slug (actuel) } ; null si le nom est inconnu.
-- p_slug vide = AdReel principal. Un slug inconnu renvoie adReelId null (la page affiche l'AdReel principal).
create or replace function public.resolve_public_link(p_handle text, p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.resolve_composer_handle(p_handle);
  v_handle text;
  v_ar text;
  v_slug text := nullif(lower(trim(coalesce(p_slug, ''))), '');
begin
  if v_owner is null then return null; end if;
  select handle into v_handle from public.composer_profiles where id = v_owner;
  if v_slug is not null then
    select id into v_ar from public.ad_reels where owner_id = v_owner and slug = v_slug;
    if v_ar is null then
      select ad_reel_id into v_ar from public.ad_reel_slug_aliases where owner_id = v_owner and slug = v_slug;
    end if;
  end if;
  return jsonb_build_object(
    'ownerId', v_owner, 'handle', v_handle, 'adReelId', v_ar,
    'slug', (select slug from public.ad_reels where owner_id = v_owner and id = v_ar)
  );
end;
$$;
grant execute on function public.resolve_public_link(text, text) to anon, authenticated;

-- Changer son nom de compositeur. Format : 3 à 30 caractères, minuscules, chiffres, tirets (pas en bord).
create or replace function public.set_my_handle(p_handle text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_composer_id();
  v_new text := lower(trim(coalesce(p_handle, '')));
  v_old text;
begin
  if v_me is null then raise exception 'Non autorisé : aucun profil compositeur associé à ce compte'; end if;
  -- VERROU BÊTA (27/09) : à retirer au feu vert de Jules-Antoine.
  if not public.is_admin() then raise exception 'Non autorisé : réservé aux administrateurs pendant la bêta'; end if;
  if v_new !~ '^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$' then
    raise exception 'Nom invalide : 3 à 30 caractères, lettres minuscules, chiffres et tirets (pas au début ni à la fin)' using hint = 'invalid';
  end if;
  if public.handle_is_reserved(v_new) then raise exception 'Ce nom est réservé par LayerPitch' using hint = 'reserved'; end if;
  select handle into v_old from public.composer_profiles where id = v_me;
  if v_old = v_new then return v_new; end if;
  if exists (select 1 from public.composer_profiles where handle = v_new and id <> v_me)
     or exists (select 1 from public.composer_handle_aliases where handle = v_new and composer_id <> v_me) then
    raise exception 'Ce nom est déjà pris' using hint = 'taken';
  end if;
  -- Son propre ancien nom redevient le nom actuel : il quitte les anciens noms.
  delete from public.composer_handle_aliases where handle = v_new and composer_id = v_me;
  update public.composer_profiles set handle = v_new where id = v_me;
  if v_old is not null then
    insert into public.composer_handle_aliases (handle, composer_id) values (v_old, v_me) on conflict (handle) do nothing;
  end if;
  return v_new;
end;
$$;

-- Nom d'un AdReel dans l'adresse. Vide = plus de nom (retour à ?adreel=<code>, l'ancien nom continue de mener ici).
-- L'AdReel principal ('main') vit à la racine /<nom>/ : pas de nom à lui donner.
create or replace function public.set_my_ad_reel_slug(p_ad_reel_id text, p_slug text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_composer_id();
  v_new text := nullif(lower(trim(coalesce(p_slug, ''))), '');
  v_old text;
  v_alias_owner text;
begin
  if v_me is null then raise exception 'Non autorisé : aucun profil compositeur associé à ce compte'; end if;
  -- VERROU BÊTA (27/09) : à retirer au feu vert de Jules-Antoine.
  if not public.is_admin() then raise exception 'Non autorisé : réservé aux administrateurs pendant la bêta'; end if;
  if p_ad_reel_id = 'main' then raise exception 'L''AdReel principal est à la racine de ton adresse' using hint = 'main'; end if;
  if not exists (select 1 from public.ad_reels where owner_id = v_me and id = p_ad_reel_id) then
    raise exception 'AdReel introuvable : publie-le d''abord' using hint = 'unpublished';
  end if;
  if v_new is not null and v_new !~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$' then
    raise exception 'Nom invalide : lettres minuscules, chiffres et tirets (pas au début ni à la fin), 60 caractères au plus' using hint = 'invalid';
  end if;
  select slug into v_old from public.ad_reels where owner_id = v_me and id = p_ad_reel_id;
  if v_old is not distinct from v_new then return v_new; end if;
  if v_new is not null then
    if exists (select 1 from public.ad_reels where owner_id = v_me and slug = v_new and id <> p_ad_reel_id) then
      raise exception 'Un autre de tes AdReels porte déjà ce nom' using hint = 'taken';
    end if;
    select ad_reel_id into v_alias_owner from public.ad_reel_slug_aliases where owner_id = v_me and slug = v_new;
    if v_alias_owner is not null and v_alias_owner <> p_ad_reel_id then
      raise exception 'Ce nom mène déjà à un autre de tes AdReels (ancienne adresse gardée pour les liens partagés)' using hint = 'alias';
    end if;
    delete from public.ad_reel_slug_aliases where owner_id = v_me and slug = v_new;
  end if;
  update public.ad_reels set slug = v_new where owner_id = v_me and id = p_ad_reel_id;
  if v_old is not null then
    insert into public.ad_reel_slug_aliases (owner_id, slug, ad_reel_id) values (v_me, v_old, p_ad_reel_id) on conflict do nothing;
  end if;
  return v_new;
end;
$$;

revoke all on function public.set_my_handle(text), public.set_my_ad_reel_slug(text, text) from public, anon;
grant execute on function public.set_my_handle(text) to authenticated;
grant execute on function public.set_my_ad_reel_slug(text, text) to authenticated;
