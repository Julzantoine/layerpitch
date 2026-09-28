// Étape 4b du chantier profils et permissions (migration 20260928050000) : partage d'une vente d'album entre le vendeur
// et ses co-ayants droit acceptés (la part d'un « je reverse moi-même » revient au vendeur), commission du palier du
// vendeur, identité de versement studio, factures par bénéficiaire. Base jetable PGlite.
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
  const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch (e) { return true; } };
  const mk = async (n, email) => { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), email]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); };

  await mk(1, 'vendeur@x.test'); await mk(2, 'studio@x.test'); await mk(3, 'absent@x.test');
  await q(`insert into public.composer_profiles (profile_id, plan, stripe_connect_account_id, stripe_connect_charges_enabled, billing_status, billing_legal_name) values ($1, 'starter', 'acct_1', true, 'particulier', 'Jean')`, [U(1)]);
  await q(`insert into public.studio_profiles (profile_id, plan) values ($1, 'indie')`, [U(2)]);
  await q(`insert into public.albums (id, seller_id, seller_role, title, rights_declaration) values ('al', $1, 'composer', 'OST', 'shared')`, [U(1)]);
  await q(`insert into public.album_rights_holders (album_id, holder_email, holder_profile_id, payout_role, share_bps, status) values
    ('al', 'studio@x.test', $1, 'studio', 3000, 'accepted'), ('al', 'absent@x.test', null, null, 1500, 'self_pay')`, [U(2)]);

  let split = await q(`select * from public.album_sale_split('al')`);
  check('deux bénéficiaires : vendeur puis studio co-ayant droit accepté', split.length === 2 && split[0].is_seller && split[1].role === 'studio');
  check('part vendeur = 70 % (la part du « je reverse moi-même » lui revient), studio 30 %', split[0].share_bps === 7000 && split[1].share_bps === 3000);
  check('compte Stripe du vendeur prêt, profil de facturation rempli', split[0].stripe_account_id === 'acct_1' && split[0].ready === true && split[0].billing_ok === true);
  check('studio pas encore prêt (ni Stripe, ni facturation)', split[1].ready === false && split[1].billing_ok === false);

  await as(2);
  await q(`select public.update_my_studio_billing_profile('professionnel', 'Studio Pixel SAS', '1 rue X', '123', null, true)`);
  await as(0);
  await q(`update public.studio_profiles set stripe_connect_account_id = 'acct_2', stripe_connect_charges_enabled = true where profile_id = $1`, [U(2)]);
  split = await q(`select * from public.album_sale_split('al')`);
  check('studio prêt après son profil de facturation et son compte Stripe', split[1].ready === true && split[1].billing_ok === true && split[1].stripe_account_id === 'acct_2');

  await db.query(`update public.beta_program set full_access = false`);
  check('commission = palier du vendeur (Warrior 5 %)', Number((await q(`select public.album_commission_rate('al') r`))[0].r) === 0.05);
  const s2 = (await q(`select id from public.studio_profiles where profile_id = $1`, [U(2)]))[0].id;
  check('numérotation propre au studio : 1 puis 2', (await q(`select public.next_studio_invoice_number($1) n`, [s2]))[0].n === 1 && (await q(`select public.next_studio_invoice_number($1) n`, [s2]))[0].n === 2);

  // Factures : un document par bénéficiaire et par achat d'album
  await mk(4, 'fan@x.test');
  const ap = (await q(`insert into public.album_purchases (buyer_id, album_id, price_paid, stripe_payment_intent_id) values ($1, 'al', 10, 'pi_1') returning id`, [U(4)]))[0].id;
  const c1 = (await q(`select id from public.composer_profiles where profile_id = $1`, [U(1)]))[0].id;
  const inv = (cols, vals) => q(`insert into public.invoices (${cols}, invoice_number, document_type, pdf_storage_path, seller_snapshot, buyer_snapshot, amount_ttc) values (${vals}, 'N', 'facture', 'p', '{}', '{}', 1)`);
  check('facture d\'album au nom du vendeur compositeur', !(await fails(`insert into public.invoices (album_purchase_id, composer_id, beneficiary_profile_id, invoice_number, document_type, pdf_storage_path, seller_snapshot, buyer_snapshot, amount_ttc) values ($1, $2, $3, 'N1', 'attestation_vente', 'p', '{}', '{}', 7)`, [ap, c1, U(1)])));
  check('facture d\'album au nom du studio co-ayant droit', !(await fails(`insert into public.invoices (album_purchase_id, studio_id, beneficiary_profile_id, invoice_number, document_type, pdf_storage_path, seller_snapshot, buyer_snapshot, amount_ttc) values ($1, $2, $3, 'N2', 'facture', 'p', '{}', '{}', 3)`, [ap, s2, U(2)])));
  check('deux factures pour le même bénéficiaire du même achat : refusé', await fails(`insert into public.invoices (album_purchase_id, studio_id, beneficiary_profile_id, invoice_number, document_type, pdf_storage_path, seller_snapshot, buyer_snapshot, amount_ttc) values ($1, $2, $3, 'N3', 'facture', 'p', '{}', '{}', 3)`, [ap, s2, U(2)]));
  check('document sans achat ou avec deux vendeurs : refusé', await fails(`insert into public.invoices (composer_id, invoice_number, document_type, pdf_storage_path, seller_snapshot, buyer_snapshot, amount_ttc) values ($1, 'N4', 'facture', 'p', '{}', '{}', 1)`, [c1])
    && await fails(`insert into public.invoices (album_purchase_id, composer_id, studio_id, beneficiary_profile_id, invoice_number, document_type, pdf_storage_path, seller_snapshot, buyer_snapshot, amount_ttc) values ($1, $2, $3, $4, 'N5', 'facture', 'p', '{}', '{}', 1)`, [ap, c1, s2, U(4)]));
  await as(2);
  await db.query(`set role authenticated`);
  const seen = await q(`select invoice_number from public.invoices`);
  await db.query(`reset role`);
  check('le studio voit sa facture, pas celle du vendeur', seen.length === 1 && seen[0].invoice_number === 'N2');
  await as(4);
  await db.query(`set role authenticated`);
  const fanSeen = await q(`select invoice_number from public.invoices order by 1`);
  await db.query(`reset role`);
  check('l\'acheteur voit les deux documents de son achat', fanSeen.length === 2);
  await as(0);
  check('fonctions internes fermées aux clients', await (async () => { await db.query(`set role authenticated`); const r = await fails(`select * from public.album_sale_split('al')`); await db.query(`reset role`); return r; })());
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
