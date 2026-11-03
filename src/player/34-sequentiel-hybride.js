/* ---- Séquentiel hybride (31/10) : un morceau parent enchaîne des sections, et chaque section est un morceau normal de la
   bibliothèque, joué par son propre lecteur (statique et layering additif pour commencer). Le parent ne programme aucun son : il dit
   à une section de finir à sa fin de boucle, reçoit l'instant exact de cette fin, et y fait démarrer la suivante pendant que la queue
   de la précédente sonne encore. Une section qui revient (AABA) a son propre lecteur : d'où l'identifiant `morceau~section`. ---- */
const HYBRID_PLAY_SVG = '<path d="M8 5v14l11-7z"/>';
const HYBRID_PAUSE_SVG = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
const HYBRID_HANDOFF_LEAD_SEC = 1.2; // au moins la seconde d'avance du moteur quantifié, malgré les minuteurs ralentis

function hybridPlayableSections(track) {
  return (track.sections || []).filter(sec => {
    const child = sec && sec.track;
    if (!child || !HYBRID_SECTION_MODES.includes(child.mode)) return false;
    if (child.mode === 'sequential') return (child.segmentSlots || []).some(sl => (sl.alternatives || []).some(layerHasSource));
    if (child.mode === 'vertical-random') return (child.sections || []).some((_, i) => vrSectionIsPlayable(child, i));
    if (child.mode === 'embranchement-vertical') return (child.loops || []).some(layerHasSource);
    const layers = child.layers || [];
    return layerHasSource(layers[0]) && (child.mode === 'static' || layers.every(layerHasSource));
  });
}
function hybridChildTrack(sec) {
  // Boucles : 0 = sans limite, vide = le réglage du morceau lui-même.
  // Le séquentiel et le vertical-random comptent en tours complets de leur chaîne.
  const key = sec.track.mode === 'sequential' || sec.track.mode === 'vertical-random' ? 'maxChainLoops' : 'maxLoops';
  // Avec des embranchements et sans section par défaut, la section attend le choix du visiteur : pas de limite.
  const waitsForChoice = (sec.branches || []).length && !sec.defaultNext;
  const limit = waitsForChoice || sec.maxLoops === 0 ? null : (sec.maxLoops || sec.track[key] || null);
  const child = Object.assign({}, sec.track, { id: sec.track.id + '~' + sec.id, [key]: limit });
  // Une section interne sans limite ne ferait jamais finir le tour : avec un nombre de tours, elle joue une fois par tour.
  if (limit && child.mode === 'vertical-random') child.sections = (child.sections || []).map(s => Object.assign({}, s, { maxLoops: s.maxLoops || 1 }));
  return child;
}

