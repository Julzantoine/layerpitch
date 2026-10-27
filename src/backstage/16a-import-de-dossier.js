/* ---------------- Import d'un dossier de fichiers -> nouveau morceau (11/10, cadrage MCP) ----------------
   Le compositeur dépose (ou choisit) un dossier de fichiers audio : le moteur de lecture des noms existant
   (groupFilesByNameFamily, guessSequentialRole, parseAudioFilenameHints, openGroupedDropDialog -- 16-bibliotheque-de-morceaux.js)
   propose une structure, le compositeur confirme ou corrige, puis un NOUVEAU morceau est créé dans la bibliothèque.
   Un morceau de la bibliothèque n'est publié que par « Publier » : l'import produit donc toujours un brouillon.
   Réservé au feu vert bulk_drop (même famille que les dépôts groupés). Décisions : layerpitch-docs/decisions/2026-10-11-mcp-et-import-de-dossier.md.
   Volontairement : seuls les fichiers de la RACINE du dossier sont importés ; les sous-dossiers sont signalés, pas
   avalés (un dossier « V2 » ne doit pas doubler les couches). */
if (typeof window !== 'undefined') { window.isTransitionFile = isTransitionFile; window.folderImportNumber = folderImportNumber; window.pairLoopsWithTransitions = pairLoopsWithTransitions; }

if (typeof window !== 'undefined') window.guessFolderStructure = guessFolderStructure;

// ---- Lecture d'un dossier : glisser-déposer (entrées du système de fichiers) ou sélecteur de dossier ----
function folderEntryReadAll(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    (function next() {
      reader.readEntries(batch => { if (!batch.length) resolve(all); else { all.push(...batch); next(); } }, reject);
    })();
  });
}
function folderEntryFile(entry) { return new Promise((resolve, reject) => entry.file(resolve, reject)); }
async function folderEntryCountAudio(dirEntry, depth) {
  if (depth > 4) return 0;
  let n = 0;
  for (const e of await folderEntryReadAll(dirEntry.createReader())) {
    if (e.isFile && FOLDER_IMPORT_AUDIO_RE.test(e.name)) n++;
    else if (e.isDirectory) n += await folderEntryCountAudio(e, depth + 1);
  }
  return n;
}
async function readFolderEntry(dirEntry) {
  const files = [], ignored = [];
  for (const e of await folderEntryReadAll(dirEntry.createReader())) {
    if (e.isFile && FOLDER_IMPORT_AUDIO_RE.test(e.name)) files.push(await folderEntryFile(e));
    else if (e.isDirectory) { const count = await folderEntryCountAudio(e, 1); if (count) ignored.push({ name: e.name, count }); }
  }
  return { name: dirEntry.name || '', files: files.sort(folderImportByName), ignored };
}
// À appeler DANS le gestionnaire de dépôt (les entrées ne survivent pas à un await) ; renvoie une promesse.
function readDroppedFolder(dt) {
  const entries = [...(dt.items || [])]
    .map(i => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null)).filter(Boolean);
  const loose = [...(dt.files || [])].filter(f => FOLDER_IMPORT_AUDIO_RE.test(f.name));
  const dir = entries.find(e => e.isDirectory);
  if (dir) return readFolderEntry(dir);
  return Promise.resolve({ name: '', files: loose.sort(folderImportByName), ignored: [] }); // fichiers en vrac : pas de nom de dossier
}
function readFolderFromInput(fileList) {
  const all = [...fileList];
  const rootName = all.length && all[0].webkitRelativePath ? all[0].webkitRelativePath.split('/')[0] : '';
  const files = [], sub = new Map();
  all.forEach(f => {
    if (!FOLDER_IMPORT_AUDIO_RE.test(f.name)) return;
    const parts = (f.webkitRelativePath || f.name).split('/');
    if (parts.length <= 2) files.push(f); else sub.set(parts[1], (sub.get(parts[1]) || 0) + 1);
  });
  return { name: rootName, files: files.sort(folderImportByName), ignored: [...sub].map(([name, count]) => ({ name, count })) };
}

