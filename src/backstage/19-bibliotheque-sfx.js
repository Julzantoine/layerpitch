/* ---------------- Bibliothèque Sfx ---------------- */
function renderSfxLibrary() {
  const masterHost = document.getElementById('sfxLibraryMaster');
  const detailHost = document.getElementById('sfxLibraryDetail');
  if (!masterHost || !detailHost) return; // panneau pas encore dans le DOM au tout premier rendu
  sfxLibrary.forEach(s => { if (!s.alternatives) s.alternatives = []; });
  if (!manageSfxSelectedId || !sfxLibrary.some(s => s.id === manageSfxSelectedId)) {
    manageSfxSelectedId = sfxLibrary.length ? sfxLibrary[0].id : null;
  }

  renderOrgMasterList(masterHost, sfxLibrary, sfxFolders, collapsedSfxFolderIds, {
    selectedId: manageSfxSelectedId,
    selectAction: 'select-manage-sfx',
    toggleFolderAction: 'toggle-sfx-folder',
    deleteFolderAction: 'delete-sfx-folder',
    folderFieldAttr: 'data-sfx-folder-field',
    folderFallbackKey: 'orgFolderFallback',
    buildRowInner: s => `<span class="seq-master-item-label">${escapeAttr(s.title) || tr('sfxFallback', { n: sfxLibrary.indexOf(s) + 1 })}</span>`
  });
  wireOrgDragDrop(masterHost, () => sfxLibrary, () => sfxFolders, renderSfxLibrary); // conteneur statique du HTML -- voir commentaire de wireOrgDragDrop

  detailHost.innerHTML = '';
  const sfx = sfxLibrary.find(s => s.id === manageSfxSelectedId);
  if (!sfx) {
    detailHost.innerHTML = `<div class="hint-inline">${tr('sfxLibraryEmptyHint')}</div>`;
    return;
  }
  const si = sfxLibrary.indexOf(sfx);
  if (!sfxSelectedEntry.has(sfx.id)) sfxSelectedEntry.set(sfx.id, 'identity');
  const entrySel = sfxSelectedEntry.get(sfx.id);

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="list-block-head">
      <div class="list-block-head-left" style="flex:1;">
        <input type="text" data-sfx-field="title" data-si="${si}" value="${escapeAttr(sfx.title)}" placeholder="${tr('sfxFallback', { n: si + 1 })}" style="font-weight:600;border:1px solid transparent;background:transparent;padding:2px 4px;flex:1;min-width:120px;">
      </div>
      <button class="btn btn-small btn-danger" data-action="remove-sfx" data-si="${si}">${tr('removeSfxBtn')}</button>
    </div>
    <div class="seq-two-col" style="margin-top:10px">
      <div class="seq-master-list" data-role="sfxEntryMaster"></div>
      <div class="seq-detail-col" data-role="sfxEntryDetail"></div>
    </div>
  `;
  detailHost.appendChild(wrap);

  const entryMasterHost = wrap.querySelector('[data-role="sfxEntryMaster"]');
  const entryDetailHost = wrap.querySelector('[data-role="sfxEntryDetail"]');
  entryMasterHost.appendChild(simpleMasterItemEl('select-sfx-entry', 'si', si, 'identity', entrySel === 'identity', `<div class="seq-master-item-label">${tr('trackSectionIdentity')}</div>`));
  entryMasterHost.appendChild(simpleMasterItemEl('select-sfx-entry', 'si', si, 'behavior', entrySel === 'behavior', `<div class="seq-master-item-label">${tr('sectionBehavior')}</div>`));
  entryMasterHost.appendChild(simpleMasterItemEl('select-sfx-entry', 'si', si, 'variations', entrySel === 'variations', `<div class="seq-master-item-label">${tr('sfxVariationsShortLabel')}</div>`));
  entryMasterHost.appendChild(simpleMasterItemEl('select-sfx-entry', 'si', si, 'space', entrySel === 'space', `<div class="seq-master-item-label">${tr('sfxEntrySpace')}</div>`));

  if (entrySel === 'identity') {
    // Titre éditable ici aussi (en plus de l'en-tête ci-dessus) -- synchronisé en direct sans re-rendu,
    // même principe que le titre des Packs/Collections (voir le gestionnaire 'input' plus bas).
    entryDetailHost.innerHTML = `
      <label>${tr('titleLabel')}</label>
      <input type="text" data-sfx-field="title" data-si="${si}" value="${escapeAttr(sfx.title)}">
      <label>${tr('descriptionLabelFr')}</label>
      <textarea data-sfx-field="descriptionFr" data-si="${si}" rows="3">${escapeAttr(sfx.descriptionFr)}</textarea>
      <label>${tr('descriptionLabelEn')}</label>
      <textarea data-sfx-field="descriptionEn" data-si="${si}" rows="3">${escapeAttr(sfx.descriptionEn)}</textarea>
      <label>${tr('sfxTagLabel')}</label>
      <input type="text" data-sfx-field="tag" data-si="${si}" value="${escapeAttr(sfx.tag || '')}">
    `;
  } else if (entrySel === 'behavior') {
    entryDetailHost.innerHTML = `
      <div class="row">
        <div>
          <label data-help="sfxRrMode">${tr('sfxRrModeLabel')}</label>
          <select data-sfx-field="rrMode" data-si="${si}">
            <option value="random"${(sfx.rrMode || 'random') === 'random' ? ' selected' : ''}>${tr('sfxRrModeRandom')}</option>
            <option value="sequential"${sfx.rrMode === 'sequential' ? ' selected' : ''}>${tr('sfxRrModeSequential')}</option>
          </select>
        </div>
        <div>
          <label style="display:flex;align-items:center;gap:8px;margin-top:22px" data-help="sfxDuck">
            <input type="checkbox" data-sfx-field="duckMainTrack" data-si="${si}" ${sfx.duckMainTrack ? 'checked' : ''} style="width:auto;margin:0;">
            <span style="font-size:12px;color:var(--text-dimmer);">${tr('sfxDuckLabel')}</span>
          </label>
        </div>
      </div>
    `;
  } else if (entrySel === 'space') {
    renderSfxSpaceEditor(entryDetailHost, sfx);
  } else if (entrySel === 'variations') {
    // Le double niveau de repli (entrée "Variations" + bouton "N variations" à l'intérieur) est conservé
    // tel quel (décision explicite, 20/08) même si la sélection d'entrée masque déjà tout le reste --
    // utile quand une même carte contient beaucoup de variations à parcourir.
    entryDetailHost.innerHTML = `
      <label data-help="sfxAlternatives">${tr('sfxAlternativesLabel')}</label>
      <div class="hint-inline">${tr('sfxAlternativesHint')}</div>
      <div class="hint-inline">${tr('altDropHint')}</div>
      <div data-role="sfxVariationsDrop" style="margin-top:8px">${tr('dropAllFilesHint')}</div>
      <div style="margin-top:8px">${altPoolToggleHtml(`sfxpool:${sfx.id}`, sfx.alternatives.length)}</div>
      <div class="list-block-body alt-pool-panel${expandedAltPoolKeys.has(`sfxpool:${sfx.id}`) ? '' : ' collapsed'}" data-role="altPoolBody" style="margin-top:8px">
        <div data-role="sfxAlternatives" data-si="${si}"></div>
        <div class="actions"><button class="btn btn-small" data-action="add-sfx-alt" data-si="${si}">${tr('addSfxAltBtn')}</button></div>
      </div>
    `;
    wireAltPoolToggle(wrap);
    const altsHost = entryDetailHost.querySelector('[data-role="sfxAlternatives"]');
    sfx.alternatives.forEach((alt, ai) => {
      const row = document.createElement('div');
      row.className = 'list-block';
      row.style.marginBottom = '8px';
      row.innerHTML = `
        <div data-role="sfxAltFileCtrl"></div>
        <label style="margin-top:8px">${tr('sfxAltLabelText')}</label>
        <input type="text" data-sfx-alt-field="label" data-si="${si}" data-ai="${ai}" value="${escapeAttr(alt.label)}" placeholder="${tr('sfxAltLabelPlaceholder', { n: ai + 1 })}">
      `;
      const ctrlHost = row.querySelector('[data-role="sfxAltFileCtrl"]');
      ctrlHost.innerHTML = fileCtrlHtml(tr('chooseSfxAltFile'), deleteIconBtnHtml('remove-sfx-alt', { si, ai }, tr('removeSfxAltBtn')));
      wireFileControl(ctrlHost, '.wav,audio/wav,.mp3,audio/mp3,audio/mpeg',
        () => alt.pendingFile, () => alt.remoteFile,
        f => {
          alt.pendingFile = f;
          hasUnsavedEdits = true;
          if (!alt.label || !alt.label.trim()) { alt.label = titleFromFilename(f.name); renderSfxLibrary(); }
        }, () => alt.originalFileName);
      altsHost.appendChild(row);
    });
    // Glisser-déposer l'ensemble des variations RR d'un coup — même mécanisme que les groupes
    // vertical-random et les emplacements séquentiels (wireBatchDrop), une alternative créée par fichier.
    const addSfxVariations = files => {
      files.forEach(f => sfx.alternatives.push({ label: titleFromFilename(f.name), remoteFile: null, pendingFile: f }));
      hasUnsavedEdits = true;
      renderSfxLibrary();
    };
    wireBatchDrop(altsHost, addSfxVariations);
    // Zone toujours visible (25/09) : celle de la liste ci-dessous disparaît quand le panneau est replié.
    wireBatchDrop(entryDetailHost.querySelector('[data-role="sfxVariationsDrop"]'), addSfxVariations);
  }
}

// ---- Spatialisation d'un Sfx : matrice "salle + auditeur au centre" (23/09) -- réservée à l'admin ----
// sfx.spatial = { enabled, room, x, y, binaural } ; x = mètres vers la droite, y = vers l'avant, l'auditeur est
// en (0,0). Le moteur (buildSpatialVoice dans player.js) lit sfx.spatial à CHAQUE lecture : le lecteur de test
// ci-dessous reflète donc instantanément chaque déplacement du point, sans republier.
function sfxSpaceDefaults() { return { enabled: true, room: 'room', x: 0, y: 3, binaural: false, path: { mode: 'fixed', points: [], loop: 'loop', durationSec: null } }; }
let sfxSpaceSelectedPoint = 0; // point de trajectoire sélectionné (index) dans l'éditeur ouvert
function renderSfxSpaceEditor(host, sfx) {
  if (!currentUserIsAdmin) {
    host.innerHTML = `<div style="opacity:0.55"><div style="font-weight:600;margin-bottom:2px">${tr('sfxSpaceTitle')}</div><div class="hint-inline">${tr('sfxSpaceAdminOnly')}</div></div>`;
    return;
  }
  const core = window.LayerPlayerCore;
  const sp = sfx.spatial;
  const on = !!(sp && sp.enabled);
  host.innerHTML = `
    <div style="font-weight:600;margin-bottom:2px">${tr('sfxSpaceTitle')}</div>
    <div class="hint-inline">${tr('sfxSpaceHint')}</div>
    <label class="switch-row" style="margin-top:8px">
      <input type="checkbox" data-sfx-space="enabled" ${on ? 'checked' : ''}>
      <span class="switch-row-label">${tr('sfxSpaceEnable')}</span>
    </label>
    <div data-role="spaceBody"></div>
  `;
  const body = host.querySelector('[data-role="spaceBody"]');
  host.querySelector('[data-sfx-space="enabled"]').addEventListener('change', e => {
    if (e.target.checked) sfx.spatial = Object.assign(sfxSpaceDefaults(), sfx.spatial || {}, { enabled: true });
    else if (sfx.spatial) sfx.spatial.enabled = false;
    hasUnsavedEdits = true;
    renderSfxSpaceEditor(host, sfx);
  });
  if (!on) return;

  if (!sp.path) sp.path = sfxSpaceDefaults().path;
  const path = sp.path;
  const room = core.SPATIAL_ROOMS[sp.room] ? sp.room : 'room';
  const [hx, hy] = core.spatialFieldHalfExtent(room);
  const SIZE = 320, C = SIZE / 2, PAD = 14, MAXPTS = 16;
  const ppm = (C - PAD) / Math.max(hx, hy); // pixels par mètre
  const gridStep = Math.max(hx, hy) <= 5 ? 1 : (Math.max(hx, hy) <= 15 ? 2 : 5);
  let grid = '';
  for (let m = gridStep; m <= Math.max(hx, hy) + 1e-6; m += gridStep) {
    if (m <= hx + 1e-6) grid += `<line x1="${C + m * ppm}" y1="${C - hy * ppm}" x2="${C + m * ppm}" y2="${C + hy * ppm}"/><line x1="${C - m * ppm}" y1="${C - hy * ppm}" x2="${C - m * ppm}" y2="${C + hy * ppm}"/>`;
    if (m <= hy + 1e-6) grid += `<line x1="${C - hx * ppm}" y1="${C - m * ppm}" x2="${C + hx * ppm}" y2="${C - m * ppm}"/><line x1="${C - hx * ppm}" y1="${C + m * ppm}" x2="${C + hx * ppm}" y2="${C + m * ppm}"/>`;
  }
  const isPath = path.mode === 'glide' || path.mode === 'steps';
  body.innerHTML = `
    <div class="row" style="margin-top:8px">
      <div>
        <label>${tr('sfxSpaceRoomLabel')}</label>
        <select data-sfx-space="room">${Object.keys(core.SPATIAL_ROOMS).map(k => `<option value="${k}" ${k === room ? 'selected' : ''}>${tr('sfxSpaceRoom_' + k)}</option>`).join('')}</select>
      </div>
      <div>
        <label>${tr('sfxSpacePathModeLabel')}</label>
        <select data-sfx-space="pathMode">
          <option value="fixed" ${!isPath ? 'selected' : ''}>${tr('sfxSpacePathFixed')}</option>
          <option value="steps" ${path.mode === 'steps' ? 'selected' : ''}>${tr('sfxSpacePathSteps')}</option>
          <option value="glide" ${path.mode === 'glide' ? 'selected' : ''}>${tr('sfxSpacePathGlide')}</option>
        </select>
      </div>
    </div>
    ${room !== 'outside' ? `
      <div class="row" style="margin-top:6px">
        <div><label>${tr('sfxSpaceReverbDb')} : <span data-role="reverbDbVal">${sp.reverbDb != null ? sp.reverbDb : 0}</span></label>
          <input type="range" min="-18" max="6" step="1" data-sfx-space="reverbDb" value="${sp.reverbDb != null ? sp.reverbDb : 0}"></div>
        <div><label>${tr('sfxSpaceBrightness')}</label>
          <input type="range" min="-1" max="1" step="0.1" data-sfx-space="brightness" value="${sp.brightness != null ? sp.brightness : 0}"></div>
      </div>` : ''}
    ${isPath ? `<div class="hint-inline">${tr(path.mode === 'steps' ? 'sfxSpacePathStepsHint' : 'sfxSpacePathGlideHint')}</div>` : ''}
    ${path.mode === 'steps' ? `
      <div style="margin-top:6px"><label>${tr('sfxSpacePathLoopLabel')}</label>
        <select data-sfx-space="pathLoop">
          ${['loop', 'pingpong', 'random', 'stop'].map(k => `<option value="${k}" ${path.loop === k ? 'selected' : ''}>${tr('sfxSpacePathLoop_' + k)}</option>`).join('')}
        </select></div>` : ''}
    ${path.mode === 'glide' ? `
      <div style="margin-top:6px"><label>${tr('sfxSpacePathDurationLabel')}</label>
        <input type="number" min="0.1" step="0.1" data-sfx-space="pathDuration" value="${path.durationSec != null ? path.durationSec : ''}"></div>` : ''}
    <div style="margin-top:10px;max-width:${SIZE}px">
      <svg data-role="spaceMatrix" viewBox="0 0 ${SIZE} ${SIZE}" width="100%" style="touch-action:none;cursor:crosshair;background:var(--bg-elev, transparent);border:1px solid var(--border);border-radius:8px;display:block">
        <rect x="${C - hx * ppm}" y="${C - hy * ppm}" width="${2 * hx * ppm}" height="${2 * hy * ppm}" fill="none" stroke="var(--text-dimmer, #888)" stroke-width="1.5"/>
        <g stroke="var(--border)" stroke-width="0.5">${grid}</g>
        <line x1="${C - hx * ppm}" y1="${C}" x2="${C + hx * ppm}" y2="${C}" stroke="var(--border)" stroke-width="0.8" stroke-dasharray="3 3"/>
        <line x1="${C}" y1="${C - hy * ppm}" x2="${C}" y2="${C + hy * ppm}" stroke="var(--border)" stroke-width="0.8" stroke-dasharray="3 3"/>
        <g data-role="spaceListener"><polygon points="${C},${C - 11} ${C - 8},${C + 8} ${C + 8},${C + 8}" fill="var(--text-dimmer, #888)"><title>${tr('sfxSpaceListener')}</title></polygon></g>
        <g data-role="spaceDynamic"></g>
        <text x="${C - hx * ppm + 4}" y="${C + hy * ppm - 5}" font-size="10" fill="var(--text-dimmer, #888)">${tr('sfxSpaceGrid', { n: gridStep })}</text>
      </svg>
      <div class="hint-inline" data-role="spaceReadout" style="margin-top:4px"></div>
      ${isPath ? `<div class="actions" style="margin-top:6px">
        <button class="btn btn-small" type="button" data-role="pathRemove">${tr('sfxSpacePathRemovePoint')}</button>
        <button class="btn btn-small" type="button" data-role="pathClear">${tr('sfxSpacePathReset')}</button>
      </div>` : ''}
    </div>
    <label class="switch-row" style="margin-top:10px">
      <input type="checkbox" data-sfx-space="binaural" ${sp.binaural ? 'checked' : ''}>
      <span class="switch-row-label">${tr('sfxSpaceBinaural')}</span>
    </label>
    <div class="hint-inline">${tr('sfxSpaceBinauralHint')}</div>
    <div style="margin-top:12px;padding:8px;border:1px solid var(--border);border-radius:6px">
      <label style="font-weight:600">${tr('sfxSpacePublicModeLabel')}</label>
      <select data-sfx-space="publicMode">
        <option value="free" ${(sp.publicMode || 'free') === 'free' ? 'selected' : ''}>${tr('sfxSpacePublicFree')}</option>
        <option value="frozen" ${sp.publicMode === 'frozen' ? 'selected' : ''}>${tr('sfxSpacePublicFrozen')}</option>
        <option value="hidden" ${sp.publicMode === 'hidden' ? 'selected' : ''}>${tr('sfxSpacePublicHidden')}</option>
      </select>
      <div class="hint-inline">${tr('sfxSpacePublicHint')}</div>
    </div>
    <div style="margin-top:12px;font-weight:600;font-size:0.9em">${tr('sfxSpaceTestLabel')}</div>
    <div data-role="spaceTest" style="margin-top:6px"></div>
  `;
  const clampPt = (q) => ({ x: Math.max(-hx, Math.min(hx, q.x || 0)), y: Math.max(-hy, Math.min(hy, q.y || 0)) });
  body.querySelector('[data-sfx-space="room"]').addEventListener('change', e => {
    sfx.spatial.room = e.target.value;
    const [nx, ny] = core.spatialFieldHalfExtent(e.target.value);
    const cl = (q) => ({ x: Math.max(-nx, Math.min(nx, q.x || 0)), y: Math.max(-ny, Math.min(ny, q.y || 0)) });
    Object.assign(sfx.spatial, cl(sfx.spatial));
    sfx.spatial.path.points = sfx.spatial.path.points.map(cl);
    hasUnsavedEdits = true;
    renderSfxSpaceEditor(host, sfx);
  });
  body.querySelector('[data-sfx-space="pathMode"]').addEventListener('change', e => {
    const mode = e.target.value;
    path.mode = mode;
    if (mode !== 'fixed' && path.points.length < 2) {
      // Amorce : départ = position actuelle, arrivée = son symétrique (ou 4 m à droite si on est au centre).
      const a = clampPt({ x: sp.x, y: sp.y });
      path.points = [a, clampPt({ x: Math.abs(a.x) > 0.5 ? -a.x : a.x + 4, y: a.y })];
    }
    sfxSpaceSelectedPoint = 0;
    hasUnsavedEdits = true;
    renderSfxSpaceEditor(host, sfx);
  });
  const loopSel = body.querySelector('[data-sfx-space="pathLoop"]');
  if (loopSel) loopSel.addEventListener('change', e => { path.loop = e.target.value; hasUnsavedEdits = true; });
  const durInp = body.querySelector('[data-sfx-space="pathDuration"]');
  if (durInp) durInp.addEventListener('input', e => { const v = parseFloat(e.target.value); path.durationSec = v > 0 ? v : null; hasUnsavedEdits = true; });
  body.querySelector('[data-sfx-space="binaural"]').addEventListener('change', e => { sfx.spatial.binaural = e.target.checked; hasUnsavedEdits = true; });
  body.querySelector('[data-sfx-space="publicMode"]').addEventListener('change', e => { sfx.spatial.publicMode = e.target.value; hasUnsavedEdits = true; });
  const rvDb = body.querySelector('[data-sfx-space="reverbDb"]');
  if (rvDb) rvDb.addEventListener('input', e => { sfx.spatial.reverbDb = parseFloat(e.target.value); body.querySelector('[data-role="reverbDbVal"]').textContent = e.target.value; hasUnsavedEdits = true; });
  const brt = body.querySelector('[data-sfx-space="brightness"]');
  if (brt) brt.addEventListener('input', e => { sfx.spatial.brightness = parseFloat(e.target.value); hasUnsavedEdits = true; });

  const svg = body.querySelector('[data-role="spaceMatrix"]');
  const dyn = svg.querySelector('[data-role="spaceDynamic"]');
  const readout = body.querySelector('[data-role="spaceReadout"]');
  const round1 = v => Math.round(v * 10) / 10;
  const X = m => C + m * ppm, Y = m => C - m * ppm;
  if (sfxSpaceSelectedPoint >= path.points.length) sfxSpaceSelectedPoint = Math.max(0, path.points.length - 1);
  function paint() {
    if (!isPath) {
      dyn.innerHTML = `<line x1="${C}" y1="${C}" x2="${X(sp.x)}" y2="${Y(sp.y)}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="2 3"/>
        <circle r="9" cx="${X(sp.x)}" cy="${Y(sp.y)}" fill="var(--accent)" stroke="#fff" stroke-width="2"/>`;
      readout.textContent = tr('sfxSpaceReadout', { x: round1(sp.x), y: round1(sp.y), d: round1(Math.hypot(sp.x, sp.y)) });
      return;
    }
    const pts = path.points;
    const line = pts.map(q => X(q.x) + ',' + Y(q.y)).join(' ');
    const arrow = path.mode === 'glide' && pts.length >= 2 ? (() => { // flèche de sens à la fin du chemin
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      const ang = Math.atan2(-(b.y - a.y), b.x - a.x), L = 11;
      const p1 = [X(b.x) - L * Math.cos(ang - 0.45), Y(b.y) - L * Math.sin(ang - 0.45)], p2 = [X(b.x) - L * Math.cos(ang + 0.45), Y(b.y) - L * Math.sin(ang + 0.45)];
      return `<polyline points="${p1.join(',')} ${X(b.x)},${Y(b.y)} ${p2.join(',')}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
    })() : '';
    // Bleu PLEIN = le point en train de jouer (pas à pas) ; anneau épais = le point sélectionné pour l'édition ;
    // anneau fin = les autres. Une pastille bleue suit le chemin pendant un glissement.
    const glideDot = playing.glide && playing.glidePos ? `<circle cx="${X(playing.glidePos.x)}" cy="${Y(playing.glidePos.y)}" r="7" fill="var(--accent)" stroke="#fff" stroke-width="2" style="pointer-events:none"/>` : '';
    dyn.innerHTML = `<polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="${path.mode === 'steps' ? '3 4' : '0'}"/>${arrow}` +
      pts.map((q, i) => { const isPlaying = i === playing.idx, isSel = i === sfxSpaceSelectedPoint; return `<circle r="${isSel ? 10 : 8}" cx="${X(q.x)}" cy="${Y(q.y)}" fill="${isPlaying ? 'var(--accent)' : 'var(--bg, #fff)'}" stroke="var(--accent)" stroke-width="${isSel ? 3.5 : 2}"/>
        <text x="${X(q.x)}" y="${Y(q.y) + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="${isPlaying ? '#fff' : 'var(--accent)'}" style="pointer-events:none">${i + 1}</text>`; }).join('') + glideDot;
    const q = pts[sfxSpaceSelectedPoint] || pts[0];
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    readout.textContent = tr('sfxSpacePathReadout', { n: sfxSpaceSelectedPoint + 1, x: round1(q.x), y: round1(q.y), len: round1(len) });
  }
  function eventPos(ev) {
    const r = svg.getBoundingClientRect();
    const k = SIZE / r.width;
    const px = (ev.clientX - r.left) * k, py = (ev.clientY - r.top) * k;
    return { px, py, x: round1(Math.max(-hx, Math.min(hx, (px - C) / ppm))), y: round1(Math.max(-hy, Math.min(hy, -(py - C) / ppm))) };
  }
  // Lecture en cours dans le lecteur de test : point « qui joue » (pas à pas) / position suivie (glissement).
  const playing = { idx: -1, glide: false, glidePos: null, token: 0 };
  const pathPos = (frac) => { // position à la fraction frac (0..1) de la longueur du chemin
    const pts = path.points; let total = 0; const cum = [0];
    for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); cum.push(total); }
    if (total <= 0) return pts[0];
    const a = frac * total; let i = 1; while (i < cum.length - 1 && cum[i] < a) i++;
    const seg = cum[i] - cum[i - 1] || 1, f = Math.max(0, Math.min(1, (a - cum[i - 1]) / seg));
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
  };
  if (window.__sfxSpacePlayHandler) document.removeEventListener('layerpitch-sfx-spatial', window.__sfxSpacePlayHandler);
  window.__sfxSpacePlayHandler = e => {
    if (!svg.isConnected || !isPath || e.detail.sfxId !== 'spacetest-' + sfx.id) return;
    const token = ++playing.token, dur = Math.max(0.2, e.detail.glideDuration || e.detail.duration || 1);
    if (e.detail.mode === 'steps' && e.detail.stepIndex != null) {
      playing.idx = e.detail.stepIndex; playing.glide = false;
      paint();
      setTimeout(() => { if (playing.token === token) { playing.idx = -1; paint(); } }, Math.max(300, (e.detail.duration || 1) * 1000));
    } else if (e.detail.mode === 'glide') {
      playing.idx = -1; playing.glide = true;
      const t0 = performance.now();
      const step = () => {
        if (playing.token !== token || !svg.isConnected) return;
        const f = (performance.now() - t0) / 1000 / dur;
        if (f >= 1) { playing.glide = false; playing.glidePos = null; paint(); return; }
        playing.glidePos = pathPos(f); paint();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  };
  document.addEventListener('layerpitch-sfx-spatial', window.__sfxSpacePlayHandler);
  let dragging = false;
  svg.addEventListener('pointerdown', ev => {
    const e = eventPos(ev);
    if (!isPath) { sp.x = e.x; sp.y = e.y; }
    else {
      // Point existant à portée : on le sélectionne et on le déplace. Sinon : nouveau point en fin de chemin.
      let hit = -1, best = 16;
      path.points.forEach((q, i) => { const d = Math.hypot(X(q.x) - e.px, Y(q.y) - e.py); if (d < best) { best = d; hit = i; } });
      if (hit < 0) {
        if (path.points.length >= MAXPTS) return;
        path.points.push({ x: e.x, y: e.y }); hit = path.points.length - 1;
        if (path.mode === 'steps' || path.mode === 'glide') { sp.x = path.points[0].x; sp.y = path.points[0].y; }
      }
      sfxSpaceSelectedPoint = hit;
    }
    dragging = true; hasUnsavedEdits = true;
    try { svg.setPointerCapture(ev.pointerId); } catch (err) {}
    paint();
  });
  svg.addEventListener('pointermove', ev => {
    if (!dragging) return;
    const e = eventPos(ev);
    if (!isPath) { sp.x = e.x; sp.y = e.y; }
    else { path.points[sfxSpaceSelectedPoint] = { x: e.x, y: e.y }; sp.x = path.points[0].x; sp.y = path.points[0].y; }
    hasUnsavedEdits = true;
    paint();
  });
  const endDrag = () => { dragging = false; };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  // Double-clic sur un point du chemin = le supprimer (24/09, demande de Jules-Antoine) ; jamais sous 2 points.
  svg.addEventListener('dblclick', ev => {
    if (!isPath) return;
    const e = eventPos(ev);
    let hit = -1, best = 16;
    path.points.forEach((q, i) => { const d = Math.hypot(X(q.x) - e.px, Y(q.y) - e.py); if (d < best) { best = d; hit = i; } });
    if (hit < 0 || path.points.length <= 2) return;
    path.points.splice(hit, 1);
    sfxSpaceSelectedPoint = Math.max(0, Math.min(sfxSpaceSelectedPoint, path.points.length - 1));
    sp.x = path.points[0].x; sp.y = path.points[0].y;
    hasUnsavedEdits = true;
    renderSfxSpaceEditor(host, sfx);
  });
  const rmBtn = body.querySelector('[data-role="pathRemove"]');
  if (rmBtn) rmBtn.addEventListener('click', () => {
    if (path.points.length <= 2) return; // un chemin a besoin d'au moins 2 points
    path.points.splice(sfxSpaceSelectedPoint, 1);
    sfxSpaceSelectedPoint = Math.max(0, sfxSpaceSelectedPoint - 1);
    hasUnsavedEdits = true;
    renderSfxSpaceEditor(host, sfx);
  });
  const clrBtn = body.querySelector('[data-role="pathClear"]');
  if (clrBtn) clrBtn.addEventListener('click', () => {
    const a = clampPt({ x: sp.x, y: sp.y });
    path.points = [a, clampPt({ x: Math.abs(a.x) > 0.5 ? -a.x : a.x + 4, y: a.y })];
    sfxSpaceSelectedPoint = 0; hasUnsavedEdits = true;
    renderSfxSpaceEditor(host, sfx);
  });
  paint();
  // Le triangle "auditeur" suit l'orientation de la tête réglée dans le lecteur de test (évènement du moteur).
  const listenerG = svg.querySelector('[data-role="spaceListener"]');
  const setTri = deg => listenerG.setAttribute('transform', `rotate(${deg} ${C} ${C})`);
  setTri(core.getListenerYaw());
  if (window.__sfxSpaceYawHandler) document.removeEventListener('layerpitch-head-yaw', window.__sfxSpaceYawHandler);
  window.__sfxSpaceYawHandler = e => { if (listenerG.isConnected) setTri(e.detail); };
  document.addEventListener('layerpitch-head-yaw', window.__sfxSpaceYawHandler);

  // Lecteur de test : le vrai lecteur de Sfx du site (mêmes variations, même moteur), branché sur les fichiers
  // du Sfx -- même ceux pas encore publiés -- et sur sfx.spatial EN DIRECT (getter), pour entendre chaque
  // déplacement du point dès le clic suivant. En mode "pas à pas", chaque clic sur Lecture avance d'un point.
  const testHost = body.querySelector('[data-role="spaceTest"]');
  const alts = (sfx.alternatives || []).map(a => a.pendingFile ? { label: a.label, localFile: a.pendingFile }
    : a.remoteFile ? { label: a.label, file: a.remoteFile } : null).filter(Boolean);
  if (!alts.length) { testHost.innerHTML = `<div class="hint-inline">${tr('sfxSpaceTestNoFile')}</div>`; return; }
  const previewDef = {
    id: 'spacetest-' + sfx.id, title: sfx.title || '', rrMode: sfx.rrMode,
    base: `${MEDIA_BASE}audio/sfx-${sfx.id}/`, publishedAt: Date.now(), alternatives: alts, hideSpatialView: true,
    get spatial() { return sfx.spatial; }
  };
  testHost.appendChild(window.LayerPlayerCore.buildSfxPlayer(previewDef));
}

