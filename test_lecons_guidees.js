// Menu « Tutoriel » et leçons guidées du Backstage (08/10) : les étapes visent des éléments qui existent, les textes
// existent en FR et EN, le menu est caché par défaut (feu vert) et le moteur fait avancer la leçon quand le geste est fait.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadBackstage } = require('./scripts/test-harness.js');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

(async () => {
  const src = read('src/backstage/43-visite-guidee.js');
  const sb = { window: {} };
  vm.createContext(sb);
  vm.runInContext(read('layerpitch-i18n.js'), sb);
  const keys = new Set([...src.matchAll(/(?:titleKey|textKey|descKey): '([^']+)'/g)].map(m => m[1]));
  ['lessonSampleDownload', 'lessonSampleUse', 'lessonChipHint', 'lessonChipMany', 'lessonNextBtn', 'lessonSampleUseMany', 'lessonSampleError', 'lsVerifyTitle', 'lsVerifyText', 'lessonSampleSoon', 'lessonDoIt', 'lessonQuit', 'lessonSkipStep', 'tutorialMenuTitle', 'tutorialTourDesc', 'tutorialLessonsHeading'].forEach(k => keys.add(k));
  ['fr', 'en'].forEach(l => check('textes présents en ' + l + ' (' + keys.size + ' clés)', [...keys].every(k => sb.window.LAYERPITCH_I18N[l].backstage[k])));

  const page = read('layerpitch-backstage.html');
  check('feu vert in_app_lessons déclaré en base', read('supabase/migrations/20261008070000_in_app_lessons_flag.sql').includes("'in_app_lessons'"));
  check('menu Tutoriel piloté par in_app_lessons, visite par in_app_tour', /function lessonsAccessOpen\(\) \{ return flagOpen\('in_app_lessons'\)/.test(src) && /lessonsOpen = lessonsAccessOpen\(\)/.test(src) && /flagOpen\('in_app_tour'\)/.test(src));
  check('menu Tutoriel caché par défaut', /id="tutorialMenuWrap" hidden/.test(page));
  ['btnTutorialMenu', 'tutorialMenuDropdown', 'tutorialMenuList', 'btnAddLibraryTrack', 'btnPublish', 'libraryDetail'].forEach(id => check('élément ' + id + ' présent', page.includes('id="' + id + '"')));
  ['data-field="mode"', 'data-role="staticFileCtrl"', 'data-field="loopable"', 'data-field="loopEngine"', 'data-role="loopTimelineHost"', 'data-action="preview-track"', 'data-role="modeMaster"', 'data-role="previewHost"', 'data-role="fxSlidersHost"', 'data-role="vrsPools"', 'data-action="add-section"', 'data-action="add-pool"', 'data-section-field="bpm"', 'data-seq-key="seqIntro"', 'data-seq-key="seqOutro"', 'data-seq-key="trackinfo"', 'data-action="add-segment-slot"', 'data-role="segmentSlotsMaster"', 'data-field="introBars"', 'data-field="introBeatsPerBar"', 'data-slot-field="repeatCount"', 'data-slot-field="hasBranches"', 'data-slot-field="quantization"', 'data-branch-field="targetId"', 'data-branch-field="label"', 'data-branch-field="hasTransition"', 'data-action="add-branch-option"', 'branch-option-card', 'data-embr-loop-field="label"', 'data-embr-loop-field="switchQuantize"', 'data-embr-loop-field="hasTransition"', 'data-role="embrLoopTimelineHost"', 'data-action="add-embr-loop"', 'data-role="embrLoopFileCtrl"', 'data-embr-loop-field="isDetour"', 'data-embr-loop-field="bars"', 'id="libraryFolderDrop"', 'vrs-batch-modal', 'data-fi="mode"', 'data-fi-btn="go"', 'data-vbd="confirm"', 'data-vbd-file', 'vrs-batch-group']
    .forEach(a => check('cible de leçon ' + a + ' présente dans les sources', page.includes(a)));

  // Moteur : la leçon avance toute seule quand le geste est fait.
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window;
  w.eval(`
    myFlags = { in_app_lessons: false };
    startLesson('static');
    window.__closed = !document.querySelector('.tour-root');
    myFlags = { in_app_lessons: true };
    document.querySelector('.nav-item[data-tab="library"]').hidden = false;
    var __r = { lessons: LESSONS.length, soon: LESSONS.filter(l => l.soon).length, add: (LESSONS.find(l => l.id === 'additive').steps || []).length, rnd: (LESSONS.find(l => l.id === 'random').steps || []).length, seq: (LESSONS.find(l => l.id === 'sequential').steps || []).length, br: (LESSONS.find(l => l.id === 'branching').steps || []).length, emb: (LESSONS.find(l => l.id === 'embranchement').steps || []).length, seqSkip: (LESSONS.find(l => l.id === 'sequential').steps || []).filter(s2 => s2.skip).length, brSkip: (LESSONS.find(l => l.id === 'branching').steps || []).filter(s2 => s2.skip).length };
    startLesson('static');
    window.__r = __r;
  `);
  check('leçon refusée tant que in_app_lessons est fermé', w.__closed === true);
  check('6 leçons déclarées, aucune « bientôt »', w.__r.lessons === 6 && w.__r.soon === 0);
  check('séquentiel simple : 18 étapes, sans raccourci', w.__r.seq === 18 && w.__r.seqSkip === 0);
  check('séquentiel à embranchement : raccourci d’import (24 étapes dont 9 sautées sans bulk_drop)', w.__r.br === 24 && w.__r.brSkip === 9);
  check('embranchement vertical : 21 étapes', w.__r.emb === 21);
  
  
  check('couches aléatoires : 13 étapes', w.__r.rnd === 13);
  check('couches additives : 13 étapes', w.__r.add === 13);
  check('la leçon ouvre une bulle', !!w.document.querySelector('.tour-root-lesson .tour-card'));
  check('étape 1 sur 11', /1 \/ 11/.test(w.document.querySelector('.tour-count').textContent));
  // Geste : l'onglet bibliothèque devient actif -> étape 2 (après le délai d'avance).
  w.eval(`document.querySelector('.backstage-panel[data-panel="library"]').classList.add('active');`);
  for (let i = 0; i < 40 && !/2 \/ 11/.test((w.document.querySelector('.tour-count') || {}).textContent || ''); i++) await new Promise(r => setTimeout(r, 100));
  check('avance seule à l’étape 2', /2 \/ 11/.test((w.document.querySelector('.tour-count') || {}).textContent || ''));
  // Étape « moteur de bouclage » : obligatoire, pas de « Passer l’étape » tant que « Simple » est réglé.
  w.eval(`library = [{ id: 't1', mode: 'static', loopEngine: 'simple', layers: [{}] }]; manageLibrarySelectedId = 't1'; guide.index = 5; guide.advancing = false; guide.cardKey = ''; renderGuideStep();`);
  check('moteur Simple : pas de bouton « Passer l’étape »', !w.document.querySelector('[data-tour="next"]'));
  check('moteur Simple : la leçon reste sur l’étape 6', /6 \/ 11/.test(w.document.querySelector('.tour-count').textContent));
  w.eval(`library[0].loopEngine = 'quantized';`);
  for (let i = 0; i < 40 && !/7 \/ 11/.test((w.document.querySelector('.tour-count') || {}).textContent || ''); i++) await new Promise(r => setTimeout(r, 100));
  check('moteur Quantifié : avance à l’étape 7', /7 \/ 11/.test((w.document.querySelector('.tour-count') || {}).textContent || ''));
  // Fichiers d'exemple : le bouton « Utiliser » n'apparaît que lorsque toutes les URL sont connues.
  const sampleOk = w.eval(`(function () {
    const st = LESSONS.find(l => l.id === 'static').steps.find(x => x.sampleKey);
    guide.lessonId = 'static';
    const nm = LESSON_SAMPLE_NAMES.static;
    const saved = LESSON_SAMPLE_URLS[nm];
    delete LESSON_SAMPLE_URLS[nm];
    const before = lessonSampleReady(st);
    LESSON_SAMPLE_URLS[nm] = 'https://example.test/' + nm;
    const after = lessonSampleReady(st);
    if (saved) LESSON_SAMPLE_URLS[nm] = saved; else delete LESSON_SAMPLE_URLS[nm];
    const multi = LESSONS.find(l => l.id === 'additive').steps.find(x => x.sampleKey);
    guide.lessonId = 'additive';
    return { before, after, names: lessonStepFileNames(multi).length, flagged: LESSONS.reduce((n, l) => n + (l.steps || []).filter(x => x.useSample).length, 0) };
  })()`);
  check('fichier d’exemple : bouton absent sans URL, présent avec', sampleOk.before === false && sampleOk.after === true);
  check('fichiers d’exemple : 3 noms pour les couches additives', sampleOk.names === 3);
  check('11 étapes de dépôt acceptent l’exemple', sampleOk.flagged === 11);
  // Dépôt réel d'un exemple : un événement « drop » transporte les fichiers jusqu'au gestionnaire de la zone.
  w.DataTransfer = class { constructor() { this.files = []; this.items = { add: f => this.files.push(f) }; } };
  w.DragEvent = class extends w.Event { constructor(t, o) { super(t, o); this.dataTransfer = o.dataTransfer; } };
  w.fetch = async () => ({ ok: true, blob: async () => new w.Blob(['x'], { type: 'audio/wav' }) });
  const zone = w.document.createElement('div'); zone.id = '__sampleZone'; w.document.body.appendChild(zone);
  let received = [];
  zone.addEventListener('drop', e => { received = e.dataTransfer.files.slice(); });
  await w.eval(`(async () => {
    guide.lessonId = 'static';
    await lessonUseSample({ selector: '#__sampleZone', useSample: true, names: 'static' });
  })()`);
  const expected = w.eval('LESSON_SAMPLE_NAMES.static');
  check('« Utiliser l’exemple » dépose le fichier nommé sur la zone', received.length === 1 && received[0].name === expected);
  // Une étape à geste n'a pas de bouton « Passer l'étape » tant qu'on est sur la dernière étape atteinte.
  w.eval(`guide.maxIndex = 3; guide.index = 3; guide.advancing = false; guide.cardKey = ''; renderGuideStep();`);
  check('étape à geste (la plus avancée) : aucun bouton « Passer l’étape »', !w.document.querySelector('[data-tour="next"]'));
  check('étape à geste : « Quitter » reste disponible', !!w.document.querySelector('[data-tour="skip"]'));
  check('étape à geste : « Précédent » disponible', !!w.document.querySelector('[data-tour="prev"]'));
  // Revue avec « Précédent » : « Passer l'étape » apparaît, et l'étape n'avance pas toute seule.
  w.eval(`guide.maxIndex = 5; guide.index = 3; guide.cardKey = ''; renderGuideStep();`);
  check('étape déjà franchie : bouton « Passer l’étape » présent', !!w.document.querySelector('[data-tour="next"]'));
  await new Promise(r => setTimeout(r, 700));
  check('étape déjà franchie : pas d’avance automatique', /4 \/ 11/.test(w.document.querySelector('.tour-count').textContent));
  // Bulle finale : bouton « Passer à la leçon suivante ».
  w.eval(`flagOpen = () => true; guide.lessonId = 'static'; guide.index = guide.steps.length - 1; guide.maxIndex = guide.index; guide.cardKey = ''; renderGuideStep();`);
  const nl = w.document.querySelector('[data-tour="nextlesson"]');
  check('bulle finale : bouton vers la leçon suivante', !!nl && /Passer à la leçon 2 : Mode layering vertical additif/.test(nl.textContent));
  w.eval(`guide.lessonId = 'branching'; guide.cardKey = ''; renderGuideStep();`);
  check('dernière leçon : pas de bouton « leçon suivante »', !w.document.querySelector('[data-tour="nextlesson"]'));
  // Glisser simulé : relâcher sur la zone dépose ; la vignette apparaît quand l'exemple est prêt.
  zone.getBoundingClientRect = () => ({ left: 100, top: 100, right: 300, bottom: 160, width: 200, height: 60 });
  const inside = w.eval(`lessonPointInZone({ selector: '#__sampleZone' }, 150, 120)`);
  const outside = w.eval(`lessonPointInZone({ selector: '#__sampleZone' }, 500, 500)`);
  check('zone de dépôt : point dedans / dehors', inside === true && outside === false);
  w.eval(`guide.lessonId = 'static'; guide.index = 3; guide.maxIndex = 3; guide.cardKey = ''; renderGuideStep();`);
  check('étape de dépôt : vignette du fichier d’exemple présente', !!w.document.querySelector('[data-tour="chip"]'));
  check('étape de dépôt : bouton « Utiliser » toujours présent (clavier)', !!w.document.querySelector('[data-tour="sample"]'));
  // Échap quitte.
  w.eval(`guide.index = 6; guide.advancing = false; guide.cardKey = ''; renderGuideStep();`); // « Vérifie les infos » : étape manuelle
  check('bouton « Suivant » sur une étape manuelle', !!w.document.querySelector('[data-tour="next"]'));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Échap ferme la leçon', !w.document.querySelector('.tour-root'));
  dom.window.close();
  process.exit(failures ? 1 : 0);
})();
