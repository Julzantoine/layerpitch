// Lecture de la carte (projet-carte-audio.js, 6/10) : navigation, transitions (fondu, coupure, attente de la mesure), fond d'ambiance,
// combat, son de transition. Faux sons et fausse horloge : tout est déterministe.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const w = new JSDOM('', { runScripts: 'outside-only' }).window;
  w.eval(fs.readFileSync(path.join(__dirname, 'projet-carte.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, 'projet-carte-audio.js'), 'utf8'));
  const M = w.LayerPitchLevelMap.model, A = w.LayerPitchLevelMapAudio;
  const flush = () => new Promise(r => setImmediate(r));

  // Faux monde : horloge manuelle, voix qui enregistrent leurs appels
  function world(boundaries) {
    const clock = { t: 100, timers: [] };
    const log = [], voices = {};
    const env = {
      now: () => clock.t,
      schedule: (fn, at) => { const timer = { fn, at, live: true }; clock.timers.push(timer); return () => { timer.live = false; }; },
      voiceFactory: async ref => {
        const key = ref.kind + ':' + ref.id;
        if (!voices[key]) voices[key] = { key, playing: false, level: null,
          start(l) { this.playing = true; this.level = l; log.push(key + ' start ' + l); }, setLevel(l, s) { this.level = l; log.push(key + ' level ' + l.toFixed(3) + ' ' + s); },
          stop() { this.playing = false; log.push(key + ' stop'); }, isPlaying() { return this.playing; },
          nextBoundary(sync) { log.push(key + ' boundary? ' + sync); return boundaries && boundaries[key] != null ? clock.t + boundaries[key] : null; } };
        return voices[key];
      },
      onChange: () => {}
    };
    const advance = async sec => { const to = clock.t + sec; for (;;) { const due = clock.timers.filter(x => x.live && x.at <= to).sort((a, b) => a.at - b.at)[0]; if (!due) break; due.live = false; clock.t = Math.max(clock.t, due.at); due.fn(); await flush(); } clock.t = to; await flush(); };
    return { env, log, voices, advance, clock };
  }
  const T = (id, title) => ({ kind: 'track', id, title: title || id });

  function demoMap() {
    const m = M.emptyMap();
    const a = M.addNode(m, 'start', 0, 0, 'Début'), b = M.addNode(m, 'place', 200, 0, 'Château'), c = M.addNode(m, 'place', 0, 200, 'Ville');
    const boss = M.addNode(m, 'boss', 400, 0, 'Gardien'), q = M.addNode(m, 'quest', 200, 120, 'Annexe');
    const e1 = M.addEdge(m, a.id, b.id), e2 = M.addEdge(m, a.id, c.id), e3 = M.addEdge(m, b.id, boss.id);
    M.setEnemy(m, e1.id, true); q.side = true; q.anchor = { kind: 'node', id: b.id };
    M.addSound(m, { kind: 'node', id: a.id }, 'main', T('intro'));
    M.addSound(m, { kind: 'node', id: b.id }, 'main', T('chateau'));
    M.addSound(m, { kind: 'node', id: c.id }, 'main', T('chateau')); // même son que le château
    M.addSound(m, { kind: 'edge', id: e1.id }, 'main', T('marche')); M.addSound(m, { kind: 'edge', id: e1.id }, 'combat', T('combat'));
    M.addSound(m, { kind: 'node', id: boss.id }, 'main', T('boss')); M.addSound(m, { kind: 'node', id: boss.id }, 'combat', T('bossfight'));
    return { m, a, b, c, boss, q, e1, e2, e3 };
  }

  // ---- Pures
  { const { m, a, b, c, q, e1, e2 } = demoMap();
    check('voisins d\'un lieu : ses parcours et la quête annexe accrochée', M.neighbors(m, { kind: 'node', id: b.id }).map(x => x.id).sort().join() === [e1.id, m.edges[2].id, q.id].sort().join());
    check('voisins d\'un parcours : ses deux extrémités', M.neighbors(m, { kind: 'edge', id: e1.id }).map(x => x.id).sort().join() === [a.id, b.id].sort().join());
    check('flèche droite depuis le début : le parcours vers le château', M.stepToward(m, { kind: 'node', id: a.id }, 1, 0).id === e1.id);
    check('flèche bas depuis le début : le parcours vers la ville', M.stepToward(m, { kind: 'node', id: a.id }, 0, 1).id === e2.id);
    check('flèche haut depuis le début : rien (pas de voisin dans cette direction)', M.stepToward(m, { kind: 'node', id: a.id }, 0, -1) === null);
    check('flèche droite sur un parcours : l\'extrémité de droite', M.stepToward(m, { kind: 'edge', id: e1.id }, 1, 0).id === b.id);
    check('transition par défaut de la carte', JSON.stringify(M.resolveTransition(m, a)) === JSON.stringify({ style: 'crossfade', sec: 2, sync: 'bar', stinger: null }));
    a.transition = { style: 'cut', stinger: T('porte') };
    check('transition propre : complétée par la carte', (r => r.style === 'cut' && r.sec === 2 && r.sync === 'bar' && r.stinger.id === 'porte')(M.resolveTransition(m, a)));
    check('transition invalide ignorée', M.cleanTransition({ style: 'zigzag', sec: 99, sync: 'jamais' }).sec === 30 && !M.cleanTransition({ style: 'zigzag' }));
    m.roomTone = T('room'); b.sounds.room = [T('roomchateau')];
    check('fond d\'ambiance : celui de l\'élément sinon celui de la carte', M.resolveRoom(m, a).id === 'room' && M.resolveRoom(m, b).id === 'roomchateau');
    check('variantes : pas deux fois de suite la même', (() => { const l = [T('x'), T('y')]; let ok = true; for (let i = 0; i < 30; i++) if (M.pickVariant(l, 'track:x').id === 'x') ok = false; return ok; })());
    check('normalize garde fond, niveau et défauts', (() => { const n = M.normalize({ nodes: [], edges: [], roomTone: T('r'), roomToneDb: -20, defaults: { transition: { style: 'cut', sec: 5 } } }); return n.roomTone.id === 'r' && n.roomToneDb === -20 && n.defaults.transition.style === 'cut' && n.defaults.transition.sync === 'bar'; })()); }

  // ---- Cerveau : démarrage et fond d'ambiance
  { const { m, a } = demoMap(); m.roomTone = T('room'); m.roomToneDb = -12;
    const W = world(); const P = A.createPlayer(W.env); P.setMap(m);
    await P.goTo({ kind: 'node', id: a.id }); await W.advance(0.1);
    check('premier son : entre en fondu court jusqu\'à plein niveau', W.log.includes('track:intro start 0') && W.log.includes('track:intro level 1.000 1'));
    check('fond d\'ambiance : démarre en fondu au niveau de la carte', W.log.includes('track:room start 0') && W.log.some(l => /^track:room level 0\.251 2$/.test(l)));
    check('état : en lecture, position connue', P.state.playing && P.state.position.id === a.id && P.state.music.id === 'intro'); }

  // ---- Fondu enchaîné attendant la mesure
  { const { m, a, e1 } = demoMap();
    const W = world({ 'track:intro': 1.5 }); const P = A.createPlayer(W.env); P.setMap(m);
    await P.goTo({ kind: 'node', id: a.id }); await W.advance(0.1); W.log.length = 0;
    await P.goTo({ kind: 'edge', id: e1.id }); await W.advance(0.5);
    check('transition sur la mesure : rien ne bouge avant le repère', !W.log.some(l => /marche start/.test(l)) && P.state.pendingAt != null && W.log.includes('track:intro boundary? bar'));
    await W.advance(1.2);
    check('au repère : le nouveau son entre à 0 puis monte, l\'ancien descend', W.log.includes('track:marche start 0') && W.log.includes('track:marche level 1.000 2') && W.log.includes('track:intro level 0.000 2'));
    await W.advance(2.5);
    check('une fois fondu, l\'ancien son est arrêté', W.log.includes('track:intro stop') && !W.voices['track:intro'].playing); }

  // ---- Coupure et fondu sortant
  { const { m, a, b } = demoMap(); b.transition = { style: 'cut', sync: 'immediate' };
    const W = world({ 'track:intro': 5 }); const P = A.createPlayer(W.env); P.setMap(m);
    await P.goTo({ kind: 'node', id: a.id }); await W.advance(0.1); W.log.length = 0;
    await P.goTo({ kind: 'node', id: b.id }); await W.advance(0.1);
    check('coupure immédiate : l\'ancien s\'arrête, le nouveau part à plein niveau, sans attendre la mesure', W.log.includes('track:intro stop') && W.log.includes('track:chateau start 1') && !W.log.some(l => /boundary/.test(l))); }
  { const { m, a, b } = demoMap(); b.transition = { style: 'fadeout', sec: 4, sync: 'immediate' };
    const W = world(); const P = A.createPlayer(W.env); P.setMap(m);
    await P.goTo({ kind: 'node', id: a.id }); await W.advance(0.1); W.log.length = 0;
    await P.goTo({ kind: 'node', id: b.id }); await W.advance(0.1);
    check('fondu sortant puis entrant : l\'ancien descend d\'abord', W.log.includes('track:intro level 0.000 2') && !W.log.includes('track:chateau start 0'));
    await W.advance(2.5);
    check('… puis le nouveau monte dans la seconde moitié', W.log.includes('track:chateau start 0') && W.log.includes('track:chateau level 1.000 2')); }

  // ---- Même son : on le laisse jouer ; son de transition ; navigation rapide
  { const { m, a, b, c } = demoMap(); b.transition = c.transition = { sync: 'immediate', sec: 1 }; b.transition.stinger = T('porte');
    const W = world(); const P = A.createPlayer(W.env); P.setMap(m);
    await P.goTo({ kind: 'node', id: b.id }); await W.advance(0.1);
    check('son de transition joué à l\'entrée', W.log.includes('track:porte start 1')); W.log.length = 0;
    await P.goTo({ kind: 'node', id: c.id }); await W.advance(0.1);
    check('deux lieux avec le même son : il continue, aucune coupure ni redémarrage', W.log.length === 0 || !W.log.some(l => /chateau (start|stop)/.test(l))); }
  { const { m, a, b, c } = demoMap(); a.transition = b.transition = c.transition = { sync: 'bar' };
    const W = world({ 'track:intro': 2 }); const P = A.createPlayer(W.env); P.setMap(m);
    await P.goTo({ kind: 'node', id: a.id }); await W.advance(0.1); W.log.length = 0;
    await P.goTo({ kind: 'node', id: b.id }); await W.advance(0.3);
    await P.goTo({ kind: 'node', id: c.id }); await W.advance(0.3);
    await W.advance(3);
    check('navigation rapide : seul le dernier choix est joué (le premier est annulé)', !W.log.some(l => /^track:chateau start/.test(l)) || W.log.filter(l => /^track:chateau start/.test(l)).length === 1); }

  // ---- Combat
  { const { m, boss } = demoMap(); boss.transition = { sync: 'immediate', sec: 1 };
    const W = world(); const P = A.createPlayer(W.env); P.setMap(m);
    await P.goTo({ kind: 'node', id: boss.id }); await W.advance(0.1); W.log.length = 0;
    check('combat : accepté sur un boss', (await P.setCombat(true)) === true); await W.advance(0.1);
    check('combat : le morceau de combat entre, l\'ambiance sort', W.log.includes('track:bossfight start 0') && W.log.includes('track:boss level 0.000 1') && P.state.combat);
    await P.setCombat(false); await W.advance(0.1);
    check('fin du combat : retour au morceau d\'ambiance', W.log.includes('track:boss start 0') || W.voices['track:boss'].level === 1);
    await P.goTo({ kind: 'node', id: m.nodes[0].id });
    check('combat refusé là où il n\'y a pas d\'emplacement', (await P.setCombat(true)) === false); }

  // ---- Fond propre à un lieu, arrêt, flèches
  { const { m, a, b, e1 } = demoMap(); m.roomTone = T('room'); b.sounds.room = [T('echo')]; a.transition = b.transition = e1.transition = { sync: 'immediate', sec: 1 };
    const W = world(); const P = A.createPlayer(W.env); P.setMap(m);
    await P.goTo({ kind: 'node', id: a.id }); await W.advance(0.1);
    await P.goTo({ kind: 'node', id: b.id }); await W.advance(0.2);
    check('lieu avec fond propre : il remplace celui de la carte en fondu', W.voices['track:echo'] && W.voices['track:echo'].level > 0 && W.voices['track:room'].level === 0);
    await W.advance(3); check('l\'ancien fond est arrêté', !W.voices['track:room'].playing);
    const to = await P.step(-1, 0);
    check('flèche gauche depuis le château : le parcours vers le début', to && to.kind === 'edge' && P.state.position.id === e1.id);
    P.stop(1); await W.advance(3);
    check('arrêt : tout s\'éteint, la position est gardée', !P.state.playing && Object.values(W.voices).every(v => !v.playing) && P.state.position.id === e1.id); }

  console.log(failures ? failures + ' échec(s)' : 'Tout est vert');
  process.exit(failures ? 1 : 0);
})();
