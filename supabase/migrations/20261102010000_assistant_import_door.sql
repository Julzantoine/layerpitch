-- LayerPitch — porte d'entrée « import par assistant » (2/11) : jetons personnels, imports en attente, journal, débit.
--
-- Contexte : le compositeur dit à son IA (installée sur son ordinateur) « fais-moi un morceau avec ce dossier de WAV ». Un petit
-- programme local lit le dossier, envoie les WAV dans une zone d'attente PRIVÉE (incoming/ du seau R2 privé) et enregistre un PLAN ;
-- au prochain passage dans le Backstage, un bandeau propose « Ajouter à ma bibliothèque » et le navigateur convertit (WAV -> OGG)
-- et construit le morceau avec le code de l'import de dossier. Aucun morceau n'est créé par la porte : rien n'est jamais public sans lui.
-- Décisions : layerpitch-docs/decisions/2026-11-02-conversion-wav-option-gratuite.md et fiche de sécurité de la porte.
--
-- Patron de sécurité (comme analytics_events / composer_profiles) : RLS activée SANS policy = aucun accès direct par l'API REST ;
-- tout passe par des fonctions SECURITY DEFINER. Celles de la porte (jeton -> compositeur) ne sont exécutables QUE par service_role
-- (l'Edge Function assistant-import) ; celles du compositeur connecté (créer/révoquer un jeton, voir ses imports) par authenticated.
-- La porte n'utilise jamais la clé serveur pour lire ou écrire une table directement : seulement ces fonctions.
--
-- Admin seulement jusqu'au feu vert : select public.set_feature_released('assistant_import', true);

insert into public.feature_flags (key, description) values
  ('assistant_import', 'Import par assistant IA (2/11) — « Connecter un assistant » dans Mon compte, imports en attente dans le Backstage ; admin seulement jusqu''au feu vert')
on conflict (key) do nothing;

-- ============================================================================
-- Tables
-- ============================================================================

-- Jetons personnels. Le jeton complet n'est montré qu'une fois à la création ; on ne garde que son empreinte SHA-256.
create table public.assistant_tokens (
  id uuid primary key default gen_random_uuid(),
  composer_id uuid not null references public.composer_profiles(id) on delete cascade,
  label text not null default '',
  token_prefix text not null,               -- début du jeton (lpa_ + 8 caractères), pour le reconnaître dans la liste
  token_hash text not null unique,          -- SHA-256 hexadécimal du jeton complet
  scope text not null default 'import',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index assistant_tokens_composer_idx on public.assistant_tokens(composer_id);
alter table public.assistant_tokens enable row level security;

-- Imports en attente : un plan + la liste des fichiers envoyés dans la zone d'attente.
-- files : [{ id, name, path, size, status: 'pending' | 'uploaded' | 'invalid' }]  (path = chemin R2 fabriqué par le serveur)
create table public.pending_imports (
  id uuid primary key default gen_random_uuid(),
  composer_id uuid not null references public.composer_profiles(id) on delete cascade,
  token_id uuid references public.assistant_tokens(id) on delete set null,
  title text not null default '',
  plan jsonb not null default '{}'::jsonb,
  files jsonb not null default '[]'::jsonb,
  total_bytes bigint not null default 0,
  status text not null default 'uploading' check (status in ('uploading', 'ready', 'failed', 'added', 'discarded')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  added_at timestamptz,
  files_deleted_at timestamptz
);
create index pending_imports_composer_idx on public.pending_imports(composer_id, status);
alter table public.pending_imports enable row level security;

-- Journal des appels de la porte : jamais de secret (ni jeton, ni lien signé).
create table public.assistant_audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  composer_id uuid,
  token_id uuid,
  action text not null,
  ok boolean not null default true,
  detail jsonb not null default '{}'::jsonb
);
create index assistant_audit_log_composer_idx on public.assistant_audit_log(composer_id, at desc);
alter table public.assistant_audit_log enable row level security;

-- Compteurs de débit (même patron que analytics_write_rate_limit), purgés en continu.
create table public.assistant_rate_limit (
  bucket_key text primary key,
  event_count int not null default 0,
  window_start timestamptz not null default now()
);
alter table public.assistant_rate_limit enable row level security;

revoke all on table public.assistant_tokens, public.pending_imports, public.assistant_audit_log, public.assistant_rate_limit from anon, authenticated;

-- ============================================================================
-- Limites (source unique : la porte les annonce, les tests les relisent)
-- ============================================================================
create or replace function public.assistant_limits()
returns jsonb language sql immutable
as $$
  select jsonb_build_object(
    'max_active_tokens', 5,
    'token_days', 90,
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
revoke all on function public.assistant_limits() from public, anon;
grant execute on function public.assistant_limits() to authenticated, service_role;

-- Nom de fichier sûr : sans caractères de contrôle ni séparateurs de chemin, 120 caractères au plus, extension .wav obligatoire.
-- Renvoie null si le nom ne convient pas.
create or replace function public.assistant_clean_filename(p_name text)
returns text language sql immutable
as $$
  select case when c ~* '\.wav$' and length(c) > 4 then c else null end
  from (select left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]/\\]', '', 'g')), 120) as c) s;
$$;
revoke all on function public.assistant_clean_filename(text) from public, anon;
grant execute on function public.assistant_clean_filename(text) to authenticated, service_role;

-- ============================================================================
-- Compositeur connecté : jetons
-- ============================================================================

create or replace function public.create_assistant_token(p_label text)
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
  if (select count(*) from public.assistant_tokens
       where composer_id = v_composer and revoked_at is null and expires_at > now()) >= (v_limits->>'max_active_tokens')::int then
    raise exception 'assistant:too_many_tokens';
  end if;
  -- 244 bits tirés du générateur aléatoire sûr de Postgres ; préfixe lpa_ pour que les outils de détection de secrets le reconnaissent.
  v_token := 'lpa_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires := now() + ((v_limits->>'token_days')::int || ' days')::interval;
  insert into public.assistant_tokens (composer_id, label, token_prefix, token_hash, expires_at)
  values (v_composer, left(btrim(coalesce(p_label, '')), 60), left(v_token, 12), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_expires)
  returning id into v_id;
  insert into public.assistant_audit_log (composer_id, token_id, action, detail) values (v_composer, v_id, 'token_created', '{}'::jsonb);
  return jsonb_build_object('id', v_id, 'token', v_token, 'prefix', left(v_token, 12), 'expires_at', v_expires);
end;
$$;

create or replace function public.list_my_assistant_tokens()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'label', t.label, 'prefix', t.token_prefix, 'created_at', t.created_at,
    'expires_at', t.expires_at, 'last_used_at', t.last_used_at, 'revoked_at', t.revoked_at
  ) order by t.created_at desc), '[]'::jsonb)
  from public.assistant_tokens t where t.composer_id = public.current_composer_id();
