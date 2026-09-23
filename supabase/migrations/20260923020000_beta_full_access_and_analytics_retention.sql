-- LayerPitch — accès complet pendant la bêta + rétention des données d'analytique indépendante du
-- palier (23 septembre, décisions de Jules-Antoine).
--
-- Constat en préparant la refonte de l'analytique compositeur : la promesse "les bêta-testeurs ont
-- accès à toutes les fonctions pendant la bêta" n'était implémentée nulle part. Le palier effectif ne
-- connaît que le palier brut et l'essai reverse trial de 30 jours -- 13 comptes sur 16 étaient `free`
-- sans essai (onglet Analytics verrouillé, quota vidéo à 0 Go), et le nettoyage nocturne
-- (purge_old_analytics_events) appliquait une rétention de 0 jour au palier `free` : il supprimait
-- chaque nuit les événements des compositeurs Free (analytics_events contenait 0 ligne).
--
-- 1. Interrupteur global beta_program.full_access (singleton). Vrai = tout le monde est traité comme
--    Pro, à la fois côté base (composer_effective_tier, effective_plan_quotas) et côté écran
--    (get_trial_status, qui alimente effectiveTierFromTrialStatus() dans le backstage). Ne touche
--    aucun compte individuel ni aucun abonnement Stripe : le palier réel (composer_profiles.plan)
--    reste intact. Table distincte de platform_flags exprès : cette dernière est créée par la
--    migration 20260921070000 de la branche adaptive-ost-sales (pas encore sur main) -- s'y appuyer
--    ici casserait toute base reconstruite depuis main seul. Fusion possible plus tard.
--    AU LANCEMENT PUBLIC : passer full_access à false ET poser trial_ends_at = date du lancement + 3
--    mois sur les comptes existants (offre bêta-testeurs : 3 mois de Pro en plus, mécanisme d'essai
--    déjà en place, get_trial_status affiche alors l'expiration) ; le voucher -50 % est un coupon
--    Stripe à créer côté dashboard (allow_promotion_codes est déjà actif).
--
-- 2. Rétention : le nettoyage ne dépend plus du palier. Il supprime uniquement au-delà de la
--    rétention MAXIMALE (celle de Pro, 1 an) pour tout le monde. Le palier ne décide que de ce qui
--    est VISIBLE (get_my_analytics : Starter 30 jours, Pro 1 an, Free verrouillé). Un compositeur qui
--    repasse en Free (carte refusée, oubli...) retrouve ainsi ses données en repassant Pro, tant
--    qu'elles ont moins d'un an. Coût assumé : les événements des comptes Free sont conservés aussi
--    (à revoir si le volume devient un sujet).
--
-- Le cas admin est ajouté à composer_effective_tier() au passage (déjà présent dans
-- get_trial_status et effective_plan_quotas depuis les 3 et 7 septembre ; omis ici le 5 septembre).

create table public.beta_program (
  id boolean primary key default true,
  constraint beta_program_singleton check (id),
  full_access boolean not null default true
);
comment on table public.beta_program is 'Interrupteur global de la bêta (ligne unique). full_access = true : tout le monde est traité comme Pro (voir beta_full_access()). Écriture uniquement par SQL direct / service_role. À passer à false au lancement public.';
insert into public.beta_program (id) values (true);
alter table public.beta_program enable row level security;
-- Aucune policy : lue uniquement via beta_full_access() (security definer).

create or replace function public.beta_full_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select full_access from public.beta_program where id), false);
$$;
grant execute on function public.beta_full_access() to authenticated;

create or replace function public.composer_effective_tier(p_composer_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.beta_full_access() then 'pro'
    when exists (select 1 from public.admins a where a.profile_id = cp.profile_id) then 'pro'
    when cp.trial_ends_at > now() then 'pro'
    else cp.plan
  end
  from public.composer_profiles cp
  where cp.id = p_composer_id;
$$;

create or replace function public.get_trial_status()
returns table (plan text, trial_ends_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when public.beta_full_access() or exists (select 1 from public.admins a where a.profile_id = cp.profile_id) then 'pro' else cp.plan end,
    cp.trial_ends_at
  from public.composer_profiles cp where cp.profile_id = auth.uid();
$$;

create or replace function public.effective_plan_quotas(p_composer_id uuid)
returns table (
  plan text, max_ad_reels int, max_share_links int, max_embeds int,
  max_audio_tracks int, max_video_blocks int, max_video_storage_gb int, commission_rate numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pq.plan,
    case when (public.beta_full_access() or exists (select 1 from public.admins a where a.profile_id = cp.profile_id)) then pro.max_ad_reels
         when cp.trial_ends_at > now() then pro.max_ad_reels
         else pq.max_ad_reels end,
    case when (public.beta_full_access() or exists (select 1 from public.admins a where a.profile_id = cp.profile_id)) then pro.max_share_links
         when cp.trial_ends_at > now() then pro.max_share_links
         else pq.max_share_links end,
    case when (public.beta_full_access() or exists (select 1 from public.admins a where a.profile_id = cp.profile_id)) then pro.max_embeds
         when cp.trial_ends_at > now() then pro.max_embeds
         else pq.max_embeds end,
    case when (public.beta_full_access() or exists (select 1 from public.admins a where a.profile_id = cp.profile_id)) then pro.max_audio_tracks
         when cp.trial_ends_at > now() then pro.max_audio_tracks
         when cp.student_tier_declared and pq.plan = 'starter' then 200
         else pq.max_audio_tracks end,
    case when (public.beta_full_access() or exists (select 1 from public.admins a where a.profile_id = cp.profile_id)) then pro.max_video_blocks
         when cp.trial_ends_at > now() then pro.max_video_blocks
         else pq.max_video_blocks end,
    case when (public.beta_full_access() or exists (select 1 from public.admins a where a.profile_id = cp.profile_id)) then pro.max_video_storage_gb
         when cp.trial_ends_at > now() then pro.max_video_storage_gb
         when cp.student_tier_declared and pq.plan = 'starter' then 5
         else pq.max_video_storage_gb end,
    case when (public.beta_full_access() or exists (select 1 from public.admins a where a.profile_id = cp.profile_id)) then pro.commission_rate
         when cp.trial_ends_at > now() then pro.commission_rate
         when cp.student_tier_declared and pq.plan = 'starter' then 0.10
         else pq.commission_rate end
  from public.composer_profiles cp
  join public.plan_quotas pq on pq.plan = cp.plan
  cross join lateral (select * from public.plan_quotas where plan = 'pro') pro
  where cp.id = p_composer_id;
$$;

grant execute on function public.effective_plan_quotas(uuid) to authenticated;

create or replace function public.purge_old_analytics_events()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.analytics_events
  where created_at < now() - (public.analytics_retention_days('pro') || ' days')::interval;

  delete from public.analytics_write_rate_limit where window_start < now() - interval '1 hour';
end;
$$;
