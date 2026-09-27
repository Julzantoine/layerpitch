/* ---------------- Sélecteur de Sfx (bibliothèque Sfx -> bloc "Sfx" d'un AdReel) ---------------- */
function buildSfxSelectorWidget(hostEl, selectedIds, onChange) {
  function render() {
    hostEl.innerHTML = '';
    if (sfxLibrary.length === 0) {
      hostEl.innerHTML = `<div class="hint">${tr('noSfxCreated')}</div>`;
      return;
    }
    selectedIds.slice().forEach((id, idx) => {
      const sfx = sfxLibrary.find(s => s.id === id);
      if (!sfx) return;
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.innerHTML = `
        <span style="flex:1">${escapeAttr(sfx.title) || tr('sfxFallback', { n: idx + 1 })}</span>
        <button type="button" class="btn btn-icon" data-sel-action="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn btn-icon" data-sel-action="down" data-idx="${idx}" ${idx === selectedIds.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="btn btn-icon btn-danger" data-sel-action="remove" data-idx="${idx}">${tr('removeBtn')}</button>
      `;
      hostEl.appendChild(row);
    });
    const unselected = sfxLibrary.filter(s => !selectedIds.includes(s.id));
    const addRow = document.createElement('div');
    addRow.style.marginTop = '8px';
    if (unselected.length) {
      addRow.innerHTML = `
        <select data-sel-action="add">
          <option value="">${tr('addSfxOption')}</option>
          ${unselected.map(s => `<option value="${s.id}">${escapeAttr(s.title) || tr('untitledFallback')}</option>`).join('')}
        </select>
      `;
    } else {
      addRow.innerHTML = `<div class="hint-inline">${tr('allSfxIncluded')}</div>`;
    }
    hostEl.appendChild(addRow);

    hostEl.querySelectorAll('[data-sel-action="add"]').forEach(sel => {
      sel.addEventListener('change', () => {
        if (sel.value) { selectedIds.push(sel.value); onChange(); render(); }
      });
    });
    hostEl.querySelectorAll('button[data-sel-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.selAction;
        const idx = parseInt(btn.dataset.idx, 10);
        if (action === 'up' && idx > 0) { const tmp = selectedIds[idx - 1]; selectedIds[idx - 1] = selectedIds[idx]; selectedIds[idx] = tmp; }
        else if (action === 'down' && idx < selectedIds.length - 1) { const tmp = selectedIds[idx + 1]; selectedIds[idx + 1] = selectedIds[idx]; selectedIds[idx] = tmp; }
        else if (action === 'remove') { selectedIds.splice(idx, 1); }
        onChange();
        render();
      });
    });
  }
  render();
  return render;
}
function buildSfxBlockCard(block) {
  const { card, body } = makeCardShell(block);
  body.innerHTML = `<div class="hint" style="margin-bottom:10px">${tr('sfxBlockHint')}</div><div data-role="selector"></div>`;
  const host = body.querySelector('[data-role="selector"]');
  if (!block.sfxIds) block.sfxIds = [];
  buildSfxSelectorWidget(host, block.sfxIds, () => { hasUnsavedEdits = true; refreshAllBlockSummaries(); });
  return card;
}

function buildContactBlockCard(block) {
  const { card, body } = makeCardShell(block);
  body.innerHTML = `
    <label data-help="headerContactEmail">${tr('contactEmailLabel')}</label>
    <input type="text" data-role="email" placeholder="${tr('contactEmailPlaceholder')}">
    <div data-role="endpointHint"></div>
  `;
  const emailEl = body.querySelector('[data-role="email"]');
  const hintEl = body.querySelector('[data-role="endpointHint"]');
  function renderHint() {
    hintEl.innerHTML = hasContactFormEndpoint()
      ? `<div class="hint-inline">${tr('formspreeOkHint')}</div>`
      : `<div class="hint-inline" style="color:#b45309">${tr('noFormspreeWarning')}</div>`;
  }
  // Même propriété que le champ "Email de contact" du bloc Header (profile.contactEmail) --
  // affiché ici aussi (5 septembre, retour de Jules-Antoine : configurer le destinataire du bloc
  // Contact en éditant un tout autre bloc n'était pas intuitif) plutôt que dupliqué en deux valeurs
  // distinctes, pour rester la même adresse partout (mailto public du Header ET relais du formulaire).
  emailEl.value = profile.contactEmail || '';
  renderHint();
  emailEl.addEventListener('input', e => {
    profile.contactEmail = e.target.value;
    hasUnsavedEdits = true;
    renderHint();
    refreshAllBlockSummaries();
  });
  return card;
}

