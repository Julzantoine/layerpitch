-- LayerPitch — rétention analytique par palier de COLLECTE (23 septembre, précision de Jules-Antoine
-- après 20260923020000).
--
-- Règle voulue : on ne garde des informations que pour les paliers concernés. En Free, rien n'est
-- collecté. Mais ce qui a été collecté pendant une période payante reste disponible : Pro de janvier
-- à juin, Free de juillet à octobre, Pro de novembre à décembre -> au retour en Pro, les données de
-- janvier à juin sont de nouveau visibles (rien n'a été collecté de juillet à octobre).
--
-- Ce que ça remplace dans 20260923020000 : là, le nettoyage supprimait au-delà de 1 an pour tout le
-- monde et les événements des comptes Free étaient conservés. Désormais :
--  1. log_analytics_event() ignore les événements d'un compte dont le palier effectif n'est ni
--     starter ni pro (la bêta compte comme Pro : beta_full_access dans composer_effective_tier).
--  2. Chaque événement porte le palier sous lequel il a été collecté (analytics_events.tier).
--  3. Le nettoyage applique à chaque événement la rétention de SON palier de collecte (Starter 30
--     jours, Pro 1 an), jamais celle du palier actuel du compte : un passage en Free ou en Starter
--     n'efface donc rien de ce qui a été collecté en Pro.
-- La visibilité (get_my_analytics) reste inchangée : fenêtre du palier actuel, Free verrouillé.
-- Lignes sans palier (avant cette migration, aucune en pratique : la table était vide) : traitées
-- comme Pro.

alter table public.analytics_events add column tier text check (tier is null or tier in ('starter', 'pro'));
comment on column public.analytics_events.tier is 'Palier effectif du compositeur au moment de la collecte (starter/pro) -- détermine la rétention de CET événement au nettoyage. NULL = antérieur à cette colonne, traité comme pro.';

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


create or replace function public.purge_old_analytics_events()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.analytics_events
  where created_at < now() - (public.analytics_retention_days(coalesce(tier, 'pro')) || ' days')::interval;

  delete from public.analytics_write_rate_limit where window_start < now() - interval '1 hour';
end;
$$;
