// Teste la couche d'affichage "forme d'onde" du mode embranchement-vertical (02/09) : les trois états
// visuels (boucle stable en progression continue verrouillée en phase, bascule avec transition en
// surimpression, détour avec sa propre ligne) et la dégradation au-delà de 4/7 boucles paires. Ne teste
// PAS le moteur audio lui-même (gains, timing des bascules) -- déjà couvert par
// test_embr_vertical_engine.js/test_embr_vertical_transitions.js, rejoués sans régression à côté de ce
// fichier. Même infrastructure jsdom que ces deux fichiers (FakeAudioContext basée sur le temps réel
// écoulé, pas de tick manuel). jsdom ne fournit ni layout réel ni contexte canvas 2D -- renderWaveformPair()
// retourne tôt (getBoundingClientRect().width < 2), donc aucune assertion sur le contenu des canvases ;
// seules les classes/attributs/styles inline (clipPath, animationDuration, animationPlayState) sont
// vérifiables ici, exactement comme le fait déjà seq-transitions pour son propre mécanisme clip-path.
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
          buffer: null, onended: null, loop: false, loopStart: 0, loopEnd: 0, connect() {},
          stop() { if (node._endTimer) clearTimeout(node._endTimer); if (!node._ended) { node._ended = true; if (node.onended) node.onended(); } },
          start(when) {
            if (node.loop) return; // boucle "en attente d'un bouton" -- ne se termine jamais toute seule, comme un vrai src.loop=true
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

  const bpm = 300, beatsPerBar = 1; // secondsPerBeat=0.2s -- rapide pour un test, assez lent pour observer les états intermédiaires

  // ---- Scénario 1 : rendu riche pour 3 boucles paires + un détour, progression continue après lecture ----
  {
    const track = {
      id: 'ewf-1', title: 'Rich waveform, 3 peers + 1 detour', mode: 'embranchement-vertical', description: '',
      duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
      loops: [
        { id: 'ref', label: 'Reference', bars: 4, isInitial: true, localFile: fakeFile('ref.wav') },
        { id: 'peerA', label: 'Peer A', bars: 4, localFile: fakeFile('peerA.wav') },
        { id: 'peerB', label: 'Peer B', bars: 4, localFile: fakeFile('peerB.wav') },
        { id: 'short', label: 'Short', bars: 1, isDetour: true, localFile: fakeFile('short.wav') }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    const richBtns = [...row.querySelectorAll('.embr-wave-btn')];
    check('les 3 boucles paires (dont la référence) reçoivent le gabarit riche', richBtns.length === 3);
    const shortBtn = [...row.querySelectorAll('.embr-loop-btn')].find(b => b.dataset.loopId === 'short');
    check('la boucle détour garde le gabarit texte simple (pas de .embr-wave-btn)', shortBtn && !shortBtn.classList.contains('embr-wave-btn'));
    check('chaque ligne riche a bien ses deux canvases + son libellé', richBtns.every(b => b.querySelector('.embr-wave-bg') && b.querySelector('.embr-wave-fg') && b.querySelector('.embr-wave-label')));
    check('picker en hauteur pleine (2-4 boucles paires) : --embr-row-h vaut 34px', row.querySelector('[data-role="embrLoopPicker"]').style.getPropertyValue('--embr-row-h') === '34px');

    Core.initTrackPlayer(track, row);
    await sleep(300);
    click(row.querySelector('[data-role="playBtn"]'));
    await sleep(100);
    const btnRef = richBtns.find(b => b.dataset.loopId === 'ref');
    const btnPeerA = richBtns.find(b => b.dataset.loopId === 'peerA');
    check('après lecture, la ligne active a une animation en cours (running)', btnRef.querySelector('.embr-wave-fg').style.animationPlayState === 'running');
    check('la ligne active a une durée d\'animation cohérente avec le cycle (4 mesures à 300bpm/1 temps = 0.8s)', btnRef.querySelector('.embr-wave-fg').style.animationDuration === '0.8s');
    check('une ligne riche non active tourne AUSSI (jamais figée), et reste visible (jamais masquée)', btnPeerA.querySelector('.embr-wave-fg').style.animationPlayState === 'running' && btnPeerA.style.display !== 'none');

    click(row.querySelector('[data-role="playBtn"]')); // Stop (toggle)
    await sleep(50);
    check('après Stop, les lignes riches repassent en pause (rien ne joue dans le vide)', btnRef.querySelector('.embr-wave-fg').style.animationPlayState === 'paused' && btnPeerA.querySelector('.embr-wave-fg').style.animationPlayState === 'paused');
  }

  // ---- Scénario 2 : bascule "paire" avec transition -- overlay visible pendant, filigrane sur les 2 lignes concernées ----
  {
    const track = {
      id: 'ewf-2', title: 'Peer switch with transition overlay', mode: 'embranchement-vertical', description: '',
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
    const picker = row.querySelector('[data-role="embrLoopPicker"]');
    const btnRef = [...row.querySelectorAll('.embr-wave-btn')].find(b => b.dataset.loopId === 'ref');
    const btnPeer = [...row.querySelectorAll('.embr-wave-btn')].find(b => b.dataset.loopId === 'peer');

    click(btnPeer);
    await sleep(100); // bien avant les 0.4s (2 mesures) de transition
    const overlay = picker.querySelector('.embr-transition-row');
    check('la ligne de transition apparaît pendant la bascule', !!overlay);
    check('sa progression est un clip-path one-shot avec la bonne durée (~0.4s)', overlay && /0\.4s/.test(overlay.querySelector('.embr-wave-fg').style.transition));
    check('les 2 lignes concernées (source ET cible) passent en filigrane', btnRef.classList.contains('embr-transition-dim') && btnPeer.classList.contains('embr-transition-dim'));
    check('aucune des deux ne voit son animation continue interrompue pendant la transition', btnRef.querySelector('.embr-wave-fg').style.animationPlayState === 'running' && btnPeer.querySelector('.embr-wave-fg').style.animationPlayState === 'running');

    check('la bascule réelle attend la fin de la transition', await waitUntil(() => btnPeer.classList.contains('active'), 800));
    check('la ligne de transition disparaît une fois la bascule effectuée', !picker.querySelector('.embr-transition-row'));
    check('le filigrane est retiré une fois la bascule effectuée', !btnRef.classList.contains('embr-transition-dim') && !btnPeer.classList.contains('embr-transition-dim'));
  }

  // ---- Scénario 3 : détour minuté -- ligne one-shot, terminaison naturelle ET interruption précoce ----
  {
    const track = {
      id: 'ewf-3', title: 'Timed detour wave row', mode: 'embranchement-vertical', description: '',
      duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
      loops: [
        { id: 'ref', label: 'Reference', bars: 4, isInitial: true, localFile: fakeFile('ref.wav') },
        { id: 'peer', label: 'Peer', bars: 4, localFile: fakeFile('peer.wav') },
        { id: 'short', label: 'Short', bars: 1, isDetour: true, localFile: fakeFile('short.wav') }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    click(row.querySelector('[data-role="playBtn"]'));
    await sleep(100);
    const picker = row.querySelector('[data-role="embrLoopPicker"]');
    const btnShort = row.querySelectorAll('.embr-loop-btn')[2];

    click(btnShort);
    await sleep(30);
    let detourRow = picker.querySelector('.embr-detour-wave-row');
    check('la ligne de détour apparaît au clic', !!detourRow);
    // Détour d'1 mesure à 300bpm/1 temps par mesure = blockSeconds(1) = 0.2s.
    check('sa progression est un clip-path one-shot avec la durée nominale (~0.2s)', detourRow && /0\.2s/.test(detourRow.querySelector('.embr-wave-fg').style.transition));

    check('la ligne disparaît une fois le détour naturellement terminé', await waitUntil(() => !picker.querySelector('.embr-detour-wave-row'), 1000));

    // Interruption précoce : reclique le détour puis choisit la boucle paire avant la fin naturelle.
    click(btnShort);
    await sleep(30);
    check('la ligne réapparaît pour ce nouveau détour', !!picker.querySelector('.embr-detour-wave-row'));
    click([...row.querySelectorAll('.embr-wave-btn')].find(b => b.dataset.loopId === 'peer'));
    await sleep(30);
    check('la ligne disparaît immédiatement en cas d\'interruption précoce (pas d\'attente de la durée nominale)', !picker.querySelector('.embr-detour-wave-row'));
  }

  // ---- Scénario 4 : détour "en boucle jusqu'à un bouton" -- animation infinie, pas de clip-path one-shot ----
  {
    const track = {
      id: 'ewf-4', title: 'Looping detour wave row', mode: 'embranchement-vertical', description: '',
      duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
      loops: [
        { id: 'ref', label: 'Reference', bars: 4, isInitial: true, localFile: fakeFile('ref.wav') },
        { id: 'short', label: 'Short', bars: 1, isDetour: true, detourMode: 'loop', localFile: fakeFile('short.wav') }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    click(row.querySelector('[data-role="playBtn"]'));
    await sleep(100);
    const picker = row.querySelector('[data-role="embrLoopPicker"]');
    const btnShort = row.querySelectorAll('.embr-loop-btn')[1];

    click(btnShort);
    await sleep(30);
    const detourRow = picker.querySelector('.embr-detour-wave-row');
    check('la ligne de détour "en boucle" apparaît au clic', !!detourRow);
    const fg = detourRow && detourRow.querySelector('.embr-wave-fg');
    // FakeAudioContext.decodeAudioData renvoie toujours { duration: 10 } -- durée fictive mais déterministe.
    check('sa progression est une animation infinie de durée = celle du buffer (10s), pas un clip-path one-shot',
      !!fg && fg.style.animationPlayState === 'running' && fg.style.animationDuration === '10s');
    check('le bouton "Mettre fin à la boucle" est présent pendant ce détour', !!row.querySelector('.embr-end-loop-btn'));

    click(row.querySelector('.embr-end-loop-btn'));
    await sleep(30);
    check('la ligne disparaît une fois "Mettre fin à la boucle" cliqué', !picker.querySelector('.embr-detour-wave-row'));
  }

  // ---- Scénario 5 : Stop pendant un détour -- couvre le chemin stopEmbrVertical() qui ne passe pas par fadeOutCurrentDetour() ----
  {
    const track = {
      id: 'ewf-5', title: 'Stop mid-detour', mode: 'embranchement-vertical', description: '',
      duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar,
      loops: [
        { id: 'ref', label: 'Reference', bars: 4, isInitial: true, localFile: fakeFile('ref.wav') },
        { id: 'short', label: 'Short', bars: 1, isDetour: true, localFile: fakeFile('short.wav') }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    click(row.querySelector('[data-role="playBtn"]'));
    await sleep(100);
    const picker = row.querySelector('[data-role="embrLoopPicker"]');
    click(row.querySelectorAll('.embr-loop-btn')[1]);
    await sleep(30);
    check('la ligne de détour est bien affichée avant le Stop', !!picker.querySelector('.embr-detour-wave-row'));
    click(row.querySelector('[data-role="playBtn"]')); // Stop
    await sleep(30);
    check('la ligne de détour est retirée par le Stop (chemin stopEmbrVertical, pas fadeOutCurrentDetour)', !picker.querySelector('.embr-detour-wave-row'));
  }

  // ---- Scénario 6 : dégradation au-delà de 4 puis 7 boucles paires (markup pur, pas besoin de lecture) ----
  function trackWithPeerCount(n) {
    const loops = [];
    for (let i = 0; i < n; i++) loops.push({ id: 'peer' + i, label: 'Peer ' + i, bars: 4, isInitial: i === 0, localFile: fakeFile('p' + i + '.wav') });
    return { id: 'ewf-deg-' + n, title: 'Degradation ' + n, mode: 'embranchement-vertical', description: '', duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar, loops, sfxIds: [] };
  }
  {
    const row5 = Core.buildTrackRow(trackWithPeerCount(5), null, false);
    const picker5 = row5.querySelector('[data-role="embrLoopPicker"]');
    check('5 boucles paires : toujours en gabarit riche', row5.querySelectorAll('.embr-wave-btn').length === 5);
    // height = 34 - (5-4)*(14/3) = 34 - 4.666... ≈ 29px (arrondi).
    check('5 boucles paires : hauteur interpolée vers le plancher (≈29px, pas 34px)', picker5.style.getPropertyValue('--embr-row-h') === '29px');

    const row8 = Core.buildTrackRow(trackWithPeerCount(8), null, false);
    const picker8 = row8.querySelector('[data-role="embrLoopPicker"]');
    check('8 boucles paires : repli sur le gabarit compact (aucun .embr-wave-btn)', row8.querySelectorAll('.embr-wave-btn').length === 0);
    check('8 boucles paires : bouton texte simple par boucle, comme aujourd\'hui', row8.querySelectorAll('.embr-loop-btn').length === 8);
    check('8 boucles paires : pas de --embr-row-h posé (gabarit compact, pas de variable de hauteur)', picker8.style.getPropertyValue('--embr-row-h') === '');
  }

  console.log(failures === 0 ? 'ALL CHECKS PASSED' : (failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
