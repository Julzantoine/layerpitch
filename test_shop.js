// Page Shop (migration 20260929080000) : feu vert, albums affichés, noms de vendeurs, choix du vendeur. PGlite.
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const one = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const fails = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const mk = async (n, email) => { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), email]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); };
  for (const [n, e] of [[1, 'compo'], [2, 'studio'], [3, 'admin'], [4, 'autre']]) await mk(n, e + '@x.test');
  const c1 = (await q(`insert into public.composer_profiles (profile_id, handle) values ($1, 'jean') returning id`, [U(1)]))[0].id;
  await q(`insert into public.studio_profiles (profile_id, display_name) values ($1, 'Studio Mousse')`, [U(2)]);
  await q(`insert into public.admins (profile_id) values ($1)`, [U(3)]);
  await q(`insert into public.tracks (id, owner_id, title, mode) values ('t1', $1, 'A', 'static'), ('t2', $1, 'B', 'static'), ('t3', $1, 'C', 'static')`, [c1]);
  await q(`insert into public.albums (id, seller_id, seller_role, title, buyable, price_eur_cents, shop_listed, listen_mode, tags) values
    ('a1', $1, 'composer', 'Album compo', true, 500, true, 'selected', array['ambient']),
    ('a2', $2, 'studio', 'OST studio', true, 0, true, 'all', array[]::text[]),
    ('a3', $1, 'composer', 'Pas affiché', true, 500, false, 'none', array[]::text[]),
    ('a4', $1, 'composer', 'Pas en vente', false, 500, true, 'none', array[]::text[]),
    ('a5', $1, 'composer', 'Sans prix', true, null, true, 'none', array[]::text[])`, [U(1), U(2)]);
  await q(`insert into public.album_tracks (album_id, track_id, position, free_listen) values ('a1', 't1', 0, true), ('a1', 't2', 1, false), ('a2', 't3', 0, false)`);
  await q(`update public.album_tracks set removed_at = now() where album_id = 'a1' and track_id = 't2'`);

  await as(0);
  check('shop fermé (feu vert non donné) : pas ouvert pour un visiteur', (await one(`select public.shop_status()->>'open'`)) === 'false');
  check('shop fermé : aucun album listé pour un visiteur', (await q(`select * from public.shop_albums()`)).length === 0);
  await as(4);
  check('shop fermé : pas ouvert pour un compte ordinaire', (await one(`select public.shop_status()->>'open'`)) === 'false');
  await as(3);
  check('shop fermé : ouvert pour un administrateur', (await one(`select public.shop_status()->>'open'`)) === 'true');
  const adm = await q(`select * from public.shop_albums() order by id`);
  check('administrateur : seulement les albums en vente, affichés et avec un prix (a1, a2)', adm.map(r => r.id).join() === 'a1,a2');
  check('noms des vendeurs : identifiant du compositeur, nom du studio', adm[0].seller_name === 'jean' && adm[1].seller_name === 'Studio Mousse' && adm[1].seller_role === 'studio');
  check('compteurs : morceaux (sans les retirés) et morceaux en écoute libre', adm[0].track_count === 1 && adm[0].free_track_count === 1 && adm[1].track_count === 1 && adm[1].free_track_count === 1);
  check('prix libre (0) affiché : prix 0 conservé', adm[1].price_eur_cents === 0 && adm[0].tags[0] === 'ambient');
  await db.query(`update public.feature_flags set released = true where key = 'shop'`);
  await as(0);
  check('feu vert donné : ouvert pour un visiteur, albums visibles sans compte', (await one(`select public.shop_status()->>'open'`)) === 'true' && (await q(`select * from public.shop_albums()`)).length === 2);

  await as(1);
  await db.query(`select public.set_album_shop_listed('a3', true)`);
  check('le vendeur choisit d\'afficher son album : il apparaît', (await q(`select id from public.shop_albums() where id = 'a3'`)).length === 1);
  await db.query(`select public.set_album_shop_listed('a3', false)`);
  check('… et de le retirer', (await q(`select id from public.shop_albums() where id = 'a3'`)).length === 0);
  await as(4);
  check('un autre compte ne peut pas changer l\'affichage', await fails(`select public.set_album_shop_listed('a1', false)`, [], /seul le vendeur/));
  await as(0);
  check('un visiteur ne peut pas changer l\'affichage', await fails(`select public.set_album_shop_listed('a1', false)`, [], /./));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
