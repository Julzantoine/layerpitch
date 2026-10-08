-- LayerPitch — historique des messages admin avec leur destinataire (8 octobre).
--
-- Le panneau admin sait désormais envoyer un message à un ou plusieurs comptes choisis
-- (admin_send_message accepte p_recipient_id depuis le 11 septembre ; seul le panneau ne
-- l'exposait pas). Problème : l'historique du panneau lisait admin_messages en direct, et la
-- règle de lecture (20260920010000) ne montre à un compte que les messages diffusés ou adressés à
-- lui -- un message adressé à un autre compte serait donc INVISIBLE (et impossible à supprimer)
-- pour l'admin qui l'a envoyé.
--
-- admin_list_messages() : tout l'historique, réservé aux admins, avec l'adresse e-mail du
-- destinataire quand le message est personnel (recipient_id renseigné). Même forme de lecture que
-- admin_list_accounts() (security definer, auth.users joint seulement parce que is_admin() garde
-- l'accès).

create or replace function public.admin_list_messages()
returns table (
  id bigint,
  body jsonb,
  title jsonb,
  created_at timestamptz,
  existing_accounts_only boolean,
  recipient_id uuid,
  recipient_email text
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
    select m.id, m.body, m.title, m.created_at, m.existing_accounts_only, m.recipient_id, u.email::text
    from public.admin_messages m
    left join auth.users u on u.id = m.recipient_id
    order by m.created_at desc
    limit 100;
end;
$$;
grant execute on function public.admin_list_messages() to authenticated;
