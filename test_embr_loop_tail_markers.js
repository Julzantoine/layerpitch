// Repères de boucle, queue et deuxième tête de lecture sur les lignes de l'embranchement vertical (voir aussi test_loop_tail_markers.js).
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

  // Même morceau que test_embr_vertical_progression.js : fichier 3,2 s, Entrée 1,6 s, Sortie 2,8 s (queue : 2,8 -> 3,2 s).
  const track = {
    id: 'etail-1', title: 'Queue embr', mode: 'embranchement-vertical', description: '',
    duration: 3.2, base: '', publishedAt: 1, bpm: 300, beatsPerBar: 1, startTrackBeat: 0,
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
  const q = (b, s) => b.querySelector(s);
  check('chaque ligne de boucle porte un calque de repères', [...row.querySelectorAll('.embr-wave-btn')].every(b => q(b, '[data-role="loopOverlay"]')));
  const out = q(btnRef, '[data-role="loopMarkOut"]'), inn = q(btnRef, '[data-role="loopMarkIn"]'), tail = q(btnRef, '[data-role="loopTail"]');
  check('repère d\'entrée à 50 % (1,6 s sur 3,2 s)', !inn.hidden && Math.abs(parseFloat(inn.style.left) - 50) < 0.5);
  check('repère de sortie à 87,5 % et queue qui en part', !out.hidden && Math.abs(parseFloat(out.style.left) - 87.5) < 0.5 && !tail.hidden && Math.abs(parseFloat(tail.style.left) - 87.5) < 0.5);
  const fgShown = () => { const m = /inset\(0(?:px)? ([\d.]+)%/.exec(btnRef.querySelector('.embr-wave-fg').style.clipPath || ''); return m ? (100 - parseFloat(m[1])) / 100 : null; };
  // Glisser dans la queue : la position affichée s'arrête au repère de sortie
  btnRef.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 34, right: 100, bottom: 34 });
  click(row.querySelector('[data-role="playBtn"]'));
  await sleep(150);
  pointer(btnRef, 'pointerdown', 97);
  check('glisser dans la queue : la tête affichée reste sur le repère de sortie (87,5 %)', Math.abs(fgShown() - 0.875) < 0.01);
  pointer(btnRef, 'pointercancel', 97);
  click(row.querySelector('[data-role="stopBtn"]')); await sleep(100);

  // Deuxième tête : le 1er passage dure 2,8 s ; la génération suivante démarre alors, la queue de la 1re joue encore 0,4 s.
  click(row.querySelector('[data-role="playBtn"]'));
  const heads = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 3600) {
    await sleep(40);
    const h = q(btnRef, '.progress-tail-head');
    heads.push({ t: (Date.now() - t0) / 1000, vis: !!h && !h.hidden, pct: h ? parseFloat(h.style.left) : NaN });
  }
  const seen = heads.filter(x => x.vis);
  check('la deuxième tête apparaît après la sortie du 1er passage (~2,8 s)', seen.length > 2 && seen[0].t > 2.6 && seen[0].t < 3.3);
  check('…part du repère de sortie et avance vers la fin du fichier', seen.every(x => x.pct >= 87 && x.pct <= 100.5) && seen[seen.length - 1].pct > seen[0].pct);
  check('…puis disparaît (la queue est finie) ; rien avant la 1re sortie', heads.filter(x => x.t < 2.5).every(x => !x.vis) && !heads[heads.length - 1].vis);
  click(row.querySelector('[data-role="playBtn"]')); await sleep(100);
  check('en pause : plus de deuxième tête', ![...row.querySelectorAll('.progress-tail-head')].some(h => !h.hidden));

  console.log(failures === 0 ? 'ALL CHECKS PASSED' : (failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
