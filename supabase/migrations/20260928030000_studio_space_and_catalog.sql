-- LayerPitch — chantier profils et permissions, étape 3 (28 septembre) : espace studio gratuit (SoloDev) et catalogue
-- public de packs. Référence : layerpitch-docs/2026-09-27-cadrage-profils-permissions.md (D2, D9, D13, D33, D34).
--
-- 1. packs.catalog_listed (D34) : « Afficher dans le catalogue », vrai par défaut. Un pack apparaît au catalogue public
--    s'il est en vente ET affiché. Lecture publique via catalog_packs() (sans compte : règle « pages publiques jamais
--    verrouillées »).
-- 2. Packs custom du studio (extensions-roadmap.md §5.3, D9 : SoloDev 2, Indie 20, AA/AAA illimité) : un pack custom
--    regroupe des morceaux et des Sfx DÉJÀ ACQUIS (packs achetés), jamais revendable, jamais recopié. Tables sans
--    politique d'accès direct : tout passe par des RPC security definer qui vérifient propriétaire, quota (matrice :
--    custom_packs) et possession de chaque élément.
-- 3. my_owned_assets() : morceaux et Sfx dont le compte connecté dispose (packs achetés).
-- Le palier et le feu vert 'studio_space' (admin seulement pendant la bêta) viennent de la matrice (20260927070000).
-- Aujourd'hui un studio = un compte (studio_profiles) ; les équipes (D14, D37) arrivent à l'étape 5 et rattacheront
-- ces mêmes tables au studio plutôt qu'au compte, sans changer leur forme (colonne studio_id).

-- ---- 1. Catalogue ----
alter table public.packs add column catalog_listed boolean not null default true;
comment on column public.packs.catalog_listed is 'Afficher dans le catalogue public (D34), vrai par défaut. Le catalogue ne montre que les packs en vente ET affichés.';