function buildHybridRow(track, isNoAiCertified) {
  const sections = hybridPlayableSections(track);
  const wrapper = document.createElement('div');
  wrapper.className = 'track-row-wrapper';
  wrapper.innerHTML = `
    <div class="track-row">
      <div style="display:flex;align-items:center;gap:6px">
        <button class="play-btn" data-role="playBtn" disabled aria-label="${t('loadingAriaLabel')}">
          <svg data-role="playIcon" class="loading-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke-dasharray="28 100"/></svg>
        </button>
        <button class="play-btn" data-role="stopBtn" style="display:none" aria-label="${t('stopAriaLabel')}" title="${t('stopAriaLabel')}">
          <svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>
        </button>
      </div>
      <div class="track-row-title" data-role="titleToggle">
        <span class="name">${escapeHtml(track.title)}</span>
        ${isNoAiCertified ? `<span class="no-ai-badge" title="${t('noAiBadgeTitle')}">${noAiBadgeSvg()}</span>` : ''}
        <span class="mode-tag">${getModeLabel(track.mode, track)}</span>
      </div>
    </div>
    <div class="track-row-details" data-role="details">
     <div class="track-row-details-inner">
      <div class="track-desc" data-role="trackDesc">${linkify(track.description || '')}</div>
      ${track.tags ? `<div class="track-tags">${track.tags.split(',').map(s => s.trim()).filter(Boolean).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      ${!sections.length ? `<span class="placeholder-tag">${t('hybridNoSection')}</span>` : `
        <div class="status" data-role="status">${t('loadingAriaLabel')}</div>
        <div class="seq-map hybrid-map${currentSeqMapTheme() === 'dark' ? ' seq-map-dark' : ''}" data-role="hybridMap">
          <div class="voice-graph-label">${t('seqMapLabel')}</div>
          <div class="seq-map-graph"><div class="seq-map-canvas" data-role="hybridMapCanvas"><svg class="seq-map-lines" data-role="hybridMapLines"></svg><div class="seq-map-nodes" data-role="hybridMapNodes"></div></div></div>
        </div>
        <div><button type="button" class="voice-refresh-btn" data-role="hybridNext" disabled>${t('goToNextSectionBtn')}</button></div>
        <div class="track-intensity-block hybrid-branches-block" data-role="hybridBranchesBlock">
          <div class="track-intensity-label">${t('hybridGoToLabel')}</div>
          <div class="hybrid-branches" data-role="hybridBranches"></div>
        </div>
        <div class="hybrid-children" data-role="hybridChildren"></div>
      `}
     </div>
    </div>
  `;
  wrapper.querySelector('[data-role="titleToggle"]').addEventListener('click', () => {
    const details = wrapper.querySelector('[data-role="details"]');
    setDetailsExpanded(details, !details.classList.contains('expanded'));
  });
  return wrapper;
}

function initHybridPlayer(track, wrapper, elementColors) {
  const sections = hybridPlayableSections(track);
  const q = role => wrapper.querySelector(`[data-role="${role}"]`);
  const playBtn = q('playBtn'), playIcon = q('playIcon'), stopBtn = q('stopBtn'), details = q('details');
  const statusEl = q('status'), nextBtn = q('hybridNext'), childrenHost = q('hybridChildren'), branchesEl = q('hybridBranches');
  trackCollapsers[track.id] = () => setDetailsExpanded(details, false);
  if (!sections.length) { playIcon.classList.remove('loading-icon'); playIcon.innerHTML = HYBRID_PLAY_SVG; return; }
  const branchesBlock = q('hybridBranchesBlock'), mapNodes = q('hybridMapNodes'), mapLines = q('hybridMapLines'), mapCanvas = q('hybridMapCanvas');
  const visited = new Set();

  let cur = -1, playing = false, paused = false, ending = false;
  let pending = null; // { to, at, given } : passage annoncé par la section en cours ; given = la suivante est déjà programmée
  let queuedAt = null; // fin déjà annoncée par la section programmée, avant même qu'on l'entende (statique sans boucle, nombre de boucles)
  // Fichier de transition d'une section vers la suivante : joué au moment du passage, la section suivante démarre après. Un
  // embranchement peut avoir le sien, qui remplace celui de la section pour ce chemin.
  const transitionBuffers = sections.map(() => null);
  const branchBuffers = new Map();
  // Embranchements (comme le séquentiel) : boutons de la section en cours. La cible est une autre section ou « end » (fin du morceau).
  const indexOfSection = id => sections.findIndex(s => s.id === id);
  const branchesOf = i => (sections[i].branches || []).filter(b => b && (b.targetId === 'end' || indexOfSection(b.targetId) >= 0));
  let chosen = null, boundaryAt = null;
  // Retour libre (réglage du morceau, rangé sur chaque section faute de colonne dédiée) : toute section déjà jouée est atteignable,
  // en plus des embranchements prévus, sans changer le déroulement quand le visiteur ne choisit rien.
  const freeReturn = sections.length > 0 && (track.sections || []).every(s => s && s.freeReturn);
  const returnsOf = i => {
    if (!freeReturn) return [];
    const planned = new Set(branchesOf(i).map(b => b.targetId));
    return [...visited].filter(j => j !== i && !planned.has(sections[j].id)).map(j => ({ id: 'retour:' + sections[j].id, targetId: sections[j].id, label: '', switchMode: 'end', isReturn: true }));
  };
  const choicesOf = i => branchesOf(i).concat(returnsOf(i));
  let transitionsLoaded = false;
  let transitionSrc = null, resumeFresh = false;
  let timer = null, endedCb = null;

  const players = sections.map((sec, i) => {
    const child = hybridChildTrack(sec);
    const row = buildTrackRow(child, null, false, true);
    row.classList.add('hybrid-child', 'hybrid-child-offstage');
    childrenHost.appendChild(row);
    initTrackPlayer(child, row, elementColors, { concurrent: true, chain: { onFinalBoundary: at => onBoundary(i, at) } });
    return { row, control: row.lpControl };
  });

  function show(i) {
    players.forEach((p, n) => p.row.classList.toggle('hybrid-child-offstage', n !== i));
    if (i >= 0) visited.add(i);
    renderBranches();
    if (details.classList.contains('expanded')) setDetailsExpanded(details, true); // la hauteur suit celle de la section affichée
  }
  function renderBranches() {
    const planned = cur >= 0 ? branchesOf(cur) : (sections.length ? branchesOf(0) : []);
    const list = cur >= 0 ? choicesOf(cur) : planned;
    nextBtn.parentElement.style.display = planned.length ? 'none' : '';
    branchesBlock.style.display = list.length ? '' : 'none';
    branchesEl.innerHTML = list.map(b => `<button type="button" class="voice-refresh-btn hybrid-branch-btn${chosen && chosen.id === b.id ? ' is-chosen' : ''}" data-branch="${escapeHtml(b.id)}" aria-pressed="${chosen && chosen.id === b.id}"${!playing || (pending && pending.given) ? ' disabled' : ''}>${b.isReturn ? '↩' : '→'} ${escapeHtml(b.label || (b.targetId === 'end' ? t('hybridEndLabel') : (sections[indexOfSection(b.targetId)].label || sections[indexOfSection(b.targetId)].track.title || '')))}</button>`).join('');
  }
  function refreshNext() {
    const last = targetAfter(cur) < 0;
    nextBtn.disabled = !playing || cur < 0 || ending || !!pending;
    nextBtn.textContent = (ending || pending) ? t('hybridEndOfLoop') : t(last ? 'goToEndBtn' : 'goToNextSectionBtn');
    renderBranches();
    renderMap();
  }
  // Carte des chemins : une case par section, rangées par distance depuis la première ; les flèches suivent les embranchements (ou
  // l'ordre des sections quand une section n'en a pas). Clic sur une case atteignable = même effet que son bouton.
  const edgesFrom = i => {
    const list = branchesOf(i);
    if (list.length) return list.filter(b => b.targetId !== 'end').map(b => indexOfSection(b.targetId));
    return i + 1 < sections.length ? [i + 1] : [];
  };
  const NODE_W = 132, NODE_H = 40, GAP_X = 56, GAP_Y = 18;
  const mapPos = (() => {
    const depth = sections.map(() => -1);
    const queue = [0]; depth[0] = 0;
    while (queue.length) { const i = queue.shift(); edgesFrom(i).forEach(j => { if (depth[j] < 0) { depth[j] = depth[i] + 1; queue.push(j); } }); }
    let maxDepth = Math.max(0, ...depth);
    depth.forEach((d, i) => { if (d < 0) depth[i] = ++maxDepth; }); // section jamais atteinte : à la suite, pour qu'on la voie quand même
    const rows = {};
    return depth.map(d => { rows[d] = (rows[d] || 0) + 1; return { x: d * (NODE_W + GAP_X), y: (rows[d] - 1) * (NODE_H + GAP_Y) }; });
  })();
  mapCanvas.style.width = (Math.max(...mapPos.map(p => p.x)) + NODE_W) + 'px';
  mapCanvas.style.height = (Math.max(...mapPos.map(p => p.y)) + NODE_H + 24) + 'px';
  mapNodes.style.setProperty('--seq-map-node-w', NODE_W + 'px');
  mapNodes.style.setProperty('--seq-map-node-h', NODE_H + 'px');
  function reachableFromCur() { return playing && cur >= 0 && !(pending && pending.given) ? edgesFrom(cur).concat(returnsOf(cur).map(b => indexOfSection(b.targetId))) : []; }
  function renderMap() {
    const reach = reachableFromCur();
    const target = pending ? pending.to : (chosen && chosen.targetId !== 'end' ? indexOfSection(chosen.targetId) : -1);
    mapNodes.innerHTML = sections.map((sec, i) => {
      const cls = 'seq-map-node' + (i === cur ? ' current' : '') + (visited.has(i) && i !== cur ? ' visited' : '') + (reach.includes(i) && i !== target ? ' selectable' : '') + (i === target ? ' pending' : '');
      const check = visited.has(i) && i !== cur ? '<span class="seq-map-node-check">✓</span>' : '';
      return `<div class="${cls}" data-map-idx="${i}" style="left:${mapPos[i].x}px;top:${mapPos[i].y}px">${check}<span class="seq-map-node-label">${escapeHtml(sec.label || sec.track.title || '')}</span></div>`;
    }).join('');
    mapLines.innerHTML = sections.map((_, i) => edgesFrom(i).map(j => {
      const a = mapPos[i], b = mapPos[j];
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
      // Retour en arrière (ou sur la même colonne) : la flèche passe sous les cases.
      const d = x2 > x1 ? `M${x1},${y1} C${x1 + GAP_X / 2},${y1} ${x2 - GAP_X / 2},${y2} ${x2},${y2}`
        : `M${a.x + NODE_W / 2},${a.y + NODE_H} C${a.x + NODE_W / 2},${Math.max(a.y, b.y) + NODE_H + 22} ${b.x + NODE_W / 2},${Math.max(a.y, b.y) + NODE_H + 22} ${b.x + NODE_W / 2},${b.y + NODE_H}`;
      return `<path class="seq-map-edge" d="${d}"></path>`;
    }).join('')).join('');
  }
  renderMap();
  mapNodes.addEventListener('click', e => {
    const node = e.target.closest('.seq-map-node.selectable');
    if (!node) return;
    const idx = Number(node.dataset.mapIdx);
    const branch = choicesOf(cur).find(b => indexOfSection(b.targetId) === idx);
    if (branch) branchesEl.querySelector(`[data-branch="${CSS.escape(branch.id)}"]`).click();
    else if (!nextBtn.disabled) nextBtn.click();
  });
  // Section qui suit `i` : le choix du visiteur, sinon la section par défaut, sinon la suivante dans l'ordre. -1 = fin du morceau.
  function targetAfter(i) {
    if (i < 0) return 0;
    const sec = sections[i];
    if (chosen) return chosen.targetId === 'end' ? -1 : indexOfSection(chosen.targetId);
    if (branchesOf(i).length) return sec.defaultNext && sec.defaultNext !== 'end' && indexOfSection(sec.defaultNext) >= 0 ? indexOfSection(sec.defaultNext) : -1;
    return i + 1 < sections.length ? i + 1 : -1;
  }
  function setPlayUI() {
    playIcon.innerHTML = playing ? HYBRID_PAUSE_SVG : HYBRID_PLAY_SVG;
    stopBtn.style.display = (playing || paused) ? '' : 'none';
    statusEl.textContent = t(playing ? 'playingStatus' : paused ? 'pausedStatus' : 'readyStatus');
    refreshNext();
  }
  function onBoundary(i, at) {
    if (pending && pending.given && pending.to === i) { queuedAt = at; return; }
    if (i !== cur || !playing) return;
    boundaryAt = at;
    planFrom(i, at);
  }
  // Prépare le passage depuis la section `i`, qui finit à `at` (recalculé si le visiteur change d'embranchement entre-temps).
  function planFrom(i, at) {
    const to = targetAfter(i);
    pending = null;
    ending = to < 0;
    if (!ending) {
      const own = chosen && branchBuffers.get(chosen.id);
      const buf = own || transitionBuffers[i];
      const trans = own ? chosen.transition : sections[i].transition;
      if (buf) {
        // Durée en mesures au tempo de la section suivante (la fin du fichier peut alors chevaucher son début), sinon le fichier entier.
        const tt = trackTempo(sections[to].track);
        const dur = trans.bars ? trans.bars * tt.beatsPerBar * tt.secondsPerBeat : buf.duration;
        pending = { to, at: at + dur, given: false, transAt: at, transBuf: buf };
      } else pending = { to, at, given: false };
    }
    refreshNext();
  }
  // viaPassage : on arrive depuis une autre section. Seul le tout premier départ joue l'intro : par un passage (section suivante,
  // embranchement, retour), le morceau démarre directement à son point d'entrée de boucle (ou sans son fichier d'intro).
  function startSection(i, when, viaPassage) {
    players[i].control.onEnded(() => onSectionEnded(i));
    players[i].control.startAt(when, !!viaPassage);
  }
  function onSectionEnded(i) {
    // La dernière section a fini de sonner. Une section qui s'arrête sans avoir annoncé de passage ne bloque pas la suite.
    if (i !== cur || !playing || (pending && pending.given)) return; // la suivante est déjà en route : simple queue qui s'éteint
    const to = targetAfter(i);
    if (to >= 0) { pending = null; chosen = null; startSection(to, startSoon(), true); cur = to; show(cur); refreshNext(); return; }
    stopAll();
    if (endedCb) { const cb = endedCb; endedCb = null; try { cb(); } catch (e) { /* jamais bloquant */ } }
  }
  function tick() {
    if (!pending || !playing) return;
    const now = ctx.currentTime;
    if (pending.transBuf && pending.transAt - now < HYBRID_HANDOFF_LEAD_SEC) {
      transitionSrc = ctx.createBufferSource();
      transitionSrc.buffer = pending.transBuf;
      transitionSrc.connect(ctx.destination);
      transitionSrc.start(Math.max(pending.transAt, now + 0.005));
      pending.transBuf = null;
    }
    if (!pending.given && pending.at - now < HYBRID_HANDOFF_LEAD_SEC) {
      pending.given = true;
      startSection(pending.to, pending.at, true);
    }
    if (pending.given && now >= pending.at) {
      cur = pending.to;
      pending = null;
      chosen = null;
      boundaryAt = null;
      show(cur);
      if (queuedAt != null) { const at = queuedAt; queuedAt = null; onBoundary(cur, at); }
      refreshNext();
    }
  }
  function startChain() {
    if (activeTrackId && activeTrackId !== track.id) {
      document.dispatchEvent(new CustomEvent('stop-track', { detail: activeTrackId }));
      if (trackStingerKillers[activeTrackId]) trackStingerKillers[activeTrackId]();
    }
    Object.keys(trackCollapsers).forEach(id => { if (id !== track.id) trackCollapsers[id](); });
    activeTrackId = track.id;
    resumeAudioContext();
    setDetailsExpanded(details, true);
  }
  function play() {
    startChain();
    if (paused) {
      paused = false;
      playing = true;
      if (resumeFresh) { resumeFresh = false; startSection(cur, startSoon(), true); show(cur); } // pause pendant une transition : on repart sur la suite
      else players[cur].control.resume(); // annonce de nouveau son passage s'il était demandé
    } else {
      playing = true;
      ending = false;
      pending = null;
      queuedAt = null;
      chosen = null;
      cur = 0;
      trackPublicEvent('track_play', { trackId: track.id, mode: track.mode });
      startSection(0, startSoon());
      show(0);
    }
    if (!timer) timer = setInterval(tick, 100);
    setPlayUI();
  }
  function stopTransition() {
    if (transitionSrc) { try { transitionSrc.stop(); } catch (e) {} transitionSrc = null; }
  }
  function pause() {
    // Une section programmée mais pas encore entendue est annulée : le passage sera recalculé à la reprise.
    if (pending && pending.given) players[pending.to].control.reset();
    stopTransition();
    if (pending && pending.transAt != null && ctx.currentTime >= pending.transAt) { players[cur].control.reset(); cur = pending.to; resumeFresh = true; }
    pending = null;
    queuedAt = null;
    chosen = null;
    ending = false;
    players.forEach((p, n) => { if (n !== cur) p.control.reset(); });
    if (!resumeFresh) players[cur].control.pause();
    playing = false;
    paused = true;
    clearInterval(timer); timer = null;
    setPlayUI();
  }
  function stopAll() {
    if (timer) { clearInterval(timer); timer = null; }
    players.forEach(p => p.control.reset());
    stopTransition();
    resumeFresh = false;
    if (playing || paused) trackPublicEvent('track_stop', { trackId: track.id, mode: track.mode });
    playing = false; paused = false; ending = false; pending = null; queuedAt = null; chosen = null; cur = -1;
    visited.clear();
    if (activeTrackId === track.id) activeTrackId = null;
    setPlayUI();
  }

  playBtn.addEventListener('click', () => { playing ? pause() : play(); });
  stopBtn.addEventListener('click', () => { stopAll(); });
  nextBtn.addEventListener('click', () => {
    if (!playing || cur < 0) return;
    trackPublicEvent('hybrid_next', { trackId: track.id, sectionIndex: cur });
    const sec = sections[cur];
    // Aller vers la fin (aucune section après) : on laisse finir la boucle et sonner sa queue, sans couper.
    if (targetAfter(cur) < 0) players[cur].control.finishAtLoopEnd();
    else players[cur].control.finishAt(sec.switchMode || 'end', sec.transitionPoints, sec.fadeSec != null ? sec.fadeSec : 0.5);
    nextBtn.disabled = true;
    nextBtn.textContent = t('hybridEndOfLoop');
  });
  branchesEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-branch]');
    if (!btn || !playing || cur < 0 || (pending && pending.given)) return;
    const branch = choicesOf(cur).find(b => b.id === btn.dataset.branch);
    if (!branch) return;
    const first = !chosen && !pending && !ending;
    chosen = branch;
    trackPublicEvent('hybrid_branch', { trackId: track.id, sectionIndex: cur, branchId: branch.id });
    // Premier choix : la section reçoit l'ordre de finir (fin de section ou prochain point de transition). Un nouveau choix avant le
    // passage change seulement la destination, au même instant.
    if (first) {
      const sec = sections[cur];
      if (branch.targetId === 'end') players[cur].control.finishAtLoopEnd(); // fin du morceau : la queue sonne jusqu'au bout
      else players[cur].control.finishAt(branch.switchMode === 'point' ? 'point' : 'end', sec.transitionPoints, sec.fadeSec != null ? sec.fadeSec : 0.5);
    } else if (boundaryAt != null) planFrom(cur, boundaryAt);
    refreshNext();
  });
  document.addEventListener('stop-track', e => { if (e.detail === track.id) { stopAll(); } });

  // Le bouton Lecture s'active quand TOUTES les sections sont chargées : un passage ne peut pas attendre un téléchargement.
  const isReady = () => transitionsLoaded && players.every(p => p.control.isReady());
  const loadTransition = async tr => {
    if (!tr || !(tr.localFile || tr.localUrl || tr.file)) return null;
    try {
      const ab = tr.localFile ? await tr.localFile.arrayBuffer()
        : tr.localUrl ? await (await fetch(tr.localUrl)).arrayBuffer()
        : await (await fetchAudio(track.base + encodeURIComponent(tr.file) + (track.publishedAt ? '?v=' + encodeURIComponent(track.publishedAt) : ''), track.protected)).arrayBuffer();
      return await decodeAudioCompat(ab);
    } catch (e) { console.warn('Transition illisible, passage direct :', e); return null; }
  };
  Promise.all(sections.map(async (sec, i) => {
    transitionBuffers[i] = await loadTransition(sec.transition);
    await Promise.all(branchesOf(i).map(async b => { const buf = await loadTransition(b.transition); if (buf) branchBuffers.set(b.id, buf); }));
  })).then(() => { transitionsLoaded = true; });
  const readyTimer = setInterval(() => {
    if (!isReady()) return;
    clearInterval(readyTimer);
    playBtn.disabled = false;
    playBtn.setAttribute('aria-label', t('playAriaLabel'));
    playIcon.classList.remove('loading-icon');
    playIcon.innerHTML = HYBRID_PLAY_SVG;
    show(0);
    setPlayUI();
  }, 100);

  // Même pilotage que les autres lecteurs (Carte de niveau, écoute aléatoire des albums) : pas de niveaux ni d'emplacements à piloter.
  wrapper.lpControl = {
    start() { if (!playing) play(); },
    stop() { stopAll(); },
    isReady, isPlaying: () => playing, onEnded(cb) { endedCb = cb; },
    elapsed: () => 0, nextBoundary: () => null, setLevel() {},
    canRefreshPool: () => false, refreshPool: () => false,
    layerCount: () => 0, layerKind: () => 'layers', layerLabels: () => null, layerAuto: () => 0, intensityLevel: () => 0, setIntensity() {},
    sequenceCount: () => 0, sequenceLabels: () => null, sequenceCurrent: () => -1, sequenceReachable: () => [], sequencePending: () => -1, goToSequence: () => false,
  };
}
