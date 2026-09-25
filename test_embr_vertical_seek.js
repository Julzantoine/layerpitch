// Teste le seek par clic/glisser sur la forme d'onde de la boucle EN COURS en mode embranchement-vertical
// (25/09) : relance de toutes les boucles paires au point cliqué (verrouillage de phase conservé),
// animation recalée, et aucun seek depuis une ligne non active (qui reste une bascule de boucle).
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
  function pointer(el, type, clientX) { el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX })); }

  const bpm = 300, beatsPerBar = 1; // cycle = 4 mesures x 0.2s = 0.8s
  const track = {
    id: 'eseek-1', title: 'Seek on waveform', mode: 'embranchement-vertical', description: '',
    duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
    loops: [
      { id: 'ref', label: 'Reference', bars: 4, isInitial: true, localFile: fakeFile('ref.wav') },
      { id: 'peerA', label: 'Peer A', bars: 4, localFile: fakeFile('peerA.wav') }
    ],
    sfxIds: []
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

  // Clic sur une ligne NON active : pas de seek.
  let before = (window.__starts || []).length;
  pointer(btnPeer, 'pointerdown', 150); pointer(btnPeer, 'pointerup', 150);
  check('une ligne non active ne déclenche aucun seek', (window.__starts || []).length === before);

  // Glisser sur la ligne active : position affichée en direct, pas encore de seek audio.
  before = window.__starts.length;
  pointer(btnRef, 'pointerdown', 50);
  check('pendant le glisser, la forme d\'onde suit le pointeur (clip-path posé, animation coupée)',
    btnRef.querySelector('.embr-wave-fg').style.clipPath === 'inset(0 75% 0 0)' && btnRef.querySelector('.embr-wave-fg').style.animation.startsWith('none'));
  check('pas de seek audio avant le relâchement', window.__starts.length === before);
  pointer(btnRef, 'pointermove', 100);
  pointer(btnRef, 'pointerup', 100);
  const fresh = window.__starts.slice(before);
  check('au relâchement, les 2 boucles paires sont relancées', fresh.length === 2);
  check('au milieu du cycle (offset 0.4s sur 0.8s)', fresh.every(s => Math.abs(s.offset - 0.4) < 1e-9));
  const fg = btnRef.querySelector('.embr-wave-fg');
  check('animation recalée sur la position cliquée (délai -0.4s, en cours)', fg.style.animationDelay === '-0.4s' && fg.style.animationPlayState === 'running' && fg.style.clipPath === '');
  check('la boucle active reste la même', btnRef.classList.contains('active') && !btnPeer.classList.contains('active'));

  click(row.querySelector('[data-role="playBtn"]')); // Stop
  await sleep(50);
  before = window.__starts.length;
  pointer(btnRef, 'pointerdown', 100); pointer(btnRef, 'pointerup', 100);
  check('à l\'arrêt, un clic ne relance rien', window.__starts.length === before);

  console.log(failures === 0 ? 'ALL CHECKS PASSED' : (failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
