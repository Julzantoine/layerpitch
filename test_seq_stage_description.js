// Teste le texte de présentation optionnel par emplacement/intro/outro/transition (mode séquentiel),
// schéma validé le 15/08 : descriptionFr/descriptionEn sur segmentSlots[], track.intro, track.outro et
// nextOptions[].transition — affiché dans le même conteneur que la description du morceau (data-role
// "trackDesc"), mis à jour au moment exact où l'élément devient audible (même mécanisme que le libellé,
// scheduleSeqLabelUpdate), un champ vide laissant volontairement le texte précédent affiché plutôt que de
// revenir à la description du morceau. Même infrastructure (horloge fictive temps réel) que
// test_seq_transitions.js.
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
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
  function waitUntil(cond, timeoutMs) {
    return new Promise(resolve => {
      const start = Date.now();
      (function poll() {
        if (cond()) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(poll, 15);
      })();
    });
  }
  function fakeFile(name) { return { name, arrayBuffer: async () => new ArrayBuffer(8) }; }

  // Reproduit exactement l'exemple de Jules-Antoine (15/08) : Intro (sans texte propre) → WetDarkCave
  // (texte propre) → [embranchement avec transition "Secret Lever", texte propre] → Corridor (texte
  // propre) → [embranchement SANS transition] → Battle (SANS texte propre, doit garder celui de Corridor).
  const track = {
    id: 'sbt-desc', title: 'Texte par emplacement', mode: 'sequential', description: 'Description du morceau', duration: 0,
    base: '', publishedAt: 1, bpm: 300, beatsPerBar: 1, // tempo rapide : tout s'enchaîne vite, test court
    intro: { label: 'Intro', bars: 1, localFile: fakeFile('intro.wav') }, // volontairement SANS descriptionFr/En
    segmentSlots: [
      {
        id: 'slotWetDarkCave', label: 'WetDarkCave', avoidImmediateRepeat: false, repeatCount: 1, quantization: 'immediate', cutStyle: 'fade',
        descriptionFr: 'Texte FR WetDarkCave', descriptionEn: 'EN text WetDarkCave',
        alternatives: [{ label: 'WDC1', bars: 4, localFile: fakeFile('wdc1.wav') }],
        nextOptions: [{ targetId: 'slotCorridor', label: 'To Corridor', transition: { label: 'SecretLever', bars: 1, localFile: fakeFile('lever.wav'), descriptionFr: 'Texte FR Secret Lever', descriptionEn: 'EN text Secret Lever' } }]
      },
      {
        id: 'slotCorridor', label: 'Corridor', avoidImmediateRepeat: false, repeatCount: 1, quantization: 'immediate', cutStyle: 'fade',
        descriptionFr: 'Texte FR Corridor', descriptionEn: 'EN text Corridor',
        alternatives: [{ label: 'Cor1', bars: 4, localFile: fakeFile('cor1.wav') }],
        // Pas de transition déclarée pour cet embranchement (bascule directe) — cible SANS texte propre.
        nextOptions: [{ targetId: 'slotBattle', label: 'To Battle' }]
      },
      {
        id: 'slotBattle', label: 'Battle', avoidImmediateRepeat: false, repeatCount: 1,
        // Volontairement SANS descriptionFr/En : doit garder le texte de Corridor affiché.
        alternatives: [{ label: 'Bat1', bars: 4, localFile: fakeFile('bat1.wav') }]
      }
    ],
    sfxIds: []
  };
  const row = Core.buildTrackRow(track, null, false);
  doc.getElementById('host').appendChild(row);
  Core.initTrackPlayer(track, row);
  await new Promise(resolve => setTimeout(resolve, 300));

  const seqCurrentEl = row.querySelector('[data-role="seqCurrent"]');
  const trackDescEl = row.querySelector('[data-role="trackDesc"]');

  check('texte de base du morceau affiché avant tout démarrage', trackDescEl.textContent.trim() === 'Description du morceau');

  click(row.querySelector('[data-role="playBtn"]'));
  check('l\'intro démarre (sans texte propre)', await waitUntil(() => seqCurrentEl.textContent === 'Intro', 2000));
  check('intro sans texte propre : la description du morceau reste affichée (pas de texte vide qui écrase)', trackDescEl.textContent.trim() === 'Description du morceau');

  check('WetDarkCave démarre', await waitUntil(() => seqCurrentEl.textContent === 'WDC1', 2000));
  check('texte FR de WetDarkCave affiché', trackDescEl.textContent.trim() === 'Texte FR WetDarkCave');

  const branchToCorridor = [...row.querySelectorAll('.seq-branch-btn')].find(b => b.dataset.targetId === 'slotCorridor');
  click(branchToCorridor);
  check('la transition "Secret Lever" démarre', await waitUntil(() => seqCurrentEl.textContent === 'SecretLever', 500));
  check('texte FR de la transition affiché', trackDescEl.textContent.trim() === 'Texte FR Secret Lever');

  check('Corridor démarre après la transition', await waitUntil(() => seqCurrentEl.textContent === 'Cor1', 2000));
  check('texte FR de Corridor affiché', trackDescEl.textContent.trim() === 'Texte FR Corridor');

  const branchToBattle = [...row.querySelectorAll('.seq-branch-btn')].find(b => b.dataset.targetId === 'slotBattle');
  click(branchToBattle);
  check('Battle démarre (bascule directe, pas de transition déclarée)', await waitUntil(() => seqCurrentEl.textContent === 'Bat1', 1500));
  check('Battle sans texte propre : le texte de Corridor reste affiché (pas écrasé par du vide)', trackDescEl.textContent.trim() === 'Texte FR Corridor');

  // ---- Résolution EN (repli sur FR géré ailleurs, ici on vérifie juste que la langue choisie s'applique) ----
  {
    const track2 = {
      id: 'sbt-desc-en', title: 'Texte EN', mode: 'sequential', description: 'Base desc', duration: 0,
      base: '', publishedAt: 1, bpm: 300, beatsPerBar: 1,
      segmentSlots: [
        { id: 'slotEnA', label: 'A', avoidImmediateRepeat: false, repeatCount: 1, descriptionFr: 'Texte FR A', descriptionEn: 'EN text A',
          alternatives: [{ label: 'A1', bars: 4, localFile: fakeFile('a1.wav') }] }
      ],
      sfxIds: []
    };
    window.LayerPlayerCore.setLang('en');
    const row2 = Core.buildTrackRow(track2, null, false);
    doc.getElementById('host').appendChild(row2);
    Core.initTrackPlayer(track2, row2);
    await new Promise(resolve => setTimeout(resolve, 300));
    const seqCurrentEl2 = row2.querySelector('[data-role="seqCurrent"]');
    const trackDescEl2 = row2.querySelector('[data-role="trackDesc"]');
    click(row2.querySelector('[data-role="playBtn"]'));
    check('(EN) segment A démarre', await waitUntil(() => seqCurrentEl2.textContent === 'A1', 2000));
    check('(EN) texte anglais affiché quand la langue courante est "en"', trackDescEl2.textContent.trim() === 'EN text A');
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
