#!/usr/bin/env node
/**
 * Matrice des droits (migration 20260927070000_entitlements_matrix.sql) sur la VRAIE base.
 *
 * Deux temps, pour prouver que la migration ne change rien aux comptes existants :
 *   node scripts/test-entitlements.js avant   -> AVANT d'appliquer la migration : photographie les quotas, paliers
 *                                                et commissions de tous les compositeurs (fichier dans le dossier
 *                                                temporaire du système, rien n'est écrit en base)
 *   npm run migrate                            -> applique la migration
 *   node scripts/test-entitlements.js apres   -> compare avec la photographie, puis vérifie la matrice
 *                                                (dans une transaction annulée : aucune donnée réelle modifiée)
 * SUPABASE_DB_URL dans .env, comme les autres scripts.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const SNAPSHOT = path.join(os.tmpdir(), 'layerpitch-entitlements-avant.json');
const mode = process.argv[2];
let passed = 0, failed = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (cond) passed++; else failed++; }

async function photo(c) {
  const { rows } = await c.query(`
    select cp.id, q.plan, q.max_ad_reels, q.max_share_links, q.max_embeds, q.max_audio_tracks, q.max_video_blocks,
           q.max_video_storage_gb, q.commission_rate::text as commission_rate,
           public.composer_real_tier(cp.id) as real_tier, public.composer_effective_tier(cp.id) as effective_tier
    from public.composer_profiles cp
    cross join lateral public.effective_plan_quotas(cp.id) q
    order by cp.id`);
  const prices = (await c.query(`select plan, price_eur_cents_monthly, price_eur_cents_yearly from public.plan_quotas order by plan`)).rows;
  return { composers: rows, prices };
}

(async () => {
  if (mode !== 'avant' && mode !== 'apres') {
    console.log('Usage : node scripts/test-entitlements.js avant | apres');
    process.exit(2);
  }
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    if (mode === 'avant') {
      const already = (await c.query(`select to_regclass('public.plan_entitlements') is not null as ok`)).rows[0].ok;
      if (already) { console.log('La migration est déjà appliquée : la photographie « avant » n\'a plus de sens.'); process.exit(1); }
      const p = await photo(c);
      fs.writeFileSync(SNAPSHOT, JSON.stringify(p, null, 1));
      console.log(`Photographie enregistrée : ${p.composers.length} compositeurs (${SNAPSHOT}).`);
      console.log('Tu peux appliquer la migration (npm run migrate), puis lancer : node scripts/test-entitlements.js apres');
      return;
    }

    // ---- après ----
    if (fs.existsSync(SNAPSHOT)) {
      const before = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
      const after = await photo(c);
      const byId = new Map(after.composers.map(r => [r.id, JSON.stringify(r)]));
      const diffs = before.composers.filter(r => byId.get(r.id) !== JSON.stringify(r));
      check(`mêmes quotas, paliers et commissions pour les ${before.composers.length} compositeurs`, diffs.length === 0);
      for (const d of diffs.slice(0, 5)) console.log('     avant', JSON.stringify(d), '\n     après', byId.get(d.id));
      check('mêmes prix d\'abonnement compositeur', JSON.stringify(before.prices) === JSON.stringify(after.prices));
    } else {
      console.log('(pas de photographie « avant » trouvée : comparaison sautée, seulement les contrôles de la matrice)');
    }

    await c.query('BEGIN');
    const n = async (sql, args) => (await c.query(sql, args)).rows;
    check('7 paliers (3 compositeur, 4 studio)', (await n(`select count(*)::int k from public.plans`))[0].k === 7);
    check('chaque palier a une ligne pour chaque fonction de son profil', (await n(`
      select count(*)::int k from public.plans p join public.features f on f.kind = p.kind
      where not exists (select 1 from public.plan_entitlements e where e.plan = p.code and e.feature = f.key and e.variant = '')`))[0].k === 0);
    check('tous les feux verts fermés au départ', (await n(`select count(*)::int k from public.feature_flags where released`))[0].k === 0);
    check('studios existants : palier SoloDev', (await n(`select count(*)::int k from public.studio_profiles where plan <> 'solodev'`))[0].k === 0);

    const admin = (await n(`select profile_id from public.admins limit 1`))[0];
    if (admin) {
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [admin.profile_id]);
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: admin.profile_id, role: 'authenticated' })]);
      const me = await n(`select * from public.my_entitlements()`);
      check('my_entitlements() pour ton compte admin : lignes compositeur, source admin', me.some(r => r.kind === 'composer') && me.every(r => r.source === 'admin' || r.source === 'preview'));
    }
    await c.query('ROLLBACK');
  } finally {
    await c.end();
  }
  console.log(`\n${passed} OK, ${failed} échec(s)`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
