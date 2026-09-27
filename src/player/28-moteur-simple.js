  /* ---- Moteur simple (bouclage natif, comportement existant inchangé) ---- */
  function stopSimple(keepPosition) {
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
    if (keepPosition !== false) {
      offsetAt = computeElapsed();
    }
    sources.forEach(s => { if (s) { try { s.stop(); } catch(e){} } });
    // Un ScriptProcessorNode fx (bitcrusher/pitch-shift) continue de traiter du silence tant qu'il reste
    // connecté -- déconnexion explicite ici, contrairement aux autres nœuds fx (coût négligeable une fois
    // la source arrêtée, laissés au ramasse-miettes comme le reste du graphe).
    layerFxChains.forEach(chain => disconnectLeakyFxNodes(chain));
    sources = []; gains = []; layerFxChains = [];
  }
  function playSimple() {
    const nowStart = startSoon(); // toutes les couches sur un même instant (voir startSoon)
    startedAt = nowStart - offsetAt / trackPitchRatio;
    const p = profiles[level] || profiles[0];
    // Repère de capture : toutes les couches démarrent ici, à cette position du fichier, en boucle ou non, au niveau
    // d'intensité en cours (le visiteur a pu le choisir avant d'appuyer sur Lecture).
    // rate / rateFade : vitesse réellement donnée aux sources (27/09 -- l'export la reprend telle quelle au lieu de la deviner).
    const pFx = (track.fx && track.fx.pitch) || {};
    const rateFade = (trackPitchRatio !== 1 && trackPitchRatio === trackBaseRatio && pFx.fadeFromSemitones != null && pFx.fadeDurationSec > 0)
      ? { from: Math.pow(2, pFx.fadeFromSemitones / 12), sec: pFx.fadeDurationSec } : null;
    captureMark('layer_run', { trackId: track.id, offset: offsetAt % track.duration, loop: loops ? [0, track.duration] : null, level, at: nowStart, rate: trackPitchRatio, rateFade });
    for (let i = 0; i < buffers.length; i++) {
      const src = ctx.createBufferSource();
      src.buffer = buffers[i];
      if (loops) { src.loop = true; src.loopStart = 0; src.loopEnd = track.duration; }
      // Moteur simple : le bouclage natif (loopStart/loopEnd, en temps de BUFFER) reste correct quel que
      // soit playbackRate -- pas besoin de diviser une durée programmée par ailleurs, contrairement aux
      // moteurs qui calculent eux-mêmes "dans x secondes réelles" en JS (voir plus bas dans ce fichier).
      applyTrackPitchRate(src, nowStart, true);
      const g = ctx.createGain();
      g.gain.setValueAtTime((p[i] || 0) * effGain(layersToLoad[i]) * voiceGain('layer-' + i), nowStart);
      const fxChain = buildTargetFxChain('layer:' + i, layersToLoad[i] && layersToLoad[i].fx, src, nowStart);
      if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
      g.connect(trackMasterGain);
      journalVoice(src, g, fxChain);
      src.start(nowStart, offsetAt % track.duration);
      sources[i] = src; gains[i] = g; layerFxChains[i] = fxChain;
      if (isStatic && !loops) {
        const layerIndex = i;
        src.onended = () => {
          // Un morceau statique non bouclable finit ici SANS jamais passer par stopSimple() -- sans ce
          // nettoyage propre, un fx à ScriptProcessorNode (s'il y en a un) continuerait de tourner
          // indéfiniment après une fin naturelle (trouvé le 22/09, en écho au même souci déjà réglé pour
          // le moteur quantifié -- même risque, chemin de code différent, pas détecté au premier passage).
          disconnectLeakyFxNodes(fxChain);
          // Si cette source a depuis été remplacée ou arrêtée manuellement (seek, stop, changement de piste),
          // sources[layerIndex] ne pointe plus vers elle -> ce n'est pas une vraie fin naturelle, on ignore.
          if (sources[layerIndex] !== src) return;
          naturalEnd();
        };
      }
    }
  }

  function pulseMeter(el) {
    if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth; // force le reflow pour pouvoir rejouer l'animation même si elle est déjà active
    el.classList.add('pulse');
  }
  // poolPicks : [{ pi, label, silent, buf }] où pi est la position d'affichage (0..vrMaxPoolCount-1) —
  // PAS l'index du pool dans la section en cours, qui peut varier d'une section à l'autre. Le mappage
  // entre "position d'affichage" et "pool réel de la section courante" est fait par l'appelant.
  function scheduleVoiceGraphUpdate(ctxStartTime, poolPicks, secIdx) {
    const delayMs = Math.max(0, (ctxStartTime - ctx.currentTime) * 1000);
    const timeoutId = setTimeout(() => {
      let topologyChanged = false;
      poolPicks.forEach(({ pi, label, silent, buf }) => {
        if (voiceCurrents[pi]) voiceCurrents[pi].textContent = label;
        const nodeEl = wwisePoolVoiceEls[pi];
        if (nodeEl) {
          const wasHidden = nodeEl.style.display === 'none';
          nodeEl.style.display = silent ? 'none' : '';
          if (wasHidden !== !!silent) topologyChanged = true;
        }
        if (!silent && buf) {
          drawVoiceWave(voiceWavePools[pi], buf);
          const fg = voiceWavePools[pi] && voiceWavePools[pi].fg;
          if (fg) { fg.style.transition = 'none'; fg.style.clipPath = 'inset(0 100% 0 0)'; }
        }
      });
      if (topologyChanged) drawWwiseLines();
      // Le libellé "section en cours" et le bloc de progression actif ne doivent changer qu'au moment où
      // cette génération devient réellement AUDIBLE — pas dès qu'elle est programmée. Avec la fenêtre de
      // programmation à l'avance (jusqu'à 1s), plusieurs décisions peuvent s'enchaîner en une seule fois
      // de façon synchrone (ex. une section à très peu de boucles qui avance presque aussitôt) : sans ce
      // délai, l'affichage sauterait déjà à la section suivante avant même que celle-ci ne se fasse
      // entendre, voire "clignoterait" sur une section jamais réellement audible pour le visiteur.
      if (secIdx != null && vrCurrentSectionOriginalIndex !== secIdx) {
        vrCurrentSectionOriginalIndex = secIdx;
        const declaredSection = (track.sections || [])[secIdx];
        if (sectionCurrentEl) sectionCurrentEl.textContent = (declaredSection && declaredSection.label) || t('sectionFallback', { n: secIdx + 1 });
        vrBlockEls.forEach((el, i) => { if (el) el.classList.toggle('active', i === secIdx); });
      }
    }, delayMs);
    voiceGraphTimeouts.push(timeoutId);
  }

