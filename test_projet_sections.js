// Sections d'un Projet (migration 20261007030000) : droits, feu vert, arbre, déplacements sans cycle, objets dans plusieurs sections,
// suppression qui garde les objets. Base jetable PGlite.
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

  await mk(1, 'admin@x.test'); await mk(2, 'membre@x.test'); await mk(3, 'intrus@x.test');
  await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro')`, [U(1)]);
  await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro')`, [U(2)]);
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await q(`update public.feature_flags set released = true where key in ('projects', 'studio_space')`);
  await as(1);
  const pid = await val(`select public.create_project('Hollow Manor')`);
  const pid2 = await val(`select public.create_project('Autre Projet')`);
  const inv = await val(`select public.invite_project_member($1, 'membre@x.test')`, [pid]);
  await as(2); await q(`select public.respond_project_invitation($1, true)`, [inv]);
  await as(1);
  const asset = async (p, url) => (await val(`select public.add_project_asset($1, $2::jsonb)`, [p, JSON.stringify({ kind: 'link', url })])).id;
  const a1 = await asset(pid, 'https://example.com/a'), a2 = await asset(pid, 'https://example.com/b'), a3 = await asset(pid, 'https://example.com/c');
  const other = await asset(pid2, 'https://example.com/z');
  const list = async p => val(`select public.list_project_sections($1)`, [p]);
  const sec = async (p, t, parent) => (await val(`select public.create_project_section($1, $2, $3)`, [p, t, parent || null])).id;

  // Feu vert
  await db.query(`update public.feature_flags set released = false where key = 'project_sections'`);
  await as(2);
  check('feu vert fermé : un membre non admin ne voit pas les sections', await fails(`select public.list_project_sections($1)`, [pid], /pas encore ouvertes/));
  check('feu vert fermé : ni ne crée', await fails(`select public.create_project_section($1, 'x')`, [pid], /pas encore ouvertes/));
  await as(1);
  const niv1 = await sec(pid, 'Niveau 1');
  check('admin : section créée malgré le feu vert fermé', !!niv1);
  await db.query(`update public.feature_flags set released = true where key = 'project_sections'`);

  // Arbre
  await as(2);
  const foret = await sec(pid, 'Forêt', niv1), chateau = await sec(pid, 'Château', niv1), boss = await sec(pid, 'Boss', chateau);
  let l = await list(pid);
  check('un membre crée des sections (arbre sur trois niveaux)', l.sections.length === 4 && l.sections.find(s => s.id === boss).parentId === chateau);
  check('nouvelles sections à la fin de leur fratrie', l.sections.find(s => s.id === foret).position === 0 && l.sections.find(s => s.id === chateau).position === 1);
  check('nom vide refusé', await fails(`select public.create_project_section($1, '   ')`, [pid], /1 à 120/));
  await as(1);
  check('parent d\'un autre Projet refusé', await fails(`select public.create_project_section($1, 'x', $2)`, [pid2, niv1], /parente introuvable/));
  await as(2);
  await q(`select public.rename_project_section($1, 'Forêt sombre')`, [foret]);
  check('renommer', (await list(pid)).sections.find(s => s.id === foret).title === 'Forêt sombre');
  check('renommer avec un nom vide refusé', await fails(`select public.rename_project_section($1, '')`, [foret], /1 à 120/));

  // Déplacements
  check('déplacer une section dans elle-même refusé', await fails(`select public.move_project_section($1, $1)`, [chateau], /elle-même/));
  check('déplacer une section dans une de ses sous-sections refusé (cycle)', await fails(`select public.move_project_section($1, $2)`, [niv1, boss], /elle-même/));
  await q(`select public.move_project_section($1, $2, 0)`, [chateau, niv1]);
  l = await list(pid);
  check('réordonner : Château passe avant Forêt', l.sections.find(s => s.id === chateau).position === 0 && l.sections.find(s => s.id === foret).position === 1);
  await q(`select public.move_project_section($1, null)`, [boss]);
  l = await list(pid);
  check('déplacer à la racine', l.sections.find(s => s.id === boss).parentId === null);
  await q(`select public.move_project_section($1, $2)`, [boss, foret]);
  check('déplacer sous une autre section', (await list(pid)).sections.find(s => s.id === boss).parentId === foret);

  // Objets
  await q(`select public.add_assets_to_section($1, $2)`, [foret, [a1, a2]]);
  await q(`select public.add_assets_to_section($1, $2)`, [chateau, [a2]]);
  l = await list(pid);
  check('un objet dans plusieurs sections', l.links.filter(x => x.assetId === a2).length === 2 && l.links.filter(x => x.assetId === a1).length === 1);
  await q(`select public.add_assets_to_section($1, $2)`, [foret, [a1]]);
  check('ajouter deux fois ne double pas le lien', (await list(pid)).links.filter(x => x.assetId === a1).length === 1);
  check('un objet d\'un autre Projet refusé', await fails(`select public.add_assets_to_section($1, $2)`, [foret, [other]], /Objet introuvable/));
  await q(`select public.set_asset_sections($1, $2)`, [a3, [chateau, boss]]);
  check('fixer les sections d\'un objet', (await list(pid)).links.filter(x => x.assetId === a3).length === 2);
  await q(`select public.set_asset_sections($1, $2)`, [a3, [boss]]);
  l = await list(pid);
  check('fixer remplace la liste', l.links.filter(x => x.assetId === a3).length === 1 && l.links.find(x => x.assetId === a3).sectionId === boss);
  check('une section d\'un autre Projet refusée', await fails(`select public.set_asset_sections($1, $2)`, [a3, [await (async () => { await as(1); return sec(pid2, 'Ailleurs'); })()]], /Section introuvable/));
  await as(2);
  await q(`select public.remove_assets_from_section($1, $2)`, [foret, [a1]]);
  l = await list(pid);
  check('retirer un objet d\'une section (devient non classé)', l.links.filter(x => x.assetId === a1).length === 0);
  check('l\'objet reste dans la réserve', Number(await val(`select count(*) from public.project_assets where id = $1`, [a1])) === 1);

  // Suppression
  await q(`select public.delete_project_section($1)`, [foret]);
  l = await list(pid);
  check('supprimer : la section disparaît', !l.sections.find(s => s.id === foret));
  check('supprimer : ses sous-sections remontent d\'un cran', l.sections.find(s => s.id === boss).parentId === niv1);
  check('supprimer : ses objets restent dans la réserve', Number(await val(`select count(*) from public.project_assets where project_id = $1`, [pid])) === 3 && l.links.filter(x => x.assetId === a2).length === 1);

  // Moodboard par section (migration 20261007040000)
  await as(2);
  const pins = async () => val(`select public.list_section_pins($1)`, [pid]);
  await q(`select public.pin_asset_in_section($1, $2, true)`, [chateau, a2]);
  await q(`select public.pin_asset_in_section($1, $2, true)`, [chateau, a3]);
  let pl = await pins();
  check('épingler dans une section : ordre à la suite', pl.length === 2 && pl.find(x => x.assetId === a2).position === 0 && pl.find(x => x.assetId === a3).position === 1);
  check('épingler range aussi l\'objet dans la section', (await list(pid)).links.some(x => x.sectionId === chateau && x.assetId === a3));
  await q(`select public.pin_asset_in_section($1, $2, true)`, [boss, a2]);
  check('même objet épinglé dans deux Moodboards (épingles indépendantes)', (await pins()).filter(x => x.assetId === a2).length === 2);
  await q(`select public.reorder_section_pins($1, $2)`, [chateau, [a3, a2]]);
  pl = await pins();
  check('réordonner le Moodboard d\'une section', pl.find(x => x.sectionId === chateau && x.assetId === a3).position === 0 && pl.find(x => x.sectionId === chateau && x.assetId === a2).position === 1);
  await q(`select public.star_section_pin($1, $2, true)`, [chateau, a3]);
  check('★ propre à ce Moodboard', (await pins()).find(x => x.sectionId === chateau && x.assetId === a3).starred === true && (await pins()).find(x => x.sectionId === boss && x.assetId === a2).starred === false);
  check('★ sur un objet non épinglé refusé', await fails(`select public.star_section_pin($1, $2, true)`, [boss, a3], /pas épinglé/));
  check('objet d\'un autre Projet refusé', await fails(`select public.pin_asset_in_section($1, $2, true)`, [chateau, other], /Objet introuvable/));
  await q(`select public.pin_asset_in_section($1, $2, false)`, [boss, a2]);
  check('retirer l\'épingle d\'un Moodboard ne touche pas l\'autre', (await pins()).filter(x => x.assetId === a2).length === 1 && (await pins()).some(x => x.sectionId === chateau && x.assetId === a2));
  await q(`select public.remove_assets_from_section($1, $2)`, [chateau, [a2]]);
  check('sortir un objet d\'une section retire son épingle', !(await pins()).some(x => x.sectionId === chateau && x.assetId === a2));
  await q(`select public.set_asset_sections($1, $2)`, [a3, [boss]]);
  check('fixer les sections retire les épingles des sections quittées', !(await pins()).some(x => x.assetId === a3));
  await as(3);
  check('un intrus ne voit pas les Moodboards de section', await fails(`select public.list_section_pins($1)`, [pid], /introuvable/));
  await as(1);
  await q(`select public.pin_asset_in_section($1, $2, true)`, [boss, a1]);
  await q(`select public.delete_project_section($1)`, [boss]);
  check('supprimer la section emporte ses épingles, pas l\'objet', Number(await val(`select count(*) from public.project_section_pins where asset_id = $1`, [a1])) === 0 && Number(await val(`select count(*) from public.project_assets where id = $1`, [a1])) === 1);

  // Tchat par section (migration 20261007050000)
  const chat = await sec(pid, 'Discussion Niveau 2');
  const gen = Number(await val(`select count(*) from public.project_messages where project_id = $1`, [pid]));
  await as(1);
  await q(`select public.post_section_message($1, 'Bonjour le niveau 2')`, [chat]);
  await as(2);
  let st = await val(`select public.section_chat_state($1)`, [pid]);
  check('non suivi : aucun compteur de non lus', st.length === 0);
  await q(`select public.set_section_follow($1, true)`, [chat]);
  await as(1);
  await q(`select public.post_section_message($1, 'Un deuxième message')`, [chat]);
  await as(2);
  st = await val(`select public.section_chat_state($1)`, [pid]);
  check('suivi : les messages d\'après comptent comme non lus', st.length === 1 && st[0].unread === 1);
  await q(`select public.mark_section_read($1)`, [chat]);
  check('marquer lu remet à zéro', (await val(`select public.section_chat_state($1)`, [pid]))[0].unread === 0);
  await q(`select public.post_section_message($1, 'Ma réponse')`, [chat]);
  check('écrire = suivre ; ses propres messages ne comptent pas', (await val(`select public.section_chat_state($1)`, [pid]))[0].unread === 0);
  const ms = await val(`select public.list_section_messages($1)`, [chat]);
  check('messages du canal, du plus récent au plus ancien', ms.length === 3 && ms[0].body === 'Ma réponse' && ms[0].mine === true && ms[2].mine === false);
  check('le tchat général ne voit pas les messages de section', Number(await val(`select count(*) from public.project_messages where project_id = $1`, [pid])) === gen && (await val(`select public.list_project_messages($1)`, [pid])).length === gen);
  check('message vide refusé', await fails(`select public.post_section_message($1, '  ')`, [chat], /vide/));
  check('on ne supprime pas le message d\'un autre', await fails(`select public.delete_section_message($1)`, [ms[2].id], /introuvable/));
  await q(`select public.delete_section_message($1)`, [ms[0].id]);
  check('on supprime son propre message', (await val(`select public.list_section_messages($1)`, [chat])).length === 2);
  await as(1);
  await q(`select public.delete_section_message($1)`, [ms[1].id]);
  check('l\'administrateur du Projet supprime un message de membre', (await val(`select public.list_section_messages($1)`, [chat])).length === 1);
  await q(`select public.set_section_follow($1, false)`, [chat]);
  check('ne plus suivre', (await val(`select public.section_chat_state($1)`, [pid])).length === 0);
  await db.query(`update public.feature_flags set released = false where key = 'project_sections'`);
  await as(2);
  check('feu vert fermé : canal de section fermé aussi', await fails(`select public.list_section_messages($1)`, [chat], /pas encore ouvertes/));
  await db.query(`update public.feature_flags set released = true where key = 'project_sections'`);
  await as(3);
  check('un intrus ne lit ni n\'écrit dans un canal', await fails(`select public.list_section_messages($1)`, [chat], /introuvable/) && await fails(`select public.post_section_message($1, 'x')`, [chat], /introuvable/));
  await as(1);
  await q(`select public.delete_project_section($1)`, [chat]);
  check('supprimer la section supprime sa discussion', Number(await val(`select count(*) from public.project_section_messages`)) === 0);

  // Pièces jointes dans un canal + cloche (migration 20261007070000)
  await as(1);
  const ch2 = await sec(pid, 'Canal fichiers');
  const fl = await val(`select public.reserve_project_file($1, 'plan.png', 1234)`, [pid]); await q(`select public.complete_project_file($1)`, [fl.fileId]);
  await as(2);
  const pm = await val(`select public.post_section_message($1, '', $2::jsonb)`, [ch2, JSON.stringify([{ fileId: fl.fileId, title: 'Plan du niveau' }])]);
  const lm = (await val(`select public.list_section_messages($1)`, [ch2]))[0];
  check('message avec seulement une pièce jointe accepté', !!pm && lm.attachments.length === 1 && lm.attachments[0].title === 'Plan du niveau' && lm.attachments[0].kind === 'image');
  const asId = lm.attachments[0].assetId;
  check('la pièce jointe devient un objet du Projet', Number(await val(`select count(*) from public.project_assets where id = $1 and project_id = $2`, [asId, pid])) === 1);
  check('…et est rangée automatiquement dans la section du canal', (await list(pid)).links.some(x => x.sectionId === ch2 && x.assetId === asId));
  check('le tchat général ne la voit pas', (await val(`select public.list_project_messages($1)`, [pid])).length === gen);
  await q(`select public.post_section_message($1, 'Voir le plan', $2::jsonb)`, [ch2, JSON.stringify([{ fileId: fl.fileId }])]);
  check('même fichier joint deux fois : un seul objet', Number(await val(`select count(*) from public.project_assets where file_id = $1`, [fl.fileId])) === 1);
  check('fichier d\'un autre Projet refusé', await fails(`select public.post_section_message($1, 'x', '[{"fileId":"00000000-0000-0000-0000-0000000000ff"}]'::jsonb)`, [ch2], /introuvable/));
  await q(`select public.delete_section_message($1)`, [pm]);
  check('supprimer le message garde l\'objet', Number(await val(`select count(*) from public.project_assets where id = $1`, [asId])) === 1);
  // cloche
  await as(1);
  await q(`select public.set_section_follow($1, true)`, [ch2]);
  check('cloche : rien tant que personne d\'autre n\'écrit', (await val(`select public.my_section_updates()`)).length === 0);
  await as(2);
  await q(`select public.post_section_message($1, 'Nouveau message pour la cloche')`, [ch2]);
  await as(1);
  const up2 = await val(`select public.my_section_updates()`);
  check('cloche : le canal suivi apparaît avec son compteur et le dernier message', up2.length === 1 && up2[0].unread === 1 && up2[0].sectionTitle === 'Canal fichiers' && up2[0].lastMessage.excerpt === 'Nouveau message pour la cloche');
  await as(2);
  check('cloche : mes propres messages ne me sont pas signalés', (await val(`select public.my_section_updates()`)).length === 0);
  await as(1);
  await q(`select public.mark_section_read($1)`, [ch2]);
  check('cloche : lu = plus rien', (await val(`select public.my_section_updates()`)).length === 0);
  await as(3);
  check('cloche : un non-membre ne voit rien', (await val(`select public.my_section_updates()`)).length === 0);
  await as(1);

  // Lien section ↔ carte (migration 20261007060000)
  await as(1);
  const mapId = await val(`select (public.save_project_map($1, $2::jsonb))->>'id'`, [pid, JSON.stringify({ title: 'Niveau 1', data: { nodes: [], edges: [] } })]);
  const lk = await sec(pid, 'Avec carte');
  check('une section n\'a pas de carte au départ', (await list(pid)).sections.find(s => s.id === lk).mapId === null);
  await as(2);
  await q(`select public.set_section_map($1, $2)`, [lk, mapId]);
  check('relier une section à une carte', (await list(pid)).sections.find(s => s.id === lk).mapId === mapId);
  check('une carte d\'un autre Projet refusée', await (async () => { await as(1); const m2 = await val(`select (public.save_project_map($1, $2::jsonb))->>'id'`, [pid2, JSON.stringify({ title: 'Autre', data: { nodes: [], edges: [] } })]); return fails(`select public.set_section_map($1, $2)`, [lk, m2], /Carte introuvable/); })());
  await q(`select public.delete_project_map($1)`, [mapId]);
  check('supprimer la carte retire le lien', (await list(pid)).sections.find(s => s.id === lk).mapId === null);

  // Intrus et nettoyage
  await as(3);
  check('un intrus ne voit rien', await fails(`select public.list_project_sections($1)`, [pid], /introuvable/));
  check('un intrus ne peut pas supprimer', await fails(`select public.delete_project_section($1)`, [chateau], /introuvable/));
  check('un intrus ne peut pas classer un objet', await fails(`select public.set_asset_sections($1, $2)`, [a2, [chateau]], /introuvable/));
  await as(1);
  await q(`select public.delete_project_asset($1)`, [a2]);
  check('supprimer un objet de la réserve retire ses liens', (await list(pid)).links.filter(x => x.assetId === a2).length === 0);
  await q(`select public.delete_project($1)`, [pid]);
  check('supprimer le Projet emporte ses sections', Number(await val(`select count(*) from public.project_sections where project_id = $1`, [pid])) === 0);

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon');
  process.exit(failures ? 1 : 0);
})();
