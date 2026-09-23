#!/usr/bin/env node
/**
 * Test de get_my_analytics_overview / get_my_analytics_entity
 * (supabase/migrations/20260923050000_composer_analytics_overview.sql).
 * Tout se passe dans une transaction annulée (ROLLBACK) : aucune donnée réelle modifiée.
 * Usage : node scripts/test-analytics-overview.js  (SUPABASE_DB_URL dans .env, migration appliquée)
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
let passed = 0, failed = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (cond) passed++; else failed++; }

(async () => {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(`
      select cp.id, cp.profile_id, ar.id as ad_reel_id from public.composer_profiles cp
      join public.ad_reels ar on ar.owner_id = cp.id
      where not exists (select 1 from public.admins a where a.profile_id = cp.profile_id) limit 1`);
    if (!rows.length) { console.error('Aucun compositeur non-admin avec un AdReel pour tester.'); process.exit(1); }
    const { id: composerId, profile_id: profileId, ad_reel_id: adReelId } = rows[0];
    await c.query('delete from public.analytics_events where owner_id = $1', [composerId]);

    const ev = (sid, name, detail, device, ago) => c.query(
      `insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, detail, device, tier, created_at)
       values ($1,'adreel',$2,$3,$4,$5::jsonb,$6,'pro', now() - $7::interval)`,
      [composerId, adReelId, sid, name, JSON.stringify(detail), device, ago]);
    // s1 (mobile, il y a 2 jours) : A jouée puis terminée, puis B
    await ev('s1', 'page_open', {}, 'mobile', '2 days'); await ev('s1', 'track_play', { trackId: 'A' }, 'mobile', '2 days');
    await ev('s1', 'go_to_end_click', { trackId: 'A' }, 'mobile', '2 days'); await ev('s1', 'track_play', { trackId: 'B' }, 'mobile', '2 days');
    // s2 (desktop, il y a 10 jours) : A seulement
    await ev('s2', 'page_open', {}, 'desktop', '10 days'); await ev('s2', 'track_play', { trackId: 'A' }, 'desktop', '10 days');
    // s3 (desktop, il y a 1 jour) : A sautée pour B, un réglage
    await ev('s3', 'page_open', {}, 'desktop', '1 day'); await ev('s3', 'track_play', { trackId: 'A' }, 'desktop', '1 day');
    await ev('s3', 'track_play', { trackId: 'B' }, 'desktop', '1 day'); await ev('s3', 'intensity_change', {}, 'desktop', '1 day');

    const as = async (fn) => { await c.query(`set local request.jwt.claims = '${JSON.stringify({ sub: profileId })}'`); return fn(); };
    const overview = async (bucket = 'day', from = "now() - interval '30 days'") =>
      (await as(() => c.query(`select public.get_my_analytics_overview(${from}, now(), $1, 'Europe/Paris') v`, [bucket]))).rows[0].v;
    const entity = async () =>
      (await as(() => c.query(`select public.get_my_analytics_entity('adreel', $1, now() - interval '30 days', now(), 'day', 'Europe/Paris') v`, [adReelId]))).rows[0].v;

    // ---- Pro (bêta active) ----
    await c.query('update public.beta_program set full_access = true where id');
    let o = await overview();
    check('Pro : 3 visites', o.totals.visits === 3);
    check('Pro : 5 lectures', o.totals.plays === 5);
    check('Pro : part mobile = 33 %', Number(o.totals.mobileShare) === 33);
    check('Pro : série zéro-remplie, somme = visites', o.series.visits.reduce((a, b) => a + b, 0) === 3 && o.series.visits.length === o.buckets.length && o.buckets.length >= 30);
    check('Pro : un AdReel listé avec 3 visites', o.entities.length === 1 && o.entities[0].visits === 3 && o.entities[0].id === adReelId);
    check('Pro : la liste porte sa mini-série', Array.isArray(o.entities[0].series) && o.entities[0].series.length === o.buckets.length);
    const e = await entity();
    const tA = e.tracks.find(t => t.trackId === 'A'), tB = e.tracks.find(t => t.trackId === 'B');
    check('Pro détail : morceau A = 3 lectures, 1 jusqu\'au bout, 1 sauté', tA && tA.plays === 3 && tA.reachedEnd === 1 && tA.skipped === 1);
    check('Pro détail : morceau B = 2 lectures, 0 sauté', tB && tB.plays === 2 && tB.skipped === 0);
    check('Pro détail : appareils mobile 1 / desktop 2', e.totals.mobile === 1 && e.totals.desktop === 2);
    check('Pro détail : interaction intensity_change comptée', e.interactions.some(i => i.name === 'intensity_change' && i.count === 1));
    await c.query('savepoint too_many');
    const refused = await overview('hour').then(() => false, err => /Trop de périodes/.test(err.message));
    await c.query('rollback to savepoint too_many');
    check('Pro : trop de périodes refusé (heures sur 30 jours)', refused);

    // ---- Collections ----
    await c.query(`insert into public.collections (id, title, owner_id) values ('t-coll-1', 'Ma collection test', $1)`, [composerId]);
    await c.query(`set local request.jwt.claims = '{}'`); // visiteur anonyme (les visites du propriétaire sont exclues)
    await c.query(`select public.log_analytics_event('collection', 't-coll-1', 'c1', 'page_open', '{}'::jsonb, 'desktop', $1)`, [composerId]);
    await c.query(`select public.log_analytics_event('collection', 't-coll-1', 'c1', 'track_play', '{"trackId":"A"}'::jsonb, 'desktop', $1)`, [composerId]);
    o = await overview();
    const coll = o.entities.find(x => x.type === 'collection');
    check('Collection : listée avec son nom, 1 visite et 1 lecture', coll && coll.name === 'Ma collection test' && coll.visits === 1 && coll.plays === 1);
    const ec = (await as(() => c.query(`select public.get_my_analytics_entity('collection', 't-coll-1', now() - interval '30 days', now(), 'day', 'Europe/Paris') v`))).rows[0].v;
    check('Collection : détail disponible (Pro)', ec.entity.name === 'Ma collection test' && ec.totals.visits === 1);

    // ---- Starter : visites seulement ----
    await c.query('update public.beta_program set full_access = false where id');
    await c.query(`update public.composer_profiles set plan = 'starter', trial_ends_at = null where id = $1`, [composerId]);
    o = await overview();
    check('Starter : visites présentes (3 AdReel + 1 collection)', o.tier === 'starter' && o.totals.visits === 4);
    check('Starter : ni lectures, ni série de lectures', o.totals.plays === null && o.series.plays === null && o.entities.every(x => x.plays === null));
    const es = await entity();
    check('Starter détail : pas de morceaux ni d\'interactions', es.tracks === null && es.interactions === null && es.totals.plays === null);
    o = await overview('day', "now() - interval '1 year'");
    check('Starter : fenêtre bornée à 30 jours de rétention', o.retentionDays === 30 && new Date(o.windowStart) > new Date(Date.now() - 31 * 864e5));

    // ---- Free : verrouillé, rien ----
    await c.query(`update public.composer_profiles set plan = 'free' where id = $1`, [composerId]);
    o = await overview();
    check('Free : aperçu (pas verrouillé)', o.locked === false && o.teaser === true && o.tier === 'free');
    check('Free : AUCUN chiffre réel (totaux et dates de visite nuls)', o.totals.visits === null && o.totals.plays === null && o.totals.mobileShare === null && o.totals.items === null && o.entities.every(x => x.visits === null && x.plays === null && x.lastVisit === null));
    check('Free : courbe ramenée à 0-100, forme conservée (max = 100, aucune valeur réelle)',
      Math.max(...o.series.visits) === 100 && o.series.visits.every(v => v >= 0 && v <= 100) && o.entities[0].series.length === o.buckets.length);
    check('Free : nom de l\'AdReel conservé', typeof o.entities[0].name === 'string' && o.entities[0].name.length > 0);
    const ef = await entity();
    check('Free : le détail d\'un élément reste verrouillé', ef.locked === true && ef.totals === undefined);

    // ---- Aperçu "en tant que" : réservé aux admins ----
    await c.query('update public.beta_program set full_access = true where id');
    await c.query(`update public.composer_profiles set plan = 'pro' where id = $1`, [composerId]);
    const asPreview = async (sub, tier) => {
      await c.query(`set local request.jwt.claims = '${JSON.stringify({ sub })}'`);
      return (await c.query(`select public.get_my_analytics_overview(now() - interval '30 days', now(), 'day', 'Europe/Paris', $1) v`, [tier])).rows[0].v;
    };
    let pv = await asPreview(profileId, 'free');
    check('Aperçu : un compte NON admin ne peut pas simuler un autre palier (paramètre ignoré)', pv.tier === 'pro' && pv.teaser === undefined);
    const { rows: adm } = await c.query(`select cp.id, cp.profile_id from public.composer_profiles cp join public.admins a on a.profile_id = cp.profile_id limit 1`);
    if (adm.length) {
      pv = await asPreview(adm[0].profile_id, 'free');
      check('Aperçu : un admin peut voir le rendu Free (aperçu flouté, aucun chiffre)', pv.tier === 'free' && pv.teaser === true && pv.totals.visits === null);
      pv = await asPreview(adm[0].profile_id, 'starter');
      check('Aperçu : un admin peut voir le rendu Starter (pas de lectures)', pv.tier === 'starter' && pv.totals.plays === null);
    }

    await c.query('ROLLBACK');
    console.log(`\n${passed} OK, ${failed} FAIL (tout annulé par ROLLBACK)`);
    process.exitCode = failed ? 1 : 0;
  } finally { await c.end(); }
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
