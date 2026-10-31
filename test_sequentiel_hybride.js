// Séquentiel hybride (31/10) : le passage d'une section à l'autre tombe pile sur la fin de boucle, sans couper la queue.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf-8');

(async () => {
  const fakeFiles = []; // le contenu d'un faux fichier est son numéro : le lecteur recopie les octets avant de décoder
  const starts = []; // { file, when, offset, node }
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="host"></div><script>${read('layerpitch-i18n.js')}</script><script>${read('player.js').replace(/<\/script/gi, '<\\/script')}</script></body></html>`, {
    url: 'http://localhost/test.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      const epoch = Date.now();
      function Ctx() { this.destination = {}; this.state = 'running'; }
      Object.defineProperty(Ctx.prototype, 'currentTime', { get() { return (Date.now() - epoch) / 1000; } });
      Ctx.prototype.resume = () => Promise.resolve();
      Ctx.prototype.createGain = () => ({ gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} });
      Ctx.prototype.createBufferSource = function () {
        const c = this;
        const n = { buffer: null, onended: null, loop: false, stoppedAt: null, playbackRate: { value: 1 }, connect() {},
          fire() { if (!n.ended) { n.ended = true; if (n.onended) n.onended(); } },
          arm(at) { clearTimeout(n.timer); n.timer = setTimeout(n.fire, Math.max(0, at - c.currentTime) * 1000); },
          stop(at) { n.stoppedAt = at == null ? c.currentTime : at; n.arm(n.stoppedAt); },
          start(when, offset) { starts.push({ file: n.buffer && n.buffer.file, when, offset, node: n }); if (!n.loop) n.arm(when + n.buffer.duration - (offset || 0)); } };
        return n;
      };
      Ctx.prototype.decodeAudioData = ab => Promise.resolve({ duration: fakeFiles[new Uint8Array(ab)[0]].duration, file: fakeFiles[new Uint8Array(ab)[0]].name, numberOfChannels: 1, length: 100, sampleRate: 44100, getChannelData: () => new Float32Array(100) });
      win.AudioContext = Ctx;
      win.ResizeObserver = win.ResizeObserver || function () { return { observe() {}, disconnect() {} }; };
    },
  });
  const { window } = dom;
  await new Promise(r => setTimeout(r, 50));
  const Core = window.LayerPlayerCore;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitUntil = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(20); } return fn(); };
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const file = (name, duration) => { fakeFiles.push({ name, duration }); const n = fakeFiles.length - 1; return { name, arrayBuffer: () => Promise.resolve(new Uint8Array([n]).buffer) }; };
  const base = { description: '', base: 'https://example.invalid/', publishedAt: Date.now(), sfxIds: [] };
  // Layering additif quantifié : boucle de 0,4 s, fichier de 0,7 s (0,3 s de queue).
  const vertical = (id, name) => ({ ...base, id, title: id, mode: 'vertical', loopEngine: 'quantized', bpm: 150, beatsPerBar: 1, loopGridUnit: 'beats', loopInBeat: 0, loopOutBeat: 1, startTrackBeat: 0, duration: 0.7, layers: [{ label: 'a', localFile: file(name + '1.wav', 0.7) }, { label: 'b', localFile: file(name + '2.wav', 0.7) }] });
  const stat = (id, name, loopable, duration) => ({ ...base, id, title: id, mode: 'static', loopable, loopEngine: 'simple', duration, layers: [{ label: 'a', localFile: file(name + '.wav', duration) }] });
  const mount = sections => {
    const track = { ...base, id: 'h' + Math.random(), title: 'Hybride', mode: 'hybrid-sequential', duration: 0, layers: [], sections };
    const row = Core.buildTrackRow(track, null, false);
    window.document.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    return row;
  };
  const rolePlay = row => row.querySelector('[data-role="playBtn"]');
  const rows = row => [...row.querySelectorAll('.hybrid-child')];
  const shown = row => rows(row).findIndex(r => !r.classList.contains('hybrid-child-offstage'));
  const firstStart = name => starts.find(s => s.file === name);
  const nearly = (a, b) => Math.abs(a - b) < 1e-6;

  // ---- Enchaînement automatique : additif (2 boucles) -> statique en boucle (2 fois) -> statique sans boucle ----
  const row = mount([
    { id: 's1', label: 'Exploration', maxLoops: 2, track: vertical('v', 'v') },
    { id: 's2', label: 'Tension', maxLoops: 2, track: stat('l', 'loop', true, 0.5) },
    { id: 's3', label: 'Fin', maxLoops: null, track: stat('e', 'end', false, 0.4) },
    { id: 's4', label: 'Sans fichier', maxLoops: null, track: { ...base, id: 'x', mode: 'static', layers: [{}] } },
    { id: 's5', label: 'Morceau supprimé', maxLoops: null, track: null },
  ]);
  check('sections sans fichier ou supprimées ignorées', row.querySelectorAll('[data-role="hybridBlocks"] .seq-block').length === 3);
  check('un lecteur par section', rows(row).length === 3);
  check('bouton Lecture actif une fois tout chargé', await waitUntil(() => !rolePlay(row).disabled, 2000));
  click(rolePlay(row));
  check('la première section démarre', await waitUntil(() => firstStart('v1.wav'), 500));
  check('elle est affichée', shown(row) === 0);
  check('deuxième section programmée', await waitUntil(() => firstStart('loop.wav'), 3000));
  const gens = starts.filter(s => s.file === 'v1.wav');
  check('additif : deux passages, pas un de plus', gens.length === 2);
  check('passage pile à la fin de la boucle', nearly(firstStart('loop.wav').when, gens[0].when + 0.8));
  check('les deux couches du dernier passage ne sont pas coupées (queue)', starts.filter(s => s.file.startsWith('v')).every(s => s.node.stoppedAt == null));
  check('affichage changé au moment du passage', await waitUntil(() => shown(row) === 1, 2000));
  check('dernière section programmée', await waitUntil(() => firstStart('end.wav'), 3000));
  check('statique en boucle : deux tours exacts', nearly(firstStart('end.wav').when, firstStart('loop.wav').when + 1));
  check('le statique en boucle s\'arrête pile', nearly(firstStart('loop.wav').node.stoppedAt, firstStart('end.wav').when));
  check('fin naturelle de la chaîne', await waitUntil(() => rolePlay(row).querySelector('svg').innerHTML.includes('M8 5v14l11-7z'), 3000));
  check('plus aucune section active', !row.querySelector('.seq-block.active'));

  // ---- Bouton « Section suivante » sur une section sans limite ; arrêt et relance ----
  starts.length = 0;
  const row2 = mount([
    { id: 'a', label: 'A', maxLoops: 0, track: vertical('va', 'a') },
    { id: 'b', label: 'B', maxLoops: 0, track: stat('lb', 'b', true, 0.5) },
  ]);
  await waitUntil(() => !rolePlay(row2).disabled, 2000);
  const next = row2.querySelector('[data-role="hybridNext"]');
  click(rolePlay(row2));
  await sleep(900);
  check('sans limite : la section continue de boucler', starts.filter(s => s.file === 'a1.wav').length >= 3);
  click(next);
  check('demande visible sur le bouton', next.disabled);
  check('la section suivante est programmée', await waitUntil(() => firstStart('b.wav'), 2500));
  const aGens = starts.filter(s => s.file === 'a1.wav');
  check('passage sur la frontière de boucle', nearly(firstStart('b.wav').when, aGens[aGens.length - 1].when + 0.4));
  check('section B affichée', await waitUntil(() => shown(row2) === 1, 2000));
  check('dernière section : le bouton mène à la fin', /fin|end/i.test(next.textContent));
  click(next);
  const stopAt = firstStart('b.wav').node.stoppedAt;
  check('la fin est demandée pour le prochain tour', stopAt != null && stopAt > firstStart('b.wav').when);
  check('et le morceau s\'arrête', await waitUntil(() => rolePlay(row2).querySelector('svg').innerHTML.includes('M8 5v14l11-7z'), 2000));

  // ---- Pause et reprise, puis Stop ----
  starts.length = 0;
  const row3 = mount([
    { id: 'c', label: 'C', maxLoops: 2, track: vertical('vc', 'c') },
    { id: 'd', label: 'D', maxLoops: 1, track: stat('ld', 'd', true, 0.5) },
  ]);
  await waitUntil(() => !rolePlay(row3).disabled, 2000);
  click(rolePlay(row3));
  await sleep(150);
  click(rolePlay(row3));
  check('pause : icône Lecture', rolePlay(row3).querySelector('svg').innerHTML.includes('M8 5v14l11-7z'));
  const during = starts.length;
  await sleep(1200);
  check('pause : rien de nouveau ne démarre', starts.length === during);
  click(rolePlay(row3));
  check('reprise : la section suivante arrive quand même', await waitUntil(() => firstStart('d.wav'), 3000));
  const stopBtn = row3.querySelector('[data-role="stopBtn"]');
  await waitUntil(() => shown(row3) === 1, 2000);
  click(stopBtn);
  check('stop : tout est coupé', firstStart('d.wav').node.stoppedAt != null && !row3.querySelector('.seq-block.active'));
  check('stop : le bouton Stop disparaît', stopBtn.style.display === 'none');

  // ---- Sortie avant la fin : prochain temps, mesure, point de transition ; repli sur la fin de boucle ----
  const longVert = (id, name, loopBeats) => ({ ...vertical(id, name), loopOutBeat: loopBeats, duration: loopBeats * 0.4 + 0.3, layers: [{ label: 'a', localFile: file(name + '1.wav', loopBeats * 0.4 + 0.3) }, { label: 'b', localFile: file(name + '2.wav', loopBeats * 0.4 + 0.3) }] });
  const exitCase = async (label, name, sectionOpts, beats) => {
    starts.length = 0;
    const r = mount([
      { id: 'x', label: 'X', maxLoops: 0, ...sectionOpts, track: { ...longVert('v' + name, name, beats), beatsPerBar: 4 } },
      { id: 'y', label: 'Y', maxLoops: 0, track: stat('n' + name, name + 'next', true, 0.5) },
    ]);
    await waitUntil(() => !rolePlay(r).disabled, 2000);
    click(rolePlay(r));
    await waitUntil(() => firstStart(name + '1.wav'), 500);
    await sleep(50);
    click(r.querySelector('[data-role="hybridNext"]'));
    await waitUntil(() => firstStart(name + 'next.wav'), 4000);
    const offsetFromGen = firstStart(name + 'next.wav').when - starts.filter(s => s.file === name + '1.wav' && s.when <= firstStart(name + 'next.wav').when).pop().when;
    const out = { r, offset: offsetFromGen, stop: firstStart(name + '1.wav').node.stoppedAt, next: firstStart(name + 'next.wav').when };
    await sleep(100);
    return out;
  };
  const beatExit = await exitCase('temps', 't', { switchMode: 'beat', fadeSec: 0.2 }, 8);
  check('prochain temps : tombe sur la grille des temps', Math.abs(beatExit.offset - 0.4) < 1e-6);
  check('la section quittée s\'arrête à la fin du fondu', nearly(beatExit.stop, beatExit.next + 0.2));
  const barExit = await exitCase('mesure', 'm', { switchMode: 'bar', fadeSec: 0 }, 8);
  check('prochaine mesure : 4 temps', Math.abs(barExit.offset - 1.6) < 1e-6);
  const pointExit = await exitCase('point', 'p', { switchMode: 'point', transitionPoints: [6, 2], fadeSec: 0 }, 8);
  check('point de transition : le prochain dans l\'ordre du morceau', Math.abs(pointExit.offset - 0.8) < 1e-6);
  const noPoint = await exitCase('sans point', 'q', { switchMode: 'point', transitionPoints: [], fadeSec: 0 }, 4);
  check('aucun point : fin de boucle, queue intacte', Math.abs(noPoint.offset - 1.6) < 1e-6 && noPoint.stop == null);
  // Statique en boucle, sortie au prochain temps : même logique sur le moteur simple.
  starts.length = 0;
  const rs = mount([
    { id: 'a', label: 'A', maxLoops: 0, switchMode: 'beat', fadeSec: 0, track: { ...stat('sb', 'sb', true, 4), bpm: 150, beatsPerBar: 4 } },
    { id: 'b', label: 'B', maxLoops: 0, track: stat('sc', 'sc', true, 0.5) },
  ]);
  await waitUntil(() => !rolePlay(rs).disabled, 2000);
  click(rolePlay(rs));
  await waitUntil(() => firstStart('sb.wav'), 500);
  await sleep(100);
  click(rs.querySelector('[data-role="hybridNext"]'));
  await waitUntil(() => firstStart('sc.wav'), 2000);
  check('statique : passage au prochain temps', Math.abs(firstStart('sc.wav').when - firstStart('sb.wav').when - 0.4) < 1e-6);
  // Dernière section coupée au temps : le morceau se termine.
  starts.length = 0;
  const rl = mount([{ id: 'a', label: 'A', maxLoops: 0, switchMode: 'beat', fadeSec: 0.1, track: longVert('ve', 'e', 8) }]);
  await waitUntil(() => !rolePlay(rl).disabled, 2000);
  click(rolePlay(rl));
  await sleep(100);
  click(rl.querySelector('[data-role="hybridNext"]'));
  check('dernière section coupée : fin du morceau', await waitUntil(() => rolePlay(rl).querySelector('svg').innerHTML.includes('M8 5v14l11-7z'), 2000));

  // ---- Fichier de transition : joué au passage, la suite démarre à sa fin ou après N mesures ----
  starts.length = 0;
  const rt = mount([
    { id: 'a', label: 'A', maxLoops: 1, transition: { localFile: file('trans.wav', 0.6) }, track: vertical('va2', 'ta') },
    { id: 'b', label: 'B', maxLoops: 1, transition: { localFile: file('trans2.wav', 2), bars: 1 }, track: { ...stat('lt', 'tb', true, 0.5), bpm: 120, beatsPerBar: 4 } },
    { id: 'c', label: 'C', maxLoops: null, transition: { localFile: file('jamais.wav', 1) }, track: { ...stat('et', 'tc', false, 0.3), bpm: 240, beatsPerBar: 2 } },
  ]);
  check('chargement avec transitions', await waitUntil(() => !rolePlay(rt).disabled, 2000));
  click(rolePlay(rt));
  check('transition programmée', await waitUntil(() => firstStart('trans.wav'), 3000));
  check('section suivante après le fichier entier', await waitUntil(() => firstStart('tb.wav'), 3000) && nearly(firstStart('tb.wav').when, firstStart('trans.wav').when + 0.6));
  check('transition jouée à la fin de boucle', nearly(firstStart('trans.wav').when, firstStart('ta1.wav').when + 0.4));
  check('durée en mesures : tempo de la section suivante', await waitUntil(() => firstStart('tc.wav'), 4000) && nearly(firstStart('tc.wav').when, firstStart('trans2.wav').when + 0.5));
  check('pas de transition après la dernière section', await waitUntil(() => rolePlay(rt).querySelector('svg').innerHTML.includes('M8 5v14l11-7z'), 3000) && !firstStart('jamais.wav'));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
