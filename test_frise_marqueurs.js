// Marqueurs de la frise de l'atelier vidéo (05/11, migration 20261105010000) : repères nommés posés au double-clic sur la règle ou au
// clic droit dans la frise, enregistrés avec le montage dans leur propre colonne (jamais dans events : ils ne jouent rien et ne sortent
// pas dans la vidéo). Base jetable PGlite + lecture des sources.
const fs = require('fs');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const U = n => '00000000-0000-0000-0000-00000000000' + n;
  await db.query(`insert into auth.users (id) values ($1)`, [U(1)]);
  await db.query(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(1)]);
  const owner = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'danny') returning id`, [U(1)]))[0].id;
  await db.query(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await db.query(`insert into public.packs (id, owner_id, title) values ('p1', $1, 'Pack')`, [owner]);
  await db.query(`select set_config('test.uid', $1, false)`, [U(1)]);

  const markers = [{ id: 'm1', t: 4.5, label: 'Entrée du boss' }];
  await q(`select public.save_video_capture(p_id => 'cap1', p_pack_id => 'p1', p_title => 'Prise', p_video_filename => 'jeu.mp4', p_events => '[]'::jsonb, p_markers => $1::jsonb)`, [JSON.stringify(markers)]);
  const get = async () => (await q(`select public.get_video_capture('cap1') as r`))[0].r;
  let cap = await get();
  check('les marqueurs enregistrés reviennent au chargement', cap.markers.length === 1 && cap.markers[0].id === 'm1' && cap.markers[0].t === 4.5 && cap.markers[0].label === 'Entrée du boss');

  // Ancien appel (8 paramètres, sans marqueurs) : toujours valable, et ne les efface pas.
  await q(`select public.save_video_capture('cap1', 'p1', 'Prise 2', 'jeu.mp4', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, false)`);
  cap = await get();
  check('un enregistrement sans marqueurs garde ceux déjà là', cap.title === 'Prise 2' && cap.markers.length === 1);

  await q(`select public.save_video_capture(p_id => 'cap1', p_pack_id => 'p1', p_title => 'Prise 3', p_video_filename => 'jeu.mp4', p_events => '[]'::jsonb, p_markers => '[]'::jsonb)`);
  cap = await get();
  check('liste vide = tous les marqueurs retirés', Array.isArray(cap.markers) && cap.markers.length === 0);

  await q(`select public.save_video_capture('cap2', 'p1', 'Neuve', 'jeu.mp4', '[]'::jsonb)`);
  check('montage neuf sans marqueurs : liste vide', (await q(`select markers from public.video_captures where id = 'cap2'`))[0].markers.length === 0);

  const frise = fs.readFileSync('src/atelier/15-frise-edition.js', 'utf8');
  const panneau = fs.readFileSync('src/atelier/18-panneau-de-capture.js', 'utf8');
  const envois = fs.readFileSync('src/atelier/16-sauvegarde-et-envois.js', 'utf8');
  const i18n = fs.readFileSync('layerpitch-i18n.js', 'utf8');
  check('frise : double-clic (hors pistes à blocs) et clic droit posent un marqueur', /addEventListener\('dblclick'[\s\S]{0,300}addMarker\(/.test(frise) && /addEventListener\('contextmenu'[\s\S]{0,600}addMarker\(/.test(frise));
  check('frise : double-clic, clic droit ou Suppr sur un marqueur l\'efface', /flagEl\.addEventListener\('dblclick'[^\n]*removeMarker\(m\)/.test(frise) && /if \(flag\)[^\n]*removeMarker\(m\)/.test(frise) && /ev\.key !== 'Delete' && ev\.key !== 'Backspace'/.test(frise));
  check('frise : marqueurs à part des événements (pas de push dans events)', !/events\.push\(\{[^}]*marker/i.test(frise));
  check('panneau : marqueurs envoyés à la sauvegarde et repris au chargement', /saveVideoCapture\([^)]*timelineMarkers[^)]*\)/.test(panneau) && /timelineMarkers = Array\.isArray\(capture\.markers\)/.test(panneau) && /p_markers: markers/.test(envois));
  check('textes des marqueurs en FR et EN', ['captureMarkerDefault', 'captureMarkerLabel', 'captureMarkerNameTitle', 'captureMarkerDelete', 'captureMarkerFlagHint'].every(k => (i18n.match(new RegExp('\\b' + k + ':', 'g')) || []).length === 2));

  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
