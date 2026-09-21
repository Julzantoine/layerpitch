-- LayerPitch — titre optionnel pour les messages admin (21 septembre).
--
-- La boîte de réception du backstage (refonte "façon YouTube", 21/09) affiche un titre en gras par
-- message ; jusqu'ici tous les messages diffusés portaient le même titre générique "Annonce
-- LayerPitch". Nouvelle colonne title, même structure ouverte que body (une clé par code langue,
-- ex. {"fr": "...", "en": "..."}) -- ajouter une langue reste un ajout de clé, jamais une migration.
-- Nullable : un message sans titre (tous les messages existants, le message de bienvenue
-- automatique) retombe sur le titre générique côté backstage.

alter table public.admin_messages add column title jsonb;
comment on column public.admin_messages.title is 'Titre optionnel du message, une clé par code langue (même forme que body). NULL = titre générique côté backstage.';

-- Signature changée (nouveau paramètre) : drop de l'ancienne surcharge, sinon deux versions
-- coexisteraient et l'appel PostgREST deviendrait ambigu (même piège que 20260911163000 et
-- 20260920010000). Les appels existants (sans p_titles) continuent de fonctionner : le paramètre
-- a une valeur par défaut.
drop function if exists public.admin_send_message(jsonb, uuid, boolean);
create function public.admin_send_message(
  p_messages jsonb,
  p_recipient_id uuid default null,
  p_existing_accounts_only boolean default false,
  p_titles jsonb default null
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

  insert into public.admin_messages (body, title, recipient_id, existing_accounts_only)
    values (p_messages, p_titles, p_recipient_id, coalesce(p_existing_accounts_only, false))
    returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.admin_send_message(jsonb, uuid, boolean, jsonb) to authenticated;
