/* ---------------- Bibliothèque de morceaux ---------------- */
// Lecture des noms de fichiers : moteur partagé (layerpitch-import-engine.js, chargé avant ce script ; phase 1 du MCP, 27/10).
// Il ne se modifie QUE là-bas -- le serveur MCP lira exactement le même fichier.
const {
  titleFromFilename, parseAudioFilenameHints, parseIntroBarsHint, titleFromFilenameStrippingHints, guessSequentialRole,
  nameFamilyKey, stripVariantSuffix, stripVariantSuffixLoose, groupFilesByNameFamily, firstFilenameHints,
  isTransitionFile, folderImportNumber, pairLoopsWithTransitions, guessFolderStructure, groupFilesBySequentialSlot,
  FOLDER_IMPORT_MODES, FOLDER_IMPORT_AUDIO_RE, folderImportByName,
} = window.LayerPitchImportEngine;
if (typeof window !== 'undefined') window.parseAudioFilenameHints = parseAudioFilenameHints;
// Choix d'un fichier un par un (bouton « Choisir un WAV »), qui ne lisait pas le nom alors que le dépôt groupé le lisait (21/10).
// Variation d'un emplacement séquentiel : mesures lues dans le nom ; tempo repris pour l'emplacement seulement s'il n'en a pas
// encore (même règle que le dépôt groupé, addFilesToSeqSlot).
function applySeqAltFileNameHints(slot, alt, file) {
  const h = parseAudioFilenameHints(file.name);
  if (h.bars) alt.bars = h.bars;
  if (h.bpm && !slot.bpm) slot.bpm = h.bpm;
}
// Transition d'un embranchement séquentiel : mesures et tempo lus dans le nom, unité « mesures » posée pour que le tempo propre
// de la transition compte. Un tempo déjà saisi à la main n'est jamais écrasé ; sans jeton dans le nom, rien ne change.
function applySeqTransitionFileNameHints(transition, file) {
  const h = parseAudioFilenameHints(file.name);
  if (h.bars) { transition.bars = h.bars; if (!transition.durationUnit) transition.durationUnit = 'bars'; }
  if (h.bpm && !transition.bpm) { transition.bpm = h.bpm; if (!transition.durationUnit) transition.durationUnit = 'bars'; }
}
if (typeof window !== 'undefined') { window.applySeqAltFileNameHints = applySeqAltFileNameHints; window.applySeqTransitionFileNameHints = applySeqTransitionFileNameHints; }
if (typeof window !== 'undefined') window.parseIntroBarsHint = parseIntroBarsHint;
// Morceau statique (08/10) : le fichier déposé donne le titre (sans le jeton « 120bpm »), le tempo et la longueur en mesures --
// même nomenclature que le dépôt groupé du séquentiel (parseAudioFilenameHints). Un titre déjà saisi n'est jamais écrasé.
function applyStaticFileNameHints(track, file) {
  const hints = parseAudioFilenameHints(file.name);
  if (hints.bpm) track.bpm = hints.bpm;
  // Longueur en mesures lue dans le nom (« _30M ») : le repère de sortie de la boucle se place à la fin de ces mesures
  // (comme dans les dépôts groupés). La queue du fichier au-delà reste la queue de résonance. Sans effet tant que le
  // moteur n'est pas « Quantifié » : la timeline lit ce repère dès qu'on le choisit.
  if (hints.bars) track.loopOutBeat = (track.loopInBeat || 0) + hints.bars * (track.beatsPerBar || 4);
  if (!track.title || !track.title.trim() || track.title === tr('defaultTrackTitle')) track.title = titleFromFilenameStrippingHints(file.name);
}
// Section d'un morceau « couches aléatoires » (08/10) : le tempo est lu dans le nom du premier fichier qui en porte un, comme
// pour le morceau statique. Appliqué seulement si la section n'avait encore aucun fichier (sinon on ne touche pas au
// calage de pools déjà en place). Renvoie le tempo appliqué, ou null.
function applySectionTempoFromFileNames(section, files, sectionHadFiles) {
  if (sectionHadFiles) return null;
  const found = (files || []).map(f => parseAudioFilenameHints(f.name)).find(h => h.bpm);
  if (!found) return null;
  section.bpm = found.bpm;
  if (!section.beatsPerBar) section.beatsPerBar = 4;
  return found.bpm;
}
function sectionHasAnyFile(section) {
  return (section.pools || []).some(p => (p.alternatives || []).some(a => a.pendingFile || a.remoteFile));
}

