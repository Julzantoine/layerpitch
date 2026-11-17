// Onglet « Tâches » d'un Projet (migration 20261104020000) : feu vert, droits, champs vérifiés contre le Projet, ordre,
// cochage, suppression réservée à l'auteur et aux admins, notification d'assignation et cloche, traces dans Activité. Base jetable PGlite.
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

  await mk(1, 'admin@x.test'); await mk(2, 'membre@x.test'); await mk(3, 'intrus@x.test'); await mk(4, 'deux@x.test');
  for (const n of [1, 2, 4]) await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro')`, [U(n)]);
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await q(`update public.feature_flags set released = true where key in ('projects', 'studio_space', 'project_sections', 'level_map')`);
  await as(1);
  const pid = await val(`select public.create_project('Hollow Manor')`);
  const pid2 = await val(`select public.create_project('Autre Projet')`);
  for (const [n, email] of [[2, 'membre@x.test'], [4, 'deux@x.test']]) {
    const inv = await val(`select public.invite_project_member($1, $2)`, [pid, email]);
    await as(n); await q(`select public.respond_project_invitation($1, true)`, [inv]); await as(1);
  }
  const asset = (await val(`select public.add_project_asset($1, $2::jsonb)`, [pid, JSON.stringify({ kind: 'link', url: 'https://example.com/a' })])).id;
  const otherAsset = (await val(`select public.add_project_asset($1, $2::jsonb)`, [pid2, JSON.stringify({ kind: 'link', url: 'https://example.com/z' })])).id;
  const sec = (await val(`select public.create_project_section($1, 'Forêt')`, [pid])).id;
  const otherSec = (await val(`select public.create_project_section($1, 'Ailleurs')`, [pid2])).id;
  const map = (await val(`select public.save_project_map($1, $2::jsonb)`, [pid, JSON.stringify({ title: 'Niveau 1', data: { nodes: [], edges: [] } })]));
  const mapId = map && (map.id || map);
  const list = async p => val(`select public.list_project_tasks($1)`, [p]);
  const create = async (p, obj) => (await val(`select public.create_project_task($1, $2::jsonb)`, [p, JSON.stringify(obj)])).id;

  // Feu vert
  await q(`update public.feature_flags set released = false where key = 'project_tasks'`);
  await as(2);
  check('feu vert fermé : un membre ne voit pas les tâches', await fails(`select public.list_project_tasks($1)`, [pid], /pas encore ouvertes/));
  check('feu vert fermé : ni n\'en crée', await fails(`select public.create_project_task($1, '{"title":"x"}'::jsonb)`, [pid], /pas encore ouvertes/));
  await as(1);
  const t0 = await create(pid, { title: 'Tâche de l\'admin' });
  check('admin LayerPitch : tâche créée malgré le feu vert fermé', !!t0);
  await q(`update public.feature_flags set released = true where key = 'project_tasks'`);

  // Hors Projet
  await as(3);
  check('un non-membre ne voit pas les tâches', await fails(`select public.list_project_tasks($1)`, [pid], /introuvable/));
  check('un non-membre ne coche pas', await fails(`select public.set_project_task_done($1, true)`, [t0], /introuvable/));

  // Création par un membre, champs complets
  await as(2);
  const t1 = await create(pid, { title: '  Refaire la boucle combat  ', notes: 'Trop longue', sectionId: sec, assigneeId: U(4), dueDate: '2026-11-20', link: { type: 'asset', id: asset } });
  let l = await list(pid), x = l.find(t => t.id === t1);
  check('un membre crée une tâche (titre nettoyé)', x && x.title === 'Refaire la boucle combat' && x.notes === 'Trop longue');
  check('section, personne assignée, échéance, lien enregistrés', x.sectionId === sec && x.assigneeId === U(4) && x.assigneeEmail === 'deux@x.test' && x.dueDate === '2026-11-20' && x.link.type === 'asset' && x.link.id === asset);
  check('nouvelle tâche en tête de la liste à faire', l[0].id === t1);
  check('auteur : mine + canDelete', x.mine === true && x.canDelete === true && x.authorEmail === 'membre@x.test');
  check('titre vide refusé', await fails(`select public.create_project_task($1, '{"title":"   "}'::jsonb)`, [pid], /1 à 200/));
  check('titre absent refusé', await fails(`select public.create_project_task($1, '{}'::jsonb)`, [pid], /1 à 200/));
  check('section d\'un autre Projet refusée', await fails(`select public.create_project_task($1, $2::jsonb)`, [pid, JSON.stringify({ title: 'x', sectionId: otherSec })], /Section introuvable/));
  check('objet d\'un autre Projet refusé', await fails(`select public.create_project_task($1, $2::jsonb)`, [pid, JSON.stringify({ title: 'x', link: { type: 'asset', id: otherAsset } })], /lié introuvable/));
  check('type de lien inconnu refusé', await fails(`select public.create_project_task($1, $2::jsonb)`, [pid, JSON.stringify({ title: 'x', link: { type: 'album', id: asset } })], /lié introuvable/));
  check('assigner un non-membre refusé', await fails(`select public.create_project_task($1, $2::jsonb)`, [pid, JSON.stringify({ title: 'x', assigneeId: U(3) })], /ne fait pas partie/));
  const t2 = await create(pid, { title: 'Point de la carte', link: { type: 'map', id: mapId, sub: 'n1' } });
  check('lien vers un point de carte', (await list(pid)).find(t => t.id === t2).link.sub === 'n1');
  const t3 = await create(pid, { title: 'Section liée', link: { type: 'section', id: sec } });
  check('lien vers une section', (await list(pid)).find(t => t.id === t3).link.type === 'section');

  // Notification d'assignation + cloche
  await as(4);
  let notes = await q(`select kind, payload from public.project_notifications where profile_id = $1 and kind = 'task_assigned'`, [U(4)]);
  check('assigner quelqu\'un le prévient', notes.length === 1 && notes[0].payload.title === 'Refaire la boucle combat' && notes[0].payload.authorEmail === 'membre@x.test');
  let up = await val(`select public.my_project_updates()`);
  check('cloche : 1 tâche assignée', up.find(u => u.projectId === pid).assignedTasks === 1);
  await q(`select public.mark_project_notifications_read($1)`, [pid]);
  up = await val(`select public.my_project_updates()`);
  check('cloche : la tâche vue ne compte plus', !(up.find(u => u.projectId === pid) || {}).assignedTasks);
  await as(2);
  await create(pid, { title: 'Pour moi', assigneeId: U(2) });
  check('s\'assigner soi-même ne notifie pas', (await q(`select 1 from public.project_notifications where profile_id = $1 and kind = 'task_assigned'`, [U(2)])).length === 0);

  // Modification partielle
  await as(4);
  await q(`select public.update_project_task($1, '{"notes":"Plus courte"}'::jsonb)`, [t1]);
  x = (await list(pid)).find(t => t.id === t1);
  check('un autre membre modifie ; les champs absents ne bougent pas', x.notes === 'Plus courte' && x.title === 'Refaire la boucle combat' && x.assigneeId === U(4) && x.sectionId === sec);
  await q(`select public.update_project_task($1, $2::jsonb)`, [t1, JSON.stringify({ assigneeId: U(2), dueDate: '', link: null, sectionId: null })]);
  x = (await list(pid)).find(t => t.id === t1);
  check('valeurs vides : échéance, lien, section effacés', x.dueDate === null && x.link === null && x.sectionId === null && x.assigneeId === U(2));
  check('réassigner prévient la nouvelle personne', (await q(`select 1 from public.project_notifications where profile_id = $1 and kind = 'task_assigned'`, [U(2)])).length === 1);
  check('titre vide refusé en modification', await fails(`select public.update_project_task($1, '{"title":""}'::jsonb)`, [t1], /1 à 200/));

  // Cocher / décocher
  await q(`select public.set_project_task_done($1, true)`, [t1]);
  l = await list(pid); x = l.find(t => t.id === t1);
  check('cocher : faite, par qui', x.done === true && x.doneByEmail === 'deux@x.test' && !!x.doneAt);
  check('les tâches faites passent après celles à faire', l[l.length - 1].id === t1 || l.filter(t => t.done).every(t => l.indexOf(t) > l.findIndex(u => !u.done)));
  await q(`select public.set_project_task_done($1, false)`, [t1]);
  l = await list(pid);
  check('décocher : revient en tête', l[0].id === t1 && l[0].done === false && l[0].doneAt === null);

  // Ordre manuel
  const todo = (await list(pid)).filter(t => !t.done).map(t => t.id);
  const wanted = [todo[todo.length - 1], ...todo.slice(0, -1)];
  await q(`select public.reorder_project_tasks($1, $2::uuid[])`, [pid, wanted]);
  check('réordonner la liste à faire', JSON.stringify((await list(pid)).filter(t => !t.done).map(t => t.id)) === JSON.stringify(wanted));

  // Suppression
  await as(4);
  check('un membre ne supprime pas la tâche d\'un autre', await fails(`select public.delete_project_task($1)`, [t2], /Seuls l'auteur/));
  check('… ni ne la voit supprimable', (await list(pid)).find(t => t.id === t2).canDelete === false);
  await as(2);
  await q(`select public.delete_project_task($1)`, [t2]);
  check('l\'auteur supprime sa tâche', !(await list(pid)).some(t => t.id === t2));
  await as(1);
  check('l\'admin du Projet voit tout supprimable', (await list(pid)).every(t => t.canDelete));
  await q(`select public.delete_project_task($1)`, [t3]);
  check('l\'admin du Projet supprime la tâche d\'un membre', !(await list(pid)).some(t => t.id === t3));

  // Activité
  const kinds = (await q(`select kind from public.project_activity where project_id = $1`, [pid])).map(r => r.kind);
  check('Activité : création, cochage, réouverture, suppression', ['task_created', 'task_done', 'task_reopened', 'task_deleted'].every(k => kinds.includes(k)));

  // Supprimer une section garde la tâche, sans section
  await as(2);
  const t4 = await create(pid, { title: 'Dans la forêt', sectionId: sec });
  await q(`select public.delete_project_section($1)`, [sec]);
  check('supprimer la section garde la tâche (sans section)', (await list(pid)).find(t => t.id === t4).sectionId === null);

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est vert.');
  process.exit(failures ? 1 : 0);
})();
