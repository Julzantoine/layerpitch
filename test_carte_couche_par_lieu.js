// Carte de niveau : une couche réglée par lieu sur un même morceau à couches. Le morceau continue (il ne repart pas), la couche change au fil
// des lieux (Poste = 1, Photocopieuse = 2, Bureau = 3) ; un lieu sans réglage garde la couche courante ; le réglage survit à la normalisation.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const dom = new JSDOM('<div id="host"></div>', { url: 'https://beta.layerpitch.com/projet.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(__dirname, 'projet-carte.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, 'projet-carte-audio.js'), 'utf8'));
  const clock = { t: 10, timers: [] }, log = [], voices = {};
  const env = { now: () => clock.t, schedule: (fn, at) => { const t = { fn, at, live: true }; clock.timers.push(t); return () => { t.live = false; }; },
    voiceFactory: async ref => { if (!voices[ref.id]) { const v = { playing: false, start() { log.push('start'); this.playing = true; }, setLevel() {}, stop() { this.playing = false; }, isPlaying() { return this.playing; }, nextBoundary: () => null, layerCount: () => 3, setIntensity(i) { v.level = i; } }; voices[ref.id] = v; } return voices[ref.id]; } };
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 3)); };
  const adv = async () => { for (let i = 0; i < 4; i++) { const due = clock.timers.filter(x => x.live).sort((a, b) => a.at - b.at)[0]; if (!due) break; due.live = false; clock.t = Math.max(clock.t, due.at); due.fn(); } await settle(); };
  const M = w.LayerPitchLevelMap.model;
  const song = [{ kind: 'track', id: 'office', title: 'Welcome to the office' }];
  const map = M.normalize({ nodes: [
    { id: 'poste', type: 'start', label: 'Poste de travail', x: 0, y: 0, layer: 1, sounds: { main: song, combat: [] } },
    { id: 'photo', type: 'place', label: 'Photocopieuse', x: 200, y: 0, layer: 2, sounds: { main: song, combat: [] } },
    { id: 'bureau', type: 'place', label: 'Bureau', x: 400, y: 0, layer: 3, sounds: { main: song, combat: [] } },
    { id: 'libre', type: 'place', label: 'Couloir', x: 600, y: 0, sounds: { main: song, combat: [] } },
    { id: 'zero', type: 'place', label: 'Hors normes', x: 800, y: 0, layer: 99, sounds: { main: song, combat: [] } }],
    edges: [] });
  const node = id => map.nodes.find(n => n.id === id);
  check('le réglage de couche survit à la normalisation', node('photo').layer === 2 && node('bureau').layer === 3);
  check('sans réglage : absent ; hors limites : ignoré', node('libre').layer === undefined && node('zero').layer === undefined);
  const P = w.LayerPitchLevelMapAudio.createPlayer(env); P.setMap(map);
  await P.goTo({ kind: 'node', id: 'poste' }); await settle(); await adv();
  check('Poste de travail : couche 1', voices.office.level === 0);
  await P.goTo({ kind: 'node', id: 'photo' }); await settle(); await adv();
  check('Photocopieuse : couche 2', voices.office.level === 1);
  await P.goTo({ kind: 'node', id: 'bureau' }); await settle(); await adv();
  check('Bureau : couche 3', voices.office.level === 2);
  await P.goTo({ kind: 'node', id: 'libre' }); await settle(); await adv();
  check('lieu sans réglage : on garde la couche 3', voices.office.level === 2);
  check('le morceau n\'a jamais été relancé', log.filter(l => l === 'start').length === 1);
  console.log(failures ? failures + ' échec(s)' : 'Tout est vert'); process.exit(failures ? 1 : 0);
})();
