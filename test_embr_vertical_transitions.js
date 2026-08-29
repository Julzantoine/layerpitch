// Teste deux ajouts du 29/08 au moteur embranchement-vertical (retour visuel de Jules-Antoine) :
// 1) Le fichier de transition d'une boucle ne doit plus sonner EN MÊME TEMPS que la montée de la boucle
//    cible (bug signalé) -- la montée doit être programmée après la durée nominale de la transition,
//    pendant que le fondu de sortie de la boucle quittée démarre lui immédiatement (même principe que
//    performSeqBranchCut() côté séquentiel). Couvre les deux cas : bascule "paire" (rampe de gain) et
//    "détour" (nouveau buffer déclenché).
// 2) Les boutons de boucle sont verrouillés pendant le segment Départ→Entrée de la référence (s'il est
//    réglé) au tout premier lancement.
// Instrumente createGain()/createBufferSource() pour capturer le délai réel de chaque appel programmé par
// rapport à ctx.currentTime, même patron que test_seq_custom_cut_fade.js (horloge fictive temps réel).
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

  const rampCalls = []; // { target, deltaSec } pour chaque linearRampToValueAtTime/setValueAtTime sur un gain
  const startCalls = []; // { deltaSec } pour chaque bufferSource.start()
  let decodedDurationOverride = 10; // durée (secondes fictives) renvoyée par decodeAudioData -- ajustée par scénario C

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
            value: 0,
            setValueAtTime(target, when) { this.value = target; rampCalls.push({ kind: 'set', target, deltaSec: when - ctxRef.currentTime }); },
            cancelScheduledValues() {},
            linearRampToValueAtTime(target, when) { rampCalls.push({ kind: 'ramp', target, deltaSec: when - ctxRef.currentTime }); }
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
            startCalls.push({ deltaSec: when - ctxRef.currentTime });
            const dur = (node.buffer && node.buffer.duration) || 1;
            const delaySec = Math.max(0, (when - ctxRef.currentTime) + dur);
            node._endTimer = setTimeout(() => { if (!node._ended) { node._ended = true; if (node.onended) node.onended(); } }, delaySec * 1000);
          }
        };
        return node;
      };
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: decodedDurationOverride }); };
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

  const bpm = 300, beatsPerBar = 1; // secondsPerBeat=0.2s -- rapide pour un test, assez lent pour observer les états intermédiaires

  // ---- Scénario A : bascule "paire" (rampe de gain) avec transition de 2 mesures (0.4s) ----
  {
    rampCalls.length = 0;
    const track = {
      id: 'evt-a', title: 'Peer switch with transition', mode: 'embranchement-vertical', description: '',
      duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
      loops: [
        { id: 'ref', label: 'Reference', bars: 4, isInitial: true, localFile: fakeFile('ref.wav') },
        {
          id: 'peer', label: 'Peer', bars: 4, localFile: fakeFile('peer.wav'),
          transition: { label: 'Whoosh', durationUnit: 'bars', bars: 2, localFile: fakeFile('whoosh.wav') }
        }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    click(row.querySelector('[data-role="playBtn"]'));
    await sleep(100);
    rampCalls.length = 0; // ignore le calage initial de la référence au lancement -- seuls les appels déclenchés par le clic ci-dessous nous intéressent
    const btnPeer = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'peer');
    click(btnPeer);
    await sleep(50); // laisse le temps aux appels d'être programmés, sans attendre la fin de la transition (0.4s)
    const upRamp = rampCalls.find(c => c.kind === 'ramp' && c.target === 1);
    const downRamps = rampCalls.filter(c => c.kind === 'ramp' && c.target === 0);
    check('une montée vers la boucle cible a bien été programmée', !!upRamp);
    // delta = fin de la rampe (linearRampToValueAtTime capture l'instant D'ARRIVÉE, pas de départ) : la
    // transition (0.4s) + le fondu standard (0.15s) une fois la montée enfin déclenchée -- ~0.55s.
    check('la montée est différée d\'environ 0.55s (0.4s de transition + 0.15s de fondu), pas immédiate (delta=' + (upRamp && upRamp.deltaSec) + ')',
      upRamp && upRamp.deltaSec > 0.45 && upRamp.deltaSec < 0.7);
    // Le fondu de sortie de la référence démarre lui immédiatement (0.15s fixe, sans attendre la transition).
    check('le fondu de sortie de la référence démarre immédiatement, sans attendre la transition (delta=' + (downRamps[0] && downRamps[0].deltaSec) + ')',
      downRamps.length > 0 && downRamps.every(c => c.deltaSec < 0.3));
  }

  // ---- Scénario B : détour (boucle plus courte) avec transition de 1 mesure (0.2s) ----
  {
    startCalls.length = 0;
    const track = {
      id: 'evt-b', title: 'Detour with transition', mode: 'embranchement-vertical', description: '',
      duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
      loops: [
        { id: 'ref', label: 'Reference', bars: 4, isInitial: true, localFile: fakeFile('ref.wav') },
        {
          id: 'short', label: 'Short', bars: 1, isDetour: true, localFile: fakeFile('short.wav'),
          transition: { label: 'Impact', durationUnit: 'bars', bars: 1, localFile: fakeFile('impact.wav') }
        }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    click(row.querySelector('[data-role="playBtn"]'));
    await sleep(100);
    const startCallsBefore = startCalls.length;
    const btnShort = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'short');
    click(btnShort);
    await sleep(30);
    // Un seul nouveau bufferSource démarré pour ce clic : celui du détour lui-même (la transition ne passe
    // pas par createBufferSource dans ce fake -- voir playEmbrTransitionIfAny, même mécanisme cependant).
    const newStart = startCalls[startCalls.length - 1];
    check('le détour a bien démarré une nouvelle source', startCalls.length > startCallsBefore);
    check('son démarrage est différé d\'environ 0.2s (durée de la transition), pas immédiat (delta=' + (newStart && newStart.deltaSec) + ')',
      newStart && newStart.deltaSec > 0.1 && newStart.deltaSec < 0.35);
  }

  // ---- Scénario B2 : durée de transition exprimée en "temps" (29/08, cohérence avec le séquentiel) --
  // 3 temps à 240 BPM/4 temps par mesure (tempo propre à la transition) = 0.75s.
  {
    rampCalls.length = 0;
    const track = {
      id: 'evt-b2', title: 'Peer switch, beats duration', mode: 'embranchement-vertical', description: '',
      duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
      loops: [
        { id: 'ref', label: 'Reference', bars: 4, isInitial: true, localFile: fakeFile('ref.wav') },
        {
          id: 'peer', label: 'Peer', bars: 4, localFile: fakeFile('peer.wav'),
          transition: { label: 'Whoosh', durationUnit: 'beats', durationBeats: 3, bpm: 240, beatsPerBar: 4, localFile: fakeFile('whoosh.wav') }
        }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    click(row.querySelector('[data-role="playBtn"]'));
    await sleep(100);
    rampCalls.length = 0; // ignore le calage initial de la référence au lancement
    const btnPeer = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'peer');
    click(btnPeer);
    await sleep(50);
    const upRamp = rampCalls.find(c => c.kind === 'ramp' && c.target === 1);
    // delta = fin de la rampe = transition (0.75s) + fondu standard (0.15s) = ~0.9s.
    check('durée "temps" (3 temps à 240 BPM/4 temps par mesure = 0.75s) appliquée, pas les mesures/le tempo du morceau (delta=' + (upRamp && upRamp.deltaSec) + ')',
      upRamp && upRamp.deltaSec > 0.75 && upRamp.deltaSec < 1.05);
  }

  // ---- Scénario C : aucune durée réglée -> repli sur la durée réelle du fichier de transition décodé ----
  {
    rampCalls.length = 0;
    decodedDurationOverride = 1.2; // fichier de transition "long" pour ce scénario précis
    const track = {
      id: 'evt-c', title: 'Transition without explicit duration', mode: 'embranchement-vertical', description: '',
      duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
      loops: [
        { id: 'ref', label: 'Reference', bars: 4, isInitial: true, localFile: fakeFile('ref.wav') },
        { id: 'peer', label: 'Peer', bars: 4, localFile: fakeFile('peer.wav'), transition: { label: 'Whoosh', localFile: fakeFile('whoosh.wav') } } // pas de durationUnit
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    click(row.querySelector('[data-role="playBtn"]'));
    await sleep(100);
    rampCalls.length = 0; // ignore le calage initial de la référence au lancement
    const btnPeer = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'peer');
    click(btnPeer);
    await sleep(50);
    const upRamp = rampCalls.find(c => c.kind === 'ramp' && c.target === 1);
    check('sans durationUnit réglé, la montée est différée de la durée réelle du fichier décodé + le fondu standard (~1.35s), pas de 0s ni d\'un repli par mesures (delta=' + (upRamp && upRamp.deltaSec) + ')',
      upRamp && upRamp.deltaSec > 1.1 && upRamp.deltaSec < 1.6);
    decodedDurationOverride = 10; // restauré pour les scénarios suivants
  }

  // ---- Scénario D : verrouillage des boutons pendant le segment Départ→Entrée de la référence ----
  {
    const track = {
      id: 'evt-d', title: 'Intro lock', mode: 'embranchement-vertical', description: '',
      duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
      loops: [
        { id: 'ref', label: 'Reference', bars: 4, isInitial: true, duration: 2, startTrackBeat: 0, loopInBeat: 2, localFile: fakeFile('ref.wav') }, // Départ 0 -> Entrée 0.4s (2 temps à 0.2s)
        { id: 'peer', label: 'Peer', bars: 4, localFile: fakeFile('peer.wav') }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    const btns = [...row.querySelectorAll('.embr-loop-btn')];
    click(row.querySelector('[data-role="playBtn"]'));
    await sleep(100); // dans la fenêtre Départ->Entrée (~0.4s)
    check('les boutons de boucle sont désactivés pendant le segment Départ→Entrée', btns.every(b => b.disabled === true));
    check('les boutons se réactivent une fois "Entrée" atteint',
      await waitUntil(() => btns.every(b => b.disabled === false), 1500));
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
