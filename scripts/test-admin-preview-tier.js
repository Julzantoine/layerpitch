#!/usr/bin/env node
/**
 * Test du sélecteur admin "Voir en tant que" global
 * (supabase/migrations/20260923090000_admin_global_preview_tier.sql).
 * Transaction annulée (ROLLBACK) : aucune donnée réelle modifiée.
 * Usage : node scripts/test-admin-preview-tier.js
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
    const { rows: adm } = await c.query(`select cp.id, cp.profile_id from public.composer_profiles cp join public.admins a on a.profile_id = cp.profile_id limit 1`);
    const { rows: oth } = await c.query(`select cp.id, cp.profile_id from public.composer_profiles cp where not exists (select 1 from public.admins a where a.profile_id = cp.profile_id) limit 1`);
    if (!adm.length || !oth.length) { console.error('Il faut un compositeur admin et un non-admin.'); process.exit(1); }
    const A = adm[0], O = oth[0];
    const as = (sub) => c.query(`set local request.jwt.claims = '${sub ? JSON.stringify({ sub }) : '{}'}'`);
    const tier = async (sub, composerId) => { await as(sub); return (await c.query('select public.composer_effective_tier($1) t', [composerId])).rows[0].t; };
    const quotas = async (sub, composerId) => { await as(sub); return (await c.query('select plan, max_video_storage_gb g from public.effective_plan_quotas($1)', [composerId])).rows[0]; };
    const status = async (sub) => { await as(sub); return (await c.query('select * from public.get_trial_status()')).rows[0]; };

    await c.query('update public.beta_program set full_access = true where id');

    // ---- sans aperçu ----
    let st = await status(A.profile_id);
    check('sans aperçu : get_trial_status = pro, real_plan = pro, aperçu inactif', st.plan === 'pro' && st.real_plan === 'pro' && st.preview_active === false);

    // ---- un non-admin ne peut pas choisir ----
    await c.query('savepoint sp');
    await as(O.profile_id);
    const denied = await c.query(`select public.set_my_preview_tier('free')`).then(() => false, e => /réservé aux admins/.test(e.message));
    await c.query('rollback to savepoint sp');
    check('un non-admin ne peut pas activer un aperçu', denied);

    // ---- l'admin choisit Free ----
    await as(A.profile_id);
    await c.query(`select public.set_my_preview_tier('free')`);
    st = await status(A.profile_id);
    check('aperçu Free : get_trial_status.plan = free, real_plan reste pro, preview_active', st.plan === 'free' && st.real_plan === 'pro' && st.preview_active === true);
    check('aperçu Free : palier effectif de l\'admin (son propre compte) = free', (await tier(A.profile_id, A.id)) === 'free');
    const qa = await quotas(A.profile_id, A.id);
    check('aperçu Free : quotas de l\'admin = ceux du palier free (vidéo 0 Go)', qa.plan === 'free' && Number(qa.g) === 0);

    // ---- portée : jamais pour d'autres, jamais sans identité ----
    check('le nettoyage / un appel sans identité ne voit PAS l\'aperçu (palier réel pro)', (await tier(null, A.id)) === 'pro');
    check('l\'aperçu de l\'admin ne touche pas un autre compositeur', (await tier(A.profile_id, O.id)) === 'pro'); // bêta active
    check('un autre compte qui interroge l\'admin voit son vrai palier', (await tier(O.profile_id, A.id)) === 'pro');

    // ---- Starter puis retour Admin ----
    await as(A.profile_id);
    await c.query(`select public.set_my_preview_tier('starter')`);
    check('aperçu Starter : palier effectif = starter', (await tier(A.profile_id, A.id)) === 'starter');
    await as(A.profile_id);
    await c.query(`select public.set_my_preview_tier('')`);
    st = await status(A.profile_id);
    check('retour Admin : aperçu inactif, plan = pro', st.preview_active === false && st.plan === 'pro' && (await tier(A.profile_id, A.id)) === 'pro');
    const qb = await quotas(A.profile_id, A.id);
    check('retour Admin : quotas de l\'admin rétablis (vidéo > 0 ou illimité)', qb.g === null || Number(qb.g) > 0);

    await c.query('ROLLBACK');
    console.log(`\n${passed} OK, ${failed} FAIL (tout annulé par ROLLBACK)`);
    process.exitCode = failed ? 1 : 0;
  } finally { await c.end(); }
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
