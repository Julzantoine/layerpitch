const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Chantier Adaptive OST (Figer/playlists fan) — vérifie que getTrackSettings()/applyTrackSettings()
// capturent et restaurent bien l'état de mix d'une piste (intensité, mute/solo, volume par voix),
// y compris sur UNE AUTRE instance de piste que celle où l'état a été capturé (le cas réel : charger
// une playlist figée applique un état sauvegardé à un rendu tout neuf, jamais à celui qui l'a produit).

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

  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  function makeVerticalTrack(id) {
    return {
      id, title: 'Vertical test', mode: 'vertical', description: '', duration: 0, base: '', publishedAt: 1,
      layers: [{ label: 'L1', localFile: fakeFile('l1.wav') }, { label: 'L2', localFile: fakeFile('l2.wav') }], sfxIds: []
    };
  }

  // ---- source: on règle une piste (intensité, mute d'une voix, volume d'une autre), puis on capture ----
  const sourceTrack = makeVerticalTrack('v-src');
  const sourceRow = Core.buildTrackRow(sourceTrack, null, false);
  doc.getElementById('host').appendChild(sourceRow);
  Core.initTrackPlayer(sourceTrack, sourceRow);
  await sleep(200);

  const chip = sourceRow.querySelector('.intensity-chip[data-level="1"]');
  if (chip) click(chip);

  const muteBtn = sourceRow.querySelector('[data-voice-action="mute"][data-voice-key="layer-0"]');
  if (muteBtn) click(muteBtn);

  const slider = sourceRow.querySelector('.voice-volume-slider[data-voice-key="layer-1"]');
  if (slider) { slider.value = '0.5'; slider.dispatchEvent(new window.Event('input', { bubbles: true })); }

  await sleep(50);
  const captured = Core.getTrackSettings('v-src');
  check('getTrackSettings: renvoie un objet pour une piste initialisée', !!captured);
  check('getTrackSettings: renvoie null pour une piste inconnue', Core.getTrackSettings('nope') === null);
  check('getTrackSettings: capture le niveau d\'intensité réglé', captured && captured.level === 1);
  check('getTrackSettings: capture la voix muette', captured && captured.mutedVoices.includes('layer-0'));
  check('getTrackSettings: capture le volume de voix réglé', captured && captured.layerVolumes['layer-1'] === 0.5);

  // ---- cible: nouvelle instance de la MÊME piste (cas réel : charger une playlist plus tard), état par défaut ----
  const targetTrack = makeVerticalTrack('v-target');
  const targetRow = Core.buildTrackRow(targetTrack, null, false);
  doc.getElementById('host').appendChild(targetRow);
  Core.initTrackPlayer(targetTrack, targetRow);
  await sleep(200);

  const beforeApply = Core.getTrackSettings('v-target');
  check('avant applyTrackSettings: état par défaut (niveau 0, rien de muet)', beforeApply.level === 0 && beforeApply.mutedVoices.length === 0);

  Core.applyTrackSettings('v-target', captured);
  await sleep(50);
  const afterApply = Core.getTrackSettings('v-target');
  check('applyTrackSettings: restaure le niveau d\'intensité', afterApply.level === 1);
  check('applyTrackSettings: restaure la voix muette', afterApply.mutedVoices.includes('layer-0'));
  check('applyTrackSettings: restaure le volume de voix', afterApply.layerVolumes['layer-1'] === 0.5);

  const targetChip = targetRow.querySelector('.intensity-chip[data-level="1"]');
  check('applyTrackSettings: le DOM reflète le chip d\'intensité actif', targetChip && targetChip.classList.contains('active'));
  const targetMuteBtn = targetRow.querySelector('[data-voice-action="mute"][data-voice-key="layer-0"]');
  check('applyTrackSettings: le DOM reflète le bouton mute actif', targetMuteBtn && targetMuteBtn.classList.contains('active'));
  const targetSlider = targetRow.querySelector('.voice-volume-slider[data-voice-key="layer-1"]');
  check('applyTrackSettings: le DOM reflète le slider de volume restauré', targetSlider && parseFloat(targetSlider.value) === 0.5);

  // ---- séquentiel/vertical-random : maxChainLoops (nombre de cycles de la chaîne avant transition
  // automatique, cf. player.js chainLoopCountSelect) capturé/restauré comme les autres réglages ----
  function makeSequentialTrack(id, maxChainLoops) {
    return {
      id, title: 'Sequential test', mode: 'sequential', description: '', duration: 0, base: '', publishedAt: 1,
      bpm: 150, beatsPerBar: 1, maxChainLoops,
      intro: { label: 'Intro', bars: 1, localFile: fakeFile('intro.wav') },
      outro: { label: 'Outro', localFile: fakeFile('outro.wav') },
      segmentSlots: [
        { id: 'slotA', label: 'A', avoidImmediateRepeat: true, repeatCount: 1, alternatives: [{ label: 'A1', bars: 1, localFile: fakeFile('a1.wav') }] }
      ],
      sfxIds: []
    };
  }
  const seqSourceTrack = makeSequentialTrack('seq-src', 3);
  const seqSourceRow = Core.buildTrackRow(seqSourceTrack, null, false);
  doc.getElementById('host').appendChild(seqSourceRow);
  Core.initTrackPlayer(seqSourceTrack, seqSourceRow);
  await sleep(150);
  const seqCaptured = Core.getTrackSettings('seq-src');
  check('getTrackSettings (séquentiel): capture maxChainLoops', seqCaptured && seqCaptured.maxChainLoops === 3);

  const seqTargetTrack = makeSequentialTrack('seq-target', null);
  const seqTargetRow = Core.buildTrackRow(seqTargetTrack, null, false);
  doc.getElementById('host').appendChild(seqTargetRow);
  Core.initTrackPlayer(seqTargetTrack, seqTargetRow);
  await sleep(150);
  check('avant applyTrackSettings (séquentiel): maxChainLoops par défaut (null)', Core.getTrackSettings('seq-target').maxChainLoops === null);
  Core.applyTrackSettings('seq-target', seqCaptured);
  await sleep(50);
  check('applyTrackSettings (séquentiel): restaure maxChainLoops sur track.maxChainLoops', Core.getTrackSettings('seq-target').maxChainLoops === 3);
  const seqSelect = seqTargetRow.querySelector('[data-role="chainLoopCountSelect"]');
  check('applyTrackSettings (séquentiel): le DOM reflète la valeur restaurée', seqSelect && seqSelect.value === '3');

  // ---- vertical-random : sectionMaxLoops (nombre de boucles par section, cf. player.js
  // vrSectionLoopSelectEls/resolveVRSection) capturé/restauré comme les autres réglages ----
  function makeVRTrack(id, sectionMaxLoops) {
    return {
      id, title: 'VR test', mode: 'vertical-random', description: '', duration: 0, base: '', publishedAt: 1,
      randomizeSections: false,
      sections: [
        { id: 'secA', label: 'A', bpm: 150, beatsPerBar: 1, loopInBeat: 0, loopOutBeat: 1, maxLoops: sectionMaxLoops[0],
          pools: [{ id: 'poolA', label: 'A', alternatives: [{ label: 'A1', localFile: fakeFile('a1.wav') }] }] },
        { id: 'secB', label: 'B', bpm: 150, beatsPerBar: 1, loopInBeat: 0, loopOutBeat: 1, maxLoops: sectionMaxLoops[1],
          pools: [{ id: 'poolB', label: 'B', alternatives: [{ label: 'B1', localFile: fakeFile('b1.wav') }] }] },
      ],
      sfxIds: []
    };
  }
  const vrSourceTrack = makeVRTrack('vr-src', [2, null]);
  const vrSourceRow = Core.buildTrackRow(vrSourceTrack, null, false);
  doc.getElementById('host').appendChild(vrSourceRow);
  Core.initTrackPlayer(vrSourceTrack, vrSourceRow);
  await sleep(150);
  const vrCaptured = Core.getTrackSettings('vr-src');
  check('getTrackSettings (vertical-random): capture le nombre de boucles par section (avant toute lecture)', vrCaptured && JSON.stringify(vrCaptured.sectionMaxLoops) === JSON.stringify([2, null]));

  const vrTargetTrack = makeVRTrack('vr-target', [null, null]);
  const vrTargetRow = Core.buildTrackRow(vrTargetTrack, null, false);
  doc.getElementById('host').appendChild(vrTargetRow);
  Core.initTrackPlayer(vrTargetTrack, vrTargetRow);
  await sleep(150);
  check('avant applyTrackSettings (vertical-random): boucles par section par défaut', JSON.stringify(Core.getTrackSettings('vr-target').sectionMaxLoops) === JSON.stringify([null, null]));
  Core.applyTrackSettings('vr-target', vrCaptured);
  await sleep(50);
  check('applyTrackSettings (vertical-random): restaure le nombre de boucles par section', JSON.stringify(Core.getTrackSettings('vr-target').sectionMaxLoops) === JSON.stringify([2, null]));
  const vrSelect0 = vrTargetRow.querySelector('[data-role="vrSectionLoop-0"]');
  check('applyTrackSettings (vertical-random): le DOM de la section 0 reflète la valeur restaurée', vrSelect0 && vrSelect0.value === '2');
  const vrSelect1 = vrTargetRow.querySelector('[data-role="vrSectionLoop-1"]');
  check('applyTrackSettings (vertical-random): le DOM de la section 1 reflète "infini" (null)', vrSelect1 && vrSelect1.value === '');

  // ---- applyTrackSettings sur une piste inconnue ou avec un settings vide : ne doit pas planter ----
  try {
    Core.applyTrackSettings('nope', captured);
    Core.applyTrackSettings('v-target', null);
    check('applyTrackSettings: ne plante pas sur piste inconnue / settings vide', true);
  } catch (e) {
    check('applyTrackSettings: ne plante pas sur piste inconnue / settings vide', false);
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
