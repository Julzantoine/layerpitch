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
  w.eval(fs.readFileSync(path.join(__dirname, 'projet-carte-audio.js'), 'utf8'));
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
  check('inspecteur du boss : ambiance, combat et fond propre', host.querySelectorAll('#lmInsp [data-slot]').length === 3);
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


  // ---- Écouter (mode lecture) : clic, flèches, combat, réglages de la carte, transitions propres
  const calls = [];
  const fakeVoices = {};
  const clock = { t: 10, timers: [] };
  const audioEnv = {
    now: () => clock.t,
    schedule: (fn, at) => { const timer = { fn, at, live: true }; clock.timers.push(timer); return () => { timer.live = false; }; },
    voiceFactory: async ref => { const key = ref.kind + ':' + ref.id; if (!fakeVoices[key]) fakeVoices[key] = { key, start(l) { calls.push(key + ' start ' + l); this.p = true; }, setLevel(l, sec) { calls.push(key + ' level ' + l.toFixed(2)); }, stop() { calls.push(key + ' stop'); this.p = false; }, isPlaying() { return !!this.p; }, nextBoundary: () => null }; return fakeVoices[key]; },
  };
  const host3 = w.document.createElement('div'); w.document.body.appendChild(host3);
  const v3 = w.LayerPitchLevelMap.mount(host3, { tr, canEdit: true, audio: audioEnv, libraries: { track: [{ id: 'room1', title: 'Room' }, { id: 'door', title: 'Porte' }], sfx: [], asset: [] },
    maps: [{ id: 'p', title: 'Jouable', data: { roomTone: null, nodes: [
      { id: 'a', type: 'start', label: 'Début', x: 100, y: 200, sounds: { main: [{ kind: 'track', id: 'intro', title: 'Intro' }] } },
      { id: 'b', type: 'boss', label: 'Gardien', x: 500, y: 200, sounds: { main: [{ kind: 'track', id: 'boss', title: 'Boss' }], combat: [{ kind: 'track', id: 'fight', title: 'Combat' }] } }],
      edges: [{ id: 'e', from: 'a', to: 'b', enemy: false, label: 'Route' }] } }],
    save: async m => ({ id: m.id }), remove: async () => ({}), ask: async () => 'x', confirm: async () => true });
  const settle = async () => { for (let i = 0; i < 6; i++) await wait(5); };
  const advance = async sec => { const to = clock.t + sec; for (;;) { const due = clock.timers.filter(x => x.live && x.at <= to).sort((a, b) => a.at - b.at)[0]; if (!due) break; due.live = false; clock.t = Math.max(clock.t, due.at); due.fn(); await settle(); } clock.t = to; await settle(); };
  check('mode Écouter : bouton présent', !!host3.querySelector('#lmPlay'));
  host3.querySelector('#lmPlay').click();
  check('mode Écouter actif : barre d\'écoute visible, outils de dessin masqués', !host3.querySelector('#lmNow').hidden && !host3.querySelector('[data-add]'));
  const downOn = id => host3.querySelector('[data-node="' + id + '"]').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  downOn('a'); await settle(); await advance(0.1);
  check('clic sur le début : son joué', calls.includes('track:intro start 0') && v3.audio.state.position.id === 'a');
  check('barre d\'écoute : position et son', /Début/.test(host3.querySelector('#lmNow').textContent) && /Intro/.test(host3.querySelector('#lmNow').textContent));
  host3.dispatchEvent(Object.assign(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  await settle(); await advance(3);
  check('flèche droite : on passe sur le parcours voisin', v3.audio.state.position.kind === 'edge' && v3.audio.state.position.id === 'e');
  host3.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await settle(); await advance(3);
  check('deuxième flèche : on arrive sur le boss, son du boss', v3.audio.state.position.id === 'b' && calls.includes('track:boss start 0'));
  host3.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'c', bubbles: true })); await settle(); await advance(3);
  check('touche C : combat, le morceau de combat entre', v3.audio.state.combat && calls.includes('track:fight start 0'));
  check('bouton « Fin du combat » affiché', /map_combatOn/.test(host3.querySelector('#lmCombat').textContent));
  host3.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true })); await settle(); await advance(3);
  check('Espace : pause (tout s\'éteint)', !v3.audio.state.playing);
  host3.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
  check('Échap : quitte l\'écoute, outils de dessin revenus', !v3.state.play && !!host3.querySelector('[data-add]'));

  // Réglages de la carte : fond d'ambiance déposé, niveau, transition par défaut
  const dtR = { data: { 'application/x-lp-sound': JSON.stringify({ kind: 'track', id: 'room1', title: 'Room' }) }, types: ['application/x-lp-sound'], getData(t) { return this.data[t]; } };
  const dropRoom = new w.Event('drop', { bubbles: true, cancelable: true }); dropRoom.dataTransfer = dtR;
  host3.querySelector('#lmRoomZone').dispatchEvent(dropRoom);
  const mp = v3.state.maps[0].data;
  check('fond d\'ambiance déposé dans les réglages', mp.roomTone && mp.roomTone.id === 'room1');
  const db = host3.querySelector('#lmRoomDb'); db.value = '-20'; db.dispatchEvent(new w.Event('input'));
  check('niveau du fond réglé', mp.roomToneDb === -20);
  const defStyle = host3.querySelector('#lmDefStyle'); defStyle.value = 'cut'; defStyle.dispatchEvent(new w.Event('change'));
  const defSync = host3.querySelector('#lmDefSync'); defSync.value = 'beat'; defSync.dispatchEvent(new w.Event('change'));
  check('transition par défaut de la carte réglée', mp.defaults.transition.style === 'cut' && mp.defaults.transition.sync === 'beat');
  // Transition propre à un élément
  host3.querySelector('[data-node="b"]').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  const own = host3.querySelector('#lmTransOwn'); own.checked = true; own.dispatchEvent(new w.Event('change'));
  const nb = mp.nodes.find(n => n.id === 'b');
  check('transition propre : cochée, reprend celle de la carte', nb.transition && nb.transition.style === 'cut' && nb.transition.sync === 'beat');
  const sec = host3.querySelector('#lmTrSec'); sec.value = '4'; sec.dispatchEvent(new w.Event('change'));
  const style = host3.querySelector('#lmTrStyle'); style.value = 'fadeout'; style.dispatchEvent(new w.Event('change'));
  check('transition propre : durée et style réglés', nb.transition.sec === 4 && nb.transition.style === 'fadeout');
  const dtS = { data: { 'application/x-lp-sound': JSON.stringify({ kind: 'track', id: 'door', title: 'Porte' }) }, types: ['application/x-lp-sound'], getData(t) { return this.data[t]; } };
  const dropSt = new w.Event('drop', { bubbles: true, cancelable: true }); dropSt.dataTransfer = dtS;
  host3.querySelector('#lmStinger').dispatchEvent(dropSt);
  check('son de transition déposé', nb.transition.stinger && nb.transition.stinger.id === 'door');
  const dtRoom2 = { data: { 'application/x-lp-sound': JSON.stringify({ kind: 'track', id: 'room1', title: 'Room' }) }, types: ['application/x-lp-sound'], getData(t) { return this.data[t]; } };
  const dropR2 = new w.Event('drop', { bubbles: true, cancelable: true }); dropR2.dataTransfer = dtRoom2;
  // (ids en double entre les pages de ce test : on cherche l'emplacement dans l'inspecteur de CETTE page)
  [...host3.querySelectorAll('#lmInsp [data-slot]')].find(x => x.dataset.slot === 'room').dispatchEvent(dropR2);
  check('fond propre à un élément déposé (un seul)', nb.sounds.room.length === 1 && nb.sounds.room[0].id === 'room1');
  own.checked = false; host3.querySelector('#lmTransOwn').checked = false; host3.querySelector('#lmTransOwn').dispatchEvent(new w.Event('change'));
  check('décocher : retour au réglage de la carte', nb.transition === null);
  v3.destroy();

  // Lecture seule
  const host2 = w.document.createElement('div'); w.document.body.appendChild(host2);
  w.LayerPitchLevelMap.mount(host2, { tr, canEdit: false, maps: [{ id: 'm', title: 'T', data: { nodes: [{ id: 'a', type: 'place', x: 0, y: 0 }], edges: [] } }], libraries: {}, save: async () => { throw new Error('ne doit pas enregistrer'); }, remove: async () => ({}) });
  check('lecture seule : ni ajout ni suppression', !host2.querySelector('[data-add]') && !host2.querySelector('#lmNew'));


  // ---- Point sur un parcours (7/10) : « générer un point sur un itinéraire pour y relier quelque chose »
  {
    const m2 = M.emptyMap();
    const s2 = M.addNode(m2, 'start', 0, 0, 'Début'), p2 = M.addNode(m2, 'place', 400, 0, 'Château'), q2 = M.addNode(m2, 'quest', 200, 150, 'Annexe'), pl2 = M.addNode(m2, 'place', 200, 300, 'Ville');
    const ed = M.addEdge(m2, s2.id, p2.id);
    const g = M.edgeGeometry(m2, ed);
    check('projection : un point au-dessus du quart du trait donne t proche de 0,25', Math.abs(M.projectOnEdge(m2, ed.id, g.p1.x + (g.p2.x - g.p1.x) * 0.25, 90) - 0.25) < 0.01);
    check('projection : bornée (jamais collée aux éléments)', M.projectOnEdge(m2, ed.id, -999, 0) === 0.05 && M.projectOnEdge(m2, ed.id, 9999, 0) === 0.95);
    check('accrocher une quête à un parcours : la quête devient annexe, point retenu', M.anchorQuestToEdge(m2, q2.id, ed.id, 0.3) && q2.side === true && q2.anchor.kind === 'edge' && q2.anchor.id === ed.id && q2.anchor.t === 0.3);
    const ap = M.anchorPoint(m2, q2.anchor);
    check('le point d\'accroche est bien à 30 % du parcours', Math.abs(ap.x - (g.p1.x + (g.p2.x - g.p1.x) * 0.3)) < 0.01 && Math.abs(ap.y - g.p1.y) < 0.01);
    check('sans t, l\'accroche reste au milieu du parcours', (() => { const mid = M.anchorPoint(m2, { kind: 'edge', id: ed.id }); return Math.abs(mid.x - (g.p1.x + g.p2.x) / 2) < 0.01; })());
    check('seule une quête s\'accroche à un parcours', M.anchorQuestToEdge(m2, pl2.id, ed.id, 0.5) === false && !pl2.anchor);
    check('le point survit à normalize (enregistrement / rechargement)', M.normalize(JSON.parse(JSON.stringify(m2))).nodes.find(n => n.id === q2.id).anchor.t === 0.3);
    M.removeEdge(m2, ed.id);
    check('parcours supprimé : la quête redevient libre', q2.anchor === null);

    // Éditeur : « Relier », puis une quête et un parcours (dans les deux ordres), puis glisser le point
    const host4 = w.document.createElement('div'); w.document.body.appendChild(host4);
    const saves4 = [];
    const v4 = w.LayerPitchLevelMap.mount(host4, { tr, canEdit: true, libraries: { track: [], sfx: [], asset: [] },
      maps: [{ id: 'm4', title: 'T', data: { nodes: [{ id: 's', type: 'start', label: 'Début', x: 0, y: 0 }, { id: 'c', type: 'place', label: 'Château', x: 400, y: 0 }, { id: 'q', type: 'quest', label: 'Quête', x: 200, y: 150 }], edges: [{ id: 'e', from: 's', to: 'c' }] } }],
      save: async m => { saves4.push(JSON.parse(JSON.stringify(m))); return { id: m.id }; }, remove: async () => ({}), ask: async () => 'x', confirm: async () => true });
    v4.state.view = { x: 0, y: 0, k: 1 };
    const at = (el, x, y, type) => el.dispatchEvent(Object.assign(new w.Event(type || 'pointerdown', { bubbles: true }), { clientX: x, clientY: y, pointerId: 1 }));
    const gm = M.edgeGeometry(M.normalize({ nodes: [{ id: 's', type: 'start', x: 0, y: 0 }, { id: 'c', type: 'place', x: 400, y: 0 }], edges: [{ id: 'e', from: 's', to: 'c' }] }), { from: 's', to: 'c' });
    host4.querySelector('#lmConnect').click();
    at(host4.querySelector('[data-node="q"]'), 200, 150);
    check('Relier : première quête cliquée, en attente du parcours', v4.state.linkFrom === 'q');
    at(host4.querySelector('[data-edge="e"]'), gm.p1.x + (gm.p2.x - gm.p1.x) * 0.7, 0); await wait(30);
    const qd = v4.state.maps[0].data.nodes.find(n => n.id === 'q');
    check('clic sur le parcours : la quête s\'accroche à cet endroit (70 %)', qd.side === true && qd.anchor && qd.anchor.kind === 'edge' && Math.abs(qd.anchor.t - 0.7) < 0.01);
    check('un point d\'accroche est dessiné sur le parcours', !!host4.querySelector('[data-anchor-dot="q"]'));
    await wait(800); // enregistrement différé de 700 ms
    check('la carte est enregistrée avec le point', saves4.some(sv => sv.data.nodes.find(n => n.id === 'q').anchor && sv.data.nodes.find(n => n.id === 'q').anchor.t));
    // glisser le point
    at(host4.querySelector('[data-anchor-dot="q"]'), 0, 0);
    at(host4.querySelector('#lmCanvas'), gm.p1.x + (gm.p2.x - gm.p1.x) * 0.2, 0, 'pointermove'); 
    at(host4.querySelector('#lmCanvas'), 0, 0, 'pointerup'); await wait(30);
    check('glisser le point : il suit le parcours (20 %)', Math.abs(v4.state.maps[0].data.nodes.find(n => n.id === 'q').anchor.t - 0.2) < 0.01);
    // dans l'autre ordre : parcours d'abord, puis la quête
    v4.state.maps[0].data.nodes.find(n => n.id === 'q').anchor = null; v4.state.maps[0].data.nodes.find(n => n.id === 'q').side = false;
    host4.querySelector('#lmConnect').click(); host4.querySelector('#lmConnect').click(); // sortir puis rentrer dans « Relier »
    at(host4.querySelector('[data-edge="e"]'), gm.p1.x + (gm.p2.x - gm.p1.x) * 0.5, 0);
    at(host4.querySelector('[data-node="q"]'), 200, 150); await wait(30);
    check('parcours puis quête : accrochée au point cliqué (50 %)', (() => { const a = v4.state.maps[0].data.nodes.find(n => n.id === 'q').anchor; return !!a && a.kind === 'edge' && Math.abs(a.t - 0.5) < 0.01; })());
    // Panneaux « Sons » et « Détail » repliables, choix retenu
    const wrap4 = host4.querySelector('.lm-wrap');
    check('panneaux dépliés au départ', !wrap4.classList.contains('lib-c') && !wrap4.classList.contains('insp-c') && host4.querySelector('[data-collapse="lib"]').getAttribute('aria-expanded') === 'true');
    host4.querySelector('[data-collapse="lib"]').click();
    check('replier « Sons » : classe posée, bouton « déplier », choix retenu', wrap4.classList.contains('lib-c') && host4.querySelector('[data-collapse="lib"]').getAttribute('aria-expanded') === 'false' && w.localStorage.getItem('lp_map_lib_collapsed') === '1');
    host4.querySelector('[data-collapse="insp"]').click();
    check('replier aussi le détail : la carte occupe presque toute la largeur', wrap4.classList.contains('lib-c') && wrap4.classList.contains('insp-c') && w.localStorage.getItem('lp_map_insp_collapsed') === '1');
    check('le dessin de la carte reste présent', !!host4.querySelector('[data-node="q"]'));
    host4.querySelector('[data-collapse="lib"]').click();
    check('déplier « Sons » : de nouveau visible, l\'autre reste replié', !wrap4.classList.contains('lib-c') && wrap4.classList.contains('insp-c'));
    host4.querySelector('[data-collapse="insp"]').click();
    v4.destroy();
  }

  console.log(failures ? failures + ' échec(s)' : 'Tout est vert');
  process.exit(failures ? 1 : 0);
})();
