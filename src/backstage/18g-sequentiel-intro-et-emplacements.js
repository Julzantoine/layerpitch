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
