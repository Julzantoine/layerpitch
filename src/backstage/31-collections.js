/* ---------------- Collections (regroupement de packs) ---------------- */
let collectionPacksRefreshers = []; // fonctions de re-rendu des sélecteurs de packs de chaque collection
function renderCollections() {
  const container = document.getElementById('collectionsContainer');
  container.innerHTML = '';
  collectionPacksRefreshers = [];
  collections.forEach((coll, ci) => {
    if (!coll.packIds) coll.packIds = [];
    const el = document.createElement('div');
    el.className = 'list-block';
    const collCollapsed = collapsedCollectionIds.has(coll.id);
    if (!collectionSelectedEntry.has(coll.id)) collectionSelectedEntry.set(coll.id, 'content');
    const entrySel = collectionSelectedEntry.get(coll.id);
    el.innerHTML = `
      <div class="list-block-head">
        <div class="list-block-head-left">
          <button class="btn btn-icon btn-toggle-collapse" data-action="toggle-collapse-collection" data-ci="${ci}" type="button">${collCollapsed ? '▸' : '▾'}</button>
          <input type="text" class="seq-header-title" data-collection-field="title" data-ci="${ci}" value="${escapeAttr(coll.title)}" placeholder="${tr('collectionFallback', { n: ci + 1 })}">
        </div>
        <button class="btn btn-small btn-danger" data-action="remove-collection" data-ci="${ci}">${tr('deleteBtn')}</button>
      </div>
      <div class="list-block-body${collCollapsed ? ' collapsed' : ''}" data-role="collectionBody">
      <div class="seq-two-col">
        <div class="seq-master-list" data-role="collectionMaster"></div>
        <div class="seq-detail-col" data-role="collectionDetail"></div>
      </div>
      ${collapseFooterHtml('toggle-collapse-collection', { ci })}
      </div>
    `;
    const collMasterHost = el.querySelector('[data-role="collectionMaster"]');
    const collDetailHost = el.querySelector('[data-role="collectionDetail"]');
    function collMasterItem(key, labelHtml) {
      return simpleMasterItemEl('select-collection-entry', 'ci', ci, key, entrySel === key, labelHtml);
    }
    collMasterHost.appendChild(collMasterItem('presentation', `<div class="seq-master-item-label">${tr('sectionPresentation')}</div>`));
    collMasterHost.appendChild(collMasterItem('content', `<div class="seq-master-item-label">${tr('trackSectionContent')}</div>`));
    collMasterHost.appendChild(collMasterItem('appearance', `<div class="seq-master-item-label">${tr('sectionAppearance')}</div>`));
    collMasterHost.appendChild(collMasterItem('distribution', `<div class="seq-master-item-label">${tr('sectionDistribution')}</div>`));

    const detailEl = document.createElement('div');
    if (entrySel === 'presentation') {
      // Fusion Identité + Présentation (20/08), même principe que le Pack juste à côté : titre (déjà
      // éditable en en-tête) + texte FR/EN sous un seul libellé, illustration/couleurs/police partis dans
      // Apparence.
      detailEl.innerHTML = `
        <label>${tr('titleLabel')}</label>
        <input type="text" data-collection-field="title" data-ci="${ci}" value="${escapeAttr(coll.title)}">
        <label data-help="collectionPresentation" style="margin-top:10px">${tr('presentationLabelFr')}</label>
        <textarea class="linkable" data-collection-field="presentationFr" data-ci="${ci}" rows="4">${escapeHtml(coll.presentationFr || '')}</textarea>
        <label data-help="collectionPresentationEn">${tr('presentationLabelEn')}</label>
        <textarea class="linkable" data-collection-field="presentationEn" data-ci="${ci}" rows="4">${escapeHtml(coll.presentationEn || '')}</textarea>
        <div class="hint-inline">${tr('linkHint')}</div>
        <div class="hint-inline">${tr('presentationBilingualHint')}</div>
      `;
    } else if (entrySel === 'content') {
      detailEl.innerHTML = `
        <label data-help="collectionPacks">${tr('collectionPacksLabel')}</label>
        <div data-role="packSelector"></div>
      `;
    } else if (entrySel === 'appearance') {
      // Nouvelle entrée (20/08) : par symétrie avec le Pack, mêmes réglages -- couleurs, police,
      // illustration. Pas de filigrane ici, Collections n'en a jamais eu (pas demandé).
      // Palier Free (Chantier Apparence Phase 3) : galerie de presets à la place des réglages fins,
      // même bascule que le Pack et l'AdReel.
      const collIsFree = currentEffectivePlan === 'free';
      const collIsPro = currentEffectivePlan === 'pro';
      const collSep = Object.assign({}, DEFAULT_SEPARATOR, coll.separator || {});
      // Palier Pro (10 septembre) : même départ rapide par preset que le Pack.
      const collProQuickStartHtml = collIsPro ? `
        <div class="hint-inline">${tr('themePresetProHint')}</div>
        <div class="theme-preset-gallery">
          ${THEME_PRESETS.concat(THEME_PRESETS_PRO).map(p => `
            <button type="button" class="theme-preset-card" data-action="apply-collection-preset-quickfill" data-ci="${ci}" data-preset-id="${p.id}"
              style="background:${p.bgColor};color:${p.titleColor}">${tr(p.labelKey)}</button>
          `).join('')}
        </div>
      ` : '';
      detailEl.innerHTML = collIsFree ? `
        <label data-help="collectionAppearance">${tr('packAppearanceLabel')}</label>
        <div class="hint-inline">${tr('themePresetFreeHint')}</div>
        <div class="theme-preset-gallery">
          ${THEME_PRESETS.map(p => `
            <button type="button" class="theme-preset-card${(coll.presetId || 'default') === p.id ? ' active' : ''}"
              data-action="select-collection-preset" data-ci="${ci}" data-preset-id="${p.id}"
              style="background:${p.bgColor};color:${p.titleColor}">${tr(p.labelKey)}</button>
          `).join('')}
        </div>
        <label data-help="collectionIllustration" style="margin-top:14px">${tr('illustrationLabel')}</label>
        <div data-role="illustrationCtrl"></div>
      ` : `
        <label data-help="collectionAppearance">${tr('packAppearanceLabel')}</label>
        ${collProQuickStartHtml}
        <div class="row">
          <div>
            <label>${tr('bgColorLabel')}</label>
            <input type="color" data-collection-field="bgColor" data-ci="${ci}" value="${coll.bgColor || '#f5f6f8'}">
          </div>
          <div>
            <label>${tr('textColorLabel')}</label>
            <input type="color" data-collection-field="textColor" data-ci="${ci}" value="${coll.textColor || '#24262b'}">
          </div>
        </div>
        <label data-help="collectionFont" style="margin-top:14px">${tr('themeFontLabel')}</label>
        <select data-collection-field="font" data-ci="${ci}">${buildFontSelectOptionsHtml(coll.font)}</select>
        <label data-i18n="separatorsLegend" style="margin-top:14px;display:block">${tr('separatorsLegend')}</label>
        <label style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <input type="checkbox" data-collection-field="separatorVisible" data-ci="${ci}" ${collSep.visible ? 'checked' : ''} style="width:auto;margin:0;">
          <span data-i18n="separatorVisibleLabel">${tr('separatorVisibleLabel')}</span>
        </label>
        <div class="row" style="margin-top:10px">
          <div>
            <label data-i18n="separatorColorLabel">${tr('separatorColorLabel')}</label>
            <input type="color" data-collection-field="separatorColor" data-ci="${ci}" value="${collSep.color}">
          </div>
          <div>
            <label data-i18n="separatorThicknessLabel">${tr('separatorThicknessLabel')}</label>
            <input type="number" data-collection-field="separatorThickness" data-ci="${ci}" min="1" max="10" step="1" value="${collSep.thickness}">
          </div>
        </div>
        <label data-help="collectionIllustration" style="margin-top:14px">${tr('illustrationLabel')}</label>
        <div data-role="illustrationCtrl"></div>
      `;
    } else if (entrySel === 'distribution') {
      detailEl.innerHTML = `
        <label style="display:flex;align-items:center;gap:8px;margin-top:0;">
          <input type="checkbox" data-collection-field="freeDownloadEnabled" data-ci="${ci}" ${coll.freeDownloadEnabled ? 'checked' : ''} style="width:auto;margin:0;">
          <span data-help="collectionFreeDownload" style="color:var(--text-dim);font-size:12px;">${tr('freeDownloadLabelCollection')}</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;">
          <input type="checkbox" data-collection-field="buyable" data-ci="${ci}" ${coll.buyable ? 'checked' : ''} style="width:auto;margin:0;">
          <span data-help="collectionBuyable" style="color:var(--text-dim);font-size:12px;">${tr('buyableLabelCollection')}</span>
        </label>
        ${coll.buyable ? `
          <label>${tr('buyUrlLabel')}</label>
          <input type="text" data-collection-field="buyUrl" data-ci="${ci}" value="${escapeAttr(coll.buyUrl)}" placeholder="https://...">
          <div class="hint-inline">${tr('buyUrlNotLiveHint')}</div>
        ` : ''}
        <label style="margin-top:14px">${tr('packDirectLinkLabel')}</label>
        <div id="collectionUrlBox_${coll.id}" class="hint-inline"></div>
        <div style="display:flex; gap:6px; margin-top:4px; flex-wrap:wrap;">
          <button class="btn btn-small" data-action="preview-collection" data-ci="${ci}" type="button" title="${escapeAttr(tr('previewHint'))}" style="flex:1">${tr('previewBtn')}</button>
          <button class="btn btn-small" data-action="copy-collection-url" data-ci="${ci}" type="button" style="flex:1">${tr('copyLink')}</button>
          <button class="btn btn-small" data-action="share-collection-url" data-ci="${ci}" type="button" style="flex:1">${tr('shareBtn')}</button>
          <button class="btn btn-small" data-action="embed-collection" data-ci="${ci}" type="button" style="flex:1">${tr('embedBtn')}</button>
        </div>
        <label data-help="publishToSocial" style="margin-top:14px">${tr('publishToSocialLabel')}</label>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">${publishButtonsHtml('publish-collection-social', 'ci', ci)}</div>
      `;
    }
    collDetailHost.appendChild(detailEl);

    if (entrySel === 'appearance') {
      const ctrlHost = detailEl.querySelector('[data-role="illustrationCtrl"]');
      ctrlHost.innerHTML = fileCtrlHtml(tr('chooseIllustration'));
      wireFileControl(ctrlHost, 'image/*',
        () => coll.pendingIllustration, () => coll.illustration,
        f => { coll.pendingIllustration = f; hasUnsavedEdits = true; }, () => coll.illustrationOriginalName);
    }
    if (entrySel === 'content') {
      const selectorHost = detailEl.querySelector('[data-role="packSelector"]');
      const refresh = buildPackSelectorWidget(selectorHost, coll.packIds, () => { hasUnsavedEdits = true; });
      collectionPacksRefreshers.push(refresh);
    }
    if (entrySel === 'distribution') {
      const collUrlBox = detailEl.querySelector(`#collectionUrlBox_${coll.id}`);
      const collUrl = computeCollectionUrl(coll.id);
      collUrlBox.innerHTML = collUrl ? `<a href="${escapeAttr(collUrl)}" target="_blank" rel="noopener">${escapeHtml(collUrl)}</a>` : escapeHtml(tr('adreelUrlPending'));
    }
    container.appendChild(el);
  });
}
document.getElementById('btnAddCollection').addEventListener('click', () => {
  collections.push({ id: genId(), title: tr('defaultCollectionTitle'), illustration: null, pendingIllustration: null, presentationFr: '', presentationEn: '', bgColor: '#f5f6f8', textColor: '#24262b', font: 'default', buyable: false, buyUrl: '', freeDownloadEnabled: false, packIds: [] });
  hasUnsavedEdits = true;
  trackBackstageEvent('collection_add', {});
  renderCollections();
});
document.getElementById('collectionsContainer').addEventListener('click', async e => {
  const entryBtn = e.target.closest('[data-action="select-collection-entry"]');
  if (entryBtn) {
    const ci = parseInt(entryBtn.dataset.ci, 10);
    collectionSelectedEntry.set(collections[ci].id, entryBtn.dataset.entry);
    renderCollections();
    return;
  }
  const toggleBtn = e.target.closest('[data-action="toggle-collapse-collection"]');
  if (toggleBtn) {
    const rowEl = toggleBtn.closest('.list-block');
    const body = rowEl.querySelector('[data-role="collectionBody"]');
    const collapsed = body.classList.toggle('collapsed');
    const topToggle = rowEl.querySelector('.list-block-head [data-action="toggle-collapse-collection"]');
    if (topToggle) topToggle.textContent = collapsed ? '▸' : '▾';
    const ci = parseInt(toggleBtn.dataset.ci, 10);
    const collId = collections[ci].id;
    if (collapsed) collapsedCollectionIds.add(collId); else collapsedCollectionIds.delete(collId);
    return;
  }
  const copyBtn = e.target.closest('[data-action="copy-collection-url"]');
  if (copyBtn) {
    const ci = parseInt(copyBtn.dataset.ci, 10);
    const url = computeCollectionUrl(collections[ci].id);
    if (!url) { window.LayerPitchNotify.info(tr('adreelUrlPending')); return; }
    const done = () => { const original = copyBtn.textContent; copyBtn.textContent = tr('copiedStatus'); setTimeout(() => { copyBtn.textContent = original; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => { window.LayerPitchNotify.error(tr('copyFailedAlert')); });
    } else {
      window.LayerPitchNotify.error(tr('copyFailedAlert'));
    }
    return;
  }
  const embedBtn = e.target.closest('[data-action="embed-collection"]');
  if (embedBtn) {
    const ci = parseInt(embedBtn.dataset.ci, 10);
    const embedUrl = computeCollectionUrl(collections[ci].id);
    if (!embedUrl) { window.LayerPitchNotify.info(tr('adreelUrlPending')); return; }
    openEmbedModal(`${embedUrl}&embed=1`, collections[ci].title, 'embedModalHintCollection');
    return;
  }
  const previewBtn = e.target.closest('[data-action="preview-collection"]');
  if (previewBtn) {
    const ci = parseInt(previewBtn.dataset.ci, 10);
    openPreview(`./collection.html?preview=1&id=${encodeURIComponent(collections[ci].id)}&lang=${currentLang()}`);
    return;
  }
  const shareBtn = e.target.closest('[data-action="share-collection-url"]');
  if (shareBtn) {
    const ci = parseInt(shareBtn.dataset.ci, 10);
    const shareUrl = computeCollectionUrl(collections[ci].id);
    if (!shareUrl) { window.LayerPitchNotify.info(tr('adreelUrlPending')); return; }
    const result = await shareViaSocialsOrFallback(shareUrl, collections[ci].title || 'LayerPitch');
    if (result === 'copied') {
      const original = shareBtn.textContent;
      shareBtn.textContent = tr('copiedStatus');
      setTimeout(() => { shareBtn.textContent = original; }, 1500);
    } else if (result === 'unavailable') {
      window.LayerPitchNotify.error(tr('copyFailedAlert'));
    }
    return;
  }
  const publishBtn = e.target.closest('[data-action="publish-collection-social"]');
  if (publishBtn) {
    const ci = parseInt(publishBtn.dataset.ci, 10);
    const social = socials.find(s => s.id === publishBtn.dataset.socialId);
    if (!social) return;
    const publicUrl = computeCollectionUrl(collections[ci].id);
    if (!publicUrl) { window.LayerPitchNotify.info(tr('adreelUrlPending')); return; }
    const url = buildSocialShareUrl(social.platform, publicUrl, tr('publishCollectionText', { title: collections[ci].title || '' }));
    if (url) { openSharePopup(url); trackBackstageEvent('social_publish_click', {}); }
    return;
  }
  const presetBtn = e.target.closest('[data-action="select-collection-preset"]');
  if (presetBtn) {
    const ci = parseInt(presetBtn.dataset.ci, 10);
    collections[ci].presetId = presetBtn.dataset.presetId;
    hasUnsavedEdits = true;
    renderCollections();
    return;
  }
  const quickFillBtn = e.target.closest('[data-action="apply-collection-preset-quickfill"]');
  if (quickFillBtn) {
    const ci = parseInt(quickFillBtn.dataset.ci, 10);
    const preset = resolveAnyThemePreset(quickFillBtn.dataset.presetId);
    collections[ci].bgColor = preset.bgColor;
    collections[ci].textColor = preset.contentColor;
    collections[ci].font = preset.font;
    collections[ci].separator = Object.assign({}, preset.separator);
    hasUnsavedEdits = true;
    renderCollections();
    return;
  }
  const btn = e.target.closest('[data-action="remove-collection"]');
  if (!btn) return;
  const ci = parseInt(btn.dataset.ci, 10);
  collections.splice(ci, 1);
  hasUnsavedEdits = true;
  trackBackstageEvent('collection_delete', {});
  renderCollections();
});
document.getElementById('collectionsContainer').addEventListener('input', e => {
  const field = e.target.dataset.collectionField;
  if (!field) return;
  const ci = parseInt(e.target.dataset.ci, 10);
  hasUnsavedEdits = true;
  if (field === 'buyable') { collections[ci].buyable = e.target.checked; renderCollections(); return; }
  if (field === 'separatorVisible' || field === 'separatorColor' || field === 'separatorThickness') {
    if (!collections[ci].separator) collections[ci].separator = Object.assign({}, DEFAULT_SEPARATOR);
    if (field === 'separatorVisible') collections[ci].separator.visible = e.target.checked;
    else if (field === 'separatorColor') collections[ci].separator.color = e.target.value;
    else collections[ci].separator.thickness = Math.max(1, parseInt(e.target.value, 10) || 1);
    return;
  }
  collections[ci][field] = e.target.value;
  if (field === 'title') {
    // Même principe que pour les Packs (20/08) : synchronisation directe sans re-rendu pour préserver le
    // focus/curseur en cours de frappe.
    const card = e.target.closest('.list-block');
    card.querySelectorAll('[data-collection-field="title"]').forEach(inp => { if (inp !== e.target) inp.value = e.target.value; });
  }
});

