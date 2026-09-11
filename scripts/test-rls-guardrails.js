#!/usr/bin/env node
/**
 * Garde-fou de non-régression RLS (11 septembre, audit sécurité) — voir le rapport de l'audit :
 * l'autorisation sur les tables sensibles (achats, factures, admin, données perso) est déléguée à
 * 100% aux policies RLS, sans second contrôle côté JS (api/*.js fait confiance à Postgres). C'est un
 * choix architectural raisonnable, mais ça veut dire qu'une seule migration future qui désactive la
 * RLS par erreur sur une de ces tables, ou qui pose une policy UPDATE/DELETE trop permissive
 * (`using (true)`), devient une fuite immédiate — sans qu'aucun code JS ne s'en aperçoive.
 *
 * Ce script ne corrige rien, il vérifie deux choses après chaque migration :
 *   1. RLS est bien ACTIVÉE sur chaque table sensible listée ci-dessous.
 *   2. Aucune policy UPDATE/DELETE de ces tables n'a une condition `USING (true)` (équivalent à
 *      "n'importe qui peut modifier/supprimer n'importe quelle ligne").
 * Une table avec RLS activée et ZÉRO policy est un résultat valide (accès fermé par défaut, lecture/
 * écriture exclusivement via des fonctions SECURITY DEFINER) — pas un échec.
 *
 * Usage : node scripts/test-rls-guardrails.js
 * Nécessite SUPABASE_DB_URL dans .env (même connexion que scripts/apply-migrations.js).
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

// Tables qui portent des données d'achat, de facturation, d'administration ou personnelles —
// voir le rapport d'audit du 11 septembre pour la liste complète des tables du projet.
const SENSITIVE_TABLES = [
  'pack_purchases', 'album_purchases', 'invoices', 'admins', 'access_requests',
  'contact_messages', 'analytics_events', 'analytics_write_rate_limit', 'composer_profiles',
  'studio_profiles', 'fan_profiles', 'profiles',
];

let passed = 0, failed = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (cond) passed++; else failed++; }

(async () => {
  if (!process.env.SUPABASE_DB_URL) {
    console.error('SUPABASE_DB_URL manquant dans .env');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    for (const table of SENSITIVE_TABLES) {
      const { rows } = await client.query(
        `select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = $1`,
        [table]
      );
      if (!rows.length) { check(`${table} existe`, false); continue; }
      check(`RLS activée sur public.${table}`, rows[0].relrowsecurity === true);
    }

    const { rows: permissivePolicies } = await client.query(
      `select schemaname, tablename, policyname, cmd, qual
       from pg_policies
       where schemaname = 'public' and tablename = any($1) and cmd in ('UPDATE', 'DELETE') and qual = 'true'`,
      [SENSITIVE_TABLES]
    );
    check(
      `Aucune policy UPDATE/DELETE trop permissive (USING (true)) sur une table sensible`,
      permissivePolicies.length === 0
    );
    if (permissivePolicies.length) {
      permissivePolicies.forEach(p => console.log(`     -> ${p.tablename}.${p.policyname} (${p.cmd})`));
    }

    console.log(`\n${passed} OK, ${failed} FAIL`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    await client.end();
  }
})().catch(e => { console.error('Erreur :', e.message); process.exit(1); });
