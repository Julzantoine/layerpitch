// Étape 2b du chantier profils et permissions (migration 20260928020000) : les verrous serveur passent par la matrice.
// Adresses personnalisées (custom_address), versions vidéo (versioning = 'saved'), enregistrement d'un montage
// (test_in_game = 'saved'). Base jetable PGlite. Prérequis : npm install.
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [U(n)]);
  const ok = async (sql, args) => { try { await db.query(sql, args); return true; } catch (e) { return false; } };
  const cid = {};
  for (const [n, plan, admin] of [[1, 'free', true], [2, 'free', false], [3, 'starter', false], [4, 'pro', false]]) {
    await db.query(`insert into auth.users (id) values ($1)`, [U(n)]);
    await db.query(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]);
    cid[n] = (await db.query(`insert into public.composer_profiles (profile_id, plan) values ($1, $2) returning id`, [U(n), plan])).rows[0].id;
    if (admin) await db.query(`insert into public.admins (profile_id) values ($1)`, [U(n)]);
    await db.query(`insert into public.packs (id, owner_id, title) values ($1, $2, 'p')`, ['pk' + n, cid[n]]);
  }
  const handle = (n, h) => { return as(n).then(() => ok(`select public.set_my_handle($1)`, [h])); };
  const capture = (n, id) => as(n).then(() => ok(`select public.save_video_capture($1, $2, 't', 'v.mp4', '[]'::jsonb)`, [id, 'pk' + n]));
  const version = (n, capId, id) => as(n).then(() => ok(`select public.save_video_capture_version($1, $2, 'v', '{}'::jsonb)`, [id, capId]));

  // Bêta active, feux verts fermés
  check('bêta : non-admin ne choisit pas son adresse (feu vert fermé)', !(await handle(2, 'rookie-un')));
  check('bêta : admin choisit son adresse', await handle(1, 'admin-un'));
  check('bêta : tout le monde est Boss → un compositeur « free » enregistre un montage', await capture(2, 'cap2'));
  check('bêta : versions vidéo refusées au non-admin (feu vert fermé)', !(await version(2, 'cap2', 'v2')));
  check('bêta : admin enregistre un montage et une version', (await capture(1, 'cap1')) && (await version(1, 'cap1', 'v1')));

  // Après la bêta, feux verts donnés : chaque palier reçoit la matrice
  await db.query(`update public.beta_program set full_access = false`);
  await db.query(`update public.feature_flags set released = true where key in ('custom_address', 'versioning')`);
  check('Rookie : pas d\'adresse personnalisée', !(await handle(2, 'rookie-deux')));
  check('Warrior : adresse personnalisée', await handle(3, 'warrior-un'));
  check('Rookie : montage non enregistrable', !(await capture(2, 'cap2b')));
  check('Warrior : montage non enregistrable (modifiable seulement, pendant la session)', !(await capture(3, 'cap3')));
  check('Boss : montage enregistré', await capture(4, 'cap4'));
  check('Boss : version vidéo enregistrée', await version(4, 'cap4', 'v4'));
  await db.query(`insert into public.video_captures (id, owner_id, pack_id, title, video_filename) values ('cap3x', $1, 'pk3', 't', 'v.mp4')`, [cid[3]]);
  check('Warrior : versions vidéo non enregistrées côté serveur (session seulement)', !(await version(3, 'cap3x', 'v3')));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
