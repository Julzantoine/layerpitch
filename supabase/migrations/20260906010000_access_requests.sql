-- LayerPitch — demandes d'accès à la bêta fermée (6 septembre).
--
-- Deux points d'entrée pour un même besoin, trouvés le même jour en creusant deux endroits
-- différents : (1) les boutons "Je veux rejoindre la bêta"/"Tenez-moi juste au courant" de la
-- landing page (jusqu'ici un endpoint Formspree placeholder, jamais réel) ; (2) bienvenue.html,
-- où quelqu'un qui n'a pas encore été invité tombe sur l'erreur brute Supabase "Signups not
-- allowed for this instance" sans aucun moyen de faire une vraie demande. Une seule table plutôt
-- que deux mécanismes séparés : dans les deux cas, le besoin réel est "quelqu'un veut un accès,
-- Jules-Antoine doit pouvoir le voir et l'inviter en un clic depuis le panneau admin existant
-- (Inviter un testeur)".
--
-- Écriture publique (anon/authenticated, un visiteur non connecté doit pouvoir s'en servir) mais
-- lecture strictement admin -- même principe que analytics_events (RLS activée sans policy,
-- accès exclusivement via des fonctions SECURITY DEFINER).

create table public.access_requests (
  id bigserial primary key,
  email text not null,
  -- 'landing' (CTA de la page publique) ou 'blocked_signin' (bienvenue.html, tentative de
  -- connexion refusée faute d'invitation) -- distingue l'origine sans complexifier le schéma.
  source text not null check (source in ('landing', 'blocked_signin')),
  -- Uniquement pertinent pour source='landing' : 'beta' (bouton "Je veux rejoindre la bêta") vs
  -- 'waitlist' (bouton "Tenez-moi juste au courant"). Null pour 'blocked_signin'.
  intent text check (intent is null or intent in ('beta', 'waitlist')),
  created_at timestamptz not null default now(),
  invited_at timestamptz
);
create index access_requests_pending_idx on public.access_requests(created_at desc) where invited_at is null;

alter table public.access_requests enable row level security;

-- Limite de fréquence par IP, même patron que bump_contact_rate_limit (20260905040000) -- réutilise
-- la même table de compteurs plutôt que d'en créer une troisième.
create or replace function public.bump_access_request_rate_limit(p_bucket_key text, p_max_per_minute int default 5)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.analytics_write_rate_limit (bucket_key, event_count)
    values (p_bucket_key, 1)
    on conflict (bucket_key) do update set event_count = analytics_write_rate_limit.event_count + 1
    returning event_count into v_count;
  return v_count <= p_max_per_minute;
end;
$$;
grant execute on function public.bump_access_request_rate_limit(text, int) to anon, authenticated;

-- Écriture publique : validation minimale, rejet silencieux (return sans insérer) plutôt qu'une
-- erreur, même principe que log_analytics_event -- un formulaire d'accès ne doit jamais planter
-- sur une entrée mal formée. L'IP est lue depuis l'en-tête posé par PostgREST, jamais transmise
-- par le client (même garde-fou que log_analytics_event/submit-contact-message).
create or replace function public.submit_access_request(p_email text, p_source text, p_intent text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := trim(p_email);
  v_ip text;
  v_bucket text;
begin
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return; end if;
  if p_source not in ('landing', 'blocked_signin') then return; end if;
  if p_intent is not null and p_intent not in ('beta', 'waitlist') then return; end if;

  v_ip := coalesce(
    nullif(split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1), ''),
    v_email
  );
  v_bucket := 'access_request:' || v_ip || ':' || floor(extract(epoch from now()) / 60)::text;
  if not public.bump_access_request_rate_limit(v_bucket) then return; end if;

  insert into public.access_requests (email, source, intent) values (v_email, p_source, p_intent);
end;
$$;
grant execute on function public.submit_access_request(text, text, text) to anon, authenticated;

-- Lecture admin : demandes en attente (jamais invitées), les plus récentes d'abord.
create or replace function public.get_pending_access_requests()
returns setof public.access_requests
language sql
stable
security definer
set search_path = public
as $$
  select * from public.access_requests
  where invited_at is null and public.is_admin()
  order by created_at desc;
$$;
grant execute on function public.get_pending_access_requests() to authenticated;

-- Marque une demande comme traitée -- appelée juste après un appel réussi à invite-tester() pour
-- cette adresse, pas automatiquement (une demande reste "en attente" tant que l'invitation réelle
-- n'a pas été envoyée, pour ne jamais perdre une demande si l'envoi échoue).
create or replace function public.mark_access_request_invited(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then return; end if;
  update public.access_requests set invited_at = now() where id = p_id;
end;
$$;
grant execute on function public.mark_access_request_invited(bigint) to authenticated;