function buildVideoCard(block) {
  const { card, body } = makeCardShell(block);
  body.innerHTML = `<div data-role="list"></div><div class="actions"><button class="btn btn-small" data-role="addBtn">${tr('addVideoBtn')}</button></div>`;
  const listEl = body.querySelector('[data-role="list"]');
  // Bibliothèque vidéo (composer_videos, Postgres) chargée à part de data.json -- pas préchargée au
  // niveau de l'app comme sfxLibrary/packs/collections, donc récupérée à l'ouverture de ce bloc.
  let libraryVideos = [];
  let libraryLoaded = false;
  function renderList() {
    listEl.innerHTML = '';
    block.videos.forEach((v, i) => {
      // Le choix "Bibliothèque vidéo" n'a de sens que pour l'admin : l'onglet Vidéo du Backstage est
      // grisé pour tout autre compositeur (16 septembre, compression trop lente pour un vrai usage --
      // voir layerpitch_video_compression_single_thread_limit.md), donc aucun non-admin ne peut avoir
      // de bibliothèque à piocher dedans. Pas de bascule à montrer dans ce cas, juste le lien externe.
      const source = currentUserIsAdmin && v.source === 'library' ? 'library' : 'url';
      const el = document.createElement('div');
      el.className = 'list-block';
      el.innerHTML = `
        <div class="list-block-head"><strong>${tr('videoFallback', { n: i + 1 })}</strong><button class="btn btn-small btn-danger" data-action="remove" data-i="${i}">${tr('deleteBtn')}</button></div>
        <label data-help="videoThumbnail">${tr('thumbnailLabel')}</label>
        <div data-role="thumbCtrl"></div>
        <label style="margin-top:8px">${tr('titleLabel')}</label><input type="text" data-field="title" data-i="${i}" value="${escapeAttr(v.title)}">
        ${currentUserIsAdmin ? `
        <label>${tr('videoSourceLabel')}</label>
        <div style="display:flex;gap:16px;align-items:center;margin-bottom:6px">
          <label style="display:flex;align-items:center;gap:4px;font-weight:normal"><input type="radio" name="videoSource-${block.id}-${i}" data-role="sourceRadio" data-i="${i}" value="url" style="width:auto;margin:0" ${source === 'url' ? 'checked' : ''}> ${tr('videoSourceUrl')}</label>
          <label style="display:flex;align-items:center;gap:4px;font-weight:normal"><input type="radio" name="videoSource-${block.id}-${i}" data-role="sourceRadio" data-i="${i}" value="library" style="width:auto;margin:0" ${source === 'library' ? 'checked' : ''}> ${tr('videoSourceLibrary')}</label>
        </div>` : ''}
        <div data-role="urlWrap" ${source === 'library' ? 'style="display:none"' : ''}>
          <label data-help="videoLink">${tr('videoLinkLabel')}</label><input type="text" data-field="url" data-i="${i}" value="${escapeAttr(source === 'url' ? (v.url || '') : '')}">
        </div>
        ${currentUserIsAdmin ? `
        <div data-role="libraryWrap" ${source === 'library' ? '' : 'style="display:none"'}>
          <label>${tr('videoLibrarySelectLabel')}</label>
          <select data-role="librarySelect" data-i="${i}">
            <option value="">${tr('videoLibrarySelectPlaceholder')}</option>
            ${libraryVideos.map(lv => `<option value="${lv.id}" ${v.libraryVideoId === lv.id ? 'selected' : ''}>${escapeAttr(lv.title || lv.originalName || lv.file)}</option>`).join('')}
          </select>
          ${libraryLoaded && !libraryVideos.length ? `<div class="hint-inline">${tr('videoLibrarySelectEmpty')}</div>` : ''}
        </div>` : ''}
        <label>${tr('commentLabel')}</label><textarea data-field="comment" data-i="${i}" rows="2">${escapeAttr(v.comment || '')}</textarea>
      `;
      const ctrlHost = el.querySelector('[data-role="thumbCtrl"]');
      ctrlHost.innerHTML = fileCtrlHtml(tr('chooseThumbnail'));
      wireFileControl(ctrlHost, 'image/*',
        () => v.pendingThumbnail, () => v.thumbnail,
        f => { v.pendingThumbnail = f; hasUnsavedEdits = true; }, () => v.thumbnailOriginalName);
      listEl.appendChild(el);
    });
  }
  if (currentUserIsAdmin) loadMyVideos().then(({ videos }) => {
    libraryVideos = videos || [];
    libraryLoaded = true;
    renderList();
  });
  body.querySelector('[data-role="addBtn"]').addEventListener('click', () => {
    block.videos.push({ title: '', url: '', comment: '', thumbnail: null, pendingThumbnail: null, source: 'url', libraryVideoId: null });
    hasUnsavedEdits = true;
    renderList();
    refreshAllBlockSummaries();
  });
  listEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="remove"]');
    if (!btn) return;
    block.videos.splice(parseInt(btn.dataset.i, 10), 1);
    hasUnsavedEdits = true;
    renderList();
    refreshAllBlockSummaries();
  });
  listEl.addEventListener('input', e => {
    const field = e.target.dataset.field;
    if (!field) return;
    hasUnsavedEdits = true;
    block.videos[parseInt(e.target.dataset.i, 10)][field] = e.target.value;
  });
  listEl.addEventListener('change', e => {
    const radio = e.target.closest('[data-role="sourceRadio"]');
    if (radio) {
      const v = block.videos[parseInt(radio.dataset.i, 10)];
      v.source = radio.value;
      if (v.source === 'library') { v.url = ''; } else { v.libraryVideoId = null; }
      hasUnsavedEdits = true;
      renderList();
      refreshAllBlockSummaries();
      return;
    }
    const sel = e.target.closest('[data-role="librarySelect"]');
    if (sel) {
      const v = block.videos[parseInt(sel.dataset.i, 10)];
      const chosen = libraryVideos.find(lv => lv.id === sel.value);
      v.libraryVideoId = sel.value || null;
      v.url = chosen ? (chosen.base + chosen.file) : '';
      hasUnsavedEdits = true;
      refreshAllBlockSummaries();
    }
  });
  renderList();
  return card;
}

