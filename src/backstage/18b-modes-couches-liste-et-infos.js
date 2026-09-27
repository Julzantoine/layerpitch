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
