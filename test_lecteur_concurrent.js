// Lecteur « concurrent » (6/10, Carte de niveau) : plusieurs morceaux jouent en même temps (fond, morceau en cours, morceau qui entre),
// pilotés par wrapper.lpControl (démarrer à un niveau, rampes de niveau, arrêt, prochaine mesure). Un lecteur ordinaire garde son
// comportement : lancer un morceau arrête l'autre.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

(async () => {
  const { playerPageHtml, installTimedFakeAudio } = require('./scripts/test-harness.js');
  const html = playerPageHtml();

  const dom = new JSDOM(html, {
    url: 'http://localhost/test.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      const epoch = Date.now();
      function FakeAudioContext() { this.destination = {}; }
      Object.defineProperty(FakeAudioContext.prototype, 'currentTime', { get() { return (Date.now() - epoch) / 1000; } });
      FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
      FakeAudioContext.prototype.createGain = function () {
        const rec = { value: 1, setValueAtTime(v) { this.value = v; (win.__sets = win.__sets || []).push(v); }, linearRampToValueAtTime(v, t) { (win.__ramps = win.__ramps || []).push({ v, t }); }, cancelScheduledValues() {} };
        return { gain: rec, connect() {}, disconnect() {} };
      };
      FakeAudioContext.prototype.createBufferSource = function () {
        const ctxRef = this;
        const node = {
          buffer: null, onended: null, loop: false, loopStart: 0, loopEnd: 0, connect() {},
          stop() { if (node._endTimer) clearTimeout(node._endTimer); if (!node._ended) { node._ended = true; if (node.onended) node.onended(); } },
          start(when, offset) {
            (win.__starts = win.__starts || []).push({ when, offset });
            if (node.loop) return; // boucle "en attente d'un bouton" -- ne se termine jamais toute seule, comme un vrai src.loop=true
            const dur = (node.buffer && node.buffer.duration) || 1;
            const delaySec = Math.max(0, (when - ctxRef.currentTime) + dur);
            node._endTimer = setTimeout(() => { if (!node._ended) { node._ended = true; if (node.onended) node.onended(); } }, delaySec * 1000);
          }
        };
        return node;
      };
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: 0.4, length: 100, numberOfChannels: 1, sampleRate: 44100, getChannelData() { return new Float32Array(100); } }); };
      win.AudioContext = FakeAudioContext;
      win.ResizeObserver = win.ResizeObserver || function () { return { observe() {}, disconnect() {} }; };
      win.requestAnimationFrame = win.requestAnimationFrame || (cb => setTimeout(cb, 16));
      win.cancelAnimationFrame = win.cancelAnimationFrame || (id => clearTimeout(id));
    }
  });
  const { window } = dom;
  await new Promise(resolve => setTimeout(resolve, 50));
  const doc = window.document;
  const Core = window.LayerPlayerCore;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function fakeFile(name) { return { name, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }; }
  function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  const mk = (id, bpm) => ({ id, title: id, mode: 'vertical', description: '', duration: 10, base: '', publishedAt: 1, loopable: true, loopEngine: 'quantized',
    bpm, beatsPerBar: 4, startTrackBeat: 0, loopInBeat: 0, loopOutBeat: 16, layers: [{ label: 'L1', localFile: fakeFile(id + '.wav') }], sfxIds: [] });
  const A = mk('conc-a', 120), B = mk('conc-b', 120), C = mk('plain-c', 120);
  const mount = (t, opts) => { const row = Core.buildTrackRow(t, null, false); doc.getElementById('host').appendChild(row); Core.initTrackPlayer(t, row, null, opts); return row; };
  const rowA = mount(A, { concurrent: true }), rowB = mount(B, { concurrent: true }), rowC = mount(C);
  await sleep(300);
  check('lecteur concurrent : expose lpControl', !!rowA.lpControl && typeof rowA.lpControl.nextBoundary === 'function');
  check('tout lecteur expose lpControl (concurrent ou non)', !!rowC.lpControl && typeof rowC.lpControl.onEnded === 'function');
  check('avant lecture : pas de repère de mesure', rowA.lpControl.nextBoundary('bar') === null);

  window.__sets = []; window.__ramps = [];
  rowA.lpControl.start(0.5); await sleep(60);
  check('start(niveau) : joue, au niveau demandé', rowA.lpControl.isPlaying() && window.__sets.includes(0.5));
  rowB.lpControl.start(1); await sleep(60);
  check('un 2e lecteur concurrent joue SANS arrêter le premier', rowA.lpControl.isPlaying() && rowB.lpControl.isPlaying());

  const bar = rowA.lpControl.nextBoundary('bar'), beat = rowA.lpControl.nextBoundary('beat'), bars2 = rowA.lpControl.nextBoundary('bars2');
  const now = Core.audioNow();
  check('prochaine mesure : dans le futur, dans la durée d\'une mesure (2 s à 120 bpm)', bar > now && bar - now <= 2.001);
  check('prochain temps : dans la demi-seconde', beat > now && beat - now <= 0.501);
  check('2 mesures : la même mesure, ou la suivante (grille de 4 s)', Math.abs(bars2 - bar) < 0.01 || Math.abs(bars2 - bar - 2) < 0.01);

  window.__ramps = [];
  rowA.lpControl.setLevel(0, 2);
  check('setLevel : rampe vers le niveau demandé', window.__ramps.length === 1 && window.__ramps[0].v === 0);
  rowA.lpControl.stop(); await sleep(60);
  check('stop : le morceau s\'arrête, l\'autre continue', !rowA.lpControl.isPlaying() && rowB.lpControl.isPlaying());
  check('arrêté : plus de repère de mesure', rowA.lpControl.nextBoundary('bar') === null);

  // Un lecteur ordinaire garde la règle « un seul morceau à la fois »
  click(rowC.querySelector('[data-role="playBtn"]')); await sleep(80);
  check('lecteur ordinaire lancé : n\'arrête pas les concurrents (seul son propre événement stop-track le ferait)', rowB.lpControl.isPlaying());
  click(rowC.querySelector('[data-role="playBtn"]')); await sleep(30);
  rowB.lpControl.stop();

  // Fin naturelle : prévenue une seule fois ; un arrêt demandé ne la déclenche pas
  const D = { id: 'plain-d', title: 'Court', mode: 'static', description: '', duration: 0.4, base: '', publishedAt: 1, loopable: false, layers: [{ label: 'L1', localFile: fakeFile('d.wav') }], sfxIds: [] };
  const rowD = mount(D, {});
  await sleep(300);
  let ended = 0;
  rowD.lpControl.onEnded(() => { ended++; });
  rowD.lpControl.start(1); await sleep(60);
  check('morceau court lancé par programme : il joue', rowD.lpControl.isPlaying());
  await sleep(900);
  check('fin naturelle : prévenu une seule fois, plus en lecture', ended === 1 && !rowD.lpControl.isPlaying());
  rowD.lpControl.onEnded(() => { ended++; });
  rowD.lpControl.start(1); await sleep(60);
  rowD.lpControl.stop(); await sleep(900);
  check('arrêt demandé : pas une fin naturelle (aucun appel)', ended === 1);
  rowD.lpControl.onEnded(() => { ended++; });
  rowD.lpControl.start(1); await sleep(60);
  click(rowD.querySelector('[data-role="playBtn"]')); await sleep(900); // Pause par le bouton
  check('pause par le bouton : pas une fin naturelle non plus', ended === 1);

  // Séquences d'un morceau séquentiel (8/10) : libellés, séquence en cours, atteignables, passage par les embranchements du morceau
  const SQ = { id: 'seq-x', title: 'Séquentiel', mode: 'sequential', description: '', duration: 30, base: '', publishedAt: 1, bpm: 120, beatsPerBar: 4, sfxIds: [],
    segmentSlots: [
      { id: 'S1', label: 'Calme', alternatives: [{ localFile: fakeFile('s1.wav'), bars: 1 }], quantization: 'immediate', nextOptions: [{ targetId: 'S2' }] },
      { id: 'S2', label: 'Tension', alternatives: [{ localFile: fakeFile('s2.wav'), bars: 1 }], quantization: 'immediate', nextOptions: [{ targetId: 'S1' }] },
      { id: 'S3', alternatives: [{ localFile: fakeFile('s3.wav'), bars: 1 }] }
    ] };
  const rowS = mount(SQ, { concurrent: true });
  await sleep(300);
  const lc = rowS.lpControl;
  check('séquences : nombre et libellés du morceau (libellé de secours pour un emplacement sans nom)', lc.sequenceCount() === 3 && lc.sequenceLabels()[0] === 'Calme' && lc.sequenceLabels()[1] === 'Tension' && /3/.test(lc.sequenceLabels()[2]));
  check('séquences : un morceau vertical n\'en a pas', rowA.lpControl.sequenceCount() === 0 && rowA.lpControl.sequenceLabels() === null && !rowA.lpControl.goToSequence(0));
  check('séquences : à l\'arrêt, on ne peut pas y aller', !lc.goToSequence(1) && lc.sequenceCurrent() === -1);
  lc.start(1); await sleep(400);
  const cur = lc.sequenceCurrent();
  check('séquences : le morceau joue, une séquence est en cours', lc.isPlaying() && cur >= 0);
  if (cur === 0) {
    check('séquences : atteignables = celles prévues par le morceau (Calme → Tension)', lc.sequenceReachable().join() === '1');
    check('séquences : une séquence non prévue est refusée', !lc.goToSequence(2) && lc.sequencePending() === -1);
    check('séquences : aller à « Tension » est accepté et mis en attente ou fait', lc.goToSequence(1) === true);
    await sleep(500);
    check('séquences : le morceau est passé à « Tension »', lc.sequenceCurrent() === 1 || lc.sequencePending() === 1);
  } else {
    check('séquences : au démarrage le morceau est sur la première séquence', false);
  }
  lc.stop(); await sleep(60);

  console.log(failures === 0 ? 'ALL CHECKS PASSED' : (failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
