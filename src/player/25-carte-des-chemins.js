  // ---- Carte globale des chemins (02/09, réécrite le même jour après un premier passage en grille en
  // flux -- voir CHANGELOG "reprise en flowchart" pour le contexte) : disposition en couches façon
  // flowchart, colonnes = distance (en arêtes AVANT) depuis le premier emplacement découvert, lignes =
  // ordre de première découverte au sein d'une colonne. Positions calculées entièrement en JS (pas de
  // mesure getBoundingClientRect comme drawWwiseLines()) -- un vrai graphe avec boucles a besoin de
  // connaître la colonne de la cible AVANT de choisir comment tracer l'arête (tout droit si elle avance,
  // en boucle si elle revient en arrière), ce que la seule position DOM ne donne pas. Dégradation (nombre
  // de nœuds simultanément visibles) : seuils repris de la même logique que le vertical à embranchement
  // (voir CHANGELOG pour le raisonnement détaillé des valeurs choisies) -- au-delà du plancher, repli sur
  // une simple liste de puces en flux, sans position ni arêtes (même principe que le repli compact déjà
  // utilisé côté embr-vertical). ----
  const SEQ_MAP_FULL_SIZE_MAX = 6, SEQ_MAP_DEGRADE_MAX = 14;
  // Écarts entre colonnes/lignes, et marges des boucles de retour, dépendants de la densité (10/09) --
  // fonctions plutôt que constantes fixes car currentSeqMapDensity() peut différer d'une page hôte à
  // l'autre (Backstage vs public) mais jamais PENDANT la vie d'une page (posé une fois par la page hôte
  // avant tout rendu, comme currentSeqMapTheme()) -- lues à chaque appel plutôt que figées une fois pour
  // ne pas dupliquer cette logique entre updateSeqMap() et seqMapDrawEdges(), qui en ont toutes deux besoin.
  function seqMapColGap() { return currentSeqMapDensity() === 'roomy' ? 56 : 40; }
  function seqMapRowGap() { return currentSeqMapDensity() === 'roomy' ? 24 : 16; }
  // Boucles de retour (03/09, retour direct "elles sont tracées un peu aléatoirement") : marge sous TOUTE
  // la grille avant la première boucle, puis un écart entre boucles successives -- voir seqMapDrawEdges.
  function seqMapLoopMargin() { return currentSeqMapDensity() === 'roomy' ? 32 : 22; }
  function seqMapLoopStagger() { return currentSeqMapDensity() === 'roomy' ? 26 : 18; }
  // Taille des nœuds en mode 'roomy' (pages publiques, 10/09) : "pleine" taille visée quand la place ne
  // manque pas, jamais dépassée même sur un très grand écran (un unique nœud géant serait absurde) --
  // plancher en dessous duquel .seq-map-graph prend le relais en défilement horizontal plutôt que des
  // cartes ratatinées. Largeur de repli si le conteneur n'est pas encore mesurable (ex. carte construite
  // avant d'être visible/dépliée, clientWidth encore à 0) : une largeur de carte plausible, pas 0.
  const SEQ_MAP_ROOMY_FULL_W = 148, SEQ_MAP_ROOMY_FULL_H = 56; // 24/09 : 168x64 -> 148x56 (« un peu surdimensionnée », Jules-Antoine)
  const SEQ_MAP_ROOMY_MIN_W = 112, SEQ_MAP_ROOMY_MIN_H = 46;
  const SEQ_MAP_ROOMY_FALLBACK_WIDTH = 640;
  // Une couleur par case (10/09, retour direct : "essayons une par case ?") -- identité stable de
  // l'emplacement (dérivée de son index dans segmentSlots, pas de l'ordre de révélation qui change en
  // cours de lecture), pas un indicateur d'état -- les états (courant/visité/sélectionnable) restent
  // portés par la bordure existante, cette couleur-ci n'apparaît qu'en filet sur le bord gauche (voir
  // CSS .seq-map-roomy .seq-map-node) pour ne jamais entrer en conflit visuel avec eux. Palette reprise
  // de l'ancienne palette des boucles de retour (retirée le 07/09, réutilisée ici pour un usage différent
  // -- identité de case, pas type d'arête).
  const SEQ_MAP_NODE_PALETTE = ['#4e79a7', '#59a14f', '#b07aa1', '#e15759', '#499894', '#d4a72c'];
  // Point sur le pourtour d'un nœud rectangulaire (centré en `from`, largeur/hauteur nodeW/nodeH), à
  // l'intersection avec le segment reliant `from` à `to` -- utilisé uniquement par la disposition "à
  // ressorts" ci-dessous (seqMapForceLayout), où les nœuds ne sont plus alignés en grille et une arête
  // peut arriver de n'importe quelle direction (contrairement à rightOf/leftOf/bottomOf, qui supposent un
  // flux strictement gauche-à-droite/haut-en-bas).
  function seqMapEdgePoint(from, to, nodeW, nodeH) {
    const dx = to.x - from.x, dy = to.y - from.y;
    if (!dx && !dy) return { x: from.x, y: from.y };
    const halfW = nodeW / 2, halfH = nodeH / 2;
    const scale = Math.min(dx ? halfW / Math.abs(dx) : Infinity, dy ? halfH / Math.abs(dy) : Infinity);
    return { x: from.x + dx * scale, y: from.y + dy * scale };
  }
  // Disposition "à ressorts" (10/09 -- la disposition en triangle qui la précédait, limitée à 3
  // emplacements, ne réglait qu'un cas précis ; retour direct : "essaie de résoudre la mise en
  // visualisation" pour des suites d'embranchements générées au hasard, avec ou sans retours). Algorithme
  // général type Fruchterman-Reingold : tous les nœuds se repoussent entre eux (jamais superposés, jamais
  // entassés), chaque arête tire ses deux extrémités l'une vers l'autre (jamais trop éloignées), relaxé
  // sur plusieurs itérations jusqu'à un arrangement stable -- se généralise naturellement au triangle pour
  // 3 nœuds mutuellement reliés, sans avoir besoin d'un cas particulier dédié. Les arêtes se tracent en
  // lignes directes entre pourtours de nœuds (seqMapEdgePoint), plus jamais en U sous la grille (qui n'a
  // plus de sens dès que les nœuds ne sont plus alignés en colonnes/lignes strictes) -- voir seqMapDrawEdges.
  //
  // Amorçage à chaud (seedPositions = seqMapForcePositions, persisté par instance de piste) : un
  // emplacement déjà positionné à l'appel précédent repart de LÀ, pas d'un point neutre -- sans ça, chaque
  // nouvel emplacement révélé (lecture publique, révélation progressive) aurait fait sauter TOUTE la
  // disposition existante au lieu de l'étendre en douceur. Un emplacement jamais vu est amorcé sur la
  // grille classique (layout.col/row) à l'échelle `k`, pas au hasard -- garde une tendance de lecture
  // gauche-à-droite cohérente avec le reste de la carte, la simulation affine ensuite depuis ce point de
  // départ plutôt que d'ignorer complètement la topologie.
  function seqMapForceLayout(visibleIdx, layout, w, h, seedPositions) {
    const k = Math.max(w, h) * 1.6; // distance "au repos" visée entre deux nœuds reliés par une arête (1,9 avant le 24/09 : carte trop grande)
    const pos = {};
    visibleIdx.forEach(idx => {
      pos[idx] = seedPositions[idx] ? { x: seedPositions[idx].x, y: seedPositions[idx].y } : { x: (layout.col[idx] || 0) * k, y: (layout.row[idx] || 0) * k };
      // Départ légèrement décalé (24/09) : deux nœuds de même colonne/ligne (ex. deux emplacements seulement, reliés dans les
      // deux sens) partaient exactement au même point -- direction de répulsion nulle, ils restaient superposés pour toujours.
      if (!seedPositions[idx]) { pos[idx].x += Math.cos(idx * 2.4) * 2; pos[idx].y += Math.sin(idx * 2.4) * 2; }
    });
    const visibleSet = new Set(visibleIdx);
    const edges = [];
    visibleIdx.forEach(idx => {
      seqMapForwardTargets(idx, visibleSet).forEach(ti => { if (ti !== idx) edges.push({ from: idx, to: ti }); });
    });
    const n = visibleIdx.length;
    let temp = k / 2;
    for (let iter = 0; iter < 220; iter++) {
      const disp = {};
      visibleIdx.forEach(idx => { disp[idx] = { x: 0, y: 0 }; });
      // Répulsion : chaque PAIRE de nœuds s'écarte, proportionnellement à k²/distance (classique
      // Fruchterman-Reingold) -- c'est ce terme, appliqué à TOUTE paire (pas seulement les nœuds reliés),
      // qui garantit qu'aucun couple ne finit jamais superposé ni collé, contrairement à la grille où deux
      // nœuds non reliés directement pouvaient partager la même colonne sans aucune force les séparant.
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = visibleIdx[i], b = visibleIdx[j];
          const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const force = (k * k) / dist;
          const ux = dx / dist, uy = dy / dist;
          disp[a].x += ux * force; disp[a].y += uy * force;
          disp[b].x -= ux * force; disp[b].y -= uy * force;
        }
      }
      // Attraction : chaque arête rapproche ses deux extrémités, proportionnellement à distance²/k --
      // équilibre la répulsion ci-dessus pour que les nœuds RELIÉS restent proches malgré tout.
      edges.forEach(e => {
        const dx = pos[e.from].x - pos[e.to].x, dy = pos[e.from].y - pos[e.to].y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const force = (dist * dist) / k;
        const ux = dx / dist, uy = dy / dist;
        disp[e.from].x -= ux * force; disp[e.from].y -= uy * force;
        disp[e.to].x += ux * force; disp[e.to].y += uy * force;
      });
      // Déplacement limité par la "température" (refroidie à chaque itération, recuit simulé classique) --
      // grands pas au début (échappe vite un mauvais point de départ), pas de plus en plus fins ensuite
      // (converge sans osciller indéfiniment autour de l'équilibre).
      visibleIdx.forEach(idx => {
        const dx = disp[idx].x, dy = disp[idx].y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const lim = Math.min(dist, temp);
        pos[idx].x += (dx / dist) * lim;
        pos[idx].y += (dy / dist) * lim;
      });
      temp *= 0.965;
    }
    visibleIdx.forEach(idx => { seedPositions[idx] = { x: pos[idx].x, y: pos[idx].y }; });
    // Normalise en coordonnées positives (coin haut-gauche de chaque nœud), avec une marge constante --
    // même principe que l'ancienne disposition en triangle qu'elle remplace.
    // Marge égale des quatre côtés autour de la BOÎTE ENGLOBANTE des nœuds (24/09, « toujours mal centrée ») : avant, la marge
    // de gauche/haut se calculait depuis le CENTRE du premier nœud (- w/2) alors que celle de droite/bas partait de son bord,
    // ce qui décalait tout le graphe vers la gauche et le haut dans son cadre.
    const pad = Math.max(w, h) * 0.35;
    const lefts = visibleIdx.map(idx => pos[idx].x - w / 2), tops = visibleIdx.map(idx => pos[idx].y - h / 2);
    const minL = Math.min(...lefts), minT = Math.min(...tops);
    const positions = {};
    let maxRight = 0, maxBottom = 0;
    visibleIdx.forEach(idx => {
      const p = { x: pos[idx].x - w / 2 - minL + pad, y: pos[idx].y - h / 2 - minT + pad };
      positions[idx] = p;
      maxRight = Math.max(maxRight, p.x + w);
      maxBottom = Math.max(maxBottom, p.y + h);
    });
    return { positions, totalW: maxRight + pad, totalH: maxBottom + pad };
  }
  // Ensemble des index d'emplacements à révéler pour l'état courant -- toujours tout en mode
  // seqMapFullReveal (Backstage), sinon déjà-visités + courant + options immédiates depuis le courant
  // (effet de découverte demandé le 1er septembre).
  function seqMapVisibleSlotIndices(currentIdx) {
    const slots = track.segmentSlots || [];
    if (seqMapFullReveal) return slots.map((s, i) => i);
    const visible = new Set(seqVisitedSlotIds);
    if (currentIdx >= 0) {
      visible.add(currentIdx);
      const cur = slots[currentIdx];
      ((cur && cur.nextOptions) || []).forEach(opt => {
        const ti = slots.findIndex(sl => sl.id === opt.targetId);
        if (ti >= 0) visible.add(ti);
      });
    }
    return [...visible];
  }
  // Cibles "en avant" d'un emplacement, restreintes aux emplacements révélés -- embranchement déclaré
  // (nextOptions) ou, à défaut, avancement automatique vers le suivant dans l'ordre du tableau (même
  // approximation volontaire que dans la première version : ne rejoue pas la logique de saut des
  // emplacements vides de pickNextSegmentSlot(), suffisante pour un aperçu topologique).
  function seqMapForwardTargets(idx, revealedSet) {
    const slots = track.segmentSlots || [];
    const slot = slots[idx];
    if (!slot) return [];
    const opts = slot.nextOptions || [];
    if (opts.length) return opts.map(o => slots.findIndex(sl => sl.id === o.targetId)).filter(ti => ti >= 0 && revealedSet.has(ti));
    // Ordre aléatoire (25/09) : aucune flèche "au suivant de la liste", qui annoncerait un ordre qui n'existe
    // pas -- seuls les embranchements (choix du visiteur, ci-dessus) gardent leurs flèches.
    if (seqMapRandom) return [];
    const nextIdx = (idx + 1) % slots.length;
    return (nextIdx !== idx && revealedSet.has(nextIdx)) ? [nextIdx] : [];
  }
  // Colonne = distance en arêtes AVANT depuis la racine (le premier emplacement découvert encore révélé,
  // ou l'emplacement 0 si rien n'a encore été découvert -- cas Backstage avant toute lecture), par simple
  // parcours en largeur sur le sous-graphe des emplacements révélés. Une arête vers un emplacement déjà
  // affecté à une colonne (boucle/retour) n'avance jamais sa colonne -- c'est justement ce qui la
  // distingue d'une avancée (voir seqMapDrawEdges, tracé en boucle plutôt qu'en ligne droite pour ces
  // arêtes-là). Ligne = position dans sa colonne, dans l'ordre de première découverte
  // (seqVisitedSlotIds étant un Set, son ordre d'itération EST l'ordre d'insertion -- aucun état
  // supplémentaire à tenir pour ça).
  function seqMapComputeLayout(visibleIdx, currentIdx) {
    const revealedSet = new Set(visibleIdx);
    const visitedOrder = [...seqVisitedSlotIds];
    if (seqMapRandom) {
      // Ordre aléatoire (25/09, validé par Jules-Antoine) : les slots forment un groupe sans ordre -- grille
      // de 4 de large, remplie dans l'ordre de découverte (un slot révélé s'ajoute au bout, rien ne bouge),
      // puis par index pour ceux pas encore joués (Backstage, tout révélé).
      const orderOf = idx => { const p = visitedOrder.indexOf(idx); return p === -1 ? Infinity : p; };
      const sorted = visibleIdx.slice().sort((a, b) => orderOf(a) - orderOf(b) || a - b);
      const perRow = Math.min(4, sorted.length);
      const col = {}, row = {};
      sorted.forEach((idx, i) => { col[idx] = i % perRow; row[idx] = Math.floor(i / perRow); });
      return { col, row, maxCol: Math.max(0, perRow - 1), maxRows: Math.max(1, Math.ceil(sorted.length / perRow)) };
    }
    const startIdx = visitedOrder.find(i => revealedSet.has(i));
    const root = startIdx != null ? startIdx : visibleIdx[0];
    const col = {};
    if (root != null) {
      col[root] = 0;
      const queue = [root];
      while (queue.length) {
        const idx = queue.shift();
        seqMapForwardTargets(idx, revealedSet).forEach(ti => {
          if (col[ti] == null) { col[ti] = col[idx] + 1; queue.push(ti); }
        });
      }
    }
    // Emplacement révélé mais jamais atteint par le parcours (composante détachée de la racine -- ne
    // devrait pas arriver en pratique étant donné comment revealedSet est construit, mais ne doit jamais
    // faire planter le rendu) : colonne 0 par défaut plutôt qu'un index manquant.
    visibleIdx.forEach(idx => { if (col[idx] == null) col[idx] = 0; });
    const orderOf = idx => { const p = visitedOrder.indexOf(idx); return p === -1 ? Infinity : p; };
    const byCol = {};
    visibleIdx.slice().sort((a, b) => orderOf(a) - orderOf(b) || a - b).forEach(idx => {
      (byCol[col[idx]] = byCol[col[idx]] || []).push(idx);
    });
    const row = {};
    Object.keys(byCol).forEach(c => byCol[c].forEach((idx, i) => { row[idx] = i; }));
    const maxCol = Math.max(0, ...visibleIdx.map(idx => col[idx]));
    const maxRows = Math.max(1, ...Object.values(byCol).map(arr => arr.length));
    return { col, row, maxCol, maxRows };
  }
  function updateSeqMap(currentIdx) {
    if (!seqMapNodesEl || !seqMapCanvasEl) return;
    seqMapLastCurrentIdx = currentIdx;
    const slots = track.segmentSlots || [];
    const visibleIdx = seqMapVisibleSlotIndices(currentIdx);
    if (!visibleIdx.length) {
      seqMapNodesEl.innerHTML = ''; if (seqMapLinesEl) seqMapLinesEl.innerHTML = '';
      seqMapCanvasEl.style.width = ''; seqMapCanvasEl.style.height = '';
      return;
    }
    // Nœuds cliquables (04/09) : uniquement ceux qui sont une vraie option depuis l'emplacement COURANT,
    // jamais un nœud "visité" par ailleurs qui n'est pas une option depuis ici -- on ne clique pas sur
    // l'historique, seulement sur ce qui est réellement proposé maintenant. Rien de sélectionnable hors
    // lecture (currentIdx < 0, ex. état "Prêt").
    const currentSlot = currentIdx >= 0 ? (slots[currentIdx] || null) : null;
    const selectableIds = new Set(((currentSlot && currentSlot.nextOptions) || []).map(o => o.targetId));
    // Coche "déjà joué" : en ordre aléatoire, seulement pour le tour en cours -- sinon, dès le 2e tour, tout
    // resterait coché et la carte ne dirait plus rien. Chaque slot joue une fois par tour : dès qu'un slot déjà
    // entendu revient, un nouveau tour a commencé. Ailleurs, inchangé : tout emplacement déjà visité.
    if (seqMapRandom && currentIdx >= 0 && currentIdx !== seqRoundLastIdx) {
      if (seqRoundLastIdx >= 0) seqRoundPlayedIds.add(seqRoundLastIdx);
      if (seqRoundPlayedIds.has(currentIdx)) seqRoundPlayedIds = new Set();
      seqRoundLastIdx = currentIdx;
    }
    const playedThisRound = seqMapRandom ? seqRoundPlayedIds : null;
    const wasPlayed = idx => (playedThisRound ? playedThisRound.has(idx) : seqVisitedSlotIds.has(idx));
    const nodeStateCls = (idx, slot) => {
      const isCurrent = idx === currentIdx;
      const isVisited = wasPlayed(idx) && !isCurrent;
      const isSelectable = selectableIds.has(slot.id);
      const isPending = pendingNextSegmentId === slot.id;
      return (isCurrent ? ' current' : '') + (isVisited ? ' visited' : '') + (isSelectable ? ' selectable' : '') + (isPending ? ' pending' : '');
    };
    const n = visibleIdx.length;
    const compact = n > SEQ_MAP_DEGRADE_MAX;
    seqMapNodesEl.classList.toggle('compact', compact);
    if (compact) {
      // Repli : simple liste de puces en flux, aucune position ni arête -- même esprit que le repli
      // compact déjà utilisé côté embr-vertical (au-delà du plancher, la topologie exacte importe moins
      // que rester lisible d'un coup d'œil).
      seqMapCanvasEl.style.width = ''; seqMapCanvasEl.style.height = '';
      if (seqMapLinesEl) seqMapLinesEl.innerHTML = '';
      seqMapNodesEl.innerHTML = visibleIdx.map(idx => {
        const slot = slots[idx] || {};
        const label = slot.label || t('slotFallback', { n: idx + 1 });
        const cls = 'seq-map-node' + nodeStateCls(idx, slot);
        const check = (wasPlayed(idx) && idx !== currentIdx) ? '<span class="seq-map-node-check">✓</span>' : '';
        return `<div class="${cls}" data-slot-idx="${idx}" data-slot-id="${escapeHtml(slot.id || '')}"><span class="seq-map-node-label">${escapeHtml(label)}</span>${check}</div>`;
      }).join('');
      attachSeqMapNodeClicks(currentSlot);
      return;
    }
    const layout = seqMapComputeLayout(visibleIdx, currentIdx);
    const roomy = currentSeqMapDensity() === 'roomy';
    let w, h;
    if (roomy) {
      // Mode 'roomy' (pages publiques, 10/09, retour direct : la maquette montrée était "agréable à
      // regarder", le vrai composant "tristounet" en comparaison, et devait pouvoir "s'adapter à la
      // fois à la taille de l'écran et au nombre d'embranchements") : contrairement au mode 'compact'
      // ci-dessous, la taille des nœuds dépend de la largeur RÉELLEMENT disponible -- seule mesure
      // DOM (clientWidth) de toute cette carte, dérogation volontaire au principe "tout en JS pur" du
      // commentaire plus haut, nécessaire ici car "s'adapter à l'écran" ne peut pas se déduire de la
      // seule topologie du graphe.
      const availableWidth = (seqMapGraphEl && seqMapGraphEl.clientWidth) || SEQ_MAP_ROOMY_FALLBACK_WIDTH;
      const cols = layout.maxCol + 1;
      const idealW = (availableWidth - (cols - 1) * seqMapColGap()) / cols;
      w = Math.max(SEQ_MAP_ROOMY_MIN_W, Math.min(SEQ_MAP_ROOMY_FULL_W, Math.round(idealW)));
      h = Math.max(SEQ_MAP_ROOMY_MIN_H, Math.round(SEQ_MAP_ROOMY_FULL_H * (w / SEQ_MAP_ROOMY_FULL_W)));
    } else {
      const span = SEQ_MAP_DEGRADE_MAX - SEQ_MAP_FULL_SIZE_MAX;
      const over = Math.max(0, Math.min(n, SEQ_MAP_DEGRADE_MAX) - SEQ_MAP_FULL_SIZE_MAX);
      w = Math.round(96 - over * (36 / span));
      h = Math.round(40 - over * (12 / span));
    }
    seqMapNodesEl.style.setProperty('--seq-map-node-w', w + 'px');
    seqMapNodesEl.style.setProperty('--seq-map-node-h', h + 'px');
    // Police proportionnelle uniquement en mode 'roomy' -- en 'compact', 10px fixe reste approprié même
    // au node le plus large (96px, taille "pleine" de ce mode), jamais aussi grand qu'un node 'roomy'.
    if (roomy) seqMapNodesEl.style.setProperty('--seq-map-node-font', Math.max(12, Math.round(w / 9)) + 'px');
    // Disposition "à ressorts" (10/09) en mode 'roomy' -- voir seqMapForceLayout ci-dessus pour le
    // pourquoi. Sinon (mode 'compact'), grille habituelle (colonnes/lignes déjà calculées par
    // seqMapComputeLayout) convertie en positions ABSOLUES une fois pour toutes ici -- seqMapDrawEdges ne
    // connaît plus que ces positions, ce qui lui permet de tracer des arêtes correctement quelle que soit
    // la disposition (grille ou ressorts) sans savoir laquelle des deux l'a produite.
    let positions, totalW, totalH;
    if (roomy && !seqMapRandom) { // ordre aléatoire : toujours la grille (sans flèches, les ressorts écarteraient les nœuds sans fin)
      ({ positions, totalW, totalH } = seqMapForceLayout(visibleIdx, layout, w, h, seqMapForcePositions));
    } else {
      const colGap = seqMapColGap(), rowGap = seqMapRowGap();
      const colW = w + colGap, rowH = h + rowGap;
      positions = {};
      visibleIdx.forEach(idx => { positions[idx] = { x: layout.col[idx] * colW, y: layout.row[idx] * rowH }; });
      totalW = (layout.maxCol + 1) * colW - colGap;
      // Marge verticale supplémentaire si des arêtes de retour existent -- chacune plonge volontairement
      // sous TOUTE la grille (voir seqMapDrawEdges), une par une, en s'étalant verticalement pour rester
      // distinctes. Sans cette marge elles seraient coupées par overflow-y:hidden sur .seq-map-graph (bug
      // trouvé en vérification visuelle réelle : la boucle existait bien dans le SVG mais restait invisible,
      // coupée sous le bord de la carte).
      const backEdgeCount = visibleIdx.reduce((n, idx) => n + seqMapForwardTargets(idx, new Set(visibleIdx)).filter(ti => layout.col[ti] <= layout.col[idx]).length, 0);
      totalH = layout.maxRows * rowH - rowGap + (backEdgeCount > 0 ? seqMapLoopMargin() + (backEdgeCount - 1) * seqMapLoopStagger() + Math.round(h / 2) + 6 : 0);
    }
    // Taille explicite sur le conteneur défilable (pas sur .seq-map-graph, qui reste la fenêtre visible) --
    // permet un défilement horizontal si le graphe est plus large que la carte, plutôt que l'effondrement
    // en une seule colonne trouvé en situation réelle avec la première version (nœuds superposés, arêtes
    // invisibles derrière eux, voir CHANGELOG).
    seqMapCanvasEl.style.width = totalW + 'px';
    seqMapCanvasEl.style.height = totalH + 'px';
    // Centré dans la carte (24/09, « toujours mal centrée ») : le canvas est dimensionné sur le graphe seul, plus petit
    // que la carte ; sans marges automatiques il restait collé à gauche. Sans effet s'il déborde (défilement).
    seqMapCanvasEl.style.marginLeft = 'auto';
    seqMapCanvasEl.style.marginRight = 'auto';
    // Ajusté à la largeur disponible (24/09, carte de l'aperçu du Backstage, panneau étroit) : en 'roomy', un graphe de plusieurs
    // nœuds dépasse la carte et obligeait à faire défiler horizontalement -- il est réduit d'un bloc (nœuds, flèches, texte)
    // jusqu'à 60 % au plus ; en dessous, le défilement reste le repli.
    if (roomy && seqMapGraphEl) {
      const cs = getComputedStyle(seqMapGraphEl);
      const avail = seqMapGraphEl.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const k = avail > 0 && totalW > avail ? Math.max(0.6, avail / totalW) : 1;
      seqMapCanvasEl.style.zoom = k < 1 ? String(k) : '';
    }
    // Pas de forme d'onde sur les nœuds (retiré le 03/09 sur retour direct de Jules-Antoine en situation
    // réelle -- en plus de ne pas être demandée ici, elle ne reflétait pas fidèlement le fichier : Corridor
    // et Battle s'arrêtaient visiblement à mi-chemin). L'état (courant/visité/pas encore atteint) se lit
    // uniquement via la bordure (voir CSS .seq-map-node.current/.visited) -- aucune donnée audio à charger
    // ni dessiner ici, juste le libellé. Couleur par case (10/09) : identité stable de l'emplacement (voir
    // SEQ_MAP_NODE_PALETTE) posée en filet CSS, uniquement consommée en 'roomy' -- inoffensive ailleurs.
    seqMapNodesEl.innerHTML = visibleIdx.map(idx => {
      const slot = slots[idx] || {};
      const label = slot.label || t('slotFallback', { n: idx + 1 });
      const cls = 'seq-map-node' + nodeStateCls(idx, slot);
      const check = (wasPlayed(idx) && idx !== currentIdx) ? '<span class="seq-map-node-check">✓</span>' : '';
      const accent = roomy ? SEQ_MAP_NODE_PALETTE[idx % SEQ_MAP_NODE_PALETTE.length] : null;
      const style = `left:${positions[idx].x}px;top:${positions[idx].y}px` + (accent ? `;--seq-map-node-accent:${accent}` : '');
      return `<div class="${cls}" data-slot-idx="${idx}" data-slot-id="${escapeHtml(slot.id || '')}" style="${style}"><span class="seq-map-node-label">${escapeHtml(label)}</span>${check}</div>`;
    }).join('');
    seqMapDrawEdges(layout, visibleIdx, positions, w, h, totalW, totalH, roomy);
    attachSeqMapNodeClicks(currentSlot);
  }
  // Attache le clic sur les nœuds sélectionnables -- rappelée à chaque reconstruction de seqMapNodesEl,
  // son innerHTML étant entièrement remplacé à chaque appel d'updateSeqMap() (donc les écouteurs d'un
  // passage précédent n'existent plus).
  function attachSeqMapNodeClicks(currentSlot) {
    seqMapNodesEl.querySelectorAll('.seq-map-node.selectable').forEach(el => {
      el.addEventListener('click', () => handleSeqBranchChoice(el.dataset.slotId, currentSlot));
    });
  }
  // Arêtes SVG entre nœuds révélés, positions calculées directement depuis `layout` (pas de mesure DOM).
  // Arête "en avant" (colonne cible > colonne source) : courbe en S classique entre le bord droit de la
  // source et le bord gauche de la cible. Arête "en arrière ou même colonne" (boucle/retour, colonne
  // cible <= colonne source) : réécrite deux fois le 03/09 sur retours directs -- d'abord une courbe (l'
  // ancienne version sortait par la droite avec un décalage fixe, forme différente selon la distance,
  // "tracées un peu aléatoirement"), puis un tracé ORTHOGONAL (droites + angles droits, "plus clair
  // notamment dans les systèmes complexes") : descend tout droit depuis le BAS de la source, traverse à
  // l'horizontale sous TOUTE la grille (pas juste sous la ligne des deux nœuds concernés -- ne risque donc
  // jamais de croiser un nœud intermédiaire), remonte tout droit dans le BAS de la cible. Même tracé
  // prévisible quelle que soit la distance entre les deux nœuds. totalW/totalH reçus tels quels depuis updateSeqMap() (pas recalculés ici) pour que
  // le viewBox du SVG corresponde exactement à .seq-map-canvas, marge des boucles de retour comprise --
  // sinon une boucle qui dépasse la dernière ligne de nœuds serait coupée par overflow-y:hidden (bug
  // trouvé en vérification visuelle réelle).
  function seqMapDrawEdges(layout, visibleIdx, positions, nodeW, nodeH, totalW, totalH, freeform) {
    if (!seqMapLinesEl) return;
    const slots = track.segmentSlots || [];
    seqMapLinesEl.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    seqMapLinesEl.setAttribute('width', totalW);
    seqMapLinesEl.setAttribute('height', totalH);
    seqMapLinesEl.innerHTML = '';
    const svgNS = 'http://www.w3.org/2000/svg';
    // Coordonnées dérivées de `positions` (calculées une fois par updateSeqMap(), grille ou triangle
    // selon le cas -- voir seqMapForceLayout) plutôt que recalculées ici depuis colonne/ligne :
    // cette fonction n'a plus besoin de savoir QUELLE disposition a produit ces positions.
    const centerOf = idx => ({ x: positions[idx].x + nodeW / 2, y: positions[idx].y + nodeH / 2 });
    const rightOf = idx => ({ x: positions[idx].x + nodeW, y: positions[idx].y + nodeH / 2 });
    const leftOf = idx => ({ x: positions[idx].x, y: positions[idx].y + nodeH / 2 });
    const bottomOf = (idx, offsetX) => ({ x: positions[idx].x + nodeW / 2 + (offsetX || 0), y: positions[idx].y + nodeH });
    const visibleSet = new Set(visibleIdx);
    // gridBottom (mode grille uniquement, voir plus bas) : bas du nœud le plus bas parmi ceux visibles --
    // équivalent de l'ancien layout.maxRows*rowH, mais dérivé des positions réelles, pas du nombre de
    // lignes de la grille (qui n'a plus de sens uniforme si une future disposition n'était plus en grille).
    const gridBottom = Math.max(0, ...visibleIdx.map(idx => positions[idx].y)) + nodeH;
    // Flèches de sens (03/09, retour direct : "ajoute une flèche pour bien expliciter le sens de
    // lecture") -- une définition <marker> par couleur utilisée (le gris par défaut des arêtes "en avant",
    // plus une par couleur de la palette des boucles de retour ci-dessous), réutilisées par toutes les
    // arêtes de cette couleur via marker-end. Redéfinies à chaque appel (innerHTML vidé juste au-dessus) --
    // coût négligeable, une poignée d'éléments SVG.
    const defs = document.createElementNS(svgNS, 'defs');
    seqMapLinesEl.appendChild(defs);
    const markerIds = {};
    function ensureArrowMarker(color, key) {
      if (markerIds[key]) return markerIds[key];
      const id = 'seqMapArrow-' + key;
      const marker = document.createElementNS(svgNS, 'marker');
      marker.setAttribute('id', id);
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '8.5');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '6');
      marker.setAttribute('markerHeight', '6');
      marker.setAttribute('orient', 'auto-start-reverse');
      const arrowPath = document.createElementNS(svgNS, 'path');
      arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
      arrowPath.setAttribute('fill', color);
      marker.appendChild(arrowPath);
      defs.appendChild(marker);
      markerIds[key] = id;
      return id;
    }
    // Couleur unique pour toutes les boucles de retour (07/09, retour direct de Jules-Antoine : "plus
    // besoin des couleurs sur les trajets de retour" une fois leur tracé fiabilisé -- voir écartement
    // minimal ci-dessous) -- même teinte neutre que les arêtes "en avant", les boucles se distinguent
    // déjà par leur tracé en U et leur étalement vertical/horizontal, pas besoin d'un code couleur en
    // plus. Remplace la palette aléatoire par paire source/cible utilisée jusqu'ici.
    const SEQ_MAP_LOOP_COLOR = cssVar('--text-dimmer', '#a8a399');
    // Étale chaque boucle de retour un peu plus bas que la précédente (backEdgeIndex incrémenté à chaque
    // arête en arrière rencontrée) -- sans ça, deux boucles de retour finissaient à la même hauteur et se
    // confondaient visuellement. updateSeqMap() réserve la marge verticale correspondante dans totalH,
    // avec les mêmes fonctions (seqMapLoopMargin()/seqMapLoopStagger()).
    //
    // Ancrages horizontaux (06/09, suite au fouillis signalé par Jules-Antoine sur un morceau à
    // plusieurs boucles) : quand plusieurs boucles de retour partagent le même nœud en départ ou en
    // arrivée, les ancrer toutes au centre du nœud les faisait converger exactement au même point --
    // réparties ici le long du bas du nœud, une par boucle. Calculé en une passe préalable (avant tout
    // tracé) car le nombre d'arêtes partageant un nœud n'est connu qu'une fois toutes les arêtes
    // recensées.
    // Tout ce bloc de précalcul (ancrages/écartement des boucles de retour en grille) ne concerne QUE le
    // tracé orthogonal en U du mode grille -- inutile et sauté en disposition "à ressorts" (roomy), qui
    // trace des lignes directes entre pourtours de nœuds (voir seqMapEdgePoint) sans jamais avoir besoin
    // de plonger sous la grille.
    const backEdgeAnchors = new Map();
    if (!freeform) {
      const backEdgePairs = [];
      visibleIdx.forEach(idx => {
        if (!slots[idx]) return;
        seqMapForwardTargets(idx, visibleSet).forEach(ti => {
          if (layout.col[ti] <= layout.col[idx]) backEdgePairs.push({ from: idx, to: ti });
        });
      });
      const ANCHOR_SPACING = 12;
      const fromTotals = {}, toTotals = {}, fromSeen = {}, toSeen = {};
      backEdgePairs.forEach(e => {
        fromTotals[e.from] = (fromTotals[e.from] || 0) + 1;
        toTotals[e.to] = (toTotals[e.to] || 0) + 1;
      });
      function spreadOffset(seenMap, totalsMap, key) {
        const total = totalsMap[key] || 1;
        const seen = seenMap[key] || 0;
        seenMap[key] = seen + 1;
        return total > 1 ? (seen - (total - 1) / 2) * ANCHOR_SPACING : 0;
      }
      backEdgePairs.forEach(e => {
        const anchor = {
          fromOffset: spreadOffset(fromSeen, fromTotals, e.from),
          toOffset: spreadOffset(toSeen, toTotals, e.to),
        };
        // Deux nœuds de la MÊME colonne (07/09, retour direct de Jules-Antoine après avoir réordonné des
        // embranchements : "c'est tout écrasé") : leur centre partage le même x, donc la boucle qui les
        // relie s'effondrait en un simple trait vertical (largeur nulle) au lieu d'un rectangle, quel que
        // soit l'écartement ci-dessus (qui ne sépare que des arêtes partageant un même nœud, pas deux
        // nœuds distincts alignés par hasard). Écartement minimal forcé dans ce cas précis -- ce bloc ne
        // s'exécute qu'en mode 'compact' (voir `if (!freeform)` plus haut) : en 'roomy', la disposition à
        // ressorts est le VRAI correctif (deux nœuds qui n'ont plus de raison de partager le même x) ;
        // cet écartement minimal reste le filet de sécurité pour le Backstage, qui reste en grille.
        if (layout.col[e.from] === layout.col[e.to]) {
          const minGap = Math.max(ANCHOR_SPACING * 2, nodeW * 0.5);
          if (Math.abs(anchor.fromOffset - anchor.toOffset) < minGap) {
            anchor.fromOffset -= minGap / 2;
            anchor.toOffset += minGap / 2;
          }
        }
        backEdgeAnchors.set(e.from + '>' + e.to, anchor);
      });
    }
    let backEdgeIndex = 0;
    const drawEdge = (fromIdx, toIdx, cls, label, hasTransition) => {
      const isBack = layout.col[toIdx] <= layout.col[fromIdx];
      const path = document.createElementNS(svgNS, 'path');
      let d, a, b, mid, markerId;
      if (freeform) {
        // Disposition "à ressorts" (10/09) : plus de notion "en avant"/"en arrière" pour le TRACÉ -- une
        // simple ligne courbe entre les pourtours des deux nœuds, dans n'importe quelle direction. isBack (calculé
        // plus haut) ne sert plus qu'à choisir la couleur (neutre "boucle" ou neutre "en avant" -- déjà
        // la même teinte depuis le 07/09, gardé séparé ici seulement pour rester cohérent avec le reste
        // du fichier si l'un des deux devait un jour redevenir distinct). Léger arc plutôt qu'une droite
        // pure : une paire de nœuds reliée dans les deux sens (aller ET retour) doit rester lisible comme
        // deux arêtes distinctes, pas une seule ligne se chevauchant elle-même.
        const cA = centerOf(fromIdx), cB = centerOf(toIdx);
        a = seqMapEdgePoint(cA, cB, nodeW, nodeH);
        b = seqMapEdgePoint(cB, cA, nodeW, nodeH);
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const bow = Math.max(10, nodeW * 0.12);
        const mx = (a.x + b.x) / 2 + (-dy / len) * bow, my = (a.y + b.y) / 2 + (dx / len) * bow;
        d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
        mid = { x: mx, y: my };
        const color = isBack ? SEQ_MAP_LOOP_COLOR : cssVar('--text-dimmer', '#a8a399');
        path.style.stroke = color;
        markerId = ensureArrowMarker(color, isBack ? 'loop' : 'default');
      } else if (isBack) {
        // Tracé orthogonal (droites + angles droits, 03/09 sur retour direct : "plus clair, notamment
        // dans les systèmes complexes") plutôt qu'une courbe -- descend tout droit, traverse à
        // l'horizontale, remonte tout droit. Aucune ambiguïté de lecture même avec plusieurs boucles
        // imbriquées, contrairement à des courbes qui peuvent se confondre visuellement dans un graphe
        // chargé.
        const anchor = backEdgeAnchors.get(fromIdx + '>' + toIdx) || {};
        a = bottomOf(fromIdx, anchor.fromOffset); b = bottomOf(toIdx, anchor.toOffset);
        const loopY = gridBottom + seqMapLoopMargin() + backEdgeIndex * seqMapLoopStagger();
        backEdgeIndex++;
        d = `M ${a.x} ${a.y} L ${a.x} ${loopY} L ${b.x} ${loopY} L ${b.x} ${b.y}`;
        mid = { x: (a.x + b.x) / 2, y: loopY };
        path.style.stroke = SEQ_MAP_LOOP_COLOR;
        markerId = ensureArrowMarker(SEQ_MAP_LOOP_COLOR, 'loop');
      } else {
        a = rightOf(fromIdx); b = leftOf(toIdx);
        const midX = (a.x + b.x) / 2;
        d = `M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`;
        mid = { x: midX, y: (a.y + b.y) / 2 };
        markerId = ensureArrowMarker(cssVar('--text-dimmer', '#a8a399'), 'default');
      }
      path.setAttribute('d', d);
      path.setAttribute('class', 'seq-map-edge' + (cls ? ' ' + cls : ''));
      path.setAttribute('marker-end', `url(#${markerId})`);
      // <title> (infobulle au survol) plutôt qu'un <text> toujours affiché comme dans la version
      // précédente : avec plusieurs embranchements/retours proches, des libellés SVG en permanence
      // visibles se chevauchaient et devenaient illisibles (retour direct en situation réelle, "tout
      // moche, tout recroquevillé") -- même principe que le graphe Wwise du vertical-random, qui n'a
      // lui-même aucun libellé permanent sur ses connecteurs.
      if (label) {
        const title = document.createElementNS(svgNS, 'title');
        title.textContent = label;
        path.appendChild(title);
      }
      seqMapLinesEl.appendChild(path);
      // Repère de transition (03/09) : un disque au milieu du chemin -- couleur retirée du liseré lui-même
      // sur retour direct ("oublie la couleur du liseré bleu"), gardée uniquement sur ce disque, agrandi
      // ("un peu plus visible") pour rester le seul indicateur de transition sur cette arête.
      if (hasTransition) {
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', String(mid.x));
        dot.setAttribute('cy', String(mid.y));
        dot.setAttribute('r', '6.5');
        // "Est-ce que la boule peut se colorer lorsqu'elle joue ?" (05/09, retour direct) : classe .playing
        // posée seulement pendant que CE fichier de transition précis est audible (currentTransitionEdge,
        // voir activateSeqStage()) -- distingue "cette arête a une transition" (toujours visible, disque de
        // base) de "cette transition est en train de jouer là, maintenant" (le reste du temps, aucune arête
        // n'est concernée).
        const isPlaying = !!(currentTransitionEdge && currentTransitionEdge.from === fromIdx && currentTransitionEdge.to === toIdx);
        dot.setAttribute('class', 'seq-map-transition-dot' + (isPlaying ? ' playing' : ''));
        const dotTitle = document.createElementNS(svgNS, 'title');
        dotTitle.textContent = t('branchTransitionBadgeTitle');
        dot.appendChild(dotTitle);
        seqMapLinesEl.appendChild(dot);
      }
    };
    visibleIdx.forEach(idx => {
      const slot = slots[idx];
      if (!slot) return;
      const options = slot.nextOptions || [];
      if (options.length) {
        options.forEach((opt, oi) => {
          const targetIdx = slots.findIndex(sl => sl.id === opt.targetId);
          if (targetIdx < 0 || !visibleSet.has(targetIdx)) return; // cible pas encore révélée -- pas d'arête vers du vide
          const hasTransition = !!(transitionBuffers[idx] && transitionBuffers[idx][oi]);
          const label = opt.label || (slots[targetIdx] && slots[targetIdx].label) || '';
          drawEdge(idx, targetIdx, 'branch' + (hasTransition ? ' transition' : ''), label, hasTransition);
        });
      } else if (!seqMapRandom) { // ordre aléatoire : pas de flèche "au suivant", voir seqMapForwardTargets
        const nextIdx = (idx + 1) % slots.length;
        if (nextIdx !== idx && visibleSet.has(nextIdx)) drawEdge(idx, nextIdx, '', '');
      }
    });
  }
