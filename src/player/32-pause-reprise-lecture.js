  function captureResumeState() {
    if (isSequential) {
      const b = currentSeqBlockInfo;
      if (!b) { pausedResume = null; return; }
      pausedResume = {
        kind: 'sequential',
        blockKind: b.kind, buffer: b.buffer, gain: b.gain, totalSec: b.totalSec, terminal: b.terminal, slotIdx: b.slotIdx,
        offsetSec: Math.max(0, Math.min(b.totalSec - 0.05, ctx.currentTime - b.virtualZero)),
        label: seqCurrentEl ? seqCurrentEl.textContent : '',
        descHtml: trackDescEl ? trackDescEl.innerHTML : '',
        goToEndRequested, pendingNextSegmentId
      };
    } else if (isEmbrVert) {
      pausedResume = { kind: 'embrVert', embrLoopIdx: embrActiveLoopIdx >= 0 ? embrActiveLoopIdx : embrReferenceIdx };
    } else if (isVerticalRandom) {
      if (vrCurrentSectionOriginalIndex < 0) { pausedResume = null; return; }
      const origIdx = vrCurrentSectionOriginalIndex;
      const section = resolveVRSection(track, origIdx);
      const timing = sectionTiming(section);
      const elapsed = currentPlaybackOffset();
      const frac = timing.cycleLength > 0 ? Math.min(1, Math.max(0, (elapsed - timing.loopInSec) / timing.cycleLength)) : 0;
      pausedResume = { kind: 'verticalRandom', origIdx, frac };
    } else {
      pausedResume = null;
    }
  }
  // Reprend précisément l'état capturé par captureResumeState() ci-dessus. Appelée par playThisTrack() une
  // fois que playing/activeTrackId/etc. sont déjà remis à jour — reprend le rôle que jouerait normalement
  // playSequential()/playEmbrVertical()/playVerticalRandom() pour un vrai (re)démarrage.
  function resumeFromPause() {
    const r = pausedResume; pausedResume = null;
    if (!r) return false;
    if (r.kind === 'sequential') {
      goToEndRequested = r.goToEndRequested;
      pendingNextSegmentId = r.pendingNextSegmentId;
      const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
      const remaining = Math.max(0.05, r.totalSec - r.offsetSec);
      // `remaining` transmis TOUJOURS (jamais null), y compris pour un bloc terminal (l'outro) — même
      // raison que seekSequential() ci-dessus : passer null ferait recaler le remplissage visuel sur
      // buffer.duration (durée totale) plutôt que ce qu'il en reste après la reprise.
      scheduleSeqGeneration(now, r.buffer, r.label, r.blockKind, remaining, r.gain, r.offsetSec, r.totalSec, r.terminal, r.slotIdx);
      if (trackDescEl) trackDescEl.innerHTML = r.descHtml;
      if (r.terminal) {
        armSeqFinalEnd();
        if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('endingWithOutro'); }
      } else {
        seqNextStartCtxTime = now + remaining / trackPitchRatio;
        seqSchedulerTimer = setInterval(seqSchedulerTick, 200);
        if (goToEndBtn) {
          if (goToEndRequested) {
            goToEndBtn.disabled = true;
            goToEndBtn.textContent = track.outro ? t('endingWithOutro') : t('endingLastSegment');
          } else {
            goToEndBtn.disabled = false;
          }
        }
      }
    } else if (r.kind === 'embrVert') {
      embrActiveLoopIdx = r.embrLoopIdx;
      const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
      embrClockReset(now, 0);
      scheduleEmbrGeneration(now, true);
      embrNextStartCtxTime = now + embrCycleLengthSec() / trackPitchRatio;
      embrSchedulerTimer = setInterval(embrSchedulerTick, 200);
      updateEmbrButtonsUI();
      applyEmbrWaveAnimation();
    } else if (r.kind === 'verticalRandom') {
      vrCurrentSectionOriginalIndex = r.origIdx;
      const declaredSection = (track.sections || [])[r.origIdx];
      if (sectionCurrentEl) sectionCurrentEl.textContent = (declaredSection && declaredSection.label) || t('sectionFallback', { n: r.origIdx + 1 });
      vrBlockEls.forEach((el, i) => { if (el) el.classList.toggle('active', i === r.origIdx); });
      seekVerticalRandom(r.frac);
    }
    return true;
  }
  // Repeint par-dessus l'UI que stopAllSources() vient de remettre à plat (libellé "—", bloc/boucle/section
  // désactivés) avec l'état figé au moment de la pause, capturé juste avant par captureResumeState() —
  // pour qu'une pause manuelle donne l'impression de vraiment "geler" l'affichage plutôt que de l'effacer
  // puis de le faire réapparaître à la reprise (peaufinage demandé le 10/09 par Jules-Antoine). Purement
  // visuel : aucune de ces valeurs ne relance quoi que ce soit tant que playing reste false.
  function applyPausedUI() {
    const r = pausedResume;
    if (!r) return;
    if (r.kind === 'sequential') {
      if (seqCurrentEl) seqCurrentEl.textContent = r.label;
      if (trackDescEl) trackDescEl.innerHTML = r.descHtml;
      const block = seqBlockEls[r.blockKind], els = seqWaveEls[r.blockKind];
      if (block) { block.classList.remove('done'); block.classList.add('active'); }
      if (els && els.fg) {
        const frac = r.totalSec > 0 ? Math.max(0, Math.min(1, r.offsetSec / r.totalSec)) : 0;
        els.fg.style.transition = 'none';
        els.fg.style.clipPath = `inset(0 ${(1 - frac) * 100}% 0 0)`;
      }
      if (r.slotIdx != null && r.slotIdx >= 0) updateSeqMap(r.slotIdx);
    } else if (r.kind === 'embrVert') {
      embrLoopBtns.forEach(btn => { btn.classList.toggle('active', parseInt(btn.dataset.loopIdx, 10) === r.embrLoopIdx); });
    } else if (r.kind === 'verticalRandom') {
      const declaredSection = (track.sections || [])[r.origIdx];
      if (sectionCurrentEl) sectionCurrentEl.textContent = (declaredSection && declaredSection.label) || t('sectionFallback', { n: r.origIdx + 1 });
      vrBlockEls.forEach((el, i) => { if (el) el.classList.toggle('active', i === r.origIdx); });
      if (vrBlockFillEls[r.origIdx]) vrBlockFillEls[r.origIdx].style.width = (r.frac * 100) + '%';
    }
  }
  // Stop (25/09, demande de Jules-Antoine) : contrairement à Pause, oublie la position -- la prochaine
  // lecture est un vrai démarrage (intro, premier emplacement/section, boucle de référence, offset 0) et
  // ouvre une nouvelle prise. Le bouton n'est visible que lorsqu'il y a quelque chose à arrêter (lecture
  // en cours ou pause en milieu de morceau).
  function stopThisTrack() {
    pausedResume = null;
    stopAllSources(false);
    // Moteur quantifié : la position de départ est le point de départ réglé par le compositeur (startTrackBeat), pas
    // le tout début du fichier -- comme au tout premier chargement et après une fin naturelle.
    offsetAt = useQuantizedLoop ? startTrackSec : 0;
    updateProgressAt(offsetAt);
    if (take) take.resumable = false;
    if (statusEl) statusEl.textContent = t('readyStatus');
    if (activeTrackId === track.id) activeTrackId = null;
    trackPublicEvent('track_stop', { trackId: track.id, mode: track.mode });
    updateStopBtn();
  }
  function updateStopBtn() {
    if (stopBtn) stopBtn.style.display = (playing || pausedResume || offsetAt > (useQuantizedLoop ? startTrackSec : 0)) ? '' : 'none'; // pas l'attribut hidden : .play-btn impose display:flex
  }
  function pauseThisTrack() {
    captureResumeState();
    stopAllSources();
    applyPausedUI();
    // Prise : seule une vraie pause se reprend dans la même prise (une fin naturelle ou un autre morceau lancé entre-temps
    // en ouvriront une nouvelle au prochain démarrage). Pas pausedResume : le moteur simple reprend sans lui (offsetAt).
    if (take) take.resumable = true;
  }
  function stopAllSources(keepPosition) {
    lpManualStop = true; // arrêt demandé : pas une fin naturelle (voir setStoppedUI)
    playing = false;
    playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
    // Annule toute rampe de ducking en cours et revient à 1 immédiatement — sinon une prochaine lecture
    // pourrait démarrer avec un gain maître encore abaissé (ou en cours de remontée programmée dans le
    // futur) si le morceau est arrêté pile pendant qu'un Sfx joue.
    trackMasterGain.gain.cancelScheduledValues(ctx.currentTime);
    trackMasterGain.gain.setValueAtTime(1, ctx.currentTime);
    if (isSequential) {
      stopSequential();
    } else if (isEmbrVert) {
      stopEmbrVertical();
    } else if (isVerticalRandom) {
      // Comme le séquentiel, la reprise après pause/veille passe par l'état déjà conservé du scheduler
      // (sectionScheduler persiste tant que la piste n'est pas complètement relancée) — jamais par
      // offsetAt, qui n'a plus de sens unique sur plusieurs sections potentiellement enchaînées.
      stopVerticalRandom();
    } else if (useQuantizedLoop) {
      if (keepPosition !== false) {
        offsetAt = currentPlaybackOffset();
      }
      stopQuantized();
    } else {
      stopSimple(keepPosition);
    }
    cancelAnimationFrame(rafId);
    vertMeterFills.forEach(el => { if (el) { el.style.transition = 'none'; el.style.width = '0%'; } });
    setStoppedUI();
  }
  function naturalEnd() {
    playing = false;
    playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
    trackMasterGain.gain.cancelScheduledValues(ctx.currentTime);
    trackMasterGain.gain.setValueAtTime(1, ctx.currentTime);
    cancelAnimationFrame(rafId);
    offsetAt = 0;
    updateProgressAt(0);
    setStoppedUI();
    if (activeTrackId === track.id) activeTrackId = null;
  }
  let lpPlayStartedAt = 0; // instant (horloge audio) du dernier vrai départ : repère de la grille musicale pour la Carte de niveau
  function playThisTrack(reroll, isContinuation) {
    if (!concurrent) {
      if (activeTrackId && activeTrackId !== track.id) {
        document.dispatchEvent(new CustomEvent('stop-track', { detail: activeTrackId }));
        if (trackStingerKillers[activeTrackId]) trackStingerKillers[activeTrackId]();
      }
      Object.keys(trackCollapsers).forEach(id => {
        if (id !== track.id) trackCollapsers[id]();
      });
      activeTrackId = track.id;
    }
    lpPlayStartedAt = ctx.currentTime;
    lpManualStop = false;
    setDetailsExpanded(details, true);
    updateStingerAvailability();
    resumeAudioContext();
    playing = true;
    playingTrackIds.add(track.id); requestWakeLock();
    // Un curseur d'intensité repart de sa position de départ (comme resetFxTriggers juste après) : on cale le niveau AVANT de
    // l'annoncer, pour que la capture parte de la bonne intensité.
    if (!isContinuation && !pausedResume && fxStructureSlider && track.mode === 'vertical') level = fxZoneOfValue(fxStructureSlider.def);
    // Capture vidéo : niveau d'intensité de départ (le visiteur a pu le choisir avant d'appuyer sur Lecture).
    if (!isContinuation) trackPublicEvent('track_play', { trackId: track.id, mode: track.mode }, { level });
    if (!isContinuation && !pausedResume) resetFxTriggers();
    // Prise (Figer) : un vrai démarrage en ouvre une nouvelle ; une reprise, un saut ou un retour de veille continue la
    // même (le journal note ce qui est réellement rejoué, quel que soit le chemin pris par le moteur).
    if (isContinuation || (take && take.resumable)) resumeTake(); else startTake();
    if (pausedResume && resumeFromPause()) {
      // Reprise exacte après un vrai Pause manuel — voir captureResumeState()/resumeFromPause() ci-dessus.
    } else if (isSequential) {
      playSequential(isContinuation);
    } else if (isEmbrVert) {
      playEmbrVertical();
    } else if (isVerticalRandom) {
      playVerticalRandom(isContinuation);
    } else if (useQuantizedLoop) {
      // Un vrai démarrage à froid réinitialise le budget de boucles (le premier passage compte déjà comme 1) ;
      // un reroll ou une recherche en cours de lecture (isContinuation) ne remet pas le compteur à zéro et ne l'avance pas non plus.
      // Note : on ne peut pas déduire ça de `playing`, qui est déjà retombé à false par le stopAllSources(false)
      // que ces deux appelants font juste avant — d'où ce paramètre explicite plutôt qu'une lecture d'état ambiant.
      if (!isContinuation) loopsPlayed = 1;
      playQuantized(offsetAt % track.duration);
    } else {
      playSimple();
    }
    playIcon.innerHTML = PAUSE_SVG;
    if (statusEl) statusEl.textContent = t('playingStatus');
    updateStopBtn();
    tick();
  }

  function rerollPool() {
    if (!isVerticalRandom) return;
    trackPublicEvent('pool_refresh', { trackId: track.id });
    if (!playing || vrCurrentSectionOriginalIndex < 0) {
      Object.keys(lastPickedPoolIndex).forEach(k => { lastPickedPoolIndex[k] = -1; });
      return;
    }
    // Rejoue la MÊME section avec de nouveaux tirages, sans faire avancer la chaîne d'un cran (contrairement
    // à un vrai changement de section) — n'arrête donc que les sources en cours, pas le scheduler pur
    // sous-jacent (sectionScheduler), dont l'état de progression reste intact.
    const origIdx = vrCurrentSectionOriginalIndex;
    if (vrSchedulerTimer) { clearInterval(vrSchedulerTimer); vrSchedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch (e) {} });
    activeGenSources = [];
    voiceGraphTimeouts.forEach(id => clearTimeout(id));
    voiceGraphTimeouts = [];
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    vrPendingCut = true;
    const timing = scheduleSectionGeneration(now, origIdx, false);
    vrNextStartCtxTime = now + timing.cycleLength / trackPitchRatio;
    vrSchedulerTimer = setInterval(sectionSchedulerTick, 200);
  }

  const titleToggle = wrapper.querySelector('[data-role="titleToggle"]');
  if (titleToggle) titleToggle.addEventListener('click', updateStingerAvailability);
  const refreshPoolBtn = wrapper.querySelector('[data-role="refreshPool"]');
  if (refreshPoolBtn) refreshPoolBtn.addEventListener('click', rerollPool);

  wrapper.querySelectorAll('[data-voice-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.voiceKey;
      const action = btn.dataset.voiceAction;
      const set = action === 'solo' ? soloedVoices : mutedVoices;
      if (set.has(key)) set.delete(key); else set.add(key);
      const active = set.has(key);
      btn.classList.toggle('active', active);
      refreshVoiceGains();
      trackPublicEvent(action === 'solo' ? 'voice_solo_toggle' : 'voice_mute_toggle', { trackId: track.id, voice: key, active });
    });
  });
  // Volume par voix : 'input' pour un retour audio et visuel immédiat pendant le glissement (même
  // rampe courte que refreshVoiceGains partout ailleurs) ; 'change' pour ne tracker que la valeur
  // finale relâchée, pas chaque pas intermédiaire du curseur.
  wrapper.querySelectorAll('.voice-volume-slider').forEach(slider => {
    const key = slider.dataset.voiceKey;
    const valueEl = wrapper.querySelector(`[data-role="volumeValue-${key}"]`);
    slider.addEventListener('input', () => {
      layerVolumes.set(key, parseFloat(slider.value));
      // Repère de capture à chaque pas du glisser (le son suit le curseur en direct) ; la statistique, elle, ne
      // retient que la valeur relâchée (voir 'change').
      captureMark('voice_volume_change', { trackId: track.id, voice: key, value: parseFloat(slider.value) });
      if (valueEl) valueEl.textContent = Math.round(parseFloat(slider.value) * 100) + '%';
      refreshVoiceGains();
    });
    slider.addEventListener('change', () => {
      trackPublicEvent('voice_volume_change', { trackId: track.id, voice: key, value: parseFloat(slider.value) });
    });
  });
  if (goToEndBtn) {
    goToEndBtn.addEventListener('click', () => {
      if (!playing) return;
      if (isVerticalRandom) {
        if (!sectionScheduler) return;
        sectionScheduler.requestGoToEnd();
        goToEndBtn.disabled = true;
        goToEndBtn.textContent = layerHasSource(track.outro) ? t('endingWithOutro') : t('endingLastSegment');
      } else {
        if (goToEndRequested) return;
        goToEndRequested = true;
        goToEndBtn.disabled = true;
        goToEndBtn.textContent = track.outro ? t('endingWithOutro') : t('endingLastSegment');
      }
      trackPublicEvent('go_to_end_click', { trackId: track.id });
    });
  }
  if (goToNextSectionBtn) {
    goToNextSectionBtn.addEventListener('click', () => {
      if (!playing || !sectionScheduler) return;
      sectionScheduler.requestGoToNextSection();
      trackPublicEvent('go_to_next_section_click', { trackId: track.id });
    });
  }

  // Glisser sur la waveform du bloc séquentiel actuellement actif pour avancer/reculer dedans — même
  // principe que la barre de lecture des autres modes (position affichée en direct pendant le glisser,
  // seek audio réel seulement au relâchement), mais limité au bloc en cours : impossible de glisser sur
  // un bloc déjà terminé (figé) ou pas encore atteint (son contenu n'est pas encore tiré au sort).
  Object.keys(seqBlockEls).forEach(kind => {
    const block = seqBlockEls[kind];
    const els = seqWaveEls[kind];
    if (!block || !els || !els.fg) return;
    let dragging = false;
    function fractionFromEvent(e) {
      const rect = block.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    function isSeekable() { return playing && currentSeqBlockInfo && currentSeqBlockInfo.kind === kind && block.classList.contains('active'); }
    block.addEventListener('pointerdown', (e) => {
      if (!isSeekable()) return;
      dragging = true;
      try { block.setPointerCapture(e.pointerId); } catch (err) {}
      els.fg.style.transition = 'none';
      els.fg.style.clipPath = `inset(0 ${(1 - fractionFromEvent(e)) * 100}% 0 0)`;
    });
    block.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      els.fg.style.clipPath = `inset(0 ${(1 - fractionFromEvent(e)) * 100}% 0 0)`;
    });
    block.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      const targetSec = fractionFromEvent(e) * currentSeqBlockInfo.totalSec;
      trackPublicEvent('seq_block_seek', { trackId: track.id, kind });
      seekSequential(targetSec);
    });
    block.addEventListener('pointercancel', () => { dragging = false; });
  });

  document.addEventListener('stop-track', (e) => { if (e.detail === track.id) stopAllSources(); });
  // Reprise après mise en veille de l'écran ou passage en arrière-plan : les minuteurs de programmation
  // et l'horloge audio peuvent avoir été suspendus pendant ce temps, laissant une programmation obsolète
  // qui resterait silencieuse indéfiniment sans ça. On relance proprement depuis la position actuelle
  // plutôt que de laisser un état incohérent qui obligerait à recharger la page.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !playing) return;
    resumeAudioContext();
    // Séquentiel et vertical-random (bug trouvé le 13/08) : le chemin générique ci-dessous arrêtait tout
    // puis relançait la chaîne via un tout nouveau tirage (isContinuation=true préserve la position dans
    // la CHAÎNE, mais le bloc en cours au moment du passage en arrière-plan était perdu, remplacé par un
    // nouveau bloc qui, lui, repart de sa propre position 0 — d'où l'impression de "repartir de zéro").
    // Correctif : réutiliser les mêmes primitives de recherche (seek) déjà éprouvées pour le glissement
    // manuel sur la waveform, qui rejouent précisément le bloc/section EN COURS à sa position réelle
    // plutôt que d'en tirer un nouveau.
    if (isSequential) {
      if (currentSeqBlockInfo) seekSequential(ctx.currentTime - currentSeqBlockInfo.virtualZero);
      return;
    }
    if (isVerticalRandom) {
      if (vrCurrentSectionOriginalIndex >= 0) {
        const section = resolveVRSection(track, vrCurrentSectionOriginalIndex);
        const timing = sectionTiming(section);
        const elapsed = currentPlaybackOffset();
        const frac = timing.cycleLength > 0 ? Math.min(1, Math.max(0, (elapsed - timing.loopInSec) / timing.cycleLength)) : 0;
        seekVerticalRandom(frac);
      }
      return;
    }
    // Embranchement-vertical (29/08, bug signalé par Jules-Antoine : changer d'onglet relançait le morceau
    // depuis la référence) : chemin dédié plutôt que le repli générique ci-dessous, qui appelle
    // playEmbrVertical() sans discernement -- or cette fonction réinitialise TOUJOURS embrActiveLoopIdx sur
    // la référence, perdant la boucle réellement active (ex. "On est repéré !") au profit d'un retour
    // silencieux à la case départ.
    if (isEmbrVert) {
      // (05/09, retour direct : "on veut que l'audio continue même si on va sur un autre onglet -- ce
      // qu'il fait déjà -- mais qu'il ne reprenne pas au début quand on revient"). Le Web Audio de ce
      // moteur continue réellement de jouer en arrière-plan la plupart du temps (aucune vraie coupure) --
      // reconstruire systématiquement toute la programmation à CHAQUE retour d'onglet, sans savoir si
      // quelque chose a vraiment été interrompu, provoquait donc un redémarrage audible depuis le début du
      // fichier alors que rien n'en avait besoin. On ne relance que si quelque chose a RÉELLEMENT été
      // interrompu : le contexte audio a été suspendu par le navigateur (ctx.state), ou le planificateur
      // périodique (setInterval, que certains navigateurs ralentissent ou gèlent en arrière-plan) a pris du
      // retard au point de ne plus avoir de génération programmée à l'heure -- sinon, on ne touche à rien,
      // la lecture en cours continue exactement telle quelle.
      const schedulerLate = embrSchedulerTimer && embrNextStartCtxTime < ctx.currentTime - 0.5;
      if (ctx.state === 'running' && !schedulerLate) return;
      resumeEmbrVerticalAfterBackground();
      return;
    }
    const resumeFrom = computeElapsed();
    stopAllSources(false);
    offsetAt = resumeFrom;
    playThisTrack(false, true);
  });
  playBtn.addEventListener('click', () => { playing ? pauseThisTrack() : playThisTrack(true); });
  if (stopBtn) stopBtn.addEventListener('click', stopThisTrack);
  // Pilotage par programme (Carte de niveau, écoute aléatoire des albums) : démarrer à un niveau donné, régler le niveau avec une rampe,
  // arrêter, être prévenu de la fin naturelle, et savoir quand tombe la prochaine mesure / le prochain temps (grille du morceau, comptée
  // depuis son départ). Disponible sur tout lecteur ; seul `concurrent` joue en même temps que les autres.
  {
    const rampTo = (level, sec) => {
      const now = ctx.currentTime, g = trackMasterGain.gain;
      g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(Math.max(0, level), now + Math.max(0.01, sec || 0));
    };
    const lpIsEmbr = track.mode === 'embranchement-vertical' && (track.loops || []).length > 1;
    const lpLevelCount = () => (lpIsEmbr ? track.loops.length : (track.mode === 'vertical' && profiles.length > 1 ? profiles.length : 0));
    // Bascule vers une boucle dès que le morceau joue et que ses boucles sont chargées (le chargement est asynchrone au démarrage).
    let lpLoopTimer = null;
    function lpSelectLoopWhenReady(idx) {
      if (lpLoopTimer) { clearInterval(lpLoopTimer); lpLoopTimer = null; }
      let tries = 0;
      const tick = () => {
        if (playing && embrLoopBuffers[idx]) { if (embrActiveLoopIdx !== idx) selectEmbrLoop(idx); return true; }
        return ++tries > 80;
      };
      if (!tick()) lpLoopTimer = setInterval(() => { if (tick()) { clearInterval(lpLoopTimer); lpLoopTimer = null; } }, 100);
    }
    let lpWaitTimer = null;
    const lpCancelWait = () => { if (lpWaitTimer) { clearInterval(lpWaitTimer); lpWaitTimer = null; } };
    wrapper.lpControl = {
      // Démarrer : si les fichiers du morceau ne sont pas encore chargés (le chargement est asynchrone), on attend qu'ils le soient (au plus
      // 2 minutes) au lieu de « jouer » dans le vide ; stop() annule l'attente. isReady() : les fichiers sont chargés.
      start(level) {
        const go = () => { if (!playing) playThisTrack(true); trackMasterGain.gain.cancelScheduledValues(ctx.currentTime); trackMasterGain.gain.setValueAtTime(Math.max(0, level), ctx.currentTime); };
        lpCancelWait();
        if (ready || playing) { go(); return; }
        let waited = 0;
        lpWaitTimer = setInterval(() => { waited += 100; if (ready) { lpCancelWait(); go(); } else if (waited > 120000) lpCancelWait(); }, 100);
      },
      stop() { lpCancelWait(); if (playing) stopAllSources(false); },
      isReady: () => !!ready,
      // Vertical-random : « nouveau tirage » (rejoue la section en cours avec de nouveaux tirages) ; faux pour les autres modes.
      canRefreshPool: () => isVerticalRandom,
      refreshPool() { if (!isVerticalRandom) return false; rerollPool(); return true; },
      setLevel: rampTo,
      isPlaying: () => playing,
      onEnded(cb) { lpEndedCb = cb; },
      elapsed: () => (playing ? Math.max(0, ctx.currentTime - lpPlayStartedAt) : 0),
      // Prochain repère de la grille (mesure, temps, 2 ou 4 mesures) à partir de maintenant, en secondes d'horloge audio ; null si le
      // morceau ne joue pas encore. Tempo propre du morceau (bpm / temps par mesure).
      // « Niveaux » d'un morceau pilotés par programme (la Carte de niveau s'en sert pour exploration / combat et pour le réglage à la main) :
      //   - mode vertical : les COUCHES (0 = couche 1 seule ... n - 1 = toutes) ;
      //   - mode vertical à embranchements : les BOUCLES nommées (index dans track.loops, bascule avec la quantification et la transition
      //     propres à la boucle visée).
      // layerCount : nombre de niveaux (0 = sans) ; layerKind : 'layers' | 'loops' ; layerLabels : noms (ou null) ; layerAuto(role) : niveau
      // automatique pour 'explore' (couche 1, ou boucle initiale) ou 'combat' (toutes les couches, ou dernière boucle) ; setIntensity(i).
      layerCount: () => lpLevelCount(),
      layerKind: () => (lpIsEmbr ? 'loops' : 'layers'),
      layerLabels: () => (lpIsEmbr ? (track.loops || []).map((l, i) => (l && l.label) || ('Boucle ' + (i + 1))) : (track.mode === 'vertical' ? (track.layers || []).map(l => (l && l.label) || '') : null)),
      layerAuto: role => { const n = lpLevelCount(); if (n < 2) return 0; if (role === 'combat') return n - 1; return lpIsEmbr ? Math.max(0, (track.loops || []).findIndex(l => l && l.isInitial)) : 0; },
      intensityLevel: () => (lpIsEmbr ? (embrActiveLoopIdx >= 0 ? embrActiveLoopIdx : Math.max(0, (track.loops || []).findIndex(l => l && l.isInitial))) : level),
      setIntensity(i) {
        const n = lpLevelCount(); if (!n) return;
        const idx = Math.max(0, Math.min(n - 1, Math.round(+i) || 0));
        if (lpIsEmbr) lpSelectLoopWhenReady(idx); else applyIntensityLevel(idx, true);
      },
      // Séquences (mode séquentiel, 8/10) : les emplacements du morceau, avec leurs libellés, et le passage de l'un à l'autre par les
      // embranchements que le morceau prévoit déjà (comme un clic sur sa carte des chemins : au prochain repère de l'emplacement en cours).
      // sequenceCount : nombre d'emplacements (0 hors mode séquentiel) ; sequenceCurrent : emplacement entendu (-1 = intro / fin) ;
      // sequenceReachable : emplacements atteignables d'ici ; sequencePending : choix en attente (-1 = aucun) ; goToSequence(i) : vrai si accepté.
      sequenceCount: () => (isSequential ? (track.segmentSlots || []).length : 0),
      sequenceLabels: () => (isSequential ? (track.segmentSlots || []).map((sl, i) => (sl && sl.label) || t('slotFallback', { n: i + 1 })) : null),
      sequenceCurrent: () => (isSequential && currentSeqBlockInfo && currentSeqBlockInfo.kind === 'segment' && currentSeqBlockInfo.slotIdx != null ? currentSeqBlockInfo.slotIdx : -1),
      sequenceReachable: () => {
        if (!isSequential || !currentSeqBlockInfo || currentSeqBlockInfo.kind !== 'segment') return [];
        const slots = track.segmentSlots || [], cur = slots[currentSeqBlockInfo.slotIdx];
        return ((cur && cur.nextOptions) || []).map(o => slots.findIndex(sl => sl.id === o.targetId)).filter(i => i >= 0);
      },
      sequencePending: () => (isSequential && pendingNextSegmentId ? (track.segmentSlots || []).findIndex(sl => sl.id === pendingNextSegmentId) : -1),
      goToSequence(i) {
        if (!isSequential || !playing || !currentSeqBlockInfo || currentSeqBlockInfo.kind !== 'segment') return false;
        const slots = track.segmentSlots || [], cur = slots[currentSeqBlockInfo.slotIdx], target = slots[i];
        if (!cur || !target || !(cur.nextOptions || []).some(o => o.targetId === target.id)) return false;
        handleSeqBranchChoice(target.id, cur);
        return true;
      },
      nextBoundary(grid) {
        if (!playing) return null;
        const tt = trackTempo(track);
        const unit = grid === 'beat' ? tt.secondsPerBeat : tt.secondsPerBeat * tt.beatsPerBar * (grid === 'bars4' ? 4 : grid === 'bars2' ? 2 : 1);
        const elapsed = Math.max(0, ctx.currentTime - lpPlayStartedAt);
        const next = lpPlayStartedAt + Math.ceil(elapsed / unit + 1e-6) * unit;
        return next;
      },
    };
  }

  // Vertical-random (fusionné le 30/07) : pas de recherche par glissement — avec plusieurs sections
  // potentiellement enchaînées dans un ordre mélangé, "une position dans le temps" n'a plus de sens
  // unique à faire glisser vers. La barre reste un indicateur visuel de progression dans la section en
  // cours, juste non interactive pour ce mode.
  if (wrap && !isVerticalRandom) {
    // Glisser-déposer sur la barre de lecture (pas juste un tap) : la position se met à jour en direct
    // pendant le glissement (y compris la waveform), et la vraie recherche audio (arrêt/redémarrage des
    // sources) ne se déclenche qu'au relâchement — sinon on redémarrerait l'audio à chaque pixel parcouru.
    function seekPctFromEvent(e) {
      const rect = wrap.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    wrap.addEventListener('pointerdown', (e) => {
      isDraggingSeek = true;
      try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
      updateProgressAt(seekPctFromEvent(e) * progressMaxSec());
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!isDraggingSeek) return;
      updateProgressAt(seekPctFromEvent(e) * progressMaxSec());
    });
    wrap.addEventListener('pointerup', (e) => {
      if (!isDraggingSeek) return;
      isDraggingSeek = false;
      const seekTo = seekPctFromEvent(e) * progressMaxSec();
      if (playing) { stopAllSources(false); offsetAt = seekTo; playThisTrack(false, true); }
      else { offsetAt = seekTo; updateProgressAt(offsetAt); }
    });
    wrap.addEventListener('pointercancel', () => { isDraggingSeek = false; });
  }

  // Glisser sur le bloc de la section EN COURS uniquement (voir seekVerticalRandom) — les autres blocs
  // ne réagissent pas, une "position" n'ayant de sens que dans la section qui joue réellement.
  vrBlockEls.forEach((block, i) => {
    if (!block) return;
    function fractionFromEvent(e) {
      const rect = block.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    block.addEventListener('pointerdown', (e) => {
      if (vrCurrentSectionOriginalIndex !== i) return;
      vrIsDraggingSeek = true;
      try { block.setPointerCapture(e.pointerId); } catch (err) {}
      if (vrBlockFillEls[i]) vrBlockFillEls[i].style.width = (fractionFromEvent(e) * 100) + '%';
    });
    block.addEventListener('pointermove', (e) => {
      if (!vrIsDraggingSeek || vrCurrentSectionOriginalIndex !== i) return;
      if (vrBlockFillEls[i]) vrBlockFillEls[i].style.width = (fractionFromEvent(e) * 100) + '%';
    });
    block.addEventListener('pointerup', (e) => {
      if (!vrIsDraggingSeek || vrCurrentSectionOriginalIndex !== i) { vrIsDraggingSeek = false; return; }
      vrIsDraggingSeek = false;
      seekVerticalRandom(fractionFromEvent(e));
    });
    block.addEventListener('pointercancel', () => { vrIsDraggingSeek = false; });
  });

  // Changement d'intensité (mode vertical) : bouton 1/2/3, ou curseur qui franchit une limite de zone (26/09).
  function applyIntensityLevel(lv, silent) {
    level = lv;
    notchDots.forEach(d => d.classList.toggle('active', parseInt(d.dataset.level, 10) === lv));
    if (!silent) trackPublicEvent('intensity_change', { trackId: track.id, level }); // silencieux quand c'est la Carte de niveau qui pilote
    if (!playing) return;
    const p = profiles[level];
    const now = ctx.currentTime;
    const gainsToRamp = useQuantizedLoop ? currentGainNodes : gains;
    gainsToRamp.forEach((g, i) => {
      if (!g) return;
      const layerGain = effGain(layersToLoad[i]);
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime((p[i] || 0) * layerGain * voiceGain('layer-' + i), now + INTENSITY_RAMP_SEC);
    });
  }
  notchDots.forEach(dot => dot.addEventListener('click', () => applyIntensityLevel(parseInt(dot.dataset.level, 10))));

  stingerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const sfx = SFX_LIBRARY_BY_ID[btn.dataset.sfxId];
      const bufs = sfx && sfxBuffersById[sfx.id];
      if (!sfx || !bufs || !bufs.length) return;
      // Tirage round robin : aléatoire sans rejouer deux fois de suite la même variation, ou avance
      // séquentielle bouclée — selon le réglage propre à ce Sfx (même logique que le bloc de contenu Sfx).
      const n = bufs.length;
      let idx;
      if (n <= 1) idx = 0;
      else if (sfx.rrMode === 'sequential') {
        idx = ((sfxLastIndexById[sfx.id] != null ? sfxLastIndexById[sfx.id] : -1) + 1) % n;
      } else {
        do { idx = Math.floor(Math.random() * n); } while (idx === sfxLastIndexById[sfx.id]);
      }
      sfxLastIndexById[sfx.id] = idx;
      const buf = bufs[idx];
      if (!buf) return;
      resumeAudioContext();
      // Départ à un instant PRÉCIS, 20 ms après l'appui (25/09), plutôt que « dès que possible » (start(0)) : le navigateur
      // ne dit pas quand tombe ce « dès que possible » (2 à 20 ms plus tard selon sa charge), si bien qu'aucun
      // enregistrement (outil vidéo, Figer) ne pouvait caler le Sfx exactement sur la musique. Inaudible à l'appui.
      const startAt = ctx.currentTime + SFX_START_LEAD_SEC;
      if (sfx.duckMainTrack) duckMainTrack(buf.duration, startAt);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      // Curseurs liés à la position / reverb de ce Sfx : le son démarre à la position actuelle du curseur, puis suit ses
      // déplacements tant qu'il joue (voir applyFxSliderToSfx).
      const spatialVoice = connectSfxSource(src, sfx, fxSfxOverrideFor(sfx.id), startAt);
      if (spatialVoice && spatialVoice.fixed) {
        let vs = activeSfxVoices.get(sfx.id);
        if (!vs) { vs = new Set(); activeSfxVoices.set(sfx.id, vs); }
        vs.add(spatialVoice);
        src.addEventListener('ended', () => vs.delete(spatialVoice));
      }
      journalSfxVoice(src, spatialVoice);
      src.start(startAt);
      activeStingerSources.push(src);
      src.onended = () => { activeStingerSources = activeStingerSources.filter(s => s !== src); };
      // spatialStep : point de trajectoire réellement joué (mode "pas à pas") -- l'outil vidéo le rejoue à l'identique.
      // Capture : réglage de salle réellement utilisé (le visiteur a pu déplacer le son sur la matrice publique), et durée
      // du fichier (le « duck » de la musique en dépend).
      trackPublicEvent('stinger_play', Object.assign({ trackId: track.id, sfxId: sfx.id, variationIndex: idx },
        spatialVoice && spatialVoice.stepIndex != null ? { spatialStep: spatialVoice.stepIndex } : {}),
        Object.assign({ fileDuration: buf.duration, at: startAt }, spatialVoice && spatialVoice.__spUsed ? { spatial: spatialVoice.__spUsed } : {}));
    });
  });

  if (loopCountSelect) {
    loopCountSelect.addEventListener('change', () => {
      // Mutation directe de l'objet track lu par schedulerTick à chaque cycle — s'applique donc au vol,
      // y compris en cours de lecture, sans avoir à relancer la piste.
      track.maxLoops = loopCountSelect.value === '' ? null : parseInt(loopCountSelect.value, 10);
      trackPublicEvent('track_loop_change', { trackId: track.id, maxLoops: track.maxLoops });
    });
  }

  if (chainLoopCountSelect) {
    chainLoopCountSelect.addEventListener('change', () => {
      // Mutation directe de track.maxChainLoops : lu au vol par pickNextSegmentSlot (séquentiel) à chaque
      // avancement, et par le getter passé à createSectionPlaybackScheduler (vertical-random) à chaque
      // cycle — dans les deux cas, pas besoin de relancer la piste pour que le changement s'applique.
      track.maxChainLoops = chainLoopCountSelect.value === '' ? null : parseInt(chainLoopCountSelect.value, 10);
      trackPublicEvent('track_chain_loop_change', { trackId: track.id, maxChainLoops: track.maxChainLoops });
    });
  }

  // Boucles par section (vertical-random uniquement) : chaque petit sélecteur mute en place l'objet
  // réellement lu par sectionScheduler.decideNext() (voir vrPlayableSectionRefs) — pas d'effet si la
  // section touchée n'est pas (encore) jouable, la mutation est alors simplement un no-op silencieux.
  vrSectionLoopSelectEls.forEach((sel, origIdx) => {
    if (!sel) return;
    sel.addEventListener('change', () => {
      const value = sel.value === '' ? null : parseInt(sel.value, 10);
      const j = playableSectionOriginalIndex.indexOf(origIdx);
      if (j >= 0 && vrPlayableSectionRefs[j]) vrPlayableSectionRefs[j].maxLoops = value;
      trackPublicEvent('track_section_loop_change', { trackId: track.id, sectionIndex: origIdx, maxLoops: value });
    });
  });

  // Compteurs utilisés pour distinguer un vrai échec de chargement d'une simple propagation encore en
  // cours côté GitHub Pages (fichiers fraîchement publiés, pas encore servis par le CDN — jusqu'à 10
  // minutes, voir docs/infrastructure.md) : si TOUTES les requêtes réseau tentées pour cette piste ont
  // échoué en 404/non-ok, plutôt qu'un mélange d'échecs ordinaires, c'est le signe le plus probable d'une
  // publication toute récente. Ne compte que les vrais fichiers distants (item.localFile/localUrl
  // ignorés, aperçu local du backstage jamais concerné par ce problème).
  let remoteFetchAttempts = 0;
  // Fichiers locaux (aperçu du Backstage) impossibles à lire ou à décoder -- voir loadArrayBuffer().
  const unreadableLocalFiles = new Set();
  const _localFileNames = new WeakMap(); // octets lus -> nom du fichier local, le temps du décodage
  let remoteFetchNotFound = 0;
