// Centre de notifications commun (migration 20260928190000) : dernière visite par Projet, « quoi de neuf pour moi »
// (messages et modifications des AUTRES depuis ma dernière visite, notes qui me sont adressées), jamais les Projets dont
// je ne suis pas membre ni mes propres actions. Base jetable PGlite.
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
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [U(n)]);
  for (const n of [1, 2, 3]) { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), `u${n}@x.test`]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro')`, [U(n)]); }
  await q(`update public.feature_flags set released = true where key = 'projects'`);
  await as(1); const p = await val(`select public.create_project('OST')`);
  const inv = await val(`select public.invite_project_member($1, 'u2@x.test')`, [p]);
  await as(2); await q(`select public.respond_project_invitation($1, true)`, [inv]);
  await q(`select public.mark_project_seen($1)`, [p]);
  await as(1); await q(`select public.mark_project_seen($1)`, [p]);
  check('rien de neuf juste après ma visite', (await val(`select public.my_project_updates()`)).length === 0);
  await q(`select public.post_project_message($1, 'Je poste mes propres messages')`, [p]);
  check('mes propres messages ne me sont pas signalés', (await val(`select public.my_project_updates()`)).length === 0);
  await as(2);
  await q(`select public.post_project_message($1, 'Tu as vu la vignette ?')`, [p]);
  await q(`select public.add_project_asset($1, '{"kind":"link","url":"https://youtu.be/abc","title":"Trailer"}'::jsonb, true)`, [p]);
  await q(`select public.add_project_annotation($1, 'project', null, null, 'Pour toi', $2)`, [p, U(1)]);
  await as(1);
  const up = await val(`select public.my_project_updates()`);
  check('un Projet avec du neuf', up.length === 1 && up[0].title === 'OST');
  check('1 nouveau message, avec le dernier (auteur, extrait)', up[0].newMessages === 1 && up[0].lastMessage.authorEmail === 'u2@x.test' && up[0].lastMessage.excerpt === 'Tu as vu la vignette ?');
  check('modifications des autres, les plus récentes d\'abord', up[0].changes === 2 && up[0].lastChanges[0].kind === 'annotation_added' && up[0].lastChanges[1].payload.title === 'Trailer');
  check('1 note qui m\'est adressée', up[0].addressedNotes === 1);
  await as(3);
  check('un non-membre ne voit rien de ce Projet', (await val(`select public.my_project_updates()`)).length === 0);
  await as(1); await q(`select public.mark_project_seen($1)`, [p]); await q(`select public.mark_project_notifications_read($1)`, [p]);
  check('après ma visite : plus rien', (await val(`select public.my_project_updates()`)).length === 0);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
