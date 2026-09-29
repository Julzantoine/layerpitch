// Vente d'OST par un studio (migration 20260929020000) : album de studio, morceaux du studio, compositeur invité qui
// ajoute et retire LES SIENS, sortie libre, retrait de la vente si l'album ne tient plus, isolation. PGlite.
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
  const J = o => JSON.stringify(o);
  const take = { kind: 'layerpitch-take', v: 1, duration: 60 };

  await mk(1, 'studio@x.test'); await mk(2, 'coco@x.test'); await mk(3, 'autre@x.test'); await mk(4, 'pack@x.test');
  await q(`insert into public.studio_profiles (profile_id) values ($1)`, [U(1)]);
  const c2 = (await q(`insert into public.composer_profiles (profile_id) values ($1) returning id`, [U(2)]))[0].id;
  const c3 = (await q(`insert into public.composer_profiles (profile_id) values ($1) returning id`, [U(3)]))[0].id;
  const c4 = (await q(`insert into public.composer_profiles (profile_id) values ($1) returning id`, [U(4)]))[0].id;
  for (const a of [1, 2, 3]) await q(`insert into public.admins (profile_id) values ($1)`, [U(a)]); // vente d'album : feu vert fermé pendant la bêta
  await q(`insert into public.tracks (id, owner_id, title, mode) values ('s1', $1, 'Studio 1', 'static'), ('s2', $1, 'Studio 2', 'static'), ('c1', $2, 'Coco 1', 'static'), ('c2', $2, 'Coco 2', 'static'), ('x1', $3, 'Autre', 'static')`, [c4, c2, c3]);
  await q(`insert into public.packs (id, owner_id, title, buyable, price_eur_cents) values ('pk', $1, 'Pack', true, 500)`, [c4]);
  await q(`insert into public.pack_tracks (pack_id, track_id, position) values ('pk', 's1', 0), ('pk', 's2', 1)`);
  await q(`insert into public.pack_purchases (studio_id, pack_id, price_paid) values ($1, 'pk', 5)`, [U(1)]);

  // ---- Le studio crée son album avec ses morceaux ----
  await as(1);
  await q(`select public.upsert_studio_album($1::jsonb)`, [J({ id: 'ost', title: 'OST Forêt', priceEurCents: 800, trackIds: ['s1'] })]);
  check('album de studio : vendeur = le compte studio, rôle studio', (await one(`select seller_role from public.albums where id = 'ost'`)) === 'studio' && (await one(`select seller_id from public.albums where id = 'ost'`)) === U(1));
  check('morceau du studio ajouté, marqué comme le sien', (await one(`select added_by from public.album_tracks where album_id = 'ost' and track_id = 's1'`)) === U(1));
  check('un morceau qui n\'est pas dans ses packs : refusé', await fails(`select public.upsert_studio_album($1::jsonb)`, [J({ id: 'ost', title: 'OST Forêt', trackIds: ['s1', 'x1'] })], /ne fait pas partie de tes packs/));
  check('mise en vente sans version officielle : refusée', await fails(`select public.upsert_studio_album($1::jsonb)`, [J({ id: 'ost', title: 'OST Forêt', buyable: true })], /version officielle/));
  await q(`select public.set_album_track_default_settings('ost', 's1', $1::jsonb)`, [J({ ...take, trackId: 's1' })]).catch(() => null);
  await q(`update public.album_tracks set default_settings = $1 where album_id = 'ost' and track_id = 's1'`, [J(take)]);
  await q(`select public.upsert_studio_album($1::jsonb)`, [J({ id: 'ost', title: 'OST Forêt', buyable: true })]);
  check('mise en vente possible avec la version officielle', (await one(`select buyable from public.albums where id = 'ost'`)) === true);

  // ---- Isolation ----
  await as(3);
  check('un autre compte ne peut pas modifier l\'album du studio', await fails(`select public.upsert_studio_album($1::jsonb)`, [J({ id: 'ost', title: 'Vol' })], /Non autorisé/));
  check('un autre compte ne peut pas inviter sur cet album', await fails(`select public.invite_album_contributor('ost', 'x@x.test')`, [], /seul le studio/));

  // ---- Invitation d'un compositeur ----
  await as(1);
  check('adresse invalide : refusée', await fails(`select public.invite_album_contributor('ost', 'nimportequoi')`, [], /invalide/));
  await q(`select public.invite_album_contributor('ost', 'Coco@X.test')`);
  check('le studio voit l\'invité en attente', (await one(`select public.list_album_contributors('ost')`))[0].status === 'pending');
  await as(2);
  const inv = await one(`select public.my_album_invitations()`);
  check('le compositeur voit l\'invitation (e-mail, casse ignorée)', inv.length === 1 && inv[0].albumTitle === 'OST Forêt' && inv[0].studioEmail === 'studio@x.test');
  check('avant d\'accepter : il ne peut pas ajouter de morceaux', await fails(`select public.set_album_contributor_tracks('ost', array['c1'])`, [], /pas compositeur invité/));
  await as(3);
  check('un autre compte ne voit pas l\'invitation', (await one(`select public.my_album_invitations()`)).length === 0);
  await as(2);
  await q(`select public.respond_album_invitation($1, true)`, [inv[0].id]);

  // ---- Le compositeur ajoute SES morceaux ----
  check('il ajoute ses morceaux', (await one(`select public.set_album_contributor_tracks('ost', array['c1', 'c2'])`)).ok === true && (await one(`select count(*)::int from public.album_tracks where album_id = 'ost' and added_by = $1`, [U(2)])) === 2);
  check('un morceau d\'un autre compositeur : refusé', await fails(`select public.set_album_contributor_tracks('ost', array['x1'])`, [], /ton catalogue/));
  check('les morceaux du studio n\'ont pas bougé', (await one(`select count(*)::int from public.album_tracks where album_id = 'ost' and track_id = 's1' and removed_at is null`)) === 1);
  check('album en vente + morceaux sans version officielle : repasse hors vente', (await one(`select buyable from public.albums where id = 'ost'`)) === false);
  await q(`select public.set_album_track_default_settings('ost', 'c1', $1::jsonb)`, [J({ ...take, trackId: 'c1' })]).catch(() => null);
  await q(`update public.album_tracks set default_settings = $1 where album_id = 'ost' and added_by = $2`, [J(take), U(2)]);
  check('il ne peut pas fixer la version officielle d\'un morceau du studio', await fails(`select public.set_album_track_default_settings('ost', 's1', $1::jsonb)`, [J({ ...take, trackId: 's1' })], /introuvable|autre compte|take/i));
  check('il ne peut ni changer le prix ni mettre en vente', await fails(`select public.upsert_studio_album($1::jsonb)`, [J({ id: 'ost', title: 'OST Forêt', priceEurCents: 1 })], /Non autorisé/));
  const mine = await one(`select public.my_album_contributions()`);
  check('ses contributions : l\'album du studio avec ses 2 morceaux', mine.length === 1 && mine[0].tracks.length === 2 && mine[0].studioEmail === 'studio@x.test');

  // ---- Le studio remet en vente, puis sortie libre ----
  await as(1);
  await q(`select public.upsert_studio_album($1::jsonb)`, [J({ id: 'ost', title: 'OST Forêt', buyable: true })]);
  check('le studio remet en vente (tous les morceaux ont une version officielle)', (await one(`select buyable from public.albums where id = 'ost'`)) === true);
  check('le studio qui met à jour ses morceaux ne touche pas ceux de l\'invité', (await q(`select public.upsert_studio_album($1::jsonb)`, [J({ id: 'ost', title: 'OST Forêt', trackIds: ['s1'] })])) && (await one(`select count(*)::int from public.album_tracks where album_id = 'ost' and added_by = $1 and removed_at is null`, [U(2)])) === 2);
  await q(`insert into public.album_purchases (buyer_id, album_id, price_paid) values ($1, 'ost', 8)`, [U(4)]);
  await as(2);
  const left = await one(`select public.leave_album('ost')`);
  check('le compositeur quitte : ses morceaux sont retirés (gardés pour l\'acheteur existant)', left.ok === true && (await one(`select count(*)::int from public.album_tracks where album_id = 'ost' and added_by = $1 and removed_at is not null`, [U(2)])) === 2);
  check('l\'album reste en vente : les morceaux du studio ont une version officielle', left.unpublished === false && (await one(`select buyable from public.albums where id = 'ost'`)) === true);
  check('il n\'est plus contributeur', await fails(`select public.set_album_contributor_tracks('ost', array['c1'])`, [], /pas compositeur invité/));
  await as(1);
  const list = await one(`select public.list_album_contributors('ost')`);
  check('le studio ne voit plus l\'invité parti', list.length === 0);

  // ---- Retrait par le studio ----
  await q(`select public.invite_album_contributor('ost', 'coco@x.test')`);
  await as(2);
  const inv2 = await one(`select public.my_album_invitations()`);
  await q(`select public.respond_album_invitation($1, true)`, [inv2[0].id]);
  await q(`select public.set_album_contributor_tracks('ost', array['c1'])`);
  await as(1);
  const cid = (await one(`select public.list_album_contributors('ost')`))[0].id;
  const rm = await one(`select public.remove_album_contributor($1)`, [cid]);
  check('le studio retire un compositeur : ses morceaux quittent l\'album', rm.ok === true && (await one(`select count(*)::int from public.album_tracks where album_id = 'ost' and added_by = $1 and removed_at is null`, [U(2)])) === 0);
  await as(3);
  check('un autre compte ne peut pas retirer un invité', await fails(`select public.remove_album_contributor($1)`, [cid], /introuvable/));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
