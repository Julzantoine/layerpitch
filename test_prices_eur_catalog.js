// Étape 2a du chantier profils et permissions (migration 20260928010000) : tout en euros, grille de prix des packs,
// catalogue abonnés, droits lus dans la matrice. Base jetable PGlite (toutes les migrations rejouées, aucune connexion).
// Prérequis : npm install (dépendance de développement @electric-sql/pglite).
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
  const refused = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const pack = async id => (await db.query(`select price_eur_cents, subscriber_credits, buyable from public.packs where id = $1`, [id])).rows[0];

  for (const [n, admin] of [[1, true], [2, false]]) {
    await db.query(`insert into auth.users (id) values ($1)`, [U(n)]);
    await db.query(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]);
    await db.query(`insert into public.composer_profiles (profile_id) values ($1)`, [U(n)]);
    if (admin) await db.query(`insert into public.admins (profile_id) values ($1)`, [U(n)]);
  }
  const upsert = (payload) => db.query(`select public.upsert_pack($1::jsonb)`, [JSON.stringify(payload)]);

  // Colonnes en euros
  const cols = (await db.query(`select table_name, column_name from information_schema.columns where table_schema = 'public' and column_name like 'price_%cents'`)).rows.map(r => r.table_name + '.' + r.column_name);
  check('packs et albums en euros, plus aucune colonne en dollars', cols.includes('packs.price_eur_cents') && cols.includes('albums.price_eur_cents') && !cols.some(c => /usd/.test(c)));

  // Grille
  const valid = async c => (await db.query(`select public.is_valid_pack_price($1) v`, [c])).rows[0].v;
  check('grille : 0, 1 €, 100 €, 110 €, 200 €, 250 €, 500 € acceptés', (await Promise.all([0, 100, 10000, 11000, 20000, 25000, 50000].map(valid))).every(Boolean));
  check('grille : 9,99 €, 105 €, 115 €, 260 €, 550 € refusés', !(await Promise.all([999, 10500, 11500, 26000, 55000].map(valid))).some(Boolean));

  // upsert_pack par un compositeur non admin (feux verts fermés)
  await as(2);
  await upsert({ id: 'p2', title: 'Pack', priceEurCents: 1500 });
  check('prix réglable par tout compositeur : 15 €', (await pack('p2')).price_eur_cents === 1500);
  check('prix hors grille refusé avec un message clair', await refused(`select public.upsert_pack($1::jsonb)`, [JSON.stringify({ id: 'p2', title: 'Pack', priceEurCents: 1499 })], /hors grille/));
  await upsert({ id: 'p2', title: 'Pack renommé' });
  check('payload sans prix : le prix existant est conservé', (await pack('p2')).price_eur_cents === 1500);
  await upsert({ id: 'p2', title: 'Pack', buyable: true, subscriberCredits: 2 });
  const p2 = await pack('p2');
  check('non-admin : « en vente » et catalogue abonnés ignorés (feux verts fermés)', p2.buyable === false && p2.subscriber_credits === null);

  // Admin
  await as(1);
  await upsert({ id: 'p1', title: 'Pack admin', priceEurCents: 2000, buyable: true, subscriberCredits: 2 });
  const p1 = await pack('p1');
  check('admin : en vente, 20 €, 2 crédits', p1.buyable === true && p1.price_eur_cents === 2000 && p1.subscriber_credits === 2);
  check('coût en crédits autre que 1, 2, 4 refusé', await refused(`select public.upsert_pack($1::jsonb)`, [JSON.stringify({ id: 'p1', title: 'x', subscriberCredits: 3 })], /1, 2 ou 4/));
  check('pack gratuit refusé dans le catalogue abonnés', await refused(`select public.upsert_pack($1::jsonb)`, [JSON.stringify({ id: 'p1', title: 'x', priceEurCents: 0 })], /gratuit/));
  await upsert({ id: 'p1', title: 'x', priceEurCents: 0, subscriberCredits: null });
  check('passer gratuit en sortant du catalogue : accepté', (await pack('p1')).price_eur_cents === 0 && (await pack('p1')).subscriber_credits === null);

  // Feu vert donné : un compositeur non admin peut mettre en vente et entrer au catalogue
  await db.query(`select public.set_feature_released('sell_packs', true)`);
  await db.query(`select public.set_feature_released('subscriber_catalog', true)`);
  await as(2);
  await upsert({ id: 'p2', title: 'Pack', buyable: true, subscriberCredits: 4 });
  check('après feux verts : non-admin met en vente, 4 crédits', (await pack('p2')).buyable === true && (await pack('p2')).subscriber_credits === 4);

  // Album : clé priceEurCents, verrou porté par la matrice
  check('album : non-admin refusé tant que sell_albums est fermé', await refused(`select public.upsert_album($1::jsonb)`, [JSON.stringify({ id: 'a2', title: 'Album' })], /réservée aux administrateurs/));
  await as(1);
  await db.query(`select public.upsert_album($1::jsonb)`, [JSON.stringify({ id: 'a1', title: 'Album', priceEurCents: 700 })]);
  check('album : prix minimum en euros enregistré', (await db.query(`select price_eur_cents from public.albums where id = 'a1'`)).rows[0].price_eur_cents === 700);

  // Données existantes : les 9,99 du 31/08 et des prix hors grille ramenés au palier le plus proche
  const fs = require('fs');
  const old = await freshDb({ upTo: '20260927070000_entitlements_matrix.sql' });
  await old.query(`insert into auth.users (id) values ($1)`, [U(9)]);
  await old.query(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(9)]);
  const cid = (await old.query(`insert into public.composer_profiles (profile_id) values ($1) returning id`, [U(9)])).rows[0].id;
  for (const [id, cents] of [['a', 999], ['b', 10499], ['c', 11400], ['d', 26000], ['e', 99900], ['f', null], ['g', 0]])
    await old.query(`insert into public.packs (id, owner_id, title, price_usd_cents) values ($1, $2, 'x', $3)`, [id, cid, cents]);
  await old.exec(fs.readFileSync('supabase/migrations/20260928010000_prices_eur_and_subscriber_catalog.sql', 'utf8'));
  const conv = Object.fromEntries((await old.query(`select id, price_eur_cents from public.packs`)).rows.map(r => [r.id, r.price_eur_cents]));
  check('conversion : 9,99 → 10 €, 104,99 → 100 €, 114 → 110 €, 260 → 250 €, 999 → 500 €, vide et gratuit inchangés',
    conv.a === 1000 && conv.b === 10000 && conv.c === 11000 && conv.d === 25000 && conv.e === 50000 && conv.f === null && conv.g === 0);

  // Contrainte en base, même hors RPC
  check('contrainte : prix hors grille impossible même en écriture directe', await refused(`update public.packs set price_eur_cents = 999 where id = 'p2'`));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
