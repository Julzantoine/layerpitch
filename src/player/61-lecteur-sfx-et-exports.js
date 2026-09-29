/* ---------------- Lecteur Sfx (bloc de contenu AdReel) ----------------
 * Même principe visuel que les blocs Intro/Segment/Outro du mode séquentiel (une forme d'onde par
 * variation, cliquable individuellement), mais sans notion de mesures/BPM — juste un jeu de variations
 * interchangeables du même son (round robin), et un bouton "Play" qui en choisit une selon le réglage
 * de la bibliothèque Sfx (aléatoire sans répéter la précédente, ou dans l'ordre).
 */
// Texte bilingue d'un Sfx : descriptionFr/descriptionEn (même pattern que presentationFr/En des packs et
// collections), avec repli sur l'ancien champ unique "description" pour tout Sfx publié avant le passage
// au bilingue (voir migration côté backstage). Résolu ici, dans player.js, puisque c'est le seul endroit
// qui connaît déjà la langue courante (currentLang()/setLang()) sans dépendre de chaque page hôte.
function pickSfxDescription(sfxDef) {
  const fr = sfxDef.descriptionFr != null ? sfxDef.descriptionFr : (sfxDef.description || '');
  const en = sfxDef.descriptionEn || '';
  return (currentLang() === 'en' ? (en || fr) : (fr || en)) || '';
}

// Texte optionnel affiché pendant la lecture séquentielle d'un emplacement (segmentSlots[]), d'une intro/
// outro, ou d'un fichier de transition (nextOptions[].transition) — même pattern bilingue que pickSfxDescription,
// mais sans repli sur un ancien champ unique (nouveau champ, jamais publié avant, pas de migration à gérer).
// Retourne '' (falsy) si l'objet n'a de texte dans aucune langue — le point d'appel (scheduleSeqLabelUpdate)
// interprète ça comme "cet élément ne redéfinit rien" et laisse le texte précédemment affiché tel quel.
function pickStageDescription(obj) {
  if (!obj) return '';
  const fr = obj.descriptionFr || '';
  const en = obj.descriptionEn || '';
  return (currentLang() === 'en' ? (en || fr) : (fr || en)) || '';
}

