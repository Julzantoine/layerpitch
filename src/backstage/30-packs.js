/* ---------------- Packs ---------------- */
function renderPacks() {
  const container = document.getElementById('packsContainer');
  container.innerHTML = '';
  packTracksRefreshers = [];
  packSfxRefreshers = [];
  packs.forEach((pack, pi) => {
    if (!pack.trackIds) pack.trackIds = [];
    if (!pack.sfxIds) pack.sfxIds = [];
    const el = document.createElement('div');
    el.className = 'list-block';
    const packCollapsed = collapsedPackIds.has(pack.id);
    // Genre du pack : jamais stocké, toujours recalculé depuis son contenu réel — musique seule, Sfx
    // seul, ou hybride si les deux sont présents. Aucun badge si le pack est encore vide des deux.
    const hasMusic = pack.trackIds.length > 0, hasSfx = pack.sfxIds.length > 0;
    const packKindBadge = (hasMusic && hasSfx) ? `<span class="badge">${tr('packKindHybrid')}</span>`
      : hasSfx ? `<span class="badge">${tr('packKindSfx')}</span>`
      : hasMusic ? `<span class="badge">${tr('packKindMusic')}</span>` : '';
    if (!packSelectedEntry.has(pack.id)) packSelectedEntry.set(pack.id, 'content');
    const entrySel = packSelectedEntry.get(pack.id);
    el.innerHTML = `
      <div class="list-block-head">
        <div class="list-block-head-left">
          <button class="btn btn-icon btn-toggle-collapse" data-action="toggle-collapse-pack" data-pi="${pi}" type="button">${packCollapsed ? '▸' : '▾'}</button>
          <input type="text" class="seq-header-title" data-pack-field="title" data-pi="${pi}" value="${escapeAttr(pack.title)}" placeholder="${tr('packFallback', { n: pi + 1 })}">
          ${packKindBadge}
        </div>
        <button class="btn btn-small btn-danger" data-action="remove-pack" data-pi="${pi}">${tr('deleteBtn')}</button>
      </div>
      <div class="list-block-body${packCollapsed ? ' collapsed' : ''}" data-role="packBody">
      <div class="seq-two-col">
        <div class="seq-master-list" data-role="packMaster"></div>
        <div class="seq-detail-col" data-role="packDetail"></div>
      </div>
      ${collapseFooterHtml('toggle-collapse-pack', { pi })}
      </div>
    `;
    const packMasterHost = el.querySelector('[data-role="packMaster"]');
    const packDetailHost = el.querySelector('[data-role="packDetail"]');
    function packMasterItem(key, labelHtml) {
      return simpleMasterItemEl('select-pack-entry', 'pi', pi, key, entrySel === key, labelHtml);
    }
    packMasterHost.appendChild(packMasterItem('presentation', `<div class="seq-master-item-label">${tr('sectionPresentation')}</div>`));
    packMasterHost.appendChild(packMasterItem('content', `<div class="seq-master-item-label">${tr('trackSectionContent')}</div>`));
    packMasterHost.appendChild(packMasterItem('appearance', `<div class="seq-master-item-label">${tr('sectionAppearance')}</div>`));
    packMasterHost.appendChild(packMasterItem('distribution', `<div class="seq-master-item-label">${tr('sectionDistribution')}</div>`));

    const detailEl = document.createElement('div');
    if (entrySel === 'presentation') {
      // Fusion Identité + Présentation (20/08, retour visuel) : le titre (déjà éditable en en-tête) et le
      // texte de présentation FR/EN vivent maintenant sous un seul et même libellé -- l'illustration et le
      // filigrane, qui relèvent de l'apparence visuelle plutôt que du texte, sont partis dans l'entrée
      // Apparence juste à côté.
      detailEl.innerHTML = `
        <label>${tr('titleLabel')}</label>
        <input type="text" data-pack-field="title" data-pi="${pi}" value="${escapeAttr(pack.title)}">
        <label data-help="packPresentation" style="margin-top:10px">${tr('presentationLabelFr')}</label>
        <textarea class="linkable" data-pack-field="presentationFr" data-pi="${pi}" rows="4">${escapeHtml(pack.presentationFr || '')}</textarea>
        <label data-help="packPresentationEn">${tr('presentationLabelEn')}</label>
        <textarea class="linkable" data-pack-field="presentationEn" data-pi="${pi}" rows="4">${escapeHtml(pack.presentationEn || '')}</textarea>
        <div class="hint-inline">${tr('linkHint')}</div>
        <div class="hint-inline">${tr('presentationBilingualHint')}</div>
      `;
    } else if (entrySel === 'distribution') {
      detailEl.innerHTML = `
        <label style="display:flex;align-items:center;gap:8px;margin-top:0;">
          <input type="checkbox" data-pack-field="freeDownloadEnabled" data-pi="${pi}" ${pack.freeDownloadEnabled ? 'checked' : ''} style="width:auto;margin:0;">
          <span data-help="packFreeDownload" style="color:var(--text-dim);font-size:12px;">${tr('freeDownloadLabel')}</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;">
          <input type="checkbox" data-pack-field="buyable" data-pi="${pi}" ${pack.buyable ? 'checked' : ''} ${can('sell_packs') ? '' : 'disabled'} style="width:auto;margin:0;">
          <span data-help="packBuyable" style="color:var(--text-dim);font-size:12px;">${tr('buyableLabel')}</span>
        </label>
        ${!can('sell_packs') ? `<div class="hint-inline">${tr('buyableAdminOnlyHint')}</div>` : ''}
        <label style="display:flex;align-items:center;gap:8px;margin-top:8px;">
          <input type="checkbox" data-pack-field="catalogListed" data-pi="${pi}" ${pack.catalogListed !== false ? 'checked' : ''} style="width:auto;margin:0;">
          <span data-help="packCatalogListed" style="color:var(--text-dim);font-size:12px;">${tr('packCatalogListedLabel')}</span>
        </label>
        <label data-help="packPrice" style="margin-top:12px">${tr('packPriceLabel')}</label>
        <select data-pack-field="priceEurCents" data-pi="${pi}">
          ${packPriceOptions(pack.priceEurCents)}
        </select>
        <div class="hint-inline">${tr('packPriceHint')}</div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:12px;">
          <input type="checkbox" data-pack-field="subscriberCatalog" data-pi="${pi}" ${pack.subscriberCredits ? 'checked' : ''} ${can('subscriber_catalog') && pack.priceEurCents ? '' : 'disabled'} style="width:auto;margin:0;">
          <span data-help="packSubscriberCatalog" style="color:var(--text-dim);font-size:12px;">${tr('packCatalogLabel')}</span>
        </label>
        ${pack.subscriberCredits ? `
          <select data-pack-field="subscriberCredits" data-pi="${pi}" ${can('subscriber_catalog') ? '' : 'disabled'}>
            ${[1, 2, 4].map(n => `<option value="${n}"${pack.subscriberCredits === n ? ' selected' : ''}>${tr(n === 1 ? 'packCatalogCreditsOne' : 'packCatalogCreditsMany', { n, eur: n * 10 })}</option>`).join('')}
          </select>` : ''}
        <div class="hint-inline">${!can('subscriber_catalog') ? tr('packCatalogLockedHint') : (!pack.priceEurCents ? tr('packCatalogFreeHint') : tr('packCatalogHint'))}</div>
        ${pack.buyable ? `
          <label>${tr('buyUrlLabel')}</label>
          <input type="text" data-pack-field="buyUrl" data-pi="${pi}" value="${escapeAttr(pack.buyUrl)}" placeholder="https://...">
          <div class="hint-inline">${tr('buyUrlNotLiveHint')}</div>
        ` : ''}
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;">
          <input type="checkbox" data-pack-field="videoTestModeEnabled" data-pi="${pi}" ${pack.videoTestModeEnabled ? 'checked' : ''} style="width:auto;margin:0;">
          <span data-help="packVideoTestMode" style="color:var(--text-dim);font-size:12px;">${tr('videoTestModeLabel')}</span>
        </label>
        <div class="hint-inline">${tr('videoTestModeHint')}</div>
        <label data-help="packLinkedAdReel" style="margin-top:14px">${tr('packLinkedAdReelLabel')}</label>
        <select data-pack-field="linkedAdReelId" data-pi="${pi}">
          <option value="">${tr('packLinkedAdReelNone')}</option>
          ${adReels.map(a => `<option value="${a.id}"${pack.linkedAdReelId === a.id ? ' selected' : ''}>${escapeAttr(a.label || a.id)}</option>`).join('')}
        </select>
        <div class="hint-inline">${tr('packLinkedAdReelHint')}</div>
        <label style="margin-top:14px">${tr('packDirectLinkLabel')}</label>
        <div id="packUrlBox_${pack.id}" class="hint-inline"></div>
        <div style="display:flex; gap:6px; margin-top:4px; flex-wrap:wrap;">
          <button class="btn btn-small" data-action="preview-pack" data-pi="${pi}" type="button" title="${escapeAttr(tr('previewHint'))}" style="flex:1">${tr('previewBtn')}</button>
          <button class="btn btn-small" data-action="copy-pack-url" data-pi="${pi}" type="button" style="flex:1">${tr('copyLink')}</button>
          <button class="btn btn-small" data-action="share-pack-url" data-pi="${pi}" type="button" style="flex:1">${tr('shareBtn')}</button>
          <button class="btn btn-small" data-action="embed-pack" data-pi="${pi}" type="button" style="flex:1">${tr('embedBtn')}</button>
        </div>
        <label data-help="publishToSocial" style="margin-top:14px">${tr('publishToSocialLabel')}</label>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">${publishButtonsHtml('publish-pack-social', 'pi', pi)}</div>
        <div class="actions" style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
          <button class="btn btn-small" data-action="view-implementation-sheet" data-pi="${pi}" type="button" data-help="implementationSheetBtn">${tr('viewImplementationSheetBtn')}</button>
        </div>
      `;
    } else if (entrySel === 'appearance') {
      // Regroupe désormais couleurs, police ET les deux images (illustration, filigrane) -- tout ce qui
      // relève du rendu visuel du pack, plutôt que de son texte (20/08).
      // Palier Free (Chantier Apparence Phase 3) : galerie de presets à la place des réglages fins,
      // même bascule que le panneau Apparence de l'AdReel.
      const packIsFree = currentEffectivePlan === 'free';
      const packIsPro = currentEffectivePlan === 'pro';
      const packSep = Object.assign({}, DEFAULT_SEPARATOR, pack.separator || {});
      // Palier Pro (10 septembre) : départ rapide par preset au-dessus des réglages fins -- copie les
      // valeurs concrètes dans bgColor/textColor/font/separator, aucun presetId conservé (voir
      // applyThemePresetQuickFill côté AdReel, même principe).
      const packProQuickStartHtml = packIsPro ? `
        <div class="hint-inline">${tr('themePresetProHint')}</div>
        <div class="theme-preset-gallery">
          ${THEME_PRESETS.concat(THEME_PRESETS_PRO).map(p => `
            <button type="button" class="theme-preset-card" data-action="apply-pack-preset-quickfill" data-pi="${pi}" data-preset-id="${p.id}"
              style="background:${p.bgColor};color:${p.titleColor}">${tr(p.labelKey)}</button>
          `).join('')}
        </div>
      ` : '';
      detailEl.innerHTML = packIsFree ? `
        <label data-help="packAppearance">${tr('packAppearanceLabel')}</label>
        <div class="hint-inline">${tr('themePresetFreeHint')}</div>
        <div class="theme-preset-gallery">
          ${THEME_PRESETS.map(p => `
            <button type="button" class="theme-preset-card${(pack.presetId || 'default') === p.id ? ' active' : ''}"
              data-action="select-pack-preset" data-pi="${pi}" data-preset-id="${p.id}"
              style="background:${p.bgColor};color:${p.titleColor}">${tr(p.labelKey)}</button>
          `).join('')}
        </div>
        <label data-help="packIllustration" style="margin-top:14px">${tr('illustrationLabel')}</label>
        <div data-role="illustrationCtrl"></div>
        <label data-help="packWatermark" style="margin-top:10px">${tr('watermarkLabel')}</label>
        <div data-role="watermarkCtrl"></div>
        <div class="hint-inline">${tr('watermarkHint')}</div>
      ` : `
        <label data-help="packAppearance">${tr('packAppearanceLabel')}</label>
        ${packProQuickStartHtml}
        <div class="row">
          <div>
            <label>${tr('bgColorLabel')}</label>
            <input type="color" data-pack-field="bgColor" data-pi="${pi}" value="${pack.bgColor || '#f5f6f8'}">
          </div>
          <div>
            <label>${tr('textColorLabel')}</label>
            <input type="color" data-pack-field="textColor" data-pi="${pi}" value="${pack.textColor || '#24262b'}">
          </div>
        </div>
        <label data-help="packFont" style="margin-top:14px">${tr('themeFontLabel')}</label>
        <select data-pack-field="font" data-pi="${pi}">${buildFontSelectOptionsHtml(pack.font)}</select>
        <label data-i18n="separatorsLegend" style="margin-top:14px;display:block">${tr('separatorsLegend')}</label>
        <label style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <input type="checkbox" data-pack-field="separatorVisible" data-pi="${pi}" ${packSep.visible ? 'checked' : ''} style="width:auto;margin:0;">
          <span data-i18n="separatorVisibleLabel">${tr('separatorVisibleLabel')}</span>
        </label>
        <div class="row" style="margin-top:10px">
          <div>
            <label data-i18n="separatorColorLabel">${tr('separatorColorLabel')}</label>
            <input type="color" data-pack-field="separatorColor" data-pi="${pi}" value="${packSep.color}">
          </div>
          <div>
            <label data-i18n="separatorThicknessLabel">${tr('separatorThicknessLabel')}</label>
            <input type="number" data-pack-field="separatorThickness" data-pi="${pi}" min="1" max="10" step="1" value="${packSep.thickness}">
          </div>
        </div>
        <label data-help="packIllustration" style="margin-top:14px">${tr('illustrationLabel')}</label>
        <div data-role="illustrationCtrl"></div>
        <label data-help="packWatermark" style="margin-top:10px">${tr('watermarkLabel')}</label>
        <div data-role="watermarkCtrl"></div>
        <div class="hint-inline">${tr('watermarkHint')}</div>
      `;
    } else if (entrySel === 'content') {
      detailEl.innerHTML = `
        <label data-help="packTracks">${tr('packTracksLabel')}</label>
        <div data-role="trackSelector"></div>
        <label data-help="packSfx" style="margin-top:14px">${tr('packSfxLabel')}</label>
        <div data-role="packSfxSelector"></div>
      `;
    }
    packDetailHost.appendChild(detailEl);

    if (entrySel === 'appearance') {
      const ctrlHost = detailEl.querySelector('[data-role="illustrationCtrl"]');
      ctrlHost.innerHTML = fileCtrlHtml(tr('chooseIllustration'));
      wireFileControl(ctrlHost, 'image/*',
        () => pack.pendingIllustration, () => pack.illustration,
        f => { pack.pendingIllustration = f; hasUnsavedEdits = true; }, () => pack.illustrationOriginalName);
      const watermarkCtrlHost = detailEl.querySelector('[data-role="watermarkCtrl"]');
      watermarkCtrlHost.innerHTML = fileCtrlHtml(tr('chooseImage'));
      wireFileControl(watermarkCtrlHost, 'image/*',
        () => pack.pendingWatermark, () => pack.watermark,
        f => { pack.pendingWatermark = f; hasUnsavedEdits = true; }, () => pack.watermarkOriginalName);
    }
    if (entrySel === 'distribution') {
      const packUrlBox = detailEl.querySelector(`#packUrlBox_${pack.id}`);
      const packUrl = computePackUrl(pack.id);
      packUrlBox.innerHTML = packUrl ? `<a href="${escapeAttr(packUrl)}" target="_blank" rel="noopener">${escapeHtml(packUrl)}</a>` : escapeHtml(tr('adreelUrlPending'));
    }
    if (entrySel === 'content') {
      const selectorHost = detailEl.querySelector('[data-role="trackSelector"]');
      const refresh = buildTrackSelectorWidget(selectorHost, pack.trackIds, () => { hasUnsavedEdits = true; renderPacks(); });
      packTracksRefreshers.push(refresh);
      const sfxSelectorHost = detailEl.querySelector('[data-role="packSfxSelector"]');
      const sfxRefresh = buildSfxSelectorWidget(sfxSelectorHost, pack.sfxIds, () => { hasUnsavedEdits = true; renderPacks(); });
      packSfxRefreshers.push(sfxRefresh);
    }
    container.appendChild(el);
  });
}
// Grille de prix d'un pack (D31, même règle que is_valid_pack_price en base) : 0 € ; 1-100 € par 1 € ; 110-200 € par 10 € ;
// 250-500 € par 50 €. Un prix hérité hors grille (ne devrait plus exister après la migration du 28/09) reste affiché.
function packPriceGrid() {
  const g = [0];
  for (let e = 1; e <= 100; e++) g.push(e * 100);
  for (let e = 110; e <= 200; e += 10) g.push(e * 100);
  for (let e = 250; e <= 500; e += 50) g.push(e * 100);
  return g;
}
function packPriceOptions(current) {
  const grid = packPriceGrid();
  const values = current != null && !grid.includes(current) ? [current].concat(grid) : grid;
  const fmt = new Intl.NumberFormat(currentLang() === 'en' ? 'en-GB' : 'fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  return `<option value=""${current == null ? ' selected' : ''}>${tr('packPriceNone')}</option>` +
    values.map(c => `<option value="${c}"${c === current ? ' selected' : ''}>${c === 0 ? tr('packPriceFree') : fmt.format(c / 100)}</option>`).join('');
}
document.getElementById('btnAddPack').addEventListener('click', () => {
  packs.push({ id: genId(), title: tr('defaultPackTitle'), illustration: null, pendingIllustration: null, watermark: null, pendingWatermark: null, presentationFr: '', presentationEn: '', buyable: false, buyUrl: '', priceEurCents: 1000, subscriberCredits: can('subscriber_catalog') ? 1 : null, catalogListed: true, freeDownloadEnabled: false, videoTestModeEnabled: false, bgColor: '#f5f6f8', textColor: '#24262b', font: 'default', trackIds: [], sfxIds: [], linkedAdReelId: '' });
  hasUnsavedEdits = true;
  trackBackstageEvent('pack_add', {});
  renderPacks();
});
document.getElementById('packsContainer').addEventListener('click', async e => {
  const entryBtn = e.target.closest('[data-action="select-pack-entry"]');
  if (entryBtn) {
    const pi = parseInt(entryBtn.dataset.pi, 10);
    packSelectedEntry.set(packs[pi].id, entryBtn.dataset.entry);
    renderPacks();
    return;
  }
  const toggleBtn = e.target.closest('[data-action="toggle-collapse-pack"]');
  if (toggleBtn) {
    const rowEl = toggleBtn.closest('.list-block');
    const body = rowEl.querySelector('[data-role="packBody"]');
    const collapsed = body.classList.toggle('collapsed');
    const topToggle = rowEl.querySelector('.list-block-head [data-action="toggle-collapse-pack"]');
    if (topToggle) topToggle.textContent = collapsed ? '▸' : '▾';
    const pi = parseInt(toggleBtn.dataset.pi, 10);
    const packId = packs[pi].id;
    if (collapsed) collapsedPackIds.add(packId); else collapsedPackIds.delete(packId);
    return;
  }
  const sheetBtn = e.target.closest('[data-action="view-implementation-sheet"]');
  if (sheetBtn) {
    const pi = parseInt(sheetBtn.dataset.pi, 10);
    openImplementationSheetModal(packs[pi]);
    return;
  }
  const copyBtn = e.target.closest('[data-action="copy-pack-url"]');
  if (copyBtn) {
    const pi = parseInt(copyBtn.dataset.pi, 10);
    const url = computePackUrl(packs[pi].id);
    if (!url) { window.LayerPitchNotify.info(tr('adreelUrlPending')); return; }
    const done = () => { const original = copyBtn.textContent; copyBtn.textContent = tr('copiedStatus'); setTimeout(() => { copyBtn.textContent = original; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => { window.LayerPitchNotify.error(tr('copyFailedAlert')); });
    } else {
      window.LayerPitchNotify.error(tr('copyFailedAlert'));
    }
    return;
  }
  const embedBtn = e.target.closest('[data-action="embed-pack"]');
  if (embedBtn) {
    const pi = parseInt(embedBtn.dataset.pi, 10);
    const embedUrl = computePackUrl(packs[pi].id);
    if (!embedUrl) { window.LayerPitchNotify.info(tr('adreelUrlPending')); return; }
    openEmbedModal(`${embedUrl}&embed=1`, packs[pi].title, 'embedModalHintPack');
    return;
  }
  const previewBtn = e.target.closest('[data-action="preview-pack"]');
  if (previewBtn) {
    const pi = parseInt(previewBtn.dataset.pi, 10);
    openPreview(`./pack.html?preview=1&id=${encodeURIComponent(packs[pi].id)}&lang=${currentLang()}`);
    return;
  }
  const shareBtn = e.target.closest('[data-action="share-pack-url"]');
  if (shareBtn) {
    const pi = parseInt(shareBtn.dataset.pi, 10);
    const shareUrl = computePackUrl(packs[pi].id);
    if (!shareUrl) { window.LayerPitchNotify.info(tr('adreelUrlPending')); return; }
    const result = await shareViaSocialsOrFallback(shareUrl, packs[pi].title || 'LayerPitch');
    if (result === 'copied') {
      const original = shareBtn.textContent;
      shareBtn.textContent = tr('copiedStatus');
      setTimeout(() => { shareBtn.textContent = original; }, 1500);
    } else if (result === 'unavailable') {
      window.LayerPitchNotify.error(tr('copyFailedAlert'));
    }
    return;
  }
  const publishBtn = e.target.closest('[data-action="publish-pack-social"]');
  if (publishBtn) {
    const pi = parseInt(publishBtn.dataset.pi, 10);
    const social = socials.find(s => s.id === publishBtn.dataset.socialId);
    if (!social) return;
    const publicUrl = computePackUrl(packs[pi].id);
    if (!publicUrl) { window.LayerPitchNotify.info(tr('adreelUrlPending')); return; }
    const url = buildSocialShareUrl(social.platform, publicUrl, tr('publishPackText', { title: packs[pi].title || '' }));
    if (url) { openSharePopup(url); trackBackstageEvent('social_publish_click', {}); }
    return;
  }
  const presetBtn = e.target.closest('[data-action="select-pack-preset"]');
  if (presetBtn) {
    const pi = parseInt(presetBtn.dataset.pi, 10);
    packs[pi].presetId = presetBtn.dataset.presetId;
    hasUnsavedEdits = true;
    renderPacks();
    return;
  }
  const quickFillBtn = e.target.closest('[data-action="apply-pack-preset-quickfill"]');
  if (quickFillBtn) {
    const pi = parseInt(quickFillBtn.dataset.pi, 10);
    const preset = resolveAnyThemePreset(quickFillBtn.dataset.presetId);
    packs[pi].bgColor = preset.bgColor;
    packs[pi].textColor = preset.contentColor;
    packs[pi].font = preset.font;
    packs[pi].separator = Object.assign({}, preset.separator);
    hasUnsavedEdits = true;
    renderPacks();
    return;
  }
  const btn = e.target.closest('[data-action="remove-pack"]');
  if (!btn) return;
  const pi = parseInt(btn.dataset.pi, 10);
  const removedId = packs[pi].id;
  packs.splice(pi, 1);
  // Même nettoyage que pour un Sfx retiré : sans ça, une collection ou un bloc "packs" garderait l'id d'un pack
  // désormais supprimé en base, et upsert_collection échouerait à la publication suivante.
  collections.forEach(c => { if (c.packIds) c.packIds = c.packIds.filter(id => id !== removedId); });
  adReels.forEach(ar => ar.blocks.forEach(b => { if (b.type === 'packs' && b.packIds) b.packIds = b.packIds.filter(id => id !== removedId); }));
  hasUnsavedEdits = true;
  trackBackstageEvent('pack_delete', {});
  renderPacks();
  renderCollections();
  rebuildAllCards();
});
document.getElementById('packsContainer').addEventListener('input', e => {
  const field = e.target.dataset.packField;
  if (!field) return;
  const pi = parseInt(e.target.dataset.pi, 10);
  hasUnsavedEdits = true;
  if (field === 'buyable') { packs[pi].buyable = e.target.checked; renderPacks(); return; }
  if (field === 'priceEurCents') {
    packs[pi].priceEurCents = e.target.value === '' ? null : parseInt(e.target.value, 10);
    if (!packs[pi].priceEurCents) packs[pi].subscriberCredits = null; // un pack gratuit n'entre pas dans le catalogue abonnés
    renderPacks(); return;
  }
  if (field === 'subscriberCatalog') { packs[pi].subscriberCredits = e.target.checked ? (packs[pi].subscriberCredits || 1) : null; renderPacks(); return; }
  if (field === 'catalogListed') { packs[pi].catalogListed = e.target.checked; return; }
  if (field === 'subscriberCredits') { packs[pi].subscriberCredits = parseInt(e.target.value, 10); return; }
  if (field === 'videoTestModeEnabled') { packs[pi].videoTestModeEnabled = e.target.checked; return; }
  if (field === 'separatorVisible' || field === 'separatorColor' || field === 'separatorThickness') {
    if (!packs[pi].separator) packs[pi].separator = Object.assign({}, DEFAULT_SEPARATOR);
    if (field === 'separatorVisible') packs[pi].separator.visible = e.target.checked;
    else if (field === 'separatorColor') packs[pi].separator.color = e.target.value;
    else packs[pi].separator.thickness = Math.max(1, parseInt(e.target.value, 10) || 1);
    return;
  }
  packs[pi][field] = e.target.value;
  if (field === 'title') {
    // Le titre est éditable à deux endroits (en-tête de carte + entrée Présentation), synchronisés en
    // direct sans re-rendu complet -- un renderPacks() ici perdrait le focus/curseur en cours de frappe.
    const card = e.target.closest('.list-block');
    card.querySelectorAll('[data-pack-field="title"]').forEach(inp => { if (inp !== e.target) inp.value = e.target.value; });
  }
});

