-- LayerPitch — preset "6 mois" sur le filtre de période du panneau Statistiques admin (23 septembre,
-- demande de Jules-Antoine : presets 24h / 7j / 1 mois / 6 mois / 1 an). Même fonction que
-- 20260917020000, une seule branche de plus dans le `case` -- même signature (text), donc un simple
-- create or replace suffit (pas de surcharge fantôme à supprimer).

create or replace function public.admin_get_stats(p_period text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_composer_count int;
  v_since timestamptz;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;

  v_since := case p_period
    when '24h' then now() - interval '24 hours'
    when '7d' then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    when '6m' then now() - interval '6 months'
    when '1y' then now() - interval '1 year'
    else null
  end;

  select count(*) into v_composer_count from public.composer_profiles;

  select jsonb_build_object(
    'accounts', jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'suspended', (select count(*) from public.profiles where suspended),
      'composers', v_composer_count,
      'studios', (select count(*) from public.studio_profiles),
      'fans', (select count(*) from public.fan_profiles)
    ),
    'content', jsonb_build_object(
      'adReels', (select count(*) from public.ad_reels),
      'packs', (select count(*) from public.packs),
      'tracks', (select count(*) from public.tracks),
      'sfx', (select count(*) from public.sfx_library),
      'collections', (select count(*) from public.collections),
      'albums', (select count(*) from public.albums)
    ),
    'composerAverages', jsonb_build_object(
      'tracksPerComposer', case when v_composer_count > 0 then round((select count(*)::numeric from public.tracks) / v_composer_count, 2) else 0 end,
      'packsPerComposer', case when v_composer_count > 0 then round((select count(*)::numeric from public.packs) / v_composer_count, 2) else 0 end,
      'adReelsPerComposer', case when v_composer_count > 0 then round((select count(*)::numeric from public.ad_reels) / v_composer_count, 2) else 0 end
    ),
    'newInPeriod', case when v_since is null then null else jsonb_build_object(
      'accounts', (select count(*) from public.profiles where created_at >= v_since),
      'composers', (select count(*) from public.composer_profiles where created_at >= v_since),
      'studios', (select count(*) from public.studio_profiles where created_at >= v_since),
      'fans', (select count(*) from public.fan_profiles where created_at >= v_since),
      'adReels', (select count(*) from public.ad_reels where created_at >= v_since),
      'packs', (select count(*) from public.packs where created_at >= v_since),
      'tracks', (select count(*) from public.tracks where created_at >= v_since),
      'sfx', (select count(*) from public.sfx_library where created_at >= v_since),
      'collections', (select count(*) from public.collections where created_at >= v_since),
      'albums', (select count(*) from public.albums where created_at >= v_since)
    ) end
  ) into v_result;

  return v_result;
end;
$$;
grant execute on function public.admin_get_stats(text) to authenticated;
