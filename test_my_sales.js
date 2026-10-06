// Onglet Ventes (migration 20260929090000) : feu vert, ventes de packs et d'albums, parts, achats de test exclus des totaux,
// cloisonnement (jamais les ventes d'un autre compte). PGlite.
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
  const sales = async n => { await as(n); return (await q(`select public.my_sales() s`))[0].s; };
  const mk = async (n, e) => { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), e + '@x.test']); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); };
  for (const [n, e] of [[1, 'vendeur'], [2, 'acheteur'], [3, 'coauteur'], [4, 'autre']]) await mk(n, e);
  const c1 = (await q(`insert into public.composer_profiles (profile_id) values ($1) returning id`, [U(1)]))[0].id;
  await q(`insert into public.composer_profiles (profile_id) values ($1)`, [U(4)]);
  await q(`insert into public.packs (id, owner_id, title, buyable, price_eur_cents) values ('pk', $1, 'Pack Forêt', true, 1000)`, [c1]);
  await q(`insert into public.pack_purchases (studio_id, pack_id, price_paid) values ($1, 'pk', 10)`, [U(2)]);
  await q(`insert into public.albums (id, seller_id, seller_role, title, buyable, price_eur_cents) values ('al', $1, 'composer', 'OST', true, 500)`, [U(1)]);
  const ap = (await q(`insert into public.album_purchases (buyer_id, album_id, price_paid, is_test) values ($1, 'al', 5, false) returning id`, [U(2)]))[0].id;
  await q(`insert into public.album_purchases (buyer_id, album_id, price_paid, is_test) values ($1, 'al', 0, true)`, [U(3)]);
  await q(`insert into public.album_payouts (album_purchase_id, beneficiary_profile_id, beneficiary_role, share_bps, amount_cents, status) values ($1, $2, 'composer', 7000, 350, 'transferred'), ($1, $3, 'composer', 3000, 150, 'pending')`, [ap, U(1), U(3)]);

  await as(1);
  check('feu vert fermé : onglet fermé pour un compte ordinaire', (await sales(1)).open === false);
  await db.query(`update public.feature_flags set released = true where key = 'sales_tab'`);
  let s = await sales(1);
  check('ouvert : 2 ventes réelles + 1 test listée', s.open && s.rows.length === 3 && s.rows.filter(r => r.isTest).length === 1);
  check('totaux : achats de test exclus (2 ventes, 10 € + 5 € bruts)', s.totals.count === 2 && s.totals.grossCents === 1500);
  const album = s.rows.find(r => r.kind === 'album' && !r.isTest), pack = s.rows.find(r => r.kind === 'pack');
  check('album : ma part (3,50 €) et statut du versement', album.shareCents === 350 && album.status === 'transferred' && album.title === 'OST');
  check('pack payé : montant brut, part inconnue (elle figure sur la facture)', pack.grossCents === 1000 && pack.shareCents === null && pack.status === 'paid');
  check('total de ma part : seulement les parts connues (3,50 €)', s.totals.shareCents === 350);
  check('aucune identité d\'acheteur dans les lignes', !JSON.stringify(s.rows).match(/acheteur|buyer|@x\.test/i));
  s = await sales(3);
  check('co-ayant droit : voit la vente d\'album où il a une part (1,50 €, en attente), pas les packs', s.rows.length === 1 && s.rows[0].shareCents === 150 && s.rows[0].status === 'pending' && s.rows[0].kind === 'album');
  s = await sales(4);
  check('cloisonnement : un autre compositeur ne voit rien', s.rows.length === 0 && s.totals.count === 0);
  s = await sales(2);
  check('l\'acheteur ne voit pas les ventes du vendeur', s.rows.length === 0);
  await as(0);
  let threw = false; try { await db.query(`select public.my_sales()`); } catch (e) { threw = true; }
  check('sans compte : refusé', threw);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
