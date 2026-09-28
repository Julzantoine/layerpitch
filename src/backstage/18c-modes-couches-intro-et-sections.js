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
              <label data-help="vrsSectionBatchDrop" style="margin-top:14px">${tr('vrsSectionBatchDropLabel')}${!flagOpen('bulk_drop') ? `<span class="hint-inline" style="margin:0 0 0 6px">${tr('fxAdminOnlyHint')}</span>` : ''}</label>
              <div class="hint-inline">${tr('vrsSectionBatchDropHint')}</div>
              <div data-role="vrsSectionDrop" class="${flagOpen('bulk_drop') ? '' : 'is-disabled'}" style="margin-top:6px">${tr('dropAllFilesHint')}</div>
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
          if (sectionDropHost && flagOpen('bulk_drop')) wireBatchDrop(sectionDropHost, files => openVrsBatchDropDialog(track, section, files));
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
