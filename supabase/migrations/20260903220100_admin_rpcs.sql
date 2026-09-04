-- LayerPitch — RPC du panneau admin (voir 20260903220000 pour le schéma). Toutes gated par
-- is_admin() (20260901190000), sauf dismiss_notice() qui est utilisable par n'importe quel compte
-- authentifié pour son propre bandeau.
--
-- Portée v1 du panneau analytique (docs/infrastructure.md, correction du 3 septembre) : comptages
-- et moyennes agrégées sur les tables catalogue existantes uniquement. "Tendances de modes de
-- lecture" explicitement hors périmètre — aucune table d'événements, chantier futur séparé.

-- ============================================================================
create or replace function public.admin_get_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_composer_count int;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;

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
    )
  ) into v_result;

  return v_result;
end;
$$;
grant execute on function public.admin_get_stats() to authenticated;

-- ============================================================================
-- Liste des comptes pour la recherche côté suspension — email n'est autrement jamais exposé à un
-- client authenticated (auth.users n'est pas lisible directement). security definer + auth.users
-- join permis uniquement parce qu'is_admin() gate l'accès à la fonction.
create or replace function public.admin_list_accounts(p_search text default null)
returns table (
  profile_id uuid,
  email text,
  created_at timestamptz,
  is_composer boolean,
  composer_handle text,
  is_studio boolean,
  is_fan boolean,
  suspended boolean,
  banned_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;

  return query
    select p.id, u.email::text, p.created_at,
      (cp.id is not null), cp.handle,
      (sp.id is not null), (fp.id is not null),
      p.suspended, u.banned_until
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.composer_profiles cp on cp.profile_id = p.id
    left join public.studio_profiles sp on sp.profile_id = p.id
    left join public.fan_profiles fp on fp.profile_id = p.id
    where p_search is null or p_search = ''
       or u.email ilike '%' || p_search || '%'
       or cp.handle ilike '%' || p_search || '%'
    order by p.created_at desc
    limit 200;
end;
$$;
grant execute on function public.admin_list_accounts(text) to authenticated;

-- ============================================================================
create or replace function public.set_platform_notice(p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;

  update public.platform_settings
    set notice_message = nullif(p_message, ''), notice_updated_at = now()
    where id = true;
end;
$$;
grant execute on function public.set_platform_notice(text) to authenticated;

-- ============================================================================
-- Utilisable par n'importe quel compte authentifié pour son propre bandeau (pas admin-only) — même
-- principe que mark_onboarding_complete() : profiles n'a pas de GRANT UPDATE direct.
create or replace function public.dismiss_notice()
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
  update public.profiles set notice_dismissed_at = now() where id = v_uid;
end;
$$;
grant execute on function public.dismiss_notice() to authenticated;
