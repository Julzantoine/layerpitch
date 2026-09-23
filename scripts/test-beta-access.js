#!/usr/bin/env node
/**
 * Test de l'interrupteur bêta et de la rétention analytique
 * (supabase/migrations/20260923020000_beta_full_access_and_analytics_retention.sql).
 * Tout se passe dans une transaction annulée à la fin (ROLLBACK) : aucune donnée réelle modifiée,
 * y compris l'interrupteur lui-même.
 * Usage : node scripts/test-beta-access.js  (SUPABASE_DB_URL dans .env, migration déjà appliquée)
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

    // Un compositeur Free, sans essai actif, qui n'est pas admin.
    const { rows } = await c.query(`
      select cp.id, cp.profile_id from public.composer_profiles cp
      where cp.plan = 'free' and (cp.trial_ends_at is null or cp.trial_ends_at <= now())
        and not exists (select 1 from public.admins a where a.profile_id = cp.profile_id)
      limit 1`);
    if (!rows.length) { console.error('Aucun compositeur Free sans essai pour tester.'); process.exit(1); }
    const { id: composerId, profile_id: profileId } = rows[0];

    const tier = async () => (await c.query('select public.composer_effective_tier($1) as t', [composerId])).rows[0].t;
    const trialPlan = async () => {
      await c.query(`set local request.jwt.claims = '${JSON.stringify({ sub: profileId })}'`);
      return (await c.query('select plan from public.get_trial_status()')).rows[0].plan;
    };
    const videoGb = async () => (await c.query('select max_video_storage_gb g from public.effective_plan_quotas($1)', [composerId])).rows[0].g;

    // ---- interrupteur ACTIF ----
    await c.query('update public.beta_program set full_access = true where id');
    check('bêta active : palier effectif = pro', (await tier()) === 'pro');
    check('bêta active : get_trial_status renvoie pro', (await trialPlan()) === 'pro');
    const gbBeta = await videoGb();

    // ---- interrupteur COUPE ----
    await c.query('update public.beta_program set full_access = false where id');
    check('bêta coupée : retour au palier réel (free)', (await tier()) === 'free');
    check('bêta coupée : get_trial_status renvoie free', (await trialPlan()) === 'free');
    const gbFree = await videoGb();
    check('quota vidéo : Pro (bêta) > Free (bêta coupée)', Number(gbBeta) > Number(gbFree));

    // ---- rétention indépendante du palier (compositeur Free, bêta coupée) ----
    await c.query(`insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, created_at)
                   values ($1,'adreel','t','s-100','test', now() - interval '100 days'),
                          ($1,'adreel','t','s-400','test', now() - interval '400 days')`, [composerId]);
    await c.query('select public.purge_old_analytics_events()');
    const left = (await c.query('select session_id from public.analytics_events where owner_id = $1 order by 1', [composerId])).rows.map(r => r.session_id);
    check('purge : événement de 100 jours CONSERVÉ pour un compte Free (données retrouvables au repassage Pro)', left.includes('s-100'));
    check('purge : événement de 400 jours supprimé (au-delà de la rétention maximale)', !left.includes('s-400'));

    await c.query('ROLLBACK');
    console.log(`\n${passed} OK, ${failed} FAIL (tout annulé par ROLLBACK)`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    await c.end();
  }
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
