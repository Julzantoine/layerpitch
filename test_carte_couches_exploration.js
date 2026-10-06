// Carte de niveau (7/10) : morceau à couches posé en « combat » sur un parcours sans musique d'exploration. Exploration : le lecteur joue
// la couche 1 de ce morceau (un compositeur peut s'en servir comme musique d'exploration) ; combat : toutes les couches ; la couche se
// règle aussi à la main (boutons 1..n, touches 1-9, Auto). Un morceau de combat SANS couches ne devient pas musique d'exploration.
// Lecteur de la carte avec des voix fictives (l'horloge est simulée).
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const dom = new JSDOM('<div id="host"></div>', { url: 'https://beta.layerpitch.com/projet.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(__dirname, 'projet-carte.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, 'projet-carte-audio.js'), 'utf8'));
  const clock = { t: 10, timers: [] };
  const log = [], voices = {};
  const mk = (key, layers) => { const v = { key, playing: false, level: null, start(l) { log.push(key + ' start'); this.playing = true; }, setLevel() {}, stop() { this.playing = false; }, isPlaying() { return this.playing }, nextBoundary: () => null };
    if (layers) { v.layerCount = () => layers; v.setIntensity = i => { v.level = i; log.push(key + ' couche ' + (i + 1)); }; } return v; };
  const env = { now: () => clock.t, schedule: (fn, at) => { const t = { fn, at, live: true }; clock.timers.push(t); return () => { t.live = false; }; },
    voiceFactory: async ref => voices[ref.id] || (voices[ref.id] = mk(ref.id, ref.id === 'layered' ? 3 : 0)) };
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 3)); };
  const M = w.LayerPitchLevelMap.model;
  const map = M.normalize({ nodes: [{ id: 'a', type: 'start', label: 'Début', x: 0, y: 0 }, { id: 'b', type: 'place', label: 'Château', x: 400, y: 0 }],
    edges: [{ id: 'forest', from: 'a', to: 'b', enemy: true, label: 'Forêt', sounds: { main: [], combat: [{ kind: 'track', id: 'layered', title: 'Goûte donc ma hache' }] } },
            { id: 'plain', from: 'a', to: 'b', enemy: true, label: 'Plaine', sounds: { main: [], combat: [{ kind: 'track', id: 'flat', title: 'Combat simple' }] } },
            { id: 'calm', from: 'a', to: 'b', enemy: false, label: 'Chemin', sounds: { main: [{ kind: 'track', id: 'explo', title: 'Exploration' }], combat: [] } }] });
  const P = w.LayerPitchLevelMapAudio.createPlayer(env); P.setMap(map);
  const adv = async () => { for (let i = 0; i < 4; i++) { const due = clock.timers.filter(x => x.live).sort((a, b) => a.at - b.at)[0]; if (!due) break; due.live = false; clock.t = Math.max(clock.t, due.at); due.fn(); } await settle(); };

  await P.goTo({ kind: 'edge', id: 'forest' }); await settle(); await adv();
  check('exploration vide + morceau à couches en combat : on joue ce morceau', P.state.music && P.state.music.id === 'layered' && voices.layered.playing);
  check('…à la couche 1 (exploration)', voices.layered.level === 0 && P.state.layerLevel === 0 && P.state.layers === 3);
  check('…et l\'état signale le repli (exploration : couche 1 du morceau de combat)', P.state.fallback === true);
  await P.setCombat(true); await settle(); await adv();
  check('combat : toutes les couches (couche 3 sur 3), sans relancer le morceau', voices.layered.level === 2 && P.state.layerLevel === 2 && log.filter(l => l === 'layered start').length === 1);
  await P.setCombat(false); await settle(); await adv();
  check('retour à l\'exploration : la couche 1', voices.layered.level === 0 && P.state.layerLevel === 0);
  P.setIntensity(1);
  check('réglage à la main : couche 2, signalé comme manuel', voices.layered.level === 1 && P.state.layerLevel === 1 && P.state.layerManual === true);
  await P.setCombat(true); await settle(); await adv();
  check('changer d\'état (combat) remet la couche en automatique', P.state.layerManual === false && voices.layered.level === 2);
  P.setIntensity(9);
  check('une couche trop haute est ramenée à la dernière', voices.layered.level === 2);
  P.setIntensity(null);
  check('Auto : retour à l\'automatique', P.state.layerManual === false);

  await P.setCombat(false); await settle(); await adv();
  await P.goTo({ kind: 'edge', id: 'plain' }); await settle(); await adv();
  check('morceau de combat SANS couches : pas de musique d\'exploration (silence)', !P.state.music && !voices.flat.playing);
  await P.setCombat(true); await settle(); await adv();
  check('…mais en combat il joue normalement', P.state.music && P.state.music.id === 'flat' && voices.flat.playing);

  await P.goTo({ kind: 'edge', id: 'calm' }); await settle(); await adv();
  check('parcours avec une musique d\'exploration : c\'est elle qui joue, aucun repli', P.state.music && P.state.music.id === 'explo' && P.state.fallback === false);

  // Interface : boutons de couches dans la barre d'écoute
  const host = w.document.getElementById('host');
  const v = w.LayerPitchLevelMap.mount(host, { tr: (k, vv) => k + (vv ? JSON.stringify(vv) : ''), canEdit: false,
    audio: env, libraries: { track: [], sfx: [], asset: [] },
    maps: [{ id: 'm', title: 'T', data: { nodes: [{ id: 'a', type: 'start', label: 'Début', x: 0, y: 0 }, { id: 'b', type: 'place', label: 'Château', x: 400, y: 0 }],
      edges: [{ id: 'forest', from: 'a', to: 'b', enemy: true, label: 'Forêt', sounds: { main: [], combat: [{ kind: 'track', id: 'layered', title: 'Goûte' }] } }] } }],
    save: async () => ({}), remove: async () => ({}), ask: async () => 'x', confirm: async () => true });
  host.querySelector('#lmPlay').click(); await settle();
  host.querySelector('[data-edge="forest"]').dispatchEvent(new w.Event('pointerdown', { bubbles: true })); await settle(); await adv();
  check('barre d\'écoute : boutons Auto, 1, 2, 3 pour un morceau à couches', !!host.querySelector('#lmLayers') && host.querySelectorAll('#lmLayers [data-layer]').length === 4);
  voices.layered.level = null;
  host.querySelector('#lmLayers [data-layer="1"]').click(); await settle();
  check('clic sur « 2 » : on entend jusqu\'à la couche 2', voices.layered.level === 1);
  host.querySelector('#lmCanvas').dispatchEvent(Object.assign(new w.KeyboardEvent('keydown', { key: '3', bubbles: true })));
  host.dispatchEvent(new w.KeyboardEvent('keydown', { key: '3', bubbles: true })); await settle();
  check('touche 3 : couche 3', voices.layered.level === 2);
  host.querySelector('#lmLayers [data-layer="auto"]').click(); await settle();
  check('« Auto » : exploration = couche 1', voices.layered.level === 0);
  v.destroy();

  // Lecteur de morceau : l'API de couches existe
  const src = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf8');
  check('lecteur : lpControl expose layerCount, intensityLevel et setIntensity', /layerCount: \(\) =>/.test(src) && /setIntensity\(i\)/.test(src) && /intensityLevel: \(\) => level/.test(src));
  console.log(failures ? failures + ' échec(s)' : 'Tout est vert');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
