/* ---------------- Visite guidée et leçons guidées du Backstage (08/10) ---------------- */
// Un seul moteur de bulles, deux usages : le tour du propriétaire (étapes manuelles : « Suivant ») et les leçons (étapes
// qui avancent toutes seules quand l'apprenant fait le geste demandé). Feu vert « in_app_tour » (visite) et « in_app_lessons » (leçons), admin seulement pour
// l'instant. Menu « Tutoriel » (leçons) dans la barre du haut, à côté de la cloche et du compte : feu vert séparé « in_app_lessons ».
const TOUR_DONE_STORAGE = 'layerpitch_tour_done_v1';
const LESSONS_DONE_STORAGE = 'layerpitch_lessons_done_v1';
const TOUR_STEPS = [
  { titleKey: 'tourWelcomeTitle', textKey: 'tourWelcomeText' },
  { selector: '.nav-item[data-tab="library"]', titleKey: 'tourLibraryTitle', textKey: 'tourLibraryText' },
  { selector: '.nav-item[data-tab="content"]', titleKey: 'tourContentTitle', textKey: 'tourContentText' },
  { selector: '.nav-item[data-tab="appearance"]', titleKey: 'tourAppearanceTitle', textKey: 'tourAppearanceText' },
  { selector: '.nav-item[data-tab="packs"]', titleKey: 'tourPacksTitle', textKey: 'tourPacksText' },
  { selector: '#btnPublish', titleKey: 'tourPublishTitle', textKey: 'tourPublishText' },
  { selector: '#btnAccountMenu', titleKey: 'tourAccountTitle', textKey: 'tourAccountText' },
];

