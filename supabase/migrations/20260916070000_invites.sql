-- LayerPitch — historique des invitations bêta envoyées (16 septembre).
--
-- Jusqu'ici, rien n'enregistrait qu'une invitation avait été envoyée : la seule trace était
-- access_requests.invited_at, et seulement quand l'invitation partait d'une demande spontanée —
-- une invitation directe (bouton "Inviter un testeur" sans demande préalable) ne laissait aucune
-- trace. Jules-Antoine veut pouvoir suivre qui il a invité et si la personne a rejoint la bêta.
--
-- "A rejoint" n'est pas stocké ici : dérivé à la lecture depuis composer_profiles (créé
-- automatiquement à la première connexion réelle du testeur, ensure_composer_profile(),
-- 20260901160000_ensure_composer_profile_rpc.sql) — plus fiable qu'un accepted_at mis à jour par
-- trigger, et évite un état à garder synchronisé.
--
-- Lecture/écriture strictement admin, même patron que access_requests/admins (20260906010000,
-- 20260901190000) : RLS activée sans policy, accès exclusivement via des fonctions SECURITY
-- DEFINER.

create table public.invites (
  id bigserial primary key,
  email text not null,
  -- Compte créé par invite-tester pour cet email (data.user.id de generateLink) -- permet de
  -- retrouver composer_profiles sans dépendre d'une correspondance par email (un compte peut
  -- changer d'email plus tard).
  user_id uuid references public.profiles(id) on delete set null,
  invited_by uuid not null references public.profiles(id),
  -- Renseigné quand cette invitation part de la liste "Demandes d'accès en attente" plutôt que
  -- d'une saisie directe -- purement informatif, jamais utilisé pour une jointure obligatoire.
  access_request_id bigint references public.access_requests(id) on delete set null,
  personal_message text,
  created_at timestamptz not null default now()
);
create index invites_created_idx on public.invites(created_at desc);

alter table public.invites enable row level security;

-- Enregistrement : appelée par l'Edge Function invite-tester juste après l'envoi réussi de
-- l'email (jamais avant -- même principe que mark_access_request_invited, ne pas tracer une
-- invitation qui n'est finalement pas partie). Appelée avec le JWT de l'admin (callerClient), pas
-- service_role -- auth.uid() est donc bien l'admin qui a cliqué "Envoyer l'invitation".
create or replace function public.record_invite(
  p_email text,
  p_user_id uuid,
  p_access_request_id bigint default null,
  p_personal_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then return; end if;
  insert into public.invites (email, user_id, invited_by, access_request_id, personal_message)
  values (trim(p_email), p_user_id, auth.uid(), p_access_request_id,
    nullif(trim(coalesce(p_personal_message, '')), ''));
end;
$$;
grant execute on function public.record_invite(text, uuid, bigint, text) to authenticated;

-- Lecture admin : toutes les invitations, plus récentes d'abord, avec le statut dérivé de
-- composer_profiles (voir commentaire de table ci-dessus).
create or replace function public.get_invites()
returns table (
  id bigint,
  email text,
  created_at timestamptz,
  personal_message text,
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.email, i.created_at, i.personal_message, cp.created_at as accepted_at
  from public.invites i
  left join public.composer_profiles cp on cp.profile_id = i.user_id
  where public.is_admin()
  order by i.created_at desc;
$$;
grant execute on function public.get_invites() to authenticated;
