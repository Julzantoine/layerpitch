-- LayerPitch — suivi du tutoriel dans l'app (13/11).
--
-- Jusqu'ici les événements du tutoriel (tuto_lesson_open, tuto_step, tuto_lesson_done, tuto_lesson_quit…) partaient uniquement vers
-- Umami (voir layerpitch-tuto.js), dont l'API est payante : impossible de les afficher dans l'admin. Ils sont maintenant AUSSI écrits
-- dans cette table (Umami continue de les recevoir). Décisions de Jules-Antoine (13/11) : base + Umami ; identifiant aléatoire par
-- visite (aucun lien avec un compte, aucun cookie) ; entonnoir par leçon + évolution dans le temps + filtre de période.
--
-- Table séparée de analytics_events : celle-ci exige un propriétaire (compositeur) alors que le tutoriel est anonyme.
-- Même patron de sécurité : RLS sans policy, écriture publique par fonction SECURITY DEFINER avec limite de débit, lecture admin seulement.

create table public.tutorial_events (
  id bigserial primary key,
  session_id text not null,
  event_name text not null,
  lesson text,
  step int,
  steps int,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index tutorial_events_created_idx on public.tutorial_events(created_at desc);
create index tutorial_events_lesson_idx on public.tutorial_events(lesson, session_id);
alter table public.tutorial_events enable row level security;

-- ============================================================================
-- Écriture (visiteurs du tutoriel, sans authentification)
-- ============================================================================
create or replace function public.log_tutorial_event(
  p_session_id text,
  p_event_name text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text;
  v_bucket text;
  v_count int;
  v_lesson text;
  v_step int;
  v_steps int;
begin
  -- Rejet silencieux : le suivi ne doit jamais faire échouer la page, même sur une entrée mal formée.
  if p_session_id is null or length(p_session_id) = 0 or length(p_session_id) > 100 then return; end if;
  if p_event_name is null or p_event_name not in
     ('lesson_open', 'step', 'lesson_done', 'lesson_quit', 'tour_open', 'tour_step', 'tour_done', 'tour_quit', 'sample_use') then return; end if;
  if p_detail is null or jsonb_typeof(p_detail) <> 'object' then p_detail := '{}'::jsonb; end if;

  -- Limite de débit par IP (en-tête posé par PostgREST), 60 événements/minute, même table de compteurs que les autres écritures publiques.
  v_ip := coalesce(
    nullif(split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1), ''),
    p_session_id
  );
  v_bucket := 'tuto:' || v_ip || ':' || floor(extract(epoch from now()) / 60)::text;
  insert into public.analytics_write_rate_limit (bucket_key, event_count)
    values (v_bucket, 1)
    on conflict (bucket_key) do update set event_count = analytics_write_rate_limit.event_count + 1
    returning event_count into v_count;
  if v_count > 60 then return; end if;

  v_lesson := nullif(left(p_detail->>'lesson', 60), '');
  -- Hors visite guidée, un événement sans leçon ne dit rien : rejeté (la ligne fausserait les courbes).
  if v_lesson is null and p_event_name not like 'tour\_%' then return; end if;
  v_step := case when (p_detail->>'step') ~ '^\d{1,3}$' then (p_detail->>'step')::int end;
  v_steps := case when (p_detail->>'steps') ~ '^\d{1,3}$' then (p_detail->>'steps')::int end;

  -- Seuls les champs connus sont gardés (jamais le détail brut envoyé par le navigateur).
  insert into public.tutorial_events (session_id, event_name, lesson, step, steps, detail)
    values (p_session_id, p_event_name, v_lesson, v_step, v_steps,
            jsonb_strip_nulls(jsonb_build_object('key', left(p_detail->>'key', 80), 'files', case when (p_detail->>'files') ~ '^\d{1,3}$' then (p_detail->>'files')::int end)));
end;
$$;
grant execute on function public.log_tutorial_event(text, text, jsonb) to anon, authenticated;

-- ============================================================================
-- Lecture (admin seulement)
-- ============================================================================
-- p_days : 7, 30 ou 0 (= tout). Renvoie :
--   lessons : une entrée par leçon (et par visite guidée, lesson = '(visite guidée)') avec le nombre de visites qui l'ont ouverte,
--             terminée, abandonnée, et l'entonnoir : pour chaque numéro d'étape, combien de visites l'ont atteinte.
--   series  : une entrée par jour (ouvertures, fins, abandons), jours sans événement compris, pour une courbe continue.
create or replace function public.admin_tutorial_stats(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz;
  v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  v_from := case when coalesce(p_days, 0) > 0 then now() - make_interval(days => p_days) else '-infinity'::timestamptz end;

  with ev as (
    select session_id, event_name, created_at,
           case when event_name like 'tour\_%' then '(visite guidée)' else lesson end as lesson,
           step, steps
    from public.tutorial_events
    where created_at >= v_from and event_name <> 'sample_use'
      and (event_name like 'tour\_%' or lesson is not null)
  ),
  -- Étape la plus avancée de chaque visite dans chaque leçon : ouverture = 1, fin = dernière étape.
  progress as (
    select lesson, session_id,
           max(case when event_name in ('lesson_open', 'tour_open') then 1
                    when event_name in ('lesson_done', 'tour_done') then coalesce(steps, step, 1)
                    else coalesce(step, 1) end) as max_step,
           bool_or(event_name in ('lesson_open', 'tour_open')) as opened,
           bool_or(event_name in ('lesson_done', 'tour_done')) as done,
           bool_or(event_name in ('lesson_quit', 'tour_quit')) as quit
    from ev group by lesson, session_id
  ),
  total_steps as (select lesson, max(steps) as steps from ev group by lesson),
  lesson_rows as (
    select p.lesson,
           coalesce(t.steps, max(p.max_step)) as steps,
           count(*) filter (where p.opened) as opened,
           count(*) filter (where p.done) as done,
           count(*) filter (where p.quit and not p.done) as quit,
           coalesce(jsonb_agg(p.max_step), '[]'::jsonb) as max_steps
    from progress p left join total_steps t using (lesson)
    group by p.lesson, t.steps
  )
  select jsonb_build_object(
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lesson', lr.lesson, 'steps', lr.steps, 'opened', lr.opened, 'done', lr.done, 'quit', lr.quit,
        'reached', (select coalesce(jsonb_agg((select count(*) from jsonb_array_elements_text(lr.max_steps) m where m::int >= n) order by n), '[]'::jsonb)
                    from generate_series(1, greatest(coalesce(lr.steps, 1), 1)) n)
      ) order by lr.opened desc, lr.lesson)
      from lesson_rows lr), '[]'::jsonb),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'opened', coalesce(s.opened, 0), 'done', coalesce(s.done, 0), 'quit', coalesce(s.quit, 0)) order by d.day)
      from (select generate_series(
              (select least(coalesce(nullif(v_from, '-infinity'::timestamptz), min(created_at)), now())::date from public.tutorial_events),
              now()::date, interval '1 day')::date as day) d
      left join (
        select created_at::date as day,
               count(distinct session_id) filter (where event_name in ('lesson_open', 'tour_open')) as opened,
               count(distinct session_id) filter (where event_name in ('lesson_done', 'tour_done')) as done,
               count(distinct session_id) filter (where event_name in ('lesson_quit', 'tour_quit')) as quit
        from public.tutorial_events where created_at >= v_from and event_name <> 'sample_use' group by 1
      ) s on s.day = d.day), '[]'::jsonb),
    'samples', coalesce((
      select jsonb_agg(jsonb_build_object('lesson', x.lesson, 'uses', x.uses) order by x.uses desc)
      from (select coalesce(lesson, '?') as lesson, count(*) as uses from public.tutorial_events
            where created_at >= v_from and event_name = 'sample_use' group by 1) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.admin_tutorial_stats(int) from public, anon;
grant execute on function public.admin_tutorial_stats(int) to authenticated;
