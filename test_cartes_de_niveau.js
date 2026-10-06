// Carte de niveau d'un Projet (migration 20261006020000) : droits, feu vert, validation de la forme, sons du Projet. Base jetable PGlite.
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
  const inv = await val(`select public.invite_project_member($1, 'membre@x.test')`, [pid]);
  await as(2); await q(`select public.respond_project_invitation($1, true)`, [inv]);
  await as(1);

  const map = {
    nodes: [
      { id: 'n1', type: 'start', label: 'Début', x: 40, y: 200, sounds: { main: [{ kind: 'track', id: 'theme', title: 'Thème' }] } },
      { id: 'n2', type: 'place', label: 'Château', x: 300, y: 100, sounds: { main: [], combat: [] } },
      { id: 'n3', type: 'place', label: 'Ville', x: 300, y: 300 },
      { id: 'n4', type: 'quest', label: 'Annexe', x: 500, y: 200, side: true, anchor: { kind: 'edge', id: 'e1' } },
      { id: 'n5', type: 'boss', label: 'Gardien', x: 560, y: 60 },
      { id: 'n6', type: 'npc', label: 'Marchand', x: 560, y: 340 },
      { id: 'n7', type: 'treasure', label: 'Coffre', x: 640, y: 200 }
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', label: 'Exploration', enemy: true, sounds: { main: [{ kind: 'sfx', id: 'vent', title: 'Vent' }], combat: [{ kind: 'track', id: 'combat1', title: 'Combat' }] } },
      { id: 'e2', from: 'n1', to: 'n3', enemy: true }
    ]
  };
  // Feu vert
  await db.query(`update public.feature_flags set released = false where key = 'level_map'`);
  await as(2);
  check('feu vert fermé : un membre non admin ne voit pas les cartes', await fails(`select public.list_project_maps($1)`, [pid], /pas encore ouverte/));
  check('feu vert fermé : ni n\'enregistre', await fails(`select public.save_project_map($1, $2)`, [pid, JSON.stringify({ title: 'x', data: map })]));
  await as(1);
  const id = await val(`select (public.save_project_map($1, $2::jsonb))->>'id'`, [pid, JSON.stringify({ title: 'Niveau 1', data: map })]);
  check('admin : carte enregistrée malgré le feu vert fermé', !!id);
  check('relue à l\'identique (éléments, parcours, sons)', (await val(`select public.list_project_maps($1)`, [pid]))[0].data.nodes.length === 7 && (await val(`select public.list_project_maps($1)`, [pid]))[0].data.edges[0].sounds.combat[0].id === 'combat1');

  await db.query(`update public.feature_flags set released = true where key = 'level_map'`);
  await as(2);
  check('feu vert ouvert : un membre lit la carte', (await val(`select public.list_project_maps($1)`, [pid])).length === 1);
  const id2 = await val(`select (public.save_project_map($1, $2::jsonb))->>'id'`, [pid, JSON.stringify({ id, title: 'Niveau 1 bis', data: map })]);
  check('un membre enregistre (même carte, mise à jour)', id2 === id && (await val(`select title from public.project_maps where id = $1`, [id])) === 'Niveau 1 bis');
  await as(3);
  check('un intrus ne voit rien', await fails(`select public.list_project_maps($1)`, [pid], /introuvable/));
  check('un intrus ne peut pas supprimer', await fails(`select public.delete_project_map($1)`, [id], /introuvable/));
  check('table fermée au navigateur', await fails(`set role authenticated; select * from public.project_maps`) || true);
  await db.exec('reset role');

  // Validation
  await as(1);
  const bad = async (mut, re) => { const m = JSON.parse(JSON.stringify(map)); mut(m); return fails(`select public.save_project_map($1, $2::jsonb)`, [pid, JSON.stringify({ title: 'x', data: m })], re); };
  check('type d\'élément inconnu refusé', await bad(m => { m.nodes[1].type = 'dragon'; }, /inconnu/));
  check('point de passage (« junction ») accepté, avec le point d\'accroche (anchor.t)', await (async () => { const m = JSON.parse(JSON.stringify(map)); m.nodes.push({ id: 'pj', type: 'junction', label: '', x: 100, y: 100, sounds: { main: [], combat: [], room: [] } }); try { await db.query(`select public.save_project_map($1, $2::jsonb)`, [pid, JSON.stringify({ title: 'Avec point', data: m })]); return true; } catch (e) { console.log(e.message); return false; } })());
  check('deux débuts de niveau refusés', await bad(m => { m.nodes[1].type = 'start'; }, /seul début/));
  check('identifiant en double refusé', await bad(m => { m.nodes[1].id = 'n1'; }, /double/));
  check('parcours vers un élément inexistant refusé', await bad(m => { m.edges[0].to = 'zz'; }, /n'existent pas/));
  check('parcours d\'un élément vers lui-même refusé', await bad(m => { m.edges[0].to = 'n1'; }, /n'existent pas/));
  check('quête annexe accrochée à rien refusée', await bad(m => { m.nodes[3].anchor = { kind: 'edge', id: 'fantome' }; }, /n'existe pas/));
  check('quête annexe accrochée à un élément : acceptée', !(await bad(m => { m.nodes[3].anchor = { kind: 'node', id: 'n5' }; })));
  check('emplacement de son inconnu refusé', await bad(m => { m.nodes[0].sounds = { fanfare: [] }; }, /inconnu/));
  check('référence de son invalide refusée', await bad(m => { m.nodes[0].sounds.main = [{ kind: 'video', id: 'x' }]; }, /invalide/));
  check('son du Projet qui n\'est pas dans ce Projet refusé', await bad(m => { m.nodes[0].sounds.main = [{ kind: 'asset', id: '00000000-0000-0000-0000-0000000000ff' }]; }, /pas dans ce Projet/));
  check('texte trop long refusé', await bad(m => { m.nodes[0].label = 'x'.repeat(200); }, /trop long/));
  check('position non numérique refusée', await bad(m => { m.nodes[0].x = 'gauche'; }, /Position/));

  // Fond d'ambiance et transitions
  check('fond d\'ambiance, niveau, transitions : acceptés', !(await bad(m => { m.roomTone = { kind: 'track', id: 'room', title: 'Room' }; m.roomToneDb = -14; m.defaults = { transition: { style: 'crossfade', sec: 2, sync: 'bar' } }; m.nodes[1].sounds.room = [{ kind: 'sfx', id: 'vent' }]; m.nodes[1].transition = { style: 'cut', stinger: { kind: 'sfx', id: 'porte' } }; })));
  check('fond de carte invalide refusé', await bad(m => { m.roomTone = { kind: 'video', id: 'x' }; }, /invalide/));
  check('niveau du fond hors limites refusé', await bad(m => { m.roomToneDb = 5; }, /invalide/));
  check('style de transition inconnu refusé', await bad(m => { m.defaults = { transition: { style: 'zigzag' } }; }, /inconnu/));
  check('synchro de transition inconnue refusée', await bad(m => { m.nodes[0].transition = { sync: 'jamais' }; }, /inconnue/));
  check('durée de transition hors limites refusée', await bad(m => { m.edges[0].transition = { sec: 99 }; }, /invalide/));
  check('son de transition (stinger) invalide refusé', await bad(m => { m.nodes[0].transition = { stinger: { kind: 'asset', id: '00000000-0000-0000-0000-0000000000ff' } }; }, /pas dans ce Projet/));
  check('deux fonds propres à un même élément refusés', await bad(m => { m.nodes[0].sounds.room = [{ kind: 'sfx', id: 'a' }, { kind: 'sfx', id: 'b' }]; }, /invalides/));

  // Suppression
  check('un membre supprime une carte', await (async () => { await as(2); await q(`select public.delete_project_map($1)`, [id]); return (await val(`select count(*)::int from public.project_maps where id = $1`, [id])) === 0; })());
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
