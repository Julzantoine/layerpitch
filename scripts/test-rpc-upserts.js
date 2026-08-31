#!/usr/bin/env node
/**
 * Test direct des RPC upsert_track/upsert_pack/upsert_ad_reel via une connexion Postgres directe,
 * en simulant le JWT que PostgREST injecterait normalement (request.jwt.claims) — nécessaire car
 * une connexion psql/pg brute ne passe pas par PostgREST, donc auth.uid() ne serait pas renseigné
 * sans ce contournement de test. Script de développement, pas destiné à un usage régulier.
 *
 * Depuis 20260831231500, l'autorisation des RPC est basée sur la propriété (owner_id) et non plus
 * sur un admin unique en dur — ce script crée donc un second compte/composer_profile de test pour
 * vérifier qu'un compositeur ne peut pas modifier le contenu d'un autre.
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

const COMPOSER_A_PROFILE_ID = '4d04e87f-7da8-41b9-a84e-9fd5ecd0e35c'; // julzantoine@yahoo.com, compte réel
const COMPOSER_B_AUTH_ID = '00000000-0000-4000-8000-000000000002'; // compte de test, créé/détruit par ce script

let passed = 0, failed = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (cond) passed++; else failed++; }

async function asProfile(client, profileId, fn) {
  await client.query('BEGIN');
  await client.query(`set local request.jwt.claims = '${JSON.stringify({ sub: profileId })}'`);
  try { return await fn(); } finally { await client.query('COMMIT'); }
}

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // ---- setup : second compte de test (composer B) ----
  await client.query("insert into auth.users (id, email) values ($1, 'composer-b-test@example.com') on conflict (id) do nothing", [COMPOSER_B_AUTH_ID]);
  await client.query('insert into public.profiles (id) values ($1) on conflict (id) do nothing', [COMPOSER_B_AUTH_ID]);
  const { rows: cbRows } = await client.query('insert into public.composer_profiles (profile_id) values ($1) on conflict (profile_id) do update set profile_id = excluded.profile_id returning id', [COMPOSER_B_AUTH_ID]);
  const composerBId = cbRows[0].id;

  // ---- compte sans composer_profile rejeté ----
  try {
    await asProfile(client, '00000000-0000-4000-8000-000000000099', () =>
      client.query('select upsert_track($1::jsonb)', [JSON.stringify({ id: 'test-track-1', mode: 'static' })])
    );
    check('compte sans profil compositeur rejeté', false);
  } catch (e) {
    check('compte sans profil compositeur rejeté (' + e.message + ')', /non autorisé/i.test(e.message));
  }

  // ---- composer A, morceau simple sans segmentSlots ----
  try {
    await asProfile(client, COMPOSER_A_PROFILE_ID, () =>
      client.query('select upsert_track($1::jsonb)', [JSON.stringify({
        id: 'test-track-1', title: 'Test RPC', mode: 'static', base: 'https://media.layerpitch.com/audio/test-track-1/',
      })])
    );
    const { rows } = await client.query('select title, mode, owner_id from tracks where id = $1', ['test-track-1']);
    check('morceau simple créé via RPC, owner_id = composer A', rows[0] && rows[0].title === 'Test RPC' && rows[0].mode === 'static' && rows[0].owner_id !== composerBId);
  } catch (e) { check('morceau simple créé via RPC (' + e.message + ')', false); }

  // ---- composer B ne peut pas modifier le morceau de composer A ----
  try {
    await asProfile(client, COMPOSER_B_AUTH_ID, () =>
      client.query('select upsert_track($1::jsonb)', [JSON.stringify({ id: 'test-track-1', title: 'Piraté', mode: 'static' })])
    );
    check('composer B rejeté sur le morceau de composer A', false);
  } catch (e) {
    check('composer B rejeté sur le morceau de composer A (' + e.message + ')', /autre compositeur/i.test(e.message));
  }

  // ---- composer B peut créer son propre morceau ----
  try {
    await asProfile(client, COMPOSER_B_AUTH_ID, () =>
      client.query('select upsert_track($1::jsonb)', [JSON.stringify({ id: 'test-track-b1', title: 'Morceau de B', mode: 'static' })])
    );
    const { rows } = await client.query('select owner_id from tracks where id = $1', ['test-track-b1']);
    check('composer B crée son propre morceau, owner_id = composer B', rows[0] && rows[0].owner_id === composerBId);
  } catch (e) { check('composer B crée son propre morceau (' + e.message + ')', false); }

  // ---- composer A, graphe segmentSlots valide (A -> B) ----
  try {
    await asProfile(client, COMPOSER_A_PROFILE_ID, () =>
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

  // ---- composer A, graphe segmentSlots INVALIDE (cible un slot inexistant) ----
  try {
    await asProfile(client, COMPOSER_A_PROFILE_ID, () =>
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

  // ---- composer A, upsert_pack ----
  try {
    await asProfile(client, COMPOSER_A_PROFILE_ID, () =>
      client.query('select upsert_pack($1::jsonb)', [JSON.stringify({
        id: 'test-pack-1', title: 'Test Pack RPC', trackIds: ['test-track-1', 'test-track-2'],
      })])
    );
    const { rows } = await client.query('select count(*) from pack_tracks where pack_id = $1', ['test-pack-1']);
    check('pack créé, 2 pack_tracks liés via RPC', Number(rows[0].count) === 2);
  } catch (e) { check('upsert_pack (' + e.message + ')', false); }

  // ---- composer A, ré-upsert du même pack avec une liste de tracks différente (vérifie le remplacement propre) ----
  try {
    await asProfile(client, COMPOSER_A_PROFILE_ID, () =>
      client.query('select upsert_pack($1::jsonb)', [JSON.stringify({
        id: 'test-pack-1', title: 'Test Pack RPC', trackIds: ['test-track-1'],
      })])
    );
    const { rows } = await client.query('select count(*) from pack_tracks where pack_id = $1', ['test-pack-1']);
    check('pack re-upserté : ancienne liste remplacée proprement (1, pas 2 ni 3)', Number(rows[0].count) === 1);
  } catch (e) { check('re-upsert pack (' + e.message + ')', false); }

  // ---- composer B ne peut pas modifier le pack de composer A ----
  try {
    await asProfile(client, COMPOSER_B_AUTH_ID, () =>
      client.query('select upsert_pack($1::jsonb)', [JSON.stringify({ id: 'test-pack-1', title: 'Piraté' })])
    );
    check('composer B rejeté sur le pack de composer A', false);
  } catch (e) {
    check('composer B rejeté sur le pack de composer A (' + e.message + ')', /autre compositeur/i.test(e.message));
  }

  // ---- composer A, upsert_ad_reel ----
  try {
    await asProfile(client, COMPOSER_A_PROFILE_ID, () =>
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
  await client.query("delete from tracks where id in ('test-track-1', 'test-track-2', 'test-track-b1')");
  await client.query('delete from auth.users where id = $1', [COMPOSER_B_AUTH_ID]); // cascade -> profiles, composer_profiles

  await client.end();
  console.log(`\n${passed} OK, ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('Erreur :', e.message); process.exit(1); });
