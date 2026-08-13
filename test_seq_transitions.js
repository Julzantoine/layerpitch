// Teste la coupure fine des embranchements séquentiels (schéma "quantization"/"cutStyle"/"transition"
// validé le 02/08) : interruption d'un segment AVANT sa fin naturelle, au bon point de quantification
// (immédiat, ou prochaine mesure), avec ou sans fichier de transition intermédiaire. Même infrastructure
// que les autres suites (horloge fictive temps réel, pas de faux "tick manuel").
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

  // BPM=300, 1 temps/mesure -> 0.2s par mesure. Segment source de 4 mesures (0.8s au total) : largement
  // assez long pour qu'une coupure "bar" au premier temps (~0.2s) soit sans ambiguïté bien AVANT la fin
  // naturelle du segment (0.8s), et pour qu'une coupure "immediate" (quasi instantanée) soit clairement
  // distincte des deux.
  const bpm = 300, beatsPerBar = 1;

  // ---- Scénario A : quantization "bar" + fichier de transition ----
  {
    const track = {
      id: 'sbt-a', title: 'Bar + transition', mode: 'sequential', description: '', duration: 0,
      base: '', publishedAt: 1, bpm, beatsPerBar,
      segmentSlots: [
        {
          id: 'slotA', label: 'A', avoidImmediateRepeat: false, repeatCount: 1, quantization: 'bar', cutStyle: 'hard',
          alternatives: [{ label: 'A1', bars: 4, localFile: fakeFile('a1.wav') }],
          nextOptions: [{ targetId: 'slotTarget', label: 'To Target', transition: { label: 'Trans', bars: 1, localFile: fakeFile('trans.wav') } }]
        },
        { id: 'slotTarget', label: 'Target', avoidImmediateRepeat: false, repeatCount: 1, alternatives: [{ label: 'T1', bars: 1, localFile: fakeFile('t1.wav') }] }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);

    const seqCurrentEl = row.querySelector('[data-role="seqCurrent"]');
    click(row.querySelector('[data-role="playBtn"]'));
    check('reaches segment A (4 mesures, 0.8s au total)', await waitUntil(() => seqCurrentEl.textContent === 'A1', 2000));

    const clickTime = Date.now();
    const branchBtn = () => [...row.querySelectorAll('.seq-branch-btn')].find(b => b.dataset.targetId === 'slotTarget');
    check('bouton d\'embranchement présent dès le début du segment', !!branchBtn());
    click(branchBtn()); // cliqué presque tout de suite après le début de A -> il reste ~3 des 4 mesures

    check('la transition démarre à la prochaine frontière de MESURE (~0.2s), bien avant la fin naturelle du segment (0.8s)',
      await waitUntil(() => seqCurrentEl.textContent === 'Trans', 500));
    const cutDelayMs = Date.now() - clickTime;
    check('le délai réel confirme une coupure mi-segment, pas une attente de la fin naturelle (delai=' + cutDelayMs + 'ms, doit être < 500ms)', cutDelayMs < 500);

    check('la transition s\'enchaîne ensuite normalement vers la cible (T1)', await waitUntil(() => seqCurrentEl.textContent === 'T1', 1000));
    check('plus aucun bouton d\'embranchement une fois sur la cible (elle n\'en déclare pas)', row.querySelectorAll('.seq-branch-btn').length === 0);
  }

  // ---- Scénario B : quantization "immediate", aucun fichier de transition ----
  {
    const track = {
      id: 'sbt-b', title: 'Immediate direct', mode: 'sequential', description: '', duration: 0,
      base: '', publishedAt: 1, bpm, beatsPerBar,
      segmentSlots: [
        {
          id: 'slotX', label: 'X', avoidImmediateRepeat: false, repeatCount: 1, quantization: 'immediate', cutStyle: 'fade',
          alternatives: [{ label: 'X1', bars: 4, localFile: fakeFile('x1.wav') }],
          nextOptions: [{ targetId: 'slotY', label: 'To Y' }]
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

    const clickTime = Date.now();
    const branchBtn = [...row.querySelectorAll('.seq-branch-btn')].find(b => b.dataset.targetId === 'slotY');
    click(branchBtn);
    check('bascule directe (pas de transition déclarée) vers Y quasi instantanément', await waitUntil(() => seqCurrentEl.textContent === 'Y1', 250));
    const cutDelayMs = Date.now() - clickTime;
    check('délai nettement plus court qu\'une frontière de mesure (0.2s) — "immediate" distinct de "bar" (delai=' + cutDelayMs + 'ms)', cutDelayMs < 150);
  }

  // ---- Scénario C : non-régression — une demande "aller vers la fin" déjà en attente ne doit pas
  // écraser silencieusement un choix d'embranchement fait ensuite (les deux boutons coexistent, rien
  // n'empêche de cliquer les deux) ; bug trouvé et corrigé le 04/08.
  {
    const track = {
      id: 'sbt-c', title: 'GoToEnd vs branch', mode: 'sequential', description: '', duration: 0,
      base: '', publishedAt: 1, bpm, beatsPerBar,
      outro: { label: 'Outro', localFile: fakeFile('outro.wav') },
      segmentSlots: [
        {
          id: 'slotP', label: 'P', avoidImmediateRepeat: false, repeatCount: 1, quantization: 'immediate', cutStyle: 'fade',
          alternatives: [{ label: 'P1', bars: 4, localFile: fakeFile('p1.wav') }],
          nextOptions: [{ targetId: 'slotQ', label: 'To Q' }]
        },
        { id: 'slotQ', label: 'Q', avoidImmediateRepeat: false, repeatCount: 1, alternatives: [{ label: 'Q1', bars: 4, localFile: fakeFile('q1.wav') }] }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);

    const seqCurrentEl = row.querySelector('[data-role="seqCurrent"]');
    click(row.querySelector('[data-role="playBtn"]'));
    check('reaches segment P', await waitUntil(() => seqCurrentEl.textContent === 'P1', 2000));

    click(row.querySelector('[data-role="goToEndBtn"]')); // demande de fin cliquée en premier...
    await sleep(30);
    const branchBtn = [...row.querySelectorAll('.seq-branch-btn')].find(b => b.dataset.targetId === 'slotQ');
    click(branchBtn); // ...puis un choix d'embranchement précis juste après

    check('le choix d\'embranchement l\'emporte : on atterrit bien sur Q, pas directement sur l\'outro', await waitUntil(() => seqCurrentEl.textContent === 'Q1', 500));
    check('le bouton "aller vers la fin" est bien réinitialisé (pas resté bloqué "en cours de fin")', !row.querySelector('[data-role="goToEndBtn"]').disabled);
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
