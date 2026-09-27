  /* ---- Moteur quantifié classique (vertical/statique avec loopEngine "quantized" — BPM + mesures,
     retrigger avec queue de fin superposée). Le vertical-random a désormais son propre moteur séparé,
     voir plus bas, puisque son minutage varie section par section plutôt que d'être fixe pour tout le
     morceau. ---- */
  function scheduleGeneration(ctxStartTime, bufferOffset) {
    // Repère de capture : une nouvelle génération de toutes les couches (moteur quantifié), depuis bufferOffset, au niveau
    // d'intensité en cours -- programmée jusqu'à 1 s plus tôt (at = son instant de départ). Une génération programmée puis annulée par un
    // arrêt est effacée par le repère voices_stop qui la précède.
    captureMark('layer_gen', { trackId: track.id, bufferOffset, level, at: ctxStartTime, rate: trackPitchRatio });
    const thisGenSources = [];
    const p = profiles[level] || profiles[0];
    const gensThisRound = [];
    for (let i = 0; i < buffers.length; i++) {
      if (!buffers[i]) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffers[i];
      applyTrackPitchRate(src, ctxStartTime);
      const g = ctx.createGain();
      const key = 'layer-' + i;
      const base = (p[i] || 0) * effGain(layersToLoad[i]);
      g.gain.setValueAtTime(base * voiceGain(key), ctxStartTime);
      const fxChain = buildTargetFxChain('layer:' + i, layersToLoad[i] && layersToLoad[i].fx, src, ctxStartTime);
      if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
      g.connect(trackMasterGain);
      // Ce moteur régénère une chaîne à chaque nouvelle génération sans jamais les déconnecter -- sans
      // conséquence pour les nœuds fx natifs (filtre/reverb/écho, coût quasi nul une fois la source
      // arrêtée), mais un bitcrusher (ScriptProcessorNode) continuerait de traiter du silence en boucle
      // indéfiniment si on le laissait connecté. src.onended se déclenche de façon fiable à la fin
      // naturelle de CETTE génération (chaque source ici joue une fois, sans loop -- la suivante prend le
      // relais) et aussi si stopSimple()-équivalent l'arrête manuellement (.stop() déclenche onended) --
      // point de nettoyage correct dans les deux cas, jamais de fuite à accumuler sur une session longue.
      if (fxChainHasLeakyNode(fxChain)) {
        src.onended = () => { disconnectLeakyFxNodes(fxChain); };
      }
      journalVoice(src, g, fxChain);
      src.start(ctxStartTime, bufferOffset);
      activeGenSources.push({ src, gain: g, voiceKey: key, baseGain: base });
      thisGenSources.push(src);
      gensThisRound[i] = g;
    }
    currentGainNodes = gensThisRound;
    lastGenSources = thisGenSources;
    scheduledGens.push({ ctxStartTime, bufferOffset, ratio: trackPitchRatio });
    const cutoff = ctx.currentTime - Math.max(cycleLength / trackPitchRatio, 4) * 2;
    if (scheduledGens.length > 6) scheduledGens = scheduledGens.filter(g => g.ctxStartTime >= cutoff);
  }
  function schedulerTick() {
    const lookahead = 1.0;
    while (nextGenStartCtxTime < ctx.currentTime + lookahead) {
      if (track.maxLoops && loopsPlayed >= track.maxLoops) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
        armFinalGenerationEnd();
        return;
      }
      scheduleGeneration(nextGenStartCtxTime, nextGenBufferOffset);
      loopsPlayed++;
      // /trackPitchRatio : cycleLength reste la durée MUSICALE nominale (réutilisée telle quelle ailleurs,
      // ex. affichage) -- seul l'avancement du planificateur en temps RÉEL doit en tenir compte, puisqu'un
      // buffer joué à trackPitchRatio défile trackPitchRatio fois plus vite que sa durée nominale.
      nextGenStartCtxTime += cycleLength / trackPitchRatio;
      nextGenBufferOffset = loopInSec;
    }
  }
  // Une fois la limite de boucles atteinte : on n'interrompt pas la génération en cours (qui contient
  // la queue déjà présente dans le fichier après le point de sortie) — elle continue de jouer seule,
  // sans rien programmer par-dessus. C'est ça, l'outro : pas un fichier séparé, juste l'absence de relance.
  function armFinalGenerationEnd() {
    const marker = lastGenSources[0];
    if (!marker) return;
    finalGenerationMarkerSrc = marker;
    // Chaîne sur un éventuel onended déjà posé par scheduleGeneration (nettoyage du bitcrusher) plutôt
    // que de l'écraser -- même risque et même correctif que armSeqFinalEnd()/armVRFinalEnd().
    const previousOnEnded = marker.onended;
    marker.onended = () => {
      if (previousOnEnded) previousOnEnded();
      if (finalGenerationMarkerSrc !== marker) return; // piste arrêtée/relancée entretemps : on ignore
      activeGenSources = [];
      playing = false;
      playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
      cancelAnimationFrame(rafId);
      offsetAt = startTrackSec;
      updateProgressAt(offsetAt);
      setStoppedUI();
      if (activeTrackId === track.id) activeTrackId = null;
    };
  }
  function stopQuantized() {
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
    finalGenerationMarkerSrc = null;
    if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch(e){} });
    activeGenSources = [];
    voiceGraphTimeouts.forEach(id => clearTimeout(id));
    voiceGraphTimeouts = [];
  }
  function playQuantized(fromOffsetSec) {
    stopQuantized();
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    scheduleGeneration(now, fromOffsetSec);
    let timeUntilNext;
    if (fromOffsetSec < loopInSec) {
      timeUntilNext = loopOutSec - fromOffsetSec;
    } else {
      const positionInLoop = (fromOffsetSec - loopInSec) % cycleLength;
      timeUntilNext = cycleLength - positionInLoop;
    }
    nextGenStartCtxTime = now + Math.max(0.02, timeUntilNext / trackPitchRatio);
    nextGenBufferOffset = loopInSec;
    schedulerTimer = setInterval(schedulerTick, 200);
  }

