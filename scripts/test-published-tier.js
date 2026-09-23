#!/usr/bin/env node
/**
 * Test : le serveur décide du palier figé dans un AdReel publié
 * (supabase/migrations/20260923100000_server_decides_published_tier.sql).
 * Transaction annulée (ROLLBACK) : aucune donnée réelle modifiée.
 * Usage : node scripts/test-published-tier.js
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
    const { rows: oth } = await c.query(`select cp.id, cp.profile_id from public.composer_profiles cp where not exists (select 1 from public.admins a where a.profile_id = cp.profile_id) limit 1`);
    const { rows: adm } = await c.query(`select cp.id, cp.profile_id from public.composer_profiles cp join public.admins a on a.profile_id = cp.profile_id limit 1`);
    const O = oth[0], A = adm[0];
    const publish = async (who, profile) => {
      await c.query(`set local request.jwt.claims = '${JSON.stringify({ sub: who.profile_id })}'`);
      const id = 'tier-test-' + Math.random().toString(36).slice(2, 8);
      await c.query(`select public.upsert_ad_reel($1::jsonb)`, [JSON.stringify({ id, label: 'x', lang: 'fr', profile, testimonials: [], blocks: [], trackIds: [] })]);
      return (await c.query(`select profile from public.ad_reels where owner_id = $1 and id = $2`, [who.id, id])).rows[0].profile;
    };
    const forged = { effectivePlan: 'pro', adminTierOverride: 'pro', title: 'Mon AdReel' };

    // Compte non admin, Free réel (bêta coupée, ni essai)
    await c.query('update public.beta_program set full_access = false where id');
    await c.query(`update public.composer_profiles set plan = 'free', trial_ends_at = null where id = $1`, [O.id]);
    let p = await publish(O, forged);
    check('non admin Free : palier "pro" forgé dans le payload ÉCRASÉ par le vrai (free)', p.effectivePlan === 'free');
    check('non admin : adminTierOverride retiré', p.adminTierOverride === undefined);
    check('le reste du profil est conservé', p.title === 'Mon AdReel');

    await c.query(`update public.composer_profiles set plan = 'starter' where id = $1`, [O.id]);
    p = await publish(O, { effectivePlan: 'free' });
    check('non admin Starter : palier réel starter enregistré', p.effectivePlan === 'starter');

    await c.query('update public.beta_program set full_access = true where id');
    p = await publish(O, { effectivePlan: 'free' });
    check('bêta active : tout le monde publié comme pro', p.effectivePlan === 'pro');

    // Admin : override honoré, aperçu ignoré
    p = await publish(A, { adminTierOverride: 'free' });
    check('admin avec override free : palier free (test du rendu public)', p.effectivePlan === 'free' && p.adminTierOverride === 'free');
    await c.query(`set local request.jwt.claims = '${JSON.stringify({ sub: A.profile_id })}'`);
    await c.query(`select public.set_my_preview_tier('starter')`);
    p = await publish(A, {});
    check('admin sans override, aperçu Starter actif : publié avec le VRAI palier (pro)', p.effectivePlan === 'pro');

    await c.query('ROLLBACK');
    console.log(`\n${passed} OK, ${failed} FAIL (tout annulé par ROLLBACK)`);
    process.exitCode = failed ? 1 : 0;
  } finally { await c.end(); }
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
