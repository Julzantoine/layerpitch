-- LayerPitch — espace Projet, étape 6b (décision Q10 du 28/09) : statistiques des vitrines, copiées sur celles des
-- compositeurs, avec les MÊMES limitations par palier, selon le palier du PROPRIÉTAIRE du Projet :
--   compositeur Rookie (free) / Warrior (starter) / Boss (pro) ; studio SoloDev -> comme Rookie (aperçu flouté),
--   Indie -> comme Warrior (basique), AA / AAA -> comme Boss (avancé). Rétention : analytics_retention_days(palier).
--   * vitrine_events : journal à part (une vitrine peut appartenir à un studio : le journal des compositeurs, rangé par
--     compositeur, ne convient pas). Aucune donnée personnelle : identifiant de visite aléatoire, type d'appareil.
--   * log_vitrine_event : écriture publique (sans compte), limitée en fréquence ; les visites des membres du Projet ne
--     comptent pas. Première ouverture d'une vitrine éditeur -> une ligne dans le journal d'activité du Projet (la cloche
--     de chaque membre la signale).
--   * get_vitrine_stats : lecture par les membres du Projet ; basique = ouvertures, visites, par jour ; avancé = + ce que
--     les visiteurs ont fait (écoutes, liens…) et appareils. Aperçu (palier bas) : mêmes chiffres, la page les floute.

create table public.vitrine_events (
  id bigserial primary key,
  vitrine_id uuid not null references public.project_vitrines(id) on delete cascade,
  session_id text not null,
  event_name text not null,
  detail jsonb not null default '{}'::jsonb,
  device text check (device is null or device in ('mobile', 'desktop')),
  tier text not null,
  created_at timestamptz not null default now()
);
create index vitrine_events_idx on public.vitrine_events(vitrine_id, created_at desc);
alter table public.vitrine_events enable row level security;

