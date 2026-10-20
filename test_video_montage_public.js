// Versions vidéo publiques (21/10, migration 20261021020000) : l'export d'un montage et de ses versions retient vidéo + étiquettes ;
// get_public_video_montage() les rend à tout le monde (sans compte), musique d'origine d'abord. Base jetable PGlite.
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('PGlite indisponible, test ignoré : ' + e.message); return; }
  const db = await freshDb();
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const U = n => '00000000-0000-0000-0000-00000000000' + n;
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [U(1), U(2)]);
  await db.query(`insert into public.profiles (id) values ($1), ($2) on conflict do nothing`, [U(1), U(2)]);
  const owner = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'danny') returning id`, [U(1)]))[0].id;
  const other = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'autre') returning id`, [U(2)]))[0].id;
  await db.query(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await db.query(`insert into public.packs (id, owner_id, title) values ('p1', $1, 'Pack')`, [owner]);
  await db.query(`insert into public.video_captures (id, owner_id, pack_id, title) values ('cap1', $1, 'p1', 'Traversée')`, [owner]);
  await db.query(`insert into public.composer_videos (id, owner_id, kind, title, base, file) values ('v1', $1, 'capture_export', 'M1', 'https://media.example/video/v1/', 'export.mp4'), ('v2', $1, 'capture_export', 'M2', 'https://media.example/video/v2/', 'export.mp4')`, [owner]);
  await db.query(`insert into public.video_capture_versions (id, capture_id, owner_id, title) values ('ver2', 'cap1', $1, 'Musique 2')`, [owner]);

  const cues1 = [{ start: 0, end: 4, text: 'Couche 1', kind: 'state', row: 0 }];
  const cues2 = [{ start: 0, end: 4, text: 'Couche 2', kind: 'state', row: 0 }, { start: 2, end: 3, text: 'LANTERNE', kind: 'stinger', row: 0 }];
  await as(2);
  let refused = false;
  try { await db.query(`select public.set_video_capture_export('cap1', 'v1', $1::jsonb)`, [JSON.stringify(cues1)]); } catch (e) { refused = true; }
  const still = (await q(`select last_export_video_id from public.video_captures where id = 'cap1'`))[0].last_export_video_id;
  check('un autre compte ne peut pas relier l’export du montage', refused || still === null);
  await as(1);
  await db.query(`select public.set_video_capture_export('cap1', 'v1', $1::jsonb)`, [JSON.stringify(cues1)]);
  let versionErr = null;
  try { await db.query(`select public.set_video_capture_version_export('ver2', 'v2', $1::jsonb)`, [JSON.stringify(cues2)]); } catch (e) { versionErr = e.message; }
  check('la version retient sa vidéo et ses étiquettes (palier versioning « saved » : admin)', versionErr === null && (await q(`select last_export_video_id from public.video_capture_versions where id = 'ver2'`))[0].last_export_video_id === 'v2');

  await as(null);
  await db.exec('set role anon'); // visiteur sans compte : droits réels du rôle anon
  const m = (await q(`select public.get_public_video_montage('cap1') as m`))[0].m;
  check('lecture publique : deux versions, la musique d’origine d’abord', m && m.versions.length === 2 && m.versions[0].key === 'original' && m.versions[1].key === 'ver2');
  check('lecture publique : adresse de la vidéo et étiquettes de chaque version', m.versions[0].url === 'https://media.example/video/v1/export.mp4' && m.versions[1].cues.length === 2 && m.versions[1].title === 'Musique 2');
  check('montage inconnu : rien', (await q(`select public.get_public_video_montage('nope') as m`))[0].m === null);
  let anonWrite = false;
  try { await db.query(`select public.set_video_capture_export('cap1', null, null)`); anonWrite = true; } catch (e) { /* refusé : attendu */ }
  check('sans compte : aucune écriture possible', !anonWrite);
  await db.exec('reset role');

  // Retouche + réexport : la version pointe vers la nouvelle vidéo, tous les endroits suivent.
  await as(1);
  await db.query(`insert into public.composer_videos (id, owner_id, kind, title, base, file) values ('v3', $1, 'capture_export', 'M2 bis', 'https://media.example/video/v3/', 'export.mp4')`, [owner]);
  await db.query(`select public.set_video_capture_version_export('ver2', 'v3', '[]'::jsonb)`);
  const m2 = (await q(`select public.get_public_video_montage('cap1') as m`))[0].m;
  check('après réexport : la version publique montre la nouvelle vidéo', m2.versions[1].url === 'https://media.example/video/v3/export.mp4');
  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
