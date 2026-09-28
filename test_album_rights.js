// Étape 4a du chantier profils et permissions (migration 20260928040000) : co-ayants droit d'un album (D4-D6).
// Déclaration, avertissement, invitations, acceptation avec casquette, refus qui bloque, injoignable réglé par le
// vendeur, vente conditionnée, isolation. Base jetable PGlite.
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

  await mk(1, 'vendeur@x.test'); await mk(2, 'coco@x.test'); await mk(3, 'autre@x.test');
  const c1 = (await q(`insert into public.composer_profiles (profile_id) values ($1) returning id`, [U(1)]))[0].id;
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]); // vente d'album : feu vert fermé pendant la bêta
  await q(`insert into public.tracks (id, owner_id, title, mode) values ('t1', $1, 'M', 'static')`, [c1]);
  await as(1);
  const take = { kind: 'layerpitch-take', v: 1 };
  await q(`select public.upsert_album($1::jsonb)`, [JSON.stringify({ id: 'al', title: 'OST', priceEurCents: 500, trackIds: ['t1'] })]);
  await q(`update public.album_tracks set default_settings = $1 where album_id = 'al'`, [JSON.stringify(take)]);
  const sell = () => q(`select public.upsert_album($1::jsonb)`, [JSON.stringify({ id: 'al', title: 'OST', buyable: true })]);
  const setRights = (decl, holders, ack) => q(`select public.set_album_rights('al', $1, $2::jsonb, $3) r`, [decl, JSON.stringify(holders), ack]);

  check('seul propriétaire (par défaut) : mise en vente possible', (await sell()) && (await one(`select buyable from public.albums where id = 'al'`)) === true);
  check('droits partagés sans reconnaître l\'avertissement : refusé', await fails(`select public.set_album_rights('al', 'shared', '[{"email":"coco@x.test","shareBps":3000}]'::jsonb, false)`, [], /avertissement/));
  check('part totale de 100 % : refusée (il faut une part au vendeur)', await fails(`select public.set_album_rights('al', 'shared', '[{"email":"coco@x.test","shareBps":10000}]'::jsonb, true)`, [], /Part invalide|moins de 100/));
  check('se déclarer soi-même co-ayant droit : refusé', await fails(`select public.set_album_rights('al', 'shared', '[{"email":"vendeur@x.test","shareBps":3000}]'::jsonb, true)`, [], /propre co-ayant/));
  const r1 = (await setRights('shared', [{ email: 'Coco@X.test', shareBps: 3000 }, { email: 'absent@x.test', shareBps: 1000 }], true))[0].r;
  check('droits partagés : 2 co-ayants droit en attente, part vendeur 60 %, 2 invitations à envoyer', r1.holders.length === 2 && r1.holders.every(h => h.status === 'pending') && r1.sellerShareBps === 6000 && r1.toInvite.length === 2);
  check('album en vente retiré de la vente tant que les réponses manquent', r1.unlisted === true && (await one(`select buyable from public.albums where id = 'al'`)) === false);
  check('remise en vente refusée tant qu\'un co-ayant droit n\'a pas répondu', await fails(`select public.upsert_album($1::jsonb)`, [JSON.stringify({ id: 'al', title: 'OST', buyable: true })], /co-ayant droit/));

  // Le co-ayant droit voit son invitation (par son e-mail) et accepte avec la casquette compositeur.
  await as(2);
  const inv = await one(`select public.my_rights_invitations()`);
  check('invitation visible par le bon compte (e-mail, casse ignorée), avec titre et part', inv.length === 1 && inv[0].albumTitle === 'OST' && inv[0].shareBps === 3000);
  await as(3);
  check('un autre compte ne voit pas l\'invitation', (await one(`select public.my_rights_invitations()`)).length === 0);
  check('un autre compte ne peut pas y répondre', await fails(`select public.respond_rights_invitation($1, true, 'composer')`, [inv[0].id], /introuvable/));
  await as(2);
  await q(`select public.respond_rights_invitation($1, true, 'composer')`, [inv[0].id]);
  check('accepté, casquette compositeur enregistrée, rattaché au compte', (await q(`select status, payout_role, holder_profile_id from public.album_rights_holders where id = $1`, [inv[0].id]))[0].status === 'accepted');
  check('répondre deux fois : refusé', await fails(`select public.respond_rights_invitation($1, false)`, [inv[0].id], /déjà répondu/));

  // Le second est injoignable : le vendeur le règle lui-même, la vente ouvre.
  await as(1);
  const absent = r1.holders.find(h => h.email === 'absent@x.test');
  await q(`select public.mark_rights_holder_self_pay($1)`, [absent.id]);
  check('injoignable réglé par le vendeur : vente possible', !!(await sell()) && (await one(`select buyable from public.albums where id = 'al'`)) === true);
  await as(3);
  check('un autre compte ne peut pas régler un co-ayant droit à la place du vendeur', await fails(`select public.mark_rights_holder_self_pay($1)`, [absent.id], /autre vendeur/));

  // L'injoignable arrive plus tard et REFUSE : vente bloquée et retirée.
  await mk(4, 'absent@x.test');
  await as(4);
  await q(`select public.respond_rights_invitation($1, false)`, [absent.id]);
  check('refus : album retiré de la vente', (await one(`select buyable from public.albums where id = 'al'`)) === false);
  await as(1);
  check('après un refus : remise en vente impossible', await fails(`select public.upsert_album($1::jsonb)`, [JSON.stringify({ id: 'al', title: 'OST', buyable: true })], /co-ayant droit/));
  check('après un refus : « je reverse moi-même » impossible', await fails(`select public.mark_rights_holder_self_pay($1)`, [absent.id], /refus/));
  const r2 = (await setRights('shared', [{ email: 'coco@x.test', shareBps: 3000 }, { email: 'absent@x.test', shareBps: 2000 }], true))[0].r;
  check('nouvelle répartition : l\'accord existant (part inchangée) est gardé, la nouvelle part repasse en attente', r2.holders.find(h => h.email === 'coco@x.test').status === 'accepted' && r2.holders.find(h => h.email === 'absent@x.test').status === 'pending' && r2.toInvite.length === 1);
  await setRights('sole', [], false);
  check('retour à « seul propriétaire » : co-ayants droit effacés, vente possible', (await one(`select count(*)::int from public.album_rights_holders`)) === 0 && !!(await sell()));

  // Isolation et accès direct
  await as(3);
  check('un autre compte ne lit pas les droits de l\'album', await fails(`select public.list_album_rights('al')`, [], /autre vendeur/));
  await db.query(`set role authenticated`);
  check('lecture directe de la table impossible', (await q(`select * from public.album_rights_holders`)).length === 0);
  await db.query(`reset role`);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
