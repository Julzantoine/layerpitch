const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Chantier Adaptive OST — chemin pré-écrit (séquentiel à embranchement) : vérifie qu'enregistrer un
// déroulé en direct (clics sur la carte des chemins pendant l'enregistrement) produit un plan
// capturable via getTrackSettings, que ce plan rejoue AUTOMATIQUEMENT le même déroulé sur une
// AUTRE instance de piste une fois restauré via applyTrackSettings (round-trip complet, comme pour
// les autres réglages), et que le plan s'abandonne proprement (repli manuel, pas de plantage) si
// une cible planifiée n'est plus une option valide (graphe modifié par le compositeur depuis).

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

  // A -> (B | C) ; C -> (D | E) ; B/D/E sans embranchement (culs-de-sac). bars=2 sur chaque
  // alternative pour éviter la course décrite dans test_seq_branching.js (frontière de
  // quantification vs. rejeu, même mitigation).
  function makeTrack(id) {
    return {
      id, title: 'Test chemin pré-écrit', mode: 'sequential', description: '', duration: 0,
      base: '', publishedAt: 1, bpm: 300, beatsPerBar: 1,
      segmentSlots: [
        { id: 'slotA', label: 'A', repeatCount: 1, alternatives: [{ label: 'A1', bars: 2, localFile: fakeFile('a1.wav') }],
          nextOptions: [{ targetId: 'slotB', label: 'To B' }, { targetId: 'slotC', label: 'To C' }] },
        { id: 'slotB', label: 'B', repeatCount: 1, alternatives: [{ label: 'B1', bars: 2, localFile: fakeFile('b1.wav') }] },
        { id: 'slotC', label: 'C', repeatCount: 1, alternatives: [{ label: 'C1', bars: 2, localFile: fakeFile('c1.wav') }],
          nextOptions: [{ targetId: 'slotD', label: 'To D' }, { targetId: 'slotE', label: 'To E' }] },
        { id: 'slotD', label: 'D', repeatCount: 1, alternatives: [{ label: 'D1', bars: 2, localFile: fakeFile('d1.wav') }] },
        { id: 'slotE', label: 'E', repeatCount: 1, alternatives: [{ label: 'E1', bars: 2, localFile: fakeFile('e1.wav') }] },
      ],
      sfxIds: []
    };
  }

  // ---- Enregistre A -> C -> E en direct ----
  const srcTrack = makeTrack('path-src');
  const srcRow = Core.buildTrackRow(srcTrack, null, false);
  doc.getElementById('host').appendChild(srcRow);
  Core.initTrackPlayer(srcTrack, srcRow);
  await sleep(300);

  const recordBtn = srcRow.querySelector('[data-role="seqPathRecordBtn"]');
  const statusEl = srcRow.querySelector('[data-role="seqPathStatus"]');
  const seqCurrentEl = srcRow.querySelector('[data-role="seqCurrent"]');
  check('bouton d\'enregistrement présent (piste avec embranchements)', !!recordBtn);
  check('statut initial : aucun chemin enregistré', statusEl.textContent.includes('aucun chemin'));

  click(recordBtn); // démarre l'enregistrement
  check('statut : enregistrement en cours', statusEl.textContent.includes('enregistrement'));

  const playBtn = srcRow.querySelector('[data-role="playBtn"]');
  click(playBtn);
  check('atteint A en premier', await waitUntil(() => seqCurrentEl.textContent === 'A1', 2000));
  click(srcRow.querySelector('[data-role="seqMapNodes"] [data-slot-id="slotC"]'));
  check('atteint C (choix enregistré)', await waitUntil(() => seqCurrentEl.textContent === 'C1', 2000));
  click(srcRow.querySelector('[data-role="seqMapNodes"] [data-slot-id="slotE"]'));
  check('atteint E (deuxième choix enregistré)', await waitUntil(() => seqCurrentEl.textContent === 'E1', 2000));

  click(recordBtn); // arrête l'enregistrement -> plannedPath = ['slotC', 'slotE']
  check('statut : chemin enregistré (2 choix)', statusEl.textContent.includes('chemin enregistré (2 choix)'));

  const captured = Core.getTrackSettings('path-src');
  check('getTrackSettings capture le plan enregistré', captured && JSON.stringify(captured.plannedPath) === JSON.stringify(['slotC', 'slotE']));

  click(playBtn); // stop

  // ---- Restaure ce plan sur une AUTRE instance : doit rejouer A -> C -> E tout seul, sans clic ----
  const targetTrack = makeTrack('path-target');
  const targetRow = Core.buildTrackRow(targetTrack, null, false);
  doc.getElementById('host').appendChild(targetRow);
  Core.initTrackPlayer(targetTrack, targetRow);
  await sleep(300);
  Core.applyTrackSettings('path-target', { plannedPath: captured.plannedPath });
  const targetStatus = targetRow.querySelector('[data-role="seqPathStatus"]');
  check('applyTrackSettings : statut reflète le plan restauré', targetStatus.textContent.includes('chemin enregistré (2 choix)'));

  const targetSeqCurrentEl = targetRow.querySelector('[data-role="seqCurrent"]');
  const targetPlayBtn = targetRow.querySelector('[data-role="playBtn"]');
  click(targetPlayBtn);
  check('plan restauré : atteint A', await waitUntil(() => targetSeqCurrentEl.textContent === 'A1', 2000));
  check('plan restauré : bascule automatiquement vers C SANS clic', await waitUntil(() => targetSeqCurrentEl.textContent === 'C1', 2000));
  check('plan restauré : bascule automatiquement vers E SANS clic', await waitUntil(() => targetSeqCurrentEl.textContent === 'E1', 2000));
  click(targetPlayBtn); // stop

  // ---- Plan invalide (cible disparue du graphe) : abandon propre, pas de plantage ----
  const brokenTrack = makeTrack('path-broken');
  brokenTrack.segmentSlots[2].nextOptions = [{ targetId: 'slotD', label: 'To D' }]; // slotC ne propose plus slotE
  const brokenRow = Core.buildTrackRow(brokenTrack, null, false);
  doc.getElementById('host').appendChild(brokenRow);
  Core.initTrackPlayer(brokenTrack, brokenRow);
  await sleep(300);
  Core.applyTrackSettings('path-broken', { plannedPath: ['slotC', 'slotE'] });
  const brokenSeqCurrentEl = brokenRow.querySelector('[data-role="seqCurrent"]');
  const brokenStatus = brokenRow.querySelector('[data-role="seqPathStatus"]');
  const brokenPlayBtn = brokenRow.querySelector('[data-role="playBtn"]');
  click(brokenPlayBtn);
  check('plan avec cible devenue invalide : atteint quand même A puis C (premier choix encore valide)', await waitUntil(() => brokenSeqCurrentEl.textContent === 'C1', 2000));
  await sleep(600); // plusieurs cycles de rejeu de C : ne doit PAS planter, ni sauter vers D ou E tout seul
  check('plan invalide : reste sur C (repli manuel, pas de saut automatique vers une cible non planifiée)', brokenSeqCurrentEl.textContent === 'C1');
  check('plan invalide : statut signale l\'abandon', await waitUntil(() => brokenStatus.textContent.includes('abandonné'), 1000));
  click(brokenPlayBtn);

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
