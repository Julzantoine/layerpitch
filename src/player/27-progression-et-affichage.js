  // En cas d'échec de chargement : arrête l'icône qui tourne (elle donnerait l'impression que ça continue
  // de charger indéfiniment) et affiche un repère visuel statique d'erreur, cohérent avec le texte de
  // statut déjà présent dans le panneau déplié.
  function setLoadErrorIcon() {
    playIcon.classList.remove('loading-icon');
    playIcon.classList.add('error-icon');
    playIcon.innerHTML = '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v6"/><circle cx="12" cy="16.7" r="0.9" fill="currentColor" stroke="none"/>';
    playBtn.setAttribute('aria-label', t('loadErrorAriaLabel'));
  }

  function updateStingerAvailability() {
    const expanded = details.classList.contains('expanded');
    setStingerButtonsEnabled(expanded && ready);
  }

  function setStingerButtonsEnabled(enabled) {
    stingerBtns.forEach(b => { b.disabled = !enabled; });
    fxTriggerBtns.forEach(b => { b.disabled = !enabled; });
    fxSliderInputs.forEach(i => { i.disabled = !enabled; });
  }
  function killStingers() {
    activeStingerSources.forEach(s => { try { s.stop(); } catch(e){} });
    activeStingerSources = [];
  }
  trackCollapsers[track.id] = () => { setDetailsExpanded(details, false); updateStingerAvailability(); };
  trackStingerKillers[track.id] = killStingers;

  function updateProgressAt(elapsed) {
    if (!wrap) return;
    const pct = (elapsed / progressMaxSec()) * 100;
    if (fill) fill.style.width = pct + '%';
    if (head) head.style.left = pct + '%';
    if (waveformFg) waveformFg.style.clipPath = `inset(0 ${Math.max(0, 100 - pct)}% 0 0)`;
    // Mode vertical additif : toutes les lignes (une par couche) avancent en même temps.
    vertLayerRows.forEach(btn => { const f = btn.querySelector('.vert-wave-fg'); if (f) f.style.clipPath = `inset(0 ${Math.max(0, 100 - pct)}% 0 0)`; });
    timeCurrent.textContent = formatTime(elapsed);
  }
  // Repères de boucle sur la forme d'onde (moteur quantifié) : entrée, sortie et queue du fichier, placés en % de sa durée
  // (la forme d'onde reste entière : la queue doit rester visible). Posés dès que la durée est connue.
  const loopOverlayEl = wrapper.querySelector('[data-role="loopOverlay"]');
  const loopTailEl = wrapper.querySelector('[data-role="loopTail"]');
  const loopMarkInEl = wrapper.querySelector('[data-role="loopMarkIn"]');
  const loopMarkOutEl = wrapper.querySelector('[data-role="loopMarkOut"]');
  const tailHeadEls = []; // deuxième tête(s) de lecture : la queue de la boucle précédente, en train d'être jouée
  function layoutLoopMarkers() {
    if (!loopOverlayEl || !useQuantizedLoop) return;
    const m = quantizedLoopMarkers({ loopInSec, loopOutSec }, progressMaxSec());
    if (!m) return;
    if (loopMarkInEl) { loopMarkInEl.hidden = m.loopInPct == null; if (m.loopInPct != null) loopMarkInEl.style.left = m.loopInPct + '%'; }
    if (loopMarkOutEl) { loopMarkOutEl.hidden = !m.hasTail && m.loopOutPct >= 99.5; loopMarkOutEl.style.left = m.loopOutPct + '%'; }
    if (loopTailEl) { loopTailEl.hidden = !m.hasTail; loopTailEl.style.left = m.tailStartPct + '%'; }
  }
  layoutLoopMarkers();
  function updateTailHeads() {
    if (!loopOverlayEl || !useQuantizedLoop) return;
    const dur = progressMaxSec();
    const positions = (playing && dur > 0) ? quantizedTailPositions(scheduledGens, ctx.currentTime, dur) : [];
    positions.forEach((sec, i) => {
      let el = tailHeadEls[i];
      if (!el) {
        el = document.createElement('div');
        el.className = 'progress-tail-head';
        el.title = t('loopTailHeadTitle');
        loopOverlayEl.appendChild(el);
        tailHeadEls[i] = el;
      }
      el.hidden = false;
      el.style.left = ((sec / dur) * 100) + '%';
    });
    for (let i = positions.length; i < tailHeadEls.length; i++) tailHeadEls[i].hidden = true;
  }
  function computeElapsed() {
    return (useQuantizedLoop || isVerticalRandom)
      ? currentPlaybackOffset()
      : (loops ? ((ctx.currentTime - startedAt) * trackPitchRatio) % track.duration : Math.min((ctx.currentTime - startedAt) * trackPitchRatio, track.duration));
  }
  function tick() {
    if (!playing || isSequential || isEmbrVert) return;
    const elapsed = computeElapsed();
    updateTailHeads();
    if (isDraggingSeek) { rafId = requestAnimationFrame(tick); return; } // laisse la position glissée visible, ne pas l'écraser
    updateProgressAt(elapsed);
    if (vertMeterFills.length) {
      const gainArr = useQuantizedLoop ? currentGainNodes : gains;
      vertMeterFills.forEach((fillEl, i) => {
        if (!fillEl) return;
        const g = gainArr[i];
        const v = g ? Math.min(1, Math.max(0, g.gain.value)) : 0;
        fillEl.style.width = Math.round(v * 100) + '%';
      });
    }
    if (isVerticalRandom) {
      // Toutes les voix d'une même section redémarrent ensemble à chaque cycle (même scheduler partagé) :
      // une seule fraction de progression suffit à synchroniser le recouvrement de toutes les waveforms —
      // recalculée sur le tempo/timeline de la section EN COURS, plus un cycle unique pour tout le morceau.
      const origIdx = vrCurrentSectionOriginalIndex >= 0 ? vrCurrentSectionOriginalIndex : (playableSectionOriginalIndex[0] !== undefined ? playableSectionOriginalIndex[0] : -1);
      const currentSection = origIdx >= 0 ? resolveVRSection(track, origIdx) : null;
      if (currentSection) {
        const timing = sectionTiming(currentSection);
        const frac = timing.cycleLength > 0 ? Math.min(1, Math.max(0, (elapsed - timing.loopInSec) / timing.cycleLength)) : 0;
        const clip = `inset(0 ${(1 - frac) * 100}% 0 0)`;
        voiceWavePools.forEach(els => { if (els && els.fg) els.fg.style.clipPath = clip; });
        if (!vrIsDraggingSeek && vrBlockFillEls[origIdx]) vrBlockFillEls[origIdx].style.width = (frac * 100) + '%';
      }
    }
    rafId = requestAnimationFrame(tick);
  }
  function setStoppedUI() {
    updateTailHeads(); // plus rien ne joue : la deuxième tête disparaît
    pauseTake(); // pause, arrêt ou fin naturelle : le temps d'écoute de la prise s'arrête là
    if (!lpManualStop && lpEndedCb) { const cb = lpEndedCb; lpEndedCb = null; try { cb(); } catch (e) { console.warn('fin de morceau :', e); } } // fin naturelle seulement
    playIcon.innerHTML = PLAY_SVG;
    if (statusEl) statusEl.textContent = t('pausedStatus');
    updateStopBtn();
  }

