-- LayerPitch — enregistre la langue choisie à l'envoi de chaque invitation (17 septembre), suite
-- à la découverte qu'aucune trace n'existait pour les invitations déjà envoyées (ni dans invites,
-- ni dans le journal d'audit Supabase auth.audit_log_entries -- vide sur ce projet, vérifié). Le
-- sélecteur "Langue" du formulaire ne changeait jusqu'ici QUE la redirection post-inscription
-- (bienvenue.html?lang=), jamais le contenu de l'email lui-même (toujours en français) -- corrigé
-- en même temps : l'email d'invitation est désormais traduit selon ce choix (même patron que
-- CONFIRMATION_COPY dans submit-access-request/index.ts).
--
-- record_invite/get_invites recréées (pas juste create or replace) : changer la liste de
-- paramètres/le type de retour créerait une surcharge au lieu de remplacer l'existante -- même
-- piège que 20260911163000_admin_send_message_drop_old_overload.sql.

alter table public.invites add column lang text not null default 'fr' check (lang in ('fr', 'en'));

drop function if exists public.record_invite(text, uuid, bigint, text);
create function public.record_invite(
  p_email text,
  p_user_id uuid,
  p_access_request_id bigint default null,
  p_personal_message text default null,
  p_lang text default 'fr'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then return; end if;
  insert into public.invites (email, user_id, invited_by, access_request_id, personal_message, lang)
  values (trim(p_email), p_user_id, auth.uid(), p_access_request_id,
    nullif(trim(coalesce(p_personal_message, '')), ''),
    case when p_lang = 'en' then 'en' else 'fr' end);
end;
$$;
grant execute on function public.record_invite(text, uuid, bigint, text, text) to authenticated;

drop function if exists public.get_invites();
create function public.get_invites()
returns table (
  id bigint,
  email text,
  created_at timestamptz,
  personal_message text,
  lang text,
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.email, i.created_at, i.personal_message, i.lang, cp.created_at as accepted_at
  from public.invites i
  left join public.composer_profiles cp on cp.profile_id = i.user_id
  where public.is_admin()
  order by i.created_at desc;
$$;
grant execute on function public.get_invites() to authenticated;
