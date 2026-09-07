-- Corrige get_trial_status() : oubli du cas admin, même famille de bug que celui déjà corrigé le 3
-- septembre sur effective_plan_quotas() (20260903210000_effective_plan_quotas_admin_case.sql).
-- Cette fonction alimente effectiveTierFromTrialStatus() dans le backstage (gate l'apparence par
-- palier, l'onglet Analytics, le style de forme d'onde -- et le retrait du watermark) : sans le cas
-- admin, le compte admin (aujourd'hui julzantoine@yahoo.com, plan réel 'free', aucun essai actif)
-- publie ses propres AdReels au palier Free, watermark compris -- trouvé le 7 septembre en testant
-- un autre chantier, jamais remarqué avant.
create or replace function public.get_trial_status()
returns table (plan text, trial_ends_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when exists (select 1 from public.admins a where a.profile_id = cp.profile_id) then 'pro' else cp.plan end,
    cp.trial_ends_at
  from public.composer_profiles cp where cp.profile_id = auth.uid();
$$;
