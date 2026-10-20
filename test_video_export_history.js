// Historique des exports vidéo (21/10, migration 20261021030000) : 3 derniers exports gardés par montage / version, retour en arrière,
// renoncer à garder l'ancienne, nettoyage complet ; une vidéo encore utilisée ailleurs n'est jamais effacée. Base jetable PGlite.
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
  await db.query(`insert into public.video_captures (id, owner_id, pack_id, title) values ('cap1', $1, 'p1', 'Traversée')`, [owner]);
  await db.query(`select set_config('test.uid', $1, false)`, [U(1)]);
  const vid = async n => db.query(`insert into public.composer_videos (id, owner_id, kind, title, base, file, size_bytes) values ($1, $2, 'capture_export', $1, 'https://media.layerpitch.com/video/' || $1 || '/', 'export.mp4', 1000)`, ['v' + n, owner]);
  const setCap = async (n, keep) => (await q(`select public.set_video_capture_export('cap1', $1, '[]'::jsonb, $2) as r`, ['v' + n, keep !== false]))[0].r;
  const hist = async () => (await q(`select public.list_video_export_history('cap1') as h`))[0].h;
  const exists = async id => (await q(`select count(*)::int n from public.composer_videos where id = $1`, [id]))[0].n === 1;

  for (let n = 1; n <= 5; n++) await vid(n);
  await setCap(1); await setCap(2); await setCap(3); await setCap(4);
  check('3 anciens exports gardés (v3, v2, v1), v4 affichée', (await hist()).map(h => h.videoId).join() === 'v3,v2,v1');
  const r5 = await setCap(5);
  check('un 4e ancien : le plus vieux (v1) est effacé de la bibliothèque et son fichier signalé', (await hist()).map(h => h.videoId).join() === 'v4,v3,v2' && !(await exists('v1')) && r5.removed.length === 1 && r5.removed[0].path === 'video/v1/export.mp4');

  // Revenir à v3 : v3 redevient la vidéo affichée, v5 passe dans l'historique.
  const h3 = (await hist()).find(h => h.videoId === 'v3');
  await db.query(`select public.restore_video_export($1)`, [h3.id]);
  const cur = (await q(`select last_export_video_id v from public.video_captures where id = 'cap1'`))[0].v;
  check('revenir à un export : il redevient la vidéo affichée partout', cur === 'v3' && (await hist()).map(h => h.videoId).join() === 'v5,v4,v2');

  // Renoncer à garder l'ancienne : v3 est effacée tout de suite.
  await vid(6);
  const r6 = await setCap(6, false);
  check('« ne pas garder l’ancienne » : effacée tout de suite, historique inchangé', !(await exists('v3')) && r6.removed.length === 1 && (await hist()).length === 3);

  // Une vidéo encore placée à la main dans un bloc vidéo d'AdReel n'est jamais effacée.
  await db.query(`insert into public.ad_reels (id, owner_id, label, blocks) values ('main', $1, 'Principal', '[{"type":"video","videos":[{"libraryVideoId":"v2"}]}]')`, [owner]);
  const usage = (await q(`select public.my_video_history_usage() as u`))[0].u;
  check('place prise par les historiques', usage.count === 3 && Number(usage.bytes) === 3000);
  const cl = (await q(`select public.clear_video_export_history() as r`))[0].r;
  check('nettoyage : historiques vidés, vidéos inutilisées effacées, celle de l’AdReel gardée', (await hist()).length === 0 && !(await exists('v5')) && !(await exists('v4')) && (await exists('v2')) && cl.removed.length === 2);
  check('la vidéo affichée n’est jamais touchée par le nettoyage', await exists('v6'));

  await db.query(`select set_config('test.uid', '', false)`);
  let anon = false;
  try { await db.exec('set role anon'); await db.query(`select public.clear_video_export_history()`); anon = true; } catch (e) { /* refusé : attendu */ } finally { await db.exec('reset role'); }
  check('sans compte : aucun accès', !anon);
  const fs = require('fs'), read = f => fs.readFileSync(require('path').join(__dirname, f), 'utf8');
  const panel = read('src/pack/18-panneau-de-capture.js');
  check('outil de capture : case « Garder l’ancienne », historique avec « Revenir à celle-ci », fichiers retirés effacés', /videoCaptureKeepOld/.test(panel) && /restore_video_export/.test(panel) && /p_keep_old: keepOldCheckbox\.checked/.test(panel) && /r2DeleteRemovedVideos\(data && data\.removed\)/.test(panel));
  check('versions : même chose pour l’export d’une version', /p_keep_old: keepOld !== false/.test(read('capture-versioning.js')) && /ctx\.afterExport/.test(read('capture-versioning.js')));
  check('bibliothèque vidéo : bouton « Effacer les historiques », mis en avant quand le quota approche', /clear_video_export_history/.test(read('src/backstage/41-envoi-r2-et-bibliotheque-video.js')) && /quotaGb \* 0\.9/.test(read('src/backstage/41-envoi-r2-et-bibliotheque-video.js')));
  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
