/* ---------------- Construction des cartes ---------------- */
function makeCardShell(block) {
  const card = document.createElement('div');
  card.className = 'block-editor-card';
  card.dataset.id = block.id;
  const canDelete = true; // tous les blocs sont supprimables (20/08, retour visuel) -- y compris les 4
  // "singletons" (Header, Bio, Témoignages, Musique) qui ne l'étaient pas jusque-là. Voir migrateBlocks()
  // : la réinjection forcée au chargement a été retirée en même temps, sinon un bloc supprimé
  // réapparaîtrait vide au rechargement suivant.
  const blockCollapsed = collapsedBlockIds.has(block.id);
  const head = document.createElement('div');
  head.className = 'block-editor-head';
  head.innerHTML = `
    <div class="block-editor-head-left">
      <span class="block-drag-handle" aria-hidden="true" title="${tr('dragHandleTitle')}">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
      </span>
      <button class="btn btn-icon btn-toggle-collapse" data-action="toggle-collapse" type="button">${blockCollapsed ? '▸' : '▾'}</button>
      <span class="pos"></span>
      <strong>${BLOCK_LABELS[block.type] || block.type}</strong>
      <span class="block-summary"></span>
    </div>
    <div class="block-order-btns">
      ${canDelete ? `<button class="btn btn-icon btn-danger" data-action="remove-block">×</button>` : ''}
    </div>
  `;
  const body = document.createElement('div');
  body.className = 'block-editor-body' + (blockCollapsed ? ' collapsed' : '');
  card.appendChild(head);
  card.appendChild(body);
  return { card, body };
}

function buildHeaderCard(block) {
  const { card, body } = makeCardShell(block);
  body.innerHTML = `
    ${sectionEyebrow(tr('trackSectionIdentity'))}
    <label data-help="headerTitle">${tr('headerTitleLabel')}</label>
    <input type="text" data-role="title" placeholder="${tr('headerTitlePlaceholder')}">
    <label data-help="headerSubtitle">${tr('headerSubtitleLabel')}</label>
    <input type="text" data-role="subtitle" placeholder="${tr('headerSubtitlePlaceholder')}">
    <label data-help="headerLogo">${tr('logoLabel')}</label>
    <div data-role="logoCtrl">${fileCtrlHtml(tr('chooseLogo'))}</div>
    <div class="hint-inline">${tr('headerLogoHint')}</div>
    ${sectionEyebrow(tr('sectionContact'))}
    <label data-help="headerContactEmail">${tr('contactEmailLabel')}</label>
    <input type="text" data-role="email" placeholder="${tr('contactEmailPlaceholder')}">
    <div class="hint-inline">${tr('formspreeHint')}</div>
    <label data-help="headerWebsite">${tr('websiteLabel')}</label>
    <input type="text" data-role="url" placeholder="${tr('headerUrlPlaceholder')}">
  `;
  const titleEl = body.querySelector('[data-role="title"]');
  const subtitleEl = body.querySelector('[data-role="subtitle"]');
  const emailEl = body.querySelector('[data-role="email"]');
  const urlEl = body.querySelector('[data-role="url"]');
  // Rétrocompatibilité : un AdReel publié avant ce changement n'a qu'un profile.tagline (jamais de
  // subtitle) — repris ici comme valeur de départ du sous-titre, une seule fois, à l'ouverture. Une fois
  // subtitle édité ou republié, c'est lui qui fait foi ; tagline n'est plus jamais réécrit.
  titleEl.value = profile.title || '';
  subtitleEl.value = (profile.subtitle != null) ? profile.subtitle : (profile.tagline || '');
  emailEl.value = profile.contactEmail || '';
  urlEl.value = profile.contactUrl || '';
  titleEl.addEventListener('input', e => { profile.title = e.target.value; hasUnsavedEdits = true; refreshAllBlockSummaries(); });
  subtitleEl.addEventListener('input', e => { profile.subtitle = e.target.value; hasUnsavedEdits = true; refreshAllBlockSummaries(); });
  emailEl.addEventListener('input', e => { profile.contactEmail = e.target.value; hasUnsavedEdits = true; refreshAllBlockSummaries(); });
  urlEl.addEventListener('input', e => { profile.contactUrl = e.target.value; hasUnsavedEdits = true; });
  wireFileControl(body.querySelector('[data-role="logoCtrl"]'), 'image/*',
    () => logoPendingFile, () => profile.logo,
    f => { logoPendingFile = f; hasUnsavedEdits = true; }, () => profile.logoOriginalName);
  return card;
}