// ---- Création du morceau ----
function newFolderImportTrack(title, mode) {
  const t = { id: genId(), title, description: '', mode, duration: 0, base: '', loopable: false, startTrackBeat: 0, maxLoops: null, maxChainLoops: null, normalizeVolume: false, layers: [], stingers: [], sfxIds: [], folderId: null };
  if (mode === 'vertical-random') {
    t.intro = { label: 'Intro', bars: 8, remoteFile: null, pendingFile: null };
    t.outro = { label: 'Outro', remoteFile: null, pendingFile: null };
    t.sections = []; t.randomizeSections = false;
  }
  if (mode === 'sequential') {
    t.bpm = 120; t.beatsPerBar = 4;
    t.intro = { label: 'Intro', bars: 8, remoteFile: null, pendingFile: null };
    t.outro = { label: 'Outro', bars: 8, remoteFile: null, pendingFile: null };
    t.segmentSlots = [];
  }
  if (mode === 'embranchement-vertical') { t.bpm = 120; t.beatsPerBar = 4; t.loops = []; }
  return t;
}
function registerImportedTrack(track, fileCount) {
  library.push(track);
  manageLibrarySelectedId = track.id;
  hasUnsavedEdits = true;
  trackBackstageEvent('track_add', { via: 'folder_import', mode: track.mode, count: fileCount });
  renderLibrary();
  if (blockTracksRefresh) blockTracksRefresh(); packTracksRefreshers.forEach(fn => fn());
  window.LayerPitchNotify.info(tr('importFolderDone', { title: track.title, n: fileCount }));
}
if (typeof window !== 'undefined') window.groupFilesBySequentialSlot = groupFilesBySequentialSlot;

function probeImportedDurations(track, pairs) { // pairs : [[objet portant .duration, fichier]]
  pairs.forEach(([obj, f]) => probeAudioDuration(f).then(dur => { obj.duration = dur; recomputeTrackDuration(track); renderLibrary(); }));
}

