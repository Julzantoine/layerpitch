// Versions vidéo dans l'espace Projet (21/10, migration 20261021050000) : un montage devient un objet du Projet (kind 'montage'),
// ajouté seulement par son auteur, sans doublon, lisible par tous les membres ; supprimé avec son montage. Base jetable PGlite.
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
  await mk(1, 'compo@x.test'); await mk(2, 'membre@x.test');
  const c1 = (await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro') returning id`, [U(1)]))[0].id;
  const c2 = (await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro') returning id`, [U(2)]))[0].id;
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await q(`update public.feature_flags set released = true where key in ('projects', 'studio_space')`);
  await q(`insert into public.packs (id, owner_id, title) values ('p1', $1, 'Pack'), ('p2', $2, 'Pack 2')`, [c1, c2]);
  await q(`insert into public.video_captures (id, owner_id, pack_id, title) values ('cap1', $1, 'p1', 'Traversée'), ('cap2', $2, 'p2', 'Autre')`, [c1, c2]);
  await as(1);
  const pid = await val(`select public.create_project('Alone in the Barque')`);
  const inv = await val(`select public.invite_project_member($1, 'membre@x.test')`, [pid]);
  await as(2); await q(`select public.respond_project_invitation($1, true)`, [inv]);
  await as(1);
  const add = p => val(`select public.add_project_asset($1, $2::jsonb, true)`, [pid, JSON.stringify(p)]);
  const r = await add({ kind: 'montage', montageId: 'cap1', title: 'Traversée' });
  check('l’auteur ajoute son montage au Projet', !!r.id && !r.existed);
  check('pas de doublon', (await add({ kind: 'montage', montageId: 'cap1' })).existed === true);
  check('le montage d’un autre compositeur est refusé', await fails(`select public.add_project_asset($1, $2::jsonb)`, [pid, JSON.stringify({ kind: 'montage', montageId: 'cap2' })], /propres montages/));
  await as(2);
  const content = await val(`select public.get_project_content($1)`, [pid]);
  const a = content.assets.find(x => x.kind === 'montage');
  check('un membre voit l’objet, avec le montage et son titre', a && a.montageId === 'cap1' && a.montageTitle === 'Traversée' && content.moodboard.includes(a.id));
  await as(1);
  await q(`delete from public.video_captures where id = 'cap1'`);
  check('montage supprimé : l’objet disparaît du Projet', (await val(`select public.get_project_content($1)`, [pid])).assets.every(x => x.kind !== 'montage'));
  const fs = require('fs'), read = f => fs.readFileSync(require('path').join(__dirname, f), 'utf8');
  const page = read('projet.html');
  check('page Projet : lecteur à versions chargé, carte « montage », ajout depuis le Moodboard, liste dans Vidéos', /layerpitch-video-versions\.js/.test(page) && /if \(a\.kind === 'montage'\) mountMontagePlayer\(el, a\)/.test(page) && /kind === 'montage'\) payload = \{ kind, montageId/.test(page) && /id="montageGrid"/.test(page));
  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