function buildBioCard(block) {
  const { card, body } = makeCardShell(block);
  body.innerHTML = `
    <label data-help="bioPhoto">${tr('bioPhotoLabel')}</label>
    <div data-role="photoCtrl">${fileCtrlHtml(tr('choosePhoto'))}</div>
    <label data-help="bioText">${tr('bioTextLabel')}</label>
    <textarea class="linkable" data-role="bioText" rows="6"></textarea>
    <div class="hint-inline">${tr('linkHintBoth')}</div>
  `;
  const bioTextEl = body.querySelector('[data-role="bioText"]');
  bioTextEl.value = profile.bio || '';
  bioTextEl.addEventListener('input', e => { profile.bio = e.target.value; hasUnsavedEdits = true; refreshAllBlockSummaries(); });
  wireFileControl(body.querySelector('[data-role="photoCtrl"]'), 'image/*',
    () => photoPendingFile, () => profile.photo,
    f => { photoPendingFile = f; hasUnsavedEdits = true; }, () => profile.photoOriginalName);
  return card;
}

function buildTestimonialsCard(block) {
  const { card, body } = makeCardShell(block);
  body.innerHTML = `<div data-role="list"></div><div class="actions"><button class="btn btn-small" data-role="addBtn">${tr('addTestimonialBtn')}</button></div>`;
  const listEl = body.querySelector('[data-role="list"]');
  function renderList() {
    listEl.innerHTML = '';
    testimonials.forEach((tm, i) => {
      const el = document.createElement('div');
      el.className = 'list-block';
      el.innerHTML = `
        <div class="list-block-head"><strong>${tr('testimonialFallback', { n: i + 1 })}</strong><button class="btn btn-small btn-danger" data-action="remove" data-i="${i}">${tr('deleteBtn')}</button></div>
        <label>${tr('textFieldLabel')}</label><textarea class="linkable" data-field="text" data-i="${i}">${escapeHtml(tm.text)}</textarea>
        <div class="hint-inline">${tr('linkHint')}</div>
        <label>${tr('authorLabel')}</label><input type="text" data-field="author" data-i="${i}" value="${escapeAttr(tm.author)}">
        <label>${tr('testimonialRoleLabel')}</label><input type="text" data-field="role" data-i="${i}" value="${escapeAttr(tm.role || '')}">
        <label>${tr('testimonialAvatarLabel')}</label>
        <div data-role="avatarCtrl" data-i="${i}"></div>
      `;
      const avatarHost = el.querySelector('[data-role="avatarCtrl"]');
      avatarHost.innerHTML = fileCtrlHtml(tr('chooseImage'));
      wireFileControl(avatarHost, 'image/*',
        () => tm.avatarPendingFile, () => tm.avatar,
        f => { tm.avatarPendingFile = f; hasUnsavedEdits = true; }, () => tm.avatarOriginalName);
      listEl.appendChild(el);
    });
  }
  body.querySelector('[data-role="addBtn"]').addEventListener('click', () => { testimonials.push({ text: '', author: '', role: '', avatar: null, avatarPendingFile: null }); hasUnsavedEdits = true; renderList(); refreshAllBlockSummaries(); });
  listEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="remove"]');
    if (!btn) return;
    testimonials.splice(parseInt(btn.dataset.i, 10), 1);
    hasUnsavedEdits = true;
    renderList();
    refreshAllBlockSummaries();
  });
  listEl.addEventListener('input', e => {
    const field = e.target.dataset.field;
    if (!field) return;
    hasUnsavedEdits = true;
    testimonials[parseInt(e.target.dataset.i, 10)][field] = e.target.value;
  });
  renderList();
  return card;
}

