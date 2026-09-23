-- LayerPitch — tableau de bord analytique : les appuis sur les boutons d'effet (23/09).
-- Le lecteur consigne depuis le 23/09 chaque appui sur un bouton d'effet (évènement `fx_trigger` {trackId,
-- triggerId, active}) dans analytics_events, mais get_my_analytics() ne remontait que cinq noms d'évènements
-- d'interaction : ceux-ci étaient stockés sans jamais être affichés. Seul changement : `fx_trigger` rejoint la
-- liste (le reste de la fonction est recopié à l'identique de 20260905010000, seule définition existante ;
-- le gating par palier est inchangé : détail réservé à Pro).

create or replace function public.get_my_analytics(p_from timestamptz default null, p_to timestamptz default null)
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
  v_retention_days int;
  v_window_start timestamptz;
  v_window_end timestamptz := now();
  v_sessions jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', true, 'tier', 'free', 'locked', true, 'sessions', '[]'::jsonb);
  end if;

  select id into v_composer_id from public.composer_profiles where profile_id = v_uid;
  if v_composer_id is null then
    -- Aucun profil compositeur pour l'instant (n'a jamais publié) : même chose qu'un palier Free.
    return jsonb_build_object('ok', true, 'tier', 'free', 'locked', true, 'sessions', '[]'::jsonb);
  end if;

  v_tier := public.composer_effective_tier(v_composer_id);
  if v_tier is null or v_tier = 'free' then
    return jsonb_build_object('ok', true, 'tier', 'free', 'locked', true, 'sessions', '[]'::jsonb);
  end if;

  v_retention_days := public.analytics_retention_days(v_tier);
  v_window_start := now() - (v_retention_days || ' days')::interval;
  -- Filtre par plage de dates : Pro uniquement (grille validée), toujours resserré dans la fenêtre
  -- de rétention plutôt que de faire confiance à une plage arbitraire fournie par le client.
  if v_tier = 'pro' then
    if p_from is not null and p_from > v_window_start then v_window_start := p_from; end if;
    if p_to is not null and p_to < v_window_end then v_window_end := p_to; end if;
  end if;
  if v_window_end < v_window_start then v_window_end := v_window_start; end if;

  if v_tier = 'starter' then
    -- Starter : agrégé en sessions directement en SQL -- aucune ligne d'événement individuelle ni
    -- `detail` ne quitte jamais la base pour ce palier.
    select coalesce(jsonb_agg(s order by (s->>'openedAt') desc), '[]'::jsonb) into v_sessions
    from (
      select jsonb_build_object(
        'sessionId', session_id, 'type', entity_type, 'entityId', entity_id,
        'openedAt', min(created_at), 'device', (array_agg(device) filter (where device is not null))[1]
      ) as s
      from public.analytics_events
      where owner_id = v_composer_id and created_at >= v_window_start and created_at <= v_window_end
      group by session_id, entity_type, entity_id
    ) grouped;
  else
    -- Pro : détail complet. "jusqu'où, sauté ou non" reste une INFÉRENCE à partir des marqueurs
    -- discrets déjà trackés (pas de mesure continue de progression de lecture) : reachedEnd si un
    -- go_to_end_click existe pour ce morceau dans la session, skipped si un autre morceau démarre
    -- ensuite sans que celui-ci ait atteint sa fin (repérage par fenêtrage LEAD, même heuristique
    -- que la piste Umami abandonnée).
    with scoped as (
      select * from public.analytics_events
      where owner_id = v_composer_id and created_at >= v_window_start and created_at <= v_window_end
    ),
    track_plays as (
      select session_id, detail->>'trackId' as track_id, created_at,
        lead(detail->>'trackId') over (partition by session_id order by created_at) as next_track_id
      from scoped where event_name = 'track_play'
    ),
    end_clicks as (
      select distinct session_id, detail->>'trackId' as track_id
      from scoped where event_name = 'go_to_end_click'
    ),
    tracks as (
      select tp.session_id,
        jsonb_agg(jsonb_build_object(
          'trackId', tp.track_id, 'playedAt', tp.created_at,
          'reachedEnd', (ec.track_id is not null),
          'skipped', (ec.track_id is null and tp.next_track_id is not null and tp.next_track_id is distinct from tp.track_id)
        ) order by tp.created_at) as tracks
      from track_plays tp
      left join end_clicks ec on ec.session_id = tp.session_id and ec.track_id = tp.track_id
      group by tp.session_id
    ),
    interactions as (
      select session_id,
        jsonb_agg(jsonb_build_object('name', event_name, 'at', created_at, 'detail', detail) order by created_at) as interactions
      from scoped
      where event_name in ('intensity_change', 'voice_solo_toggle', 'voice_mute_toggle', 'stinger_play', 'pool_refresh', 'fx_trigger')
      group by session_id
    ),
    session_meta as (
      select session_id, entity_type, entity_id, min(created_at) as opened_at,
        (array_agg(device) filter (where device is not null))[1] as device
      from scoped
      group by session_id, entity_type, entity_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'sessionId', sm.session_id, 'type', sm.entity_type, 'entityId', sm.entity_id,
      'openedAt', sm.opened_at, 'device', sm.device,
      'tracks', coalesce(t.tracks, '[]'::jsonb),
      'interactions', coalesce(i.interactions, '[]'::jsonb)
    ) order by sm.opened_at desc), '[]'::jsonb)
    into v_sessions
    from session_meta sm
    left join tracks t on t.session_id = sm.session_id
    left join interactions i on i.session_id = sm.session_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'tier', v_tier, 'locked', false,
    'retentionDays', v_retention_days,
    'windowStart', v_window_start, 'windowEnd', v_window_end,
    'sessions', v_sessions
  );
end;
$$;
grant execute on function public.get_my_analytics(timestamptz, timestamptz) to authenticated;
