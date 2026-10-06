// Projet de démonstration public (migration 20260929010000) : marque « démo » posée seulement par un administrateur ou le
// compte de démonstration ; lecture sans compte du seul Projet marqué, sans adresse e-mail ni note privée ni lien secret ;
// fichiers du Projet de démo lisibles sans compte, ceux des autres Projets non. Base jetable PGlite (qui ne rejoue pas les
// droits sur les tables : la fermeture des tables aux visiteurs relève des règles RLS existantes, non modifiées ici).
const fs = require('fs');
const path = require('path');
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb({ upTo: '20260928230000' });
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const fails = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  const emails = { 1: 'admin@x.test', 2: 'contact@layerpitch.com', 3: 'autre@x.test' };
  for (const n of [1, 2, 3]) { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), emails[n]]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); }
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro'), ($2, 'pro')`, [U(2), U(3)]);
  await q(`update public.feature_flags set released = true where key in ('projects', 'video_upload')`);

  await as(2); const demo = await val(`select public.create_project('Hollow Manor')`);
  const add = async (payload) => (await val(`select public.add_project_asset($1, $2::jsonb, true)`, [demo, JSON.stringify(payload)])).id;
  const note = await add({ kind: 'note', title: 'Direction sonore', body: 'Silences longs' });
  const f = await val(`select public.reserve_project_file($1, 'couloir.png', 1000)`, [demo]); await q(`select public.complete_project_file($1)`, [f.fileId]);
  await add({ kind: 'image', fileId: f.fileId, title: 'Couloir' });
  await val(`select public.post_project_message($1, 'Bienvenue')`, [demo]);
  await val(`select public.add_project_annotation($1, 'asset', $2, null, 'Note publique', null, null, false)`, [demo, note]);
  await val(`select public.add_project_annotation($1, 'asset', $2, null, 'Note privée', null, null, true)`, [demo, note]);

  await as(3); const other = await val(`select public.create_project('Projet privé')`);
  const fo = await val(`select public.reserve_project_file($1, 'secret.png', 1000)`, [other]); await q(`select public.complete_project_file($1)`, [fo.fileId]);
  await val(`select public.add_project_asset($1, $2::jsonb)`, [other, JSON.stringify({ kind: 'image', fileId: fo.fileId, title: 'Secret' })]);

  await db.exec(fs.readFileSync(path.join(__dirname, 'supabase', 'migrations', '20260929010000_public_demo_project.sql'), 'utf8'));

  // Marque
  await as(3);
  check('un compte ordinaire ne peut pas marquer un Projet comme démo', await fails(`select public.set_public_demo($1, true)`, [other], /Réservé/));
  check('le compte de démo ne peut marquer que son propre Projet', await fails(`select public.set_public_demo($1, true)`, [demo], /Réservé/));
  await as(2); await q(`select public.set_public_demo($1, true)`, [demo]);
  check('le compte de démonstration marque son Projet', (await val(`select public_demo from public.projects where id = $1`, [demo])) === true);
  await as(2);
  check('le compte de démo ne peut pas marquer le Projet d\'un autre', await fails(`select public.set_public_demo($1, true)`, [other], /Réservé|Accès/));
  await as(1); await q(`select public.set_public_demo($1, true)`, [other]);
  check('un administrateur marque un autre Projet : un seul à la fois', (await val(`select count(*) from public.projects where public_demo`)) == 1 && (await val(`select public_demo from public.projects where id = $1`, [demo])) === false);
  await q(`select public.set_public_demo($1, true)`, [demo]);

  // Lecture sans compte
  await as(0); await db.query(`set role anon`);
  const d = await val(`select public.get_public_demo()`);
  const denied = await fails(`select public.set_public_demo($1, false)`, [demo]);
  await db.query(`reset role`);
  check('lecture sans compte : le Projet de démo, ses objets, ses messages', d && d.project.title === 'Hollow Manor' && d.content.assets.length === 2 && d.messages.length === 1);
  check('aucune adresse e-mail dans la réponse', !JSON.stringify(d).includes('@'));
  check('notes : seulement les publiques', d.annotations.length === 1 && d.annotations[0].body === 'Note publique');
  check('le Projet privé d\'un autre n\'apparaît pas', !JSON.stringify(d).includes('Secret') && !JSON.stringify(d).includes('Projet privé'));
  check('sans compte : impossible de marquer ou démarquer', denied);

  // Fichiers
  await db.query(`reset role`);
  check('fichier du Projet de démo : lisible sans compte', !!(await val(`select public.project_file_is_public($1)`, [f.fileId])));
  check('fichier d\'un autre Projet : toujours privé', (await val(`select public.project_file_is_public($1)`, [fo.fileId])) === null);
  await as(2); await q(`select public.set_public_demo($1, false)`, [demo]);
  await db.query(`set role anon`);
  check('démarqué : plus rien n\'est lisible', (await val(`select public.get_public_demo()`)) === null);
  await db.query(`reset role`);
  check('démarqué : ses fichiers redeviennent privés', (await val(`select public.project_file_is_public($1)`, [f.fileId])) === null);


  // Interrupteur de la page Projet : état de la démo, réservé aux administrateurs et au compte de démo
  await as(1);
  await q(`select public.set_public_demo($1, true)`, [demo]);
  const st1 = await val(`select public.get_public_demo_status()`);
  check('administrateur : eligible, avec le numéro du Projet-démo', st1.eligible === true && st1.projectId === demo);
  await as(2);
  check('compte de démo : eligible', (await val(`select public.get_public_demo_status()`)).eligible === true);
  await as(3);
  const st3 = await val(`select public.get_public_demo_status()`);
  check('compte ordinaire : non eligible, aucun numéro de Projet rendu', st3.eligible === false && st3.projectId === undefined);
  await as(1); await q(`select public.set_public_demo($1, false)`, [demo]);
  const st4 = await val(`select public.get_public_demo_status()`);
  check('aucune démo : eligible mais projectId null', st4.eligible === true && st4.projectId === null);

  console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
