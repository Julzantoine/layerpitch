// Carte de niveau, monde ouvert (27/10) : zones (rectangle, ovale, forme libre, imbriquées), cercles de proximité, modes de déplacement,
// règle « cercle d'un élément > mode de déplacement > zone » (avec la case « garder la musique de la zone »), combat, fond d'ambiance,
// sous-cartes et fil d'Ariane ; puis le lecteur (follow) avec de faux sons, et l'éditeur dans une page jetable.
// Le serveur (validation, liens retirés à la suppression) est testé par test_cartes_de_niveau.js.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const flush = () => new Promise(r => setImmediate(r));
  const dom = new JSDOM('<div id="host"></div>', { url: 'https://beta.layerpitch.com/projet.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(__dirname, 'projet-carte.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, 'projet-carte-audio.js'), 'utf8'));
  const M = w.LayerPitchLevelMap.model, A = w.LayerPitchLevelMapAudio;
  const T = (id, title) => ({ kind: 'track', id, title: title || id });
  const key = t => (t ? t.kind + ':' + t.id : 'rien');

  // ---- Zones : formes et imbrication
  const map = M.emptyMap();
  const forest = M.addZone(map, 'rect', 0, 0, 1000, 800, 'Forêt');
  const lake = M.addZone(map, 'ellipse', 600, 400, 300, 200, 'Lac');
  const village = M.addPolyZone(map, [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 250, y: 400 }], 'Village');
  check('zones créées (rectangle, ovale, forme libre), chacune sa couleur', !!forest && !!lake && !!village && new Set([forest.color, lake.color, village.color]).size === 3);
  check('forme libre de 2 points refusée', M.addPolyZone(map, [{ x: 0, y: 0 }, { x: 10, y: 10 }]) === null);
  check('forme inconnue refusée', M.addZone(map, 'etoile', 0, 0, 10, 10) === null);
  check('rectangle : dedans / dehors', M.zoneContains(forest, 10, 10) && !M.zoneContains(forest, 1001, 10));
  check('ovale : le centre dedans, le coin du cadre dehors', M.zoneContains(lake, 750, 500) && !M.zoneContains(lake, 605, 405));
  check('forme libre : dedans / dehors (lancer de rayon)', M.zoneContains(village, 250, 200) && !M.zoneContains(village, 120, 380));
  check('zones imbriquées : la plus intérieure d\'abord (village dans la forêt)', M.zonesAt(map, 250, 200).map(z => z.label).join() === 'Village,Forêt');
  check('hors de toute zone : rien', M.zonesAt(map, 2000, 2000).length === 0);
  M.resizeZone(forest, 'nw', -200, -100);
  check('redimensionner par le coin haut-gauche : le coin opposé reste en place', forest.x === -200 && forest.y === -100 && forest.x + forest.w === 1000 && forest.y + forest.h === 800);
  M.resizeZone(forest, 'se', 1200, 900); check('redimensionner par le coin bas-droite', forest.w === 1400 && forest.h === 1000);
  check('poignée d\'une forme libre : point ajouté sur le côté le plus proche, puis retiré', M.insertZonePoint(village, 250, 90) === 1 && village.points.length === 4 && M.removeZonePoint(village, 1) && village.points.length === 3);
  check('une forme libre garde au moins 3 points', !M.removeZonePoint(village, 0));
  M.moveZone(lake, 10, 0); check('déplacer une zone', lake.x === 610);

  // ---- Qui joue : cercle > mode de déplacement > zone
  M.addSound(map, { kind: 'zone', id: forest.id }, 'main', T('foret'));
  M.addSound(map, { kind: 'zone', id: village.id }, 'main', T('village'));
  M.addSound(map, { kind: 'zone', id: forest.id }, 'combat', T('combatForet'));
  M.addSound(map, { kind: 'zone', id: forest.id }, 'room', { kind: 'sfx', id: 'oiseaux', title: 'Oiseaux' });
  const castle = M.addNode(map, 'place', 900, 700, 'Château');
  M.addSound(map, { kind: 'node', id: castle.id }, 'main', T('chateau'));
  const horse = M.addMode(map, 'Cheval', 420), foot = M.addMode(map, 'À pied', 140);
  M.addSound(map, { kind: 'mode', id: horse.id }, 'main', T('galop'));
  check('mode de déplacement : sons posés comme sur un élément', map.modes.length === 2 && map.modes[0].sounds.main[0].id === 'galop');
  check('à pied dans la forêt : la musique de la forêt', key(M.governorAt(map, 800, 100, foot.id, false)) === 'zone:' + forest.id);
  check('à pied dans le village : la zone la plus intérieure', key(M.governorAt(map, 250, 200, foot.id, false)) === 'zone:' + village.id);
  check('à cheval dans la forêt : le thème du cheval passe devant la zone', key(M.governorAt(map, 800, 100, horse.id, false)) === 'mode:' + horse.id);
  check('à cheval dans le village (pas coché) : toujours le cheval', key(M.governorAt(map, 250, 200, horse.id, false)) === 'mode:' + horse.id);
  village.keepMusic = true;
  check('village coché « garder sa musique même en monture » : sa musique passe devant le cheval', key(M.governorAt(map, 250, 200, horse.id, false)) === 'zone:' + village.id);
  check('… mais en forêt, le cheval reprend', key(M.governorAt(map, 800, 100, horse.id, false)) === 'mode:' + horse.id);
  check('cercle d\'un élément : sa musique passe devant tout, même à cheval', key(M.governorAt(map, 900, 650, horse.id, false)) === 'node:' + castle.id);
  check('juste hors du cercle (rayon 90 par défaut) : de nouveau le cheval', key(M.governorAt(map, 900, 600, horse.id, false)) === 'mode:' + horse.id);
  M.setRadius(map, castle.id, 200);
  check('cercle agrandi (200) : le château joue déjà là', key(M.governorAt(map, 900, 600, horse.id, false)) === 'node:' + castle.id && M.radiusOf(castle) === 200);
  check('combat à cheval en forêt : le premier qui a une 2e musique (la forêt)', key(M.governorAt(map, 800, 100, horse.id, true)) === 'zone:' + forest.id);
  check('combat dans le village (pas de 2e musique) : celle de la forêt qui l\'entoure', key(M.governorAt(map, 250, 200, foot.id, true)) === 'zone:' + forest.id);
  check('combat là où rien n\'a de 2e musique : la musique ordinaire', key(M.governorAt(map, 5000, 5000, horse.id, true)) === 'mode:' + horse.id);
  check('hors de toute zone, à pied : rien ne joue', M.governorAt(map, 5000, 5000, foot.id, false) === null);
  check('hors de toute zone, à cheval : le cheval', key(M.governorAt(map, 5000, 5000, horse.id, false)) === 'mode:' + horse.id);
  check('fond d\'ambiance : celui de la zone (forêt), y compris dans le village qui n\'en a pas', M.roomAt(map, 250, 200).id === 'oiseaux' && M.roomAt(map, 5000, 5000) === null);
  map.roomTone = { kind: 'sfx', id: 'vent', title: 'Vent' };
  check('fond d\'ambiance hors des zones : celui de la carte', M.roomAt(map, 5000, 5000).id === 'vent');
  check('points de passage et transitions n\'ont pas de cercle', !M.hasCircle(M.addNode(map, 'junction', 0, 0)) && M.hasCircle(castle));
  check('modes par défaut : un seul « à pied » implicite quand la carte n\'en a pas', M.modesOf(M.emptyMap()).length === 1 && M.modesOf(M.emptyMap())[0].id === null);
  check('allure suivante proposée d\'après les noms pris', M.nextModePreset({ modes: [{ label: 'walk' }] }, k => k).key === 'run');
  check('vitesse : celle du mode, sinon par défaut', M.speedOf(map, horse.id) === 420 && M.speedOf(map, 'inconnu') === 420 && M.speedOf(M.emptyMap(), null) === M.DEFAULT_SPEED);

  // ---- Sous-cartes
  check('relier un élément à une sous-carte', M.setLink(map, { kind: 'node', id: castle.id }, 'map-chateau') && castle.link === 'map-chateau');
  check('relier une zone', M.setLink(map, { kind: 'zone', id: village.id }, 'map-village') && village.link === 'map-village');
  check('identifiant de carte invalide refusé', !M.setLink(map, { kind: 'node', id: castle.id }, 'a b'));
  check('un parcours ne mène pas à une sous-carte', !M.setLink(map, { kind: 'edge', id: 'x' }, 'map-chateau'));
  check('lien trouvé dans le cercle du château', (l => l && l.mapId === 'map-chateau' && l.kind === 'node')(M.linkAt(map, 900, 650)));
  check('lien d\'une zone (village)', (l => l && l.mapId === 'map-village' && l.kind === 'zone')(M.linkAt(map, 250, 200)));
  check('lien vers une carte disparue ignoré', M.linkAt(map, 900, 650, ['map-village']) === null);
  M.setLink(map, { kind: 'node', id: castle.id }, null); check('retirer le lien', !('link' in castle));
  M.setLink(map, { kind: 'node', id: castle.id }, 'map-chateau');
  let r = M.trailEnter([], 'monde', { kind: 'node', id: castle.id }, { x: 900, y: 650 }, 'chateau');
  check('fil d\'Ariane : entrer empile la carte quittée et l\'endroit', r.trail.length === 1 && r.trail[0].mapId === 'monde' && r.trail[0].at.x === 900 && r.back === null);
  r = M.trailEnter(r.trail, 'chateau', null, null, 'donjon');
  check('fil d\'Ariane : Monde › Château › Donjon', r.trail.map(s => s.mapId).join() === 'monde,chateau');
  const loop = M.trailEnter(r.trail, 'donjon', null, null, 'monde');
  check('pas de boucle : un lien vers une carte déjà dans le fil y ramène', loop.trail.length === 0 && loop.back && loop.back.mapId === 'monde' && loop.back.at.x === 900);

  // ---- Lecture : enregistrée et relue à l'identique
  const round = M.normalize(JSON.parse(JSON.stringify(map)));
  check('relue : zones, formes, couleurs, cases, liens', round.zones.length === 3 && round.zones[2].shape === 'poly' && round.zones[2].keepMusic === true && round.zones[2].link === 'map-village' && round.zones[0].color === forest.color);
  check('relue : modes de déplacement et rayons', round.modes.length === 2 && round.modes[0].speed === 420 && round.nodes.find(n => n.id === castle.id).radius === 200 && round.nodes.find(n => n.id === castle.id).link === 'map-chateau');
  check('relue : une carte ancienne (sans monde ouvert) garde sa forme', (o => !o.nodes[0].link && !('radius' in o.nodes[0]) && o.zones.length === 0 && o.background === null)(M.normalize({ nodes: [{ id: 'n1', type: 'start', x: 0, y: 0 }], edges: [] })));
  check('relue : image de fond (image du Projet) et opacité bornée', (o => o.background && o.background.id === 'img1' && o.background.opacity === 0.1)(M.normalize({ nodes: [], edges: [], background: { kind: 'asset', id: 'img1', x: 0, y: 0, w: 100, h: 50, opacity: 0 } })));
  check('relue : zone mal formée écartée', M.normalize({ nodes: [], edges: [], zones: [{ id: 'z', shape: 'rect', w: 0, h: 10 }, { id: 'p', shape: 'poly', points: [{ x: 0, y: 0 }] }] }).zones.length === 0);
  check('bilan : les zones sont comptées', M.summary(map).zones === 3);

  // ---- Lecteur : follow (balade libre)
  {
    const clock = { t: 100, timers: [] }, log = [], voices = {};
    const env = {
      now: () => clock.t,
      schedule: (fn, at) => { const timer = { fn, at, live: true }; clock.timers.push(timer); return () => { timer.live = false; }; },
      voiceFactory: async ref => {
        const k = ref.kind + ':' + ref.id;
        if (!voices[k]) voices[k] = { playing: false, start() { this.playing = true; log.push(k + ' start'); }, setLevel() {}, stop() { this.playing = false; log.push(k + ' stop'); }, isPlaying() { return this.playing; }, nextBoundary: () => null };
        return voices[k];
      },
      onChange: () => {}
    };
    const advance = async sec => { const to = clock.t + sec; for (;;) { const due = clock.timers.filter(x => x.live && x.at <= to).sort((a, b) => a.at - b.at)[0]; if (!due) break; due.live = false; clock.t = Math.max(clock.t, due.at); due.fn(); await flush(); } clock.t = to; await flush(); };
    const p = A.createPlayer(env); p.setMap(map);
    await p.follow({ kind: 'zone', id: forest.id }, { room: M.roomAt(map, 800, 100) }); await advance(3);
    check('lecteur : la zone joue sa musique, avec le fond d\'ambiance donné', p.state.music.id === 'foret' && p.state.room.id === 'oiseaux' && p.state.playing);
    check('lecteur : rien ne change si la page redemande la même chose', (await p.follow({ kind: 'zone', id: forest.id }, { room: M.roomAt(map, 800, 100) })) === false);
    await p.follow({ kind: 'mode', id: horse.id }, { room: M.roomAt(map, 800, 100) }); await advance(3);
    check('lecteur : à cheval, le thème du cheval (fondu depuis la forêt)', p.state.music.id === 'galop' && p.state.position.kind === 'mode' && voices['track:foret'].playing === false);
    await p.follow({ kind: 'zone', id: forest.id }, { combat: true, room: null }); await advance(3);
    check('lecteur : combat dans la forêt = sa 2e musique ; fond coupé', p.state.music.id === 'combatForet' && p.state.combat && p.state.room === null);
    await p.follow(null, { room: map.roomTone }); await advance(3);
    check('lecteur : hors de tout, la musique s\'éteint, le fond de la carte reste', p.state.music === null && p.state.room.id === 'vent' && !voices['track:combatForet'].playing);
    p.stop(0); await advance(1);
    await p.resume(); await advance(1);
    check('lecteur : reprendre après une pause en balade libre', p.state.playing && p.state.room.id === 'vent');
    // La musique continue d'une carte à l'autre : le lecteur garde le son en cours si la sous-carte joue le même.
    const sub = M.emptyMap(); const subStart = M.addNode(sub, 'start', 0, 0, 'Entrée'); M.addSound(sub, { kind: 'node', id: subStart.id }, 'main', T('galop'));
    await p.follow({ kind: 'mode', id: horse.id }, {}); await advance(3);
    const starts = log.filter(l => l === 'track:galop start').length;
    p.setMap(sub); await p.goTo({ kind: 'node', id: subStart.id }); await advance(3);
    check('lecteur : changer de carte avec le même morceau ne le relance pas', p.state.music.id === 'galop' && log.filter(l => l === 'track:galop start').length === starts);
  }

  // ---- Éditeur : zones, sous-cartes, balade libre
  {
    const tr = (k, v) => k + (v ? JSON.stringify(v) : '');
    const host = w.document.getElementById('host');
    const saved = [];
    const world = { id: 'monde', title: 'Monde', data: M.normalize(JSON.parse(JSON.stringify(map))) };
    const castleMap = { id: 'map-chateau', title: 'Château', data: { nodes: [{ id: 'cs', type: 'start', x: 0, y: 0, label: 'Porte', sounds: { main: [T('chateau')] } }], edges: [] } };
    let nextId = 1;
    const fakeAudio = { voiceFactory: async ref => ({ start() {}, setLevel() {}, stop() {}, isPlaying: () => true, nextBoundary: () => null, ref }), now: () => 0, schedule: (fn) => { fn(); return () => {}; } };
    const view = w.LayerPitchLevelMap.mount(host, { tr, canEdit: true, libraries: { track: [], sfx: [], asset: [] }, maps: [world, castleMap], openId: 'monde', audio: fakeAudio,
      images: [{ id: 'img1', title: 'Carte du monde' }], imageUrl: async () => 'data:image/png;base64,iVBORw0KGgo=',
      save: async m => { saved.push(m); return { id: m.id || 'new' + (nextId++) }; }, remove: async () => ({}), ask: async (q, v) => v, confirm: async () => true });
    const svg = () => host.querySelector('#lmSvg');
    check('éditeur : les trois zones sont dessinées, la plus petite par-dessus', svg().querySelectorAll('[data-zone]').length === 3 && [...svg().querySelectorAll('g[data-zone]')].pop().dataset.zone === village.id);
    check('éditeur : cercles de proximité visibles sur une carte à zones', svg().querySelectorAll('.lm-circle').length >= 1);
    check('éditeur : boutons de zone (rectangle, ovale, forme libre)', !!host.querySelector('button[data-zone="rect"]') && !!host.querySelector('button[data-zone="ellipse"]') && !!host.querySelector('button[data-zone="poly"]'));
    host.querySelector('button[data-zone="rect"]').click();
    const st = view.state;
    check('éditeur : « Zone » ajoute un rectangle et le sélectionne', st.sel && st.sel.kind === 'zone' && st.maps[0].data.zones.length === 4);
    check('éditeur : zone sélectionnée = 4 poignées de coin', svg().querySelectorAll('[data-zh]').length === 4);
    check('éditeur : le détail d\'une zone propose couleur, « garder la musique », lien de sous-carte', !!host.querySelector('#lmInsp [data-color]') && !!host.querySelector('#lmKeep') && !!host.querySelector('#lmLink'));
    const opts = [...host.querySelectorAll('#lmLink option')].map(o => o.value);
    check('éditeur : le lien propose les autres cartes (pas celle-ci) et « nouvelle carte »', opts.includes('map-chateau') && !opts.includes('monde') && opts.includes('__new'));
    // Forme libre : trois clics puis Entrée
    host.querySelector('button[data-zone="poly"]').click();
    check('éditeur : mode dessin de forme libre', !!st.drawing);
    const canvas = host.querySelector('#lmCanvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 400 });
    const down = (x, y, extra) => canvas.dispatchEvent(new w.MouseEvent('pointerdown', Object.assign({ bubbles: true, clientX: x, clientY: y }, extra || {})));
    const up = (x, y) => canvas.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
    [[10, 10], [200, 10], [100, 200]].forEach(([x, y]) => { down(x, y); up(x, y); });
    check('éditeur : chaque clic pose un point', st.drawing && st.drawing.points.length === 3);
    host.onkeydown({ key: 'Enter', target: canvas, preventDefault() {} });
    check('éditeur : Entrée ferme la forme libre (nouvelle zone sélectionnée)', !st.drawing && st.maps[0].data.zones.length === 5 && st.maps[0].data.zones[4].shape === 'poly' && st.sel.id === st.maps[0].data.zones[4].id);
    // Sous-carte : double-clic sur le château ouvre sa carte, avec le fil d'Ariane
    st.view = { x: 0, y: 0, k: 1 }; view.render();
    const castleEl = host.querySelector(`[data-node="${castle.id}"]`);
    castleEl.querySelector('rect').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 900, clientY: 700 }));
    castleEl.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
    host.querySelector(`[data-node="${castle.id}"] rect`).dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 900, clientY: 700 }));
    check('éditeur : double-clic sur un élément relié = la sous-carte s\'ouvre', st.current === 'map-chateau' && st.trail.length === 1 && st.trail[0].mapId === 'monde');
    check('éditeur : fil d\'Ariane « Monde › Château »', /Monde/.test(host.querySelector('.lm-crumbs').textContent) && /Château/.test(host.querySelector('.lm-crumbs b').textContent));
    host.querySelector('#lmCrumbBack').click();
    check('éditeur : « Revenir » ramène au monde, l\'élément sélectionné', st.current === 'monde' && st.trail.length === 0 && st.sel && st.sel.id === castle.id);
    // Balade libre
    st.sel = null;
    host.querySelector('#lmPlay').click(); await flush();
    const start = M.normalize(world.data).nodes.find(n => n.type === 'start');
    check('balade libre : le personnage apparaît (au Début, sinon au centre de la plus grande zone)', !!st.avatar && !!host.querySelector('#lmAvatar') && (start ? st.avatar.x === start.x : true));
    check('balade libre : la barre montre les déplacements et les touches', /map_modesNow/.test(host.querySelector('#lmNow').textContent) && /map_freeKeys/.test(host.querySelector('#lmNow').textContent));
    // Se placer dans le cercle du château : bouton « Entrer », puis E
    view.state.avatar = { x: castle.x, y: castle.y };
    host.onkeydown({ key: 'm', code: 'KeyM', target: canvas, preventDefault() {} });
    check('balade libre : M passe au déplacement suivant', st.modeId === foot.id);
    check('balade libre : dans le cercle du château, sa musique et le bouton « Entrer »', st.gov && st.gov.kind === 'node' && st.gov.id === castle.id && !!host.querySelector('#lmEnter'));
    host.onkeydown({ key: 'e', code: 'KeyE', target: canvas, preventDefault() {} }); await flush();
    check('balade libre : E entre dans le château (couloir : on arrive à son Début)', st.current === 'map-chateau' && st.trail.length === 1 && st.trail[0].at && st.trail[0].at.x === castle.x);
    check('balade dans la sous-carte : bouton « Sortir »', !!host.querySelector('#lmExit'));
    host.onkeydown({ key: 'x', code: 'KeyX', target: host.querySelector('#lmCanvas'), preventDefault() {} }); await flush();
    check('X : retour au monde, le personnage là où il était', st.current === 'monde' && st.trail.length === 0 && st.avatar && st.avatar.x === castle.x && st.play);
    view.destroy();
  }

  console.log(failures ? failures + ' échec(s)' : 'Tout est vert');
  process.exit(failures ? 1 : 0);
})();
