// Teste le bouton Stop du lecteur (25/09) : visible seulement quand il y a quelque chose à arrêter, et
// contrairement à Pause, la lecture suivante repart du début (pas de reprise de position).
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

(async () => {
  const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
  const playerSrc = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body><div id="host"></div>
  <script>${i18nSrc}</script>
  <script>${playerSrc}</script>
  </body></html>`;

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
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: 10 }); };
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
  const track = {
    id: 'stop-1', title: 'Stop button', mode: 'embranchement-vertical', description: '',
    duration: 0, base: '', publishedAt: 1, bpm: 300, beatsPerBar: 1,
    loops: [
      { id: 'ref', label: 'Reference', bars: 4, isInitial: true, localFile: fakeFile('ref.wav') },
      { id: 'peerA', label: 'Peer A', bars: 4, localFile: fakeFile('peerA.wav') }
    ],
    sfxIds: []
  };
  const row = Core.buildTrackRow(track, null, false);
  doc.getElementById('host').appendChild(row);
  Core.initTrackPlayer(track, row);
  await sleep(300);
  const playBtn = row.querySelector('[data-role="playBtn"]');
  const stopBtn = row.querySelector('[data-role="stopBtn"]');
  const btnRef = row.querySelector('.embr-loop-btn[data-loop-id="ref"]');
  const btnPeer = row.querySelector('.embr-loop-btn[data-loop-id="peerA"]');
  check('Stop masqué avant toute lecture', stopBtn && stopBtn.style.display === 'none');
  click(playBtn); await sleep(50);
  check('Stop visible pendant la lecture', stopBtn.style.display === '');
  click(btnPeer); await sleep(50);
  check('bascule vers Peer A', btnPeer.classList.contains('active'));
  click(playBtn); await sleep(50); // Pause
  check('Stop reste visible en pause', stopBtn.style.display === '');
  click(stopBtn); await sleep(50);
  check('après Stop, bouton masqué', stopBtn.style.display === 'none');
  click(playBtn); await sleep(50);
  check('après Stop, la lecture repart de la boucle de référence (pas de reprise)', btnRef.classList.contains('active') && !btnPeer.classList.contains('active'));
  click(stopBtn); await sleep(50);

  // Morceau vertical en boucle quantifiée avec un point de départ (startTrackBeat) : Stop doit ramener la lecture à ce
  // point, pas au tout début du fichier -- et le bouton Stop disparaît (rien à arrêter).
  const qTrack = {
    id: 'stop-q', title: 'Stop quantifié', mode: 'vertical', description: '', duration: 10, base: '', publishedAt: 1,
    loopable: true, loopEngine: 'quantized', bpm: 120, beatsPerBar: 4, startTrackBeat: 2, loopInBeat: 4, loopOutBeat: 12,
    layers: [{ label: 'L1', localFile: fakeFile('q1.wav') }], sfxIds: []
  };
  const qRow = Core.buildTrackRow(qTrack, null, false);
  doc.getElementById('host').appendChild(qRow);
  Core.initTrackPlayer(qTrack, qRow);
  await sleep(300);
  const qPlay = qRow.querySelector('[data-role="playBtn"]'), qStop = qRow.querySelector('[data-role="stopBtn"]');
  window.__starts = [];
  click(qPlay); await sleep(50);
  check('quantifié : la première lecture part du point de départ (1 s)', window.__starts.length && Math.abs(window.__starts[0].offset - 1) < 1e-9);
  click(qPlay); await sleep(50); // Pause
  click(qStop); await sleep(50);
  check('quantifié : après Stop, bouton masqué', qStop.style.display === 'none');
  window.__starts = [];
  click(qPlay); await sleep(50);
  check('quantifié : après Stop, la lecture repart du point de départ (pas du début du fichier)', window.__starts.length && Math.abs(window.__starts[0].offset - 1) < 1e-9);
  click(qStop); await sleep(50);

  console.log(failures === 0 ? 'ALL CHECKS PASSED' : (failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