// ---- Dépôts du mode séquentiel (25/09) : partagés entre les zones de dépôt du détail (sélecteur de fichier de
// l'intro/outro, "Dépôt groupé du slot") et les entrées de la liste de gauche (Intro, #1 Slot 1, Outro), sur
// lesquelles on peut lâcher les fichiers directement.
// Intro/outro : un seul fichier ; mesures (intro) et tempo repris du nom quand il en porte.
function setSeqStageFile(track, stage, f) {
  const st = track[stage];
  const h = parseAudioFilenameHints(f.name);
  st.pendingFile = f;
  if (stage === 'intro') {
    if (h.bars) st.bars = h.bars;
    if (h.bpm) { st.bpm = h.bpm; st.timingOwn = true; } // tempo lu dans le nom : désormais pris en compte à la lecture
    if (!track.title || !track.title.trim() || track.title === tr('defaultTrackTitle')) track.title = titleFromFilename(f.name);
  }
  hasUnsavedEdits = true;
  renderLibrary();
  probeAudioDuration(f).then(dur => { if (dur > (track.duration || 0)) { track.duration = dur; renderLibrary(); } });
}
// Slot : chaque fichier devient une variation. Slot encore sans aucun fichier : ses variations vides (celle
// créée par "+ Slot") sont des attentes de fichier, remplacées par le dépôt plutôt que laissées en silence parasite.
function addFilesToSeqSlot(track, ti, si, files) {
  const slot = track.segmentSlots[si];
  const hasFile = a => !!(a.pendingFile || a.remoteFile);
  if (!slot.alternatives.some(hasFile)) slot.alternatives = [];
  files.forEach(f => {
    const h = parseAudioFilenameHints(f.name);
    if (h.bpm && !slot.bpm) slot.bpm = h.bpm; // tempo du slot repris du premier nom qui en porte un
    slot.alternatives.push({ label: titleFromFilenameStrippingHints(f.name), bars: h.bars || 8, remoteFile: null, pendingFile: f });
  });
  // Slot sans nom : nommé d'après le 1er fichier, sans son numéro de variation ("Door #1.2" -> "Door #1",
  // pour que les slots #1 et #2 restent distincts ; "Hit 3" -> "Hit").
  if (!slot.label || !slot.label.trim()) {
    const base = titleFromFilenameStrippingHints(files[0].name);
    const m = base.match(/^(.*\d)\s*[.,]\s*\d+$/);
    slot.label = m ? m[1].trim() : stripVariantSuffix(base);
  }
  expandedAltPoolKeys.add(`slotpool:${ti}:${si}`); // montre les variations qu'on vient d'ajouter
  hasUnsavedEdits = true;
  renderLibrary();
  Promise.all(files.map(probeAudioDuration)).then(durs => {
    const maxDur = Math.max(0, ...durs);
    if (maxDur > (track.duration || 0)) { track.duration = maxDur; renderLibrary(); }
  });
}

if (typeof window !== 'undefined') window.groupFilesByNameFamily = groupFilesByNameFamily;
function hintsText(h) {
  return h ? [h.bpm ? h.bpm + ' BPM' : '', h.bars ? tr('vrsBatchBarsN', { n: h.bars }) : '', h.introBars ? tr('importFolderEmbrIntro', { n: h.introBars }) : ''].filter(Boolean).join(', ') : '';
}

