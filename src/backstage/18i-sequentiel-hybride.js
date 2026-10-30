/* ---------------- Séquentiel hybride (31/10) : la liste des sections du morceau ---------------- */
// Une section n'a pas de fichier à elle : elle désigne un morceau de la bibliothèque (static ou vertical pour commencer). Rien n'est
// recopié, donc le morceau reste modifiable à un seul endroit.
const HYBRID_SECTION_MODES_BS = ['static', 'vertical'];
function hybridSectionTrackIsReady(source) {
  if (!source || !HYBRID_SECTION_MODES_BS.includes(source.mode)) return false;
  const layers = source.layers || [], has = l => !!(l && (l.pendingFile || l.remoteFile));
  return has(layers[0]) && (source.mode === 'static' || layers.every(has));
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
    `;
    const swap = (a, b) => { const arr = track.sections; [arr[a], arr[b]] = [arr[b], arr[a]]; changed(); };
    row.querySelector('[data-hybrid="up"]').addEventListener('click', () => swap(si, si - 1));
    row.querySelector('[data-hybrid="down"]').addEventListener('click', () => swap(si, si + 1));
    row.querySelector('[data-hybrid="remove"]').addEventListener('click', () => { track.sections.splice(si, 1); changed(); });
    row.querySelector('[data-hybrid="track"]').addEventListener('change', e => { sec.trackId = e.target.value || null; changed(); });
    row.querySelector('[data-hybrid="label"]').addEventListener('input', e => { sec.label = e.target.value; hasUnsavedEdits = true; });
    row.querySelector('[data-hybrid="loops"]').addEventListener('change', e => { sec.maxLoops = e.target.value === '' ? null : parseInt(e.target.value, 10); hasUnsavedEdits = true; });
    list.appendChild(row);
  });
  host.querySelector('[data-role="hybridAdd"]').addEventListener('click', () => { track.sections.push({ id: genId(), label: '', trackId: null, maxLoops: null }); changed(); });
}

