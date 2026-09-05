-- LayerPitch — messages du bloc "Contact" public, relayés par LayerPitch (5 septembre).
--
-- Remplace l'ancien mécanisme (le navigateur du visiteur postait directement vers un compte
-- Formspree tiers que le compositeur devait créer lui-même) : trop de friction à l'inscription
-- (compte externe à créer avant de pouvoir publier le bloc), et LayerPitch ne voyait jamais passer
-- le message, donc aucun moyen de prévenir le compositeur autrement que par cet email tiers.
--
-- Nouveau flux : le visiteur poste vers l'Edge Function submit-contact-message (service_role, seule
-- à toucher cette table), qui (a) retrouve elle-même le propriétaire réel et son email de contact à
-- partir de l'AdReel visé — jamais une valeur envoyée par le client, même principe que
-- log_analytics_event() (20260905010000) — (b) envoie l'email via Resend, (c) journalise ici pour
-- que le backstage puisse afficher un badge "message non lu" dans la cloche de notification.
--
-- Volontairement une table à part de analytics_events plutôt qu'un event_name de plus dessus :
-- analytics_events est purgé selon le palier payant du compositeur (0 jour de rétention en Free,
-- voir analytics_retention_days()) — un ping de "tu as reçu un message" ne doit PAS dépendre d'un
-- abonnement payant ni disparaître avant que le compositeur ait pu le voir.

create table public.contact_messages (
  id bigserial primary key,
  owner_id uuid not null references public.composer_profiles(id) on delete cascade,
  ad_reel_id text not null,
  -- Copie du label au moment du message (pas un live join vers ad_reels) : reste lisible même si
  -- l'AdReel est renommé ou supprimé depuis, la cloche du backstage n'a jamais besoin de retrouver
  -- l'entité elle-même, juste d'afficher "via quoi" ce message est arrivé.
  ad_reel_label text not null,
  sender_name text not null,
  sender_email text not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index contact_messages_owner_seen_idx on public.contact_messages(owner_id, seen_at, created_at desc);

-- RLS activée avec une seule policy de lecture (le compositeur voit ses propres messages, même
-- patron que "own issued invoices", 20260904130000) — aucune policy d'écriture : l'insertion se
-- fait exclusivement depuis l'Edge Function via la clé service_role, qui contourne RLS.
alter table public.contact_messages enable row level security;

create policy "own contact messages" on public.contact_messages
  for select using (
    owner_id in (select id from public.composer_profiles where profile_id = auth.uid())
  );

-- Marque tous les messages non vus comme vus (RPC plutôt qu'un UPDATE direct : aucun GRANT UPDATE
-- de base sur cette table, même convention que dismiss_notice()/mark_onboarding_complete()).
create or replace function public.mark_contact_messages_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_composer_id uuid;
begin
  select id into v_composer_id from public.composer_profiles where profile_id = auth.uid();
  if v_composer_id is null then return; end if;
  update public.contact_messages set seen_at = now() where owner_id = v_composer_id and seen_at is null;
end;
$$;
grant execute on function public.mark_contact_messages_seen() to authenticated;

-- Limite de fréquence pour submit-contact-message (Edge Function, clé service_role) — même table et
-- même fenêtre glissante d'une minute que log_analytics_event() (20260905010000), réutilisée plutôt
-- que dupliquée, mais seuil bien plus bas : 5/minute par clé, un vrai visiteur n'envoie jamais 5
-- messages de contact en une minute, contrairement aux ajustements d'intensité en cours de lecture
-- pour lesquels le seuil de 60 avait été calibré.
create or replace function public.bump_contact_rate_limit(p_bucket_key text, p_max_per_minute int default 5)
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
grant execute on function public.bump_contact_rate_limit(text, int) to service_role;
