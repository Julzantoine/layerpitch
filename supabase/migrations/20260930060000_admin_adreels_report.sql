-- LayerPitch — rapport des AdReels de tous les compositeurs, pour le panneau admin (4/10, demande de Jules-Antoine).
-- Une vue d'ensemble de ce que les bêta-testeurs ont publié : pour chaque compositeur, son nom d'adresse, son palier, le nombre
-- de morceaux, de packs, de collections et d'albums, la date de sa dernière publication et de sa dernière connexion, et ses
-- AdReels (nom, langue, nombre de morceaux, dernière modification, adresse). VOLONTAIREMENT SANS adresse e-mail et sans contenu
-- (titres de morceaux, textes) : uniquement des chiffres et de quoi retrouver la page publique. Réservé aux administrateurs.
create or replace function public.admin_adreels_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;
  return coalesce((
    select jsonb_agg(q.c order by q.published desc nulls last, q.c ->> 'handle')
    from (
      select s.published_at as published, jsonb_build_object(
        'handle', cp.handle,
        'plan', public.composer_effective_tier(cp.id),
        'createdAt', cp.created_at,
        'lastSignInAt', u.last_sign_in_at,
        'publishedAt', s.published_at,
        'tracks', (select count(*) from public.tracks t where t.owner_id = cp.id and t.retired_at is null),
        'packs', (select count(*) from public.packs p where p.owner_id = cp.id),
        'collections', (select count(*) from public.collections co where co.owner_id = cp.id),
        'albums', (select count(*) from public.albums a where a.seller_id = cp.profile_id),
        'adreels', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ar.id, 'label', ar.label, 'slug', ar.slug, 'lang', ar.lang, 'updatedAt', ar.updated_at,
            'tracks', (select count(*) from public.ad_reel_tracks art where art.ad_reel_id = ar.id and art.owner_id = ar.owner_id)
          ) order by ar.created_at)
          from public.ad_reels ar where ar.owner_id = cp.id
        ), '[]'::jsonb)
      ) as c
      from public.composer_profiles cp
      join public.profiles pr on pr.id = cp.profile_id and pr.deleted_at is null
      left join auth.users u on u.id = cp.profile_id
      left join public.settings s on s.owner_id = cp.id
      where cp.handle is not null
    ) q
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.admin_adreels_report() to authenticated;
