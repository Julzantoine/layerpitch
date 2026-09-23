-- LayerPitch — exclut les visites du compositeur lui-même de l'analytique (23 septembre, demande de
-- Jules-Antoine : "tes propres visites -> non"). Même fonction que 20260923030000 (collecte par
-- palier), une garde de plus après la résolution du propriétaire.

create or replace function public.log_analytics_event(
  p_entity_type text,
  p_entity_id text,
  p_session_id text,
  p_event_name text,
  p_detail jsonb default '{}'::jsonb,
  p_device text default null,
  p_owner_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_tier text;
  v_ip text;
  v_bucket text;
  v_count int;
begin
  if p_entity_type is null or p_entity_type not in ('adreel', 'pack') then return; end if;
  if p_entity_id is null or length(p_entity_id) = 0 or length(p_entity_id) > 200 then return; end if;
  if p_session_id is null or length(p_session_id) = 0 or length(p_session_id) > 200 then return; end if;
  if p_event_name is null or length(p_event_name) = 0 or length(p_event_name) > 100 then return; end if;
  if p_device is not null and p_device not in ('mobile', 'desktop') then p_device := null; end if;

  -- p_owner_id : indice de désambiguïsation, jamais pris seul -- la ligne doit exister réellement
  -- avec CETTE combinaison (id, owner_id) quand l'indice est fourni. `limit 1` sur le repli sans
  -- indice (p_owner_id null) : choix arbitraire assumé, seul cas où plusieurs lignes peuvent
  -- effectivement matcher (chemin historique sans handle, un seul propriétaire réel en pratique).
  if p_entity_type = 'adreel' then
    select owner_id into v_owner_id from public.ad_reels
      where id = p_entity_id and (p_owner_id is null or owner_id = p_owner_id) limit 1;
  else
    select owner_id into v_owner_id from public.packs
      where id = p_entity_id and (p_owner_id is null or owner_id = p_owner_id) limit 1;
  end if;
  if v_owner_id is null then return; end if;

  -- Les visites du compositeur lui-même ne comptent pas (23 septembre, demande de Jules-Antoine) :
  -- quand il ouvre son propre AdReel/pack connecté dans ce navigateur, la session Supabase du
  -- backstage est partagée avec les pages publiques (même origine) et l'appel arrive ici avec son
  -- identité. Exclusion côté serveur (pas côté page) : impossible à contourner par une page en cache.
  -- Limite assumée : depuis un navigateur où il n'est pas connecté, sa visite est indiscernable de
  -- celle d'un visiteur.
  if auth.uid() is not null and exists (
    select 1 from public.composer_profiles cp where cp.id = v_owner_id and cp.profile_id = auth.uid()
  ) then return; end if;

  -- Pas de collecte pour un compte Free (décision du 23 septembre) : seuls Starter et Pro ont un
  -- tableau de bord. Le palier est enregistré avec l'événement (colonne tier) pour que le nettoyage
  -- applique à CHAQUE événement la rétention du palier sous lequel il a été collecté.
  v_tier := public.composer_effective_tier(v_owner_id);
  if v_tier is null or v_tier not in ('starter', 'pro') then return; end if;

  v_ip := coalesce(
    nullif(split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1), ''),
    p_session_id
  );
  v_bucket := v_ip || ':' || floor(extract(epoch from now()) / 60)::text;
  insert into public.analytics_write_rate_limit (bucket_key, event_count)
    values (v_bucket, 1)
    on conflict (bucket_key) do update set event_count = analytics_write_rate_limit.event_count + 1
    returning event_count into v_count;
  if v_count > 60 then return; end if;

  insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, detail, device, tier)
    values (v_owner_id, p_entity_type, p_entity_id, p_session_id, p_event_name, coalesce(p_detail, '{}'::jsonb), p_device, v_tier);
end;
$$;