// Morceau en cours d'édition dans la Bibliothèque musicale (celui sélectionné dans la liste).
function lessonSection() { const t = lessonTrack(); return (t && t.sections && t.sections[0]) || null; }
function lessonPoolFiles(i) { const sec = lessonSection(); const p = sec && sec.pools && sec.pools[i]; return p ? (p.alternatives || []).filter(a => a.pendingFile || a.remoteFile).length : 0; }
// Point d'accès unique aux leçons : aujourd'hui le feu vert « in_app_lessons ». Une future version publique (mode démo,
// sans compte) n'aura qu'à répondre « oui » ici, sans toucher aux leçons.
function lessonsAccessOpen() { return flagOpen('in_app_lessons'); }
function lessonHasFile(x) { return !!(x && (x.pendingFile || x.remoteFile)); }
function lessonSlotFileCount(i) { const t = lessonTrack(); const sl = t && t.segmentSlots && t.segmentSlots[i]; return sl ? (sl.alternatives || []).filter(lessonHasFile).length : 0; }
function lessonSlot(i) { const t = lessonTrack(); return (t && t.segmentSlots && t.segmentSlots[i]) || null; }
function lessonLoopFileCount() { const t = lessonTrack(); return t ? (t.loops || []).filter(lessonHasFile).length : 0; }
function lessonFolderDialogOpen() { return !!document.querySelector('.vrs-batch-modal [data-fi="mode"]'); }
function lessonDialogText() { const m = document.querySelector('.vrs-batch-modal'); return m ? m.textContent : ''; }
function lessonTrack() { return (typeof library !== 'undefined' && library.find(t => t.id === manageLibrarySelectedId)) || null; }
// Fichiers d'exemple de chaque leçon : null tant qu'ils n'existent pas (la bulle dit alors « bientôt disponible »).
const LESSON_SAMPLE_FILES = { static: null, additive: null, random: null, sequential: null, branching: null, embranchement: null, import: null };
// Nom du fichier d'exemple cité dans la consigne de dépôt (il porte le tempo : ambiance_120bpm).
// (additive : noms provisoires, à remplacer par ceux des vrais fichiers).
const LESSON_SAMPLE_NAMES = {
  static: 'ambiance_120bpm.wav',
  additive: 'couche-calme_120bpm.wav, couche-rythme_120bpm.wav, couche-intense_120bpm.wav',
  randomFixed: 'couche-fixe_120bpm.wav',
  randomVariants: 'variante-1_120bpm.wav, variante-2_120bpm.wav, variante-3_120bpm.wav',
  seqIntro: 'intro_120bpm.wav',
  seqA: 'segment-a1_120bpm.wav, segment-a2_120bpm.wav',
  seqB: 'segment-b1_120bpm.wav, segment-b2_120bpm.wav',
  seqOutro: 'outro_120bpm.wav',
  seqC: 'segment-c1_120bpm.wav, segment-c2_120bpm.wav',
  embrLoops: 'boucle-calme_120bpm_16M.wav, boucle-combat_120bpm_16M.wav',
  embrDetour: 'detour_120bpm_4M.wav',
  import: 'Tuto séquentiel',
};
// done(ctx) : true quand le geste est fait -> la leçon avance seule. clickDone : un clic sur la cible suffit.
// Sans done ni clickDone : étape manuelle (« Suivant »). enter(ctx) : photographie l'état à l'arrivée sur l'étape.
const LESSONS = [
  { id: 'static', titleKey: 'lessonStaticTitle', descKey: 'lessonStaticDesc', steps: [
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lsLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    { selector: '#btnAddLibraryTrack', titleKey: 'lsAddTitle', textKey: 'lsAddText',
      enter: (c) => { c.baseLen = library.length; }, done: (c) => library.length > c.baseLen },
    { selector: '#libraryDetail select[data-field="mode"]', titleKey: 'lsModeTitle', textKey: 'lsModeText',
      done: () => { const t = lessonTrack(); return !!t && t.mode === 'static'; } },
    { selector: '#libraryDetail [data-role="staticFileCtrl"]', titleKey: 'lsFileTitle', textKey: 'lsFileText', sampleKey: 'static',
      done: () => { const t = lessonTrack(); const l = t && t.layers && t.layers[0]; return !!(l && (l.pendingFile || l.remoteFile)); } },
    { selector: '#libraryDetail input[data-field="loopable"]', titleKey: 'lsLoopTitle', textKey: 'lsLoopText',
      done: () => { const t = lessonTrack(); return !!t && !!t.loopable; } },
    // Le fichier d'exemple n'est pas préparé pour boucler seul : la leçon exige « Quantifié » (required : pas de « Passer
    // l'étape », elle n'avance que lorsque c'est fait). Le tempo et les points de boucle n'existent qu'en Quantifié.
    { selector: '#libraryDetail select[data-field="loopEngine"]', titleKey: 'lsEngineTitle', textKey: 'lsEngineText', required: true,
      done: () => { const t = lessonTrack(); return !!t && t.loopEngine === 'quantized'; } },
    { selector: '#libraryDetail input[data-field="bpm"]', titleKey: 'lsVerifyTitle', textKey: 'lsVerifyText' },
    { selector: '#libraryDetail [data-role="loopTimelineHost"]', titleKey: 'lsPointsTitle', textKey: 'lsPointsText' },
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'lsListenTitle', textKey: 'lsListenText', clickDone: true },
    { selector: '#btnPublish', titleKey: 'lsSaveTitle', textKey: 'lsSaveText', clickDone: true },
    { titleKey: 'lsEndTitle', textKey: 'lsEndText', final: true },
  ] },
  { id: 'additive', titleKey: 'lessonAdditiveTitle', descKey: 'lessonAdditiveDesc', steps: [
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lsLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    { selector: '#btnAddLibraryTrack', titleKey: 'lsAddTitle', textKey: 'lsAddText',
      enter: (c) => { c.baseLen = library.length; }, done: (c) => library.length > c.baseLen },
    // Un nouveau morceau est déjà en « vertical » : étape de lecture (« Suivant »), pas de geste à détecter.
    { selector: '#libraryDetail select[data-field="mode"]', titleKey: 'laModeTitle', textKey: 'laModeText' },
    { selector: '#libraryDetail [data-role="modeMaster"]', titleKey: 'laDropTitle', textKey: 'laDropText', sampleKey: 'additive',
      done: () => { const t = lessonTrack(); return !!t && (t.layers || []).filter(l => l.pendingFile || l.remoteFile).length >= 2; } },
    { selector: '#libraryDetail [data-role="modeMaster"]', titleKey: 'laCheckTitle', textKey: 'laCheckText' },
    { selector: '#libraryDetail select[data-field="loopEngine"]', titleKey: 'laEngineTitle', textKey: 'laEngineText', required: true,
      done: () => { const t = lessonTrack(); return !!t && t.loopEngine === 'quantized'; } },
    { selector: '#libraryDetail [data-role="loopTimelineHost"]', titleKey: 'laPointsTitle', textKey: 'laPointsText' },
    // Le pilotage de l'intensité se règle AVANT l'écoute : boutons nommés (par défaut), ou curseur à seuils (RTPC).
    { selector: '#libraryDetail [data-role="modeMaster"]', titleKey: 'laButtonsTitle', textKey: 'laButtonsText' },
    { selector: '#libraryDetail [data-role="fxSlidersHost"]', titleKey: 'laSliderTitle', textKey: 'laSliderText',
      skip: () => !fxOpen('rtpc') }, // curseurs : feu vert « rtpc » (admin seulement pour l'instant)
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'laListenTitle', textKey: 'laListenText', clickDone: true },
    { selector: '#libraryDetail [data-role="previewHost"]', titleKey: 'laIntensityTitle', textKey: 'laIntensityText' },
    { selector: '#btnPublish', titleKey: 'lsSaveTitle', textKey: 'lsSaveText', clickDone: true },
    { titleKey: 'laEndTitle', textKey: 'laEndText', final: true },
  ] },
  { id: 'random', titleKey: 'lessonRandomTitle', descKey: 'lessonRandomDesc', steps: [
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lsLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    { selector: '#btnAddLibraryTrack', titleKey: 'lsAddTitle', textKey: 'lsAddText',
      enter: (c) => { c.baseLen = library.length; }, done: (c) => library.length > c.baseLen },
    { selector: '#libraryDetail select[data-field="mode"]', titleKey: 'lrModeTitle', textKey: 'lrModeText',
      done: () => { const t = lessonTrack(); return !!t && t.mode === 'vertical-random'; } },
    { selector: '#libraryDetail [data-action="add-section"]', titleKey: 'lrSectionTitle', textKey: 'lrSectionText',
      done: () => { const t = lessonTrack(); return !!t && (t.sections || []).length >= 1; } },
    // Une nouvelle section naît avec un premier pool vide : il sert de couche fixe (un seul fichier, joué à chaque passage).
    { selector: '#libraryDetail [data-role="vrsPools"] > .list-block:nth-child(1)', titleKey: 'lrFixedTitle', textKey: 'lrFixedText', sampleKey: 'random', names: 'randomFixed',
      done: () => lessonPoolFiles(0) >= 1 },
    { selector: '#libraryDetail [data-action="add-pool"]', titleKey: 'lrPoolTitle', textKey: 'lrPoolText',
      done: () => { const s2 = lessonSection(); return !!s2 && (s2.pools || []).length >= 2; } },
    { selector: '#libraryDetail [data-role="vrsPools"] > .list-block:nth-child(2)', titleKey: 'lrVariantsTitle', textKey: 'lrVariantsText', names: 'randomVariants',
      done: () => lessonPoolFiles(1) >= 2 },
    { selector: '#libraryDetail [data-role="vrsPools"]', titleKey: 'lrCheckTitle', textKey: 'lrCheckText' },
    { selector: '#libraryDetail input[data-section-field="bpm"]', titleKey: 'lrBpmTitle', textKey: 'lrBpmText' },
    { selector: '#libraryDetail [data-role="loopTimelineHost"]', titleKey: 'lrPointsTitle', textKey: 'lrPointsText' },
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'lrListenTitle', textKey: 'lrListenText', clickDone: true },
    { selector: '#btnPublish', titleKey: 'lsSaveTitle', textKey: 'lsSaveText', clickDone: true },
    { titleKey: 'lrEndTitle', textKey: 'lrEndText', final: true },
  ] },
  { id: 'sequential', titleKey: 'lessonSequentialTitle', descKey: 'lessonSequentialDesc', steps: [
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lsLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    { selector: '#btnAddLibraryTrack', titleKey: 'lsAddTitle', textKey: 'lsAddText',
      enter: (c) => { c.baseLen = library.length; }, done: (c) => library.length > c.baseLen },
    { selector: '#libraryDetail select[data-field="mode"]', titleKey: 'lqModeTitle', textKey: 'lqModeText',
      done: () => { const t = lessonTrack(); return !!t && t.mode === 'sequential'; } },
    { selector: '#libraryDetail .seq-master-item[data-seq-key="seqIntro"]', titleKey: 'lqIntroTitle', textKey: 'lqIntroText', sampleKey: 'sequential', names: 'seqIntro',
      done: () => { const t = lessonTrack(); return !!t && lessonHasFile(t.intro); } },
    // L'intro de l'exemple dure moins d'une mesure (un temps) : réglage manuel (mesures = 1, temps par mesure = 1).
    { selector: '#libraryDetail .row:has([data-field="introBars"])', titleKey: 'lqIntroSetTitle', textKey: 'lqIntroSetText',
      done: () => { const t = lessonTrack(); return !!t && !!t.intro && Number(t.intro.bars) === 1 && Number(t.intro.beatsPerBar) === 1; } },
    { selector: '#libraryDetail [data-action="add-segment-slot"]', titleKey: 'lqSlotTitle', textKey: 'lqSlotText',
      done: () => { const t = lessonTrack(); return !!t && (t.segmentSlots || []).length >= 1; } },
    { selector: '#libraryDetail .seq-master-item[data-si="0"]', titleKey: 'lqSegTitle', textKey: 'lqSegText', names: 'seqA',
      done: () => lessonSlotFileCount(0) >= 2 },
    { selector: '#libraryDetail [data-slot-field="repeatCount"]', titleKey: 'lqSlotCheckTitle', textKey: 'lqSlotCheckText' },
    // Répétition des opérations pour une nouvelle section.
    { selector: '#libraryDetail [data-action="add-segment-slot"]', titleKey: 'lqSlot2Title', textKey: 'lqSlot2Text',
      done: () => { const t = lessonTrack(); return !!t && (t.segmentSlots || []).length >= 2; } },
    { selector: '#libraryDetail .seq-master-item[data-si="1"]', titleKey: 'lqSeg2Title', textKey: 'lqSeg2Text', names: 'seqB',
      done: () => lessonSlotFileCount(1) >= 2 },
    { selector: '#libraryDetail [data-slot-field="repeatCount"]', titleKey: 'lqSlotCheckTitle', textKey: 'lqSlotCheckText' },
    { selector: '#libraryDetail .seq-master-item[data-seq-key="seqOutro"]', titleKey: 'lqOutroTitle', textKey: 'lqOutroText', names: 'seqOutro',
      done: () => { const t = lessonTrack(); return !!t && lessonHasFile(t.outro); } },
    { selector: '#libraryDetail [data-role="segmentSlotsMaster"]', titleKey: 'lqCheckTitle', textKey: 'lqCheckText' },
    { selector: '#libraryDetail .seq-master-item[data-seq-key="trackinfo"]', titleKey: 'lqInfoTitle', textKey: 'lqInfoText',
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 'trackinfo'; } },
    { selector: '#libraryDetail select[data-field="maxChainLoops"]', titleKey: 'lqCyclesTitle', textKey: 'lqCyclesText' },
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'lqListenTitle', textKey: 'lqListenText', clickDone: true },
    { selector: '#btnPublish', titleKey: 'lsSaveTitle', textKey: 'lsSaveText', clickDone: true },
    { titleKey: 'lqEndTitle', textKey: 'lqEndText', final: true },
  ] },
  { id: 'branching', titleKey: 'lessonBranchingTitle', descKey: 'lessonBranchingDesc', steps: [
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lsLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    // Cette leçon prolonge la précédente : elle reprend le morceau séquentiel déjà construit (au moins 2 emplacements).
    { selector: '#libraryMaster', titleKey: 'lbOpenTitle', textKey: 'lbOpenText',
      done: () => { const t = lessonTrack(); return !!t && t.mode === 'sequential' && (t.segmentSlots || []).length >= 2; } },
    { selector: '#libraryDetail [data-action="add-segment-slot"]', titleKey: 'lbSlot3Title', textKey: 'lbSlot3Text',
      done: () => { const t = lessonTrack(); return !!t && (t.segmentSlots || []).length >= 3; } },
    { selector: '#libraryDetail .seq-master-item[data-si="2"]', titleKey: 'lbSeg3Title', textKey: 'lbSeg3Text', sampleKey: 'branching', names: 'seqC',
      done: () => { const sl = lessonSlot(2); return !!sl && (sl.alternatives || []).filter(lessonHasFile).length >= 2; } },
    { selector: '#libraryDetail .seq-master-item[data-si="0"]', titleKey: 'lbPickTitle', textKey: 'lbPickText',
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 0; } },
    { selector: '#libraryDetail input[data-slot-field="hasBranches"]', titleKey: 'lbEnableTitle', textKey: 'lbEnableText',
      done: () => { const sl = lessonSlot(0); return !!sl && (sl.nextOptions || []).length >= 1; } },
    { selector: '#libraryDetail .branch-option-card:nth-child(1) [data-branch-field="targetId"]', titleKey: 'lbTarget1Title', textKey: 'lbTarget1Text' },
    { selector: '#libraryDetail [data-action="add-branch-option"]', titleKey: 'lbAddTitle', textKey: 'lbAddText',
      done: () => { const sl = lessonSlot(0); return !!sl && (sl.nextOptions || []).length >= 2; } },
    { selector: '#libraryDetail .branch-option-card:nth-child(2) [data-branch-field="targetId"]', titleKey: 'lbTarget2Title', textKey: 'lbTarget2Text',
      done: () => { const t = lessonTrack(); const sl = lessonSlot(0); const third = lessonSlot(2); return !!(t && sl && third && sl.nextOptions && sl.nextOptions[1] && sl.nextOptions[1].targetId === third.id); } },
    { selector: '#libraryDetail .branch-option-card:nth-child(1) [data-branch-field="label"]', titleKey: 'lbLabelsTitle', textKey: 'lbLabelsText' },
    { selector: '#libraryDetail select[data-slot-field="quantization"]', titleKey: 'lbTriggerTitle', textKey: 'lbTriggerText' },
    { selector: '#libraryDetail .branch-option-card:nth-child(1) [data-branch-field="hasTransition"]', titleKey: 'lbTransTitle', textKey: 'lbTransText' },
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'lbListenTitle', textKey: 'lbListenText', clickDone: true },
    { selector: '#btnPublish', titleKey: 'lsSaveTitle', textKey: 'lsSaveText', clickDone: true },
    { titleKey: 'lbEndTitle', textKey: 'lbEndText', final: true },
  ] },
  { id: 'embranchement', titleKey: 'lessonEmbrTitle', descKey: 'lessonEmbrDesc', steps: [
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lsLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    { selector: '#btnAddLibraryTrack', titleKey: 'lsAddTitle', textKey: 'lsAddText',
      enter: (c) => { c.baseLen = library.length; }, done: (c) => library.length > c.baseLen },
    { selector: '#libraryDetail select[data-field="mode"]', titleKey: 'leModeTitle', textKey: 'leModeText',
      done: () => { const t = lessonTrack(); return !!t && t.mode === 'embranchement-vertical'; } },
    { selector: '#libraryDetail [data-role="modeMaster"]', titleKey: 'leDropTitle', textKey: 'leDropText', sampleKey: 'embranchement', names: 'embrLoops',
      done: () => lessonLoopFileCount() >= 2 },
    { selector: '#libraryDetail [data-role="modeMaster"]', titleKey: 'leCheckTitle', textKey: 'leCheckText' },
    { selector: '#libraryDetail .seq-master-item[data-si="0"]', titleKey: 'leRefTitle', textKey: 'leRefText',
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 0; } },
    { selector: '#libraryDetail input[data-field="bpm"]', titleKey: 'leBpmTitle', textKey: 'leBpmText' },
    { selector: '#libraryDetail [data-role="embrLoopTimelineHost"]', titleKey: 'lePointsTitle', textKey: 'lePointsText' },
    { selector: '#libraryDetail .seq-master-item[data-si="1"]', titleKey: 'leSecondTitle', textKey: 'leSecondText',
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 1; } },
    { selector: '#libraryDetail input[data-embr-loop-field="label"]', titleKey: 'leLabelTitle', textKey: 'leLabelText' },
    { selector: '#libraryDetail select[data-embr-loop-field="switchQuantize"]', titleKey: 'leQuantTitle', textKey: 'leQuantText' },
    { selector: '#libraryDetail input[data-embr-loop-field="hasTransition"]', titleKey: 'leTransTitle', textKey: 'leTransText' },
    // Boucle de détour : un fichier à part, joué ponctuellement au clic (mesures et tempo propres).
    { selector: '#libraryDetail [data-action="add-embr-loop"]', titleKey: 'ldAddTitle', textKey: 'ldAddText',
      done: () => { const t = lessonTrack(); return !!t && (t.loops || []).length >= 3; } },
    { selector: '#libraryDetail .seq-master-item[data-si="2"]', titleKey: 'ldOpenTitle', textKey: 'ldOpenText',
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 2; } },
    { selector: '#libraryDetail [data-role="embrLoopFileCtrl"]', titleKey: 'ldFileTitle', textKey: 'ldFileText', names: 'embrDetour',
      done: () => { const t = lessonTrack(); return !!t && lessonHasFile((t.loops || [])[2]); } },
    { selector: '#libraryDetail input[data-embr-loop-field="isDetour"]', titleKey: 'ldFlagTitle', textKey: 'ldFlagText',
      done: () => { const t = lessonTrack(); const l = t && (t.loops || [])[2]; return !!l && !!l.isDetour; } },
    { selector: '#libraryDetail .row:has([data-embr-loop-field="bars"])', titleKey: 'ldSetTitle', textKey: 'ldSetText' },
    { selector: '#libraryDetail [data-role="fxSlidersHost"]', titleKey: 'leSliderTitle', textKey: 'leSliderText', skip: () => !fxOpen('rtpc') },
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'leListenTitle', textKey: 'leListenText', clickDone: true },
    { selector: '#btnPublish', titleKey: 'lsSaveTitle', textKey: 'lsSaveText', clickDone: true },
    { titleKey: 'leEndTitle', textKey: 'leEndText', final: true },
  ] },
  // Leçon 7 : l'import d'un dossier tourne entièrement dans le navigateur (feu vert « bulk_drop » pour l'instant).
  { id: 'import', titleKey: 'lessonImportTitle', descKey: 'lessonImportDesc', needs: 'bulk_drop', steps: [
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lsLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    { selector: '#libraryFolderDrop', titleKey: 'lfDropTitle', textKey: 'lfDropText', sampleKey: 'import', names: 'import',
      enter: (c) => { c.baseLen = library.length; }, done: () => lessonFolderDialogOpen() },
    { selector: '.vrs-batch-modal [data-fi="mode"]', titleKey: 'lfReadTitle', textKey: 'lfReadText' },
    { selector: '.vrs-batch-modal [data-fi-btn="go"]', titleKey: 'lfGoTitle', textKey: 'lfGoText',
      done: () => !!document.querySelector('.vrs-batch-modal [data-vbd-file]') },
    // Le piège : « Ouverture.wav » n'est pas reconnue comme intro et aucun nom ne porte de tempo. L'apprenant la
    // renomme chez lui (mot « Intro » + « _120bpm »), puis redépose le dossier.
    { selector: '.vrs-batch-modal .vrs-batch-body', titleKey: 'lfRolesTitle', textKey: 'lfRolesText' },
    { selector: '.vrs-batch-modal .vrs-batch-body', titleKey: 'lfRenameTitle', textKey: 'lfRenameText', required: true,
      done: () => /120\s*BPM/i.test(lessonDialogText()) && !!document.querySelector('.vrs-batch-modal [data-vbd-check="hints"]') },
    { selector: '.vrs-batch-modal .vrs-batch-group', titleKey: 'lfCheckTitle', textKey: 'lfCheckText' },
    { selector: '.vrs-batch-modal [data-vbd="confirm"]', titleKey: 'lfCreateTitle', textKey: 'lfCreateText',
      done: (c) => library.length > c.baseLen },
    { selector: '#libraryMaster', titleKey: 'lfDraftTitle', textKey: 'lfDraftText' },
    { selector: '#btnPublish', titleKey: 'lsSaveTitle', textKey: 'lsSaveText', clickDone: true },
    { titleKey: 'lfEndTitle', textKey: 'lfEndText', final: true },
  ] },
];

