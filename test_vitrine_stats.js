// Statistiques des vitrines (migration 20260928210000, décision Q10) : écriture sans compte, visites des membres exclues,
// niveau selon le palier du propriétaire (studio SoloDev aperçu / Indie basique / AA avancé), première ouverture d'une
// vitrine éditeur signalée dans l'activité du Projet. Base jetable PGlite.
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  for (const n of [1, 2]) { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), `u${n}@x.test`]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); }
  await db.query(`update public.beta_program set full_access = false`);
  await q(`update public.feature_flags set released = true where key in ('projects', 'studio_space')`);
  await as(1);
  const sid = await val(`select public.ensure_studio_profile()`);
  await q(`update public.studio_profiles set plan = 'indie' where id = $1`, [sid]);
  const p = await val(`select public.create_project('Jeu', '', true)`);
  const pub = await val(`select public.save_project_vitrine($1, '{"title":"OST","published":true}'::jsonb)`, [p]);
  const ed = await val(`select public.save_project_vitrine($1, '{"title":"Pitch","audience":"publisher"}'::jsonb)`, [p]);
  const log = (vid, sess, name, detail) => q(`select public.log_vitrine_event($1, $2, $3, $4::jsonb, 'desktop')`, [vid, sess, name, JSON.stringify(detail || {})]);
  await log(pub.id, 's-membre', 'page_open');
  check('visite d\'un membre du Projet : non comptée', (await val(`select count(*)::int from public.vitrine_events`)) === 0);
  await as(0);
  await log(pub.id, 's1', 'page_open'); await log(pub.id, 's1', 'track_play', { trackId: 't1' }); await log(pub.id, 's2', 'page_open'); await log(pub.id, 's2', 'link_click', { label: 'Steam' });
  await log(pub.id, 's3', '<script>', {});
  check('nom d\'événement invalide : ignoré', (await val(`select count(*)::int from public.vitrine_events`)) === 4);
  const actBefore = await val(`select count(*)::int from public.project_activity where kind = 'vitrine_first_open'`);
  await log(ed.id, 'e1', 'page_open'); await log(ed.id, 'e2', 'page_open');
  check('première ouverture d\'une vitrine éditeur : une seule ligne d\'activité (pas une par ouverture)', (await val(`select count(*)::int from public.project_activity where kind = 'vitrine_first_open'`)) === actBefore + 1);
  await as(1);
  let st = await val(`select public.get_vitrine_stats($1)`, [pub.id]);
  check('studio Indie : statistiques basiques (ouvertures, visites), rétention 30 jours', st.level === 'basic' && st.opens === 2 && st.visits === 2 && st.retentionDays === 30 && !('events' in st));
  await q(`update public.studio_profiles set plan = 'aa' where id = $1`, [sid]);
  st = await val(`select public.get_vitrine_stats($1)`, [pub.id]);
  check('studio AA : statistiques avancées (actions, liens cliqués, appareils)', st.level === 'advanced' && st.events.some(e => e.name === 'track_play') && st.links[0].label === 'Steam' && st.devices.desktop === 2);
  await q(`update public.studio_profiles set plan = 'solodev' where id = $1`, [sid]);
  check('studio SoloDev : aperçu (la page floute)', (await val(`select public.get_vitrine_stats($1)`, [pub.id])).level === 'teaser');
  await as(2);
  let refused = false; try { await q(`select public.get_vitrine_stats($1)`, [pub.id]); } catch (e) { refused = /introuvable/.test(e.message); }
  check('un non-membre ne lit pas les statistiques', refused);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
