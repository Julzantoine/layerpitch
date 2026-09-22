-- LayerPitch — Adaptive OST, côté FAN : réglages par album, versions figées, réglages par défaut du vendeur.
-- Suite de 20260921070000 (modèle vendeur) et 20260921080000 (upsert_album / achat de test).
--
-- Adapté de la branche claude/adaptive-ost-architecture-sy68is (20260910120100 + 20260910130000),
-- avec DEUX changements de conception décidés le 21 septembre avec Jules-Antoine :
--
-- 1. Les réglages d'un fan sont rangés PAR ALBUM (« mes réglages de cet album », une version par
--    morceau) — pas par playlist comme sur la branche. Les playlists (réglages propres, cross-albums)
--    viendront plus tard, sans dépendre de cette table.
-- 2. « Figer » = instantané de réglages (comme sur la branche), MAIS le fan pourra aussi télécharger
--    ses versions figées à volonté (rendu audio, chantier séparé — voir album_freezes ci-dessous :
--    le snapshot est IMMUABLE, ce qui rend le rendu reproductible et cachable).
--
-- Forme des réglages (`settings`) : laissée au moteur (player.js getTrackSettings/applyTrackSettings),
-- sans contrainte ici — même principe que tracks.layers/sections/loops (Décision 1 du schéma initial).
--
-- Écriture uniquement par RPC SECURITY DEFINER (aucun GRANT INSERT/UPDATE/DELETE direct), lecture par
-- RLS « own » — même convention que le reste du projet.
--
-- VERROU BÊTA : les RPC vendeur (set_album_track_default_settings) sont réservées aux admins, comme
-- upsert_album. Côté fan, l'accès est gouverné par la possession de l'album (album_purchases), et
-- comme seuls les admins peuvent en obtenir en bêta (claim_test_album), il n'y a pas de verrou à part.

-- ============================================================================
-- Réglages par défaut proposés par le vendeur (point de départ de chaque fan)
-- ============================================================================
-- Porté par album_tracks (l'association album+piste), pas par tracks : la même piste peut avoir une
-- ambiance par défaut différente selon l'album où elle est vendue.
alter table public.album_tracks
  add column default_settings jsonb not null default '{}'::jsonb;
comment on column public.album_tracks.default_settings is 'Réglages par défaut choisis par le vendeur pour cette piste dans cet album. Point de départ de tout fan qui n''a pas encore réglé cette piste (voir get_my_album_settings).';

-- Le fan ne peut lire que ce qui lui appartient ; cette fonction sert de garde commune aux RPC ci-dessous.
create or replace function public.owns_album(p_album_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.album_purchases where buyer_id = auth.uid() and album_id = p_album_id);
$$;
grant execute on function public.owns_album(text) to authenticated;

-- ============================================================================
-- Réglages du fan, par album et par morceau
-- ============================================================================
create table public.album_track_settings (
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  album_id text not null references public.albums(id) on delete cascade,
  track_id text not null references public.tracks(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (buyer_id, album_id, track_id)
);
comment on table public.album_track_settings is 'Réglages personnels d''un fan pour un morceau d''un album qu''il possède. Absence de ligne = il n''a rien changé (on retombe sur album_tracks.default_settings).';

-- ============================================================================
-- Versions figées : instantanés IMMUABLES de tous les réglages d'un album
-- ============================================================================
-- Append-only par construction (aucune RPC de modification). Immuable = le rendu audio d'une version
-- figée est toujours le même, donc téléchargeable à volonté et cachable une fois généré.
create table public.album_freezes (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  album_id text not null references public.albums(id) on delete cascade,
  name text not null default '',
  -- Construit côté serveur par freeze_my_album() à partir de l'état réel, jamais soumis par le
  -- client (un fan ne peut pas « figer » un état qu'il n'a pas atteint). Forme :
  -- [{trackId, position, settings}, ...]
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index album_freezes_buyer_album_idx on public.album_freezes(buyer_id, album_id, created_at desc);

alter table public.album_track_settings enable row level security;
alter table public.album_freezes enable row level security;
create policy "own album track settings" on public.album_track_settings for select using (auth.uid() = buyer_id);
create policy "own album freezes" on public.album_freezes for select using (auth.uid() = buyer_id);

-- ============================================================================
-- RPC fan
-- ============================================================================

-- Réglages effectifs de tous les morceaux d'un album : ceux du fan s'il en a, sinon les défauts du vendeur.
create or replace function public.get_my_album_settings(p_album_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not public.owns_album(p_album_id) then
    raise exception 'Non autorisé : tu ne possèdes pas cet album';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'trackId', at.track_id,
      'position', at.position,
      'settings', coalesce(s.settings, at.default_settings),
      'isCustom', s.settings is not null
    ) order by at.position), '[]'::jsonb)
    from public.album_tracks at
    left join public.album_track_settings s
      on s.buyer_id = auth.uid() and s.album_id = at.album_id and s.track_id = at.track_id
    where at.album_id = p_album_id
  );
