// Tableau « Tutoriel » de l'admin (13/11, migration 20261113010000) : écriture sans compte (validation, limite de débit), lecture
// réservée aux admins, entonnoir par leçon, courbe par jour, filtre de période (base jetable PGlite) ; puis l'envoi côté navigateur.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; };

(async () => {
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); } catch (e) { console.log('FAIL PGlite absent : ' + e.message); process.exit(1); }
  const db = await freshDb();
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const fails = async (sql, re) => { try { await db.query(sql); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  for (const n of [1, 2]) { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), `u${n}@x.test`]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); }
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  const log = (sid, name, d) => q(`select public.log_tutorial_event($1, $2, $3::jsonb)`, [sid, name, JSON.stringify(d || {})]);

  // Visite A : ouvre « static » (4 étapes), va jusqu'à l'étape 3, abandonne. B : va au bout. C : ouvre et abandonne tout de suite.
  await as(0);
  await log('A', 'lesson_open', { lesson: 'static', steps: 4 }); await log('A', 'step', { lesson: 'static', step: 2, steps: 4 }); await log('A', 'step', { lesson: 'static', step: 3, steps: 4 }); await log('A', 'lesson_quit', { lesson: 'static', step: 3, steps: 4 });
  await log('B', 'lesson_open', { lesson: 'static', steps: 4 }); await log('B', 'step', { lesson: 'static', step: 2, steps: 4 }); await log('B', 'step', { lesson: 'static', step: 3, steps: 4 }); await log('B', 'step', { lesson: 'static', step: 4, steps: 4 }); await log('B', 'lesson_done', { lesson: 'static', steps: 4 });
  await log('C', 'lesson_open', { lesson: 'static', steps: 4 }); await log('C', 'lesson_quit', { lesson: 'static', step: 1, steps: 4 });
  await log('A', 'tour_open', { steps: 5 });
  await log('B', 'sample_use', { lesson: 'static', step: 2, files: 3 });
  // Entrées refusées en silence.
  await log('', 'lesson_open', { lesson: 'x' }); await log('D', 'pirate', { lesson: 'x' }); await log('D', 'lesson_open', 'pas un objet'); await log('D', 'lesson_open', {});
  check('entrées mal formées ou inconnues : ignorées sans erreur', (await val(`select count(*)::int from public.tutorial_events`)) === 13);
  check('aucune ligne pour un nom d’événement inconnu', (await val(`select count(*)::int from public.tutorial_events where event_name = 'pirate'`)) === 0);
  check('aucune ligne sans identifiant de visite', (await val(`select count(*)::int from public.tutorial_events where session_id = ''`)) === 0);
  check('table fermée à l’accès direct (RLS sans règle)', await fails(`set role anon; select * from public.tutorial_events`).then(async r => { await db.query('reset role'); return r || (await q(`set role anon`).then(() => q(`select * from public.tutorial_events`)).then(async rows => { await db.query('reset role'); return rows.length === 0; }).catch(async () => { await db.query('reset role'); return true; })); }));

  // Lecture : refusée hors admin.
  await as(2);
  check('lecture refusée à un non-admin', await fails(`select public.admin_tutorial_stats(30)`, /administrateurs/));
  await as(1);
  const st = await val(`select public.admin_tutorial_stats(30)`);
  const lesson = st.lessons.find(l => l.lesson === 'static');
  check('leçon « static » : 3 ouvertures, 1 terminée, 2 abandons', lesson && lesson.opened === 3 && lesson.done === 1 && lesson.quit === 2);
  check('entonnoir : visites ayant atteint les étapes 1 à 4 = 3, 2, 2, 1', lesson && JSON.stringify(lesson.reached) === '[3,2,2,1]');
  check('visite guidée comptée à part', st.lessons.some(l => l.lesson === '(visite guidée)' && l.opened === 1));
  check('morceaux d’exemple comptés à part, pas dans les leçons', st.samples.length === 1 && st.samples[0].uses === 1);
  const today = st.series[st.series.length - 1];
  check('courbe : aujourd’hui = 3 visites ayant ouvert (A, B, C), 1 fin, 2 abandons', today && today.opened === 3 && today.done === 1 && today.quit === 2);

  // Filtre de période : un événement vieux de 40 jours sort de « 30 jours », reste dans « tout ».
  await q(`update public.tutorial_events set created_at = now() - interval '40 days' where session_id = 'C'`);
  const s30 = await val(`select public.admin_tutorial_stats(30)`), sAll = await val(`select public.admin_tutorial_stats(0)`);
  check('période 30 jours : la visite de 40 jours est exclue', s30.lessons.find(l => l.lesson === 'static').opened === 2);
  check('période « tout » : elle est comprise', sAll.lessons.find(l => l.lesson === 'static').opened === 3 && sAll.series.length >= 41);

  // Limite de débit : au-delà de 60 événements par minute et par visite (repli sans IP), le reste est ignoré.
  await as(0);
  for (let i = 0; i < 70; i++) await log('SPAM', 'step', { lesson: 'spam', step: 1 });
  check('limite de débit : 60 événements gardés sur 70', (await val(`select count(*)::int from public.tutorial_events where session_id = 'SPAM'`)) === 60);

  // Côté navigateur : l'événement part vers la base même sans Umami, avec un identifiant de visite stable.
  const sent = [];
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://layerpitch.com/layerpitch-backstage.html?tuto&lesson=static', runScripts: 'outside-only' });
  dom.window.fetch = (url, opts) => { sent.push([url, opts]); return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }); };
  dom.window.eval(fs.readFileSync(path.join(__dirname, 'layerpitch-tuto.js'), 'utf8'));
  dom.window.LayerPitchTuto.track('step', { lesson: 'static', step: 2, steps: 4 });
  dom.window.LayerPitchTuto.track('lesson_done', { lesson: 'static' });
  const rpc = sent.filter(([u]) => /rpc\/log_tutorial_event$/.test(u)).map(([, o]) => JSON.parse(o.body));
  check('navigateur : deux événements envoyés à la base, sans attendre Umami', rpc.length === 2 && rpc[0].p_event_name === 'step' && rpc[0].p_detail.step === 2);
  check('navigateur : même identifiant de visite, sans compte ni e-mail', rpc[0].p_session_id === rpc[1].p_session_id && /^v[a-z0-9]+$/.test(rpc[0].p_session_id));
  check('navigateur : clé publique seulement', sent.every(([, o]) => !o || !o.headers || !/service_role/.test(JSON.stringify(o.headers))));
  const plain = [];
  const dom2 = new JSDOM('<!doctype html><body></body>', { url: 'https://layerpitch.com/layerpitch-backstage.html', runScripts: 'outside-only' });
  dom2.window.fetch = (u, o) => { plain.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }); };
  dom2.window.eval(fs.readFileSync(path.join(__dirname, 'layerpitch-tuto.js'), 'utf8'));
  dom2.window.LayerPitchTuto.track('step', { lesson: 'x' });
  check('hors mode tutoriel : rien n’est envoyé', plain.length === 0);
  process.exit(failures ? 1 : 0);
})();
