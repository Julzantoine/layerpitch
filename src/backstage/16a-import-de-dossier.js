/* ---------------- Import d'un dossier de fichiers -> nouveau morceau (11/10, cadrage MCP) ----------------
   Le compositeur dépose (ou choisit) un dossier de fichiers audio : le moteur de lecture des noms existant
   (groupFilesByNameFamily, guessSequentialRole, parseAudioFilenameHints, openGroupedDropDialog -- 16-bibliotheque-de-morceaux.js)
   propose une structure, le compositeur confirme ou corrige, puis un NOUVEAU morceau est créé dans la bibliothèque.
   Un morceau de la bibliothèque n'est publié que par « Publier » : l'import produit donc toujours un brouillon.
   Réservé au feu vert bulk_drop (même famille que les dépôts groupés). Décisions : layerpitch-docs/decisions/2026-10-11-mcp-et-import-de-dossier.md.
   Volontairement : seuls les fichiers de la RACINE du dossier sont importés ; les sous-dossiers sont signalés, pas
   avalés (un dossier « V2 » ne doit pas doubler les couches). */
const FOLDER_IMPORT_MODES = ['vertical-random', 'vertical', 'sequential', 'embranchement-vertical'];
const FOLDER_IMPORT_AUDIO_RE = /\.(wav|mp3)$/i;
const folderImportByName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

// Structure la plus probable pour un dossier, avec la raison (affichée au compositeur). Pure : testée sans page.
// Ordre : le nom du dossier d'abord (il l'a écrit), puis l'intensité dans les noms, puis les alternatives numérotées,
// puis une intro/outro, sinon une couche par fichier.
function guessFolderStructure(folderName, files) {
  const n = nameFamilyKey(folderName || '');
  if (/embranch|branching/.test(n)) return { mode: 'embranchement-vertical', why: 'name' };
  if (/random|aleatoire/.test(n) && /vertical|layer|couche/.test(n)) return { mode: 'vertical-random', why: 'name' };
  if (/sequenti/.test(n)) return { mode: 'sequential', why: 'name' };
  if (/layer|vertical|couche/.test(n)) return { mode: 'vertical', why: 'name' };
  const intensity = files.filter(f => /(?:^|[^a-z])(?:low|med|medium|mid|high)[\s_-]?intensit|intensit/i.test(f.name)).length;
  if (files.length >= 2 && intensity >= 2) return { mode: 'vertical', why: 'intensity' };
  const g = groupFilesByNameFamily(files, true);
  if (g.groups.some(x => x.files.length >= 2)) return { mode: 'vertical-random', why: 'variants' };
  if (g.intro || g.outro) return { mode: 'sequential', why: 'introOutro' };
  return { mode: 'vertical', why: 'default' };
}
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
// Slots du séquentiel : « Door #1.1 », « Door #1.2 » forment le slot « Door #1 » (variations) ; « Door #2 » est un autre slot.
// Plus fin que la famille de noms des pools, qui réunirait « Door #1 » et « Door #2 » en un seul groupe.
function groupFilesBySequentialSlot(files) {
  let intro = null, outro = null;
  const order = [], bySlot = new Map();
  files.forEach(f => {
    const role = guessSequentialRole(f.name);
    if (role === 'intro' && !intro) { intro = f; return; }
    if (role === 'outro' && !outro) { outro = f; return; }
    const base = titleFromFilenameStrippingHints(f.name);
    const m = base.match(/^(.*\d)\s*[.,]\s*\d+$/);
    const label = m ? m[1].trim() : base;
    const key = nameFamilyKey(label);
    if (!bySlot.has(key)) { bySlot.set(key, { label, files: [] }); order.push(key); }
    bySlot.get(key).files.push(f);
  });
  return { intro, outro, groups: order.map(k => bySlot.get(k)) };
}
if (typeof window !== 'undefined') window.groupFilesBySequentialSlot = groupFilesBySequentialSlot;

function probeImportedDurations(track, pairs) { // pairs : [[objet portant .duration, fichier]]
  pairs.forEach(([obj, f]) => probeAudioDuration(f).then(dur => { obj.duration = dur; recomputeTrackDuration(track); renderLibrary(); }));
}

