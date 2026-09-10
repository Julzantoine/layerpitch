const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Chantier Adaptive OST — corrige un vrai bug trouvé par la relecture de code : un chemin
// pré-écrit (embranchement-vertical) se désynchronisait après une reprise post mise-en-veille
// (resumeEmbrVerticalAfterBackground remet embrReferenceStartCtxTime à zéro sans ajuster le
// minutage des bascules planifiées restantes). Ce test simule une interruption (événement
// visibilitychange) EN COURS de plan et vérifie que la bascule suivante se déclenche toujours au
// bon instant RÉEL depuis le début de la lecture, pas décalée par la durée déjà écoulée avant
// l'interruption.

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
  async function waitUntil(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { if (predicate()) return true; await sleep(20); }
    return predicate();
  }

  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  const track = {
    id: 'embr-resume-fix', title: 'Test reprise', mode: 'embranchement-vertical', description: '', duration: 0,
    base: '', publishedAt: 1, bpm: 150, beatsPerBar: 1,
    loops: [
      { id: 'ref', label: 'Reference', bars: 2, isInitial: true, localFile: fakeFile('ref.wav') },
      { id: 'peer', label: 'Peer', bars: 2, localFile: fakeFile('peer.wav') },
    ],
    sfxIds: []
  };

  const row = Core.buildTrackRow(track, null, false);
  doc.getElementById('host').appendChild(row);
  Core.initTrackPlayer(track, row);
  await sleep(300);

  // Plan : bascule vers "peer" à 0.2s, retour vers "ref" à 0.7s (depuis le début RÉEL de la lecture).
  Core.applyTrackSettings('embr-resume-fix', { embrPlannedSwitches: [{ atSec: 0.2, loopIdx: 1 }, { atSec: 0.7, loopIdx: 0 }] });

  const btnRef = row.querySelector('.embr-loop-btn[data-loop-id="ref"]');
  const btnPeer = row.querySelector('.embr-loop-btn[data-loop-id="peer"]');
  const playBtn = row.querySelector('[data-role="playBtn"]');

  const playStartedAt = Date.now();
  click(playBtn);
  check('bascule automatique vers peer (première étape du plan)', await waitUntil(() => btnPeer.classList.contains('active'), 1500));

  // Simule une interruption (mise en veille -> retour) EN PLEIN MILIEU du plan, bien avant la
  // deuxième bascule planifiée (0.7s) -- déclenche resumeEmbrVerticalAfterBackground() via le même
  // événement que le vrai code écoute (visibilitychange), pas un appel direct à une fonction interne
  // non exportée.
  await sleep(150); // ~0.35s écoulées depuis le début réel de la lecture
  doc.dispatchEvent(new window.Event('visibilitychange'));

  check('bascule vers ref au bon MOMENT RÉEL (~0.7s depuis le début), pas décalée par l\'interruption',
    await waitUntil(() => btnRef.classList.contains('active'), 1200));
  const elapsedAtSecondSwitch = (Date.now() - playStartedAt) / 1000;
  check(`minutage correct : bascule vers ref ~0.7s après le début (mesuré ${elapsedAtSecondSwitch.toFixed(2)}s, tolérance large pour la latence du test)`,
    elapsedAtSecondSwitch > 0.5 && elapsedAtSecondSwitch < 1.0);

  click(playBtn); // stop

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
