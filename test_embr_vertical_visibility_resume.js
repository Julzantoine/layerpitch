// Teste la reprise après un passage en arrière-plan (changement d'onglet) pendant la lecture d'un morceau
// en embranchement-vertical (29/08, bug signalé par Jules-Antoine : revenir sur l'onglet relançait le
// morceau depuis la boucle de référence, perdant la boucle "paire" réellement active). Simule
// document.visibilityState comme le ferait un vrai changement d'onglet, plutôt que d'appeler une fonction
// interne directement -- on veut vérifier le VRAI chemin déclenché par l'événement navigateur.
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
          buffer: null, onended: null, connect() {},
          stop() { if (node._endTimer) clearTimeout(node._endTimer); if (!node._ended) { node._ended = true; if (node.onended) node.onended(); } },
          start(when) {
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
  function setVisibility(state) {
    Object.defineProperty(doc, 'visibilityState', { value: state, configurable: true });
    doc.dispatchEvent(new window.Event('visibilitychange'));
  }

  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  const bpm = 300, beatsPerBar = 1; // rapide pour un test

  const track = {
    id: 'evt-vis', title: 'Tab switch resume', mode: 'embranchement-vertical', description: '',
    duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
    loops: [
      { id: 'ref', label: 'A', bars: 4, isInitial: true, localFile: fakeFile('a.wav') },
      { id: 'peer', label: 'B', bars: 4, localFile: fakeFile('b.wav') }
    ],
    sfxIds: []
  };
  const row = Core.buildTrackRow(track, null, false);
  doc.getElementById('host').appendChild(row);
  Core.initTrackPlayer(track, row);
  await sleep(300);

  const btnRef = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'ref');
  const btnPeer = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'peer');

  click(row.querySelector('[data-role="playBtn"]'));
  await sleep(100);
  click(btnPeer); // bascule vers B (pas de transition ici -> immédiat)
  await sleep(50);
  check('B est bien la boucle active avant le changement d\'onglet', btnPeer.classList.contains('active'));

  console.log('--- simulation : passage en arrière-plan puis retour ---');
  setVisibility('hidden');
  await sleep(150); // le morceau "reste en pause" en arrière-plan, comme un vrai onglet caché
  setVisibility('visible');
  await sleep(80);

  check('B est TOUJOURS la boucle active après le retour sur l\'onglet (pas de retour à la référence)',
    btnPeer.classList.contains('active') && !btnRef.classList.contains('active'));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
