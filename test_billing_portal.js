// Portail client Stripe (migration 20260928100000, 28/09) : différence de crédits à la montée de palier (une fois par
// période, rien à la descente), état des abonnements du compte (my_billing : propriétaire / membre, résiliation
// programmée), abonnements compositeur déjà payés marqués actifs. Base jetable PGlite.
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
  const mk = async (n, email) => { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), email]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); };
  await db.query(`update public.beta_program set full_access = false`);
  await db.query(`update public.feature_flags set released = true where key in ('studio_space', 'subscriber_catalog')`);

  await mk(1, 'compo@x.test'); await mk(2, 'boss@studio.test'); await mk(3, 'marie@studio.test');
  await q(`insert into public.composer_profiles (profile_id, plan, stripe_subscription_id, stripe_customer_id, subscription_status) values ($1, 'starter', 'sub_c', 'cus_c', 'active')`, [U(1)]);
  await as(2);
  const sid = await val(`select public.ensure_studio_profile()`);
  await q(`update public.studio_profiles set plan = 'indie', subscription_status = 'active', stripe_customer_id = 'cus_s' where id = $1`, [sid]);
  const mm = await val(`select public.invite_team_member('marie@studio.test')`);
  await as(3); await q(`select public.respond_team_invitation($1, true)`, [mm]);
  await as(0);

  // Montée de palier
  await q(`select public.grant_studio_credits($1, '2026-10-01')`, [sid]);
  check('Indie : 2 crédits du mois', (await val(`select public.studio_credit_balance($1)`, [sid])) === 2);
  check('montée Indie → AA : +6 (différence 8 − 2)', (await val(`select public.grant_studio_upgrade_credits($1, 'indie', 'aa', '2026-10-01')`, [sid])) === 6);
  check('solde 8 après la montée', (await val(`select public.studio_credit_balance($1)`, [sid])) === 8);
  check('descente AA → Indie : rien retiré, rien ajouté', (await val(`select public.grant_studio_upgrade_credits($1, 'aa', 'indie', '2026-10-01')`, [sid])) === 0);
  await q(`select public.grant_studio_upgrade_credits($1, 'indie', 'aa', '2026-10-01')`, [sid]);
  check('re-montée dans la même période : pas de nouvelle différence (solde toujours 8)', (await val(`select public.studio_credit_balance($1)`, [sid])) === 8);
  await q(`select public.grant_studio_upgrade_credits($1, 'indie', 'aa', '2026-11-01')`, [sid]);
  check('montée dans une autre période : de nouveau possible (14)', (await val(`select public.studio_credit_balance($1)`, [sid])) === 14);

  // my_billing
  await as(2);
  let b = await val(`select public.my_billing()`);
  check('propriétaire : studio actif, gérable, pas de profil compositeur', b.studio.active && b.studio.isOwner && b.studio.canManage && b.composer === null);
  await as(3);
  b = await val(`select public.my_billing()`);
  check('membre : voit l\'abonnement du studio mais ne peut pas le gérer', b.studio.active && !b.studio.isOwner && !b.studio.canManage);
  await as(1);
  b = await val(`select public.my_billing()`);
  check('compositeur : abonnement Warrior actif, gérable, pas de studio', b.composer.active && b.composer.plan === 'starter' && b.composer.canManage && b.studio === null);
  await as(0);
  await q(`update public.studio_profiles set subscription_cancel_at = '2026-11-01' where id = $1`, [sid]);
  await as(2);
  b = await val(`select public.my_billing()`);
  check('résiliation programmée visible (date de fin)', b.studio.active && String(b.studio.cancelAt).startsWith('2026-11-01'));
  check('my_credits montre aussi la résiliation programmée', String((await val(`select public.my_credits()`)).subscription.cancelAt).startsWith('2026-11-01'));

  await db.query(`set role authenticated`);
  await as(2);
  let refused = false;
  try { await db.query(`select public.grant_studio_upgrade_credits($1, 'indie', 'aa', '2026-12-01')`, [sid]); } catch { refused = true; }
  check('un utilisateur ne peut pas se donner de crédits lui-même', refused);
  await db.query(`reset role`);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
