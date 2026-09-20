-- LayerPitch — envoi d'un message admin "aux comptes déjà existants uniquement" (20 septembre).
--
-- Jusqu'ici un message diffusé (recipient_id null) était visible par TOUS les comptes, y compris
-- ceux créés après l'envoi (20260911162000) -- un message daté ("vous êtes aujourd'hui 10 bêta
-- testeurs...") aurait donc été lu par les futurs arrivants, qui reçoivent déjà leur propre
-- message de bienvenue (mark_onboarding_complete). Nouveau drapeau existing_accounts_only : le
-- message reste UNE seule ligne diffusée, mais n'est visible que par les comptes dont
-- profiles.created_at est antérieur ou égal à son created_at.
--
-- La règle vit à deux endroits qu'il faut garder alignés : la policy RLS "public read" (ce que le
-- backstage/admin lisent) et mark_admin_messages_seen() (SECURITY DEFINER, donc hors RLS -- sans
-- la même condition, elle marquerait "vus" des messages jamais affichés au compte).
-- account_predates() est elle-même SECURITY DEFINER pour ne pas dépendre de la policy de lecture
-- de profiles.

alter table public.admin_messages add column existing_accounts_only boolean not null default false;
comment on column public.admin_messages.existing_accounts_only is 'true = message diffusé (recipient_id null) visible uniquement par les comptes créés avant son envoi. Sans effet si recipient_id est renseigné.';

create or replace function public.account_predates(p_ts timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and created_at <= p_ts);
$$;
grant execute on function public.account_predates(timestamptz) to anon, authenticated;

drop policy "public read" on public.admin_messages;
create policy "public read" on public.admin_messages
  for select using (
    recipient_id = auth.uid()
    or (recipient_id is null and (not existing_accounts_only or public.account_predates(created_at)))
  );

create or replace function public.mark_admin_messages_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_composer_id uuid;
  v_uid uuid := auth.uid();
begin
  select id into v_composer_id from public.composer_profiles where profile_id = v_uid;
  if v_composer_id is null then return; end if;

  insert into public.admin_message_reads (message_id, composer_id)
    select m.id, v_composer_id
    from public.admin_messages m
    where (
        m.recipient_id = v_uid
        or (m.recipient_id is null and (not m.existing_accounts_only or public.account_predates(m.created_at)))
      )
      and not exists (
        select 1 from public.admin_message_reads r
        where r.message_id = m.id and r.composer_id = v_composer_id
      )
  on conflict (message_id, composer_id) do nothing;
end;
$$;
grant execute on function public.mark_admin_messages_seen() to authenticated;

-- Signature changée (nouveau paramètre) : drop de l'ancienne surcharge, sinon deux versions
-- coexisteraient et l'appel PostgREST deviendrait ambigu (même piège que 20260911163000).
drop function if exists public.admin_send_message(jsonb, uuid);
create function public.admin_send_message(
  p_messages jsonb,
  p_recipient_id uuid default null,
  p_existing_accounts_only boolean default false
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

  insert into public.admin_messages (body, recipient_id, existing_accounts_only)
    values (p_messages, p_recipient_id, coalesce(p_existing_accounts_only, false))
    returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.admin_send_message(jsonb, uuid, boolean) to authenticated;
