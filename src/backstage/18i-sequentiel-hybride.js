/* ---------------- Séquentiel hybride (31/10) : la liste des sections du morceau ---------------- */
// Une section n'a pas de fichier à elle : elle désigne un morceau de la bibliothèque (static ou vertical pour commencer). Rien n'est
// recopié, donc le morceau reste modifiable à un seul endroit.
const HYBRID_SECTION_MODES_BS = ['static', 'vertical', 'sequential', 'vertical-random', 'embranchement-vertical'];
function hybridSectionTrackIsReady(source) {
  if (!source || !HYBRID_SECTION_MODES_BS.includes(source.mode)) return false;
  const has = l => !!(l && (l.pendingFile || l.remoteFile));
  if (source.mode === 'sequential') return (source.segmentSlots || []).some(sl => (sl.alternatives || []).some(has));
  if (source.mode === 'vertical-random') return (source.sections || []).some(sec => (sec.pools || []).some(p => (p.alternatives || []).some(has)) || sec.referencesSectionId);
  if (source.mode === 'embranchement-vertical') return (source.loops || []).some(has);
  const layers = source.layers || [];
  return has(layers[0]) && (source.mode === 'static' || layers.every(has));
}
// Le morceau commence-t-il par une partie jouée une seule fois avant sa boucle (départ avant l'entrée de boucle, ou fichier d'intro) ?
function hybridSectionHasIntro(source) {
  if (!source) return false;
  if (source.mode === 'sequential' || source.mode === 'vertical-random') return !!(source.intro && (source.intro.pendingFile || source.intro.remoteFile));
  if (source.mode === 'embranchement-vertical') {
    const ref = (source.loops || []).find(l => l.isInitial) || (source.loops || [])[0] || {};
    return (ref.loopInBeat || 0) > (ref.startTrackBeat || 0);
  }
  return source.loopEngine === 'quantized' && (source.loopInBeat || 0) > (source.startTrackBeat || 0);
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
// Embranchements d'une section (comme le séquentiel) : le visiteur choisit où aller ; chaque chemin a son moment de passage et peut
// avoir son propre fichier de transition.
function renderHybridBranches(host, track, sec, si, hasOneTimeline, changed) {
  if (!sec.branches) sec.branches = [];
  const targets = track.sections.filter(o => o !== sec);
  const targetName = (o, n) => o.label || ((library.find(l => l.id === o.trackId) || {}).title) || tr('sectionFallback', { n: n + 1 });
  // Une cible déjà prise par un autre embranchement de cette section n'est plus proposée (sauf à lui-même).
  const takenBy = self => new Set(sec.branches.filter(o => o !== self).map(o => o.targetId).filter(Boolean));
  const targetOptions = (cur, self) => `<option value="">${tr('hybridBranchPickTarget')}</option>`
    + targets.filter(o => !takenBy(self).has(o.id)).map(o => `<option value="${escapeAttr(o.id)}"${cur === o.id ? ' selected' : ''}>${escapeHtml(targetName(o, track.sections.indexOf(o)))}</option>`).join('')
    + (takenBy(self).has('end') ? '' : `<option value="end"${cur === 'end' ? ' selected' : ''}>${tr('hybridBranchEnd')}</option>`)
    + `<option value="__new">${tr('hybridBranchNewSection')}</option>`;
  // Le réflexe est de créer l'embranchement avant la section où il mène : on crée alors cette section, vide, juste après.
  const newTargetSection = () => {
    const created = { id: genId(), label: '', trackId: null, maxLoops: null };
    track.sections.push(created);
    return created.id;
  };
  host.className = 'hybrid-branches-editor';
  host.innerHTML = `
    <div class="hybrid-branches-title">↳ ${escapeHtml(tr('hybridBranchesOf', { name: targetName(sec, si) }))}</div>
    <div class="hint-inline">${tr('hybridBranchesHint')}</div>
    <div data-role="branchList"></div>
    <div class="actions"><button class="btn btn-small" type="button" data-hybrid="addBranch">${tr('hybridAddBranch')}</button></div>
    ${sec.branches.length ? `
      <label style="margin-top:8px">${tr('hybridDefaultNextLabel')}</label>
      <select data-hybrid="defaultNext">
        <option value=""${!sec.defaultNext ? ' selected' : ''}>${tr('hybridDefaultWait')}</option>
        ${targets.map(o => `<option value="${escapeAttr(o.id)}"${sec.defaultNext === o.id ? ' selected' : ''}>${escapeHtml(tr('hybridDefaultGoTo', { name: targetName(o, track.sections.indexOf(o)) }))}</option>`).join('')}
        <option value="end"${sec.defaultNext === 'end' ? ' selected' : ''}>${tr('hybridBranchEnd')}</option>
      </select>
      <div class="hint-inline">${tr('hybridDefaultNextHint')}</div>
    ` : ''}
  `;
  const list = host.querySelector('[data-role="branchList"]');
  const targetWithoutTrack = b => { const o = track.sections.find(x => x.id === b.targetId); return o && !o.trackId ? o : null; };
  sec.branches.forEach((b, bi) => {
    const card = document.createElement('div');
    card.className = 'list-block';
    card.style.margin = '6px 0';
    const hasTrans = !!(b.transition && (b.transition.pendingFile || b.transition.remoteFile));
    const mode = !hasOneTimeline ? 'end' : (b.switchMode || 'end');
    card.innerHTML = `
      <div class="list-block-head">
        <select data-branch="target" style="flex:1;margin-right:8px">${targetOptions(b.targetId, b)}</select>
        <button class="btn btn-small btn-danger" type="button" data-branch="remove">${tr('hybridRemoveSection')}</button>
      </div>
      <label style="margin-top:6px">${tr('hybridBranchLabelLabel')}</label>
      <input type="text" data-branch="label" value="${escapeAttr(b.label || '')}" placeholder="${escapeAttr(tr('hybridBranchLabelPlaceholder'))}">
      <label style="margin-top:6px">${tr('hybridBranchSwitchLabel')}</label>
      <select data-branch="switch">
        <option value="end"${mode === 'end' ? ' selected' : ''}>${tr('hybridSwitchEnd')}</option>
        ${hasOneTimeline ? `<option value="point"${mode === 'point' ? ' selected' : ''}>${tr('hybridSwitchPoint')}</option>` : ''}
      </select>
      ${targetWithoutTrack(b) ? `<div class="hint-inline" style="color:#b45309">${tr('hybridBranchTargetEmpty', { name: targetName(targetWithoutTrack(b), track.sections.indexOf(targetWithoutTrack(b))) })}</div>` : ''}
      ${mode === 'point' && !(sec.transitionPoints || []).length ? `<div class="hint-inline" style="color:#b45309">${tr('hybridBranchNeedsPoints')}</div>` : ''}
      <label style="margin-top:6px">${tr('hybridBranchTransitionLabel')}</label>
      <div data-role="branchTransFile"></div>
      ${hasTrans ? `
        <select data-branch="transBars" style="margin-top:6px">
          <option value=""${!b.transition.bars ? ' selected' : ''}>${tr('hybridTransitionWholeFile')}</option>
          ${[1, 2, 4, 8, 16].map(n => `<option value="${n}"${b.transition.bars === n ? ' selected' : ''}>${tr('hybridTransitionBars', { n })}</option>`).join('')}
        </select>
      ` : ''}
    `;
    card.querySelector('[data-branch="target"]').addEventListener('change', e => { b.targetId = e.target.value === '__new' ? newTargetSection() : (e.target.value || null); changed(); });
    card.querySelector('[data-branch="label"]').addEventListener('input', e => { b.label = e.target.value; hasUnsavedEdits = true; });
    card.querySelector('[data-branch="switch"]').addEventListener('change', e => { b.switchMode = e.target.value; changed(); });
    card.querySelector('[data-branch="remove"]').addEventListener('click', () => {
      if (b.transition && b.transition.remoteFile) queueR2Delete(`audio/${track.id}/${b.transition.remoteFile}`);
      sec.branches.splice(bi, 1);
      if (!sec.branches.length) sec.defaultNext = null;
      changed();
    });
    const fileHost = card.querySelector('[data-role="branchTransFile"]');
    fileHost.innerHTML = fileCtrlHtml(tr('chooseWavMp3'), hasTrans ? `<button class="btn btn-small btn-danger" type="button" data-branch="transRemove">${tr('hybridTransitionRemove')}</button>` : '');
    wireFileControl(fileHost, '.wav,audio/wav,.mp3,audio/mp3,audio/mpeg',
      () => b.transition && b.transition.pendingFile, () => b.transition && b.transition.remoteFile,
      f => {
        if (!b.transition) b.transition = { remoteFile: null, originalFileName: null, pendingFile: null, bars: null };
        if (b.transition.remoteFile) queueR2Delete(`audio/${track.id}/${b.transition.remoteFile}`);
        b.transition.remoteFile = null;
        b.transition.pendingFile = f;
        changed();
      }, () => b.transition && b.transition.originalFileName);
    const rm = fileHost.querySelector('[data-branch="transRemove"]');
    if (rm) rm.addEventListener('click', () => { if (b.transition.remoteFile) queueR2Delete(`audio/${track.id}/${b.transition.remoteFile}`); b.transition = null; changed(); });
    const bars = card.querySelector('[data-branch="transBars"]');
    if (bars) bars.addEventListener('change', e => { b.transition.bars = e.target.value ? parseInt(e.target.value, 10) : null; hasUnsavedEdits = true; });
    list.appendChild(card);
  });
  host.querySelector('[data-hybrid="addBranch"]').addEventListener('click', () => {
    // Seule section du morceau : l'embranchement mène tout de suite à une nouvelle section, à remplir plus bas.
    sec.branches.push({ id: genId(), targetId: targets.length ? null : newTargetSection(), label: '', switchMode: 'end', transition: null });
    changed();
  });
  const def = host.querySelector('[data-hybrid="defaultNext"]');
  if (def) def.addEventListener('change', e => { sec.defaultNext = e.target.value || null; changed(); });
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
    // Le séquentiel et le vertical-random enchaînent plusieurs fichiers : pas de frise unique où poser des points.
    const hasOneTimeline = !source || (source.mode !== 'sequential' && source.mode !== 'vertical-random');
    const switchMode = !hasOneTimeline && sec.switchMode === 'point' ? 'end' : (sec.switchMode || 'end');
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
      <label style="margin-top:8px">${tr(hasOneTimeline ? 'hybridSectionLoopsLabel' : 'hybridSectionCyclesLabel')}</label>
      <select data-hybrid="loops">
        <option value=""${loopValue === '' ? ' selected' : ''}>${tr('hybridLoopsFromTrack')}</option>
        <option value="0"${loopValue === '0' ? ' selected' : ''}>${tr('hybridLoopsInfinite')}</option>
        ${[1, 2, 3, 5, 10].map(n => `<option value="${n}"${loopValue === String(n) ? ' selected' : ''}>${n}</option>`).join('')}
      </select>
      <label style="margin-top:8px">${tr('hybridSwitchLabel')}</label>
      <select data-hybrid="switch">
        ${[['beat', 'hybridSwitchBeat'], ['bar', 'hybridSwitchBar'], ...(hasOneTimeline ? [['point', 'hybridSwitchPoint']] : []), ['end', 'hybridSwitchEnd']].map(([v, k]) => `<option value="${v}"${switchMode === v ? ' selected' : ''}>${tr(k)}</option>`).join('')}
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
    if (hybridSectionHasIntro(source)) {
      const skip = document.createElement('label');
      skip.className = 'hybrid-skip-intro';
      skip.innerHTML = `<input type="checkbox"${sec.skipIntro ? ' checked' : ''}> <span>${tr('hybridSkipIntroLabel')}</span>`;
      skip.querySelector('input').addEventListener('change', e => { sec.skipIntro = e.target.checked; hasUnsavedEdits = true; });
      row.appendChild(skip);
      const hint = document.createElement('div');
      hint.className = 'hint-inline';
      hint.textContent = tr('hybridSkipIntroHint');
      row.appendChild(hint);
    }
    const branchesHost = document.createElement('div');
    row.appendChild(branchesHost);
    renderHybridBranches(branchesHost, track, sec, si, hasOneTimeline, changed);
    const swap = (a, b) => { const arr = track.sections; [arr[a], arr[b]] = [arr[b], arr[a]]; changed(); };
    row.querySelector('[data-hybrid="up"]').addEventListener('click', () => swap(si, si - 1));
    row.querySelector('[data-hybrid="down"]').addEventListener('click', () => swap(si, si + 1));
    row.querySelector('[data-hybrid="remove"]').addEventListener('click', () => {
      if (sec.transition && sec.transition.remoteFile) queueR2Delete(`audio/${track.id}/${sec.transition.remoteFile}`);
      (sec.branches || []).forEach(b => { if (b.transition && b.transition.remoteFile) queueR2Delete(`audio/${track.id}/${b.transition.remoteFile}`); });
      // Les embranchements qui menaient à cette section disparaissent avec elle.
      track.sections.forEach(other => {
        (other.branches || []).filter(b => b.targetId === sec.id).forEach(b => { if (b.transition && b.transition.remoteFile) queueR2Delete(`audio/${track.id}/${b.transition.remoteFile}`); });
        other.branches = (other.branches || []).filter(b => b.targetId !== sec.id);
        if (other.defaultNext === sec.id) other.defaultNext = null;
      });
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

