// Embranchement vertical piloté par un curseur (14/11, retour d'Hugo) : la frise des boucles reste affichée (lecture seule : un clic
// ne bascule plus de boucle, c'est le curseur qui décide) et sert toujours à placer la tête de lecture, sur n'importe quelle ligne.
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
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: 0.8 }); };
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

  const bpm = 300, beatsPerBar = 1; // cycle = 4 mesures x 0.2s = 0.8s
  const track = {
    id: 'eseek-1', title: 'Seek on waveform', mode: 'embranchement-vertical', description: '',
    duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
    loops: [
      { id: 'ref', label: 'Reference', bars: 4, isInitial: true, localFile: fakeFile('ref.wav') },
      { id: 'peerA', label: 'Peer A', bars: 4, localFile: fakeFile('peerA.wav') }
    ],
    sfxIds: [],
    fxSliders: [{ id: 's1', label: 'Panic', defaultValue: 0, visible: true, bindings: [], thresholds: [], intensity: { bounds: [0.5] } }]
  };
  const row = Core.buildTrackRow(track, null, false);
  doc.getElementById('host').appendChild(row);
  const btns = [...row.querySelectorAll('.embr-wave-btn')];
  btns.forEach(b => { b.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 34, right: 200, bottom: 34 }); });
  const btnRef = btns.find(b => b.dataset.loopId === 'ref');
  const btnPeer = btns.find(b => b.dataset.loopId === 'peerA');
  Core.initTrackPlayer(track, row);
  await sleep(300);
  click(row.querySelector('[data-role="playBtn"]'));
  await sleep(100);

  const picker = row.querySelector('[data-role="embrLoopPicker"]');
  check('la frise des boucles reste affichée malgré le curseur', !!picker && picker.closest('.track-intensity-block').style.display !== 'none' && btns.length === 2);
  check('elle est marquée « piloté par curseur » (lecture seule)', picker.classList.contains('is-slider-driven'));

  // Clic sur une ligne NON active : ne bascule plus, mais place la tête de lecture.
  let before = window.__starts.length;
  pointer(btnPeer, 'pointerdown', 100); pointer(btnPeer, 'pointerup', 100); click(btnPeer);
  const fresh = window.__starts.slice(before);
  check('un clic sur une autre ligne ne change pas la boucle active', btnRef.classList.contains('active') && !btnPeer.classList.contains('active'));
  check('mais il place la tête de lecture (au milieu du cycle)', fresh.length >= 1 && fresh.every(s => Math.abs(s.offset - 0.4) < 1e-9));

  // Clic sur la ligne active : place la tête, comme avant.
  before = window.__starts.length;
  pointer(btnRef, 'pointerdown', 50); pointer(btnRef, 'pointerup', 50);
  check('un clic sur la ligne active place la tête de lecture (quart du cycle)', window.__starts.slice(before).some(s => Math.abs(s.offset - 0.2) < 1e-9));

  click(row.querySelector('[data-role="playBtn"]')); // Stop
  await sleep(50);
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : (failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
