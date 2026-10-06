-- LayerPitch — page « Shop » (29/09, demande de Jules-Antoine) : une page publique, deux rayons — « Assets audio » (packs
-- de musiques et Sfx, pour les studios et game devs) et « OST adaptive » (albums, pour les fans). Remplace le catalogue.
--
--   * Feu vert 'shop' (admin seulement pendant la bêta). shop_status() dit si le shop est ouvert POUR L'APPELANT (ouvert
--     pour tous, ou appelant administrateur) ; sans compte, il n'est ouvert qu'une fois le feu vert donné.
--   * albums.shop_listed : « Afficher dans le shop », choisi par le vendeur (défaut : non ; un album en vente reste
--     accessible par son lien sans figurer dans le shop). Les packs ont déjà packs.catalog_listed.
--   * shop_albums() : les albums en vente, affichés et avec un prix, avec le nom du vendeur (AdReel principal ou identifiant
--     du compositeur ; nom du studio pour un studio). Vide tant que le shop n'est pas ouvert pour l'appelant.
--   * Les packs du shop viennent de catalog_packs() (inchangé).

insert into public.feature_flags (key, description) values
  ('shop', 'Page Shop publique (packs et OST adaptive), 29/09. Admin seulement pendant la bêta : À OUVRIR AU LANCEMENT.')
on conflict (key) do nothing;

alter table public.albums add column shop_listed boolean not null default false;
comment on column public.albums.shop_listed is 'Afficher l''album dans le Shop (choix du vendeur). Il faut aussi qu''il soit en vente (buyable).';

create or replace function public.shop_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('open', coalesce((select f.released from public.feature_flags f where f.key = 'shop'), false)
                                    or (auth.uid() is not null and exists (select 1 from public.admins a where a.profile_id = auth.uid())));
$$;
grant execute on function public.shop_status() to anon, authenticated;

create or replace function public.album_seller_name(p_seller uuid, p_role text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when p_role = 'studio'
    then (select sp.display_name from public.studio_profiles sp where sp.profile_id = p_seller)
    else coalesce(nullif((select r.profile->>'title' from public.ad_reels r join public.composer_profiles c on c.id = r.owner_id
                          where c.profile_id = p_seller order by (r.id = 'main') desc, r.created_at limit 1), ''),
                  (select c.handle from public.composer_profiles c where c.profile_id = p_seller)) end;
$$;
revoke execute on function public.album_seller_name(uuid, text) from public, anon, authenticated;
grant execute on function public.album_seller_name(uuid, text) to service_role;

create or replace function public.shop_albums()
returns table (
  id text, title text, illustration text, tags text[], price_eur_cents int, seller_name text, seller_role text,
  track_count int, free_track_count int, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce((public.shop_status()->>'open')::boolean, false) then return; end if;
  return query
    select a.id, a.title, a.illustration, a.tags, a.price_eur_cents, coalesce(public.album_seller_name(a.seller_id, a.seller_role), ''),
           coalesce(a.seller_role, 'composer'),
           (select count(*)::int from public.album_tracks at where at.album_id = a.id and at.removed_at is null),
           (select count(*)::int from public.album_tracks at where at.album_id = a.id and at.removed_at is null
              and (a.listen_mode = 'all' or (a.listen_mode = 'selected' and at.free_listen))),
           a.updated_at
    from public.albums a
    where a.buyable and a.shop_listed and a.price_eur_cents is not null
    order by a.updated_at desc;
end;
$$;
grant execute on function public.shop_albums() to anon, authenticated;

create or replace function public.set_album_shop_listed(p_album_id text, p_listed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.albums set shop_listed = coalesce(p_listed, false), updated_at = now() where id = p_album_id and seller_id = auth.uid();
  if not found then raise exception 'Non autorisé : seul le vendeur de l''album choisit de l''afficher dans le shop'; end if;
end;
$$;
revoke execute on function public.set_album_shop_listed(text, boolean) from public, anon;
grant execute on function public.set_album_shop_listed(text, boolean) to authenticated;

-- « shop » devient un nom réservé (adresse /shop) : aucun compositeur ne peut le prendre comme identifiant.
create or replace function public.handle_is_reserved(p_handle text)
returns boolean
language sql
immutable
as $$
  select p_handle = any(array[
    'index','pack','collection','admin','admin-beta-console','admin-analytics','bienvenue','landing','landing-en',
    'layerpitch-backstage','library','mes-albums','mon-compte','video-test','video-engine-prototype','404',
    'api','audio','images','fonts','video','vendor','sandbox','scripts','supabase','docs','data','u','landing-assets',
    'node_modules','assets','static','www','app','beta','layerpitch','help','aide','support','contact','login','signup',
    'vitrine','projet','projets','studio','catalogue','tarifs','invitation','album','shop'
  ]);
$$;
