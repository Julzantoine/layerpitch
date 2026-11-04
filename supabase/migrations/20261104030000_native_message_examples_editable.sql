-- LayerPitch — le message natif « examples » (exemples préchargés, 4/11) devient modifiable depuis le
-- panneau admin, comme 'welcome' et 'welcome_studio'. La migration des exemples
-- (20261104020000_example_content_and_onboarding_profile.sql) le prévoit dans son commentaire, mais
-- admin_update_native_message n'acceptait que les clés de bienvenue.

create or replace function public.admin_update_native_message(p_key text, p_body jsonb, p_title jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;
  if p_key is null or p_key not in ('welcome', 'welcome_studio', 'examples') then
    raise exception 'Message natif inconnu : %', p_key;
  end if;
  if jsonb_typeof(p_body) is distinct from 'object' then
    raise exception 'p_body doit être un objet JSON (une clé par code langue)';
  end if;
  if p_title is not null and jsonb_typeof(p_title) is distinct from 'object' then
    raise exception 'p_title doit être un objet JSON (une clé par code langue) ou null';
  end if;
  insert into public.platform_message_templates (key, body, title)
    values (p_key, p_body, coalesce(p_title, '{}'::jsonb))
  on conflict (key) do update
    set body = excluded.body, title = excluded.title, updated_at = now();
end;
$$;
grant execute on function public.admin_update_native_message(text, jsonb, jsonb) to authenticated;
