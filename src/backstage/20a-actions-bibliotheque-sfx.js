document.getElementById('btnAddSfx').addEventListener('click', () => {
  const newSfx = { id: genId(), title: tr('defaultSfxTitle'), descriptionFr: '', descriptionEn: '', rrMode: 'random', duckMainTrack: false, alternatives: [], folderId: null };
  sfxLibrary.push(newSfx);
  manageSfxSelectedId = newSfx.id;
  hasUnsavedEdits = true;
  trackBackstageEvent('sfx_add', {});
  renderSfxLibrary();
});
(function wireSfxLibraryDrop() {
  const host = document.getElementById('sfxLibraryDrop');
  if (!host) return;
  // Le statut admin n'est connu qu'après coup (RPC) : vérifié au moment du dépôt. Pour un non-admin, le
  // dépôt est avalé sans effet (sinon le navigateur ouvrirait le fichier et quitterait la page).
  wireBatchDrop(host, files => { if (flagOpen('bulk_drop')) openSfxBatchDropDialog(files); });
  host.addEventListener('dragover', e => { if (!flagOpen('bulk_drop')) host.classList.remove('drag-over'); });
  host.addEventListener('drop', e => e.preventDefault());
})();
document.getElementById('btnAddSfxFolder').addEventListener('click', () => {
  sfxFolders.push({ id: genId(), label: tr('defaultOrgFolderLabel', { n: sfxFolders.length + 1 }) });
  hasUnsavedEdits = true;
  renderSfxLibrary();
});
document.getElementById('sfxLibraryContainer').addEventListener('click', async e => {
  const selectBtn = e.target.closest('[data-action="select-manage-sfx"]');
  if (selectBtn) { manageSfxSelectedId = selectBtn.dataset.dragId; renderSfxLibrary(); return; }
  const entryBtn = e.target.closest('[data-action="select-sfx-entry"]');
  if (entryBtn) {
    sfxSelectedEntry.set(manageSfxSelectedId, entryBtn.dataset.entry);
    renderSfxLibrary();
    return;
  }
  const folderToggleBtn = e.target.closest('[data-action="toggle-sfx-folder"]');
  if (folderToggleBtn) {
    const fid = folderToggleBtn.dataset.folderId;
    if (collapsedSfxFolderIds.has(fid)) collapsedSfxFolderIds.delete(fid); else collapsedSfxFolderIds.add(fid);
    renderSfxLibrary();
    return;
  }
  const folderDeleteBtn = e.target.closest('[data-action="delete-sfx-folder"]');
  if (folderDeleteBtn) {
    const fid = folderDeleteBtn.dataset.folderId;
    if (await deleteOrgFolder(sfxFolders, sfxLibrary, fid)) {
      collapsedSfxFolderIds.delete(fid);
      hasUnsavedEdits = true;
      renderSfxLibrary();
    }
    return;
  }
  const protectBtn = e.target.closest('[data-action="toggle-sfx-protection"]');
  if (protectBtn) {
    const sfx = sfxLibrary[parseInt(protectBtn.dataset.si, 10)];
    const target = !sfx.protected;
    if (!await window.LayerPitchNotify.confirm(tr(target ? 'sfxProtectConfirm' : 'sfxUnprotectConfirm', { title: sfx.title || sfx.id }), { okLabel: tr(target ? 'trackProtectBtn' : 'trackUnprotectBtn') })) return;
    protectBtn.disabled = true; protectBtn.textContent = tr('trackProtectBusy');
    try {
      await loadPostgresReadScripts();
      const r = await window.LayerPitchSfx.setSfxProtected(sfx.id, target);
      if (!r.ok) window.LayerPitchNotify.error(tr('trackProtectError', { error: r.error }));
      else { sfx.protected = target; window.LayerPitchNotify.info(tr(target ? 'trackProtectDone' : 'trackUnprotectDone')); }
    } catch (err) { window.LayerPitchNotify.error(tr('trackProtectError', { error: err.message })); }
    renderSfxLibrary();
    return;
  }
  const removeBtn = e.target.closest('[data-action="remove-sfx"]');
  if (removeBtn) {
    const si = parseInt(removeBtn.dataset.si, 10);
    const removedId = sfxLibrary[si].id;
    pendingR2Deletes.set('sfx:' + removedId, sfxRemoteFileKeys(sfxLibrary[si])); // effacés à la publication, voir pendingR2Deletes
    sfxLibrary.splice(si, 1);
    // Nettoie toutes les références à ce Sfx désormais supprimé — morceaux, packs, blocs de contenu —
    // sinon un id orphelin resterait silencieusement ignoré à la publication.
    library.forEach(t => { if (t.sfxIds) t.sfxIds = t.sfxIds.filter(id => id !== removedId); });
    packs.forEach(p => { if (p.sfxIds) p.sfxIds = p.sfxIds.filter(id => id !== removedId); });
    adReels.forEach(ar => ar.blocks.forEach(b => { if (b.type === 'sfx' && b.sfxIds) b.sfxIds = b.sfxIds.filter(id => id !== removedId); }));
    sfxSelectedEntry.delete(removedId);
    hasUnsavedEdits = true;
    trackBackstageEvent('sfx_remove', {});
    renderSfxLibrary();
    renderLibrary();
    renderPacks();
    rebuildAllCards();
    return;
  }
  const addAltBtn = e.target.closest('[data-action="add-sfx-alt"]');
  if (addAltBtn) {
    const si = parseInt(addAltBtn.dataset.si, 10);
    sfxLibrary[si].alternatives.push({ label: '', remoteFile: null, pendingFile: null });
    hasUnsavedEdits = true;
    renderSfxLibrary();
    return;
  }
  const removeAltBtn = e.target.closest('[data-action="remove-sfx-alt"]');
  if (removeAltBtn) {
    const si = parseInt(removeAltBtn.dataset.si, 10);
    const ai = parseInt(removeAltBtn.dataset.ai, 10);
    const removedAlt = sfxLibrary[si].alternatives[ai];
    if (removedAlt && removedAlt.remoteFile) queueR2Delete(`audio/sfx-${sfxLibrary[si].id}/${removedAlt.remoteFile}`); // effacé à la publication, voir pendingOrphanR2Keys
    sfxLibrary[si].alternatives.splice(ai, 1);
    hasUnsavedEdits = true;
    renderSfxLibrary();
    return;
  }
});
document.getElementById('sfxLibraryContainer').addEventListener('input', e => {
  const folderField = e.target.dataset.sfxFolderField;
  if (folderField === 'label') {
    const folder = sfxFolders.find(f => f.id === e.target.dataset.folderId);
    if (folder) { folder.label = e.target.value; hasUnsavedEdits = true; }
    return;
  }
  const field = e.target.dataset.sfxField;
  const altField = e.target.dataset.sfxAltField;
  if (field) {
    const si = parseInt(e.target.dataset.si, 10);
    const sfx = sfxLibrary[si];
    const value = (e.target.type === 'checkbox') ? e.target.checked : e.target.value;
    sfx[field] = value;
    hasUnsavedEdits = true;
    if (field === 'title') {
      // Le titre est éditable à deux endroits (en-tête du détail + entrée Identité), synchronisés en
      // direct sans re-rendu -- même principe que Pack/Collection. La ligne correspondante dans la liste
      // maître (à gauche) est aussi patchée directement, pour la même raison.
      document.querySelectorAll('#sfxLibraryDetail [data-sfx-field="title"]').forEach(inp => { if (inp !== e.target) inp.value = e.target.value; });
      const masterLabel = document.querySelector(`#sfxLibraryMaster .org-row[data-drag-id="${sfx.id}"] .seq-master-item-label`);
      if (masterLabel) masterLabel.textContent = e.target.value || tr('sfxFallback', { n: si + 1 });
      packSfxRefreshers.forEach(fn => fn());
      rebuildAllCards(); // les blocs de contenu "Sfx" affichent aussi ce titre dans leur sélecteur
    }
  } else if (altField) {
    const si = parseInt(e.target.dataset.si, 10);
    const ai = parseInt(e.target.dataset.ai, 10);
    sfxLibrary[si].alternatives[ai][altField] = e.target.value;
    hasUnsavedEdits = true;
  }
});

