-- LayerPitch — le palier figé dans un AdReel publié est décidé par le SERVEUR (23 septembre, question de
-- Jules-Antoine : "pourquoi pas maintenant ?"). Avant : la page envoyait profile.effectivePlan dans le
-- payload de upsert_ad_reel et le serveur l'enregistrait tel quel -- un compte Free pouvait s'attribuer
-- 'pro' (apparence Pro, forme d'onde Pro, pas de filigrane) en modifiant ce qui part de son navigateur.
-- Pas une fuite de données : de la triche sur son propre affichage public.
--
-- composer_real_tier() = le palier RÉEL (bêta, admin, essai, plan) sans l'aperçu admin ;
-- composer_effective_tier() = aperçu admin s'il y en a un, sinon le palier réel (comportement inchangé).
-- upsert_ad_reel() écrase profile.effectivePlan par composer_real_tier() (ou par l'override d'un admin,
-- profile.adminTierOverride, retiré pour tout autre compte). Packs et collections ne stockent aucun
-- palier publié (leurs pages publiques retombent sur Starter quand il est absent) : rien à corriger ici.
-- Les AdReels déjà publiés gardent leur valeur jusqu'à leur prochaine publication.

create or replace function public.composer_real_tier(p_composer_id uuid)
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
grant execute on function public.composer_real_tier(uuid) to authenticated;

create or replace function public.composer_effective_tier(p_composer_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.own_preview_tier_for(p_composer_id), public.composer_real_tier(p_composer_id));
$$;

create or replace function public.upsert_ad_reel(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ad_reel_id text := payload->>'id';
  v_owner_id uuid := public.current_composer_id();
  v_idx int := 0;
  v_id text;
  v_profile jsonb := coalesce(payload->'profile', '{}'::jsonb);
  v_tier text;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_ad_reel_id is null or v_ad_reel_id = '' then raise exception 'payload.id manquant'; end if;

  -- Palier figé dans le contenu publié : décidé ICI, par le serveur, jamais lu tel quel dans le payload
  -- (avant le 23 septembre, la page l'envoyait dans profile.effectivePlan et rien ne le vérifiait : un
  -- compte Free pouvait s'attribuer "pro"). Palier RÉEL (composer_real_tier : bêta, admin, essai, plan),
  -- jamais l'aperçu admin. Seul un admin peut forcer le palier d'un AdReel (profile.adminTierOverride,
  -- vérifier son rendu public sous un autre palier) ; pour tout autre compte ce champ est retiré.
  v_tier := public.composer_real_tier(v_owner_id);
  if public.is_admin() and (v_profile->>'adminTierOverride') in ('free', 'starter', 'pro') then
    v_tier := v_profile->>'adminTierOverride';
  else
    v_profile := v_profile - 'adminTierOverride';
  end if;
  v_profile := jsonb_set(v_profile, '{effectivePlan}', to_jsonb(v_tier));

  insert into public.ad_reels (id, owner_id, folder_id, label, lang, profile, testimonials, blocks, track_overrides, allow_indexing, updated_at)
  values (
    v_ad_reel_id, v_owner_id, nullif(payload->>'folderId',''), coalesce(payload->>'label',''), coalesce(payload->>'lang','fr'),
    v_profile, coalesce(payload->'testimonials','[]'::jsonb),
    coalesce(payload->'blocks','[]'::jsonb), coalesce(payload->'trackOverrides','{}'::jsonb),
    coalesce((payload->>'allowIndexing')::boolean, true), now()
  )
  on conflict (owner_id, id) do update set
    folder_id = excluded.folder_id, label = excluded.label, lang = excluded.lang, profile = excluded.profile,
    testimonials = excluded.testimonials, blocks = excluded.blocks, track_overrides = excluded.track_overrides,
    allow_indexing = excluded.allow_indexing, updated_at = now();

  delete from public.ad_reel_tracks where owner_id = v_owner_id and ad_reel_id = v_ad_reel_id;
  for v_id in select jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb))
  loop
    insert into public.ad_reel_tracks (owner_id, ad_reel_id, track_id, position) values (v_owner_id, v_ad_reel_id, v_id, v_idx);
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_ad_reel_id);
end;
$$;
