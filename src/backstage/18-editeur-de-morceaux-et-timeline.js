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
        <div class="hint-inline">${tr('segmentSlotsOrderHint')}${currentUserIsAdmin ? ' ' + tr('altDuplicateHint') : ''}</div>
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

    if (!isSequential) {
      // ---- Disposition maître-détail généralisée à tous les modes non séquentiels (18/08) : mêmes 3
      // entrées virtuelles (Infos du morceau / Sfx / Infos additionnelles) qu'en séquentiel, réutilisant
      // seqSelectedSlotIndex (déjà générique, clé = track.id) et le même gestionnaire délégué
      // 'select-seq-slot' (aucune modification du câblage de clic nécessaire). Chaque mode ajoute ensuite
      // ses propres entrées sous les 3 virtuelles : couches (vertical), catégorie Structure avec
      // Intro/Sections/Outro (vertical-random), boucles nommées (embranchement-vertical), rien de plus
      // pour le statique.
      if (!track.sfxIds) track.sfxIds = [];
      if (isVerticalRandom) {
        if (!track.sections) track.sections = [];
        if (!track.intro) track.intro = { label: 'Intro', bars: 8, remoteFile: null, pendingFile: null };
        if (!track.outro) track.outro = { label: 'Outro', remoteFile: null, pendingFile: null };
        // Grille de mesures propre à l'intro (18/08, demande explicite ; enfin enregistrée et lue par
        // player.js le 25/09) : BPM/temps par mesure dédiés à l'intro. Volontairement PAS de valeur par défaut
        // écrite dans track.intro : tant que le compositeur n'y touche pas, l'intro suit le tempo de la
        // première section (comportement historique du lecteur) et les champs affichent ce tempo-là.
      } else if (isEmbrVert) {
        if (!track.loops) track.loops = [];
        track.loops.forEach(l => { if (!l.id) l.id = genId(); });
        if (track.loops.length && !track.loops.some(l => l.isInitial)) track.loops[0].isInitial = true;
      } else if (!isStatic) {
        // Migration douce (18/08) : les couches existantes n'avaient jamais besoin d'id avant le glisser-
        // déposer -- ajouté ici une fois pour toutes, jamais réécrit si déjà présent. Garde-fou aussi sur
        // l'existence même du tableau (un morceau créé directement dans un autre mode puis basculé vers
        // vertical n'a jamais eu de `layers`).
        if (!track.layers) track.layers = [];
        track.layers.forEach(l => { if (!l.id) l.id = genId(); });
      }

      const modeMasterHost = el.querySelector('[data-role="modeMaster"]');
      const modeDetailHost = el.querySelector('[data-role="modeDetail"]');
      const curSel = seqSelectedSlotIndex.get(track.id);
      if (curSel === undefined) {
        seqSelectedSlotIndex.set(track.id, 'trackinfo');
      } else if (typeof curSel === 'number') {
        const arrLen = isVerticalRandom ? track.sections.length : (isEmbrVert ? track.loops.length : (isStatic ? 0 : track.layers.length));
        if (curSel >= arrLen) seqSelectedSlotIndex.set(track.id, 'trackinfo');
      }
      const modeSel = seqSelectedSlotIndex.get(track.id);
      function modeMasterItem(key, labelHtml, dragId, isChild) {
        const item = document.createElement('div');
        item.className = 'seq-master-item' + (isChild ? ' seq-master-item-child' : '') + (modeSel === key ? ' active' : '');
        item.dataset.action = 'select-seq-slot';
        item.dataset.ti = ti;
        if (typeof key === 'number') item.dataset.si = key; else item.dataset.seqKey = key;
        if (dragId) item.dataset.dragId = dragId;
        item.innerHTML = labelHtml;
        return item;
      }

      // -- "Infos du morceau" : tout ce que le morceau comporte comme info pour ce mode -- titre/format
      // déjà en en-tête, fichier statique le cas échéant, tempo/mesures selon le mode, description,
      // harmonisation des volumes. Champs déplacés tels quels depuis l'ancien flux plat, jamais dupliqués.
      modeMasterHost.appendChild(modeMasterItem('trackinfo', `<div class="seq-master-item-label">${tr('seqTrackInfoLabel')}</div>`));
      if (modeSel === 'trackinfo') {
        const infoEl = document.createElement('div');
        infoEl.innerHTML = `
          ${isStatic ? `
            <label data-help="layersVertical">${tr('audioTrackLabel')}</label>
            <div data-role="staticFileCtrl" style="margin-top:6px;margin-bottom:4px"></div>
            <div class="hint-inline">${tr('staticDropHint')}</div>
            <div data-role="staticFxHost"></div>
            <label style="display:flex;align-items:center;gap:8px;margin-top:6px">
              <input type="checkbox" data-field="loopable" data-ti="${ti}" ${track.loopable ? 'checked' : ''} style="width:auto;margin:0;">
              <span data-help="loopableStatic" style="color:var(--text-dimmer);font-size:12px;">${tr('loopableHint')}</span>
            </label>
          ` : ''}
          ${(loops && !isVerticalRandom && !isEmbrVert) ? `
            <label data-help="loopEngine">${tr('loopEngineLabel')}</label>
            <select data-field="loopEngine" data-ti="${ti}">
              <option value="simple"${track.loopEngine !== 'quantized' ? ' selected' : ''}>${tr('loopEngineSimple')}</option>
              <option value="quantized"${track.loopEngine === 'quantized' ? ' selected' : ''}>${tr('loopEngineQuantized')}</option>
            </select>
            ${track.loopEngine === 'quantized' ? `
              <div class="row" style="margin-top:8px">
                <div><label data-help="bpmMeasuresQuantized">${tr('bpmLabel')}</label><input type="text" inputmode="decimal" data-field="bpm" data-ti="${ti}" value="${bpm}"></div>
                <div><label>${tr('beatsPerBarLabel')}</label><input type="text" inputmode="numeric" data-field="beatsPerBar" data-ti="${ti}" value="${beatsPerBar}"></div>
              </div>
              <label data-help="loopPointsQuantized" style="margin-top:8px">${tr('loopPointsLabel')}</label>
              <div data-role="loopTimelineHost" data-ti="${ti}"></div>
              <div class="hint-inline">${tr('loopTimelineHintQuantized')}</div>
              <label style="margin-top:10px">${tr('defaultLoopCountLabel')}</label>
              <select data-field="maxLoops" data-ti="${ti}">
                <option value=""${!track.maxLoops ? ' selected' : ''}>${tr('infiniteLoops')}</option>
                ${[1,2,3,5,10].map(n => `<option value="${n}"${track.maxLoops === n ? ' selected' : ''}>${n}</option>`).join('')}
              </select>
              <div class="hint-inline">${tr('loopCountVisitorHint')}</div>
            ` : ''}
          ` : ''}
          ${isVerticalRandom ? `
            <label style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" data-field="randomizeSections" data-ti="${ti}" ${track.randomizeSections ? 'checked' : ''} style="width:auto;margin:0;">
              <span data-help="randomizeSections" style="color:var(--text-dim);font-size:12px;">${tr('randomizeSectionsLabel')}</span>
            </label>
            <div class="hint-inline">${tr('randomizeSectionsHint')}</div>
            <label data-help="maxChainLoopsVerticalRandom" style="margin-top:14px">${tr('maxChainLoopsLabel')}</label>
            <select data-field="maxChainLoops" data-ti="${ti}">
              <option value=""${!track.maxChainLoops ? ' selected' : ''}>${tr('infiniteLoops')}</option>
              ${[1,2,3,5,10].map(n => `<option value="${n}"${track.maxChainLoops === n ? ' selected' : ''}>${n}</option>`).join('')}
            </select>
            <div class="hint-inline">${tr('maxChainLoopsHintVerticalRandom')}</div>
          ` : ''}
          <label data-help="trackDescription" style="margin-top:14px">${tr('descriptionLabel')}</label>
          <textarea class="linkable" data-field="description" data-ti="${ti}">${escapeHtml(track.description)}</textarea>
          <label style="margin-top:14px">${tr('trackTagsLabel')}</label>
          <input type="text" data-field="tags" data-ti="${ti}" value="${escapeAttr(track.tags || '')}">
          <div class="hint-inline">${tr('trackTagsHint')}</div>
          <label style="display:flex;align-items:center;gap:8px;margin-top:10px;">
            <input type="checkbox" data-field="normalizeVolume" data-ti="${ti}" ${track.normalizeVolume ? 'checked' : ''} style="width:auto;margin:0;">
            <span data-help="normalizeVolume" style="color:var(--text-dim);font-size:12px;">${tr('normalizeVolumeLabel')}</span>
          </label>
          ${trackPitchFxHtml(track, ti)}
          ${fxTriggersEditorHtml(track, ti)}
          ${fxSlidersEditorHtml(track, ti)}
        `;
        modeDetailHost.appendChild(infoEl);
        if (isStatic) {
          if (!track.layers || !track.layers[0]) track.layers = [{ id: genId(), label: '', remoteFile: null, pendingFile: null }];
          const staticCtrlHost = infoEl.querySelector('[data-role="staticFileCtrl"]');
          const layer0 = track.layers[0];
          staticCtrlHost.innerHTML = fileCtrlHtml(tr('chooseWavMp3'));
          const staticFxHost = infoEl.querySelector('[data-role="staticFxHost"]');
          if (staticFxHost) staticFxHost.innerHTML = layerFxHtml(layer0, ti, null);
          wireFileControl(staticCtrlHost, '.wav,audio/wav,.mp3,audio/mp3,audio/mpeg',
            () => layer0.pendingFile, () => layer0.remoteFile,
            f => {
              layer0.pendingFile = f;
              hasUnsavedEdits = true;
              if (!track.title || !track.title.trim() || track.title === tr('defaultTrackTitle')) { track.title = titleFromFilename(f.name); renderLibrary(); }
              probeAudioDuration(f).then(dur => { layer0.duration = dur; recomputeTrackDuration(track); renderLibrary(); });
            }, () => layer0.originalFileName);
          wireBatchDrop(staticCtrlHost, files => {
            const f = files[0];
            layer0.pendingFile = f;
            hasUnsavedEdits = true;
            if (!track.title || !track.title.trim() || track.title === tr('defaultTrackTitle')) track.title = titleFromFilename(f.name);
            renderLibrary();
            probeAudioDuration(f).then(dur => { layer0.duration = dur; recomputeTrackDuration(track); renderLibrary(); });
          });
        }
        if (track.loopEngine === 'quantized' && !isVerticalRandom && !isEmbrVert) {
          const timelineHost = infoEl.querySelector('[data-role="loopTimelineHost"]');
          if (timelineHost) timelineHost.appendChild(buildLoopTimelineEl(track, ti, el));
        }
      }

      // -- Catégorie "Structure" (libellé non cliquable, toujours juste après "Infos du morceau") :
      // emplacements/couches/sections/boucles selon le mode. Rien pour le statique (pas de 4e catégorie).
      if (!isStatic) {
        const catLabel = document.createElement('div');
        catLabel.className = 'seq-master-category-label';
        catLabel.textContent = tr('trackSectionStructure');
        modeMasterHost.appendChild(catLabel);
      }
      if (isVerticalRandom) {
        modeMasterHost.appendChild(modeMasterItem('vrsIntro', `<div class="seq-master-item-label">${tr('introShortLabel')}</div>`, null, true));
        if (modeSel === 'vrsIntro') {
          const introEl = document.createElement('div');
          introEl.innerHTML = `
            <div data-role="introCtrl" style="margin-bottom:10px"></div>
            <div class="row">
              <div><label>${tr('nameFieldLabel')}</label><input type="text" data-field="introLabel" data-ti="${ti}" value="${escapeAttr(track.intro.label)}"></div>
              <div><label>${tr('barsLabel')}</label><input type="text" inputmode="numeric" data-field="introBars" data-ti="${ti}" value="${track.intro.bars || 8}"></div>
            </div>
            <div class="row" style="margin-top:8px">
              <div><label data-help="bpmMeasuresVerticalRandom">${tr('bpmLabel')}</label><input type="text" inputmode="decimal" data-field="introBpm" data-ti="${ti}" value="${track.intro.bpm || ((track.sections || [])[0] || {}).bpm || 120}"></div>
              <div><label>${tr('beatsPerBarLabel')}</label><input type="text" inputmode="numeric" data-field="introBeatsPerBar" data-ti="${ti}" value="${track.intro.beatsPerBar || ((track.sections || [])[0] || {}).beatsPerBar || 4}"></div>
            </div>
            <div class="hint-inline">${tr('introSectionLabel')}</div>
            <div class="hint-inline">${tr('introTailHintVrs')}</div>
            <div style="margin-top:8px">
              ${collapsibleBlockToggleHtml(`introDesc:${ti}`, tr('stageDescriptionToggleLabel'), 'vrsIntroDescToggle', 'stageDescription')}
              <div class="list-block-body${expandedAltPoolKeys.has(`introDesc:${ti}`) ? '' : ' collapsed'}" data-role="vrsIntroDescBody" style="margin-top:8px">
                <div class="hint-inline">${tr('stageDescriptionHint')}</div>
                <div><label>${tr('stageDescriptionFrLabel')}</label><textarea rows="2" data-field="introDescriptionFr" data-ti="${ti}">${escapeHtml(track.intro.descriptionFr || '')}</textarea></div>
                <div><label>${tr('stageDescriptionEnLabel')}</label><textarea rows="2" data-field="introDescriptionEn" data-ti="${ti}">${escapeHtml(track.intro.descriptionEn || '')}</textarea></div>
              </div>
            </div>
            ${stageFxHtml(track.intro.fx, 'intro', `data-ti="${ti}"`)}
          `;
          modeDetailHost.appendChild(introEl);
          const introCtrlHost = introEl.querySelector('[data-role="introCtrl"]');
          introCtrlHost.innerHTML = fileCtrlHtml(tr('chooseWavMp3'));
          wireFileControl(introCtrlHost, '.wav,audio/wav,.mp3,audio/mp3,audio/mpeg',
            () => track.intro.pendingFile, () => track.intro.remoteFile,
            f => {
              track.intro.pendingFile = f;
              hasUnsavedEdits = true;
              if (!track.title || !track.title.trim() || track.title === tr('defaultTrackTitle')) track.title = titleFromFilename(f.name);
              renderLibrary();
              probeAudioDuration(f).then(dur => { if (dur > (track.duration || 0)) { track.duration = dur; renderLibrary(); } });
            }, () => track.intro.originalFileName);
          wireCollapsibleBlockToggle(introEl.querySelector('[data-role="vrsIntroDescToggle"]'), introEl.querySelector('[data-role="vrsIntroDescBody"]'), `introDesc:${ti}`);
        }

        track.sections.forEach((section, sci) => {
          if (!section.pools) section.pools = [];
          if (!section.bpm) section.bpm = 120;
          if (!section.beatsPerBar) section.beatsPerBar = 4;
          if (section.startTrackBeat === undefined) section.startTrackBeat = 0;
          if (section.loopInBeat === undefined) section.loopInBeat = 0;
          if (section.loopOutBeat === undefined) section.loopOutBeat = 16;
          if (section.duration === undefined) section.duration = 0;
          if (section.maxLoops === undefined) section.maxLoops = null;
          const isDuplicateForMaster = !!section.referencesSectionId;
          modeMasterHost.appendChild(modeMasterItem(sci, `
            <div class="seq-master-item-label">${dragHandleHtml()}${escapeAttr(section.label) || tr('sectionFallback', { n: sci + 1 })}</div>
            <div class="seq-master-item-tags">${isDuplicateForMaster ? `<span class="seq-master-item-tag">${tr('seqDuplicateTag')}</span>` : `<span class="seq-master-item-tag">${trCount(section.pools.length, 'vrsPoolCountSingular', 'vrsPoolCountPlural')}</span>`}</div>
          `, section.id, true));
          if (modeSel !== sci) return;
          const sectionBpm = section.bpm || 120;
          const sectionBeatsPerBar = section.beatsPerBar || 4;
          const sectionEl = document.createElement('div');
          const isDuplicate = !!section.referencesSectionId;
          const sourceSection = isDuplicate ? track.sections.find(s2 => s2.id === section.referencesSectionId) : null;
          const hasAnyFile = isDuplicate
            ? !!(sourceSection && sourceSection.pools.some(p => (p.alternatives || []).some(a => a.pendingFile || a.remoteFile)))
            : section.pools.some(p => (p.alternatives || []).some(a => a.pendingFile || a.remoteFile));
          const duplicatableOptions = track.sections.filter((s2, osci) => osci !== sci && !s2.referencesSectionId);
          const isReferencedByOthers = track.sections.some(s2 => s2.referencesSectionId === section.id);
          sectionEl.innerHTML = `
            <label>${tr('nameFieldLabel')}</label><input type="text" placeholder="${tr('sectionNamePlaceholder')}" data-section-field="label" data-ti="${ti}" data-si="${sci}" value="${escapeAttr(section.label)}" style="margin-bottom:8px">
            <div class="actions"><button class="btn btn-small btn-danger" data-action="remove-section" data-ti="${ti}" data-si="${sci}">${tr('removeSectionBtn')}</button></div>
            ${!hasAnyFile ? `<div class="hint-inline" style="color:#b45309">${tr('noAltFileWarning')}</div>` : ''}
            <label data-help="slotContentSource" style="margin-top:8px">${tr('slotContentSourceLabel')}</label>
            <select data-section-field="referencesSectionId" data-ti="${ti}" data-si="${sci}" ${isReferencedByOthers ? 'disabled' : ''}>
              <option value="">${tr('slotContentOwnOption')}</option>
              ${duplicatableOptions.map(other => `<option value="${other.id}" ${section.referencesSectionId === other.id ? 'selected' : ''}>${tr('slotContentDuplicateOption', { label: escapeAttr(other.label) || tr('untitledFallback') })}</option>`).join('')}
            </select>
            ${isReferencedByOthers ? `<div class="hint-inline">${tr('slotIsSourceHint')}</div>` : ''}
            ${isDuplicate ? `
              <div class="hint-inline">${tr('sectionDuplicateHint', { label: escapeAttr((sourceSection && sourceSection.label) || tr('untitledFallback')) })}</div>
            ` : `
              <label data-help="vrsSectionBatchDrop" style="margin-top:14px">${tr('vrsSectionBatchDropLabel')}${!currentUserIsAdmin ? `<span class="hint-inline" style="margin:0 0 0 6px">${tr('fxAdminOnlyHint')}</span>` : ''}</label>
              <div class="hint-inline">${tr('vrsSectionBatchDropHint')}</div>
              <div data-role="vrsSectionDrop" class="${currentUserIsAdmin ? '' : 'is-disabled'}" style="margin-top:6px">${tr('dropAllFilesHint')}</div>
              <label data-help="bpmMeasuresVerticalRandom" style="margin-top:14px">${tr('bpmMeasuresLabel')}</label>
              <div class="row" style="margin-top:8px">
                <div><label>${tr('bpmLabel')}</label><input type="text" inputmode="decimal" data-section-field="bpm" data-ti="${ti}" data-si="${sci}" value="${sectionBpm}"></div>
                <div><label>${tr('beatsPerBarLabel')}</label><input type="text" inputmode="numeric" data-section-field="beatsPerBar" data-ti="${ti}" data-si="${sci}" value="${sectionBeatsPerBar}"></div>
              </div>
              <label data-help="loopPointsVerticalRandom" style="margin-top:8px">${tr('loopPointsLabel')}</label>
              <div data-role="loopTimelineHost" data-ti="${ti}" data-si="${sci}"></div>
              <div class="hint-inline">${tr('loopTimelineHintVerticalRandom')}</div>
              <label data-help="defaultLoopCount" style="margin-top:10px">${tr('defaultLoopCountLabel')}</label>
              <select data-section-field="maxLoops" data-ti="${ti}" data-si="${sci}">
                <option value=""${!section.maxLoops ? ' selected' : ''}>${tr('infiniteLoops')}</option>
                ${[1,2,3,5,10].map(n => `<option value="${n}"${section.maxLoops === n ? ' selected' : ''}>${n}</option>`).join('')}
              </select>
              <div class="hint-inline">${tr('loopCountVisitorHint')}</div>
              <label data-help="vrsPools" style="margin-top:14px">${tr('vrsPoolsLabel')}</label>
              <div data-role="vrsPools"></div>
              <div class="actions"><button class="btn btn-small" data-action="add-pool" data-ti="${ti}" data-si="${sci}">${tr('addPoolBtn')}</button></div>
            `}
          `;
          modeDetailHost.appendChild(sectionEl);
          if (isDuplicate) return;

          const timelineHost = sectionEl.querySelector('[data-role="loopTimelineHost"]');
          if (timelineHost) timelineHost.appendChild(buildLoopTimelineEl(section, ti, el));

          // Dépôt groupé de la section (25/09) -- réservé à l'admin tant que Jules-Antoine ne l'a pas validé.
          const sectionDropHost = sectionEl.querySelector('[data-role="vrsSectionDrop"]');
          if (sectionDropHost && currentUserIsAdmin) wireBatchDrop(sectionDropHost, files => openVrsBatchDropDialog(track, section, files));
          // Zone grisée : on avale quand même le dépôt, sinon le navigateur ouvrirait le fichier et quitterait
          // la page (modifications non enregistrées perdues).
          else if (sectionDropHost) ['dragover', 'drop'].forEach(ev => sectionDropHost.addEventListener(ev, e => e.preventDefault()));

          const poolsHost = sectionEl.querySelector('[data-role="vrsPools"]');
          section.pools.forEach((pool, pi) => {
            if (!pool.alternatives) pool.alternatives = [];
            const poolEl = document.createElement('div');
            poolEl.className = 'list-block';
            poolEl.style.marginBottom = '8px';
            const poolHasFile = pool.alternatives.some(a => a.pendingFile || a.remoteFile);
            poolEl.innerHTML = `
              <div class="list-block-head">
                <input type="text" placeholder="${tr('poolNamePlaceholder')}" data-pool-field="label" data-ti="${ti}" data-si="${sci}" data-pi="${pi}" value="${escapeAttr(pool.label)}" style="flex:1;margin-right:8px;">
                <button class="btn btn-small btn-danger" data-action="remove-pool" data-ti="${ti}" data-si="${sci}" data-pi="${pi}">${tr('removePoolBtn')}</button>
              </div>
              ${!poolHasFile ? `<div class="hint-inline" style="color:#b45309">${tr('noAltFileWarning')}</div>` : ''}
              <label style="display:flex;align-items:center;gap:8px;margin-top:8px;">
                <input type="checkbox" data-pool-field="avoidImmediateRepeat" data-ti="${ti}" data-si="${sci}" data-pi="${pi}" ${pool.avoidImmediateRepeat ? 'checked' : ''} style="width:auto;margin:0;">
                <span style="color:var(--text-dim);font-size:12px;">${tr('avoidRepeatAltLabel')}</span>
              </label>
              <div class="hint-inline">${tr('silentAltHint')}</div>
              <div class="hint-inline">${tr('blockDropHint')}</div>
              <div style="margin-top:10px">${altPoolToggleHtml(`vrspool:${ti}:${sci}:${pi}`, pool.alternatives.length)}</div>
              <div class="list-block-body alt-pool-panel${expandedAltPoolKeys.has(`vrspool:${ti}:${sci}:${pi}`) ? '' : ' collapsed'}" data-role="altPoolBody" style="margin-top:8px">
                <div data-role="poolAlternatives"></div>
                <div class="actions"><button class="btn btn-small" data-action="add-pool-alt" data-ti="${ti}" data-si="${sci}" data-pi="${pi}">${tr('addAlternativeBtn')}</button></div>
              </div>
              ${poolFxHtml(pool, ti, sci, pi)}
            `;
            wireAltPoolToggle(poolEl);
            const altsHost = poolEl.querySelector('[data-role="poolAlternatives"]');
            pool.alternatives.forEach((alt, ai) => {
              const altRow = document.createElement('div');
              altRow.className = 'list-block';
              altRow.style.marginBottom = '8px';
              altRow.innerHTML = `
                <div data-role="poolAltFileCtrl"></div>
                <label style="margin-top:8px">${tr('labelFieldLabel')}</label><input type="text" placeholder="${tr('altLabelPlaceholder')}" data-pool-alt-field="label" data-ti="${ti}" data-si="${sci}" data-pi="${pi}" data-ai="${ai}" value="${escapeAttr(alt.label)}">
              `;
              const altCtrlHost = altRow.querySelector('[data-role="poolAltFileCtrl"]');
              altCtrlHost.innerHTML = fileCtrlHtml(tr('chooseWavMp3'), deleteIconBtnHtml('remove-pool-alt', { ti, si: sci, pi, ai }, tr('removeAlternativeBtn')));
              wireFileControl(altCtrlHost, '.wav,audio/wav,.mp3,audio/mp3,audio/mpeg',
                () => alt.pendingFile, () => alt.remoteFile,
                f => {
                  alt.pendingFile = f;
                  hasUnsavedEdits = true;
                  if (!alt.label || !alt.label.trim()) { alt.label = titleFromFilename(f.name); renderLibrary(); }
                  probeAudioDuration(f).then(dur => {
                    if (dur > (section.duration || 0)) { section.duration = dur; renderLibrary(); }
                    if (dur > (track.duration || 0)) { track.duration = dur; }
                  });
                }, () => alt.originalFileName);
              altsHost.appendChild(altRow);
            });
            // Toute la carte du pool est une zone de dépôt (25/09, demande de Jules-Antoine) -- plus seulement la
            // liste des variations, repliée par défaut. Un fichier lâché sur le sélecteur d'une variation précise
            // remplace toujours SON fichier (wireFileControl arrête l'événement avant qu'il n'arrive ici).
            wireBatchDrop(poolEl, files => {
              // Pool encore sans aucun fichier : ses variations vides sont des attentes de fichier, remplacées.
              if (!pool.alternatives.some(a => a.pendingFile || a.remoteFile)) pool.alternatives = [];
              files.forEach(f => pool.alternatives.push({ label: titleFromFilenameStrippingHints(f.name), remoteFile: null, pendingFile: f }));
              expandedAltPoolKeys.add(`vrspool:${ti}:${sci}:${pi}`);
              hasUnsavedEdits = true;
              renderLibrary();
              Promise.all(files.map(probeAudioDuration)).then(durs => {
                const maxDur = Math.max(0, ...durs);
                if (maxDur > (section.duration || 0)) { section.duration = maxDur; renderLibrary(); }
                if (maxDur > (track.duration || 0)) { track.duration = maxDur; }
              });
            });
            poolsHost.appendChild(poolEl);
          });
        });

        modeMasterHost.appendChild(modeMasterItem('vrsOutro', `<div class="seq-master-item-label">${tr('outroShortLabel')}</div>`, null, true));
        if (modeSel === 'vrsOutro') {
          const outroEl = document.createElement('div');
          outroEl.innerHTML = `
            <div data-role="outroCtrl" style="margin-bottom:10px"></div>
            <label>${tr('nameFieldLabel')}</label><input type="text" data-field="outroLabel" data-ti="${ti}" value="${escapeAttr(track.outro.label)}">
            <div class="hint-inline">${tr('outroSectionLabel')}</div>
            <div class="hint-inline">${tr('noOutroHint')}</div>
            <div style="margin-top:8px">
              ${collapsibleBlockToggleHtml(`outroDesc:${ti}`, tr('stageDescriptionToggleLabel'), 'vrsOutroDescToggle', 'stageDescription')}
              <div class="list-block-body${expandedAltPoolKeys.has(`outroDesc:${ti}`) ? '' : ' collapsed'}" data-role="vrsOutroDescBody" style="margin-top:8px">
                <div class="hint-inline">${tr('stageDescriptionHint')}</div>
                <div><label>${tr('stageDescriptionFrLabel')}</label><textarea rows="2" data-field="outroDescriptionFr" data-ti="${ti}">${escapeHtml(track.outro.descriptionFr || '')}</textarea></div>
                <div><label>${tr('stageDescriptionEnLabel')}</label><textarea rows="2" data-field="outroDescriptionEn" data-ti="${ti}">${escapeHtml(track.outro.descriptionEn || '')}</textarea></div>
              </div>
            </div>
            ${stageFxHtml(track.outro.fx, 'outro', `data-ti="${ti}"`)}
          `;
          modeDetailHost.appendChild(outroEl);
          const outroCtrlHost = outroEl.querySelector('[data-role="outroCtrl"]');
          outroCtrlHost.innerHTML = fileCtrlHtml(tr('chooseWavMp3'));
          wireFileControl(outroCtrlHost, '.wav,audio/wav,.mp3,audio/mp3,audio/mpeg',
            () => track.outro.pendingFile, () => track.outro.remoteFile,
            f => {
              track.outro.pendingFile = f;
              hasUnsavedEdits = true;
              renderLibrary();
              probeAudioDuration(f).then(dur => { if (dur > (track.duration || 0)) { track.duration = dur; renderLibrary(); } });
            }, () => track.outro.originalFileName);
          wireCollapsibleBlockToggle(outroEl.querySelector('[data-role="vrsOutroDescToggle"]'), outroEl.querySelector('[data-role="vrsOutroDescBody"]'), `outroDesc:${ti}`);
        }

        wireArrayDragReorder(modeMasterHost, 'seq-master-item', () => track.sections, item => { seqSelectedSlotIndex.set(track.id, track.sections.indexOf(item)); renderLibrary(); }, item => cloneWithCopyLabel(item)); // Alt + glisser : copie (25/09)
        // "+ Section" vit désormais à la suite de la Structure (juste après Outro), même correctif que
        // pour le séquentiel (20/08).
        appendMasterAddButton(modeMasterHost, 'add-section', ti, 'addSectionBtn');
      } else if (isEmbrVert) {
        // Classification paire/détour désormais EXPLICITE (24/08, retour visuel) -- une case à cocher
        // "Boucle de détour" par boucle non-référence, plutôt qu'une comparaison implicite des mesures qui
        // rendait le champ "Mesures" trompeur (le modifier reclassait silencieusement la boucle).
        track.loops.forEach((loop, li) => {
          modeMasterHost.appendChild(modeMasterItem(li, `
            <div class="seq-master-item-label">${dragHandleHtml()}${escapeAttr(loop.label) || tr('embrLoopFallback', { n: li + 1 })}</div>
            <div class="seq-master-item-tags">${loop.isInitial ? `<span class="seq-master-item-tag">${tr('embrInitialLabel')}</span>` : ''}</div>
          `, loop.id, true));
          if (modeSel !== li) return;
          const hasFile = !!(loop.pendingFile || loop.remoteFile);
          const loopEl = document.createElement('div');
          loopEl.innerHTML = `
            <div data-role="embrLoopFileCtrl" style="margin-bottom:10px"></div>
            <label>${tr('labelFieldLabel')}</label><input type="text" placeholder="${tr('embrLoopNamePlaceholder')}" data-embr-loop-field="label" data-ti="${ti}" data-li="${li}" value="${escapeAttr(loop.label)}" style="margin-bottom:8px">
            <div class="actions"><button class="btn btn-small btn-danger" data-action="remove-embr-loop" data-ti="${ti}" data-li="${li}">${tr('removeEmbrLoopBtn')}</button></div>
            ${!hasFile ? `<div class="hint-inline" style="color:#b45309">${tr('noEmbrLoopFileWarning')}</div>` : ''}
            ${loop.isInitial ? `
              <label data-help="embrLoopInitial">${tr('embrInitialLabel')}</label>
              <label style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                <input type="radio" name="embrInitial-${ti}" data-embr-loop-field="isInitial" data-ti="${ti}" data-li="${li}" checked style="width:auto;margin:0;">
                <span style="color:var(--text-dim);font-size:12px;">${tr('embrInitialCheckLabel')}</span>
              </label>
              <div class="hint-inline">${tr('embrInitialHint')}</div>
              <label data-help="bpmMeasuresEmbrVert" style="margin-top:14px">${tr('bpmMeasuresLabel')}</label>
              <div class="row" style="margin-top:8px">
                <div><label>${tr('bpmLabel')}</label><input type="text" inputmode="decimal" data-field="bpm" data-ti="${ti}" value="${track.bpm || 120}"></div>
                <div><label>${tr('beatsPerBarLabel')}</label><input type="text" inputmode="numeric" data-field="beatsPerBar" data-ti="${ti}" value="${track.beatsPerBar || 4}"></div>
              </div>
              <div class="hint-inline">${tr('embrBpmHint')}</div>
            ` : `
              <label style="display:flex;align-items:center;gap:8px;">
                <input type="radio" name="embrInitial-${ti}" data-embr-loop-field="isInitial" data-ti="${ti}" data-li="${li}" style="width:auto;margin:0;">
                <span data-help="embrLoopInitial" style="color:var(--text-dim);font-size:12px;">${tr('embrInitialCheckLabel')}</span>
              </label>
              <label style="display:flex;align-items:center;gap:8px;margin-top:10px;">
                <input type="checkbox" data-embr-loop-field="isDetour" data-ti="${ti}" data-li="${li}" ${loop.isDetour ? 'checked' : ''} style="width:auto;margin:0;">
                <span data-help="embrIsDetour" style="color:var(--text-dim);font-size:12px;">${tr('embrIsDetourLabel')}</span>
              </label>
              <div class="hint-inline">${loop.isDetour ? tr('embrIsDetourOnHint') : tr('embrIsDetourOffHint')}</div>
              ${loop.isDetour ? `
                <div class="row" style="margin-top:8px">
                  <div><label>${tr('barsLabel')}</label><input type="text" inputmode="numeric" data-embr-loop-field="bars" data-ti="${ti}" data-li="${li}" value="${loop.bars || 8}"></div>
                  <div><label>${tr('bpmLabel')}</label><input type="text" inputmode="decimal" data-embr-loop-field="bpm" data-ti="${ti}" data-li="${li}" value="${loop.bpm || track.bpm || 120}"></div>
                  <div><label>${tr('beatsPerBarLabel')}</label><input type="text" inputmode="numeric" data-embr-loop-field="beatsPerBar" data-ti="${ti}" data-li="${li}" value="${loop.beatsPerBar || track.beatsPerBar || 4}"></div>
                </div>
                <div class="hint-inline">${tr('embrDetourTempoHint')}</div>
              ` : ''}
            `}
            <label data-help="embrQuantize" style="margin-top:14px">${tr('embrQuantizeLabel')}</label>
            <select data-embr-loop-field="switchQuantize" data-ti="${ti}" data-li="${li}">
              <option value="immediate"${(loop.switchQuantize || 'immediate') === 'immediate' ? ' selected' : ''}>${tr('embrQuantizeImmediate')}</option>
              <option value="beat"${loop.switchQuantize === 'beat' ? ' selected' : ''}>${tr('embrQuantizeNextBeat')}</option>
              <option value="bar"${loop.switchQuantize === 'bar' ? ' selected' : ''}>${tr('embrQuantizeNextBar')}</option>
            </select>
            <div class="hint-inline">${tr('embrQuantizeHint')}</div>
            <label data-help="slotCutStyle" style="margin-top:14px">${tr('cutStyleLabel')}</label>
            <select data-embr-loop-field="cutStyle" data-ti="${ti}" data-li="${li}">
              <option value="fade"${(loop.cutStyle || 'fade') === 'fade' ? ' selected' : ''}>${tr('cutStyleFade')}</option>
              <option value="hard"${loop.cutStyle === 'hard' ? ' selected' : ''}>${tr('cutStyleHard')}</option>
              <option value="custom"${loop.cutStyle === 'custom' ? ' selected' : ''}>${tr('cutStyleCustom')}</option>
            </select>
            ${loop.cutStyle === 'custom' ? `
              <div style="margin-top:8px">
                <label data-help="slotCustomCutFade">${tr('customCutFadeLabel')}</label>
                <input type="range" min="0" max="8" step="0.05" data-embr-loop-field="customCutFadeSec" data-ti="${ti}" data-li="${li}" value="${loop.customCutFadeSec != null ? loop.customCutFadeSec : 0.15}">
                <span class="hint-inline" data-role="embrCustomCutFadeValue">${(loop.customCutFadeSec != null ? loop.customCutFadeSec : 0.15).toFixed(2)}s</span>
              </div>
            ` : ''}
            ${!loop.isInitial && !loop.isDetour ? `
              <label style="display:flex;align-items:center;gap:8px;margin-top:14px;">
                <input type="checkbox" data-embr-loop-field="autoReturnEnabled" data-ti="${ti}" data-li="${li}" ${loop.autoReturnEnabled ? 'checked' : ''} style="width:auto;margin:0;">
                <span data-help="embrAutoReturn" style="color:var(--text-dim);font-size:12px;">${tr('embrAutoReturnLabel')}</span>
              </label>
              <div class="hint-inline">${tr('embrAutoReturnHint')}</div>
              ${loop.autoReturnEnabled ? `
                <div class="row" style="margin-top:8px">
                  <div><label>${tr('embrAutoReturnValueLabel')}</label><input type="text" inputmode="numeric" data-embr-loop-field="autoReturnValue" data-ti="${ti}" data-li="${li}" value="${loop.autoReturnValue || 4}"></div>
                  <div>
                    <label>${tr('embrAutoReturnUnitLabel')}</label>
                    <select data-embr-loop-field="autoReturnUnit" data-ti="${ti}" data-li="${li}">
                      <option value="beats"${loop.autoReturnUnit === 'beats' ? ' selected' : ''}>${tr('embrAutoReturnUnitBeats')}</option>
                      <option value="bars"${(loop.autoReturnUnit || 'bars') === 'bars' ? ' selected' : ''}>${tr('embrAutoReturnUnitBars')}</option>
                      <option value="seconds"${loop.autoReturnUnit === 'seconds' ? ' selected' : ''}>${tr('embrAutoReturnUnitSeconds')}</option>
                    </select>
                  </div>
                </div>
              ` : ''}
            ` : ''}
            <div class="branch-options-panel" style="margin-top:14px">
              <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" data-embr-loop-field="hasTransition" data-ti="${ti}" data-li="${li}" ${loop.transition ? 'checked' : ''} style="width:auto;margin:0;">
                <span data-help="embrTransition" style="color:var(--text-dim);font-size:12px;">${tr('embrTransitionLabel')}</span>
              </label>
              <div class="hint-inline">${tr('embrTransitionHint')}</div>
              ${loop.transition ? `
                <div data-role="embrTransitionFileCtrl" style="margin-top:8px"></div>
                <label style="margin-top:8px">${tr('branchLabelOverrideLabel')}</label>
                <input type="text" placeholder="${tr('transitionNamePlaceholder')}" data-embr-loop-field="transitionLabel" data-ti="${ti}" data-li="${li}" value="${escapeAttr(loop.transition.label)}">
                <div style="margin-top:8px">
                  <label data-help="transitionDurationUnit">${tr('transitionDurationUnitLabel')}</label>
                  <select data-embr-transition-field="durationUnit" data-ti="${ti}" data-li="${li}">
                    <option value="auto"${!loop.transition.durationUnit ? ' selected' : ''}>${tr('transitionDurationUnitAuto')}</option>
                    <option value="bars"${loop.transition.durationUnit === 'bars' ? ' selected' : ''}>${tr('transitionDurationUnitBars')}</option>
                    <option value="beats"${loop.transition.durationUnit === 'beats' ? ' selected' : ''}>${tr('transitionDurationUnitBeats')}</option>
                    <option value="seconds"${loop.transition.durationUnit === 'seconds' ? ' selected' : ''}>${tr('transitionDurationUnitSeconds')}</option>
                  </select>
                </div>
                ${loop.transition.durationUnit === 'seconds' ? `
                  <div style="margin-top:8px"><label>${tr('transitionDurationSecondsLabel')}</label><input type="text" inputmode="decimal" data-embr-transition-field="durationSeconds" data-ti="${ti}" data-li="${li}" value="${loop.transition.durationSeconds != null ? loop.transition.durationSeconds : 1}"></div>
                ` : (loop.transition.durationUnit === 'bars' || loop.transition.durationUnit === 'beats') ? `
                  <div class="row" style="margin-top:8px">
                    ${loop.transition.durationUnit === 'beats' ? `
                      <div><label>${tr('transitionDurationBeatsLabel')}</label><input type="text" inputmode="decimal" data-embr-transition-field="durationBeats" data-ti="${ti}" data-li="${li}" value="${loop.transition.durationBeats || 1}"></div>
                    ` : `
                      <div><label>${tr('barsLabel')}</label><input type="text" inputmode="numeric" data-embr-transition-field="bars" data-ti="${ti}" data-li="${li}" value="${loop.transition.bars || 4}"></div>
                    `}
                    <div><label>${tr('bpmLabel')}</label><input type="text" inputmode="decimal" placeholder="${loop.bpm || track.bpm || 120}" data-embr-transition-field="bpm" data-ti="${ti}" data-li="${li}" value="${loop.transition.bpm || ''}"></div>
                    <div><label>${tr('beatsPerBarLabel')}</label><input type="text" inputmode="numeric" placeholder="${loop.beatsPerBar || track.beatsPerBar || 4}" data-embr-transition-field="beatsPerBar" data-ti="${ti}" data-li="${li}" value="${loop.transition.beatsPerBar || ''}"></div>
                  </div>
                  <div class="hint-inline">${tr('transitionBarsTempoHint')}</div>
                ` : ''}
                ${stageFxHtml(loop.transition.fx, 'embrTransition', `data-ti="${ti}" data-li="${li}"`)}
              ` : ''}
            </div>
            ${!loop.isInitial && loop.isDetour ? `
              <label data-help="embrDetourMode" style="margin-top:14px">${tr('embrDetourModeLabel')}</label>
              <select data-embr-loop-field="detourMode" data-ti="${ti}" data-li="${li}">
                <option value="once"${(loop.detourMode || 'once') === 'once' ? ' selected' : ''}>${tr('embrDetourModeOnce')}</option>
                <option value="loop"${loop.detourMode === 'loop' ? ' selected' : ''}>${tr('embrDetourModeLoop')}</option>
              </select>
              <div class="hint-inline">${tr('embrDetourModeHint')}</div>
              ${loop.detourMode === 'loop' ? `
                <label style="margin-top:8px">${tr('embrEndLoopButtonLabel')}</label>
                <input type="text" placeholder="${tr('embrEndLoopButtonPlaceholder')}" data-embr-loop-field="endLoopButtonLabel" data-ti="${ti}" data-li="${li}" value="${escapeAttr(loop.endLoopButtonLabel)}">
              ` : ''}
            ` : ''}
            ${loop.isInitial ? `<div data-role="embrLoopTimelineHost" style="margin-top:14px"></div>` : ''}
            ${loopFxHtml(loop, ti, li)}
            ${fxActionsHtml(loop.fxActions, track, `data-fx-owner="loop" data-ti="${ti}" data-li="${li}"`)}
          `;
          modeDetailHost.appendChild(loopEl);
          const ctrlHost = loopEl.querySelector('[data-role="embrLoopFileCtrl"]');
          ctrlHost.innerHTML = fileCtrlHtml(tr('chooseWavMp3'));
          wireFileControl(ctrlHost, '.wav,audio/wav,.mp3,audio/mp3,audio/mpeg',
            () => loop.pendingFile, () => loop.remoteFile,
            f => {
              loop.pendingFile = f;
              hasUnsavedEdits = true;
              if (!loop.label || !loop.label.trim()) loop.label = titleFromFilename(f.name);
              if (!track.title || !track.title.trim() || track.title === tr('defaultTrackTitle')) track.title = titleFromFilename(f.name);
              renderLibrary();
              // Durée stockée par boucle, pas accumulée sur track.duration (24/08, même correctif que le
              // mode Vertical de la semaine dernière) -- nécessaire ici pour construire la règle de points
              // de boucle de la référence, et évite la même pollution/contamination déjà corrigée ailleurs.
              probeAudioDuration(f).then(dur => { loop.duration = dur; renderLibrary(); });
            }, () => loop.originalFileName);
          if (loop.transition) {
            const transCtrlHost = loopEl.querySelector('[data-role="embrTransitionFileCtrl"]');
            if (transCtrlHost) {
              transCtrlHost.innerHTML = fileCtrlHtml(tr('chooseWavMp3'));
              wireFileControl(transCtrlHost, '.wav,audio/wav,.mp3,audio/mp3,audio/mpeg',
                () => loop.transition.pendingFile, () => loop.transition.remoteFile,
                f => {
                  loop.transition.pendingFile = f;
                  hasUnsavedEdits = true;
                  if (!loop.transition.label || !loop.transition.label.trim()) loop.transition.label = titleFromFilename(f.name);
                  renderLibrary();
                }, () => loop.transition.originalFileName);
            }
          }
          if (loop.isInitial) {
            // Points de boucle (Départ/Entrée/Sortie) de la boucle de référence (24/08) -- réutilise tel
            // quel le composant déjà construit pour le mode Vertical (buildLoopTimelineEl), plutôt que
            // d'en reconstruire une variante. Les boucles PAIRES (même durée que la référence) reprennent
            // cette même fenêtre de lecture sur leur propre fichier côté player.js (verrouillage de phase),
            // les boucles détour n'en tiennent pas compte (décision validée le 24/08). bpm/beatsPerBar
            // posés directement sur l'objet `loop` (redondant avec track.bpm/track.beatsPerBar, mais
            // buildLoopTimelineEl attend ces champs sur son `timingOwner`, et les repères glissés doivent
            // persister sur ce même objet `loop` -- pas une copie -- pour survivre au prochain rendu.
            loop.bpm = track.bpm;
            loop.beatsPerBar = track.beatsPerBar;
            const timelineHost = loopEl.querySelector('[data-role="embrLoopTimelineHost"]');
            if (timelineHost) timelineHost.appendChild(buildLoopTimelineEl(loop, ti, loopEl));
          }
        });
        wireBatchDrop(modeMasterHost, files => {
          // Mesures de chaque boucle lues dans son nom ("_16M", 25/09) : propres à ce fichier, donc appliquées
          // directement ; le tempo du morceau, lui, passe par une confirmation (offerTrackTempoFromFilenames).
          // Admin seulement pour l'instant.
          const pushedLoops = files.map((f, idx) => {
            const fileBars = currentUserIsAdmin ? parseAudioFilenameHints(f.name).bars : null;
            const newLoop = { id: genId(), label: currentUserIsAdmin ? titleFromFilenameStrippingHints(f.name) : titleFromFilename(f.name), bars: fileBars || 8, isInitial: track.loops.length === 0 && idx === 0, remoteFile: null, pendingFile: f, switchQuantize: 'immediate', autoReturnEnabled: false, autoReturnValue: 4, autoReturnUnit: 'bars', detourMode: 'once', endLoopButtonLabel: '', isDetour: false, cutStyle: 'fade', customCutFadeSec: null, transition: null };
            track.loops.push(newLoop);
            return newLoop;
          });
          hasUnsavedEdits = true;
          if ((!track.title || !track.title.trim() || track.title === tr('defaultTrackTitle')) && files[0]) track.title = titleFromFilename(files[0].name);
          renderLibrary();
          // Durée par boucle (24/08, même correctif que ci-dessus) -- chaque fichier déposé alimente la
          // duration de SA PROPRE boucle, pas un agrégat au niveau du morceau.
          pushedLoops.forEach((newLoop, i) => {
            probeAudioDuration(files[i]).then(dur => { newLoop.duration = dur; renderLibrary(); });
          });
          offerTrackTempoFromFilenames(track, files, false);
        });
        wireArrayDragReorder(modeMasterHost, 'seq-master-item', () => track.loops, item => { seqSelectedSlotIndex.set(track.id, track.loops.indexOf(item)); renderLibrary(); }, item => cloneWithCopyLabel(item)); // Alt + glisser : copie (25/09)
        // "+ Boucle" vit désormais à la suite des boucles nommées, même correctif (20/08).
        appendMasterAddButton(modeMasterHost, 'add-embr-loop', ti, 'addEmbrLoopBtn');
      } else if (!isStatic) {
        track.layers.forEach((layer, li) => {
          modeMasterHost.appendChild(modeMasterItem(li, `<div class="seq-master-item-label">${dragHandleHtml()}${escapeAttr(layer.label) || tr('layerFallback', { n: li + 1 })}</div>`, layer.id, true));
          if (modeSel !== li) return;
          const row = document.createElement('div');
          row.innerHTML = `
            <div data-role="layerFileCtrl"></div>
            <label style="margin-top:8px">${tr('labelFieldLabel')}</label><input type="text" placeholder="${tr('layerLabelPlaceholder')}" data-field="label" data-ti="${ti}" data-li="${li}" value="${escapeAttr(layer.label)}">
            ${layerFxHtml(layer, ti, li)}
          `;
          modeDetailHost.appendChild(row);
          const ctrlHost = row.querySelector('[data-role="layerFileCtrl"]');
          ctrlHost.innerHTML = fileCtrlHtml(tr('chooseWavMp3'), deleteIconBtnHtml('remove-layer', { ti, li }, tr('removeLayerBtn')));
          wireFileControl(ctrlHost, '.wav,audio/wav,.mp3,audio/mp3,audio/mpeg',
            () => layer.pendingFile, () => layer.remoteFile,
            f => {
              layer.pendingFile = f;
              hasUnsavedEdits = true;
              if (li === 0 && (!track.title || !track.title.trim() || track.title === tr('defaultTrackTitle'))) {
                track.title = titleFromFilename(f.name);
                renderLibrary();
              }
              probeAudioDuration(f).then(dur => { layer.duration = dur; recomputeTrackDuration(track); renderLibrary(); });
            }, () => layer.originalFileName);
        });
        wireBatchDrop(modeMasterHost, files => {
          // Les couches déjà présentes mais sans fichier (ex. "Niveau 1" par défaut d'un morceau tout
          // neuf) reçoivent en priorité les premiers fichiers déposés, dans l'ordre, au lieu de rester
          // vides pendant que tout le lot crée des couches supplémentaires à la suite (14/09, retour de
          // Jules-Antoine).
          const emptyLayers = track.layers.filter(l => !l.pendingFile && !l.remoteFile);
          const touchedLayers = files.map((f, idx) => {
            const target = emptyLayers[idx];
            const layerLabel = currentUserIsAdmin ? titleFromFilenameStrippingHints(f.name) : titleFromFilename(f.name);
            if (target) { target.pendingFile = f; target.label = layerLabel; return target; }
            const newLayer = { id: genId(), label: layerLabel, remoteFile: null, pendingFile: f };
            track.layers.push(newLayer);
            return newLayer;
          });
          hasUnsavedEdits = true;
          if ((!track.title || !track.title.trim() || track.title === tr('defaultTrackTitle')) && files[0]) track.title = titleFromFilename(files[0].name);
          renderLibrary();
          touchedLayers.forEach((layer, i) => {
            probeAudioDuration(files[i]).then(dur => { layer.duration = dur; recomputeTrackDuration(track); renderLibrary(); });
          });
          offerTrackTempoFromFilenames(track, files, true);
        });
        wireArrayDragReorder(modeMasterHost, 'seq-master-item', () => track.layers, item => { seqSelectedSlotIndex.set(track.id, track.layers.indexOf(item)); renderLibrary(); }, item => cloneWithCopyLabel(item)); // Alt + glisser : copie (25/09)
        // "+ Couche" vit désormais à la suite des couches, même correctif (20/08).
        appendMasterAddButton(modeMasterHost, 'add-layer', ti, 'addLayerBtn');
        const layersDropHintEl = document.createElement('div');
        layersDropHintEl.className = 'hint-inline';
        layersDropHintEl.style.marginTop = '6px';
        layersDropHintEl.textContent = tr('layersDropHint');
        modeMasterHost.appendChild(layersDropHintEl);
      }
      // -- "Sfx" et "Infos additionnelles" : mêmes deux entrées, mêmes data-field, que le séquentiel.
      modeMasterHost.appendChild(modeMasterItem('sfx', `
        <div class="seq-master-item-label">${tr('seqContentAdditionalLabel')}</div>
        <div class="seq-master-item-tags"><span class="seq-master-item-tag">${trCount(track.sfxIds.length, 'blockSummarySfxSingular', 'blockSummarySfx')}</span></div>
      `));
      if (modeSel === 'sfx') {
        const sfxEl = document.createElement('div');
        sfxEl.innerHTML = `
          <label data-help="stingers">${tr('stingersLabel')}</label>
          <div class="hint-inline">${tr('trackSfxHint')}</div>
          <div data-role="trackSfxSelector" data-ti="${ti}" style="margin-top:6px"></div>
        `;
        modeDetailHost.appendChild(sfxEl);
      }
      modeMasterHost.appendChild(modeMasterItem('infos', `<div class="seq-master-item-label">${tr('seqAdditionalInfoLabel')}</div>`));
      if (modeSel === 'infos') {
        const notesEl = document.createElement('div');
        notesEl.innerHTML = `
          <label data-help="implementationNote">${tr('implementationNoteLabel')}</label>
          <textarea data-field="implementationNote" data-ti="${ti}" placeholder="${tr('implementationNotePlaceholder')}">${escapeAttr(track.implementationNote || '')}</textarea>
          <div class="hint-inline">${tr('implementationNoteHint')}</div>
          <label data-help="noAiOverride" style="margin-top:14px">${tr('noAiOverrideLabel')}</label>
          <select data-field="noAiOverride" data-ti="${ti}">
            <option value="" ${(track.noAiOverride !== true && track.noAiOverride !== false) ? 'selected' : ''}>${tr('noAiFollowGlobalOption', { state: noAiCertifiedGlobal ? tr('yesWord') : tr('noWord') })}</option>
            <option value="true" ${track.noAiOverride === true ? 'selected' : ''}>${tr('noAiAlwaysCertifyOption')}</option>
            <option value="false" ${track.noAiOverride === false ? 'selected' : ''}>${tr('noAiNeverCertifyOption')}</option>
          </select>
          <div class="hint-inline">${tr('noAiOverrideHint')}</div>
        `;
        modeDetailHost.appendChild(notesEl);
      }
    } else {
      if (!track.segmentSlots) track.segmentSlots = [];
      if (!track.intro) track.intro = { label: 'Intro', bars: 8, remoteFile: null, pendingFile: null };
      if (!track.outro) track.outro = { label: 'Outro', bars: 8, remoteFile: null, pendingFile: null };

      // Plus de dépôt groupé au niveau du morceau ni sur la liste des slots (25/09, jugés redondants par
      // Jules-Antoine) : comme les sections du vertical-random, on crée le slot (+ Slot) puis on dépose ses
      // fichiers dans sa zone "Dépôt groupé du slot". Intro/outro : dépôt sur leur propre sélecteur de fichier.

      // Intro/Outro n'ont plus de bloc replié à part (18/08, alignement sur le principe déjà en place pour
      // les autres modes) : ils sont désormais deux entrées de la liste maître, dans la catégorie
      // "Structure" avec les emplacements — voir plus bas, juste avant/après la boucle segmentSlots.


      // Disposition maître-détail (18/08) : la colonne de gauche liste des entrées cliquables -- les
      // emplacements de la Chaîne de lecture, mais aussi "Infos du morceau" / "Contenu additionnel" /
      // "Infos additionnelles" -- et la colonne de droite affiche le détail de l'entrée sélectionnée.
      // seqSelectedSlotIndex stocke soit un index numérique (emplacement), soit une des 3 clés spéciales
      // ('trackinfo' | 'sfx' | 'infos'). Un clic ne fait QUE changer cette sélection d'affichage --
      // aucune donnée du morceau n'est touchée par la sélection elle-même.
      const slotsMasterHost = el.querySelector('[data-role="segmentSlotsMaster"]');
      const slotsDetailHost = el.querySelector('[data-role="segmentSlotsDetail"]');
      const curSel = seqSelectedSlotIndex.get(track.id);
      if (curSel === undefined || (typeof curSel === 'number' && curSel >= track.segmentSlots.length)) {
        seqSelectedSlotIndex.set(track.id, 'trackinfo');
      }
      const selectedSi = seqSelectedSlotIndex.get(track.id);
      function seqMasterItem(seqKey, labelHtml, isChild) {
        const item = document.createElement('div');
        item.className = 'seq-master-item' + (isChild ? ' seq-master-item-child' : '') + (selectedSi === seqKey ? ' active' : '');
        item.dataset.action = 'select-seq-slot';
        item.dataset.ti = ti;
        item.dataset.seqKey = seqKey;
        item.innerHTML = labelHtml;
        return item;
      }
      // -- "Infos du morceau" : tempo/mesures, cycles avant transition auto, description, harmonisation.
      // Réutilise exactement les mêmes data-field que l'ancien emplacement de ces champs (title/mode déjà
      // montés en en-tête juste au-dessus) -- aucun nouveau champ de données, juste un déplacement.
      slotsMasterHost.appendChild(seqMasterItem('trackinfo', `
        <div class="seq-master-item-label">${tr('seqTrackInfoLabel')}</div>
        <div class="seq-master-item-tags"><span class="seq-master-item-tag">${bpm} BPM</span><span class="seq-master-item-tag">${track.maxChainLoops ? tr('seqCyclesFinite', { n: track.maxChainLoops }) : tr('seqCyclesInfinite')}</span>${track.randomizeSections ? `<span class="seq-master-item-tag">${tr('seqSlotOrderRandomTag')}</span>` : ''}</div>
      `));
      if (selectedSi === 'trackinfo') {
        const infoEl = document.createElement('div');
        infoEl.innerHTML = `
          <div class="row">
            <div><label>${tr('bpmLabel')}</label><input type="text" inputmode="decimal" data-field="bpm" data-ti="${ti}" value="${bpm}"></div>
            <div><label>${tr('beatsPerBarLabel')}</label><input type="text" inputmode="numeric" data-field="beatsPerBar" data-ti="${ti}" value="${beatsPerBar}"></div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;margin-top:10px;">
            <input type="checkbox" data-field="seqSlotOrder" data-ti="${ti}" ${track.randomizeSections ? 'checked' : ''} style="width:auto;margin:0;">
            <span data-help="seqSlotOrder" style="color:var(--text-dim);font-size:12px;">${tr('seqSlotOrderLabel')}</span>
          </label>
          <div class="hint-inline">${tr('seqSlotOrderHint')}</div>
          <label data-help="maxChainLoops" style="margin-top:10px">${tr('maxChainLoopsLabel')}</label>
          <select data-field="maxChainLoops" data-ti="${ti}">
            <option value=""${!track.maxChainLoops ? ' selected' : ''}>${tr('infiniteLoops')}</option>
            ${[1,2,3,5,10].map(n => `<option value="${n}"${track.maxChainLoops === n ? ' selected' : ''}>${n}</option>`).join('')}
          </select>
          <div class="hint-inline">${tr('maxChainLoopsHint')}</div>
          <label data-help="trackDescription" style="margin-top:14px">${tr('descriptionLabel')}</label>
          <textarea class="linkable" data-field="description" data-ti="${ti}">${escapeHtml(track.description)}</textarea>
          <label style="margin-top:14px">${tr('trackTagsLabel')}</label>
          <input type="text" data-field="tags" data-ti="${ti}" value="${escapeAttr(track.tags || '')}">
          <div class="hint-inline">${tr('trackTagsHint')}</div>
          <label style="display:flex;align-items:center;gap:8px;margin-top:10px;">
            <input type="checkbox" data-field="normalizeVolume" data-ti="${ti}" ${track.normalizeVolume ? 'checked' : ''} style="width:auto;margin:0;">
            <span data-help="normalizeVolume" style="color:var(--text-dim);font-size:12px;">${tr('normalizeVolumeLabel')}</span>
          </label>
          ${trackPitchFxHtml(track, ti)}
          ${fxTriggersEditorHtml(track, ti)}
          ${fxSlidersEditorHtml(track, ti)}
        `;
        slotsDetailHost.appendChild(infoEl);
      }
      // -- Catégorie "Structure" (libellé non cliquable, toujours juste après "Infos du morceau") :
      // Intro, chaque emplacement, Outro -- même principe que les autres modes (18/08).
      const seqCatLabel = document.createElement('div');
      seqCatLabel.className = 'seq-master-category-label';
      seqCatLabel.textContent = tr('trackSectionStructure');
      slotsMasterHost.appendChild(seqCatLabel);

      // Fichiers lâchés directement sur une entrée de la liste (25/09, demande de Jules-Antoine) : Intro/Outro
      // prennent le premier fichier, un slot les prend tous en variations. L'entrée est sélectionnée pour
      // montrer le résultat. Un slot dupliqué n'a pas de fichiers à lui : pas de dépôt (le filet de sécurité
      // global avale l'événement).
      const wireStageDrop = (item, stage) => wireBatchDrop(item, files => { seqSelectedSlotIndex.set(track.id, stage === 'intro' ? 'seqIntro' : 'seqOutro'); setSeqStageFile(track, stage, files[0]); });
      const introMasterItem = seqMasterItem('seqIntro', `<div class="seq-master-item-label">${tr('introShortLabel')}</div>`, true);
      wireStageDrop(introMasterItem, 'intro');
      slotsMasterHost.appendChild(introMasterItem);
      if (selectedSi === 'seqIntro') {
        const introEl = document.createElement('div');
        introEl.innerHTML = `
          <div data-role="introCtrl" style="margin-bottom:10px"></div>
          <div class="row">
            <div><label>${tr('nameFieldLabel')}</label><input type="text" data-field="introLabel" data-ti="${ti}" value="${escapeAttr(track.intro.label)}"></div>
            <div><label>${tr('barsLabel')}</label><input type="text" inputmode="numeric" data-field="introBars" data-ti="${ti}" value="${track.intro.bars || 8}"></div>
            <div><label>${tr('roleLabel')}</label>
              <select data-role-select="intro" data-ti="${ti}">
                <option value="intro" selected>${tr('roleIntro')}</option>
                <option value="segment">${tr('roleSegment')}</option>
                <option value="outro">${tr('roleOutro')}</option>
              </select>
            </div>
          </div>
          <div class="hint-inline">${tr('introSectionLabel')}</div>
          <div style="margin-top:8px">
            ${collapsibleBlockToggleHtml(`introDesc:${ti}`, tr('stageDescriptionToggleLabel'), 'introDescToggle', 'stageDescription')}
            <div class="list-block-body${expandedAltPoolKeys.has(`introDesc:${ti}`) ? '' : ' collapsed'}" data-role="introDescBody" style="margin-top:8px">
              <div class="hint-inline">${tr('stageDescriptionHint')}</div>
              <div><label>${tr('stageDescriptionFrLabel')}</label><textarea rows="2" data-field="introDescriptionFr" data-ti="${ti}">${escapeHtml((track.intro && track.intro.descriptionFr) || '')}</textarea></div>
              <div><label>${tr('stageDescriptionEnLabel')}</label><textarea rows="2" data-field="introDescriptionEn" data-ti="${ti}">${escapeHtml((track.intro && track.intro.descriptionEn) || '')}</textarea></div>
            </div>
          </div>
          ${track.intro ? stageFxHtml(track.intro.fx, 'intro', `data-ti="${ti}"`) : ''}
        `;
        slotsDetailHost.appendChild(introEl);
        const introCtrlHost = introEl.querySelector('[data-role="introCtrl"]');
        introCtrlHost.innerHTML = fileCtrlHtml(tr('chooseWavMp3'));
        wireFileControl(introCtrlHost, '.wav,audio/wav,.mp3,audio/mp3,audio/mpeg',
          () => track.intro.pendingFile, () => track.intro.remoteFile,
          f => setSeqStageFile(track, 'intro', f), () => track.intro.originalFileName);
        wireCollapsibleBlockToggle(introEl.querySelector('[data-role="introDescToggle"]'), introEl.querySelector('[data-role="introDescBody"]'), `introDesc:${ti}`);
      }
      track.segmentSlots.forEach((slot, si) => {
        if (!slot.alternatives) slot.alternatives = [];
        const isDuplicateForMaster = !!slot.referencesSlotId;
        const branchCountForMaster = (slot.nextOptions || []).length;
        const masterItem = document.createElement('div');
        masterItem.className = 'seq-master-item seq-master-item-child' + (si === selectedSi ? ' active' : '');
        masterItem.dataset.action = 'select-seq-slot';
        masterItem.dataset.ti = ti;
        masterItem.dataset.si = si;
        masterItem.dataset.dragId = slot.id;
        masterItem.innerHTML = `
          <div class="seq-master-item-label">${dragHandleHtml()}#${si + 1} ${escapeAttr((slot.label || '').replace(/^#\d+\s*/, '')) || tr('slotFallback', { n: si + 1 })}</div>
          <div class="seq-master-item-tags">
            ${isDuplicateForMaster ? `<span class="seq-master-item-tag">${tr('seqDuplicateTag')}</span>` : ''}
            ${branchCountForMaster ? `<span class="seq-master-item-tag">${trCount(branchCountForMaster, 'seqOutletsSingular', 'seqOutletsPlural')}</span>` : ''}
          </div>
        `;
        if (!isDuplicateForMaster) wireBatchDrop(masterItem, files => { seqSelectedSlotIndex.set(track.id, si); addFilesToSeqSlot(track, ti, si, files); });
        slotsMasterHost.appendChild(masterItem);
        if (si !== selectedSi) return; // seule la carte sélectionnée reçoit le détail complet ci-dessous
        const slotEl = document.createElement('div');
        slotEl.className = 'list-block';
        slotEl.style.marginBottom = '10px';
        const isDuplicate = !!slot.referencesSlotId;
        const sourceSlot = isDuplicate ? track.segmentSlots.find(sl => sl.id === slot.referencesSlotId) : null;
        const hasAnyFile = isDuplicate ? !!(sourceSlot && sourceSlot.alternatives.some(a => a.pendingFile || a.remoteFile)) : slot.alternatives.some(a => a.pendingFile || a.remoteFile);
        // Emplacements pouvant servir de source à dupliquer : n'importe quel autre emplacement qui n'est
        // pas lui-même une duplication (on évite les chaînes de références, une seule indirection).
        const duplicatableOptions = track.segmentSlots.filter((sl, osi) => osi !== si && !sl.referencesSlotId);
        // Un emplacement qui sert déjà de source à un ou plusieurs autres (via leur propre référence) ne
        // peut pas à son tour devenir un duplicata — ça créerait une chaîne à deux niveaux que le lecteur
        // ne sait pas résoudre (une seule indirection gérée, pas une résolution récursive).
        const isReferencedByOthers = track.segmentSlots.some(sl => sl.referencesSlotId === slot.id);
        slotEl.innerHTML = `
          <div class="list-block-head">
            <input type="text" placeholder="${tr('slotNamePlaceholder')}" data-slot-field="label" data-ti="${ti}" data-si="${si}" value="${escapeAttr(slot.label)}" style="flex:1;margin:0 8px 0 0;">
            <button class="btn btn-small btn-danger" data-action="remove-segment-slot" data-ti="${ti}" data-si="${si}">${tr('removeSegmentSlotBtn')}</button>
          </div>
          ${!hasAnyFile ? `<div class="hint-inline" style="color:#b45309">${tr('noAltFileWarning')}</div>` : ''}
          <div class="row" style="margin-top:8px">
            <div>
              <label data-help="slotRepeatCount">${tr('repeatCountLabel')}</label>
              <input type="text" inputmode="numeric" data-slot-field="repeatCount" data-ti="${ti}" data-si="${si}" value="${slot.repeatCount || 1}">
            </div>
            <div>
              <label data-help="slotContentSource">${tr('slotContentSourceLabel')}</label>
              <select data-slot-field="referencesSlotId" data-ti="${ti}" data-si="${si}" ${isReferencedByOthers ? 'disabled' : ''}>
                <option value="">${tr('slotContentOwnOption')}</option>
                ${duplicatableOptions.map(other => `<option value="${other.id}" ${slot.referencesSlotId === other.id ? 'selected' : ''}>${tr('slotContentDuplicateOption', { label: escapeAttr(other.label) || tr('untitledFallback') })}</option>`).join('')}
              </select>
            </div>
            ${!isDuplicate ? `
              <div>
                <label data-help="slotBpmOverride">${tr('bpmLabel')}</label>
                <input type="text" inputmode="decimal" placeholder="${bpm}" data-slot-field="bpm" data-ti="${ti}" data-si="${si}" value="${slot.bpm || ''}">
              </div>
            ` : ''}
          </div>
          ${!isDuplicate ? `
            <div class="hint-inline">${tr('slotBpmOverrideHint')}</div>
            <div class="row" style="margin-top:8px">
              <div><label>${tr('beatsPerBarLabel')}</label><input type="text" inputmode="numeric" placeholder="${beatsPerBar}" data-slot-field="beatsPerBar" data-ti="${ti}" data-si="${si}" value="${slot.beatsPerBar || ''}"></div>
            </div>
          ` : ''}
          ${isReferencedByOthers ? `<div class="hint-inline">${tr('slotIsSourceHint')}</div>` : ''}
          <div class="hint-inline">${tr('repeatCountHint')}</div>
          <div style="margin-top:8px">
            ${collapsibleBlockToggleHtml(`slotDesc:${ti}:${si}`, tr('stageDescriptionToggleLabel'), 'slotDescToggle', 'stageDescription')}
            <div class="list-block-body${expandedAltPoolKeys.has(`slotDesc:${ti}:${si}`) ? '' : ' collapsed'}" data-role="slotDescBody" style="margin-top:8px">
              <div class="hint-inline">${tr('stageDescriptionHint')}</div>
              <div><label>${tr('stageDescriptionFrLabel')}</label><textarea rows="2" data-slot-field="descriptionFr" data-ti="${ti}" data-si="${si}">${escapeHtml(slot.descriptionFr || '')}</textarea></div>
              <div><label>${tr('stageDescriptionEnLabel')}</label><textarea rows="2" data-slot-field="descriptionEn" data-ti="${ti}" data-si="${si}">${escapeHtml(slot.descriptionEn || '')}</textarea></div>
            </div>
          </div>
          <div class="switch-row">
            <input type="checkbox" id="hasBranches-${ti}-${si}" data-slot-field="hasBranches" data-ti="${ti}" data-si="${si}" ${(slot.nextOptions && slot.nextOptions.length) ? 'checked' : ''}>
            <span class="switch-row-label" data-help="slotHasBranches">${tr('hasBranchesLabel')}</span>
            ${(slot.nextOptions && slot.nextOptions.length) ? `<span class="switch-row-badge">${trCount(slot.nextOptions.length, 'seqOutletsSingular', 'seqOutletsPlural')}</span>` : ''}
          </div>
          ${(slot.nextOptions && slot.nextOptions.length) ? `
            <div class="branch-options-panel">
              ${collapsibleBlockToggleHtml(`branches:${ti}:${si}`, tr('branchOptionsToggleLabel'), 'branchesToggle', 'slotHasBranches')}
              <div class="list-block-body${expandedAltPoolKeys.has(`branches:${ti}:${si}`) ? '' : ' collapsed'}" data-role="branchesBody" style="margin-top:8px">
                <div class="hint-inline">${tr('branchOptionsHint')}</div>
                <div class="row" style="margin-top:8px">
                  <div>
                    <label data-help="slotQuantization">${tr('quantizationLabel')}</label>
                    <select data-slot-field="quantization" data-ti="${ti}" data-si="${si}">
                      <option value="immediate"${(slot.quantization || 'bar') === 'immediate' ? ' selected' : ''}>${tr('quantizationImmediate')}</option>
                      <option value="beat"${(slot.quantization || 'bar') === 'beat' ? ' selected' : ''}>${tr('quantizationBeat')}</option>
                      <option value="bar"${(slot.quantization || 'bar') === 'bar' ? ' selected' : ''}>${tr('quantizationBar')}</option>
                    </select>
                  </div>
                  <div>
                    <label data-help="slotCutStyle">${tr('cutStyleLabel')}</label>
                    <select data-slot-field="cutStyle" data-ti="${ti}" data-si="${si}">
                      <option value="fade"${(slot.cutStyle || 'fade') === 'fade' ? ' selected' : ''}>${tr('cutStyleFade')}</option>
                      <option value="hard"${(slot.cutStyle || 'fade') === 'hard' ? ' selected' : ''}>${tr('cutStyleHard')}</option>
                      <option value="custom"${slot.cutStyle === 'custom' ? ' selected' : ''}>${tr('cutStyleCustom')}</option>
                    </select>
                  </div>
                </div>
                ${slot.cutStyle === 'custom' ? `
                  <div style="margin-top:8px">
                    <label data-help="slotCustomCutFade">${tr('customCutFadeLabel')}</label>
                    <input type="range" min="0" max="8" step="0.05" data-slot-field="customCutFadeSec" data-ti="${ti}" data-si="${si}" value="${slot.customCutFadeSec != null ? slot.customCutFadeSec : 0.15}">
                    <span class="hint-inline" data-role="customCutFadeValue">${(slot.customCutFadeSec != null ? slot.customCutFadeSec : 0.15).toFixed(2)}s</span>
                  </div>
                ` : ''}
                <div data-role="branchOptions"></div>
                <div class="actions"><button class="btn btn-small" data-action="add-branch-option" data-ti="${ti}" data-si="${si}">${tr('addBranchOptionBtn')}</button></div>
              </div>
            </div>
          ` : ''}
          ${isDuplicate ? `
            <div class="hint-inline">${tr('slotDuplicateHint', { label: escapeAttr((sourceSlot && sourceSlot.label) || tr('untitledFallback')) })}</div>
          ` : `
            <label style="display:flex;align-items:center;gap:8px;margin-top:8px;">
              <input type="checkbox" data-slot-field="avoidImmediateRepeat" data-ti="${ti}" data-si="${si}" ${slot.avoidImmediateRepeat ? 'checked' : ''} style="width:auto;margin:0;">
              <span style="color:var(--text-dim);font-size:12px;">${tr('avoidRepeatAltLabel')}</span>
            </label>
            <div class="hint-inline">${tr('silentAltHint')}</div>
            <div class="hint-inline">${tr('seqSlotBatchDropHint')}</div>
            <div class="eyebrow-block">
              <div class="eyebrow-block-title">Variations de cet emplacement</div>
              ${altPoolToggleHtml(`slotpool:${ti}:${si}`, slot.alternatives.length)}
              <div class="list-block-body alt-pool-panel${expandedAltPoolKeys.has(`slotpool:${ti}:${si}`) ? '' : ' collapsed'}" data-role="altPoolBody" style="margin-top:8px">
                <div data-role="slotAlternatives"></div>
                <div class="actions"><button class="btn btn-small" data-action="add-slot-alternative" data-ti="${ti}" data-si="${si}">${tr('addAlternativeBtn')}</button></div>
              </div>
            </div>
          `}
          ${slotFxHtml(slot, ti, si)}
        `;
        // Les options d'embranchement dépendent des libellés de TOUS les emplacements (qui peuvent changer
        // à tout moment) : construites dynamiquement ici plutôt que figées dans le gabarit HTML statique
        // ci-dessus — même principe que le <select> "dupliquer le contenu de" un peu plus haut. Placé AVANT
        // le retour anticipé sur emplacement dupliqué : le contenu audio peut être dupliqué, la position
        // dans la chaîne (donc les embranchements) reste une propriété propre à CET emplacement.
        const branchOptionsHost = slotEl.querySelector('[data-role="branchOptions"]');
        if (branchOptionsHost && slot.nextOptions) {
          slot.nextOptions.forEach((opt, bi) => {
            const wrap = document.createElement('div');
            wrap.className = 'branch-option-card';
            wrap.style.marginTop = '8px';
            const targetOptionsHtml = track.segmentSlots.map((sl, tsi) => tsi === si ? '' :
              `<option value="${sl.id}" ${opt.targetId === sl.id ? 'selected' : ''}>${escapeAttr(sl.label) || tr('slotFallback', { n: tsi + 1 })}</option>`
            ).join('');
            const hasTransitionFile = !!(opt.transition && (opt.transition.pendingFile || opt.transition.remoteFile));
            wrap.innerHTML = `
              <div class="branch-option-eyebrow">${tr('seqOutletLabel', { n: bi + 1 }).toUpperCase()}</div>
              <div class="row">
                <div>
                  <label>${tr('branchTargetLabel')}</label>
                  <select data-branch-field="targetId" data-ti="${ti}" data-si="${si}" data-bi="${bi}">${targetOptionsHtml}</select>
                </div>
                <div>
                  <label>${tr('branchLabelOverrideLabel')}</label>
                  <input type="text" placeholder="${tr('branchLabelOverridePlaceholder')}" data-branch-field="label" data-ti="${ti}" data-si="${si}" data-bi="${bi}" value="${escapeAttr(opt.label)}">
                </div>
                <button class="btn btn-icon btn-danger" data-action="remove-branch-option" data-ti="${ti}" data-si="${si}" data-bi="${bi}" title="${tr('removeBranchOptionBtn')}" style="align-self:flex-end">×</button>
              </div>
              <label class="switch-row" style="margin-top:8px">
                <input type="checkbox" data-branch-field="hasTransition" data-ti="${ti}" data-si="${si}" data-bi="${bi}" ${opt.transition ? 'checked' : ''}>
                <span class="switch-row-label" data-help="branchTransition">${tr('hasTransitionLabel')}</span>
              </label>
              ${opt.transition ? `
                <div data-role="transitionFileCtrl" style="margin-top:6px;margin-bottom:6px"></div>
                <div class="hint-inline">${tr('transitionHint')}</div>
                ${!hasTransitionFile ? `<div class="hint-inline" style="color:#b45309">${tr('noTransitionFileWarning')}</div>` : ''}
                <div class="row" style="margin-top:6px">
                  <div><label>${tr('branchLabelOverrideLabel')}</label><input type="text" placeholder="${tr('transitionNamePlaceholder')}" data-branch-transition-field="label" data-ti="${ti}" data-si="${si}" data-bi="${bi}" value="${escapeAttr(opt.transition.label)}"></div>
                  <div>
                    <label data-help="transitionDurationUnit">${tr('transitionDurationUnitLabel')}</label>
                    <select data-branch-transition-field="durationUnit" data-ti="${ti}" data-si="${si}" data-bi="${bi}">
                      <option value="bars"${(opt.transition.durationUnit || 'bars') === 'bars' ? ' selected' : ''}>${tr('transitionDurationUnitBars')}</option>
                      <option value="beats"${opt.transition.durationUnit === 'beats' ? ' selected' : ''}>${tr('transitionDurationUnitBeats')}</option>
                      <option value="seconds"${opt.transition.durationUnit === 'seconds' ? ' selected' : ''}>${tr('transitionDurationUnitSeconds')}</option>
                    </select>
                  </div>
                </div>
                ${opt.transition.durationUnit === 'seconds' ? `
                  <div class="row" style="margin-top:6px">
                    <div><label>${tr('transitionDurationSecondsLabel')}</label><input type="text" inputmode="decimal" data-branch-transition-field="durationSeconds" data-ti="${ti}" data-si="${si}" data-bi="${bi}" value="${opt.transition.durationSeconds != null ? opt.transition.durationSeconds : 1}"></div>
                  </div>
                ` : `
                  <div class="row" style="margin-top:6px">
                    ${opt.transition.durationUnit === 'beats' ? `
                      <div><label>${tr('transitionDurationBeatsLabel')}</label><input type="text" inputmode="decimal" data-branch-transition-field="durationBeats" data-ti="${ti}" data-si="${si}" data-bi="${bi}" value="${opt.transition.durationBeats || 1}"></div>
                    ` : `
                      <div><label>${tr('barsLabel')}</label><input type="text" inputmode="numeric" data-branch-transition-field="bars" data-ti="${ti}" data-si="${si}" data-bi="${bi}" value="${opt.transition.bars || 4}"></div>
                    `}
                    <div><label>${tr('bpmLabel')}</label><input type="text" inputmode="decimal" placeholder="${slot.bpm || bpm}" data-branch-transition-field="bpm" data-ti="${ti}" data-si="${si}" data-bi="${bi}" value="${opt.transition.bpm || ''}"></div>
                    <div><label>${tr('beatsPerBarLabel')}</label><input type="text" inputmode="numeric" placeholder="${slot.beatsPerBar || beatsPerBar}" data-branch-transition-field="beatsPerBar" data-ti="${ti}" data-si="${si}" data-bi="${bi}" value="${opt.transition.beatsPerBar || ''}"></div>
                  </div>
                  <div class="hint-inline">${tr('transitionBarsTempoHint')}</div>
                `}
                <div style="margin-top:6px">
                  ${collapsibleBlockToggleHtml(`transDesc:${ti}:${si}:${bi}`, tr('stageDescriptionToggleLabel'), 'transDescToggle', 'stageDescription')}
                  <div class="list-block-body${expandedAltPoolKeys.has(`transDesc:${ti}:${si}:${bi}`) ? '' : ' collapsed'}" data-role="transDescBody" style="margin-top:6px">
                    <div class="hint-inline">${tr('stageDescriptionHint')}</div>
                    <div><label>${tr('stageDescriptionFrLabel')}</label><textarea rows="2" data-branch-transition-field="descriptionFr" data-ti="${ti}" data-si="${si}" data-bi="${bi}">${escapeHtml(opt.transition.descriptionFr || '')}</textarea></div>
                    <div><label>${tr('stageDescriptionEnLabel')}</label><textarea rows="2" data-branch-transition-field="descriptionEn" data-ti="${ti}" data-si="${si}" data-bi="${bi}">${escapeHtml(opt.transition.descriptionEn || '')}</textarea></div>
                  </div>
                </div>
                ${stageFxHtml(opt.transition.fx, 'seqTransition', `data-ti="${ti}" data-si="${si}" data-bi="${bi}"`)}
              ` : ''}
              ${fxActionsHtml(opt.fxActions, track, `data-fx-owner="opt" data-ti="${ti}" data-si="${si}" data-bi="${bi}"`)}
            `;
            branchOptionsHost.appendChild(wrap);
            if (opt.transition) {
              wireCollapsibleBlockToggle(wrap.querySelector('[data-role="transDescToggle"]'), wrap.querySelector('[data-role="transDescBody"]'), `transDesc:${ti}:${si}:${bi}`);
              const ctrlHost = wrap.querySelector('[data-role="transitionFileCtrl"]');
              ctrlHost.innerHTML = fileCtrlHtml(tr('chooseWavMp3'));
              wireFileControl(ctrlHost, '.wav,audio/wav,.mp3,audio/mp3,audio/mpeg',
                () => opt.transition.pendingFile, () => opt.transition.remoteFile,
                f => {
                  opt.transition.pendingFile = f;
                  hasUnsavedEdits = true;
                  if (!opt.transition.label || !opt.transition.label.trim()) opt.transition.label = titleFromFilename(f.name);
                  renderLibrary();
                }, () => opt.transition.originalFileName);
            }
          });
        }
        // Câblage à faire AVANT le retour anticipé sur duplicata : ces deux blocs (embranchements, texte
        // narratif) s'affichent dans le gabarit que l'emplacement soit un duplicata ou non -- seul le
        // contenu audio (alternatives/anti-répétition, juste en dessous) diffère selon isDuplicate. Un
        // emplacement dupliqué avec des embranchements ou un texte narratif renseigné aurait sinon un
        // bouton dépliant présent dans le DOM mais totalement inerte au clic (bug repéré le 18/08, présent
        // aussi pour "branchesToggle" avant même l'ajout du texte narratif).
        wireCollapsibleBlockToggle(slotEl.querySelector('[data-role="branchesToggle"]'), slotEl.querySelector('[data-role="branchesBody"]'), `branches:${ti}:${si}`);
        wireCollapsibleBlockToggle(slotEl.querySelector('[data-role="slotDescToggle"]'), slotEl.querySelector('[data-role="slotDescBody"]'), `slotDesc:${ti}:${si}`);
        if (isDuplicate) { slotsDetailHost.appendChild(slotEl); return; }
        // Uniquement pertinent pour un emplacement non dupliqué : le pool d'alternatives propre à CET
        // emplacement (un duplicata affiche un simple message renvoyant vers l'emplacement source à la place).
        wireAltPoolToggle(slotEl);
        const altsHost = slotEl.querySelector('[data-role="slotAlternatives"]');
        slot.alternatives.forEach((alt, ai) => {
          const altRow = document.createElement('div');
          altRow.className = 'list-block';
          altRow.style.marginBottom = '8px';
          altRow.innerHTML = `
            <div data-role="slotAltFileCtrl" style="margin-bottom:8px"></div>
            <div class="row">
              <div><label>${tr('labelFieldLabel')}</label><input type="text" placeholder="${tr('altLabelPlaceholder')}" data-slot-alt-field="label" data-ti="${ti}" data-si="${si}" data-ai="${ai}" value="${escapeAttr(alt.label)}"></div>
              <div><label>${tr('barsLabel')}</label><input type="text" inputmode="numeric" data-slot-alt-field="bars" data-ti="${ti}" data-si="${si}" data-ai="${ai}" value="${alt.bars || 8}"></div>
              <div><label>${tr('roleLabel')}</label>
                <select data-role-select="segment" data-ti="${ti}" data-si="${si}" data-ai="${ai}">
                  <option value="intro">${tr('roleIntro')}</option>
                  <option value="segment" selected>${tr('roleSegment')}</option>
                  <option value="outro">${tr('roleOutro')}</option>
                </select>
              </div>
            </div>
          `;
          const altCtrlHost = altRow.querySelector('[data-role="slotAltFileCtrl"]');
          altCtrlHost.innerHTML = fileCtrlHtml(tr('chooseWavMp3'), deleteIconBtnHtml('remove-slot-alternative', { ti, si, ai }, tr('removeAlternativeBtn')));
          wireFileControl(altCtrlHost, '.wav,audio/wav,.mp3,audio/mp3,audio/mpeg',
            () => alt.pendingFile, () => alt.remoteFile,
            f => {
              alt.pendingFile = f;
              hasUnsavedEdits = true;
              if (!alt.label || !alt.label.trim()) { alt.label = titleFromFilename(f.name); renderLibrary(); }
              probeAudioDuration(f).then(dur => { if (dur > (track.duration || 0)) { track.duration = dur; renderLibrary(); } });
            }, () => alt.originalFileName);
          altsHost.appendChild(altRow);
        });
        // Dépôt groupé du slot (25/09, même principe que la section du vertical-random : on crée le slot à la
        // main, puis on y dépose tous ses fichiers -- chacun devient une variation). Zone visible en haut du
        // slot, en plus de la liste des variations (repliée par défaut, d'où l'ajout). Ouverte à tous : c'est
        // l'ancien dépôt dans la liste des variations, rendu visible et complété.
        // Tout le panneau du slot est une zone de dépôt (25/09) : chaque fichier devient une variation. Un fichier
        // lâché sur le sélecteur d'une variation précise remplace toujours SON fichier (wireFileControl).
        slotEl.classList.add('seq-slot-drop-panel');
        wireBatchDrop(slotEl, files => addFilesToSeqSlot(track, ti, si, files));
        slotsDetailHost.appendChild(slotEl);
      });
      const outroMasterItem = seqMasterItem('seqOutro', `<div class="seq-master-item-label">${tr('outroShortLabel')}</div>`, true);
      wireStageDrop(outroMasterItem, 'outro');
      slotsMasterHost.appendChild(outroMasterItem);
      if (selectedSi === 'seqOutro') {
        const outroEl = document.createElement('div');
        outroEl.innerHTML = `
          <div data-role="outroCtrl" style="margin-bottom:10px"></div>
          <div class="row">
            <div><label>${tr('nameFieldLabel')}</label><input type="text" data-field="outroLabel" data-ti="${ti}" value="${escapeAttr(track.outro.label)}"></div>
            <div><label>${tr('roleLabel')}</label>
              <select data-role-select="outro" data-ti="${ti}">
                <option value="intro">${tr('roleIntro')}</option>
                <option value="segment">${tr('roleSegment')}</option>
                <option value="outro" selected>${tr('roleOutro')}</option>
              </select>
            </div>
          </div>
          <div class="hint-inline">${tr('outroSectionLabel')}</div>
          <div class="hint-inline">${tr('noOutroHint')}</div>
          <div style="margin-top:8px">
            ${collapsibleBlockToggleHtml(`outroDesc:${ti}`, tr('stageDescriptionToggleLabel'), 'outroDescToggle', 'stageDescription')}
            <div class="list-block-body${expandedAltPoolKeys.has(`outroDesc:${ti}`) ? '' : ' collapsed'}" data-role="outroDescBody" style="margin-top:8px">
              <div class="hint-inline">${tr('stageDescriptionHint')}</div>
              <div><label>${tr('stageDescriptionFrLabel')}</label><textarea rows="2" data-field="outroDescriptionFr" data-ti="${ti}">${escapeHtml((track.outro && track.outro.descriptionFr) || '')}</textarea></div>
              <div><label>${tr('stageDescriptionEnLabel')}</label><textarea rows="2" data-field="outroDescriptionEn" data-ti="${ti}">${escapeHtml((track.outro && track.outro.descriptionEn) || '')}</textarea></div>
            </div>
          </div>
          ${track.outro ? stageFxHtml(track.outro.fx, 'outro', `data-ti="${ti}"`) : ''}
        `;
        slotsDetailHost.appendChild(outroEl);
        const outroCtrlHost = outroEl.querySelector('[data-role="outroCtrl"]');
        outroCtrlHost.innerHTML = fileCtrlHtml(tr('chooseWavMp3'));
        wireFileControl(outroCtrlHost, '.wav,audio/wav,.mp3,audio/mp3,audio/mpeg',
          () => track.outro.pendingFile, () => track.outro.remoteFile,
          f => setSeqStageFile(track, 'outro', f), () => track.outro.originalFileName);
        wireCollapsibleBlockToggle(outroEl.querySelector('[data-role="outroDescToggle"]'), outroEl.querySelector('[data-role="outroDescBody"]'), `outroDesc:${ti}`);
      }
      // "+ Emplacement" vit désormais à la suite de la Structure (juste après Outro), plutôt que sous
      // toute la colonne maître (ce qui le plaçait à tort après Contenu additionnel/Infos additionnelles,
      // 20/08 -- retour visuel).
      appendMasterAddButton(slotsMasterHost, 'add-segment-slot', ti, 'addSegmentSlotBtn');
      // Ordre des slots par poignée (25/09, remplace les flèches ↑/↓), Alt + glisser pour copier. Intro/Outro et les
      // autres entrées (sans data-drag-id) ne bougent pas et ne servent pas de cible.
      wireArrayDragReorder(slotsMasterHost, 'seq-master-item', () => track.segmentSlots, item => { seqSelectedSlotIndex.set(track.id, track.segmentSlots.indexOf(item)); renderLibrary(); }, item => cloneWithCopyLabel(item));
      // -- "Contenu additionnel" (Sfx) et "Infos additionnelles" (note d'implémentation + certification) --
      // même principe : entrées virtuelles de la liste maître, contenu déplacé tel quel depuis l'ancien
      // bloc "Réglages avancés" du flux plat (mêmes data-field/data-role, juste un autre emplacement DOM).
      if (!track.sfxIds) track.sfxIds = [];
      slotsMasterHost.appendChild(seqMasterItem('sfx', `
        <div class="seq-master-item-label">${tr('seqContentAdditionalLabel')}</div>
        <div class="seq-master-item-tags"><span class="seq-master-item-tag">${trCount(track.sfxIds.length, 'blockSummarySfxSingular', 'blockSummarySfx')}</span></div>
      `));
      if (selectedSi === 'sfx') {
        const sfxEl = document.createElement('div');
        sfxEl.innerHTML = `
          <label data-help="stingers">${tr('stingersLabel')}</label>
          <div class="hint-inline">${tr('trackSfxHint')}</div>
          <div data-role="trackSfxSelector" data-ti="${ti}" style="margin-top:6px"></div>
        `;
        slotsDetailHost.appendChild(sfxEl);
      }
      slotsMasterHost.appendChild(seqMasterItem('infos', `
        <div class="seq-master-item-label">${tr('seqAdditionalInfoLabel')}</div>
      `));
      if (selectedSi === 'infos') {
        const notesEl = document.createElement('div');
        notesEl.innerHTML = `
          <label data-help="implementationNote">${tr('implementationNoteLabel')}</label>
          <textarea data-field="implementationNote" data-ti="${ti}" placeholder="${tr('implementationNotePlaceholder')}">${escapeAttr(track.implementationNote || '')}</textarea>
          <div class="hint-inline">${tr('implementationNoteHint')}</div>
          <label data-help="noAiOverride" style="margin-top:14px">${tr('noAiOverrideLabel')}</label>
          <select data-field="noAiOverride" data-ti="${ti}">
            <option value="" ${(track.noAiOverride !== true && track.noAiOverride !== false) ? 'selected' : ''}>${tr('noAiFollowGlobalOption', { state: noAiCertifiedGlobal ? tr('yesWord') : tr('noWord') })}</option>
            <option value="true" ${track.noAiOverride === true ? 'selected' : ''}>${tr('noAiAlwaysCertifyOption')}</option>
            <option value="false" ${track.noAiOverride === false ? 'selected' : ''}>${tr('noAiNeverCertifyOption')}</option>
          </select>
          <div class="hint-inline">${tr('noAiOverrideHint')}</div>
        `;
        slotsDetailHost.appendChild(notesEl);
      }
    }
    const trackSfxSelectorHost = el.querySelector('[data-role="trackSfxSelector"]');
    if (!track.sfxIds) track.sfxIds = [];
    if (trackSfxSelectorHost) buildSfxSelectorWidget(trackSfxSelectorHost, track.sfxIds, () => { hasUnsavedEdits = true; });

    detailHost.appendChild(el);
  });
}

