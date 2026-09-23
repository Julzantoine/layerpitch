-- LayerPitch — import vidéo réservé aux comptes admin pendant la bêta (23 septembre, demande de
-- Jules-Antoine : "l'upload vidéo, tu le grises pour tout le monde sauf les comptes admin").
--
-- L'interrupteur bêta de 20260923020000 traitait tout le monde comme Pro, y compris pour le quota de
-- stockage vidéo (max_video_storage_gb) : il ouvrait donc l'import vidéo à tous les testeurs, ce qui
-- n'était pas voulu (coût de stockage R2, et la compression côté serveur n'existe pas encore --
-- voir la note "compression vidéo" du chantier capture). Seule cette colonne change : tant que
-- l'interrupteur est actif, le quota vidéo est 0 Go pour tout le monde sauf les admins (essai reverse
-- trial compris). upsert_video refuse alors tout envoi (quota 0 = refus dès le premier octet) et
-- list_my_videos renvoie quotaGb = 0, que le backstage lit pour griser la zone de dépôt.
-- Interrupteur coupé (lancement public) : retour aux règles normales par palier.
-- Les vidéos déjà importées ne sont pas supprimées (seul un nouvel envoi est refusé).

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
  where cp.id = p_composer_id;
$$;

grant execute on function public.effective_plan_quotas(uuid) to authenticated;
