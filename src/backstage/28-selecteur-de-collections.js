/* ---------------- Sélecteur de collections (banque de collections -> bloc "Collections" d'un AdReel) ---------------- */
function buildCollectionSelectorWidget(hostEl, selectedIds, onChange) {
  function render() {
    hostEl.innerHTML = '';
    if (collections.length === 0) {
      hostEl.innerHTML = `<div class="hint">${tr('noCollectionsCreated')}</div>`;
      return;
    }
    selectedIds.slice().forEach((id, idx) => {
      const collection = collections.find(c => c.id === id);
      if (!collection) return;
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.innerHTML = `
        <span style="flex:1">${escapeAttr(collection.title) || tr('untitledFallback')}</span>
        <button type="button" class="btn btn-icon" data-sel-action="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn btn-icon" data-sel-action="down" data-idx="${idx}" ${idx === selectedIds.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="btn btn-icon btn-danger" data-sel-action="remove" data-idx="${idx}">${tr('removeBtn')}</button>
      `;
      hostEl.appendChild(row);
    });
    const unselected = collections.filter(c => !selectedIds.includes(c.id));
    const addRow = document.createElement('div');
    addRow.style.marginTop = '8px';
    if (unselected.length) {
      addRow.innerHTML = `
        <select data-sel-action="add">
          <option value="">${tr('addCollectionOption')}</option>
          ${unselected.map(c => `<option value="${c.id}">${escapeAttr(c.title) || tr('untitledFallback')}</option>`).join('')}
        </select>
      `;
    } else {
      addRow.innerHTML = `<div class="hint-inline">${tr('allCollectionsIncluded')}</div>`;
    }
    hostEl.appendChild(addRow);

    hostEl.querySelectorAll('[data-sel-action="add"]').forEach(sel => {
      sel.addEventListener('change', () => {
        if (sel.value) { selectedIds.push(sel.value); onChange(); render(); }
      });
    });
    hostEl.querySelectorAll('button[data-sel-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.selAction;
        const idx = parseInt(btn.dataset.idx, 10);
        if (action === 'up' && idx > 0) { const tmp = selectedIds[idx - 1]; selectedIds[idx - 1] = selectedIds[idx]; selectedIds[idx] = tmp; }
        else if (action === 'down' && idx < selectedIds.length - 1) { const tmp = selectedIds[idx + 1]; selectedIds[idx + 1] = selectedIds[idx]; selectedIds[idx] = tmp; }
        else if (action === 'remove') { selectedIds.splice(idx, 1); }
        onChange();
        render();
      });
    });
  }
  render();
  return render;
}
function buildCollectionsBlockCard(block) {
  const { card, body } = makeCardShell(block);
  body.innerHTML = `
    <div class="hint" style="margin-bottom:10px">${tr('collectionsBlockHint')}</div>
    <label>${tr('blockPresentationLabel')}</label>
    <textarea class="linkable" data-role="presentation" rows="3">${escapeHtml(block.presentation || '')}</textarea>
    <div class="hint-inline">${tr('linkHint')}</div>
    <div data-role="selector" style="margin-top:10px"></div>
  `;
  body.querySelector('[data-role="presentation"]').addEventListener('input', e => { block.presentation = e.target.value; hasUnsavedEdits = true; });
  const host = body.querySelector('[data-role="selector"]');
  if (!block.collectionIds) block.collectionIds = [];
  buildCollectionSelectorWidget(host, block.collectionIds, () => { hasUnsavedEdits = true; refreshAllBlockSummaries(); });
  return card;
}