const CARD_BUILDERS = { header: buildHeaderCard, bio: buildBioCard, testimonials: buildTestimonialsCard, tracks: buildTracksCard, text: buildTextCard, photo: buildPhotoCard, video: buildVideoCard, packs: buildPacksBlockCard, collections: buildCollectionsBlockCard, sfx: buildSfxBlockCard, contact: buildContactBlockCard };

function renderImgPreview(el, pendingFile, remoteFile) {
  if (pendingFile) el.innerHTML = `<img src="${URL.createObjectURL(pendingFile)}">`;
  else if (remoteFile) el.innerHTML = `<span style="color:#6ec98a">✓</span>`;
  else el.textContent = 'aucun';
}

function rebuildAllCards() {
  const container = document.getElementById('blocksEditorContainer');
  container.innerHTML = '';
  blockCards = {};
  blockTracksRefresh = null;
  blocks.forEach(b => {
    const card = buildCardForBlock(b);
    if (card) blockCards[b.id] = card;
  });
  layoutBlocks();
}

// Point de passage unique pour construire une carte de bloc : appelle le builder propre au type, puis
// greffe la section "Apparence de ce bloc" par-dessus — commun à tous les types sans dupliquer le travail
// dans chacun des ~9 builders (décision : les réglages par bloc s'appliquent à tous les blocs sans exception).
function buildCardForBlock(block) {
  const builder = CARD_BUILDERS[block.type];
  if (!builder) return null;
  const card = builder(block);
  const body = card.querySelector('.block-editor-body');
  if (body) {
    // Palier Free (Chantier Apparence Phase 3) : plus de personnalisation par bloc, seulement la galerie
    // de presets au niveau général -- masqué ici plutôt que dans chacun des ~9 builders, même choke
    // point que l'injection elle-même. Les réglages déjà enregistrés par un compositeur passé ensuite en
    // Free restent en base (block.appearance n'est jamais touché ici), juste plus montrés/appliqués.
    if (currentEffectivePlan !== 'free') {
      appendBlockAppearanceSection(body, block);
      appendElementAppearanceSection(body, block);
    }
    body.insertAdjacentHTML('beforeend', collapseFooterHtml('toggle-collapse', {}));
  }
  return card;
}