-- Palier « statistiques » du propriétaire d'un Projet, exprimé dans les codes des compositeurs (free / starter / pro).
create or replace function public.project_stats_tier(p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case p.owner_kind
    when 'composer' then coalesce((select public.composer_effective_tier(cp.id) from public.composer_profiles cp where cp.profile_id = p.owner_profile_id), 'free')
    else case (select sp.plan from public.studio_profiles sp where sp.id = p.owner_studio_id) when 'indie' then 'starter' when 'aa' then 'pro' when 'aaa' then 'pro' else 'free' end
  end
  from public.projects p where p.id = p_project_id;
$$;

create or replace function public.log_vitrine_event(p_vitrine_id uuid, p_session_id text, p_event_name text, p_detail jsonb default '{}'::jsonb, p_device text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v record; v_tier text; v_ip text; v_bucket text; v_count int; v_first boolean;
begin
  if p_session_id is null or length(p_session_id) = 0 or length(p_session_id) > 200 then return; end if;
  if p_event_name is null or p_event_name !~ '^[a-z_]{1,60}$' then return; end if;
  if p_device is not null and p_device not in ('mobile', 'desktop') then p_device := null; end if;
  select * into v from public.project_vitrines where id = p_vitrine_id and (published or audience = 'publisher');
  if not found then return; end if;
  -- Les visites des membres du Projet ne comptent pas (comme celles d'un compositeur sur son propre AdReel).
  if auth.uid() is not null and public.project_role(v.project_id, auth.uid()) is not null then return; end if;
  v_ip := coalesce(nullif(split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1), ''), p_session_id);
  v_bucket := 'v:' || v_ip || ':' || floor(extract(epoch from now()) / 60)::text;
  insert into public.analytics_write_rate_limit (bucket_key, event_count) values (v_bucket, 1)
    on conflict (bucket_key) do update set event_count = analytics_write_rate_limit.event_count + 1
    returning event_count into v_count;
  if v_count > 60 then return; end if;
  v_tier := public.project_stats_tier(v.project_id);
  v_first := p_event_name = 'page_open' and v.audience = 'publisher'
    and not exists (select 1 from public.vitrine_events where vitrine_id = v.id and event_name = 'page_open');
  insert into public.vitrine_events (vitrine_id, session_id, event_name, detail, device, tier)
  values (v.id, p_session_id, p_event_name, case when length(coalesce(p_detail, '{}'::jsonb)::text) <= 2000 then coalesce(p_detail, '{}'::jsonb) else '{}'::jsonb end, p_device, v_tier);
  if v_first then
    insert into public.project_activity (project_id, actor_id, kind, payload) values (v.project_id, null, 'vitrine_first_open', jsonb_build_object('title', v.title));
  end if;
end;
$$;

-- p_days : fenêtre demandée, bornée par la rétention du palier.
create or replace function public.get_vitrine_stats(p_vitrine_id uuid, p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v record; v_tier text; v_level text; v_ret int; v_since timestamptz; v_res jsonb;
begin
  select * into v from public.project_vitrines where id = p_vitrine_id;
  if not found then raise exception 'Vitrine introuvable'; end if;
  perform public.assert_project_role(v.project_id);
  v_tier := public.project_stats_tier(v.project_id);
  v_level := case v_tier when 'pro' then 'advanced' when 'starter' then 'basic' else 'teaser' end;
  v_ret := greatest(public.analytics_retention_days(v_tier), 1);
  v_since := now() - (least(greatest(coalesce(p_days, 30), 1), v_ret) || ' days')::interval;
  v_res := jsonb_build_object('level', v_level, 'tier', v_tier, 'retentionDays', v_ret,
    'opens', (select count(*) from public.vitrine_events where vitrine_id = v.id and event_name = 'page_open' and created_at >= v_since),
    'visits', (select count(distinct session_id) from public.vitrine_events where vitrine_id = v.id and created_at >= v_since),
    'lastOpenAt', (select max(created_at) from public.vitrine_events where vitrine_id = v.id and event_name = 'page_open'),
    'byDay', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'opens', n) order by d), '[]'::jsonb) from (
        select date_trunc('day', created_at)::date as d, count(*) as n from public.vitrine_events
        where vitrine_id = v.id and event_name = 'page_open' and created_at >= v_since group by 1) t));
  if v_level = 'advanced' then
    v_res := v_res || jsonb_build_object(
      'events', (select coalesce(jsonb_agg(jsonb_build_object('name', event_name, 'count', n) order by n desc), '[]'::jsonb) from (
          select event_name, count(*) as n from public.vitrine_events where vitrine_id = v.id and event_name <> 'page_open' and created_at >= v_since group by 1) t),
      'links', (select coalesce(jsonb_agg(jsonb_build_object('label', l, 'count', n) order by n desc), '[]'::jsonb) from (
          select detail->>'label' as l, count(*) as n from public.vitrine_events where vitrine_id = v.id and event_name = 'link_click' and created_at >= v_since group by 1) t),
      'devices', (select coalesce(jsonb_object_agg(coalesce(device, 'inconnu'), n), '{}'::jsonb) from (
          select device, count(distinct session_id) as n from public.vitrine_events where vitrine_id = v.id and created_at >= v_since group by 1) t));
  end if;
  return v_res;
end;
$$;

-- Nettoyage : chaque événement selon la rétention du palier sous lequel il a été collecté (même règle que les AdReels).
create or replace function public.purge_old_vitrine_events()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  delete from public.vitrine_events where created_at < now() - (greatest(public.analytics_retention_days(tier), 1) || ' days')::interval;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
select cron.schedule('purge-vitrine-events', '20 3 * * *', 'select public.purge_old_vitrine_events()');

revoke execute on function public.project_stats_tier(uuid), public.purge_old_vitrine_events() from public, anon, authenticated;
grant execute on function public.purge_old_vitrine_events() to service_role;
revoke execute on function public.log_vitrine_event(uuid, text, text, jsonb, text) from public;
grant execute on function public.log_vitrine_event(uuid, text, text, jsonb, text) to anon, authenticated;
revoke execute on function public.get_vitrine_stats(uuid, int) from public, anon;
grant execute on function public.get_vitrine_stats(uuid, int) to authenticated;
