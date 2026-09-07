#!/usr/bin/env node
/**
 * Test direct des RPC du panneau admin (supabase/migrations/20260903220100_admin_rpcs.sql) via une
 * connexion Postgres directe, en simulant le JWT que PostgREST injecterait normalement — même
 * contournement que scripts/test-is-admin.js / scripts/test-rpc-upserts.js.
 *
 * Vérifie admin_get_stats(), admin_list_accounts(), admin_send_message()/admin_delete_message()
 * (chemin admin + chemin non-admin rejeté, boîte de réception qui a remplacé le bandeau
 * platform_settings/set_platform_notice() le 7 septembre) et mark_admin_messages_seen()
 * (utilisable par n'importe quel compte). Ne teste pas l'Edge Function suspend-account (nécessite
 * un vrai appel HTTP après déploiement manuel) : voir la checklist manuelle décrite dans le plan.
 *
 * Usage : node scripts/test-admin-rpcs.js
 * Nécessite SUPABASE_DB_URL dans .env et que 20260903220000/20260903220100 aient été appliquées.
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

const ADMIN_EMAIL = 'julzantoine@yahoo.com';
const NON_ADMIN_AUTH_ID = '00000000-0000-4000-8000-000000000004'; // compte de test, créé/détruit par ce script

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
    // ---- setup : compte admin réel, retrouvé par email ----
    const { rows: adminRows } = await client.query('select id from auth.users where email = $1', [ADMIN_EMAIL]);
    if (!adminRows.length) {
      console.error(`Aucun compte auth.users pour ${ADMIN_EMAIL} — impossible de tester le compte admin réel.`);
      process.exit(1);
    }
    const adminId = adminRows[0].id;

    // ---- setup : second compte de test, sans ligne dans admins ----
    await client.query("insert into auth.users (id, email) values ($1, 'non-admin-test-admin-rpcs@example.com') on conflict (id) do nothing", [NON_ADMIN_AUTH_ID]);
    await client.query('insert into public.profiles (id) values ($1) on conflict (id) do nothing', [NON_ADMIN_AUTH_ID]);

    // ---- admin_get_stats() : chemin admin ----
    try {
      const { rows } = await asProfile(client, adminId, () => client.query('select admin_get_stats() as v'));
      const stats = rows[0].v;
      check('admin_get_stats() renvoie accounts/content/composerAverages', !!(stats && stats.accounts && stats.content && stats.composerAverages));
    } catch (e) { check('admin_get_stats() pour l\'admin (' + e.message + ')', false); }

    // ---- admin_get_stats() : chemin non-admin rejeté ----
    try {
      await asProfile(client, NON_ADMIN_AUTH_ID, () => client.query('select admin_get_stats() as v'));
      check('admin_get_stats() rejeté pour un compte non-admin', false);
    } catch (e) { check('admin_get_stats() rejeté pour un compte non-admin', /réservé aux admins/i.test(e.message)); }

    // ---- admin_list_accounts() : chemin admin, contient le compte de test ----
    try {
      const { rows } = await asProfile(client, adminId, () => client.query('select * from admin_list_accounts(null)'));
      const ids = rows.map(r => r.profile_id);
      check('admin_list_accounts() contient le compte admin et le compte de test', ids.includes(adminId) && ids.includes(NON_ADMIN_AUTH_ID));
    } catch (e) { check('admin_list_accounts() pour l\'admin (' + e.message + ')', false); }

    // ---- admin_list_accounts() : chemin non-admin rejeté ----
    try {
      await asProfile(client, NON_ADMIN_AUTH_ID, () => client.query('select * from admin_list_accounts(null)'));
      check('admin_list_accounts() rejeté pour un compte non-admin', false);
    } catch (e) { check('admin_list_accounts() rejeté pour un compte non-admin', /réservé aux admins/i.test(e.message)); }

    // ---- admin_send_message() : chemin non-admin rejeté ----
    try {
      await asProfile(client, NON_ADMIN_AUTH_ID, () => client.query('select admin_send_message($1::jsonb)', [JSON.stringify({ fr: 'devrait échouer', en: 'should fail' })]));
      check('admin_send_message() rejeté pour un compte non-admin', false);
    } catch (e) { check('admin_send_message() rejeté pour un compte non-admin', /réservé aux admins/i.test(e.message)); }

    // ---- admin_send_message() : chemin admin, structure multilingue, vérifié en lecture brute ----
    let testMessageId = null;
    try {
      const testMessages = { fr: 'message de test — script automatisé', en: 'test message — automated script' };
      const { rows: sendRows } = await asProfile(client, adminId, () => client.query('select admin_send_message($1::jsonb) as id', [JSON.stringify(testMessages)]));
      testMessageId = sendRows[0].id;
      const { rows } = await client.query('select body from admin_messages where id = $1', [testMessageId]);
      check('admin_send_message() écrit bien la carte de messages', rows[0].body.fr === testMessages.fr && rows[0].body.en === testMessages.en);
    } catch (e) { check('admin_send_message() pour l\'admin (' + e.message + ')', false); }

    // ---- mark_admin_messages_seen() : utilisable par le compte non-admin (silencieux, ce compte
    // de test n'a pas de composer_profiles — même garde que mark_contact_messages_seen()) ----
    try {
      await asProfile(client, NON_ADMIN_AUTH_ID, () => client.query('select mark_admin_messages_seen()'));
      check('mark_admin_messages_seen() ne lève pas d\'erreur pour un compte sans composer_profiles', true);
    } catch (e) { check('mark_admin_messages_seen() pour un compte non-admin (' + e.message + ')', false); }

    // ---- admin_delete_message() : chemin non-admin rejeté, puis nettoyage par l'admin ----
    try {
      await asProfile(client, NON_ADMIN_AUTH_ID, () => client.query('select admin_delete_message($1::bigint)', [testMessageId]));
      check('admin_delete_message() rejeté pour un compte non-admin', false);
    } catch (e) { check('admin_delete_message() rejeté pour un compte non-admin', /réservé aux admins/i.test(e.message)); }

    // ---- nettoyage : supprime le message de test et le compte de test ----
    if (testMessageId) await asProfile(client, adminId, () => client.query('select admin_delete_message($1::bigint)', [testMessageId]));
    await client.query('delete from auth.users where id = $1', [NON_ADMIN_AUTH_ID]); // cascade -> profiles

    console.log(`\n${passed} OK, ${failed} FAIL`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    await client.end();
  }
})().catch(e => { console.error('Erreur :', e.message); process.exit(1); });