$$;

create or replace function public.revoke_assistant_token(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_composer uuid := public.current_composer_id(); v_n int;
begin
  if v_composer is null then raise exception 'assistant:no_session'; end if;
  update public.assistant_tokens set revoked_at = now() where id = p_id and composer_id = v_composer and revoked_at is null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into public.assistant_audit_log (composer_id, token_id, action) values (v_composer, p_id, 'token_revoked');
  end if;
  return v_n > 0;
end;
$$;

-- Coupure d'urgence : l'admin révoque TOUS les jetons de tous les comptes.
create or replace function public.admin_revoke_all_assistant_tokens()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'assistant:admin_only'; end if;
  update public.assistant_tokens set revoked_at = now() where revoked_at is null;
  get diagnostics v_n = row_count;
  insert into public.assistant_audit_log (action, detail) values ('admin_revoke_all', jsonb_build_object('count', v_n));
  return v_n;
end;
$$;

-- ============================================================================
-- Compositeur connecté : imports en attente (Backstage)
-- ============================================================================

create or replace function public.list_my_pending_imports()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', p.title, 'plan', p.plan, 'created_at', p.created_at, 'expires_at', p.expires_at,
    'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f->>'id', 'name', f->>'name', 'size', (f->>'size')::bigint)), '[]'::jsonb)
                from jsonb_array_elements(p.files) f)
  ) order by p.created_at desc), '[]'::jsonb)
  from public.pending_imports p
  where p.composer_id = public.current_composer_id() and p.status = 'ready' and p.expires_at > now();
$$;