function buildTracksCard(block) {
  const { card, body } = makeCardShell(block);
  body.innerHTML = `<div class="hint" data-help="tracksBlockSelector" style="margin-bottom:10px">${tr('tracksBlockHint')}</div><div data-role="selector"></div>`;
  const host = body.querySelector('[data-role="selector"]');
  const refresh = buildTrackSelectorWidget(host, trackIds, () => { hasUnsavedEdits = true; refreshAllBlockSummaries(); }, trackOverrides);
  blockTracksRefresh = refresh;
  return card;
}

function buildTextCard(block) {
  const { card, body } = makeCardShell(block);
  body.innerHTML = `
    <label>${tr('textBlockTitleLabel')}</label>
    <input type="text" data-role="title" value="${escapeAttr(block.title || '')}">
    <label>${tr('bioTextLabel')}</label>
    <textarea class="linkable" data-role="content" rows="4">${escapeHtml(block.content || '')}</textarea>
    <div class="hint-inline">${tr('linkHint')}</div>
    <label data-help="blockAlign">${tr('alignLabel')}</label>
    <select data-role="align">
      <option value="left">${tr('alignLeft')}</option>
      <option value="center">${tr('alignCenter')}</option>
      <option value="right">${tr('alignRight')}</option>
    </select>
  `;
  body.querySelector('[data-role="align"]').value = block.align || 'left';
  body.querySelector('[data-role="title"]').addEventListener('input', e => { block.title = e.target.value; hasUnsavedEdits = true; refreshAllBlockSummaries(); });
  body.querySelector('[data-role="content"]').addEventListener('input', e => { block.content = e.target.value; hasUnsavedEdits = true; refreshAllBlockSummaries(); });
  body.querySelector('[data-role="align"]').addEventListener('change', e => { block.align = e.target.value; hasUnsavedEdits = true; });
  return card;
}

function buildPhotoCard(block) {
  const { card, body } = makeCardShell(block);
  body.innerHTML = `
    <label data-help="blockAlign">${tr('alignLabel')}</label>
    <select data-role="align">
      <option value="left">${tr('alignLeft')}</option>
      <option value="center">${tr('alignCenter')}</option>
      <option value="right">${tr('alignRight')}</option>
    </select>
    <div class="hint-inline">${tr('photoAlignHint')}</div>
    <label>${tr('photoBlockCaptionLabel')}</label>
    <input type="text" data-role="caption" value="${escapeAttr(block.caption || '')}">
    <div data-role="list" style="margin-top:10px"></div>
    <div class="actions"><button class="btn btn-small" data-role="addBtn">${tr('addImageBtn')}</button></div>
  `;
  body.querySelector('[data-role="align"]').value = block.align || 'left';
  body.querySelector('[data-role="align"]').addEventListener('change', e => { block.align = e.target.value; hasUnsavedEdits = true; });
  body.querySelector('[data-role="caption"]').addEventListener('input', e => { block.caption = e.target.value; hasUnsavedEdits = true; });
  const listEl = body.querySelector('[data-role="list"]');
  function renderList() {
    listEl.innerHTML = '';
    block.images.forEach((img, i) => {
      const el = document.createElement('div');
      el.className = 'list-block';
      el.innerHTML = `<div data-role="ctrl"></div><div class="actions"><button class="btn btn-small btn-danger" data-action="remove" data-i="${i}">${tr('removeImageBtn')}</button></div>`;
      const ctrlHost = el.querySelector('[data-role="ctrl"]');
      ctrlHost.innerHTML = fileCtrlHtml(tr('chooseImage'));
      wireFileControl(ctrlHost, 'image/*',
        () => img.pendingFile, () => img.file,
        f => { img.pendingFile = f; hasUnsavedEdits = true; }, () => img.originalFileName);
      listEl.appendChild(el);
    });
  }
  body.querySelector('[data-role="addBtn"]').addEventListener('click', () => {
    block.images.push({ file: null, pendingFile: null });
    hasUnsavedEdits = true;
    renderList();
    refreshAllBlockSummaries();
  });
  listEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="remove"]');
    if (!btn) return;
    block.images.splice(parseInt(btn.dataset.i, 10), 1);
    hasUnsavedEdits = true;
    renderList();
    refreshAllBlockSummaries();
  });
  renderList();
  return card;
}

