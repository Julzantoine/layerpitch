// Page publique d'album (migration 20260929010000, album.html) : get_public_album ne montre qu'un album en vente, sans
// connexion ; morceaux retirés absents ; « album » est un nom réservé. Base jetable PGlite.
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
  await q(`insert into auth.users (id, email) values ($1, 'a@x.test')`, [U(1)]);
  await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(1)]);
  const c = (await q(`insert into public.composer_profiles (profile_id, handle) values ($1, 'jean') returning id`, [U(1)]))[0].id;
  for (const t of ['t1', 't2', 't3']) await q(`insert into public.tracks (id, owner_id, title, mode) values ($1, $2, $3, 'static')`, [t, c, 'Morceau ' + t]);
  await q(`insert into public.albums (id, seller_id, seller_role, title, presentation_fr, price_eur_cents, buyable) values ('ost', $1, 'composer', 'Mon OST', 'Bonjour', 500, true)`, [U(1)]);
  await q(`insert into public.albums (id, seller_id, seller_role, title, buyable) values ('brouillon', $1, 'composer', 'Pas en vente', false)`, [U(1)]);
  for (const [i, t] of ['t1', 't2', 't3'].entries()) await q(`insert into public.album_tracks (album_id, track_id, position) values ('ost', $1, $2)`, [t, i]);
  await q(`update public.album_tracks set removed_at = now() where album_id = 'ost' and track_id = 't2'`);
  await db.query(`select set_config('test.uid', '', false)`); // visiteur sans compte
  const a = await val(`select public.get_public_album('ost')`);
  check('album en vente : titre, prix, présentation', a && a.title === 'Mon OST' && a.priceEurCents === 500 && a.presentationFr === 'Bonjour');
  check('vendeur : à défaut d\'AdReel, l\'identifiant public', a.sellerName === 'jean' && a.sellerRole === 'composer');
  check('morceaux dans l\'ordre, sans celui retiré', a.tracks.map(t => t.id).join(',') === 't1,t3');
  check('album non en vente : rien', (await val(`select public.get_public_album('brouillon')`)) === null);
  check('album inconnu : rien', (await val(`select public.get_public_album('nope')`)) === null);
  check('« album » est un nom réservé', (await val(`select public.handle_is_reserved('album')`)) === true);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
