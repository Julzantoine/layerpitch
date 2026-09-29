/* ---------------- Sélecteur de morceaux (bibliothèque -> AdReel ou Pack) ---------------- */
// overridesObj : objet live { [trackId]: { title?, description?, layers?: {li: label}, stingers?: {si: label} } }.
// Fourni uniquement pour l'usage AdReel (jamais pour les Packs) — active l'éditeur "Personnaliser pour cet AdReel".
function buildTrackSelectorWidget(hostEl, selectedIds, onChange, overridesObj) {
  const expandedOverrides = new Set(); // état d'affichage de l'éditeur de surcharge, local à ce widget (pas persistant entre rendus de page)

  function layersOf(track) {
    if (track.mode === 'vertical') return track.layers || [];
    return [];
  }

  function overrideEditorHtml(track, ov) {
    const layerArr = layersOf(track);
    const stingerArr = (track.sfxIds || []).map(id => sfxLibrary.find(s => s.id === id)).filter(Boolean);
    const field = (name, labelText, inputTag, helpKey) => `
      <label${helpKey ? ` data-help="${helpKey}"` : ''} style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        <input type="checkbox" data-ov-field="${name}" data-track-id="${track.id}" ${ov[name] !== undefined ? 'checked' : ''} style="width:auto;margin:0;">
        <span style="font-size:11px;color:var(--text-dimmer);">${labelText}</span>
      </label>
      ${ov[name] !== undefined ? inputTag : ''}
    `;
    return `
      ${field('title', tr('titleOverrideLabel'), `<input type="text" data-ov-value="title" data-track-id="${track.id}" value="${escapeAttr(ov.title)}" style="margin-bottom:4px;">`, 'trackOverride')}
      ${field('description', tr('descOverrideLabel'), `<textarea data-ov-value="description" data-track-id="${track.id}" style="margin-bottom:4px;">${escapeHtml(ov.description)}</textarea>`)}
      ${layerArr.length ? `
        <div style="font-size:11px;color:var(--text-dimmer);margin-top:12px;margin-bottom:2px;">${tr('layersHeading')}</div>
        ${layerArr.map((lyr, li) => `
          <label style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <input type="checkbox" data-ov-layer-toggle="${li}" data-track-id="${track.id}" ${ov.layers && ov.layers[li] !== undefined ? 'checked' : ''} style="width:auto;margin:0;">
            <span style="font-size:11px;color:var(--text-dimmer);min-width:100px;flex-shrink:0;">${escapeAttr(lyr.label) || tr('layerFallback', { n: li + 1 })} :</span>
            ${ov.layers && ov.layers[li] !== undefined ? `<input type="text" data-ov-layer-value="${li}" data-track-id="${track.id}" value="${escapeAttr(ov.layers[li])}" style="flex:1">` : ''}
          </label>
        `).join('')}
      ` : ''}
      ${stingerArr.length ? `
        <div style="font-size:11px;color:var(--text-dimmer);margin-top:12px;margin-bottom:2px;">${tr('stingersHeading')}</div>
        ${stingerArr.map((sfx, si) => `
          <label style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <input type="checkbox" data-ov-stinger-toggle="${sfx.id}" data-track-id="${track.id}" ${ov.sfx && ov.sfx[sfx.id] !== undefined ? 'checked' : ''} style="width:auto;margin:0;">
            <span style="font-size:11px;color:var(--text-dimmer);min-width:100px;flex-shrink:0;">${escapeAttr(sfx.title) || tr('sfxFallback', { n: si + 1 })} :</span>
            ${ov.sfx && ov.sfx[sfx.id] !== undefined ? `<input type="text" data-ov-stinger-value="${sfx.id}" data-track-id="${track.id}" value="${escapeAttr(ov.sfx[sfx.id])}" style="flex:1">` : ''}
          </label>
        `).join('')}
      ` : ''}
    `;
  }

  function render() {
    hostEl.innerHTML = '';
    if (library.length === 0) {
      hostEl.innerHTML = `<div class="hint">${tr('noTracksInLibrary')}</div>`;
      return;
    }
    selectedIds.slice().forEach((id, idx) => {
      const track = library.find(t => t.id === id);
      if (!track) return;
      const row = document.createElement('div');
      row.dataset.dragId = id;
      const headButtons = `
        <button type="button" class="btn btn-icon" data-sel-action="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn btn-icon" data-sel-action="down" data-idx="${idx}" ${idx === selectedIds.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="btn btn-icon btn-danger" data-sel-action="remove" data-idx="${idx}">${tr('removeBtn')}</button>
      `;
      if (!overridesObj) {
        row.className = 'layer-row sel-track-item';
        row.innerHTML = `${dragHandleHtml()}<span style="flex:1">${escapeAttr(track.title) || tr('untitledFallback')}</span>${headButtons}`;
        hostEl.appendChild(row);
        return;
      }
      const ov = overridesObj[track.id] || {};
      const hasOverride = !!(ov.title !== undefined || ov.description !== undefined || (ov.layers && Object.keys(ov.layers).length) || (ov.sfx && Object.keys(ov.sfx).length));
      const expanded = expandedOverrides.has(track.id);
      row.className = 'list-block sel-track-item';
      row.style.marginBottom = '6px';
      row.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
          ${dragHandleHtml()}
          <button type="button" class="btn btn-icon" data-sel-action="toggle-override" data-track-id="${track.id}">${expanded ? '▾' : '▸'}</button>
          <span style="flex:1">${hasOverride ? '✎ ' : ''}${escapeAttr(track.title) || tr('untitledFallback')}</span>
          ${headButtons}
        </div>
        <div class="list-block-body${expanded ? '' : ' collapsed'}" style="margin-top:8px">
          ${overrideEditorHtml(track, ov)}
        </div>
      `;
      hostEl.appendChild(row);
    });
    const unselected = library.filter(t => !selectedIds.includes(t.id));
    const addRow = document.createElement('div');
    addRow.style.marginTop = '8px';
    if (unselected.length) {
      addRow.innerHTML = `
        <select data-sel-action="add">
          <option value="">${tr('addTrackOption')}</option>
          ${unselected.map(t2 => `<option value="${t2.id}">${escapeAttr(t2.title) || tr('untitledFallback')}</option>`).join('')}
        </select>
      `;
    } else {
      addRow.innerHTML = `<div class="hint-inline">${tr('allTracksIncluded')}</div>`;
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
        if (action === 'toggle-override') {
          const trackId = btn.dataset.trackId;
          if (expandedOverrides.has(trackId)) expandedOverrides.delete(trackId); else expandedOverrides.add(trackId);
          render();
          return;
        }
        const idx = parseInt(btn.dataset.idx, 10);
        if (action === 'up' && idx > 0) { const tmp = selectedIds[idx - 1]; selectedIds[idx - 1] = selectedIds[idx]; selectedIds[idx] = tmp; }
        else if (action === 'down' && idx < selectedIds.length - 1) { const tmp = selectedIds[idx + 1]; selectedIds[idx + 1] = selectedIds[idx]; selectedIds[idx] = tmp; }
        else if (action === 'remove') { selectedIds.splice(idx, 1); }
        onChange();
        render();
      });
    });

    if (!overridesObj) return;

    function getOrCreateOverride(trackId) {
      if (!overridesObj[trackId]) overridesObj[trackId] = {};
      return overridesObj[trackId];
    }
    function pruneIfEmpty(trackId) {
      const ov = overridesObj[trackId];
      if (!ov) return;
      const empty = ov.title === undefined && ov.description === undefined
        && (!ov.layers || Object.keys(ov.layers).length === 0)
        && (!ov.sfx || Object.keys(ov.sfx).length === 0);
      if (empty) delete overridesObj[trackId];
    }

    hostEl.querySelectorAll('[data-ov-field]').forEach(cb => {
      cb.addEventListener('change', () => {
        const trackId = cb.dataset.trackId;
        const field = cb.dataset.ovField;
        const track = library.find(t => t.id === trackId);
        const ov = getOrCreateOverride(trackId);
        if (cb.checked) { ov[field] = track ? (track[field] || '') : ''; }
        else { delete ov[field]; pruneIfEmpty(trackId); }
        onChange();
        render();
      });
    });
    hostEl.querySelectorAll('[data-ov-value]').forEach(input => {
      input.addEventListener('input', () => {
        const trackId = input.dataset.trackId;
        const field = input.dataset.ovValue;
        const ov = getOrCreateOverride(trackId);
        ov[field] = input.value;
        onChange();
      });
    });
    hostEl.querySelectorAll('[data-ov-layer-toggle]').forEach(cb => {
      cb.addEventListener('change', () => {
        const trackId = cb.dataset.trackId;
        const li = parseInt(cb.dataset.ovLayerToggle, 10);
        const track = library.find(t => t.id === trackId);
        const ov = getOrCreateOverride(trackId);
        if (!ov.layers) ov.layers = {};
        if (cb.checked) { const arr = track ? layersOf(track) : []; ov.layers[li] = (arr[li] && arr[li].label) || ''; }
        else { delete ov.layers[li]; if (Object.keys(ov.layers).length === 0) delete ov.layers; pruneIfEmpty(trackId); }
        onChange();
        render();
      });
    });
    hostEl.querySelectorAll('[data-ov-layer-value]').forEach(input => {
      input.addEventListener('input', () => {
        const trackId = input.dataset.trackId;
        const li = parseInt(input.dataset.ovLayerValue, 10);
        const ov = getOrCreateOverride(trackId);
        if (!ov.layers) ov.layers = {};
        ov.layers[li] = input.value;
        onChange();
      });
    });
    hostEl.querySelectorAll('[data-ov-stinger-toggle]').forEach(cb => {
      cb.addEventListener('change', () => {
        const trackId = cb.dataset.trackId;
        const sfxId = cb.dataset.ovStingerToggle;
        const ov = getOrCreateOverride(trackId);
        if (!ov.sfx) ov.sfx = {};
        if (cb.checked) { const sfx = sfxLibrary.find(s => s.id === sfxId); ov.sfx[sfxId] = (sfx && sfx.title) || ''; }
        else { delete ov.sfx[sfxId]; if (Object.keys(ov.sfx).length === 0) delete ov.sfx; pruneIfEmpty(trackId); }
        onChange();
        render();
      });
    });
    hostEl.querySelectorAll('[data-ov-stinger-value]').forEach(input => {
      input.addEventListener('input', () => {
        const trackId = input.dataset.trackId;
        const sfxId = input.dataset.ovStingerValue;
        const ov = getOrCreateOverride(trackId);
        if (!ov.sfx) ov.sfx = {};
        ov.sfx[sfxId] = input.value;
        onChange();
      });
    });
  }
  render();
  // Glisser-déposer (29/08, retour de Jules-Antoine : les flèches ↑/↓ ne sont plus l'interaction
  // principale attendue, gardées uniquement comme repli accessible/clavier) -- réutilise le même mécanisme
  // que les listes maître de couches/boucles/sections, généralisé pour accepter ici un tableau de simples
  // identifiants plutôt que d'objets {id, ...}. Câblé UNE SEULE FOIS ici (hors de render()) : hostEl est un
  // conteneur persistant reçu de l'appelant, réutilisé tel quel à travers tous les rendus successifs de ce
  // widget (seul son contenu est vidé/reconstruit à chaque render()) -- l'appeler depuis l'intérieur de
  // render() aurait empilé un nouveau jeu d'écouteurs à chaque rendu.
  wireArrayDragReorder(hostEl, 'sel-track-item', () => selectedIds, () => { onChange(); render(); });
  return render;
}

// Note : pas de buildPackSelectorWidget ici — une fonction du même nom existe déjà plus bas dans ce
// fichier (créée à l'origine pour le sélecteur de packs du bloc "Packs" d'un AdReel) et fait exactement
// le même travail (liste ordonnée + réordonnancement + ajout via menu déroulant) ; les Collections la
// réutilisent telle quelle plutôt que d'en dupliquer une seconde.
function saveWorkingPendingIntoCurrent() {
  const ar = adReels.find(a => a.id === currentAdReelId);
  if (ar) { ar.logoPendingFile = logoPendingFile; ar.photoPendingFile = photoPendingFile; ar.themeBgImagePendingFile = themeBgImagePendingFile; }
}
function switchAdReel(newId) {
  saveWorkingPendingIntoCurrent();
  const ar = adReels.find(a => a.id === newId);
  if (!ar) return;
  currentAdReelId = newId;
  blocks = ar.blocks;
  profile = ar.profile;
  testimonials = ar.testimonials;
  trackIds = ar.trackIds;
  trackOverrides = ar.trackOverrides || (ar.trackOverrides = {});
  logoPendingFile = ar.logoPendingFile || null;
  photoPendingFile = ar.photoPendingFile || null;
  themeBgImagePendingFile = ar.themeBgImagePendingFile || null;
  fillAppearanceFields();
  rebuildAllCards();
  renderAdReelSelect();
  renderManageAdreels();
}
function computeAdReelUrl(adReelId) {
  // Lien public = chemin joli du handle sur beta.layerpitch.com (voir 404.html). Jamais de lien de substitution :
  // tant que le handle n'est pas chargé (asynchrone, voir refreshMyComposerHandle), il n'y a simplement pas encore
  // de lien à afficher -- null est un état transitoire normal. (Le lien github.io des dépôts personnels a disparu
  // avec la publication via GitHub, le 24/09.)
  if (myComposerHandle) {
    const base = `https://beta.layerpitch.com/${encodeURIComponent(myComposerHandle)}/`;
    if (adReelId === 'main') return base;
    // Nom choisi pour l'AdReel (27/09) : /<nom>/<adreel> ; sinon son code, comme avant.
    const ar = adReels.find(a => a.id === adReelId);
    return ar && ar.slug ? base + encodeURIComponent(ar.slug) : `${base}?adreel=${encodeURIComponent(adReelId)}`;
  }
  return null;
}
// Pack et collection : même adresse publique que l'AdReel (handle du compositeur). Avant le 24/09, toujours
// construite sur github.io -- faux pour tout compositeur sans dépôt GitHub (« ton-compte.github.io/… »). null tant
// que le handle n'est pas chargé, comme computeAdReelUrl.
function computePackUrl(packId) {
  if (!myComposerHandle) return null;
  return `https://beta.layerpitch.com/${encodeURIComponent(myComposerHandle)}/pack.html?id=${encodeURIComponent(packId)}`;
}
function computeCollectionUrl(collectionId) {
  if (!myComposerHandle) return null;
  return `https://beta.layerpitch.com/${encodeURIComponent(myComposerHandle)}/collection.html?id=${encodeURIComponent(collectionId)}`;
}
// Code d'intégration (iframe) : même URL publique que "Copier le lien", avec &embed=1 en plus --
// pack.html/collection.html s'en servent pour remplacer le discret "← Retour" par un vrai bouton
// visible ramenant l'auditeur vers l'AdReel principal (voir embedMode, pack.html/collection.html).
function buildEmbedSnippet(url, title) {
  return `<iframe src="${url}" width="100%" height="700" style="border:0;border-radius:8px;max-width:640px;" allow="autoplay" loading="lazy" title="${escapeAttr(title)}"></iframe>`;
}
function openEmbedModal(url, itemTitle, hintKey) {
  document.getElementById('embedModalSub').textContent = tr(hintKey);
  document.getElementById('embedCodeArea').value = buildEmbedSnippet(url, itemTitle || 'LayerPitch');
  document.getElementById('embedModalOverlay').style.display = 'flex';
}
document.getElementById('embedCloseBtn').addEventListener('click', () => {
  document.getElementById('embedModalOverlay').style.display = 'none';
});
document.getElementById('embedCopyBtn').addEventListener('click', async () => {
  const area = document.getElementById('embedCodeArea');
  try {
    await navigator.clipboard.writeText(area.value);
  } catch (e) {
    area.select();
    document.execCommand('copy');
  }
  const statusEl = document.getElementById('embedCopyStatus');
  statusEl.classList.add('visible');
  setTimeout(() => statusEl.classList.remove('visible'), 1500);
});
function renderAdReelSelect() {
  const sel = document.getElementById('adReelSelect');
  sel.innerHTML = adReels.map(a => `<option value="${a.id}"${a.id === currentAdReelId ? ' selected' : ''}>${escapeAttr(a.label || a.id)} (${escapeAttr(a.id)})</option>`).join('');
  const url = computeAdReelUrl(currentAdReelId);
  const box = document.getElementById('adReelUrlBox');
  box.innerHTML = url
    ? `<a href="${url}" target="_blank" rel="noopener">${escapeAttr(url)}</a>`
    : escapeAttr(tr('adreelUrlPending'));
  document.getElementById('btnDeleteAdReel').disabled = (currentAdReelId === 'main' || adReels.length <= 1);
  // Code d'intégration (liste de morceaux uniquement, voir embedMode côté index.html) : désactivé si
  // cet AdReel n'a aucun bloc "Morceaux" -- rien à intégrer, plutôt qu'un lecteur vide et déroutant.
  const ar = adReels.find(a => a.id === currentAdReelId);
  const hasTracksBlock = !!(ar && (ar.blocks || []).some(b => b.type === 'tracks'));
  const embedBtn = document.getElementById('btnEmbedAdReelTracks');
  embedBtn.disabled = !hasTracksBlock;
  embedBtn.title = hasTracksBlock ? '' : tr('embedAdreelTracksDisabledHint');
}
function renderManageAdreels() {
  const masterHost = document.getElementById('manageAdreelsMaster');
  const detailHost = document.getElementById('manageAdreelsDetail');
  if (!masterHost || !detailHost) return; // panneau pas encore dans le DOM au tout premier rendu
  if (!manageAdreelsSelectedId || !adReels.some(a => a.id === manageAdreelsSelectedId)) {
    manageAdreelsSelectedId = currentAdReelId;
  }

  renderOrgMasterList(masterHost, adReels, adReelFolders, collapsedAdReelFolderIds, {
    selectedId: manageAdreelsSelectedId,
    selectAction: 'select-manage-adreel',
    toggleFolderAction: 'toggle-adreel-folder',
    deleteFolderAction: 'delete-adreel-folder',
    folderFieldAttr: 'data-adreel-folder-field',
    folderFallbackKey: 'orgFolderFallback',
    buildRowInner: a => `
      <span class="seq-master-item-label">${escapeAttr(a.label || a.id)}</span>
      ${a.id === currentAdReelId ? `<span class="badge">${tr('currentAdreelBadge')}</span>` : ''}
    `
  });
  wireOrgDragDrop(masterHost, () => adReels, () => adReelFolders, renderManageAdreels); // conteneur statique du HTML -- voir commentaire de wireOrgDragDrop

  const selected = adReels.find(a => a.id === manageAdreelsSelectedId);
  detailHost.innerHTML = '';
  if (!selected) return;
  const url = computeAdReelUrl(selected.id);
  const canDelete = !(selected.id === 'main' || adReels.length <= 1);
  detailHost.innerHTML = `
    <div class="list-block-head">
      <div class="list-block-head-left" style="flex:1;gap:8px;">
        <input type="text" data-manage-adreel-field="label" data-id="${selected.id}" value="${escapeAttr(selected.label || selected.id)}" style="font-weight:600;border:1px solid transparent;background:transparent;padding:2px 4px;flex:1;min-width:120px;">
        ${selected.id === currentAdReelId ? `<span class="badge">${tr('currentAdreelBadge')}</span>` : ''}
      </div>
      <span class="hint-inline" style="font-family:monospace;white-space:nowrap;">${escapeAttr(selected.id)}</span>
    </div>
    <div class="hint-inline" style="margin-top:6px;word-break:break-all;">${url ? `<a href="${url}" target="_blank" rel="noopener">${escapeAttr(url)}</a>` : escapeAttr(tr('adreelUrlPending'))}</div>
    <div class="actions" style="margin-top:10px;flex-wrap:wrap;">
      <button class="btn btn-small" data-action="edit-adreel" data-id="${selected.id}" type="button">${tr('editAdreelBtn')}</button>
      <button class="btn btn-small" data-action="duplicate-adreel" data-id="${selected.id}" type="button">${tr('duplicateAdreelBtn')}</button>
      <button class="btn btn-small" data-action="copy-adreel-url-manage" data-id="${selected.id}" type="button">${tr('copyLink')}</button>
      <button class="btn btn-small" data-action="share-adreel-url-manage" data-id="${selected.id}" type="button">${tr('shareBtn')}</button>
      <button class="btn btn-small btn-danger" data-action="delete-adreel-manage" data-id="${selected.id}" type="button" ${canDelete ? '' : 'disabled'} title="${canDelete ? '' : escapeAttr(tr('cantDeleteLastAdreel'))}">${tr('deleteBtn')}</button>
    </div>
  `;
}
document.getElementById('btnAddAdReelFolder').addEventListener('click', () => {
  adReelFolders.push({ id: genId(), label: tr('defaultOrgFolderLabel', { n: adReelFolders.length + 1 }) });
  hasUnsavedEdits = true;
  renderManageAdreels();
});
document.getElementById('manageAdreelsContainer').addEventListener('input', e => {
  const folderField = e.target.dataset.adreelFolderField;
  if (folderField === 'label') {
    const folder = adReelFolders.find(f => f.id === e.target.dataset.folderId);
    if (folder) { folder.label = e.target.value; hasUnsavedEdits = true; }
    return;
  }
  const field = e.target.dataset.manageAdreelField;
  if (field !== 'label') return;
  const id = e.target.dataset.id;
  const ar = adReels.find(a => a.id === id);
  if (!ar) return;
  ar.label = e.target.value;
  hasUnsavedEdits = true;
  renderAdReelSelect(); // le libellé renommé doit se refléter immédiatement dans le sélecteur de la barre latérale
});
document.getElementById('manageAdreelsContainer').addEventListener('click', async e => {
  const selectBtn = e.target.closest('[data-action="select-manage-adreel"]');
  if (selectBtn) { manageAdreelsSelectedId = selectBtn.dataset.dragId; renderManageAdreels(); return; }
  const folderToggleBtn = e.target.closest('[data-action="toggle-adreel-folder"]');
  if (folderToggleBtn) {
    const fid = folderToggleBtn.dataset.folderId;
    if (collapsedAdReelFolderIds.has(fid)) collapsedAdReelFolderIds.delete(fid); else collapsedAdReelFolderIds.add(fid);
    renderManageAdreels();
    return;
  }
  const folderDeleteBtn = e.target.closest('[data-action="delete-adreel-folder"]');
  if (folderDeleteBtn) {
    const fid = folderDeleteBtn.dataset.folderId;
    if (await deleteOrgFolder(adReelFolders, adReels, fid)) {
      collapsedAdReelFolderIds.delete(fid);
      hasUnsavedEdits = true;
      renderManageAdreels();
    }
    return;
  }
  const editBtn = e.target.closest('[data-action="edit-adreel"]');
  if (editBtn) { switchAdReel(editBtn.dataset.id); switchTab('content'); return; }
  const dupBtn = e.target.closest('[data-action="duplicate-adreel"]');
  if (dupBtn) { openNewAdReelModal(dupBtn.dataset.id); return; }
  const delBtn = e.target.closest('[data-action="delete-adreel-manage"]');
  if (delBtn) { if (!delBtn.disabled) deleteAdReel(delBtn.dataset.id); return; }
  const copyBtn = e.target.closest('[data-action="copy-adreel-url-manage"]');
  if (copyBtn) {
    const url = computeAdReelUrl(copyBtn.dataset.id);
    if (!url) { window.LayerPitchNotify.info(tr('adreelUrlPending')); return; }
    const done = () => { const original = copyBtn.textContent; copyBtn.textContent = tr('copiedStatus'); setTimeout(() => { copyBtn.textContent = original; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => { window.LayerPitchNotify.error(tr('copyFailedAlert')); });
    } else { window.LayerPitchNotify.error(tr('copyFailedAlert')); }
    return;
  }
  const shareBtn = e.target.closest('[data-action="share-adreel-url-manage"]');
  if (shareBtn) {
    const shareUrl = computeAdReelUrl(shareBtn.dataset.id);
    if (!shareUrl) { window.LayerPitchNotify.info(tr('adreelUrlPending')); return; }
    const ar = adReels.find(a => a.id === shareBtn.dataset.id);
    const result = await shareViaSocialsOrFallback(shareUrl, (ar && ar.label) || 'LayerPitch');
    if (result === 'copied') {
      const original = shareBtn.textContent;
      shareBtn.textContent = tr('copiedStatus');
      setTimeout(() => { shareBtn.textContent = original; }, 1500);
    } else if (result === 'unavailable') { window.LayerPitchNotify.error(tr('copyFailedAlert')); }
    return;
  }
});
document.getElementById('adReelSelect').addEventListener('change', e => switchAdReel(e.target.value));
document.getElementById('btnCopyAdReelUrl').addEventListener('click', () => {
  const url = computeAdReelUrl(currentAdReelId);
  if (!url) { window.LayerPitchNotify.info(tr('adreelUrlPending')); return; }
  const btn = document.getElementById('btnCopyAdReelUrl');
  const done = () => { const original = btn.textContent; btn.textContent = tr('copiedStatus'); setTimeout(() => { btn.textContent = original; }, 1500); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(() => { window.LayerPitchNotify.error(tr('copyFailedAlert')); });
  } else {
    window.LayerPitchNotify.error(tr('copyFailedAlert'));
  }
});
document.getElementById('btnEmbedAdReelTracks').addEventListener('click', () => {
  const baseUrl = computeAdReelUrl(currentAdReelId);
  if (!baseUrl) { window.LayerPitchNotify.info(tr('adreelUrlPending')); return; }
  const ar = adReels.find(a => a.id === currentAdReelId);
  // computeAdReelUrl('main') ne contient pas encore de "?" (juste la racine) -- &embed=1 supposerait à
  // tort un "?" déjà présent, contrairement à computePackUrl/computeCollectionUrl (toujours "?id=...").
  const url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'embed=1';
  openEmbedModal(url, (ar && ar.label) || 'LayerPitch', 'embedModalHintAdreelTracks');
});
document.getElementById('btnShareAdReelUrl').addEventListener('click', async () => {
  const shareUrl = computeAdReelUrl(currentAdReelId);
  if (!shareUrl) { window.LayerPitchNotify.info(tr('adreelUrlPending')); return; }
  const btn = document.getElementById('btnShareAdReelUrl');
  const ar = adReels.find(a => a.id === currentAdReelId);
  const result = await shareViaSocialsOrFallback(shareUrl, (ar && ar.label) || 'LayerPitch');
  if (result === 'copied') {
    const original = btn.textContent;
    btn.textContent = tr('copiedStatus');
    setTimeout(() => { btn.textContent = original; }, 1500);
  } else if (result === 'unavailable') {
    window.LayerPitchNotify.error(tr('copyFailedAlert'));
  }
});

// Apparence du Backstage (thème jour/nuit, couleur de fond, image de fond en filigrane) : réglages locaux à cet
// ordinateur, sans rapport avec l'apparence publique. Depuis le 29/09 le code est dans layerpitch-appearance.js, commun
// à toutes les pages d'espace (mêmes clés de stockage qu'avant : le réglage existant est conservé).
window.LayerPitchAppearance.mountPanel(document.getElementById('backstageAppearanceHost'));

// Purge ponctuelle (11 septembre, audit sécurité) : le panneau "Stockage média (Cloudflare R2)" qui
// stockait les clés secrètes R2 maîtresses en clair dans localStorage a été retiré — create-media-signed-url
// couvre déjà tous les cas d'usage avec des URLs signées à courte durée de vie, sans jamais exposer
// ces clés au navigateur. Si une session précédente les avait mémorisées ici, on les efface au
// prochain chargement plutôt que de les laisser traîner indéfiniment sur le disque.
try {
  ['layerpitch_backstage_r2_account_id', 'layerpitch_backstage_r2_bucket',
   'layerpitch_backstage_r2_access_key_id', 'layerpitch_backstage_r2_secret_access_key']
    .forEach((k) => localStorage.removeItem(k));
} catch (e) { /* stockage bloqué : rien à purger de toute façon */ }

function buildBlocksForNewAdReel(source, importExtraBlocks) {
  // Bug corrigé (16 juillet) : l'ancienne version partait toujours de freshBlocks() (ordre figé
  // header/bio/testimonials/tracks), puis collait les blocs "extra" à la fin — la position réelle des
  // blocs dans l'AdReel source (ex. une Bio déplacée tout en bas) était donc toujours perdue à l'import.
  // Ici, on reconstruit dans l'ordre exact de source.blocks ; les cases à cocher (importHeader, importBio,
  // etc.) ne contrôlent QUE le contenu copié (profil, témoignages, morceaux), jamais la position des blocs.
  if (!source) return freshBlocks();
  const blocks = source.blocks.map(b => {
    if (SINGLETON_TYPES.includes(b.type)) {
      const fresh = { id: genId(), type: b.type };
      if (b.appearance) fresh.appearance = Object.assign({}, b.appearance);
      return fresh;
    }
    if (!importExtraBlocks) return null;
    const clone = { ...b, id: genId() };
    if (b.appearance) clone.appearance = Object.assign({}, b.appearance); // copie indépendante, pas la même référence que le bloc source
    if (b.type === 'photo') clone.images = (b.images || []).map(img => ({ file: img.file || null, originalFileName: img.originalFileName || null, pendingFile: null }));
    if (b.type === 'video') clone.videos = (b.videos || []).map(v => ({ title: v.title || '', url: v.url || '', comment: v.comment || '', thumbnail: v.thumbnail || null, thumbnailOriginalName: v.thumbnailOriginalName || null, pendingThumbnail: null, source: v.source === 'library' ? 'library' : 'url', libraryVideoId: v.libraryVideoId || null }));
    if (b.type === 'packs') clone.packIds = (b.packIds || []).slice();
    if (b.type === 'collections') clone.collectionIds = (b.collectionIds || []).slice();
    if (b.type === 'sfx') clone.sfxIds = (b.sfxIds || []).slice();
    if (b.type === 'socials') clone.socialIds = (b.socialIds || []).slice();
    return clone;
  }).filter(Boolean);
  // Garde-fou : garantit la présence des 4 blocs obligatoires même si l'un manquait dans la source.
  SINGLETON_TYPES.forEach(t => {
    if (!blocks.some(b => b.type === t)) blocks.push({ id: genId(), type: t });
  });
  return blocks;
}
function openNewAdReelModal(duplicateFromId) {
  const sourceSel = document.getElementById('newAdReelSource');
  sourceSel.innerHTML = `<option value="">${tr('noneEmptyAdreel')}</option>` +
    adReels.map(a => `<option value="${a.id}">${escapeAttr(a.label || a.id)} (${escapeAttr(a.id)})</option>`).join('');
  const dupSource = duplicateFromId ? adReels.find(a => a.id === duplicateFromId) : null;
  document.getElementById('newAdReelLabel').value = dupSource ? tr('duplicateLabelSuffix', { label: dupSource.label || dupSource.id }) : '';
  // Langue de publication par défaut d'un AdReel vide (15/09, retour direct de Jules-Antoine) :
  // suit la langue d'AFFICHAGE du Backstage (currentLang()) plutôt qu'un 'fr' figé -- un
  // compositeur qui utilise le Backstage en anglais s'attend à ce qu'un AdReel neuf parte lui aussi
  // en anglais, pas à devoir changer ce champ à chaque création. Un AdReel dupliqué garde, lui,
  // toujours la langue réelle de sa source (comportement inchangé).
  document.getElementById('newAdReelLang').value = dupSource ? (dupSource.lang || 'fr') : currentLang();
  sourceSel.value = duplicateFromId || '';
  ['importHeader', 'importBio', 'importTestimonials', 'importAppearance', 'importTracks', 'importExtraBlocks'].forEach(id => {
    document.getElementById(id).checked = !!dupSource;
  });
  updateNewAdReelImportState();
  document.getElementById('newAdReelModalOverlay').style.display = 'flex';
  document.getElementById('newAdReelLabel').focus();
  document.getElementById('newAdReelLabel').select();
}
function updateNewAdReelImportState() {
  const hasSource = !!document.getElementById('newAdReelSource').value;
  document.getElementById('newAdReelImportOptions').classList.toggle('disabled', !hasSource);
}
document.getElementById('newAdReelSource').addEventListener('change', updateNewAdReelImportState);
document.getElementById('btnAddAdReel').addEventListener('click', () => openNewAdReelModal());
document.getElementById('newAdReelCancel').addEventListener('click', () => {
  document.getElementById('newAdReelModalOverlay').style.display = 'none';
});
document.getElementById('newAdReelOk').addEventListener('click', () => {
  const label = document.getElementById('newAdReelLabel').value.trim();
  if (!label) { window.LayerPitchNotify.info(tr('giveNameAlert')); return; }
  const sourceId = document.getElementById('newAdReelSource').value;
  const source = sourceId ? adReels.find(a => a.id === sourceId) : null;
  const imp = {
    header: source && document.getElementById('importHeader').checked,
    bio: source && document.getElementById('importBio').checked,
    testimonials: source && document.getElementById('importTestimonials').checked,
    appearance: source && document.getElementById('importAppearance').checked,
    tracks: source && document.getElementById('importTracks').checked,
    extraBlocks: source && document.getElementById('importExtraBlocks').checked
  };

  let id = slug(label);
  if (!id || adReels.some(a => a.id === id)) id = genId();

  const profile = { title: '', subtitle: '', bio: '', contactEmail: '', contactUrl: '', logo: null, photo: null, theme: Object.assign({}, DEFAULT_THEME) };
  if (imp.header && source) {
    profile.title = source.profile.title || '';
    profile.subtitle = (source.profile.subtitle != null) ? source.profile.subtitle : (source.profile.tagline || '');
    profile.logo = source.profile.logo || null;
    profile.contactEmail = source.profile.contactEmail || '';
    profile.contactUrl = source.profile.contactUrl || '';
  }
  if (imp.bio && source) {
    profile.bio = source.profile.bio || '';
    profile.photo = source.profile.photo || null;
  }
  if (imp.appearance && source) {
    profile.theme = migrateProfileTheme(source.profile);
  }

  const blocks = buildBlocksForNewAdReel(imp.header || imp.bio || imp.testimonials || imp.tracks || imp.extraBlocks ? source : null, imp.extraBlocks && source);

  const newAdReel = {
    id, label,
    blocks,
    profile,
    lang: document.getElementById('newAdReelLang').value || 'fr',
    testimonials: (imp.testimonials && source) ? source.testimonials.map(t => ({ ...t })) : [],
    trackIds: (imp.tracks && source) ? source.trackIds.slice() : [],
    trackOverrides: (imp.tracks && source) ? JSON.parse(JSON.stringify(source.trackOverrides || {})) : {},
    // Toujours indexé par défaut à la création, même en dupliquant un AdReel non-indexé -- décision
    // volontaire (15/09) : rien à "importer" ici, chaque AdReel démarre visible et c'est au
    // compositeur de le décocher explicitement s'il s'agit d'une démo.
    allowIndexing: true,
    logoPendingFile: null, photoPendingFile: null, themeBgImagePendingFile: null,
    folderId: null
  };
  adReels.push(newAdReel);
  // Repliés par défaut (15/09, retour direct de Jules-Antoine) -- même convention que le chargement
  // initial de la page (voir plus bas, tous les blocs de tous les AdReels rejoignent
  // collapsedBlockIds à chaque chargement) : sans cet ajout explicite, un AdReel créé ou dupliqué
  // SANS recharger la page restait déplié, ses ids n'ayant jamais rejoint l'ensemble.
  newAdReel.blocks.forEach(b => collapsedBlockIds.add(b.id));
  hasUnsavedEdits = true;
  trackBackstageEvent('adreel_add', { imported: !!source });
  document.getElementById('newAdReelModalOverlay').style.display = 'none';
  switchAdReel(id);
});
async function deleteAdReel(id) {
  if (id === 'main' || adReels.length <= 1) return;
  if (!(await window.LayerPitchNotify.confirm(tr('deleteAdreelConfirm', { id }), { danger: true }))) return;
  if (!adReels.some(a => a.id === id)) return; // données rechargées pendant la question
  adReels = adReels.filter(a => a.id !== id);
  // Un pack qui renvoyait vers cet AdReel retombe sur "Aucun" plutôt que de garder une référence
  // orpheline silencieusement ignorée à la publication.
  packs.forEach(p => { if (p.linkedAdReelId === id) p.linkedAdReelId = ''; });
  hasUnsavedEdits = true;
  trackBackstageEvent('adreel_delete', {});
  if (currentAdReelId === id) switchAdReel('main');
  else renderAdReelSelect();
  renderPacks();
  renderManageAdreels();
}
document.getElementById('btnDeleteAdReel').addEventListener('click', () => deleteAdReel(currentAdReelId));