// Construit les options d'un sélecteur de police : "Par défaut" + groupe Google Fonts pré-intégrées +
// groupe Polices personnalisées (uniquement celles déjà publiées ou en attente d'upload). Encodage de
// la valeur : 'default' | 'google:NomDeLaPolice' | 'custom:idDeLaPoliceUploadée'.
function buildFontSelectOptionsHtml(currentVal) {
  const val = currentVal || 'default';
  let html = `<option value="default" ${val === 'default' ? 'selected' : ''}>${tr('fontDefaultOption')}</option>`;
  html += `<optgroup label="${tr('fontGoogleGroupLabel')}">`;
  html += GOOGLE_FONTS_PRESET.map(name => {
    const v = 'google:' + name;
    return `<option value="${v}" ${val === v ? 'selected' : ''}>${name}</option>`;
  }).join('');
  html += `</optgroup>`;
  if (customFonts.length) {
    html += `<optgroup label="${tr('fontCustomGroupLabel')}">`;
    html += customFonts.map(f => {
      const v = 'custom:' + f.id;
      return `<option value="${v}" ${val === v ? 'selected' : ''}>${escapeAttr(f.name)}</option>`;
    }).join('');
    html += `</optgroup>`;
  }
  return html;
}

// Blocs dont le panneau "Apparence de ce bloc" a été déplié explicitement pendant cette session — replié
// par défaut pour tous les autres (la personnalisation par bloc reste l'exception, pas la norme : la
// plupart des blocs héritent simplement du réglage général et n'ont besoin de rien voir ici).
const expandedBlockAppearanceIds = new Set();
function appendBlockAppearanceSection(body, block) {
  const expanded = expandedBlockAppearanceIds.has(block.id);
  const wrap = document.createElement('div');
  wrap.className = 'block-appearance-section';
  wrap.innerHTML = `
    <div class="list-block-head" style="margin-bottom:0;cursor:pointer" data-role="appearanceToggleHead">
      <div class="list-block-head-left">
        <button class="btn btn-icon btn-toggle-collapse" type="button" data-role="appearanceToggleBtn">${expanded ? '▾' : '▸'}</button>
        <strong data-i18n="blockAppearanceTitle">${tr('blockAppearanceTitle')}</strong>
      </div>
    </div>
    <div class="list-block-body${expanded ? '' : ' collapsed'}" data-role="appearanceBody">
      <div class="hint-inline">${tr('blockAppearanceHint')}</div>
      <div data-role="blockAppearanceFields"></div>
    </div>
  `;
  body.appendChild(wrap);
  const toggleBtn = wrap.querySelector('[data-role="appearanceToggleBtn"]');
  const appearanceBody = wrap.querySelector('[data-role="appearanceBody"]');
  const toggle = () => {
    const collapsed = appearanceBody.classList.toggle('collapsed');
    toggleBtn.textContent = collapsed ? '▸' : '▾';
    if (collapsed) expandedBlockAppearanceIds.delete(block.id); else expandedBlockAppearanceIds.add(block.id);
  };
  wrap.querySelector('[data-role="appearanceToggleHead"]').addEventListener('click', toggle);
  renderBlockAppearanceFields(wrap.querySelector('[data-role="blockAppearanceFields"]'), block);
}

