-- LayerPitch — Adaptive OST : versions figées PAR MORCEAU (décision de Jules-Antoine du 25 septembre 2026).
--
-- Figer = enregistrer une PRISE : tout ce que le fan a joué sur un morceau (journal exact du lecteur,
-- LayerPlayerCore.getTrackTake), dont le rendu audio est identique à ce qu'il a entendu (LayerCaptureRender.renderTake).
-- Plusieurs prises d'un même morceau = plusieurs versions, rangées ensuite dans la bibliothèque (en playlist ou non)
-- et téléchargeables. La version officielle de l'album est elle-même une prise, celle du vendeur :
-- album_tracks.default_settings l'accueille (colonne existante, RPC set_album_track_default_settings inchangée).
--
-- Remplace album_freezes (une version figée d'un ALBUM ENTIER, conception du 21/09) : table supprimée ici, avec
-- freeze_my_album, pour ne pas garder deux notions de « version figée ». Garde-fou : la migration s'arrête si la
-- table contient déjà des versions (aucune n'a jamais été créée : aucune page ne l'appelait).
-- album_track_settings (réglages du fan d'une session à l'autre) est conservée pour plus tard.
--
-- Écriture uniquement par RPC SECURITY DEFINER, lecture par RLS « own » -- même convention que le reste du projet.
-- Accès gouverné par la possession de l'album (owns_album) : en bêta, seuls les admins possèdent des albums
-- (claim_test_album est réservé aux admins), donc pas de verrou supplémentaire à lever au lancement.

do $$
begin
  if to_regclass('public.album_freezes') is not null and exists (select 1 from public.album_freezes) then
    raise exception 'album_freezes contient des versions : migration arrêtée, rien n''a été supprimé (à examiner avant de continuer)';
  end if;
end $$;
drop function if exists public.freeze_my_album(text, text);
drop table if exists public.album_freezes;

create table if not exists public.album_track_versions (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  album_id text not null references public.albums(id) on delete cascade,
  track_id text not null references public.tracks(id) on delete cascade,
  name text not null default '',
  -- La prise elle-même : IMMUABLE (aucune RPC ne la modifie) -- son rendu audio est donc toujours le même,
  -- téléchargeable à volonté et stockable une fois rendu.
  take jsonb not null,
  created_at timestamptz not null default now()
);
comment on table public.album_track_versions is 'Versions figées d''un fan : une prise (journal exact du lecteur) par ligne, pour un morceau d''un album qu''il possède. Prise immuable ; seul le nom se modifie.';
create index if not exists album_track_versions_buyer_album_idx on public.album_track_versions(buyer_id, album_id, track_id, created_at desc);

alter table public.album_track_versions enable row level security;
drop policy if exists "own album track versions" on public.album_track_versions;
create policy "own album track versions" on public.album_track_versions for select using (auth.uid() = buyer_id);

-- Contrôle commun d'une prise soumise par un client : bonne forme, bon morceau, taille raisonnable (une prise de
-- plusieurs minutes pèse quelques dizaines de Ko ; 2 Mo laisse une marge très large sans ouvrir la porte à l'abus).
create or replace function public.check_take(p_take jsonb, p_track_id text)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_take is null or jsonb_typeof(p_take) <> 'object' or (p_take->>'kind') is distinct from 'layerpitch-take' then
    raise exception 'Prise invalide';
  end if;
  if p_take->>'trackId' is distinct from p_track_id then
    raise exception 'Cette prise ne correspond pas à ce morceau';
  end if;
  if octet_length(p_take::text) > 2000000 then
    raise exception 'Prise trop volumineuse';
  end if;
end;
$$;

-- Enregistre une nouvelle version d'un morceau (Figer). Renvoie son identifiant.
create or replace function public.save_my_track_version(p_album_id text, p_track_id text, p_name text, p_take jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not public.owns_album(p_album_id) then raise exception 'Non autorisé : tu ne possèdes pas cet album'; end if;
  if not exists (select 1 from public.album_tracks where album_id = p_album_id and track_id = p_track_id) then
    raise exception 'Ce morceau ne fait pas partie de cet album';
  end if;
  perform public.check_take(p_take, p_track_id);
  insert into public.album_track_versions (buyer_id, album_id, track_id, name, take)
  values (auth.uid(), p_album_id, p_track_id, left(coalesce(trim(p_name), ''), 120), p_take)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rename_my_track_version(p_version_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  update public.album_track_versions set name = left(coalesce(trim(p_name), ''), 120)
  where id = p_version_id and buyer_id = auth.uid();
  if not found then raise exception 'Version introuvable'; end if;
end;
$$;

create or replace function public.delete_my_track_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  delete from public.album_track_versions where id = p_version_id and buyer_id = auth.uid();
  if not found then raise exception 'Version introuvable'; end if;
end;
$$;

-- Tout ce qu'il faut pour afficher un album possédé : ses morceaux dans l'ordre, la version officielle du vendeur
-- (sa prise, ou null s'il n'en a pas encore enregistré) et les versions du fan, les plus récentes d'abord.
create or replace function public.get_my_album_versions(p_album_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not public.owns_album(p_album_id) then raise exception 'Non autorisé : tu ne possèdes pas cet album'; end if;
  return jsonb_build_object(
    'tracks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'trackId', at.track_id, 'position', at.position,
        'official', case when at.default_settings->>'kind' = 'layerpitch-take' then at.default_settings else null end
      ) order by at.position), '[]'::jsonb)
      from public.album_tracks at where at.album_id = p_album_id
    ),
    'versions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'trackId', v.track_id, 'name', v.name, 'take', v.take, 'createdAt', v.created_at
      ) order by v.created_at desc), '[]'::jsonb)
      from public.album_track_versions v where v.buyer_id = auth.uid() and v.album_id = p_album_id
    )
  );
end;
$$;

revoke all on function public.check_take(jsonb, text), public.save_my_track_version(text, text, text, jsonb),
  public.rename_my_track_version(uuid, text), public.delete_my_track_version(uuid), public.get_my_album_versions(text)
  from public, anon;
grant execute on function public.save_my_track_version(text, text, text, jsonb) to authenticated;
grant execute on function public.rename_my_track_version(uuid, text) to authenticated;
grant execute on function public.delete_my_track_version(uuid) to authenticated;
grant execute on function public.get_my_album_versions(text) to authenticated;
