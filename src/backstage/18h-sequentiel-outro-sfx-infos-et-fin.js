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
          ${trackProtectionHtml(track, ti)}
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

