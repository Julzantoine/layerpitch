// Carte des chemins d'un morceau séquentiel en ordre aléatoire (25/09, validé par Jules-Antoine) : les slots
// forment un groupe sans flèches (l'ordre de la liste n'existe plus), les coches "déjà joué" repartent à
// zéro à chaque tour. Même infrastructure jsdom que test_seq_map.js.
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

  const bpm = 300, beatsPerBar = 1; // secondesPerBeat=0.2s -- rapide pour un test, assez lent pour observer les états intermédiaires

  // Ordre aléatoire : 4 emplacements, lecture rapide (1 mesure chacun), sans embranchement.
  const mk = (id, label) => ({ id, label, repeatCount: 1, alternatives: [{ label: label + '1', bars: 1, localFile: fakeFile(id + '.wav') }] });

  // ---- Backstage (tout révélé) : grille sans flèches, mention "ordre aléatoire" ----
  {
    const track = { id: 'rnd-1', title: 'Random full', mode: 'sequential', description: '', duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
      randomizeSections: true, seqMapFullReveal: true, segmentSlots: [mk('s1', 'A'), mk('s2', 'B'), mk('s3', 'C'), mk('s4', 'D'), mk('s5', '')], sfxIds: [] };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await waitUntil(() => row.querySelectorAll('.seq-map-node').length === 5, 2000);
    const nodes = [...row.querySelectorAll('.seq-map-node')];
    check('5 slots affichés', nodes.length === 5);
    check('slot sans nom : libellé de repli traduit (pas la clé "slotFallback")', /^(Emplacement|Slot) 5$/.test(nodes.find(n => n.dataset.slotIdx === '4').textContent.trim()));
    check('aucune flèche entre slots en ordre aléatoire', row.querySelectorAll('[data-role="seqMapLines"] .seq-map-edge').length === 0);
    check('mention "ordre aléatoire" à côté du titre de la carte', /aléatoire|random/i.test(row.querySelector('[data-role="seqMap"] .voice-graph-label').textContent));
    const tops = new Set(nodes.map(n => n.style.top)), lefts = new Set(nodes.map(n => n.style.left));
    check('grille de 4 de large : 2 lignes, 4 colonnes', tops.size === 2 && lefts.size === 4);
  }

  // ---- Page publique : coches remises à zéro à chaque tour ----
  {
    const track = { id: 'rnd-2', title: 'Random public', mode: 'sequential', description: '', duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
      randomizeSections: true, segmentSlots: [mk('s1', 'A'), mk('s2', 'B'), mk('s3', 'C')], sfxIds: [] };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    const nodesEl = row.querySelector('[data-role="seqMapNodes"]');
    click(row.querySelector('[data-role="playBtn"]'));
    const played = [];
    let sawAllRevealed = false, sawFreshRound = false, maxChecks = 0;
    const deadline = Date.now() + 6000;
    let last = null;
    while (Date.now() < deadline && played.length < 7) {
      const cur = nodesEl.querySelector('.seq-map-node.current');
      const idx = cur ? cur.dataset.slotIdx : null;
      if (idx !== null && idx !== last) {
        played.push(idx); last = idx;
        const checks = nodesEl.querySelectorAll('.seq-map-node-check').length;
        maxChecks = Math.max(maxChecks, checks);
        if (nodesEl.children.length === 3) sawAllRevealed = true;
        // 4e slot joué = 1er du 2e tour : aucune coche (le tour vient de recommencer)
        if (played.length === 4 && checks === 0) sawFreshRound = true;
      }
      await sleep(20);
    }
    check('les 3 slots ont été joués puis tous révélés', sawAllRevealed);
    check('jamais plus de 2 coches (le slot en cours n\'en porte pas)', maxChecks <= 2);
    check('au début du 2e tour, plus aucune coche', sawFreshRound);
    check('le 1er tour joue chaque slot une fois', new Set(played.slice(0, 3)).size === 3);
    check('toujours aucune flèche', row.querySelectorAll('[data-role="seqMapLines"] .seq-map-edge').length === 0);
    click(row.querySelector('[data-role="playBtn"]'));
  }

  // ---- Non-régression : ordre fixe, les flèches sont toujours là ----
  {
    const track = { id: 'rnd-3', title: 'Fixed', mode: 'sequential', description: '', duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
      seqMapFullReveal: true, segmentSlots: [mk('s1', 'A'), mk('s2', 'B'), mk('s3', 'C')], sfxIds: [] };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await waitUntil(() => row.querySelectorAll('.seq-map-node').length === 3, 2000);
    check('ordre fixe : flèches tracées', row.querySelectorAll('[data-role="seqMapLines"] .seq-map-edge').length === 3);
    check('ordre fixe : pas de mention "ordre aléatoire"', !/aléatoire|random order/i.test(row.querySelector('[data-role="seqMap"] .voice-graph-label').textContent));
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
