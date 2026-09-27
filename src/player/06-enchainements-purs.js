// ---------------- Vertical-random : logique pure d'enchaînement des sections ----------------
// Fonction volontairement pure (aucune dépendance à Web Audio, à ctx, ni à quoi que ce soit dans le DOM) —
// elle décide UNIQUEMENT quoi jouer ensuite, jamais comment. Le code Web Audio (incrément 2) ne fera
// qu'appeler decideNext() et traduire son résultat en programmation de sources sonores. Séparée ainsi
// pour pouvoir être testée exhaustivement sans avoir besoin de faire jouer de son réel — voir
// test-section-scheduler.js.
//
// playableSections : tableau de { maxLoops: number|null }, dans l'ordre déclaré par le compositeur,
//   DÉJÀ FILTRÉ aux sections qui ont au moins un fichier chargé (même convention que pickNextSegmentSlot
//   pour le séquentiel, qui saute silencieusement les emplacements vides plutôt que de casser la chaîne).
// options.randomize : brassage complet (true) ou ordre fixe (false) — voir décision du 30/07.
// options.hasIntro / options.hasOutro : présence d'un fichier intro/outro pour ce morceau.
//
// Retour de decideNext() : un descripteur de ce qu'il faut programmer ensuite, ou null si plus rien à
// programmer après le générateur en cours (fin naturelle, comme le séquentiel existant sans outro) :
//   { type: 'intro' }
//   { type: 'section', index, isFirstEverForThisSection }
//   { type: 'outro' }
function createSectionPlaybackScheduler(playableSections, options) {
  const randomize = !!(options && options.randomize);
  const hasIntro = !!(options && options.hasIntro);
  const hasOutro = !!(options && options.hasOutro);
  const n = playableSections.length;

  function buildOrder() {
    const base = Array.from({ length: n }, (_, i) => i);
    if (!randomize) return base;
    // Fisher-Yates : un brassage complet par cycle — chaque section joue exactement une fois par
    // passage, seul l'ORDRE est mélangé (une section dupliquée plusieurs fois dans la liste pèse donc
    // plus lourd, sans jamais être "perdue" — voir discussion du 30/07 sur le choix brassage vs pioche).
    for (let i = base.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = base[i]; base[i] = base[j]; base[j] = tmp;
    }
    return base;
  }

  let order = buildOrder();
  let orderPos = 0;
  let loopsPlayedInSection = 0;
  let chainCyclesCompleted = 0;
  const everStarted = new Array(n).fill(false);
  let introConsumed = !hasIntro;
  let goToEndRequested = false;
  let goToNextRequested = false;

  function requestGoToEnd() { goToEndRequested = true; }
  function requestGoToNextSection() { goToNextRequested = true; }

  function advanceOrder() {
    loopsPlayedInSection = 0;
    orderPos++;
    if (orderPos >= n) {
      orderPos = 0;
      if (randomize) order = buildOrder(); // nouveau brassage à chaque cycle complet
      // Un cycle complet vient de se refermer (retour au début de l'ordre) — c'est la frontière qui
      // compte pour maxChainLoops, indépendamment de la raison de l'avancement (maxLoops d'une section
      // épuisé ou "section suivante" demandée manuellement, les deux passent par advanceOrder()).
      // Lu ici (pas mis en cache à la création) : options.maxChainLoops peut être un getter branché sur
      // une valeur mutable côté appelant (voir playVerticalRandom), pour un changement pris en compte au
      // vol sans recréer le scheduler.
      chainCyclesCompleted++;
      const maxChainLoops = (options && options.maxChainLoops) || null;
      if (maxChainLoops && chainCyclesCompleted >= maxChainLoops) goToEndRequested = true;
    }
  }

  function decideNext() {
    if (!introConsumed) {
      introConsumed = true;
      return { type: 'intro' };
    }
    if (goToEndRequested) {
      goToEndRequested = false;
      // Sans outro définie : rien à programmer après le générateur en cours — il va simplement jusqu'à
      // sa fin réelle (même comportement que le séquentiel existant sans outro).
      return hasOutro ? { type: 'outro' } : null;
    }
    if (n === 0) return null;

    // "Aller vers la section suivante" : la décision en cours (le générateur qui va être programmé MAINTENANT,
    // juste après celui qui joue déjà) saute directement à la section suivante — le générateur déjà en cours
    // de lecture n'est jamais interrompu, seul ce qui vient après change. Vérifié explicitement avec
    // Jules-Antoine : "attend la fin de la section en cours", jamais une répétition en plus.
    if (goToNextRequested) {
      goToNextRequested = false;
      advanceOrder();
    }

    const sectionIndex = order[orderPos];
    const isFirstEverForThisSection = !everStarted[sectionIndex];
    everStarted[sectionIndex] = true;
    loopsPlayedInSection++;

    const maxLoops = playableSections[sectionIndex].maxLoops;
    if (maxLoops && loopsPlayedInSection >= maxLoops) advanceOrder();

    return { type: 'section', index: sectionIndex, isFirstEverForThisSection };
  }

  return { decideNext, requestGoToEnd, requestGoToNextSection };
}

