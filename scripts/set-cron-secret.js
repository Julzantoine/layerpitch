#!/usr/bin/env node
/**
 * LayerPitch — range dans le coffre (Vault) de la base le code secret de la tâche planifiée de suppression de comptes
 * (secret « cron_secret », lu par la commande du job cron « suppression-de-comptes »). Le même code doit être posé sur la
 * fonction (supabase secrets set CRON_SECRET=...). Le code arrive par la variable d'environnement CRON_SECRET : il n'est
 * jamais affiché. Usage : CRON_SECRET=... node scripts/set-cron-secret.js   (identifiants de la base dans .env : SUPABASE_DB_URL)
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
(async () => {
  const secret = process.env.CRON_SECRET || '';
  if (!process.env.SUPABASE_DB_URL) { console.error('SUPABASE_DB_URL manquant dans .env'); process.exit(1); }
  if (secret.length < 32) { console.error('CRON_SECRET absent ou trop court (32 caractères au moins)'); process.exit(1); }
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const ex = (await c.query("select id from vault.secrets where name = 'cron_secret'")).rows[0];
  if (ex) await c.query('select vault.update_secret($1, $2)', [ex.id, secret]);
  else await c.query("select vault.create_secret($1, 'cron_secret')", [secret]);
  console.log(ex ? 'secret cron_secret mis à jour dans le coffre.' : 'secret cron_secret créé dans le coffre.');
  await c.end();
})().catch(e => { console.error('ERREUR : ' + e.message); process.exit(1); });
