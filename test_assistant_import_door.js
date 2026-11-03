// Porte « import par assistant » (migration 20261102010000) : jetons personnels, imports en attente, quotas, journal, débit, purge,
// et surtout les attaques prévues dans la fiche de sécurité : jeton volé/expiré/révoqué, accès aux données d'un autre compte,
// chemins fournis par le client, noms piégés, fichiers trop gros, saturation, appel direct des fonctions réservées à la porte.
// Base jetable PGlite.
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const crypto = require('crypto');
  const db = await freshDb();
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const one = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const fails = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const sha = t => crypto.createHash('sha256').update(t).digest('hex');
  const MB = 1024 * 1024;

  // ---- Jeu d'essai : 1 = compositeur, 2 = autre compositeur, 3 = admin ----
  for (const [n, e] of [[1, 'un'], [2, 'deux'], [3, 'admin']]) {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), e + '@x.test']);
    await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]);
  }
  const c1 = (await q(`insert into public.composer_profiles (profile_id, handle) values ($1, 'un') returning id`, [U(1)]))[0].id;
  const c2 = (await q(`insert into public.composer_profiles (profile_id, handle) values ($1, 'deux') returning id`, [U(2)]))[0].id;
  await q(`insert into public.admins (profile_id) values ($1)`, [U(3)]);
  await q(`insert into public.composer_profiles (profile_id, handle) values ($1, 'admin')`, [U(3)]);

  // ---- Feu vert : fermé = seul un admin peut créer un jeton ----
  await as(1);
  check('feu vert fermé : un compositeur ne peut pas créer de jeton', await fails(`select public.create_assistant_token('essai')`, [], /not_released/));
  await as(3);
  const adminTok = await one(`select public.create_assistant_token('admin')`);
  check('feu vert fermé : un admin peut', adminTok && adminTok.token && adminTok.token.startsWith('lpa_'));
  await q(`update public.feature_flags set released = true where key = 'assistant_import'`);

  // ---- Jetons ----
  await as(1);
  const t1 = await one(`select public.create_assistant_token('Mon Mac')`);
  check('jeton : préfixe lpa_ et longueur (4 + 64)', /^lpa_[0-9a-f]{64}$/.test(t1.token));
  check('jeton : expire dans environ 90 jours', Math.abs(new Date(t1.expires_at) - Date.now() - 90 * 86400000) < 3600000);
  const row = (await q(`select * from public.assistant_tokens where id = $1`, [t1.id]))[0];
  check('jeton : seule l\'empreinte SHA-256 est stockée, jamais le jeton', row.token_hash === sha(t1.token) && !JSON.stringify(row).includes(t1.token) && row.token_prefix === t1.token.slice(0, 12));
  const listed = JSON.stringify(await one(`select public.list_my_assistant_tokens()`));
  check('liste : prefixe et dates, jamais le jeton ni son empreinte', listed.includes(row.token_prefix) && !listed.includes(t1.token) && !listed.includes(row.token_hash));
  const revokeSpare = id => one(`select public.revoke_assistant_token($1)`, [id]);
  const t30 = await one(`select public.create_assistant_token('court', 30)`);
  check('durée choisie : 30 jours', Math.abs(new Date(t30.expires_at) - Date.now() - 30 * 86400000) < 3600000);
  check('durée choisie : 0 et 366 jours refusés', await fails(`select public.create_assistant_token('x', 0)`, [], /bad_duration/) && await fails(`select public.create_assistant_token('x', 366)`, [], /bad_duration/));
  const myStatus = await one(`select public.my_assistant_status()`);
  check('Mon compte : état ouvert avec la liste des jetons et les limites', myStatus.open === true && myStatus.tokens.length === 2 && myStatus.limits.token_days_max === 365 && myStatus.limits.max_active_tokens === 10 && !JSON.stringify(myStatus).includes(t1.token));
  await revokeSpare(t30.id);
  for (let i = 0; i < 9; i++) await one(`select public.create_assistant_token($1)`, ['t' + i]);
  check('plafond : 10 jetons actifs au plus', await fails(`select public.create_assistant_token('de trop')`, [], /too_many_tokens/));

  const resolved = await one(`select public.assistant_resolve_token($1)`, [sha(t1.token)]);
  check('résolution : l\'empreinte du jeton donne le bon compositeur', resolved && resolved.composer_id === c1 && resolved.scope === 'import');
  check('résolution : un jeton inconnu ne donne rien', (await one(`select public.assistant_resolve_token($1)`, [sha('lpa_inconnu')])) === null);
  check('dernière utilisation notée', (await one(`select last_used_at is not null from public.assistant_tokens where id = $1`, [t1.id])) === true);

  // Un autre compte ne peut ni voir ni révoquer mon jeton
  await as(2);
  check('autre compte : liste vide', (await one(`select jsonb_array_length(public.list_my_assistant_tokens())`)) === 0);
  check('autre compte : ne peut pas révoquer mon jeton', (await one(`select public.revoke_assistant_token($1)`, [t1.id])) === false);
  check('autre compte : mon jeton fonctionne toujours', (await one(`select public.assistant_resolve_token($1)`, [sha(t1.token)])) !== null);
  await as(1);

  // Expiré, révoqué, feu vert refermé (coupure)
  const tExp = await one(`select public.create_assistant_token('expire')`).catch(async () => null);
  await q(`update public.assistant_tokens set expires_at = now() - interval '1 minute' where label = 't0'`);
  const t0hash = (await q(`select token_hash from public.assistant_tokens where label = 't0'`))[0].token_hash;
  check('expiré : refusé', (await one(`select public.assistant_resolve_token($1)`, [t0hash])) === null);
  check('révocation par le propriétaire', (await one(`select public.revoke_assistant_token($1)`, [t1.id])) === true);
  check('révoqué : refusé', (await one(`select public.assistant_resolve_token($1)`, [sha(t1.token)])) === null);
  const t2 = await one(`select public.create_assistant_token('Portable')`).catch(() => null);
  const t2tok = t2 ? t2.token : null;
  check('un jeton se recrée après révocation (place libérée)', !!t2tok);
  await q(`update public.feature_flags set released = false where key = 'assistant_import'`);
  check('coupure : feu vert refermé = jeton refusé pour un non-admin', (await one(`select public.assistant_resolve_token($1)`, [sha(t2tok)])) === null);
  await q(`update public.feature_flags set released = true where key = 'assistant_import'`);
  check('feu vert rouvert : le jeton remarche', (await one(`select public.assistant_resolve_token($1)`, [sha(t2tok)])) !== null);
  check('révocation générale : réservée aux admins', await fails(`select public.admin_revoke_all_assistant_tokens()`, [], /admin_only/));

  // ---- Débit ----
  check('débit : 3 appels permis sur limite 3', (await one(`select public.assistant_check_rate('b', 3, 60)`)) && (await one(`select public.assistant_check_rate('b', 3, 60)`)) && (await one(`select public.assistant_check_rate('b', 3, 60)`)));
  check('débit : le 4e est refusé', (await one(`select public.assistant_check_rate('b', 3, 60)`)) === false);
  await q(`update public.assistant_rate_limit set window_start = now() - interval '2 minutes' where bucket_key = 'b'`);
  check('débit : la fenêtre se renouvelle', (await one(`select public.assistant_check_rate('b', 3, 60)`)) === true);

  // ---- Début d'import : validation et quotas ----
  const plan = { mode: 'embranchement-vertical', files: [{ name: 'a.wav', role: 'loop' }] };
  const begin = (composer, title, p, files) => db.query(`select public.assistant_begin_import($1, null, $2, $3::jsonb, $4::jsonb) as r`, [composer, title, JSON.stringify(p), JSON.stringify(files)]).then(r => r.rows[0].r);
  const ok = await begin(c1, 'Monte en l\'air', plan, [{ name: '#1 Everything is fine_120bpm_18M_intro2M.wav', size: 30 * MB }, { name: 'Transition #1.wav', size: 5 * MB }]);
  check('import : accepté, 2 fichiers, chemins fabriqués par le serveur', ok.files.length === 2 && ok.files.every(f => new RegExp(`^incoming/${c1}/${ok.import_id}/[0-9a-f-]{36}\\.wav$`).test(f.path)));
  check('import : le nom envoyé n\'apparaît jamais dans le chemin', ok.files.every(f => !f.path.includes('Transition') && !f.path.includes('Everything')));
  const evil = await begin(c1, 'x', plan, [{ name: '../../etc/pass\u0007wd\u001b/..\\x.WAV', size: MB }]);
  check('nom piégé : séparateurs et caractères de contrôle retirés, chemin intact', !/[\\/\u0001-\u001f]/.test(evil.files[0].name) && evil.files[0].path.startsWith(`incoming/${c1}/`) && !evil.files[0].path.includes('..'));
  const bad = async (files, p, re) => fails(`select public.assistant_begin_import($1, null, 't', $2::jsonb, $3::jsonb)`, [c1, JSON.stringify(p || plan), JSON.stringify(files)], re);
  check('refus : fichier qui n\'est pas un WAV', await bad([{ name: 'virus.exe', size: MB }], null, /bad_file_name/));
  check('refus : nom vide ou réduit à l\'extension', await bad([{ name: '.wav', size: MB }], null, /bad_file_name/));
  check('refus : taille nulle ou négative', await bad([{ name: 'a.wav', size: 0 }], null, /file_too_big/) && await bad([{ name: 'a.wav', size: -5 }], null, /file_too_big/));
  check('refus : fichier de plus de 150 Mo', await bad([{ name: 'a.wav', size: 151 * MB }], null, /file_too_big/));
  check('refus : 61 fichiers', await bad(Array.from({ length: 61 }, (_, i) => ({ name: `f${i}.wav`, size: MB })), null, /too_many_files/));
  check('refus : liste vide ou mal formée', await bad([], null, /no_files/) && await bad([{ name: 'a.wav', size: 'beaucoup' }], null, /bad_file/));
  check('refus : import de plus de 1 Go', await bad(Array.from({ length: 8 }, (_, i) => ({ name: `f${i}.wav`, size: 140 * MB })), null, /import_too_big/));
  check('refus : plan avec un mode inconnu ou qui n\'est pas un objet', await bad([{ name: 'a.wav', size: MB }], { mode: 'drop table' }, /bad_plan/) && await bad([{ name: 'a.wav', size: MB }], [1, 2], /bad_plan/));
  check('refus : plan trop gros (> 64 Ko)', await bad([{ name: 'a.wav', size: MB }], { mode: 'vertical', blob: 'x'.repeat(70000) }, /bad_plan/));
  check('refus : compositeur inconnu', await fails(`select public.assistant_begin_import($1, null, 't', $2::jsonb, $3::jsonb)`, ['00000000-0000-0000-0000-0000000000ff', JSON.stringify(plan), JSON.stringify([{ name: 'a.wav', size: MB }])], /unknown_composer/));

  // Quotas du compte : 5 imports en attente au plus ; 3 Go au plus
  await q(`delete from public.pending_imports where composer_id = $1`, [c1]);
  const big = Array.from({ length: 7 }, (_, i) => ({ name: `s${i}.wav`, size: 140 * MB }));
  await begin(c1, 'g1', plan, big); await begin(c1, 'g2', plan, big); await begin(c1, 'g3', plan, big);
  check('quota du compte : 3 Go en attente au plus (le 4e import de ~1 Go est refusé)', await bad(big, null, /account_quota/));
  await q(`delete from public.pending_imports where composer_id = $1`, [c1]);
  for (let i = 0; i < 5; i++) await begin(c1, 'p' + i, plan, [{ name: 'a.wav', size: MB }]);
  check('quota : 5 imports en attente au plus', await bad([{ name: 'a.wav', size: MB }], null, /too_many_imports/));
  await q(`delete from public.pending_imports where composer_id = $1`, [c1]);

  // ---- Vérification des fichiers, étapes d'un import ----
  const imp = await begin(c1, 'Vrai import', plan, [{ name: 'a.wav', size: MB }, { name: 'b.wav', size: MB }]);
  const checked = (comp, imp_, f, v) => one(`select public.assistant_file_checked($1, $2, $3, $4)`, [comp, imp_, f, v]);
  check('fichier vérifié 1/2 : l\'import reste en cours', (await checked(c1, imp.import_id, imp.files[0].id, true)) === 'uploading');
  check('un autre compte ne peut pas marquer mes fichiers', (await checked(c2, imp.import_id, imp.files[1].id, true)) === null);
  as(1);
  check('fichier vérifié 2/2 : l\'import est prêt', (await checked(c1, imp.import_id, imp.files[1].id, true)) === 'ready');
  const imp2 = await begin(c1, 'Piégé', plan, [{ name: 'a.wav', size: MB }, { name: 'b.wav', size: MB }]);
  await checked(c1, imp2.import_id, imp2.files[0].id, true);
  check('un fichier invalide fait échouer l\'import', (await checked(c1, imp2.import_id, imp2.files[1].id, false)) === 'failed');
  const st = await one(`select public.assistant_import_status($1, $2)`, [c1, imp.import_id]);
  check('statut : état et fichiers, sans chemin', st.status === 'ready' && st.files.length === 2 && !JSON.stringify(st).includes('incoming/'));
  check('statut : invisible pour un autre compte', (await one(`select public.assistant_import_status($1, $2)`, [c2, imp.import_id])) === null);

  // ---- Côté Backstage ----
  await as(1);
  const mine = await one(`select public.list_my_pending_imports()`);
  check('Backstage : seul l\'import prêt apparaît, avec ses fichiers mais sans chemin R2', mine.length === 1 && mine[0].id === imp.import_id && mine[0].files.length === 2 && !JSON.stringify(mine).includes('incoming/'));
  await as(2);
  check('Backstage : un autre compte ne voit rien', (await one(`select jsonb_array_length(public.list_my_pending_imports())`)) === 0);
  check('Backstage : un autre compte ne peut ni ajouter ni écarter mon import', (await one(`select public.mark_pending_import_added($1)`, [imp.import_id])) === false && (await one(`select public.discard_pending_import($1)`, [imp.import_id])) === false);
  check('liens de lecture : refusés pour un import qui n\'est pas le mien', (await one(`select jsonb_array_length(public.assistant_import_files_for_download($1, $2))`, [c2, imp.import_id])) === 0);
  check('liens de lecture : refusés tant que l\'import n\'est pas prêt', (await one(`select jsonb_array_length(public.assistant_import_files_for_download($1, $2))`, [c1, imp2.import_id])) === 0);
  check('liens de lecture : possibles pour le propriétaire d\'un import prêt', (await one(`select jsonb_array_length(public.assistant_import_files_for_download($1, $2))`, [c1, imp.import_id])) === 2);
  await as(1);
  check('Backstage : « Ajouter » marque l\'import (une seule fois)', (await one(`select public.mark_pending_import_added($1)`, [imp.import_id])) === true && (await one(`select public.mark_pending_import_added($1)`, [imp.import_id])) === false);
  check('Backstage : un import ajouté disparaît de la liste', (await one(`select jsonb_array_length(public.list_my_pending_imports())`)) === 0);

  // ---- Purge ----
  const toPurge = async () => q(`select * from public.assistant_files_to_purge(100)`);
  check('purge : un import ajouté depuis moins d\'une heure n\'est pas encore purgé', !(await toPurge()).some(r => r.import_id === imp.import_id));
  await q(`update public.pending_imports set added_at = now() - interval '2 hours' where id = $1`, [imp.import_id]);
  check('purge : un import ajouté depuis plus d\'une heure l\'est', (await toPurge()).filter(r => r.import_id === imp.import_id).length === 2);
  await q(`update public.pending_imports set expires_at = now() - interval '1 day' where id = $1`, [imp2.import_id]);
  check('purge : un import échoué et expiré l\'est aussi', (await toPurge()).filter(r => r.import_id === imp2.import_id).length === 2);
  await q(`select public.assistant_mark_purged($1)`, [imp.import_id]);
  check('purge : un import marqué purgé ne revient plus', !(await toPurge()).some(r => r.import_id === imp.import_id));

  // ---- Journal : jamais de secret ----
  await q(`select public.assistant_log($1, null, 'begin_import', true, '{"files":2}'::jsonb)`, [c1]);
  const logs = JSON.stringify(await q(`select * from public.assistant_audit_log`));
  check('journal : des entrées, mais ni jeton ni empreinte', logs.includes('token_created') && logs.includes('begin_import') && !logs.includes(t1.token) && !logs.includes(row.token_hash));

  // ---- Droits : la porte n'est pas appelable par l'API publique ----
  const asRole = async (role, sql, args) => { await db.query(`set role ${role}`); try { return await fails(sql, args); } finally { await db.query('reset role'); } };
  const doorCalls = [
    [`select public.assistant_resolve_token('x')`], [`select public.assistant_check_rate('x', 1, 1)`],
    [`select public.assistant_begin_import(null, null, 't', '{}'::jsonb, '[]'::jsonb)`], [`select public.assistant_file_checked(null, null, 'x', true)`],
    [`select public.assistant_import_status(null, null)`], [`select public.assistant_import_files_for_download(null, null)`],
    [`select * from public.assistant_files_to_purge(1)`], [`select public.assistant_mark_purged(null)`], [`select public.assistant_housekeeping()`],
    [`select public.assistant_log(null, null, 'x', true, '{}'::jsonb)`],
  ];
  for (const role of ['authenticated', 'anon']) {
    let all = true; for (const [sql] of doorCalls) all = all && await asRole(role, sql);
    check(`droits : les fonctions de la porte sont interdites au rôle ${role}`, all);
  }
  check('droits : un visiteur sans compte ne peut pas créer de jeton', await asRole('anon', `select public.create_assistant_token('x')`));
  let tablesClosed = true;
  for (const t of ['assistant_tokens', 'pending_imports', 'assistant_audit_log', 'assistant_rate_limit']) {
    tablesClosed = tablesClosed && await asRole('authenticated', `select * from public.${t}`) && await asRole('anon', `select * from public.${t}`);
    tablesClosed = tablesClosed && await asRole('authenticated', `delete from public.${t}`);
  }
  check('droits : aucune des 4 tables n\'est lisible ni modifiable par l\'API REST', tablesClosed);
  const rls = await q(`select relname, relrowsecurity from pg_class where relname in ('assistant_tokens','pending_imports','assistant_audit_log','assistant_rate_limit')`);
  const policies = await q(`select tablename from pg_policies where tablename in ('assistant_tokens','pending_imports','assistant_audit_log','assistant_rate_limit')`);
  check('RLS activée sur les 4 tables, sans aucune policy', rls.length === 4 && rls.every(r => r.relrowsecurity) && policies.length === 0);

  // ---- Entretien : nettoyage, suppression de compte ----
  await q(`insert into public.assistant_audit_log (at, action) values (now() - interval '100 days', 'vieux')`);
  await q(`select public.assistant_housekeeping()`);
  check('entretien : le journal de plus de 90 jours est purgé', (await one(`select count(*)::int from public.assistant_audit_log where action = 'vieux'`)) === 0);
  await q(`delete from public.composer_profiles where id = $1`, [c2]);
  check('suppression de compte : la zone d\'attente du compositeur est mise en file d\'effacement R2', (await one(`select count(*)::int from public.account_deletion_files where bucket = 'private' and prefix = $1`, [`incoming/${c2}/`])) === 1);
  const limits = await one(`select public.assistant_limits()`);
  check('limites annoncées : 150 Mo, 1 Go, 3 Go, 14 jours, 90 jours', limits.max_file_bytes === 150 * MB && limits.max_import_bytes === 1024 * MB && limits.max_account_bytes === 3072 * MB && limits.pending_days === 14 && limits.token_days === 90);

  if (failures) { console.log(failures + ' échec(s)'); process.exit(1); }
  console.log('Porte « import par assistant » : tout est vert.');
})();