create or replace function public.catalog_packs()
returns table (
  id text, title text, illustration text, tags text[], price_eur_cents int, subscriber_credits int,
  composer_name text, composer_handle text, track_count int, sfx_count int, updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.title, p.illustration, p.tags, p.price_eur_cents, p.subscriber_credits,
         coalesce(nullif((select a.profile->>'title' from public.ad_reels a
                          where a.owner_id = p.owner_id order by (a.id = 'main') desc, a.created_at limit 1), ''), cp.handle),
         cp.handle,
         (select count(*)::int from public.pack_tracks pt where pt.pack_id = p.id),
         (select count(*)::int from public.pack_sfx ps where ps.pack_id = p.id),
         p.updated_at
  from public.packs p
  join public.composer_profiles cp on cp.id = p.owner_id
  where p.buyable and p.catalog_listed and coalesce(p.price_eur_cents, 0) > 0
  order by p.updated_at desc;
$$;
grant execute on function public.catalog_packs() to anon, authenticated;

-- upsert_pack : clé catalogListed (absente = inchangé ; nouveau pack = affiché).
create or replace function public.upsert_pack(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack_id text := payload->>'id';
  v_owner_id uuid := public.current_composer_id();
  v_existing_owner uuid;
  -- « En vente » et catalogue abonnés : droits lus dans la matrice (28/09), plus un test is_admin() en dur.
  v_can_sell boolean := public.i_can('sell_packs');
  v_can_catalog boolean := public.i_can('subscriber_catalog');
  v_price int;
  v_credits int;
  v_idx int;
  v_id text;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_pack_id is null or v_pack_id = '' then raise exception 'payload.id manquant'; end if;

  select owner_id into v_existing_owner from public.packs where id = v_pack_id;
  if v_existing_owner is not null and v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : ce pack appartient à un autre compositeur';
  end if;
  -- Prix (grille D31) et crédits (D15/D31) : seulement si le payload en parle ; sinon on garde l'existant.
  if payload ? 'priceEurCents' then
    v_price := (payload->>'priceEurCents')::int;
    if not public.is_valid_pack_price(v_price) then
      raise exception 'Prix hors grille : 0 €, 1 à 100 € par 1 €, 110 à 200 € par 10 €, 250 à 500 € par 50 €';
    end if;
  end if;
  if payload ? 'subscriberCredits' then
    v_credits := (payload->>'subscriberCredits')::int;
    if v_credits is not null and v_credits not in (1, 2, 4) then
      raise exception 'Coût en crédits : 1, 2 ou 4';
    end if;
  end if;

  -- Valeurs FINALES (payload fusionné avec l'existant) : utilisées telles quelles à l'insertion ET à la mise à jour,
  -- car Postgres vérifie les contraintes de table sur la ligne proposée avant même de détecter le conflit.
  v_price := case when payload ? 'priceEurCents' then v_price
                  else (select p.price_eur_cents from public.packs p where p.id = v_pack_id) end;
  v_credits := case when v_can_catalog and payload ? 'subscriberCredits' then v_credits
                    else (select p.subscriber_credits from public.packs p where p.id = v_pack_id) end;
  -- Garde-fou lisible (la contrainte packs_free_not_in_subscriber_catalog le double).
  if v_credits is not null and coalesce(v_price, 0) = 0 then
    raise exception 'Un pack gratuit ne peut pas entrer dans le catalogue abonnés';
  end if;

  perform public.assert_refs_owned('tracks', (select coalesce(array_agg(x), array[]::text[]) from jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb)) x), v_owner_id, 'morceau');
  perform public.assert_refs_owned('sfx_library', (select coalesce(array_agg(x), array[]::text[]) from jsonb_array_elements_text(coalesce(payload->'sfxIds', '[]'::jsonb)) x), v_owner_id, 'Sfx');

  insert into public.packs (id, owner_id, title, illustration, illustration_original_name, watermark,
    watermark_original_name, presentation_fr, presentation_en, buyable, buy_url,
    free_download_enabled, video_test_mode_enabled, bg_color, text_color, font, linked_ad_reel_id, tags,
    price_eur_cents, subscriber_credits, catalog_listed, updated_at)
  values (
    v_pack_id, v_owner_id, coalesce(payload->>'title',''), payload->>'illustration', payload->>'illustrationOriginalName',
    payload->>'watermark', payload->>'watermarkOriginalName', coalesce(payload->>'presentationFr',''),
    coalesce(payload->>'presentationEn',''),
    case when v_can_sell then coalesce((payload->>'buyable')::boolean,false) else false end,
    coalesce(payload->>'buyUrl',''), coalesce((payload->>'freeDownloadEnabled')::boolean,false),
    coalesce((payload->>'videoTestModeEnabled')::boolean,false), payload->>'bgColor', payload->>'textColor',
    payload->>'font', nullif(payload->>'linkedAdReelId',''),
    coalesce((select array_agg(t) from jsonb_array_elements_text(coalesce(payload->'tags','[]'::jsonb)) t), '{}'),
    v_price, v_credits, coalesce((payload->>'catalogListed')::boolean, true),
    now()
  )
  on conflict (id) do update set
    title = excluded.title, illustration = excluded.illustration,
    illustration_original_name = excluded.illustration_original_name, watermark = excluded.watermark,
    watermark_original_name = excluded.watermark_original_name, presentation_fr = excluded.presentation_fr,
    presentation_en = excluded.presentation_en,
    buyable = case when v_can_sell then excluded.buyable else public.packs.buyable end,
    price_eur_cents = excluded.price_eur_cents, subscriber_credits = excluded.subscriber_credits,
    catalog_listed = case when payload ? 'catalogListed' then excluded.catalog_listed else public.packs.catalog_listed end,
    buy_url = excluded.buy_url,
    free_download_enabled = excluded.free_download_enabled, video_test_mode_enabled = excluded.video_test_mode_enabled,
    bg_color = excluded.bg_color, text_color = excluded.text_color, font = excluded.font,
    linked_ad_reel_id = excluded.linked_ad_reel_id, tags = excluded.tags, updated_at = now();

  delete from public.pack_tracks where pack_id = v_pack_id;
  delete from public.pack_sfx where pack_id = v_pack_id;

  v_idx := 0;
  for v_id in select jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb))
  loop
    insert into public.pack_tracks (pack_id, track_id, position) values (v_pack_id, v_id, v_idx);
    v_idx := v_idx + 1;
  end loop;
  v_idx := 0;
  for v_id in select jsonb_array_elements_text(coalesce(payload->'sfxIds', '[]'::jsonb))
  loop
    insert into public.pack_sfx (pack_id, sfx_id, position) values (v_pack_id, v_id, v_idx);
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_pack_id);
end;
$$;

-- ---- 2. Packs custom ----
create table public.studio_custom_packs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio_profiles(id) on delete cascade,
  name text not null default '',
  allow_simultaneous_playback boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index studio_custom_packs_studio_idx on public.studio_custom_packs(studio_id);

create table public.studio_custom_pack_items (
  custom_pack_id uuid not null references public.studio_custom_packs(id) on delete cascade,
  kind text not null check (kind in ('track', 'sfx')),
  ref_id text not null,
  label text not null default '',
  position int not null default 0,
  primary key (custom_pack_id, kind, ref_id)
);
alter table public.studio_custom_packs enable row level security;
alter table public.studio_custom_pack_items enable row level security;
-- Aucune politique : lecture et écriture uniquement par les RPC ci-dessous.

-- Id du profil studio du compte connecté (NULL s'il n'en a pas).
create or replace function public.current_studio_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select sp.id from public.studio_profiles sp where sp.profile_id = auth.uid();
$$;
revoke execute on function public.current_studio_id() from public, anon, authenticated;
grant execute on function public.current_studio_id() to service_role;

