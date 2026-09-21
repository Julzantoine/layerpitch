-- LayerPitch — retire le paramètre inutilisé p_include_admins de get_announcement_recipients
-- (21 septembre). Prévu pour tester l'envoi en incluant les comptes admin, puis remplacé par le
-- mode essai de l'Edge Function (test_email) : plus aucun appelant. Les comptes admin restent
-- exclus des destinataires. Drop puis create dans la même migration : changer la liste de
-- paramètres avec create or replace créerait une seconde surcharge, et l'appel de l'Edge Function
-- (qui ne passe que p_message_id) deviendrait ambigu.

drop function if exists public.get_announcement_recipients(bigint, boolean);
create function public.get_announcement_recipients(p_message_id bigint)
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
    and not exists (select 1 from public.admins a where a.profile_id = p.id);
$$;
revoke execute on function public.get_announcement_recipients(bigint) from public, anon, authenticated;
grant execute on function public.get_announcement_recipients(bigint) to service_role;
