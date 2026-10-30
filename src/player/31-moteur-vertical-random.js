  /* ---- Moteur vertical-random : sections chaînées, chacune avec ses pools simultanés et son propre
     tempo/timeline (30/07). La décision "quoi jouer ensuite" vient entièrement de
     createSectionPlaybackScheduler (logique pure, testée indépendamment — voir test-section-scheduler.js) ;
     ce qui suit ne fait que traduire ses décisions en programmation Web Audio réelle. ---- */
  let vrNextStartCtxTime = 0;
  let vrIsDraggingSeek = false; // pendant un glissement sur le bloc de section actif : le tick() n'écrase pas le remplissage affiché
  let vrSchedulerTimer = null;
  let vrCurrentSectionOriginalIndex = -1; // pour savoir quand la section affichée doit changer (rebuild du graphe)
  let vrPendingCut = false;
  function emitVROutcome(name, at, detail) {
    const cut = vrPendingCut; vrPendingCut = false;
    const rate = trackPitchRatio; // appelé à la programmation du cycle : vitesse de ses sources (pour l'export)
    voiceGraphTimeouts.push(setTimeout(() => {
      trackPublicEvent(name, Object.assign({}, detail, cut ? { cut: { hard: true, fadeSec: 0 } } : {}), { at, rate });
    }, Math.max(0, (at - ctx.currentTime) * 1000)));
  }
  function scheduleSectionGeneration(ctxStartTime, secIdx, isFirstEverForThisSection, offsetOverride) {
    const section = resolveVRSection(track, secIdx);
    const declaredSection = (track.sections || [])[secIdx];
    const timing = sectionTiming(section);
    const bufferOffset = offsetOverride != null ? offsetOverride : (isFirstEverForThisSection ? timing.startTrackSec : timing.loopInSec);
    const pools = section.pools || [];
    const poolPicks = [];
    const telemetryPicks = []; // { poolIndex, altIndex } par pool réellement tiré CE cycle -- seule donnée qui
    // permette de reproduire fidèlement l'audio à l'export (moteur de capture, pack.html) sans pour autant
    // détailler le pool dans l'éditeur de frise lui-même (demande explicite de Jules-Antoine le 2026-09-16 :
    // "dans l'éditeur, on ne détaille pas le contenu du pool" -- ce champ reste un détail interne à
    // l'événement, jamais affiché comme une piste séparée).
    pools.forEach((pool, poolIdx) => {
      const displaySlot = poolIdx; // les sections d'un même morceau ont chacune leur propre liste de pools,
      // affichée dans les mêmes emplacements visuels 0..N-1 (voir vrMaxPoolCount) — une section avec moins
      // de pools laisse simplement les emplacements suivants masqués.
      const bufs = (sectionBuffers[secIdx] && sectionBuffers[secIdx][poolIdx]) || [];
      const idx = pickPoolAlternativeIndex(secIdx, poolIdx);
      telemetryPicks.push({ poolIndex: displaySlot, altIndex: idx });
      let label = '—', silent = true, pickedBuf = null;
      if (idx >= 0) {
        const alt = (pool.alternatives || [])[idx];
        const buf = bufs[idx];
        silent = !buf;
        pickedBuf = buf;
        label = buf ? ((alt && alt.label) ? alt.label : t('altFallback', { n: idx + 1 })) : t('silenceLabel');
        if (buf) {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          applyTrackPitchRate(src, ctxStartTime);
          const g = ctx.createGain();
          const key = 'pool-' + displaySlot;
          const base = effGain(alt);
          g.gain.setValueAtTime(base * voiceGain(key), ctxStartTime);
          // fx : porté par le pool (la "voix"/l'emplacement), pas par l'alternative tirée au sort -- même
          // chaîne quel que soit le tirage, cf. la logique retenue pour les emplacements séquentiels.
          const fxChain = buildTargetFxChain('pool:' + secIdx + ':' + poolIdx, pool.fx, src, ctxStartTime);
          if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
          g.connect(trackMasterGain);
          // Chaque génération de pool rejoue une fois sans boucle -- onended fiable pour le nettoyage du
          // bitcrusher, comme pour les autres moteurs. armVRFinalEnd() chaîne sur ce handler plutôt que de
          // l'écraser -- voir son commentaire.
          if (fxChainHasLeakyNode(fxChain)) {
            src.onended = () => { disconnectLeakyFxNodes(fxChain); };
          }
          journalVoice(src, g, fxChain);
          src.start(ctxStartTime, bufferOffset);
          activeGenSources.push({ src, gain: g, voiceKey: key, baseGain: base });
        }
      }
      poolPicks.push({ pi: displaySlot, label, silent, buf: pickedBuf });
    });
    // Emplacements au-delà du nombre de pools de CETTE section (mais existants pour une autre section
    // du même morceau, donc présents dans le graphe) : masqués, pas juste silencieux.
    for (let pi = pools.length; pi < vrMaxPoolCount; pi++) poolPicks.push({ pi, label: '—', silent: true, buf: null });
    scheduleVoiceGraphUpdate(ctxStartTime, poolPicks, secIdx);
    lastGenSources = activeGenSources.slice(-Math.max(1, pools.length)).map(s => s.src);
    scheduledGens.push({ ctxStartTime, bufferOffset, ratio: trackPitchRatio });
    // Capture/export (2026-09-16, voir pack.html) : un cycle de section = une fenêtre autonome à reproduire
    // fidèlement (mêmes tirages, même offset dans les fichiers) -- déclenché à CHAQUE appel de cette
    // fonction, donc aussi bien un vrai changement de section qu'un simple bouclage de la section courante
    // OU un seek manuel (seekVerticalRandom réutilise ce même point d'entrée) : les trois sont des moments
    // où de nouvelles sources démarrent réellement, donc trois moments valides à capturer.
    // Émis au moment où le cycle devient AUDIBLE (25/09, comme le séquentiel) : un cycle programmé puis annulé
    // (nouveau tirage, saut, arrêt -- voiceGraphTimeouts vidé) n'est jamais annoncé. cut : ce cycle remplace net les
    // sources précédentes (nouveau tirage / saut), au lieu de laisser finir leur queue.
    emitVROutcome('vr_section_start', ctxStartTime, {
      trackId: track.id, sectionId: (declaredSection && declaredSection.id) || null, sectionIndex: secIdx,
      bufferOffset, picks: telemetryPicks,
    });
    const roughCutoffWindow = 8; // les sections n'ont pas de cycleLength unique commun, fenêtre fixe raisonnable
    const cutoff = ctx.currentTime - roughCutoffWindow;
    if (scheduledGens.length > 12) scheduledGens = scheduledGens.filter(g => g.ctxStartTime >= cutoff);
    return timing;
  }
  function sectionSchedulerTick() {
    const lookahead = 1.0;
    while (vrNextStartCtxTime < ctx.currentTime + lookahead) {
      const next = sectionScheduler.decideNext();
      if (!next) {
        clearInterval(vrSchedulerTimer); vrSchedulerTimer = null;
        armVRFinalEnd();
        return;
      }
      if (next.type === 'intro') {
        if (!introBuffer) continue; // pas de fichier intro chargé : ignoré, on redemande immédiatement la suite
        const src = ctx.createBufferSource();
        src.buffer = introBuffer;
        applyTrackPitchRate(src, vrNextStartCtxTime);
        const g = ctx.createGain();
        g.gain.setValueAtTime(effGain(track.intro), vrNextStartCtxTime);
        const fxChain = buildTargetFxChain('intro', track.intro && track.intro.fx, src, vrNextStartCtxTime);
        if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
        g.connect(trackMasterGain);
        if (fxChainHasLeakyNode(fxChain)) {
          src.onended = () => { disconnectLeakyFxNodes(fxChain); };
        }
        journalVoice(src, g, fxChain);
        src.start(vrNextStartCtxTime, 0);
        activeGenSources.push({ src, gain: g, voiceKey: 'intro', baseGain: effGain(track.intro) });
        lastGenSources = [src];
        scheduledGens.push({ ctxStartTime: vrNextStartCtxTime, bufferOffset: 0, ratio: trackPitchRatio });
        emitVROutcome('vr_intro_start', vrNextStartCtxTime, { trackId: track.id });
        // Durée nominale de l'intro : mesures déclarées, au tempo de la PREMIÈRE section jouable (elle
        // seule a un sens ici, l'intro n'appartenant à aucune section) — la partie du fichier qui dépasse
        // cette durée nominale forme la queue de chevauchement, exactement comme en séquentiel.
        const firstPlayableOrigIdx = playableSectionOriginalIndex[0];
        const firstSection = firstPlayableOrigIdx !== undefined ? resolveVRSection(track, firstPlayableOrigIdx) : null;
        // Tempo propre à l'intro s'il a été réglé dans le Backstage (25/09), sinon celui de la première section.
        const introDurationSec = vrIntroDurationSec(track, firstSection);
        vrNextStartCtxTime += introDurationSec / trackPitchRatio;
        continue;
      }
      if (next.type === 'outro') {
        if (!outroBuffer) { clearInterval(vrSchedulerTimer); vrSchedulerTimer = null; armVRFinalEnd(); return; }
        const src = ctx.createBufferSource();
        src.buffer = outroBuffer;
        applyTrackPitchRate(src, vrNextStartCtxTime);
        const g = ctx.createGain();
        g.gain.setValueAtTime(effGain(track.outro), vrNextStartCtxTime);
        const fxChain = buildTargetFxChain('outro', track.outro && track.outro.fx, src, vrNextStartCtxTime);
        if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
        g.connect(trackMasterGain);
        if (fxChainHasLeakyNode(fxChain)) {
          src.onended = () => { disconnectLeakyFxNodes(fxChain); };
        }
        journalVoice(src, g, fxChain);
        src.start(vrNextStartCtxTime, 0);
        activeGenSources.push({ src, gain: g, voiceKey: 'outro', baseGain: effGain(track.outro) });
        lastGenSources = [src];
        scheduledGens.push({ ctxStartTime: vrNextStartCtxTime, bufferOffset: 0, ratio: trackPitchRatio });
        emitVROutcome('vr_outro_start', vrNextStartCtxTime, { trackId: track.id });
        clearInterval(vrSchedulerTimer); vrSchedulerTimer = null;
        armVRFinalEnd();
        return;
      }
      // next.type === 'section'
      const origIdx = playableSectionOriginalIndex[next.index];
      const timing = scheduleSectionGeneration(vrNextStartCtxTime, origIdx, next.isFirstEverForThisSection);
      vrNextStartCtxTime += (next.isFirstEverForThisSection ? (timing.loopOutSec - timing.startTrackSec) : timing.cycleLength) / trackPitchRatio;
    }
  }
  function armVRFinalEnd() {
    const marker = lastGenSources[0];
    if (!marker) return;
    finalGenerationMarkerSrc = marker;
    // Chaîne sur un éventuel onended déjà posé (nettoyage du bitcrusher, voir scheduleSectionGeneration et
    // le bloc outro plus haut) plutôt que de l'écraser -- même raisonnement que armSeqFinalEnd().
    const previousOnEnded = marker.onended;
    marker.onended = () => {
      if (previousOnEnded) previousOnEnded();
      if (finalGenerationMarkerSrc !== marker) return;
      activeGenSources = [];
      playing = false;
      playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
      cancelAnimationFrame(rafId);
      updateProgressAt(0);
      setStoppedUI();
      if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('goToEndBtn'); }
      if (goToNextSectionBtn) goToNextSectionBtn.disabled = true;
      if (activeTrackId === track.id) activeTrackId = null;
    };
  }
  function stopVerticalRandom() {
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
    finalGenerationMarkerSrc = null;
    if (vrSchedulerTimer) { clearInterval(vrSchedulerTimer); vrSchedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch(e){} });
    activeGenSources = [];
    voiceGraphTimeouts.forEach(id => clearTimeout(id));
    voiceGraphTimeouts = [];
    voiceWavePools.forEach(els => { if (els && els.fg) { els.fg.style.transition = 'none'; els.fg.style.clipPath = 'inset(0 100% 0 0)'; } });
    voiceCurrents.forEach(el => { if (el) el.textContent = '—'; });
    let anyWasHidden = false;
    wwisePoolVoiceEls.forEach(el => { if (el && el.style.display === 'none') { anyWasHidden = true; el.style.display = ''; } });
    if (anyWasHidden) drawWwiseLines();
    if (sectionCurrentEl) sectionCurrentEl.textContent = '—';
    vrBlockEls.forEach(el => { if (el) el.classList.remove('active'); });
    vrBlockFillEls.forEach(el => { if (el) el.style.width = '0%'; });
    vrCurrentSectionOriginalIndex = -1;
  }
  function playVerticalRandom(isContinuation) {
    stopVerticalRandom();
    // Un vrai démarrage (pas une reprise après pause/veille) repart de zéro : nouvel ordre de sections
    // (rebrassé si "randomiser" est coché), intro rejouée si présente. Une reprise continue la chaîne là
    // où elle en était — même convention que playSequential(isContinuation) pour le séquentiel.
    if (!isContinuation || !sectionScheduler) {
      vrPlayableSectionRefs = playableSectionOriginalIndex.map(origIdx => ({ maxLoops: resolveVRSection(track, origIdx).maxLoops }));
      sectionScheduler = createSectionPlaybackScheduler(
        vrPlayableSectionRefs,
        {
          randomize: !!track.randomizeSections, hasIntro: !!introBuffer, hasOutro: !!outroBuffer,
          // Getter plutôt qu'une valeur figée à la création : le sélecteur visiteur mute track.maxChainLoops
          // directement (voir plus bas), donc chaque cycle voit la valeur à jour sans recréer le scheduler.
          get maxChainLoops() { return track.maxChainLoops || null; }
        }
      );
    }
    vrNextStartCtxTime = startSoon(); // toutes les voix du premier cycle sur un même instant (voir startSoon)
    sectionSchedulerTick();
    vrSchedulerTimer = setInterval(sectionSchedulerTick, 200);
    if (goToEndBtn) goToEndBtn.disabled = false;
    if (goToNextSectionBtn) goToNextSectionBtn.disabled = false;
  }
  // Glisser sur le bloc de la section EN COURS (voir vrBlockEls) : recherche à l'intérieur du cycle de
  // CETTE section uniquement, sans faire avancer la chaîne (même esprit que rerollPool) — les autres
  // blocs ne sont pas cliquables, une "position" n'ayant de sens que dans la section qui joue réellement.
  function seekVerticalRandom(fraction) {
    if (!playing || vrCurrentSectionOriginalIndex < 0) return;
    const origIdx = vrCurrentSectionOriginalIndex;
    const section = resolveVRSection(track, origIdx);
    const timing = sectionTiming(section);
    const offset = timing.loopInSec + fraction * timing.cycleLength;
    if (vrSchedulerTimer) { clearInterval(vrSchedulerTimer); vrSchedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch (e) {} });
    activeGenSources = [];
    voiceGraphTimeouts.forEach(id => clearTimeout(id));
    voiceGraphTimeouts = [];
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    vrPendingCut = true;
    scheduleSectionGeneration(now, origIdx, false, offset);
    const timeUntilNext = timing.cycleLength - (fraction * timing.cycleLength);
    vrNextStartCtxTime = now + Math.max(0.02, timeUntilNext / trackPitchRatio);
    vrSchedulerTimer = setInterval(sectionSchedulerTick, 200);
  }

  // État nécessaire pour qu'un vrai Pause manuel (bouton Lecture/Pause) reprenne EXACTEMENT où la lecture
  // en était, plutôt que de repartir du tout début (bug signalé le 07/09 par Jules-Antoine : "pause"
  // stoppait complètement la lecture au lieu de la mettre en pause). Pour le séquentiel, l'embranchement
  // vertical et le vertical-random, les fonctions stop* ci-dessous réinitialisent volontairement l'identité
  // du bloc/de la boucle/de la section en cours (comportement voulu pour un vrai Stop, ou pour la reprise
  // après veille qui a ses propres mécanismes dédiés, voir seekSequential/seekVerticalRandom/
  // resumeEmbrVerticalAfterBackground) — donc capturé ICI, AVANT l'appel au stop du moteur. Pour le moteur
  // simple/quantifié, rien à faire : offsetAt (mis à jour par stopSimple/stopQuantized) suffit déjà.
  let pausedResume = null;