-- ---- 3. Ce dont le compte dispose : morceaux et Sfx des packs achetés ----
create or replace function public.my_owned_assets()
returns table (kind text, id text, title text, pack_id text, pack_title text)
language sql
stable
security definer
set search_path = public
as $$
  with bought as (select distinct pp.pack_id from public.pack_purchases pp where pp.studio_id = auth.uid())
  select 'track', t.id, t.title, b.pack_id, pk.title
  from bought b join public.pack_tracks pt on pt.pack_id = b.pack_id join public.tracks t on t.id = pt.track_id
  join public.packs pk on pk.id = b.pack_id
  union all
  select 'sfx', s.id, s.title, b.pack_id, pk.title
  from bought b join public.pack_sfx ps on ps.pack_id = b.pack_id join public.sfx_library s on s.id = ps.sfx_id
  join public.packs pk on pk.id = b.pack_id
  order by 5, 3;
$$;
revoke execute on function public.my_owned_assets() from public, anon;
grant execute on function public.my_owned_assets() to authenticated;

create or replace function public.list_my_custom_packs()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'allowSimultaneousPlayback', c.allow_simultaneous_playback,
    'createdAt', c.created_at, 'updatedAt', c.updated_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'refId', i.ref_id, 'label', i.label) order by i.position)
                       from public.studio_custom_pack_items i where i.custom_pack_id = c.id), '[]'::jsonb)
  ) order by c.created_at), '[]'::jsonb)
  from public.studio_custom_packs c
  where c.studio_id = public.current_studio_id();
$$;
revoke execute on function public.list_my_custom_packs() from public, anon;
grant execute on function public.list_my_custom_packs() to authenticated;

-- payload : { id?, name, allowSimultaneousPlayback, items: [{ kind: 'track'|'sfx', refId, label }] }
create or replace function public.upsert_my_custom_pack(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio uuid := public.current_studio_id();
  v_id uuid := nullif(payload->>'id', '')::uuid;
  v_ent record;
  v_count int;
  v_item jsonb;
  v_pos int := 0;
begin
  if v_studio is null then raise exception 'Non autorisé : aucun profil studio associé à ce compte'; end if;
  select * into v_ent from public.entitlement(auth.uid(), 'custom_packs', false);
  if not coalesce(v_ent.allowed, false) then raise exception 'Non autorisé : les packs custom ne sont pas ouverts pour ce compte'; end if;

  if v_id is not null and not exists (select 1 from public.studio_custom_packs where id = v_id and studio_id = v_studio) then
    raise exception 'Non autorisé : ce pack custom appartient à un autre studio';
  end if;
  if v_id is null then
    select count(*) into v_count from public.studio_custom_packs where studio_id = v_studio;
    if v_ent.amount is not null and v_count >= v_ent.amount then
      raise exception 'Limite atteinte : % pack(s) custom pour ton palier', v_ent.amount::int using hint = 'quota';
    end if;
    insert into public.studio_custom_packs (studio_id, name, allow_simultaneous_playback)
    values (v_studio, coalesce(payload->>'name', ''), coalesce((payload->>'allowSimultaneousPlayback')::boolean, false))
    returning id into v_id;
  else
    update public.studio_custom_packs
       set name = coalesce(payload->>'name', name),
           allow_simultaneous_playback = coalesce((payload->>'allowSimultaneousPlayback')::boolean, allow_simultaneous_playback),
           updated_at = now()
     where id = v_id;
  end if;

  if payload ? 'items' then
    -- Chaque élément doit être un morceau ou un Sfx d'un pack acheté par ce compte (jamais un contenu non acquis).
    for v_item in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) loop
      if not exists (select 1 from public.my_owned_assets() o where o.kind = v_item->>'kind' and o.id = v_item->>'refId') then
        raise exception 'Non autorisé : « % » ne fait pas partie de tes achats', coalesce(v_item->>'refId', '?');
      end if;
    end loop;
    delete from public.studio_custom_pack_items where custom_pack_id = v_id;
    for v_item in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) loop
      insert into public.studio_custom_pack_items (custom_pack_id, kind, ref_id, label, position)
      values (v_id, v_item->>'kind', v_item->>'refId', coalesce(v_item->>'label', ''), v_pos)
      on conflict (custom_pack_id, kind, ref_id) do update set label = excluded.label, position = excluded.position;
      v_pos := v_pos + 1;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke execute on function public.upsert_my_custom_pack(jsonb) from public, anon;
grant execute on function public.upsert_my_custom_pack(jsonb) to authenticated;

create or replace function public.delete_my_custom_pack(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.studio_custom_packs where id = p_id and studio_id = public.current_studio_id();
  if not found then raise exception 'Pack custom introuvable'; end if;
end;
$$;
revoke execute on function public.delete_my_custom_pack(uuid) from public, anon;
grant execute on function public.delete_my_custom_pack(uuid) to authenticated;
