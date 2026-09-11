-- LayerPitch — corrections de l'audit sécurité du 11 septembre.
--
-- 1) log_analytics_event() lisait le PREMIER segment de l'en-tête x-forwarded-for comme IP client
-- pour sa limite de fréquence (60/minute). Le premier segment est exactement celui qu'un appelant
-- direct (hors navigateur, ex. un script qui appelle la RPC PostgREST à la main) peut fixer
-- lui-même sur sa propre requête -- un attaquant changeant cette valeur à chaque appel obtient un
-- nouveau compteur à chaque fois et contourne la limite. Le DERNIER segment, lui, est celui posé
-- par le proxy de confiance le plus proche de Postgres (PostgREST/Supabase) -- non falsifiable par
-- le client tant qu'au moins ce dernier saut existe. Corrigé pour lire le dernier segment plutôt
-- que le premier.
--
-- 2) submit_access_request(text, text, text) : la RPC d'origine (20260906010000_access_requests.sql),
-- gardée en base pour compatibilité mais dont le commentaire indique déjà que le front n'appelle
-- plus qu'une Edge Function équivalente (submit-access-request, qui envoie aussi l'email de
-- confirmation). Elle restait pourtant grantée à anon/authenticated -- une seconde porte
-- d'entrée inutile sur la même table. Retirée ici plutôt que la fonction elle-même : DROP casserait
-- la ligne si jamais quelque chose l'appelait encore sans qu'on l'ait vu ; REVOKE ferme l'accès
-- sans perdre la possibilité de la reprendre si besoin.

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
  v_xff text;
  v_parts text[];
begin
  if p_entity_type is null or p_entity_type not in ('adreel', 'pack') then return; end if;
  if p_entity_id is null or length(p_entity_id) = 0 or length(p_entity_id) > 200 then return; end if;
  if p_session_id is null or length(p_session_id) = 0 or length(p_session_id) > 200 then return; end if;
  if p_event_name is null or length(p_event_name) = 0 or length(p_event_name) > 100 then return; end if;
  if p_device is not null and p_device not in ('mobile', 'desktop') then p_device := null; end if;

  if p_entity_type = 'adreel' then
    select owner_id into v_owner_id from public.ad_reels
      where id = p_entity_id and (p_owner_id is null or owner_id = p_owner_id) limit 1;
  else
    select owner_id into v_owner_id from public.packs
      where id = p_entity_id and (p_owner_id is null or owner_id = p_owner_id) limit 1;
  end if;
  if v_owner_id is null then return; end if;

  -- Dernier segment de x-forwarded-for (posé par le proxy de confiance), pas le premier
  -- (falsifiable par l'appelant) -- voir commentaire d'en-tête de cette migration.
  v_xff := current_setting('request.headers', true)::json->>'x-forwarded-for';
  if v_xff is not null then
    v_parts := string_to_array(v_xff, ',');
    v_ip := nullif(trim(v_parts[array_length(v_parts, 1)]), '');
  end if;
  v_ip := coalesce(v_ip, p_session_id);
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
grant execute on function public.log_analytics_event(text, text, text, text, jsonb, text, uuid) to anon, authenticated;

revoke execute on function public.submit_access_request(text, text, text) from anon, authenticated;
