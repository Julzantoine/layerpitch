  // ---- Journal de prise de CE morceau (voir setTakeRecording plus haut) ----
  // Une prise commence à chaque vrai démarrage (pas une reprise après pause, un saut dans la frise ou un retour de
  // veille : ceux-là continuent la même prise, et le journal note simplement ce qui a été rejoué). Pendant une pause,
  // le temps d'écoute s'arrête. Chaque moteur signale ses voix via journalVoice / journalSfxVoice juste avant de les
  // lancer ; tout le reste (volumes, vitesse, effets) est consigné par les nœuds eux-mêmes.
  let take = null;
  function startTake() {
    if (!takeRecordingEnabled) { take = null; return; }
    journalParam(trackMasterGain.gain); // morceau initialisé avant l'activation : on rattrape son gain maître
    take = {
      startCtx: ctx.currentTime, pauses: [], pausedAt: null, voices: [], sfx: [], recordedAt: new Date().toISOString(),
      master0: trackMasterGain.gain.value, masterFrom: trackMasterGain.gain.__lpLog ? trackMasterGain.gain.__lpLog.auto.length : 0,
      yaw0: getListenerYaw(), yawFrom: _takeYawLog.length
    };
  }
  function pauseTake() { if (take && take.pausedAt == null) take.pausedAt = ctx.currentTime; }
  function resumeTake() {
    if (!take) return;
    take.resumable = false;
    if (take.pausedAt != null) { take.pauses.push([take.pausedAt, ctx.currentTime]); take.pausedAt = null; }
  }
  function journalVoice(src, g, chain) {
    if (take && take.pausedAt == null && src && src.__lpInfo) take.voices.push({ src, g, chain });
  }
  function journalSfxVoice(src, spatialVoice) {
    if (take && take.pausedAt == null && src && src.__lpInfo) take.sfx.push({ src, voice: spatialVoice || null });
  }
  trackTakeReaders[track.id] = () => {
    const J = take;
    if (!J) return null;
    const endCtx = J.pausedAt != null ? J.pausedAt : ctx.currentTime;
    // Heure du contexte audio -> temps d'écoute : on retire les pauses déjà closes, et un instant tombé PENDANT une
    // pause (ou après la pause en cours) se ramène au moment où elle a commencé.
    const pauses = J.pausedAt != null ? J.pauses.concat([[J.pausedAt, Infinity]]) : J.pauses;
    const tt = c => {
      let t = c - J.startCtx;
      pauses.forEach(([a, b]) => { if (c >= b) t -= (b - a); else if (c > a) t -= (c - a); });
      return Math.round(t * 1e6) / 1e6;
    };
    const param = log => (log ? { init: log.init, auto: log.auto.map(e => [e[0], tt(e[1])].concat(e.slice(2))) } : null);
    // Plusieurs stop() : le dernier appel l'emporte, sauf si la source s'était déjà arrêtée avant qu'il arrive.
    const stopOf = info => {
      let s = null;
      info.stops.forEach(([call, when]) => { if (s == null || call < s) s = when; });
      return s == null ? null : tt(s);
    };
    const base = src => {
      const info = src.__lpInfo, st = info.starts[0];
      return { url: st.url, start: tt(st.when), offset: st.offset, dur: st.duration, loop: st.loop, stop: stopOf(info), rate: param(src.playbackRate.__lpLog) };
    };
    const started = x => x.src.__lpInfo && x.src.__lpInfo.starts.length;
    const voices = J.voices.filter(started).map(({ src, g, chain }) => Object.assign(base(src), {
      gain: g ? param(g.gain.__lpLog) : null,
      fx: chain && chain.__lpMeta ? chain.__lpMeta : null,
      fxLog: chain && chain.__lpFxLog ? chain.__lpFxLog.map(([c, fx, r]) => [tt(c), fx, r]) : []
    }));
    const sfx = J.sfx.filter(started).map(({ src, voice }) => {
      const sp = voice && voice.__lpSpatial;
      return Object.assign(base(src), { spatial: sp ? { sp: sp.sp, stepIndex: sp.stepIndex, calls: sp.calls.map(c => [tt(c[0])].concat(c.slice(1))) } : null });
    });
    const masterLog = trackMasterGain.gain.__lpLog;
    const all = voices.concat(sfx);
    return JSON.parse(JSON.stringify({
      v: 1, kind: 'layerpitch-take', trackId: track.id, publishedAt: track.publishedAt || null, recordedAt: J.recordedAt,
      duration: tt(endCtx), complete: J.pausedAt != null, missing: all.filter(x => !x.url).length,
      // Retard propre aux effets à ScriptProcessor (bitcrusher, pitch-shift) EN DIRECT : le rendu hors-ligne, plus rapide,
      // en a un plus court -- il ajoute la différence pour que ces voix restent calées comme à l'écoute (Sfx compris).
      fxLatencySec: fxSpLatencySec(ctx),
      sampleRate: ctx.sampleRate, // le rendu se fait à la même fréquence : mêmes fichiers décodés, mêmes réverbérations
      voices, sfx,
      // Gain maître : commandes passées pendant une pause (autre morceau lancé, remise à 1 d'un arrêt) écartées -- rien
      // ne sonnait, et elles changeraient une prise déjà close.
      master: { init: J.master0, auto: masterLog ? masterLog.auto.slice(J.masterFrom).filter(e => !pauses.some(([a, b]) => e[1] > a + 1e-6 && e[1] < b)).map(e => [e[0], tt(e[1])].concat(e.slice(2))) : [] },
      yaw: [[0, J.yaw0]].concat(_takeYawLog.slice(J.yawFrom).filter(([c]) => c >= J.startCtx && c <= endCtx).map(([c, y]) => [tt(c), y]))
    }));
  };
  // Ducking : abaisse brièvement le gain maître du morceau pendant qu'un Sfx réglé pour ça est en train
  // de jouer, pour le mettre en valeur, puis remonte — réglage propre à chaque Sfx (duckMainTrack), pas
  // au morceau. Rampes linéaires plutôt qu'un changement instantané, moins désagréable à l'oreille.
  // Baisse plafonnée à 30% (DUCK_LEVEL = 0.7) : la descente reste rapide et nette, mais la remontée
  // démarre dès la moitié du Sfx et s'étale sur une rampe longue — quitte à se terminer après la fin du
  // Sfx lui-même, plutôt que la remontée courte et collée à la toute fin d'avant.
  function duckMainTrack(sfxDurationSec, atTime) {
    const now = atTime != null ? atTime : ctx.currentTime;
    trackMasterGain.gain.cancelScheduledValues(now);
    trackMasterGain.gain.setValueAtTime(trackMasterGain.gain.value, now);
    trackMasterGain.gain.linearRampToValueAtTime(DUCK_LEVEL, now + DUCK_ATTACK_SEC);
    const restoreAt = now + Math.max(DUCK_ATTACK_SEC, sfxDurationSec / 2);
    trackMasterGain.gain.setValueAtTime(DUCK_LEVEL, restoreAt);
    trackMasterGain.gain.linearRampToValueAtTime(1, restoreAt + DUCK_RELEASE_SEC);
  }

  // Paramètres du moteur quantifié (BPM/mesures + queue de fin superposée) — ignorés si useQuantizedLoop est faux
  const { bpm, beatsPerBar, secondsPerBeat } = trackTempo(track);
  const { loopInSec, loopOutSec, cycleLength, startTrackSec } = quantizedLoopTiming(track);
  // Pour vertical-random, track.duration reflète le fichier le PLUS LONG de tout le pool (couches fixes
  // + toutes les alternatives de tous les groupes), pas la longueur du cycle qui boucle réellement —
  // un seul alternative par groupe joue à la fois, souvent bien plus courte que la plus longue du pool.
  // Sans ce plafond, cliquer loin dans la barre programme un bufferOffset au-delà de la longueur réelle
  // des buffers en cours de lecture (silence, plus de boucle). Les autres modes gardent track.duration :
  // toutes leurs couches partagent la même durée par convention, donc pas le même risque.
  // Fonction plutôt que valeur figée : track.duration n'est connu avec certitude qu'une fois le
  // décodage terminé (voir plus bas), donc on le relit à chaque appel plutôt que de le geler trop tôt.
  // Pour vertical-random, la durée affichée est celle du cycle de la section EN COURS (celle qui joue
  // réellement, ou à défaut la première jouable avant tout démarrage) — plus un tempo unique partagé par
  // tout le morceau, chaque section ayant désormais sa propre timeline (30/07).
  function progressMaxSec() {
    if (!isVerticalRandom) return track.duration;
    const origIdx = vrCurrentSectionOriginalIndex >= 0 ? vrCurrentSectionOriginalIndex : (playableSectionOriginalIndex[0] !== undefined ? playableSectionOriginalIndex[0] : -1);
    if (origIdx < 0) return track.duration;
    const section = resolveVRSection(track, origIdx);
    return (section ? sectionTiming(section).loopOutSec : 0) || track.duration;
  }
  // StartTrackPoint (startTrackSec, calculé plus haut par quantizedLoopTiming) : où démarre la toute première lecture
  // (permet de sauter un silence en tête). Ne s'applique qu'au moteur quantifié — le moteur simple garde son
  // comportement natif inchangé.

  const playBtn = wrapper.querySelector('[data-role="playBtn"]');
  const stopBtn = wrapper.querySelector('[data-role="stopBtn"]');
  const playIcon = wrapper.querySelector('[data-role="playIcon"]');
  const details = wrapper.querySelector('[data-role="details"]');
  const statusEl = wrapper.querySelector('[data-role="status"]');
  const wrap = wrapper.querySelector('[data-role="progressWrap"]');
  const progressTrackEl = wrapper.querySelector('[data-role="progressTrack"]');
  const fill = wrapper.querySelector('[data-role="progressFill"]');
  const head = wrapper.querySelector('[data-role="progressHead"]');
  // Barre de progression "à deux états" (Chantier Apparence par élément, palier Pro, 05/09) : simple
  // barre CSS (pas un canvas), donc appliquée une seule fois en style inline plutôt que reconstruite à
  // chaque tick -- même repli que la forme d'onde si non réglée (couleurs générales inchangées).
  if (elementColors && elementColors.progressBar) {
    if (progressTrackEl && elementColors.progressBar.unplayedColor) progressTrackEl.style.background = elementColors.progressBar.unplayedColor;
    if (elementColors.progressBar.playedColor) {
      if (fill) fill.style.background = elementColors.progressBar.playedColor;
      if (head) head.style.background = elementColors.progressBar.playedColor;
    }
  }
  // Recale max-height si le contenu change de taille pendant que la piste est dépliée (ex. le statut
  // qui passe de "Chargement…" à "Prêt", ou une waveform qui apparaît) — sinon la hauteur mesurée au
  // moment du dépli deviendrait obsolète et couperait ou laisserait un vide sous le contenu.
  const detailsInnerEl = details.querySelector('.track-row-details-inner');
  if (detailsInnerEl && window.ResizeObserver) {
    new ResizeObserver(() => {
      if (details.classList.contains('expanded')) details.style.maxHeight = detailsInnerEl.scrollHeight + 'px';
    }).observe(detailsInnerEl);
  }
  // Waveform (mode statique uniquement — une seule couche jouée à la fois, donc "la" forme d'onde du
  // morceau a un sens ; ambigu pour vertical/vertical-random où plusieurs couches sonnent ensemble).
  const waveformBg = wrapper.querySelector('[data-role="waveformBg"]');
  const waveformFg = wrapper.querySelector('[data-role="waveformFg"]');
  let waveformBuffer = null;
  function redrawWaveforms() {
    renderWaveformPair(waveformBg, waveformFg, waveformBuffer, waveBgColor, waveFgColor);
  }
  if (waveformBg && waveformFg) {
    // Redessine si le contraste renforcé change (couleurs différentes) ou si le conteneur change de taille
    // (redimensionnement de fenêtre, ou premier dépli depuis l'état replié).
    document.addEventListener('layerpitch-contrast-changed', redrawWaveforms);
    if (window.ResizeObserver) new ResizeObserver(redrawWaveforms).observe(waveformBg);
  }
  const timeCurrent = wrapper.querySelector('[data-role="timeCurrent"]');
  const timeTotal = wrapper.querySelector('[data-role="timeTotal"]');
  const notchDots = [...wrapper.querySelectorAll('.intensity-chip')];
  const embrLoopBtns = [...wrapper.querySelectorAll('.embr-loop-btn')];
  const stingerBtns = [...wrapper.querySelectorAll('.stinger-btn')];
  const loopCountSelect = wrapper.querySelector('[data-role="loopCountSelect"]');
  const chainLoopCountSelect = wrapper.querySelector('[data-role="chainLoopCountSelect"]');
  // Vertical-random (fusionné avec l'ex-"vertical random séquentiel" le 30/07) : le graphe affiche des
  // "emplacements de voix" génériques (pool-0, pool-1, ...), dimensionnés au plus grand nombre de pools
  // parmi toutes les sections — quand la section en cours en a moins, les emplacements excédentaires sont
  // simplement masqués (même mécanisme que les tirages silencieux déjà existants), plutôt que de
  // reconstruire le graphe en HTML à chaque changement de section.
  const vrMaxPoolCount = isVerticalRandom ? Math.max(0, ...(track.sections || []).map((s, i) => (resolveVRSection(track, i) || {}).pools?.length || 0)) : 0;
  const voiceWavePools = Array.from({ length: vrMaxPoolCount }, (_, pi) => ({
    bg: wrapper.querySelector(`[data-role="voiceWaveBg-${pi}"]`),
    fg: wrapper.querySelector(`[data-role="voiceWaveFg-${pi}"]`)
  }));
  const voiceCurrents = Array.from({ length: vrMaxPoolCount }, (_, pi) => wrapper.querySelector(`[data-role="voiceCurrent-${pi}"]`));
  // Dessine la waveform d'une voix vertical-random (alternative piochée dans un pool) — même principe
  // fond/avant-plan que la waveform du mode statique et les blocs du mode séquentiel.
  function drawVoiceWave(els, buffer) {
    if (!els || !els.bg || !els.fg || !buffer) return;
    renderWaveformPair(els.bg, els.fg, buffer, waveBgColor, waveFgColor);
  }
  // Graphe de nœuds façon Wwise (Voice Graph) pour vertical-random : source -> une voix par emplacement
  // de pool -> bus de sortie, reliés par des connecteurs courbes dessinés en SVG. Le nombre d'emplacements
  // est fixe pour un morceau donné (seul le libellé/l'état de chaque emplacement change selon la section
  // en cours et le tirage), donc les connecteurs ne sont redessinés qu'au premier rendu, au
  // redimensionnement, et quand un emplacement apparaît/disparaît (changement de section).
  const wwiseGraphEl = wrapper.querySelector('[data-role="wwiseGraph"]');
  const wwiseLinesEl = wrapper.querySelector('[data-role="wwiseLines"]');
  const wwiseSourceEl = wrapper.querySelector('[data-role="wwiseSource"]');
  const wwiseBusEl = wrapper.querySelector('[data-role="wwiseBus"]');
  const wwisePoolVoiceEls = Array.from({ length: vrMaxPoolCount }, (_, pi) => wrapper.querySelector(`[data-role="wwiseVoice-pool-${pi}"]`));
  const wwiseVoiceEls = wwisePoolVoiceEls;
  function drawWwiseLines() {
    if (!wwiseGraphEl || !wwiseLinesEl || !wwiseSourceEl || !wwiseBusEl) return;
    const rect = wwiseGraphEl.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    wwiseLinesEl.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    wwiseLinesEl.innerHTML = '';
    const srcRect = wwiseSourceEl.getBoundingClientRect();
    const busRect = wwiseBusEl.getBoundingClientRect();
    const srcPoint = { x: srcRect.right - rect.left, y: srcRect.top + srcRect.height / 2 - rect.top };
    const busPoint = { x: busRect.left - rect.left, y: busRect.top + busRect.height / 2 - rect.top };
    wwiseVoiceEls.forEach(voiceEl => {
      if (!voiceEl || voiceEl.style.display === 'none') return; // voix actuellement silencieuse : pas de connecteur vers du vide
      const vRect = voiceEl.getBoundingClientRect();
      const vLeft = { x: vRect.left - rect.left, y: vRect.top + vRect.height / 2 - rect.top };
      const vRight = { x: vRect.right - rect.left, y: vRect.top + vRect.height / 2 - rect.top };
      const mid1 = (srcPoint.x + vLeft.x) / 2;
      const path1 = document.createElementNS(svgNS, 'path');
      path1.setAttribute('d', `M ${srcPoint.x} ${srcPoint.y} C ${mid1} ${srcPoint.y}, ${mid1} ${vLeft.y}, ${vLeft.x} ${vLeft.y}`);
      path1.setAttribute('class', 'wwise-line');
      wwiseLinesEl.appendChild(path1);
      const mid2 = (vRight.x + busPoint.x) / 2;
      const path2 = document.createElementNS(svgNS, 'path');
      path2.setAttribute('d', `M ${vRight.x} ${vRight.y} C ${mid2} ${vRight.y}, ${mid2} ${busPoint.y}, ${busPoint.x} ${busPoint.y}`);
      path2.setAttribute('class', 'wwise-line');
      wwiseLinesEl.appendChild(path2);
    });
  }
  if (wwiseGraphEl) {
    requestAnimationFrame(drawWwiseLines); // laisse le temps à un premier passage de mise en page
    if (window.ResizeObserver) new ResizeObserver(drawWwiseLines).observe(wwiseGraphEl);
  }
  // Vumètres du mode vertical classique — remplissage en direct sur le vrai gain de chaque couche,
  // visible pendant le fondu enchaîné quand l'intensité change (voir tick() plus bas).
  const vertMeterFills = (track.mode === 'vertical' ? track.layers : []).map((l, i) => wrapper.querySelector(`[data-role="vertMeter-${i}"] .voice-meter-bar-fill`));
  const seqMeterEl = wrapper.querySelector('[data-role="seqMeter"]');
  const seqCurrentEl = wrapper.querySelector('[data-role="seqCurrent"]');
  // Texte affiché par-dessus la description du morceau pendant la lecture séquentielle — mis à jour
  // uniquement quand l'emplacement/transition en cours en déclare un (voir pickStageDescription()) : un
  // champ vide laisse volontairement le texte précédent affiché plutôt que de revenir à la description du
  // morceau (ex. une intro sans texte propre doit laisser voir la description du morceau jusqu'au premier
  // emplacement qui en a un — comportement demandé explicitement le 15/08, obtenu gratuitement par cette
  // règle "ne jamais écraser par du vide" sans cas particulier à coder).
  const trackDescEl = wrapper.querySelector('[data-role="trackDesc"]');
  const seqPendingIndicatorEl = wrapper.querySelector('[data-role="seqPendingIndicator"]');
  // Carte globale des chemins (02/09) -- voir updateSeqMap()/drawSeqMapLines() plus bas.
  // Carte globale des chemins (02/09) : .seq-map-graph est la fenêtre défilable (overflow-x:auto),
  // .seq-map-canvas le contenu dimensionné par JS (voir updateSeqMap()), .seq-map-lines/.seq-map-nodes
  // deux calques superposés à l'intérieur de ce contenu. Positions calculées en JS, sans mesure DOM en
  // mode 'compact' (pas besoin de ResizeObserver, contrairement au graphe Wwise voisin/drawWwiseLines) --
  // MAIS le mode 'roomy' (10/09, pages publiques) mesure bel et bien seqMapGraphEl.clientWidth pour
  // s'adapter à la largeur réelle disponible (voir updateSeqMap()), donc redessiné au redimensionnement
  // comme le graphe Wwise, dans ce mode uniquement -- en 'compact', la taille ne dépend que du nombre
  // d'emplacements, ce ResizeObserver n'aurait rien à faire.
  const seqMapGraphEl = wrapper.querySelector('[data-role="seqMapGraph"]');
  // seqMapLastRoomyWidth : garde-fou contre une boucle de ResizeObserver observée en usage réel (Clarity,
  // 17/09) -- en mode 'roomy', updateSeqMap() dimensionne .seq-map-canvas selon seqMapGraphEl.clientWidth ;
  // si ce canvas devient plus large que l'espace dispo, la barre de défilement horizontale qui apparaît
  // (.seq-map-graph a overflow-x:auto) grignote sa hauteur, ce que la même ResizeObserver détecte aussi
  // (elle observe toute la content-box, pas juste la largeur) et redéclenche updateSeqMap() -- alors même
  // que la largeur, seule dimension qui nous intéresse ici, n'a pas changé. On ne relance donc que si elle
  // a effectivement bougé.
  let seqMapLastRoomyWidth = -1;
  if (seqMapGraphEl && window.ResizeObserver && currentSeqMapDensity() === 'roomy') {
    new ResizeObserver(() => {
      const w = seqMapGraphEl.clientWidth;
      if (w === seqMapLastRoomyWidth) return;
      seqMapLastRoomyWidth = w;
      updateSeqMap(seqMapLastCurrentIdx);
    }).observe(seqMapGraphEl);
  }
  const seqMapCanvasEl = wrapper.querySelector('[data-role="seqMapCanvas"]');
  const seqMapLinesEl = wrapper.querySelector('[data-role="seqMapLines"]');
  const seqMapNodesEl = wrapper.querySelector('[data-role="seqMapNodes"]');
  const goToEndBtn = wrapper.querySelector('[data-role="goToEndBtn"]');
  const goToNextSectionBtn = wrapper.querySelector('[data-role="goToNextSectionBtn"]');
  const sectionCurrentEl = wrapper.querySelector('[data-role="sectionCurrent"]');
  const vrBlockEls = (track.sections || []).map((s, i) => wrapper.querySelector(`[data-role="vrBlock-${i}"]`));
  const vrBlockFillEls = (track.sections || []).map((s, i) => wrapper.querySelector(`[data-role="vrBlockFill-${i}"]`));
  const vrSectionLoopSelectEls = (track.sections || []).map((s, i) => wrapper.querySelector(`[data-role="vrSectionLoop-${i}"]`));
  // Référence live vers les objets réellement lus par sectionScheduler.decideNext() à chaque cycle — les
  // muter en place (voir vrSectionLoopSelectEls ci-dessous) fait donc effet au vol, sans recréer le
  // scheduler ni interrompre la lecture en cours (même principe que track.maxLoops pour le moteur quantifié).
  let vrPlayableSectionRefs = [];

  let buffers = [], sources = [], gains = [], layerFxChains = []; // moteur simple
  let activeGenSources = []; // moteur quantifié : [{src, gain}], toutes générations (dont queues) confondues
