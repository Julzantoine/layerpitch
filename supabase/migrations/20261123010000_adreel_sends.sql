-- LayerPitch — Suivi des envois (23 novembre, cadrage layerpitch-docs/2026-11-23-suivi-des-envois-cadrage.md).
-- Le compositeur déclare un envoi (« Envoyer à… » sur un AdReel : studio, personne, note) ; LayerPitch lui donne un lien rien
-- qu'à ce destinataire : l'adresse habituelle de l'AdReel + un code dans le fragment (#r=<code>), qui ne quitte jamais le
-- navigateur (ni les serveurs, ni l'aperçu WhatsApp/LinkedIn ne le voient). Quand la page s'ouvre avec ce code, la visite est
-- rattachée à l'envoi (register_send_visit) ; ses écoutes se retrouvent dans analytics_events par le même session_id.
-- LayerPitch ne lit jamais la boîte mail du compositeur : créer le lien = enregistrer l'envoi.
--
-- Statuts : sent (Envoyé) | replied (Répondu) | signed (Signé) | dropped (Sans suite). « Écouté » n'est pas stocké : il se
-- déduit des visites (au moins une). followed_up_at = « j'ai relancé » (repart à zéro le délai de la liste « à relancer »).
-- L'historique survit à la suppression de l'AdReel (pas de clé étrangère vers ad_reels ; ad_reel_label garde le nom).
-- Paliers : le carnet et « écouté / dernière visite » pour tous ; le nombre de visites, d'écoutes et les morceaux joués suivent
-- les stats (Free : masqués). Réservé à l'admin jusqu'au feu vert 'sends_tracking'.

create table public.adreel_sends (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.composer_profiles(id) on delete cascade,
  ad_reel_id text not null,
  ad_reel_label text not null default '',
  code text not null unique check (code ~ '^[a-z0-9]{8,32}$'),
  studio text not null check (length(btrim(studio)) between 1 and 120),
  person text not null default '' check (length(person) <= 120),
  note text not null default '' check (length(note) <= 4000),
  status text not null default 'sent' check (status in ('sent', 'replied', 'signed', 'dropped')),
  status_changed_at timestamptz,
  followed_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index adreel_sends_owner_idx on public.adreel_sends (owner_id, created_at desc);
alter table public.adreel_sends enable row level security;  -- aucune politique : seules les fonctions ci-dessous y touchent
revoke all on public.adreel_sends from anon, authenticated;

create table public.adreel_send_visits (
  send_id uuid not null references public.adreel_sends(id) on delete cascade,
  session_id text not null check (length(session_id) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (send_id, session_id)
);
create index adreel_send_visits_session_idx on public.adreel_send_visits (session_id);
alter table public.adreel_send_visits enable row level security;
revoke all on public.adreel_send_visits from anon, authenticated;

insert into public.feature_flags (key, description) values
  ('sends_tracking', 'Suivi des envois (23/11) : « Envoyer à… » sur un AdReel, lien par destinataire, onglet Envois, liste à relancer — create/update/delete_adreel_send, list_my_adreel_sends.')
on conflict (key) do nothing;

-- Compositeur connecté + feu vert (ou admin). Renvoie son composer_profiles.id.
create or replace function public.assert_sends_access()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_owner uuid := public.current_composer_id();
begin
  if v_owner is null then raise exception 'Connexion requise'; end if;
  if not public.feature_released('sends_tracking', auth.uid()) then
    raise exception 'Le suivi des envois n''est pas encore ouvert' using hint = 'locked';
  end if;
  return v_owner;
end;
$$;
revoke execute on function public.assert_sends_access() from public, anon, authenticated;

create or replace function public.create_adreel_send(p_ad_reel_id text, p_studio text, p_person text default '', p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.assert_sends_access();
  v_label text;
  v_code text;
  v_id uuid;
begin
  select coalesce(nullif(btrim(label), ''), id) into v_label from public.ad_reels where owner_id = v_owner and id = p_ad_reel_id;
  if not found then raise exception 'AdReel introuvable'; end if;
  if p_studio is null or length(btrim(p_studio)) not between 1 and 120 then raise exception 'Nom du studio : 1 à 120 caractères'; end if;
  if (select count(*) from public.adreel_sends where owner_id = v_owner) >= 5000 then raise exception 'Trop d''envois enregistrés'; end if;
  loop
    -- 12 caractères hexadécimaux tirés de la partie aléatoire d'un UUID v4 : 48 bits, impossible à deviner.
    v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    exit when not exists (select 1 from public.adreel_sends where code = v_code);
  end loop;
  insert into public.adreel_sends (owner_id, ad_reel_id, ad_reel_label, code, studio, person, note)
    values (v_owner, p_ad_reel_id, v_label, v_code, btrim(p_studio), btrim(coalesce(p_person, '')), coalesce(p_note, ''))
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'code', v_code);
end;
$$;
grant execute on function public.create_adreel_send(text, text, text, text) to authenticated;

-- p : champs présents seulement -- studio, person, note, status, followedUp (true = « j'ai relancé » maintenant, false = effacer).
create or replace function public.update_adreel_send(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.assert_sends_access();
  r public.adreel_sends;
begin
  select * into r from public.adreel_sends where id = p_id and owner_id = v_owner;
  if not found then raise exception 'Envoi introuvable'; end if;
  if p ? 'studio' then
    if length(btrim(coalesce(p->>'studio', ''))) not between 1 and 120 then raise exception 'Nom du studio : 1 à 120 caractères'; end if;
    r.studio := btrim(p->>'studio');
  end if;
  if p ? 'person' then r.person := btrim(coalesce(p->>'person', '')); end if;
  if p ? 'note' then r.note := coalesce(p->>'note', ''); end if;
  if p ? 'status' and p->>'status' is distinct from r.status then
    if p->>'status' not in ('sent', 'replied', 'signed', 'dropped') then raise exception 'Statut inconnu'; end if;
    r.status := p->>'status';
    r.status_changed_at := now();
  end if;
  if p ? 'followedUp' then r.followed_up_at := case when (p->>'followedUp')::boolean then now() else null end; end if;
  update public.adreel_sends set studio = r.studio, person = r.person, note = r.note, status = r.status,
    status_changed_at = r.status_changed_at, followed_up_at = r.followed_up_at, updated_at = now()
    where id = p_id;
end;
$$;
grant execute on function public.update_adreel_send(uuid, jsonb) to authenticated;

create or replace function public.delete_adreel_send(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_owner uuid := public.assert_sends_access();
begin
  delete from public.adreel_sends where id = p_id and owner_id = v_owner;
  if not found then raise exception 'Envoi introuvable'; end if;
end;
$$;
grant execute on function public.delete_adreel_send(uuid) to authenticated;

-- Tous les envois du compositeur, du plus récent au plus ancien, avec ce qu'on sait des visites.
-- detailed = false (palier Free) : visits/plays/trackIds absents ; listened et lastVisitAt restent (le statut « Écouté » en dépend).
create or replace function public.list_my_adreel_sends()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.assert_sends_access();
  v_tier text := coalesce(public.composer_effective_tier(v_owner), 'free');
  v_detailed boolean := v_tier in ('starter', 'pro');
  v_rows jsonb;
begin
  with v as (
    select s.id as send_id, count(v.session_id)::int as visits, min(v.created_at) as first_at, max(v.created_at) as last_at
    from public.adreel_sends s left join public.adreel_send_visits v on v.send_id = s.id
    where s.owner_id = v_owner group by s.id
  ),
  plays as (
    select v.send_id, count(*)::int as plays,
      coalesce(jsonb_agg(distinct e.detail->>'trackId') filter (where e.detail->>'trackId' is not null), '[]'::jsonb) as track_ids
    from public.adreel_send_visits v
    join public.adreel_sends s on s.id = v.send_id and s.owner_id = v_owner
    join public.analytics_events e on e.session_id = v.session_id and e.owner_id = v_owner and e.event_name = 'track_play'
    group by v.send_id
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', s.id, 'adReelId', s.ad_reel_id, 'adReelLabel', s.ad_reel_label,
      'adReelExists', exists (select 1 from public.ad_reels ar where ar.owner_id = v_owner and ar.id = s.ad_reel_id),
      'code', s.code, 'studio', s.studio, 'person', s.person, 'note', s.note, 'status', s.status,
      'statusChangedAt', s.status_changed_at, 'followedUpAt', s.followed_up_at, 'createdAt', s.created_at,
      'listened', coalesce(v.visits, 0) > 0, 'firstVisitAt', v.first_at, 'lastVisitAt', v.last_at,
      'visits', case when v_detailed then coalesce(v.visits, 0) end,
      'plays', case when v_detailed then coalesce(p.plays, 0) end,
      'trackIds', case when v_detailed then coalesce(p.track_ids, '[]'::jsonb) end
    )) order by s.created_at desc), '[]'::jsonb)
  into v_rows
  from public.adreel_sends s
  left join v on v.send_id = s.id
  left join plays p on p.send_id = s.id
  where s.owner_id = v_owner;
  return jsonb_build_object('ok', true, 'tier', v_tier, 'detailed', v_detailed, 'sends', v_rows);
end;
$$;
grant execute on function public.list_my_adreel_sends() to authenticated;

-- Page publique d'un AdReel ouverte avec #r=<code> : rattache cette visite (session_id de la page) à l'envoi.
-- Jamais d'erreur renvoyée au visiteur (fonction muette) ; code inconnu, AdReel différent ou visite du compositeur lui-même : rien.
create or replace function public.register_send_visit(p_code text, p_session_id text, p_ad_reel_id text, p_owner_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.adreel_sends;
begin
  if p_code is null or p_code !~ '^[a-z0-9]{8,32}$' then return; end if;
  if p_session_id is null or length(p_session_id) not between 1 and 200 then return; end if;
  select * into r from public.adreel_sends where code = p_code;
  if not found then return; end if;
  if r.ad_reel_id is distinct from p_ad_reel_id or (p_owner_id is not null and r.owner_id <> p_owner_id) then return; end if;
  -- Les visites du compositeur lui-même ne comptent pas (même règle que log_analytics_event).
  if auth.uid() is not null and exists (select 1 from public.composer_profiles cp where cp.id = r.owner_id and cp.profile_id = auth.uid()) then return; end if;
  -- Frein : au plus 30 nouvelles visites par minute sur un même envoi (un lien qui fuit ne gonfle pas la base).
  if (select count(*) from public.adreel_send_visits where send_id = r.id and created_at > now() - interval '1 minute') >= 30 then return; end if;
  insert into public.adreel_send_visits (send_id, session_id) values (r.id, p_session_id) on conflict do nothing;
end;
$$;
grant execute on function public.register_send_visit(text, text, text, uuid) to anon, authenticated;
