-- LayerPitch — ciblage par compte pour admin_messages + message de bienvenue automatique.
--
-- Jusqu'ici admin_messages ne savait que diffuser à TOUT LE MONDE (portée actée le 7 septembre,
-- 20260907060000_admin_messages_inbox.sql) -- c'est ce qui a fait qu'un message de test envoyé
-- par Jules-Antoine depuis le panneau admin a été vu par tous les comptes (10 septembre). Ajoute
-- un ciblage optionnel par compte (recipient_id) : une ligne avec recipient_id renseigné n'est
-- visible que par ce compte-là ; une ligne avec recipient_id = null reste diffusée à tout le monde
-- comme avant (comportement admin_send_message() inchangé par défaut).
--
-- Premier usage : mark_onboarding_complete() insère automatiquement un message personnel de
-- bienvenue pour chaque compte qui termine bienvenue.html, dans la même boîte "Messages de
-- LayerPitch" que les annonces -- décidé le 11 septembre (pas d'email, un message interne).

alter table public.admin_messages add column recipient_id uuid references auth.users(id) on delete cascade;
comment on column public.admin_messages.recipient_id is 'NULL = diffusé à tous les comptes (comportement historique). Renseigné = visible uniquement par ce compte.';

drop policy "public read" on public.admin_messages;
create policy "public read" on public.admin_messages
  for select using (recipient_id is null or recipient_id = auth.uid());

-- ============================================================================
-- admin_send_message : p_recipient_id optionnel, comportement par défaut (broadcast) inchangé
-- pour l'appel existant côté admin.html (api/admin.js n'envoie jamais ce paramètre aujourd'hui).
create or replace function public.admin_send_message(p_messages jsonb, p_recipient_id uuid default null)
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

  insert into public.admin_messages (body, recipient_id) values (p_messages, p_recipient_id) returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.admin_send_message(jsonb, uuid) to authenticated;

-- ============================================================================
-- mark_onboarding_complete() : même fonction qu'avant (20260903160000), augmentée pour insérer le
-- message de bienvenue personnel une seule fois (garde "not exists" -- revisiter cet écran après
-- coup, cas déjà géré par bienvenue.html qui ne réappelle jamais cette RPC une fois
-- onboarding_completed=true, mais on protège aussi côté fonction par prudence).
--
-- ✏️ TEXTE À ÉDITER PAR JULES-ANTOINE : le corps du message (fr/en) est en dur ci-dessous --
-- demander une modification en langage naturel, une nouvelle migration met à jour cette fonction.
create or replace function public.mark_onboarding_complete()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Non autorisé : aucune session active';
  end if;
  update public.profiles set onboarding_completed = true where id = v_uid;

  if not exists (select 1 from public.admin_messages where recipient_id = v_uid) then
    insert into public.admin_messages (body, recipient_id) values (
      jsonb_build_object(
        'fr', 'Bienvenue sur LayerPitch ! [À REMPLACER PAR JULES-ANTOINE : texte de bienvenue, lien playlist tutos, adresse de contact.]',
        'en', 'Welcome to LayerPitch! [TO BE REPLACED BY JULES-ANTOINE: welcome text, tutorial playlist link, contact address.]'
      ),
      v_uid
    );
  end if;
end;
$$;

grant execute on function public.mark_onboarding_complete() to authenticated;

-- ============================================================================
-- mark_admin_messages_seen() : ajoute le filtre de portée (recipient_id is null or = auth.uid())
-- -- sans lui, cette fonction (security definer, donc pas soumise à la policy RLS "public read")
-- marquerait "vus" des messages personnels destinés à D'AUTRES comptes, jamais réellement
-- affichés à celui qui appelle la RPC.
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
    where (m.recipient_id is null or m.recipient_id = v_uid)
      and not exists (
        select 1 from public.admin_message_reads r
        where r.message_id = m.id and r.composer_id = v_composer_id
      )
  on conflict (message_id, composer_id) do nothing;
end;
$$;
grant execute on function public.mark_admin_messages_seen() to authenticated;
