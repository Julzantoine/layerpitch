-- LayerPitch — email envoyé aux testeurs quand une annonce admin arrive dans leur cloche (21
-- septembre, demande de Jules-Antoine).
--
-- Périmètre : uniquement les annonces admin_messages diffusées (recipient_id null) -- les messages
-- des visiteurs du bloc "Contact" envoient déjà un email (submit-contact-message), et le message de
-- bienvenue (recipient_id renseigné, inséré par mark_onboarding_complete) ne doit pas en envoyer.
-- L'envoi lui-même est fait par l'Edge Function notify-admin-message, appelée par un Database
-- Webhook (dashboard Supabase) à chaque INSERT dans admin_messages.
--
-- Trois choix confirmés par Jules-Antoine : déclenchement automatique côté base, langue de l'email
-- = langue du backstage du compte (stockée côté serveur, jusqu'ici uniquement en localStorage),
-- désinscription possible depuis "Mon compte".

alter table public.profiles add column lang text check (lang in ('fr', 'en'));
comment on column public.profiles.lang is 'Langue du backstage du compte (fr/en), synchronisée par le backstage à chaque ouverture (set_my_lang). NULL tant qu''il n''a jamais été ouvert -- l''email d''annonce est alors bilingue.';

alter table public.profiles add column email_announcements boolean not null default true;
comment on column public.profiles.email_announcements is 'false = ne reçoit plus d''email quand une annonce admin arrive dans sa cloche (réglage dans Mon compte).';

-- Une ligne par (annonce, compte) déjà notifié par email : rend l'envoi idempotent (un rejeu du
-- webhook, ou un second appel manuel, ne renvoie jamais deux fois au même compte).
create table public.admin_message_emails (
  message_id bigint not null references public.admin_messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (message_id, profile_id)
);
alter table public.admin_message_emails enable row level security;
-- Aucune policy : lue/écrite uniquement par l'Edge Function (service_role, hors RLS).

-- Écriture des préférences par le compte lui-même, via des RPC plutôt qu'un UPDATE direct sur
-- profiles (la policy "own profile update" ne restreint pas les colonnes).
create or replace function public.set_my_lang(p_lang text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_lang not in ('fr', 'en') then return; end if;
  update public.profiles set lang = p_lang where id = auth.uid() and lang is distinct from p_lang;
end;
$$;
grant execute on function public.set_my_lang(text) to authenticated;

create or replace function public.get_my_notification_prefs()
returns table (email_announcements boolean, lang text)
language sql
stable
security definer
set search_path = public
as $$
  select p.email_announcements, p.lang from public.profiles p where p.id = auth.uid();
$$;
grant execute on function public.get_my_notification_prefs() to authenticated;

create or replace function public.set_my_email_announcements(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  update public.profiles set email_announcements = coalesce(p_enabled, true) where id = auth.uid();
end;
$$;
grant execute on function public.set_my_email_announcements(boolean) to authenticated;

-- Destinataires d'une annonce : mêmes règles de visibilité que la policy RLS de admin_messages
-- (broadcast, existing_accounts_only -- 20260920010000), plus : compte qui s'est déjà connecté au
-- moins une fois (composer_profiles existe), non suspendu, n'ayant pas désactivé les emails, pas
-- déjà notifié pour cette annonce, et hors comptes admin (sauf p_include_admins, pour les essais).
-- L'adresse vient de auth.users, illisible via PostgREST -- d'où cette fonction SECURITY DEFINER,
-- réservée à service_role (l'Edge Function), jamais appelable depuis un navigateur.
create or replace function public.get_announcement_recipients(p_message_id bigint, p_include_admins boolean default false)
returns table (profile_id uuid, email text, lang text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, u.email::text, p.lang
  from public.admin_messages m
  join public.profiles p on (not m.existing_accounts_only or p.created_at <= m.created_at)
  join auth.users u on u.id = p.id
  where m.id = p_message_id
    and m.recipient_id is null
    and p.email_announcements
    and not p.suspended
    and u.email is not null
    and exists (select 1 from public.composer_profiles cp where cp.profile_id = p.id)
    and not exists (select 1 from public.admin_message_emails e where e.message_id = m.id and e.profile_id = p.id)
    and (p_include_admins or not exists (select 1 from public.admins a where a.profile_id = p.id));
$$;
revoke execute on function public.get_announcement_recipients(bigint, boolean) from public, anon, authenticated;
grant execute on function public.get_announcement_recipients(bigint, boolean) to service_role;
