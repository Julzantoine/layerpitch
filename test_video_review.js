// Lien de relecture client (9/11, migration 20261109020000) : un lien secret par montage, le client (sans compte) voit les versions sorties du
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
  await as(2);
  check('un autre compte ne peut pas créer le lien', await fails(`select public.set_video_review_link('cap1', true, false, false)`));
  check('un autre compte ne voit pas le lien', (await q(`select public.get_video_review_link('cap1', false) as l`))[0].l === null);
  await as(1);
  check('avant création : pas de lien', (await q(`select public.get_video_review_link('cap1', false) as l`))[0].l === null);
  const link = (await q(`select public.set_video_review_link('cap1', true, false, false) as l`))[0].l;
  check('le lien est créé, actif, avec un jeton long', link.enabled === true && typeof link.token === 'string' && link.token.length >= 64);
  check('relire le lien donne le même jeton', (await q(`select public.get_video_review_link('cap1', false) as l`))[0].l.token === link.token);
  const T = link.token;

  // --- Côté client : sans compte ---
  await as(null);
  check('mauvais jeton : rien', (await q(`select public.get_video_review('nimporte-quoi') as r`))[0].r === null);
  const r = (await q(`select public.get_video_review($1) as r`, [T]))[0].r;
  check('le client voit la vidéo muette, l\'original et la version sortie du brouillon', r.title === 'Traversée' && r.baseUrl.endsWith('base.mp4') && r.versions.length === 2 && r.versions[0].key === 'original' && r.versions[1].key === 'verA');
  check('le brouillon n\'est pas montré au client', !r.versions.some(v => v.key === 'verB'));
  check('la version montrée porte son statut', r.versions[1].status === 'sent');
  const c1 = (await q(`select public.add_video_review_comment($1, 'verA', 12.5, '  Camille ', 'Le drone est trop fort ici', null) as r`, [T]))[0].r;
  check('le client commente à un instant précis, prénom nettoyé', c1.ok === true);
  check('commentaire sur un brouillon refusé', await fails(`select public.add_video_review_comment($1, 'verB', 3, 'Camille', 'x', null)`, [T]));
  check('commentaire sans prénom refusé', await fails(`select public.add_video_review_comment($1, 'verA', 3, '   ', 'x', null)`, [T]));
  check('commentaire vide refusé', await fails(`select public.add_video_review_comment($1, 'verA', 3, 'Camille', '   ', null)`, [T]));
  check('jeton invalide : commentaire refusé', await fails(`select public.add_video_review_comment('x', 'verA', 3, 'Camille', 'salut', null)`));
  check('instant hors limites refusé', await fails(`select public.add_video_review_comment($1, 'verA', -1, 'Camille', 'x', null)`, [T]));
  await db.query(`select public.add_video_review_comment($1, 'original', 4, 'Camille', 'Début parfait', null)`, [T]);
  const r2 = (await q(`select public.get_video_review($1) as r`, [T]))[0].r;
  const first = r2.comments.find(c => c.body.startsWith('Le drone'));
  check('les commentaires reviennent au client, rangés par version et instant', r2.comments.length === 2 && first.versionKey === 'verA' && Number(first.t) === 12.5 && first.author === 'Camille' && first.fromOwner === false && first.resolved === false);
  const rep = (await q(`select public.add_video_review_comment($1, 'original', 0, 'Camille', 'Précision', $2) as r`, [T, first.id]))[0].r;
  const r3 = (await q(`select public.get_video_review($1) as r`, [T]))[0].r;
  const reply = r3.comments.find(c => c.id === rep.id);
  check('une réponse reprend la version et l\'instant de son parent', reply.versionKey === 'verA' && Number(reply.t) === 12.5 && reply.parentId === first.id);
  check('décision sur un brouillon refusée', await fails(`select public.set_video_review_decision($1, 'verB', 'approved', 'Camille')`, [T]));
  check('décision invalide refusée', await fails(`select public.set_video_review_decision($1, 'verA', 'sent', 'Camille')`, [T]));
  await db.query(`select public.set_video_review_decision($1, 'verA', 'changes_requested', 'Camille')`, [T]);
  const st = (await q(`select review_status, review_status_by from public.video_capture_versions where id = 'verA'`))[0];
  check('« Demander des modifs » : le statut change tout seul, avec le prénom', st.review_status === 'changes_requested' && st.review_status_by === 'Camille');

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

  // --- Lien désactivé / renouvelé ---
  await db.query(`select public.set_video_review_link('cap1', false, false, false)`);
  await as(null);
  check('lien désactivé : plus rien pour le client', (await q(`select public.get_video_review($1) as r`, [T]))[0].r === null && await fails(`select public.add_video_review_comment($1, 'verA', 1, 'C', 'x', null)`, [T]));
  await as(1);
  const rot = (await q(`select public.set_video_review_link('cap1', true, true, false) as l`))[0].l;
  await as(null);
  check('lien renouvelé : l\'ancien jeton ne marche plus, le nouveau si', rot.token !== T && (await q(`select public.get_video_review($1) as r`, [T]))[0].r === null && (await q(`select public.get_video_review($1) as r`, [rot.token]))[0].r !== null);

  // --- Quota ---
  await as(null);
  let quota = false;
  for (let i = 0; i < 32 && !quota; i++) { try { await db.query(`select public.add_video_review_comment($1, 'original', 1, 'Spam', 'x', null)`, [rot.token]); } catch (e) { quota = true; } }
  check('quota : trop de commentaires d\'affilée sont refusés', quota);

  // --- Suppression ---
  await as(1);
  await db.query(`select public.delete_video_review_comment($1, false)`, [first.id]);
  check('supprimer un commentaire emporte ses réponses', (await q(`select count(*)::int as n from public.video_review_comments where id = $1 or parent_id = $1`, [first.id]))[0].n === 0);
  // PGlite tourne en superutilisateur (pas de simulation de rôles) : on vérifie plutôt dans le catalogue que les tables sont fermées
  // (sécurité de ligne activée, AUCUNE règle d'accès direct), comme video_captures.
  const rls = await q(`select relname, relrowsecurity from pg_class where relname in ('video_review_links', 'video_review_comments') order by relname`);
  const pols = await q(`select count(*)::int as n from pg_policies where tablename in ('video_review_links', 'video_review_comments')`);
  check('tables fermées : sécurité de ligne activée, aucune règle d\'accès direct', rls.length === 2 && rls.every(x => x.relrowsecurity) && pols[0].n === 0);
  const anonGrants = await q(`select count(*)::int as n from information_schema.routine_privileges where grantee = 'anon' and routine_name in ('get_video_review_link','set_video_review_link','list_video_review_comments','reply_video_review_comment','resolve_video_review_comment','delete_video_review_comment')`);
  check('les fonctions du compositeur ne sont pas ouvertes à anon', anonGrants[0].n === 0);

  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
  process.exit(failures ? 1 : 0);
})();
