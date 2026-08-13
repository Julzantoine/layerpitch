// Teste le moteur embranchement-vertical (boucles nommées en arrière-plan + bascule par rampe de gain +
// détour ponctuel pour une boucle plus courte que la référence). Même infrastructure que
// test_vr_engine.js/test_player_regression.js : horloge fictive basée sur le temps réel écoulé, pas de
// faux "tick manuel", pour que le scheduler à fenêtre glissante de player.js tourne exactement comme en
// vrai (juste avec un tempo très rapide pour que le test se termine vite).
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
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: 10 }); }; // durée réelle non pertinente : le moteur programme sur bars/BPM, pas sur buffer.duration
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

  // BPM=150, 1 temps/mesure -> secondsPerBeat=0.4s. Référence et "peer" à 2 mesures (cycle 0.8s), boucle
  // courte à 1 mesure (0.4s, moitié de la référence) — assez rapide pour un test, assez lent pour observer
  // les états intermédiaires (bouton désactivé pendant le détour) avant qu'ils ne se referment.
  const track = {
    id: 'ev1', title: 'Test embranchement-vertical', mode: 'embranchement-vertical', description: '',
    duration: 0, base: 'https://example.invalid/audio/ev1/', publishedAt: Date.now(),
    bpm: 150, beatsPerBar: 1,
    loops: [
      { id: 'ref', label: 'Reference', bars: 2, isInitial: true, localFile: fakeFile('ref.wav') },
      { id: 'peer', label: 'Peer', bars: 2, localFile: fakeFile('peer.wav') },
      { id: 'short', label: 'Short', bars: 1, localFile: fakeFile('short.wav') }
    ],
    sfxIds: []
  };

  const row = Core.buildTrackRow(track, null, false);
  doc.getElementById('host').appendChild(row);
  Core.initTrackPlayer(track, row);
  await sleep(300);

  const playBtn = row.querySelector('[data-role="playBtn"]');
  check('play button enabled after (fake) loading completes', playBtn && !playBtn.disabled);

  const loopBtns = [...row.querySelectorAll('.embr-loop-btn')];
  check('one named button per declared loop', loopBtns.length === 3);
  const btnRef = loopBtns.find(b => b.dataset.loopId === 'ref');
  const btnPeer = loopBtns.find(b => b.dataset.loopId === 'peer');
  const btnShort = loopBtns.find(b => b.dataset.loopId === 'short');
  check('reference loop marked active before playback even starts (server-rendered default)', btnRef.classList.contains('active'));

  click(playBtn);
  await sleep(100);
  check('reference loop still active right after play starts', btnRef.classList.contains('active'));

  // ---- Bascule pure entre deux boucles de même longueur (rampe de gain, pas de redémarrage) ----
  click(btnPeer);
  await sleep(50); // rampe de 0.15s pas encore terminée, mais l'état "actif" bascule immédiatement au clic
  check('clicking a same-length loop switches the active button immediately (no wait for quantization)', btnPeer.classList.contains('active') && !btnRef.classList.contains('active'));
  await sleep(200);
  check('peer loop still active well after the crossfade ramp (background loop, can be kept indefinitely)', btnPeer.classList.contains('active'));

  // ---- Détour ponctuel : boucle plus courte que la référence ----
  click(btnShort);
  await sleep(30);
  check('short loop button disabled immediately once the detour starts (no retrigger while it plays)', btnShort.disabled === true);
  check('no peer button shows as active during the detour (embrActiveLoopIdx = -1)', !btnRef.classList.contains('active') && !btnPeer.classList.contains('active'));
  // Le détour dure blockSeconds(1 mesure) = 0.4s ; on attend son terme + une marge pour la rampe de retour.
  check('short loop button re-enabled and reference loop active again once the detour has run its course',
    await waitUntil(() => !btnShort.disabled && btnRef.classList.contains('active'), 2000));

  // ---- Non-régression (bug trouvé et corrigé le 31/07) : interrompre un détour AVANT sa fin naturelle,
  // en choisissant autre chose, ne doit pas laisser le détour orphelin (bouton bloqué, source jamais coupée).
  click(btnShort);
  await sleep(30);
  check('second detour: short loop button disabled once it starts', btnShort.disabled === true);
  click(btnPeer); // interrompt le détour bien avant sa fin naturelle (0.4s), au lieu d'attendre
  await sleep(50);
  check('interrupting a detour early re-enables its button immediately (does not wait for the full duration)', btnShort.disabled === false);
  check('interrupting a detour early switches straight to the newly chosen peer loop', btnPeer.classList.contains('active'));
  // Si le détour interrompu n'avait pas été proprement nettoyé, cliquer une troisième fois dessus plus
  // tard planterait ou resterait bloqué désactivé pour de bon — vérifie qu'il reste pleinement utilisable.
  await sleep(100);
  click(btnShort);
  await sleep(30);
  check('the same loop can be triggered again after an early interruption (state fully cleaned up, not stuck)', btnShort.disabled === true);
  check('re-enabled and back on the reference loop after this fresh detour completes',
    await waitUntil(() => !btnShort.disabled && btnRef.classList.contains('active'), 2000));

  // ---- Stop pendant un détour en cours (bug trouvé et corrigé le 31/07 : la source du détour n'était
  // jamais explicitement arrêtée) : ne doit ni jeter d'erreur, ni laisser un bouton bloqué.
  click(btnShort);
  await sleep(30);
  check('third detour started, button disabled as expected', btnShort.disabled === true);
  click(playBtn); // Stop en pleine lecture du détour
  await sleep(50);
  check('stopping mid-detour does not throw and re-enables every loop button', loopBtns.every(b => !b.disabled));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