// Case "Personnaliser" par champ : décochée = le bloc hérite du réglage général (champ absent de
// block.appearance) ; cochée = le bloc fige sa propre valeur, indépendante de toute modification
// ultérieure du réglage général (jusqu'à ce qu'on la décoche, ou qu'on choisisse "Tout aligner" côté
// conflit général).
function renderBlockAppearanceFields(host, block) {
  host.innerHTML = APPEARANCE_FIELDS.map(f => {
    const has = !!(block.appearance && block.appearance[f.key] !== undefined);
    const currentVal = has ? block.appearance[f.key] : effectiveThemeValue(f.key);
    let control;
    if (f.type === 'font') {
      control = `<select data-field="${f.key}" data-role="font" ${has ? '' : 'disabled'}>${buildFontSelectOptionsHtml(currentVal)}</select>`;
    } else if (f.type === 'opacity') {
      control = `<input type="range" data-field="${f.key}" data-role="range" min="0" max="1" step="0.05" value="${currentVal}" ${has ? '' : 'disabled'}><span class="hint-inline" data-role="rangeValue" data-field="${f.key}">${Math.round(currentVal * 100)}%</span>`;
    } else if (f.type === 'image') {
      // Contrôle d'upload affiché seulement une fois la case cochée (sinon un contrôle "désactivé mais
      // cliquable" prête à confusion) — reconstruit à chaque bascule de la case, comme le reste du panneau.
      control = has ? `<div data-role="imageCtrl" data-field="${f.key}"></div>` : `<span class="hint-inline">${tr('inheritsGeneralImage')}</span>`;
    } else {
      control = `<input type="color" data-field="${f.key}" data-role="color" value="${currentVal}" ${has ? '' : 'disabled'}>`;
    }
    return `
      <div class="block-appearance-row">
        <label>
          <input type="checkbox" data-field="${f.key}" data-role="toggle" ${has ? 'checked' : ''}>
          <span>${tr(f.label)}</span>
        </label>
        ${control}
      </div>
    `;
  }).join('');
  host.querySelectorAll('[data-role="toggle"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const field = cb.dataset.field;
      if (cb.checked) {
        block.appearance = block.appearance || {};
        block.appearance[field] = effectiveThemeValue(field);
      } else if (block.appearance) {
        delete block.appearance[field];
        if (!Object.keys(block.appearance).length) delete block.appearance;
      }
      hasUnsavedEdits = true;
      renderBlockAppearanceFields(host, block);
    });
  });
  host.querySelectorAll('[data-role="color"]').forEach(inp => {
    inp.addEventListener('input', () => {
      const field = inp.dataset.field;
      block.appearance = block.appearance || {};
      block.appearance[field] = inp.value;
      hasUnsavedEdits = true;
    });
  });
  host.querySelectorAll('[data-role="font"]').forEach(sel => {
    sel.addEventListener('change', () => {
      const field = sel.dataset.field;
      block.appearance = block.appearance || {};
      block.appearance[field] = sel.value;
      hasUnsavedEdits = true;
    });
  });
  host.querySelectorAll('[data-role="range"]').forEach(range => {
    range.addEventListener('input', () => {
      const field = range.dataset.field;
      const v = parseFloat(range.value);
      block.appearance = block.appearance || {};
      block.appearance[field] = v;
      hasUnsavedEdits = true;
      const label = host.querySelector(`[data-role="rangeValue"][data-field="${field}"]`);
      if (label) label.textContent = Math.round(v * 100) + '%';
    });
  });
  // Fichier en attente stocké hors de block.appearance (sur le bloc lui-même, propriété `_pending<Champ>`)
  // pour ne jamais contaminer la sérialisation de appearance avec un objet File non publiable — la
  // sérialisation à la publication ne recopie de toute façon que les champs connus de appearance.
  host.querySelectorAll('[data-role="imageCtrl"]').forEach(div => {
    const field = div.dataset.field;
    const pendingKey = '_pending_' + field;
    div.innerHTML = fileCtrlHtml(tr('chooseBgImageFile'));
    wireFileControl(div, 'image/*',
      () => block[pendingKey], () => (block.appearance ? block.appearance[field] : null),
      f2 => { block[pendingKey] = f2; hasUnsavedEdits = true; });
  });
}