let guide = null; // { root, kind, lessonId, steps, index, ctx, timer, advancing, clicked }

function tourTargetVisible(el) {
  if (!el || el.hidden || el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function tourMarkDone() { try { localStorage.setItem(TOUR_DONE_STORAGE, '1'); } catch (e) { /* stockage indisponible */ } }
function tourAlreadyDone() { try { return localStorage.getItem(TOUR_DONE_STORAGE) === '1'; } catch (e) { return false; } }
function lessonsDone() { try { return JSON.parse(localStorage.getItem(LESSONS_DONE_STORAGE) || '{}') || {}; } catch (e) { return {}; } }
function lessonMarkDone(id) { try { const d = lessonsDone(); d[id] = true; localStorage.setItem(LESSONS_DONE_STORAGE, JSON.stringify(d)); } catch (e) { /* stockage indisponible */ } }

function closeBackstageTour() {
  if (!guide) return;
  if (guide.timer) clearInterval(guide.timer);
  guide.root.remove();
  window.removeEventListener('resize', renderGuideStep);
  document.removeEventListener('keydown', guideKeydown, true);
  document.removeEventListener('click', guideClickCapture, true);
  if (guide.kind === 'tour') tourMarkDone();
  guide = null;
  renderTutorialMenu();
}
function guideKeydown(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeBackstageTour(); }
}
function guideClickCapture(e) {
  if (!guide) return;
  const step = guide.steps[guide.index];
  if (step && step.clickDone && step.selector && e.target.closest && e.target.closest(step.selector)) guide.clicked = true;
}
function guideStepTarget(step) { return step.selector ? document.querySelector(step.selector) : null; }
function guideGo(delta) {
  if (!guide) return;
  let next = guide.index + delta;
  // Saute les étapes sans objet (ex. curseur de paramètre quand son feu vert est fermé), dans les deux sens.
  while (next >= 0 && next < guide.steps.length && guide.steps[next].skip && guide.steps[next].skip()) next += delta;
  if (next < 0) return;
  if (next >= guide.steps.length) { finishGuide(); return; }
  guide.index = next; guide.clicked = false; guide.advancing = false;
  const step = guide.steps[next];
  if (step.enter) step.enter(guide.ctx);
  renderGuideStep();
}
function finishGuide() {
  if (guide && guide.kind === 'lesson') lessonMarkDone(guide.lessonId);
  closeBackstageTour();
}
function guideStepIsDone(step) {
  if (step.done) { try { return !!step.done(guide.ctx); } catch (e) { return false; } }
  if (step.clickDone) return guide.clicked;
  return false;
}
function guideTick() {
  if (!guide) return;
  const step = guide.steps[guide.index];
  if (guide.kind === 'lesson' && !guide.advancing && guideStepIsDone(step)) {
    guide.advancing = true;
    setTimeout(() => guideGo(1), 450); // laisse voir le résultat du geste avant la bulle suivante
    return;
  }
  renderGuideStep(true);
}
function renderGuideStep(positionOnly) {
  if (!guide) return;
  const step = guide.steps[guide.index];
  const target = guideStepTarget(step);
  const visible = tourTargetVisible(target);
  const spot = guide.root.querySelector('.tour-spot');
  const card = guide.root.querySelector('.tour-card');
  const auto = guide.kind === 'lesson' && (step.done || step.clickDone);
  const last = guide.index === guide.steps.length - 1;
  const key = guide.index + ':' + (visible ? 'v' : 'h');
  if (!positionOnly || guide.cardKey !== key) {
    guide.cardKey = key;
    const sample = step.sampleKey ? LESSON_SAMPLE_FILES[step.sampleKey] : undefined;
    const sampleHtml = step.sampleKey
      ? (sample ? `<a class="tour-sample" href="${escapeAttr(sample)}" download>${escapeHtml(tr('lessonSampleDownload'))}</a>`
        : `<div class="tour-sample tour-sample-soon">${escapeHtml(tr('lessonSampleSoon'))}</div>`)
      : '';
    card.innerHTML = `
      <div class="tour-count">${guide.index + 1} / ${guide.steps.length}</div>
      <div class="tour-title">${escapeHtml(tr(step.titleKey))}</div>
      <div class="tour-text">${escapeHtml(tr(step.textKey, { file: LESSON_SAMPLE_NAMES[step.names || guide.lessonId] || '' }))}</div>
      ${sampleHtml}
      ${auto ? `<div class="tour-waiting">${escapeHtml(tr('lessonDoIt'))}</div>` : ''}
      <div class="tour-actions">
        <button class="btn btn-small" type="button" data-tour="skip">${escapeHtml(tr(last ? 'tourClose' : (guide.kind === 'lesson' ? 'lessonQuit' : 'tourSkip')))}</button>
        <span style="flex:1"></span>
        ${guide.index > 0 && !auto && !step.final ? `<button class="btn btn-small" type="button" data-tour="prev">${escapeHtml(tr('tourPrev'))}</button>` : ''}
        ${auto ? (step.required ? '' : `<button class="btn btn-small" type="button" data-tour="next">${escapeHtml(tr('lessonSkipStep'))}</button>`)
          : `<button class="btn btn-small btn-primary" type="button" data-tour="next">${escapeHtml(tr(last ? 'tourFinish' : 'tourNext'))}</button>`}
      </div>`;
    card.querySelector('[data-tour="skip"]').onclick = closeBackstageTour;
    const nextBtn = card.querySelector('[data-tour="next"]');
    if (nextBtn) nextBtn.onclick = () => guideGo(1); // absent sur une étape obligatoire
    const prev = card.querySelector('[data-tour="prev"]');
    if (prev) prev.onclick = () => guideGo(-1);
  }
  const margin = 12;
  if (visible) {
    const r = target.getBoundingClientRect();
    spot.style.display = 'block';
    spot.style.top = (r.top - 4) + 'px'; spot.style.left = (r.left - 4) + 'px';
    spot.style.width = (r.width + 8) + 'px'; spot.style.height = (r.height + 8) + 'px';
    // Pendant une leçon, la cible doit rester cliquable : le voile laisse passer les clics (pointer-events), la carte non.
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let left = r.right + margin, top = r.top;
    if (left + cw > window.innerWidth - margin) { left = Math.min(r.left, window.innerWidth - cw - margin); top = r.bottom + margin; }
    if (top + ch > window.innerHeight - margin) top = Math.max(margin, r.top - ch - margin);
    card.style.left = Math.max(margin, left) + 'px'; card.style.top = Math.max(margin, top) + 'px';
    card.style.transform = 'none';
  } else {
    spot.style.display = 'none';
    card.style.left = '50%'; card.style.top = '50%'; card.style.transform = 'translate(-50%, -50%)';
  }
}
function openGuide(kind, steps, lessonId) {
  if (guide) closeBackstageTour();
  if (!steps.length) return;
  const root = document.createElement('div');
  root.className = 'tour-root' + (kind === 'lesson' ? ' tour-root-lesson' : '');
  root.setAttribute('role', 'dialog');
  root.innerHTML = '<div class="tour-spot"></div><div class="tour-card"></div>';
  document.body.appendChild(root);
  guide = { root, kind, lessonId, steps, index: 0, ctx: {}, timer: null, advancing: false, clicked: false, cardKey: '' };
  if (steps[0].enter) steps[0].enter(guide.ctx);
  window.addEventListener('resize', renderGuideStep);
  document.addEventListener('keydown', guideKeydown, true);
  document.addEventListener('click', guideClickCapture, true);
  renderGuideStep();
  if (kind === 'lesson') guide.timer = setInterval(guideTick, 250);
  else guide.timer = setInterval(() => renderGuideStep(true), 400); // suit la cible si l'écran se redessine
}
function startBackstageTour() {
  if (guide) return;
  openGuide('tour', TOUR_STEPS.filter(s => !s.selector || tourTargetVisible(document.querySelector(s.selector))));
}
function startLesson(id) {
  const lesson = LESSONS.find(l => l.id === id);
  if (!lesson || !lesson.steps || !lessonsAccessOpen() || (lesson.needs && !flagOpen(lesson.needs))) return;
  openGuide('lesson', lesson.steps, id);
  // Saute les étapes déjà faites au départ (par ex. bibliothèque déjà ouverte).
  const skipDone = () => { while (guide && guide.index < guide.steps.length - 1 && guide.steps[guide.index].done && guideStepIsDone(guide.steps[guide.index])) guideGo(1); };
  skipDone();
}

// ---- Menu « Tutoriel » (barre du haut) ----
function renderTutorialMenu() {
  const list = document.getElementById('tutorialMenuList');
  if (!list) return;
  const done = lessonsDone();
  const tick = '<svg class="account-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  list.innerHTML = `
    <button class="account-menu-item" type="button" data-tutorial="tour">
      <span class="account-menu-item-label"><span class="tutorial-menu-text"><b>${escapeHtml(tr('accountMenuTour'))}</b><small>${escapeHtml(tr('tutorialTourDesc'))}</small></span></span>
      ${tourAlreadyDone() ? tick : ''}
    </button>
    <div class="account-menu-sep"></div>
    <div class="tutorial-menu-heading">${escapeHtml(tr('tutorialLessonsHeading'))}</div>
    ${LESSONS.map(l => `
      <button class="account-menu-item" type="button" data-tutorial="${l.id}" ${(l.soon || (l.needs && !flagOpen(l.needs))) ? 'disabled' : ''}>
        <span class="account-menu-item-label"><span class="tutorial-menu-text"><b>${escapeHtml(tr(l.titleKey))}</b><small>${escapeHtml(tr(l.descKey))}</small></span></span>
        ${(l.soon || (l.needs && !flagOpen(l.needs))) ? `<span class="nav-badge">${escapeHtml(tr('comingSoonBadge'))}</span>` : (done[l.id] ? tick : '')}
      </button>`).join('')}`;
}
function initTutorialMenuUi() {
  const btn = document.getElementById('btnTutorialMenu');
  const dropdown = document.getElementById('tutorialMenuDropdown');
  if (!btn || !dropdown) return;
  const closeMenu = () => { dropdown.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = dropdown.hidden;
    if (willOpen) renderTutorialMenu();
    dropdown.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) document.dispatchEvent(new CustomEvent('lp-header-menu-open', { detail: 'tutorial' }));
  });
  document.addEventListener('lp-header-menu-open', (e) => { if (e.detail !== 'tutorial' && !dropdown.hidden) closeMenu(); });
  document.addEventListener('click', (e) => { if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== btn) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('[data-tutorial]');
    if (!item || item.disabled) return;
    closeMenu();
    const id = item.dataset.tutorial;
    if (id === 'tour') startBackstageTour(); else startLesson(id);
  });
}
// Appelée une fois les feux verts connus (fin de renderAdminOnlyPanels) : montre le menu et lance la visite la toute
// première fois, sans jamais la relancer ensuite.
function syncBackstageTour() {
  const open = flagOpen('in_app_tour');
  const menuItem = document.getElementById('accountMenuTour');
  if (menuItem) menuItem.hidden = !open;
  // Le menu « Tutoriel » et les leçons ont leur propre feu vert : on peut ouvrir la visite sans ouvrir les leçons.
  const lessonsOpen = lessonsAccessOpen();
  const wrap = document.getElementById('tutorialMenuWrap');
  if (wrap) wrap.hidden = !lessonsOpen;
  if (lessonsOpen) renderTutorialMenu();
  if (open && !tourAlreadyDone() && !guide) setTimeout(startBackstageTour, 600);
}
(function wireTourMenu() {
  const item = document.getElementById('accountMenuTour');
  if (item) item.addEventListener('click', () => {
    const dd = document.getElementById('accountMenuDropdown');
    if (dd) dd.hidden = true;
    startBackstageTour();
  });
  initTutorialMenuUi();
})();
