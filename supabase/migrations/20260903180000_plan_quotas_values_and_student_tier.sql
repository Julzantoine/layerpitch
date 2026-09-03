-- LayerPitch — plan_quotas renseigné (Décisions de pricing actées le 3 septembre, canal business
-- plan, docs/business-plan.md §6.1 une fois poussé) + palier étudiant compositeur.
--
-- Colonnes ajoutées à plan_quotas : le schéma initial (max_ad_reels, max_tracks, max_packs,
-- storage_mb, price_usd_cents, 20260831102635) ne couvrait pas les dimensions de la grille
-- retenue. max_tracks/max_packs/storage_mb ne sont référencées nulle part ailleurs dans le code
-- (vérifié) -- laissées telles quelles plutôt que renommées/supprimées, décision à part.

alter table public.plan_quotas
  add column max_share_links int,
  add column max_embeds int,
  add column max_audio_tracks int,
  add column max_video_blocks int,
  add column max_video_storage_gb int,
  add column commission_rate numeric;

update public.plan_quotas set
  max_ad_reels = 3, max_share_links = 5, max_embeds = 3, max_audio_tracks = 100,
  max_video_blocks = 3, max_video_storage_gb = 0, commission_rate = 0.15
  where plan = 'free';

update public.plan_quotas set
  max_ad_reels = 10, max_share_links = 10, max_embeds = 10, max_audio_tracks = null,
  max_video_blocks = 10, max_video_storage_gb = 20, commission_rate = 0.05
  where plan = 'starter';

update public.plan_quotas set
  max_ad_reels = null, max_share_links = null, max_embeds = null, max_audio_tracks = null,
  max_video_blocks = null, max_video_storage_gb = 100, commission_rate = 0.01
  where plan = 'pro';

-- Palier du compte : rien ne reliait jusqu'ici un composer_profile à une ligne de plan_quotas.
-- Réglable à la main pour l'instant (en attendant Stripe Billing, qui l'assignera automatiquement
-- une fois construit) -- 'free' par défaut, cohérent avec le fait qu'aucun compte existant n'a
-- souscrit à quoi que ce soit.
alter table public.composer_profiles
  add column plan text not null default 'free' references public.plan_quotas(plan);

-- Dérogation "palier étudiant" (déclarative, aucune vérification de justificatif à ce stade) --
-- volontairement pas nommée "remise" dans le code : certains champs deviennent MEILLEURS que le
-- palier starter de base (max_audio_tracks passe d'illimité à 200, donc en réalité plus restrictif)
-- et d'autres moins bons (video_storage_gb réduit, commission_rate augmentée) -- un compromis, pas
-- une réduction pure. Champ sur composer_profiles plutôt qu'une ligne dédiée dans plan_quotas :
-- une ligne "starter_student" obligerait à dupliquer "pro_student" le jour où la dérogation
-- s'étend à d'autres paliers (explosion combinatoire), et à élargir la contrainte check() sur
-- plan_quotas.plan à chaque nouveau cas. Un booléen + résolution à la lecture reste extensible
-- sans toucher au schéma pour un futur nouveau cas de dérogation.
alter table public.composer_profiles
  add column student_tier_declared boolean not null default false;

-- Résolution des quotas effectifs d'un compositeur : palier de base, puis dérogation étudiante
-- appliquée par-dessus si active ET palier starter (le cas déclaré aujourd'hui -- étendre le
-- "and" ci-dessous le jour où la dérogation couvre d'autres paliers). Fonction plutôt qu'une vue :
-- appelée avec l'id d'un compositeur précis, pas destinée à lister tous les comptes à la fois.
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
    pq.plan, pq.max_ad_reels, pq.max_share_links, pq.max_embeds,
    case when cp.student_tier_declared and pq.plan = 'starter' then 200 else pq.max_audio_tracks end,
    pq.max_video_blocks,
    case when cp.student_tier_declared and pq.plan = 'starter' then 5 else pq.max_video_storage_gb end,
    case when cp.student_tier_declared and pq.plan = 'starter' then 0.10 else pq.commission_rate end
  from public.composer_profiles cp
  join public.plan_quotas pq on pq.plan = cp.plan
  where cp.id = p_composer_id;
$$;

grant execute on function public.effective_plan_quotas(uuid) to authenticated;
