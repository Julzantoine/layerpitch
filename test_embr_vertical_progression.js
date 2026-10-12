// Progression de la forme d'onde du mode embranchement-vertical (11/10) avec une intro, une boucle et une queue : la progression suit la
// position réelle dans le fichier, le 1er passage va du Départ jusqu'à la Sortie, puis la boucle repart de l'Entrée (pas du tout début).
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
        return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} };
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
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: 3.2 }); };
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
  async function waitUntil(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { if (predicate()) return true; await sleep(20); }
    return predicate();
  }

  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  function pointer(el, type, clientX) { el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX })); }

  // Morceau avec une intro (Départ -> Entrée), une boucle (Entrée -> Sortie) et une queue : 0,2 s par temps.
  //   fichier 3,2 s ; Entrée au temps 8 (1,6 s) ; Sortie au temps 14 (2,8 s) -> cycle de 1,2 s ; Départ à 0.
  const bpm = 300, beatsPerBar = 1;
  const track = {
    id: 'eprog-1', title: 'Progression', mode: 'embranchement-vertical', description: '',
    duration: 3.2, base: '', publishedAt: 1, bpm, beatsPerBar, startTrackBeat: 0,
    loops: [
      { id: 'ref', label: 'Reference', bars: 4, isInitial: true, duration: 3.2, startTrackBeat: 0, loopInBeat: 8, loopOutBeat: 14, localFile: fakeFile('ref.wav') },
      { id: 'peerA', label: 'Peer A', bars: 4, duration: 3.2, localFile: fakeFile('peerA.wav') }
    ],
    sfxIds: []
  };
  const row = Core.buildTrackRow(track, null, false);
  doc.getElementById('host').appendChild(row);
  const btnRef = [...row.querySelectorAll('.embr-wave-btn')].find(b => b.dataset.loopId === 'ref');
  Core.initTrackPlayer(track, row);
  await sleep(300);
  const shown = () => { const m = /inset\(0(?:px)? ([\d.]+)%/.exec(btnRef.querySelector('.embr-wave-fg').style.clipPath || ''); return m ? (100 - parseFloat(m[1])) / 100 : null; };
  click(row.querySelector('[data-role="playBtn"]'));
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 5200) { await sleep(60); samples.push({ t: (Date.now() - t0) / 1000, f: shown() }); }
  const loopInFrac = 1.6 / 3.2, loopOutFrac = 2.8 / 3.2;
  // 1er passage : Départ (0) -> Sortie (2,8 s), d'un seul tenant : l'intro puis la boucle, sans retour avant l'Entrée
  const first = samples.filter(s => s.t > 0.2 && s.t < 2.5 && s.f !== null);
  check('1er passage : la progression monte régulièrement dans le fichier, intro comprise, sans retour en arrière', first.length > 15 && first.every((s, i) => i === 0 || s.f >= first[i - 1].f - 0.005));
  const mid = samples.find(s => s.t > 0.95 && s.t < 1.05);
  check('au milieu de l\'intro, la position est celle du FICHIER (~31 %), pas celle du cycle (~83 %)', !!mid && mid.f > 0.2 && mid.f < 0.45);
  const pastCycle = samples.filter(s => s.t > 1.4 && s.t < 2.5);
  check('au-delà d\'un cycle (1,2 s) le 1er passage continue (la boucle ne repart pas trop tôt, par-dessus la fin de l\'intro)', pastCycle.length > 8 && pastCycle.every(s => s.f > 0.4));
  const afterLoop = samples.filter(s => s.t > 3.1 && s.f !== null);
  check('après la Sortie, la progression repart de l\'Entrée (50 %), jamais du tout début', afterLoop.length > 20 && afterLoop.every(s => s.f >= loopInFrac - 0.02));
  check('…et elle reste dans la boucle (jamais au-delà de la Sortie, 87,5 %)', afterLoop.every(s => s.f <= loopOutFrac + 0.03));

  // Audio : la 2e génération démarre à la SORTIE du 1er passage (2,8 s après le début), à l'Entrée du fichier (1,6 s) ; puis un cycle (1,2 s)
  const st = (window.__starts || []).filter((s, i, a) => i % 2 === 0); // 2 boucles paires par génération : on garde la 1re de chaque
  check('audio : la 1re génération démarre au Départ (offset 0)', st.length >= 3 && Math.abs(st[0].offset - 0) < 1e-9);
  check('audio : la 2e génération démarre à l\'Entrée (offset 1,6 s), 2,8 s après la 1re (Sortie du 1er passage), pas 1,2 s', Math.abs(st[1].offset - 1.6) < 1e-9 && Math.abs((st[1].when - st[0].when) - 2.8) < 0.05);
  check('audio : les suivantes reviennent à l\'Entrée toutes les 1,2 s (un cycle)', Math.abs(st[2].offset - 1.6) < 1e-9 && Math.abs((st[2].when - st[1].when) - 1.2) < 0.05);

  console.log(failures === 0 ? 'ALL CHECKS PASSED' : (failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
