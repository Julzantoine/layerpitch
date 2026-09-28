// scripts/pglite-db.mjs — base Postgres JETABLE (PGlite, en mémoire) avec toutes les migrations rejouées.
// Sert à tester une migration AVANT de l'appliquer à la vraie base : aucune connexion, aucune donnée réelle.
//   import { freshDb } from './scripts/pglite-db.mjs';  const db = await freshDb();          // toutes les migrations
//   const db = await freshDb({ upTo: '20260927060000_x.sql' });                            // s'arrêter à une migration
//   node scripts/pglite-db.mjs                                                            // vérifie que tout se rejoue
// Faux schéma Supabase : auth.users, auth.uid() (lit le réglage test.uid), rôles anon/authenticated/service_role,
// storage, et des bouchons pour pg_cron, pg_net et vault (extensions absentes de PGlite).
//   await db.query(`select set_config('test.uid', $1, false)`, [uuid]);   // « se connecter » en tant que ce compte
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');

const SUPABASE_STUBS = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage; create schema extensions; create schema net; create schema vault; create schema cron;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid, metadata jsonb);
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  create function net.http_post(url text default null, body jsonb default null, params jsonb default null, headers jsonb default null, timeout_milliseconds int default null) returns bigint language sql as $$ select 1::bigint $$;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
  create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
  create function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
`;

export async function freshDb({ upTo } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const files = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort().filter(f => !upTo || f <= upTo);
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').replace(/create extension if not exists (pg_cron|pg_net);/gi, '');
    try { await db.exec(sql); } catch (e) { throw new Error(`${f} : ${e.message}`); }
  }
  db.migrationCount = files.length;
  return db;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = await freshDb();
  console.log(`OK : ${db.migrationCount} migrations rejouées sur une base jetable.`);
}