if (typeof window !== 'undefined') window.firstFilenameHints = firstFilenameHints;
// Fenêtre modale commune. opts :
//   files, title, groups [{ label, files }], intro/outro (fichier ou null), introTaken/outroTaken,
//   withIntroOutro, withSilent, groupKind ('pool' | 'sfx'), confirmLabel,
//   checks [{ id, text, checked, note }] -- cases à cocher libres (ex. tempo/mesures repérés),
//   onConfirm({ groups: [{ label, silent, files }], intro, outro, checks: { id: bool } })
function openGroupedDropDialog(opts) {
  const files = opts.files;
  const groups = opts.groups.map(g => ({ id: genId(), label: g.label, silent: false }));
  const dest = new Map(); // fichier -> 'intro' | 'outro' | 'skip' | id de groupe
  if (opts.intro) dest.set(opts.intro, 'intro');
  if (opts.outro) dest.set(opts.outro, 'outro');
  opts.groups.forEach((g, i) => g.files.forEach(f => dest.set(f, groups[i].id)));
  const checks = {};
  (opts.checks || []).forEach(c => { checks[c.id] = !!c.checked; });
  let silentAll = false;
  const isSfx = opts.groupKind === 'sfx';
  // Libellés propres à l'appelant (11/10, import de dossier : un « slot » du séquentiel n'est pas un « pool ») ;
  // par défaut, ceux des pools / des Sfx comme avant.
  const L = Object.assign({
    summary: isSfx ? 'batchSfxSummary' : 'vrsBatchSummary',
    option: isSfx ? 'batchSfxOption' : 'vrsBatchPoolOption',
    fallback: isSfx ? 'sfxFallback' : 'vrsBatchPoolFallback',
    empty: isSfx ? 'batchSfxEmptyGroup' : 'vrsBatchEmptyGroup',
    placeholder: isSfx ? 'batchSfxNamePlaceholder' : 'poolNamePlaceholder',
    addGroup: isSfx ? 'addSfx' : 'addPoolBtn'
  }, opts.labels || {});

  const overlay = document.createElement('div');
  overlay.className = 'vrs-batch-overlay';
  const modal = document.createElement('div');
  modal.className = 'vrs-batch-modal';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();

  const groupName = (g, i) => g.label || tr(L.fallback, { n: i + 1 });
  function destOptionsHtml(cur) {
    const opt = (v, label) => `<option value="${v}"${cur === v ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    return (opts.withIntroOutro ? opt('intro', tr('introShortLabel')) + opt('outro', tr('outroShortLabel')) : '')
      + groups.map((g, i) => opt(g.id, tr(L.option, { name: groupName(g, i) }))).join('')
      + opt('skip', tr('vrsBatchSkipOption'));
  }
  const filesFor = key => files.filter(f => dest.get(f) === key);
  function fileRowsHtml(key) {
    const list = filesFor(key);
    if (!list.length) return `<div class="hint-inline">${tr(L.empty)}</div>`;
    return list.map(f => `
      <div class="vrs-batch-file">
        <span title="${escapeAttr(f.name)}">${escapeHtml(f.name)}</span>
        <select data-vbd-file="${files.indexOf(f)}">${destOptionsHtml(key)}</select>
      </div>`).join('');
  }
  // Tempo/mesures de l'intro lus dans son nom : appliqués à l'intro seule (ils la concernent sans ambiguïté),
  // mais affichés ici pour que rien ne change sans que le compositeur l'ait vu.
  function introHintText() {
    const f = filesFor('intro')[0];
    return f ? hintsText(parseAudioFilenameHints(f.name)) : '';
  }
  function fixedGroupHtml(key, title, taken, extra) {
    if (!filesFor(key).length) return '';
    return `
      <div class="vrs-batch-group">
        <div class="vrs-batch-group-head"><strong>${title}</strong>${taken ? `<span class="hint-inline">${tr('vrsBatchReplacesCurrent')}</span>` : ''}${extra || ''}</div>
        ${fileRowsHtml(key)}
      </div>`;
  }
  function render() {
    const filled = groups.filter(g => filesFor(g.id).length);
    const tooMany = filesFor('intro').length > 1 || filesFor('outro').length > 1;
    const introHints = introHintText();
    modal.innerHTML = `
      <h3>${escapeHtml(opts.title)}</h3>
      <div class="hint-inline">${tr(L.summary, { files: files.length, pools: filled.length })}</div>
      <div class="vrs-batch-body">
        ${opts.withSilent ? `
          <label class="vrs-batch-check vrs-batch-silent-all">
            <input type="checkbox" data-vbd="silentAll"${silentAll ? ' checked' : ''}>
            <span>${tr('vrsBatchSilentAllLabel')}</span>
          </label>
          <div class="hint-inline">${tr('vrsBatchSilentHint')}</div>` : ''}
        ${(opts.checks || []).map(c => `
          <label class="vrs-batch-check">
            <input type="checkbox" data-vbd-check="${c.id}"${checks[c.id] ? ' checked' : ''}>
            <span>${c.text}</span>
          </label>
          ${c.note ? `<div class="hint-inline">${c.note}</div>` : ''}`).join('')}
        ${fixedGroupHtml('intro', tr('introShortLabel'), opts.introTaken, introHints ? `<span class="hint-inline">${tr('vrsBatchIntroHints', { hints: introHints })}</span>` : '')}
        ${groups.map(g => `
          <div class="vrs-batch-group">
            <div class="vrs-batch-group-head">
              <input type="text" data-vbd-group-label="${g.id}" value="${escapeAttr(g.label)}" placeholder="${tr(L.placeholder)}">
              ${opts.withSilent ? `<label class="vrs-batch-check"><input type="checkbox" data-vbd-group-silent="${g.id}"${g.silent ? ' checked' : ''}><span>${tr('vrsBatchSilentPoolLabel')}</span></label>` : ''}
            </div>
            ${fileRowsHtml(g.id)}
          </div>`).join('')}
        ${fixedGroupHtml('outro', tr('outroShortLabel'), opts.outroTaken)}
        ${filesFor('skip').length ? `
          <div class="vrs-batch-group">
            <div class="vrs-batch-group-head"><strong>${tr('vrsBatchSkippedLabel')}</strong></div>
            ${fileRowsHtml('skip')}
          </div>` : ''}
        <div class="actions"><button class="btn btn-small" type="button" data-vbd="addGroup">${tr(L.addGroup)}</button></div>
      </div>
      ${tooMany ? `<div class="hint-inline" style="color:#b45309">${tr('vrsBatchTooManyIntroOutro')}</div>` : ''}
      <div class="actions vrs-batch-actions">
        <button class="btn btn-small" type="button" data-vbd="cancel">${tr('cancel')}</button>
        <button class="btn btn-small btn-primary" type="button" data-vbd="confirm"${tooMany || !files.some(f => dest.get(f) !== 'skip') ? ' disabled' : ''}>${opts.confirmLabel}</button>
      </div>
    `;
  }
  modal.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.vbdFile !== undefined) { dest.set(files[+t.dataset.vbdFile], t.value); render(); }
    else if (t.dataset.vbd === 'silentAll') { silentAll = t.checked; groups.forEach(g => { g.silent = silentAll; }); render(); }
    else if (t.dataset.vbdCheck) checks[t.dataset.vbdCheck] = t.checked;
    else if (t.dataset.vbdGroupSilent) { const g = groups.find(x => x.id === t.dataset.vbdGroupSilent); if (g) g.silent = t.checked; }
    else if (t.dataset.vbdGroupLabel) render(); // met à jour les noms dans les menus déroulants
  });
  modal.addEventListener('input', e => {
    const id = e.target.dataset.vbdGroupLabel;
    if (id) { const g = groups.find(x => x.id === id); if (g) g.label = e.target.value; }
  });
  modal.addEventListener('click', e => {
    const a = e.target.closest('[data-vbd]');
    if (!a || a.tagName === 'INPUT') return;
    if (a.dataset.vbd === 'cancel') close();
    else if (a.dataset.vbd === 'addGroup') { groups.push({ id: genId(), label: '', silent: silentAll }); render(); }
    else if (a.dataset.vbd === 'confirm') {
      close();
      opts.onConfirm({
        groups: groups.map(g => ({ label: (g.label || '').trim(), silent: !!g.silent, files: filesFor(g.id) })).filter(g => g.files.length),
        intro: filesFor('intro')[0] || null,
        outro: filesFor('outro')[0] || null,
        checks
      });
    }
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  render();
}

// Petite fenêtre de confirmation seule (sans regroupement) : tempo/mesures repérés lors d'un dépôt groupé
// dans les modes Vertical et Vertical branching. checks : [{ id, text, checked }] ; onConfirm({ id: bool }).
function openHintsConfirmDialog(title, checks, onConfirm) {
  const state = {};
  checks.forEach(c => { state[c.id] = c.checked !== false; });
  const overlay = document.createElement('div');
  overlay.className = 'vrs-batch-overlay';
  overlay.innerHTML = `
    <div class="vrs-batch-modal">
      <h3>${escapeHtml(title)}</h3>
      <div class="hint-inline">${tr('hintsConfirmSub')}</div>
      <div class="vrs-batch-body">
        ${checks.map(c => `<label class="vrs-batch-check"><input type="checkbox" data-hc="${c.id}"${state[c.id] ? ' checked' : ''}><span>${c.text}</span></label>`).join('')}
      </div>
      <div class="actions vrs-batch-actions">
        <button class="btn btn-small" type="button" data-hc-btn="cancel">${tr('hintsConfirmSkip')}</button>
        <button class="btn btn-small btn-primary" type="button" data-hc-btn="ok">${tr('hintsConfirmApply')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('change', e => { if (e.target.dataset.hc) state[e.target.dataset.hc] = e.target.checked; });
  overlay.addEventListener('click', e => {
    const b = e.target.closest('[data-hc-btn]');
    if (e.target === overlay || (b && b.dataset.hcBtn === 'cancel')) { overlay.remove(); return; }
    if (b && b.dataset.hcBtn === 'ok') { overlay.remove(); onConfirm(state); }
  });
}

// -- Pools d'une section vertical-random --
function openVrsBatchDropDialog(track, section, files) {
  const guess = groupFilesByNameFamily(files, true);
  // Tempo/mesures repérés dans un nom ("Main Perc_120BPM_16M.wav") : proposés pour la section, cochés
  // d'office seulement si la section n'a encore aucun fichier (on n'écrase pas un réglage déjà fait).
  const sectionHasFile = (section.pools || []).some(p => (p.alternatives || []).some(a => a.pendingFile || a.remoteFile));
  const found = firstFilenameHints(files);
  openGroupedDropDialog({
    files, groupKind: 'pool', withIntroOutro: true, withSilent: true,
    title: tr('vrsBatchTitle', { section: section.label || tr('untitledFallback') }),
    groups: guess.groups, intro: guess.intro, outro: guess.outro,
    introTaken: !!(track.intro && (track.intro.pendingFile || track.intro.remoteFile)),
    outroTaken: !!(track.outro && (track.outro.pendingFile || track.outro.remoteFile)),
    checks: found ? [{
      id: 'hints', checked: !sectionHasFile,
      text: tr('vrsBatchApplyHintsLabel', { hints: hintsText(found.hints), file: escapeHtml(found.file.name) }),
      note: sectionHasFile ? tr('vrsBatchHintsSectionHasFiles') : ''
    }] : [],
    confirmLabel: tr('vrsBatchConfirmBtn'),
    onConfirm: res => applyVrsBatchDrop(track, section, files, res, res.checks.hints ? found.hints : null)
  });
}

function applyVrsBatchDrop(track, section, files, res, hints) {
  const hasFile = a => !!(a.pendingFile || a.remoteFile);
  if (!section.pools) section.pools = [];
  // Pools "vierges" laissés par la création de la section (+ Section / + Pool : sans nom ni fichier) --
  // retirés pour ne pas laisser un pool fantôme à côté de ceux qu'on crée. Aucun fichier distant en jeu.
  section.pools = section.pools.filter(p => (p.label || '').trim() || (p.alternatives || []).some(hasFile));
  const touched = [];
  res.groups.forEach(g => {
    let target = g.label ? section.pools.find(sp => nameFamilyKey(sp.label) === nameFamilyKey(g.label)) : null;
    if (target) {
      if (!target.alternatives) target.alternatives = [];
      // Pool nommé à l'avance mais encore sans aucun fichier : ses emplacements vides d'origine sont des
      // attentes de fichier, pas des silences voulus -- remplacés par les fichiers déposés.
      if (!target.alternatives.some(hasFile)) target.alternatives = [];
    } else {
      target = { id: genId(), label: g.label, avoidImmediateRepeat: true, alternatives: [] };
      section.pools.push(target);
    }
    g.files.forEach(f => target.alternatives.push({ label: titleFromFilenameStrippingHints(f.name), remoteFile: null, pendingFile: f }));
    if (g.silent && !target.alternatives.some(a => !hasFile(a))) target.alternatives.push({ label: tr('vrsSilentAltLabel'), remoteFile: null, pendingFile: null });
    touched.push(...g.files);
  });
  if (res.intro) {
    const h = parseAudioFilenameHints(res.intro.name);
    track.intro.pendingFile = res.intro;
    track.intro.label = titleFromFilenameStrippingHints(res.intro.name);
    if (h.bars) track.intro.bars = h.bars;
    if (h.bpm) track.intro.bpm = h.bpm;
  }
  if (res.outro) {
    track.outro.pendingFile = res.outro;
    track.outro.label = titleFromFilenameStrippingHints(res.outro.name);
  }
  if (hints) {
    if (hints.bpm) section.bpm = hints.bpm;
    if (hints.introBars) section.loopInBeat = hints.introBars * (section.beatsPerBar || 4); // « intro2M » : rebouclage après l'intro
    // Avec une intro (« 18M_intro2M ») : « 18 » est la mesure de fin de boucle, intro comprise.
    if (hints.bars) section.loopOutBeat = (hints.introBars && hints.bars > hints.introBars ? 0 : (section.loopInBeat || 0)) + hints.bars * (section.beatsPerBar || 4);
  }
  hasUnsavedEdits = true;
  if ((!track.title || !track.title.trim() || track.title === tr('defaultTrackTitle')) && files[0]) track.title = titleFromFilename(files[0].name);
  renderLibrary();
  Promise.all(touched.map(probeAudioDuration)).then(durs => {
    const maxDur = Math.max(0, ...durs);
    if (maxDur > (section.duration || 0)) { section.duration = maxDur; renderLibrary(); }
    if (maxDur > (track.duration || 0)) track.duration = maxDur;
  });
  [res.intro, res.outro].filter(Boolean).forEach(f => probeAudioDuration(f).then(dur => { if (dur > (track.duration || 0)) { track.duration = dur; renderLibrary(); } }));
}

// -- Bibliothèque Sfx : un Sfx par famille de noms, ses fichiers en variations round-robin --
// Un Sfx déjà présent avec le même titre est complété plutôt que dupliqué.
// Un seul fichier déposé : un Sfx simple (une variation), sans fenêtre de vérification -- ou ajouté au Sfx du même nom.
function addSimpleSfxFromFile(file) {
  const guess = groupFilesByNameFamily([file], false).groups[0];
  const title = (guess && guess.label) || titleFromFilename(file.name);
  let sfx = sfxLibrary.find(s => nameFamilyKey(s.title) === nameFamilyKey(title));
  if (!sfx) {
    sfx = { id: genId(), title, descriptionFr: '', descriptionEn: '', rrMode: 'random', duckMainTrack: false, alternatives: [], folderId: null };
    sfxLibrary.push(sfx);
  }
  sfx.alternatives.push({ label: titleFromFilename(file.name), remoteFile: null, pendingFile: file });
  manageSfxSelectedId = sfx.id; sfxSelectedEntry.set(sfx.id, 'variations');
  hasUnsavedEdits = true;
  trackBackstageEvent('sfx_batch_add', { count: 1 });
  renderSfxLibrary();
}
function openSfxBatchDropDialog(files) {
  const guess = groupFilesByNameFamily(files, false);
  openGroupedDropDialog({
    files, groupKind: 'sfx', withIntroOutro: false, withSilent: false,
    title: tr('batchSfxTitle'), groups: guess.groups,
    confirmLabel: tr('batchSfxConfirmBtn'),
    onConfirm: res => {
      let lastId = null;
      res.groups.forEach((g, i) => {
        const title = g.label || tr('sfxFallback', { n: sfxLibrary.length + 1 });
        let sfx = sfxLibrary.find(s => nameFamilyKey(s.title) === nameFamilyKey(title));
        if (!sfx) {
          sfx = { id: genId(), title, descriptionFr: '', descriptionEn: '', rrMode: 'random', duckMainTrack: false, alternatives: [], folderId: null };
          sfxLibrary.push(sfx);
        }
        g.files.forEach(f => sfx.alternatives.push({ label: titleFromFilename(f.name), remoteFile: null, pendingFile: f }));
        lastId = sfx.id;
      });
      if (lastId) { manageSfxSelectedId = lastId; sfxSelectedEntry.set(lastId, 'variations'); }
      hasUnsavedEdits = true;
      trackBackstageEvent('sfx_batch_add', { count: res.groups.length });
      renderSfxLibrary();
    }
  });
}

// -- Modes Vertical (couches) et Vertical branching : tempo/mesures repérés dans les noms déposés --
// Réglages du MORCEAU entier (pas d'un seul fichier) : toujours soumis à confirmation. Admin seulement
// tant que Jules-Antoine n'a pas donné son feu vert.
function offerTrackTempoFromFilenames(track, files, withLoopBars) {
  if (!flagOpen('bulk_drop')) return;
  const found = firstFilenameHints(files, true);
  if (!found) return;
  const h = found.hints;
  const checks = [];
  if (h.bpm && h.bpm !== track.bpm) checks.push({ id: 'bpm', text: tr('hintsConfirmTrackBpm', { bpm: h.bpm, file: escapeHtml(found.file.name) }) });
  if (withLoopBars && h.introBars) checks.push({ id: 'intro', text: tr('hintsConfirmTrackIntroBars', { n: h.introBars, file: escapeHtml(found.file.name) }) });
  // Avec une intro (« 18M_intro2M ») : 18 = la mesure où la boucle se termine, intro comprise -> boucle de la mesure 3 à la 18.
  if (withLoopBars && h.bars) checks.push({ id: 'bars', text: h.introBars && h.bars > h.introBars
    ? tr('hintsConfirmTrackLoopSpan', { from: h.introBars + 1, to: h.bars, len: h.bars - h.introBars, file: escapeHtml(found.file.name) })
    : tr('hintsConfirmTrackLoopBars', { n: h.bars, file: escapeHtml(found.file.name) }) });
  if (!checks.length) return;
  openHintsConfirmDialog(tr('hintsConfirmTitle'), checks, state => {
    if (state.bpm) { track.bpm = h.bpm; if (!track.beatsPerBar) track.beatsPerBar = 4; }
    if (state.intro) {
      track.loopEngine = 'quantized';
      if (!track.beatsPerBar) track.beatsPerBar = 4;
      track.loopInBeat = h.introBars * track.beatsPerBar; // les mesures d'intro ne rebouclent pas
    }
    if (state.bars) {
      track.loopEngine = 'quantized';
      if (!track.beatsPerBar) track.beatsPerBar = 4;
      // Avec intro : « NM » est une position absolue (fin de la boucle) ; sans intro : longueur de la boucle.
      track.loopOutBeat = (h.introBars && h.bars > h.introBars ? 0 : (track.loopInBeat || 0)) + h.bars * track.beatsPerBar;
    }
    hasUnsavedEdits = true;
    renderLibrary();
  });
}

function buildPreviewTrack(track) {
  if (track.mode === 'hybrid-sequential') {
    return {
      id: track.id, title: track.title, description: track.description, tags: track.tags || '', mode: track.mode, duration: 0, base: track.base, layers: [], sfxIds: [],
      sections: (track.sections || []).map(sec => {
        const source = library.find(l => l.id === sec.trackId);
        return { id: sec.id, label: sec.label, trackId: sec.trackId, maxLoops: sec.maxLoops, track: source ? buildPreviewTrack(source) : null };
      })
    };
  }
  const mapItem = (item) => {
    if (!item) return null;
    // fx (chantier "effets dynamiques", 22/09) : porté ici plutôt que dans un mapper dédié aux couches,
    // pour que l'aperçu local reflète les effets même si un futur type d'item (intro/outro...) en gagne un
    // jour -- absence du champ chez tous les autres types aujourd'hui, donc sans effet ailleurs.
    if (item.pendingFile) return { label: item.label, localFile: item.pendingFile, fx: item.fx || null };
    if (item.remoteFile) return { label: item.label, file: item.remoteFile, gain: item.gain || 1, fx: item.fx || null };
    return null;
  };
  // Pour les alternatives d'un groupe : un slot vide reste un choix possible du tirage (silence),
  // il ne doit JAMAIS être filtré du pool — sinon la taille du pool et les probabilités changent.
  const mapAlternative = (item) => {
    if (item && item.pendingFile) return { label: item.label || '', localFile: item.pendingFile, volumeDb: item.volumeDb || 0 };
    if (item && item.remoteFile) return { label: item.label || '', file: item.remoteFile, gain: item.gain || 1, volumeDb: item.volumeDb || 0 };
    return { label: (item && item.label) || '', file: null };
  };
  // Comme mapItem, mais conserve le nombre de mesures (intro/segments du mode séquentiel) ET le texte de
  // présentation optionnel (descriptionFr/descriptionEn, affiché pendant que l'élément est audible, voir
  // player.js : pickStageDescription()). Partagé par l'intro (directement) et les fichiers de transition
  // (via mapTransition ci-dessous) : les deux ont ce même besoin.
  const mapBlockWithBars = (item) => {
    const m = mapItem(item);
    if (!m) return null;
    const out = { ...m, bars: (item && item.bars) || 8, descriptionFr: (item && item.descriptionFr) || '', descriptionEn: (item && item.descriptionEn) || '' };
    // Tempo propre (intro du vertical-random, 25/09) -- seulement s'il a été réglé, sinon le lecteur suit la
    // première section.
    if (item && item.bpm) out.bpm = item.bpm;
    if (item && item.beatsPerBar) out.beatsPerBar = item.beatsPerBar;
    // Drapeau posé par l'éditeur d'intro (séquentiel) : sans lui, le lecteur ignore bpm/beatsPerBar de l'intro.
    if (item && item.timingOwn) out.timingOwn = true;
    return out;
  };
  // Comme mapAlternative (ne filtre jamais un slot vide), mais conserve aussi le nombre de mesures —
  // pour les alternatives d'un emplacement séquentiel.
  const mapAlternativeWithBars = (item) => ({ ...mapAlternative(item), bars: (item && item.bars) || 8 });
  // Comme mapBlockWithBars, mais ajoute les champs de durée explicite propres au fichier de transition
  // (durationUnit/bpm/beatsPerBar en mode mesures, durationSeconds en mode secondes). Fonction dédiée
  // plutôt qu'ajout générique à mapBlockWithBars : ces champs n'ont pas de sens pour l'intro, qui
  // réutilise aussi mapBlockWithBars.
  const mapTransition = (item) => {
    const m = mapBlockWithBars(item);
    if (!m) return null;
    return { ...m, durationUnit: (item && item.durationUnit) || null, bpm: item && item.bpm, beatsPerBar: item && item.beatsPerBar, durationSeconds: item && item.durationSeconds };
  };
  return {
    id: 'preview-' + track.id,
    title: track.title || tr('previewFallbackTitle'),
    description: track.description || '',
    tags: track.tags || '',
    mode: track.mode,
    loopable: track.loopable,
    loopEngine: track.loopEngine,
    bpm: track.bpm,
    beatsPerBar: track.beatsPerBar,
    loopInBeat: track.loopInBeat,
    loopOutBeat: track.loopOutBeat,
    startTrackBeat: track.startTrackBeat || 0,
    maxLoops: (track.maxLoops !== undefined && track.maxLoops !== null) ? track.maxLoops : null,
    maxChainLoops: (track.maxChainLoops !== undefined && track.maxChainLoops !== null) ? track.maxChainLoops : null,
    noAiOverride: (track.noAiOverride === true || track.noAiOverride === false) ? track.noAiOverride : null,
    duration: track.duration || 0,
    base: `${MEDIA_BASE}audio/${track.id}/`,
    publishedAt: Date.now(), // aperçu local : toujours frais à chaque clic sur "Écouter", pas besoin d'attendre une publication pour retrouver la bonne version
    // Carte globale des chemins (02/09, mode séquentiel à embranchement uniquement -- sans effet sur les
    // autres modes) : le compositeur n'a évidemment "déjà joué" aucun emplacement en train de construire sa
    // piste -- sa prévisualisation affiche donc la structure complète telle que configurée (outil de
    // vérification de son propre travail), contrairement à la révélation progressive du lecteur public.
    seqMapFullReveal: true,
    // fx de morceau entier (pitch "vitesse", 22/09) -- distinct de layers[].fx/loops[].fx/etc., voir
    // applyTrackPitchRate() dans player.js.
    fx: track.fx || null,
    fxTriggers: (track.fxTriggers || []).map(x => ({ id: x.id, label: x.label || '', target: x.target, fx: x.fx || {}, visible: !!x.visible, fadeSec: x.fadeSec != null ? x.fadeSec : null, fadeOutSec: x.fadeOutSec != null ? x.fadeOutSec : null, relations: fxRelationsClean(x.relations), steps: fxStepsClean(x.steps), showEffects: x.showEffects !== false, targets: Array.isArray(x.targets) && x.targets.length ? x.targets.map(t => Object.assign({}, t)) : undefined })),
    fxSliders: fxSlidersClean(track.fxSliders),
    layers: (track.layers || []).map(mapItem).filter(Boolean),
    intro: mapBlockWithBars(track.intro),
    // L'outro n'a pas de "bars" (mapItem, pas mapBlockWithBars — pas de durée programmée après elle, elle
    // joue jusqu'à sa fin naturelle) mais gagne le même texte de présentation optionnel que l'intro/la
    // transition, ajouté à la main ici plutôt que de la faire passer par mapBlockWithBars pour ne pas lui
    // donner un champ "bars" qui ne servirait jamais.
    outro: (() => { const m = mapItem(track.outro); return m ? { ...m, descriptionFr: (track.outro && track.outro.descriptionFr) || '', descriptionEn: (track.outro && track.outro.descriptionEn) || '' } : null; })(),
    segmentSlots: (track.segmentSlots || []).map(sl => ({
      id: sl.id, label: sl.label, avoidImmediateRepeat: sl.avoidImmediateRepeat,
      referencesSlotId: sl.referencesSlotId || null, repeatCount: sl.repeatCount || 1,
      quantization: sl.quantization || 'bar', cutStyle: sl.cutStyle || 'fade', customCutFadeSec: sl.customCutFadeSec,
      bpm: sl.bpm, beatsPerBar: sl.beatsPerBar,
      descriptionFr: sl.descriptionFr || '', descriptionEn: sl.descriptionEn || '',
      nextOptions: sl.nextOptions ? sl.nextOptions.map(opt => ({ targetId: opt.targetId, label: opt.label || '', transition: opt.transition ? mapTransition(opt.transition) : null, fxActions: opt.fxActions || null })) : null,
      alternatives: (sl.alternatives || []).map(mapAlternativeWithBars),
      fx: sl.fx || null
    })),
    // Une entrée par boucle déclarée, y compris sans fichier — l'index doit rester aligné avec celui
    // utilisé par les boutons nommés du lecteur (data-loop-idx), contrairement à `layers` ci-dessus qui,
    // lui, filtre les entrées vides (le vertical classique n'a pas cette contrainte d'alignement par id).
    // 24/08 : mapping complété -- ne portait jusqu'ici QUE id/label/bars/isInitial/fichier/gain, aucun des
    // champs ajoutés lors des sessions précédentes (timing de bascule quantifié, minuteur de retour, mode
    // détour, points de boucle) ni de ceux ajoutés dans cette session (classification explicite, tempo
    // propre, fondu de coupure, transition) -- l'aperçu local "Écouter" ne reflétait donc aucun de ces
    // réglages jusqu'à présent. Repli sur les valeurs de track.bpm/track.beatsPerBar uniquement quand la
    // boucle n'a pas les siennes propres, même logique que côté player.js (slotTiming()).
    loops: (track.loops || []).map(l => {
      const m = mapItem(l) || {};
      return {
        id: l.id, label: l.label || '', bars: l.bars || 8, isInitial: !!l.isInitial,
        localFile: m.localFile || null, file: m.file || null, gain: m.gain,
        switchQuantize: l.switchQuantize || 'immediate',
        autoReturnEnabled: !!l.autoReturnEnabled, autoReturnValue: l.autoReturnValue || 4, autoReturnUnit: l.autoReturnUnit || 'bars',
        detourMode: l.detourMode || 'once', endLoopButtonLabel: l.endLoopButtonLabel || '',
        startTrackBeat: l.startTrackBeat || 0, loopInBeat: l.loopInBeat || 0, loopOutBeat: l.loopOutBeat || null,
        duration: l.duration || 0,
        isDetour: !!l.isDetour, bpm: l.bpm || null, beatsPerBar: l.beatsPerBar || null,
        cutStyle: l.cutStyle || 'fade', customCutFadeSec: l.customCutFadeSec,
        // Champs de durée (durationUnit/bars/durationBeats/durationSeconds/bpm/beatsPerBar) manquaient ici
        // (05/09, retour direct : "j'ai réglé la durée de la transition sur 1 temps, mais ça va jusqu'au bout
        // du fichier" -- reproduit uniquement dans l'aperçu "Écouter" du Backstage, pas sur la page publique,
        // qui lit directement le data.json publié où ces champs sont bien présents) -- mapItem() ne renvoie
        // que label/localFile/file/gain, jamais la configuration de durée. Sans eux, embrTransitionDurationSecFor()
        // (player.js) ne reconnaît aucun `durationUnit` et retombe systématiquement sur la durée totale du
        // fichier, quel que soit le réglage choisi dans le formulaire. Même correction déjà faite le 24/08
        // pour le chargement/restauration (voir plus bas dans ce fichier), jamais reportée ici pour l'aperçu.
        transition: l.transition ? {
          label: l.transition.label || '', durationUnit: l.transition.durationUnit || null,
          bars: l.transition.bars, durationBeats: l.transition.durationBeats, durationSeconds: l.transition.durationSeconds,
          bpm: l.transition.bpm, beatsPerBar: l.transition.beatsPerBar,
          ...mapItem(l.transition)
        } : null,
        fx: l.fx || null,
        fxActions: l.fxActions || null
      };
    }),
    // Vertical-random (fusionné avec l'ex-"vertical random séquentiel" le 30/07) : le moteur de lecture
    // (player.js) ne sait pas encore l'interpréter dans ce nouveau format (chantier suivant) — la structure
    // est déjà correctement transmise en prévision de ce chantier.
    randomizeSections: !!track.randomizeSections,
    sections: (track.sections || []).map(sec => ({
      id: sec.id, label: sec.label, referencesSectionId: sec.referencesSectionId || null,
      bpm: sec.bpm || 120, beatsPerBar: sec.beatsPerBar || 4, startTrackBeat: sec.startTrackBeat || 0,
      loopInBeat: sec.loopInBeat || 0, loopOutBeat: sec.loopOutBeat || 16,
      maxLoops: (sec.maxLoops !== undefined && sec.maxLoops !== null) ? sec.maxLoops : null,
      pools: (sec.pools || []).map(p => ({
        id: p.id, label: p.label, avoidImmediateRepeat: p.avoidImmediateRepeat,
        alternatives: (p.alternatives || []).map(mapAlternative),
        fx: p.fx || null
      }))
    })),
    sfxIds: track.sfxIds || []
  };
}

function togglePreview(ti, cardEl) {
  const host = cardEl.querySelector('[data-role="previewHost"]');
  if (host.dataset.active === '1') {
    const previewId = host.dataset.previewId;
    if (previewId) { document.dispatchEvent(new CustomEvent('stop-track', { detail: previewId })); activePreviewIds.delete(previewId); }
    host.innerHTML = '';
    host.dataset.active = '0';
    return;
  }
  const track = library[ti];
  const hasFile = f => !!(f && (f.pendingFile || f.remoteFile));
  let hasAnyFile;
  if (track.mode === 'hybrid-sequential') {
    hasAnyFile = (track.sections || []).some(sec => { const s = library.find(l => l.id === sec.trackId); return s && (s.layers || []).some(hasFile); });
  } else if (track.mode === 'vertical-random') {
    hasAnyFile = hasFile(track.intro) || hasFile(track.outro) || (track.sections || []).some(sec => (sec.pools || []).some(p => (p.alternatives || []).some(hasFile)));
  } else if (track.mode === 'sequential') {
    hasAnyFile = hasFile(track.intro) || hasFile(track.outro) || (track.segmentSlots || []).some(sl => (sl.alternatives || []).some(hasFile));
  } else if (track.mode === 'embranchement-vertical') {
    hasAnyFile = (track.loops || []).some(hasFile);
  } else {
    hasAnyFile = (track.layers || []).some(hasFile);
  }
  if (!hasAnyFile) {
    window.LayerPitchNotify.info(tr('chooseFileBeforeListenAlert'));
    return;
  }
  const previewTrack = buildPreviewTrack(track);
  // Aperçu « vivant » : les réglages d'effet modifiés pendant l'écoute s'appliquent sans relance (événement preview-fx-live, voir le lecteur).
  host._previewGen = (host._previewGen || 0) + 1;
  previewTrack.__previewLive = true;
  previewTrack.__previewGen = host._previewGen;
  // Bibliothèque Sfx locale pour cette prévisualisation : mêmes fichiers en attente que dans l'éditeur
  // (localFile), pas besoin d'avoir déjà publié pour tester le bouton Sfx d'un morceau.
  const previewSfxById = {};
  sfxLibrary.forEach(sfx => {
    previewSfxById[sfx.id] = {
      id: sfx.id, title: sfx.title, rrMode: sfx.rrMode, spatial: sfx.spatial || null,
      base: `${MEDIA_BASE}audio/sfx-${sfx.id}/`,
      publishedAt: Date.now(),
      alternatives: (sfx.alternatives || []).map(a => a.pendingFile ? { label: a.label, localFile: a.pendingFile }
        : a.remoteFile ? { label: a.label, file: a.remoteFile } : null).filter(Boolean)
    };
  });
  window.LayerPlayerCore.setSfxLibrary(previewSfxById);
  const row = buildTrackRow(previewTrack, null, noAiCertifiedGlobal);
  host.innerHTML = '';
  host.appendChild(row);
  initTrackPlayer(previewTrack, row);
  host.dataset.active = '1';
  host.dataset.previewId = previewTrack.id;
  activePreviewIds.add(previewTrack.id);
  const titleToggle = row.querySelector('[data-role="titleToggle"]');
  if (titleToggle) titleToggle.click(); // déplie directement la vue pour aller droit à l'écoute
  // Lecture automatique (12/10) : « Prévisualiser » suffit, plus besoin de rappuyer sur Lecture. Le bouton Lecture est grisé le temps
  // du chargement des fichiers : on lance la lecture dès qu'il s'active. L'audio est débloqué tout de suite (le clic sur « Prévisualiser »
  // est le geste de l'utilisateur ; certains navigateurs refusent de démarrer un son après une longue attente sans cela). Si
  // l'aperçu est refermé ou remplacé entre-temps, ou si le chargement échoue, rien ne démarre.
  const previewPlayBtn = row.querySelector('[data-role="playBtn"]');
  try { if (window.LayerPlayerCore && window.LayerPlayerCore.resumeAudio) window.LayerPlayerCore.resumeAudio(); } catch (e) { /* le bouton Lecture reste disponible */ }
  if (previewPlayBtn) {
    // Numéro de lancement (22/10) : l'identifiant de l'aperçu est le même à chaque relance ; sans ce numéro, le minuteur d'une relance
    // précédente (aperçu relancé à chaque clic sur la flèche d'un champ) cliquait encore sur SON bouton Lecture -> lectures superposées.
    const gen = host._previewGen;
    let waited = 0;
    const autoplayTimer = setInterval(() => {
      waited += 120;
      if (host.dataset.active !== '1' || host.dataset.previewId !== previewTrack.id || host._previewGen !== gen) { clearInterval(autoplayTimer); return; }
      if (!previewPlayBtn.disabled) { clearInterval(autoplayTimer); previewPlayBtn.click(); }
      else if (waited > 120000) clearInterval(autoplayTimer);
    }, 120);
  }
}

const activePreviewIds = new Set();

