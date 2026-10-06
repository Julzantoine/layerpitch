document.getElementById('btnAddLibraryTrack').addEventListener('click', () => {
  const newTrack = { id: genId(), title: tr('defaultTrackTitle'), description: '', mode: 'vertical', duration: 0, base: '', loopable: false, startTrackBeat: 0, maxLoops: null, maxChainLoops: null, normalizeVolume: false, layers: [{ id: genId(), label: tr('defaultLevelLabel'), remoteFile: null, pendingFile: null }], stingers: [], sfxIds: [], folderId: null };
  library.push(newTrack);
  manageLibrarySelectedId = newTrack.id;
  hasUnsavedEdits = true;
  trackBackstageEvent('track_add', {});
  renderLibrary();
  if (blockTracksRefresh) blockTracksRefresh(); packTracksRefreshers.forEach(fn => fn());
});
document.getElementById('btnAddLibraryFolder').addEventListener('click', () => {
  libraryFolders.push({ id: genId(), label: tr('defaultOrgFolderLabel', { n: libraryFolders.length + 1 }) });
  hasUnsavedEdits = true;
  renderLibrary();
});
document.getElementById('libraryContainer').addEventListener('click', async e => {
  const selectBtn = e.target.closest('[data-action="select-manage-track"]');
  if (selectBtn) { manageLibrarySelectedId = selectBtn.dataset.dragId; renderLibrary(); return; }
  const folderToggleBtn = e.target.closest('[data-action="toggle-library-folder"]');
  if (folderToggleBtn) {
    const fid = folderToggleBtn.dataset.folderId;
    if (collapsedLibraryFolderIds.has(fid)) collapsedLibraryFolderIds.delete(fid); else collapsedLibraryFolderIds.add(fid);
    renderLibrary();
    return;
  }
  const folderDeleteBtn = e.target.closest('[data-action="delete-library-folder"]');
  if (folderDeleteBtn) {
    const fid = folderDeleteBtn.dataset.folderId;
    if (await deleteOrgFolder(libraryFolders, library, fid)) {
      collapsedLibraryFolderIds.delete(fid);
      hasUnsavedEdits = true;
      renderLibrary();
    }
    return;
  }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const ti = parseInt(btn.dataset.ti, 10);
  const li = btn.dataset.li !== undefined ? parseInt(btn.dataset.li, 10) : null;
  const si = btn.dataset.si !== undefined ? parseInt(btn.dataset.si, 10) : null;
  const gi = btn.dataset.gi !== undefined ? parseInt(btn.dataset.gi, 10) : null;
  const ai = btn.dataset.ai !== undefined ? parseInt(btn.dataset.ai, 10) : null;
  const fli = btn.dataset.fli !== undefined ? parseInt(btn.dataset.fli, 10) : null;
  const pi = btn.dataset.pi !== undefined ? parseInt(btn.dataset.pi, 10) : null;
  const bi = btn.dataset.bi !== undefined ? parseInt(btn.dataset.bi, 10) : null;
  const tri = btn.dataset.tri !== undefined ? parseInt(btn.dataset.tri, 10) : null;
  if (btn.dataset.action === 'select-seq-slot') {
    // Pure sélection d'affichage (colonne de droite) -- ne touche à aucune donnée du morceau.
    // dataset.seqKey porte les 3 entrées virtuelles ('trackinfo'/'sfx'/'infos'), dataset.si (déjà
    // parsé en nombre plus haut) porte l'index d'un vrai emplacement de la Chaîne de lecture.
    seqSelectedSlotIndex.set(library[ti].id, btn.dataset.seqKey !== undefined ? btn.dataset.seqKey : si);
    renderLibrary();
    return;
  }
  if (btn.dataset.action === 'duplicate-track') {
    btn.disabled = true;
    try { await duplicateLibraryTrack(library[ti]); } finally { btn.disabled = false; }
    return;
  }
  if (btn.dataset.action === 'recompute-track-normalization') {
    const track = library[ti];
    btn.disabled = true; btn.textContent = tr('normalizeRecomputeBusy');
    try {
      const r = await recomputeTrackNormalization(track);
      window.LayerPitchNotify.info(tr(r.missing ? 'normalizeRecomputeDonePartial' : 'normalizeRecomputeDone', { lufs: r.lufs == null ? '?' : r.lufs.toFixed(1), n: r.missing }));
    } catch (e) { window.LayerPitchNotify.error(tr('normalizeRecomputeError', { error: e.message })); }
    renderLibrary();
    return;
  }
  if (btn.dataset.action === 'toggle-track-protection') {
    const track = library[ti];
    const target = !track.protected;
    window.LayerPitchNotify.confirm(tr(target ? 'trackProtectConfirm' : 'trackUnprotectConfirm', { title: track.title || track.id }), { okLabel: tr(target ? 'trackProtectBtn' : 'trackUnprotectBtn') }).then(async ok => {
      if (!ok) return;
      btn.disabled = true; btn.textContent = tr('trackProtectBusy');
      try {
        await loadPostgresReadScripts();
        const r = await window.LayerPitchTracks.setTrackProtected(track.id, target);
        if (!r.ok) { window.LayerPitchNotify.error(tr('trackProtectError', { error: r.error })); }
        else { track.protected = target; window.LayerPitchNotify.info(tr(target ? 'trackProtectDone' : 'trackUnprotectDone')); }
      } catch (e) { window.LayerPitchNotify.error(tr('trackProtectError', { error: e.message })); }
      renderLibrary();
    });
    return;
  }
  if (btn.dataset.action === 'preview-track') {
    togglePreview(ti, btn.closest('.list-block'));
    trackBackstageEvent('preview_play', {});
    return;
  }
  if (btn.dataset.action === 'remove-track') {
    // Demande confirmation avant de retirer le morceau : il disparaît aussi des AdReels et Packs qui l'utilisent.
    const tk = library[ti];
    const usedIn = adReels.filter(a => a.trackIds.includes(tk.id)).length + packs.filter(p => (p.trackIds || []).includes(tk.id)).length;
    const title = tk.title || tr('trackFallback', { n: ti + 1 });
    if (!(await window.LayerPitchNotify.confirm(tr(usedIn ? 'deleteTrackConfirmUsed' : 'deleteTrackConfirm', { title, n: usedIn }), { danger: true }))) return;
    if (library[ti] !== tk) return; // données rechargées pendant la question : l'index ne désigne plus ce morceau
  }
  hasUnsavedEdits = true;
  if (btn.dataset.action === 'remove-track') {
    const removedId = library[ti].id;
    // Fichiers R2 effacés seulement après la suppression en base, à la publication (voir pendingR2Deletes).
    pendingR2Deletes.set('tracks:' + removedId, trackRemoteFileKeys(library[ti]));
    library.splice(ti, 1);
    adReels.forEach(a => { a.trackIds = a.trackIds.filter(id => id !== removedId); });
    packs.forEach(p => { p.trackIds = (p.trackIds || []).filter(id => id !== removedId); });
    trackBackstageEvent('track_delete', {});
  }
  else if (btn.dataset.action === 'add-fx-trigger') {
    const tk = library[ti];
    if (!tk.fxTriggers) tk.fxTriggers = [];
    const newTrigger = { id: genId(), label: tr('fxTriggerFallbackLabel', { n: tk.fxTriggers.length + 1 }), target: { type: 'track' }, fx: {}, visible: true, fadeSec: null }; // agit sur tout le morceau ; bouton public par défaut
    tk.fxTriggers.push(newTrigger);
    fxTriggersSectionOpen.add('c:' + newTrigger.id); // un trigger qu'on vient de créer s'affiche déplié
    fxTriggersPersistOpen();
  }
  else if (btn.dataset.action === 'add-fx-slider') {
    const tk = library[ti];
    if (!tk.fxSliders) tk.fxSliders = [];
    tk.fxSliders.push({ id: genId(), label: tr('fxSliderFallbackLabel', { n: tk.fxSliders.length + 1 }), defaultValue: 1, smoothSec: 0.15, visible: false, bindings: [], thresholds: [] });
  }
  else if (btn.dataset.action === 'remove-fx-slider') { library[ti].fxSliders.splice(parseInt(btn.dataset.sri, 10), 1); }
  else if (btn.dataset.action === 'add-fxs-binding') {
    const tk = library[ti], sl = tk.fxSliders[parseInt(btn.dataset.sri, 10)];
    sl.bindings = sl.bindings || [];
    sl.bindings.push({ target: { type: 'track' }, param: 'highcut.frequency', from: 400, to: 20000 });
  }
  else if (btn.dataset.action === 'fxsb-curve-reset') {
    const b = library[ti].fxSliders[parseInt(btn.dataset.sri, 10)].bindings[parseInt(btn.dataset.bi, 10)];
    delete b.curve; delete b.curveSmooth; delete fxCurveSelected[fxCurveKey(ti, btn.dataset.sri, btn.dataset.bi)];
  }
  else if (btn.dataset.action === 'fxsb-curve-smooth') {
    // Courbe lissée (27/09) : la case elle-même porte l'action ; son état coché est déjà à jour au moment du clic.
    const b = library[ti].fxSliders[parseInt(btn.dataset.sri, 10)].bindings[parseInt(btn.dataset.bi, 10)];
    if (btn.checked) b.curveSmooth = true; else delete b.curveSmooth;
  }
  else if (btn.dataset.action === 'fxsb-curve-remove') {
    const k = fxCurveKey(ti, btn.dataset.sri, btn.dataset.bi);
    const b = library[ti].fxSliders[parseInt(btn.dataset.sri, 10)].bindings[parseInt(btn.dataset.bi, 10)];
    const i = fxCurveSelected[k];
    if (b.curve && i != null && i > 0 && i < b.curve.length - 1) { b.curve.splice(i, 1); delete fxCurveSelected[k]; }
  }
  else if (btn.dataset.action === 'remove-fxs-binding') { library[ti].fxSliders[parseInt(btn.dataset.sri, 10)].bindings.splice(parseInt(btn.dataset.bi, 10), 1); }
  else if (btn.dataset.action === 'add-fxs-threshold') {
    const tk = library[ti], sl = tk.fxSliders[parseInt(btn.dataset.sri, 10)];
    const firstTrg = (tk.fxTriggers || []).find(d => d && d.id);
    sl.thresholds = sl.thresholds || [];
    if (firstTrg) sl.thresholds.push({ at: 0.25, mode: 'below', triggerId: firstTrg.id });
  }
  else if (btn.dataset.action === 'remove-fxs-threshold') { library[ti].fxSliders[parseInt(btn.dataset.sri, 10)].thresholds.splice(parseInt(btn.dataset.thi, 10), 1); }
  else if (btn.dataset.action === 'fx-trigger-to-track') { library[ti].fxTriggers[tri].target = { type: 'track' }; }
  else if (btn.dataset.action === 'add-fx-step') {
    const trg = library[ti].fxTriggers[tri];
    // Avec un chemin (data-sti) : étape ENFANT de celle-là ; sans : étape de premier niveau du trigger.
    let list;
    if (btn.dataset.sti != null && btn.dataset.sti !== '') { const at = fxStepByPath(trg, btn.dataset.sti); if (!at) return; at.step.children = at.step.children || []; list = at.step.children; }
    else { trg.steps = trg.steps || []; list = trg.steps; }
    const step = { id: genId(), label: '', delaySec: list.length ? (+list[list.length - 1].delaySec || 0) : 0, fx: {} };
    list.push(step);
    fxTriggersSectionOpen.add('s:' + trg.id + ':' + (btn.dataset.sti ? btn.dataset.sti + '-' : '') + (list.length - 1) + ':' + step.id); // une étape qu'on vient de créer s'affiche dépliée
    fxTriggersPersistOpen();
  }
  else if (btn.dataset.action === 'remove-fx-step') {
    const trg = library[ti].fxTriggers[tri];
    const at = fxStepByPath(trg, btn.dataset.sti);
    if (!at) return;
    at.list.splice(at.index, 1);
    // Nettoyage des « children » et « steps » devenus vides.
    const prune = list => list.forEach(x => { if (x.children) { prune(x.children); if (!x.children.length) delete x.children; } });
    prune(trg.steps || []);
    if (!trg.steps.length) delete trg.steps;
  }
  else if (btn.dataset.action === 'remove-fx-trigger') {
    const tk = library[ti];
    const removed = tk.fxTriggers[tri];
    tk.fxTriggers.splice(tri, 1);
    // Plus aucune action ne doit pointer vers un trigger supprimé.
    const purge = o => { if (o && o.fxActions) { o.fxActions = o.fxActions.filter(a => a.triggerId !== removed.id); if (!o.fxActions.length) o.fxActions = null; } };
    (tk.loops || []).forEach(purge);
    (tk.segmentSlots || []).forEach(sl => (sl.nextOptions || []).forEach(purge));
    // ... ni aucun seuil de curseur.
    (tk.fxSliders || []).forEach(sl => { if (sl.thresholds) sl.thresholds = sl.thresholds.filter(t => t.triggerId !== removed.id); });
    // ... ni aucune relation d'un autre trigger.
    (tk.fxTriggers || []).forEach(o => {
      const r = o.relations;
      if (!r) return;
      if (r.activates) r.activates = r.activates.filter(a => a.triggerId !== removed.id);
      if (r.cuts) r.cuts = r.cuts.filter(x => x !== removed.id);
      if (r.requires) r.requires = r.requires.filter(x => x !== removed.id);
    });
  }
  else if (btn.dataset.action === 'add-layer') library[ti].layers.push({ id: genId(), label: '', remoteFile: null, pendingFile: null });
  else if (btn.dataset.action === 'remove-layer') {
    const removedLayer = library[ti].layers[li];
    if (removedLayer && removedLayer.remoteFile) queueR2Delete(`audio/${library[ti].id}/${removedLayer.remoteFile}`);
    library[ti].layers.splice(li, 1);
    recomputeTrackDuration(library[ti]);
  }
  else if (btn.dataset.action === 'add-segment-slot') {
    if (!library[ti].segmentSlots) library[ti].segmentSlots = [];
    library[ti].segmentSlots.push({ id: genId(), label: '', avoidImmediateRepeat: true, alternatives: [{ label: '', bars: 8, remoteFile: null, pendingFile: null }] });
  }
  else if (btn.dataset.action === 'remove-segment-slot') {
    const removedSlot = library[ti].segmentSlots[si];
    const removedId = removedSlot.id;
    (removedSlot.alternatives || []).forEach(a => { if (a.remoteFile) queueR2Delete(`audio/${library[ti].id}/${a.remoteFile}`); });
    (removedSlot.nextOptions || []).forEach(opt => { if (opt.transition && opt.transition.remoteFile) queueR2Delete(`audio/${library[ti].id}/${opt.transition.remoteFile}`); });
    library[ti].segmentSlots.splice(si, 1);
    // Un emplacement qui dupliquait celui qu'on vient de supprimer revient à un contenu propre (vide)
    // plutôt que de garder une référence pendante vers un emplacement qui n'existe plus.
    library[ti].segmentSlots.forEach(sl => { if (sl.referencesSlotId === removedId) sl.referencesSlotId = null; });
  }
  else if (btn.dataset.action === 'add-slot-alternative') library[ti].segmentSlots[si].alternatives.push({ label: '', bars: 8, remoteFile: null, pendingFile: null });
  else if (btn.dataset.action === 'remove-slot-alternative') {
    const removedAlt = library[ti].segmentSlots[si].alternatives[ai];
    if (removedAlt && removedAlt.remoteFile) queueR2Delete(`audio/${library[ti].id}/${removedAlt.remoteFile}`);
    library[ti].segmentSlots[si].alternatives.splice(ai, 1);
  }
  else if (btn.dataset.action === 'add-section') {
    if (!library[ti].sections) library[ti].sections = [];
    library[ti].sections.push({ id: genId(), label: '', bars: 8, pools: [{ id: genId(), label: '', avoidImmediateRepeat: true, alternatives: [{ label: '', remoteFile: null, pendingFile: null }] }] });
  }
  else if (btn.dataset.action === 'remove-section') {
    const removedSection = library[ti].sections[si];
    const removedId = removedSection.id;
    (removedSection.pools || []).forEach(pool => (pool.alternatives || []).forEach(a => { if (a.remoteFile) queueR2Delete(`audio/${library[ti].id}/${a.remoteFile}`); }));
    library[ti].sections.splice(si, 1);
    // Une section qui dupliquait celle qu'on vient de supprimer revient à un contenu propre (vide)
    // plutôt que de garder une référence pendante vers une section qui n'existe plus.
    library[ti].sections.forEach(sec => { if (sec.referencesSectionId === removedId) sec.referencesSectionId = null; });
  }
  else if (btn.dataset.action === 'add-pool') library[ti].sections[si].pools.push({ id: genId(), label: '', avoidImmediateRepeat: true, alternatives: [{ label: '', remoteFile: null, pendingFile: null }] });
  else if (btn.dataset.action === 'remove-pool') {
    const removedPool = library[ti].sections[si].pools[pi];
    (removedPool.alternatives || []).forEach(a => { if (a.remoteFile) queueR2Delete(`audio/${library[ti].id}/${a.remoteFile}`); });
    library[ti].sections[si].pools.splice(pi, 1);
  }
  else if (btn.dataset.action === 'add-pool-alt') library[ti].sections[si].pools[pi].alternatives.push({ label: '', remoteFile: null, pendingFile: null });
  else if (btn.dataset.action === 'remove-pool-alt') {
    const removedAlt = library[ti].sections[si].pools[pi].alternatives[ai];
    if (removedAlt && removedAlt.remoteFile) queueR2Delete(`audio/${library[ti].id}/${removedAlt.remoteFile}`);
    library[ti].sections[si].pools[pi].alternatives.splice(ai, 1);
  }
  else if (btn.dataset.action === 'add-embr-loop') {
    if (!library[ti].loops) library[ti].loops = [];
    library[ti].loops.push({ id: genId(), label: '', bars: 8, isInitial: library[ti].loops.length === 0, remoteFile: null, pendingFile: null, switchQuantize: 'immediate', autoReturnEnabled: false, autoReturnValue: 4, autoReturnUnit: 'bars', detourMode: 'once', endLoopButtonLabel: '', isDetour: false, cutStyle: 'fade', customCutFadeSec: null, transition: null });
  }
  else if (btn.dataset.action === 'remove-embr-loop') {
    const removedLoop = library[ti].loops[li];
    if (removedLoop && removedLoop.remoteFile) queueR2Delete(`audio/${library[ti].id}/${removedLoop.remoteFile}`);
    if (removedLoop && removedLoop.transition && removedLoop.transition.remoteFile) queueR2Delete(`audio/${library[ti].id}/${removedLoop.transition.remoteFile}`);
    library[ti].loops.splice(li, 1);
    // La boucle de référence vient d'être supprimée : la première boucle restante en hérite plutôt que
    // de laisser le morceau sans aucune référence (voir garde-fou au rendu, qui ferait la même chose,
    // mais autant fixer l'état tout de suite pour rester cohérent avant même le prochain rendu).
    if (removedLoop && removedLoop.isInitial && library[ti].loops.length) library[ti].loops[0].isInitial = true;
  }
  else if (btn.dataset.action === 'add-branch-option') {
    const slot = library[ti].segmentSlots[si];
    if (!slot.nextOptions) slot.nextOptions = [];
    // Cible par défaut : le premier autre emplacement de la chaîne (autre que soi-même) s'il y en a un —
    // sinon soi-même (auto-boucle explicite), pour ne jamais créer une option invalide dès l'ajout.
    const firstOther = library[ti].segmentSlots.find(sl => sl.id !== slot.id);
    slot.nextOptions.push({ targetId: (firstOther || slot).id, label: '' });
  }
  else if (btn.dataset.action === 'remove-branch-option') {
    const removedOpt = library[ti].segmentSlots[si].nextOptions[bi];
    if (removedOpt && removedOpt.transition && removedOpt.transition.remoteFile) queueR2Delete(`audio/${library[ti].id}/${removedOpt.transition.remoteFile}`);
    library[ti].segmentSlots[si].nextOptions.splice(bi, 1);
  }
  renderLibrary();
  if (blockTracksRefresh) blockTracksRefresh(); packTracksRefreshers.forEach(fn => fn());
});
document.getElementById('libraryContainer').addEventListener('input', e => {
  const folderField = e.target.dataset.libraryFolderField;
  if (folderField === 'label') {
    const folder = libraryFolders.find(f => f.id === e.target.dataset.folderId);
    if (folder) { folder.label = e.target.value; hasUnsavedEdits = true; }
    return;
  }
  const field = e.target.dataset.field;
  hasUnsavedEdits = true;
  if (field) {
    const ti = parseInt(e.target.dataset.ti, 10);
    const li = e.target.dataset.li !== undefined ? parseInt(e.target.dataset.li, 10) : null;
    if (field === 'title') {
      library[ti].title = e.target.value;
      // La ligne correspondante dans la liste maître (à gauche) est patchée directement, sans re-rendu
      // complet, pour ne pas perdre le focus/curseur en cours de frappe -- même principe que Sfx/Pack.
      const masterLabel = document.querySelector(`#libraryMaster .org-row[data-drag-id="${library[ti].id}"] .seq-master-item-label`);
      if (masterLabel) masterLabel.textContent = e.target.value || tr('trackFallback', { n: ti + 1 });
      if (blockTracksRefresh) blockTracksRefresh(); packTracksRefreshers.forEach(fn => fn());
    }
    else if (field === 'mode') {
      library[ti].mode = e.target.value;
      if (e.target.value === 'vertical-random') {
        if (!library[ti].intro) library[ti].intro = { label: 'Intro', bars: 8, remoteFile: null, pendingFile: null };
        if (!library[ti].outro) library[ti].outro = { label: 'Outro', remoteFile: null, pendingFile: null };
        if (!library[ti].sections) library[ti].sections = [];
        if (library[ti].randomizeSections === undefined) library[ti].randomizeSections = false;
      }
      if (e.target.value === 'sequential') {
        if (!library[ti].bpm) { library[ti].bpm = 120; library[ti].beatsPerBar = 4; }
        if (!library[ti].intro) library[ti].intro = { label: 'Intro', bars: 8, remoteFile: null, pendingFile: null };
        if (!library[ti].outro) library[ti].outro = { label: 'Outro', bars: 8, remoteFile: null, pendingFile: null };
        if (!library[ti].segmentSlots) library[ti].segmentSlots = [];
      }
      if (e.target.value === 'embranchement-vertical') {
        if (!library[ti].bpm) { library[ti].bpm = 120; library[ti].beatsPerBar = 4; }
        if (!library[ti].loops) library[ti].loops = [];
      }
      renderLibrary();
      return;
    }
    else if (field === 'loopable') { library[ti].loopable = e.target.checked; renderLibrary(); return; }
    else if (field === 'loopEngine') {
      library[ti].loopEngine = e.target.value;
      if (e.target.value === 'quantized' && !library[ti].bpm) {
        library[ti].bpm = 120;
        library[ti].beatsPerBar = 4;
        library[ti].loopGridUnit = 'bars';
        library[ti].loopInBeat = 0;
        library[ti].loopOutBeat = 16;
      }
      renderLibrary();
      return;
    }
    else if (field === 'bpm') { library[ti].bpm = parseFloat(e.target.value) || 120; }
    else if (field === 'beatsPerBar') { library[ti].beatsPerBar = parseInt(e.target.value, 10) || 4; }
    else if (field === 'maxLoops') { library[ti].maxLoops = e.target.value === '' ? null : parseInt(e.target.value, 10); }
    else if (field === 'maxChainLoops') { library[ti].maxChainLoops = e.target.value === '' ? null : parseInt(e.target.value, 10); }
    else if (field === 'normalizeVolume') {
      library[ti].normalizeVolume = e.target.checked;
      library[ti]._normDirty = e.target.checked; // le gain unique est (re)calculé à la prochaine publication
      renderLibrary(); // le bouton « Recalculer » apparaît/disparaît
      return;
    }
    else if (field === 'introLabel') { library[ti].intro.label = e.target.value; }
    else if (field === 'introBars') { library[ti].intro.bars = parseInt(e.target.value, 10) || 8; }
    else if (field === 'introBpm') { library[ti].intro.bpm = parseFloat(e.target.value) || null; }
    else if (field === 'introBeatsPerBar') { library[ti].intro.beatsPerBar = parseInt(e.target.value, 10) || null; }
    else if (field === 'introDescriptionFr') { library[ti].intro.descriptionFr = e.target.value; }
    else if (field === 'introDescriptionEn') { library[ti].intro.descriptionEn = e.target.value; }
    else if (field === 'outroLabel') { library[ti].outro.label = e.target.value; }
    else if (field === 'outroDescriptionFr') { library[ti].outro.descriptionFr = e.target.value; }
    else if (field === 'outroDescriptionEn') { library[ti].outro.descriptionEn = e.target.value; }
    else if (field === 'randomizeSections') { library[ti].randomizeSections = e.target.checked; }
    else if (field === 'seqSlotOrder') { library[ti].randomizeSections = e.target.checked; renderLibrary(); } // re-rendu : l'étiquette "aléatoire" de la liste de gauche
    else if (field === 'description') library[ti].description = e.target.value;
    else if (field === 'tags') library[ti].tags = e.target.value;
    else if (field === 'implementationNote') library[ti].implementationNote = e.target.value;
    else if (field === 'noAiOverride') {
      library[ti].noAiOverride = e.target.value === '' ? null : (e.target.value === 'true');
      renderLibrary(); // le libellé de l'option "suivre le réglage global" affiche l'état effectif (oui/non)
    }
    else if (field === 'label') library[ti].layers[li].label = e.target.value;
    else if (field === 'fxTrigger') {
      const trg = (library[ti].fxTriggers || [])[parseInt(e.target.dataset.tri, 10)];
      const prop = e.target.dataset.fxtProp;
      if (trg) {
        if (prop === 'label') trg.label = e.target.value;
        else if (prop === 'visible') trg.visible = e.target.checked;
        else if (prop === 'showEffects') trg.showEffects = e.target.checked;
        else if (prop === 'fadeSec') trg.fadeSec = e.target.value === '' ? null : parseFloat(e.target.value);
        else if (prop === 'fadeOutSec') trg.fadeOutSec = e.target.value === '' ? null : parseFloat(e.target.value);
        else if (prop === 'target') trg.target = parseFxTriggerTarget(e.target.value);
        else if (prop === 'autoOffSec') { trg.relations = trg.relations || {}; trg.relations.autoOffSec = e.target.value === '' ? null : parseFloat(e.target.value); }
      }
    }
    else if (field === 'fxStep') {
      const trg = (library[ti].fxTriggers || [])[parseInt(e.target.dataset.tri, 10)];
      const at = trg && fxStepByPath(trg, e.target.dataset.sti), st = at && at.step;
      const prop = e.target.dataset.fxsProp;
      if (st) {
        if (prop === 'label') st.label = e.target.value;
        else if (prop === 'delaySec') st.delaySec = e.target.value === '' ? 0 : Math.max(0, parseFloat(e.target.value) || 0);
        else if (prop === 'fadeSec' || prop === 'fadeOutSec') { const v = parseFloat(e.target.value); if (e.target.value !== '' && v >= 0) st[prop] = v; else delete st[prop]; }
        else if (prop === 'durationSec') { const v = parseFloat(e.target.value); if (v > 0) st.durationSec = v; else delete st.durationSec; }
      }
    }
    else if (field === 'fxSlider') {
      const sl = (library[ti].fxSliders || [])[parseInt(e.target.dataset.sri, 10)];
      const prop = e.target.dataset.fxsProp;
      if (sl) {
        if (prop === 'label') sl.label = e.target.value;
        else if (prop === 'visible') sl.visible = e.target.checked;
        else if (prop === 'defaultValue') sl.defaultValue = Math.max(0, Math.min(1, (parseFloat(e.target.value) || 0) / 100));
        else if (prop === 'smoothSec') sl.smoothSec = e.target.value === '' ? 0.15 : Math.max(0, parseFloat(e.target.value) || 0);
        else if (prop === 'intensity') {
          // Un seul curseur pilote la structure : l'activer ici le retire des autres. Il devient visible, puisqu'il remplace
          // les boutons du visiteur.
          if (e.target.checked) {
            library[ti].fxSliders.forEach(o => { if (o !== sl) delete o.intensity; });
            sl.intensity = { bounds: [] };
            sl.visible = true;
          } else delete sl.intensity;
          hasUnsavedEdits = true; renderLibrary(); return;
        }
      }
    }
    else if (field === 'fxSliderIntensityBound') {
      const sl = (library[ti].fxSliders || [])[parseInt(e.target.dataset.sri, 10)];
      if (sl && sl.intensity) {
        const n = window.LayerPlayerCore.fxStructureZones(library[ti]).length;
        const bounds = window.LayerPlayerCore.fxIntensityBounds(sl.intensity.bounds, n) || [];
        bounds[parseInt(e.target.dataset.ib, 10)] = Math.max(0, Math.min(1, (parseFloat(e.target.value) || 0) / 100));
        sl.intensity.bounds = bounds; // pas de re-rendu ni de tri pendant la frappe (focus) : le lecteur trie à la lecture
      }
    }
    else if (field === 'fxSliderBinding') {
      const sl = (library[ti].fxSliders || [])[parseInt(e.target.dataset.sri, 10)];
      const b = sl && (sl.bindings || [])[parseInt(e.target.dataset.bi, 10)];
      const prop = e.target.dataset.fxsbProp;
      if (b) {
        if (prop === 'target') {
          const wasSfx = !!(b.target && b.target.type === 'sfx');
          b.target = parseFxTriggerTarget(e.target.value);
          const isSfx = b.target && b.target.type === 'sfx';
          if (wasSfx !== isSfx) { // voix <-> Sfx : le paramètre et les bornes changent de nature
            if (isSfx) { b.param = 'spatial.distance'; b.from = 2; b.to = 20; } else { b.param = 'highcut.frequency'; b.from = 400; b.to = 20000; }
            hasUnsavedEdits = true; renderLibrary(); return;
          }
        }
        else if (prop === 'param') {
          // Changer de paramètre remet des bornes « 0 % -> 100 % » adaptées à sa nature (400 -> 20000 n'a aucun sens pour des demi-tons).
          b.param = e.target.value;
          const r = FX_SLIDER_DEFAULT_RANGE[b.param];
          if (r) { b.from = r[0]; b.to = r[1]; delete b.curve; }
          hasUnsavedEdits = true; renderLibrary(); return;
        }
        else if (prop === 'from') b.from = parseFloat(e.target.value);
        else if (prop === 'to') b.to = parseFloat(e.target.value);
      }
    }
    else if (field === 'fxSliderThreshold') {
      const sl = (library[ti].fxSliders || [])[parseInt(e.target.dataset.sri, 10)];
      const t = sl && (sl.thresholds || [])[parseInt(e.target.dataset.thi, 10)];
      const prop = e.target.dataset.fxstProp;
      if (t) {
        if (prop === 'mode') t.mode = e.target.value;
        else if (prop === 'at') t.at = Math.max(0, Math.min(1, (parseFloat(e.target.value) || 0) / 100));
        else if (prop === 'triggerId') t.triggerId = e.target.value;
      }
    }
    else if (field === 'fxRel') {
      const trg = (library[ti].fxTriggers || [])[parseInt(e.target.dataset.tri, 10)];
      const other = e.target.dataset.relOther, kind = e.target.dataset.relKind;
      if (trg && other) {
        const rel = trg.relations = trg.relations || {};
        if (kind === 'activates') {
          rel.activates = (rel.activates || []).filter(a => a.triggerId !== other);
          if (e.target.checked) rel.activates.push({ triggerId: other, delaySec: 0 });
          hasUnsavedEdits = true; renderLibrary(); // la case « après N s » apparaît/disparaît
          return;
        } else if (kind === 'delay') {
          const a = (rel.activates || []).find(x => x.triggerId === other);
          if (a) a.delaySec = e.target.value === '' ? 0 : (parseFloat(e.target.value) || 0);
        } else if (kind === 'cuts' || kind === 'requires') {
          rel[kind] = (rel[kind] || []).filter(x => x !== other);
          if (e.target.checked) rel[kind].push(other);
        }
      }
    }
    else if (field === 'fxAction') {
      const owner = e.target.dataset.fxOwner;
      const obj = owner === 'loop' ? library[ti].loops[li] : library[ti].segmentSlots[parseInt(e.target.dataset.si, 10)].nextOptions[parseInt(e.target.dataset.bi, 10)];
      const id = e.target.dataset.fxTriggerId;
      if (obj) {
        obj.fxActions = (obj.fxActions || []).filter(a => a.triggerId !== id);
        if (e.target.value) obj.fxActions.push({ triggerId: id, active: e.target.value === 'on' });
        if (!obj.fxActions.length) obj.fxActions = null;
      }
    }
    else if (field === 'fx') {
      // data-fx-target dit à quel objet appliquer le réglage -- une seule chaîne de gestion pour les 4
      // modes plutôt qu'un bloc par mode (voir fxBlockHtml/layerFxHtml/loopFxHtml/slotFxHtml/poolFxHtml).
      const fxTarget = e.target.dataset.fxTarget || 'layer';
      let target;
      if (fxTarget === 'loop') target = library[ti].loops[li];
      else if (fxTarget === 'slot') target = library[ti].segmentSlots[parseInt(e.target.dataset.si, 10)];
      else if (fxTarget === 'pool') target = library[ti].sections[parseInt(e.target.dataset.si, 10)].pools[parseInt(e.target.dataset.pi, 10)];
      else if (fxTarget === 'track') target = library[ti];
      else if (fxTarget === 'trigger') target = library[ti].fxTriggers[parseInt(e.target.dataset.tri, 10)];
      else if (fxTarget === 'trstep') target = fxStepByPath(library[ti].fxTriggers[parseInt(e.target.dataset.tri, 10)], e.target.dataset.sti).step;
      else if (fxTarget === 'intro') target = library[ti].intro;
      else if (fxTarget === 'outro') target = library[ti].outro;
      else if (fxTarget === 'seqTransition') target = library[ti].segmentSlots[parseInt(e.target.dataset.si, 10)].nextOptions[parseInt(e.target.dataset.bi, 10)].transition;
      else if (fxTarget === 'embrTransition') target = library[ti].loops[li].transition;
      else target = li != null ? library[ti].layers[li] : library[ti].layers[0];
      if (!target) return;
      const effect = e.target.dataset.fxEffect;
      const param = e.target.dataset.fxParam;
      if (param === 'enabled') {
        if (e.target.checked) {
          target.fx = target.fx || {};
          // Le pitch de morceau entier (mode "rate" implicite) a ses propres valeurs de départ, distinctes
          // du pitch par élément ("shift") -- voir FX_TRACK_DEFAULTS.
          target.fx[effect] = (fxTarget === 'track' && FX_TRACK_DEFAULTS[effect]) ? FX_TRACK_DEFAULTS[effect]() : FX_DEFAULTS[effect]();
        } else if (target.fx) {
          delete target.fx[effect];
          if (!Object.keys(target.fx).length) delete target.fx;
        }
        renderLibrary();
        return;
      }
      if (!target.fx || !target.fx[effect]) return;
      // Champ numérique vidé volontairement (ex. "fadeFrom..." optionnel) : null plutôt que NaN --
      // un champ de fondu vide veut dire "pas de fondu", pas "fondu vers zéro".
      target.fx[effect][param] = (e.target.tagName === 'SELECT') ? (param === 'slope' ? parseInt(e.target.value, 10) : e.target.value) : (e.target.value === '' ? null : parseFloat(e.target.value));
      // Changer le mode du pitch affecte quels champs sont affichés (le fondu n'a de sens qu'en mode
      // "rate", cf. fxBlockHtml) -- seul cas de la chaîne fx qui a besoin d'un re-rendu complet.
      if (effect === 'pitch' && param === 'mode') renderLibrary();
    }
  } else if (e.target.dataset.slotField) {
    const ti = parseInt(e.target.dataset.ti, 10);
    const si = parseInt(e.target.dataset.si, 10);
    const slot = library[ti].segmentSlots[si];
    if (e.target.dataset.slotField === 'label') slot.label = e.target.value;
    else if (e.target.dataset.slotField === 'avoidImmediateRepeat') slot.avoidImmediateRepeat = e.target.checked;
    else if (e.target.dataset.slotField === 'repeatCount') slot.repeatCount = Math.max(1, parseInt(e.target.value, 10) || 1);
    else if (e.target.dataset.slotField === 'referencesSlotId') {
      const isReferencedByOthers = library[ti].segmentSlots.some(sl => sl.referencesSlotId === slot.id);
      if (isReferencedByOthers) { renderLibrary(); return; } // garde-fou : un emplacement-source ne peut pas devenir lui-même un duplicata
      slot.referencesSlotId = e.target.value || null;
      renderLibrary();
    }
    else if (e.target.dataset.slotField === 'hasBranches') {
      if (e.target.checked) {
        // Une première option par défaut plutôt qu'une liste vide : évite un panneau "embranchements
        // activés" sans le moindre bouton pour le visiteur tant que le compositeur n'a rien ajouté.
        const firstOther = library[ti].segmentSlots.find(sl => sl.id !== slot.id);
        slot.nextOptions = [{ targetId: (firstOther || slot).id, label: '' }];
        expandedAltPoolKeys.add(`branches:${ti}:${si}`); // déplié tout de suite : on vient de l'activer, le cacher serait déroutant
      } else {
        slot.nextOptions = null;
      }
      renderLibrary();
    }
    else if (e.target.dataset.slotField === 'quantization') { slot.quantization = e.target.value; }
    else if (e.target.dataset.slotField === 'cutStyle') { slot.cutStyle = e.target.value; renderLibrary(); }
    // Curseur de durée : mise à jour directe de l'affichage à côté (pas de renderLibrary() ici, qui
    // recréerait le curseur en plein glissement et interromprait le drag en cours).
    else if (e.target.dataset.slotField === 'customCutFadeSec') {
      const v = parseFloat(e.target.value);
      slot.customCutFadeSec = v;
      const valueEl = e.target.parentElement.querySelector('[data-role="customCutFadeValue"]');
      if (valueEl) valueEl.textContent = v.toFixed(2) + 's';
    }
    // Champ vide = hérite du tempo du morceau (pas de valeur forcée comme le tempo par section du
    // vertical-random, qui lui n'a jamais de morceau à hériter) — voir joueur.js : slot.bpm || track.bpm || 120.
    else if (e.target.dataset.slotField === 'bpm') { slot.bpm = e.target.value === '' ? null : (parseFloat(e.target.value) || null); }
    else if (e.target.dataset.slotField === 'beatsPerBar') { slot.beatsPerBar = e.target.value === '' ? null : (parseInt(e.target.value, 10) || null); }
    else if (e.target.dataset.slotField === 'descriptionFr') slot.descriptionFr = e.target.value;
    else if (e.target.dataset.slotField === 'descriptionEn') slot.descriptionEn = e.target.value;
  } else if (e.target.dataset.slotAltField) {
    const ti = parseInt(e.target.dataset.ti, 10);
    const si = parseInt(e.target.dataset.si, 10);
    const ai = parseInt(e.target.dataset.ai, 10);
    const alt = library[ti].segmentSlots[si].alternatives[ai];
    if (e.target.dataset.slotAltField === 'label') alt.label = e.target.value;
    else if (e.target.dataset.slotAltField === 'bars') alt.bars = parseInt(e.target.value, 10) || 8;
  } else if (e.target.dataset.branchField) {
    const ti = parseInt(e.target.dataset.ti, 10);
    const si = parseInt(e.target.dataset.si, 10);
    const bi = parseInt(e.target.dataset.bi, 10);
    const opt = library[ti].segmentSlots[si].nextOptions[bi];
    if (e.target.dataset.branchField === 'targetId') opt.targetId = e.target.value;
    else if (e.target.dataset.branchField === 'label') opt.label = e.target.value;
    else if (e.target.dataset.branchField === 'hasTransition') {
      if (e.target.checked) opt.transition = { label: '', bars: 4, remoteFile: null, pendingFile: null };
      else opt.transition = null;
      renderLibrary();
    }
  } else if (e.target.dataset.branchTransitionField) {
    const ti = parseInt(e.target.dataset.ti, 10);
    const si = parseInt(e.target.dataset.si, 10);
    const bi = parseInt(e.target.dataset.bi, 10);
    const transition = library[ti].segmentSlots[si].nextOptions[bi].transition;
    if (e.target.dataset.branchTransitionField === 'label') transition.label = e.target.value;
    else if (e.target.dataset.branchTransitionField === 'bars') transition.bars = parseInt(e.target.value, 10) || 4;
    else if (e.target.dataset.branchTransitionField === 'durationUnit') { transition.durationUnit = e.target.value; renderLibrary(); }
    else if (e.target.dataset.branchTransitionField === 'durationSeconds') transition.durationSeconds = parseFloat(e.target.value) || 0;
    else if (e.target.dataset.branchTransitionField === 'durationBeats') transition.durationBeats = parseFloat(e.target.value) || 0;
    // Champs vides = hérite du tempo de l'emplacement source puis du morceau — voir player.js : transitionTiming().
    else if (e.target.dataset.branchTransitionField === 'bpm') transition.bpm = e.target.value === '' ? null : (parseFloat(e.target.value) || null);
    else if (e.target.dataset.branchTransitionField === 'beatsPerBar') transition.beatsPerBar = e.target.value === '' ? null : (parseInt(e.target.value, 10) || null);
    else if (e.target.dataset.branchTransitionField === 'descriptionFr') transition.descriptionFr = e.target.value;
    else if (e.target.dataset.branchTransitionField === 'descriptionEn') transition.descriptionEn = e.target.value;
  } else if (e.target.dataset.embrLoopField) {
    const ti = parseInt(e.target.dataset.ti, 10);
    const li = parseInt(e.target.dataset.li, 10);
    const loop = library[ti].loops[li];
    if (e.target.dataset.embrLoopField === 'label') loop.label = e.target.value;
    else if (e.target.dataset.embrLoopField === 'bars') loop.bars = parseInt(e.target.value, 10) || 8; // pas de re-rendu ici : perdrait le focus/curseur à chaque frappe (même principe que le titre des Packs) -- le classement paire/détour se remet à jour au prochain rendu naturel (changement de sélection, etc.)
    else if (e.target.dataset.embrLoopField === 'isInitial') {
      // Une seule boucle de référence à la fois (comportement de radio) : on nettoie les autres avant de
      // poser le nouveau drapeau, plutôt que de dépendre uniquement du groupement HTML `name` des radios.
      library[ti].loops.forEach(l => { l.isInitial = false; });
      loop.isInitial = true;
      renderLibrary(); // les indices "boucle courte / boucle paire" affichés dépendent tous de la référence
    }
    else if (e.target.dataset.embrLoopField === 'switchQuantize') loop.switchQuantize = e.target.value;
    else if (e.target.dataset.embrLoopField === 'autoReturnEnabled') { loop.autoReturnEnabled = e.target.checked; renderLibrary(); }
    else if (e.target.dataset.embrLoopField === 'autoReturnValue') loop.autoReturnValue = parseFloat(e.target.value) || 0;
    else if (e.target.dataset.embrLoopField === 'autoReturnUnit') loop.autoReturnUnit = e.target.value;
    else if (e.target.dataset.embrLoopField === 'detourMode') { loop.detourMode = e.target.value; renderLibrary(); }
    else if (e.target.dataset.embrLoopField === 'endLoopButtonLabel') loop.endLoopButtonLabel = e.target.value;
    else if (e.target.dataset.embrLoopField === 'isDetour') { loop.isDetour = e.target.checked; renderLibrary(); }
    else if (e.target.dataset.embrLoopField === 'bpm') loop.bpm = parseFloat(e.target.value) || null;
    else if (e.target.dataset.embrLoopField === 'beatsPerBar') loop.beatsPerBar = parseInt(e.target.value, 10) || null;
    else if (e.target.dataset.embrLoopField === 'cutStyle') { loop.cutStyle = e.target.value; renderLibrary(); }
    // Curseur de durée : mise à jour directe de l'affichage à côté (pas de renderLibrary() ici, qui
    // recréerait le curseur en plein glissement et interromprait le drag en cours) -- même principe que
    // customCutFadeSec du séquentiel.
    else if (e.target.dataset.embrLoopField === 'customCutFadeSec') {
      const v = parseFloat(e.target.value);
      loop.customCutFadeSec = v;
      const valueEl = e.target.parentElement.querySelector('[data-role="embrCustomCutFadeValue"]');
      if (valueEl) valueEl.textContent = v.toFixed(2) + 's';
    }
    else if (e.target.dataset.embrLoopField === 'hasTransition') {
      loop.transition = e.target.checked ? { label: '', remoteFile: null, pendingFile: null } : null;
      renderLibrary();
    }
    else if (e.target.dataset.embrLoopField === 'transitionLabel') loop.transition.label = e.target.value;
  } else if (e.target.dataset.embrTransitionField) {
    const ti = parseInt(e.target.dataset.ti, 10);
    const li = parseInt(e.target.dataset.li, 10);
    const transition = library[ti].loops[li].transition;
    // "auto" (29/08) : pas une vraie valeur stockée -- durationUnit reste absent, ce qui fait retomber
    // player.js (embrTransitionDurationSecFor()) sur la durée réelle du fichier décodé plutôt qu'un calcul
    // par mesures, comportement par défaut le plus sûr pour une transition d'embranchement-vertical (pas
    // de valeur "mesures" pré-remplie à la création, contrairement au séquentiel).
    if (e.target.dataset.embrTransitionField === 'durationUnit') {
      transition.durationUnit = e.target.value === 'auto' ? null : e.target.value;
      renderLibrary();
    }
    else if (e.target.dataset.embrTransitionField === 'bars') transition.bars = parseInt(e.target.value, 10) || 4;
    else if (e.target.dataset.embrTransitionField === 'durationBeats') transition.durationBeats = parseFloat(e.target.value) || 0;
    else if (e.target.dataset.embrTransitionField === 'durationSeconds') transition.durationSeconds = parseFloat(e.target.value) || 0;
    // Champs vides = hérite du tempo de la boucle quittée puis du morceau — voir player.js : embrTransitionDurationSecFor()/transitionTiming().
    else if (e.target.dataset.embrTransitionField === 'bpm') transition.bpm = e.target.value === '' ? null : (parseFloat(e.target.value) || null);
    else if (e.target.dataset.embrTransitionField === 'beatsPerBar') transition.beatsPerBar = e.target.value === '' ? null : (parseInt(e.target.value, 10) || null);
  } else if (e.target.dataset.sectionField) {
    const ti = parseInt(e.target.dataset.ti, 10);
    const si = parseInt(e.target.dataset.si, 10);
    const section = library[ti].sections[si];
    if (e.target.dataset.sectionField === 'label') section.label = e.target.value;
    else if (e.target.dataset.sectionField === 'bpm') section.bpm = parseFloat(e.target.value) || 120;
    else if (e.target.dataset.sectionField === 'beatsPerBar') section.beatsPerBar = parseInt(e.target.value, 10) || 4;
    else if (e.target.dataset.sectionField === 'maxLoops') section.maxLoops = e.target.value === '' ? null : parseInt(e.target.value, 10);
    else if (e.target.dataset.sectionField === 'referencesSectionId') {
      const isReferencedByOthers = library[ti].sections.some(s2 => s2.referencesSectionId === section.id);
      if (isReferencedByOthers) { renderLibrary(); return; } // garde-fou : une section-source ne peut pas devenir elle-même un duplicata
      section.referencesSectionId = e.target.value || null;
      renderLibrary();
    }
  } else if (e.target.dataset.poolField) {
    const ti = parseInt(e.target.dataset.ti, 10);
    const si = parseInt(e.target.dataset.si, 10);
    const pi = parseInt(e.target.dataset.pi, 10);
    const pool = library[ti].sections[si].pools[pi];
    if (e.target.dataset.poolField === 'label') pool.label = e.target.value;
    else if (e.target.dataset.poolField === 'avoidImmediateRepeat') pool.avoidImmediateRepeat = e.target.checked;
  } else if (e.target.dataset.poolAltField) {
    const ti = parseInt(e.target.dataset.ti, 10);
    const si = parseInt(e.target.dataset.si, 10);
    const pi = parseInt(e.target.dataset.pi, 10);
    const ai = parseInt(e.target.dataset.ai, 10);
    const alt = library[ti].sections[si].pools[pi].alternatives[ai];
    if (e.target.dataset.poolAltField === 'label') alt.label = e.target.value;
  } else if (e.target.dataset.roleSelect) {
    // Reclassification d'un bloc du mode séquentiel entre intro / segment / outro (utilisé après le
    // dépôt groupé, dont le rôle deviné par nom de fichier peut avoir besoin d'être corrigé).
    const ti = parseInt(e.target.dataset.ti, 10);
    const track = library[ti];
    const from = e.target.dataset.roleSelect;
    const to = e.target.value;
    if (from === to) return;
    let payload;
    if (from === 'intro') {
      payload = { label: track.intro.label, bars: track.intro.bars, remoteFile: track.intro.remoteFile, pendingFile: track.intro.pendingFile };
      track.intro = { label: 'Intro', bars: 8, remoteFile: null, pendingFile: null };
    } else if (from === 'outro') {
      payload = { label: track.outro.label, bars: 8, remoteFile: track.outro.remoteFile, pendingFile: track.outro.pendingFile };
      track.outro = { label: 'Outro', bars: 8, remoteFile: null, pendingFile: null };
    } else {
      // Un "segment" vit dans un emplacement (segmentSlots[si].alternatives[ai]) — on le retire de son
      // emplacement, et si celui-ci se retrouve vide, on le supprime aussi plutôt que de laisser un
      // emplacement fantôme sans aucune alternative.
      const si = parseInt(e.target.dataset.si, 10);
      const ai = parseInt(e.target.dataset.ai, 10);
      const slot = track.segmentSlots[si];
      payload = slot.alternatives[ai];
      slot.alternatives.splice(ai, 1);
      if (slot.alternatives.length === 0) track.segmentSlots.splice(si, 1);
    }
    if (to === 'intro') track.intro = { label: payload.label, bars: payload.bars || 8, remoteFile: payload.remoteFile, pendingFile: payload.pendingFile };
    else if (to === 'outro') track.outro = { label: payload.label, remoteFile: payload.remoteFile, pendingFile: payload.pendingFile };
    else track.segmentSlots.push({ id: genId(), label: payload.label, avoidImmediateRepeat: true, alternatives: [{ label: payload.label, bars: payload.bars || 8, remoteFile: payload.remoteFile, pendingFile: payload.pendingFile }] });
    hasUnsavedEdits = true;
    renderLibrary();
    return;
  }
});
// La timeline dépend du BPM/temps-par-mesure pour sa grille : on ne rafraîchit qu'à la sortie du
// champ ('change', pas 'input') pour ne pas perturber la frappe au clavier. Mais si un aperçu "Écouter"
// est ouvert pour ce morceau, on ne reconstruit pas non plus : renderLibrary() détruirait et recréerait
// tout le lecteur (donc son état interne, dont le pool tiré au sort en vertical-random) — la timeline
// restera juste sur l'ancien BPM le temps que l'aperçu se ferme ou qu'un autre rafraîchissement survienne.
document.getElementById('libraryContainer').addEventListener('change', e => {
  const field = e.target.dataset.field;
  const sectionField = e.target.dataset.sectionField;
  const isTimingField = (field === 'bpm' || field === 'beatsPerBar') || (sectionField === 'bpm' || sectionField === 'beatsPerBar');
  if (!isTimingField) return;
  const ti = parseInt(e.target.dataset.ti, 10);
  const previewId = 'preview-' + library[ti].id;
  if (activePreviewIds.has(previewId)) return;
  renderLibrary();
});

