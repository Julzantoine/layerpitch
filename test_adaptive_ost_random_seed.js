const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Chantier Adaptive OST — graine déterministe (vertical-random) : vérifie que fixer une graine
// (via getTrackSettings/applyTrackSettings, ou le champ vrSeedInput lui-même) rend le brassage des
// sections REPRODUCTIBLE à l'identique entre deux lectures indépendantes depuis le début — c'est ce
// qui permet de "figer" un déroulé génératif précis plutôt que d'avoir à écrire un chemin à la main.
// Vérifie aussi qu'une piste sans graine garde son comportement historique (non bloquée par un état
// interne figé).

(async () => {
  const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
  const playerSrc = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body><div id="host"></div>
  <script>${i18nSrc}</script>
  <script>${playerSrc}</script>
  </body></html>`;

  const dom = new JSDOM(html, {
    url: 'http://localhost/test.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
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
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: 2 }); };
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

  // 3 sections, 1 seule boucle chacune (maxLoops:1) -> avance vite, randomizeSections:true -> l'ordre
  // A/B/C est rebrassé à chaque cycle complet (voir buildOrder() dans player.js).
  function makeTrack(id) {
    return {
      id, title: 'VR seed test', mode: 'vertical-random', description: '', duration: 0, base: '', publishedAt: 1,
      randomizeSections: true,
      sections: ['A', 'B', 'C'].map(label => ({
        id: 'sec' + label, label, bpm: 150, beatsPerBar: 1, loopInBeat: 0, loopOutBeat: 1, maxLoops: 1,
        pools: [{ id: 'pool' + label, label: 'pool', alternatives: [{ label: label + '1', localFile: fakeFile(label + '1.wav') }] }]
      })),
      sfxIds: []
    };
  }

  // buildTrackRow/initTrackPlayer une SEULE fois par track.id (une deuxième initialisation créerait
  // une instance séparée qui écraserait trackSettingsHandles[track.id] — pas la même piste qu'on
  // vient de régler). D'où la séparation entre "créer/régler" et "jouer/observer" ci-dessous, plutôt
  // qu'une seule fonction qui referait buildTrackRow/initTrackPlayer à chaque appel.
  async function freshTrackRow(track, seed) {
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(200);
    if (seed != null) Core.applyTrackSettings(track.id, { randomSeed: seed });
    return row;
  }

  // Collecte les N premières valeurs de section affichées (dédupliquées par changement), en jouant
  // une instance de piste DÉJÀ initialisée (voir freshTrackRow).
  async function playAndCollectSequence(row, count) {
    const sectionCurrentEl = row.querySelector('[data-role="sectionCurrent"]');
    const playBtn = row.querySelector('[data-role="playBtn"]');
    click(playBtn);
    const seen = [];
    let last = null;
    while (seen.length < count) {
      await waitUntil(() => sectionCurrentEl.textContent !== last && sectionCurrentEl.textContent !== '—', 3000);
      last = sectionCurrentEl.textContent;
      seen.push(last);
    }
    click(playBtn); // stop
    await sleep(50);
    return seen;
  }

  async function collectSectionSequence(track, seed, count) {
    const row = await freshTrackRow(track, seed);
    return playAndCollectSequence(row, count);
  }

  const SEED = 424242;
  const seqA = await collectSectionSequence(makeTrack('vr-seed-a'), SEED, 6);
  const seqB = await collectSectionSequence(makeTrack('vr-seed-b'), SEED, 6);
  check('même graine : le brassage des sections est identique entre 2 lectures indépendantes', JSON.stringify(seqA) === JSON.stringify(seqB));
  check('même graine : le brassage n\'est pas juste "toujours A,B,C" par coïncidence (randomize a un effet)', !(seqA.join() === 'A,B,C,A,B,C'));

  // Récupère la graine via getTrackSettings et la réapplique sur une AUTRE instance -- round-trip
  // complet (le cas réel : capturer côté studio, restaurer côté fan via playlist_tracks.settings).
  const trackC = makeTrack('vr-seed-c');
  const rowC = await freshTrackRow(trackC, null);
  Core.applyTrackSettings('vr-seed-c', { randomSeed: SEED });
  const capturedSeed = Core.getTrackSettings('vr-seed-c');
  check('getTrackSettings (vertical-random) : capture la graine réglée', capturedSeed && capturedSeed.randomSeed === SEED);
  const vrSeedInputC = rowC.querySelector('[data-role="vrSeedInput"]');
  check('applyTrackSettings : le champ de graine reflète la valeur', vrSeedInputC && vrSeedInputC.value === String(SEED));

  const seqC = await playAndCollectSequence(rowC, 6);
  check('graine restaurée via getTrackSettings/applyTrackSettings : reproduit le même brassage', JSON.stringify(seqC) === JSON.stringify(seqA));

  // Sans graine (comportement historique) : deux lectures indépendantes n'ont pas de raison de
  // produire la même séquence -- test probabiliste par nature (Math.random() reste Math.random()),
  // mais avec 3 sections rebrassées à chaque cycle complet sur 3 cycles (9 tirages), la chance de
  // coïncidence par pur hasard est d'environ 1/216 (3!^3) -- assez faible pour ne pas rendre ce test
  // significativement instable.
  const seqNoSeedA = await collectSectionSequence(makeTrack('vr-noseed-a'), null, 9);
  const seqNoSeedB = await collectSectionSequence(makeTrack('vr-noseed-b'), null, 9);
  check('sans graine : comportement historique conservé (deux lectures indépendantes diffèrent, pas figées par erreur)', JSON.stringify(seqNoSeedA) !== JSON.stringify(seqNoSeedB));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
