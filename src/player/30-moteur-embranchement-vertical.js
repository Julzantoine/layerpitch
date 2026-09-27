  /* ---- Moteur embranchement-vertical : N boucles nommées et autonomes, calées sur le même BPM,
     jouant simultanément en arrière-plan pour les boucles de MÊME longueur que la référence (celle
     marquée isInitial) — bascule entre elles par pure rampe de gain (0.15s, même mécanisme que le
     solo/muet ci-dessus), sans redémarrage audio donc sans décalage. Une boucle plus courte que la
     référence n'est PAS jouée en arrière-plan (aucun verrouillage de phase naturel avec le cycle de
     référence) : au clic, lecture fraîche en fondu d'entrée, puis retour automatique à la référence une
     fois sa durée nominale écoulée (voir schéma validé le 31/07). Réutilise blockSeconds() du moteur
     séquentiel pour rester sur une seule notion de "durée en mesures" dans tout le fichier. ---- */
  const embrReferenceIdx = embrReferenceIndex(track);
  // Classification paire/détour explicite (isDetour, 24/08) plutôt qu'une comparaison implicite des
  // mesures -- avec repli sur l'ancienne comparaison si le champ est absent du JSON chargé (morceau publié
  // avant ce changement, pas encore republié depuis). Une fois republié via le backstage, `isDetour` est
  // toujours explicitement présent (migré à la volée côté loadData()) et ce repli ne joue plus.
  const embrPeerIndices = embrPeerIndicesOf(track);
  // Durée nominale du fichier de transition d'une boucle avant que la boucle cible ne commence réellement
  // à monter (29/08, même mécanisme que transitionDurationSecFor() côté branching séquentiel, décision
  // confirmée par Jules-Antoine, complété le 29/08 avec l'unité "temps" pour rester cohérent avec le
  // séquentiel) : `durationUnit` réglé -> mesures ou temps individuels (tempo propre à la transition,
  // repli sur celui de la boucle quittée puis celui du morceau, via transitionTiming()) ou secondes
  // explicites, mêmes conventions que le séquentiel. Rien de réglé -> durée réelle du fichier décodé
  // lui-même plutôt que blockSeconds() : contrairement aux transitions séquentielles (toujours créées avec
  // `bars: 4` par défaut), une transition d'embranchement-vertical n'a par défaut AUCUNE valeur de mesures
  // -- un repli par mesures y donnerait une durée arbitraire (potentiellement plusieurs secondes de silence
  // sur la cible) plutôt que la durée réelle du fichier déposé.
  function embrTransitionDurationSecFor(loopDef, sourceLoopDef, buf) { return embrTransitionDurationSec(track, loopDef, sourceLoopDef, buf ? buf.duration : 0); }
  // Joue le fichier de transition (24/08) de la boucle CIBLE, s'il en existe un -- en overlay, superposé au
  // fondu de coupure plutôt qu'inséré séquentiellement entre les deux boucles (bien plus simple à
  // synchroniser correctement, et suffisant pour l'usage visé : un whoosh/une texture qui accompagne la
  // bascule plutôt qu'un vrai montage Wwise à embranchements). Suivie dans embrActiveTransitionSources
  // (contrairement à une vraie source "fire-and-forget") uniquement pour pouvoir la couper sur Stop --
  // bug trouvé à la relecture du 24/08 : sans ce suivi, une transition encore audible continuerait de
  // sonner après un Stop, la seule source de ce moteur à ne pas être coupée proprement.
  function playEmbrTransitionIfAny(loopIdx, ctxStartTime) {
    const buf = embrTransitionBuffers[loopIdx];
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    applyTrackPitchRate(src, ctxStartTime);
    // Effets (27/09) : ceux de la transition elle-même, plus les triggers du morceau entier -- même chaîne que les autres
    // éléments (qui gère aussi le retard des effets à ScriptProcessor, comme avant pour cet overlay).
    const transDef = ((track.loops || [])[loopIdx] || {}).transition;
    const fxChain = buildTargetFxChain('transition', transDef && transDef.fx, src, ctxStartTime);
    if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(trackMasterGain); } else src.connect(trackMasterGain);
    journalVoice(src, null, fxChain);
    src.start(ctxStartTime, 0);
    embrMark('embr_transition', { loopId: ((track.loops || [])[loopIdx] || {}).id, at: ctxStartTime });
    embrActiveTransitionSources.push(src);
    src.onended = () => {
      if (fxChainHasLeakyNode(fxChain)) disconnectLeakyFxNodes(fxChain);
      const i = embrActiveTransitionSources.indexOf(src);
      if (i !== -1) embrActiveTransitionSources.splice(i, 1);
    };
  }
  // Points de boucle (Départ/Entrée/Sortie) de la boucle de référence (24/08) -- optionnels. S'ils sont
  // réglés (Sortie > Entrée), remplacent le calcul de durée de cycle par simple nombre de mesures : la
  // fenêtre de lecture Entrée->Sortie devient le cycle réel, et TOUTE génération (référence et boucles
  // paires, sur leur PROPRE fichier -- verrouillage de phase, décision validée le 24/08) démarre à
  // "Entrée" plutôt qu'au tout début du fichier. Le tout premier lancement démarre en revanche à "Départ"
  // (peut être avant "Entrée"), qui ne joue donc qu'une seule fois -- même principe que le moteur quantifié
  // classique (voir bufferOffset plus haut dans ce fichier). Aucun réglage -> comportement d'origine
  // inchangé (durée = nombre de mesures, démarrage à l'offset 0 pour toutes les générations).
  // Pas encore de fichier probé : ancien calcul par mesures. Pas de Sortie réglée : le cycle va jusqu'à la fin réelle du
  // fichier (24/08, "Mesures" est vestige une fois un fichier chargé). Voir embrLoopTimingOf.
  function embrLoopTiming() { return embrLoopTimingOf(track); }
  function embrCycleLengthSec() { return embrLoopTiming().cycleLength; }
  // Le bouton d'une boucle EST masqué (pas seulement désactivé) tant qu'elle est celle effectivement
  // audible -- inutile d'afficher un bouton vers ce qui joue déjà (retour de Jules-Antoine, 29/08).
  // S'applique aussi bien à une boucle "paire" (embrActiveLoopIdx) qu'à un détour en cours (embrDetourBtn,
  // déjà désactivé par ailleurs -- le masquage remplace ici ce simple grisage). Seulement pendant une
  // lecture réelle (`playing`) : dans l'état "Prêt" avant tout premier clic sur Écouter, la référence est
  // déjà marquée .active par défaut (rendu serveur) mais rien ne joue encore -- son bouton doit rester
  // visible et cliquable comme les autres à ce stade.
  function updateEmbrButtonsUI() {
    embrLoopBtns.forEach(btn => {
      const idx = parseInt(btn.dataset.loopIdx, 10);
      btn.classList.toggle('active', idx === embrActiveLoopIdx);
      // Gabarit riche (2-7 boucles paires, voir buildTrackRow) : jamais masqué, même la boucle
      // actuellement audible -- sa forme d'onde doit rester visible et continuer d'avancer (demande du
      // 02/09). Le masquage display:none n'est conservé que pour le gabarit compact ci-dessous, inchangé.
      if (btn.classList.contains('embr-wave-btn')) { btn.style.display = ''; return; }
      const isCurrentlyAudible = playing && (idx === embrActiveLoopIdx || btn === embrDetourBtn);
      btn.style.display = isCurrentlyAudible ? 'none' : '';
    });
  }
  // Anime la progression continue des lignes riches -- calée UNE SEULE FOIS par (re)démarrage de
  // l'horloge de phase (embrClockReset vient justement d'être appelé par
  // l'appelant, playEmbrVertical()/resumeEmbrVerticalAfterBackground()), jamais recalculée à chaque
  // bascule : le verrouillage de phase entre boucles paires ne change pas quand on change laquelle est
  // audible (refreshEmbrGains est une pure rampe de gain, voir son commentaire d'en-tête). N'affecte que
  // les boutons en gabarit riche (classe .embr-wave-btn) -- silencieusement ignoré pour les autres.
  // startPosSec (25/09, seek par clic sur la forme d'onde) : position dans le cycle à laquelle l'animation
  // reprend (délai négatif). L'animation est toujours REDÉMARRÉE (animation: none + reflow) plutôt que
  // simplement relancée -- sinon elle repartirait de là où elle avait été mise en pause, désynchronisée
  // de l'audio, et un clip-path posé pendant un glisser resterait masqué par l'animation.
  function applyEmbrWaveAnimation(startPosSec, ratioOverride) {
    const cycle = embrCycleLengthSec();
    if (!(cycle > 0)) return;
    embrLoopBtns.forEach(btn => {
      const fg = btn.querySelector('.embr-wave-fg');
      if (!fg) return;
      fg.style.animation = 'none';
      fg.style.clipPath = '';
      void fg.offsetWidth;
      fg.style.animation = '';
      // Durées RÉELLES : cycle et position sont en temps nominal, joués à la vitesse audible (27/09 -- avant, l'animation
      // ignorait la vitesse du morceau et se décalait dès qu'elle n'était pas à 1).
      const r = ratioOverride || embrClockSegAt(ctx.currentTime).ratio || 1;
      fg.style.animationDuration = (cycle / r) + 's';
      fg.style.animationDelay = (-(startPosSec || 0) / r) + 's';
      fg.style.animationPlayState = 'running';
    });
  }
  // Repasse toutes les lignes riches en pause (état "Prêt", plus rien ne joue) -- évite une animation qui
  // continue de tourner dans le vide après un Stop.
  function pauseEmbrWaveAnimation() {
    embrLoopBtns.forEach(btn => {
      const fg = btn.querySelector('.embr-wave-fg');
      if (fg) fg.style.animationPlayState = 'paused';
    });
  }
  // Ligne overlay "en surimpression" affichée pendant la lecture d'un fichier de transition (voir
  // playEmbrTransitionIfAny) -- même mécanisme one-shot clip-path que animateMainWaveProgress() du
  // lecteur Sfx (buildSfxPlayer), réutilisé via renderWaveformPair() plutôt que dupliqué. Pendant qu'elle
  // est affichée, les lignes riches de la boucle quittée ET de la boucle ciblée passent "en filigrane"
  // (classe .embr-transition-dim, opacity 0.5 -- sans effet sur un bouton non riche) sans jamais
  // interrompre leur propre animation continue.
  let embrTransitionRowEl = null;
  function removeEmbrTransitionOverlay() {
    if (embrTransitionRowEl) { embrTransitionRowEl.remove(); embrTransitionRowEl = null; }
    embrLoopBtns.forEach(btn => btn.classList.remove('embr-transition-dim'));
  }
  function showEmbrTransitionOverlay(fromIdx, toIdx, buf, durationSec) {
    removeEmbrTransitionOverlay();
    const picker = wrapper.querySelector('[data-role="embrLoopPicker"]');
    if (!picker || !buf || !(durationSec > 0)) return;
    const row = document.createElement('div');
    row.className = 'embr-transition-row';
    row.innerHTML = '<canvas class="embr-wave-bg"></canvas><canvas class="embr-wave-fg"></canvas>';
    picker.appendChild(row);
    embrTransitionRowEl = row;
    const bg = row.querySelector('.embr-wave-bg'), fg = row.querySelector('.embr-wave-fg');
    renderWaveformPair(bg, fg, buf, waveBgColor, waveFgColor);
    fg.style.animation = 'none';
    fg.style.transition = 'none';
    fg.style.clipPath = 'inset(0 100% 0 0)';
    void fg.offsetWidth; // force le reflow avant de redémarrer la transition, même truc qu'ailleurs dans ce fichier
    fg.style.transition = `clip-path ${durationSec}s linear`;
    fg.style.clipPath = 'inset(0 0% 0 0)';
    [fromIdx, toIdx].forEach(idx => {
      const btn = embrLoopBtns.find(b => parseInt(b.dataset.loopIdx, 10) === idx);
      if (btn) btn.classList.add('embr-transition-dim');
    });
  }
  // Ligne dédiée à un détour en cours -- deux variantes : one-shot (clip-path fixe sur sa durée nominale,
  // même mécanisme que la ligne de transition ci-dessus) pour un détour minuté, boucle infinie (même
  // mécanisme que applyEmbrWaveAnimation, durée = celle du buffer lui-même) pour un détour "en boucle
  // jusqu'à un bouton" (detourMode === 'loop', src.loop = true côté moteur -- voir startDetour()).
  let embrDetourRowEl = null;
  function removeEmbrDetourWaveRow() {
    if (embrDetourRowEl) { embrDetourRowEl.remove(); embrDetourRowEl = null; }
  }
  function showEmbrDetourWaveRow(buf, durationSec, isLooping) {
    removeEmbrDetourWaveRow();
    const picker = wrapper.querySelector('[data-role="embrLoopPicker"]');
    if (!picker || !buf) return;
    const row = document.createElement('div');
    row.className = 'embr-detour-wave-row';
    row.innerHTML = '<canvas class="embr-wave-bg"></canvas><canvas class="embr-wave-fg"></canvas>';
    picker.appendChild(row);
    embrDetourRowEl = row;
    const bg = row.querySelector('.embr-wave-bg'), fg = row.querySelector('.embr-wave-fg');
    renderWaveformPair(bg, fg, buf, waveBgColor, waveFgColor);
    if (isLooping) {
      // durationSec = durée RÉELLE d'un tour (vitesse du morceau comprise, 27/09) ; avant, la durée du fichier était prise
      // telle quelle et l'animation se décalait dès que la vitesse n'était pas à 1.
      fg.style.animationDuration = (durationSec > 0 ? durationSec : buf.duration) + 's';
      fg.style.animationDelay = '0s';
      fg.style.animationPlayState = 'running';
    } else if (durationSec > 0) {
      fg.style.animation = 'none';
      fg.style.transition = 'none';
      fg.style.clipPath = 'inset(0 100% 0 0)';
      void fg.offsetWidth;
      fg.style.transition = `clip-path ${durationSec}s linear`;
      fg.style.clipPath = 'inset(0 0% 0 0)';
    }
  }
  // Programme une génération de toutes les boucles "paires" (même longueur que la référence) en simultané,
  // gain à 1 pour celle actuellement active, 0 pour les autres — même principe que scheduleGeneration()
  // du moteur quantifié classique (retrigger périodique avec queue de fin superposée), généralisé à des
  // buffers indépendants au lieu des couches d'un seul morceau. isFirst (24/08) : seule la toute première
  // génération de la lecture démarre à "Départ" (offset embrLoopTiming().startSec) -- toutes les
  // suivantes démarrent à "Entrée" (embrLoopTiming().loopInSec), même principe que le moteur quantifié
  // classique.
  function scheduleEmbrGeneration(ctxStartTime, isFirst, offsetOverride) {
    const timing = embrLoopTiming();
    const bufferOffset = offsetOverride != null ? offsetOverride : (isFirst ? timing.startSec : timing.loopInSec);
    // Repère de capture : nouvelle génération des boucles jumelles (toutes démarrent ensemble, seule la boucle active
    // est audible).
    captureMark('embr_gen', { trackId: track.id, bufferOffset, at: ctxStartTime, rate: trackPitchRatio,
      active: embrActiveLoopIdx >= 0 ? ((track.loops || [])[embrActiveLoopIdx] || {}).id : null,
      peers: embrPeerIndices.map(i => ((track.loops || [])[i] || {}).id) });
    embrPeerIndices.forEach(idx => {
      const buf = embrLoopBuffers[idx];
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      applyTrackPitchRate(src, ctxStartTime);
      const g = ctx.createGain();
      g.gain.setValueAtTime(idx === embrActiveLoopIdx ? 1 : 0, ctxStartTime);
      const loopDef = (track.loops || [])[idx];
      const fxChain = buildTargetFxChain('loop:' + idx, loopDef && loopDef.fx, src, ctxStartTime);
      if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
      g.connect(trackMasterGain);
      // Même raisonnement que scheduleGeneration() (moteur quantifié) : cette génération rejoue une fois
      // sans boucle, son onended est donc un point de nettoyage fiable pour le bitcrusher.
      if (fxChainHasLeakyNode(fxChain)) {
        src.onended = () => { disconnectLeakyFxNodes(fxChain); };
      }
      journalVoice(src, g, fxChain);
      src.start(ctxStartTime, bufferOffset);
      embrActiveGenSources.push({ src, gain: g, loopIdx: idx, ctxStartTime });
    });
    // Purge des générations trop anciennes pour ne plus jamais sonner (même logique de nettoyage que
    // scheduledGens du moteur quantifié) — évite une croissance illimitée du tableau sur une lecture longue.
    const cutoff = ctx.currentTime - Math.max(embrCycleLengthSec() / trackPitchRatio, 4) * 2;
    if (embrActiveGenSources.length > 40) embrActiveGenSources = embrActiveGenSources.filter(g => g.ctxStartTime >= cutoff);
  }
  function embrSchedulerTick() {
    const lookahead = 1.0;
    while (embrNextStartCtxTime < ctx.currentTime + lookahead) {
      embrClockAtGeneration(embrNextStartCtxTime);
      scheduleEmbrGeneration(embrNextStartCtxTime, false); // jamais "Départ" ici, uniquement au tout premier lancement (playEmbrVertical)
      embrNextStartCtxTime += embrCycleLengthSec() / trackPitchRatio;
    }
  }
  // Recalcule en direct le gain de toutes les sources "paires" actuellement audibles ou en train de finir
  // (queue) — sans ça, un clic ne prendrait effet qu'à la prochaine génération programmée. Reprend
  // exactement le principe de refreshVoiceGains() ci-dessus, avec une seule "voix" active à la fois
  // plutôt que la logique solo/muet à plusieurs voix simultanées.
  // targetIdx : boucle qui doit monter à 1 (-1 si aucune, cas du détour où plus aucune voix paire n'est
  // active). Bascule toujours IMMÉDIATE (29/08) : une éventuelle transition est gérée en amont par
  // l'appelant (performEmbrSwitch), qui attend sa fin avant d'appeler cette fonction -- jamais de délai
  // géré ICI. Un délai géré à ce niveau avait été tenté (24/08→29/08) mais se heurtait au planificateur
  // périodique de générations (scheduleEmbrGeneration), qui ignore tout délai en cours et réinitialise le
  // gain de la cible dès le cycle suivant -- source de silences et de boucles superposées (bug signalé par
  // Jules-Antoine). Voir le commentaire d'en-tête de performEmbrSwitch pour le mécanisme retenu à la place.
  function refreshEmbrGains(targetIdx) {
    const now = ctx.currentTime;
    const activeLoopDef = (track.loops || [])[targetIdx];
    const fadeSec = embrCutFadeSec(activeLoopDef);
    embrMark('embr_gains', { loopId: activeLoopDef ? activeLoopDef.id : null, fadeSec });
    embrActiveGenSources.forEach(({ gain, loopIdx }) => {
      if (!gain) return;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      if (loopIdx === targetIdx) {
        if (fadeSec <= 0) gain.gain.setValueAtTime(1, now); // "hard" : coupure nette, aucune rampe
        else gain.gain.linearRampToValueAtTime(1, now + fadeSec);
      } else {
        if (fadeSec <= 0) gain.gain.setValueAtTime(0, now);
        else gain.gain.linearRampToValueAtTime(0, now + fadeSec);
      }
    });
  }
  // Fondu de sortie IMMÉDIAT d'une boucle "paire" quittée, déclenché dès qu'une transition démarre plutôt
  // que d'attendre la fin de celle-ci (05/09, retour direct : "la boucle continue de jouer pendant la
  // transition, je ne veux plus ça"). Avant ce correctif, la boucle quittée restait à plein volume pendant
  // toute la durée de la transition -- gain remis à 0 seulement par refreshEmbrGains() une fois la
  // transition terminée (voir performEmbrSwitch) -- d'où un mélange boucle+transition entendu par
  // Jules-Antoine. Même principe que performSeqBranchCut() côté séquentiel (le bloc quitté y est fondu
  // tout de suite, la transition suivant en bloc distinct) : ici la boucle ducke sur son propre
  // cutStyle/customCutFadeSec (embrCutFadeSec, "fondu de sortie propre à CETTE boucle", même repli que
  // fadeOutCurrentDetour) pendant que le fichier de transition joue seul par-dessus. Ne touche que la
  // source `sourceIdx` -- les autres boucles paires sont déjà à gain 0, refreshEmbrGains() s'occupera de
  // faire monter la cible une fois la transition terminée.
  function duckEmbrSourceLoop(sourceIdx, sourceLoopDef) {
    if (sourceIdx < 0) return; // aucune boucle paire active à ce moment (détour en cours, déjà géré par fadeOutCurrentDetour())
    const now = ctx.currentTime;
    const fadeSec = embrCutFadeSec(sourceLoopDef);
    embrMark('embr_duck', { loopId: sourceLoopDef ? sourceLoopDef.id : null, fadeSec });
    embrActiveGenSources.forEach(({ gain, loopIdx }) => {
      if (!gain || loopIdx !== sourceIdx) return;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      if (fadeSec <= 0) gain.gain.setValueAtTime(0, now);
      else gain.gain.linearRampToValueAtTime(0, now + fadeSec);
    });
  }
  // Reprise après mise en veille (29/08, bug signalé par Jules-Antoine : changer d'onglet relançait le
  // morceau depuis la référence). Contrairement au séquentiel/vertical-random, l'embranchement-vertical
  // n'a pas de notion de "position dans le temps" à laquelle chercher (plusieurs boucles phase-verrouillées
  // tournent en parallèle indéfiniment, pas une seule chronologie linéaire) -- on ne cherche donc pas à
  // retrouver la phase exacte d'avant la mise en veille (potentiellement longue, aucun repère fiable), mais
  // à relancer proprement une nouvelle horloge de phase à partir de maintenant, EN PRÉSERVANT la boucle qui
  // était effectivement active plutôt que de repartir de la référence comme le ferait playEmbrVertical().
  // Cas d'un détour en cours au moment de la mise en veille (embrActiveLoopIdx déjà à -1 à cet instant,
  // pas de boucle "paire" à préserver) : repli sur la référence -- un détour est un aparté ponctuel, pas la
  // boucle de fond que l'auditeur associe au morceau, le perdre au retour d'un onglet resté longtemps en
  // arrière-plan est un compromis acceptable plutôt que de tenter de reconstituer sa position exacte.
  function resumeEmbrVerticalAfterBackground() {
    const preservedIdx = embrActiveLoopIdx >= 0 ? embrActiveLoopIdx : embrReferenceIdx;
    stopEmbrVertical();
    embrActiveLoopIdx = preservedIdx;
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    embrClockReset(now, 0);
    scheduleEmbrGeneration(now, true); // fixe déjà le bon gain (1) sur preservedIdx via embrActiveLoopIdx ci-dessus
    embrNextStartCtxTime = now + embrCycleLengthSec() / trackPitchRatio;
    embrSchedulerTimer = setInterval(embrSchedulerTick, 200);
    updateEmbrButtonsUI();
    applyEmbrWaveAnimation();
  }
  // Seek (25/09, demande directe : "on ne peut pas cliquer dans la barre de lecture pour faire avancer la
  // tête de lecture") : `fraction` = position dans le cycle Entrée->Sortie, la même échelle que le
  // remplissage animé des lignes riches. Toutes les boucles paires restant verrouillées en phase, on les
  // relance TOUTES au même point -- la boucle audible reste la même, seule la position change. Contrairement
  // à resumeEmbrVerticalAfterBackground(), on ne passe pas par stopEmbrVertical() : un minuteur de retour
  // auto en cours doit survivre au seek (même raisonnement que seekSequential()). L'horloge de phase est
  // recalée pour que la quantification des bascules suivantes (embrQuantizeDelaySec) reste juste.
  function seekEmbrVertical(fraction) {
    const timing = embrLoopTiming();
    const cycle = timing.cycleLength;
    if (!(cycle > 0) || embrActiveLoopIdx < 0) return;
    const posSec = Math.max(0, Math.min(1, fraction)) * cycle;
    if (embrSchedulerTimer) { clearInterval(embrSchedulerTimer); embrSchedulerTimer = null; }
    // Repère de capture : seules les générations des boucles jumelles s'arrêtent (transition ou détour éventuels continuent).
    captureMark('voices_stop', { trackId: track.id, scope: 'embr_gens' });
    embrActiveGenSources.forEach(({ src }) => { try { src.stop(); } catch (e) {} });
    embrActiveGenSources = [];
    // Un seek pendant le segment Départ->Entrée du premier lancement saute directement dans le cycle :
    // le verrouillage des boutons propre à ce segment n'a plus lieu d'être.
    if (embrIntroLockTimeout) {
      clearTimeout(embrIntroLockTimeout); embrIntroLockTimeout = null;
      embrLoopBtns.forEach(btn => { btn.disabled = false; });
    }
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    embrClockReset(now, posSec);
    scheduleEmbrGeneration(now, false, timing.loopInSec + posSec);
    embrNextStartCtxTime = now + (cycle - posSec) / trackPitchRatio;
    embrSchedulerTimer = setInterval(embrSchedulerTick, 200);
    applyEmbrWaveAnimation(posSec);
  }
  function playEmbrVertical() {
    stopEmbrVertical();
    embrActiveLoopIdx = embrReferenceIdx;
    applyFxActions(((track.loops || [])[embrReferenceIdx] || {}).fxActions); // état de départ = celui de la boucle de référence
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    embrClockReset(now, 0); // point zéro de l'horloge de phase, utilisée par embrQuantizeDelaySec()
    scheduleEmbrGeneration(now, true); // seul appel avec isFirst=true -- démarre à "Départ", pas "Entrée"
    embrNextStartCtxTime = now + embrCycleLengthSec() / trackPitchRatio;
    embrSchedulerTimer = setInterval(embrSchedulerTick, 200);
    updateEmbrButtonsUI();
    applyEmbrWaveAnimation();
    // Verrouillage des boutons pendant le segment Départ→Entrée (29/08, retour visuel) : ce segment ne
    // joue qu'une seule fois au tout premier lancement (voir embrLoopTiming()) et n'a pas de verrouillage
    // de phase établi avec les boucles paires avant d'avoir atteint "Entrée" -- une bascule pendant cette
    // fenêtre serait prématurée. Sans réglage de Départ/Entrée sur la référence, les deux valent 0 et ce
    // verrouillage dure 0s (comportement d'origine inchangé).
    const timing = embrLoopTiming();
    const introSec = timing.loopInSec - timing.startSec;
    if (introSec > 0) {
      embrLoopBtns.forEach(btn => { btn.disabled = true; });
      embrIntroLockTimeout = setTimeout(() => {
        embrIntroLockTimeout = null;
        embrLoopBtns.forEach(btn => { btn.disabled = false; });
      }, introSec * 1000 / trackPitchRatio);
    }
  }
  function stopEmbrVertical() {
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
    if (embrSchedulerTimer) { clearInterval(embrSchedulerTimer); embrSchedulerTimer = null; }
    if (embrDetourTimeout) { clearTimeout(embrDetourTimeout); embrDetourTimeout = null; }
    if (embrAutoReturnTimeout) { clearTimeout(embrAutoReturnTimeout); embrAutoReturnTimeout = null; }
    if (embrPendingSwitchTimeout) { clearTimeout(embrPendingSwitchTimeout); embrPendingSwitchTimeout = null; }
    if (embrPendingTransitionSwitchTimeout) { clearTimeout(embrPendingTransitionSwitchTimeout); embrPendingTransitionSwitchTimeout = null; }
    if (embrIntroLockTimeout) { clearTimeout(embrIntroLockTimeout); embrIntroLockTimeout = null; }
    removeEmbrEndLoopButton();
    removeEmbrDetourWaveRow();
    removeEmbrTransitionOverlay();
    // Le détour d'une boucle courte (voir selectEmbrLoop) n'est jamais poussé dans embrActiveGenSources —
    // ce n'est pas une génération "paire" en arrière-plan, juste une lecture ponctuelle — donc sans cet
    // arrêt explicite, elle continuerait de jouer jusqu'à sa fin naturelle après un Stop (bug trouvé et
    // corrigé le 31/07, voir CHANGELOG).
    if (embrDetourSource) { try { embrDetourSource.src.stop(); } catch (e) {} embrDetourSource = null; }
    if (embrDetourBtn) { embrDetourBtn.disabled = false; embrDetourBtn = null; }
    embrActiveGenSources.forEach(({ src }) => { try { src.stop(); } catch (e) {} });
    embrActiveGenSources = [];
    // Transitions encore audibles (24/08, bug trouvé à la relecture) -- même raisonnement que le détour
    // ci-dessus : sans cet arrêt explicite, une transition en cours continuerait de sonner après Stop.
    // Itère sur une COPIE (slice()) plutôt que le tableau live : src.stop() peut déclencher onended, qui
    // mute embrActiveTransitionSources pendant l'itération -- sans cette copie, un forEach sur le tableau
    // live sauterait l'élément suivant après chaque suppression en cours de boucle (bug détecté par le
    // test avant même d'atteindre un vrai navigateur, où onended est généralement asynchrone -- mais
    // s'appuyer sur cette hypothèse de timing pour la justesse du code serait fragile).
    embrActiveTransitionSources.slice().forEach(src => { try { src.stop(); } catch (e) {} });
    embrActiveTransitionSources = [];
    embrActiveLoopIdx = -1;
    embrLoopBtns.forEach(btn => { btn.disabled = false; });
    updateEmbrButtonsUI();
    pauseEmbrWaveAnimation();
  }
  // Interrompt en douceur (fondu de EMBR_CROSSFADE_SEC) un détour en cours, sans décider de ce qui doit
  // devenir actif ensuite — à la charge de l'appelant. Réutilisée à la fois pour le retour naturel à la
  // référence (durée nominale écoulée) et pour une interruption volontaire (le visiteur fait un nouveau
  // choix avant la fin du détour précédent) : sans ça, l'ancien détour restait orphelin — jamais coupé,
  // son bouton jamais réactivé (bug trouvé le 31/07, voir CHANGELOG).
  function fadeOutCurrentDetour() {
    if (embrDetourTimeout) { clearTimeout(embrDetourTimeout); embrDetourTimeout = null; }
    removeEmbrEndLoopButton();
    removeEmbrDetourWaveRow();
    if (!embrDetourSource) return;
    const t2 = ctx.currentTime;
    const dg = embrDetourSource.gain;
    // Fondu de sortie propre à CETTE boucle détour (24/08) -- même réglage cutStyle/customCutFadeSec que
    // celui utilisé pour son fondu d'entrée, retrouvé via le bouton désactivé pendant qu'elle joue.
    const leavingIdx = embrDetourBtn ? parseInt(embrDetourBtn.dataset.loopIdx, 10) : -1;
    const leavingLoopDef = leavingIdx >= 0 ? (track.loops || [])[leavingIdx] : null;
    const fadeSec = embrCutFadeSec(leavingLoopDef);
    embrMark('embr_detour_out', { loopId: leavingLoopDef ? leavingLoopDef.id : null, fadeSec });
    dg.gain.cancelScheduledValues(t2);
    dg.gain.setValueAtTime(dg.gain.value, t2);
    if (fadeSec <= 0) dg.gain.setValueAtTime(0, t2);
    else dg.gain.linearRampToValueAtTime(0, t2 + fadeSec);
    embrDetourSource = null;
    if (embrDetourBtn) { embrDetourBtn.disabled = false; embrDetourBtn = null; }
  }
  // Durée en secondes d'un minuteur de retour auto (boucle paire), quelle que soit son unité de réglage
  // (temps/mesures/secondes) -- même conversion bpm/beatsPerBar que le reste du moteur quantifié.
  function embrDurationToSeconds(value, unit) { return embrDurationToSec(track, value, unit); }
  // Délai (en secondes) avant qu'une bascule demandée ne s'exécute réellement, selon le réglage de
  // quantification de la boucle CIBLE (24/08) -- calculé par rapport à la phase de la référence, seule
  // horloge qui tourne en continu en arrière-plan (y compris pour déclencher un détour, qui n'a pas
  // encore de cycle propre avant de démarrer). 'immediate' (ou absent) -> 0, aucune attente.
  function embrQuantizeDelaySec(quantize) {
    // Temps RÉEL : le cycle et le temps musical sont en temps nominal du fichier (pitch "vitesse", 23/09) ; la conversion
    // se fait à la vitesse AUDIBLE maintenant (celle de la génération en cours), pas à celle qui vient d'être demandée.
    const now = ctx.currentTime;
    return embrQuantizeDelayAt(track, quantize, embrNominalAt(now)) / embrClockSegAt(now).ratio;
  }
  // Affiche/retire le bouton "Mettre fin à la boucle" inséré dynamiquement à la suite des boutons de
  // boucle habituels, uniquement pendant qu'un détour en mode "en boucle jusqu'à un bouton" est actif
  // (24/08). Un clic dessus redemande la boucle de référence -- en repassant par selectEmbrLoop(), donc en
  // respectant lui aussi le timing de bascule quantifié réglé sur la boucle de référence.
  function removeEmbrEndLoopButton() {
    if (embrEndLoopBtnEl) { embrEndLoopBtnEl.remove(); embrEndLoopBtnEl = null; }
  }
  function showEmbrEndLoopButton(loopDef) {
    removeEmbrEndLoopButton();
    const picker = wrapper.querySelector('[data-role="embrLoopPicker"]');
    if (!picker) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'embr-loop-btn embr-end-loop-btn';
    btn.textContent = (loopDef.endLoopButtonLabel && loopDef.endLoopButtonLabel.trim()) || t('embrEndLoopDefaultLabel');
    btn.addEventListener('click', () => { selectEmbrLoop(embrReferenceIdx); });
    picker.appendChild(btn);
    embrEndLoopBtnEl = btn;
  }
  // Exécute réellement la bascule vers `idx` -- toute la logique qui existait auparavant directement dans
  // selectEmbrLoop(), désormais appelée soit tout de suite (quantification "immédiat"), soit après le
  // délai calculé par embrQuantizeDelaySec() pour "prochain temps"/"prochaine mesure" (24/08).
  // Repères de capture de l'embranchement-vertical (25/09) : chaque commande de volume réellement donnée par le moteur
  // (bascule entre boucles jumelles, baisse de la boucle quittée pendant une transition, entrée/sortie d'un détour,
  // départ d'une transition) est annoncée à l'outil vidéo au moment où elle a lieu, avec la clé de la bascule qui l'a
  // provoquée (k) et celle de sa bascule « parente » (pk : un retour automatique suit la bascule qui l'a armé). Déplacer
  // une bascule sur la frise déplace ainsi tout ce qu'elle a déclenché, et rien d'autre.
  let embrSwitchSeq = 0, embrMarkKey = null, embrMarkParentKey = null, embrPendingParentKey = null;
  function embrMark(name, detail) {
    // rate : vitesse des sources créées à ce moment (détour, transition) -- reprise telle quelle par l'export (27/09).
    captureMark(name, Object.assign({ trackId: track.id, rate: trackPitchRatio }, embrMarkKey ? { k: embrMarkKey } : {}, embrMarkParentKey ? { pk: embrMarkParentKey } : {}, detail));
  }
  function withEmbrKey(k, pk, fn) {
    const k0 = embrMarkKey, pk0 = embrMarkParentKey;
    embrMarkKey = k; embrMarkParentKey = pk;
    try { return fn(); } finally { embrMarkKey = k0; embrMarkParentKey = pk0; }
  }
  function performEmbrSwitch(idx) {
    const swKey = 'sw' + (++embrSwitchSeq), swParent = embrPendingParentKey;
    embrPendingParentKey = null;
    return withEmbrKey(swKey, swParent, () => performEmbrSwitchInner(idx, swKey, swParent));
  }
  function performEmbrSwitchInner(idx, swKey, swParent) {
    const buf = embrLoopBuffers[idx];
    if (!buf) return;
    const loopDef = (track.loops || [])[idx];
    // Une bascule "transition en attente" précédente n'a plus lieu d'être si un nouveau choix arrive avant
    // qu'elle ne s'exécute (29/08, corrige un bug réel : le planificateur périodique de générations ignore
    // totalement une bascule en attente et réinitialise le gain de la cible à 1 dès le cycle suivant, quel
    // que soit le délai en cours -- laissé tel quel, ça produisait un silence pendant la transition ET des
    // boucles superposées selon le moment du clic par rapport aux cycles. Correctif : la bascule RÉELLE
    // (embrActiveLoopIdx, gains, UI) n'a plus lieu tant que la transition ne s'est pas terminée -- jusque
    // là, embrActiveLoopIdx reste sur l'ancienne boucle, donc le planificateur continue de la régénérer
    // normalement, sans connaître ni se soucier de la bascule en attente).
    if (embrPendingTransitionSwitchTimeout) { clearTimeout(embrPendingTransitionSwitchTimeout); embrPendingTransitionSwitchTimeout = null; }
    // Une transition affichée pour cette bascule annulée n'a plus lieu d'être -- sans ce retrait
    // inconditionnel, un nouveau choix SANS transition propre laisserait l'ancienne ligne affichée
    // indéfiniment (showEmbrTransitionOverlay() ne serait alors jamais rappelée pour la nettoyer).
    removeEmbrTransitionOverlay();
    if (embrPeerIndices.includes(idx)) {
      if (idx === embrActiveLoopIdx && !embrDetourSource) return; // déjà la voix active, rien à faire --
      // AVANT le nettoyage du minuteur ci-dessous (bug corrigé le 24/08 : un reclic accidentel sur le
      // bouton déjà actif annulait silencieusement son propre minuteur de retour sans jamais le
      // reprogrammer, laissant la boucle active indéfiniment au lieu de revenir comme prévu).
      if (embrAutoReturnTimeout) { clearTimeout(embrAutoReturnTimeout); embrAutoReturnTimeout = null; }
      fadeOutCurrentDetour(); // sans effet si aucun détour n'était en cours
      const sourceLoopDef = (track.loops || [])[embrActiveLoopIdx]; // boucle quittée -- repli de tempo pour la transition
      // Transition (29/08, ducking ajouté le 05/09) : jouée tout de suite. La boucle quittée ducke
      // immédiatement sur son propre fondu de sortie (duckEmbrSourceLoop) plutôt que de continuer à plein
      // volume pendant toute la transition -- seul le fichier de transition doit s'entendre entre les deux
      // boucles. La bascule réelle (embrActiveLoopIdx + gains + UI) n'intervient elle qu'une fois la
      // transition terminée, exactement comme une coupure immédiate ordinaire à cet instant-là -- jamais de
      // gain différé en parallèle du planificateur périodique.
      const transBuf = embrTransitionBuffers[idx];
      const transDelay = transBuf ? embrTransitionDurationSecFor(loopDef, sourceLoopDef, transBuf) / trackPitchRatio : 0; // temps réel (la transition joue aussi à trackPitchRatio)
      if (transBuf) { playEmbrTransitionIfAny(idx, ctx.currentTime); duckEmbrSourceLoop(embrActiveLoopIdx, sourceLoopDef); }
      if (transBuf) showEmbrTransitionOverlay(embrActiveLoopIdx, idx, transBuf, transDelay);
      const doSwitch = () => withEmbrKey(swKey, swParent, () => {
        removeEmbrTransitionOverlay();
        applyFxActions(loopDef && loopDef.fxActions); // triggers d'effets liés à cette boucle (23/09)
        embrActiveLoopIdx = idx;
        refreshEmbrGains(idx);
        updateEmbrButtonsUI();
        // Minuteur de retour auto (24/08) -- seulement si réglé sur cette boucle, jamais sur la référence
        // elle-même (revenir "vers" la référence n'aurait pas de sens).
        if (loopDef && !loopDef.isInitial && loopDef.autoReturnEnabled) {
          const sec = embrDurationToSeconds(loopDef.autoReturnValue, loopDef.autoReturnUnit);
          if (sec > 0) {
            embrAutoReturnTimeout = setTimeout(() => {
              embrAutoReturnTimeout = null;
              embrPendingParentKey = swKey; // le retour suit la bascule qui l'a armé (voir embrMark)
              performEmbrSwitch(embrReferenceIdx); // retour direct, sans quantification supplémentaire -- le délai est déjà exprimé en unités musicales
            }, sec * 1000 / trackPitchRatio);
          }
        }
      });
      if (transDelay > 0) embrPendingTransitionSwitchTimeout = setTimeout(() => { embrPendingTransitionSwitchTimeout = null; doSwitch(); }, transDelay * 1000);
      else doSwitch();
    } else {
      // Ce détour précis est déjà celui en cours (son bouton est de toute façon désactivé pendant qu'il
      // joue -- double sécurité si l'appel venait d'ailleurs qu'un clic utilisateur).
      if (embrDetourBtn && parseInt(embrDetourBtn.dataset.loopIdx, 10) === idx) return;
      if (embrAutoReturnTimeout) { clearTimeout(embrAutoReturnTimeout); embrAutoReturnTimeout = null; } // on quitte le groupe des boucles paires -- son minuteur n'a plus lieu d'être
      fadeOutCurrentDetour(); // coupe en douceur un éventuel détour précédent avant d'en démarrer un nouveau
      const btn = embrLoopBtns.find(b => parseInt(b.dataset.loopIdx, 10) === idx);
      if (btn) btn.disabled = true; // pas de retrigger possible tant que le détour joue (validé le 31/07)
      const sourceLoopDef = (track.loops || [])[embrActiveLoopIdx]; // boucle quittée -- repli de tempo pour la transition
      // Transition (29/08, ducking ajouté le 05/09) : même principe que la branche "paire" ci-dessus --
      // jouée tout de suite, la voix paire encore active (si elle existe -- fadeOutCurrentDetour() a déjà
      // géré le cas d'un détour précédent juste au-dessus) ducke immédiatement sur son propre fondu de
      // sortie plutôt que de continuer à plein volume jusqu'au démarrage réel du détour.
      const transBuf = embrTransitionBuffers[idx];
      const transDelay = transBuf ? embrTransitionDurationSecFor(loopDef, sourceLoopDef, transBuf) / trackPitchRatio : 0; // temps réel (la transition joue aussi à trackPitchRatio)
      if (transBuf) { playEmbrTransitionIfAny(idx, ctx.currentTime); duckEmbrSourceLoop(embrActiveLoopIdx, sourceLoopDef); }
      if (transBuf) showEmbrTransitionOverlay(embrActiveLoopIdx, idx, transBuf, transDelay);
      const startDetour = () => withEmbrKey(swKey, swParent, () => {
        removeEmbrTransitionOverlay();
        applyFxActions(loopDef && loopDef.fxActions); // triggers d'effets liés à ce détour (23/09)
        embrActiveLoopIdx = -1; // plus aucune voix "paire" n'est active pendant le détour
        refreshEmbrGains(-1);
        const now = ctx.currentTime;
        const fadeSec = embrCutFadeSec(loopDef);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, now);
        if (fadeSec <= 0) g.gain.setValueAtTime(1, now); // "hard" : coupure nette, pas de fondu d'entrée
        else g.gain.linearRampToValueAtTime(1, now + fadeSec);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const loopsUntilButton = loopDef && loopDef.detourMode === 'loop';
        if (loopsUntilButton) { src.loop = true; src.loopStart = 0; src.loopEnd = buf.duration; }
        applyTrackPitchRate(src, now);
        const fxChain = buildTargetFxChain('loop:' + idx, loopDef && loopDef.fx, src, now);
        if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
        g.connect(trackMasterGain);
        // onended se déclenche aussi bien à la fin naturelle (détour non bouclé) qu'à l'arrêt manuel
        // (stopEmbrVertical()/fadeOutCurrentDetour() appellent .stop(), qui déclenche onended) -- un seul
        // point de nettoyage couvre les deux cas.
        if (fxChainHasLeakyNode(fxChain)) {
          src.onended = () => { disconnectLeakyFxNodes(fxChain); };
        }
        journalVoice(src, g, fxChain);
        src.start(now, 0);
        embrMark('embr_detour_in', { loopId: loopDef && loopDef.id, fadeSec, loop: !!loopsUntilButton });
        embrDetourSource = { src, gain: g };
        embrDetourBtn = btn;
        if (loopsUntilButton) {
          // Pas de minuterie de retour ici : ça tourne jusqu'à ce qu'on clique sur "Mettre fin à la boucle"
          // (ou sur le bouton d'une autre boucle, qui interrompt aussi ce détour via fadeOutCurrentDetour()).
          showEmbrEndLoopButton(loopDef);
          showEmbrDetourWaveRow(buf, buf.duration / trackPitchRatio, true);
        } else {
          // Durée propre à CETTE boucle détour si elle a son propre tempo (bpm/beatsPerBar, 24/08) --
          // blockSeconds() accepte déjà un `slot` optionnel avec repli sur le tempo du morceau, exactement
          // le même mécanisme que slotTiming()/sectionTiming() ailleurs dans ce fichier, réutilisé tel quel.
          const durationSec = blockSeconds(loopDef && loopDef.bars, loopDef) / trackPitchRatio; // temps réel
          showEmbrDetourWaveRow(buf, durationSec, false);
          embrDetourTimeout = setTimeout(() => withEmbrKey(swKey + ':ret', swKey, () => { // fin du détour : suit son départ
            fadeOutCurrentDetour();
            embrActiveLoopIdx = embrReferenceIdx;
            refreshEmbrGains(embrReferenceIdx);
            updateEmbrButtonsUI();
          }), durationSec * 1000);
        }
        updateEmbrButtonsUI();
      });
      if (transDelay > 0) embrPendingTransitionSwitchTimeout = setTimeout(() => { embrPendingTransitionSwitchTimeout = null; startDetour(); }, transDelay * 1000);
      else startDetour();
    }
    trackPublicEvent('embr_loop_select', { trackId: track.id, loopId: loopDef && loopDef.id });
  }
  // Clic sur un bouton nommé : bascule pure (rampe de gain) si la boucle ciblée est "paire" avec la
  // référence (elle tourne déjà en silence en arrière-plan, verrouillée en phase) ; détour ponctuel en
  // aller-retour si elle est plus courte (pas de verrouillage de phase possible, donc pas de lecture en
  // arrière-plan avant sélection — voir commentaire d'en-tête du moteur). Depuis le 24/08, la bascule
  // réelle (performEmbrSwitch) peut être différée selon le réglage de quantification de la boucle CIBLE --
  // un nouveau clic avant l'exécution d'une bascule en attente l'annule et la remplace, plutôt que
  // d'empiler les bascules.
  function selectEmbrLoop(idx) {
    if (!playing) return;
    if (!embrLoopBuffers[idx]) return;
    if (embrPendingSwitchTimeout) { clearTimeout(embrPendingSwitchTimeout); embrPendingSwitchTimeout = null; }
    const loopDef = (track.loops || [])[idx];
    const delaySec = embrQuantizeDelaySec(loopDef && loopDef.switchQuantize);
    if (delaySec <= 0.001) {
      performEmbrSwitch(idx);
    } else {
      embrPendingSwitchTimeout = setTimeout(() => { embrPendingSwitchTimeout = null; performEmbrSwitch(idx); }, delaySec * 1000);
    }
  }
  embrLoopBtns.forEach(btn => {
    btn.addEventListener('click', () => selectEmbrLoop(parseInt(btn.dataset.loopIdx, 10)));
  });
  // Cliquer/glisser sur la forme d'onde de la boucle EN COURS (gabarit riche uniquement) déplace la tête
  // de lecture -- même principe que les blocs séquentiels : position affichée en direct pendant le
  // glisser, seek audio réel seulement au relâchement. Un clic sur une AUTRE ligne reste une bascule de
  // boucle (inchangé). Pas de seek pendant un détour, une transition ou une bascule quantifiée en attente :
  // l'horloge de phase y est déjà engagée vers autre chose.
  embrLoopBtns.forEach(btn => {
    if (!btn.classList.contains('embr-wave-btn')) return;
    const idx = parseInt(btn.dataset.loopIdx, 10);
    let dragging = false;
    function fractionFromEvent(e) {
      const rect = btn.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    function showFraction(frac) {
      embrLoopBtns.forEach(b => {
        const fg = b.querySelector('.embr-wave-fg');
        if (!fg) return;
        fg.style.animation = 'none';
        fg.style.clipPath = `inset(0 ${(1 - frac) * 100}% 0 0)`;
      });
    }
    function isSeekable() {
      return playing && idx === embrActiveLoopIdx && !embrDetourSource
        && !embrPendingSwitchTimeout && !embrPendingTransitionSwitchTimeout;
    }
    btn.addEventListener('pointerdown', (e) => {
      if (!isSeekable()) return;
      dragging = true;
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      showFraction(fractionFromEvent(e));
    });
    btn.addEventListener('pointermove', (e) => {
      if (dragging) showFraction(fractionFromEvent(e));
    });
    btn.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      if (!isSeekable()) { applyEmbrWaveAnimation(embrCurrentCyclePosSec()); return; }
      trackPublicEvent('embr_seek', { trackId: track.id });
      seekEmbrVertical(fractionFromEvent(e));
    });
    btn.addEventListener('pointercancel', () => {
      if (!dragging) return;
      dragging = false;
      applyEmbrWaveAnimation(embrCurrentCyclePosSec());
    });
  });
  // Position actuelle dans le cycle (temps nominal du fichier) -- sert à remettre l'animation en place
  // quand un glisser est annulé sans seek.
  function embrCurrentCyclePosSec() {
    const cycle = embrCycleLengthSec();
    if (!(cycle > 0)) return 0;
    const elapsed = embrNominalAt(ctx.currentTime);
    return ((elapsed % cycle) + cycle) % cycle;
  }

