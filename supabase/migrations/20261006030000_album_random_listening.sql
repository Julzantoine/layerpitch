-- LayerPitch — le « dé » des albums (6 octobre) : écoute aléatoire à chaque écoute, décidée par le compositeur pour chaque album.
--   * albums.allow_random : le vendeur autorise (ou non) le fan à écouter les morceaux « vivants » (tirage neuf à chaque écoute) à la place
--     de la version figée. Non par défaut : certains compositeurs veulent qu'on entende l'œuvre telle qu'écrite.
--   * set_album_random : réglé par le VENDEUR de l'album (compositeur ou studio), comme set_album_listening.
-- Le choix du fan (dé allumé ou non, par album et par morceau) reste dans son navigateur : aucune donnée de plus en base.

alter table public.albums add column allow_random boolean not null default false;
comment on column public.albums.allow_random is 'Le fan peut écouter les morceaux en version aléatoire (le dé). Réglé par le vendeur, set_album_random.';

create or replace function public.set_album_random(p_album_id text, p_allow boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.albums where id = p_album_id and seller_id = auth.uid()) then
    raise exception 'Non autorisé : seul le vendeur de l''album règle l''écoute aléatoire';
  end if;
  update public.albums set allow_random = coalesce(p_allow, false), updated_at = now() where id = p_album_id;
end;
$$;
revoke execute on function public.set_album_random(text, boolean) from public, anon;
grant execute on function public.set_album_random(text, boolean) to authenticated;
