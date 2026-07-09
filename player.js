(function() {
// player.js — Moteur de lecture partagé entre index.html et pack.html (LayerPitch)
// Un seul endroit pour le rendu des morceaux et toute la logique audio (bouclage simple + quantifié, stingers, intensité).
// Chargé comme script classique (<script src="player.js"></script>) — fonctionne en file:// comme en https://,
// contrairement aux modules ES qui sont bloqués par les navigateurs en ouverture locale directe.

const ctx = new (window.AudioContext || window.webkitAudioContext)();

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}
function cumulativeProfiles(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Array.from({ length: n }, (_, j) => (j <= i ? 1 : 0)));
  return out;
}
function section(label, innerHTML) {
  const el = document.createElement('div');
  el.className = 'block';
  el.innerHTML = (label ? `<div class="section-label">${label}</div>` : '') + innerHTML;
  return el;
}
function escapeHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function linkify(s) { return escapeHtml(s).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>'); }

/* ---------------- État partagé entre toutes les pistes de la page (une seule instance par page chargée) ---------------- */
const trackCollapsers = {};
const trackStingerKillers = {};
let activeTrackId = null;

function renderTracksBlock(container, tracks, packsByTrackId) {
  const el = section('Musique', '');
  container.appendChild(el);
  if (!tracks || tracks.length === 0) {
    el.innerHTML += '<div class="empty">Aucun morceau publié pour l\'instant.</div>';
    return;
  }

  tracks.forEach(track => {
    const packsForTrack = (packsByTrackId && packsByTrackId[track.id]) || [];
    const row = buildTrackRow(track, packsForTrack);
    el.appendChild(row);
    initTrackPlayer(track, row);
  });
}

const MODE_LABELS = {
  static: 'statique',
  vertical: 'layering vertical',
  'vertical-random': 'layering vertical randomisé',
  sequential: 'séquentiel',
  branching: 'embranchement'
};
const PLAYABLE_MODES = ['static', 'vertical', 'vertical-random'];

function layerHasSource(l) { return !!(l && (l.localFile || l.file)); }

function buildTrackRow(track, packsForTrack) {
  packsForTrack = packsForTrack || [];
  const supported = PLAYABLE_MODES.includes(track.mode);
  const isStatic = track.mode === 'static';
  const isVerticalRandom = track.mode === 'vertical-random';
  const loops = !isStatic || !!track.loopable;
  const hasFiles = supported && (isVerticalRandom
    ? (track.fixedLayers || []).some(layerHasSource)
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
        <div class="track-intensity-label">Intensité</div>
        <div class="intensity-picker" data-role="slider">${chips}</div>
      </div>
    `;
  }

  let voiceGraphHtml = '';
  if (isVerticalRandom && supported) {
    const fixedRows = (track.fixedLayers || []).map((f, fi) => `
      <div class="voice-row">
        <span class="voice-meter" data-role="voiceMeter-fixed-${fi}"></span>
        <span class="voice-row-current">${escapeHtml(f && f.label ? f.label : ('Couche fixe ' + (fi + 1)))}</span>
      </div>
    `).join('');
    const groupRows = (track.randomGroups || []).map((g, gi) => `
      <div class="voice-row">
        <span class="voice-meter" data-role="voiceMeter-${gi}"></span>
        <span class="voice-row-current" data-role="voiceCurrent-${gi}">—</span>
      </div>
    `).join('');
    voiceGraphHtml = `
      <div class="voice-graph" data-role="voiceGraph">
        <div class="voice-graph-label">En cours</div>
        ${fixedRows}
        ${groupRows}
        <button type="button" class="voice-refresh-btn" data-role="refreshPool">↻ Rafraîchir le pool</button>
      </div>
    `;
  }

  // Sélecteur de boucles : uniquement pour les pistes qui utilisent le moteur quantifié (seul moteur
  // qui connaît la notion de cycle et donc de "nombre de boucles"). Valeur par défaut = celle choisie
  // par le compositeur, modifiable ici par le visiteur — la piste applique le changement au vol.
  const useQuantizedLoopForUI = isVerticalRandom || (loops && track.loopEngine === 'quantized');
  let loopCountHtml = '';
  if (useQuantizedLoopForUI && supported) {
    const options = [null, 1, 2, 3, 5, 10];
    const current = track.maxLoops || null;
    loopCountHtml = `
      <div class="loop-count-block">
        <div class="loop-count-label">Nombre de boucles</div>
        <select data-role="loopCountSelect">
          ${options.map(n => `<option value="${n === null ? '' : n}"${current === n ? ' selected' : ''}>${n === null ? '∞ Infini' : n}</option>`).join('')}
        </select>
      </div>
    `;
  }

  wrapper.innerHTML = `
    <div class="track-row">
      <button class="play-btn" data-role="playBtn" disabled aria-label="Lecture">
        <svg data-role="playIcon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <div class="track-row-title" data-role="titleToggle">
        <span class="name">${escapeHtml(track.title)}</span>
        <span class="mode-tag">${MODE_LABELS[track.mode] || track.mode}</span>
        ${supported ? `
          <span class="loop-icon" title="${loops ? 'Bouclable' : 'Ne boucle pas'}">
            ${loops
              ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13"/><path d="M13 6l6 6-6 6"/></svg>'}
          </span>
        ` : ''}
      </div>
    </div>
    <div class="track-row-details" data-role="details" style="display:none">
      <div class="track-desc">${linkify(track.description || '')}</div>
      ${packsForTrack && packsForTrack.length ? `<div class="pack-link">${packsForTrack.map(p => `<a href="./pack.html?id=${encodeURIComponent(p.id)}">Fait partie du pack : ${escapeHtml(p.title)}</a>`).join('<br>')}</div>` : ''}
      ${!supported ? `<span class="placeholder-tag">Mode "${track.mode}" pas encore supporté</span>` :
        !hasFiles ? `<span class="placeholder-tag">Fichiers audio manquants</span>` : `
        <div class="status" data-role="status">Chargement…</div>
        <div class="progress-wrap" data-role="progressWrap">
          <div class="progress-track"></div>
          <div class="progress-fill" data-role="progressFill"></div>
          <div class="progress-head" data-role="progressHead"></div>
        </div>
        <div class="time-row"><span data-role="timeCurrent">0:00</span><span data-role="timeTotal">${formatTime(track.duration)}</span></div>
        ${track.stingers && track.stingers.length ? `
          <div class="stingers" data-role="stingers">
            ${track.stingers.map((s, i) => `<button class="stinger-btn" data-stinger="${i}" disabled><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${escapeHtml(s.label || ('Stinger ' + (i + 1)))}</button>`).join('')}
          </div>
        ` : ''}
      `}
      ${intensityBlockHtml}
      ${loopCountHtml}
      ${voiceGraphHtml}
    </div>
  `;

  wrapper.querySelector('[data-role="titleToggle"]').addEventListener('click', () => {
    const details = wrapper.querySelector('[data-role="details"]');
    details.style.display = details.style.display === 'none' ? 'block' : 'none';
  });

  return wrapper;
}

function initTrackPlayer(track, wrapper) {
  const isStatic = track.mode === 'static';
  const isVerticalRandom = track.mode === 'vertical-random';
  const supported = PLAYABLE_MODES.includes(track.mode);
  const hasFiles = supported && (isVerticalRandom
    ? (track.fixedLayers || []).some(layerHasSource)
    : layerHasSource(track.layers[0]) && (isStatic || track.layers.every(layerHasSource)));
  if (!hasFiles) return;

  const layersToLoad = isVerticalRandom ? [] : (isStatic ? [track.layers[0]] : track.layers);
  const profiles = isVerticalRandom ? [] : (isStatic ? [[1]] : cumulativeProfiles(track.layers.length));
  const loops = !isStatic || !!track.loopable; // toujours vrai pour vertical-random (isStatic est faux)
  const useQuantizedLoop = isVerticalRandom || (loops && track.loopEngine === 'quantized');
  const stingerDefs = track.stingers ? track.stingers.filter(s => s.file || s.localFile) : [];

  // Paramètres du moteur quantifié (BPM/mesures + queue de fin superposée) — ignorés si useQuantizedLoop est faux
  const bpm = track.bpm || 120;
  const beatsPerBar = track.beatsPerBar || 4;
  const secondsPerBeat = 60 / bpm;
  const loopInSec = (track.loopInBeat || 0) * secondsPerBeat;
  const loopOutSec = Math.max(loopInSec + secondsPerBeat, (track.loopOutBeat || beatsPerBar * 4) * secondsPerBeat);
  const cycleLength = loopOutSec - loopInSec;
  // StartTrackPoint : où démarre la toute première lecture (permet de sauter un silence en tête).
  // Ne s'applique qu'au moteur quantifié — le moteur simple garde son comportement natif inchangé.
  const startTrackSec = Math.min((track.startTrackBeat || 0) * secondsPerBeat, loopInSec);

  const playBtn = wrapper.querySelector('[data-role="playBtn"]');
  const playIcon = wrapper.querySelector('[data-role="playIcon"]');
  const details = wrapper.querySelector('[data-role="details"]');
  const statusEl = wrapper.querySelector('[data-role="status"]');
  const wrap = wrapper.querySelector('[data-role="progressWrap"]');
  const fill = wrapper.querySelector('[data-role="progressFill"]');
  const head = wrapper.querySelector('[data-role="progressHead"]');
  const timeCurrent = wrapper.querySelector('[data-role="timeCurrent"]');
  const timeTotal = wrapper.querySelector('[data-role="timeTotal"]');
  const notchDots = [...wrapper.querySelectorAll('.intensity-chip')];
  const stingerBtns = [...wrapper.querySelectorAll('.stinger-btn')];
  const loopCountSelect = wrapper.querySelector('[data-role="loopCountSelect"]');
  const voiceMeterFixeds = (track.fixedLayers || []).map((f, fi) => wrapper.querySelector(`[data-role="voiceMeter-fixed-${fi}"]`));
  const voiceMeters = (track.randomGroups || []).map((g, gi) => wrapper.querySelector(`[data-role="voiceMeter-${gi}"]`));
  const voiceCurrents = (track.randomGroups || []).map((g, gi) => wrapper.querySelector(`[data-role="voiceCurrent-${gi}"]`));

  let buffers = [], sources = [], gains = []; // moteur simple
  let activeGenSources = []; // moteur quantifié : [{src, gain}], toutes générations (dont queues) confondues
  let currentGainNodes = []; // moteur quantifié : gains de la génération la plus récente, par couche (contrôle d'intensité en direct)
  let schedulerTimer = null;
  let voiceGraphTimeouts = [];
  let nextGenStartCtxTime = 0, nextGenBufferOffset = 0;
  // Historique des générations programmées : { ctxStartTime, bufferOffset }. Sert à retrouver la position
  // RÉELLEMENT audible à un instant donné (voir currentPlaybackOffset ci-dessous) — pas simplement "la dernière
  // programmée", qui à cause du lookahead scheduler (jusqu'à 1s d'avance) peut encore être dans le futur au
  // moment où on la lit, ce qui donnait une tête de lecture visuellement en avance sur le son.
  let scheduledGens = [];
  function currentPlaybackOffset() {
    let chosen = null;
    for (const g of scheduledGens) {
      if (g.ctxStartTime <= ctx.currentTime && (!chosen || g.ctxStartTime > chosen.ctxStartTime)) chosen = g;
    }
    if (!chosen) return 0;
    return Math.min(chosen.bufferOffset + (ctx.currentTime - chosen.ctxStartTime), track.duration);
  }
  // Nombre de boucles (moteur quantifié) : loopsPlayed compte les passages programmés par le scheduler
  // récurrent (pas le tout premier, déclenché directement par playQuantized). Une fois track.maxLoops
  // atteint (si non nul), on arrête de programmer de nouvelles générations et on laisse la dernière
  // en cours filer seule jusqu'à sa fin naturelle (l'outro = la queue déjà présente dans le fichier).
  let loopsPlayed = 0;
  let lastGenSources = [];
  let finalGenerationMarkerSrc = null;

  // Spécifique au mode vertical-random
  let fixedBuffers = []; // une entrée par couche fixe déclarée (toutes jouent systématiquement, à chaque cycle)
  let groupBuffers = [];    // groupBuffers[g] = [buffer, buffer, ...] pour chaque alternative jouable du groupe g
  let lastPickedIndex = []; // lastPickedIndex[g] = index de la dernière alternative tirée pour le groupe g (-1 si aucune encore)
  function pickAlternativeIndex(g) {
    const group = (track.randomGroups || [])[g];
    const bufs = groupBuffers[g] || [];
    const n = bufs.length;
    if (n === 0) return -1;
    let idx = Math.floor(Math.random() * n);
    if (group && group.avoidImmediateRepeat && n > 1) {
      while (idx === lastPickedIndex[g]) idx = Math.floor(Math.random() * n);
    }
    lastPickedIndex[g] = idx;
    return idx;
  }

  let stingerBuffers = [];
  let activeStingerSources = [];
  let level = 0, playing = false, startedAt = 0, offsetAt = (useQuantizedLoop ? startTrackSec : 0), rafId = null, ready = false;

  const PLAY_SVG = '<path d="M8 5v14l11-7z"/>';
  const PAUSE_SVG = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';

  function updateStingerAvailability() {
    const expanded = details.style.display !== 'none';
    setStingerButtonsEnabled(expanded && ready);
  }

  function setStingerButtonsEnabled(enabled) {
    stingerBtns.forEach(b => { b.disabled = !enabled; });
  }
  function killStingers() {
    activeStingerSources.forEach(s => { try { s.stop(); } catch(e){} });
    activeStingerSources = [];
  }
  trackCollapsers[track.id] = () => { details.style.display = 'none'; updateStingerAvailability(); };
  trackStingerKillers[track.id] = killStingers;

  function updateProgressAt(elapsed) {
    if (!wrap) return;
    const pct = (elapsed / track.duration) * 100;
    fill.style.width = pct + '%'; head.style.left = pct + '%';
    timeCurrent.textContent = formatTime(elapsed);
  }
  function tick() {
    if (!playing) return;
    const elapsed = useQuantizedLoop
      ? currentPlaybackOffset()
      : (loops ? (ctx.currentTime - startedAt) % track.duration : Math.min(ctx.currentTime - startedAt, track.duration));
    updateProgressAt(elapsed);
    rafId = requestAnimationFrame(tick);
  }
  function setStoppedUI() {
    playIcon.innerHTML = PLAY_SVG;
    if (statusEl) statusEl.textContent = 'En pause';
  }

  /* ---- Moteur simple (bouclage natif, comportement existant inchangé) ---- */
  function stopSimple(keepPosition) {
    if (loops && keepPosition !== false) {
      offsetAt = (ctx.currentTime - startedAt) % track.duration;
    }
    sources.forEach(s => { if (s) { try { s.stop(); } catch(e){} } });
    sources = []; gains = [];
  }
  function playSimple() {
    startedAt = ctx.currentTime - offsetAt;
    const p = profiles[level] || profiles[0];
    for (let i = 0; i < buffers.length; i++) {
      const src = ctx.createBufferSource();
      src.buffer = buffers[i];
      if (loops) { src.loop = true; src.loopStart = 0; src.loopEnd = track.duration; }
      const g = ctx.createGain();
      g.gain.setValueAtTime(p[i] || 0, ctx.currentTime);
      src.connect(g); g.connect(ctx.destination);
      src.start(0, offsetAt % track.duration);
      sources[i] = src; gains[i] = g;
      if (isStatic && !loops) {
        const layerIndex = i;
        src.onended = () => {
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
  function scheduleVoiceGraphUpdate(ctxStartTime, groupPicks) {
    const delayMs = Math.max(0, (ctxStartTime - ctx.currentTime) * 1000);
    const timeoutId = setTimeout(() => {
      voiceMeterFixeds.forEach(pulseMeter);
      groupPicks.forEach(({ gi, label }) => {
        pulseMeter(voiceMeters[gi]);
        if (voiceCurrents[gi]) voiceCurrents[gi].textContent = label;
      });
    }, delayMs);
    voiceGraphTimeouts.push(timeoutId);
  }

  /* ---- Moteur quantifié / vertical-random (BPM + mesures, retrigger avec queue de fin superposée) ---- */
  function scheduleGeneration(ctxStartTime, bufferOffset, reroll) {
    const thisGenSources = [];
    if (isVerticalRandom) {
      fixedBuffers.forEach(buf => {
        if (!buf) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.setValueAtTime(1, ctxStartTime);
        src.connect(g); g.connect(ctx.destination);
        src.start(ctxStartTime, bufferOffset);
        activeGenSources.push({ src, gain: g });
        thisGenSources.push(src);
      });
      const groupPicks = [];
      (track.randomGroups || []).forEach((group, gi) => {
        const idx = (reroll === false && lastPickedIndex[gi] !== undefined && lastPickedIndex[gi] !== -1)
          ? lastPickedIndex[gi]
          : pickAlternativeIndex(gi);
        let label = '—';
        if (idx >= 0) {
          const alt = (group.alternatives || [])[idx];
          const buf = (groupBuffers[gi] || [])[idx];
          label = buf ? ((alt && alt.label) ? alt.label : 'Alt. ' + (idx + 1)) : '(silence)';
          if (buf) {
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const g = ctx.createGain();
            g.gain.setValueAtTime(1, ctxStartTime);
            src.connect(g); g.connect(ctx.destination);
            src.start(ctxStartTime, bufferOffset);
            activeGenSources.push({ src, gain: g });
            thisGenSources.push(src);
          }
        }
        groupPicks.push({ gi, label });
      });
      scheduleVoiceGraphUpdate(ctxStartTime, groupPicks);
    } else {
      const p = profiles[level] || profiles[0];
      const gensThisRound = [];
      for (let i = 0; i < buffers.length; i++) {
        if (!buffers[i]) continue;
        const src = ctx.createBufferSource();
        src.buffer = buffers[i];
        const g = ctx.createGain();
        g.gain.setValueAtTime(p[i] || 0, ctxStartTime);
        src.connect(g); g.connect(ctx.destination);
        src.start(ctxStartTime, bufferOffset);
        activeGenSources.push({ src, gain: g });
        thisGenSources.push(src);
        gensThisRound[i] = g;
      }
      currentGainNodes = gensThisRound;
    }
    lastGenSources = thisGenSources;
    scheduledGens.push({ ctxStartTime, bufferOffset });
    const cutoff = ctx.currentTime - Math.max(cycleLength, 4) * 2;
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
      scheduleGeneration(nextGenStartCtxTime, nextGenBufferOffset, true);
      loopsPlayed++;
      nextGenStartCtxTime += cycleLength;
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
    marker.onended = () => {
      if (finalGenerationMarkerSrc !== marker) return; // piste arrêtée/relancée entretemps : on ignore
      activeGenSources = [];
      playing = false;
      cancelAnimationFrame(rafId);
      offsetAt = startTrackSec;
      updateProgressAt(offsetAt);
      setStoppedUI();
      if (activeTrackId === track.id) activeTrackId = null;
    };
  }
  function stopQuantized() {
    finalGenerationMarkerSrc = null;
    if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch(e){} });
    activeGenSources = [];
    voiceGraphTimeouts.forEach(id => clearTimeout(id));
    voiceGraphTimeouts = [];
    if (isVerticalRandom) {
      voiceMeterFixeds.forEach(el => { if (el) el.classList.remove("pulse"); });
      voiceMeters.forEach(el => { if (el) el.classList.remove('pulse'); });
      voiceCurrents.forEach(el => { if (el) el.textContent = '—'; });
    }
  }
  function playQuantized(fromOffsetSec, reroll) {
    stopQuantized();
    const now = ctx.currentTime;
    scheduleGeneration(now, fromOffsetSec, reroll);
    let timeUntilNext;
    if (fromOffsetSec < loopInSec) {
      timeUntilNext = loopOutSec - fromOffsetSec;
    } else {
      const positionInLoop = (fromOffsetSec - loopInSec) % cycleLength;
      timeUntilNext = cycleLength - positionInLoop;
    }
    nextGenStartCtxTime = now + Math.max(0.02, timeUntilNext);
    nextGenBufferOffset = loopInSec;
    schedulerTimer = setInterval(schedulerTick, 200);
  }

  function stopAllSources(keepPosition) {
    playing = false;
    if (useQuantizedLoop) {
      if (keepPosition !== false) {
        offsetAt = currentPlaybackOffset();
      }
      stopQuantized();
    } else {
      stopSimple(keepPosition);
    }
    cancelAnimationFrame(rafId);
    setStoppedUI();
  }
  function naturalEnd() {
    playing = false;
    cancelAnimationFrame(rafId);
    offsetAt = 0;
    updateProgressAt(0);
    setStoppedUI();
    if (activeTrackId === track.id) activeTrackId = null;
  }
  function playThisTrack(reroll, isContinuation) {
    if (activeTrackId && activeTrackId !== track.id) {
      document.dispatchEvent(new CustomEvent('stop-track', { detail: activeTrackId }));
      if (trackStingerKillers[activeTrackId]) trackStingerKillers[activeTrackId]();
    }
    Object.keys(trackCollapsers).forEach(id => {
      if (id !== track.id) trackCollapsers[id]();
    });
    activeTrackId = track.id;
    details.style.display = 'block';
    updateStingerAvailability();
    if (ctx.state === 'suspended') ctx.resume();
    playing = true;
    if (useQuantizedLoop) {
      // Un vrai démarrage à froid réinitialise le budget de boucles (le premier passage compte déjà comme 1) ;
      // un reroll ou une recherche en cours de lecture (isContinuation) ne remet pas le compteur à zéro et ne l'avance pas non plus.
      // Note : on ne peut pas déduire ça de `playing`, qui est déjà retombé à false par le stopAllSources(false)
      // que ces deux appelants font juste avant — d'où ce paramètre explicite plutôt qu'une lecture d'état ambiant.
      if (!isContinuation) loopsPlayed = 1;
      playQuantized(offsetAt % track.duration, reroll !== false);
    } else {
      playSimple();
    }
    playIcon.innerHTML = PAUSE_SVG;
    if (statusEl) statusEl.textContent = 'Lecture en cours';
    tick();
  }

  function rerollPool() {
    if (!isVerticalRandom) return;
    if (playing) {
      const currentOffset = currentPlaybackOffset();
      stopAllSources(false);
      offsetAt = currentOffset;
      playThisTrack(true, true);
    } else {
      lastPickedIndex = lastPickedIndex.map(() => -1);
    }
  }

  const titleToggle = wrapper.querySelector('[data-role="titleToggle"]');
  if (titleToggle) titleToggle.addEventListener('click', updateStingerAvailability);
  const refreshPoolBtn = wrapper.querySelector('[data-role="refreshPool"]');
  if (refreshPoolBtn) refreshPoolBtn.addEventListener('click', rerollPool);

  document.addEventListener('stop-track', (e) => { if (e.detail === track.id) stopAllSources(); });
  playBtn.addEventListener('click', () => { playing ? stopAllSources() : playThisTrack(true); });

  if (wrap) {
    wrap.addEventListener('click', (e) => {
      const rect = wrap.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const seekTo = pct * track.duration;
      if (playing) { stopAllSources(false); offsetAt = seekTo; playThisTrack(false, true); }
      else { offsetAt = seekTo; updateProgressAt(offsetAt); }
    });
  }

  notchDots.forEach(dot => {
    dot.addEventListener('click', () => {
      level = parseInt(dot.dataset.level, 10);
      notchDots.forEach(d => d.classList.toggle('active', d === dot));
      if (!playing) return;
      const p = profiles[level];
      const now = ctx.currentTime;
      const gainsToRamp = useQuantizedLoop ? currentGainNodes : gains;
      gainsToRamp.forEach((g, i) => {
        if (!g) return;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(p[i] || 0, now + 1.4);
      });
    });
  });

  stingerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const idx = parseInt(btn.dataset.stinger, 10);
      const buf = stingerBuffers[idx];
      if (!buf) return;
      if (ctx.state === 'suspended') ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(1, ctx.currentTime);
      src.connect(g); g.connect(ctx.destination);
      src.start(0);
      activeStingerSources.push(src);
      src.onended = () => { activeStingerSources = activeStingerSources.filter(s => s !== src); };
    });
  });

  if (loopCountSelect) {
    loopCountSelect.addEventListener('change', () => {
      // Mutation directe de l'objet track lu par schedulerTick à chaque cycle — s'applique donc au vol,
      // y compris en cours de lecture, sans avoir à relancer la piste.
      track.maxLoops = loopCountSelect.value === '' ? null : parseInt(loopCountSelect.value, 10);
    });
  }

  async function loadArrayBuffer(item) {
    if (item.localFile) return await item.localFile.arrayBuffer();
    const res = await fetch(track.base + encodeURIComponent(item.file));
    return await res.arrayBuffer();
  }

  (async () => {
    let loaded = 0;
    let total;
    if (isVerticalRandom) {
      const rawGroups = track.randomGroups || [];
      const rawFixed = (track.fixedLayers || []).filter(layerHasSource);
      total = rawFixed.length + rawGroups.reduce((n, g) => n + (g.alternatives || []).filter(layerHasSource).length, 0) + stingerDefs.length;
      fixedBuffers = new Array(rawFixed.length).fill(null);
      for (let fi = 0; fi < rawFixed.length; fi++) {
        try {
          const ab = await loadArrayBuffer(rawFixed[fi]);
          fixedBuffers[fi] = await ctx.decodeAudioData(ab);
          loaded++;
          if (statusEl) statusEl.textContent = `Chargement… ${loaded}/${total}`;
        } catch (e) { /* une couche fixe manquante ne bloque pas les autres */ }
      }
      if (fixedBuffers.every(b => !b)) { if (statusEl) statusEl.textContent = 'Erreur de chargement (aucune couche fixe)'; return; }
      for (let gi = 0; gi < rawGroups.length; gi++) {
        const alts = rawGroups[gi].alternatives || [];
        // Même longueur que les alternatives déclarées, y compris les slots vides (intentionnels : ils restent
        // un choix possible du tirage, avec pour effet un cycle silencieux pour ce groupe — pas un fichier à charger).
        groupBuffers[gi] = new Array(alts.length).fill(null);
        lastPickedIndex[gi] = -1;
        for (let ai = 0; ai < alts.length; ai++) {
          if (!layerHasSource(alts[ai])) continue;
          try {
            const ab = await loadArrayBuffer(alts[ai]);
            groupBuffers[gi][ai] = await ctx.decodeAudioData(ab);
            loaded++;
            if (statusEl) statusEl.textContent = `Chargement… ${loaded}/${total}`;
          } catch (e) { /* fichier manquant : ce tirage restera silencieux plutôt que de bloquer la lecture */ }
        }
      }
    } else {
      total = layersToLoad.length + stingerDefs.length;
      for (let i = 0; i < layersToLoad.length; i++) {
        try {
          const ab = await loadArrayBuffer(layersToLoad[i]);
          buffers[i] = await ctx.decodeAudioData(ab);
          loaded++;
          if (statusEl) statusEl.textContent = `Chargement… ${loaded}/${total}`;
        } catch (e) { if (statusEl) statusEl.textContent = 'Erreur de chargement'; return; }
      }
    }
    for (let i = 0; i < stingerDefs.length; i++) {
      try {
        const ab = await loadArrayBuffer(stingerDefs[i]);
        stingerBuffers[i] = await ctx.decodeAudioData(ab);
        loaded++;
        if (statusEl) statusEl.textContent = `Chargement… ${loaded}/${total}`;
      } catch (e) { /* un stinger manquant ne bloque pas la lecture principale */ }
    }
    // Pour une source locale non encore publiée, la durée réelle n'est connue qu'une fois décodée.
    const allMainBuffers = isVerticalRandom
      ? [...fixedBuffers, ...groupBuffers.flat()].filter(Boolean)
      : buffers.filter(Boolean);
    const decodedMax = Math.max(0, ...allMainBuffers.map(b => b.duration), ...stingerBuffers.filter(Boolean).map(b => b.duration));
    if (decodedMax > (track.duration || 0)) {
      track.duration = decodedMax;
      if (timeTotal) timeTotal.textContent = formatTime(track.duration);
    }
    if (statusEl) statusEl.textContent = 'Prêt';
    playBtn.disabled = false;
    ready = true;
    updateStingerAvailability();
  })();
}

/* ---------------- Init ---------------- */



window.LayerPlayerCore = {
  formatTime,
  cumulativeProfiles,
  section,
  escapeHtml,
  linkify,
  layerHasSource,
  buildTrackRow,
  initTrackPlayer,
  renderTracksBlock,
  MODE_LABELS,
  PLAYABLE_MODES
};

})();
