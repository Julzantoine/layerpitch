// Teste le timing des transitions d'embranchement-vertical (29/08, réécrit après un bug réel signalé par
// Jules-Antoine : silence pendant la transition + boucles superposées). Architecture retenue : la
// transition joue EN OVERLAY par-dessus la voix actuellement audible (qui continue normalement, jamais de
// silence), et la bascule RÉELLE (embrActiveLoopIdx + gains + UI) n'a lieu qu'une fois la transition
// terminée -- réalisée via un vrai délai JS (setTimeout), pas un décalage encodé dans l'automation Web
// Audio (une tentative précédente avait fait ce choix ; le planificateur périodique de générations
// l'ignorait complètement et cassait tout). Donc : mesure du timing en temps réel écoulé (comme
// test_seq_transitions.js), pas en inspectant les paramètres passés aux appels Web Audio.
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

  let decodedDurationOverride = 10; // durée (secondes fictives) renvoyée par decodeAudioData -- ajustée par scénario D

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

  // ---- Scénario A : bascule "paire" avec transition de 2 mesures (0.4s) ----
  {
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
    const btnRef = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'ref');
    const btnPeer = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'peer');

    const clickTime = Date.now();
    click(btnPeer);
    await sleep(100); // bien avant les 0.4s de transition
    check('la référence reste active PENDANT la transition (aucun silence : elle continue de jouer normalement)',
      btnRef.classList.contains('active') && !btnPeer.classList.contains('active'));

    check('la bascule réelle vers la boucle cible n\'a lieu qu\'une fois la transition terminée (~0.4s), pas avant',
      await waitUntil(() => btnPeer.classList.contains('active'), 800));
    const switchDelayMs = Date.now() - clickTime;
    check('délai mesuré cohérent avec la durée de la transition (~0.4s, pas immédiat, pas beaucoup plus) (delai=' + switchDelayMs + 'ms)',
      switchDelayMs > 300 && switchDelayMs < 650);
  }

  // ---- Scénario B : détour (boucle plus courte) avec transition de 1 mesure (0.2s) ----
  {
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
    const btnRef = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'ref');
    const btnShort = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'short');

    click(btnShort);
    await sleep(30);
    check('le bouton du détour est désactivé tout de suite (pas de retrigger pendant l\'attente de la transition)', btnShort.disabled === true);
    await sleep(80); // toujours bien avant les 0.2s de transition
    check('la référence reste active/audible pendant que la transition du détour joue (pas de silence, pas de coupure prématurée)',
      btnRef.classList.contains('active'));

    // Le détour dure ensuite blockSeconds(1 mesure) = 0.2s après son démarrage réel (une fois la
    // transition terminée) ; on attend large pour couvrir transition + détour + marge de la rampe de retour.
    check('le détour finit par se terminer et la référence redevient active (transition puis détour puis retour, sans rien perdre)',
      await waitUntil(() => !btnShort.disabled && btnRef.classList.contains('active'), 2000));
  }

  // ---- Scénario C : durée de transition exprimée en "temps" (3 temps à 240 BPM/4 temps par mesure = 0.75s) ----
  {
    const track = {
      id: 'evt-c', title: 'Peer switch, beats duration', mode: 'embranchement-vertical', description: '',
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
    const btnPeer = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'peer');

    const clickTime = Date.now();
    click(btnPeer);
    check('durée "temps" (3 temps à 240 BPM/4 temps par mesure = 0.75s) respectée avant la bascule réelle',
      await waitUntil(() => btnPeer.classList.contains('active'), 1200));
    const switchDelayMs = Date.now() - clickTime;
    check('délai mesuré cohérent avec 0.75s, pas avec les mesures/le tempo du morceau (delai=' + switchDelayMs + 'ms)',
      switchDelayMs > 600 && switchDelayMs < 950);
  }

  // ---- Scénario D : aucune durée réglée -> repli sur la durée réelle du fichier de transition décodé ----
  {
    decodedDurationOverride = 0.9; // fichier de transition "long" pour ce scénario précis, mais raisonnable pour un test
    const track = {
      id: 'evt-d', title: 'Transition without explicit duration', mode: 'embranchement-vertical', description: '',
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
    const btnPeer = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'peer');

    const clickTime = Date.now();
    click(btnPeer);
    check('sans durationUnit réglé, la bascule attend la durée réelle du fichier décodé (~0.9s)',
      await waitUntil(() => btnPeer.classList.contains('active'), 1300));
    const switchDelayMs = Date.now() - clickTime;
    check('délai mesuré cohérent avec ~0.9s, pas 0s ni un repli par mesures (delai=' + switchDelayMs + 'ms)',
      switchDelayMs > 750 && switchDelayMs < 1100);
  }

  // ---- Scénario E : non-régression -- un nouveau clic PENDANT une transition en attente annule et
  // remplace la bascule en cours, plutôt que de laisser les deux s'exécuter l'une après l'autre (ce qui
  // aurait pu recréer un chevauchement). ----
  {
    const track = {
      id: 'evt-e', title: 'Interrupt pending transition switch', mode: 'embranchement-vertical', description: '',
      duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
      loops: [
        { id: 'ref', label: 'Reference', bars: 4, isInitial: true, localFile: fakeFile('ref.wav') },
        {
          id: 'peerA', label: 'PeerA', bars: 4, localFile: fakeFile('peerA.wav'),
          transition: { label: 'Whoosh', durationUnit: 'bars', bars: 4, localFile: fakeFile('whooshA.wav') } // 0.8s, largement plus que le temps qu'on va laisser avant d'interrompre
        },
        { id: 'peerB', label: 'PeerB', bars: 4, localFile: fakeFile('peerB.wav') } // pas de transition -> bascule immédiate
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    click(row.querySelector('[data-role="playBtn"]'));
    await sleep(100);
    const btnRef = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'ref');
    const btnA = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'peerA');
    const btnB = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'peerB');

    click(btnA); // déclenche la transition de 0.8s, bascule en attente
    await sleep(100); // bien avant les 0.8s
    click(btnB); // interrompt -- B n'a pas de transition, bascule immédiate attendue
    check('le second clic (sans transition) prend effet rapidement, sans attendre la transition du premier',
      await waitUntil(() => btnB.classList.contains('active'), 300));
    await sleep(900); // largement de quoi couvrir les 0.8s de la transition interrompue, si elle s'exécutait quand même
    check('la bascule interrompue ne s\'exécute jamais après coup (toujours sur B, pas revenu sur A)',
      btnB.classList.contains('active') && !btnA.classList.contains('active') && !btnRef.classList.contains('active'));
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