// Même architecture que le morceau (buildTrackRow/initTrackPlayer) : une ligne compacte (bouton Play +
// titre), un seul repli qui laisse apparaître tout ce qu'il y a à voir — description, la forme d'onde de
// la SEULE variation effectivement jouée (pas les N en même temps comme avant), et les variations RR
// juste en dessous pour en choisir une précise. Pas de second niveau de repli imbriqué.
// Style des variations round robin d'un Sfx (24/09) : injecté par le lecteur lui-même plutôt que copié dans chaque page
// hôte. index.html en avait sa propre copie, mais pack.html (qui affiche pourtant des Sfx) et le Backstage (lecteur de
// test de l'entrée « Espace ») n'avaient rien -- les blocs y étaient énormes, avec les deux formes d'onde côte à côte au
// lieu d'être superposées. `:where()` = spécificité nulle : toute règle de la page hôte (index.html, ses thèmes) reste prioritaire.
function ensureSfxPlayerStyle() {
  if (document.getElementById('lp-sfx-player-style')) return;
  const st = document.createElement('style');
  st.id = 'lp-sfx-player-style';
  st.textContent = `
    :where(.sfx-rr-row) { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
    :where(.sfx-rr-block) { position: relative; flex: 1 1 64px; min-width: 64px; height: 40px; border-radius: 6px;
      border: 1px solid var(--border, #ccc); background: transparent; cursor: pointer; overflow: hidden; padding: 0; font-family: inherit; }
    :where(.sfx-rr-block.active) { border-color: var(--accent, #2f80c0); }
    :where(.sfx-rr-wave-bg, .sfx-rr-wave-fg) { position: absolute; inset: 0; width: 100%; height: 100%; }
    :where(.sfx-rr-wave-fg) { opacity: 0; transition: opacity 0.15s ease; }
    :where(.sfx-rr-block.active .sfx-rr-wave-fg) { opacity: 1; }
    :where(.sfx-space-view) { margin-top: 12px; font-size: 12px; }
    :where(.sfx-space-layout) { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
    :where(.sfx-space-map) { flex: 0 1 320px; min-width: 220px; }
    :where(.sfx-space-side) { flex: 1 1 200px; min-width: 190px; }
    :where(.sfx-space-side .head-turn-row) { margin-top: 0 !important; }
    :where(.sfx-space-bin) { display: flex; align-items: center; gap: 6px; margin: 10px 0 0; cursor: pointer; }
    :where(.sfx-space-title) { font-weight: 600; margin-bottom: 4px; }
    :where(.sfx-space-readout) { margin-top: 4px; color: var(--text-dimmer, #888); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; }
    :where(.sfx-space-controls) { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 6px; }
    :where(.sfx-space-controls label) { display: flex; align-items: center; gap: 5px; margin: 0; cursor: pointer; }
    :where(.sfx-space-hint) { margin-top: 4px; color: var(--text-dimmer, #888); font-size: 11px; }
    :where(.sfx-rr-label) { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.03em; color: var(--text-dim, #555);
      z-index: 1; padding: 0 4px; text-align: center;
      text-shadow: 0 0 4px var(--bg-card, #fff), 0 0 4px var(--bg-card, #fff), 0 0 4px var(--bg-card, #fff); }
  `;
  document.head.appendChild(st);
}
function buildSfxPlayer(sfxDef) {
  ensureSfxPlayerStyle();
  const alts = sfxDef.alternatives || [];
  const description = pickSfxDescription(sfxDef);
  const wrapper = document.createElement('div');
  wrapper.className = 'track-row-wrapper sfx-row-wrapper';
  wrapper.innerHTML = `
    <div class="track-row">
      <button class="play-btn" data-role="playBtn" ${alts.length ? '' : 'disabled'} aria-label="${t('playAriaLabel') || 'Play'}">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <div class="track-row-title" data-role="titleToggle">
        <span class="name">${escapeHtml(sfxDef.title || '')}</span>
        <span class="mode-tag">${t('sfxModeTag')}</span>
      </div>
    </div>
    <div class="track-row-details" data-role="details">
      <div class="track-row-details-inner">
        ${sfxDef.tag ? `<div class="track-tags"><span class="tag">${escapeHtml(sfxDef.tag)}</span></div>` : ''}
        ${description ? `<div class="track-desc">${linkify(description)}</div>` : ''}
        ${alts.length ? `
          <div class="progress-wrap waveform-mode" data-role="mainWaveWrap">
            <canvas class="waveform-bg" data-role="mainWaveBg"></canvas>
            <canvas class="waveform-fg" data-role="mainWaveFg"></canvas>
          </div>
          <div class="sfx-rr-row" data-role="sfxRrRow">
            ${alts.map((a, i) => `
              <button class="sfx-rr-block" type="button" data-ri="${i}" aria-label="${escapeHtml(a.label) || ('Variation ' + (i + 1))}">
                <canvas class="sfx-rr-wave-bg"></canvas>
                <canvas class="sfx-rr-wave-fg"></canvas>
                <span class="sfx-rr-label">${escapeHtml(a.label) || ('#' + (i + 1))}</span>
              </button>
            `).join('')}
          </div>
        ` : `<span class="placeholder-tag">${t('sfxNoFilesYet')}</span>`}
      </div>
    </div>
  `;

  wrapper.querySelector('[data-role="titleToggle"]').addEventListener('click', () => {
    const details = wrapper.querySelector('[data-role="details"]');
    setDetailsExpanded(details, !details.classList.contains('expanded'));
  });
  // Sfx spatialisé : l'auditeur peut tourner la tête (curseur d'orientation) sous les variations.
  if (sfxDef.spatial && sfxDef.spatial.enabled) {
    const inner = wrapper.querySelector('.track-row-details-inner');
    const publicMode = sfxDef.spatial.publicMode || 'free'; // 'free' | 'frozen' | 'hidden' (choix du compositeur)
    if (sfxDef.hideSpatialView) inner.appendChild(buildHeadTurnControl()); // lecteur de test du Backstage : l'éditeur est déjà juste au-dessus
    else if (publicMode !== 'hidden') inner.appendChild(buildSpatialMatrixView(sfxDef)); // le curseur d'orientation y est posé à côté de la matrice
  }

  if (!alts.length) return wrapper; // Sfx sans variation uploadée : titre/description seuls, pas de lecteur

  const rrBlocks = [...wrapper.querySelectorAll('.sfx-rr-block')];
  const playBtn = wrapper.querySelector('[data-role="playBtn"]');
  const mainWaveBg = wrapper.querySelector('[data-role="mainWaveBg"]');
  const mainWaveFg = wrapper.querySelector('[data-role="mainWaveFg"]');
  const details = wrapper.querySelector('[data-role="details"]');
  const buffers = new Array(alts.length).fill(null);
  const loadPromises = new Array(alts.length).fill(null);
  let lastIndex = -1;
  let activeSource = null;
  // Participe au même registre partagé que les morceaux (trackCollapsers/activeTrackId, voir plus haut
  // dans le fichier) : un Sfx joué déplie sa propre ligne et replie tout le reste de la page — morceaux
  // ET autres Sfx confondus — exactement comme playThisTrack() le fait pour un morceau.
  trackCollapsers[sfxDef.id] = () => setDetailsExpanded(details, false);

  // Décodeur dédié à CE lecteur, jamais partagé — même raisonnement que pour chaque piste musicale : des
  // appels .decode() concurrents sur un décodeur Ogg Vorbis partagé s'entremêleraient silencieusement.
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
  function drawRrWave(i) {
    const buf = buffers[i];
    if (!buf) return;
    const block = rrBlocks[i];
    const bg = block.querySelector('.sfx-rr-wave-bg');
    const fg = block.querySelector('.sfx-rr-wave-fg');
    renderWaveformPair(bg, fg, buf, cssVar('--border', '#ccc'), cssVar('--accent', '#2f80c0'));
  }
  let currentMainIndex = -1;
  // Forme d'onde principale : reflète uniquement la variation en train de jouer (ou la dernière jouée),
  // jamais toutes les variations à la fois — c'est ce que montrent les blocs RR en dessous, à la demande.
  function drawMainWave(i) {
    const buf = buffers[i];
    if (!buf || !mainWaveBg) return;
    renderWaveformPair(mainWaveBg, mainWaveFg, buf, cssVar('--border', '#ccc'), cssVar('--accent', '#2f80c0'));
  }
  // Anime le remplissage de la forme d'onde principale sur la durée réelle du buffer — même mécanisme de
  // transition CSS (clip-path) que le reste du site (cf. activateSeqStage pour le mode séquentiel), plutôt
  // qu'une boucle requestAnimationFrame : un Sfx est un one-shot sans pause/seek, une transition CSS suffit.
  function animateMainWaveProgress(durationSec) {
    if (!mainWaveFg || !(durationSec > 0)) return;
    mainWaveFg.style.transition = 'none';
    mainWaveFg.style.clipPath = 'inset(0 100% 0 0)';
    void mainWaveFg.offsetWidth; // force le reflow, sinon le navigateur fusionne ce reset avec la transition suivante
    mainWaveFg.style.transition = `clip-path ${durationSec}s linear`;
    mainWaveFg.style.clipPath = 'inset(0 0% 0 0)';
  }
  async function loadAlt(i) {
    if (buffers[i]) return buffers[i];
    if (loadPromises[i]) return loadPromises[i];
    loadPromises[i] = (async () => {
      const alt = alts[i];
      let ab;
      if (alt.localFile) ab = await alt.localFile.arrayBuffer(); // fichier choisi mais pas encore publié (test dans le Backstage)
      else if (alt.localUrl) ab = await (await fetch(alt.localUrl)).arrayBuffer();
      else {
        if (!alt.file || !sfxDef.base) return null;
        const v = sfxDef.publishedAt ? ('?v=' + encodeURIComponent(sfxDef.publishedAt)) : '';
        const res = await fetchAudio(sfxDef.base + encodeURIComponent(alt.file) + v, sfxDef.protected);
        ab = await res.arrayBuffer();
      }
      const buf = await decodeAudioDataCompat(ab);
      buffers[i] = buf;
      drawRrWave(i);
      return buf;
    })().catch(e => { console.error('Sfx — échec de chargement d\'une variation :', e); return null; });
    return loadPromises[i];
  }
  // Chargement dès le montage plutôt qu'à la demande : contrairement aux morceaux complets (chargés à
  // l'expansion seulement), un Sfx est un one-shot court — coût réseau marginal, et ça évite un délai
  // perceptible au premier clic sur "Play" ou sur une variation.
  alts.forEach((_, i) => loadAlt(i));

  function pickIndex() {
    const n = alts.length;
    if (n <= 1) return 0;
    if (sfxDef.rrMode === 'sequential') { lastIndex = (lastIndex + 1) % n; return lastIndex; }
    let idx;
    do { idx = Math.floor(Math.random() * n); } while (idx === lastIndex);
    lastIndex = idx;
    return idx;
  }
  async function playIndex(i) {
    const buf = await loadAlt(i);
    if (!buf) return;
    if (activeSource) { try { activeSource.stop(); } catch (e) {} }
    rrBlocks.forEach(b => b.classList.remove('active'));
    rrBlocks[i].classList.add('active');
    currentMainIndex = i;
    drawMainWave(i);
    animateMainWaveProgress(buf.duration);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    connectSfxSource(src, sfxDef);
    src.start();
    activeSource = src;
    src.onended = () => {
      if (activeSource === src) {
        activeSource = null;
        rrBlocks[i].classList.remove('active');
        if (activeTrackId === sfxDef.id) activeTrackId = null;
      }
    };
  }
  rrBlocks.forEach((block, i) => { block.addEventListener('click', () => playIndex(i)); });
  playBtn.addEventListener('click', () => {
    if (activeTrackId && activeTrackId !== sfxDef.id) {
      document.dispatchEvent(new CustomEvent('stop-track', { detail: activeTrackId }));
      if (trackStingerKillers[activeTrackId]) trackStingerKillers[activeTrackId]();
    }
    Object.keys(trackCollapsers).forEach(id => { if (id !== sfxDef.id) trackCollapsers[id](); });
    activeTrackId = sfxDef.id;
    setDetailsExpanded(details, true);
    playIndex(pickIndex());
  });

  // Redessine les formes d'onde déjà chargées si le conteneur change de taille — même principe que
  // partout ailleurs sur le site (mode statique, séquentiel, etc.). Inclut la forme d'onde principale si
  // une variation a déjà été jouée au moins une fois.
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      buffers.forEach((buf, i) => { if (buf) drawRrWave(i); });
      if (currentMainIndex >= 0) drawMainWave(currentMainIndex);
    }).observe(wrapper);
  }

  return wrapper;
}