-- Fichiers d'un import prêt, avec leurs chemins : réservé à la fonction serveur qui signe les liens de lecture (service_role).
create or replace function public.assistant_import_files_for_download(p_composer uuid, p_import uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.files from public.pending_imports p
                    where p.id = p_import and p.composer_id = p_composer and p.status = 'ready' and p.expires_at > now()), '[]'::jsonb);
$$;

create or replace function public.mark_pending_import_added(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_composer uuid := public.current_composer_id(); v_n int;
begin
  if v_composer is null then raise exception 'assistant:no_session'; end if;
  update public.pending_imports set status = 'added', added_at = now()
   where id = p_id and composer_id = v_composer and status = 'ready';
  get diagnostics v_n = row_count;
  if v_n > 0 then insert into public.assistant_audit_log (composer_id, action, detail) values (v_composer, 'import_added', jsonb_build_object('import_id', p_id)); end if;
  return v_n > 0;
end;
$$;

create or replace function public.discard_pending_import(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_composer uuid := public.current_composer_id(); v_n int;
begin
  if v_composer is null then raise exception 'assistant:no_session'; end if;
  update public.pending_imports set status = 'discarded', added_at = now()
   where id = p_id and composer_id = v_composer and status in ('uploading', 'ready', 'failed');
  get diagnostics v_n = row_count;
  if v_n > 0 then insert into public.assistant_audit_log (composer_id, action, detail) values (v_composer, 'import_discarded', jsonb_build_object('import_id', p_id)); end if;
  return v_n > 0;
end;
$$;

-- ============================================================================
-- Porte (Edge Function assistant-import) : service_role seulement
-- ============================================================================

-- Jeton -> compositeur. Renvoie null si le jeton est inconnu, révoqué, expiré, ou si le feu vert est fermé pour ce compte.
create or replace function public.assistant_resolve_token(p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare t public.assistant_tokens%rowtype; v_profile uuid;
begin
  select * into t from public.assistant_tokens where token_hash = p_hash;
  if not found or t.revoked_at is not null or t.expires_at <= now() then return null; end if;
  select cp.profile_id into v_profile from public.composer_profiles cp where cp.id = t.composer_id;
  if v_profile is null or not public.feature_released('assistant_import', v_profile) then return null; end if;
  if t.last_used_at is null or t.last_used_at < now() - interval '1 minute' then
    update public.assistant_tokens set last_used_at = now() where id = t.id;
  end if;
  return jsonb_build_object('token_id', t.id, 'composer_id', t.composer_id, 'scope', t.scope);
end;
$$;

-- Limitation de débit : vrai si l'appel est permis. Fenêtre fixe de p_window_seconds par seau.
create or replace function public.assistant_check_rate(p_bucket text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  insert into public.assistant_rate_limit (bucket_key, event_count, window_start) values (p_bucket, 1, now())
  on conflict (bucket_key) do update set
    event_count = case when assistant_rate_limit.window_start < now() - make_interval(secs => p_window_seconds) then 1 else assistant_rate_limit.event_count + 1 end,
    window_start = case when assistant_rate_limit.window_start < now() - make_interval(secs => p_window_seconds) then now() else assistant_rate_limit.window_start end
  returning event_count into v_count;
  return v_count <= p_limit;
end;
$$;

create or replace function public.assistant_log(p_composer uuid, p_token uuid, p_action text, p_ok boolean, p_detail jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.assistant_audit_log (composer_id, token_id, action, ok, detail)
  values (p_composer, p_token, left(coalesce(p_action, ''), 60), coalesce(p_ok, true), coalesce(p_detail, '{}'::jsonb));
$$;

-- Début d'un import : valide le plan, les noms et les tailles, applique les quotas, fabrique les chemins (jamais fournis par le client).
-- p_files : [{ name, size }]. Renvoie { import_id, files: [{ id, name, path, size }] }.
create or replace function public.assistant_begin_import(p_composer uuid, p_token uuid, p_title text, p_plan jsonb, p_files jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limits jsonb := public.assistant_limits();
  v_import uuid := gen_random_uuid();
  v_files jsonb := '[]'::jsonb;
  v_el jsonb; v_name text; v_size bigint; v_id uuid; v_total bigint := 0; v_n int := 0;
  v_pending_count int; v_pending_bytes bigint;
begin
  if p_composer is null or not exists (select 1 from public.composer_profiles where id = p_composer) then raise exception 'assistant:unknown_composer'; end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' or octet_length(p_plan::text) > (v_limits->>'max_plan_bytes')::int then raise exception 'assistant:bad_plan'; end if;
  if coalesce(p_plan->>'mode', '') not in ('vertical', 'vertical-random', 'sequential', 'embranchement-vertical', 'static') then raise exception 'assistant:bad_plan'; end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) < 1 then raise exception 'assistant:no_files'; end if;
  if jsonb_array_length(p_files) > (v_limits->>'max_files_per_import')::int then raise exception 'assistant:too_many_files'; end if;

  select count(*), coalesce(sum(total_bytes), 0) into v_pending_count, v_pending_bytes
    from public.pending_imports where composer_id = p_composer and status in ('uploading', 'ready') and expires_at > now();
  if v_pending_count >= (v_limits->>'max_pending_imports')::int then raise exception 'assistant:too_many_imports'; end if;

  for v_el in select * from jsonb_array_elements(p_files) loop
    v_n := v_n + 1;
    if jsonb_typeof(v_el) <> 'object' or jsonb_typeof(v_el->'size') <> 'number' then raise exception 'assistant:bad_file'; end if;
    v_name := public.assistant_clean_filename(v_el->>'name');
    v_size := (v_el->>'size')::bigint;
    if v_name is null then raise exception 'assistant:bad_file_name'; end if;
    if v_size < 1 or v_size > (v_limits->>'max_file_bytes')::bigint then raise exception 'assistant:file_too_big'; end if;
    v_total := v_total + v_size;
    v_id := gen_random_uuid();
    v_files := v_files || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'name', v_name, 'size', v_size, 'status', 'pending',
      'path', 'incoming/' || p_composer || '/' || v_import || '/' || v_id || '.wav'));
  end loop;
  if v_total > (v_limits->>'max_import_bytes')::bigint then raise exception 'assistant:import_too_big'; end if;
  if v_pending_bytes + v_total > (v_limits->>'max_account_bytes')::bigint then raise exception 'assistant:account_quota'; end if;

  insert into public.pending_imports (id, composer_id, token_id, title, plan, files, total_bytes, expires_at)
  values (v_import, p_composer, p_token, left(btrim(coalesce(p_title, '')), 120), p_plan, v_files, v_total,
          now() + ((v_limits->>'pending_days')::int || ' days')::interval);
  return jsonb_build_object('import_id', v_import, 'files', v_files);
end;
$$;

-- Résultat de la vérification d'un fichier envoyé (taille et signature RIFF/WAVE contrôlées par la porte).
-- Quand tous les fichiers sont reçus : « ready » ; un seul fichier invalide : « failed ».
create or replace function public.assistant_file_checked(p_composer uuid, p_import uuid, p_file text, p_valid boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_files jsonb;
begin
  update public.pending_imports p set files = (
    select coalesce(jsonb_agg(case when f->>'id' = p_file then jsonb_set(f, '{status}', to_jsonb(case when p_valid then 'uploaded' else 'invalid' end)) else f end), '[]'::jsonb)
      from jsonb_array_elements(p.files) f)
   where p.id = p_import and p.composer_id = p_composer and p.status = 'uploading'
  returning p.files into v_files;
  if v_files is null then return null; end if;
  if exists (select 1 from jsonb_array_elements(v_files) f where f->>'status' = 'invalid') then v_status := 'failed';
  elsif not exists (select 1 from jsonb_array_elements(v_files) f where f->>'status' = 'pending') then v_status := 'ready';
  else v_status := 'uploading'; end if;
  update public.pending_imports set status = v_status where id = p_import;
  return v_status;
end;
$$;

-- Chemin, taille annoncée et état d'UN fichier d'un import en cours : sert à la porte pour contrôler ce qui a réellement été envoyé.
create or replace function public.assistant_file_info(p_composer uuid, p_import uuid, p_file text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select f from public.pending_imports p, jsonb_array_elements(p.files) f
   where p.id = p_import and p.composer_id = p_composer and p.status = 'uploading' and p.expires_at > now() and f->>'id' = p_file;
$$;

create or replace function public.assistant_import_status(p_composer uuid, p_import uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('import_id', p.id, 'status', p.status, 'title', p.title, 'expires_at', p.expires_at,
    'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f->>'id', 'name', f->>'name', 'status', f->>'status')), '[]'::jsonb) from jsonb_array_elements(p.files) f))
  from public.pending_imports p where p.id = p_import and p.composer_id = p_composer;
$$;

-- Purge (tâche planifiée) : chemins R2 à supprimer — imports expirés, abandonnés, écartés, ou ajoutés depuis plus d'une heure.
create or replace function public.assistant_files_to_purge(p_limit int)
returns table (import_id uuid, path text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, f->>'path'
    from public.pending_imports p, jsonb_array_elements(p.files) f
   where p.files_deleted_at is null
     and ((p.status in ('uploading', 'ready', 'failed') and p.expires_at <= now())
          or p.status = 'discarded'
          or (p.status = 'added' and p.added_at < now() - interval '1 hour'))
   limit greatest(p_limit, 1);
$$;

create or replace function public.assistant_mark_purged(p_import uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pending_imports set files_deleted_at = now(),
         status = case when status in ('uploading', 'ready', 'failed') then 'discarded' else status end
   where id = p_import and files_deleted_at is null;
$$;

create or replace function public.assistant_housekeeping()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.assistant_rate_limit where window_start < now() - interval '1 hour';
  delete from public.assistant_audit_log where at < now() - interval '90 days';
  delete from public.pending_imports where files_deleted_at is not null and created_at < now() - interval '30 days';
$$;

-- ============================================================================
-- Droits d'exécution
-- ============================================================================
revoke all on function
  public.create_assistant_token(text), public.list_my_assistant_tokens(), public.revoke_assistant_token(uuid),
  public.admin_revoke_all_assistant_tokens(), public.list_my_pending_imports(), public.mark_pending_import_added(uuid),
  public.discard_pending_import(uuid),
  public.assistant_import_files_for_download(uuid, uuid), public.assistant_resolve_token(text),
  public.assistant_check_rate(text, int, int), public.assistant_log(uuid, uuid, text, boolean, jsonb),
  public.assistant_begin_import(uuid, uuid, text, jsonb, jsonb), public.assistant_file_checked(uuid, uuid, text, boolean),
  public.assistant_import_status(uuid, uuid), public.assistant_files_to_purge(int), public.assistant_mark_purged(uuid),
  public.assistant_housekeeping(), public.assistant_file_info(uuid, uuid, text)
from public, anon, authenticated;

grant execute on function
  public.create_assistant_token(text), public.list_my_assistant_tokens(), public.revoke_assistant_token(uuid),
  public.admin_revoke_all_assistant_tokens(), public.list_my_pending_imports(), public.mark_pending_import_added(uuid),
  public.discard_pending_import(uuid)
to authenticated;

grant execute on function
  public.assistant_import_files_for_download(uuid, uuid), public.assistant_resolve_token(text),
  public.assistant_check_rate(text, int, int), public.assistant_log(uuid, uuid, text, boolean, jsonb),
  public.assistant_begin_import(uuid, uuid, text, jsonb, jsonb), public.assistant_file_checked(uuid, uuid, text, boolean),
  public.assistant_import_status(uuid, uuid), public.assistant_files_to_purge(int), public.assistant_mark_purged(uuid),
  public.assistant_housekeeping(), public.assistant_file_info(uuid, uuid, text)
to service_role;

-- ============================================================================
-- Suppression de compte : la zone d'attente d'un compositeur supprimé est mise en file d'effacement R2 (préfixe), quel que soit le
-- chemin de suppression (les lignes pending_imports partent en cascade ; sans cette file, leurs WAV resteraient orphelins).
-- ============================================================================
create or replace function public.queue_assistant_files_on_composer_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.account_deletion_files (profile_id, bucket, prefix)
  values (old.profile_id, 'private', 'incoming/' || old.id || '/');
  return old;
end;
$$;
revoke all on function public.queue_assistant_files_on_composer_delete() from public, anon, authenticated;
create trigger assistant_files_on_composer_delete before delete on public.composer_profiles
  for each row execute function public.queue_assistant_files_on_composer_delete();

-- Entretien quotidien de la base (journal, compteurs, vieilles lignes). L'effacement des fichiers R2 est fait par la fonction
-- purge-assistant-imports, à planifier comme process-account-deletions (voir layerpitch-docs).
select cron.schedule('assistant-housekeeping', '40 3 * * *', 'select public.assistant_housekeeping()');
