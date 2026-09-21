-- LayerPitch — déclencheur qui appelle notify-admin-message à chaque annonce diffusée (21
-- septembre), suite de 20260921040000_announcement_emails.sql.
--
-- Pourquoi un déclencheur SQL et pas un Database Webhook du dashboard : à la création du webhook,
-- le dashboard a échoué ("schema supabase_functions does not exist") -- l'infrastructure
-- webhooks n'avait jamais été activée sur ce projet. Un webhook n'est de toute façon qu'un
-- déclencheur qui appelle pg_net ; l'écrire ici le rend versionné et indépendant du dashboard.
--
-- Le secret partagé (en-tête x-webhook-secret, comparé par la fonction à NOTIFY_WEBHOOK_SECRET)
-- n'est PAS dans ce fichier (dépôt public) : il est lu dans Supabase Vault, secret nommé
-- 'notify_webhook_secret', créé à la main (select vault.create_secret(...)). L'Authorization
-- utilise la clé publique (publishable) déjà exposée côté navigateur -- elle sert seulement à
-- passer la vérification JWT de la passerelle des Edge Functions, la vraie barrière est le secret.
--
-- Ne se déclenche que pour les annonces diffusées (recipient_id null) : le message de bienvenue
-- (ciblé) n'envoie jamais d'email. L'appel réseau part APRÈS la validation de la transaction
-- (pg_net), la fonction retrouve donc bien la ligne. Une erreur ici ne doit JAMAIS empêcher
-- l'enregistrement de l'annonce : tout est dans un bloc exception qui se contente d'avertir.

create extension if not exists pg_net;

create or replace function public.notify_admin_message_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notify_webhook_secret';
  if v_secret is null then
    raise warning 'notify_admin_message_email: secret Vault "notify_webhook_secret" introuvable, aucun email envoyé pour le message %', new.id;
    return new;
  end if;

  perform net.http_post(
    url := 'https://ypygllyjfynrnvapufow.supabase.co/functions/v1/notify-admin-message',
    body := jsonb_build_object('type', 'INSERT', 'record', jsonb_build_object('id', new.id)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_bpjR1M-no9BaxD6QjwcNlQ_og_IgcRb',
      'x-webhook-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  raise warning 'notify_admin_message_email: échec de l''appel pour le message % : %', new.id, sqlerrm;
  return new;
end;
$$;
revoke execute on function public.notify_admin_message_email() from public, anon, authenticated;

drop trigger if exists notify_admin_message_email on public.admin_messages;
create trigger notify_admin_message_email
  after insert on public.admin_messages
  for each row
  when (new.recipient_id is null)
  execute function public.notify_admin_message_email();
