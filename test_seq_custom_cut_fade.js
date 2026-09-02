// Teste le 3e style de coupure "custom" (voir décision du 13/08 : pas d'auto-calcul basé sur la
// transition, un champ de durée explicite à la place) : le fondu de sortie de l'emplacement source suit
// la durée choisie par le compositeur (slot.customCutFadeSec), pas la valeur fixe de 0.15s utilisée par
// "fade". Instrumente createGain pour capturer les appels linearRampToValueAtTime(0, ...) (fondus vers le
// silence) et mesure le délai réel par rapport à l'instant de l'appel. Même infrastructure que
// test_seq_transitions.js (horloge fictive temps réel).
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

  const fadeRamps = []; // { deltaSec } pour chaque appel linearRampToValueAtTime(0, ...)

  const dom = new JSDOM(html, {
    url: 'http://localhost/test.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      const epoch = Date.now();
      function FakeAudioContext() { this.destination = {}; }
      Object.defineProperty(FakeAudioContext.prototype, 'currentTime', { get() { return (Date.now() - epoch) / 1000; } });
      FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
      FakeAudioContext.prototype.createGain = function () {
        const ctxRef = this;
        return {
          gain: {
            value: 1, setValueAtTime() {}, cancelScheduledValues() {},
            linearRampToValueAtTime(target, when) {
              if (target === 0) fadeRamps.push({ deltaSec: when - ctxRef.currentTime });
            }
          },
          connect() {}, disconnect() {}
        };
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

  const bpm = 300, beatsPerBar = 1; // 0.2s/mesure — segments longs (4 mesures, 0.8s) pour couper largement avant leur fin naturelle

  // ---- Scénario A : cutStyle "custom", 1.5s de fondu ----
  {
    fadeRamps.length = 0;
    const track = {
      id: 'ccf-a', title: 'Custom fade', mode: 'sequential', description: '', duration: 0,
      base: '', publishedAt: 1, bpm, beatsPerBar,
      segmentSlots: [
        {
          id: 'slotA', label: 'A', avoidImmediateRepeat: false, repeatCount: 1, quantization: 'immediate', cutStyle: 'custom', customCutFadeSec: 1.5,
          alternatives: [{ label: 'A1', bars: 4, localFile: fakeFile('a1.wav') }],
          nextOptions: [{ targetId: 'slotB', label: 'To B' }]
        },
        { id: 'slotB', label: 'B', avoidImmediateRepeat: false, repeatCount: 1, alternatives: [{ label: 'B1', bars: 1, localFile: fakeFile('b1.wav') }] }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    const seqCurrentEl = row.querySelector('[data-role="seqCurrent"]');
    click(row.querySelector('[data-role="playBtn"]'));
    check('reaches segment A', await waitUntil(() => seqCurrentEl.textContent === 'A1', 2000));
    click(row.querySelector('[data-role="seqMapNodes"] [data-slot-id="slotB"]'));
    await sleep(50);
    check('un fondu vers le silence déclenché', fadeRamps.length >= 1);
    const delta = fadeRamps[0] && fadeRamps[0].deltaSec;
    check('durée du fondu proche de 1.5s (personnalisée), pas de 0.15s (delta=' + delta + ')', delta != null && delta > 1.2 && delta < 1.8);
  }

  // ---- Scénario A2 : cutStyle "custom", 0s de fondu (coupure instantanée voulue) — bug trouvé le 13/08
  // lors d'une relecture du code : "sourceSlot.customCutFadeSec || 0.15" traitait 0 comme absent et
  // retombait sur 0.15s au lieu de respecter la coupure instantanée explicitement voulue. ----
  {
    fadeRamps.length = 0;
    const track = {
      id: 'ccf-a2', title: 'Custom fade zero', mode: 'sequential', description: '', duration: 0,
      base: '', publishedAt: 1, bpm, beatsPerBar,
      segmentSlots: [
        {
          id: 'slotA', label: 'A', avoidImmediateRepeat: false, repeatCount: 1, quantization: 'immediate', cutStyle: 'custom', customCutFadeSec: 0,
          alternatives: [{ label: 'A1', bars: 4, localFile: fakeFile('a1.wav') }],
          nextOptions: [{ targetId: 'slotB', label: 'To B' }]
        },
        { id: 'slotB', label: 'B', avoidImmediateRepeat: false, repeatCount: 1, alternatives: [{ label: 'B1', bars: 1, localFile: fakeFile('b1.wav') }] }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    const seqCurrentEl = row.querySelector('[data-role="seqCurrent"]');
    click(row.querySelector('[data-role="playBtn"]'));
    check('reaches segment A', await waitUntil(() => seqCurrentEl.textContent === 'A1', 2000));
    click(row.querySelector('[data-role="seqMapNodes"] [data-slot-id="slotB"]'));
    await sleep(50);
    check('un fondu vers le silence déclenché', fadeRamps.length >= 1);
    const delta = fadeRamps[0] && fadeRamps[0].deltaSec;
    check('durée du fondu proche de 0s (coupure instantanée respectée, pas de repli sur 0.15s) (delta=' + delta + ')', delta != null && delta < 0.05);
  }

  // ---- Scénario B : cutStyle "fade" (par défaut) — reste fixe à 0.15s même avec une transition longue ----
  // (décision du 13/08 : pas d'auto-calcul basé sur la transition, "fade" reste toujours 0.15s)
  {
    fadeRamps.length = 0;
    const track = {
      id: 'ccf-b', title: 'Default fade with long transition', mode: 'sequential', description: '', duration: 0,
      base: '', publishedAt: 1, bpm, beatsPerBar,
      segmentSlots: [
        {
          id: 'slotX', label: 'X', avoidImmediateRepeat: false, repeatCount: 1, quantization: 'immediate', cutStyle: 'fade',
          alternatives: [{ label: 'X1', bars: 4, localFile: fakeFile('x1.wav') }],
          nextOptions: [{ targetId: 'slotY', label: 'To Y', transition: { label: 'Trans', bars: 4, localFile: fakeFile('trans.wav') } }] // 4 mesures à 300 BPM = 0.8s, largement plus que 0.15s si un auto-calcul existait encore
        },
        { id: 'slotY', label: 'Y', avoidImmediateRepeat: false, repeatCount: 1, alternatives: [{ label: 'Y1', bars: 1, localFile: fakeFile('y1.wav') }] }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    const seqCurrentEl = row.querySelector('[data-role="seqCurrent"]');
    click(row.querySelector('[data-role="playBtn"]'));
    check('reaches segment X', await waitUntil(() => seqCurrentEl.textContent === 'X1', 2000));
    click(row.querySelector('[data-role="seqMapNodes"] [data-slot-id="slotY"]'));
    await sleep(50);
    check('un fondu vers le silence déclenché', fadeRamps.length >= 1);
    const delta = fadeRamps[0] && fadeRamps[0].deltaSec;
    check('durée du fondu reste fixe à ~0.15s malgré une transition de 0.8s (pas d\'auto-calcul) (delta=' + delta + ')', delta != null && delta > 0.05 && delta < 0.35);
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
