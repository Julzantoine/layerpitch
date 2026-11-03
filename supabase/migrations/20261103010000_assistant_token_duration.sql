-- Import par assistant IA — durée de validité d'un jeton CHOISIE par le compositeur (1 à 365 jours, 90 par défaut), plafond de jetons
-- actifs porté de 5 à 10, et état « Connecter un assistant » lisible par Mon compte (ouvert ou non pour ce compte + jetons).

create or replace function public.assistant_limits()
returns jsonb language sql immutable
as $$
  select jsonb_build_object(
    'max_active_tokens', 10,
    'token_days', 90,
    'token_days_max', 365,
    'max_pending_imports', 5,
    'max_files_per_import', 60,
    'max_file_bytes', 150::bigint * 1024 * 1024,
    'max_import_bytes', 1024::bigint * 1024 * 1024,
    'max_account_bytes', 3::bigint * 1024 * 1024 * 1024,
    'pending_days', 14,
    'max_plan_bytes', 65536,
    'calls_per_minute', 60,
    'imports_per_day', 20
  );
$$;

drop function if exists public.create_assistant_token(text);
create or replace function public.create_assistant_token(p_label text, p_days int default 90)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_composer uuid := public.current_composer_id();
  v_limits jsonb := public.assistant_limits();
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if auth.uid() is null or v_composer is null then raise exception 'assistant:no_session'; end if;
  if not public.feature_released('assistant_import', auth.uid()) then raise exception 'assistant:not_released'; end if;
  if p_days is null or p_days < 1 or p_days > (v_limits->>'token_days_max')::int then raise exception 'assistant:bad_duration'; end if;
  if (select count(*) from public.assistant_tokens
       where composer_id = v_composer and revoked_at is null and expires_at > now()) >= (v_limits->>'max_active_tokens')::int then
    raise exception 'assistant:too_many_tokens';
  end if;
  v_token := 'lpa_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires := now() + (p_days || ' days')::interval;
  insert into public.assistant_tokens (composer_id, label, token_prefix, token_hash, expires_at)
  values (v_composer, left(btrim(coalesce(p_label, '')), 60), left(v_token, 12), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_expires)
  returning id into v_id;
  insert into public.assistant_audit_log (composer_id, token_id, action, detail) values (v_composer, v_id, 'token_created', jsonb_build_object('days', p_days));
  return jsonb_build_object('id', v_id, 'token', v_token, 'prefix', left(v_token, 12), 'expires_at', v_expires);
end;
$$;
revoke all on function public.create_assistant_token(text, int) from public, anon;
grant execute on function public.create_assistant_token(text, int) to authenticated;

-- Ce que Mon compte affiche : { open, tokens, limits }. open = faux tant que le feu vert est fermé pour ce compte (la carte reste cachée).
create or replace function public.my_assistant_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_limits jsonb := public.assistant_limits();
begin
  if auth.uid() is null or public.current_composer_id() is null or not public.feature_released('assistant_import', auth.uid()) then
    return jsonb_build_object('open', false);
  end if;
  return jsonb_build_object('open', true, 'tokens', public.list_my_assistant_tokens(),
    'limits', jsonb_build_object('max_active_tokens', v_limits->'max_active_tokens', 'token_days', v_limits->'token_days', 'token_days_max', v_limits->'token_days_max'));
end;
$$;
revoke all on function public.my_assistant_status() from public, anon;
grant execute on function public.my_assistant_status() to authenticated;
