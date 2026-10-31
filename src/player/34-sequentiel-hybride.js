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
    const layers = child.layers || [];
    return layerHasSource(layers[0]) && (child.mode === 'static' || layers.every(layerHasSource));
  });
}
function hybridChildTrack(sec) {
  // Boucles : 0 = sans limite, vide = le réglage du morceau lui-même.
  const maxLoops = sec.maxLoops === 0 ? null : (sec.maxLoops || sec.track.maxLoops || null);
  return Object.assign({}, sec.track, { id: sec.track.id + '~' + sec.id, maxLoops });
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
        <div class="seq-blocks hybrid-blocks" data-role="hybridBlocks">
          ${sections.map(sec => `<div class="seq-block"><span class="seq-block-label">${escapeHtml(sec.label || sec.track.title || '')}</span></div>`).join('')}
        </div>
        <div><button type="button" class="voice-refresh-btn" data-role="hybridNext" disabled>${t('goToNextSectionBtn')}</button></div>
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
  const statusEl = q('status'), nextBtn = q('hybridNext'), childrenHost = q('hybridChildren');
  trackCollapsers[track.id] = () => setDetailsExpanded(details, false);
  if (!sections.length) { playIcon.classList.remove('loading-icon'); playIcon.innerHTML = HYBRID_PLAY_SVG; return; }
  const blocks = [...q('hybridBlocks').children];

  let cur = -1, playing = false, paused = false, ending = false;
  let pending = null; // { to, at, given } : passage annoncé par la section en cours ; given = la suivante est déjà programmée
  let queuedAt = null; // fin déjà annoncée par la section programmée, avant même qu'on l'entende (statique sans boucle, nombre de boucles)
  // Fichier de transition d'une section vers la suivante : joué au moment du passage, la section suivante démarre après.
  const transitionBuffers = sections.map(() => null);
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
    blocks.forEach((b, n) => b.classList.toggle('active', n === i));
    if (details.classList.contains('expanded')) setDetailsExpanded(details, true); // la hauteur suit celle de la section affichée
  }
  function refreshNext() {
    const last = cur === sections.length - 1;
    nextBtn.disabled = !playing || cur < 0 || ending || !!pending;
    nextBtn.textContent = (ending || pending) ? t('hybridEndOfLoop') : t(last ? 'goToEndBtn' : 'goToNextSectionBtn');
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
    if (i === sections.length - 1) ending = true;
    else {
      const buf = transitionBuffers[i];
      const trans = sections[i].transition;
      if (buf) {
        // Durée en mesures au tempo de la section suivante (la fin du fichier peut alors chevaucher son début), sinon le fichier entier.
        const tt = trackTempo(sections[i + 1].track);
        const dur = trans.bars ? trans.bars * tt.beatsPerBar * tt.secondsPerBeat : buf.duration;
        pending = { to: i + 1, at: at + dur, given: false, transAt: at, transBuf: buf };
      } else pending = { to: i + 1, at, given: false };
    }
    refreshNext();
  }
  function startSection(i, when) {
    players[i].control.onEnded(() => onSectionEnded(i));
    players[i].control.startAt(when);
  }
  function onSectionEnded(i) {
    // La dernière section a fini de sonner. Une section qui s'arrête sans avoir annoncé de passage ne bloque pas la suite.
    if (i !== cur || !playing || (pending && pending.given)) return; // la suivante est déjà en route : simple queue qui s'éteint
    if (i < sections.length - 1) { pending = null; startSection(i + 1, startSoon()); cur = i + 1; show(cur); refreshNext(); return; }
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
      startSection(pending.to, pending.at);
    }
    if (pending.given && now >= pending.at) {
      cur = pending.to;
      pending = null;
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
      if (resumeFresh) { resumeFresh = false; startSection(cur, startSoon()); show(cur); } // pause pendant une transition : on repart sur la suite
      else players[cur].control.resume(); // annonce de nouveau son passage s'il était demandé
    } else {
      playing = true;
      ending = false;
      pending = null;
      queuedAt = null;
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
    playing = false; paused = false; ending = false; pending = null; queuedAt = null; cur = -1;
    blocks.forEach(b => b.classList.remove('active'));
    if (activeTrackId === track.id) activeTrackId = null;
    setPlayUI();
  }

  playBtn.addEventListener('click', () => { playing ? pause() : play(); });
  stopBtn.addEventListener('click', () => { stopAll(); });
  nextBtn.addEventListener('click', () => {
    if (!playing || cur < 0) return;
    trackPublicEvent('hybrid_next', { trackId: track.id, sectionIndex: cur });
    const sec = sections[cur];
    players[cur].control.finishAt(sec.switchMode || 'end', sec.transitionPoints, sec.fadeSec != null ? sec.fadeSec : 0.5);
    nextBtn.disabled = true;
    nextBtn.textContent = t('hybridEndOfLoop');
  });
  document.addEventListener('stop-track', e => { if (e.detail === track.id) { stopAll(); } });

  // Le bouton Lecture s'active quand TOUTES les sections sont chargées : un passage ne peut pas attendre un téléchargement.
  const isReady = () => transitionsLoaded && players.every(p => p.control.isReady());
  Promise.all(sections.map(async (sec, i) => {
    const tr = sec.transition;
    if (i === sections.length - 1 || !tr || !(tr.localFile || tr.localUrl || tr.file)) return;
    try {
      const ab = tr.localFile ? await tr.localFile.arrayBuffer()
        : tr.localUrl ? await (await fetch(tr.localUrl)).arrayBuffer()
        : await (await fetchAudio(track.base + encodeURIComponent(tr.file) + (track.publishedAt ? '?v=' + encodeURIComponent(track.publishedAt) : ''), track.protected)).arrayBuffer();
      transitionBuffers[i] = await decodeAudioCompat(ab);
    } catch (e) { console.warn('Transition illisible, passage direct :', e); }
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
