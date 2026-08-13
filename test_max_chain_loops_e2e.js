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
      let bufCounter = 0;
      FakeAudioContext.prototype.decodeAudioData = function () { bufCounter++; return Promise.resolve({ duration: 2 + (bufCounter % 3) * 0.1 }); };
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
  function setValue(el, v) { el.value = v; el.dispatchEvent(new window.Event('change', { bubbles: true })); }
  async function waitUntil(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { if (predicate()) return true; await sleep(50); }
    return predicate();
  }

  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  // ---- Vertical-random : maxChainLoops=1 doit arrêter tout seul, sans "aller vers la fin" manuel ----
  {
    const track = {
      id: 'vr1', title: 'VR auto-end', mode: 'vertical-random', description: '', duration: 0,
      base: 'https://example.invalid/audio/vr1/', publishedAt: Date.now(), randomizeSections: false,
      maxChainLoops: 1,
      outro: { label: 'Outro', localFile: fakeFile('outro.wav') },
      sections: [
        { id: 'secA', label: 'A', bpm: 150, beatsPerBar: 1, startTrackBeat: 0, loopInBeat: 0, loopOutBeat: 1, maxLoops: 1, pools: [{ id: 'p1', label: 'P1', alternatives: [{ label: 'alt', localFile: fakeFile('a1.wav') }] }] },
        { id: 'secB', label: 'B', bpm: 150, beatsPerBar: 1, startTrackBeat: 0, loopInBeat: 0, loopOutBeat: 1, maxLoops: 1, pools: [{ id: 'p2', label: 'P2', alternatives: [{ label: 'alt', localFile: fakeFile('b1.wav') }] }] }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    const playBtn = row.querySelector('[data-role="playBtn"]');
    check('VR : select maxChainLoops public présent et pré-rempli sur 1', row.querySelector('[data-role="chainLoopCountSelect"]').value === '1');
    check('VR : pas de select loopCount (quantifié) mort pour ce mode', !row.querySelector('[data-role="loopCountSelect"]'));
    click(playBtn);
    const icon = row.querySelector('[data-role="playIcon"]');
    check('VR : s\'arrête automatiquement après 1 cycle complet, sans clic manuel sur "aller vers la fin"',
      await waitUntil(() => icon.innerHTML.includes('M8 5v14l11-7z'), 5000));
  }

  // ---- Séquentiel : le sélecteur visiteur change track.maxChainLoops en cours de route ----
  {
    const track = {
      id: 'seq1', title: 'Sequential live change', mode: 'sequential', description: '', duration: 0, base: '', publishedAt: 1,
      bpm: 300, beatsPerBar: 1, maxChainLoops: null,
      outro: { label: 'Outro', localFile: fakeFile('outro.wav') },
      segmentSlots: [{ id: 'slotA', label: 'A', avoidImmediateRepeat: false, repeatCount: 1, alternatives: [{ label: 'A1', bars: 1, localFile: fakeFile('a1.wav') }] }],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    const chainSelect = row.querySelector('[data-role="chainLoopCountSelect"]');
    check('séquentiel : select maxChainLoops public présent, "infini" par défaut', !!chainSelect && chainSelect.value === '');
    click(row.querySelector('[data-role="playBtn"]'));
    await sleep(150);
    // Le visiteur choisit "1" APRÈS le départ de la lecture — doit prendre effet sans relancer la piste.
    setValue(chainSelect, '1');
    const icon = row.querySelector('[data-role="playIcon"]');
    check('séquentiel : le changement en cours de lecture déclenche bien la fin automatique',
      await waitUntil(() => icon.innerHTML.includes('M8 5v14l11-7z'), 5000));
  }

  // ---- Vertical-random : le sélecteur PAR SECTION change section.maxLoops en cours de route ----
  {
    const track = {
      id: 'vr2', title: 'VR section live change', mode: 'vertical-random', description: '', duration: 0,
      base: 'https://example.invalid/audio/vr2/', publishedAt: Date.now(), randomizeSections: false,
      sections: [
        { id: 'secA', label: 'A', bpm: 150, beatsPerBar: 1, startTrackBeat: 0, loopInBeat: 0, loopOutBeat: 1, maxLoops: 5, pools: [{ id: 'p1', label: 'P1', alternatives: [{ label: 'alt', localFile: fakeFile('a1.wav') }] }] },
        { id: 'secB', label: 'B', bpm: 150, beatsPerBar: 1, startTrackBeat: 0, loopInBeat: 0, loopOutBeat: 1, maxLoops: null, pools: [{ id: 'p2', label: 'P2', alternatives: [{ label: 'alt', localFile: fakeFile('b1.wav') }] }] }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    click(row.querySelector('[data-role="playBtn"]'));
    const sectionCurrentEl = row.querySelector('[data-role="sectionCurrent"]');
    await waitUntil(() => sectionCurrentEl.textContent === 'A', 2000);
    // Le compositeur avait réglé 5 boucles pour A ; le visiteur en choisit 1 alors que A est déjà en train
    // de jouer — l'avancement vers B doit prendre effet bien avant les 5 boucles d'origine (~2s à 0,4s/boucle).
    setValue(row.querySelector('[data-role="vrSectionLoop-0"]'), '1');
    check('VR : la mutation live de section.maxLoops (via le sélecteur par section) fait avancer vers B bien avant la valeur d\'origine',
      await waitUntil(() => sectionCurrentEl.textContent === 'B', 4000));
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
