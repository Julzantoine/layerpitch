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
