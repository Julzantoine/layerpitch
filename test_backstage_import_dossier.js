// Import d'un dossier de fichiers audio -> nouveau morceau en brouillon (11/10, cadrage MCP + import).
// Reprend les vrais dossiers de Jules-Antoine : « Menu / Test Layering Vertical Random » (alternatives numérotées),
// « Goute donc ma hache » (niveaux d'intensité dans les noms), « Boom Impact » (variantes d'un même son).
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'layerpitch-notify.js', 'player.js'] });
  const { window } = dom;
  const doc = window.document;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
  function change(el, value) { el.value = value; el.dispatchEvent(new window.Event('change', { bubbles: true })); }
  const q = sel => doc.querySelector(sel);
  const F = name => new window.File([new Uint8Array(8)], name, { type: 'audio/wav' });
  const lib = () => window.eval('library');

  // ---- Deviner la structure (fonction pure) ----
  const menu = ['AltPerc #1.5.wav', 'AltPerc #1.wav', 'AltPerc #2.wav', 'BS #1.wav', 'BS #2.wav', 'BS #4 (Slap).wav', 'Cocottes Gt #1.wav', 'Cocottes Gt #2.wav', 'Intro+MainPerc.wav', 'MainPerc.wav', 'Thème Gt.wav', 'Theme Kb.wav'].map(F);
  let g = window.guessFolderStructure('Menu / Test Layering Vertical Random', menu);
  check('nom de dossier « Layering Vertical Random » -> vertical-random (raison : nom)', g.mode === 'vertical-random' && g.why === 'name');
  g = window.guessFolderStructure('Menu', menu);
  check('sans indice dans le dossier : les familles numérotées -> vertical-random (raison : alternatives)', g.mode === 'vertical-random' && g.why === 'variants');
  const hache = ['#1.BattleLoop_LowIntensity_120bpm_64M.wav', '#2.BattleLoop_MedIntensity_120bpm_64M.wav', '#3.BattleLoop_HighIntensity_120bpm_64M.wav'].map(F);
  g = window.guessFolderStructure('Goute donc ma hache pour voir', hache);
  check('noms avec Low/Med/HighIntensity -> vertical (raison : intensité)', g.mode === 'vertical' && g.why === 'intensity');
  g = window.guessFolderStructure('The Last Door', ['Door_Intro_120bpm_14M.wav', 'Door Opening.wav', 'Door Chase.wav', 'Door_Outro.wav'].map(F));
  check('intro/outro, noms tous différents -> sequential', g.mode === 'sequential' && g.why === 'introOutro');
  g = window.guessFolderStructure('Divers', ['Render_03.wav', 'Final_v2.wav'].map(F));
  check('aucun indice -> vertical par défaut', g.mode === 'vertical' && g.why === 'default');
  check('« embranchement » dans le nom du dossier', window.guessFolderStructure('Test embranchement', hache).mode === 'embranchement-vertical');

  // ---- Slots du séquentiel : « #1.1 » et « #1.2 » restent dans le slot « #1 » ----
  const seq = window.groupFilesBySequentialSlot(['Door_Intro.wav', 'Door #1.1.wav', 'Door #1.2.wav', 'Door #2.wav', 'Door_Outro.wav'].map(F));
  check('intro et outro reconnues', seq.intro && seq.intro.name === 'Door_Intro.wav' && seq.outro && seq.outro.name === 'Door_Outro.wav');
  check('2 slots : « Door #1 » (2 variations) et « Door #2 »', seq.groups.length === 2 && seq.groups[0].label === 'Door #1' && seq.groups[0].files.length === 2 && seq.groups[1].label === 'Door #2');

  // ---- Visibilité : réservé au feu vert bulk_drop ----
  const host = q('#libraryFolderImport');
  check('zone d\'import masquée sans feu vert', !!host && host.hidden === true);

  // ---- Fenêtre : aucun fichier audio ----
  window.openFolderImportDialog({ name: 'Vide', files: [], ignored: [] });
  check('dossier sans audio : aucune fenêtre ouverte', !q('.vrs-batch-overlay'));

  // ---- Vertical (une couche par fichier) ----
  const before = lib().length;
  window.openFolderImportDialog({ name: 'Goute donc ma hache pour voir', files: hache, ignored: [{ name: 'V2', count: 4 }] });
  check('fenêtre de structure ouverte, proposition = vertical', !!q('.vrs-batch-overlay') && q('[data-fi="mode"]').value === 'vertical');
  check('sous-dossier ignoré signalé', q('.vrs-batch-overlay').textContent.includes('V2 (4)'));
  check('titre proposé = nom du dossier', q('[data-fi="title"]').value === 'Goute donc ma hache pour voir');
  click(q('[data-fi-btn="go"]'));
  const t1 = lib()[before];
  check('morceau créé (brouillon dans la bibliothèque), mode vertical', lib().length === before + 1 && t1.mode === 'vertical' && t1.title === 'Goute donc ma hache pour voir');
  check('3 couches, une par fichier, libellés sans tempo/mesures', t1.layers.length === 3 && t1.layers[0].label === '#1.BattleLoop LowIntensity' && t1.layers.every(l => l.pendingFile));
  check('rien d\'en ligne : fichiers en attente seulement', t1.layers.every(l => !l.remoteFile));
  check('le morceau créé est sélectionné', window.eval('manageLibrarySelectedId') === t1.id);
  const hintsOverlay = q('.vrs-batch-overlay');
  if (hintsOverlay) click(hintsOverlay.querySelector('[data-hc-btn="cancel"]'));

  // ---- Vertical-random : fenêtre des pools, puis création ----
  window.openFolderImportDialog({ name: 'Menu / Test Layering Vertical Random', files: menu, ignored: [] });
  check('proposition = vertical-random', q('[data-fi="mode"]').value === 'vertical-random');
  q('[data-fi="title"]').value = 'Menu';
  q('[data-fi="title"]').dispatchEvent(new window.Event('input', { bubbles: true }));
  const n2 = lib().length;
  click(q('[data-fi-btn="go"]'));
  check('2e fenêtre : vérification des pools, sans rien créer encore', !!q('.vrs-batch-modal [data-vbd="confirm"]') && lib().length === n2);
  click(q('[data-vbd="confirm"]'));
  const t2 = lib()[n2];
  check('morceau vertical-random créé, titre choisi', lib().length === n2 + 1 && t2.mode === 'vertical-random' && t2.title === 'Menu');
  const pools = t2.sections[0].pools;
  const poolOf = label => pools.find(p => p.label.toLowerCase() === label.toLowerCase());
  check('pools par famille : AltPerc (3), BS (3), Cocottes Gt (2)', poolOf('AltPerc') && poolOf('AltPerc').alternatives.length === 3 && poolOf('BS') && poolOf('BS').alternatives.length === 3 && poolOf('Cocottes Gt') && poolOf('Cocottes Gt').alternatives.length === 2);
  check('Intro+MainPerc posée en intro', t2.intro.pendingFile && t2.intro.pendingFile.name === 'Intro+MainPerc.wav');

  // ---- Séquentiel ----
  const seqFiles = ['Door_Intro_6M_90bpm.wav', 'Door #1.1_120bpm_16M.wav', 'Door #1.2_8M.wav', 'Door #2.wav', 'Door_Outro.wav'].map(F);
  window.openFolderImportDialog({ name: 'The Last Door', files: seqFiles, ignored: [] });
  // Des « #1.1 », « #1.2 », « #2 » du même nom ressemblent à des alternatives : le moteur propose l'aléatoire,
  // c'est au compositeur de choisir « Séquentiel » (c'est le cas ambigu, assumé).
  check('proposition = vertical-random (noms numérotés du même nom)', q('[data-fi="mode"]').value === 'vertical-random');
  change(q('[data-fi="mode"]'), 'sequential');
  const n3 = lib().length;
  click(q('[data-fi-btn="go"]'));
  check('fenêtre séquentielle : parle d\'emplacements, pas de pools', q('.vrs-batch-modal').textContent.includes('emplacement'));
  click(q('[data-vbd="confirm"]'));
  const t3 = lib()[n3];
  check('séquentiel : 2 slots, le 1er avec 2 variations (mesures lues)', t3.mode === 'sequential' && t3.segmentSlots.length === 2 && t3.segmentSlots[0].alternatives.length === 2 && t3.segmentSlots[0].alternatives.map(a => a.bars).join(',') === '16,8');
  check('tempo du slot lu dans le nom', t3.segmentSlots[0].bpm === 120);
  check('intro (6 mesures, 90 bpm) et outro posées', t3.intro.pendingFile && t3.intro.bars === 6 && t3.intro.bpm === 90 && t3.outro.pendingFile);

  // ---- Embranchement vertical ----
  window.openFolderImportDialog({ name: 'Test embranchement', files: hache, ignored: [] });
  const n4 = lib().length;
  click(q('[data-fi-btn="go"]'));
  const t4 = lib()[n4];
  check('embranchement : 3 boucles, la 1re initiale, mesures lues (64)', t4.mode === 'embranchement-vertical' && t4.loops.length === 3 && t4.loops[0].isInitial && !t4.loops[1].isInitial && t4.loops.every(l => l.bars === 64));
  const o4 = q('.vrs-batch-overlay'); if (o4) click(o4.querySelector('[data-hc-btn="cancel"]'));

  // ---- Annuler : rien n'est créé ----
  const n5 = lib().length;
  window.openFolderImportDialog({ name: 'Annulé', files: hache, ignored: [] });
  click(q('[data-fi-btn="cancel"]'));
  check('annulation : aucun morceau créé, fenêtre fermée', lib().length === n5 && !q('.vrs-batch-overlay'));

  // ---- Dépôt réel d'un dossier (entrées du système de fichiers) : racine importée, sous-dossier signalé ----
  window.eval("myFlags.bulk_drop = true");
  const fileEntry = name => ({ isFile: true, isDirectory: false, name, file: ok => ok(F(name)) });
  const dirEntry = (name, children) => ({
    isFile: false, isDirectory: true, name,
    createReader() { let done = false; return { readEntries(ok) { if (done) ok([]); else { done = true; ok(children); } } }; }
  });
  const dropped = dirEntry('Combat_v3', [fileEntry('Pads.wav'), fileEntry('Drums.wav'), fileEntry('notes.txt'), dirEntry('V2', [fileEntry('Pads.wav'), fileEntry('Drums.wav')])]);
  const folder = await window.readDroppedFolder({ items: [{ kind: 'file', webkitGetAsEntry: () => dropped }], files: [] });
  check('dossier déposé : nom, 2 fichiers audio à la racine (le .txt écarté)', folder.name === 'Combat_v3' && folder.files.length === 2);
  check('sous-dossier V2 signalé avec son nombre de fichiers', folder.ignored.length === 1 && folder.ignored[0].name === 'V2' && folder.ignored[0].count === 2);
  const loose = await window.readDroppedFolder({ items: [], files: [F('b.wav'), F('a.wav'), F('c.txt')] });
  check('fichiers en vrac : triés, sans nom de dossier', loose.name === '' && loose.files.map(f => f.name).join(',') === 'a.wav,b.wav');
  const fromInput = window.readFolderFromInput(['Sons/A.wav', 'Sons/B.mp3', 'Sons/V2/C.wav', 'Sons/readme.txt'].map(p => { const f = F(p.split('/').pop()); Object.defineProperty(f, 'webkitRelativePath', { value: p }); return f; }));
  check('sélecteur de dossier : racine = « Sons », 2 fichiers, V2 ignoré', fromInput.name === 'Sons' && fromInput.files.length === 2 && fromInput.ignored.length === 1 && fromInput.ignored[0].name === 'V2');

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
