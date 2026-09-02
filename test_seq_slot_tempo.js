// Teste le tempo propre par emplacement séquentiel (segmentSlots[i].bpm / beatsPerBar, optionnel,
// repli slot.bpm || track.bpm || 120 — voir décision du 13/08, même principe que le tempo par section
// du vertical-random). Trois points vérifiés : l'intro suit le tempo du premier emplacement de la
// chaîne ; une coupure d'embranchement (frontière de quantification ET durée du fichier de transition)
// suit le tempo de l'emplacement qu'on QUITTE, jamais celui de la cible ; un emplacement cible avec son
// propre tempo joue sa durée nominale sur SA grille, pas celle du morceau. Même infrastructure que
// test_seq_transitions.js (horloge fictive temps réel, pas de faux "tick manuel").
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
  async function waitUntil(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { if (predicate()) return true; await sleep(20); }
    return predicate();
  }

  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  // Morceau à 300 BPM / 1 temps-mesure (0.2s la mesure) — sauf l'emplacement B, volontairement beaucoup
  // plus lent (60 BPM -> 1s la mesure), pour que toute confusion entre le tempo du morceau et celui de
  // l'emplacement se voie immédiatement dans les délais mesurés (5x d'écart, aucune ambiguïté possible).
  const track = {
    id: 'stt1', title: 'Tempo par emplacement', mode: 'sequential', description: '', duration: 0,
    base: '', publishedAt: 1, bpm: 300, beatsPerBar: 1,
    intro: { label: 'Intro', bars: 1, localFile: fakeFile('intro.wav') },
    segmentSlots: [
      {
        id: 'slotA', label: 'A', avoidImmediateRepeat: false, repeatCount: 1, quantization: 'bar', cutStyle: 'hard',
        // slotA n'a PAS de bpm propre -> hérite du tempo du morceau (300 BPM, 0.2s/mesure), comme avant
        // ce changement (rétrocompatibilité : un emplacement sans réglage propre doit sonner à l'identique).
        alternatives: [{ label: 'A1', bars: 4, localFile: fakeFile('a1.wav') }],
        nextOptions: [{ targetId: 'slotB', label: 'To B', transition: { label: 'Trans', bars: 1, localFile: fakeFile('trans.wav') } }]
      },
      {
        id: 'slotB', label: 'B', bpm: 60, beatsPerBar: 1, avoidImmediateRepeat: false, repeatCount: 1,
        alternatives: [{ label: 'B1', bars: 1, localFile: fakeFile('b1.wav') }]
      }
    ],
    sfxIds: []
  };

  const row = Core.buildTrackRow(track, null, false);
  doc.getElementById('host').appendChild(row);
  Core.initTrackPlayer(track, row);
  await sleep(300);

  const seqCurrentEl = row.querySelector('[data-role="seqCurrent"]');

  // ---- 1) L'intro suit le tempo du PREMIER emplacement de la chaîne (slotA, 300 BPM -> 1 mesure = 0.2s) ----
  const introStart = Date.now();
  click(row.querySelector('[data-role="playBtn"]'));
  check('l\'intro (1 mesure, tempo de slotA=300 BPM) cède la place à A bien avant 1s',
    await waitUntil(() => seqCurrentEl.textContent === 'A1', 1500));
  const introDelayMs = Date.now() - introStart;
  check('durée de l\'intro cohérente avec 300 BPM (~0.2s), pas avec un tempo par défaut de 120 BPM (~0.5s) (mesuré=' + introDelayMs + 'ms)', introDelayMs < 400);

  // ---- 2) Embranchement A -> B : la frontière "bar" ET la transition suivent le tempo de la SOURCE (A,
  // 300 BPM -> 0.2s/mesure), jamais celui de la cible (B, 60 BPM -> 1s/mesure) ----
  const clickTime = Date.now();
  const nodeB = () => row.querySelector('[data-role="seqMapNodes"] [data-slot-id="slotB"]');
  check('nœud d\'embranchement vers B sélectionnable', !!nodeB() && nodeB().classList.contains('selectable'));
  click(nodeB());

  check('la transition démarre à la prochaine frontière de MESURE de la source (~0.2s), pas de la cible (~1s)',
    await waitUntil(() => seqCurrentEl.textContent === 'Trans', 600));
  const cutDelayMs = Date.now() - clickTime;
  check('délai de coupure cohérent avec le tempo de la SOURCE, pas de la cible (delai=' + cutDelayMs + 'ms, doit être < 600ms)', cutDelayMs < 600);

  const transStart = Date.now();
  check('la transition (1 mesure) s\'enchaîne ensuite vers B', await waitUntil(() => seqCurrentEl.textContent === 'B1', 1000));
  const transDelayMs = Date.now() - transStart;
  check('durée de la transition cohérente avec le tempo de la SOURCE (~0.2s), pas de la cible (~1s) (mesuré=' + transDelayMs + 'ms)', transDelayMs < 600);

  // ---- 3) Une fois sur B, l'emplacement joue sur SA PROPRE grille (60 BPM, 1 mesure = 1s), pas celle du
  // morceau (300 BPM, qui donnerait 0.2s) — on vérifie que B est encore actif après le délai "morceau"
  // qui aurait déjà fait avancer un emplacement sans tempo propre. ----
  await sleep(400); // 0.2s (tempo morceau) aurait déjà fait boucler B si son propre tempo n'était pas respecté
  check('B (tempo propre 60 BPM, 1 mesure = 1s) toujours en cours après 0.4s (n\'a pas bouclé au tempo du morceau, 0.2s)', seqCurrentEl.textContent === 'B1');
  check('B toujours en cours peu avant l\'échéance de SA propre mesure (~1s au total)', await waitUntil(() => true, 1) && seqCurrentEl.textContent === 'B1');

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