// Grille de rôles (11/10, décision de Jules-Antoine : peu de règles tirées d'une nomenclature, le reste par questions) :
// une ligne par fichier, un menu de rôle ; ce que le nom dit explicitement (Transition, Intro, Outro) pré-remplit la ligne,
// toujours modifiable. opts : title, files, roles [{ value, label }], defaultRole(file), extraHtml(state), onRolesChanged(state),
// onExtraChange(target, state), requiredRole (au moins un fichier doit l'avoir), onConfirm(state).
function openRoleGridDialog(opts) {
  const files = opts.files;
  const state = { roles: files.map(f => opts.defaultRole(f)) };
  if (opts.onRolesChanged) opts.onRolesChanged(state);
  const overlay = document.createElement('div');
  overlay.className = 'vrs-batch-overlay';
  const modal = document.createElement('div');
  modal.className = 'vrs-batch-modal';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  function render() {
    const okEnabled = state.roles.some(r => r === opts.requiredRole);
    modal.innerHTML = `
      <h3>${escapeHtml(opts.title)}</h3>
      <div class="hint-inline">${opts.summary || ''}</div>
      <div class="vrs-batch-body">
        ${files.map((f, i) => `
          <div class="vrs-batch-file">
            <span title="${escapeAttr(f.name)}">${escapeHtml(f.name)}</span>
            <select data-rg="${i}">${opts.roles.map(r => `<option value="${r.value}"${state.roles[i] === r.value ? ' selected' : ''}>${escapeHtml(r.label)}</option>`).join('')}</select>
          </div>`).join('')}
        ${opts.extraHtml ? opts.extraHtml(state) : ''}
      </div>
      <div class="actions vrs-batch-actions">
        <button class="btn btn-small" type="button" data-rg-btn="cancel">${tr('cancel')}</button>
        <button class="btn btn-small btn-primary" type="button" data-rg-btn="ok"${okEnabled ? '' : ' disabled'}>${tr('importFolderConfirmBtn')}</button>
      </div>`;
  }
  modal.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.rg !== undefined) { state.roles[+t.dataset.rg] = t.value; if (opts.onRolesChanged) opts.onRolesChanged(state); render(); }
    else if (t.dataset.rgx !== undefined && opts.onExtraChange) { opts.onExtraChange(t, state); render(); }
  });
  modal.addEventListener('click', e => {
    const b = e.target.closest('[data-rg-btn]');
    if (!b) return;
    if (b.dataset.rgBtn === 'cancel') { close(); return; }
    if (b.disabled) return;
    close();
    opts.onConfirm(state);
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  render();
}
if (typeof window !== 'undefined') window.openRoleGridDialog = openRoleGridDialog;

// Vertical : une couche par fichier. Rien n'est supposé : chaque fichier est une couche, sauf ceux que le compositeur écarte.
// Morceau statique : l'unique fichier devient la piste ; titre, tempo et mesures lus dans son nom comme au choix d'un fichier.
function importFolderAsStatic(title, files) {
  const f = files[0];
  const track = newFolderImportTrack(title, 'static');
  const layer = { id: genId(), label: titleFromFilenameStrippingHints(f.name), remoteFile: null, pendingFile: f };
  track.layers.push(layer);
  applyStaticFileNameHints(track, f);
  registerImportedTrack(track, 1);
  probeImportedDurations(track, [[layer, f]]);
}
function importFolderAsVertical(title, files) {
  openRoleGridDialog({
    title: tr('importFolderGroupedTitle', { title }), files, requiredRole: 'layer',
    summary: tr('importFolderVerticalSummary', { files: files.length }),
    roles: [{ value: 'layer', label: tr('importFolderRoleLayer') }, { value: 'skip', label: tr('vrsBatchSkipOption') }],
    defaultRole: () => 'layer',
    onConfirm: st => {
      const chosen = files.filter((f, i) => st.roles[i] === 'layer');
      const track = newFolderImportTrack(title, 'vertical');
      chosen.forEach(f => track.layers.push({ id: genId(), label: titleFromFilenameStrippingHints(f.name), remoteFile: null, pendingFile: f }));
      registerImportedTrack(track, chosen.length);
      probeImportedDurations(track, track.layers.map((l, i) => [l, chosen[i]]));
      offerTrackTempoFromFilenames(track, chosen, true);
    }
  });
}

// Une boucle nommée d'embranchement, avec sa transition (facultative) -- partagée entre l'import de dossier et le dépôt
// groupé « + Boucle » de l'éditeur (11/10). Mesures d'intro (« intro2M ») : le rebouclage est posé après elles.
function makeEmbranchementLoop(track, file, transitionFile, isInitial) {
  const h = parseAudioFilenameHints(file.name), intro = parseIntroBarsHint(file.name);
  const loop = {
    id: genId(), label: titleFromFilenameStrippingHints(file.name), bars: h.bars || 8, isInitial: !!isInitial,
    remoteFile: null, pendingFile: file, switchQuantize: 'immediate', autoReturnEnabled: false, autoReturnValue: 4, autoReturnUnit: 'bars',
    detourMode: 'once', endLoopButtonLabel: '', isDetour: false, cutStyle: 'fade', customCutFadeSec: null,
    transition: transitionFile ? { label: titleFromFilenameStrippingHints(transitionFile.name), remoteFile: null, pendingFile: transitionFile } : null
  };
  if (intro) {
    loop.beatsPerBar = track.beatsPerBar || 4; loop.loopInBeat = intro * loop.beatsPerBar;
    // « 18M_intro2M » : 18 mesures au total, la boucle va de la mesure 3 à la mesure 18 (16 mesures).
    if (h.bars && h.bars > intro) loop.loopOutBeat = h.bars * loop.beatsPerBar;
  }
  return loop;
}
// Dépôt groupé sur les boucles d'un embranchement déjà créé : les « Transition #N » se rattachent à la boucle de même
// numéro (parmi les fichiers déposés, puis parmi les boucles existantes sans transition) ; renvoie ce qui a été fait.
function addFilesToEmbranchementLoops(track, files) {
  const loopFiles = files.filter(f => !isTransitionFile(f.name));
  const added = [], attached = [];
  let leftovers;
  if (loopFiles.length) {
    const paired = pairLoopsWithTransitions(files);
    // Les boucles déjà présentes mais sans fichier (ex. « Boucle 1 » créée avec « + Boucle ») reçoivent d'abord les
    // premiers fichiers, dans l'ordre, au lieu de rester vides pendant que le lot crée des boucles à la suite.
    const emptyLoops = track.loops.filter(l => !l.pendingFile && !l.remoteFile);
    paired.pairs.forEach((pr, i) => {
      const target = emptyLoops[i];
      const made = makeEmbranchementLoop(track, pr.loop, pr.transition, track.loops.length === 0 && added.length === 0);
      if (target) {
        // On garde l'identité de la boucle (id, rôle de référence) et on lui donne le contenu lu dans le fichier.
        const keep = { id: target.id, isInitial: target.isInitial };
        Object.keys(target).forEach(k => { delete target[k]; });
        Object.assign(target, made, keep);
        added.push({ loop: target, file: pr.loop, transition: pr.transition });
      } else {
        track.loops.push(made); added.push({ loop: made, file: pr.loop, transition: pr.transition });
      }
    });
    leftovers = paired.unassigned || [];
  } else {
    leftovers = files.filter(f => isTransitionFile(f.name)); // seulement des transitions : pour les boucles déjà là
  }
  // Transitions sans boucle déposée avec elles : rattachées aux boucles existantes sans transition, par numéro puis par ordre.
  leftovers.forEach(t => {
    const n = folderImportNumber(t.name);
    const free = track.loops.filter(l => !(l.transition && (l.transition.pendingFile || l.transition.remoteFile)));
    const target = (n && free.find(l => folderImportNumber(l.label) === n)) || free[0];
    if (!target) return;
    target.transition = { label: titleFromFilenameStrippingHints(t.name), remoteFile: null, pendingFile: t };
    attached.push({ loop: target, file: t });
  });
  return { added, attached };
}
if (typeof window !== 'undefined') window.addFilesToEmbranchementLoops = addFilesToEmbranchementLoops;
function buildEmbranchementTrack(title, pairs) {
  const track = newFolderImportTrack(title, 'embranchement-vertical');
  pairs.forEach((pr, i) => track.loops.push(makeEmbranchementLoop(track, pr.loop, pr.transition, i === 0)));
  return track;
}
function finishEmbranchementImport(track, pairs, files) {
  registerImportedTrack(track, files.length);
  probeImportedDurations(track, track.loops.map((l, i) => [l, pairs[i].loop]));
  track.loops.forEach((l, i) => { if (l.transition && pairs[i].transition) probeAudioDuration(pairs[i].transition).then(dur => { l.transition.duration = dur; renderLibrary(); }); });
  offerTrackTempoFromFilenames(track, pairs.map(p => p.loop), false);
}
// Embranchement : grille de rôles (boucle / transition / ne pas importer) ; les transitions sont rattachées par le numéro
// commun, sinon par l'ordre, et le compositeur corrige chaque rattachement et choisit la boucle de départ.
function importFolderAsEmbranchement(title, files) {
  const roleFor = f => (isTransitionFile(f.name) && files.some(x => !isTransitionFile(x.name)) ? 'transition' : 'loop');
  function recompute(st) { // rattachement par défaut, recalculé à chaque changement de rôle
    const loops = files.filter((f, i) => st.roles[i] === 'loop');
    const trans = files.filter((f, i) => st.roles[i] === 'transition');
    const paired = pairLoopsWithTransitions(loops.concat(trans).map(f => f));
    st.loops = loops; st.trans = trans;
    st.choice = loops.map(l => {
      const pr = (paired.pairs || []).find(x => x.loop === l);
      return pr && pr.transition ? trans.indexOf(pr.transition) : -1;
    });
    st.initial = 0;
  }
  const extra = st => {
    if (!st.loops.length) return '';
    return `<div class="vrs-batch-group"><div class="vrs-batch-group-head"><strong>${tr('importFolderEmbrPairsTitle')}</strong></div>
      <div class="hint-inline">${tr('importFolderEmbrPairsHint')}</div>
      ${st.loops.map((l, i) => `
        <div class="vrs-batch-file">
          <span><label style="display:inline-flex;gap:6px;align-items:center"><input type="radio" name="rgInitial" data-rgx="initial" value="${i}"${st.initial === i ? ' checked' : ''} style="width:auto;margin:0">${escapeHtml(titleFromFilenameStrippingHints(l.name))}</label></span>
          <select data-rgx="trans" data-i="${i}">
            <option value="-1"${st.choice[i] === -1 ? ' selected' : ''}>${tr('importFolderEmbrNone')}</option>
            ${st.trans.map((t, k) => `<option value="${k}"${st.choice[i] === k ? ' selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
          </select>
        </div>`).join('')}
    </div>`;
  };
  openRoleGridDialog({
    title: tr('importFolderGroupedTitle', { title }), files, requiredRole: 'loop',
    summary: tr('importFolderEmbrGridSummary', { files: files.length }),
    roles: [{ value: 'loop', label: tr('importFolderRoleLoop') }, { value: 'transition', label: tr('importFolderRoleTransition') }, { value: 'skip', label: tr('vrsBatchSkipOption') }],
    defaultRole: roleFor,
    onRolesChanged: recompute,
    extraHtml: extra,
    onExtraChange: (t, st) => {
      if (t.dataset.rgx === 'initial') st.initial = +t.value;
      else if (t.dataset.rgx === 'trans') st.choice[+t.dataset.i] = +t.value;
    },
    onConfirm: st => {
      const pairs = st.loops.map((l, i) => ({ loop: l, transition: st.choice[i] >= 0 ? st.trans[st.choice[i]] : null }));
      const track = buildEmbranchementTrack(title, pairs);
      track.loops.forEach((l, i) => { l.isInitial = i === st.initial; });
      finishEmbranchementImport(track, pairs, st.loops.concat(pairs.map(p => p.transition).filter(Boolean)));
    }
  });
}

function importFolderAsVerticalRandom(title, files) {
  const guess = groupFilesByNameFamily(files, true);
  const found = firstFilenameHints(files);
  openGroupedDropDialog({
    files, groupKind: 'pool', withIntroOutro: true, withSilent: true,
    title: tr('importFolderGroupedTitle', { title }),
    groups: guess.groups, intro: guess.intro, outro: guess.outro,
    checks: found ? [{ id: 'hints', checked: true, text: tr('vrsBatchApplyHintsLabel', { hints: hintsText(found.hints), file: escapeHtml(found.file.name) }) }] : [],
    confirmLabel: tr('importFolderConfirmBtn'),
    onConfirm: res => {
      const track = newFolderImportTrack(title, 'vertical-random');
      const section = { id: genId(), label: '', bars: 8, pools: [] };
      track.sections.push(section);
      registerImportedTrack(track, files.length);
      applyVrsBatchDrop(track, section, files, res, res.checks.hints && found ? found.hints : null);
    }
  });
}
function importFolderAsSequential(title, files) {
  const guess = groupFilesBySequentialSlot(files);
  const found = firstFilenameHints(files);
  openGroupedDropDialog({
    files, groupKind: 'pool', withIntroOutro: true, withSilent: false,
    labels: { summary: 'importFolderSlotsSummary', option: 'importFolderSlotOption', fallback: 'importFolderSlotFallback', empty: 'importFolderSlotEmpty', placeholder: 'slotNamePlaceholder', addGroup: 'addSegmentSlotBtn' },
    title: tr('importFolderGroupedTitle', { title }),
    groups: guess.groups, intro: guess.intro, outro: guess.outro,
    checks: found && found.hints.bpm ? [{ id: 'hints', checked: true, text: tr('hintsConfirmTrackBpm', { bpm: found.hints.bpm, file: escapeHtml(found.file.name) }) }] : [],
    confirmLabel: tr('importFolderConfirmBtn'),
    onConfirm: res => {
      const track = newFolderImportTrack(title, 'sequential');
      const touched = [];
      res.groups.forEach(g => {
        const slot = { id: genId(), label: g.label, avoidImmediateRepeat: true, alternatives: [] };
        g.files.forEach(f => {
          const h = parseAudioFilenameHints(f.name);
          if (h.bpm && !slot.bpm) slot.bpm = h.bpm;
          slot.alternatives.push({ label: titleFromFilenameStrippingHints(f.name), bars: h.bars || 8, remoteFile: null, pendingFile: f });
          touched.push(f);
        });
        track.segmentSlots.push(slot);
      });
      if (res.intro) {
        const h = parseAudioFilenameHints(res.intro.name);
        track.intro.pendingFile = res.intro; track.intro.label = titleFromFilenameStrippingHints(res.intro.name);
        if (h.bars) track.intro.bars = h.bars;
        if (h.bpm) track.intro.bpm = h.bpm;
        touched.push(res.intro);
      }
      if (res.outro) { track.outro.pendingFile = res.outro; track.outro.label = titleFromFilenameStrippingHints(res.outro.name); touched.push(res.outro); }
      if (res.checks.hints && found && found.hints.bpm) track.bpm = found.hints.bpm;
      registerImportedTrack(track, files.length);
      Promise.all(touched.map(probeAudioDuration)).then(durs => {
        const maxDur = Math.max(0, ...durs);
        if (maxDur > (track.duration || 0)) { track.duration = maxDur; renderLibrary(); }
      });
    }
  });
}

// Fenêtre 1 : titre + structure (proposition pré-sélectionnée, avec sa raison). Aucune écriture avant « Continuer ».
function openFolderImportDialog(folder) {
  const files = folder.files || [];
  if (!files.length) { window.LayerPitchNotify.info(tr('importFolderNoAudio')); return; }
  const guess = guessFolderStructure(folder.name, files);
  // Aucun indice dans les noms (why = 'default') : pas de présélection, la structure doit être choisie (11/10, retour de
  // Jules-Antoine : « le moteur croit toujours que c'est du layering »). Le défaut vertical n'est qu'un repli interne.
  // Décision du 11/10 : on ne présélectionne QUE si le nom du dossier le dit ; toute autre devinette est une suggestion
  // affichée, que le compositeur accepte d'un clic (chaque compositeur nomme ses fichiers à sa manière).
  const noClue = guess.why !== 'name';
  const state = { mode: noClue ? '' : guess.mode, title: folder.name || titleFromFilename(files[0].name) };
  const overlay = document.createElement('div');
  overlay.className = 'vrs-batch-overlay';
  const modal = document.createElement('div');
  modal.className = 'vrs-batch-modal';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const optionLabel = { static: 'modeOptionStatic', 'vertical-random': 'modeOptionVerticalRandom', vertical: 'modeOptionVertical', sequential: 'modeOptionSequential', 'embranchement-vertical': 'modeOptionEmbranchementVertical' };
  const ignored = folder.ignored || [];
  modal.innerHTML = `
    <h3>${tr('importFolderTitle')}</h3>
    <div class="hint-inline">${tr('importFolderSummary', { files: files.length, folder: escapeHtml(folder.name || '…') })}</div>
    <div class="vrs-batch-body">
      <label>${tr('importFolderTitleLabel')}</label>
      <input type="text" data-fi="title" value="${escapeAttr(state.title)}">
      <label style="margin-top:12px">${tr('importFolderStructureLabel')}</label>
      <select data-fi="mode">${noClue ? `<option value="" selected>${tr('importFolderChoosePlaceholder')}</option>` : ''}${(files.length === 1 ? ['static', ...FOLDER_IMPORT_MODES] : FOLDER_IMPORT_MODES).map(m => `<option value="${m}"${m === state.mode ? ' selected' : ''}>${tr(optionLabel[m])}</option>`).join('')}</select>
      <div class="hint-inline">${!noClue ? tr('importFolderGuess', { why: tr('importFolderWhy_name') })
        : (guess.why === 'default' ? tr('importFolderNoClue')
        : (guess.why === 'transitionsUnclear' ? tr('importFolderNoClueTransition')
        : tr('importFolderSuggestion', { mode: tr(optionLabel[guess.mode]), why: tr('importFolderWhy_' + guess.why) })))}
        ${noClue && guess.why !== 'default' && guess.why !== 'transitionsUnclear' ? `<button class="btn btn-small" type="button" data-fi-btn="suggest" style="margin-left:6px">${tr('importFolderUseSuggestion')}</button>` : ''}</div>
      ${noClue ? `
        <div class="vrs-batch-group" style="margin-top:12px">
          <div class="vrs-batch-group-head"><strong>${tr('importFolderWhatAreTheyTitle')}</strong></div>
          ${[['vertical-random', 'importFolderWhatRandom'], ['vertical', 'importFolderWhatLevels'], ['sequential', 'importFolderWhatSteps'], ['embranchement-vertical', 'importFolderWhatLoops']].map(([m, k]) => `
            <label class="vrs-batch-check"><input type="radio" name="fiWhat" data-fi-radio="${m}" style="width:auto;margin:0"><span>${tr(k)}</span></label>`).join('')}
        </div>` : ''}
      ${ignored.length ? `<div class="hint-inline" style="color:#b45309;margin-top:10px">${tr('importFolderIgnored', { list: escapeHtml(ignored.map(s => `${s.name} (${s.count})`).join(', ')) })}</div>` : ''}
      <div class="hint-inline" style="margin-top:10px">${tr('importFolderDraftNote')}</div>
    </div>
    <div class="actions vrs-batch-actions">
      <button class="btn btn-small" type="button" data-fi-btn="cancel">${tr('cancel')}</button>
      <button class="btn btn-small btn-primary" type="button" data-fi-btn="go"${noClue ? ' disabled' : ''}>${tr('importFolderContinue')}</button>
    </div>`;
  modal.addEventListener('input', e => { if (e.target.dataset.fi === 'title') state.title = e.target.value; });
  modal.addEventListener('change', e => {
    if (e.target.dataset.fiRadio) { // réponse en langage clair : règle la structure (et la liste ci-dessus)
      state.mode = e.target.dataset.fiRadio;
      modal.querySelector('[data-fi="mode"]').value = state.mode;
      modal.querySelector('[data-fi-btn="go"]').disabled = false;
      return;
    }
    if (e.target.dataset.fi !== 'mode') return;
    state.mode = e.target.value;
    modal.querySelectorAll('[data-fi-radio]').forEach(r => { r.checked = r.dataset.fiRadio === state.mode; });
    modal.querySelector('[data-fi-btn="go"]').disabled = !state.mode;
  });
  modal.addEventListener('click', e => {
    const b = e.target.closest('[data-fi-btn]');
    if (!b) return;
    if (b.dataset.fiBtn === 'cancel') { close(); return; }
    if (b.dataset.fiBtn === 'suggest') {
      state.mode = guess.mode;
      modal.querySelector('[data-fi="mode"]').value = guess.mode;
      modal.querySelector('[data-fi-btn="go"]').disabled = false;
      return;
    }
    if (!state.mode) return; // rien choisi : on ne devine pas à sa place
    close();
    const title = (state.title || '').trim() || tr('defaultTrackTitle');
    if (state.mode === 'static') importFolderAsStatic(title, files);
    else if (state.mode === 'vertical-random') importFolderAsVerticalRandom(title, files);
    else if (state.mode === 'sequential') importFolderAsSequential(title, files);
    else if (state.mode === 'embranchement-vertical') importFolderAsEmbranchement(title, files);
    else importFolderAsVertical(title, files);
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}
if (typeof window !== 'undefined') window.openFolderImportDialog = openFolderImportDialog;

(function wireFolderImport() {
  const btn = document.getElementById('btnImportFolder');
  const input = document.getElementById('importFolderInput');
  const zone = document.getElementById('libraryFolderDrop');
  if (!btn || !input || !zone) return;
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { const folder = readFolderFromInput(input.files); input.value = ''; openFolderImportDialog(folder); });
  zone.addEventListener('dragover', e => {
    if (![...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files')) return;
    e.preventDefault(); zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation(); // jamais d'ouverture du fichier par le navigateur
    zone.classList.remove('drag-over');
    if (!flagOpen('bulk_drop')) return;
    readDroppedFolder(e.dataTransfer).then(openFolderImportDialog)
      .catch(err => window.LayerPitchNotify.error(tr('importFolderReadError', { error: err && err.message ? err.message : String(err) })));
  });
})();
