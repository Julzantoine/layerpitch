/* ---------------- Séquentiel hybride (31/10) : la liste des sections du morceau ---------------- */
// Une section n'a pas de fichier à elle : elle désigne un morceau de la bibliothèque (static ou vertical pour commencer). Rien n'est
// recopié, donc le morceau reste modifiable à un seul endroit.
const HYBRID_SECTION_MODES_BS = ['static', 'vertical'];
function hybridSectionTrackIsReady(source) {
  if (!source || !HYBRID_SECTION_MODES_BS.includes(source.mode)) return false;
  const layers = source.layers || [], has = l => !!(l && (l.pendingFile || l.remoteFile));
  return has(layers[0]) && (source.mode === 'static' || layers.every(has));
}
// Frise des points de transition d'une section : une graduation par temps du morceau. Un clic pose un point, un clic sur un point l'enlève.
function hybridPointsTimeline(sec, source, changed) {
  const wrap = document.createElement('div');
  const bpm = (source && source.bpm) || 120, beatsPerBar = (source && source.beatsPerBar) || 4;
  const duration = source && source.duration;
  if (!duration) { wrap.innerHTML = `<div class="hint-inline">${tr('hybridPointsNeedTrack')}</div>`; return wrap; }
  if (!sec.transitionPoints) sec.transitionPoints = [];
  const totalBeats = Math.max(1, Math.floor(duration * bpm / 60));
  wrap.className = 'hybrid-points';
  for (let beat = 0; beat < totalBeats; beat++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    const isBar = beat % beatsPerBar === 0;
    cell.className = 'hybrid-point' + (isBar ? ' is-bar' : '') + (sec.transitionPoints.includes(beat) ? ' is-on' : '');
    cell.dataset.beat = beat;
    cell.title = tr('hybridPointTitle', { bar: Math.floor(beat / beatsPerBar) + 1, beat: beat % beatsPerBar + 1 });
    if (isBar) cell.textContent = Math.floor(beat / beatsPerBar) + 1;
    cell.addEventListener('click', () => {
      const i = sec.transitionPoints.indexOf(beat);
      if (i >= 0) sec.transitionPoints.splice(i, 1); else { sec.transitionPoints.push(beat); sec.transitionPoints.sort((a, b) => a - b); }
      changed();
    });
    wrap.appendChild(cell);
  }
  return wrap;
}
function renderHybridEditor(host, track, ti) {
  if (!track.sections) track.sections = [];
  const eligible = library.filter(l => l.id !== track.id && HYBRID_SECTION_MODES_BS.includes(l.mode));
  host.innerHTML = `
    <label>${tr('descriptionLabel')}</label>
    <textarea data-field="description" data-ti="${ti}">${escapeHtml(track.description || '')}</textarea>
    <div class="hint-inline" style="margin-top:10px">${tr('hybridEditorIntro')}</div>
    <label style="margin-top:14px">${tr('hybridSectionsLabel')}</label>
    ${!eligible.length ? `<div class="hint-inline" style="color:#b45309">${tr('hybridNoEligibleTrack')}</div>` : ''}
    <div data-role="hybridSections"></div>
    <div class="actions"><button class="btn btn-small" type="button" data-role="hybridAdd"${eligible.length ? '' : ' disabled'}>${tr('hybridAddSection')}</button></div>
  `;
  const changed = () => { hasUnsavedEdits = true; renderLibrary(); };
  const list = host.querySelector('[data-role="hybridSections"]');
  track.sections.forEach((sec, si) => {
    const source = library.find(l => l.id === sec.trackId);
    const row = document.createElement('div');
    row.className = 'list-block';
    row.style.marginBottom = '8px';
    const loopValue = sec.maxLoops == null ? '' : String(sec.maxLoops);
    const switchMode = sec.switchMode || 'end';
    const hasTrans = !!(sec.transition && (sec.transition.pendingFile || sec.transition.remoteFile));
    row.innerHTML = `
      <div class="list-block-head">
        <strong>${si + 1}</strong>
        <div style="display:flex;gap:6px">
          <button class="btn btn-small" type="button" data-hybrid="up"${si === 0 ? ' disabled' : ''}>${tr('hybridMoveUp')}</button>
          <button class="btn btn-small" type="button" data-hybrid="down"${si === track.sections.length - 1 ? ' disabled' : ''}>${tr('hybridMoveDown')}</button>
          <button class="btn btn-small btn-danger" type="button" data-hybrid="remove">${tr('hybridRemoveSection')}</button>
        </div>
      </div>
      <label>${tr('hybridSectionTrackLabel')}</label>
      <select data-hybrid="track">
        <option value="">${tr('hybridPickTrack')}</option>
        ${eligible.map(l => `<option value="${escapeAttr(l.id)}"${l.id === sec.trackId ? ' selected' : ''}>${escapeHtml(l.title || tr('untitledFallback'))}</option>`).join('')}
      </select>
      ${sec.trackId && !hybridSectionTrackIsReady(source) ? `<div class="hint-inline" style="color:#b45309">${tr('hybridMissingTrack')}</div>` : ''}
      <label style="margin-top:8px">${tr('hybridSectionNameLabel')}</label>
      <input type="text" data-hybrid="label" value="${escapeAttr(sec.label || '')}" placeholder="${escapeAttr((source && source.title) || '')}">
      <label style="margin-top:8px">${tr('hybridSectionLoopsLabel')}</label>
      <select data-hybrid="loops">
        <option value=""${loopValue === '' ? ' selected' : ''}>${tr('hybridLoopsFromTrack')}</option>
        <option value="0"${loopValue === '0' ? ' selected' : ''}>${tr('hybridLoopsInfinite')}</option>
        ${[1, 2, 3, 5, 10].map(n => `<option value="${n}"${loopValue === String(n) ? ' selected' : ''}>${n}</option>`).join('')}
      </select>
      <label style="margin-top:8px">${tr('hybridSwitchLabel')}</label>
      <select data-hybrid="switch">
        ${[['beat', 'hybridSwitchBeat'], ['bar', 'hybridSwitchBar'], ['point', 'hybridSwitchPoint'], ['end', 'hybridSwitchEnd']].map(([v, k]) => `<option value="${v}"${switchMode === v ? ' selected' : ''}>${tr(k)}</option>`).join('')}
      </select>
      <div class="hint-inline">${tr('hybridSwitchHint')}</div>
      ${switchMode === 'point' ? `
        <label style="margin-top:8px">${tr('hybridPointsLabel')}</label>
        <div data-role="hybridPoints"></div>
        <div class="hint-inline">${tr('hybridPointsHint')}</div>
      ` : ''}
      ${switchMode !== 'end' ? `
        <label style="margin-top:8px">${tr('hybridFadeLabel')}</label>
        <input type="number" step="0.1" min="0" max="10" data-hybrid="fade" value="${sec.fadeSec != null ? sec.fadeSec : 0.5}" style="max-width:120px">
        <div class="hint-inline">${tr('hybridFadeHint')}</div>
      ` : ''}
      ${si < track.sections.length - 1 ? `
        <label style="margin-top:8px">${tr('hybridTransitionLabel')}</label>
        <div data-role="hybridTransFile"></div>
        <div class="hint-inline">${tr('hybridTransitionHint')}</div>
        ${hasTrans ? `
          <label style="margin-top:8px">${tr('hybridTransitionLengthLabel')}</label>
          <select data-hybrid="transBars">
            <option value=""${!sec.transition.bars ? ' selected' : ''}>${tr('hybridTransitionWholeFile')}</option>
            ${[1, 2, 4, 8, 16].map(n => `<option value="${n}"${sec.transition.bars === n ? ' selected' : ''}>${tr('hybridTransitionBars', { n })}</option>`).join('')}
          </select>
        ` : ''}
      ` : ''}
    `;
    const switchSel = row.querySelector('[data-hybrid="switch"]');
    switchSel.addEventListener('change', e => { sec.switchMode = e.target.value; changed(); });
    const fadeInput = row.querySelector('[data-hybrid="fade"]');
    if (fadeInput) fadeInput.addEventListener('input', e => { const v = parseFloat(e.target.value); sec.fadeSec = isNaN(v) ? 0 : Math.max(0, v); hasUnsavedEdits = true; });
    const pointsHost = row.querySelector('[data-role="hybridPoints"]');
    if (pointsHost) pointsHost.appendChild(hybridPointsTimeline(sec, source, changed));
    const transHost = row.querySelector('[data-role="hybridTransFile"]');
    if (transHost) {
      transHost.innerHTML = fileCtrlHtml(tr('chooseWavMp3'), hasTrans ? `<button class="btn btn-small btn-danger" type="button" data-hybrid="transRemove">${tr('hybridTransitionRemove')}</button>` : '');
      wireFileControl(transHost, '.wav,audio/wav,.mp3,audio/mp3,audio/mpeg',
        () => sec.transition && sec.transition.pendingFile, () => sec.transition && sec.transition.remoteFile,
        f => {
          if (!sec.transition) sec.transition = { remoteFile: null, originalFileName: null, pendingFile: null, bars: null };
          if (sec.transition.remoteFile) queueR2Delete(`audio/${track.id}/${sec.transition.remoteFile}`);
          sec.transition.remoteFile = null;
          sec.transition.pendingFile = f;
          changed();
        }, () => sec.transition && sec.transition.originalFileName);
      const removeBtn = transHost.querySelector('[data-hybrid="transRemove"]');
      if (removeBtn) removeBtn.addEventListener('click', () => {
        if (sec.transition.remoteFile) queueR2Delete(`audio/${track.id}/${sec.transition.remoteFile}`);
        sec.transition = null;
        changed();
      });
    }
    const transBars = row.querySelector('[data-hybrid="transBars"]');
    if (transBars) transBars.addEventListener('change', e => { sec.transition.bars = e.target.value ? parseInt(e.target.value, 10) : null; hasUnsavedEdits = true; });
    const swap = (a, b) => { const arr = track.sections; [arr[a], arr[b]] = [arr[b], arr[a]]; changed(); };
    row.querySelector('[data-hybrid="up"]').addEventListener('click', () => swap(si, si - 1));
    row.querySelector('[data-hybrid="down"]').addEventListener('click', () => swap(si, si + 1));
    row.querySelector('[data-hybrid="remove"]').addEventListener('click', () => {
      if (sec.transition && sec.transition.remoteFile) queueR2Delete(`audio/${track.id}/${sec.transition.remoteFile}`);
      track.sections.splice(si, 1);
      changed();
    });
    row.querySelector('[data-hybrid="track"]').addEventListener('change', e => { sec.trackId = e.target.value || null; changed(); });
    row.querySelector('[data-hybrid="label"]').addEventListener('input', e => { sec.label = e.target.value; hasUnsavedEdits = true; });
    row.querySelector('[data-hybrid="loops"]').addEventListener('change', e => { sec.maxLoops = e.target.value === '' ? null : parseInt(e.target.value, 10); hasUnsavedEdits = true; });
    list.appendChild(row);
  });
  host.querySelector('[data-role="hybridAdd"]').addEventListener('click', () => { track.sections.push({ id: genId(), label: '', trackId: null, maxLoops: null }); changed(); });
}