// ---- Réglage par élément (Chantier Apparence, palier Pro, 05/09) ------------------------------------
// Même mécanisme de bascule "Personnaliser" que appendBlockAppearanceSection/renderBlockAppearanceFields
// ci-dessus, un cran plus bas (par élément à l'intérieur d'un bloc plutôt que par bloc) -- réutilisé tel
// quel plutôt que dupliqué : case cochée = fige une valeur de départ dans block.elementAppearance[clé],
// décochée = supprime la clé (hérite du thème du bloc/AdReel, cascade inchangée). Strictement Pro
// (imbriqué DANS une section déjà visible dès Starter côté bloc) -- Starter voit un message verrouillé,
// jamais les contrôles ; Free ne voit rien du tout (toute la zone "Apparence de ce bloc" est masquée pour
// lui, voir buildCardForBlock). Les données déjà enregistrées par un compositeur repassé ensuite
// Starter/Free restent en base (jamais touchées ici), simplement plus montrées/appliquées -- même repli
// non destructif que le reste du système d'apparence.
const expandedElementAppearanceIds = new Set();
function appendElementAppearanceSection(body, block) {
  const registry = ELEMENT_APPEARANCE_REGISTRY[block.type];
  if (!registry || !registry.length) return; // aucun élément personnalisable listé pour ce type de bloc
  const expanded = expandedElementAppearanceIds.has(block.id);
  const isPro = currentEffectivePlan === 'pro';
  const wrap = document.createElement('div');
  wrap.className = 'block-appearance-section';
  wrap.innerHTML = `
    <div class="list-block-head" style="margin-bottom:0;cursor:pointer" data-role="elAppearanceToggleHead">
      <div class="list-block-head-left">
        <button class="btn btn-icon btn-toggle-collapse" type="button" data-role="elAppearanceToggleBtn">${expanded ? '▾' : '▸'}</button>
        <strong>${tr('elementAppearanceTitle')}</strong>
      </div>
    </div>
    <div class="list-block-body${expanded ? '' : ' collapsed'}" data-role="elAppearanceBody">
      ${isPro
        ? `<div class="hint-inline">${tr('elementAppearanceHint')}</div><div data-role="elementAppearanceFields"></div>`
        : `<div class="hint-inline">${tr('elementAppearanceLockedMsg')}</div>`}
    </div>
  `;
  body.appendChild(wrap);
  const toggleBtn = wrap.querySelector('[data-role="elAppearanceToggleBtn"]');
  const sectionBody = wrap.querySelector('[data-role="elAppearanceBody"]');
  const toggle = () => {
    const collapsed = sectionBody.classList.toggle('collapsed');
    toggleBtn.textContent = collapsed ? '▸' : '▾';
    if (collapsed) expandedElementAppearanceIds.delete(block.id); else expandedElementAppearanceIds.add(block.id);
  };
  wrap.querySelector('[data-role="elAppearanceToggleHead"]').addEventListener('click', toggle);
  if (isPro) renderElementAppearanceFields(wrap.querySelector('[data-role="elementAppearanceFields"]'), block, registry);
}
// Avertissement de contraste WCAG AA en direct (pas un blocage) pour un élément de type 'text' -- compare
// la couleur choisie à la couleur de fond effective du thème (AdReel ou preset Free, cf. effectiveThemeValue).
function updateElementContrastWarning(host, block, key) {
  const warnEl = host.querySelector(`[data-role="elContrastWarning"][data-el-key="${key}"]`);
  if (!warnEl) return;
  const ov = block.elementAppearance && block.elementAppearance[key];
  if (!ov || !ov.color) { warnEl.textContent = ''; return; }
  const ratio = contrastRatio(ov.color, effectiveThemeValue('bgColor'));
  if (ratio < WCAG_AA_TEXT_RATIO) {
    warnEl.textContent = tr('elementContrastWarning', { ratio: ratio.toFixed(2) });
    warnEl.style.color = '#c0392b';
  } else {
    warnEl.textContent = '';
  }
}
function renderElementAppearanceFields(host, block, registry) {
  host.innerHTML = registry.map(entry => {
    const ov = block.elementAppearance && block.elementAppearance[entry.key];
    const has = !!ov;
    let control;
    if (entry.type === 'text') {
      const color = has ? ov.color : effectiveThemeValue('contentColor');
      const font = has ? (ov.font || 'default') : effectiveThemeValue('font');
      control = `
        <div class="row" style="margin-top:6px">
          <div><label class="hint-inline">${tr('elementColorLabel')}</label><input type="color" data-el-field="color" data-el-key="${entry.key}" value="${color}" ${has ? '' : 'disabled'}></div>
          <div><label class="hint-inline">${tr('elementFontLabel')}</label><select data-el-field="font" data-el-key="${entry.key}" ${has ? '' : 'disabled'}>${buildFontSelectOptionsHtml(font)}</select></div>
        </div>
        <div class="hint-inline" data-role="elContrastWarning" data-el-key="${entry.key}"></div>
      `;
    } else if (entry.type === 'simple') {
      const color = has ? ov.color : effectiveThemeValue('contentColor');
      control = `<input type="color" data-el-field="color" data-el-key="${entry.key}" value="${color}" ${has ? '' : 'disabled'}>`;
    } else { // twostate : forme d'onde / barre de progression -- deux couleurs, jamais une seule
      const titleColor = effectiveThemeValue('titleColor');
      const played = has ? ov.playedColor : titleColor;
      const unplayed = has ? ov.unplayedColor : mutedVariant(titleColor);
      control = `
        <div class="row" style="margin-top:6px">
          <div><label class="hint-inline">${tr('elementPlayedColorLabel')}</label><input type="color" data-el-field="playedColor" data-el-key="${entry.key}" value="${played}" ${has ? '' : 'disabled'}></div>
          <div><label class="hint-inline">${tr('elementUnplayedColorLabel')}</label><input type="color" data-el-field="unplayedColor" data-el-key="${entry.key}" value="${unplayed}" ${has ? '' : 'disabled'}></div>
        </div>
      `;
    }
    return `
      <div class="block-appearance-row">
        <label>
          <input type="checkbox" data-el-toggle="${entry.key}" ${has ? 'checked' : ''}>
          <span>${tr(entry.labelKey)}</span>
        </label>
        ${control}
      </div>
    `;
  }).join('');
  host.querySelectorAll('[data-el-toggle]').forEach(cb => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.elToggle;
      const entry = registry.find(e => e.key === key);
      if (cb.checked) {
        block.elementAppearance = block.elementAppearance || {};
        if (entry.type === 'twostate') {
          const played = effectiveThemeValue('titleColor');
          block.elementAppearance[key] = { playedColor: played, unplayedColor: mutedVariant(played) };
        } else if (entry.type === 'text') {
          block.elementAppearance[key] = { color: effectiveThemeValue('contentColor'), font: effectiveThemeValue('font') };
        } else {
          block.elementAppearance[key] = { color: effectiveThemeValue('contentColor') };
        }
      } else if (block.elementAppearance) {
        delete block.elementAppearance[key];
        if (!Object.keys(block.elementAppearance).length) delete block.elementAppearance;
      }
      hasUnsavedEdits = true;
      renderElementAppearanceFields(host, block, registry);
    });
  });
  host.querySelectorAll('[data-el-field="color"], [data-el-field="playedColor"], [data-el-field="unplayedColor"]').forEach(inp => {
    inp.addEventListener('input', () => {
      const key = inp.dataset.elKey;
      const field = inp.dataset.elField;
      block.elementAppearance = block.elementAppearance || {};
      block.elementAppearance[key] = block.elementAppearance[key] || {};
      block.elementAppearance[key][field] = inp.value;
      hasUnsavedEdits = true;
      if (field === 'color') updateElementContrastWarning(host, block, key);
    });
  });
  host.querySelectorAll('[data-el-field="font"]').forEach(sel => {
    sel.addEventListener('change', () => {
      const key = sel.dataset.elKey;
      block.elementAppearance = block.elementAppearance || {};
      block.elementAppearance[key] = block.elementAppearance[key] || {};
      block.elementAppearance[key].font = sel.value;
      hasUnsavedEdits = true;
    });
  });
  registry.forEach(entry => { if (entry.type === 'text' && block.elementAppearance && block.elementAppearance[entry.key]) updateElementContrastWarning(host, block, entry.key); });
}

