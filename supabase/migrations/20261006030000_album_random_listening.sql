-- LayerPitch — le « dé » des albums (6 octobre) : écoute aléatoire à chaque écoute, décidée par le compositeur pour chaque album.
--   * albums.allow_random : le vendeur autorise (ou non) le fan à écouter les morceaux « vivants » (tirage neuf à chaque écoute) à la place
--     de la version figée. Non par défaut : certains compositeurs veulent qu'on entende l'œuvre telle qu'écrite.
--   * set_album_random : réglé par le VENDEUR de l'album (compositeur ou studio), comme set_album_listening.
--   * album_fan_prefs / get_my_album_prefs / set_my_album_prefs : le CHOIX du fan (dé de l'album allumé ou non, et par morceau « allumé » ou
--     « éteint » pour surcharger celui de l'album), rangé en base par compte et par album -- il suit le fan d'un appareil à l'autre
--     (navigateur, future application). Séparé de album_track_settings, qui sert à la prise figée et se remplace d'un bloc.

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

-- ---- Préférences du fan, par album ----
create table public.album_fan_prefs (
  buyer_id uuid not null references auth.users(id) on delete cascade,
  album_id text not null references public.albums(id) on delete cascade,
  dice boolean not null default false,
  track_dice jsonb not null default '{}'::jsonb,  -- { "<id du morceau>": "on" | "off" }
  updated_at timestamptz not null default now(),
  primary key (buyer_id, album_id)
);
comment on table public.album_fan_prefs is 'Choix du fan pour un album qu''il possède : dé de l''album et dé par morceau (écoute aléatoire).';
alter table public.album_fan_prefs enable row level security;
revoke all on public.album_fan_prefs from anon, authenticated;

create or replace function public.get_my_album_prefs(p_album_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not public.owns_album(p_album_id) then raise exception 'Non autorisé : tu ne possèdes pas cet album'; end if;
  select dice, track_dice into r from public.album_fan_prefs where buyer_id = auth.uid() and album_id = p_album_id;
  return jsonb_build_object('dice', coalesce(r.dice, false), 'tracks', coalesce(r.track_dice, '{}'::jsonb));
end;
$$;
revoke execute on function public.get_my_album_prefs(text) from public, anon;
grant execute on function public.get_my_album_prefs(text) to authenticated;

-- Remplace les préférences de ce fan pour cet album. p_tracks : { "<morceau>": "on" | "off" } (les morceaux inconnus de l'album sont ignorés).
create or replace function public.set_my_album_prefs(p_album_id text, p_dice boolean, p_tracks jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_clean jsonb;
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not public.owns_album(p_album_id) then raise exception 'Non autorisé : tu ne possèdes pas cet album'; end if;
  if p_tracks is not null and jsonb_typeof(p_tracks) <> 'object' then raise exception 'Préférences invalides'; end if;
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_clean
    from jsonb_each(coalesce(p_tracks, '{}'::jsonb)) e
    where e.value in ('"on"'::jsonb, '"off"'::jsonb)
      and exists (select 1 from public.album_tracks at where at.album_id = p_album_id and at.track_id = e.key);
  insert into public.album_fan_prefs (buyer_id, album_id, dice, track_dice, updated_at)
  values (auth.uid(), p_album_id, coalesce(p_dice, false), v_clean, now())
  on conflict (buyer_id, album_id) do update set dice = excluded.dice, track_dice = excluded.track_dice, updated_at = now();
end;
$$;
revoke execute on function public.set_my_album_prefs(text, boolean, jsonb) from public, anon;
grant execute on function public.set_my_album_prefs(text, boolean, jsonb) to authenticated;

-- ---- Suppression de compte : les préférences du fan partent avec lui ----
-- Le compte supprimé reste en « suppression douce » (la ligne d'identité survit, adresse e-mail effacée) : la cascade ne se déclencherait pas.
-- finalize_account_deletion (20260929070000) est gardée sous un autre nom et précédée de l'effacement de cette table.
alter function public.finalize_account_deletion(uuid) rename to finalize_account_deletion_core;
revoke execute on function public.finalize_account_deletion_core(uuid) from public, anon, authenticated, service_role;

create or replace function public.finalize_account_deletion(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.album_fan_prefs where buyer_id = p_profile;
  return public.finalize_account_deletion_core(p_profile);
end;
$$;
revoke execute on function public.finalize_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.finalize_account_deletion(uuid) to service_role;