window.LayerPlayerCore = {
  formatTime,
  cumulativeProfiles,
  section,
  escapeHtml,
  linkify,
  layerHasSource,
  adReelFromParam,
  infoBadgeSvg,
  buildTrackRow,
  initTrackPlayer,
  renderTracksBlock,
  setTakeRecording,
  getTrackTake,
  buildSfxPlayer,
  SPATIAL_ROOMS,
  spatialFieldHalfExtent,
  normalizeSpatial,
  buildRoomImpulse,
  buildSpatialVoice,
  buildSpatialMatrixView,
  pickSpatialStepIndex,
  buildLayerFxChain,
  applyFxToChain,
  fxTrackRatio,
  fxSliderRateSemitones,
  trackNeedsLatencyComp,
  withLatencyComp,
  fxSpLatencySec,
  embrCutFadeSec,
  // Minutages musicaux purs (26/09, voir plus haut) -- partagés avec l'outil vidéo (capture-retarget.js).
  trackTempo, seqSlotTiming, seqBlockSeconds, seqTransitionTiming, seqTransitionDurationSec, embrTransitionDurationSec,
  quantizedLoopTiming, vrSectionTiming, vrIntroDurationSec, embrReferenceIndex, embrPeerIndicesOf, embrLoopTimingOf, embrDurationToSec, embrQuantizeDelayAt,
  // Contexte audio de la page : sa fréquence et le retard de ses effets à ScriptProcessor (rendu hors-ligne à l'identique).
  liveSampleRate: () => ctx.sampleRate,
  audioContext: () => ctx, // le contexte audio de la page (lecture d'une version figée en direct)
  decodeAudioCompat,
  resumeAudio: () => { try { if (ctx.state !== 'running') return ctx.resume(); } catch (e) {} return Promise.resolve(); },
  audioNow: () => ctx.currentTime,
  liveFxLatencySec: () => fxSpLatencySec(ctx),
  CAPTURE_RAMPS: { intensity: INTENSITY_RAMP_SEC, voice: VOICE_RAMP_SEC, duckLevel: DUCK_LEVEL, duckAttack: DUCK_ATTACK_SEC, duckRelease: DUCK_RELEASE_SEC },
  createTriggerRuleEngine,
  simulateTriggerRules,
  FX_SLIDER_PARAMS,
  fxSlidersValid,
  fxSliderOverrides,
  fxSliderForceKeys,
  applyFxSliderOverrides,
  fxSliderThresholdWants,
  fxSliderSfxOverrides,
  fxSpatialWithOverride,
  fxCurveEval,
  spatialPathPointAt,
  fxCurveSanitize,
  fxSliderTargetKey,
  fxTargetKeyFromTarget,
  baseFxForTarget,
  mergeTriggerFx,
  setListenerYaw,
  getListenerYaw,
  applyListenerYaw,
  setupContrastToggle,
  setupNightModeToggle,
  getModeLabel,
  setLang,
  setSfxLibrary,
  shareOrCopy,
  downloadTracksAsZip,
  fetchAudio,
  fetchAudioBytes,
  createSectionPlaybackScheduler,
  PLAYABLE_MODES,
  WAVEFORM_STYLES,
  setWaveformStyle,
  currentWaveformStyle,
  SEQ_MAP_THEMES,
  setSeqMapTheme,
  currentSeqMapTheme,
  SEQ_MAP_DENSITIES,
  setSeqMapDensity,
  currentSeqMapDensity,
  computeWaveformPeaks,
  drawWaveformCanvas,
  resolveEffectiveWaveformStyle,
  resolveWaveformColors
};

})();
