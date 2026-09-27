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
