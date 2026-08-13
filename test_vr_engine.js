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
    url: 'http://localhost/test.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      // Horloge fictive basée sur le temps réel écoulé (pas de faux "tick manuel") — le scheduler à
      // fenêtre glissante (lookahead) de player.js tourne alors exactement comme en vrai, juste avec des
      // sections très courtes pour que le test se termine vite.
      const epoch = Date.now();
      function FakeAudioContext() {
        this.destination = {};
      }
      Object.defineProperty(FakeAudioContext.prototype, 'currentTime', {
        get() { return (Date.now() - epoch) / 1000; }
      });
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
      // Décodage fictif mais "réussi" : chaque buffer déclare une durée (secondes) dérivée d'un compteur
      // interne, pour distinguer facilement les fichiers entre eux si besoin dans les logs de debug.
      let bufCounter = 0;
      FakeAudioContext.prototype.decodeAudioData = function () {
        bufCounter++;
        return Promise.resolve({ duration: 2 + (bufCounter % 3) * 0.1 });
      };
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

  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  function fakeFile(name) { return { name, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }; }
  function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---- Construit un morceau vertical-random à 2 sections + intro/outro, avec des cycles TRÈS courts
  // (BPM élevé, peu de mesures) pour que le test avance vite en temps réel. ----
  const track = {
    id: 't1', title: 'Test VR', mode: 'vertical-random', description: '', duration: 0,
    base: 'https://example.invalid/audio/t1/', publishedAt: Date.now(),
    randomizeSections: false,
    intro: { label: 'Intro', bars: 1, localFile: fakeFile('intro.wav') },
    outro: { label: 'Outro', localFile: fakeFile('outro.wav') },
    sections: [
      {
        id: 'secA', label: 'A', bpm: 150, beatsPerBar: 1, startTrackBeat: 0, loopInBeat: 0, loopOutBeat: 1, maxLoops: 2,
        pools: [
          { id: 'poolBasse', label: 'Basse', avoidImmediateRepeat: true, alternatives: [{ label: 'Basse 1', localFile: fakeFile('b1.wav') }, { label: 'Basse 2', localFile: fakeFile('b2.wav') }] }
        ]
      },
      {
        id: 'secB', label: 'B', bpm: 150, beatsPerBar: 1, startTrackBeat: 0, loopInBeat: 0, loopOutBeat: 1, maxLoops: null,
        pools: [
          { id: 'poolGuitare', label: 'Guitare', avoidImmediateRepeat: false, alternatives: [{ label: 'Guitare 1', localFile: fakeFile('g1.wav') }] }
        ]
      }
    ],
    sfxIds: []
  };
  // BPM=150, 1 temps/mesure -> secondsPerBeat = 0.4s, cycle = 0.4s par section — assez rapide pour un test,
  // assez lent pour que la fenêtre de programmation à l'avance (1s) ne remplisse pas des dizaines de
  // générations d'un coup (ce qui retarderait d'autant l'effet visible des boutons manuels).

  const row = Core.buildTrackRow(track, null, false);
  doc.getElementById('host').appendChild(row);
  Core.initTrackPlayer(track, row);

  // Laisse le temps au chargement asynchrone (décodage fictif) de se terminer.
  await sleep(300);

  const playBtn = row.querySelector('[data-role="playBtn"]');
  check('play button enabled after (fake) loading completes', playBtn && !playBtn.disabled);

  const sectionCurrentEl = row.querySelector('[data-role="sectionCurrent"]');
  const goToEndBtn = row.querySelector('[data-role="goToEndBtn"]');
  const goToNextSectionBtn = row.querySelector('[data-role="goToNextSectionBtn"]');
  check('goToEndBtn present', !!goToEndBtn);
  check('goToNextSectionBtn present', !!goToNextSectionBtn);
  check('buttons disabled before play', goToEndBtn.disabled && goToNextSectionBtn.disabled);

  click(playBtn);
  check('buttons enabled once playing', !goToEndBtn.disabled && !goToNextSectionBtn.disabled);

  // Attend activement (au lieu d'un délai fixe) que la section affichée devienne "B" — intro (0.4s) puis
  // section A qui avance automatiquement après 2 boucles (maxLoops=2, soit 0.8s) vers B.
  async function waitUntil(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await sleep(50);
    }
    return predicate();
  }
  check('auto-advance reaches section B (intro + 2 loops of A)', await waitUntil(() => sectionCurrentEl.textContent === 'B', 4000));

  // ---- Barre de progression par section (seek par glissement sur le bloc actif uniquement) ----
  const vrBlocks = row.querySelectorAll('[data-role="vrBlocks"] .seq-block');
  check('one progress block per declared section', vrBlocks.length === 2);
  const activeBlockIndex = () => [...vrBlocks].findIndex(b => b.classList.contains('active'));
  check('exactly one block marked active (matching current section "B")', activeBlockIndex() === 1);

  const activeBlock = vrBlocks[activeBlockIndex()];
  const otherBlock = vrBlocks[1 - activeBlockIndex()]; // section "A", pas active en ce moment
  function fakePointerEvent(type, clientX) {
    const ev = new window.MouseEvent(type, { bubbles: true, clientX });
    return ev;
  }
  // Le bloc INACTIF ne doit rien faire au clic (pas de recherche possible en dehors de la section en cours).
  otherBlock.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 20 });
  otherBlock.dispatchEvent(fakePointerEvent('pointerdown', 50));
  otherBlock.dispatchEvent(fakePointerEvent('pointerup', 50));
  await sleep(100);
  check('clicking the inactive block does not change the current section', sectionCurrentEl.textContent === 'B');

  // Le bloc ACTIF doit permettre de rechercher une position (mi-cycle ici) sans faire avancer la chaîne
  // (toujours sur "B" après le seek, pas de saut vers "A").
  activeBlock.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 20 });
  activeBlock.dispatchEvent(fakePointerEvent('pointerdown', 50));
  activeBlock.dispatchEvent(fakePointerEvent('pointerup', 50));
  await sleep(100);
  check('seeking within the active block keeps the same section (does not advance the chain)', sectionCurrentEl.textContent === 'B');
  check('play/pause icon still shows pause (still playing) after seek', row.querySelector('[data-role="playIcon"]').innerHTML.includes('M6 5h4v14H6z'));

  click(goToNextSectionBtn);
  check('after manual "next section" from B, back to A (only 2 sections, wraps around)', await waitUntil(() => sectionCurrentEl.textContent === 'A', 3000));

  // "Aller vers la fin" doit finir par déclencher l'outro puis l'arrêt naturel.
  click(goToEndBtn);
  const stoppedIcon = row.querySelector('[data-role="playIcon"]');
  check('playback stops naturally after outro', await waitUntil(() => stoppedIcon.innerHTML.includes('M8 5v14l11-7z'), 4000));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
