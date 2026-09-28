// Étape 5a du chantier profils et permissions (migration 20260928060000) : équipes studio. Quota de membres (propriétaire
// compris), invitation par e-mail, un compte = un seul studio, palier et bibliothèque partagés, packs custom communs,
// retrait, départ, transfert de propriété, isolation. Base jetable PGlite.
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
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const fails = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const mk = async (n, email) => { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), email]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); };
  await db.query(`update public.beta_program set full_access = false`);
  await db.query(`update public.feature_flags set released = true where key = 'studio_space'`);

  await mk(1, 'boss@studio.test'); await mk(2, 'marie@studio.test'); await mk(3, 'paul@studio.test'); await mk(4, 'autre@x.test'); await mk(9, 'compo@x.test');
  await as(1);
  const sid = await val(`select public.ensure_studio_profile()`);
  check('SoloDev : 1 membre (le propriétaire) → aucune invitation possible', await fails(`select public.invite_team_member('marie@studio.test')`, [], /Limite atteinte : 1/));
  await q(`update public.studio_profiles set plan = 'indie' where id = $1`, [sid]);
  const m2 = await val(`select public.invite_team_member('Marie@Studio.test')`);
  await q(`select public.invite_team_member('paul@studio.test')`);
  check('Indie : 3 membres propriétaire compris → 4e refusé', await fails(`select public.invite_team_member('autre@x.test')`, [], /Limite atteinte : 3/));
  check('inviter deux fois la même adresse : refusé', await fails(`select public.invite_team_member('marie@studio.test')`, [], /déjà invitée/));

  await as(2);
  const inv = await val(`select public.my_team_invitations()`);
  check('Marie voit son invitation', inv.length === 1 && inv[0].ownerEmail === 'boss@studio.test');
  await as(4);
  check('un autre compte ne peut pas accepter l\'invitation de Marie', await fails(`select public.respond_team_invitation($1, true)`, [m2], /introuvable/));
  await as(2);
  await q(`select public.respond_team_invitation($1, true)`, [m2]);
  check('Marie membre : son studio = celui de l\'équipe', (await val(`select public.current_studio_id()`)) === sid);
  check('Marie hérite du palier du studio (Indie)', (await q(`select plan from public.entitlement($1, 'custom_packs')`, [U(2)]))[0].plan === 'indie');
  check('Marie n\'a pas de studio à elle : ensure_studio_profile rend celui de l\'équipe', (await val(`select public.ensure_studio_profile()`)) === sid && (await val(`select count(*)::int from public.studio_profiles`)) === 1);

  // Bibliothèque partagée : Paul (pas encore membre) et Marie achètent, le propriétaire voit tout
  const c9 = (await q(`insert into public.composer_profiles (profile_id) values ($1) returning id`, [U(9)]))[0].id;
  await q(`insert into public.packs (id, owner_id, title) values ('pA', $1, 'Pack A')`, [c9]);
  await q(`insert into public.tracks (id, owner_id, title, mode) values ('t1', $1, 'M', 'static')`, [c9]);
  await q(`insert into public.pack_tracks (pack_id, track_id, position) values ('pA', 't1', 0)`);
  await q(`insert into public.pack_purchases (studio_id, pack_id, price_paid) values ($1, 'pA', 10)`, [U(2)]);
  await as(1);
  check('le propriétaire voit l\'achat de Marie dans la bibliothèque de l\'équipe', (await val(`select public.my_team_purchases()`)).length === 1 && (await q(`select * from public.my_owned_assets()`)).length === 1);
  check('le propriétaire peut capturer ce pack (l\'équipe le possède)', await val(`select public.team_owns_pack('pA')`));
  const cp = (await val(`select public.upsert_my_custom_pack('{"name":"Commun","items":[{"kind":"track","refId":"t1"}]}'::jsonb)`)).id;
  await as(2);
  check('pack custom créé par le propriétaire visible par Marie', (await val(`select public.list_my_custom_packs()`)).some(c => c.id === cp));
  await as(4);
  check('un compte extérieur ne voit rien de l\'équipe', (await val(`select public.my_team_purchases()`)).length === 0 && !(await val(`select public.team_owns_pack('pA')`)));

  // Un compte qui a déjà son studio ne peut pas rejoindre une autre équipe
  await q(`select public.ensure_studio_profile()`);
  await as(1);
  await q(`update public.studio_profiles set plan = 'aa' where id = $1`, [sid]);
  const m4id = await val(`select public.invite_team_member('autre@x.test')`);
  await as(4);
  check('un compte qui a son propre studio ne peut pas rejoindre une équipe', await fails(`select public.respond_team_invitation($1, true)`, [m4id], /un seul studio/));

  // Départ, retrait, transfert de propriété
  await as(3);
  const m3 = (await val(`select public.my_team_invitations()`))[0].id;
  await q(`select public.respond_team_invitation($1, true)`, [m3]);
  await as(2);
  check('un membre ne peut pas retirer un autre membre', await fails(`select public.remove_team_member($1)`, [m3], /introuvable/));
  await as(1);
  await q(`select public.transfer_studio_ownership($1)`, [m2]);
  check('transfert : Marie propriétaire, l\'ancien propriétaire devient membre du même studio', (await val(`select profile_id from public.studio_profiles where id = $1`, [sid])) === U(2) && (await val(`select public.current_studio_id()`)) === sid);
  const team = await val(`select public.my_team()`);
  check('my_team : le propriétaire n\'est plus « moi », liste cohérente', team.isOwner === false && team.owner.email === 'marie@studio.test');
  const meRow = team.members.find(m => m.me);
  await q(`select public.remove_team_member($1)`, [meRow.id]);
  check('quitter l\'équipe : plus de studio', (await val(`select public.current_studio_id()`)) === null);
  await as(0);
  await db.query(`set role authenticated`);
  check('table des membres illisible directement', (await q(`select * from public.studio_members`)).length === 0);
  await db.query(`reset role`);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
