-- LayerPitch — analytique : les boutons d'effet dans la vue détaillée d'un AdReel/pack/collection (revue du 24/09).
--
-- Séquelle du travail en parallèle du 23/09 : la branche des effets avait ajouté les appuis sur les boutons d'effet
-- (événement `fx_trigger`) à l'ANCIENNE fonction get_my_analytics (20260923040000), pendant que main remplaçait le
-- tableau de bord par get_my_analytics_overview / _entity (20260923050000 à 080000), qui les ignorent. Résultat : la
-- synthèse « boutons d'effet les plus utilisés » n'apparaissait que dans le bloc replié de l'ancienne vue.
-- get_my_analytics_entity est recréée à l'identique de 20260923080000, avec deux ajouts : `fx_trigger` dans
-- 'interactions', et un nouveau champ 'fxButtons' (appuis d'activation par bouton + nombre de visites).

create or replace function public.get_my_analytics_entity(
  p_type text,
  p_id text,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_bucket text default 'day',
  p_tz text default 'UTC',
  p_preview_tier text default null
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
  if p_preview_tier is not null and p_preview_tier in ('free', 'starter', 'pro') and public.is_admin() then
    v_tier := p_preview_tier;
  end if;
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
                                 'stinger_play', 'pool_refresh', 'seq_branch_select', 'embr_loop_select', 'fx_trigger')
            group by event_name) i
    ), '[]'::jsonb) else null end,
    -- Boutons d'effet (24/09) : appuis d'ACTIVATION par bouton, et dans combien de visites. Pro seulement, comme le
    -- reste du détail. Le Backstage retrouve le nom du bouton et du morceau dans sa bibliothèque.
    'fxButtons', case when v_tier = 'pro' then coalesce((
      select jsonb_agg(jsonb_build_object('trackId', track_id, 'triggerId', trigger_id, 'presses', presses, 'sessions', sessions)
                       order by presses desc)
      from (select detail->>'trackId' as track_id, detail->>'triggerId' as trigger_id,
                   count(*) as presses, count(distinct session_id) as sessions
            from scoped
            where event_name = 'fx_trigger' and detail->>'active' = 'true' and detail->>'triggerId' is not null
            group by 1, 2) f
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
