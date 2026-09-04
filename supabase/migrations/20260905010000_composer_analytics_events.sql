-- LayerPitch — tableau de bord analytique compositeur, système propriétaire (5 septembre).
--
-- Remplace une première piste envisagée (interroger l'API Umami Cloud via une Edge Function),
-- abandonnée avant d'être déployée : son accès API est réservé au plan payant d'Umami (~20$/mois,
-- trouvé en essayant de générer une clé), et ça introduisait une dépendance externe pour une
-- fonctionnalité compositeur — hors de la philosophie du reste de LayerPitch (Postgres/RPC, pas de
-- serveur API dédié). Umami reste installé tel quel sur le site, mais sert désormais uniquement à
-- Jules-Antoine (vue globale plateforme), sans lien avec ce chantier.
--
-- Grille (Free/Starter/Pro) actée en canal architecture, inchangée dans son contenu par rapport à
-- la première piste : Free aucun accès, Starter sessions/appareil approximatif/date (rétention 1
-- mois), Pro détail par morceau + interactions adaptatives + filtre de dates (rétention 1 an).
--
-- Point technique trouvé en codant (pas deviné) : effective_plan_quotas() a été un temps envisagée
-- pour résoudre le palier effectif, mais sa colonne `plan` ne reflète JAMAIS un essai reverse trial
-- actif (documenté explicitement dans sa propre migration, 20260903190000) -- l'utiliser aurait
-- cassé "essai actif = accès Pro pendant l'essai". composer_effective_tier() ci-dessous reproduit à
-- la place la même logique déjà éprouvée côté client (layerpitch-backstage.html,
-- effectiveTierFromTrialStatus()) : essai actif -> 'pro', sinon le palier brut. Le rôle admin n'est
-- délibérément pas pris en compte ici, même limite documentée partout ailleurs dans le produit
-- (chantier de gating admin séparé, pas encore fini).

-- ============================================================================
-- Table des événements
-- ============================================================================

create table public.analytics_events (
  id bigserial primary key,
  owner_id uuid not null references public.composer_profiles(id) on delete cascade,
  entity_type text not null check (entity_type in ('adreel', 'pack')),
  entity_id text not null,
  session_id text not null,
  event_name text not null,
  detail jsonb not null default '{}'::jsonb,
  device text check (device is null or device in ('mobile', 'desktop')),
  created_at timestamptz not null default now()
);
create index analytics_events_owner_created_idx on public.analytics_events(owner_id, created_at desc);
create index analytics_events_session_idx on public.analytics_events(session_id);

-- RLS activée SANS policy : aucun accès direct via l'API REST (anon/authenticated), y compris en
-- lecture -- exclusivement via les fonctions SECURITY DEFINER ci-dessous, même patron que
-- composer_profiles/resolve_composer_handle (20260903120100). Les fonctions elles-mêmes tournent
-- avec les privilèges de leur propriétaire (postgres), qui contourne RLS normalement.
alter table public.analytics_events enable row level security;

-- Compteurs de limite de fréquence sur l'écriture publique (voir log_analytics_event ci-dessous) --
-- table à part de analytics_events plutôt qu'une colonne IP dessus : pas de donnée personnelle dans
-- la table de faits elle-même, uniquement dans ce compteur temporaire, purgé en continu.
create table public.analytics_write_rate_limit (
  bucket_key text primary key,
  event_count int not null default 0,
  window_start timestamptz not null default now()
);
alter table public.analytics_write_rate_limit enable row level security;

-- ============================================================================
-- Fonctions communes (palier effectif, fenêtre de rétention) — source unique de vérité pour la
-- lecture ET la purge, pour qu'elles ne puissent jamais diverger.
-- ============================================================================

create or replace function public.composer_effective_tier(p_composer_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when cp.trial_ends_at > now() then 'pro' else cp.plan end
  from public.composer_profiles cp
  where cp.id = p_composer_id;
$$;
grant execute on function public.composer_effective_tier(uuid) to authenticated;

-- Rétention par palier posée en fonction nommée plutôt qu'en valeur en dur dispersée -- grille
-- validée du 4 septembre : Starter 1 mois glissant, Pro 1 an glissant. 0 pour tout le reste (Free,
-- ou palier inconnu) : la purge (voir plus bas) supprime alors tout, cohérent avec "Free n'a de
-- toute façon jamais accès au tableau de bord".
create or replace function public.analytics_retention_days(p_tier text)
returns int
language sql
immutable
as $$
  select case p_tier when 'starter' then 30 when 'pro' then 365 else 0 end;
$$;

-- ============================================================================
-- Écriture (pages publiques, sans authentification)
-- ============================================================================

create or replace function public.log_analytics_event(
  p_entity_type text,
  p_entity_id text,
  p_session_id text,
  p_event_name text,
  p_detail jsonb default '{}'::jsonb,
  p_device text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_ip text;
  v_bucket text;
  v_count int;
begin
  -- Validation minimale -- rejet silencieux (return, jamais raise) : le tracking ne doit jamais
  -- faire échouer ou ralentir la page publique appelante, même sur une entrée mal formée.
  if p_entity_type is null or p_entity_type not in ('adreel', 'pack') then return; end if;
  if p_entity_id is null or length(p_entity_id) = 0 or length(p_entity_id) > 200 then return; end if;
  if p_session_id is null or length(p_session_id) = 0 or length(p_session_id) > 200 then return; end if;
  if p_event_name is null or length(p_event_name) = 0 or length(p_event_name) > 100 then return; end if;
  if p_device is not null and p_device not in ('mobile', 'desktop') then p_device := null; end if;

  -- Point de sécurité central : le propriétaire réel est retrouvé ICI, côté base, à partir de
  -- l'identifiant d'AdReel/pack fourni -- jamais une valeur envoyée par le client. Renvoie
  -- silencieusement si l'entité n'existe pas (lien mort, id trafiqué) plutôt que d'insérer une
  -- ligne orpheline ou de faire échouer l'appel.
  if p_entity_type = 'adreel' then
    select owner_id into v_owner_id from public.ad_reels where id = p_entity_id;
  else
    select owner_id into v_owner_id from public.packs where id = p_entity_id;
  end if;
  if v_owner_id is null then return; end if;

  -- Limite de fréquence par IP, fenêtre d'une minute -- adresse lue depuis l'en-tête posé par
  -- PostgREST (current_setting('request.headers')), jamais une valeur transmise par le client.
  -- Repli sur session_id si l'en-tête n'est pas exposé (ex. connexion directe hors PostgREST, comme
  -- scripts/test-analytics-rpcs.js) -- jamais un rejet total faute d'IP. Seuil à 60/minute par
  -- clé : généreux pour un usage réel (ajustements d'intensité/solo-mute répétés pendant une vraie
  -- écoute), suffisant pour bloquer une boucle d'événements/bug côté lecteur ou un script abusif.
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

  insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, detail, device)
    values (v_owner_id, p_entity_type, p_entity_id, p_session_id, p_event_name, coalesce(p_detail, '{}'::jsonb), p_device);
end;
$$;
grant execute on function public.log_analytics_event(text, text, text, text, jsonb, text) to anon, authenticated;

-- ============================================================================
-- Lecture (backstage, authentifié) — le gating par palier est fait ICI, dans la fonction elle-même,
-- pas seulement à l'affichage : un compositeur Free n'a structurellement aucun moyen de recevoir des
-- données (même en trafiquant l'appel), un Starter ne reçoit jamais `tracks`/`interactions` (jamais
-- sélectionnés côté SQL pour ce palier, pas juste omis à l'affichage).
-- ============================================================================

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
      where event_name in ('intensity_change', 'voice_solo_toggle', 'voice_mute_toggle', 'stinger_play', 'pool_refresh')
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

-- ============================================================================
-- Purge (rétention réelle, pas seulement un filtre à la lecture) — évite que la table grossisse
-- indéfiniment avec des événements que plus personne ne peut voir.
-- ============================================================================

-- Point tranché en codant (signalé, pas deviné) : la rétention appliquée est celle du palier ACTUEL
-- du compositeur au moment de la purge, pas celui en vigueur quand l'événement a été enregistré --
-- comportement le plus simple à construire, cohérent avec composer_effective_tier() qui ne calcule
-- de toute façon jamais un palier "historique". Documenté ici plutôt que deviné en silence : si un
-- compositeur rétrograde de Pro à Starter, ses événements de plus d'un mois sont supprimés à la
-- prochaine purge, même s'ils étaient encore dans la fenêtre d'un an au moment où il était Pro.
create or replace function public.purge_old_analytics_events()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.analytics_events ev
  using public.composer_profiles cp
  where ev.owner_id = cp.id
    and ev.created_at < now() - (public.analytics_retention_days(public.composer_effective_tier(cp.id)) || ' days')::interval;

  -- Compteurs de limite de fréquence : ne servent qu'à une fenêtre glissante d'une minute, tout ce
  -- qui a plus d'une heure est certainement obsolète.
  delete from public.analytics_write_rate_limit where window_start < now() - interval '1 hour';
end;
$$;

-- Tâche planifiée quotidienne (3h du matin). pg_cron est une extension officiellement supportée par
-- Supabase -- si son activation échoue faute de privilège sur ce projet, l'erreur le dira
-- explicitement et il faudra l'activer une fois depuis le tableau de bord Supabase (Database >
-- Extensions > pg_cron) avant de rejouer uniquement les deux lignes ci-dessous.
create extension if not exists pg_cron;
select cron.schedule('purge-analytics-events', '0 3 * * *', 'select public.purge_old_analytics_events();');
