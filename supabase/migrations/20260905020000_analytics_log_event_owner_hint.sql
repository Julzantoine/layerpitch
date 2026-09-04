-- LayerPitch — corrige log_analytics_event() : résolution du propriétaire ambiguë sur AdReel.
--
-- Trouvé en testant (scripts/test-analytics-rpcs.js, deux compositeurs de test avec un AdReel
-- 'main' chacun -- reproduit volontairement le cas historique de 20260903120000_ad_reels_owner_scoped_id.sql) :
-- ad_reels.id n'est unique que PAR compositeur (clé primaire composite (owner_id, id)), contrairement
-- à packs.id (clé primaire simple, toujours unique). `select owner_id from ad_reels where id =
-- p_entity_id` sans filtrer par propriétaire attrapait arbitrairement L'UN des deux compositeurs
-- partageant le même id 'main' -- exactement le bug qu'on avait déjà corrigé côté tracking Umami,
-- réapparu ici sous une autre forme.
--
-- Corrigé en ajoutant un paramètre p_owner_id : un INDICE à vérifier, jamais une valeur prise pour
-- argent comptant -- la ligne n'est retenue que si elle correspond RÉELLEMENT à cet id ET à cet
-- entity_id ensemble (jointure sur les deux, pas une confiance aveugle sur p_owner_id seul). La
-- page publique connaît déjà cette valeur (window.__lpTrackContext.ownerId, propagé depuis le
-- chantier Umami précédent -- resolveHandle() -> composer_profiles.id, jamais une saisie libre).
-- p_owner_id reste optionnel (défaut NULL) : sur le chemin historique sans handle (data.json
-- statique, un seul propriétaire possible par construction), le repli par entity_id seul suffit,
-- pas d'ambiguïté réelle dans ce cas précis.

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

  insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, detail, device)
    values (v_owner_id, p_entity_type, p_entity_id, p_session_id, p_event_name, coalesce(p_detail, '{}'::jsonb), p_device);
end;
$$;

-- L'ancienne signature (6 paramètres, sans p_owner_id) doit être retirée explicitement : Postgres
-- traite une fonction avec un paramètre supplémentaire comme une SURCHARGE distincte, pas un
-- remplacement -- sans ce DROP, les deux coexisteraient et un appel ambigu échouerait.
drop function if exists public.log_analytics_event(text, text, text, text, jsonb, text);

grant execute on function public.log_analytics_event(text, text, text, text, jsonb, text, uuid) to anon, authenticated;
