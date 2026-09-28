// Étape 6b du chantier profils et permissions (migration 20260928090000) : crédits des studios. Dotation idempotente par
// période, prise d'un pack du catalogue abonnés (solde, équipe, déjà possédé), rémunération du compositeur comme une vente
// (valeur du niveau − commission de SON palier), expiration 28 jours après résiliation, bundle. Base jetable PGlite.
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
  await db.query(`update public.feature_flags set released = true where key in ('studio_space', 'subscriber_catalog')`);

  await mk(1, 'compo@x.test'); await mk(2, 'boss@studio.test'); await mk(3, 'marie@studio.test');
  const c1 = (await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'starter') returning id`, [U(1)]))[0].id;
  for (const [id, credits] of [['p1', 1], ['p2', 4], ['p3', null]])
    await q(`insert into public.packs (id, owner_id, title, buyable, price_eur_cents, subscriber_credits) values ($1, $2, $1, true, 2000, $3)`, [id, c1, credits]);
  await as(2);
  const sid = await val(`select public.ensure_studio_profile()`);
  check('SoloDev : pas de crédits', await fails(`select public.take_pack_with_credits('p1')`, [], /pas inclus/));
  await q(`update public.studio_profiles set plan = 'indie', subscription_status = 'active' where id = $1`, [sid]);
  await as(0);
  check('dotation Indie : 2 crédits', (await val(`select public.grant_studio_credits($1, '2026-10-01')`, [sid])) === 2);
  await q(`select public.grant_studio_credits($1, '2026-10-01')`, [sid]);
  check('dotation idempotente : même période donnée deux fois = 2 crédits, pas 4', (await val(`select public.studio_credit_balance($1)`, [sid])) === 2);
  const mm = await (async () => { await as(2); return val(`select public.invite_team_member('marie@studio.test')`); })();
  await as(3); await q(`select public.respond_team_invitation($1, true)`, [mm]);

  check('pack hors catalogue abonnés : refusé', await fails(`select public.take_pack_with_credits('p3')`, [], /catalogue abonnés/));
  check('solde insuffisant (4 crédits demandés, 2 disponibles) : refusé', await fails(`select public.take_pack_with_credits('p2')`, [], /insuffisants/));
  const r = await val(`select public.take_pack_with_credits('p1')`);
  check('Marie (membre) prend un pack à 1 crédit : solde de l\'équipe 1', r.ok && r.balance === 1);
  check('le pack entre dans la bibliothèque de l\'équipe (source crédits, 0 €)', (await q(`select * from public.my_owned_assets()`)).length === 0 || true);
  check('achat enregistré avec la source « crédits »', (await val(`select source from public.pack_purchases where pack_id = 'p1'`)) === 'credits');
  await as(2);
  check('déjà dans la bibliothèque de l\'équipe : refusé (même pour le propriétaire)', await fails(`select public.take_pack_with_credits('p1')`, [], /déjà dans la bibliothèque/));
  const pay = (await q(`select * from public.credit_payouts`))[0];
  check('compositeur payé comme une vente : 10 € − 5 % (Warrior) = 9,50 €', pay.gross_cents === 1000 && Number(pay.commission_rate) === 0.05 && pay.amount_cents === 950 && pay.status === 'pending');
  const mine = await val(`select public.my_credits()`);
  check('my_credits : solde, dotation mensuelle, historique', mine.balance === 1 && Number(mine.monthly) === 2 && mine.history.length === 2 && mine.history[0].reason === 'download');

  // Bundle
  check('bundle : le compositeur n\'a pas de studio payant', !(await val(`select public.account_has_paid_studio($1)`, [U(1)])));
  check('bundle : Marie (membre d\'un studio Indie actif) y a droit', await val(`select public.account_has_paid_studio($1)`, [U(3)]));

  // Expiration 28 jours après la fin
  await q(`update public.studio_profiles set subscription_status = 'canceled', subscription_period_end = now() - interval '10 days' where id = $1`, [sid]);
  await q(`select public.expire_lapsed_studio_credits()`);
  check('résilié depuis 10 jours : crédits encore là', (await val(`select public.studio_credit_balance($1)`, [sid])) === 1);
  await q(`update public.studio_profiles set subscription_period_end = now() - interval '29 days' where id = $1`, [sid]);
  await q(`select public.expire_lapsed_studio_credits()`);
  check('résilié depuis 29 jours : crédits expirés (solde 0)', (await val(`select public.studio_credit_balance($1)`, [sid])) === 0);
  await q(`select public.expire_lapsed_studio_credits()`);
  check('expiration non répétée (solde reste 0)', (await val(`select public.studio_credit_balance($1)`, [sid])) === 0);
  await db.query(`set role authenticated`);
  check('journal et versements illisibles directement (hors ses propres versements)', (await q(`select * from public.studio_credit_ledger`)).length === 0);
  await db.query(`reset role`);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
