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
  function setValue(el, value) { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); el.dispatchEvent(new window.Event('change', { bubbles: true })); }
  const qa = sel => [...doc.querySelectorAll(sel)];
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

  // ---- Aucun indice : pas de présélection, « Continuer » grisé jusqu'au choix ----
  window.openFolderImportDialog({ name: 'Divers', files: ['Render_03.wav', 'Final_v2.wav'].map(F), ignored: [] });
  check('aucun indice : aucune structure présélectionnée', q('[data-fi="mode"]').value === '');
  check('aucun indice : « Continuer » grisé', q('[data-fi-btn="go"]').disabled === true);
  const nNo = lib().length;
  click(q('[data-fi-btn="go"]'));
  check('clic sur « Continuer » grisé : rien créé, fenêtre toujours là', lib().length === nNo && !!q('.vrs-batch-overlay'));
  change(q('[data-fi="mode"]'), 'vertical');
  check('structure choisie : « Continuer » actif', q('[data-fi-btn="go"]').disabled === false);
  click(q('[data-fi-btn="go"]'));
  check('grille de rôles : une ligne par fichier, rien créé encore', qa('[data-rg]').length === 2 && lib().length === nNo);
  click(q('[data-rg-btn="ok"]'));
  check('morceau créé avec la structure choisie', lib().length === nNo + 1 && lib()[nNo].mode === 'vertical');
  const noClueOverlay = q('.vrs-batch-overlay'); if (noClueOverlay) click(noClueOverlay.querySelector('[data-hc-btn="cancel"]'));

  // ---- Question en langage clair : alternatives, niveaux, étapes ou boucles ? ----
  window.openFolderImportDialog({ name: 'Perc', files: ['Perc #1.wav', 'Perc #2.wav', 'Perc #3.wav'].map(F), ignored: [] });
  check('question claire : 4 réponses possibles, aucune cochée', qa('[data-fi-radio]').length === 4 && qa('[data-fi-radio]').every(r => !r.checked));
  const radioLevels = q('[data-fi-radio="vertical"]'); radioLevels.checked = true; change(radioLevels, 'vertical');
  check('« niveaux d\'intensité » règle la structure et active « Continuer »', q('[data-fi="mode"]').value === 'vertical' && q('[data-fi-btn="go"]').disabled === false);
  const radioRandom = q('[data-fi-radio="vertical-random"]'); radioRandom.checked = true; change(radioRandom, 'vertical-random');
  check('« alternatives » règle la structure sur l\'aléatoire', q('[data-fi="mode"]').value === 'vertical-random');
  click(q('[data-fi-btn="cancel"]'));
  window.openFolderImportDialog({ name: 'Menu / Test Layering Vertical Random', files: menu, ignored: [] });
  check('nom du dossier explicite : pas de question, structure présélectionnée', qa('[data-fi-radio]').length === 0 && q('[data-fi="mode"]').value === 'vertical-random');
  click(q('[data-fi-btn="cancel"]'));

  // ---- Vertical (une couche par fichier) ----
  const before = lib().length;
  window.openFolderImportDialog({ name: 'Goute donc ma hache pour voir', files: hache, ignored: [{ name: 'V2', count: 4 }] });
  check('intensité dans les noms : suggestion affichée, RIEN de présélectionné', !!q('.vrs-batch-overlay') && q('[data-fi="mode"]').value === '' && q('.vrs-batch-overlay').textContent.includes('Layering vertical additif') && !!q('[data-fi-btn="suggest"]'));
  click(q('[data-fi-btn="suggest"]'));
  check('« Choisir la suggestion » sélectionne vertical', q('[data-fi="mode"]').value === 'vertical' && q('[data-fi-btn="go"]').disabled === false);
  check('sous-dossier ignoré signalé', q('.vrs-batch-overlay').textContent.includes('V2 (4)'));
  check('titre proposé = nom du dossier', q('[data-fi="title"]').value === 'Goute donc ma hache pour voir');
  click(q('[data-fi-btn="go"]'));
  check('grille de rôles : 3 fichiers, tous en « Couche »', qa('[data-rg]').length === 3 && qa('[data-rg]').every(sel => sel.value === 'layer'));
  click(q('[data-rg-btn="ok"]'));
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
  check('noms numérotés du même nom : suggestion vertical-random, rien de présélectionné', q('[data-fi="mode"]').value === '' && q('.vrs-batch-overlay').textContent.includes('Layering vertical randomisé'));
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
  check('nom du dossier « embranchement » : structure présélectionnée', q('[data-fi="mode"]').value === 'embranchement-vertical');
  const n4 = lib().length;
  click(q('[data-fi-btn="go"]'));
  click(q('[data-rg-btn="ok"]'));
  const t4 = lib()[n4];
  check('embranchement : 3 boucles, la 1re initiale, mesures lues (64)', t4.mode === 'embranchement-vertical' && t4.loops.length === 3 && t4.loops[0].isInitial && !t4.loops[1].isInitial && t4.loops.every(l => l.bars === 64));
  const o4 = q('.vrs-batch-overlay'); if (o4) click(o4.querySelector('[data-hc-btn="cancel"]'));

  // ---- Dossier réel « Monte en l'air et pattes de velours » : 2 boucles + 2 transitions numérotées ----
  const monte = ['#1 Everything is fine_120bpm_18M_intro2M.wav', 'Transition #2.wav', 'Transition #1.wav', "#2 We've been noticed_120bpm_18M_intro2M.wav"].map(F);
  const gm = window.guessFolderStructure("Monte en l'air et pattes de velours", monte);
  check('boucles + transitions -> embranchement vertical (raison : transitions)', gm.mode === 'embranchement-vertical' && gm.why === 'transitions');
  check('« Transition » reconnue dans un nom', window.isTransitionFile('Transition #1.wav') && !window.isTransitionFile('#1 Everything is fine.wav'));
  check('mesures d\'intro lues (intro2M)', window.parseIntroBarsHint('#1 Everything is fine_120bpm_18M_intro2M.wav') === 2 && window.parseIntroBarsHint('Door_Intro_6M_90bpm.wav') === null);
  check('tempo/mesures toujours lus malgré « intro2M »', JSON.stringify(window.parseAudioFilenameHints('#1 Everything is fine_120bpm_18M_intro2M.wav')) === JSON.stringify({ bpm: 120, bars: 18 }));
  const pr = window.pairLoopsWithTransitions(monte);
  check('transition rattachée à la boucle de même numéro', pr.pairs.length === 2 && pr.pairs[0].transition.name === 'Transition #1.wav' && pr.pairs[1].transition.name === 'Transition #2.wav');
  const nM = lib().length;
  window.openFolderImportDialog({ name: "Monte en l'air et pattes de velours", files: monte, ignored: [] });
  check('Monte : suggestion embranchement, rien de présélectionné', q('[data-fi="mode"]').value === '' && q('.vrs-batch-overlay').textContent.includes('Embranchement vertical'));
  click(q('[data-fi-btn="suggest"]'));
  click(q('[data-fi-btn="go"]'));
  const rolesM = qa('[data-rg]').map(sel => sel.value).join(',');
  check('grille de rôles : « Transition » reconnue (2 boucles, 2 transitions)', qa('[data-rg]').length === 4 && rolesM.split(',').filter(r => r === 'transition').length === 2 && rolesM.split(',').filter(r => r === 'loop').length === 2);
  check('rattachement proposé par numéro : #1 -> Transition #1', qa('[data-rgx="trans"]').length === 2 && qa('[data-rgx="trans"]')[0].selectedOptions[0].textContent === 'Transition #1.wav' && lib().length === nM);
  click(q('[data-rg-btn="ok"]'));
  const tM = lib()[nM];
  check('2 boucles (la 1re initiale), 18 mesures, libellés propres', tM.mode === 'embranchement-vertical' && tM.loops.length === 2 && tM.loops[0].isInitial && tM.loops.every(l => l.bars === 18) && tM.loops[0].label === '#1 Everything is fine');
  check('transitions rattachées, fichiers en attente', tM.loops[0].transition && tM.loops[0].transition.pendingFile.name === 'Transition #1.wav' && tM.loops[1].transition.pendingFile.name === 'Transition #2.wav');
  check('2 mesures d\'intro : rebouclage après 2 x 4 temps', tM.loops.every(l => l.loopInBeat === 8));
  check('« 18M_intro2M » : boucle de la mesure 3 à la mesure 18 (temps 8 à 72)', tM.loops.every(l => l.loopInBeat === 8 && l.loopOutBeat === 72));
  const oM = q('.vrs-batch-overlay'); if (oM) click(oM.querySelector('[data-hc-btn="cancel"]'));
  // la transition peut être changée ou retirée avant de créer
  window.openFolderImportDialog({ name: 'Monte', files: monte, ignored: [] });
  click(q('[data-fi-btn="suggest"]'));
  click(q('[data-fi-btn="go"]'));
  change(qa('[data-rgx="trans"]')[1], '-1');
  click(q('[data-rg-btn="ok"]'));
  const tM2 = lib()[lib().length - 1];
  check('transition retirée dans la fenêtre : la boucle n\'en a plus', tM2.loops[0].transition && tM2.loops[1].transition === null);
  const oM2 = q('.vrs-batch-overlay'); if (oM2) click(oM2.querySelector('[data-hc-btn="cancel"]'));
  // Rôle d'un fichier changé à la main : « Transition #2 » écartée, boucle de départ = la 2e
  window.openFolderImportDialog({ name: 'Monte', files: monte, ignored: [] });
  click(q('[data-fi-btn="suggest"]'));
  click(q('[data-fi-btn="go"]'));
  const idxT2 = monte.findIndex(f => f.name === 'Transition #2.wav');
  change(qa('[data-rg]')[idxT2], 'skip');
  check('transition écartée : plus qu\'une transition proposée', qa('[data-rgx="trans"]')[0].options.length === 2);
  qa('[data-rgx="initial"]')[1].checked = true; change(qa('[data-rgx="initial"]')[1], '1');
  click(q('[data-rg-btn="ok"]'));
  const tM3 = lib()[lib().length - 1];
  check('boucle de départ choisie : la 2e', !tM3.loops[0].isInitial && tM3.loops[1].isInitial && tM3.loops[0].transition && tM3.loops[1].transition === null);
  const oM3 = q('.vrs-batch-overlay'); if (oM3) click(oM3.querySelector('[data-hc-btn="cancel"]'));
  // les transitions ne gênent pas les autres devinettes
  check('Menu reste en aléatoire (sans transition)', window.guessFolderStructure('Menu', menu).mode === 'vertical-random');

  // ---- Dépôt groupé « + Boucle » d'un embranchement existant : mêmes règles (transitions, intro2M) ----
  window.eval("myFlags.bulk_drop = true");
  click(q('#btnAddLibraryTrack'));
  const tiE = window.eval('library.length - 1');
  setValue(q(`#libraryContainer select[data-field="mode"][data-ti="${tiE}"]`), 'embranchement-vertical');
  const trackE = () => window.eval(`library[${tiE}]`);
  const resE = window.addFilesToEmbranchementLoops(trackE(), monte);
  check('dépôt groupé : 2 boucles créées, transitions rattachées par numéro', trackE().loops.length === 2 && trackE().loops[0].isInitial && trackE().loops[0].transition.pendingFile.name === 'Transition #1.wav' && trackE().loops[1].transition.pendingFile.name === 'Transition #2.wav' && resE.added.length === 2);
  check('dépôt groupé : intro2M -> rebouclage après 2 mesures, 18 mesures', trackE().loops.every(l => l.loopInBeat === 8 && l.bars === 18));
  // transition déposée plus tard seule : rattachée à la boucle de même numéro qui n'en a pas
  trackE().loops[1].transition = null;
  const lateE = window.addFilesToEmbranchementLoops(trackE(), [F('Transition #2.wav')]);
  check('transition déposée seule : rattachée à la boucle #2 sans transition', lateE.attached.length === 1 && trackE().loops[1].transition.pendingFile.name === 'Transition #2.wav' && trackE().loops.length === 2);

  // Même chose par le vrai dépôt de fichiers sur la liste des boucles
  click(q('#btnAddLibraryTrack'));
  const tiU = window.eval('library.length - 1');
  setValue(q(`#libraryContainer select[data-field="mode"][data-ti="${tiU}"]`), 'embranchement-vertical');
  const zoneU = q('#libraryContainer [data-role="modeMaster"]');
  const dtU = { files: monte, types: ['Files'] };
  const overU = new window.Event('dragover', { bubbles: true, cancelable: true }); Object.defineProperty(overU, 'dataTransfer', { value: dtU }); zoneU.dispatchEvent(overU);
  const dropU = new window.Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(dropU, 'dataTransfer', { value: dtU }); zoneU.dispatchEvent(dropU);
  const trackU = window.eval(`library[${tiU}]`);
  check('vrai dépôt sur les boucles : 2 boucles, transitions rattachées, intro2M lu', trackU.loops.length === 2 && trackU.loops[0].transition && trackU.loops[0].transition.pendingFile.name === 'Transition #1.wav' && trackU.loops[1].transition.pendingFile.name === 'Transition #2.wav' && trackU.loops[0].loopInBeat === 8);
  const oU = q('.vrs-batch-overlay'); if (oU) click(oU.querySelector('[data-hc-btn="cancel"]'));

  // Morceau vertical : la fenêtre de confirmation règle intro + fin de boucle (mesure 3 à 18)
  click(q('#btnAddLibraryTrack'));
  const tiV = window.eval('library.length - 1');
  const introFile = F('#1 Everything is fine_120bpm_18M_intro2M.wav');
  window.__introFile = introFile;
  window.eval(`offerTrackTempoFromFilenames(library[${tiV}], [window.__introFile], true)`);
  const okV = q('.vrs-batch-overlay [data-hc-btn="ok"]');
  check('morceau vertical : la fenêtre propose intro + boucle de la mesure 3 à 18', !!okV && q('.vrs-batch-overlay').textContent.includes('mesure 3 à la mesure 18'));
  if (okV) click(okV);
  const tV = window.eval(`library[${tiV}]`);
  check('morceau vertical : loopIn = 2 mesures, loopOut = mesure 18', tV.loopInBeat === 8 && tV.loopOutBeat === 72 && tV.loopEngine === 'quantized' && tV.bpm === 120);

  // Section vertical-random : même lecture (fin de boucle à la mesure 18, intro de 2 mesures)
  const secT = { id: 's', label: '', bars: 8, pools: [] };
  const trkT = { id: 't', title: 'T', mode: 'vertical-random', intro: { label: 'Intro', remoteFile: null, pendingFile: null }, outro: { label: 'Outro', remoteFile: null, pendingFile: null }, sections: [secT], layers: [], duration: 0 };
  window.eval('library.push(' + JSON.stringify(trkT) + ')');
  const trkLive = window.eval('library[library.length - 1]');
  window.applyVrsBatchDrop(trkLive, trkLive.sections[0], [], { groups: [], intro: null, outro: null, checks: {} }, { bpm: 120, bars: 18, introBars: 2 });
  check('section vertical-random : loopIn = 8 temps, loopOut = 72 (mesure 18)', trkLive.sections[0].loopInBeat === 8 && trkLive.sections[0].loopOutBeat === 72);

  // ---- Dossier réel RobotAdventure : séquentiel à embranchement, aucun indice net -> on demande ----
  const robot = ['#1_RobotAdventure_WetDarkCave_120bpm_30M.wav', '#2_RobotAdventure_Corridor_120bpm_30M.wav', '#3_RobotAdventure_BattleFinal_160bpm_40M.wav', '#1bis_SecretLever_Transition.wav'].map(F);
  const gr = window.guessFolderStructure('RobotAdventure', robot);
  check('RobotAdventure : « #1bis…Transition » n\'est pas la transition d\'une boucle -> question, pas de présélection', gr.why === 'transitionsUnclear');
  window.openFolderImportDialog({ name: 'RobotAdventure', files: robot, ignored: [] });
  check('RobotAdventure : liste sur « Choisis », « Continuer » grisé, message dédié', q('[data-fi="mode"]').value === '' && q('[data-fi-btn="go"]').disabled === true && q('.vrs-batch-overlay').textContent.includes('bifurcation'));
  click(q('[data-fi-btn="cancel"]'));
  check('« #1bis » n\'a pas le numéro 1, « Transition #1 » oui', window.folderImportNumber('#1bis_SecretLever_Transition.wav') === null && window.folderImportNumber('Transition #1.wav') === '1' && window.folderImportNumber('#2.5 X.wav') === '2.5');

  // ---- Devinette : « Transition » dans un séquentiel (intro/outro) n'en fait pas un embranchement ----
  const seqT = window.guessFolderStructure('The Last Door', ['Door_Intro.wav', '#1bis_SecretLever_Transition.wav', '#2 Door.wav', 'Door_Outro.wav'].map(F));
  check('transition + intro/outro : jamais un embranchement', seqT.mode !== 'embranchement-vertical');

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
