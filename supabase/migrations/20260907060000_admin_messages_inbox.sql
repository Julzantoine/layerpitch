-- LayerPitch — remplace le bandeau d'annonce (platform_settings.notice_messages, un seul message
-- global écrasé à chaque envoi, 20260903220000/20260903230000/20260903240000) par une vraie boîte
-- de réception : historique de messages admin → compositeurs, avec cloche de notification dans le
-- backstage (même patron que contact_messages/mark_contact_messages_seen, 20260905040000), plutôt
-- qu'un bandeau plein écran qui écrase le message précédent. Décidé le 7 septembre (retour de
-- Jules-Antoine : préfère une boîte qui déclenche une notif à un bandeau).
--
-- Portée actée le 7 septembre : broadcast uniquement (pas de ciblage par compositeur — comme le
-- bandeau avant lui), avec historique complet (chaque message envoyé reste consultable, statut
-- lu/non lu par message et par compositeur — contrairement au bandeau qui n'avait qu'un flag global
-- profiles.notice_dismissed_at comparé à un seul timestamp de mise à jour).
--
-- admin_messages : une ligne par envoi, jamais écrasée (contrairement à l'ancien singleton
-- platform_settings). admin_message_reads : une ligne par (message, compositeur) UNIQUEMENT une
-- fois le message vu — pas de fan-out à l'envoi vers tous les compositeurs existants ; la cloche
-- calcule "non lu" côté client en comparant admin_messages à ses propres lignes
-- admin_message_reads (même principe que seen_at sur contact_messages, mais un flag par compositeur
-- puisque ce n'est plus un message avec un seul destinataire).

drop function if exists public.set_platform_notice(jsonb);
drop function if exists public.dismiss_notice();
drop table if exists public.platform_settings;
alter table public.profiles drop column if exists notice_dismissed_at;

create table public.admin_messages (
  id bigserial primary key,
  -- Une clé par code langue (ex. {"fr": "...", "en": "..."}), même structure ouverte que l'ancien
  -- notice_messages (20260903240000) — ajouter une langue reste un ajout de clé, jamais une
  -- migration de schéma.
  body jsonb not null,
  created_at timestamptz not null default now()
);
comment on table public.admin_messages is 'Messages envoyés par un admin à tous les compositeurs (boîte de réception du backstage, remplace l''ancien bandeau platform_settings) — historisés, jamais écrasés. Écriture via admin_send_message()/admin_delete_message() (security definer, gated is_admin()), jamais un GRANT direct.';

alter table public.admin_messages enable row level security;
-- Lecture publique, même convention que platform_settings ("public read", 20260903220000) : ce
-- n'est pas une donnée sensible, et le backstage est de toute façon derrière l'authentification.
create policy "public read" on public.admin_messages for select using (true);

create table public.admin_message_reads (
  message_id bigint not null references public.admin_messages(id) on delete cascade,
  composer_id uuid not null references public.composer_profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (message_id, composer_id)
);
comment on table public.admin_message_reads is 'Accusés de lecture par compositeur et par message admin_messages — une ligne insérée seulement quand le message a été vu (pas de fan-out à l''envoi). Écriture via mark_admin_messages_seen() uniquement.';

alter table public.admin_message_reads enable row level security;
create policy "own admin message reads" on public.admin_message_reads
  for select using (
    composer_id in (select id from public.composer_profiles where profile_id = auth.uid())
  );

-- ============================================================================
create or replace function public.admin_send_message(p_messages jsonb)
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

  insert into public.admin_messages (body) values (p_messages) returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.admin_send_message(jsonb) to authenticated;

-- ============================================================================
create or replace function public.admin_delete_message(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;

  delete from public.admin_messages where id = p_id;
end;
$$;
grant execute on function public.admin_delete_message(bigint) to authenticated;

-- ============================================================================
-- Utilisable par n'importe quel compte compositeur authentifié (pas admin-only), même principe que
-- mark_contact_messages_seen() : marque comme vus tous les messages pas encore accusés par ce
-- compositeur. Silencieux si le compte n'a pas encore de composer_profiles (mêmes conditions que
-- mark_contact_messages_seen()).
create or replace function public.mark_admin_messages_seen()
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

  insert into public.admin_message_reads (message_id, composer_id)
    select m.id, v_composer_id
    from public.admin_messages m
    where not exists (
      select 1 from public.admin_message_reads r
      where r.message_id = m.id and r.composer_id = v_composer_id
    )
  on conflict (message_id, composer_id) do nothing;
end;
$$;
grant execute on function public.mark_admin_messages_seen() to authenticated;
