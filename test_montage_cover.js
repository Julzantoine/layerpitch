// Vignette d'un montage vidéo (19/11, migration 20261119020000) : posée par son propriétaire, lue publiquement avec le montage,
// refusée si l'adresse n'est pas une image du média ou si le montage n'est pas à soi. Base jetable PGlite + garde-fous du code.
const fs = require('fs');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  // Garde-fous côté code : le lecteur pose l'affiche, l'atelier envoie sous montage-, le serveur de signatures accepte ce dossier pour un studio.
  const lib = fs.readFileSync('layerpitch-video-versions.js', 'utf8');
  check('le lecteur à versions pose la vignette comme affiche (poster)', /video\.poster = montage\.coverUrl/.test(lib));
  const atelier = fs.readFileSync('atelier.html', 'utf8');
  check('atelier : boutons « image affichée », importer, retirer', /atelierCoverFrame/.test(atelier) && /atelierCoverImport/.test(atelier) && /atelierCoverRemove/.test(atelier) && /uploadMontageCover/.test(atelier));
  const edge = fs.readFileSync('supabase/functions/create-media-signed-url/index.ts', 'utf8');
  check('envoi d\'une vignette de montage de studio accepté sous images/<studio>/montage-', /montage-\[\^\/\]\+/.test(edge) && /account_studio_id/.test(edge));

  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('PGlite indisponible, partie base ignorée : ' + e.message); if (failures) process.exit(1); console.log('\nALL CHECKS PASSED'); return; }
  const db = await freshDb();
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const U = n => '00000000-0000-0000-0000-00000000000' + n;
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [U(1), U(2)]);
  await db.query(`insert into public.profiles (id) values ($1), ($2) on conflict do nothing`, [U(1), U(2)]);
  const owner = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'danny') returning id`, [U(1)]))[0].id;
  await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'autre')`, [U(2)]);
  await db.query(`insert into public.packs (id, owner_id, title) values ('p1', $1, 'Pack')`, [owner]);
  await db.query(`insert into public.video_captures (id, owner_id, pack_id, title) values ('cap1', $1, 'p1', 'Traversée')`, [owner]);
  const url = `https://media.layerpitch.com/images/${owner}/montage-cap1-abc.jpg`;

  await as(1);
  check('au départ : pas de vignette', (await q(`select public.get_video_capture_cover('cap1') as c`))[0].c === null);
  await db.query(`select public.set_video_capture_cover('cap1', $1)`, [url]);
  check('vignette posée, relue par son propriétaire', (await q(`select public.get_video_capture_cover('cap1') as c`))[0].c === url);
  let err = null; try { await db.query(`select public.set_video_capture_cover('cap1', 'https://exemple.com/x.jpg')`); } catch (e) { err = e; }
  check('adresse hors du dossier d\'images du média refusée', !!err && (await q(`select public.get_video_capture_cover('cap1') as c`))[0].c === url);
  err = null; try { await db.query(`select public.set_video_capture_cover('cap1', 'https://media.layerpitch.com/images/x/montage-a.svg')`); } catch (e) { err = e; }
  check('type d\'image non prévu (svg) refusé', !!err);

  await as(2);
  err = null; try { await db.query(`select public.set_video_capture_cover('cap1', $1)`, [url.replace('abc', 'zzz')]); } catch (e) { err = e; }
  check('le montage d\'un autre compte ne peut pas recevoir de vignette', !!err);
  check('ni la lire par la lecture privée', (await q(`select public.get_video_capture_cover('cap1') as c`))[0].c === null);

  await as(null);
  await db.exec('set role anon');
  const m = (await q(`select public.get_public_video_montage('cap1') as m`))[0].m;
  await db.exec('reset role');
  check('lecture publique : coverUrl rendu avec le montage (même sans version)', !!m && m.coverUrl === url);

  await as(1);
  await db.query(`select public.set_video_capture_cover('cap1', null)`);
  check('retrait : la vignette redevient vide', (await q(`select public.get_video_capture_cover('cap1') as c`))[0].c === null);

  if (failures) { console.log('\n' + failures + ' échec(s)'); process.exit(1); }
  console.log('\nALL CHECKS PASSED');
})().catch(e => { console.error('FAIL - ' + e.message); process.exit(1); });
