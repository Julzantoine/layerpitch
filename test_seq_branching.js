// Teste l'option `nextOptions` du mode sequential (voir schéma validé le 31/07) : tant qu'aucun choix
// n'est fait, l'emplacement se rejoue à l'identique ; un clic met en file un choix ; un second clic sur
// une autre option remplace le premier (dernier clic gagne) ; la bascule effective n'a lieu qu'au
// prochain point de quantification du scheduler séquentiel existant. Même infrastructure que
// test_player_regression.js / test_max_chain_loops_e2e.js (horloge fictive temps réel).
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
    while (Date.now() < deadline) { if (predicate()) return true; await sleep(30); }
    return predicate();
  }

  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  // BPM=300, 1 temps/mesure -> 0.2s par emplacement (même ordre de grandeur que le test "Sequential live
  // change" de test_max_chain_loops_e2e.js) — assez rapide pour observer plusieurs rejeux de A avant de
  // faire un choix, sans faire traîner le test.
  const track = {
    id: 'sb1', title: 'Test embranchement séquentiel', mode: 'sequential', description: '', duration: 0,
    base: '', publishedAt: 1, bpm: 300, beatsPerBar: 1,
    segmentSlots: [
      {
        id: 'slotA', label: 'A', avoidImmediateRepeat: false, repeatCount: 1,
        alternatives: [{ label: 'A1', bars: 1, localFile: fakeFile('a1.wav') }],
        nextOptions: [{ targetId: 'slotB', label: 'To B' }, { targetId: 'slotC', label: '' }]
      },
      { id: 'slotB', label: 'B', avoidImmediateRepeat: false, repeatCount: 1, alternatives: [{ label: 'B1', bars: 1, localFile: fakeFile('b1.wav') }] },
      { id: 'slotC', label: 'C', avoidImmediateRepeat: false, repeatCount: 1, alternatives: [{ label: 'C1', bars: 1, localFile: fakeFile('c1.wav') }] }
    ],
    sfxIds: []
  };

  const row = Core.buildTrackRow(track, null, false);
  doc.getElementById('host').appendChild(row);
  Core.initTrackPlayer(track, row);
  await sleep(300);

  const playBtn = row.querySelector('[data-role="playBtn"]');
  check('play button enabled after (fake) loading completes', playBtn && !playBtn.disabled);

  const seqCurrentEl = row.querySelector('[data-role="seqCurrent"]');
  const pendingEl = row.querySelector('[data-role="seqPendingIndicator"]');

  click(playBtn);
  check('reaches slot A first', await waitUntil(() => seqCurrentEl.textContent === 'A1', 2000));

  // ---- Sans choix : l'emplacement se rejoue à l'identique (repeatCount ignoré, jamais d'avancement automatique) ----
  await sleep(700); // plusieurs cycles de 0.2s auraient largement eu le temps d'avancer si le comportement était resté celui d'une chaîne fixe
  check('still on A after several cycles with no branch chosen (replays in place, does not advance on its own)', seqCurrentEl.textContent === 'A1');

  const branchBtns = () => [...row.querySelectorAll('.seq-branch-btn')];
  check('two branch buttons shown for slot A (its declared nextOptions)', branchBtns().length === 2);
  const btnToB = () => branchBtns().find(b => b.dataset.targetId === 'slotB');
  const btnToC = () => branchBtns().find(b => b.dataset.targetId === 'slotC');
  check('custom label used when provided', btnToB().textContent === 'To B');
  check('falls back to the target slot\'s own label when no override given', btnToC().textContent === 'C');
  check('pending indicator hidden before any click', pendingEl.style.display === 'none');

  // ---- Dernier clic gagne : B puis C avant la bascule -> doit atterrir sur C, pas B ----
  click(btnToB());
  await sleep(20);
  check('pending indicator shown right after a branch click', pendingEl.style.display !== 'none');
  check('clicked button marked pending', btnToB().classList.contains('pending'));
  click(btnToC());
  await sleep(20);
  check('second click replaces the pending choice (last click wins)', btnToC().classList.contains('pending') && !btnToB().classList.contains('pending'));

  check('switch actually lands on C (the last-clicked target), not B', await waitUntil(() => seqCurrentEl.textContent === 'C1', 2000));
  check('pending indicator hidden again once the branch has been consumed (slot C has no nextOptions)', pendingEl.style.display === 'none');
  check('no branch buttons shown for slot C (no nextOptions declared on it)', branchBtns().length === 0);

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
