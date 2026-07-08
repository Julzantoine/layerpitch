// player.js — Moteur de lecture partagé entre index.html et pack.html (LayerPitch)
// Un seul endroit pour le rendu des morceaux et toute la logique audio (bouclage simple + quantifié, stingers, intensité).
// Chargé comme module ES natif (<script type="module">) — pas de build nécessaire, GitHub Pages le sert tel quel.

const ctx = new (window.AudioContext || window.webkitAudioContext)();

export function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}
export function cumulativeProfiles(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Array.from({ length: n }, (_, j) => (j <= i ? 1 : 0)));
  return out;
}
export function section(label, innerHTML) {
  const el = document.createElement('div');
  el.className = 'block';
  el.innerHTML = (label ? `<div class="section-label">${label}</div>` : '') + innerHTML;
  return el;
}
export function escapeHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function linkify(s) { return escapeHtml(s).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>'); }

/* ---------------- État partagé entre toutes les pistes de la page (une seule instance par page chargée) ---------------- */
const trackCollapsers = {};
const trackStingerKillers = {};
let activeTrackId = null;

export function renderTracksBlock(container, tracks, packsByTrackId) {
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

export const MODE_LABELS = {
  static: 'statique',
  vertical: 'layering vertical',
  'vertical-random': 'layering vertical randomisé',
  sequential: 'séquentiel',
  branching: 'embranchement'
};
export const PLAYABLE_MODES = ['static', 'vertical'];

export function buildTrackRow(track, packsForTrack) {
  packsForTrack = packsForTrack || [];
  const supported = PLAYABLE_MODES.includes(track.mode);
  const isStatic = track.mode === 'static';
  const hasFiles = supported && track.base && track.layers[0] && track.layers[0].file &&
    (isStatic || track.layers.every(l => l.file));

  const wrapper = document.createElement('div');
  wrapper.className = 'track-row-wrapper';

  let intensityBlockHtml = '';
  if (!isStatic && supported) {
    const n = track.layers.length;
    const chips = Array.from({ length: n }, (_, i) => {
      const label = (track.layers[i] && track.layers[i].label) ? track.layers[i].label : String(i + 1);
      return `<button type="button" class="intensity-chip${i === 0 ? ' active' : ''}" data-level="${i}">${escapeHtml(label)}</button>`;
    }).join('');
    intensityBlockHtml = `
      <div class="track-intensity-block">
        <div class="track-intensity-label">Intensité</div>
        <div class="intensity-picker" data-role="slider">${chips}</div>
      </div>
    `;
  }

  wrapper.innerHTML = `
    <div class="track-row">
      <button class="play-btn" data-role="playBtn" ${hasFiles ? '' : 'disabled'} aria-label="Lecture">
        <svg data-role="playIcon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <div class="track-row-title" data-role="titleToggle">
        <span class="name">${escapeHtml(track.title)}</span>
        <span class="mode-tag">${MODE_LABELS[track.mode] || track.mode}</span>
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
        <div class="time-row"><span data-role="timeCurrent">0:00</span><span>${formatTime(track.duration)}</span></div>
        ${track.stingers && track.stingers.length ? `
          <div class="stingers" data-role="stingers">
            ${track.stingers.map((s, i) => `<button class="stinger-btn" data-stinger="${i}" disabled><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${escapeHtml(s.label || ('Stinger ' + (i + 1)))}</button>`).join('')}
          </div>
        ` : ''}
      `}
      ${intensityBlockHtml}
    </div>
  `;

  wrapper.querySelector('[data-role="titleToggle"]').addEventListener('click', () => {
    const details = wrapper.querySelector('[data-role="details"]');
    details.style.display = details.style.display === 'none' ? 'block' : 'none';
  });

  return wrapper;
}

export function initTrackPlayer(track, wrapper) {
  const isStatic = track.mode === 'static';
  const supported = PLAYABLE_MODES.includes(track.mode);
  const hasFiles = supported && track.base && track.layers[0] && track.layers[0].file &&
    (isStatic || track.layers.every(l => l.file));
  if (!hasFiles) return;

  const layersToLoad = isStatic ? [track.layers[0]] : track.layers;
  const profiles = isStatic ? [[1]] : cumulativeProfiles(track.layers.length);
  const loops = !isStatic || !!track.loopable;
  const useQuantizedLoop = loops && track.loopEngine === 'quantized';
  const stingerDefs = track.stingers ? track.stingers.filter(s => s.file) : [];

  // Paramètres du moteur quantifié (BPM/mesures + queue de fin superposée) — ignorés si useQuantizedLoop est faux
  const bpm = track.bpm || 120;
  const beatsPerBar = track.beatsPerBar || 4;
  const secondsPerBeat = 60 / bpm;
  const loopInSec = (track.loopInBeat || 0) * secondsPerBeat;
  const loopOutSec = Math.max(loopInSec + secondsPerBeat, (track.loopOutBeat || beatsPerBar * 4) * secondsPerBeat);
  const cycleLength = loopOutSec - loopInSec;

  const playBtn = wrapper.querySelector('[data-role="playBtn"]');
  const playIcon = wrapper.querySelector('[data-role="playIcon"]');
  const details = wrapper.querySelector('[data-role="details"]');
  const statusEl = wrapper.querySelector('[data-role="status"]');
  const wrap = wrapper.querySelector('[data-role="progressWrap"]');
  const fill = wrapper.querySelector('[data-role="progressFill"]');
  const head = wrapper.querySelector('[data-role="progressHead"]');
  const timeCurrent = wrapper.querySelector('[data-role="timeCurrent"]');
  const notchDots = [...wrapper.querySelectorAll('.intensity-chip')];
  const stingerBtns = [...wrapper.querySelectorAll('.stinger-btn')];

  let buffers = [], sources = [], gains = []; // moteur simple
  let activeGenSources = []; // moteur quantifié : [{src, gain}], toutes générations (dont queues) confondues
  let currentGainNodes = []; // moteur quantifié : gains de la génération la plus récente, par couche (contrôle d'intensité en direct)
  let schedulerTimer = null;
  let latestGenStartCtxTime = 0, latestGenBufferOffset = 0, nextGenStartCtxTime = 0, nextGenBufferOffset = 0;

  let stingerBuffers = [];
  let activeStingerSources = [];
  let level = 0, playing = false, startedAt = 0, offsetAt = 0, rafId = null, ready = false;

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
      ? Math.min(latestGenBufferOffset + (ctx.currentTime - latestGenStartCtxTime), track.duration)
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

  /* ---- Moteur quantifié (BPM + mesures, retrigger avec queue de fin superposée) ---- */
  function scheduleGeneration(ctxStartTime, bufferOffset) {
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
      gensThisRound[i] = g;
    }
    currentGainNodes = gensThisRound;
    latestGenStartCtxTime = ctxStartTime;
    latestGenBufferOffset = bufferOffset;
  }
  function schedulerTick() {
    const lookahead = 1.0;
    while (nextGenStartCtxTime < ctx.currentTime + lookahead) {
      scheduleGeneration(nextGenStartCtxTime, nextGenBufferOffset);
      nextGenStartCtxTime += cycleLength;
      nextGenBufferOffset = loopInSec;
    }
  }
  function stopQuantized() {
    if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch(e){} });
    activeGenSources = [];
  }
  function playQuantized(fromOffsetSec) {
    stopQuantized();
    const now = ctx.currentTime;
    scheduleGeneration(now, fromOffsetSec);
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
        offsetAt = Math.min(latestGenBufferOffset + (ctx.currentTime - latestGenStartCtxTime), track.duration);
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
  function playThisTrack() {
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
      playQuantized(offsetAt % track.duration);
    } else {
      playSimple();
    }
    playIcon.innerHTML = PAUSE_SVG;
    if (statusEl) statusEl.textContent = 'Lecture en cours';
    tick();
  }

  const titleToggle = wrapper.querySelector('[data-role="titleToggle"]');
  if (titleToggle) titleToggle.addEventListener('click', updateStingerAvailability);

  document.addEventListener('stop-track', (e) => { if (e.detail === track.id) stopAllSources(); });
  playBtn.addEventListener('click', () => { playing ? stopAllSources() : playThisTrack(); });

  if (wrap) {
    wrap.addEventListener('click', (e) => {
      const rect = wrap.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const seekTo = pct * track.duration;
      if (playing) { stopAllSources(false); offsetAt = seekTo; playThisTrack(); }
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

  (async () => {
    let loaded = 0;
    const total = layersToLoad.length + stingerDefs.length;
    for (let i = 0; i < layersToLoad.length; i++) {
      try {
        const res = await fetch(track.base + encodeURIComponent(layersToLoad[i].file));
        const ab = await res.arrayBuffer();
        buffers[i] = await ctx.decodeAudioData(ab);
        loaded++;
        if (statusEl) statusEl.textContent = `Chargement… ${loaded}/${total}`;
      } catch (e) { if (statusEl) statusEl.textContent = 'Erreur de chargement'; return; }
    }
    for (let i = 0; i < stingerDefs.length; i++) {
      try {
        const res = await fetch(track.base + encodeURIComponent(stingerDefs[i].file));
        const ab = await res.arrayBuffer();
        stingerBuffers[i] = await ctx.decodeAudioData(ab);
        loaded++;
        if (statusEl) statusEl.textContent = `Chargement… ${loaded}/${total}`;
      } catch (e) { /* un stinger manquant ne bloque pas la lecture principale */ }
    }
    if (statusEl) statusEl.textContent = 'Prêt';
    playBtn.disabled = false;
    ready = true;
    updateStingerAvailability();
  })();
}

/* ---------------- Init ---------------- */