function importFolderAsVertical(title, files) {
  const track = newFolderImportTrack(title, 'vertical');
  files.forEach(f => track.layers.push({ id: genId(), label: titleFromFilenameStrippingHints(f.name), remoteFile: null, pendingFile: f }));
  registerImportedTrack(track, files.length);
  probeImportedDurations(track, track.layers.map((l, i) => [l, files[i]]));
  offerTrackTempoFromFilenames(track, files, true);
}
function importFolderAsEmbranchement(title, files) {
  const track = newFolderImportTrack(title, 'embranchement-vertical');
  files.forEach((f, i) => track.loops.push({
    id: genId(), label: titleFromFilenameStrippingHints(f.name), bars: parseAudioFilenameHints(f.name).bars || 8, isInitial: i === 0,
    remoteFile: null, pendingFile: f, switchQuantize: 'immediate', autoReturnEnabled: false, autoReturnValue: 4, autoReturnUnit: 'bars',
    detourMode: 'once', endLoopButtonLabel: '', isDetour: false, cutStyle: 'fade', customCutFadeSec: null, transition: null
  }));
  registerImportedTrack(track, files.length);
  probeImportedDurations(track, track.loops.map((l, i) => [l, files[i]]));
  offerTrackTempoFromFilenames(track, files, false);
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
  const noClue = guess.why === 'default';
  const state = { mode: noClue ? '' : guess.mode, title: folder.name || titleFromFilename(files[0].name) };
  const overlay = document.createElement('div');
  overlay.className = 'vrs-batch-overlay';
  const modal = document.createElement('div');
  modal.className = 'vrs-batch-modal';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const optionLabel = { 'vertical-random': 'modeOptionVerticalRandom', vertical: 'modeOptionVertical', sequential: 'modeOptionSequential', 'embranchement-vertical': 'modeOptionEmbranchementVertical' };
  const ignored = folder.ignored || [];
  modal.innerHTML = `
    <h3>${tr('importFolderTitle')}</h3>
    <div class="hint-inline">${tr('importFolderSummary', { files: files.length, folder: escapeHtml(folder.name || '…') })}</div>
    <div class="vrs-batch-body">
      <label>${tr('importFolderTitleLabel')}</label>
      <input type="text" data-fi="title" value="${escapeAttr(state.title)}">
      <label style="margin-top:12px">${tr('importFolderStructureLabel')}</label>
      <select data-fi="mode">${noClue ? `<option value="" selected>${tr('importFolderChoosePlaceholder')}</option>` : ''}${FOLDER_IMPORT_MODES.map(m => `<option value="${m}"${m === state.mode ? ' selected' : ''}>${tr(optionLabel[m])}</option>`).join('')}</select>
      <div class="hint-inline">${noClue ? tr('importFolderNoClue') : tr('importFolderGuess', { why: tr('importFolderWhy_' + guess.why) })}</div>
      ${ignored.length ? `<div class="hint-inline" style="color:#b45309;margin-top:10px">${tr('importFolderIgnored', { list: escapeHtml(ignored.map(s => `${s.name} (${s.count})`).join(', ')) })}</div>` : ''}
      <div class="hint-inline" style="margin-top:10px">${tr('importFolderDraftNote')}</div>
    </div>
    <div class="actions vrs-batch-actions">
      <button class="btn btn-small" type="button" data-fi-btn="cancel">${tr('cancel')}</button>
      <button class="btn btn-small btn-primary" type="button" data-fi-btn="go"${noClue ? ' disabled' : ''}>${tr('importFolderContinue')}</button>
    </div>`;
  modal.addEventListener('input', e => { if (e.target.dataset.fi === 'title') state.title = e.target.value; });
  modal.addEventListener('change', e => {
    if (e.target.dataset.fi !== 'mode') return;
    state.mode = e.target.value;
    modal.querySelector('[data-fi-btn="go"]').disabled = !state.mode;
  });
  modal.addEventListener('click', e => {
    const b = e.target.closest('[data-fi-btn]');
    if (!b) return;
    if (b.dataset.fiBtn === 'cancel') { close(); return; }
    if (!state.mode) return; // rien choisi : on ne devine pas à sa place
    close();
    const title = (state.title || '').trim() || tr('defaultTrackTitle');
    if (state.mode === 'vertical-random') importFolderAsVerticalRandom(title, files);
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
