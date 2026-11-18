// Vitrines : le bloc « Vidéo » accepte un MONTAGE (migration 20261118010000). Le serveur laisse passer l'objet montage dans un bloc vidéo
// (et le refuse dans les autres blocs), la vitrine publique renvoie montageId + montageTitle sans rien divulguer d'autre. Base jetable PGlite.
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
  await q(`insert into auth.users (id, email) values ($1, 'compo@x.test')`, [U(1)]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(1)]);
  const c1 = (await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro') returning id`, [U(1)]))[0].id;
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await q(`update public.feature_flags set released = true where key in ('projects', 'studio_space')`);
  await q(`insert into public.packs (id, owner_id, title) values ('p1', $1, 'Pack')`, [c1]);
  await q(`insert into public.video_captures (id, owner_id, pack_id, title) values ('cap1', $1, 'p1', 'Short test')`, [c1]);
  await as(1);
  const pid = await val(`select public.create_project('Dernier Étage')`);
  const mont = (await val(`select public.add_project_asset($1, $2::jsonb, true)`, [pid, JSON.stringify({ kind: 'montage', montageId: 'cap1', title: 'Scène A/B' })])).id;
  const save = blocks => val(`select public.save_project_vitrine($1, $2::jsonb)`, [pid, JSON.stringify({ audience: 'players', title: 'Dernier Étage', slug: 'dernier-etage-test', published: true, blocks })]);
  const v = await save([{ id: 'v', type: 'video', assetIds: [mont] }]);
  check('un bloc Vidéo accepte un montage', !!v.id);
  check('un bloc Photo refuse un montage', await fails(`select public.save_project_vitrine($1, $2::jsonb)`, [pid, JSON.stringify({ blocks: [{ type: 'photo', assetIds: [mont] }] })], /bon type/));
  check('un bloc Morceaux refuse un montage', await fails(`select public.save_project_vitrine($1, $2::jsonb)`, [pid, JSON.stringify({ blocks: [{ type: 'tracks', assetIds: [mont] }] })], /bon type/));
  await as(null);
  const pubV = await val(`select public.get_vitrine('dernier-etage-test')`);
  const a = pubV && pubV.assets[mont];
  check('lecture sans compte : le montage porte son identifiant et son titre', a && a.kind === 'montage' && a.montageId === 'cap1' && a.montageTitle === 'Short test');
  check('lecture sans compte : rien d\'autre divulgué (ni fichier, ni auteur)', a && !a.fileId && !('authorEmail' in a) && !('createdBy' in a));
  const fs = require('fs'), read = f => fs.readFileSync(require('path').join(__dirname, f), 'utf8');
  check('éditeur : le bloc Vidéo propose les montages', /video: \['video', 'montage'\]/.test(read('projet.html')));
  check('page publique : le montage devient une vidéo à versions', /kind === 'montage'/.test(read('vitrine.html')) && /montageId: a\.montageId/.test(read('vitrine.html')) && /\(v\.url \|\| v\.montageId\)/.test(read('reel.js')));
  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
