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

  // Préférences du fan (le dé), par compte et par album : en base, pour suivre le fan d'un appareil à l'autre
  await db.query(`insert into auth.users (id) values ($1)`, [U(3)]); await db.query(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(3)]);
  await db.query(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro')`, [U(1)]);
  const owner = (await db.query(`select id from public.composer_profiles where profile_id = $1`, [U(1)])).rows[0].id;
  await db.query(`insert into public.tracks (id, owner_id, title, mode) values ('t1', $1, 'T1', 'vertical'), ('t2', $1, 'T2', 'vertical')`, [owner]);
  await db.query(`insert into public.album_tracks (album_id, track_id, position) values ('alb1', 't1', 0), ('alb1', 't2', 1)`);
  await db.query(`insert into public.album_purchases (album_id, buyer_id, is_test) values ('alb1', $1, true)`, [U(2)]);
  await as(3);
  check('sans achat : préférences refusées (lecture et écriture)', await fails(`select public.get_my_album_prefs('alb1')`) && await fails(`select public.set_my_album_prefs('alb1', true, '{}')`));
  await as(2);
  const get = async () => (await db.query(`select public.get_my_album_prefs('alb1') as p`)).rows[0].p;
  check('acheteur : préférences par défaut (dé éteint, aucun morceau)', JSON.stringify(await get()) === '{"dice":false,"tracks":{}}');
  await db.query(`select public.set_my_album_prefs('alb1', true, '{"t1":"off","t2":"on"}'::jsonb)`);
  check('préférences enregistrées pour le compte (dé d\'album + par morceau)', JSON.stringify(await get()) === '{"dice":true,"tracks":{"t1":"off","t2":"on"}}');
  await db.query(`select public.set_my_album_prefs('alb1', false, '{"t1":"on","zz":"on","t2":"peut-être"}'::jsonb)`);
  check('morceau inconnu et valeur invalide ignorés, le reste remplacé', JSON.stringify(await get()) === '{"dice":false,"tracks":{"t1":"on"}}');
  check('préférences mal formées refusées', await fails(`select public.set_my_album_prefs('alb1', true, '[1]'::jsonb)`));
  await as(3);
  check('un autre compte ne voit pas ces préférences (table fermée)', await fails(`select public.get_my_album_prefs('alb1')`));

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
