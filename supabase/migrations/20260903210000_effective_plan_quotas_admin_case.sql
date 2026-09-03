-- LayerPitch — ajoute le cas admin (priorité la plus haute) à effective_plan_quotas().
--
-- Le plan approuvé du 3 septembre (chantier 4b, docs/infrastructure.md) prévoyait le compte de
-- Jules-Antoine couvert par un statut admin plutôt qu'un palier dédié -- la migration
-- 20260903190000 avait volontairement omis ce cas, ayant vérifié qu'une colonne
-- profiles.is_admin n'existait pas. Trouvé après coup : le mécanisme existe déjà, sous une forme
-- différente -- une table admins + fonction is_admin() (20260901190000_admin_role.sql), déjà en
-- prod pour invite-tester. Corrige l'omission en s'appuyant dessus, aucun nouveau mécanisme à
-- construire.
--
-- is_admin() vérifie auth.uid() de l'appelant -- pas utilisable ici tel quel, cette fonction
-- calcule les quotas d'un p_composer_id donné (pas forcément l'appelant). On vérifie donc
-- directement la table admins pour le profile_id propriétaire du composer_profile concerné.

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
    case when exists (select 1 from public.admins a where a.profile_id = cp.profile_id) then pro.max_ad_reels
         when cp.trial_ends_at > now() then pro.max_ad_reels
         else pq.max_ad_reels end,
    case when exists (select 1 from public.admins a where a.profile_id = cp.profile_id) then pro.max_share_links
         when cp.trial_ends_at > now() then pro.max_share_links
         else pq.max_share_links end,
    case when exists (select 1 from public.admins a where a.profile_id = cp.profile_id) then pro.max_embeds
         when cp.trial_ends_at > now() then pro.max_embeds
         else pq.max_embeds end,
    case when exists (select 1 from public.admins a where a.profile_id = cp.profile_id) then pro.max_audio_tracks
         when cp.trial_ends_at > now() then pro.max_audio_tracks
         when cp.student_tier_declared and pq.plan = 'starter' then 200
         else pq.max_audio_tracks end,
    case when exists (select 1 from public.admins a where a.profile_id = cp.profile_id) then pro.max_video_blocks
         when cp.trial_ends_at > now() then pro.max_video_blocks
         else pq.max_video_blocks end,
    case when exists (select 1 from public.admins a where a.profile_id = cp.profile_id) then pro.max_video_storage_gb
         when cp.trial_ends_at > now() then pro.max_video_storage_gb
         when cp.student_tier_declared and pq.plan = 'starter' then 5
         else pq.max_video_storage_gb end,
    case when exists (select 1 from public.admins a where a.profile_id = cp.profile_id) then pro.commission_rate
         when cp.trial_ends_at > now() then pro.commission_rate
         when cp.student_tier_declared and pq.plan = 'starter' then 0.10
         else pq.commission_rate end
  from public.composer_profiles cp
  join public.plan_quotas pq on pq.plan = cp.plan
  cross join lateral (select * from public.plan_quotas where plan = 'pro') pro
  where cp.id = p_composer_id;
$$;

grant execute on function public.effective_plan_quotas(uuid) to authenticated;
