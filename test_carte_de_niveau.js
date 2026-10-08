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
  // 8/10 : une musique par élément, plus une 2e facultative sur n'importe quel élément ou parcours (emplacement interne « combat »)
  check('2e musique acceptée sur un lieu', M.addSound(map, { kind: 'node', id: castle.id }, 'combat', ref) && M.hasAltMusic(map, { kind: 'node', id: castle.id }));
  check('2e musique acceptée sur un boss', M.addSound(map, { kind: 'node', id: boss.id }, 'combat', ref));
  check('2e musique acceptée sur un parcours, sans qu\'il faille l\'étoile', M.addSound(map, { kind: 'edge', id: e1.id }, 'combat', { kind: 'track', id: 'fight', title: 'Combat' }) && M.hasAltMusic(map, { kind: 'edge', id: e1.id }));
  check('pas de 2e musique tant qu\'aucun son n\'y est posé', !M.hasAltMusic(map, { kind: 'node', id: city.id }));
  M.setEnemy(map, e1.id, true); M.setEnemy(map, e1.id, false);
  check('l\'étoile « ennemi possible » n\'est plus qu\'un repère : elle ne touche pas aux sons', M.edgeById(map, e1.id).sounds.combat.length === 1);
  const tgtC = { kind: 'node', id: castle.id };
  check('nom de la 2e musique (rogné à 60 caractères, retiré si vide)', M.setAltName(map, tgtC, '  Tension ' + 'x'.repeat(80)) && M.nodeById(map, castle.id).altName.length === 60 && M.setAltName(map, tgtC, '  ') && M.nodeById(map, castle.id).altName === undefined);
  check('son de transition entre les deux musiques : un seul, valide', M.addSound(map, tgtC, 'altTransition', { kind: 'sfx', id: 'whoosh', title: 'Whoosh' }) && M.nodeById(map, castle.id).altTransition.id === 'whoosh' && !M.addSound(map, tgtC, 'altTransition', { kind: 'video', id: 'x' }));
  check('2e musique, nom et transition survivent à normalize', (() => { M.setAltName(map, tgtC, 'Tension'); const n = M.normalize(JSON.parse(JSON.stringify(map))).nodes.find(x => x.id === castle.id); return n.altName === 'Tension' && n.altTransition.id === 'whoosh' && n.sounds.combat.length === 1; })());
  check('une carte sans 2e musique garde sa forme (aucune clé en plus)', (() => { const n = M.normalize({ nodes: [{ id: 'z', type: 'place', x: 0, y: 0 }], edges: [] }).nodes[0]; return !('altName' in n) && !('altTransition' in n); })());
  check('retirer la 2e musique efface sons, nom et transition', M.clearAlt(map, tgtC) && !M.hasAltMusic(map, tgtC) && !('altName' in M.nodeById(map, castle.id)) && !('altTransition' in M.nodeById(map, castle.id)));
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
  check('inspecteur du boss : une seule musique et le fond propre, « ＋ 2e musique » proposé', host.querySelectorAll('#lmInsp [data-slot]').length === 2 && !host.querySelector('#lmInsp [data-slot="combat"]') && !!host.querySelector('#lmAltAdd'));
  host.querySelector('#lmAltAdd').click();
  check('un seul morceau dans l\'emplacement : pas de mention du tirage au hasard', !/map_randomHint/.test(host.querySelector('#lmInsp').textContent));
  check('« ＋ 2e musique » : le 2e emplacement, son nom et la transition apparaissent', !!host.querySelector('#lmInsp [data-slot="combat"]') && !!host.querySelector('#lmAltName') && !!host.querySelector('#lmInsp [data-slot="altTransition"]') && !host.querySelector('#lmAltAdd'));
  const slotCombat = host.querySelector('#lmInsp [data-slot="combat"]');
  const item2 = host.querySelectorAll('#lmLib [data-ref]')[1];
  const dt2 = { data: {}, types: ['application/x-lp-sound'], setData(t, v) { this.data[t] = v; }, getData(t) { return this.data[t]; } };
  const ds2 = new w.Event('dragstart', { bubbles: true }); ds2.dataTransfer = dt2; item2.dispatchEvent(ds2);
  const drop2 = new w.Event('drop', { bubbles: true, cancelable: true }); drop2.dataTransfer = dt2; slotCombat.dispatchEvent(drop2);
  { // deux morceaux dans « Musique » : la mention du tirage au hasard apparaît
    const hostR = w.document.createElement('div'); w.document.body.appendChild(hostR);
    const vR = w.LayerPitchLevelMap.mount(hostR, { tr, canEdit: true, libraries: { track: [], sfx: [], asset: [] }, maps: [{ id: 'mr', title: 'R', data: { nodes: [{ id: 'a', type: 'start', label: 'D', x: 0, y: 0, sounds: { main: [{ kind: 'track', id: 'u', title: 'U' }, { kind: 'track', id: 'v', title: 'V' }] } }], edges: [] } }], save: async m => ({ id: m.id }), remove: async () => ({}) });
    hostR.querySelector('[data-node="a"]').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    check('deux morceaux dans « Musique » : la mention du tirage au hasard est affichée', /map_randomHint/.test(hostR.querySelector('#lmInsp').textContent));
  }
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
  await settle(); await advance(0.1);
  check('« Se balader » sans rien sélectionner : on est placé tout de suite sur le Début, son joué', !!v3.audio.state.position && v3.audio.state.position.id === 'a' && calls.includes('track:intro start 0'));
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
  check('bouton « Retour à la musique 1 » affiché pendant la 2e musique', /map_altBack/.test(host3.querySelector('#lmCombat').textContent));
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
  // Fond d'ambiance : déposé sur le TITRE de la colonne (pas seulement le cadre en pointillés), puis choisi à gauche et « + Ajouter »
  const roomLabel = host3.querySelector('#lmRoomZone').parentElement.querySelector('label');
  const dropRoom2 = new w.Event('drop', { bubbles: true, cancelable: true }); dropRoom2.dataTransfer = { data: { 'application/x-lp-sound': JSON.stringify({ kind: 'track', id: 'room2', title: 'Room 2' }) }, types: ['application/x-lp-sound'], getData(t) { return this.data[t]; } };
  roomLabel.dispatchEvent(dropRoom2);
  check('fond d\'ambiance : déposé sur le titre de la colonne, il est pris en compte', v3.state.maps[0].data.roomTone.id === 'room2');
  const addBtn0 = [...host3.querySelectorAll('#lmRoomZone button')].find(b => /map_addPicked/.test(b.textContent));
  check('fond d\'ambiance : « + Ajouter » est grisé tant qu\'aucun son n\'est choisi à gauche', !!addBtn0 && addBtn0.disabled);
  const libItem = host3.querySelector('[data-ref]'); libItem.click();
  const addBtn1 = [...host3.querySelectorAll('#lmRoomZone button')].find(b => /map_addPicked/.test(b.textContent));
  check('fond d\'ambiance : après avoir choisi un son à gauche, « + Ajouter » devient actif et le nomme', !!addBtn1 && !addBtn1.disabled && /map_addPicked/.test(addBtn1.textContent));
  addBtn1.click();
  check('fond d\'ambiance : « + Ajouter » pose le son choisi', v3.state.maps[0].data.roomTone && v3.state.maps[0].data.roomTone.id === JSON.parse(libItem.dataset.ref).id);
  v3.state.maps[0].data.roomTone = { kind: 'track', id: 'room1', title: 'Room' };
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
    // Point de passage (7/10) : un parcours devient A → P → B ; d'autres itinéraires peuvent en partir
    const m5 = M.emptyMap();
    const s5 = M.addNode(m5, 'start', 0, 0, 'Début'), c5 = M.addNode(m5, 'place', 400, 0, 'Château'), v5 = M.addNode(m5, 'place', 200, 200, 'Ville'), q5 = M.addNode(m5, 'quest', 100, 120, 'Annexe');
    const ed5 = M.addEdge(m5, s5.id, c5.id); ed5.label = 'Route'; ed5.enemy = true; ed5.sounds.main = [{ kind: 'track', id: 't1', title: 'Marche' }];
    const gm5 = M.edgeGeometry(m5, ed5);
    M.anchorQuestToEdge(m5, q5.id, ed5.id, 0.8);
    const cut = M.splitEdge(m5, ed5.id, gm5.p1.x + (gm5.p2.x - gm5.p1.x) * 0.5, 0);
    check('point de passage : un nouvel élément de type « junction », posé sur le parcours (au milieu)', !!cut && cut.node.type === 'junction' && Math.abs(cut.node.x - (gm5.p1.x + gm5.p2.x) / 2) <= 1 && cut.node.y === 0);
    check('le parcours est remplacé par deux moitiés Début → P et P → Château', m5.edges.length === 2 && !M.edgeById(m5, ed5.id) && cut.edges[0].from === s5.id && cut.edges[0].to === cut.node.id && cut.edges[1].from === cut.node.id && cut.edges[1].to === c5.id);
    check('les moitiés reprennent le nom (1re), l\'ennemi et les sons', cut.edges[0].label === 'Route' && cut.edges[1].label === '' && cut.edges.every(e => e.enemy && e.sounds.main.length === 1) && cut.edges[0].sounds !== cut.edges[1].sounds);
    check('la quête accrochée à 80 % suit la 2e moitié (60 % de celle-ci)', q5.anchor.id === cut.edges[1].id && Math.abs(q5.anchor.t - 0.6) < 0.01);
    const e6 = M.addEdge(m5, cut.node.id, v5.id);
    check('un autre itinéraire part du point de passage (embranchement)', !!e6 && m5.edges.length === 3);
    check('le point de passage survit à normalize', M.normalize(JSON.parse(JSON.stringify(m5))).nodes.some(n => n.type === 'junction'));
    check('à 3 parcours, supprimer le point supprime ses parcours (pas de fusion)', (() => { const m = JSON.parse(JSON.stringify(m5)); M.removeNode(m, cut.node.id); return m.edges.length === 0 && !m.nodes.some(n => n.type === 'junction'); })());
    const m7 = M.emptyMap(); const a7 = M.addNode(m7, 'start', 0, 0, 'A'), b7 = M.addNode(m7, 'place', 400, 0, 'B'); const ed7 = M.addEdge(m7, a7.id, b7.id); const cut7 = M.splitEdge(m7, ed7.id, 200, 0);
    M.removeNode(m7, cut7.node.id);
    check('à 2 parcours, supprimer le point les réunit (A → P → B redevient A → B)', m7.edges.length === 1 && m7.edges[0].from === a7.id && m7.edges[0].to === b7.id && m7.nodes.length === 2);

    // Éditeur : double-clic, Relier + parcours, bouton du détail
    const host5 = w.document.createElement('div'); w.document.body.appendChild(host5);
    const v5v = w.LayerPitchLevelMap.mount(host5, { tr, canEdit: true, libraries: { track: [], sfx: [], asset: [] },
      maps: [{ id: 'm5', title: 'T', data: { nodes: [{ id: 's', type: 'start', label: 'Début', x: 0, y: 0 }, { id: 'c', type: 'place', label: 'Château', x: 400, y: 0 }, { id: 'v', type: 'place', label: 'Ville', x: 200, y: 250 }, { id: 'p', type: 'npc', label: 'Marchand', x: 100, y: 200 }], edges: [{ id: 'e', from: 's', to: 'c' }] } }],
      save: async () => ({ id: 'm5' }), remove: async () => ({}), ask: async () => 'x', confirm: async () => true });
    v5v.state.view = { x: 0, y: 0, k: 1 };
    const geo = M.edgeGeometry(M.normalize({ nodes: [{ id: 's', type: 'start', x: 0, y: 0 }, { id: 'c', type: 'place', x: 400, y: 0 }], edges: [{ id: 'e', from: 's', to: 'c' }] }), { from: 's', to: 'c' });
    const ptr = (el, x, y, type) => el.dispatchEvent(Object.assign(new w.Event(type || 'pointerdown', { bubbles: true }), { clientX: x, clientY: y, pointerId: 1 }));
    const nodes5 = () => v5v.state.maps[0].data.nodes, edges5 = () => v5v.state.maps[0].data.edges;
    ptr(host5.querySelector('[data-edge="e"]'), geo.p1.x + (geo.p2.x - geo.p1.x) * 0.3, 0, 'dblclick');
    check('double-clic sur un parcours : un point de passage est créé et sélectionné', nodes5().filter(n => n.type === 'junction').length === 1 && edges5().length === 2 && v5v.state.sel.kind === 'node');
    const j1 = nodes5().find(n => n.type === 'junction');
    check('le point de passage est dessiné (petit rond)', !!host5.querySelector('[data-node="' + j1.id + '"] circle'));
    // Relier : Marchand (PNJ) puis le parcours d'arrivée du point -> un nouveau point, relié au Marchand
    host5.querySelector('#lmConnect').click();
    ptr(host5.querySelector('[data-node="p"]'), 100, 200);
    const second = edges5().find(e => e.from === j1.id);
    ptr(host5.querySelector('[data-edge="' + second.id + '"]'), 300, 0);
    check('Relier : un élément (PNJ) puis un parcours : un 2e point de passage est créé et relié au PNJ', nodes5().filter(n => n.type === 'junction').length === 2 && edges5().some(e => e.from === 'p' && nodes5().find(n => n.id === e.to).type === 'junction'));
    // Relier : un simple clic sur un parcours, sans élément choisi d'abord, ne crée RIEN (il le sélectionne)
    host5.querySelector('#lmConnect').click(); host5.querySelector('#lmConnect').click();
    const firstHalf = edges5().find(e => e.from === 's');
    const nBefore = nodes5().length, eBefore = edges5().length;
    ptr(host5.querySelector('[data-edge="' + firstHalf.id + '"]'), 40, 0);
    check('Relier : un clic sur un parcours sans élément choisi ne crée aucun point (il sélectionne le parcours)', nodes5().length === nBefore && edges5().length === eBefore && v5v.state.sel.kind === 'edge' && !v5v.state.linkFrom);
    // Relier : la Ville d'abord, puis le parcours -> point de passage relié à la Ville (embranchement)
    ptr(host5.querySelector('[data-node="v"]'), 200, 250);
    ptr(host5.querySelector('[data-edge="' + firstHalf.id + '"]'), 40, 0);
    check('Relier : un élément (Ville) puis un parcours : un point de passage est créé et relié à la Ville', nodes5().length === nBefore + 1 && edges5().length === eBefore + 2 && edges5().some(e => e.from === 'v' && nodes5().find(n => n.id === e.to).type === 'junction'));
    // Double-clic réel (deux appuis rapprochés sur le même parcours, sans événement « dblclick » : le dessin remplace l'élément entre les deux)
    if (v5v.state.connecting) host5.querySelector('#lmConnect').click();
    const tgt = edges5().find(e => e.to === 'c'), jBefore = nodes5().filter(n => n.type === 'junction').length;
    ptr(host5.querySelector('[data-edge="' + tgt.id + '"]'), 300, 0);
    check('un seul appui : le parcours est seulement sélectionné', nodes5().filter(n => n.type === 'junction').length === jBefore);
    ptr(host5.querySelector('[data-edge="' + tgt.id + '"]'), 301, 0);
    check('deux appuis rapprochés sur un parcours : un point de passage est créé (même sans événement dblclick)', nodes5().filter(n => n.type === 'junction').length === jBefore + 1);
    host5.querySelector('[data-edge]') && host5.querySelector('[data-edge]').dispatchEvent(new w.Event('dblclick', { bubbles: true }));
    check('l\'événement dblclick qui suit ne crée pas un deuxième point', nodes5().filter(n => n.type === 'junction').length === jBefore + 1);
    // bouton du détail
    if (v5v.state.connecting) host5.querySelector('#lmConnect').click(); // sortir du mode « Relier »
    const eSel = edges5()[0]; v5v.state.sel = { kind: 'edge', id: eSel.id }; host5.querySelector('#lmCanvas').dispatchEvent(new w.Event('pointerup', { bubbles: true }));
    const nj = nodes5().filter(n => n.type === 'junction').length;
    ptr(host5.querySelector('[data-edge="' + eSel.id + '"]'), 5, 5); // sélectionne le parcours -> inspecteur
    const splitBtn = host5.querySelector('#lmSplit');
    check('détail d\'un parcours : bouton « Insérer un point de passage »', !!splitBtn);
    if (splitBtn) splitBtn.click();
    check('…un clic coupe le parcours en son milieu', nodes5().filter(n => n.type === 'junction').length === nj + 1);
    // Se balader : la barre d'état est cachée hors du mode, puis on se place sur le Début sans rien sélectionner
    const now5 = host5.querySelector('#lmNow');
    check('hors du mode « se balader », la barre d\'état est cachée', !!now5 && now5.hidden === true && /\.lm-now\[hidden\]\s*\{\s*display:\s*none/.test(fs.readFileSync(path.join(__dirname, 'projet-carte.js'), 'utf8')));
    v5v.destroy();
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

  // ---- Balade : mention des flèches et témoin de chargement des morceaux (8/10)
  {
    const releases = [];
    const slowEnv = { now: () => 0, schedule: () => () => {}, voiceFactory: ref => new Promise(res => releases.push(() => res({ start() {}, setLevel() {}, stop() {}, isPlaying: () => true, nextBoundary: () => null }))) };
    const h9 = w.document.createElement('div'); w.document.body.appendChild(h9);
    const v9 = w.LayerPitchLevelMap.mount(h9, { tr, canEdit: true, audio: slowEnv, libraries: { track: [], sfx: [], asset: [] },
      maps: [{ id: 'm9', title: 'Lent', data: { nodes: [{ id: 'a', type: 'start', label: 'Début', x: 0, y: 0, sounds: { main: [{ kind: 'track', id: 'lourd', title: 'Lourd' }] } }], edges: [] } }],
      save: async m => ({ id: m.id }), remove: async () => ({}) });
    check('balade : la mention des flèches est visible avant de se lancer, et sur le bouton', /map_keysHint/.test(h9.querySelector('.lm-keys').textContent) && /map_playBtnHint/.test(h9.querySelector('#lmPlay').title));
    h9.querySelector('#lmPlay').click(); await wait(30);
    check('balade : pendant le chargement du morceau, « Chargement » est affiché', v9.audio.state.loading === 1 && !!h9.querySelector('.lm-loading'));
    releases.forEach(r => r()); await wait(30);
    check('balade : une fois chargé, le témoin disparaît', v9.audio.state.loading === 0 && !h9.querySelector('.lm-loading'));
  }

  // ---- Panneau de pilotage d'un morceau séquentiel pendant la balade (8/10) : libellés du morceau, atteignables, touches 1-9
  {
    const went = [];
    const seqVoice = { start() {}, setLevel() {}, stop() {}, isPlaying: () => true, nextBoundary: () => null,
      sequenceCount: () => 3, sequenceLabels: () => ['Calme', 'Tension', 'Séquence 3'], sequenceCurrent: () => 0, sequenceReachable: () => [1], sequencePending: () => -1,
      goToSequence: i => { went.push(i); return true; } };
    const seqEnv = { now: () => 0, schedule: () => () => {}, voiceFactory: async () => seqVoice };
    const h10 = w.document.createElement('div'); w.document.body.appendChild(h10);
    const v10 = w.LayerPitchLevelMap.mount(h10, { tr, canEdit: true, audio: seqEnv, libraries: { track: [], sfx: [], asset: [] },
      maps: [{ id: 'm10', title: 'Seq', data: { nodes: [{ id: 'a', type: 'start', label: 'Début', x: 0, y: 0, sounds: { main: [{ kind: 'track', id: 'seq', title: 'Séquentiel' }] } }], edges: [] } }],
      save: async m => ({ id: m.id }), remove: async () => ({}) });
    h10.querySelector('#lmPlay').click(); await wait(40);
    const seqBtns = [...h10.querySelectorAll('[data-seq]')];
    check('séquentiel en balade : un bouton par séquence, avec les libellés du morceau', seqBtns.length === 3 && /Calme/.test(seqBtns[0].textContent) && /Tension/.test(seqBtns[1].textContent));
    check('séquentiel en balade : la séquence en cours est mise en avant, seules les atteignables sont actives', seqBtns[0].classList.contains('primary') && !seqBtns[1].disabled && seqBtns[0].disabled && seqBtns[2].disabled);
    seqBtns[1].click();
    check('séquentiel en balade : cliquer une séquence la demande au morceau', went.join() === '1');
    h10.dispatchEvent(new w.KeyboardEvent('keydown', { key: '2', bubbles: true }));
    check('séquentiel en balade : la touche 2 demande la 2e séquence', went.join() === '1,1');
    // Le morceau change de séquence tout seul : le panneau suit sans qu'on fasse rien
    seqVoice.sequenceCurrent = () => 1; seqVoice.sequenceReachable = () => [0, 2];
    await wait(450);
    const seqBtns2 = [...h10.querySelectorAll('[data-seq]')];
    check('séquentiel en balade : quand le morceau change de séquence, le panneau suit (séquence en cours et atteignables)', seqBtns2[1].classList.contains('primary') && !seqBtns2[0].classList.contains('primary') && !seqBtns2[0].disabled && !seqBtns2[2].disabled && seqBtns2[1].disabled);
    h10.querySelector('#lmPlay').click(); await wait(30);
  }

  // ---- 2e musique pendant la balade (8/10) : bouton nommé, jingle de transition à la bascule
  {
    const plays = [];
    const mkV = key => ({ key, start(l) { plays.push(key + ' start'); }, setLevel() {}, stop() { plays.push(key + ' stop'); }, isPlaying: () => true, nextBoundary: () => null });
    const voices2 = {};
    const env2 = { now: () => 0, schedule: () => () => {}, voiceFactory: async ref => (voices2[ref.id] = voices2[ref.id] || mkV(ref.id)) };
    const h11 = w.document.createElement('div'); w.document.body.appendChild(h11);
    const v11 = w.LayerPitchLevelMap.mount(h11, { tr, canEdit: true, audio: env2, libraries: { track: [], sfx: [], asset: [] },
      maps: [{ id: 'm11', title: 'Deux', data: { nodes: [{ id: 'a', type: 'start', label: 'Début', x: 0, y: 0, altName: 'Poursuite', altTransition: { kind: 'sfx', id: 'whoosh', title: 'Whoosh' },
        sounds: { main: [{ kind: 'track', id: 'calme', title: 'Calme' }], combat: [{ kind: 'track', id: 'course', title: 'Course' }] } }], edges: [] } }],
      save: async m => ({ id: m.id }), remove: async () => ({}) });
    h11.querySelector('#lmPlay').click(); await wait(40);
    check('2e musique : le bouton porte le nom choisi', /Poursuite/.test(h11.querySelector('#lmCombat').textContent) && !h11.querySelector('#lmCombat').disabled);
    plays.length = 0; h11.querySelector('#lmCombat').click(); await wait(40);
    check('2e musique : la bascule joue le son de transition puis la 2e musique', plays.includes('whoosh start') && plays.includes('course start'));
    check('2e musique : le bouton propose alors le retour à la musique 1', /map_altBack/.test(h11.querySelector('#lmCombat').textContent));
    const h12 = w.document.createElement('div'); w.document.body.appendChild(h12);
    const v12 = w.LayerPitchLevelMap.mount(h12, { tr, canEdit: true, audio: env2, libraries: { track: [], sfx: [], asset: [] },
      maps: [{ id: 'm12', title: 'Une', data: { nodes: [{ id: 'a', type: 'start', label: 'Début', x: 0, y: 0, sounds: { main: [{ kind: 'track', id: 'calme', title: 'Calme' }] } }], edges: [] } }],
      save: async m => ({ id: m.id }), remove: async () => ({}) });
    h12.querySelector('#lmPlay').click(); await wait(40);
    check('une seule musique : le bouton de 2e musique est grisé', h12.querySelector('#lmCombat').disabled);
  }

  // ---- Fichier audio déposé depuis l'ordinateur (8/10) : envoyé par la page, la carte garde la référence
  {
    const uploads = [];
    const h8 = w.document.createElement('div'); w.document.body.appendChild(h8);
    const v8 = w.LayerPitchLevelMap.mount(h8, { tr, canEdit: true, libraries: { track: [], sfx: [], asset: [] },
      maps: [{ id: 'm8', title: 'Niveau', data: { nodes: [{ id: 'a', type: 'start', label: 'Début', x: 100, y: 100 }, { id: 'b', type: 'place', label: 'Lieu', x: 300, y: 100 }], edges: [{ id: 'e', from: 'a', to: 'b' }] } }],
      save: async m => ({ id: m.id }), remove: async () => ({}),
      uploadSound: async f => { uploads.push(f.name); return { ref: { kind: 'asset', id: 'asset-' + f.name, title: f.name } }; } });
    const fileDrop = (el, files) => { const ev = new w.Event('drop', { bubbles: true, cancelable: true }); ev.dataTransfer = { types: ['Files'], files, getData: () => '' }; el.dispatchEvent(ev); return ev; };
    const fileOver = (el) => { const ev = new w.Event('dragover', { bubbles: true, cancelable: true }); ev.dataTransfer = { types: ['Files'] }; el.dispatchEvent(ev); return ev; };
    const mkF = (name, type) => new w.File(['x'], name, { type });
    const settle2 = () => new Promise(r => setTimeout(r, 30));
    check('fond d\'ambiance : un fichier de l\'ordinateur survole la zone, dépôt accepté', fileOver(h8.querySelector('#lmRoomZone')).defaultPrevented);
    fileDrop(h8.querySelector('#lmRoomZone'), [mkF('ambiance.wav', 'audio/wav')]); await settle2();
    check('fond d\'ambiance : fichier audio déposé = envoyé, et pris comme fond (référence « asset »)', uploads.join() === 'ambiance.wav' && v8.state.maps[0].data.roomTone && v8.state.maps[0].data.roomTone.kind === 'asset' && v8.state.maps[0].data.roomTone.id === 'asset-ambiance.wav');
    fileDrop(h8.querySelector('#lmRoomZone'), [mkF('image.png', 'image/png')]); await settle2();
    check('un fichier qui n\'est pas de l\'audio est refusé (rien n\'est envoyé)', uploads.length === 1 && /map_dropAudioOnly/.test(h8.textContent));
    fileDrop(h8.querySelector('[data-node="b"]'), [mkF('theme.mp3', 'audio/mpeg'), mkF('boucle.ogg', 'audio/ogg')]); await settle2();
    const nb = v8.state.maps[0].data.nodes.find(n => n.id === 'b');
    check('fichiers audio déposés sur un lieu : tous envoyés et ajoutés à son emplacement principal', uploads.length === 3 && nb.sounds.main.length === 2 && nb.sounds.main[0].kind === 'asset');
    fileDrop(h8.querySelector('[data-edge="e"]'), [mkF('vent.m4a', '')]); await settle2();
    check('sur un parcours aussi (type reconnu par l\'extension)', v8.state.maps[0].data.edges[0].sounds.main.length === 1);
    const hNo = w.document.createElement('div'); w.document.body.appendChild(hNo);
    w.LayerPitchLevelMap.mount(hNo, { tr, canEdit: true, libraries: { track: [], sfx: [], asset: [] }, maps: [{ id: 'mn', title: 'N', data: { nodes: [], edges: [] } }], save: async m => ({ id: m.id }), remove: async () => ({}) });
    check('sans fonction d\'envoi fournie : les fichiers ne sont pas acceptés', !fileOver(hNo.querySelector('#lmRoomZone')).defaultPrevented);
  }

  // ---- Boutons « Fichiers » et « Sections » (8/10) : seulement si la page fournit les fonctions
  {
    const calls = [];
    const h6 = w.document.createElement('div'); w.document.body.appendChild(h6);
    w.LayerPitchLevelMap.mount(h6, { tr, canEdit: true, libraries: { track: [], sfx: [], asset: [] }, maps: [{ id: 'mx', title: 'Niveau X', data: { nodes: [], edges: [] } }],
      save: async m => ({ id: m.id }), remove: async () => ({}), downloadFiles: m => calls.push('dl:' + m.id), linkSections: m => calls.push('link:' + m.id), linkedNames: m => 'Forêt, Château' });
    check('carte : boutons Fichiers et Sections proposés', !!h6.querySelector('#lmDownload') && !!h6.querySelector('#lmLinkSec'));
    check('carte : le bouton Sections affiche les sections reliées', /Forêt, Château/.test(h6.querySelector('#lmLinkSec').textContent));
    h6.querySelector('#lmLinkSec').click(); h6.querySelector('#lmDownload').click();
    check('carte : les boutons appellent la page avec la carte courante', calls.join() === 'link:mx,dl:mx');
    const h7 = w.document.createElement('div'); w.document.body.appendChild(h7);
    w.LayerPitchLevelMap.mount(h7, { tr, canEdit: true, libraries: { track: [], sfx: [], asset: [] }, maps: [{ id: 'my', title: 'Y', data: { nodes: [], edges: [] } }], save: async m => ({ id: m.id }), remove: async () => ({}) });
    check('carte : sans fonctions fournies (sections fermées), pas de boutons', !h7.querySelector('#lmLinkSec') && !h7.querySelector('#lmDownload'));
  }

  console.log(failures ? failures + ' échec(s)' : 'Tout est vert');
  process.exit(failures ? 1 : 0);
})();