document.getElementById('btnAddHeaderBlock').addEventListener('click', () => {
  const b = { id: genId(), type: 'header' };
  blocks.push(b);
  blockCards[b.id] = buildCardForBlock(b);
  hasUnsavedEdits = true;
  trackBackstageEvent('block_add', { blockType: 'header' });
  layoutBlocks();
});
document.getElementById('btnAddBioBlock').addEventListener('click', () => {
  const b = { id: genId(), type: 'bio' };
  blocks.push(b);
  blockCards[b.id] = buildCardForBlock(b);
  hasUnsavedEdits = true;
  trackBackstageEvent('block_add', { blockType: 'bio' });
  layoutBlocks();
});
document.getElementById('btnAddTestimonialsBlock').addEventListener('click', () => {
  const b = { id: genId(), type: 'testimonials' };
  blocks.push(b);
  blockCards[b.id] = buildCardForBlock(b);
  hasUnsavedEdits = true;
  trackBackstageEvent('block_add', { blockType: 'testimonials' });
  layoutBlocks();
});
document.getElementById('btnAddTracksBlock').addEventListener('click', () => {
  const b = { id: genId(), type: 'tracks' };
  blocks.push(b);
  blockCards[b.id] = buildCardForBlock(b);
  hasUnsavedEdits = true;
  trackBackstageEvent('block_add', { blockType: 'tracks' });
  layoutBlocks();
});
document.getElementById('btnAddText').addEventListener('click', () => {
  const b = { id: genId(), type: 'text', content: '', align: 'left' };
  blocks.push(b);
  blockCards[b.id] = buildCardForBlock(b);
  hasUnsavedEdits = true;
  trackBackstageEvent('block_add', { blockType: 'text' });
  layoutBlocks();
});
document.getElementById('btnAddPhoto').addEventListener('click', () => {
  const b = { id: genId(), type: 'photo', align: 'left', images: [] };
  blocks.push(b);
  blockCards[b.id] = buildCardForBlock(b);
  hasUnsavedEdits = true;
  trackBackstageEvent('block_add', { blockType: 'photo' });
  layoutBlocks();
});
document.getElementById('btnAddVideoBlock').addEventListener('click', () => {
  const b = { id: genId(), type: 'video', videos: [] };
  blocks.push(b);
  blockCards[b.id] = buildCardForBlock(b);
  hasUnsavedEdits = true;
  trackBackstageEvent('block_add', { blockType: 'video' });
  layoutBlocks();
});
document.getElementById('btnAddPacksBlock').addEventListener('click', () => {
  const b = { id: genId(), type: 'packs', packIds: [] };
  blocks.push(b);
  blockCards[b.id] = buildCardForBlock(b);
  hasUnsavedEdits = true;
  trackBackstageEvent('block_add', { blockType: 'packs' });
  layoutBlocks();
});
document.getElementById('btnAddCollectionsBlock').addEventListener('click', () => {
  const b = { id: genId(), type: 'collections', collectionIds: [] };
  blocks.push(b);
  blockCards[b.id] = buildCardForBlock(b);
  hasUnsavedEdits = true;
  trackBackstageEvent('block_add', { blockType: 'collections' });
  layoutBlocks();
});
document.getElementById('btnAddSfxBlock').addEventListener('click', () => {
  const b = { id: genId(), type: 'sfx', sfxIds: [] };
  blocks.push(b);
  blockCards[b.id] = buildCardForBlock(b);
  hasUnsavedEdits = true;
  trackBackstageEvent('block_add', { blockType: 'sfx' });
  layoutBlocks();
});
document.getElementById('btnAddContactBlock').addEventListener('click', () => {
  const b = { id: genId(), type: 'contact' };
  blocks.push(b);
  blockCards[b.id] = buildCardForBlock(b);
  hasUnsavedEdits = true;
  trackBackstageEvent('block_add', { blockType: 'contact' });
  layoutBlocks();
});

