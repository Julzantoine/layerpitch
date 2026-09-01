#!/usr/bin/env node
/**
 * Test direct de is_admin() (supabase/migrations/20260901180000_admin_role.sql) via une connexion
 * Postgres directe, en simulant le JWT que PostgREST injecterait normalement (request.jwt.claims)
 * — même contournement que scripts/test-rpc-upserts.js, nécessaire car une connexion pg brute ne
 * passe pas par PostgREST (auth.uid() ne serait pas renseigné sinon).
 *
 * Vérifie que is_admin() distingue bien le compte admin (Jules-Antoine) d'un second compte de
 * test sans ligne dans `admins` — le même contrôle que l'Edge Function invite-tester applique
 * désormais via callerClient.rpc('is_admin'). Ne teste pas l'Edge Function elle-même (nécessite un
 * vrai appel HTTP après redéploiement manuel via le dashboard Supabase) : ce script vérifie la
 * logique d'autorisation en base, qui est la seule partie modifiable depuis cet environnement.
 *
 * Usage : node scripts/test-is-admin.js
 * Nécessite SUPABASE_DB_URL dans .env (voir .env.example) et que la migration
 * 20260901190000_admin_role.sql ait déjà été appliquée (node scripts/apply-migrations.js).
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const ADMIN_EMAIL = 'julzantoine@yahoo.com'; // seedé par la migration
const NON_ADMIN_AUTH_ID = '00000000-0000-4000-8000-000000000003'; // compte de test, créé/détruit par ce script

let passed = 0, failed = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (cond) passed++; else failed++; }

async function asProfile(client, profileId, fn) {
  await client.query('BEGIN');
  await client.query(`set local request.jwt.claims = '${JSON.stringify({ sub: profileId })}'`);
  try { return await fn(); } finally { await client.query('COMMIT'); }
}

(async () => {
  if (!process.env.SUPABASE_DB_URL) {
    console.error('SUPABASE_DB_URL manquant dans .env');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // ---- setup : compte admin réel, retrouvé par email (pas d'uuid en dur) ----
    const { rows: adminRows } = await client.query('select id from auth.users where email = $1', [ADMIN_EMAIL]);
    if (!adminRows.length) {
      console.error(`Aucun compte auth.users pour ${ADMIN_EMAIL} — impossible de tester le compte admin réel.`);
      process.exit(1);
    }
    const adminId = adminRows[0].id;

    // ---- setup : second compte de test, sans ligne dans admins ----
    await client.query("insert into auth.users (id, email) values ($1, 'non-admin-test@example.com') on conflict (id) do nothing", [NON_ADMIN_AUTH_ID]);
    await client.query('insert into public.profiles (id) values ($1) on conflict (id) do nothing', [NON_ADMIN_AUTH_ID]);

    // ---- is_admin() vrai pour le compte admin ----
    try {
      const { rows } = await asProfile(client, adminId, () => client.query('select is_admin() as v'));
      check(`is_admin() = true pour ${ADMIN_EMAIL}`, rows[0].v === true);
    } catch (e) { check('is_admin() pour le compte admin (' + e.message + ')', false); }

    // ---- is_admin() faux pour un compte non-admin ----
    try {
      const { rows } = await asProfile(client, NON_ADMIN_AUTH_ID, () => client.query('select is_admin() as v'));
      check('is_admin() = false pour un compte non-admin', rows[0].v === false);
    } catch (e) { check('is_admin() pour le compte non-admin (' + e.message + ')', false); }

    // ---- is_admin() faux sans session (auth.uid() null) ----
    try {
      const { rows } = await client.query('select is_admin() as v');
      check('is_admin() = false sans session (auth.uid() null)', rows[0].v === false);
    } catch (e) { check('is_admin() sans session (' + e.message + ')', false); }

    // ---- nettoyage ----
    await client.query('delete from auth.users where id = $1', [NON_ADMIN_AUTH_ID]); // cascade -> profiles

    console.log(`\n${passed} OK, ${failed} FAIL`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    await client.end();
  }
})().catch(e => { console.error('Erreur :', e.message); process.exit(1); });
