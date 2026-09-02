// Teste la couche d'affichage ajoutée au mode séquentiel à embranchement (02/09) : l'aperçu enrichi des
// boutons d'embranchement (forme d'onde statique + badge de transition) et la carte globale des chemins
// (révélation progressive côté public, révélation complète côté Backstage via seqMapFullReveal, gestion
// des cycles, dégradation au-delà d'un certain nombre de nœuds). Ne teste PAS le moteur de bascule
// lui-même (déjà couvert par test_seq_branching.js/test_seq_transitions.js, rejoués sans régression à
// côté de ce fichier). Même infrastructure jsdom que ces deux fichiers.
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

  // ---- Scénario 1 : aperçu enrichi des boutons d'embranchement (forme d'onde + badge sélectif) ----
  {
    const track = {
      id: 'sm-1', title: 'Branch preview + badge', mode: 'sequential', description: '', duration: 0,
      base: '', publishedAt: 1, bpm, beatsPerBar,
      segmentSlots: [
        {
          id: 'slotA', label: 'A', repeatCount: 1,
          alternatives: [{ label: 'A1', bars: 2, localFile: fakeFile('a1.wav') }],
          nextOptions: [
            { targetId: 'slotB', label: 'To B', transition: { label: 'Whoosh', bars: 1, localFile: fakeFile('whoosh.wav') } },
            { targetId: 'slotC', label: 'To C' } // pas de transition déclarée pour cette paire précise
          ]
        },
        { id: 'slotB', label: 'B', repeatCount: 1, alternatives: [{ label: 'B1', bars: 1, localFile: fakeFile('b1.wav') }] },
        { id: 'slotC', label: 'C', repeatCount: 1, alternatives: [{ label: 'C1', bars: 1, localFile: fakeFile('c1.wav') }] }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    click(row.querySelector('[data-role="playBtn"]'));
    await waitUntil(() => row.querySelector('[data-role="seqCurrent"]').textContent === 'A1', 2000);

    const btnToB = () => [...row.querySelectorAll('.seq-branch-btn')].find(b => b.dataset.targetId === 'slotB');
    const btnToC = () => [...row.querySelectorAll('.seq-branch-btn')].find(b => b.dataset.targetId === 'slotC');
    // Forme d'onde retirée le 02/09 sur retour direct de Jules-Antoine en situation réelle (des boutons
    // d'embranchement, puis le 03/09 des nœuds de la carte globale aussi -- voir scénarios suivants,
    // en plus de ne pas être demandée, elle ne reflétait pas fidèlement le fichier réel) -- seul le badge
    // de transition subsiste sur ces boutons.
    check('aucun canvas de forme d\'onde sur le bouton vers B', !btnToB().querySelector('canvas'));
    check('aucun canvas de forme d\'onde sur le bouton vers C non plus', !btnToC().querySelector('canvas'));
    check('badge de transition présent UNIQUEMENT sur le bouton vers B (transition déclarée pour cette paire précise)', !!btnToB().querySelector('.seq-branch-transition-badge'));
    check('aucun badge sur le bouton vers C (aucune transition déclarée pour cette paire)', !btnToC().querySelector('.seq-branch-transition-badge'));
    check('le libellé reste lisible malgré le badge (le badge ne contribue aucun texte)', btnToB().textContent.trim() === 'To B');
  }

  // ---- Scénario 2 : révélation progressive côté public -- rien avant de jouer, puis courant + options immédiates seulement ----
  {
    const track = {
      id: 'sm-2', title: 'Progressive reveal', mode: 'sequential', description: '', duration: 0,
      base: '', publishedAt: 1, bpm, beatsPerBar,
      segmentSlots: [
        // bars:2 sur toute boucle qui EMBRANCHE (nextOptions non vide), pas 1 -- avec bars:1 la durée d'un
        // passage coïncide exactement avec l'unité de quantification, course connue et documentée dans
        // test_seq_branching.js entre l'avancement d'epoch et la vérification de frontière (retrouvée par
        // l'exécution : sans ce réglage, ce scénario prenait plus de 2s à basculer au lieu de ~0.2-0.4s).
        { id: 'slotA', label: 'A', repeatCount: 1, alternatives: [{ label: 'A1', bars: 2, localFile: fakeFile('a1.wav') }], nextOptions: [{ targetId: 'slotB', label: '' }] },
        { id: 'slotB', label: 'B', repeatCount: 1, alternatives: [{ label: 'B1', bars: 2, localFile: fakeFile('b1.wav') }], nextOptions: [{ targetId: 'slotC', label: '' }] },
        { id: 'slotC', label: 'C', repeatCount: 1, alternatives: [{ label: 'C1', bars: 1, localFile: fakeFile('c1.wav') }] }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    const nodesEl = row.querySelector('[data-role="seqMapNodes"]');
    check('rien sur la carte avant la première lecture (pas de seqMapFullReveal côté public)', nodesEl.children.length === 0);

    click(row.querySelector('[data-role="playBtn"]'));
    await waitUntil(() => row.querySelector('[data-role="seqCurrent"]').textContent === 'A1', 2000);
    check('seuls A (courant) et B (option immédiate) sont révélés -- pas C, à deux sauts', nodesEl.children.length === 2);
    check('le nœud A porte la classe "current"', !!nodesEl.querySelector('.seq-map-node[data-slot-idx="0"].current'));
    check('le nœud B est révélé mais ni "current" ni "visited" (jamais encore atteint)', !!nodesEl.querySelector('.seq-map-node[data-slot-idx="1"]:not(.current):not(.visited)'));

    const btnToB = () => [...row.querySelectorAll('.seq-branch-btn')].find(b => b.dataset.targetId === 'slotB');
    click(btnToB());
    await waitUntil(() => row.querySelector('[data-role="seqCurrent"]').textContent === 'B1', 2000);
    check('après la bascule vers B, C devient visible (nouvelle option immédiate) -- A reste visible aussi', nodesEl.children.length === 3);
    check('A (quitté) porte désormais la classe "visited", plus "current"', !!nodesEl.querySelector('.seq-map-node[data-slot-idx="0"].visited') && !nodesEl.querySelector('.seq-map-node[data-slot-idx="0"].current'));
    check('B est maintenant "current"', !!nodesEl.querySelector('.seq-map-node[data-slot-idx="1"].current'));
  }

  // ---- Scénario 3 : cycle -- un embranchement pointant vers un emplacement déjà visité ne duplique pas le nœud ----
  {
    const track = {
      id: 'sm-3', title: 'Cycle A<->B', mode: 'sequential', description: '', duration: 0,
      base: '', publishedAt: 1, bpm, beatsPerBar,
      segmentSlots: [
        // bars:2 sur les deux -- même raison que dans le scénario 2 ci-dessus (les deux embranchent ici).
        { id: 'slotA', label: 'A', repeatCount: 1, alternatives: [{ label: 'A1', bars: 2, localFile: fakeFile('a1.wav') }], nextOptions: [{ targetId: 'slotB', label: '' }] },
        { id: 'slotB', label: 'B', repeatCount: 1, alternatives: [{ label: 'B1', bars: 2, localFile: fakeFile('b1.wav') }], nextOptions: [{ targetId: 'slotA', label: 'Retour' }] }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300);
    const nodesEl = row.querySelector('[data-role="seqMapNodes"]');
    click(row.querySelector('[data-role="playBtn"]'));
    await waitUntil(() => row.querySelector('[data-role="seqCurrent"]').textContent === 'A1', 2000);
    click([...row.querySelectorAll('.seq-branch-btn')].find(b => b.dataset.targetId === 'slotB'));
    await waitUntil(() => row.querySelector('[data-role="seqCurrent"]').textContent === 'B1', 2000);
    check('2 nœuds après le premier aller A->B (pas plus)', nodesEl.children.length === 2);

    // B pointe vers A, déjà affiché -- ne doit pas apparaître deux fois.
    const btnBackToA = () => [...row.querySelectorAll('.seq-branch-btn')].find(b => b.dataset.targetId === 'slotA');
    check('le bouton de retour vers A (déjà visité) est bien proposé depuis B', !!btnBackToA());
    click(btnBackToA());
    await waitUntil(() => row.querySelector('[data-role="seqCurrent"]').textContent === 'A1' && [...row.querySelectorAll('.seq-map-node')].find(n => n.dataset.slotIdx === '0').classList.contains('current'), 2000);
    check('toujours 2 nœuds distincts après le retour sur A (aucun doublon créé par le cycle)', nodesEl.children.length === 2);
    check('A redevient "current" (pas un second nœud "A")', !!nodesEl.querySelector('.seq-map-node[data-slot-idx="0"].current'));
    check('B, quitté, porte maintenant "visited"', !!nodesEl.querySelector('.seq-map-node[data-slot-idx="1"].visited'));

    // Bug trouvé en situation réelle (03/09) : la première version (grille en flux) ne traçait pas
    // d'arête visible pour "#3 Battle -> #1 WetDarkCave" -- en fait si, mais superposée derrière les
    // nœuds intermédiaires (tous à la même position x dans une colonne unique). La disposition en
    // couches place A et B dans des colonnes DIFFÉRENTES (A avance vers B), donc l'arête de retour B->A
    // doit maintenant être tracée en boucle distincte plutôt qu'invisible.
    const nodeA = nodesEl.querySelector('[data-slot-idx="0"]'), nodeB = nodesEl.querySelector('[data-slot-idx="1"]');
    check('A et B occupent des colonnes différentes (A précède B dans le flux, style "left" distinct)', parseFloat(nodeA.style.left) !== parseFloat(nodeB.style.left));
    const linesEl = row.querySelector('[data-role="seqMapLines"]');
    const edgePaths = [...linesEl.querySelectorAll('.seq-map-edge')];
    check('les deux arêtes (A->B aller, B->A retour) sont bien tracées, pas une seule fusionnée par erreur', edgePaths.length === 2);
    // Une arête en boucle (retour) a un point de contrôle dont le y dépasse largement celui des deux
    // extrémités -- une arête classique (aller) ne "creuse" jamais au-delà de ses propres extrémités.
    // C'est précisément la distinction qui manquait dans la première version (ligne droite superposée
    // aux nœuds intermédiaires, invisible en pratique).
    const isLoopedPath = d => {
      const nums = d.match(/-?[0-9.]+/g).map(Number);
      const [, ay, , cy1, , cy2, , by] = nums; // M ax ay C cx1 cy1, cx2 cy2, bx by
      const maxEndY = Math.max(ay, by);
      return cy1 > maxEndY + 1 && cy2 > maxEndY + 1;
    };
    check('l\'arête de retour (B->A) est routée en boucle distincte, pas en ligne droite superposée aux nœuds (bug trouvé en situation réelle)', edgePaths.some(p => isLoopedPath(p.getAttribute('d'))));
  }

  // ---- Scénario 4 : révélation complète côté Backstage (seqMapFullReveal) -- tout visible sans jamais jouer ----
  {
    const track = {
      id: 'sm-4', title: 'Backstage full reveal', mode: 'sequential', description: '', duration: 0,
      base: '', publishedAt: 1, bpm, beatsPerBar, seqMapFullReveal: true,
      segmentSlots: [
        { id: 'slotA', label: 'A', repeatCount: 1, alternatives: [{ label: 'A1', bars: 2, localFile: fakeFile('a1.wav') }], nextOptions: [{ targetId: 'slotB', label: '' }] },
        { id: 'slotB', label: 'B', repeatCount: 1, alternatives: [{ label: 'B1', bars: 1, localFile: fakeFile('b1.wav') }], nextOptions: [{ targetId: 'slotC', label: '' }] },
        { id: 'slotC', label: 'C', repeatCount: 1, alternatives: [{ label: 'C1', bars: 1, localFile: fakeFile('c1.wav') }] },
        { id: 'slotD', label: 'D (jamais reliée)', repeatCount: 1, alternatives: [{ label: 'D1', bars: 1, localFile: fakeFile('d1.wav') }] }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(300); // aucun clic sur Écouter -- juste le chargement
    const nodesEl = row.querySelector('[data-role="seqMapNodes"]');
    check('les 4 emplacements sont tous révélés dès le chargement, sans avoir joué (outil de vérification Backstage)', nodesEl.children.length === 4);
    check('aucun nœud "current" avant toute lecture', !nodesEl.querySelector('.seq-map-node.current'));
  }

  // ---- Scénario 5 : dégradation -- hauteur/largeur interpolées puis repli compact au-delà du plancher ----
  function trackWithSlotCount(n) {
    const slots = [];
    for (let i = 0; i < n; i++) slots.push({ id: 'slot' + i, label: 'Slot ' + i, repeatCount: 1, alternatives: [{ label: 'S' + i, bars: 1, localFile: fakeFile('s' + i + '.wav') }] });
    return { id: 'sm-deg-' + n, title: 'Degradation ' + n, mode: 'sequential', description: '', duration: 0, base: '', publishedAt: 1, bpm, beatsPerBar, seqMapFullReveal: true, segmentSlots: slots, sfxIds: [] };
  }
  {
    const row6 = Core.buildTrackRow(trackWithSlotCount(6), null, false);
    doc.getElementById('host').appendChild(row6);
    Core.initTrackPlayer(trackWithSlotCount(6), row6);
    await sleep(250);
    const nodes6 = row6.querySelector('[data-role="seqMapNodes"]');
    check('6 emplacements : toujours en taille pleine (96px), pas de repli compact', !nodes6.classList.contains('compact') && nodes6.style.getPropertyValue('--seq-map-node-w') === '96px');
    check('6 emplacements : positionnement en couches (style "left" posé, pas un simple flux)', nodes6.querySelector('.seq-map-node').style.left !== '');

    const row10 = Core.buildTrackRow(trackWithSlotCount(10), null, false);
    doc.getElementById('host').appendChild(row10);
    Core.initTrackPlayer(trackWithSlotCount(10), row10);
    await sleep(250);
    const nodes10 = row10.querySelector('[data-role="seqMapNodes"]');
    check('10 emplacements : taille interpolée (ni pleine ni repli compact)', !nodes10.classList.contains('compact') && nodes10.style.getPropertyValue('--seq-map-node-w') !== '96px' && nodes10.style.getPropertyValue('--seq-map-node-w') !== '');

    const row20 = Core.buildTrackRow(trackWithSlotCount(20), null, false);
    doc.getElementById('host').appendChild(row20);
    Core.initTrackPlayer(trackWithSlotCount(20), row20);
    await sleep(250);
    const nodes20 = row20.querySelector('[data-role="seqMapNodes"]');
    check('20 emplacements : repli compact (au-delà du plancher de lisibilité)', nodes20.classList.contains('compact'));
    check('en repli compact, pas de positionnement en couches (simple flux, style "left" absent)', nodes20.querySelector('.seq-map-node').style.left === '');
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
