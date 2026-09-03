-- LayerPitch — Stripe Billing compositeur : essai reverse trial, tarification mensuelle/annuelle
-- (chantier 4b, décisions actées le 3 septembre — voir docs/LAYERPITCH_CHANGELOG.md).
--
-- Reverse trial : accès Pro complet pendant 30 jours, sans carte, retombée automatique sur Free à
-- l'expiration si aucune action. Géré entièrement en base (trial_ends_at) -- Stripe n'intervient
-- que pour un vrai abonnement payant, démarré immédiatement, jamais pour l'essai lui-même.

-- ---- Essai : posé uniquement à la création d'un NOUVEAU composer_profile, jamais rétroactif ----
alter table public.composer_profiles add column trial_ends_at timestamptz;

create or replace function public.ensure_composer_profile()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Non autorisé : aucune session active';
  end if;

  select id into v_id from public.composer_profiles where profile_id = v_uid;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.composer_profiles (profile_id, trial_ends_at)
    values (v_uid, now() + interval '30 days')
    returning id into v_id;
  return v_id;
end;
$$;

-- ---- Tarification mensuelle/annuelle : remplace le prix unique de plan_quotas (colonne d'origine
-- laissée telle quelle, non référencée ailleurs -- même choix que les autres colonnes orphelines
-- de cette table, docs/LAYERPITCH_CHANGELOG.md [2026-09-03h]) ----
alter table public.plan_quotas
  add column price_usd_cents_monthly int,
  add column price_usd_cents_yearly int;

-- ---- Choix du palier Free : RPC plutôt qu'un GRANT UPDATE direct (principe déjà acté,
-- docs/LAYERPITCH_CHANGELOG.md [2026-09-03g]) ----
create or replace function public.choose_free_plan()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Non autorisé : aucune session active';
  end if;
  update public.composer_profiles set plan = 'free' where profile_id = v_uid;
end;
$$;

grant execute on function public.choose_free_plan() to authenticated;

-- ---- Statut d'essai/palier du compte connecté, pour la bannière CTA du backstage ----
create or replace function public.get_trial_status()
returns table (plan text, trial_ends_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select cp.plan, cp.trial_ends_at from public.composer_profiles cp where cp.profile_id = auth.uid();
$$;

grant execute on function public.get_trial_status() to authenticated;

-- ---- Quotas effectifs : ajoute le cas "essai actif" en priorité sur le palier réel.
-- Le cas is_admin (priorité la plus haute) N'EST PAS construit ici -- profiles.is_admin n'existe
-- pas encore en base (chantier admin d'une autre session, toujours en cours de planification au
-- moment de cette migration, vérifié avant d'écrire ce fichier). À ajouter en tête de cette
-- fonction (create or replace, un seul cas de plus) une fois cette colonne réellement présente. ----
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
    case when cp.trial_ends_at > now() then pro.max_ad_reels else pq.max_ad_reels end,
    case when cp.trial_ends_at > now() then pro.max_share_links else pq.max_share_links end,
    case when cp.trial_ends_at > now() then pro.max_embeds else pq.max_embeds end,
    case when cp.trial_ends_at > now() then pro.max_audio_tracks
         when cp.student_tier_declared and pq.plan = 'starter' then 200
         else pq.max_audio_tracks end,
    case when cp.trial_ends_at > now() then pro.max_video_blocks else pq.max_video_blocks end,
    case when cp.trial_ends_at > now() then pro.max_video_storage_gb
         when cp.student_tier_declared and pq.plan = 'starter' then 5
         else pq.max_video_storage_gb end,
    case when cp.trial_ends_at > now() then pro.commission_rate
         when cp.student_tier_declared and pq.plan = 'starter' then 0.10
         else pq.commission_rate end
  from public.composer_profiles cp
  join public.plan_quotas pq on pq.plan = cp.plan
  cross join lateral (select * from public.plan_quotas where plan = 'pro') pro
  where cp.id = p_composer_id;
$$;

grant execute on function public.effective_plan_quotas(uuid) to authenticated;
