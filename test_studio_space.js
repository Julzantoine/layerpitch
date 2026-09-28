// Étape 3 du chantier profils et permissions (migration 20260928030000) : catalogue public de packs et packs custom du
// studio (quota de la matrice, possession de chaque élément, isolation entre studios). Base jetable PGlite.
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
  const fails = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const mk = async n => { await q(`insert into auth.users (id) values ($1)`, [U(n)]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); };

  // Compositeur 1 avec deux packs en vente (un masqué du catalogue), un pack gratuit, un pack pas en vente.
  await mk(1);
  const c1 = (await q(`insert into public.composer_profiles (profile_id, handle) values ($1, 'jean') returning id`, [U(1)]))[0].id;
  await q(`insert into public.ad_reels (id, owner_id, label, profile) values ('main', $1, 'x', '{"title":"Jean Compositeur"}')`, [c1]);
  for (const [id, buyable, listed, price] of [['pA', true, true, 1000], ['pB', true, false, 2000], ['pC', true, true, 0], ['pD', false, true, 1000]])
    await q(`insert into public.packs (id, owner_id, title, buyable, catalog_listed, price_eur_cents) values ($1, $2, $1, $3, $4, $5)`, [id, c1, buyable, listed, price]);
  await q(`insert into public.tracks (id, owner_id, title, mode) values ('t1', $1, 'Morceau 1', 'static'), ('t2', $1, 'Morceau 2', 'static'), ('t3', $1, 'Morceau 3', 'static')`, [c1]);
  await q(`insert into public.sfx_library (id, owner_id, title) values ('s1', $1, 'Sfx 1')`, [c1]);
  await q(`insert into public.pack_tracks (pack_id, track_id, position) values ('pA', 't1', 0), ('pA', 't2', 1), ('pB', 't3', 0)`);
  await q(`insert into public.pack_sfx (pack_id, sfx_id, position) values ('pA', 's1', 0)`);

  await as(0);
  await db.query(`set role anon`);
  const cat = await q(`select * from public.catalog_packs()`);
  await db.query(`reset role`);
  check('catalogue lisible sans compte', Array.isArray(cat));
  check('catalogue : seulement les packs en vente, affichés et payants', cat.length === 1 && cat[0].id === 'pA');
  check('catalogue : nom du compositeur, adresse, nombre de morceaux et de Sfx', cat[0].composer_name === 'Jean Compositeur' && cat[0].composer_handle === 'jean' && cat[0].track_count === 2 && cat[0].sfx_count === 1);

  // Studio 2 (a acheté pA), studio 3 (rien acheté)
  await mk(2); await mk(3);
  await q(`insert into public.studio_profiles (profile_id) values ($1), ($2)`, [U(2), U(3)]);
  await q(`insert into public.pack_purchases (studio_id, pack_id, price_paid) values ($1, 'pA', 10)`, [U(2)]);
  await db.query(`update public.beta_program set full_access = false`);
  await as(2);
  check('packs custom fermés tant que le feu vert studio_space ne l\'est pas', await fails(`select public.upsert_my_custom_pack('{"name":"Test"}'::jsonb)`, [], /pas ouverts/));
  await db.query(`update public.feature_flags set released = true where key = 'studio_space'`);
  const owned = await q(`select * from public.my_owned_assets()`);
  check('mes éléments : les 2 morceaux et le Sfx du pack acheté, pas le reste', owned.length === 3 && owned.every(o => o.pack_id === 'pA'));
  const r1 = (await q(`select public.upsert_my_custom_pack($1::jsonb) r`, [JSON.stringify({ name: 'Playtest forêt', items: [{ kind: 'track', refId: 't2' }, { kind: 'sfx', refId: 's1', label: 'Pas' }] })]))[0].r;
  check('création d\'un pack custom avec des éléments achetés', r1.ok && !!r1.id);
  check('refus d\'un élément non acheté (morceau d\'un autre pack)', await fails(`select public.upsert_my_custom_pack($1::jsonb)`, [JSON.stringify({ id: r1.id, items: [{ kind: 'track', refId: 't3' }] })], /ne fait pas partie/));
  await q(`select public.upsert_my_custom_pack($1::jsonb)`, [JSON.stringify({ name: 'Deuxième' })]);
  check('SoloDev : 3e pack custom refusé (limite 2)', await fails(`select public.upsert_my_custom_pack('{"name":"Trois"}'::jsonb)`, [], /Limite atteinte : 2/));
  const list = (await q(`select public.list_my_custom_packs() l`))[0].l;
  check('liste : 2 packs, éléments dans l\'ordre avec leur étiquette', list.length === 2 && list[0].items.length === 2 && list[0].items[0].refId === 't2' && list[0].items[1].label === 'Pas');
  await q(`update public.studio_profiles set plan = 'indie' where profile_id = $1`, [U(2)]);
  const r3 = (await q(`select public.upsert_my_custom_pack('{"name":"Trois"}'::jsonb) r`))[0].r;
  check('Indie : 3e pack custom accepté (limite 20)', r3.ok);

  // Isolation
  await as(3);
  check('un autre studio ne voit pas mes packs custom', (await q(`select public.list_my_custom_packs() l`))[0].l.length === 0);
  check('un autre studio ne peut pas modifier mon pack custom', await fails(`select public.upsert_my_custom_pack($1::jsonb)`, [JSON.stringify({ id: r1.id, name: 'volé' })], /autre studio/));
  check('un autre studio ne peut pas supprimer mon pack custom', await fails(`select public.delete_my_custom_pack($1)`, [r1.id], /introuvable/));
  await db.query(`set role authenticated`);
  check('lecture directe des tables de packs custom impossible', (await q(`select * from public.studio_custom_packs`)).length === 0);
  await db.query(`reset role`);
  await as(2);
  await q(`select public.delete_my_custom_pack($1)`, [r1.id]);
  check('suppression de mon pack custom (éléments compris)', (await q(`select count(*)::int n from public.studio_custom_pack_items`))[0].n === 0);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
