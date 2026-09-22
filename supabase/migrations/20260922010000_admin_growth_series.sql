-- LayerPitch — courbe d'évolution dans le temps pour le panneau admin (demande de Jules-Antoine,
-- 22 septembre) : le panneau Statistiques ne donnait jusqu'ici que des totaux à l'instant présent
-- et un filtre "nouveaux sur la période" (un seul chiffre agrégé, 20260917020000) — pas de tracé
-- dans le temps. Aucune nouvelle table nécessaire : chaque table catalogue a déjà created_at,
-- il suffit de regrouper par semaine/mois plutôt que de tout compter d'un coup.
--
-- Même jeu de métriques que "nouveaux sur la période" (accounts/composers/studios/fans/adReels/
-- packs/tracks/sfx/collections/albums), décidé avec Jules-Antoine : "tout ce qui existe déjà dans
-- les statistiques" plutôt qu'un sous-ensemble limité à compositeurs/AdReels.
--
-- Zéro-remplissage des périodes sans activité (generate_series des buckets, puis comptage par
-- bucket) — une semaine sans nouveau compositeur doit apparaître comme 0, pas être absente du
-- graphique (sinon la courbe suggérerait à tort une activité continue).

create or replace function public.admin_get_growth_series(p_granularity text default 'week', p_periods int default 12)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit interval;
  v_start timestamptz;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;
  if p_granularity not in ('week', 'month') then
    raise exception 'p_granularity doit valoir ''week'' ou ''month''';
  end if;
  if p_periods is null or p_periods < 1 or p_periods > 104 then
    raise exception 'p_periods doit être compris entre 1 et 104';
  end if;

  v_unit := case p_granularity when 'week' then interval '1 week' else interval '1 month' end;
  v_start := date_trunc(p_granularity, now()) - (p_periods - 1) * v_unit;

  with buckets as (
    select generate_series(v_start, date_trunc(p_granularity, now()), v_unit) as bucket
  ),
  counted as (
    select
      b.bucket,
      (select count(*) from public.profiles p where date_trunc(p_granularity, p.created_at) = b.bucket) as accounts,
      (select count(*) from public.composer_profiles cp where date_trunc(p_granularity, cp.created_at) = b.bucket) as composers,
      (select count(*) from public.studio_profiles sp where date_trunc(p_granularity, sp.created_at) = b.bucket) as studios,
      (select count(*) from public.fan_profiles fp where date_trunc(p_granularity, fp.created_at) = b.bucket) as fans,
      (select count(*) from public.ad_reels ar where date_trunc(p_granularity, ar.created_at) = b.bucket) as ad_reels,
      (select count(*) from public.packs pk where date_trunc(p_granularity, pk.created_at) = b.bucket) as packs,
      (select count(*) from public.tracks tr where date_trunc(p_granularity, tr.created_at) = b.bucket) as tracks,
      (select count(*) from public.sfx_library sx where date_trunc(p_granularity, sx.created_at) = b.bucket) as sfx,
      (select count(*) from public.collections cl where date_trunc(p_granularity, cl.created_at) = b.bucket) as collections,
      (select count(*) from public.albums al where date_trunc(p_granularity, al.created_at) = b.bucket) as albums
    from buckets b
  )
  select jsonb_build_object(
    'granularity', p_granularity,
    'buckets', (select jsonb_agg(to_char(bucket, 'YYYY-MM-DD') order by bucket) from counted),
    'series', jsonb_build_object(
      'accounts', (select jsonb_agg(accounts order by bucket) from counted),
      'composers', (select jsonb_agg(composers order by bucket) from counted),
      'studios', (select jsonb_agg(studios order by bucket) from counted),
      'fans', (select jsonb_agg(fans order by bucket) from counted),
      'adReels', (select jsonb_agg(ad_reels order by bucket) from counted),
      'packs', (select jsonb_agg(packs order by bucket) from counted),
      'tracks', (select jsonb_agg(tracks order by bucket) from counted),
      'sfx', (select jsonb_agg(sfx order by bucket) from counted),
      'collections', (select jsonb_agg(collections order by bucket) from counted),
      'albums', (select jsonb_agg(albums order by bucket) from counted)
    )
  ) into v_result;

  return v_result;
end;
$$;
grant execute on function public.admin_get_growth_series(text, int) to authenticated;
