  // Surveille la prochaine frontière de temps ("beat") ou de mesure ("bar") de l'emplacement ACTUELLEMENT
  // audible, et déclenche la coupure dès qu'elle est atteinte SI un choix est en attente à ce moment-là —
  // sinon se réarme pour la frontière suivante (l'emplacement continue de se rejouer normalement tant
  // qu'aucun choix n'est fait). myEpoch protège contre les chaînes héritées d'un passage précédent sur cet
  // emplacement (ou un autre) : si l'epoch global a changé entretemps (nouveau passage, coupure survenue
  // par un autre chemin), cette chaîne s'éteint silencieusement au lieu de continuer à tourner en double.
  // afterTime : chercher la frontière qui suit cet instant (au lieu de « maintenant ») -- le minuteur se réveille un peu
  // AVANT la frontière (ENGINE_START_LEAD_SEC) pour programmer la coupure pile dessus, à l'échantillon près.
  function armNextSeqBranchBoundary(myEpoch, afterTime) {
    if (myEpoch !== seqBranchEpoch) return;
    if (!currentSeqBlockInfo || currentSeqBlockInfo.kind !== 'segment') return;
    const slotIdx = currentSeqBlockInfo.slotIdx;
    const slot = (slotIdx != null && slotIdx >= 0) ? (track.segmentSlots || [])[slotIdx] : null;
    if (!slot || !slot.nextOptions || !slot.nextOptions.length) return;
    const quant = slot.quantization || 'bar';
    const segStart = currentSeqBlockInfo.virtualZero;
    const timing = slotTiming(slot);
    const unitSec = quant === 'beat' ? timing.secondsPerBeat : (timing.beatsPerBar * timing.secondsPerBeat);
    const elapsed = Math.max(0, (afterTime != null ? afterTime : ctx.currentTime) - segStart);
    const stepsElapsed = Math.floor(elapsed / unitSec + 1e-6);
    const cutTime = segStart + (stepsElapsed + 1) * unitSec; // toujours la PROCHAINE frontière, strictement après maintenant
    const delayMs = Math.max(0, (cutTime - ENGINE_START_LEAD_SEC - ctx.currentTime) * 1000);
    const id = setTimeout(() => {
      if (myEpoch !== seqBranchEpoch) return; // périmée pendant l'attente (nouveau passage ou coupure survenue par ailleurs)
      if (pendingNextSegmentId) performSeqBranchCut(cutTime);
      else armNextSeqBranchBoundary(myEpoch, cutTime); // rien choisi à cette frontière : on surveille la suivante
    }, delayMs);
    seqTimeouts.push(id);
  }
  // Exécute la coupure : termine net ou en fondu (cutStyle) l'emplacement actuellement audible au point de
  // quantification atteint, annule toute génération déjà programmée mais pas encore audible (voir filtrage
  // de seqActiveSources plus bas), puis bascule vers la cible choisie — via un fichier de transition si l'embranchement
  // en déclare un (rejoue ensuite normalement, chevauchement crossfade-tail classique vers la cible), sinon
  // directement. Schéma "quantization"/"cutStyle"/"transition" validé le 02/08.
  // atTime : instant exact de la coupure (frontière de mesure / de temps) ; sans lui (quantification « immédiate »), juste
  // après l'appui.
  function performSeqBranchCut(atTime) {
    const targetId = pendingNextSegmentId;
    pendingNextSegmentId = null;
    updateSeqPendingIndicator();
    if (!currentSeqBlockInfo || currentSeqBlockInfo.kind !== 'segment' || currentSeqBlockInfo.slotIdx == null || currentSeqBlockInfo.slotIdx < 0 || !targetId) return;
    const sourceSlotIdx = currentSeqBlockInfo.slotIdx;
    const sourceSlot = (track.segmentSlots || [])[sourceSlotIdx];
    if (!sourceSlot) return;
    const targetIdx = (track.segmentSlots || []).findIndex(sl => sl.id === targetId);
    if (targetIdx < 0) return; // cible introuvable (id orphelin, ex. emplacement supprimé depuis) : l'emplacement continue de se rejouer normalement, rien de cassé
    seqBranchEpoch++; // invalide toute chaîne de vérification de frontière encore en vol pour l'emplacement qu'on quitte
    // Un choix de cible précis est plus spécifique qu'une demande générique "aller vers la fin" déjà en
    // attente (les deux boutons coexistent, rien n'empêche de cliquer les deux) — sans ça, decideNextSeqBlock()
    // route vers l'outro dès le prochain calcul et le visiteur n'entend jamais la cible qu'il vient de choisir.
    goToEndRequested = false;
    if (goToEndBtn) { goToEndBtn.disabled = false; goToEndBtn.textContent = t('goToEndBtn'); }
    const cutStyle = sourceSlot.cutStyle || 'fade';
    const now = atTime != null ? Math.max(atTime, ctx.currentTime) : startSoon(); // coupure pile sur la frontière (voir armNextSeqBranchBoundary)
    const opt = (sourceSlot.nextOptions || []).find(o => o.targetId === targetId);
    const oi = opt ? sourceSlot.nextOptions.indexOf(opt) : -1;
    applyFxActions(opt && opt.fxActions); // triggers d'effets liés à cette bascule (23/09)
    const transitionBuf = (oi >= 0 && transitionBuffers[sourceSlotIdx]) ? transitionBuffers[sourceSlotIdx][oi] : null;
    const transitionDurationSec = transitionBuf ? transitionDurationSecFor(opt, sourceSlot) : null;
    // Trois styles de coupure : "hard" (fin nette), "fade" (fondu court fixe, 0.15s — même durée que les
    // autres fondus courts du morceau, solo/muet, embranchement-vertical), "custom" (durée choisie par le
    // compositeur, `sourceSlot.customCutFadeSec`, en secondes réelles — pas en mesures, un fondu de sortie
    // n'a pas besoin d'être quantifié musicalement comme un segment).
    const fadeOutSec = cutStyle === 'custom' ? (sourceSlot.customCutFadeSec != null ? sourceSlot.customCutFadeSec : 0.15) : 0.15;
    // Repère de capture : le bloc suivant (transition ou cible) part sur une COUPURE -- l'outil vidéo éteint alors le
    // bloc quitté comme ici (net ou en fondu), au lieu de le laisser finir sa queue comme dans un enchaînement normal.
    seqPendingCut = { hard: cutStyle === 'hard', fadeSec: cutStyle === 'hard' ? 0 : fadeOutSec };
    if (currentSeqBlockInfo.gainNode) {
      const g = currentSeqBlockInfo.gainNode;
      g.gain.cancelScheduledValues(now);
      if (cutStyle === 'hard') {
        g.gain.setValueAtTime(0, now);
      } else {
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + fadeOutSec);
      }
    }
    // Le scheduler normal programme jusqu'à 1s à l'avance (voir seqSchedulerTick) : au moment d'une coupure,
    // une ou PLUSIEURS générations peuvent déjà être programmées (source.start() déjà appelé sur le
    // contexte audio) sans être encore audibles — un emplacement court peut suffire à en empiler plusieurs
    // dans la même fenêtre. Toutes sont maintenant caduques et doivent être coupées avant leur heure de
    // départ, sinon elles sonnent quand même par-dessus la nouvelle destination : Web Audio ne sait pas
    // qu'elles sont devenues obsolètes tant qu'on ne les arrête pas explicitement une par une. Ne retenir
    // que "la dernière programmée" (ancien seqNextScheduled, une seule référence) ne suffisait pas dès que
    // plus d'une génération future était en attente — bug trouvé le 06/08 (chevauchement audible entre
    // l'ancien et le nouvel emplacement, signalé par Jules-Antoine). La génération ACTUELLEMENT audible
    // (ctxStartTime <= now) n'est jamais concernée ici : elle est déjà en train de s'éteindre via son
    // gainNode juste au-dessus.
    seqActiveSources = seqActiveSources.filter(({ src, ctxStartTime: st }) => {
      if (st > ctx.currentTime) { try { src.stop(); } catch (e) {} return false; } // pas encore audible : annulé
      return true;
    });
    seqTimeouts.forEach(id => clearTimeout(id)); seqTimeouts = [];
    if (transitionBuf) {
      // Repère pour le mode Capture (pack.html, 2026-09-15), même principe que seq_slot_start : contrairement
      // à une génération normale (programmée jusqu'à 1s à l'avance), une coupure part quasi immédiatement --
      // pas de décalage d'anticipation à corriger ici.
      seqOutcomeByBuffer.set(transitionBuf, { name: 'seq_transition_start', detail: { trackId: track.id, fromSlotId: sourceSlot.id, targetId } });
      forcedNextBlock = {
        buffer: transitionBuf, label: (opt.transition && opt.transition.label) || t('transitionFallbackLabel'),
        durationSec: transitionDurationSec, terminal: false, kind: 'transition',
        gain: effGain(opt.transition), slotIdx: -1, desc: pickStageDescription(opt.transition),
        // Identité de l'arête (05/09, boule "en train de jouer") -- portée par le bloc plutôt que déduite
        // plus tard : au moment où ce bloc devient réellement audible (voir activateSeqStage), currentSlotIndex
        // pointe déjà sur la cible (posé juste en dessous), donc source/cible ne sont plus récupérables autrement.
        fromSlotIdx: sourceSlotIdx, toSlotIdx: targetIdx
      };
    }
    // currentSlotIndex pointe maintenant sur la cible : que le bloc immédiatement suivant soit la
    // transition injectée (forcedNextBlock, consommée une seule fois) ou directement la cible (pas de
    // transition définie pour cet embranchement), decideNextSeqBlock() retombera ensuite naturellement sur
    // pickNextSegmentSlot() pour CET emplacement — exactement le même mécanisme qu'un enchaînement normal.
    currentSlotIndex = targetIdx;
    currentSlotRepeatsPlayed = 0;
    seqNextStartCtxTime = now;
    seqSchedulerTick();
  }
  // fillDurationSec : temps restant à animer jusqu'à 100% (pas forcément la durée totale du bloc — après
  // un seek, on reprend au milieu). totalDurationSec : durée nominale complète du bloc, nécessaire pour
  // savoir où se trouve le curseur de seek même après plusieurs reprises successives.
  function scheduleSeqLabelUpdate(ctxStartTime, label, kind, fillDurationSec, totalDurationSec, buffer, gainValue, terminal, slotIdx, gainNode, desc, fromSlotIdx, toSlotIdx) {
    const delayMs = Math.max(0, (ctxStartTime - ctx.currentTime) * 1000);
    const id = setTimeout(() => {
      pulseMeter(seqMeterEl);
      if (seqCurrentEl) seqCurrentEl.textContent = label;
      // "" (aucun texte propre à cet élément) laisse volontairement le texte déjà affiché tel quel — voir
      // pickStageDescription().
      if (desc && trackDescEl) trackDescEl.innerHTML = linkify(desc);
      if (kind) activateSeqStage(kind, (fillDurationSec != null) ? fillDurationSec : buffer.duration, totalDurationSec, buffer, gainValue, terminal, slotIdx, gainNode, fromSlotIdx, toSlotIdx, ctxStartTime);
    }, delayMs);
    seqTimeouts.push(id);
  }
  // Repères de capture du séquentiel (25/09) : quel évènement annoncer quand un fichier devient audible (renseigné par
  // celui qui choisit le bloc, relu par scheduleSeqGeneration -- aussi pour une reprise en cours de fichier), et la
  // coupure en attente d'être signalée par le prochain bloc.
  const seqOutcomeByBuffer = new Map();
  let seqPendingCut = null;
  function scheduleSeqGeneration(ctxStartTime, buffer, label, kind, fillDurationSec, gainValue, offsetSec, totalDurationSec, terminal, slotIdx, desc, fromSlotIdx, toSlotIdx) {
    if (!buffer) return;
    const off = offsetSec || 0;
    const total = totalDurationSec != null ? totalDurationSec : ((fillDurationSec != null) ? fillDurationSec + off : buffer.duration);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    applyTrackPitchRate(src, ctxStartTime);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainValue != null ? gainValue : 1, ctxStartTime);
    // fx : porté par l'emplacement (segmentSlot) pour un segment -- même chaîne quel que soit le tirage
    // qui le remplit, cf. la logique retenue pour vertical-random (pool) -- ou par intro/outro directement
    // pour ces deux cas particuliers, qui n'ont qu'un seul fichier chacun.
    const fxSource = kind === 'segment' ? (slotIdx != null ? (track.segmentSlots || [])[slotIdx] : null)
      : kind === 'intro' ? track.intro : kind === 'outro' ? track.outro
      : kind === 'transition' ? seqTransitionDefByBuffer.get(buffer) : null; // transition : ses propres effets (27/09)
    const fxChain = buildTargetFxChain(kind === 'segment' && slotIdx != null ? 'slot:' + slotIdx : kind, fxSource && fxSource.fx, src, ctxStartTime);
    if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
    g.connect(trackMasterGain);
    // Chaque bloc rejoue une fois sans boucle -- onended est un point de nettoyage fiable pour le
    // bitcrusher, comme pour les autres moteurs. armSeqFinalEnd() (bloc terminal) CHAÎNE sur ce handler
    // plutôt que de l'écraser -- voir son commentaire.
    if (fxChainHasLeakyNode(fxChain)) {
      src.onended = () => { disconnectLeakyFxNodes(fxChain); };
    }
    journalVoice(src, g, fxChain);
    src.start(ctxStartTime, off);
    seqActiveSources.push({ src, gain: g, ctxStartTime });
    // Télémétrie + repère de capture du bloc, émis au moment où il devient AUDIBLE (pas quand il est programmé,
    // jusqu'à 1 s plus tôt) : un bloc programmé puis annulé par une coupure (seqTimeouts vidé) n'est jamais annoncé.
    // Un bloc repris en cours de fichier (saut dans la frise, reprise après pause) n'est qu'un repère de capture :
    // il ne compte pas une deuxième fois dans les statistiques.
    const outcome = seqOutcomeByBuffer.get(buffer);
    const rateAtCreate = trackPitchRatio; // vitesse de CE bloc (programmé jusqu'à 1 s avant d'être audible) -- pour l'export
    const cut = off > 0 ? null : seqPendingCut;
    if (off <= 0) seqPendingCut = null;
    if (outcome) {
      const emitId = setTimeout(() => {
        const detail = Object.assign({}, outcome.detail, cut ? { cut } : {});
        if (off > 0) captureMark(outcome.name, Object.assign(detail, { offset: off, resumed: true, at: ctxStartTime, rate: rateAtCreate }));
        else trackPublicEvent(outcome.name, detail, { at: ctxStartTime, rate: rateAtCreate });
      }, Math.max(0, (ctxStartTime - ctx.currentTime) * 1000));
      seqTimeouts.push(emitId);
    }
    seqLastGenSources = [src];
    // Sans durée explicite (cas de l'outro, qui ne programme rien après elle) : on anime le remplissage
    // sur la durée réelle du fichier décodé, seule longueur connue dans ce cas.
    scheduleSeqLabelUpdate(ctxStartTime, label, kind, fillDurationSec, total, buffer, gainValue, terminal, slotIdx, g, desc, fromSlotIdx, toSlotIdx);
  }
  // Détermine le prochain bloc à programmer : soit l'outro (si "Aller vers la fin" a été demandé et
  // qu'une outro existe), soit rien du tout (demande faite mais pas d'outro : on laisse filer), soit
  // un segment tiré au sort. `terminal: true` signifie "rien à programmer après ce bloc".
  function decideNextSeqBlock() {
    if (forcedNextBlock) { const b = forcedNextBlock; forcedNextBlock = null; return b; }
    if (goToEndRequested) {
      goToEndRequested = false;
      if (outroBuffer) {
        // Repère pour le mode Capture -- l'outro est terminale (rien après), donc sa durée réelle n'a pas
        // besoin d'être anticipée par materializeLayerSegments : elle va jusqu'à la fin de la prise.
        seqOutcomeByBuffer.set(outroBuffer, { name: 'seq_outro_start', detail: { trackId: track.id } });
        return { buffer: outroBuffer, label: (track.outro && track.outro.label) || 'Outro', durationSec: null, terminal: true, kind: 'outro', gain: effGain(track.outro), desc: pickStageDescription(track.outro) };
      }
      return null;
    }
    const picked = pickNextSegmentSlot();
    if (!picked) return null;
    const slot = track.segmentSlots[picked.slotIdx];
    const alt = resolveSlotAlternative(picked.slotIdx, picked.altIdx);
    // Repère générique pour le mode Capture (pack.html, 2026-09-15) : contrairement à seq_branch_select
    // (qui ne fire que sur un clic manuel d'embranchement), ce point de passage voit TOUJOURS un nouveau
    // segment, qu'il vienne d'un enchaînement automatique ou d'une coupure -- même principe que
    // embr_loop_select pour l'embranchement-vertical. altIndex précise quelle variation a été tirée au
    // sort, indispensable pour rejouer fidèlement ce qui a vraiment été entendu. Purement une nouvelle
    // ligne d'analytics, silencieuse si personne ne l'écoute -- aucun effet sur la lecture elle-même.
    // Note : programmé jusqu'à `lookahead` (1s) avant de devenir réellement audible (voir seqSchedulerTick
    // plus bas), donc légèrement en avance sur le son perçu -- acceptable pour une capture, pas pour un
    // minutage sample-accurate.
    seqOutcomeByBuffer.set(slotBuffers[picked.slotIdx][picked.altIdx], { name: 'seq_slot_start', detail: { trackId: track.id, slotId: slot.id, altIndex: picked.altIdx } });
    return { buffer: slotBuffers[picked.slotIdx][picked.altIdx], label: (alt && alt.label) || (slot.label || ('Emplacement ' + (picked.slotIdx + 1))), durationSec: blockSeconds(alt && alt.bars, slot), terminal: false, kind: 'segment', gain: effGain(alt), slotIdx: picked.slotIdx, desc: pickStageDescription(slot) };
  }
  function armSeqFinalEnd() {
    const marker = seqLastGenSources[0];
    if (!marker) return;
    seqFinalMarkerSrc = marker;
    // Chaîne sur un éventuel onended déjà posé par scheduleSeqGeneration (nettoyage du bitcrusher, voir
    // plus haut) plutôt que de l'écraser -- affecter .onended REMPLACE tout gestionnaire précédent, pas
    // un addEventListener -- l'écraser aurait fait fuir le ScriptProcessorNode du bloc terminal.
    const previousOnEnded = marker.onended;
    marker.onended = () => {
      if (previousOnEnded) previousOnEnded();
      if (seqFinalMarkerSrc !== marker) return; // piste arrêtée/relancée entretemps : on ignore
      seqActiveSources = [];
      playing = false;
      playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
      setStoppedUI();
      if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('goToEndBtn'); }
      if (activeTrackId === track.id) activeTrackId = null;
    };
  }
  function seqSchedulerTick() {
    const lookahead = 1.0;
    while (seqNextStartCtxTime < ctx.currentTime + lookahead) {
      const next = decideNextSeqBlock();
      if (!next) {
        clearInterval(seqSchedulerTimer); seqSchedulerTimer = null;
        armSeqFinalEnd();
        return;
      }
      scheduleSeqGeneration(seqNextStartCtxTime, next.buffer, next.label, next.kind, next.terminal ? null : next.durationSec, next.gain, 0, null, next.terminal, next.slotIdx, next.desc, next.fromSlotIdx, next.toSlotIdx);
      if (next.terminal) {
        clearInterval(seqSchedulerTimer); seqSchedulerTimer = null;
        armSeqFinalEnd();
        return;
      }
      seqNextStartCtxTime += next.durationSec / trackPitchRatio;
    }
  }
  function stopSequential() {
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
    seqFinalMarkerSrc = null;
    if (seqSchedulerTimer) { clearInterval(seqSchedulerTimer); seqSchedulerTimer = null; }
    seqActiveSources.forEach(({ src }) => { try { src.stop(); } catch(e){} });
    seqActiveSources = [];
    seqTimeouts.forEach(id => clearTimeout(id));
    seqTimeouts = [];
    goToEndRequested = false;
    pendingNextSegmentId = null;
    seqBranchEpoch++; // éteint silencieusement toute chaîne de vérification de frontière encore en vol
    forcedNextBlock = null;
    if (seqMeterEl) seqMeterEl.classList.remove('pulse');
    if (seqCurrentEl) seqCurrentEl.textContent = '—';
    // Symétrique à seqCurrentEl ci-dessus : à un vrai arrêt (pas une reprise, voir seekSequential qui ne
    // passe jamais par ici), le texte affiché revient à la description de base du morceau plutôt que de
    // rester figé sur le dernier emplacement/transition entendu.
    if (trackDescEl) trackDescEl.innerHTML = linkify(track.description || '');
    if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('goToEndBtn'); }
    resetSeqStages();
    updateSeqPendingIndicator();
    // Carte globale (02/09) : plus aucun nœud "courant" une fois arrêté -- l'historique (seqVisitedSlotIds)
    // reste volontairement affiché tel quel (ce qui a été découvert cette session le reste), voir
    // playSequential() pour le seul cas où il est vraiment remis à zéro (un vrai redémarrage, pas juste Stop).
    // Idem pour la boule de transition (05/09) : plus rien n'est audible à l'arrêt, jamais "en train de jouer".
    currentTransitionEdge = null;
    updateSeqMap(-1);
  }
  function playSequential(isContinuation) {
    stopSequential();
    // Un vrai démarrage (pas une reprise après pause/veille) repart du premier emplacement de la chaîne —
    // la reprise, elle, continue le cycle là où il en était plutôt que de tout redémarrer. La carte globale
    // suit la même règle : un vrai redémarrage efface l'historique de découverte, une reprise le conserve.
    if (!isContinuation) {
      chainState = { cyclesCompleted: 0, capReached: false };
      // Ordre aléatoire : le premier emplacement est tiré dans le premier tour mélangé, pas forcément le n°1.
      currentSlotIndex = (track.randomizeSections && (track.segmentSlots || []).length)
        ? advanceChainIndex(-1, track.segmentSlots.length, chainState, track.maxChainLoops, true) : 0;
      seqVisitedSlotIds = new Set();
      seqRoundPlayedIds = new Set(); seqRoundLastIdx = -1;
    }
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    let firstBuffer, firstLabel, firstDurationSec, firstKind, firstGain, firstDesc, firstSlotIdx = -1;
    if (!isContinuation && introBuffer) {
      // L'intro n'appartient à aucun emplacement — son tempo suit celui du premier emplacement de la
      // chaîne (position 0, point de départ conventionnel), même principe que le vertical-random dont
      // l'intro suit le tempo de la première section jouable.
      const firstSlot = (track.segmentSlots || [])[0];
      firstBuffer = introBuffer; firstLabel = (track.intro && track.intro.label) || 'Intro'; firstDurationSec = blockSeconds(track.intro && track.intro.bars, firstSlot); firstKind = 'intro'; firstGain = effGain(track.intro); firstDesc = pickStageDescription(track.intro);
      // Repère pour le mode Capture -- l'intro ne passe jamais par decideNextSeqBlock() (voir son
      // commentaire pour seq_slot_start), donc pas couverte par ce repère-là : son propre événement.
      seqOutcomeByBuffer.set(introBuffer, { name: 'seq_intro_start', detail: { trackId: track.id } });
    } else {
      const picked = pickNextSegmentSlot();
      if (!picked) { if (statusEl) statusEl.textContent = t('noSegmentAvailable'); return; }
      const slot = track.segmentSlots[picked.slotIdx];
      const alt = resolveSlotAlternative(picked.slotIdx, picked.altIdx);
      // Même repère que dans decideNextSeqBlock() ci-dessus, pour le tout premier segment (celui-ci ne
      // passe jamais par decideNextSeqBlock() -- voir le commentaire là-bas pour le raisonnement complet).
      seqOutcomeByBuffer.set(slotBuffers[picked.slotIdx][picked.altIdx], { name: 'seq_slot_start', detail: { trackId: track.id, slotId: slot.id, altIndex: picked.altIdx } });
      firstBuffer = slotBuffers[picked.slotIdx][picked.altIdx]; firstLabel = (alt && alt.label) || (slot.label || ('Emplacement ' + (picked.slotIdx + 1))); firstDurationSec = blockSeconds(alt && alt.bars, slot); firstKind = 'segment'; firstGain = effGain(alt); firstSlotIdx = picked.slotIdx; firstDesc = pickStageDescription(slot);
    }
    scheduleSeqGeneration(now, firstBuffer, firstLabel, firstKind, firstDurationSec, firstGain, 0, null, false, firstSlotIdx, firstDesc);
    seqNextStartCtxTime = now + firstDurationSec / trackPitchRatio;
    seqSchedulerTimer = setInterval(seqSchedulerTick, 200);
    if (goToEndBtn) goToEndBtn.disabled = false;
  }
  // Seek dans le bloc actuellement actif (glisser sur sa waveform) : on arrête proprement tout ce qui est
  // programmé (comme un stop classique), puis on relance le MÊME buffer à la nouvelle position, et on
  // reprend la boucle de planification pour la suite comme si de rien n'était — le prochain segment tiré
  // au sort, ou la fin, ne sont pas affectés par le seek.
  function seekSequential(targetSec) {
    if (!currentSeqBlockInfo || !playing) return;
    const { kind, buffer, gain, totalSec, terminal, slotIdx } = currentSeqBlockInfo;
    const off = Math.max(0, Math.min(totalSec - 0.05, targetSec));
    const remaining = totalSec - off;
    // Capturé AVANT stopSequential() (qui remet le libellé affiché à "—") — bug trouvé le 13/08 en
    // réutilisant cette fonction pour la reprise après changement d'onglet : l'audio rejouait bien le bon
    // segment à la bonne position, mais l'étiquette affichée retombait à "—" au lieu de son nom, capturée
    // une fois déjà écrasée par l'arrêt.
    const label = seqCurrentEl ? seqCurrentEl.textContent : '';
    // Même piège que pour `label` juste au-dessus (et déjà corrigé une fois pour lui, le 13/08) : ma propre
    // remise à zéro de trackDescEl dans stopSequential() (ajoutée le 15/08) écraserait le texte affiché par
    // un vrai arrêt alors qu'un seek n'est qu'un redémarrage interne du même bloc. Capturé avant, restauré
    // après, à l'identique.
    const descHtml = trackDescEl ? trackDescEl.innerHTML : '';
    // stopSequential() remet goToEndRequested à false (comportement voulu pour un vrai arrêt) — mais un
    // seek n'est qu'un redémarrage interne du même bloc, pas un arrêt demandé par le visiteur. Si "Aller
    // vers la fin" avait été cliqué et n'était pas encore consommé (bloc courant non terminal), la demande
    // doit survivre au seek, sans quoi le morceau continue de boucler comme si rien n'avait été cliqué.
    // Même logique pour un choix d'embranchement en attente : un seek ne doit pas l'annuler.
    const wasGoToEndRequested = goToEndRequested;
    const wasPendingNextSegmentId = pendingNextSegmentId;
    stopSequential();
    goToEndRequested = wasGoToEndRequested;
    pendingNextSegmentId = wasPendingNextSegmentId;
    if (trackDescEl) trackDescEl.innerHTML = descHtml;
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    // Important : on transmet TOUJOURS `remaining` (durée réellement restante après le seek), y compris
    // pour un bloc terminal (l'outro). Le passer à null ici (comme le fait le premier appel normal, sans
    // seek, où l'décalage est de toute façon 0) ferait retomber le calcul du remplissage visuel sur
    // buffer.duration — la durée TOTALE du fichier plutôt que ce qu'il en reste après le point de seek —
    // et le curseur se recalerait visuellement comme si la lecture repartait du tout début, alors que
    // l'audio, lui, joue bien depuis la bonne position.
    scheduleSeqGeneration(now, buffer, label, kind, remaining, gain, off, totalSec, terminal, slotIdx);
    if (terminal) {
      armSeqFinalEnd();
      if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('endingWithOutro'); }
    } else {
      seqNextStartCtxTime = now + remaining / trackPitchRatio;
      seqSchedulerTimer = setInterval(seqSchedulerTick, 200);
      // Le bouton doit refléter l'état réel : si la demande est encore en attente (restaurée ci-dessus),
      // il doit rester désactivé avec son texte "en cours de fin", pas se réactiver comme si de rien n'était.
      if (goToEndBtn) {
        if (goToEndRequested) {
          goToEndBtn.disabled = true;
          goToEndBtn.textContent = track.outro ? t('endingWithOutro') : t('endingLastSegment');
        } else {
          goToEndBtn.disabled = false;
        }
      }
    }
  }
  let level = 0, playing = false, startedAt = 0, offsetAt = (useQuantizedLoop ? startTrackSec : 0), rafId = null, ready = false;
  let isDraggingSeek = false; // vrai pendant qu'on glisse sur la barre de lecture — tick() ne doit pas écraser la position affichée pendant ce temps

  const PLAY_SVG = '<path d="M8 5v14l11-7z"/>';
  const PAUSE_SVG = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
