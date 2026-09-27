function buildTrackRow(track, packsForTrack, globalNoAiCertified, suppressIndividualBadge) {
  packsForTrack = packsForTrack || [];
  // Même logique qu'effectiveNoAiCertified() côté Backstage : une exception explicite par morceau
  // (true/false) prime sur le réglage global, sinon on suit le réglage global. Pas affiché du tout si
  // le badge collectif (tout le catalogue certifié) est déjà montré une fois pour tout le bloc.
  const isNoAiCertified = !suppressIndividualBadge && ((track.noAiOverride === true || track.noAiOverride === false) ? track.noAiOverride : !!globalNoAiCertified);
  const supported = PLAYABLE_MODES.includes(track.mode);
  const isStatic = track.mode === 'static';
  const isVerticalRandom = track.mode === 'vertical-random';
  const isSequential = track.mode === 'sequential';
  const isEmbrVert = track.mode === 'embranchement-vertical';
  const loops = !isStatic || !!track.loopable;
  // Même plafond que progressMaxSec() dans initTrackPlayer : vertical-random affiche la longueur du
  // cycle qui boucle de la PREMIÈRE section jouable, pas celle du fichier le plus long de tous les pools
  // de toutes les sections (voir le commentaire détaillé dans initTrackPlayer).
  const displayMaxSec = (() => {
    if (!isVerticalRandom) return track.duration;
    const sections = track.sections || [];
    let firstPlayable = null;
    for (let i = 0; i < sections.length; i++) { if (vrSectionIsPlayable(track, i)) { firstPlayable = resolveVRSection(track, i); break; } }
    if (!firstPlayable) return track.duration;
    const spb = 60 / (firstPlayable.bpm || 120);
    const lIn = (firstPlayable.loopInBeat || 0) * spb;
    const lOut = Math.max(lIn + spb, (firstPlayable.loopOutBeat || (firstPlayable.beatsPerBar || 4) * 4) * spb);
    return lOut || track.duration;
  })();
  const hasFiles = supported && (isVerticalRandom
    ? (track.sections || []).some((s, i) => vrSectionIsPlayable(track, i))
    : isSequential
    ? (track.segmentSlots || []).some(sl => (sl.alternatives || []).some(layerHasSource))
    : isEmbrVert
    ? (track.loops || []).some(layerHasSource)
    : layerHasSource(track.layers[0]) && (isStatic || track.layers.every(layerHasSource)));

  const wrapper = document.createElement('div');
  wrapper.className = 'track-row-wrapper';

  let intensityBlockHtml = '';
  if (track.mode === 'vertical' && supported) {
    const n = track.layers.length;
    const chips = Array.from({ length: n }, (_, i) => {
      const customLabel = (track.layers[i] && track.layers[i].label) ? track.layers[i].label : '';
      const inner = customLabel
        ? `<span class="intensity-chip-num">${i + 1}</span>${escapeHtml(customLabel)}`
        : String(i + 1);
      return `<button type="button" class="intensity-chip${i === 0 ? ' active' : ''}" data-level="${i}">${inner}</button>`;
    }).join('');
    intensityBlockHtml = `
      <div class="track-intensity-block">
        <div class="track-intensity-label">${t('intensityLabel')}</div>
        <div class="intensity-picker" data-role="slider">${chips}</div>
      </div>
    `;
  }

  // Boutons nommés d'embranchement-vertical : une boucle autonome par bouton (pas un curseur continu,
  // contrairement au vertical classique) — la boucle marquée isInitial est active par défaut. Le bouton
  // de la boucle actuellement audible porte la classe "active" ; celui d'une boucle plus courte que la
  // référence (donc un aller-retour à sens unique, pas une boucle qu'on peut garder) est désactivé
  // pendant qu'elle joue (voir selectEmbrLoop côté moteur) pour éviter un retrigger qui casserait le calage.
  let embrVertBlockHtml = '';
  if (isEmbrVert && supported) {
    const loopsList = track.loops || [];
    const refBars = (loopsList.find(l => l.isInitial) || loopsList[0] || {}).bars;
    const isShortLoop = (l, isRef) => !isRef && refBars != null && l.bars != null && l.bars < refBars;
    // Seuils de dégradation du visuel riche (voir CHANGELOG du 02/09) : 2-4 boucles paires = hauteur
    // pleine (34px, comme .seq-block) ; 5-7 = hauteur interpolée jusqu'à un plancher de 20px, en dessous
    // duquel les barres de drawWaveformCanvas() fusionnent visuellement ; 8+ = repli complet sur le
    // gabarit compact (bouton texte simple, comportement inchangé).
    const peerCount = loopsList.filter(l => !isShortLoop(l, !!l.isInitial)).length;
    const embrRichMode = peerCount <= 7;
    const embrRowH = peerCount <= 4 ? 34 : Math.round(34 - (Math.min(peerCount, 7) - 4) * (14 / 3));
    const buttons = loopsList.map((l, i) => {
      const isRef = !!l.isInitial;
      const isShort = isShortLoop(l, isRef);
      const label = escapeHtml(l.label || t('loopFallback', { n: i + 1 }));
      if (embrRichMode && !isShort) {
        return `<button type="button" class="embr-loop-btn embr-wave-btn${isRef ? ' active' : ''}" data-loop-id="${escapeHtml(l.id || String(i))}" data-loop-idx="${i}" data-short="0"><canvas class="embr-wave-bg" data-role="embrWaveBg-${i}"></canvas><canvas class="embr-wave-fg" data-role="embrWaveFg-${i}"></canvas><span class="embr-wave-label">${label}</span></button>`;
      }
      return `<button type="button" class="embr-loop-btn${isRef ? ' active' : ''}" data-loop-id="${escapeHtml(l.id || String(i))}" data-loop-idx="${i}" data-short="${isShort ? '1' : '0'}">${label}</button>`;
    }).join('');
    embrVertBlockHtml = `
      <div class="track-intensity-block">
        <div class="track-intensity-label">${t('embrLoopsLabel')}</div>
        <div class="intensity-picker" data-role="embrLoopPicker"${embrRichMode ? ` style="--embr-row-h:${embrRowH}px"` : ''}>${buttons}</div>
      </div>
    `;
  }

  // Panneau "En cours" pour le vertical classique : un vumètre par couche, qui reflète en direct
  // son gain réel — visible pendant le fondu enchaîné quand l'intensité change (façon Wwise Voice Graph).
  let vertGraphHtml = '';
  if (track.mode === 'vertical' && supported) {
    vertGraphHtml = `
      <div class="voice-graph" data-role="vertGraph">
        <div class="voice-graph-label">${t('inProgressLabel')}</div>
        ${track.layers.map((l, i) => `
          <div class="voice-row-wrap">
            <div class="voice-row">
              <span class="voice-row-label">${escapeHtml((l && l.label) || t('layerFallback', { n: i + 1 }))}</span>
              <span class="voice-meter-bar" data-role="vertMeter-${i}"><span class="voice-meter-bar-fill"></span></span>
              <div class="wwise-node-controls">
                <button type="button" class="voice-ctrl-btn" data-voice-action="solo" data-voice-key="layer-${i}" title="${t('soloTitle')}">S</button>
                <button type="button" class="voice-ctrl-btn" data-voice-action="mute" data-voice-key="layer-${i}" title="${t('muteTitle')}">M</button>
              </div>
            </div>
            <div class="voice-volume-row">
              <input type="range" class="voice-volume-slider" data-voice-key="layer-${i}" min="0" max="1.5" step="0.01" value="1" title="${t('volumeTitle')}" aria-label="${t('volumeTitle')}">
              <span class="voice-volume-value" data-role="volumeValue-layer-${i}">100%</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  let voiceGraphHtml = '';
  if (isVerticalRandom && supported) {
    // Nombre de "voix" affichées : le plus grand nombre de pools parmi toutes les sections jouables — une
    // section qui en a moins voit simplement ses voix excédentaires masquées à l'écran au moment de jouer
    // (même mécanisme que les tirages silencieux existants), plutôt que de reconstruire tout le graphe en
    // HTML à chaque changement de section.
    const allSections = track.sections || [];
    const maxPoolCount = Math.max(0, ...allSections.map((s, i) => (resolveVRSection(track, i) || {}).pools?.length || 0));
    const sectionBlocks = allSections.map((sec, i) => `
      <div class="seq-block" data-role="vrBlock-${i}">
        <div class="vr-block-fill" data-role="vrBlockFill-${i}"></div>
        <span class="seq-block-label">${escapeHtml(sec.label || t('sectionFallback', { n: i + 1 }))}</span>
      </div>
    `).join('');
    // Une petite liste déroulante par section, alignée sous chaque bloc — affichée en permanence (pas
    // seulement pour la section active), pour régler section.maxLoops indépendamment de maxChainLoops
    // (qui porte sur la chaîne entière). Désactivée si la section n'a aucun contenu jouable.
    const sectionLoopOptions = [null, 1, 2, 3, 5, 10];
    const sectionLoopRow = allSections.map((sec, i) => {
      const label = sec.label || t('sectionFallback', { n: i + 1 });
      const current = resolveVRSection(track, i).maxLoops || null;
      return `
      <div style="flex:1">
        <select data-role="vrSectionLoop-${i}" title="${escapeHtml(t('sectionLoopCountTitle', { label }))}">
          ${sectionLoopOptions.map(n => `<option value="${n === null ? '' : n}"${current === n ? ' selected' : ''}>${n === null ? '∞' : n}</option>`).join('')}
        </select>
      </div>`;
    }).join('');
    const poolNodes = Array.from({ length: maxPoolCount }, (_, pi) => `
      <div class="wwise-node wwise-node-voice" data-role="wwiseVoice-pool-${pi}">
        <div class="wwise-node-top">
          <div class="wwise-node-label" data-role="voiceCurrent-${pi}">—</div>
          <div class="wwise-node-controls">
            <button type="button" class="voice-ctrl-btn" data-voice-action="solo" data-voice-key="pool-${pi}" title="${t('soloTitle')}">S</button>
            <button type="button" class="voice-ctrl-btn" data-voice-action="mute" data-voice-key="pool-${pi}" title="${t('muteTitle')}">M</button>
          </div>
        </div>
        <div class="voice-volume-row">
          <input type="range" class="voice-volume-slider" data-voice-key="pool-${pi}" min="0" max="1.5" step="0.01" value="1" title="${t('volumeTitle')}" aria-label="${t('volumeTitle')}">
          <span class="voice-volume-value" data-role="volumeValue-pool-${pi}">100%</span>
        </div>
        <span class="wwise-node-wave">
          <canvas class="wwise-wave-bg" data-role="voiceWaveBg-${pi}"></canvas>
          <canvas class="wwise-wave-fg" data-role="voiceWaveFg-${pi}"></canvas>
        </span>
      </div>
    `).join('');
    voiceGraphHtml = `
      <div class="voice-graph" data-role="voiceGraph">
        <div class="voice-graph-label">${t('inProgressLabel')}</div>
        <div class="voice-row">
          <span class="voice-row-label">${t('currentSectionLabel')}</span>
          <span class="voice-row-current" data-role="sectionCurrent">—</span>
        </div>
        ${sectionBlocks ? `<div class="seq-blocks" data-role="vrBlocks">${sectionBlocks}</div>` : ''}
        ${sectionBlocks ? `<div class="seq-blocks" data-role="vrSectionLoopRow" style="margin-top:2px">${sectionLoopRow}</div>` : ''}
        <div class="wwise-graph" data-role="wwiseGraph">
          <svg class="wwise-graph-lines" data-role="wwiseLines"></svg>
          <div class="wwise-col wwise-col-source">
            <div class="wwise-node wwise-node-source" data-role="wwiseSource">${escapeHtml(track.title || t('trackFallback'))}</div>
          </div>
          <div class="wwise-col wwise-col-voices">
            ${poolNodes}
          </div>
          <div class="wwise-col wwise-col-bus">
            <div class="wwise-node wwise-node-bus" data-role="wwiseBus">${t('outputNode')}</div>
          </div>
        </div>
        <div class="actions" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
          <button type="button" class="voice-refresh-btn" data-role="refreshPool">${t('refreshPool')}</button>
          <button type="button" class="voice-refresh-btn" data-role="goToNextSectionBtn" disabled>${t('goToNextSectionBtn')}</button>
          <button type="button" class="voice-refresh-btn" data-role="goToEndBtn" disabled>${t('goToEndBtn')}</button>
        </div>
      </div>
    `;
  }

  let seqGraphHtml = '';
  if (isSequential && supported) {
    const hasIntro = layerHasSource(track.intro);
    const hasOutro = layerHasSource(track.outro);
    seqGraphHtml = `
      <div class="voice-graph" data-role="seqGraph">
        <div class="voice-graph-label">${t('inProgressLabel')}</div>
        <div class="seq-blocks" data-role="seqBlocks">
          ${hasIntro ? `<div class="seq-block" data-role="seqBlock-intro"><canvas class="seq-block-wave-bg" data-role="seqWaveBg-intro"></canvas><canvas class="seq-block-wave-fg" data-role="seqWaveFg-intro"></canvas><span class="seq-block-label">${t('introLabel')}</span></div>` : ''}
          <div class="seq-block" data-role="seqBlock-segment"><canvas class="seq-block-wave-bg" data-role="seqWaveBg-segment"></canvas><canvas class="seq-block-wave-fg" data-role="seqWaveFg-segment"></canvas><span class="seq-block-label">${t('segmentLabel')}</span></div>
          ${hasOutro ? `<div class="seq-block" data-role="seqBlock-outro"><canvas class="seq-block-wave-bg" data-role="seqWaveBg-outro"></canvas><canvas class="seq-block-wave-fg" data-role="seqWaveFg-outro"></canvas><span class="seq-block-label">${t('outroLabel')}</span></div>` : ''}
        </div>
        <div class="voice-row">
          <span class="voice-meter" data-role="seqMeter"></span>
          <span class="voice-row-current" data-role="seqCurrent">—</span>
        </div>
        <div class="seq-pending-indicator" data-role="seqPendingIndicator" style="display:none">${t('pendingBranchLabel')}</div>
        <button type="button" class="voice-refresh-btn" data-role="goToEndBtn" disabled ${hasOutro ? '' : 'style="display:none"'}>${t('goToEndBtn')}</button>
      </div>
    `;
  }

  // Carte globale des chemins (02/09) : un nœud par emplacement de la chaîne, remplie/mise à jour
  // dynamiquement par updateSeqMap()/drawSeqMapLines() (voir bloc dédié dans initTrackPlayer) -- vide au
  // rendu initial (ni lecture ni structure "toujours révélée" avant l'exécution JS), sauf en mode
  // Backstage (seqMapFullReveal) où elle se remplit dès le chargement des buffers.
  let seqMapHtml = '';
  if (isSequential && supported && (track.segmentSlots || []).length > 1) {
    seqMapHtml = `
      <div class="seq-map${currentSeqMapTheme() === 'dark' ? ' seq-map-dark' : ''}${currentSeqMapDensity() === 'roomy' ? ' seq-map-roomy' : ''}" data-role="seqMap">
        <div class="voice-graph-label">${t('seqMapLabel')}${track.randomizeSections ? ` <span class="seq-map-random-note">· ${t('seqMapRandomOrderNote')}</span>` : ''}</div>
        <div class="seq-map-graph" data-role="seqMapGraph">
          <div class="seq-map-canvas" data-role="seqMapCanvas">
            <svg class="seq-map-lines" data-role="seqMapLines"></svg>
            <div class="seq-map-nodes" data-role="seqMapNodes"></div>
          </div>
        </div>
      </div>
    `;
  }

  // Boutons de triggers d'effets (23/09) : uniquement ceux que le compositeur a choisi d'exposer (visible),
  // ou tous dans l'aperçu du Backstage (seqMapFullReveal, même drapeau que la carte des chemins) pour qu'il
  // puisse les essayer avant de les publier. Désactivés jusqu'à ce que la ligne soit dépliée et prête
  // (même règle que les boutons Sfx, voir setStingerButtonsEnabled). Un trigger sans cible valide n'apparaît pas.
  let fxTriggersHtml = '';
  const publicFxTriggers = supported ? (track.fxTriggers || []).filter(d => d && d.id && d.fx && d.target && (d.visible || track.seqMapFullReveal)) : [];
  if (publicFxTriggers.length) {
    ensureFxTriggerStyle();
    fxTriggersHtml = `
      <div class="track-intensity-block">
        <div class="track-intensity-label">${t('fxTriggersRowLabel')}</div>
        <div class="fx-trigger-row">
          ${publicFxTriggers.map((d, i) => `<button type="button" class="fx-trigger-btn" data-fx-trigger="${escapeHtml(d.id)}" aria-pressed="false" disabled>${escapeHtml(d.label || t('fxTriggerFallbackLabel', { n: i + 1 }))}</button>`).join('')}
        </div>
      </div>
    `;
  }

  // Curseurs de paramètre (24/09) : même règle de visibilité que les boutons d'effet (visible, ou tous dans l'aperçu
  // du Backstage), désactivés jusqu'à ce que la ligne soit prête.
  const publicFxSliders = supported ? fxSlidersValid(track).filter(sl => sl.visible || track.seqMapFullReveal) : [];
  if (publicFxSliders.length) {
    ensureFxTriggerStyle();
    fxTriggersHtml += `
      <div class="track-intensity-block">
        <div class="track-intensity-label">${t('fxSlidersRowLabel')}</div>
        <div class="fx-slider-row">
          ${publicFxSliders.map((sl, i) => `<label class="fx-slider"><span>${escapeHtml(sl.label || t('fxSliderFallbackLabel', { n: i + 1 }))}</span><input type="range" min="0" max="100" step="1" value="${Math.round(sl.def * 100)}" data-fx-slider="${escapeHtml(sl.id)}" disabled><output>${Math.round(sl.def * 100)}%</output></label>`).join('')}
        </div>
      </div>
    `;
  }

  // Sélecteur de boucles : uniquement pour les pistes qui utilisent le moteur quantifié (seul moteur
  // qui connaît la notion de cycle et donc de "nombre de boucles"). Valeur par défaut = celle choisie
  // par le compositeur, modifiable ici par le visiteur — la piste applique le changement au vol.
  // Le vertical-random n'est PAS concerné ici : depuis la fusion des modes, il a son propre sélecteur de
  // cycles de chaîne plus bas (chainLoopCountHtml), lié à maxChainLoops et non à maxLoops.
  const useQuantizedLoopForUI = (loops && track.loopEngine === 'quantized');
  let loopCountHtml = '';
  if (useQuantizedLoopForUI && supported) {
    const options = [null, 1, 2, 3, 5, 10];
    const current = track.maxLoops || null;
    loopCountHtml = `
      <div class="loop-count-block">
        <div class="loop-count-label">${t('loopCountLabel')}</div>
        <select data-role="loopCountSelect">
          ${options.map(n => `<option value="${n === null ? '' : n}"${current === n ? ' selected' : ''}>${n === null ? t('infiniteLoops') : n}</option>`).join('')}
        </select>
      </div>
    `;
  }

  // Sélecteur du nombre de cycles complets de la chaîne avant transition automatique — séquentiel et
  // vertical-random uniquement (voir maxChainLoops, décision du 31/07). Indépendant de section.maxLoops
  // (réglable section par section juste sous les blocs, pour le vertical-random — voir sectionLoopRowHtml).
  let chainLoopCountHtml = '';
  if ((isSequential || isVerticalRandom) && supported) {
    const options = [null, 1, 2, 3, 5, 10];
    const current = track.maxChainLoops || null;
    chainLoopCountHtml = `
      <div class="loop-count-block">
        <div class="loop-count-label">${t('chainLoopCountLabel')}</div>
        <select data-role="chainLoopCountSelect">
          ${options.map(n => `<option value="${n === null ? '' : n}"${current === n ? ' selected' : ''}>${n === null ? t('infiniteLoops') : n}</option>`).join('')}
        </select>
      </div>
    `;
  }

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
        ${supported ? `
          <span class="loop-icon" title="${loops ? 'Bouclable' : 'Ne boucle pas'}">
            ${loops
              ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13"/><path d="M13 6l6 6-6 6"/></svg>'}
          </span>
        ` : ''}
      </div>
    </div>
    <div class="track-row-details" data-role="details">
     <div class="track-row-details-inner">
      <div class="track-desc" data-role="trackDesc">${linkify(track.description || '')}</div>
      ${track.tags ? `<div class="track-tags">${track.tags.split(',').map(s => s.trim()).filter(Boolean).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      ${packsForTrack && packsForTrack.length ? `<div class="pack-link">${packsForTrack.map(p => `<a href="./pack.html?id=${encodeURIComponent(p.id)}${adReelFromParam()}">${t('partOfPack', { title: escapeHtml(p.title) })}</a>`).join('<br>')}</div>` : ''}
      ${!supported ? `<span class="placeholder-tag">Mode "${track.mode}" pas encore supporté</span>` :
        !hasFiles ? `<span class="placeholder-tag">Fichiers audio manquants</span>` : (
        (isSequential || isVerticalRandom || isEmbrVert) ? `
          <div class="status" data-role="status">Chargement…</div>
        ` : `
        <div class="status" data-role="status">Chargement…</div>
        <div class="progress-wrap${isStatic ? ' waveform-mode' : ''}" data-role="progressWrap">
          ${isStatic ? `
            <canvas class="waveform-bg" data-role="waveformBg"></canvas>
            <canvas class="waveform-fg" data-role="waveformFg"></canvas>
          ` : `
            <div class="progress-track" data-role="progressTrack"></div>
            <div class="progress-fill" data-role="progressFill"></div>
            <div class="progress-head" data-role="progressHead"></div>
          `}
        </div>
        <div class="time-row"><span data-role="timeCurrent">0:00</span><span data-role="timeTotal">${formatTime(displayMaxSec)}</span></div>
        ${(track.sfxIds && track.sfxIds.length) ? `
          <div class="track-intensity-block">
            <div class="track-intensity-label">${t('sfxRowLabel')}</div>
            <div class="track-sfx-row">
              ${track.sfxIds.map(id => SFX_LIBRARY_BY_ID[id]).filter(Boolean).map((sfx, i) => `<button class="stinger-btn" data-stinger="${i}" data-sfx-id="${sfx.id}" disabled><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${escapeHtml((track.sfxLabelOverrides && track.sfxLabelOverrides[sfx.id]) || sfx.title || ('Sfx ' + (i + 1)))}</button>`).join('')}
            </div>
          </div>
        ` : ''}
      `)}
      ${intensityBlockHtml}
      ${embrVertBlockHtml}
      ${loopCountHtml}
      ${chainLoopCountHtml}
      ${voiceGraphHtml}
      ${vertGraphHtml}
      ${seqGraphHtml}
      ${seqMapHtml}
      ${fxTriggersHtml}
      ${(isSequential || isVerticalRandom || isEmbrVert) && track.sfxIds && track.sfxIds.length ? `
        <div class="track-intensity-block">
          <div class="track-intensity-label">${t('sfxRowLabel')}</div>
          <div class="track-sfx-row">
            ${track.sfxIds.map(id => SFX_LIBRARY_BY_ID[id]).filter(Boolean).map((sfx, i) => `<button class="stinger-btn" data-stinger="${i}" data-sfx-id="${sfx.id}" disabled><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${escapeHtml((track.sfxLabelOverrides && track.sfxLabelOverrides[sfx.id]) || sfx.title || ('Sfx ' + (i + 1)))}</button>`).join('')}
          </div>
        </div>
      ` : ''}
     </div>
    </div>
  `;

  wrapper.querySelector('[data-role="titleToggle"]').addEventListener('click', () => {
    const details = wrapper.querySelector('[data-role="details"]');
    setDetailsExpanded(details, !details.classList.contains('expanded'));
  });

  return wrapper;
}

// Résout la paire de couleurs bg/fg à utiliser pour la forme d'onde d'un morceau, à partir d'un éventuel
// réglage par élément (Chantier Apparence, palier Pro, réglage par élément, 05/09) -- pure (aucun DOM/
// canvas), donc testable directement sans les limites de jsdom sur le rendu canvas réel. Repli sur les
// couleurs générales existantes (cssVar) si non réglé, exactement comme avant ce chantier -- compatible
// avec N'IMPORTE QUEL style choisi par ailleurs (Chantier Apparence "style de forme d'onde") puisqu'un
// style ne fait jamais que redessiner avec la couleur reçue, quelle qu'elle soit.
function resolveWaveformColors(elementColors) {
  return {
    bg: (elementColors && elementColors.waveform && elementColors.waveform.unplayedColor) || cssVar('--border', '#ccc'),
    fg: (elementColors && elementColors.waveform && elementColors.waveform.playedColor) || cssVar('--accent', '#c9713c')
  };
}
