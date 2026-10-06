// Tableau de bord analytique : noms lisibles (1er/10). 1) Base (PGlite) : le détail d'une visite remonte aussi les choix de
// boucle, d'option de bascule et de volume (migration 20260930020000), palier Pro seulement. 2) Le vrai Backstage : le
// morceau est montré par son titre (pas son identifiant interne) et chaque interaction dit ce que le visiteur a fait.
const { loadBackstage } = require('./scripts/test-harness.js');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; }

(async () => {
  // ---- Base ----
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); } catch (e) { console.log('FAIL PGlite absent : ' + e.message); process.exit(1); }
  const db = await freshDb();
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  await db.query(`update public.beta_program set full_access = false`);
  await db.query(`insert into auth.users (id, email) values ($1, 'a@x.test')`, [U(1)]);
  await db.query(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(1)]);
  await db.query(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro')`, [U(1)]);
  const cp = (await db.query(`select id from public.composer_profiles where profile_id = $1`, [U(1)])).rows[0].id;
  const ev = (name, detail) => db.query(`insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, detail, device) values ($1, 'adreel', 'main', 's1', $2, $3::jsonb, 'desktop')`, [cp, name, JSON.stringify(detail)]);
  await ev('track_play', { trackId: 'tA' });
  await ev('embr_loop_select', { trackId: 'tA', loopId: 'l2' });
  await ev('seq_branch_select', { trackId: 'tA', targetId: 'slot2' });
  await ev('voice_volume_change', { trackId: 'tA', voice: 'layer-1', value: 0.5 });
  await ev('intensity_change', { trackId: 'tA', level: 2 });
  await ev('go_to_end_click', { trackId: 'tA' });
  await db.query(`select set_config('test.uid', $1, false)`, [U(1)]);
  const r = (await db.query(`select public.get_my_analytics() as a`)).rows[0].a;
  const names = ((r.sessions || [])[0] || {}).interactions ? r.sessions[0].interactions.map(i => i.name) : [];
  check('détail d\'une visite : choix de boucle, d\'option et de volume remontent', ['embr_loop_select', 'seq_branch_select', 'voice_volume_change', 'intensity_change'].every(n => names.includes(n)));
  check('détail d\'une visite : les clics sans intérêt (aller à la fin) restent écartés', !names.includes('go_to_end_click'));
  check('détail : l\'identifiant de la boucle est transmis (pour retrouver son nom)', r.sessions[0].interactions.find(i => i.name === 'embr_loop_select').detail.loopId === 'l2');

  // ---- Backstage ----
  const dom = await loadBackstage();
  const w = dom.window;
  w.eval(`library = [{ id: 'tA', title: 'Thème du boss', layers: [{ label: 'Calme' }, { label: 'Tension' }, { label: 'Combat' }, ], loops: [{ id: 'l1', label: 'Rue' }, { id: 'l2', label: 'Toits' }],
    segmentSlots: [{ id: 'slot1', label: 'Intro' }, { id: 'slot2', label: 'Poursuite' }], fxTriggers: [] }]`);
  const L = i => w.eval('analyticsInteractionLabel')(i);
  check('morceau montré par son titre, pas par son identifiant', w.eval("analyticsTrackName('tA')") === 'Thème du boss' && w.eval("analyticsTrackName('zzz')") === 'zzz');
  check('intensité : niveau et nom de la couche', L({ name: 'intensity_change', detail: { trackId: 'tA', level: 1 } }) === 'Intensité 2 (Tension) — Thème du boss');
  check('boucle : nom de la boucle choisie', L({ name: 'embr_loop_select', detail: { trackId: 'tA', loopId: 'l2' } }) === 'Boucle « Toits » choisie — Thème du boss');
  check('option de bascule : nom de l\'emplacement', L({ name: 'seq_branch_select', detail: { trackId: 'tA', targetId: 'slot2' } }) === 'Option « Poursuite » choisie — Thème du boss');
  check('solo : couche et état', L({ name: 'voice_solo_toggle', detail: { trackId: 'tA', voice: 'layer-2', active: true } }) === 'Solo de « Combat » activé — Thème du boss');
  check('volume : couche et valeur', L({ name: 'voice_volume_change', detail: { trackId: 'tA', voice: 'layer-0', value: 0.75 } }) === 'Volume de « Calme » réglé à 75 % — Thème du boss');
  check('morceau supprimé depuis : repli sur l\'identifiant, sans planter', /zzz/.test(L({ name: 'embr_loop_select', detail: { trackId: 'zzz', loopId: 'x' } })));
  check('évènement inconnu : son nom, comme avant', L({ name: 'autre_chose', detail: {} }) === 'autre_chose');
  const card = w.eval('renderAnalyticsSessionCard')({ type: 'adreel', entityId: 'main', openedAt: '2026-09-25T17:24:59Z', device: 'desktop', tracks: [{ trackId: 'tA', reachedEnd: true }], interactions: [{ name: 'intensity_change', detail: { trackId: 'tA', level: 0 } }] });
  w.eval("currentEffectivePlan = 'pro'");
  const card2 = w.eval('renderAnalyticsSessionCard')({ type: 'adreel', entityId: 'main', openedAt: '2026-09-25T17:24:59Z', device: 'desktop', tracks: [{ trackId: 'tA', reachedEnd: true }], interactions: [{ name: 'intensity_change', detail: { trackId: 'tA', level: 0 } }] });
  check('carte de visite (Pro) : titre du morceau et interaction lisible, plus d\'identifiant', /Thème du boss — /.test(card2) && /Intensité 1 \(Calme\)/.test(card2) && !/>tA —/.test(card2));

  console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
