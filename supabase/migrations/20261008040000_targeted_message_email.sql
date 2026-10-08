-- LayerPitch — e-mail de notification pour un message admin adressé à des comptes précis (8 octobre).
--
-- Jusqu'ici seules les annonces diffusées à tout le monde (recipient_id null) envoyaient un e-mail
-- (20260921040000 à 20260921060000). Un message personnel -- notamment le message d'accueil, inséré
-- par mark_onboarding_complete() -- n'en envoyait jamais, et le panneau admin ne pouvait de toute
-- façon pas en créer. Le panneau sait maintenant viser des comptes choisis (migration
-- 20261008030000) : pour une lettre à une partie des testeurs, il faut pouvoir demander l'e-mail.
--
-- Choix : une colonne email_notify, FAUSSE par défaut. Seul admin_send_message(..., p_email_notify)
-- la met à vrai, et seulement pour un message personnel. Le message d'accueil (insertion directe,
-- sans cette colonne) reste donc sans e-mail, comme décidé le 11 septembre.
--
-- Destinataires d'un message personnel avec e-mail : le compte visé, sans les filtres de la
-- diffusion qui n'ont pas de sens pour un choix explicite (« a déjà ouvert le Backstage »,
-- « n'est pas admin » : l'admin peut s'envoyer un essai à lui-même, et un studio sans profil
-- compositeur peut être visé). Restent respectés : la désinscription (profiles.email_announcements),
-- la suspension, et l'idempotence (admin_message_emails).

alter table public.admin_messages add column email_notify boolean not null default false;
comment on column public.admin_messages.email_notify is 'true = message personnel (recipient_id renseigné) pour lequel un e-mail de notification est aussi envoyé. Toujours false pour une diffusion (l''e-mail y est systématique) et pour le message d''accueil.';

-- Nouvelle liste de paramètres : drop puis create (un create or replace créerait une seconde
-- surcharge, et l'appel du panneau deviendrait ambigu).
drop function if exists public.admin_send_message(jsonb, uuid, boolean, jsonb);
create function public.admin_send_message(
  p_messages jsonb,
  p_recipient_id uuid default null,
  p_existing_accounts_only boolean default false,
  p_titles jsonb default null,
  p_email_notify boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;
  if jsonb_typeof(p_messages) is distinct from 'object' then
    raise exception 'p_messages doit être un objet JSON (une clé par code langue)';
  end if;
  if p_titles is not null and jsonb_typeof(p_titles) is distinct from 'object' then
    raise exception 'p_titles doit être un objet JSON (une clé par code langue) ou null';
  end if;

  insert into public.admin_messages (body, title, recipient_id, existing_accounts_only, email_notify)
    values (p_messages, p_titles, p_recipient_id, coalesce(p_existing_accounts_only, false),
            p_recipient_id is not null and coalesce(p_email_notify, false))
    returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.admin_send_message(jsonb, uuid, boolean, jsonb, boolean) to authenticated;

-- Destinataires : diffusion (règles inchangées) OU message personnel avec e-mail demandé.
create or replace function public.get_announcement_recipients(p_message_id bigint)
returns table (profile_id uuid, email text, lang text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, u.email::text, p.lang
  from public.admin_messages m
  join public.profiles p on
       (m.recipient_id is null and (not m.existing_accounts_only or p.created_at <= m.created_at))
    or (m.recipient_id = p.id and m.email_notify)
  join auth.users u on u.id = p.id
  where m.id = p_message_id
    and p.email_announcements
    and not p.suspended
    and u.email is not null
    and not exists (select 1 from public.admin_message_emails e where e.message_id = m.id and e.profile_id = p.id)
    and (
      m.recipient_id is not null
      or (
        exists (select 1 from public.composer_profiles cp where cp.profile_id = p.id)
        and not exists (select 1 from public.admins a where a.profile_id = p.id)
      )
    );
$$;
revoke execute on function public.get_announcement_recipients(bigint) from public, anon, authenticated;
grant execute on function public.get_announcement_recipients(bigint) to service_role;

-- Déclencheur : diffusion, ou message personnel avec e-mail demandé.
drop trigger if exists notify_admin_message_email on public.admin_messages;
create trigger notify_admin_message_email
  after insert on public.admin_messages
  for each row
  when (new.recipient_id is null or new.email_notify)
  execute function public.notify_admin_message_email();

-- Historique du panneau : indique si l'e-mail a été demandé. Le type de retour change : drop puis create.
drop function if exists public.admin_list_messages();
create function public.admin_list_messages()
returns table (
  id bigint,
  body jsonb,
  title jsonb,
  created_at timestamptz,
  existing_accounts_only boolean,
  recipient_id uuid,
  recipient_email text,
  email_notify boolean
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
    select m.id, m.body, m.title, m.created_at, m.existing_accounts_only, m.recipient_id, u.email::text, m.email_notify
    from public.admin_messages m
    left join auth.users u on u.id = m.recipient_id
    order by m.created_at desc
    limit 100;
end;
$$;
grant execute on function public.admin_list_messages() to authenticated;
