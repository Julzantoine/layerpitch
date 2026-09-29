-- LayerPitch — écoute libre d'un album sur sa page publique (29/09, décision de Jules-Antoine : « il faut demander au
-- compositeur s'il veut laisser tout l'album en libre écoute, ou quels morceaux »).
--
--   * albums.listen_mode : 'none' (par défaut : aucun morceau ne s'écoute avant l'achat), 'all' (tout l'album), 'selected'
--     (seulement les morceaux cochés, album_tracks.free_listen).
--   * set_album_listening : réglé par le VENDEUR de l'album (compositeur ou studio ; pour un album de studio c'est le
--     studio qui décide, y compris pour les morceaux des compositeurs invités).
--   * get_public_album renvoie listenMode et, pour chaque morceau, free (peut être écouté sans acheter).
-- Limite assumée : c'est un choix d'AFFICHAGE. Les morceaux restent lisibles publiquement (lecture publique des tables et
-- fichiers audio publics, comme pour les AdReels) : ce réglage ne protège pas contre quelqu'un qui irait chercher les
-- fichiers lui-même.

alter table public.albums add column listen_mode text not null default 'none' check (listen_mode in ('none', 'all', 'selected'));
alter table public.album_tracks add column free_listen boolean not null default false;

create or replace function public.set_album_listening(p_album_id text, p_mode text, p_track_ids text[] default array[]::text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_mode not in ('none', 'all', 'selected') then raise exception 'Réglage d''écoute invalide'; end if;
  if not exists (select 1 from public.albums where id = p_album_id and seller_id = auth.uid()) then
    raise exception 'Non autorisé : seul le vendeur de l''album règle l''écoute libre';
  end if;
  update public.albums set listen_mode = p_mode, updated_at = now() where id = p_album_id;
  update public.album_tracks set free_listen = (p_mode = 'selected' and track_id = any(coalesce(p_track_ids, array[]::text[])))
  where album_id = p_album_id;
end;
$$;
revoke execute on function public.set_album_listening(text, text, text[]) from public, anon;
grant execute on function public.set_album_listening(text, text, text[]) to authenticated;

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
    'sellerName', coalesce(v_name, ''), 'sellerRole', coalesce(a.seller_role, 'composer'), 'listenMode', a.listen_mode,
    'tracks', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title,
                 'free', (a.listen_mode = 'all' or (a.listen_mode = 'selected' and at.free_listen))) order by at.position), '[]'::jsonb)
               from public.album_tracks at join public.tracks t on t.id = at.track_id
               where at.album_id = a.id and at.removed_at is null));
end;
$$;
