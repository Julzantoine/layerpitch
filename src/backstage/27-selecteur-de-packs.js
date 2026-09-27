/* ---------------- Sélecteur de packs (banque de packs -> bloc "Packs" d'un AdReel) ---------------- */
function buildPackSelectorWidget(hostEl, selectedIds, onChange) {
  function render() {
    hostEl.innerHTML = '';
    if (packs.length === 0) {
      hostEl.innerHTML = `<div class="hint">${tr('noPacksCreated')}</div>`;
      return;
    }
    selectedIds.slice().forEach((id, idx) => {
      const pack = packs.find(p => p.id === id);
      if (!pack) return;
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.innerHTML = `
        <span style="flex:1">${escapeAttr(pack.title) || tr('untitledFallback')}</span>
        <button type="button" class="btn btn-icon" data-sel-action="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn btn-icon" data-sel-action="down" data-idx="${idx}" ${idx === selectedIds.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="btn btn-icon btn-danger" data-sel-action="remove" data-idx="${idx}">${tr('removeBtn')}</button>
      `;
      hostEl.appendChild(row);
    });
    const unselected = packs.filter(p => !selectedIds.includes(p.id));
    const addRow = document.createElement('div');
    addRow.style.marginTop = '8px';
    if (unselected.length) {
      addRow.innerHTML = `
        <select data-sel-action="add">
          <option value="">${tr('addPackOption')}</option>
          ${unselected.map(p => `<option value="${p.id}">${escapeAttr(p.title) || tr('untitledFallback')}</option>`).join('')}
        </select>
      `;
    } else {
      addRow.innerHTML = `<div class="hint-inline">${tr('allPacksIncluded')}</div>`;
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
function buildPacksBlockCard(block) {
  const { card, body } = makeCardShell(block);
  body.innerHTML = `
    <div class="hint" style="margin-bottom:10px">${tr('packsBlockHint')}</div>
    <label>${tr('blockPresentationLabel')}</label>
    <textarea class="linkable" data-role="presentation" rows="3">${escapeHtml(block.presentation || '')}</textarea>
    <div class="hint-inline">${tr('linkHint')}</div>
    <div data-role="selector" style="margin-top:10px"></div>
  `;
  body.querySelector('[data-role="presentation"]').addEventListener('input', e => { block.presentation = e.target.value; hasUnsavedEdits = true; });
  const host = body.querySelector('[data-role="selector"]');
  if (!block.packIds) block.packIds = [];
  buildPackSelectorWidget(host, block.packIds, () => { hasUnsavedEdits = true; refreshAllBlockSummaries(); });
  return card;
}

