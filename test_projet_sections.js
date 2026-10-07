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