end;
$$;

-- Écrase entièrement les réglages d'un morceau (le client envoie toujours l'état complet renvoyé par
-- getTrackSettings(), jamais un diff).
create or replace function public.set_my_album_track_settings(p_album_id text, p_track_id text, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not public.owns_album(p_album_id) then
    raise exception 'Non autorisé : tu ne possèdes pas cet album';
  end if;
  if not exists (select 1 from public.album_tracks where album_id = p_album_id and track_id = p_track_id) then
    raise exception 'Ce morceau ne fait pas partie de cet album';
  end if;
  insert into public.album_track_settings (buyer_id, album_id, track_id, settings, updated_at)
  values (auth.uid(), p_album_id, p_track_id, coalesce(p_settings, '{}'::jsonb), now())
  on conflict (buyer_id, album_id, track_id) do update
    set settings = excluded.settings, updated_at = now();
end;
$$;

-- Retour aux réglages par défaut du vendeur pour un morceau.
create or replace function public.reset_my_album_track_settings(p_album_id text, p_track_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  delete from public.album_track_settings
  where buyer_id = auth.uid() and album_id = p_album_id and track_id = p_track_id;
end;
$$;

-- « Figer » : instantané des réglages EFFECTIFS (réglages du fan, sinon défauts du vendeur) de tous les
-- morceaux de l'album à cet instant.
create or replace function public.freeze_my_album(p_album_id text, p_name text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not public.owns_album(p_album_id) then
    raise exception 'Non autorisé : tu ne possèdes pas cet album';
  end if;
  v_snapshot := public.get_my_album_settings(p_album_id);
  if jsonb_array_length(v_snapshot) = 0 then
    raise exception 'Cet album ne contient aucun morceau à figer';
  end if;
  -- get_my_album_settings porte aussi 'isCustom' : inutile dans un instantané (un fait sur l'état
  -- passé, pas sur le rendu) — on ne garde que ce qui définit le rendu.
  select coalesce(jsonb_agg(jsonb_build_object('trackId', e->'trackId', 'position', e->'position', 'settings', e->'settings')
                            order by (e->>'position')::int), '[]'::jsonb)
  into v_snapshot
  from jsonb_array_elements(v_snapshot) e;

  insert into public.album_freezes (buyer_id, album_id, name, snapshot)
  values (auth.uid(), p_album_id, coalesce(p_name, ''), v_snapshot)
  returning id into v_id;
  return v_id;
end;
$$;

-- ============================================================================
-- RPC vendeur : réglages par défaut d'un morceau dans son album
-- ============================================================================
create or replace function public.set_album_track_default_settings(p_album_id text, p_track_id text, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Non autorisé : connexion requise'; end if;
  -- VERROU BÊTA, jumeau de celui d'upsert_album (à retirer au même moment).
  if not public.is_admin() then
    raise exception 'Non autorisé : la fonction album est réservée aux administrateurs pendant la bêta';
  end if;
  update public.album_tracks at
  set default_settings = coalesce(p_settings, '{}'::jsonb)
  where at.album_id = p_album_id and at.track_id = p_track_id
    and exists (select 1 from public.albums a where a.id = at.album_id and a.seller_id = auth.uid());
  if not found then
    raise exception 'Non autorisé : morceau introuvable dans cet album, ou album appartenant à un autre vendeur';
  end if;
end;
$$;

revoke all on function public.get_my_album_settings(text), public.set_my_album_track_settings(text, text, jsonb),
  public.reset_my_album_track_settings(text, text), public.freeze_my_album(text, text),
  public.set_album_track_default_settings(text, text, jsonb), public.owns_album(text) from public, anon;
grant execute on function public.get_my_album_settings(text) to authenticated;
grant execute on function public.set_my_album_track_settings(text, text, jsonb) to authenticated;
grant execute on function public.reset_my_album_track_settings(text, text) to authenticated;
grant execute on function public.freeze_my_album(text, text) to authenticated;
grant execute on function public.set_album_track_default_settings(text, text, jsonb) to authenticated;
grant execute on function public.owns_album(text) to authenticated;
