// Vignette au choix (migration 20261119010000) : cover_file_id posée par update_project_asset, rendue par get_project_content,
// refusée si le fichier vient d'un autre Projet, et remise à nul si le fichier est supprimé. Base jetable PGlite.
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
  const one = async (sql, args) => (await q(sql, args))[0];
  await q(`insert into auth.users (id, email) values ($1, 'compo@x.test')`, [U(1)]);
  await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(1)]);
  await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro')`, [U(1)]);
  await q(`update public.feature_flags set released = true where key = 'projects'`);
  await db.query(`select set_config('test.uid', $1, false)`, [U(1)]);
  const p1 = (await one(`select public.create_project('Un') as id`)).id;
  const p2 = (await one(`select public.create_project('Deux') as id`)).id;
  const file = async (pid, name, status) => (await one(`insert into public.project_files (project_id, path, original_name, mime_type, size_bytes, status, uploaded_by)
    values ($1, $2, $2, 'image/png', 10, $3, $4) returning id`, [pid, 'projects/' + name, status || 'ready', U(1)])).id;
  const mine = await file(p1, 'a.png'), other = await file(p2, 'b.png'), pending = await file(p1, 'c.png', 'uploading');
  const note = (await one(`select public.add_project_asset($1, '{"kind":"note","title":"Idée","body":"x"}'::jsonb, true) as r`, [p1])).r.id;
  const content = async () => (await one(`select public.get_project_content($1) as c`, [p1])).c.assets.find(a => a.id === note);

  check('au départ : pas de vignette choisie', (await content()).coverFileId === null);
  await q(`select public.update_project_asset($1, jsonb_build_object('coverFileId', $2::text))`, [note, mine]);
  check('vignette posée et rendue par get_project_content', (await content()).coverFileId === mine);
  await q(`select public.update_project_asset($1, '{"title":"Autre titre"}'::jsonb)`, [note]);
  check('modifier seulement le titre ne touche pas la vignette', (await content()).coverFileId === mine && (await content()).title === 'Autre titre');
  let err = null; try { await q(`select public.update_project_asset($1, jsonb_build_object('coverFileId', $2::text))`, [note, other]); } catch (e) { err = e; }
  check('fichier d\'un autre Projet refusé', !!err && /introuvable/.test(err.message) && (await content()).coverFileId === mine);
  err = null; try { await q(`select public.update_project_asset($1, jsonb_build_object('coverFileId', $2::text))`, [note, pending]); } catch (e) { err = e; }
  check('fichier pas encore envoyé refusé', !!err);
  await q(`select public.update_project_asset($1, '{"coverFileId": null}'::jsonb)`, [note]);
  check('coverFileId nul retire la vignette', (await content()).coverFileId === null);
  await q(`select public.update_project_asset($1, jsonb_build_object('coverFileId', $2::text))`, [note, mine]);
  await q(`delete from public.project_files where id = $1`, [mine]);
  check('fichier supprimé : la vignette redevient automatique', (await content()).coverFileId === null);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
