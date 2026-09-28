function renderLibrary() {
  // Stoppe proprement tout aperçu audio en cours avant de reconstruire le DOM (sinon le son continuerait "orphelin").
  activePreviewIds.forEach(id => document.dispatchEvent(new CustomEvent('stop-track', { detail: id })));
  activePreviewIds.clear();
  const masterHost = document.getElementById('libraryMaster');
  const detailHost = document.getElementById('libraryDetail');
  if (!masterHost || !detailHost) return; // panneau pas encore dans le DOM au tout premier rendu
  if (!manageLibrarySelectedId || !library.some(t => t.id === manageLibrarySelectedId)) {
    manageLibrarySelectedId = library.length ? library[0].id : null;
  }

  renderOrgMasterList(masterHost, library, libraryFolders, collapsedLibraryFolderIds, {
    selectedId: manageLibrarySelectedId,
    selectAction: 'select-manage-track',
    toggleFolderAction: 'toggle-library-folder',
    deleteFolderAction: 'delete-library-folder',
    folderFieldAttr: 'data-library-folder-field',
    folderFallbackKey: 'orgFolderFallback',
    buildRowInner: t => `<span class="seq-master-item-label">${escapeAttr(t.title) || tr('trackFallback', { n: library.indexOf(t) + 1 })}</span>`
  });
  wireOrgDragDrop(masterHost, () => library, () => libraryFolders, renderLibrary); // conteneur statique du HTML -- voir commentaire de wireOrgDragDrop

  detailHost.innerHTML = '';
  if (!manageLibrarySelectedId) {
    detailHost.innerHTML = `<div class="hint-inline">${tr('libraryEmptyHint')}</div>`;
    return;
  }
  library.forEach((track, ti) => {
    if (track.id !== manageLibrarySelectedId) return; // un seul morceau affiché à la fois -- celui sélectionné dans la liste maître
    const isStatic = track.mode === 'static';
    const isVerticalRandom = track.mode === 'vertical-random';
    const isSequential = track.mode === 'sequential';
    const isEmbrVert = track.mode === 'embranchement-vertical';
    const loops = !isStatic || !!track.loopable;
    const beatsPerBar = track.beatsPerBar || 4;
    const bpm = track.bpm || 120;
    const el = document.createElement('div');
    el.className = 'list-block';
    el.innerHTML = `
      <div class="list-block-head">
        <div class="list-block-head-left">
          <input type="text" class="seq-header-title" data-field="title" data-ti="${ti}" value="${escapeAttr(track.title)}" placeholder="${tr('trackFallback', { n: ti + 1 })}">
          <select data-field="mode" data-ti="${ti}" class="seq-header-mode" data-help="trackMode">
            <option value="static"${track.mode === 'static' ? ' selected' : ''}>${tr('modeOptionStatic')}</option>
            <option value="vertical"${track.mode === 'vertical' ? ' selected' : ''}>${tr('modeOptionVertical')}</option>
            <option value="vertical-random"${track.mode === 'vertical-random' ? ' selected' : ''}>${tr('modeOptionVerticalRandom')}</option>
            <option value="sequential"${track.mode === 'sequential' ? ' selected' : ''}>${tr('modeOptionSequential')}</option>
            <option value="embranchement-vertical"${track.mode === 'embranchement-vertical' ? ' selected' : ''}>${tr('modeOptionEmbranchementVertical')}</option>
            <option value="vertical-additive-random" disabled>${tr('modeOptionVerticalAdditiveRandom')}</option>
            <option value="vertical-additive-sequential" disabled>${tr('modeOptionVerticalAdditiveSequential')}</option>
            <option value="vertical-additive-sequential-random" disabled>${tr('modeOptionVerticalAdditiveSequentialRandom')}</option>
          </select>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-small" data-action="preview-track" data-ti="${ti}" type="button">${tr('previewBtn')}</button>
          <button class="btn btn-small btn-danger" data-action="remove-track" data-ti="${ti}">${tr('deleteBtn')}</button>
        </div>
      </div>
      <div data-role="previewHost"></div>
      <div class="list-block-body" data-role="trackBody">
      ${isSequential ? `
        <label data-help="segmentSlotsSection" style="margin-top:14px">${tr('segmentSlotsLabel')}</label>
        ${!(track.segmentSlots && track.segmentSlots.some(sl => (sl.alternatives || []).some(a => a.pendingFile || a.remoteFile))) ? `<div class="hint-inline" style="color:#b45309">${tr('noSegmentWarning')}</div>` : ''}
        <div class="hint-inline">${tr('segmentSlotsOrderHint')}${flagOpen('alt_drag_delete') ? ' ' + tr('altDuplicateHint') : ''}</div>
        <div class="seq-two-col">
          <div class="seq-master-list" data-role="segmentSlotsMaster"></div>
          <div class="seq-detail-col" data-role="segmentSlotsDetail"></div>
        </div>
      ` : `
        <div class="seq-two-col">
          <div class="seq-master-list" data-role="modeMaster"></div>
          <div class="seq-detail-col" data-role="modeDetail"></div>
        </div>
      `}
      </div>
    `;

