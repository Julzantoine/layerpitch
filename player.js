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
const PLAYABLE_MODES = ['static', 'vertical', 'vertical-random', 'sequential'];

function layerHasSource(l) { return !!(l && (l.localFile || l.file)); }

function buildTrackRow(track, packsForTrack) {
  packsForTrack = packsForTrack || [];
  const supported = PLAYABLE_MODES.includes(track.mode);
  const isStatic = track.mode === 'static';
  const isVerticalRandom = track.mode === 'vertical-random';
  const isSequential = track.mode === 'sequential';
  const loops = !isStatic || !!track.loopable;
  const hasFiles = supported && (isVerticalRandom
    ? (track.fixedLayers || []).some(layerHasSource)
    : isSequential
    ? (track.segments || []).some(layerHasSource)
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

  let seqGraphHtml = '';
  if (isSequential && supported) {
    const hasIntro = layerHasSource(track.intro);
    const hasOutro = layerHasSource(track.outro);
    seqGraphHtml = `
      <div class="voice-graph" data-role="seqGraph">
        <div class="voice-graph-label">En cours</div>
        <div class="seq-blocks" data-role="seqBlocks">
          ${hasIntro ? `<div class="seq-block" data-role="seqBlock-intro"><div class="seq-block-fill" data-role="seqFill-intro"></div><span class="seq-block-label">Intro</span></div>` : ''}
          <div class="seq-block" data-role="seqBlock-segment"><div class="seq-block-fill" data-role="seqFill-segment"></div><span class="seq-block-label">Segment</span></div>
          ${hasOutro ? `<div class="seq-block" data-role="seqBlock-outro"><div class="seq-block-fill" data-role="seqFill-outro"></div><span class="seq-block-label">Outro</span></div>` : ''}
        </div>
        <div class="voice-row">
          <span class="voice-meter" data-role="seqMeter"></span>
          <span class="voice-row-current" data-role="seqCurrent">—</span>
        </div>
        <button type="button" class="voice-refresh-btn" data-role="goToEndBtn" disabled>Aller vers la fin →</button>
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
    <div class="track-row-details" data-role="details">
     <div class="track-row-details-inner">
      <div class="track-desc">${linkify(track.description || '')}</div>
      ${packsForTrack && packsForTrack.length ? `<div class="pack-link">${packsForTrack.map(p => `<a href="./pack.html?id=${encodeURIComponent(p.id)}">Fait partie du pack : ${escapeHtml(p.title)}</a>`).join('<br>')}</div>` : ''}
      ${!supported ? `<span class="placeholder-tag">Mode "${track.mode}" pas encore supporté</span>` :
        !hasFiles ? `<span class="placeholder-tag">Fichiers audio manquants</span>` : (
        isSequential ? `
          <div class="status" data-role="status">Chargement…</div>
          ${track.stingers && track.stingers.length ? `
            <div class="stingers" data-role="stingers">
              ${track.stingers.map((s, i) => `<button class="stinger-btn" data-stinger="${i}" disabled><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${escapeHtml(s.label || ('Stinger ' + (i + 1)))}</button>`).join('')}
            </div>
          ` : ''}
        ` : `
        <div class="status" data-role="status">Chargement…</div>
        <div class="progress-wrap${isStatic ? ' waveform-mode' : ''}" data-role="progressWrap">
          ${isStatic ? `
            <canvas class="waveform-bg" data-role="waveformBg"></canvas>
            <canvas class="waveform-fg" data-role="waveformFg"></canvas>
          ` : `
            <div class="progress-track"></div>
            <div class="progress-fill" data-role="progressFill"></div>
            <div class="progress-head" data-role="progressHead"></div>
          `}
        </div>
        <div class="time-row"><span data-role="timeCurrent">0:00</span><span data-role="timeTotal">${formatTime(track.duration)}</span></div>
        ${track.stingers && track.stingers.length ? `
          <div class="stingers" data-role="stingers">
            ${track.stingers.map((s, i) => `<button class="stinger-btn" data-stinger="${i}" disabled><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${escapeHtml(s.label || ('Stinger ' + (i + 1)))}</button>`).join('')}
          </div>
        ` : ''}
      `)}
      ${intensityBlockHtml}
      ${loopCountHtml}
      ${voiceGraphHtml}
      ${seqGraphHtml}
     </div>
    </div>
  `;

  wrapper.querySelector('[data-role="titleToggle"]').addEventListener('click', () => {
    const details = wrapper.querySelector('[data-role="details"]');
    details.classList.toggle('expanded');
  });

  return wrapper;
}

function initTrackPlayer(track, wrapper) {
  const isStatic = track.mode === 'static';
  const isVerticalRandom = track.mode === 'vertical-random';
  const isSequential = track.mode === 'sequential';
  const supported = PLAYABLE_MODES.includes(track.mode);
  const hasFiles = supported && (isVerticalRandom
    ? (track.fixedLayers || []).some(layerHasSource)
    : isSequential
    ? (track.segments || []).some(layerHasSource)
    : layerHasSource(track.layers[0]) && (isStatic || track.layers.every(layerHasSource)));
  if (!hasFiles) return;

  const layersToLoad = (isVerticalRandom || isSequential) ? [] : (isStatic ? [track.layers[0]] : track.layers);
  const profiles = (isVerticalRandom || isSequential) ? [] : (isStatic ? [[1]] : cumulativeProfiles(track.layers.length));
  const loops = !isStatic || !!track.loopable; // toujours vrai pour vertical-random (isStatic est faux)
  const useQuantizedLoop = !isSequential && (isVerticalRandom || (loops && track.loopEngine === 'quantized'));
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
  // Waveform (mode statique uniquement — une seule couche jouée à la fois, donc "la" forme d'onde du
  // morceau a un sens ; ambigu pour vertical/vertical-random où plusieurs couches sonnent ensemble).
  const waveformBg = wrapper.querySelector('[data-role="waveformBg"]');
  const waveformFg = wrapper.querySelector('[data-role="waveformFg"]');
  let waveformPeaks = null;
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function computeWaveformPeaks(buffer, bucketCount) {
    const data = buffer.getChannelData(0); // un seul canal suffit pour une représentation visuelle
    const samplesPerBucket = Math.max(1, Math.floor(data.length / bucketCount));
    const peaks = new Array(bucketCount).fill(0);
    for (let i = 0; i < bucketCount; i++) {
      let max = 0;
      const start = i * samplesPerBucket;
      const end = Math.min(start + samplesPerBucket, data.length);
      for (let j = start; j < end; j++) {
        const v = Math.abs(data[j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    return peaks;
  }
  function drawWaveformCanvas(canvas, peaks, color) {
    if (!canvas || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (w < 2 || h < 2) return; // pas encore mis en page (ex. onglet caché) : on retentera au prochain redraw
    canvas.width = w; canvas.height = h;
    const c2d = canvas.getContext('2d');
    c2d.clearRect(0, 0, w, h);
    c2d.fillStyle = color;
    const barCount = peaks.length;
    const slot = w / barCount;
    const barWidth = Math.max(1, slot - Math.max(1, Math.round(dpr)));
    const mid = h / 2;
    for (let i = 0; i < barCount; i++) {
      const amp = Math.max(0.04, peaks[i]); // hauteur minimale visible même sur un silence
      const barH = Math.max(2 * dpr, amp * h);
      c2d.fillRect(i * slot, mid - barH / 2, barWidth, barH);
    }
  }
  function redrawWaveforms() {
    drawWaveformCanvas(waveformBg, waveformPeaks, cssVar('--border', '#ccc'));
    drawWaveformCanvas(waveformFg, waveformPeaks, cssVar('--accent', '#c9713c'));
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
  const stingerBtns = [...wrapper.querySelectorAll('.stinger-btn')];
  const loopCountSelect = wrapper.querySelector('[data-role="loopCountSelect"]');
  const voiceMeterFixeds = (track.fixedLayers || []).map((f, fi) => wrapper.querySelector(`[data-role="voiceMeter-fixed-${fi}"]`));
  const voiceMeters = (track.randomGroups || []).map((g, gi) => wrapper.querySelector(`[data-role="voiceMeter-${gi}"]`));
  const voiceCurrents = (track.randomGroups || []).map((g, gi) => wrapper.querySelector(`[data-role="voiceCurrent-${gi}"]`));
  const seqMeterEl = wrapper.querySelector('[data-role="seqMeter"]');
  const seqCurrentEl = wrapper.querySelector('[data-role="seqCurrent"]');
  const goToEndBtn = wrapper.querySelector('[data-role="goToEndBtn"]');

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
  let rawFixedLayers = []; // couches fixes réellement chargées (avec fichier), même indexation que fixedBuffers — sert à retrouver le bon gain de correction par index dans scheduleGeneration
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

  // Spécifique au mode séquentiel
  let introBuffer = null, outroBuffer = null;
  let segmentBuffers = []; // aligné sur track.segments
  let lastSegmentIndex = -1;
  let seqSchedulerTimer = null;
  let seqNextStartCtxTime = 0;
  let seqActiveSources = []; // {src, gain} toutes générations confondues (dont queues en train de finir)
  let seqLastGenSources = [];
  let seqFinalMarkerSrc = null;
  let seqTimeouts = [];
  let goToEndRequested = false;
  function blockSeconds(bars) { return (bars || beatsPerBar) * beatsPerBar * secondsPerBeat; }
  function pickSegmentIndex() {
    const validIdxs = segmentBuffers.map((b, i) => b ? i : -1).filter(i => i >= 0);
    if (validIdxs.length === 0) return -1;
    let idx = validIdxs[Math.floor(Math.random() * validIdxs.length)];
    if (track.avoidImmediateRepeat && validIdxs.length > 1) {
      while (idx === lastSegmentIndex) idx = validIdxs[Math.floor(Math.random() * validIdxs.length)];
    }
    lastSegmentIndex = idx;
    return idx;
  }
  // Visualisation en blocs (intro / segment en cours / outro), qui se remplissent au rythme de la lecture —
  // demande directe d'un retour compositeur : "montrer un bloc pour le cue de départ qui se remplit en jouant,
  // puis un bloc pour la boucle tirée au sort, puis un bloc pour le cue de fin".
  const seqBlockEls = {
    intro: wrapper.querySelector('[data-role="seqBlock-intro"]'),
    segment: wrapper.querySelector('[data-role="seqBlock-segment"]'),
    outro: wrapper.querySelector('[data-role="seqBlock-outro"]')
  };
  const seqFillEls = {
    intro: wrapper.querySelector('[data-role="seqFill-intro"]'),
    segment: wrapper.querySelector('[data-role="seqFill-segment"]'),
    outro: wrapper.querySelector('[data-role="seqFill-outro"]')
  };
  function activateSeqStage(kind, durationSec) {
    const order = ['intro', 'segment', 'outro'];
    const idx = order.indexOf(kind);
    // Tout ce qui précède ce stade (hors "segment", qui se remplit à nouveau à chaque tirage plutôt que
    // de passer "fait") est figé plein — reflète la lecture qui vient réellement de passer ce point.
    order.forEach((k, i) => {
      if (i >= idx || k === 'segment') return;
      const block = seqBlockEls[k], fill = seqFillEls[k];
      if (!block || !fill) return;
      block.classList.remove('active'); block.classList.add('done');
      fill.style.transition = 'none'; fill.style.width = '100%';
    });
    const block = seqBlockEls[kind], fill = seqFillEls[kind];
    if (block && fill) {
      block.classList.remove('done'); block.classList.add('active');
      fill.style.transition = 'none'; fill.style.width = '0%';
      void fill.offsetWidth; // force le reflow avant de relancer la transition, sinon le navigateur la fusionne avec le reset ci-dessus
      if (durationSec > 0) { fill.style.transition = `width ${durationSec}s linear`; fill.style.width = '100%'; }
    }
    // Le passage à l'outro clôt définitivement le stade "segment" (plus de nouveau tirage à suivre).
    if (kind === 'outro' && seqBlockEls.segment && seqFillEls.segment) {
      seqBlockEls.segment.classList.remove('active'); seqBlockEls.segment.classList.add('done');
      seqFillEls.segment.style.transition = 'none'; seqFillEls.segment.style.width = '100%';
    }
  }
  function resetSeqStages() {
    Object.keys(seqBlockEls).forEach(k => {
      const block = seqBlockEls[k], fill = seqFillEls[k];
      if (block) block.classList.remove('active', 'done');
      if (fill) { fill.style.transition = 'none'; fill.style.width = '0%'; }
    });
  }
  function scheduleSeqLabelUpdate(ctxStartTime, label, kind, fillDurationSec) {
    const delayMs = Math.max(0, (ctxStartTime - ctx.currentTime) * 1000);
    const id = setTimeout(() => {
      pulseMeter(seqMeterEl);
      if (seqCurrentEl) seqCurrentEl.textContent = label;
      if (kind) activateSeqStage(kind, fillDurationSec);
    }, delayMs);
    seqTimeouts.push(id);
  }
  function scheduleSeqGeneration(ctxStartTime, buffer, label, kind, fillDurationSec, gainValue) {
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainValue != null ? gainValue : 1, ctxStartTime);
    src.connect(g); g.connect(ctx.destination);
    src.start(ctxStartTime, 0);
    seqActiveSources.push({ src, gain: g });
    seqLastGenSources = [src];
    // Sans durée explicite (cas de l'outro, qui ne programme rien après elle) : on anime le remplissage
    // sur la durée réelle du fichier décodé, seule longueur connue dans ce cas.
    scheduleSeqLabelUpdate(ctxStartTime, label, kind, (fillDurationSec != null) ? fillDurationSec : buffer.duration);
  }
  // Détermine le prochain bloc à programmer : soit l'outro (si "Aller vers la fin" a été demandé et
  // qu'une outro existe), soit rien du tout (demande faite mais pas d'outro : on laisse filer), soit
  // un segment tiré au sort. `terminal: true` signifie "rien à programmer après ce bloc".
  function decideNextSeqBlock() {
    if (goToEndRequested) {
      goToEndRequested = false;
      if (outroBuffer) return { buffer: outroBuffer, label: (track.outro && track.outro.label) || 'Outro', durationSec: null, terminal: true, kind: 'outro', gain: (track.outro && track.outro.gain) || 1 };
      return null;
    }
    const idx = pickSegmentIndex();
    if (idx < 0) return null;
    const seg = track.segments[idx];
    return { buffer: segmentBuffers[idx], label: (seg && seg.label) || ('Segment ' + (idx + 1)), durationSec: blockSeconds(seg && seg.bars), terminal: false, kind: 'segment', gain: (seg && seg.gain) || 1 };
  }
  function armSeqFinalEnd() {
    const marker = seqLastGenSources[0];
    if (!marker) return;
    seqFinalMarkerSrc = marker;
    marker.onended = () => {
      if (seqFinalMarkerSrc !== marker) return; // piste arrêtée/relancée entretemps : on ignore
      seqActiveSources = [];
      playing = false;
      setStoppedUI();
      if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = 'Aller vers la fin →'; }
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
      scheduleSeqGeneration(seqNextStartCtxTime, next.buffer, next.label, next.kind, next.terminal ? null : next.durationSec, next.gain);
      if (next.terminal) {
        clearInterval(seqSchedulerTimer); seqSchedulerTimer = null;
        armSeqFinalEnd();
        return;
      }
      seqNextStartCtxTime += next.durationSec;
    }
  }
  function stopSequential() {
    seqFinalMarkerSrc = null;
    if (seqSchedulerTimer) { clearInterval(seqSchedulerTimer); seqSchedulerTimer = null; }
    seqActiveSources.forEach(({ src }) => { try { src.stop(); } catch(e){} });
    seqActiveSources = [];
    seqTimeouts.forEach(id => clearTimeout(id));
    seqTimeouts = [];
    goToEndRequested = false;
    if (seqMeterEl) seqMeterEl.classList.remove('pulse');
    if (seqCurrentEl) seqCurrentEl.textContent = '—';
    if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = 'Aller vers la fin →'; }
    resetSeqStages();
  }
  function playSequential(isContinuation) {
    stopSequential();
    const now = ctx.currentTime;
    let firstBuffer, firstLabel, firstDurationSec, firstKind, firstGain;
    if (!isContinuation && introBuffer) {
      firstBuffer = introBuffer; firstLabel = (track.intro && track.intro.label) || 'Intro'; firstDurationSec = blockSeconds(track.intro && track.intro.bars); firstKind = 'intro'; firstGain = (track.intro && track.intro.gain) || 1;
    } else {
      const idx = pickSegmentIndex();
      if (idx < 0) { if (statusEl) statusEl.textContent = 'Aucun segment disponible'; return; }
      const seg = track.segments[idx];
      firstBuffer = segmentBuffers[idx]; firstLabel = (seg && seg.label) || ('Segment ' + (idx + 1)); firstDurationSec = blockSeconds(seg && seg.bars); firstKind = 'segment'; firstGain = (seg && seg.gain) || 1;
    }
    scheduleSeqGeneration(now, firstBuffer, firstLabel, firstKind, firstDurationSec, firstGain);
    seqNextStartCtxTime = now + firstDurationSec;
    seqSchedulerTimer = setInterval(seqSchedulerTick, 200);
    if (goToEndBtn) goToEndBtn.disabled = false;
  }
  let level = 0, playing = false, startedAt = 0, offsetAt = (useQuantizedLoop ? startTrackSec : 0), rafId = null, ready = false;

  const PLAY_SVG = '<path d="M8 5v14l11-7z"/>';
  const PAUSE_SVG = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';

  function updateStingerAvailability() {
    const expanded = details.classList.contains('expanded');
    setStingerButtonsEnabled(expanded && ready);
  }

  function setStingerButtonsEnabled(enabled) {
    stingerBtns.forEach(b => { b.disabled = !enabled; });
  }
  function killStingers() {
    activeStingerSources.forEach(s => { try { s.stop(); } catch(e){} });
    activeStingerSources = [];
  }
  trackCollapsers[track.id] = () => { details.classList.remove('expanded'); updateStingerAvailability(); };
  trackStingerKillers[track.id] = killStingers;

  function updateProgressAt(elapsed) {
    if (!wrap) return;
    const pct = (elapsed / track.duration) * 100;
    if (fill) fill.style.width = pct + '%';
    if (head) head.style.left = pct + '%';
    if (waveformFg) waveformFg.style.clipPath = `inset(0 ${Math.max(0, 100 - pct)}% 0 0)`;
    timeCurrent.textContent = formatTime(elapsed);
  }
  function tick() {
    if (!playing || isSequential) return;
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
      g.gain.setValueAtTime((p[i] || 0) * ((layersToLoad[i] && layersToLoad[i].gain) || 1), ctx.currentTime);
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
      fixedBuffers.forEach((buf, fi) => {
        if (!buf) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.setValueAtTime((rawFixedLayers[fi] && rawFixedLayers[fi].gain) || 1, ctxStartTime);
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
            g.gain.setValueAtTime((alt && alt.gain) || 1, ctxStartTime);
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
        g.gain.setValueAtTime((p[i] || 0) * ((layersToLoad[i] && layersToLoad[i].gain) || 1), ctxStartTime);
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
    if (isSequential) {
      stopSequential();
    } else if (useQuantizedLoop) {
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
    details.classList.add('expanded');
    updateStingerAvailability();
    if (ctx.state === 'suspended') ctx.resume();
    playing = true;
    if (isSequential) {
      playSequential(isContinuation);
    } else if (useQuantizedLoop) {
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
  if (goToEndBtn) {
    goToEndBtn.addEventListener('click', () => {
      if (!playing || goToEndRequested) return;
      goToEndRequested = true;
      goToEndBtn.disabled = true;
      goToEndBtn.textContent = track.outro ? 'Fin en cours…' : 'Dernier segment…';
    });
  }

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
        const layerGain = (layersToLoad[i] && layersToLoad[i].gain) || 1;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime((p[i] || 0) * layerGain, now + 1.4);
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
      g.gain.setValueAtTime((stingerDefs[idx] && stingerDefs[idx].gain) || 1, ctx.currentTime);
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
      rawFixedLayers = rawFixed;
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
    } else if (isSequential) {
      const hasIntro = layerHasSource(track.intro);
      const hasOutro = layerHasSource(track.outro);
      const segs = (track.segments || []).filter(layerHasSource);
      total = (hasIntro ? 1 : 0) + (hasOutro ? 1 : 0) + segs.length + stingerDefs.length;
      segmentBuffers = new Array((track.segments || []).length).fill(null);
      if (hasIntro) {
        try {
          const ab = await loadArrayBuffer(track.intro);
          introBuffer = await ctx.decodeAudioData(ab);
          loaded++;
          if (statusEl) statusEl.textContent = `Chargement… ${loaded}/${total}`;
        } catch (e) { /* intro manquante : la lecture démarrera directement sur un segment */ }
      }
      if (hasOutro) {
        try {
          const ab = await loadArrayBuffer(track.outro);
          outroBuffer = await ctx.decodeAudioData(ab);
          loaded++;
          if (statusEl) statusEl.textContent = `Chargement… ${loaded}/${total}`;
        } catch (e) { /* outro manquante : "Aller vers la fin" laissera simplement filer le segment en cours */ }
      }
      for (let sgi = 0; sgi < (track.segments || []).length; sgi++) {
        if (!layerHasSource(track.segments[sgi])) continue;
        try {
          const ab = await loadArrayBuffer(track.segments[sgi]);
          segmentBuffers[sgi] = await ctx.decodeAudioData(ab);
          loaded++;
          if (statusEl) statusEl.textContent = `Chargement… ${loaded}/${total}`;
        } catch (e) { /* segment manquant : simplement absent du tirage, ne bloque pas le reste */ }
      }
      if (segmentBuffers.every(b => !b)) { if (statusEl) statusEl.textContent = 'Erreur de chargement (aucun segment)'; return; }
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
      if (isStatic && buffers[0] && waveformBg) {
        waveformPeaks = computeWaveformPeaks(buffers[0], 200);
        redrawWaveforms();
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
      : isSequential
      ? [introBuffer, outroBuffer, ...segmentBuffers].filter(Boolean)
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



/* ---------------- Accessibilité : contraste renforcé ---------------- */
// Case à cocher côté visiteur (mémorisée sur ce navigateur via localStorage) qui remplace les couleurs
// personnalisées (celles de l'AdReel ou du pack) par une palette à fort contraste, lisible quel que
// soit le choix esthétique du compositeur. Purement client, aucune dépendance backend.
const HIGH_CONTRAST_VARS = {
  '--bg': '#ffffff', '--bg-card': '#ffffff', '--text': '#000000',
  '--text-dim': '#1a1a1a', '--text-dimmer': '#3a3a3a', '--border': '#000000',
  '--accent': '#a3390f', '--accent-soft': '#f4d9cb'
};
function setupContrastToggle(toggleId, customBg, customText) {
  const toggle = document.getElementById(toggleId);
  if (!toggle) return;
  const root = document.documentElement;
  function apply(on) {
    if (on) {
      Object.keys(HIGH_CONTRAST_VARS).forEach(key => root.style.setProperty(key, HIGH_CONTRAST_VARS[key]));
    } else {
      Object.keys(HIGH_CONTRAST_VARS).forEach(key => root.style.removeProperty(key));
      if (customBg) root.style.setProperty('--bg', customBg);
      if (customText) root.style.setProperty('--text', customText);
    }
    document.body.classList.toggle('high-contrast', on);
    document.dispatchEvent(new CustomEvent('layerpitch-contrast-changed'));
  }
  let saved = false;
  try { saved = localStorage.getItem('layerpitch-high-contrast') === '1'; } catch (e) {}
  toggle.checked = saved;
  apply(saved);
  toggle.addEventListener('change', () => {
    apply(toggle.checked);
    try { localStorage.setItem('layerpitch-high-contrast', toggle.checked ? '1' : '0'); } catch (e) {}
  });
}

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
  setupContrastToggle,
  MODE_LABELS,
  PLAYABLE_MODES
};

})();
