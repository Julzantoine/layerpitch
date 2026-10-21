// Montages vidéo d'un STUDIO (21/10, migration 20261021060000) : le montage appartient au studio entier (tout membre le retouche, il
// reste au studio quand un membre part), versions et historique compris ; droits du palier studio ; nombre de montages (Indie : 10) ;
// stockage compté dans le quota du studio ; rien ne change pour les compositeurs. Base jetable PGlite.
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  const U = n => '00000000-0000-0000-0000-00000000000' + n;
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const fails = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const mk = async (n, email) => { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), email]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); };
  await mk(1, 'studio@x.test'); await mk(2, 'membre@x.test'); await mk(3, 'compo@x.test'); await mk(4, 'autre-studio@x.test');
  await q(`update public.feature_flags set released = true where key in ('studio_space', 'versioning', 'projects')`);
  const st = (await q(`insert into public.studio_profiles (profile_id, display_name, plan) values ($1, 'Barque Studio', 'indie') returning id`, [U(1)]))[0].id;
  const st2 = (await q(`insert into public.studio_profiles (profile_id, display_name, plan) values ($1, 'Autre', 'indie') returning id`, [U(4)]))[0].id;
  await q(`insert into public.studio_members (studio_id, email, profile_id, status) values ($1, 'membre@x.test', $2, 'active')`, [st, U(2)]);
  const c3 = (await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro') returning id`, [U(3)]))[0].id;
  await q(`insert into public.packs (id, owner_id, title) values ('p1', $1, 'Pack')`, [c3]);
  await q(`insert into public.pack_purchases (studio_id, pack_id) values ($1, 'p1')`, [U(1)]); // pack acheté par le studio

  // Le propriétaire du studio enregistre un montage AU NOM DU STUDIO.
  await as(1);
  const owns = await val(`select public.team_owns_pack('p1')`);
  const save = (id, n) => db.query(`select public.save_video_capture($1, 'p1', $2, 'jeu.mp4', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, true)`, [id, n]);
  let saveErr = null; try { await save('cap1', 'Traversée'); } catch (e) { saveErr = e.message; }
  check('le studio enregistre un montage sur un pack qu’il a acheté (' + (saveErr || 'ok') + ')', owns === true && saveErr === null);
  const row = (await q(`select owner_id, owner_studio_id from public.video_captures where id = 'cap1'`))[0];
  check('le montage appartient au studio, pas au compte qui l’a fait', row.owner_id === null && row.owner_studio_id === st);

  // Un membre de l'équipe le voit, le retouche, en fait une version.
  await as(2);
  const list = await val(`select public.list_my_video_captures(null, true)`);
  check('un membre du studio voit le montage', list.length === 1 && list[0].id === 'cap1');
  await save('cap1', 'Traversée retouchée');
  check('un membre le retouche', (await q(`select title from public.video_captures where id = 'cap1'`))[0].title === 'Traversée retouchée');
  let verErr = null; try { await q(`select public.save_video_capture_version('ver1', 'cap1', 'Musique 2', '{}'::jsonb, true)`); } catch (e) { verErr = e.message; }
  check('un membre crée une version vidéo (palier studio « saved »)', verErr === null);
  check('côté compositeur (sans p_studio), ce membre ne voit rien', (await val(`select public.list_my_video_captures(null, false)`)).length === 0);

  // Un autre studio ne voit rien et ne peut rien toucher.
  await as(4);
  check('un autre studio ne voit pas le montage', (await val(`select public.list_my_video_captures(null, true)`)).length === 0);
  check('un autre studio ne peut pas le retoucher', await fails(`select public.save_video_capture('cap1', 'p1', 'x', 'x', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, true)`, [], /pack|appartient/));

  // Bibliothèque vidéo du studio : vidéo muette + son, quota du studio, historique.
  await as(1);
  await q(`select public.reserve_video_upload_studio($1, 'video/base1/base.mp4', 1000)`, [st]);
  await q(`select public.reserve_video_upload_studio($1, 'video/son1/audio.mp4', 200)`, [st]);
  await q(`select public.reserve_video_upload_studio($1, 'video/son2/audio.mp4', 300)`, [st]);
  for (const [id, kind] of [['base1', 'capture_base'], ['son1', 'capture_audio'], ['son2', 'capture_audio']]) await q(`select public.upsert_video($1::jsonb)`, [JSON.stringify({ id, kind, title: id, asStudio: true })]);
  await q(`select public.set_video_capture_base('cap1', 'base1', true)`);
  await q(`select public.set_video_capture_export('cap1', 'son1', '[]'::jsonb, true, true)`);
  await as(2);
  await q(`select public.set_video_capture_export('cap1', 'son2', '[]'::jsonb, true, true)`);
  check('historique partagé par l’équipe (l’ancien son du propriétaire, vu par le membre)', (await val(`select public.list_video_export_history('cap1', true)`)).length === 1);
  const lib = await val(`select public.list_my_videos(true)`);
  check('bibliothèque vidéo du studio : la vidéo muette, sans les sons ; stockage compté', lib.videos.map(v => v.id).join() === 'base1' && Number(lib.usedBytes) === 1500);
  check('quota : le stockage du studio inclut sa bibliothèque vidéo', Number(await val(`select public.owner_storage_used('studio', $1)`, [st])) === 1500);
  await as(4);
  check('un autre studio ne réserve pas l’envoi d’un fichier du studio', (await val(`select public.reserve_video_upload_studio($1, 'video/base1/base.mp4', 10)`, [st2])) !== null);

  // Le membre quitte le studio : le montage reste au studio.
  await q(`delete from public.studio_members where profile_id = $1`, [U(2)]);
  await as(1);
  check('un membre part : le montage reste au studio', (await val(`select public.list_my_video_captures(null, true)`)).length === 1);
  await as(2);
  check('l’ancien membre n’y a plus accès', (await val(`select public.list_my_video_captures(null, true)`)).length === 0);

  // Projets : un montage du studio se pose dans un Projet du studio.
  await as(1);
  const pid = await val(`select public.create_project('Alone in the Barque', '', true)`);
  const add = await val(`select public.add_project_asset($1, $2::jsonb)`, [pid, JSON.stringify({ kind: 'montage', montageId: 'cap1' })]);
  check('un montage du studio s’ajoute à un Projet du studio', !!add.id);

  // Nombre de montages enregistrés (Indie : 10).
  // Le palier réellement appliqué en test dépend des réglages de la bêta : on fixe la limite à 10 pour tous les paliers studio.
  await q(`update public.plan_entitlements set allowed = true, amount = 10 where feature = 'saved_montages'`);
  for (let i = 2; i <= 10; i++) await save('cap' + i, 'M' + i);
  check('11e montage refusé (limite saved_montages : 10)', await fails(`select public.save_video_capture('cap11', 'p1', 'x', 'x', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, true)`, [], /Nombre maximal/));
  const fs = require('fs'), read = f => fs.readFileSync(require('path').join(__dirname, f), 'utf8');
  const pack = read('src/pack/16-sauvegarde-et-envois.js');
  check('outil de capture : un compte studio agit au nom du studio (p_studio, asStudio)', /window\.__lpStudioBuyer && path\.startsWith\('video\/'\)/.test(pack) && /rpc\('save_video_capture', withStudio\(/.test(pack) && /asStudio: videoAsStudio\(\)/.test(pack));
  check('outil de capture : un studio enregistre et versionne (plus de « provisoire »)', /window\.__lpVersioningLevel = lvl\('studio_versioning'\)/.test(read('src/pack/19-bouton-de-capture.js')));
  check('espace studio : onglet « Vidéos » (montages, bibliothèque, nettoyage)', /STUDIO_TABS = \['library', 'custom', 'video'/.test(read('studio.html')) && /clear_video_export_history', \{ p_studio: true \}/.test(read('studio.html')) && /studio\.video/.test(read('layerpitch-shell.js')));
  check('envoi des fichiers : vidéo d’un studio au quota du studio', /reserve_video_upload_studio/.test(read('supabase/functions/create-media-signed-url/index.ts')) && /verifyStudioVideo/.test(read('supabase/functions/create-media-signed-url/index.ts')));
  check('envois vidéo d’un studio bloqués tant que la fonction d’envoi n’est pas redéployée', /window\.__lpStudioVideoUploadsReady = false;/.test(pack) && /!window\.__lpStudioVideoUploadsReady\) throw/.test(pack));
  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
