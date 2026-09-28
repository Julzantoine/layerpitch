// Retours de l'essai réel du 28/09 (migration 20260928220000) : parade « vitrine publique = 1 AdReel » (et quota
// d'AdReels enfin contrôlé côté serveur), adresses au nom du jeu, image de fond, bloc Contact des vitrines, taille des
// fichiers (doublons). Base jetable PGlite.
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
  const fails = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  for (const n of [1, 2]) { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), `u${n}@x.test`]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); }
  await db.query(`update public.beta_program set full_access = false`);
  await q(`update public.feature_flags set released = true where key in ('projects', 'studio_space', 'video_upload')`);
  const c1 = (await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'starter') returning id`, [U(1)]))[0].id;
  await as(1);
  const p = await val(`select public.create_project('Jeu Forêt')`);
  // Warrior : 10 AdReels au plus. 9 existants.
  for (let i = 0; i < 9; i++) await q(`insert into public.ad_reels (id, owner_id, label, profile, blocks) values ($1, $2, 'A', '{}'::jsonb, '[]'::jsonb)`, ['a' + i, c1]);
  const v1 = await val(`select public.save_project_vitrine($1, '{"published":true}'::jsonb)`, [p]);
  check('adresse par défaut : le nom du jeu (titre du Projet)', v1.slug === 'jeu-foret' && v1.published === true);
  const v2 = await val(`select public.save_project_vitrine($1, '{"audience":"publisher"}'::jsonb)`, [p]);
  check('vitrine éditeur : nom du jeu + « -editeur »', v2.slug === 'jeu-foret-editeur');
  check('parade : 9 AdReels + 1 vitrine publique = 10, une 2e vitrine publique publiée est refusée', await fails(`select public.save_project_vitrine($1, '{"title":"Autre","published":true}'::jsonb)`, [p], /Limite atteinte : 10/));
  check('parade : un brouillon public reste possible', (await val(`select public.save_project_vitrine($1, '{"title":"Brouillon"}'::jsonb)`, [p])).published === false);
  check('parade : une vitrine éditeur publiée reste libre', !!(await val(`select public.save_project_vitrine($1, '{"title":"Pitch 2","audience":"publisher","published":true}'::jsonb)`, [p])));
  check('réenregistrer la vitrine publique déjà en ligne : jamais bloqué', (await val(`select public.save_project_vitrine($1, $2::jsonb)`, [p, JSON.stringify({ id: v1.id, published: true, title: 'OST' })])).published === true);
  check('quota d\'AdReels contrôlé : un 11e AdReel (nouveau) est refusé', await fails(`select public.upsert_ad_reel('{"id":"nouveau"}'::jsonb)`, [], /Limite atteinte : 10 AdReels/));
  check('un AdReel existant se republie toujours', !!(await val(`select public.upsert_ad_reel('{"id":"a1","label":"A1"}'::jsonb)`)));
  // Studio : libre
  await as(2);
  const sid = await val(`select public.ensure_studio_profile()`);
  await q(`update public.studio_profiles set plan = 'indie' where id = $1`, [sid]);
  const ps = await val(`select public.create_project('Studio Game', '', true)`);
  check('Projet de studio : vitrines publiques sans limite', !!(await val(`select public.save_project_vitrine($1, '{"published":true}'::jsonb)`, [ps])));
  // Image de fond + taille des fichiers
  await as(1);
  const f = await val(`select public.reserve_project_file($1, 'fond.png', 1234)`, [p]); await q(`select public.complete_project_file($1)`, [f.fileId]);
  const img = (await val(`select public.add_project_asset($1, $2::jsonb)`, [p, JSON.stringify({ kind: 'image', fileId: f.fileId })])).id;
  check('taille du fichier renvoyée avec le contenu (doublons)', (await val(`select public.get_project_content($1)`, [p])).assets.find(a => a.id === img).fileSize === 1234);
  await q(`select public.save_project_vitrine($1, $2::jsonb)`, [p, JSON.stringify({ id: v1.id, published: true, title: 'OST', bgAssetId: img, blocks: [{ type: 'header' }, { type: 'contact' }] })]);
  await as(0); await db.query(`set role anon`);
  const pub = await val(`select public.get_vitrine('jeu-foret')`);
  await db.query(`reset role`);
  check('image de fond : dans la vitrine lue sans compte, fichier lisible publiquement', pub.bgAssetId === img && pub.assets[img] && !!(await val(`select public.project_file_is_public($1)`, [f.fileId])));
  // Bloc Contact
  await as(0); await db.query(`set role anon`);
  await q(`select public.submit_vitrine_message($1, 'Ana', 'ana@editeur.fr', 'On aime beaucoup, on peut en parler ?')`, [v1.id]);
  const badMail = await fails(`select public.submit_vitrine_message($1, 'X', 'pas-une-adresse', 'x')`, [v1.id], /invalide/);
  const noForm = await fails(`select public.submit_vitrine_message($1, 'X', 'x@y.fr', 'x', null)`, [v2.id], /introuvable|formulaire/);
  await db.query(`reset role`);
  await as(1);
  const msgs = await val(`select public.list_project_messages($1)`, [p]);
  check('message d\'un visiteur : arrive dans la discussion du Projet', msgs.some(m => m.body.includes('Message reçu via la vitrine « OST »') && m.body.includes('ana@editeur.fr')));
  check('adresse e-mail invalide : refusée', badMail);
  check('vitrine sans bloc Contact (ou non publiée sans lien secret) : refusée', noForm);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
