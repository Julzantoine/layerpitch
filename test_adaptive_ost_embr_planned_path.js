const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Chantier Adaptive OST — chemin pré-écrit (embranchement-vertical) : contrairement au séquentiel à
// embranchement, ce moteur n'a aucun point de décision naturel (boucles phase-verrouillées en
// continu, bascule uniquement manuelle) -- le plan enregistre donc le MINUTAGE réel de chaque
// bascule (secondes depuis le début de la lecture), pas seulement son ordre. Vérifie
// qu'enregistrer une performance (bascules réelles pendant la lecture) produit un plan capturable
// via getTrackSettings, et que ce plan rejoue automatiquement les mêmes bascules, au même moment
// relatif, sur une AUTRE instance de piste après restauration via applyTrackSettings.

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
    while (Date.now() < deadline) { if (predicate()) return true; await sleep(30); }
    return predicate();
  }

  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  function makeTrack(id) {
    return {
      id, title: 'Test chemin embr-vertical', mode: 'embranchement-vertical', description: '', duration: 0,
      base: '', publishedAt: 1, bpm: 150, beatsPerBar: 1,
      loops: [
        { id: 'ref', label: 'Reference', bars: 2, isInitial: true, localFile: fakeFile('ref.wav') },
        { id: 'peer', label: 'Peer', bars: 2, localFile: fakeFile('peer.wav') },
      ],
      sfxIds: []
    };
  }

  // ---- Enregistre une bascule vers "peer" en direct ----
  const srcTrack = makeTrack('embr-path-src');
  const srcRow = Core.buildTrackRow(srcTrack, null, false);
  doc.getElementById('host').appendChild(srcRow);
  Core.initTrackPlayer(srcTrack, srcRow);
  await sleep(300);

  const recordBtn = srcRow.querySelector('[data-role="embrPathRecordBtn"]');
  const statusEl = srcRow.querySelector('[data-role="embrPathStatus"]');
  check('bouton d\'enregistrement présent (piste à plusieurs boucles)', !!recordBtn);
  check('statut initial : aucun chemin enregistré', statusEl.textContent.includes('aucun chemin'));

  const playBtn = srcRow.querySelector('[data-role="playBtn"]');
  click(playBtn);
  await sleep(150);

  click(recordBtn); // démarre l'enregistrement (après le début de lecture, comme un vrai geste en direct)
  check('statut : enregistrement en cours', statusEl.textContent.includes('enregistrement'));

  const btnPeerSrc = srcRow.querySelector('.embr-loop-btn[data-loop-id="peer"]');
  const btnRefSrc = srcRow.querySelector('.embr-loop-btn[data-loop-id="ref"]');
  await sleep(200);
  click(btnPeerSrc);
  check('bascule vers peer effective', await waitUntil(() => btnPeerSrc.classList.contains('active'), 1000));

  click(recordBtn); // arrête l'enregistrement -> 1 bascule enregistrée
  check('statut : chemin enregistré (1 bascule)', statusEl.textContent.includes('chemin enregistré (1 bascule)'));

  const captured = Core.getTrackSettings('embr-path-src');
  check('getTrackSettings capture le plan (1 bascule vers peer)', captured && captured.embrPlannedSwitches.length === 1 && captured.embrPlannedSwitches[0].loopIdx === 1);
  check('getTrackSettings capture un minutage positif et raisonnable (~0.2s après le début)', captured.embrPlannedSwitches[0].atSec > 0.1 && captured.embrPlannedSwitches[0].atSec < 1);

  click(playBtn); // stop

  // ---- Restaure ce plan sur une AUTRE instance : doit basculer vers "peer" tout seul, sans clic ----
  const targetTrack = makeTrack('embr-path-target');
  const targetRow = Core.buildTrackRow(targetTrack, null, false);
  doc.getElementById('host').appendChild(targetRow);
  Core.initTrackPlayer(targetTrack, targetRow);
  await sleep(300);
  Core.applyTrackSettings('embr-path-target', { embrPlannedSwitches: captured.embrPlannedSwitches });
  const targetStatus = targetRow.querySelector('[data-role="embrPathStatus"]');
  check('applyTrackSettings : statut reflète le plan restauré', targetStatus.textContent.includes('chemin enregistré (1 bascule)'));

  const targetPlayBtn = targetRow.querySelector('[data-role="playBtn"]');
  const btnPeerTarget = targetRow.querySelector('.embr-loop-btn[data-loop-id="peer"]');
  const btnRefTarget = targetRow.querySelector('.embr-loop-btn[data-loop-id="ref"]');
  check('avant lecture : référence active par défaut', btnRefTarget.classList.contains('active'));
  click(targetPlayBtn);
  check('plan restauré : bascule automatiquement vers peer SANS clic', await waitUntil(() => btnPeerTarget.classList.contains('active'), 1500));
  click(targetPlayBtn); // stop

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
