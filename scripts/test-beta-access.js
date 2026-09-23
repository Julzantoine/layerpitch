#!/usr/bin/env node
/**
 * Test de l'interrupteur bêta et de la rétention analytique
 * (migrations 20260923020000 et 20260923030000).
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
      order by exists (select 1 from public.ad_reels ar where ar.owner_id = cp.id) desc
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
    check('quota vidéo (import réservé aux admins pendant la bêta) : 0 Go pour un non-admin, bêta active', Number(gbBeta) === 0);
    check('quota vidéo : bêta coupée = règles normales du palier (Free = 0 Go)', Number(gbFree) === 0);
    const { rows: adm } = await c.query(`select cp.id from public.composer_profiles cp join public.admins a on a.profile_id = cp.profile_id limit 1`);
    if (adm.length) {
      const gbAdmin = (await c.query('select max_video_storage_gb g from public.effective_plan_quotas($1)', [adm[0].id])).rows[0].g;
      check('quota vidéo : un admin garde le quota Pro (import autorisé)', gbAdmin === null || Number(gbAdmin) > 0);
    }

    // ---- collecte : rien en Free, tout en Pro (bêta comptée comme Pro) ----
    const { rows: ent } = await c.query(`select id from public.ad_reels where owner_id = $1 limit 1`, [composerId]);
    if (ent.length) {
      const logIt = (sid) => c.query(`select public.log_analytics_event('adreel', $1, $2, 'test', '{}'::jsonb, 'desktop', $3)`, [ent[0].id, sid, composerId]);
      const count = async (sid) => Number((await c.query('select count(*) n from public.analytics_events where session_id = $1', [sid])).rows[0].n);
      await logIt('collect-free');            // bêta coupée (état courant) : compte Free
      check('collecte : compte Free = aucun événement enregistré', (await count('collect-free')) === 0);
      await c.query('update public.beta_program set full_access = true where id');
      await logIt('collect-beta');
      check('collecte : bêta active = événement enregistré avec le palier pro',
        (await c.query("select tier from public.analytics_events where session_id = 'collect-beta'")).rows[0]?.tier === 'pro');
      await c.query('update public.beta_program set full_access = false where id');
    } else {
      console.log('SKIP - ce compositeur n\'a aucun AdReel, tests de collecte ignorés');
    }

    // ---- nettoyage : rétention du palier de COLLECTE, jamais du palier actuel ----
    // Compte Free, bêta coupée : c'est le scénario "Pro de janvier à juin, Free ensuite".
    await c.query(`insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, tier, created_at) values
      ($1,'adreel','t','pro-100','test','pro', now() - interval '100 days'),
      ($1,'adreel','t','pro-400','test','pro', now() - interval '400 days'),
      ($1,'adreel','t','st-100','test','starter', now() - interval '100 days'),
      ($1,'adreel','t','st-10','test','starter', now() - interval '10 days')`, [composerId]);
    await c.query('select public.purge_old_analytics_events()');
    const left = (await c.query("select session_id from public.analytics_events where session_id like 'pro-%' or session_id like 'st-%'")).rows.map(r => r.session_id);
    check('nettoyage : événement collecté en Pro à 100 jours CONSERVÉ malgré le passage en Free', left.includes('pro-100'));
    check('nettoyage : événement collecté en Pro à 400 jours supprimé (au-delà d\'un an)', !left.includes('pro-400'));
    check('nettoyage : événement collecté en Starter à 100 jours supprimé (rétention Starter = 30 jours)', !left.includes('st-100'));
    check('nettoyage : événement collecté en Starter à 10 jours conservé', left.includes('st-10'));

    await c.query('ROLLBACK');
    console.log(`\n${passed} OK, ${failed} FAIL (tout annulé par ROLLBACK)`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    await c.end();
  }
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
