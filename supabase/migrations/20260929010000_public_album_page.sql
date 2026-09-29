-- LayerPitch — page publique d'album (/album/<id>, album.html), sans connexion.
--
--   * get_public_album(album) : un album EN VENTE (buyable) avec sa pochette, sa présentation, son prix minimum, ses
--     morceaux (titre seulement, dans l'ordre, sans ceux retirés de l'album) et le nom du vendeur. Renvoie null si
--     l'album n'existe pas ou n'est pas en vente : une page publique ne révèle jamais un album non publié.
--     Le nom du vendeur = titre de son AdReel principal, à défaut son identifiant public ; pour un studio, « Studio »
--     tant que les studios n'ont pas de nom public (vente d'OST par un studio : chantier suivant).
--   * « album » devient un nom réservé (comme « vitrine ») : aucun compositeur ne peut le prendre comme identifiant.
--   * Le bouton « Acheter » de la page appelle claim_test_album (achat factice, réservé à l'admin pendant la bêta).

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
    v_name := 'Studio';
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
grant execute on function public.get_public_album(text) to anon, authenticated;

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
    'vitrine','projet','projets','studio','catalogue','tarifs','invitation','album'
  ]);
$$;
