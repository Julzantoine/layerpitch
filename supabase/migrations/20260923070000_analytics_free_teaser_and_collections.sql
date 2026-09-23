-- LayerPitch — analytique pour les comptes Free : collecte 30 jours + aperçu flouté (23 septembre,
-- décision de Jules-Antoine : "on n'a qu'à collecter que sur 30 jours comme le starter et flouter les
-- chiffres"). Remplace la règle de 20260923030000 ("rien n'est collecté en Free").
--
-- 1. Rétention Free = 30 jours (comme Starter) ; les événements portent tier = 'free'.
-- 2. log_analytics_event() collecte pour tous les paliers (la garde "Free = rien" est retirée).
-- 3. get_my_analytics_overview() ne renvoie plus "verrouillé" à un compte Free mais un APERÇU : la
--    forme des courbes (séries normalisées 0-100), l'ordre et les noms des AdReels/packs, jamais un
--    chiffre réel (voir le commentaire dans la fonction). Le détail d'un élément et la liste brute
--    des visites restent verrouillés pour Free.
-- 4. Collections : entity_type 'collection' accepté (écriture, vue d'ensemble, détail).
-- Un Free qui passe Starter/Pro voit aussitôt ce qui a été collecté sur ses 30 derniers jours.

-- Suivi des COLLECTIONS (23 septembre, accord de Jules-Antoine) : entity_type accepte désormais
-- 'collection' (visites et lectures, même mécanisme que les AdReels et les packs).
alter table public.analytics_events drop constraint if exists analytics_events_entity_type_check;
alter table public.analytics_events add constraint analytics_events_entity_type_check check (entity_type in ('adreel', 'pack', 'collection'));

alter table public.analytics_events drop constraint if exists analytics_events_tier_check;
alter table public.analytics_events add constraint analytics_events_tier_check check (tier is null or tier in ('free', 'starter', 'pro'));

create or replace function public.analytics_retention_days(p_tier text)
returns int
language sql
immutable
as $$
  select case p_tier when 'free' then 30 when 'starter' then 30 when 'pro' then 365 else 0 end;
$$;

-- Ramène une série de comptages (tableau jsonb) à 0-100 par rapport à son maximum : conserve la
-- forme de la courbe sans révéler d'ordre de grandeur.
create or replace function public.analytics_normalize_series(p_series jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when p_series is null or jsonb_typeof(p_series) <> 'array' then null
    else coalesce((
      select jsonb_agg(case when q.mx > 0 then round(100.0 * q.v / q.mx) else 0 end order by q.ord)
      from (
        select t.v_text::numeric as v, t.ord, max(t.v_text::numeric) over () as mx
        from jsonb_array_elements_text(p_series) with ordinality as t(v_text, ord)
      ) q
    ), '[]'::jsonb)
  end;
$$;

create or replace function public.log_analytics_event(
  p_entity_type text,
  p_entity_id text,
  p_session_id text,
  p_event_name text,
  p_detail jsonb default '{}'::jsonb,
  p_device text default null,
  p_owner_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_tier text;
  v_ip text;
  v_bucket text;
  v_count int;
begin
  if p_entity_type is null or p_entity_type not in ('adreel', 'pack', 'collection') then return; end if;
  if p_entity_id is null or length(p_entity_id) = 0 or length(p_entity_id) > 200 then return; end if;
  if p_session_id is null or length(p_session_id) = 0 or length(p_session_id) > 200 then return; end if;
  if p_event_name is null or length(p_event_name) = 0 or length(p_event_name) > 100 then return; end if;
  if p_device is not null and p_device not in ('mobile', 'desktop') then p_device := null; end if;

  -- p_owner_id : indice de désambiguïsation, jamais pris seul -- la ligne doit exister réellement
  -- avec CETTE combinaison (id, owner_id) quand l'indice est fourni. `limit 1` sur le repli sans
  -- indice (p_owner_id null) : choix arbitraire assumé, seul cas où plusieurs lignes peuvent
  -- effectivement matcher (chemin historique sans handle, un seul propriétaire réel en pratique).
  if p_entity_type = 'adreel' then
    select owner_id into v_owner_id from public.ad_reels
      where id = p_entity_id and (p_owner_id is null or owner_id = p_owner_id) limit 1;
  elsif p_entity_type = 'pack' then
    select owner_id into v_owner_id from public.packs
      where id = p_entity_id and (p_owner_id is null or owner_id = p_owner_id) limit 1;
  else
    select owner_id into v_owner_id from public.collections
      where id = p_entity_id and (p_owner_id is null or owner_id = p_owner_id) limit 1;
  end if;
  if v_owner_id is null then return; end if;

  -- Les visites du compositeur lui-même ne comptent pas (23 septembre, demande de Jules-Antoine) :
  -- quand il ouvre son propre AdReel/pack connecté dans ce navigateur, la session Supabase du
  -- backstage est partagée avec les pages publiques (même origine) et l'appel arrive ici avec son
  -- identité. Exclusion côté serveur (pas côté page) : impossible à contourner par une page en cache.
  -- Limite assumée : depuis un navigateur où il n'est pas connecté, sa visite est indiscernable de
  -- celle d'un visiteur.
  if auth.uid() is not null and exists (
    select 1 from public.composer_profiles cp where cp.id = v_owner_id and cp.profile_id = auth.uid()
  ) then return; end if;

  -- Le palier est enregistré avec l'événement (colonne tier) pour que le nettoyage
  -- applique à CHAQUE événement la rétention du palier sous lequel il a été collecté.
  v_tier := public.composer_effective_tier(v_owner_id);
  if v_tier is null then return; end if;

  v_ip := coalesce(
    nullif(split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1), ''),
    p_session_id
  );
  v_bucket := v_ip || ':' || floor(extract(epoch from now()) / 60)::text;
  insert into public.analytics_write_rate_limit (bucket_key, event_count)
    values (v_bucket, 1)
    on conflict (bucket_key) do update set event_count = analytics_write_rate_limit.event_count + 1
    returning event_count into v_count;
  if v_count > 60 then return; end if;

  insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, detail, device, tier)
    values (v_owner_id, p_entity_type, p_entity_id, p_session_id, p_event_name, coalesce(p_detail, '{}'::jsonb), p_device, v_tier);
end;
$$;

create or replace function public.get_my_analytics_overview(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_bucket text default 'day',
  p_tz text default 'UTC'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_composer_id uuid;
  v_tier text;
  v_retention int;
  v_start timestamptz;
  v_end timestamptz := now();
  v_unit interval;
  v_first timestamp;
  v_last timestamp;
  v_n int;
  v_result jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', true, 'tier', 'free', 'locked', true);
  end if;
  select id into v_composer_id from public.composer_profiles where profile_id = v_uid;
  if v_composer_id is null then
    return jsonb_build_object('ok', true, 'tier', 'free', 'locked', true);
  end if;
  v_tier := public.composer_effective_tier(v_composer_id);
  if v_tier is null then
    return jsonb_build_object('ok', true, 'tier', 'free', 'locked', true);
  end if;

  if p_bucket is null or p_bucket not in ('hour', 'day', 'week', 'month') then
    raise exception 'p_bucket doit valoir hour, day, week ou month';
  end if;
  if p_tz is null or not exists (select 1 from pg_timezone_names where name = p_tz) then p_tz := 'UTC'; end if;

  v_retention := public.analytics_retention_days(v_tier);
  v_start := now() - (v_retention || ' days')::interval;
  if p_from is not null and p_from > v_start then v_start := p_from; end if;
  if p_to is not null and p_to < v_end then v_end := p_to; end if;
  if v_end < v_start then v_end := v_start; end if;

  v_unit := ('1 ' || p_bucket)::interval;
  v_first := date_trunc(p_bucket, v_start at time zone p_tz);
  v_last := date_trunc(p_bucket, v_end at time zone p_tz);
  select count(*) into v_n from generate_series(v_first, v_last, v_unit);
  if v_n > 400 then
    raise exception 'Trop de périodes (%) : choisis un découpage plus large', v_n;
  end if;

  with b as (
    select generate_series(v_first, v_last, v_unit) as bucket
  ),
  scoped as (
    select * from public.analytics_events
    where owner_id = v_composer_id and created_at >= v_start and created_at <= v_end
  ),
  sessions as (
    select session_id, entity_type, entity_id, min(created_at) as opened_at,
      (array_agg(device) filter (where device is not null))[1] as device,
      count(*) filter (where event_name = 'track_play') as plays
    from scoped group by session_id, entity_type, entity_id
  ),
  visits_by_bucket as (
    select date_trunc(p_bucket, opened_at at time zone p_tz) as bucket, count(*) as n
    from sessions group by 1
  ),
  plays_by_bucket as (
    select date_trunc(p_bucket, created_at at time zone p_tz) as bucket, count(*) as n
    from scoped where event_name = 'track_play' group by 1
  ),
  ent as (
    select entity_type, entity_id, count(*) as visits, sum(plays) as plays, max(opened_at) as last_visit,
      count(*) filter (where device = 'mobile') as mobile, count(*) filter (where device is not null) as known
    from sessions group by entity_type, entity_id
  ),
  ent_visits as (
    select entity_type, entity_id, date_trunc(p_bucket, opened_at at time zone p_tz) as bucket, count(*) as n
    from sessions group by 1, 2, 3
  ),
  ent_series as (
    select e.entity_type, e.entity_id, jsonb_agg(coalesce(ev.n, 0) order by b.bucket) as series
    from ent e cross join b
    left join ent_visits ev on ev.entity_type = e.entity_type and ev.entity_id = e.entity_id and ev.bucket = b.bucket
    group by e.entity_type, e.entity_id
  ),
  ent_out as (
    select jsonb_build_object(
      'type', e.entity_type, 'id', e.entity_id,
      'name', coalesce(nullif(case e.entity_type when 'adreel' then ar.label when 'pack' then pk.title else co.title end, ''), e.entity_id),
      'visits', e.visits,
      'plays', case when v_tier = 'pro' then e.plays else null end,
      'lastVisit', e.last_visit,
      'mobileShare', case when e.known > 0 then round(100.0 * e.mobile / e.known) else null end,
      'series', es.series
    ) as o, e.visits
    from ent e
    join ent_series es on es.entity_type = e.entity_type and es.entity_id = e.entity_id
    left join public.ad_reels ar on e.entity_type = 'adreel' and ar.owner_id = v_composer_id and ar.id = e.entity_id
    left join public.packs pk on e.entity_type = 'pack' and pk.owner_id = v_composer_id and pk.id = e.entity_id
    left join public.collections co on e.entity_type = 'collection' and co.owner_id = v_composer_id and co.id = e.entity_id
  )
  select jsonb_build_object(
    'ok', true, 'tier', v_tier, 'locked', false, 'retentionDays', v_retention,
    'windowStart', v_start, 'windowEnd', v_end, 'bucket', p_bucket,
    'buckets', (select jsonb_agg(to_char(bucket, 'YYYY-MM-DD"T"HH24:MI') order by bucket) from b),
    'totals', jsonb_build_object(
      'visits', (select count(*) from sessions),
      'plays', case when v_tier = 'pro' then (select count(*) from scoped where event_name = 'track_play') else null end,
      'mobileShare', (select case when count(*) filter (where device is not null) > 0
                       then round(100.0 * count(*) filter (where device = 'mobile') / count(*) filter (where device is not null)) end from sessions),
      'items', (select count(*) from ent)
    ),
    'series', jsonb_build_object(
      'visits', (select jsonb_agg(coalesce(v.n, 0) order by b.bucket) from b left join visits_by_bucket v on v.bucket = b.bucket),
      'plays', case when v_tier = 'pro'
                 then (select jsonb_agg(coalesce(p.n, 0) order by b.bucket) from b left join plays_by_bucket p on p.bucket = b.bucket)
                 else null end
    ),
    'entities', coalesce((select jsonb_agg(o order by visits desc) from (select o, visits from ent_out order by visits desc limit 200) t), '[]'::jsonb)
  ) into v_result;

  -- Compte Free : APERÇU seulement (décision du 23 septembre). Aucun chiffre réel ne quitte la base :
  -- ni totaux, ni dates de dernière visite, ni valeurs de série. Restent la FORME des courbes
  -- (séries ramenées à 0-100 par rapport à leur maximum), l'ordre des AdReels/packs et leurs noms.
  -- L'écran affiche des chiffres factices floutés par-dessus -- un simple flou CSS aurait suffi à
  -- l'œil, mais aurait laissé les vraies valeurs lisibles dans la réponse réseau.
  if v_tier = 'free' then
    v_result := jsonb_build_object(
      'ok', true, 'tier', 'free', 'locked', false, 'teaser', true, 'retentionDays', v_retention,
      'windowStart', v_start, 'windowEnd', v_end, 'bucket', p_bucket,
      'buckets', v_result->'buckets',
      'totals', jsonb_build_object('visits', null, 'plays', null, 'mobileShare', null, 'items', null),
      'series', jsonb_build_object('visits', public.analytics_normalize_series(v_result->'series'->'visits'), 'plays', null),
      'entities', coalesce((
        select jsonb_agg(jsonb_build_object(
          'type', e->>'type', 'id', e->>'id', 'name', e->>'name',
          'visits', null, 'plays', null, 'lastVisit', null, 'mobileShare', null,
          'series', public.analytics_normalize_series(e->'series')
        ))
        from jsonb_array_elements(v_result->'entities') e
      ), '[]'::jsonb)
    );
  end if;

  return v_result;
end;
$$;
grant execute on function public.get_my_analytics_overview(timestamptz, timestamptz, text, text) to authenticated;

create or replace function public.get_my_analytics_entity(
  p_type text,
  p_id text,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_bucket text default 'day',
  p_tz text default 'UTC'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_composer_id uuid;
  v_tier text;
  v_retention int;
  v_start timestamptz;
  v_end timestamptz := now();
  v_unit interval;
  v_first timestamp;
  v_last timestamp;
  v_n int;
  v_name text;
  v_result jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', true, 'tier', 'free', 'locked', true);
  end if;
  select id into v_composer_id from public.composer_profiles where profile_id = v_uid;
  if v_composer_id is null then
    return jsonb_build_object('ok', true, 'tier', 'free', 'locked', true);
  end if;
  v_tier := public.composer_effective_tier(v_composer_id);
  if v_tier is null or v_tier not in ('starter', 'pro') then
    return jsonb_build_object('ok', true, 'tier', 'free', 'locked', true);
  end if;
  if p_type is null or p_type not in ('adreel', 'pack', 'collection') or p_id is null then
    raise exception 'p_type doit valoir adreel, pack ou collection, et p_id est obligatoire';
  end if;
  if p_bucket is null or p_bucket not in ('hour', 'day', 'week', 'month') then
    raise exception 'p_bucket doit valoir hour, day, week ou month';
  end if;
  if p_tz is null or not exists (select 1 from pg_timezone_names where name = p_tz) then p_tz := 'UTC'; end if;

  v_retention := public.analytics_retention_days(v_tier);
  v_start := now() - (v_retention || ' days')::interval;
  if p_from is not null and p_from > v_start then v_start := p_from; end if;
  if p_to is not null and p_to < v_end then v_end := p_to; end if;
  if v_end < v_start then v_end := v_start; end if;

  v_unit := ('1 ' || p_bucket)::interval;
  v_first := date_trunc(p_bucket, v_start at time zone p_tz);
  v_last := date_trunc(p_bucket, v_end at time zone p_tz);
  select count(*) into v_n from generate_series(v_first, v_last, v_unit);
  if v_n > 400 then
    raise exception 'Trop de périodes (%) : choisis un découpage plus large', v_n;
  end if;

  if p_type = 'adreel' then
    select nullif(label, '') into v_name from public.ad_reels where owner_id = v_composer_id and id = p_id;
  elsif p_type = 'pack' then
    select nullif(title, '') into v_name from public.packs where owner_id = v_composer_id and id = p_id;
  else
    select nullif(title, '') into v_name from public.collections where owner_id = v_composer_id and id = p_id;
  end if;

  with b as (
    select generate_series(v_first, v_last, v_unit) as bucket
  ),
  scoped as (
    select * from public.analytics_events
    where owner_id = v_composer_id and entity_type = p_type and entity_id = p_id
      and created_at >= v_start and created_at <= v_end
  ),
  sessions as (
    select session_id, min(created_at) as opened_at,
      (array_agg(device) filter (where device is not null))[1] as device,
      count(*) filter (where event_name = 'track_play') as plays
    from scoped group by session_id
  ),
  visits_by_bucket as (
    select date_trunc(p_bucket, opened_at at time zone p_tz) as bucket, count(*) as n from sessions group by 1
  ),
  plays_by_bucket as (
    select date_trunc(p_bucket, created_at at time zone p_tz) as bucket, count(*) as n
    from scoped where event_name = 'track_play' group by 1
  ),
  track_plays as (
    select session_id, detail->>'trackId' as track_id, created_at,
      lead(detail->>'trackId') over (partition by session_id order by created_at) as next_track_id
    from scoped where event_name = 'track_play'
  ),
  end_clicks as (
    select distinct session_id, detail->>'trackId' as track_id from scoped where event_name = 'go_to_end_click'
  ),
  track_stats as (
    select tp.track_id, count(*) as plays,
      count(*) filter (where ec.track_id is not null) as reached_end,
      count(*) filter (where ec.track_id is null and tp.next_track_id is not null and tp.next_track_id is distinct from tp.track_id) as skipped
    from track_plays tp
    left join end_clicks ec on ec.session_id = tp.session_id and ec.track_id = tp.track_id
    where tp.track_id is not null
    group by tp.track_id
  )
  select jsonb_build_object(
    'ok', true, 'tier', v_tier, 'locked', false, 'retentionDays', v_retention,
    'windowStart', v_start, 'windowEnd', v_end, 'bucket', p_bucket,
    'entity', jsonb_build_object('type', p_type, 'id', p_id, 'name', coalesce(v_name, p_id)),
    'buckets', (select jsonb_agg(to_char(bucket, 'YYYY-MM-DD"T"HH24:MI') order by bucket) from b),
    'totals', jsonb_build_object(
      'visits', (select count(*) from sessions),
      'plays', case when v_tier = 'pro' then (select count(*) from scoped where event_name = 'track_play') else null end,
      'mobile', (select count(*) from sessions where device = 'mobile'),
      'desktop', (select count(*) from sessions where device = 'desktop'),
      'unknownDevice', (select count(*) from sessions where device is null)
    ),
    'series', jsonb_build_object(
      'visits', (select jsonb_agg(coalesce(v.n, 0) order by b.bucket) from b left join visits_by_bucket v on v.bucket = b.bucket),
      'plays', case when v_tier = 'pro'
                 then (select jsonb_agg(coalesce(p.n, 0) order by b.bucket) from b left join plays_by_bucket p on p.bucket = b.bucket)
                 else null end
    ),
    'tracks', case when v_tier = 'pro' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'trackId', ts.track_id, 'title', coalesce(nullif(t.title, ''), ts.track_id),
        'plays', ts.plays, 'reachedEnd', ts.reached_end, 'skipped', ts.skipped
      ) order by ts.plays desc)
      from track_stats ts left join public.tracks t on t.owner_id = v_composer_id and t.id = ts.track_id
    ), '[]'::jsonb) else null end,
    'interactions', case when v_tier = 'pro' then coalesce((
      select jsonb_agg(jsonb_build_object('name', event_name, 'count', n) order by n desc)
      from (select event_name, count(*) as n from scoped
            where event_name in ('intensity_change', 'voice_solo_toggle', 'voice_mute_toggle', 'voice_volume_change',
                                 'stinger_play', 'pool_refresh', 'seq_branch_select', 'embr_loop_select')
            group by event_name) i
    ), '[]'::jsonb) else null end,
    'recentSessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sessionId', session_id, 'openedAt', opened_at, 'device', device,
        'plays', case when v_tier = 'pro' then plays else null end
      ) order by opened_at desc)
      from (select * from sessions order by opened_at desc limit 15) rs
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
grant execute on function public.get_my_analytics_entity(text, text, timestamptz, timestamptz, text, text) to authenticated;