// ---------------- Séquentiel : avancement pur d'un cran dans la chaîne d'emplacements ----------------
// Fonction volontairement pure (aucune closure, aucune dépendance à l'audio) — factorise les deux
// endroits de pickNextSegmentSlot qui avancent currentSlotIndex pour EXACTEMENT la même raison (un
// emplacement vide qu'on saute, ou un repeatCount épuisé) : les deux cas font "avancer d'un cran dans la
// chaîne", point sur lequel on peut détecter un cycle complet (retour à l'emplacement 0) et compter vers
// maxChainLoops. `chainState` est un objet partagé { cyclesCompleted, capReached } muté en place par
// l'appelant, pour rester lisible sans faire de cette fonction un objet à part entière comme le
// scheduler du vertical-random (voir décision du 31/07 — pas nécessaire ici, pickNextSegmentSlot garde
// la responsabilité du choix d'alternative et du saut des emplacements vides, qui dépendent des buffers
// audio réels et ne sont donc pas testables de la même façon). Testée isolément dans
// test-slot-chain-advancer.js.
// randomize (25/09, demande de Jules-Antoine -- même réglage track.randomizeSections que le vertical-random) :
// brassage complet par tour, comme les sections -- chaque emplacement joue une fois par tour, seul l'ordre
// change. L'ordre du tour en cours vit dans chainState.order ; la position est retrouvée à partir de
// l'emplacement courant (indexOf) plutôt que stockée, pour rester juste après un saut d'embranchement qui
// pose currentSlotIndex directement. index = -1 : premier emplacement du tout premier tour (démarrage).
function advanceChainIndex(index, n, chainState, maxChainLoops, randomize) {
  if (!randomize) {
    const nextIndex = (index + 1) % n;
    if (nextIndex === 0 && index >= 0) {
      chainState.cyclesCompleted = (chainState.cyclesCompleted || 0) + 1;
      if (maxChainLoops && chainState.cyclesCompleted >= maxChainLoops) chainState.capReached = true;
    }
    return nextIndex;
  }
  // Fisher-Yates ; le premier emplacement d'un nouveau tour n'est jamais celui qui vient de finir le
  // précédent (pas de répétition immédiate à la jonction des tours), dès qu'il y a au moins 2 emplacements.
  const shuffled = avoidFirst => {
    const o = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = o[i]; o[i] = o[j]; o[j] = t; }
    if (n > 1 && o[0] === avoidFirst) { const j = 1 + Math.floor(Math.random() * (n - 1)); const t = o[0]; o[0] = o[j]; o[j] = t; }
    return o;
  };
  if (!chainState.order || chainState.order.length !== n) chainState.order = shuffled(-1);
  const pos = index < 0 ? -1 : chainState.order.indexOf(index);
  if (pos + 1 < n) return chainState.order[pos + 1];
  chainState.cyclesCompleted = (chainState.cyclesCompleted || 0) + 1;
  if (maxChainLoops && chainState.cyclesCompleted >= maxChainLoops) chainState.capReached = true;
  chainState.order = shuffled(index);
  return chainState.order[0];
}

// Style des boutons de triggers d'effets, injecté une seule fois par le lecteur lui-même plutôt que copié
// dans index.html/pack.html/collection.html (chacun a sa propre feuille de style, déjà dupliquée) -- ne
// s'appuie que sur les variables CSS déjà définies par toutes les pages hôtes (--accent, --border...).
function ensureFxTriggerStyle() {
  if (document.getElementById('lp-fx-trigger-style')) return;
  const st = document.createElement('style');
  st.id = 'lp-fx-trigger-style';
  st.textContent = `
    .fx-trigger-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .fx-trigger-btn { font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 6px 12px; border-radius: 999px;
      border: 1px solid var(--border, #ccc); background: transparent; color: var(--text-dim, #555); cursor: pointer; }
    .fx-trigger-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .fx-trigger-btn.active { background: var(--accent); border-color: var(--accent); color: var(--bg, #fff); }
    .fx-trigger-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .fx-trigger-btn.fx-locked { opacity: 0.4; cursor: not-allowed; border-style: dashed; }
    .fx-slider-row { display: flex; flex-direction: column; gap: 8px; }
    .fx-slider { display: flex; align-items: center; gap: 10px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-dim, #555); }
    .fx-slider span { min-width: 110px; }
    .fx-slider input[type=range] { flex: 1; max-width: 260px; accent-color: var(--accent); }
    .fx-slider input[type=range]:disabled { opacity: 0.4; }
    .fx-slider output { min-width: 3.2em; text-align: right; }
  `;
  document.head.appendChild(st);
}
