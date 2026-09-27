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
