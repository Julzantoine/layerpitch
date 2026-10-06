// Carte de niveau (projet-carte.js, 6/10) : modèle (éléments, parcours, accroches, sons) et éditeur dans une page jetable.
// Le serveur est testé par test_cartes_de_niveau.js.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const dom = new JSDOM('<div id="host"></div>', { url: 'https://beta.layerpitch.com/projet.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(__dirname, 'projet-carte.js'), 'utf8'));
  const M = w.LayerPitchLevelMap.model;

  // ---- Modèle
  const map = M.emptyMap();
  const start = M.addNode(map, 'start', 0, 0, 'Début');
  check('un début de niveau', !!start && start.type === 'start');
  check('un deuxième début refusé', M.addNode(map, 'start', 10, 10) === null);
  check('type inconnu refusé', M.addNode(map, 'dragon', 0, 0) === null);
  const castle = M.addNode(map, 'place', 200, 0, 'Château'), city = M.addNode(map, 'place', 200, 200, 'Ville');
  const boss = M.addNode(map, 'boss', 400, 0, 'Gardien'), quest = M.addNode(map, 'quest', 300, 100, 'Annexe');
  const e1 = M.addEdge(map, start.id, castle.id), e2 = M.addEdge(map, start.id, city.id);
  check('parcours créé', !!e1 && !!e2 && map.edges.length === 2);
  check('parcours vers soi-même refusé', M.addEdge(map, castle.id, castle.id) === null);
  check('parcours en double refusé (dans les deux sens)', M.addEdge(map, castle.id, start.id) === null);
  check('parcours vers un élément inconnu refusé', M.addEdge(map, castle.id, 'zz') === null);

  const ref = { kind: 'track', id: 'theme', title: 'Thème' };
  check('son déposé sur un lieu (emplacement principal)', M.addSound(map, { kind: 'node', id: castle.id }, 'main', ref));
  check('même son deux fois refusé', !M.addSound(map, { kind: 'node', id: castle.id }, 'main', ref));
  check('emplacement combat refusé sur un lieu', !M.addSound(map, { kind: 'node', id: castle.id }, 'combat', ref));
  check('emplacement combat accepté sur un boss', M.addSound(map, { kind: 'node', id: boss.id }, 'combat', ref));
  check('emplacement combat refusé sur un parcours sans ennemi', !M.addSound(map, { kind: 'edge', id: e1.id }, 'combat', ref));
  M.setEnemy(map, e1.id, true);
  check('emplacement combat accepté sur un parcours étoilé', M.addSound(map, { kind: 'edge', id: e1.id }, 'combat', { kind: 'track', id: 'fight', title: 'Combat' }));
  M.setEnemy(map, e1.id, false);
  check('retirer l\'étoile garde les sons de combat', M.edgeById(map, e1.id).sounds.combat.length === 1);
  check('référence invalide refusée', !M.addSound(map, { kind: 'node', id: castle.id }, 'main', { kind: 'video', id: 'x' }));
  for (let i = 0; i < 20; i++) M.addSound(map, { kind: 'node', id: city.id }, 'main', { kind: 'sfx', id: 's' + i, title: 'S' + i });
  check('douze sons au plus par emplacement', city.sounds.main.length === M.MAX_SOUNDS);
  check('son retiré', M.removeSound(map, { kind: 'node', id: city.id }, 'main', 0) && city.sounds.main.length === M.MAX_SOUNDS - 1);

  // Quête annexe accrochée n'importe où
  quest.side = true; quest.anchor = { kind: 'edge', id: e1.id };
  const p = M.anchorPoint(map, quest.anchor), g = M.edgeGeometry(map, e1);
  check('accroche sur un parcours : point au milieu du trait', p && Math.abs(p.x - g.mid.x) < 1e-9 && Math.abs(p.y - g.mid.y) < 1e-9);
  check('choix d\'accroche : tout sauf elle-même', M.anchorChoices(map, quest.id).length === (map.nodes.length - 1) + map.edges.length);
  M.removeEdge(map, e1.id);
  check('parcours supprimé : la quête annexe redevient libre', quest.anchor === null);
  quest.anchor = { kind: 'node', id: castle.id };
  M.removeNode(map, castle.id);
  check('élément supprimé : ses parcours partent et l\'accroche aussi', quest.anchor === null && !map.nodes.some(n => n.id === castle.id) && map.edges.every(e => e.from !== castle.id && e.to !== castle.id));
  const s = M.summary(map);
  check('bilan : sons posés et éléments sans son', s.sounds > 0 && s.silent >= 1 && s.nodes === map.nodes.length);
  check('les traits partent du bord des formes, pas du centre', (() => { const a = M.nodeById(map, start.id), b = M.nodeById(map, city.id); const pt = M.borderPoint(a, b.x, b.y); return Math.hypot(pt.x - a.x, pt.y - a.y) > 0 && Math.hypot(pt.x - a.x, pt.y - a.y) < Math.hypot(b.x - a.x, b.y - a.y); })());
  check('normalize : jette un parcours dont une extrémité manque, complète les champs', (() => { const n = M.normalize({ nodes: [{ id: 'a', type: 'place', x: 1, y: 2 }, { id: 'b', type: 'dragon' }], edges: [{ id: 'e', from: 'a', to: 'b' }] }); return n.nodes.length === 1 && n.edges.length === 0 && Array.isArray(n.nodes[0].sounds.main); })());

  // ---- Éditeur
  const tr = (k, v) => k + (v ? JSON.stringify(v) : '');
  const saves = [];
  const host = w.document.getElementById('host');
  const view = w.LayerPitchLevelMap.mount(host, {
    tr, canEdit: true,
    maps: [{ id: 'm1', title: 'Niveau 1', data: { nodes: [{ id: 'a', type: 'start', label: 'Début', x: 100, y: 100 }, { id: 'b', type: 'boss', label: 'Gardien', x: 400, y: 100 }], edges: [{ id: 'e', from: 'a', to: 'b', enemy: true }] } }],
    libraries: { track: [{ id: 't1', title: 'Thème du château' }, { id: 't2', title: 'Combat' }], sfx: [{ id: 's1', title: 'Vent' }], asset: [] },
    save: async m => { saves.push(JSON.parse(JSON.stringify(m))); return { id: m.id }; },
    remove: async () => ({}), ask: async () => 'Niveau 2', confirm: async () => true,
  });
  check('éditeur : éléments et parcours dessinés', host.querySelectorAll('[data-node]').length === 2 && host.querySelectorAll('[data-edge]').length === 1);
  check('éditeur : bibliothèque de sons listée', host.querySelectorAll('#lmLib [data-ref]').length === 2);
  host.querySelector('[data-add="place"]').click();
  check('bouton « Lieu » : un élément de plus, sélectionné', host.querySelectorAll('[data-node]').length === 3 && view.state.sel && view.state.sel.kind === 'node');
  check('le début ne peut plus être ajouté (déjà posé)', host.querySelector('[data-add="start"]').disabled);
  const label = host.querySelector('#lmLabel'); label.value = 'Château'; label.dispatchEvent(new w.Event('input'));
  await wait(900);
  check('enregistrement automatique après une modification', saves.length >= 1 && saves[saves.length - 1].data.nodes.some(n => n.label === 'Château'));

  // Dépôt d'un son de la bibliothèque sur un élément
  const dt = { data: {}, types: ['application/x-lp-sound'], setData(t, v) { this.data[t] = v; }, getData(t) { return this.data[t]; }, effectAllowed: '' };
  const item = host.querySelector('#lmLib [data-ref]');
  const dragstart = new w.Event('dragstart', { bubbles: true }); dragstart.dataTransfer = dt; item.dispatchEvent(dragstart);
  const target = host.querySelector('[data-node="b"]');
  const drop = new w.Event('drop', { bubbles: true, cancelable: true }); drop.dataTransfer = dt; target.dispatchEvent(drop);
  const boss2 = view.state.maps[0].data.nodes.find(n => n.id === 'b');
  check('son glissé sur un boss : posé en ambiance', boss2.sounds.main.length === 1 && boss2.sounds.main[0].id === 't1');
  check('inspecteur du boss : emplacement combat présent', host.querySelectorAll('#lmInsp .lm-slot').length === 2);
  const slotCombat = host.querySelector('#lmInsp [data-slot="combat"]');
  const item2 = host.querySelectorAll('#lmLib [data-ref]')[1];
  const dt2 = { data: {}, types: ['application/x-lp-sound'], setData(t, v) { this.data[t] = v; }, getData(t) { return this.data[t]; } };
  const ds2 = new w.Event('dragstart', { bubbles: true }); ds2.dataTransfer = dt2; item2.dispatchEvent(ds2);
  const drop2 = new w.Event('drop', { bubbles: true, cancelable: true }); drop2.dataTransfer = dt2; slotCombat.dispatchEvent(drop2);
  check('son glissé sur l\'emplacement combat de l\'inspecteur', boss2.sounds.combat.length === 1 && boss2.sounds.combat[0].id === 't2');

  // Parcours : sélection puis case ennemi
  host.querySelector('[data-edge="e"]').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  check('parcours sélectionné : case « ennemi possible » cochée', view.state.sel.kind === 'edge' && host.querySelector('#lmEnemy').checked);
  // Relier deux éléments
  host.querySelector('#lmConnect').click();
  check('mode « Relier » actif', view.state.connecting);
  // Nouvelle carte / suppression
  host.querySelector('#lmNew').click(); await wait(20);
  check('nouvelle carte créée et enregistrée', view.state.maps.length === 2 && saves.some(sv => sv.title === 'Niveau 2'));
  view.destroy();

  // Lecture seule
  const host2 = w.document.createElement('div'); w.document.body.appendChild(host2);
  w.LayerPitchLevelMap.mount(host2, { tr, canEdit: false, maps: [{ id: 'm', title: 'T', data: { nodes: [{ id: 'a', type: 'place', x: 0, y: 0 }], edges: [] } }], libraries: {}, save: async () => { throw new Error('ne doit pas enregistrer'); }, remove: async () => ({}) });
  check('lecture seule : ni ajout ni suppression', !host2.querySelector('[data-add]') && !host2.querySelector('#lmNew'));

  console.log(failures ? failures + ' échec(s)' : 'Tout est vert');
  process.exit(failures ? 1 : 0);
})();
