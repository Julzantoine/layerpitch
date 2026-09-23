-- LayerPitch — sélecteur admin "Voir en tant que" GLOBAL (23 septembre, demande de Jules-Antoine :
-- "ce sélecteur peut s'appliquer partout où il y a des limitations de paliers pour que je puisse tout
-- vérifier"). Décisions : choix MÉMORISÉ côté serveur ; les publications gardent le VRAI palier (un
-- sélecteur par AdReel, côté écran, permet de publier volontairement sous un autre palier).
--
-- Portée : le palier choisi (admins.preview_tier) n'est lu que quand l'appelant est cet admin ET
-- que la question porte sur SON PROPRE compositeur -- own_preview_tier_for(). Le nettoyage nocturne
-- (pas d'auth.uid()), les événements des visiteurs et les autres comptes ne voient jamais ce choix :
-- aucun risque pour les données. Il alimente les trois fonctions centrales de palier :
-- composer_effective_tier (analytique), effective_plan_quotas (quota vidéo) et get_trial_status
-- (tout l'affichage du backstage). get_trial_status renvoie en plus real_plan (le vrai palier, utilisé
-- pour figer le palier à la publication) et preview_active.
-- Remplace, côté écran, le sélecteur limité à la page Analytics (le paramètre p_preview_tier des
-- fonctions d'analytique reste accepté mais n'est plus utilisé par l'interface).

alter table public.admins add column preview_tier text check (preview_tier is null or preview_tier in ('free', 'starter', 'pro'));
comment on column public.admins.preview_tier is 'Palier simulé par cet admin ("Voir en tant que"), NULL = accès admin normal. Lu uniquement pour son propre compositeur, jamais par le nettoyage ni pour un autre compte.';

create or replace function public.own_preview_tier_for(p_composer_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select a.preview_tier
  from public.admins a
  join public.composer_profiles cp on cp.profile_id = a.profile_id
  where a.profile_id = auth.uid() and cp.id = p_composer_id;
$$;
grant execute on function public.own_preview_tier_for(uuid) to authenticated;

create or replace function public.set_my_preview_tier(p_tier text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;
  if p_tier is not null and p_tier <> '' and p_tier not in ('free', 'starter', 'pro') then
    raise exception 'p_tier doit valoir free, starter, pro (ou vide pour revenir à admin)';
  end if;
  update public.admins set preview_tier = nullif(p_tier, '') where profile_id = auth.uid();
end;
$$;
grant execute on function public.set_my_preview_tier(text) to authenticated;

create or replace function public.composer_effective_tier(p_composer_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.own_preview_tier_for(p_composer_id) is not null then public.own_preview_tier_for(p_composer_id)
    when public.beta_full_access() then 'pro'
    when exists (select 1 from public.admins a where a.profile_id = cp.profile_id) then 'pro'
    when cp.trial_ends_at > now() then 'pro'
    else cp.plan
  end
  from public.composer_profiles cp
  where cp.id = p_composer_id;
$$;

-- get_trial_status : colonnes de sortie changées (real_plan, preview_active) -> drop puis create.
drop function if exists public.get_trial_status();
create function public.get_trial_status()
returns table (plan text, trial_ends_at timestamptz, real_plan text, preview_active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(cp_pv.preview_tier, r.p),
    cp.trial_ends_at,
    r.p,
    cp_pv.preview_tier is not null
  from public.composer_profiles cp
  cross join lateral (
    select case when public.beta_full_access() or exists (select 1 from public.admins a where a.profile_id = cp.profile_id)
                then 'pro' else cp.plan end as p
  ) r
  left join lateral (select a2.preview_tier from public.admins a2 where a2.profile_id = cp.profile_id) cp_pv on true
  where cp.profile_id = auth.uid();
$$;
grant execute on function public.get_trial_status() to authenticated;

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
    case when exists (select 1 from public.admins a where a.profile_id = cp.profile_id) then pro.max_video_storage_gb
         when public.beta_full_access() then 0
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
  where cp.id = p_composer_id
    and public.own_preview_tier_for(p_composer_id) is null
  union all
  select q.plan, q.max_ad_reels, q.max_share_links, q.max_embeds, q.max_audio_tracks, q.max_video_blocks,
         q.max_video_storage_gb, q.commission_rate
  from public.plan_quotas q
  where q.plan = public.own_preview_tier_for(p_composer_id);
$$;

grant execute on function public.effective_plan_quotas(uuid) to authenticated;
