  async function loadArrayBuffer(item) {
    if (item.localFile) {
      // Fichier choisi dans le Backstage mais pas encore publié : le navigateur ne garde qu'un lien vers le fichier
      // sur le disque. Modifié/réexporté/déplacé depuis sa sélection, il devient illisible (vécu le 25/09 sous
      // Firefox : "Erreur de chargement (aucune section)" alors que la section avait bien un fichier). Nom retenu
      // pour que le message d'erreur dise lequel choisir à nouveau, au lieu d'un "aucune section" trompeur.
      let ab;
      try { ab = await item.localFile.arrayBuffer(); }
      catch (e) { unreadableLocalFiles.add(item.localFile.name); throw e; }
      _localFileNames.set(ab, item.localFile.name);
      return ab;
    }
    // localUrl (18/09) : variante de localFile pour l'Aperçu public (?preview=1, nouvel onglet) -- un
    // fichier pas encore publié y arrive en URL locale temporaire (blob:, voir pendingPreviewUrl() côté
    // backstage) plutôt qu'en objet File directement utilisable, un objet File ne survivant pas au
    // passage par localStorage (JSON) entre le backstage et cet onglet. fetch() sait lire une URL blob:
    // aussi bien qu'une URL distante, d'où ce simple embranchement plutôt qu'un chemin de code séparé.
    if (item.localUrl) return await (await fetch(item.localUrl)).arrayBuffer();
    remoteFetchAttempts++;
    const v = track.publishedAt ? ('?v=' + encodeURIComponent(track.publishedAt)) : '';
    const url = track.base + encodeURIComponent(item.file) + v;
    const res = await fetchAudio(url, track.protected);
    if (!res.ok) remoteFetchNotFound++;
    const ab = await res.arrayBuffer();
    _arrayBufferUrls.set(ab, url); // journal de prise : le rendu hors-ligne retéléchargera ce fichier
    return ab;
  }
  // Vrai uniquement si CHAQUE requête réseau tentée a échoué — un seul fichier chargé avec succès suffit à
  // écarter l'hypothèse "propagation encore en cours" (ce serait alors un vrai fichier manquant/corrompu).
  function looksLikePropagationDelay() {
    return remoteFetchAttempts > 0 && remoteFetchNotFound === remoteFetchAttempts;
  }
  function loadErrorMessageFor(fallbackKey) {
    if (unreadableLocalFiles.size) return t('loadErrorLocalFileUnreadable', { files: [...unreadableLocalFiles].map(n => '« ' + n + ' »').join(', ') });
    return t(looksLikePropagationDelay() ? 'loadErrorPropagating' : fallbackKey);
  }
  // Relais de décodage : Safari (Mac et iOS, donc tout navigateur sur iPhone/iPad puisqu'Apple impose
  // WebKit) ne sait pas décoder l'Ogg Vorbis nativement via decodeAudioData — échec silencieux, capté
  // plus bas par le try/catch ("Erreur de chargement"). On tente d'abord le décodage natif (rapide, ne
  // change rien pour les navigateurs qui le supportent déjà), et seulement s'il échoue, on bascule sur
  // un décodeur Ogg Vorbis en JavaScript/WebAssembly, indépendant du support natif.
  // Volontairement une instance PAR PISTE (pas partagée au niveau du module) : plusieurs pistes chargent
  // leurs fichiers en parallèle au chargement de la page, et un décodeur partagé verrait ses appels
  // .reset()/.decode() de pistes différentes s'entremêler — corruption silencieuse plutôt qu'erreur.
  let vorbisDecoderPromise = null;
  function getVorbisDecoder() {
    if (!vorbisDecoderPromise) {
      vorbisDecoderPromise = (async () => {
        if (!window['ogg-vorbis-decoder']) throw new Error('Décodeur Ogg Vorbis de secours introuvable (bibliothèque non chargée)');
        const decoder = new window['ogg-vorbis-decoder'].OggVorbisDecoder();
        await decoder.ready;
        return decoder;
      })();
    }
    return vorbisDecoderPromise;
  }
  async function decodeAudioDataCompat(arrayBuffer) {
    let buf;
    try { buf = await decodeAudioDataCompatRaw(arrayBuffer); }
    catch (e) { const localName = _localFileNames.get(arrayBuffer); if (localName) unreadableLocalFiles.add(localName); throw e; }
    const url = _arrayBufferUrls.get(arrayBuffer);
    if (url && buf) _bufferUrls.set(buf, url);
    return buf;
  }
  async function decodeAudioDataCompatRaw(arrayBuffer) {
    try {
      return await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch (nativeError) {
      const decoder = await getVorbisDecoder();
      await decoder.reset();
      const { channelData, samplesDecoded, sampleRate } = await decoder.decode(new Uint8Array(arrayBuffer));
      if (!samplesDecoded || !channelData || !channelData.length) throw nativeError;
      const audioBuffer = ctx.createBuffer(channelData.length, samplesDecoded, sampleRate);
      for (let ch = 0; ch < channelData.length; ch++) audioBuffer.copyToChannel(channelData[ch], ch);
      return audioBuffer;
    }
  }

  (async () => {
    let loaded = 0;
    let total;
    if (isVerticalRandom) {
      const rawSections = track.sections || [];
      const hasIntro = layerHasSource(track.intro);
      const hasOutro = layerHasSource(track.outro);
      // Total de fichiers à charger : intro/outro + toutes les alternatives ayant un fichier, dans les
      // sections NON dupliquées (une section qui duplique une autre ne charge rien en propre, voir 2e passe).
      const poolAltsWithSource = rawSections.reduce((sum, sec) => {
        if (sec.referencesSectionId) return sum;
        return sum + (sec.pools || []).reduce((s2, p) => s2 + (p.alternatives || []).filter(layerHasSource).length, 0);
      }, 0);
      total = (hasIntro ? 1 : 0) + (hasOutro ? 1 : 0) + poolAltsWithSource + totalSfxFilesToLoad;
      if (hasIntro) {
        try {
          const ab = await loadArrayBuffer(track.intro);
          introBuffer = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* intro manquante : la lecture démarrera directement sur la première section */ }
      }
      if (hasOutro) {
        try {
          const ab = await loadArrayBuffer(track.outro);
          outroBuffer = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* outro manquante : "Aller vers la fin" laissera simplement filer la section en cours */ }
      }
      // Deux passes, même principe que les groupes/emplacements ailleurs : d'abord les sections avec leur
      // propre contenu, puis celles qui dupliquent (referencesSectionId) pointent vers le MÊME tableau —
      // aucun fichier n'est chargé ni décodé deux fois.
      for (let si = 0; si < rawSections.length; si++) {
        if (rawSections[si].referencesSectionId) continue; // traité en 2e passe
        const pools = rawSections[si].pools || [];
        sectionBuffers[si] = [];
        for (let pi = 0; pi < pools.length; pi++) {
          const alts = pools[pi].alternatives || [];
          // Même longueur que les alternatives déclarées, y compris les slots vides (intentionnels : ils
          // restent un choix possible du tirage, avec pour effet un cycle silencieux pour ce pool).
          sectionBuffers[si][pi] = new Array(alts.length).fill(null);
          lastPickedPoolIndex[canonicalPoolKey(si, pi)] = -1;
          for (let ai = 0; ai < alts.length; ai++) {
            if (!layerHasSource(alts[ai])) continue;
            try {
              const ab = await loadArrayBuffer(alts[ai]);
              sectionBuffers[si][pi][ai] = await decodeAudioDataCompat(ab);
              loaded++;
              if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
            } catch (e) { /* alternative manquante : ce tirage restera silencieux pour ce pool, ne bloque pas le reste */ }
          }
        }
      }
      for (let si = 0; si < rawSections.length; si++) {
        if (!rawSections[si].referencesSectionId) continue;
        const sourceIdx = rawSections.findIndex(s => s.id === rawSections[si].referencesSectionId);
        sectionBuffers[si] = sourceIdx >= 0 ? sectionBuffers[sourceIdx] : [];
      }
      // Sections effectivement jouables : celles qui ont, une fois les duplications résolues, au moins un
      // pool avec au moins un fichier chargé — ordre DÉCLARÉ conservé (même convention que
      // pickNextSegmentSlot pour le séquentiel, qui saute silencieusement les emplacements vides).
      playableSectionOriginalIndex = rawSections.map((s, i) => i).filter(i => (sectionBuffers[i] || []).some(bufs => bufs.some(b => b)));
      if (!playableSectionOriginalIndex.length) { if (statusEl) statusEl.textContent = loadErrorMessageFor('loadErrorNoSections'); setLoadErrorIcon(); return; }
    } else if (isSequential) {
      const hasIntro = layerHasSource(track.intro);
      const hasOutro = layerHasSource(track.outro);
      const rawSlots = track.segmentSlots || [];
      const slotAltsWithSource = rawSlots.reduce((sum, sl) => sum + (sl.alternatives || []).filter(layerHasSource).length, 0);
      const transitionsWithSource = rawSlots.reduce((sum, sl) => sum + (sl.nextOptions || []).filter(opt => layerHasSource(opt.transition)).length, 0);
      total = (hasIntro ? 1 : 0) + (hasOutro ? 1 : 0) + slotAltsWithSource + transitionsWithSource + totalSfxFilesToLoad;
      if (hasIntro) {
        try {
          const ab = await loadArrayBuffer(track.intro);
          introBuffer = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* intro manquante : la lecture démarrera directement sur un emplacement */ }
      }
      if (hasOutro) {
        try {
          const ab = await loadArrayBuffer(track.outro);
          outroBuffer = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* outro manquante : "Aller vers la fin" laissera simplement filer l'emplacement en cours */ }
      }
      for (let si = 0; si < rawSlots.length; si++) {
        if (rawSlots[si].referencesSlotId) continue; // traité en 2e passe
        const alts = rawSlots[si].alternatives || [];
        // Même longueur que les alternatives déclarées, y compris les slots vides (intentionnel, même
        // convention que les groupes du vertical-random) : ça reste un choix possible du tirage, avec pour
        // effet un cycle silencieux pour cet emplacement — pas un fichier à charger.
        slotBuffers[si] = new Array(alts.length).fill(null);
        lastPickedSlotAltIndex[canonicalSlotKey(si)] = -1;
        for (let ai = 0; ai < alts.length; ai++) {
          if (!layerHasSource(alts[ai])) continue;
          try {
            const ab = await loadArrayBuffer(alts[ai]);
            slotBuffers[si][ai] = await decodeAudioDataCompat(ab);
            loaded++;
            if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
          } catch (e) { /* alternative manquante : ce tirage restera silencieux pour cet emplacement, ne bloque pas le reste */ }
        }
      }
      for (let si = 0; si < rawSlots.length; si++) {
        if (!rawSlots[si].referencesSlotId) continue;
        const sourceIdx = rawSlots.findIndex(sl => sl.id === rawSlots[si].referencesSlotId);
        slotBuffers[si] = sourceIdx >= 0 ? slotBuffers[sourceIdx] : [];
      }
      // Fichiers de transition (optionnels, un par embranchement précis — paire source→cible, PAS par
      // emplacement) : même convention d'indexation que slotBuffers, mais un niveau plus loin puisque
      // c'est nextOptions[oi], pas alternatives[ai], qui porte le fichier. transitionBuffers[si][oi] reste
      // null si aucun fichier n'est déclaré pour cet embranchement précis — la bascule sera alors directe
      // (pas de fichier de transition à jouer) plutôt qu'une erreur de chargement.
      for (let si = 0; si < rawSlots.length; si++) {
        const opts = rawSlots[si].nextOptions || [];
        transitionBuffers[si] = new Array(opts.length).fill(null);
        for (let oi = 0; oi < opts.length; oi++) {
          if (!layerHasSource(opts[oi].transition)) continue;
          try {
            const ab = await loadArrayBuffer(opts[oi].transition);
            transitionBuffers[si][oi] = await decodeAudioDataCompat(ab);
            seqTransitionDefByBuffer.set(transitionBuffers[si][oi], opts[oi].transition); // ses effets propres (27/09)
            loaded++;
            if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
          } catch (e) { /* transition manquante : la bascule vers cette cible se fera directement, sans fichier intermédiaire */ }
        }
      }
      if (slotBuffers.every(bufs => bufs.every(b => !b))) { if (statusEl) statusEl.textContent = loadErrorMessageFor('loadErrorNoSegments'); setLoadErrorIcon(); return; }
      // Carte globale (02/09) : côté Backstage (seqMapFullReveal), affichée en entier dès le chargement --
      // outil de vérification de sa propre structure, pas besoin d'attendre une première lecture. Côté
      // public, rien à afficher tant que rien n'a joué (révélation progressive, voir updateSeqMap()).
      if (seqMapFullReveal) updateSeqMap(-1);
    } else if (isEmbrVert) {
      const rawLoops = track.loops || [];
      const loopsWithSource = rawLoops.filter(layerHasSource).length;
      const transitionsWithSource = rawLoops.filter(l => layerHasSource(l && l.transition)).length;
      total = loopsWithSource + transitionsWithSource + totalSfxFilesToLoad;
      embrLoopBuffers = new Array(rawLoops.length).fill(null);
      embrTransitionBuffers = new Array(rawLoops.length).fill(null);
      for (let li = 0; li < rawLoops.length; li++) {
        if (!layerHasSource(rawLoops[li])) continue;
        try {
          const ab = await loadArrayBuffer(rawLoops[li]);
          embrLoopBuffers[li] = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* boucle manquante : ce bouton restera désactivé, ne bloque pas les autres */ }
      }
      // Formes d'onde des boutons de boucle (02/09) : les canvases .embr-wave-bg/.embr-wave-fg existent dans
      // le HTML depuis le premier chantier, mais rien ne les dessinait jamais -- bug confirmé le 05/09 en
      // situation réelle (retour direct : "on devrait voir les deux formes d'ondes des deux boucles paires
      // ici"), chaque bouton "riche" restait entièrement vide (juste le fond CSS + le libellé, indiscernable
      // d'un bouton plat). embrLoopBtns porte déjà data-loop-idx, posé une seule fois par buildTrackRow --
      // aucun besoin de reconstruire l'association bouton/buffer ici.
      embrLoopBtns.forEach(btn => {
        if (!btn.classList.contains('embr-wave-btn')) return;
        const idx = parseInt(btn.dataset.loopIdx, 10);
        const buf = embrLoopBuffers[idx];
        const bg = btn.querySelector('.embr-wave-bg'), fg = btn.querySelector('.embr-wave-fg');
        if (buf && bg && fg) renderWaveformPair(bg, fg, buf, waveBgColor, waveFgColor);
      });
      // Fichiers de transition (24/08) -- optionnels, un par boucle. Une transition manquante/en échec ne
      // bloque jamais la boucle elle-même : la bascule se fait juste sans overlay, comme si aucune
      // transition n'avait été réglée (même tolérance que les transitions du séquentiel).
      for (let li = 0; li < rawLoops.length; li++) {
        const trans = rawLoops[li] && rawLoops[li].transition;
        if (!layerHasSource(trans)) continue;
        try {
          const ab = await loadArrayBuffer(trans);
          embrTransitionBuffers[li] = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* transition manquante : la bascule vers cette boucle se fera sans overlay */ }
      }
      if (embrLoopBuffers.every(b => !b)) { if (statusEl) statusEl.textContent = loadErrorMessageFor('loadErrorNoSegments'); setLoadErrorIcon(); return; }
    } else {
      total = layersToLoad.length + totalSfxFilesToLoad;
      for (let i = 0; i < layersToLoad.length; i++) {
        try {
          const ab = await loadArrayBuffer(layersToLoad[i]);
          buffers[i] = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { if (statusEl) statusEl.textContent = loadErrorMessageFor('loadErrorStatus'); setLoadErrorIcon(); return; }
      }
      if (isStatic && buffers[0] && waveformBg) {
        try {
          waveformBuffer = buffers[0];
          redrawWaveforms();
        } catch (e) { /* la waveform est un bonus visuel : un échec ici ne doit jamais bloquer la lecture */ }
      }
    }
    for (const sfx of attachedSfx) {
      const alts = (sfx.alternatives || []).filter(a => a.file || a.localFile || a.localUrl);
      sfxBuffersById[sfx.id] = new Array(alts.length).fill(null);
      for (let ai = 0; ai < alts.length; ai++) {
        try {
          // Base propre au Sfx (audio/sfx-{id}/), jamais celle du morceau — un Sfx est une entrée de
          // bibliothèque partagée, potentiellement attachée à plusieurs morceaux à la fois.
          const alt = alts[ai];
          let ab;
          if (alt.localFile) ab = await alt.localFile.arrayBuffer();
          else if (alt.localUrl) ab = await (await fetch(alt.localUrl)).arrayBuffer(); // voir loadArrayBuffer() plus haut
          else {
            const v = sfx.publishedAt ? ('?v=' + encodeURIComponent(sfx.publishedAt)) : '';
            const sfxUrl = sfx.base + encodeURIComponent(alt.file) + v;
            const res = await fetchAudio(sfxUrl, sfx.protected);
            ab = await res.arrayBuffer();
            _arrayBufferUrls.set(ab, sfxUrl);
          }
          sfxBuffersById[sfx.id][ai] = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* une variation manquante ne bloque pas la lecture principale */ }
      }
    }
    // Reverb de salle des Sfx spatialisés préparée dès le chargement (25/09) : la calculer au premier appui bloquait la page
    // quelques dizaines de ms (accroc audible sur les effets à ScriptProcessor, départ du Sfx en retard).
    // Même chose pour le rendu 3D au casque : le navigateur ne charge ses données de spatialisation (HRTF) qu'à la création
    // du premier panoramique binaural, et joue ce premier son en mode dégradé en attendant.
    attachedSfx.forEach(sfx => { if (sfx.spatial && sfx.spatial.enabled) { try { getRoomBus(ctx, normalizeSpatial(sfx.spatial).room); } catch (e) {} } });
    if (attachedSfx.some(sfx => sfx.spatial && sfx.spatial.enabled)) { try { if (!_hrtfWarmPanner) { _hrtfWarmPanner = ctx.createPanner(); _hrtfWarmPanner.panningModel = 'HRTF'; } } catch (e) {} }
    // Pour une source locale non encore publiée, la durée réelle n'est connue qu'une fois décodée.
    const allMainBuffers = isVerticalRandom
      ? [introBuffer, outroBuffer, ...sectionBuffers.flat(2)].filter(Boolean)
      : isSequential
      ? [introBuffer, outroBuffer, ...slotBuffers.flat()].filter(Boolean)
      : isEmbrVert
      ? embrLoopBuffers.filter(Boolean)
      : buffers.filter(Boolean);
    const allSfxBuffers = Object.values(sfxBuffersById).flat().filter(Boolean);
    const decodedMax = Math.max(0, ...allMainBuffers.map(b => b.duration), ...allSfxBuffers.map(b => b.duration));
    if (decodedMax > (track.duration || 0)) {
      track.duration = decodedMax;
      if (timeTotal) timeTotal.textContent = formatTime(progressMaxSec());
    }
    if (statusEl) statusEl.textContent = t('readyStatus');
    playBtn.disabled = false;
    playBtn.setAttribute('aria-label', t('playAriaLabel'));
    playIcon.classList.remove('loading-icon');
    playIcon.innerHTML = PLAY_SVG;
    ready = true;
    updateStingerAvailability();
  })();
}

