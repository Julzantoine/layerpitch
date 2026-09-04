#!/usr/bin/env node
/**
 * Test direct des RPC du tableau de bord analytique compositeur
 * (supabase/migrations/20260905010000_composer_analytics_events.sql) via une connexion Postgres
 * directe, même contournement que scripts/test-admin-rpcs.js (simule le JWT que PostgREST
 * injecterait normalement via `set local request.jwt.claims`).
 *
 * Couvre les exigences du chantier : refus Free (aucune donnée renvoyée), contenu exact Starter vs
 * Pro, résolution du palier effectif avec essai actif, isolation stricte entre deux compositeurs
 * (y compris le cas de collision d'id d'AdReel "main", historiquement ambigu côté Umami),
 * impossibilité de falsifier le propriétaire à l'écriture, limite de fréquence, purge par rétention.
 *
 * Note sur la limite de fréquence : cette connexion directe ne passe pas par PostgREST, donc
 * `current_setting('request.headers')` est absent et log_analytics_event() retombe sur son repli
 * (clé de compteur = session_id) — exactement le chemin prévu pour ce cas, donc bien testable ici,
 * juste pas le chemin "IP réelle" (qui nécessiterait un vrai appel HTTP après déploiement).
 *
 * Usage : node scripts/test-analytics-rpcs.js
 * Nécessite SUPABASE_DB_URL dans .env et que 20260905010000 ait été appliquée.
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

const AUTH_A = '00000000-0000-4000-8000-00000000a001'; // compositeur de test A
const AUTH_B = '00000000-0000-4000-8000-00000000a002'; // compositeur de test B
const ADREEL_ID = 'main'; // même id chez A et B -- reproduit volontairement le cas de collision historique

let passed = 0, failed = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (cond) passed++; else failed++; }

async function asProfile(client, profileId, fn) {
  await client.query('BEGIN');
  await client.query(`set local request.jwt.claims = '${JSON.stringify({ sub: profileId })}'`);
  try { return await fn(); } finally { await client.query('COMMIT'); }
}
async function anonymous(client, fn) {
  await client.query('BEGIN');
  await client.query("set local request.jwt.claims = ''");
  try { return await fn(); } finally { await client.query('COMMIT'); }
}

(async () => {
  if (!process.env.SUPABASE_DB_URL) {
    console.error('SUPABASE_DB_URL manquant dans .env');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  let composerA, composerB;
  try {
    // ---- setup : deux comptes de test, chacun avec un composer_profile et un AdReel 'main' ----
    for (const [auth, email] of [[AUTH_A, 'test-analytics-a@example.com'], [AUTH_B, 'test-analytics-b@example.com']]) {
      await client.query("insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing", [auth, email]);
      await client.query('insert into public.profiles (id) values ($1) on conflict (id) do nothing', [auth]);
    }
    await client.query('delete from public.composer_profiles where profile_id in ($1, $2)', [AUTH_A, AUTH_B]);
    const { rows: crA } = await client.query('insert into public.composer_profiles (profile_id, plan) values ($1, $2) returning id', [AUTH_A, 'starter']);
    const { rows: crB } = await client.query('insert into public.composer_profiles (profile_id, plan) values ($1, $2) returning id', [AUTH_B, 'starter']);
    composerA = crA[0].id; composerB = crB[0].id;

    await client.query('delete from public.ad_reels where owner_id in ($1, $2)', [composerA, composerB]);
    await client.query('insert into public.ad_reels (owner_id, id, label) values ($1, $2, $3)', [composerA, ADREEL_ID, 'Test A']);
    await client.query('insert into public.ad_reels (owner_id, id, label) values ($1, $2, $3)', [composerB, ADREEL_ID, 'Test B']);

    await client.query('delete from public.analytics_events where owner_id in ($1, $2)', [composerA, composerB]);
    await client.query("delete from public.analytics_write_rate_limit where bucket_key like 'test-analytics-%'");

    // ---- écriture : ambiguïté d'id résolue via l'indice ownerId (jamais pris seul, voir migration
    // 20260905020000) -- sans lui, l'un des deux écrase/attrape l'autre puisque 'main' existe chez A ET B ----
    await anonymous(client, () => client.query(
      "select log_analytics_event('adreel', $1, 'test-analytics-session-a1', 'track_play', '{\"trackId\":\"t1\"}'::jsonb, 'desktop', $2)",
      [ADREEL_ID, composerA]
    ));
    await anonymous(client, () => client.query(
      "select log_analytics_event('adreel', $1, 'test-analytics-session-b1', 'track_play', '{\"trackId\":\"t9\"}'::jsonb, 'mobile', $2)",
      [ADREEL_ID, composerB]
    ));
    const { rows: writtenA } = await client.query('select owner_id from public.analytics_events where session_id = $1', ['test-analytics-session-a1']);
    const { rows: writtenB } = await client.query('select owner_id from public.analytics_events where session_id = $1', ['test-analytics-session-b1']);
    check('écriture : événement A rattaché au VRAI propriétaire A (indice vérifié contre une vraie ligne AdReel)', writtenA.length === 1 && writtenA[0].owner_id === composerA);
    check('écriture : événement B (même id d\'AdReel "main") rattaché au VRAI propriétaire B, pas A', writtenB.length === 1 && writtenB[0].owner_id === composerB);

    // ---- écriture : indice de propriétaire falsifié (owner_id réel de A, mais n'a jamais possédé
    // CET entity_id chez lui -- ici B n'a que 'main', pas d'autre AdReel) -> aucune ligne, jamais
    // une fausse confiance sur l'indice seul ----
    let spoofRejectedCleanly = true;
    try {
      await anonymous(client, () => client.query(
        "select log_analytics_event('adreel', 'id-que-personne-ne-possede', 'test-analytics-session-spoof', 'track_play', '{}'::jsonb, null, $1)",
        [composerA]
      ));
    } catch (e) { spoofRejectedCleanly = false; }
    const { rows: spoofRows } = await client.query('select 1 from public.analytics_events where session_id = $1', ['test-analytics-session-spoof']);
    check('écriture : indice ownerId réel mais combiné à un entity_id qu\'il ne possède pas -> aucune ligne insérée', spoofRejectedCleanly && spoofRows.length === 0);

    // ---- écriture : entité inexistante -> aucune ligne insérée, aucune erreur ----
    let entityRejectedCleanly = true;
    try {
      await anonymous(client, () => client.query(
        "select log_analytics_event('adreel', 'id-inexistant-xyz', 'test-analytics-session-ghost', 'track_play', '{}'::jsonb, null)"
      ));
    } catch (e) { entityRejectedCleanly = false; }
    const { rows: ghostRows } = await client.query('select 1 from public.analytics_events where session_id = $1', ['test-analytics-session-ghost']);
    check('écriture : AdReel inexistant -> aucune ligne insérée, aucune erreur levée', entityRejectedCleanly && ghostRows.length === 0);

    // ---- écriture : limite de fréquence (repli sur session_id hors PostgREST, voir en-tête du fichier) ----
    const rateSession = 'test-analytics-session-rate';
    for (let i = 0; i < 70; i++) {
      await anonymous(client, () => client.query(
        "select log_analytics_event('adreel', $1, $2, 'pool_refresh', '{}'::jsonb, null, $3)", [ADREEL_ID, rateSession, composerA]
      ));
    }
    const { rows: rateRows } = await client.query('select count(*) as n from public.analytics_events where session_id = $1', [rateSession]);
    check('écriture : limite de fréquence -- 70 appels rapides ne produisent pas 70 lignes (plafond ~60/minute)', Number(rateRows[0].n) <= 60 && Number(rateRows[0].n) > 0);
    await client.query('delete from public.analytics_events where session_id in ($1, $2, $3)', ['test-analytics-session-a1', 'test-analytics-session-b1', rateSession]);

    // ---- lecture : Free -- aucune donnée renvoyée, même s'il existe des événements réels ----
    await client.query(
      "insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, detail, device) values ($1, 'adreel', $2, 'test-analytics-session-free', 'track_play', '{\"trackId\":\"t1\"}'::jsonb, 'desktop')",
      [composerA, ADREEL_ID]
    );
    await client.query("update public.composer_profiles set plan = 'free', trial_ends_at = null where id = $1", [composerA]);
    const { rows: freeResp } = await asProfile(client, AUTH_A, () => client.query('select get_my_analytics(null, null) as v'));
    const free = freeResp[0].v;
    check('lecture Free : locked = true', free.locked === true);
    check('lecture Free : sessions TOUJOURS vide, même si un événement réel existe pour ce compositeur', Array.isArray(free.sessions) && free.sessions.length === 0);

    // ---- lecture : Starter -- session sans détail ----
    await client.query("update public.composer_profiles set plan = 'starter', trial_ends_at = null where id = $1", [composerA]);
    const { rows: starterResp } = await asProfile(client, AUTH_A, () => client.query('select get_my_analytics(null, null) as v'));
    const starter = starterResp[0].v;
    check('lecture Starter : une session remontée', starter.tier === 'starter' && Array.isArray(starter.sessions) && starter.sessions.length === 1);
    check('lecture Starter : sessionId/type/entityId/device corrects', starter.sessions[0] && starter.sessions[0].entityId === ADREEL_ID && starter.sessions[0].device === 'desktop');
    check('lecture Starter : jamais de tracks/interactions dans la réponse', starter.sessions[0] && !('tracks' in starter.sessions[0]) && !('interactions' in starter.sessions[0]));

    // ---- lecture : Pro -- détail complet, isolation stricte (jamais les événements de B) ----
    await client.query(
      "insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, detail, device) values ($1, 'adreel', $2, 'test-analytics-session-free', 'go_to_end_click', '{\"trackId\":\"t1\"}'::jsonb, 'desktop'), ($1, 'adreel', $2, 'test-analytics-session-free', 'intensity_change', '{\"level\":2}'::jsonb, 'desktop')",
      [composerA, ADREEL_ID]
    );
    await client.query(
      "insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, detail, device) values ($1, 'adreel', $2, 'test-analytics-session-b-real', 'track_play', '{\"trackId\":\"tb\"}'::jsonb, 'mobile')",
      [composerB, ADREEL_ID]
    );
    await client.query("update public.composer_profiles set plan = 'pro', trial_ends_at = null where id = $1", [composerA]);
    const { rows: proResp } = await asProfile(client, AUTH_A, () => client.query('select get_my_analytics(null, null) as v'));
    const pro = proResp[0].v;
    const proSession = (pro.sessions || []).find(s => s.sessionId === 'test-analytics-session-free');
    check('lecture Pro : détail par morceau présent, "écouté jusqu\'au bout" détecté', proSession && proSession.tracks.length === 1 && proSession.tracks[0].reachedEnd === true && proSession.tracks[0].skipped === false);
    check('lecture Pro : interaction adaptative présente (intensity_change)', proSession && proSession.interactions.length === 1 && proSession.interactions[0].name === 'intensity_change');
    check('lecture Pro : isolation stricte -- ne voit jamais la session du compositeur B (même id d\'AdReel)', !(pro.sessions || []).some(s => s.sessionId === 'test-analytics-session-b-real'));

    // ---- lecture : essai reverse trial actif -> accès Pro même si palier brut = free ----
    await client.query("update public.composer_profiles set plan = 'free', trial_ends_at = now() + interval '5 days' where id = $1", [composerA]);
    const { rows: trialResp } = await asProfile(client, AUTH_A, () => client.query('select get_my_analytics(null, null) as v'));
    check('lecture : essai actif -> palier effectif "pro" malgré un palier brut "free"', trialResp[0].v.tier === 'pro' && trialResp[0].v.locked === false);

    await client.query("update public.composer_profiles set plan = 'free', trial_ends_at = now() - interval '5 days' where id = $1", [composerA]);
    const { rows: expiredResp } = await asProfile(client, AUTH_A, () => client.query('select get_my_analytics(null, null) as v'));
    check('lecture : essai expiré -> retombée sur Free (locked), pas de faux Pro résiduel', expiredResp[0].v.tier === 'free' && expiredResp[0].v.locked === true);

    // ---- lecture : non authentifié -> Free/verrouillé, jamais une erreur ----
    const { rows: anonResp } = await anonymous(client, () => client.query('select get_my_analytics(null, null) as v'));
    check('lecture : appel non authentifié -> Free verrouillé (jamais une erreur ni une fuite)', anonResp[0].v.locked === true);

    // ---- purge : supprime les données au-delà de la rétention du palier ACTUEL, garde le reste ----
    await client.query("update public.composer_profiles set plan = 'starter', trial_ends_at = null where id = $1", [composerA]);
    await client.query(
      "insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, created_at) values ($1, 'adreel', $2, 'test-analytics-session-old', 'track_play', now() - interval '40 days'), ($1, 'adreel', $2, 'test-analytics-session-recent', 'track_play', now() - interval '5 days')",
      [composerA, ADREEL_ID]
    );
    await client.query('select public.purge_old_analytics_events()');
    const { rows: afterPurge } = await client.query('select session_id from public.analytics_events where owner_id = $1', [composerA]);
    const remainingIds = afterPurge.map(r => r.session_id);
    check('purge : ligne de plus de 30 jours supprimée (rétention Starter)', !remainingIds.includes('test-analytics-session-old'));
    check('purge : ligne récente conservée', remainingIds.includes('test-analytics-session-recent'));

    // ---- nettoyage complet ----
    await client.query('delete from public.analytics_events where owner_id in ($1, $2)', [composerA, composerB]);
    await client.query("delete from public.analytics_write_rate_limit where bucket_key like '%test-analytics-%'");
    await client.query('delete from public.ad_reels where owner_id in ($1, $2)', [composerA, composerB]);
    await client.query('delete from auth.users where id in ($1, $2)', [AUTH_A, AUTH_B]); // cascade -> profiles/composer_profiles

    console.log(`\n${passed} OK, ${failed} FAIL`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    await client.end();
  }
})().catch(e => { console.error('Erreur :', e.message); process.exit(1); });
