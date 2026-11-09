// Lien de relecture client (9/11, migration 20261109030000) : une adresse lisible + un secret (clé magique ou mot de passe) par montage, le client (sans compte) voit les versions sorties du
// brouillon, commente à l'image près, valide ou demande des modifs ; le compositeur lit, répond, marque « traité ». Base jetable PGlite.
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('PGlite indisponible, test ignoré : ' + e.message); return; }
  const db = await freshDb();
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch (e) { return true; } };
  const U = n => '00000000-0000-0000-0000-00000000000' + n;
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [U(1), U(2)]);
  await db.query(`insert into public.profiles (id) values ($1), ($2) on conflict do nothing`, [U(1), U(2)]);
  const owner = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'danny') returning id`, [U(1)]))[0].id;
  await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'autre') returning id`, [U(2)]);
  await db.query(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await db.query(`insert into public.packs (id, owner_id, title) values ('p1', $1, 'Pack')`, [owner]);
  await db.query(`insert into public.composer_videos (id, owner_id, kind, title, base, file) values
    ('b1', $1, 'capture_base', 'Muette', 'https://media.example/video/b1/', 'base.mp4'),
    ('v1', $1, 'capture_audio', 'M1', 'https://media.example/video/v1/', 'a.mp4'),
    ('v2', $1, 'capture_audio', 'M2', 'https://media.example/video/v2/', 'b.mp4'),
    ('v3', $1, 'capture_audio', 'M3', 'https://media.example/video/v3/', 'c.mp4')`, [owner]);
  await db.query(`insert into public.video_captures (id, owner_id, pack_id, title, base_video_id, last_export_video_id) values ('cap1', $1, 'p1', 'Traversée', 'b1', 'v1'), ('cap2', $1, 'p1', 'Autre', null, null)`, [owner]);
  await db.query(`insert into public.video_capture_versions (id, capture_id, owner_id, title, last_export_video_id, review_status) values
    ('verA', 'cap1', $1, 'Musique A', 'v2', 'sent'), ('verB', 'cap1', $1, 'Musique B (brouillon)', 'v3', 'draft')`, [owner]);

  // --- Côté compositeur : créer le lien ---
  const SET = `select public.set_video_review_link($1, $2, $3, $4, $5, $6, false) as l`;
  await as(2);
  check('un autre compte ne peut pas créer le lien', await fails(SET, ['cap1', true, 'traversee', 'magic', null, false]));
  check('un autre compte ne voit pas le lien', (await q(`select public.get_video_review_link('cap1', false) as l`))[0].l === null);
  await as(1);
  check('avant création : pas de lien', (await q(`select public.get_video_review_link('cap1', false) as l`))[0].l === null);
  check('adresse manquante refusée', await fails(SET, ['cap1', true, null, 'magic', null, false]));
  check('adresse invalide refusée (majuscules, espaces, trop courte)', await fails(SET, ['cap1', true, 'ab', 'magic', null, false]) && await fails(SET, ['cap1', true, 'a b c', 'magic', null, false]) && await fails(SET, ['cap1', true, '-x-', 'magic', null, false]));
  check('« relecture » est un nom réservé pour les compositeurs', (await q(`select public.handle_is_reserved('relecture') as r`))[0].r === true);
  const link = (await q(SET, ['cap1', true, ' Traversee-V2 ', 'magic', null, false]))[0].l;
  check('le lien magique est créé : adresse en minuscules, actif, clé longue montrée une fois', link.slug === 'traversee-v2' && link.enabled === true && link.mode === 'magic' && typeof link.secret === 'string' && link.secret.length >= 64);
  const g = (await q(`select public.get_video_review_link('cap1', false) as l`))[0].l;
  check('relire le lien ne redonne JAMAIS la clé', g.slug === 'traversee-v2' && g.mode === 'magic' && g.enabled === true && !('secret' in g) && !('token' in g));
  const stored = (await q(`select secret_hash, iterations from public.video_review_links where capture_id = 'cap1'`))[0];
  check('seule l\'empreinte est gardée (pas la clé en clair)', stored.secret_hash && stored.secret_hash !== link.secret && stored.iterations === 1);
  const S = link.secret;
  await as(1);
  await db.query(`insert into public.video_captures (id, owner_id, pack_id, title) values ('cap3', $1, 'p1', 'Troisième')`, [owner]);
  check('adresse déjà prise par un autre montage refusée', await fails(SET, ['cap3', true, 'traversee-v2', 'magic', null, false]));
  const renamedSame = (await q(SET, ['cap1', null, 'traversee-v2', null, null, false]))[0].l;
  check('réenregistrer le même nom sur le même montage : accepté, clé inchangée (pas renvoyée)', renamedSame.slug === 'traversee-v2' && renamedSame.secret === null);

  // --- Côté client : sans compte ---
  await as(null);
  check('accès : le mode est connu avant le secret (rien d\'autre)', JSON.stringify((await q(`select public.get_video_review_access('traversee-v2') as r`))[0].r) === '{"mode":"magic"}' && (await q(`select public.get_video_review_access('inconnu') as r`))[0].r === null);
  check('mauvaise clé : rien (sans erreur)', (await q(`select public.get_video_review('traversee-v2', 'nimporte-quoi') as r`))[0].r === null);
  check('mauvais nom : rien', (await q(`select public.get_video_review('inconnu', $1) as r`, [S]))[0].r === null);
  const r = (await q(`select public.get_video_review('traversee-v2', $1) as r`, [S]))[0].r;
  check('le client voit la vidéo muette, l\'original et la version sortie du brouillon', r.title === 'Traversée' && r.baseUrl.endsWith('base.mp4') && r.versions.length === 2 && r.versions[0].key === 'original' && r.versions[1].key === 'verA');
  check('le brouillon n\'est pas montré au client', !r.versions.some(v => v.key === 'verB'));
  check('la version montrée porte son statut', r.versions[1].status === 'sent');
  const ADD = `select public.add_video_review_comment('traversee-v2', $1, $2, $3, $4, $5, $6) as r`;
  const c1 = (await q(ADD, [S, 'verA', 12.5, '  Camille ', 'Le drone est trop fort ici', null]))[0].r;
  check('le client commente à un instant précis, prénom nettoyé', c1.ok === true);
  check('commentaire sur un brouillon refusé', await fails(ADD, [S, 'verB', 3, 'Camille', 'x', null]));
  check('commentaire sans prénom refusé', await fails(ADD, [S, 'verA', 3, '   ', 'x', null]));
  check('commentaire vide refusé', await fails(ADD, [S, 'verA', 3, 'Camille', '   ', null]));
  check('mauvaise clé : commentaire refusé SANS erreur (ok:false), pour que le frein compte', (await q(ADD, ['pas-la-clé', 'verA', 3, 'Camille', 'salut', null]))[0].r.ok === false);
  check('instant hors limites refusé', await fails(ADD, [S, 'verA', -1, 'Camille', 'x', null]));
  await q(ADD, [S, 'original', 4, 'Camille', 'Début parfait', null]);
  const r2 = (await q(`select public.get_video_review('traversee-v2', $1) as r`, [S]))[0].r;
  const first = r2.comments.find(c => c.body.startsWith('Le drone'));
  check('les commentaires reviennent au client, rangés par version et instant', r2.comments.length === 2 && first.versionKey === 'verA' && Number(first.t) === 12.5 && first.author === 'Camille' && first.fromOwner === false && first.resolved === false);
  const rep = (await q(ADD, [S, 'original', 0, 'Camille', 'Précision', first.id]))[0].r;
  const r3 = (await q(`select public.get_video_review('traversee-v2', $1) as r`, [S]))[0].r;
  const reply = r3.comments.find(c => c.id === rep.id);
  check('une réponse reprend la version et l\'instant de son parent', reply.versionKey === 'verA' && Number(reply.t) === 12.5 && reply.parentId === first.id);
  const DEC = `select public.set_video_review_decision('traversee-v2', $1, $2, $3, $4) as r`;
  check('décision sur un brouillon refusée', await fails(DEC, [S, 'verB', 'approved', 'Camille']));
  check('décision invalide refusée', await fails(DEC, [S, 'verA', 'sent', 'Camille']));
  check('décision avec une mauvaise clé : refusée sans erreur', (await q(DEC, ['faux', 'verA', 'approved', 'Camille']))[0].r.ok === false && (await q(`select review_status from public.video_capture_versions where id = 'verA'`))[0].review_status === 'sent');
  await q(DEC, [S, 'verA', 'changes_requested', 'Camille']);
  const st = (await q(`select review_status, review_status_by from public.video_capture_versions where id = 'verA'`))[0];
  check('« Demander des modifs » : le statut change tout seul, avec le prénom', st.review_status === 'changes_requested' && st.review_status_by === 'Camille');

  // --- Frein : 10 secrets faux par 10 minutes ---
  const fl = (await q(`select count(*)::int as n from public.video_review_access_failures where capture_id = 'cap1'`))[0].n;
  check('les essais ratés sont comptés', fl >= 3);
  for (let i = fl; i < 10; i++) await q(`select public.get_video_review('traversee-v2', $1) as r`, ['faux' + i]);
  check('après 10 essais ratés : même la bonne clé est bloquée (trop d\'essais)', await fails(`select public.get_video_review('traversee-v2', $1)`, [S]));
  await db.query(`delete from public.video_review_access_failures`);
  check('le frein se relâche', (await q(`select public.get_video_review('traversee-v2', $1) as r`, [S]))[0].r !== null);

  // --- Retour au compositeur ---
  await as(1);
  const list = (await q(`select public.list_video_review_comments('cap1', false) as l`))[0].l;
  check('le compositeur lit tous les commentaires', list.length === 3);
  const vs = (await q(`select public.list_video_capture_versions('cap1', false) as l`))[0].l;
  check('la liste des versions montre qui a changé le statut', vs.find(v => v.id === 'verA').statusBy === 'Camille' && vs.find(v => v.id === 'verA').status === 'changes_requested');
  await db.query(`select public.set_video_capture_version_status('verA', 'sent', false)`);
  check('si le compositeur change le statut, « par qui » est effacé', (await q(`select review_status_by from public.video_capture_versions where id = 'verA'`))[0].review_status_by === null);
  await db.query(`select public.reply_video_review_comment($1, 'Je baisse le drone', 'Danny', false)`, [first.id]);
  const list2 = (await q(`select public.list_video_review_comments('cap1', false) as l`))[0].l;
  check('la réponse du compositeur est marquée comme la sienne', list2.some(c => c.fromOwner && c.author === 'Danny' && c.parentId === first.id));
  await db.query(`select public.resolve_video_review_comment($1, true, false)`, [first.id]);
  check('« traité » est enregistré', (await q(`select public.list_video_review_comments('cap1', false) as l`))[0].l.find(c => c.id === first.id).resolved === true);
  await as(2);
  check('un autre compte ne peut ni répondre ni résoudre ni supprimer', await fails(`select public.reply_video_review_comment($1, 'x', 'x', false)`, [first.id])
    && await fails(`select public.resolve_video_review_comment($1, true, false)`, [first.id]) && await fails(`select public.delete_video_review_comment($1, false)`, [first.id]));
  await as(1);

  // --- Lien désactivé / clé renouvelée / mot de passe / renommé ---
  await db.query(SET.replace('as l', ''), ['cap1', false, null, null, null, false]);
  await as(null);
  check('lien désactivé : plus rien pour le client (accès, lecture, écriture)', (await q(`select public.get_video_review_access('traversee-v2') as r`))[0].r === null && (await q(`select public.get_video_review('traversee-v2', $1) as r`, [S]))[0].r === null && (await q(ADD, [S, 'verA', 1, 'C', 'x', null]))[0].r.ok === false);
  await as(1);
  const rot = (await q(SET, ['cap1', true, null, null, null, true]))[0].l;
  await as(null);
  check('clé renouvelée : l\'ancienne ne marche plus, la nouvelle oui', rot.secret && rot.secret !== S && (await q(`select public.get_video_review('traversee-v2', $1) as r`, [S]))[0].r === null && (await q(`select public.get_video_review('traversee-v2', $1) as r`, [rot.secret]))[0].r !== null);
  await as(1);
  check('mot de passe trop court refusé', await fails(SET, ['cap1', null, null, 'password', 'abc', false]));
  check('passer en mot de passe sans en donner un : refusé', await fails(SET, ['cap1', null, null, 'password', null, false]));
  const pw = (await q(SET, ['cap1', null, null, 'password', 'sesame-2026', false]))[0].l;
  check('mode mot de passe : aucune clé renvoyée, mode enregistré', pw.mode === 'password' && pw.secret === null);
  await as(null);
  check('mot de passe : le mode est annoncé', (await q(`select public.get_video_review_access('traversee-v2') as r`))[0].r.mode === 'password');
  check('mot de passe : le bon ouvre, l\'ancienne clé magique non', (await q(`select public.get_video_review('traversee-v2', 'sesame-2026') as r`))[0].r !== null && (await q(`select public.get_video_review('traversee-v2', $1) as r`, [rot.secret]))[0].r === null);
  const pwStored = (await q(`select iterations from public.video_review_links where capture_id = 'cap1'`))[0];
  check('mot de passe : salé et haché en 10 000 tours', pwStored.iterations === 10000);
  await as(1);
  const ren = (await q(SET, ['cap1', null, 'nouvelle-adresse', null, null, false]))[0].l;
  await as(null);
  check('renommer : l\'ancienne adresse meurt, la nouvelle marche avec le même mot de passe', ren.slug === 'nouvelle-adresse' && (await q(`select public.get_video_review_access('traversee-v2') as r`))[0].r === null && (await q(`select public.get_video_review('nouvelle-adresse', 'sesame-2026') as r`))[0].r !== null);

  // --- Quota ---
  let quota = false;
  for (let i = 0; i < 32 && !quota; i++) { try { await db.query(`select public.add_video_review_comment('nouvelle-adresse', 'sesame-2026', 'original', 1, 'Spam', 'x', null)`); } catch (e) { quota = true; } }
  check('quota : trop de commentaires d\'affilée sont refusés', quota);

  // --- Suppression ---
  await as(1);
  await db.query(`select public.delete_video_review_comment($1, false)`, [first.id]);
  check('supprimer un commentaire emporte ses réponses', (await q(`select count(*)::int as n from public.video_review_comments where id = $1 or parent_id = $1`, [first.id]))[0].n === 0);
  // PGlite tourne en superutilisateur (pas de simulation de rôles) : on vérifie plutôt dans le catalogue que les tables sont fermées
  // (sécurité de ligne activée, AUCUNE règle d'accès direct), comme video_captures.
  const rls = await q(`select relname, relrowsecurity from pg_class where relname in ('video_review_links', 'video_review_comments', 'video_review_access_failures') order by relname`);
  const pols = await q(`select count(*)::int as n from pg_policies where tablename in ('video_review_links', 'video_review_comments', 'video_review_access_failures')`);
  check('tables fermées : sécurité de ligne activée, aucune règle d\'accès direct', rls.length === 3 && rls.every(x => x.relrowsecurity) && pols[0].n === 0);
  const anonGrants = await q(`select count(*)::int as n from information_schema.routine_privileges where grantee = 'anon' and routine_name in ('get_video_review_link','set_video_review_link','list_video_review_comments','reply_video_review_comment','resolve_video_review_comment','delete_video_review_comment','video_review_capture')`);
  check('les fonctions du compositeur ne sont pas ouvertes à anon', anonGrants[0].n === 0);

  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
  process.exit(failures ? 1 : 0);
})();
