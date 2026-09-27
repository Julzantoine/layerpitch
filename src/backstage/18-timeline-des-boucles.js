/* ---------------- Timeline des points de boucle ---------------- */
// Remplace les anciens champs texte (point d'entrée/sortie en mesures ou temps) par une timeline
// visuelle : graduations de mesures/temps + 3 repères glissables (Départ / Entrée boucle / Sortie
// boucle), aimantés au temps le plus proche. Pas de waveform décodée — uniquement duration/BPM,
// déjà présents dans le schéma.
// timingOwner : objet possédant bpm/beatsPerBar/duration/startTrackBeat/loopInBeat/loopOutBeat — le morceau
// lui-même pour les modes qui n'ont qu'une seule zone de tempo (séquentiel quantifié, boucle simple/quantifiée),
// ou une section pour le mode vertical-random (chaque section a désormais sa propre timeline, comme un vrai
// segment Wwise indépendant — cf. discussion du 30/07).
function buildLoopTimelineEl(timingOwner, ti, cardEl) {
  const wrap = document.createElement('div');
  wrap.className = 'loop-timeline';

  const bpm = timingOwner.bpm || 120;
  const beatsPerBar = timingOwner.beatsPerBar || 4;
  const spb = 60 / bpm;
  const duration = timingOwner.duration || 0;

  if (!duration) {
    wrap.innerHTML = `<div class="loop-timeline-placeholder">${tr('chooseFileFirstHint')}</div>`;
    return wrap;
  }

  const totalBeats = Math.max(1, Math.round(duration / spb));
  let startTrackBeat = Math.max(0, Math.min(timingOwner.startTrackBeat || 0, totalBeats));
  let loopInBeat = Math.max(0, Math.min(timingOwner.loopInBeat || 0, totalBeats));
  let loopOutBeat = Math.max(0, Math.min(timingOwner.loopOutBeat || totalBeats, totalBeats));

  const ruler = document.createElement('div');
  ruler.className = 'loop-timeline-ruler';
  wrap.appendChild(ruler);

  const legend = document.createElement('div');
  legend.className = 'loop-timeline-legend';
  legend.innerHTML = `
    <span><i style="background:repeating-linear-gradient(45deg, rgba(0,0,0,0.25), rgba(0,0,0,0.25) 2px, transparent 2px, transparent 4px)"></i>${tr('skippedLegend')}</span>
    <span><i style="background:rgba(0,0,0,0.18)"></i>${tr('introOnceLegend')}</span>
    <span><i style="background:rgba(47,128,192,0.5)"></i>${tr('loopLegend')}</span>
    <span><i style="background:rgba(181,121,15,0.5)"></i>${tr('tailOutroLegend')}</span>
  `;
  wrap.appendChild(legend);

  const summary = document.createElement('div');
  summary.className = 'hint-inline';
  summary.style.marginTop = '4px';
  wrap.appendChild(summary);

  function beatToPct(b) { return (b / totalBeats) * 100; }
  function pctToBeat(pct) { return Math.round((pct / 100) * totalBeats); }
  function formatBeat(b) {
    const bar = Math.floor(b / beatsPerBar) + 1;
    const beatInBar = (b % beatsPerBar) + 1;
    return tr('measureBeatFormat', { bar, beat: beatInBar });
  }

  function addHandle(kind, beat, label) {
    const h = document.createElement('div');
    h.className = 'loop-timeline-handle ' + kind;
    h.style.left = beatToPct(beat) + '%';
    const flag = document.createElement('div');
    flag.className = 'loop-timeline-handle-flag';
    flag.textContent = label;
    h.appendChild(flag);
    ruler.appendChild(h);

    h.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      try { h.setPointerCapture(e.pointerId); } catch (err) {}
      const rect = ruler.getBoundingClientRect();
      const onMove = (ev) => {
        const pct = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
        let beatVal = pctToBeat(pct);
        if (kind === 'start') beatVal = Math.max(0, Math.min(beatVal, loopInBeat));
        else if (kind === 'loopin') beatVal = Math.max(startTrackBeat, Math.min(beatVal, loopOutBeat));
        else if (kind === 'loopout') beatVal = Math.max(loopInBeat, Math.min(beatVal, totalBeats));
        h.style.left = beatToPct(beatVal) + '%';
        flag.textContent = formatBeat(beatVal);
        h.dataset.pendingBeat = beatVal;
      };
      const onUp = () => {
        ruler.removeEventListener('pointermove', onMove);
        ruler.removeEventListener('pointerup', onUp);
        const finalBeat = h.dataset.pendingBeat !== undefined ? parseInt(h.dataset.pendingBeat, 10) : beat;
        if (kind === 'start') timingOwner.startTrackBeat = finalBeat;
        else if (kind === 'loopin') timingOwner.loopInBeat = finalBeat;
        else if (kind === 'loopout') timingOwner.loopOutBeat = finalBeat;
        hasUnsavedEdits = true;
        renderLibrary();
        if (blockTracksRefresh) blockTracksRefresh();
        packTracksRefreshers.forEach(fn => fn());
      };
      ruler.addEventListener('pointermove', onMove);
      ruler.addEventListener('pointerup', onUp);
    });
  }

  // Graduations : un trait fin par temps, un trait marqué par mesure, un chiffre de mesure
  // (densité réduite automatiquement si le morceau est long, pour rester lisible).
  const labelEvery = totalBeats > 64 ? beatsPerBar * 4 : (totalBeats > 32 ? beatsPerBar * 2 : beatsPerBar);
  for (let b = 0; b <= totalBeats; b++) {
    const isBar = b % beatsPerBar === 0;
    const tick = document.createElement('div');
    tick.className = 'loop-timeline-tick' + (isBar ? ' bar' : '');
    tick.style.left = beatToPct(b) + '%';
    tick.style.height = isBar ? '100%' : '40%';
    ruler.appendChild(tick);
    if (isBar && b % labelEvery === 0) {
      const lbl = document.createElement('div');
      lbl.className = 'loop-timeline-tick-label';
      lbl.style.left = beatToPct(b) + '%';
      lbl.textContent = (b / beatsPerBar) + 1;
      ruler.appendChild(lbl);
    }
  }

  // Zones ombrées
  const zSkipped = document.createElement('div');
  zSkipped.className = 'loop-timeline-zone skipped';
  zSkipped.style.left = '0%'; zSkipped.style.width = beatToPct(startTrackBeat) + '%';
  ruler.appendChild(zSkipped);

  const zIntro = document.createElement('div');
  zIntro.className = 'loop-timeline-zone intro';
  zIntro.style.left = beatToPct(startTrackBeat) + '%'; zIntro.style.width = (beatToPct(loopInBeat) - beatToPct(startTrackBeat)) + '%';
  ruler.appendChild(zIntro);

  const zLoop = document.createElement('div');
  zLoop.className = 'loop-timeline-zone loop';
  zLoop.style.left = beatToPct(loopInBeat) + '%'; zLoop.style.width = (beatToPct(loopOutBeat) - beatToPct(loopInBeat)) + '%';
  ruler.appendChild(zLoop);

  const zOutro = document.createElement('div');
  zOutro.className = 'loop-timeline-zone outro';
  zOutro.style.left = beatToPct(loopOutBeat) + '%'; zOutro.style.width = (100 - beatToPct(loopOutBeat)) + '%';
  ruler.appendChild(zOutro);

  addHandle('start', startTrackBeat, tr('startHandleLabel'));
  addHandle('loopin', loopInBeat, tr('entryHandleLabel'));
  addHandle('loopout', loopOutBeat, tr('exitHandleLabel'));

  summary.textContent = tr('loopSummaryFormat', { duration: ((loopOutBeat - loopInBeat) * spb).toFixed(2), start: (loopInBeat * spb).toFixed(2), end: (loopOutBeat * spb).toFixed(2) });

  // Clic ailleurs sur la timeline (pas sur un repère) : déplace aussi le curseur du lecteur "Écouter"
  // s'il est ouvert, pour vérifier le placement à l'oreille plutôt qu'à l'œil. Simule un clic sur la
  // barre de progression existante (.progress-wrap) — confirmé fonctionnel (player.js n'écoute qu'un
  // simple 'click' dessus).
  ruler.addEventListener('click', e => {
    if (e.target.closest('.loop-timeline-handle')) return;
    e.stopPropagation();
    const rect = ruler.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const timeSec = (pct / 100) * duration;
    seekOpenPreview(cardEl, timeSec, duration);
  });

  return wrap;
}

function seekOpenPreview(cardEl, timeSec, totalDuration) {
  if (!cardEl) return;
  const host = cardEl.querySelector('[data-role="previewHost"]');
  if (!host || host.dataset.active !== '1') return;
  const bar = host.querySelector('.progress-wrap');
  if (!bar || !totalDuration) return;
  const rect = bar.getBoundingClientRect();
  const clientX = rect.left + (timeSec / totalDuration) * rect.width;
  const clientY = rect.top + rect.height / 2;
  ['mousedown', 'mouseup', 'click'].forEach(type => {
    bar.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY }));
  });
}

