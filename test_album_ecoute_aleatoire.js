// Le dé des albums, côté base (migration 20261006030000) : réglage du vendeur, refus pour les autres. PGlite jetable.
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
  const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch (e) { return true; } };
  for (const n of [1, 2]) { await db.query(`insert into auth.users (id) values ($1)`, [U(n)]); await db.query(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); }
  await db.query(`insert into public.albums (id, title, seller_id, seller_role) values ('alb1', 'Album', $1, 'composer')`, [U(1)]);
  check('par défaut : écoute aléatoire non autorisée', (await db.query(`select allow_random from public.albums where id = 'alb1'`)).rows[0].allow_random === false);
  await as(2);
  check('un autre compte ne peut pas la régler', await fails(`select public.set_album_random('alb1', true)`));
  await as(1);
  await db.query(`select public.set_album_random('alb1', true)`);
  check('le vendeur l\'autorise', (await db.query(`select allow_random from public.albums where id = 'alb1'`)).rows[0].allow_random === true);
  await db.query(`select public.set_album_random('alb1', false)`);
  check('… et la retire', (await db.query(`select allow_random from public.albums where id = 'alb1'`)).rows[0].allow_random === false);
  check('album inconnu refusé', await fails(`select public.set_album_random('nope', true)`));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
