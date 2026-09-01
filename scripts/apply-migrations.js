#!/usr/bin/env node
/**
 * LayerPitch — applique les fichiers SQL de supabase/migrations/ dans l'ordre alphabétique,
 * chacun dans sa propre transaction (rollback automatique en cas d'erreur, aucune migration
 * partiellement appliquée). Une table _migrations garde la trace des fichiers déjà appliqués —
 * relancer ce script ne réapplique jamais un fichier déjà passé. Identifiants dans .env :
 * SUPABASE_DB_URL.
 *
 * Envoie NOTIFY pgrst, 'reload schema' après coup (une seule fois, si au moins une migration a
 * été appliquée) — sans ça, PostgREST continue de servir son schéma en cache et toute migration
 * touchant une structure de table (colonne ajoutée/retirée, clé primaire changée) casse les
 * lectures/écritures avec des erreurs du type "column X does not exist" jusqu'au prochain
 * redémarrage naturel de PostgREST. Trouvé le 1er septembre (migration settings/socials),
 * docs/LAYERPITCH_CHANGELOG.md pour le détail. La propagation prend quelques secondes une fois le
 * signal envoyé — normal, pas une confirmation instantanée.
 *
 * Usage : node scripts/apply-migrations.js
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

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');

(async () => {
  if (!process.env.SUPABASE_DB_URL) {
    console.error('SUPABASE_DB_URL manquant dans .env');
    process.exit(1);
  }
  const allFiles = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())');
    const { rows } = await client.query('select name from public._migrations');
    const already = new Set(rows.map(r => r.name));
    const files = allFiles.filter(f => !already.has(f));

    if (!files.length) { console.log('Rien à appliquer — déjà à jour.'); return; }
    console.log(`${files.length} fichier(s) de migration à appliquer :`);
    files.forEach(f => console.log('  - ' + f));

    for (const f of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      console.log(`\n→ ${f}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('insert into public._migrations (name) values ($1)', [f]);
        await client.query('COMMIT');
        console.log(`  ✓ appliqué`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`  ✗ échec, rollback : ${e.message}`);
        throw e;
      }
    }
    await client.query("NOTIFY pgrst, 'reload schema'");
    console.log('\n✓ Toutes les migrations appliquées. Signal de rechargement du cache de schéma PostgREST envoyé (propagation : quelques secondes).');
  } finally {
    await client.end();
  }
})().catch(e => { console.error('Erreur :', e.message); process.exit(1); });
