#!/usr/bin/env node
/**
 * Test direct des RPC upsert_track/upsert_pack/upsert_ad_reel via une connexion Postgres directe,
 * en simulant le JWT que PostgREST injecterait normalement (request.jwt.claims) — nécessaire car
 * une connexion psql/pg brute ne passe pas par PostgREST, donc auth.jwt() ne serait pas renseigné
 * sans ce contournement de test. Script de développement, pas destiné à un usage régulier.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnv() {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

let passed = 0, failed = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (cond) passed++; else failed++; }

async function asUser(client, email, fn) {
  await client.query('BEGIN');
  await client.query(`set local request.jwt.claims = '${JSON.stringify({ email })}'`);
  try { return await fn(); } finally { await client.query('COMMIT'); }
}

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // ---- non-admin rejeté ----
  try {
    await asUser(client, 'quelquun@autre.com', () =>
      client.query('select upsert_track($1::jsonb)', [JSON.stringify({ id: 'test-track-1', mode: 'static' })])
    );
    check('appel non-admin rejeté', false);
  } catch (e) {
    check('appel non-admin rejeté (' + e.message + ')', /non autorisé/i.test(e.message));
  }

  // ---- admin, morceau simple sans segmentSlots ----
  try {
    await asUser(client, 'julzantoine@yahoo.com', () =>
      client.query('select upsert_track($1::jsonb)', [JSON.stringify({
        id: 'test-track-1', title: 'Test RPC', mode: 'static', base: 'https://media.layerpitch.com/audio/test-track-1/',
      })])
    );
    const { rows } = await client.query('select title, mode from tracks where id = $1', ['test-track-1']);
    check('morceau simple créé via RPC', rows[0] && rows[0].title === 'Test RPC' && rows[0].mode === 'static');
  } catch (e) { check('morceau simple créé via RPC (' + e.message + ')', false); }

  // ---- admin, graphe segmentSlots valide (A -> B) ----
  try {
    await asUser(client, 'julzantoine@yahoo.com', () =>
      client.query('select upsert_track($1::jsonb)', [JSON.stringify({
        id: 'test-track-2', title: 'Test Graph Valide', mode: 'sequential', base: '',
        segmentSlots: [
          { id: 'slotA', label: 'A', nextOptions: [{ targetId: 'slotB', label: 'To B' }] },
          { id: 'slotB', label: 'B' },
        ],
      })])
    );
    const { rows } = await client.query('select count(*) from segment_slot_transitions where from_slot_id = $1', ['slotA']);
    check('graphe valide accepté, transition créée', Number(rows[0].count) === 1);
  } catch (e) { check('graphe valide accepté (' + e.message + ')', false); }

  // ---- admin, graphe segmentSlots INVALIDE (cible un slot inexistant) ----
  try {
    await asUser(client, 'julzantoine@yahoo.com', () =>
      client.query('select upsert_track($1::jsonb)', [JSON.stringify({
        id: 'test-track-3', title: 'Test Graph Invalide', mode: 'sequential', base: '',
        segmentSlots: [
          { id: 'slotX', label: 'X', nextOptions: [{ targetId: 'slot-inexistant', label: 'Nulle part' }] },
        ],
      })])
    );
    check('graphe invalide rejeté', false);
    await client.query("delete from tracks where id = 'test-track-3'"); // au cas où, ne devrait jamais être atteint
  } catch (e) {
    check('graphe invalide rejeté (' + e.message + ')', /introuvable/i.test(e.message));
  }
  const { rows: leaked } = await client.query("select count(*) from tracks where id = 'test-track-3'");
  check('rien écrit pour le morceau au graphe invalide (rollback atomique)', Number(leaked[0].count) === 0);

  // ---- admin, upsert_pack ----
  try {
    await asUser(client, 'julzantoine@yahoo.com', () =>
      client.query('select upsert_pack($1::jsonb)', [JSON.stringify({
        id: 'test-pack-1', title: 'Test Pack RPC', trackIds: ['test-track-1', 'test-track-2'],
      })])
    );
    const { rows } = await client.query('select count(*) from pack_tracks where pack_id = $1', ['test-pack-1']);
    check('pack créé, 2 pack_tracks liés via RPC', Number(rows[0].count) === 2);
  } catch (e) { check('upsert_pack (' + e.message + ')', false); }

  // ---- admin, ré-upsert du même pack avec une liste de tracks différente (vérifie le remplacement propre) ----
  try {
    await asUser(client, 'julzantoine@yahoo.com', () =>
      client.query('select upsert_pack($1::jsonb)', [JSON.stringify({
        id: 'test-pack-1', title: 'Test Pack RPC', trackIds: ['test-track-1'],
      })])
    );
    const { rows } = await client.query('select count(*) from pack_tracks where pack_id = $1', ['test-pack-1']);
    check('pack re-upserté : ancienne liste remplacée proprement (1, pas 2 ni 3)', Number(rows[0].count) === 1);
  } catch (e) { check('re-upsert pack (' + e.message + ')', false); }

  // ---- admin, upsert_ad_reel ----
  try {
    await asUser(client, 'julzantoine@yahoo.com', () =>
      client.query('select upsert_ad_reel($1::jsonb)', [JSON.stringify({
        id: 'test-adreel-1', label: 'Test AdReel RPC', lang: 'fr', trackIds: ['test-track-1', 'test-track-2'],
      })])
    );
    const { rows } = await client.query('select count(*) from ad_reel_tracks where ad_reel_id = $1', ['test-adreel-1']);
    check('AdReel créé, 2 ad_reel_tracks liés via RPC', Number(rows[0].count) === 2);
  } catch (e) { check('upsert_ad_reel (' + e.message + ')', false); }

  // ---- nettoyage des données de test ----
  await client.query("delete from ad_reels where id = 'test-adreel-1'");
  await client.query("delete from packs where id = 'test-pack-1'");
  await client.query("delete from tracks where id in ('test-track-1', 'test-track-2')");

  await client.end();
  console.log(`\n${passed} OK, ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('Erreur :', e.message); process.exit(1); });
