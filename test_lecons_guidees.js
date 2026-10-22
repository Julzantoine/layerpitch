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
  ['lessonSampleDownload', 'lessonSampleUse', 'lessonMoveHint', 'lessonListening', 'lessonKeepTrack', 'lessonChipHint', 'lessonArrowLabel', 'lessonChipMany', 'lessonNextBtn', 'lessonSampleUseMany', 'lessonSampleError', 'lsVerifyTitle', 'lsVerifyText', 'lessonSampleSoon', 'lessonDoIt', 'lessonQuit', 'lessonSkipStep', 'tutorialMenuTitle', 'tutorialTourDesc', 'tutorialLessonsHeading'].forEach(k => keys.add(k));
  ['fr', 'en'].forEach(l => check('textes présents en ' + l + ' (' + keys.size + ' clés)', [...keys].every(k => sb.window.LAYERPITCH_I18N[l].backstage[k] || sb.window.LAYERPITCH_I18N[l].shared[k])));

  const page = read('layerpitch-backstage.html');
  check('feu vert in_app_lessons déclaré en base', read('supabase/migrations/20261008070000_in_app_lessons_flag.sql').includes("'in_app_lessons'"));
  check('menu Tutoriel piloté par in_app_lessons, visite par in_app_tour', /function lessonsAccessOpen\(\) \{ return flagOpen\('in_app_lessons'\)/.test(src) && /lessonsOpen = lessonsAccessOpen\(\)/.test(src) && /flagOpen\('in_app_tour'\)/.test(src));
  check('menu Tutoriel caché par défaut', /id="tutorialMenuWrap" hidden/.test(page));
  ['btnTutorialMenu', 'tutorialMenuDropdown', 'tutorialMenuList', 'btnAddLibraryTrack', 'btnPublish', 'libraryDetail'].forEach(id => check('élément ' + id + ' présent', page.includes('id="' + id + '"')));
  ['data-field="mode"', 'data-role="staticFileCtrl"', 'data-field="loopable"', 'data-field="loopEngine"', 'data-role="loopTimelineHost"', 'data-action="preview-track"', 'data-role="modeMaster"', 'data-role="previewHost"', 'data-role="fxSlidersHost"', 'data-role="vrsPools"', 'data-action="add-pool"', 'data-section-field="bpm"', 'data-seq-key="seqIntro"', 'data-seq-key="seqOutro"', 'data-seq-key="trackinfo"', 'data-action="add-segment-slot"', 'data-role="segmentSlotsMaster"', 'data-field="introBars"', 'data-field="introBeatsPerBar"', 'data-slot-field="repeatCount"', 'data-slot-field="hasBranches"', 'data-slot-field="quantization"', 'data-branch-field="targetId"', 'data-branch-field="label"', 'data-branch-field="hasTransition"', 'data-action="add-branch-option"', 'branch-option-card', 'data-embr-loop-field="label"', 'data-embr-loop-field="switchQuantize"', 'data-embr-loop-field="hasTransition"', 'data-role="embrLoopTimelineHost"', 'data-action="add-embr-loop"', 'data-role="embrLoopFileCtrl"', 'data-embr-loop-field="isDetour"', 'data-embr-loop-field="bars"', 'id="libraryFolderDrop"', 'vrs-batch-modal', 'data-fi="mode"', 'data-fi-btn="go"', 'data-vbd="confirm"', 'data-vbd-file', 'vrs-batch-group']
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
    var __r = { lessons: LESSONS.filter(l => l.theme === 'engine').length, soon: LESSONS.filter(l => l.theme === 'engine' && l.soon).length, add: (LESSONS.find(l => l.id === 'additive').steps || []).length, rnd: (LESSONS.find(l => l.id === 'random').steps || []).length, seq: (LESSONS.find(l => l.id === 'sequential').steps || []).length, br: (LESSONS.find(l => l.id === 'branching').steps || []).length, emb: (LESSONS.find(l => l.id === 'embranchement').steps || []).length, seqSkip: (LESSONS.find(l => l.id === 'sequential').steps || []).filter(s2 => s2.skip).length, brSkip: (LESSONS.find(l => l.id === 'branching').steps || []).filter(s2 => s2.skip).length };
    startLesson('static');
    window.__r = __r;
  `);
  check('leçon refusée tant que in_app_lessons est fermé', w.__closed === true);
  check('8 leçons déclarées, aucune « bientôt »', w.__r.lessons === 8 && w.__r.soon === 0);
  check('séquentiel simple : 22 étapes (deux sections de quatre alternatives, duplication en AABA, case de mélange présentée), sans raccourci d’import', w.__r.seq === 22 && w.__r.seqSkip === 0);
  check('séquentiel à embranchement : raccourci d’import (40 étapes dont 9 sautées sans bulk_drop)', w.__r.br === 40 && w.__r.brSkip === 9);
  check('embranchement vertical : 24 étapes', w.__r.emb === 24);
  
  
  check('couches aléatoires : 19 étapes (dépôt direct dans la fenêtre d’import, compresseur sur la basse)', w.__r.rnd === 19);
  check('couches additives : 23 étapes', w.__r.add === 23);
  check('la leçon ouvre une bulle', !!w.document.querySelector('.tour-root-lesson .tour-card'));
  check('la leçon démarre sur le message de bienvenue (étape 1 sur 12)', /1 \/ 12/.test(w.document.querySelector('.tour-count').textContent) && /Bienvenue/.test(w.document.querySelector('.tour-title').textContent));
  check('message de bienvenue : étape manuelle avec « Suivant »', !!w.document.querySelector('[data-tour="next"]'));
  w.eval('guideGo(1)');
  check('« Suivant » passe à l’étape 2 sur 12', /2 \/ 12/.test(w.document.querySelector('.tour-count').textContent));
  // Geste : l'onglet bibliothèque devient actif -> étape 2 (après le délai d'avance).
  w.eval(`document.querySelector('.backstage-panel[data-panel="library"]').classList.add('active');`);
  for (let i = 0; i < 40 && !/3 \/ 12/.test((w.document.querySelector('.tour-count') || {}).textContent || ''); i++) await new Promise(r => setTimeout(r, 100));
  check('avance seule à l’étape 3', /3 \/ 12/.test((w.document.querySelector('.tour-count') || {}).textContent || ''));
  // Étape « moteur de bouclage » : obligatoire, pas de « Passer l’étape » tant que « Simple » est réglé.
  w.eval(`library = [{ id: 't1', mode: 'static', loopEngine: 'simple', layers: [{}] }]; manageLibrarySelectedId = 't1'; guide.index = 6; guide.advancing = false; guide.cardKey = ''; renderGuideStep();`);
  check('moteur Simple : pas de bouton « Passer l’étape »', !w.document.querySelector('[data-tour="next"]'));
  check('moteur Simple : la leçon reste sur l’étape 7', /7 \/ 12/.test(w.document.querySelector('.tour-count').textContent));
  w.eval(`library[0].loopEngine = 'quantized';`);
  for (let i = 0; i < 40 && !/8 \/ 12/.test((w.document.querySelector('.tour-count') || {}).textContent || ''); i++) await new Promise(r => setTimeout(r, 100));
  check('moteur Quantifié : avance à l’étape 8', /8 \/ 12/.test((w.document.querySelector('.tour-count') || {}).textContent || ''));
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
  check('18 étapes de dépôt acceptent l’exemple', sampleOk.flagged === 18);
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
  w.eval(`guide.maxIndex = 4; guide.index = 4; guide.advancing = false; guide.cardKey = ''; renderGuideStep();`);
  check('étape à geste (la plus avancée) : aucun bouton « Passer l’étape »', !w.document.querySelector('[data-tour="next"]'));
  check('étape à geste : « Quitter » reste disponible', !!w.document.querySelector('[data-tour="skip"]'));
  check('étape à geste : « Précédent » disponible', !!w.document.querySelector('[data-tour="prev"]'));
  // Revue avec « Précédent » : « Passer l'étape » apparaît, et l'étape n'avance pas toute seule.
  w.eval(`guide.maxIndex = 6; guide.index = 4; guide.cardKey = ''; renderGuideStep();`);
  check('étape déjà franchie : bouton « Passer l’étape » présent', !!w.document.querySelector('[data-tour="next"]'));
  await new Promise(r => setTimeout(r, 700));
  check('étape déjà franchie : pas d’avance automatique', /5 \/ 12/.test(w.document.querySelector('.tour-count').textContent));
  // Bulle finale : bouton « Passer à la leçon suivante ».
  w.eval(`flagOpen = () => true; guide.lessonId = 'static'; guide.index = guide.steps.length - 1; guide.maxIndex = guide.index; guide.cardKey = ''; renderGuideStep();`);
  const nl = w.document.querySelector('[data-tour="nextlesson"]');
  check('bulle finale : bouton vers la leçon suivante', !!nl && /Passer à la leçon 2 : Mode embranchement vertical/.test(nl.textContent));
  w.eval(`guide.lessonId = 'branching'; guide.cardKey = ''; renderGuideStep();`);
  check('dernière leçon : pas de bouton « leçon suivante »', !w.document.querySelector('[data-tour="nextlesson"]'));
  // Glisser simulé : relâcher sur la zone dépose ; la vignette apparaît quand l'exemple est prêt.
  zone.getBoundingClientRect = () => ({ left: 100, top: 100, right: 300, bottom: 160, width: 200, height: 60 });
  const inside = w.eval(`lessonPointInZone({ selector: '#__sampleZone' }, 150, 120)`);
  const outside = w.eval(`lessonPointInZone({ selector: '#__sampleZone' }, 500, 500)`);
  check('zone de dépôt : point dedans / dehors', inside === true && outside === false);
  w.eval(`guide.lessonId = 'static'; guide.index = 4; guide.maxIndex = 4; guide.cardKey = ''; renderGuideStep();`);
  check('étape de dépôt : vignette du fichier d’exemple présente', !!w.document.querySelector('[data-tour="chip"]'));
  check('étape de dépôt : plus de bouton « Utiliser le fichier d’exemple »', !w.document.querySelector('[data-tour="sample"]'));
  check('étape de dépôt : la vignette est atteignable au clavier', w.document.querySelector('[data-tour="chip"]').getAttribute('tabindex') === '0');
  check('pendant une leçon : bulles d’aide au survol masquées', w.document.body.classList.contains('lp-guide-active'));
  // Flèche de la 31e mesure : même échelle que la timeline (durée / temps), 30 mesures de 4 temps à 120 BPM.
  const arrowX = w.eval(`(function () {
    const ruler = document.createElement('div'); ruler.className = 'loop-timeline-ruler';
    ruler.getBoundingClientRect = () => ({ left: 100, top: 400, right: 1100, bottom: 440, width: 1000, height: 40 });
    const host = document.createElement('div'); host.id = 'libraryDetail'; host.appendChild(ruler); document.body.appendChild(host);
    library = [{ id: 'tt', duration: 70, bpm: 120, beatsPerBar: 4 }]; manageLibrarySelectedId = 'tt';
    const p = lessonArrowPoint(31); host.remove(); return p;
  })()`);
  // 70 s à 120 BPM = 140 temps ; la 31e mesure commence au temps 120 : 120/140 de la largeur.
  check('flèche : placée sur la barre de la 31e mesure', arrowX && Math.abs(arrowX.x - (100 + 1000 * 120 / 140)) < 0.01 && arrowX.y === 400);
  // Étape d'écoute : le clic sur « Écouter » n'avance plus ; « Suivant » n'apparaît qu'après le clic, et c'est lui qui avance.
  const listenIdx = w.eval(`LESSONS.find(l => l.id === 'static').steps.findIndex(x => x.listen)`);
  w.eval(`guide.lessonId = 'static'; guide.index = ${listenIdx}; guide.maxIndex = ${listenIdx}; guide.clicked = false; guide.advancing = false; guide.cardKey = ''; renderGuideStep();`);
  check('écoute : pas de « Suivant » avant le clic', !w.document.querySelector('[data-tour="next"]'));
  w.eval(`guide.clicked = true; guideTick();`);
  await new Promise(r => setTimeout(r, 700));
  check('écoute : après le clic, la leçon n’avance pas toute seule', w.eval('guide.index') === listenIdx);
  check('écoute : « Suivant » apparaît après le clic', !!w.document.querySelector('[data-tour="next"]'));
  // (Les étapes « supprime le morceau d'essai » ont été retirées le 20/10 : le tutoriel se joue sans compte, rien n'est enregistré.)
  // Écoute : après le clic sur « Écouter », la surbrillance passe au lecteur qui vient de s'ouvrir.
  const hl = w.eval(`(function () {
    const st = LESSONS.find(l => l.id === 'static').steps.find(x => x.listen);
    const btn = document.createElement('button'); btn.setAttribute('data-action', 'preview-track');
    const host = document.createElement('div'); host.id = 'libraryDetail';
    const player = document.createElement('div'); player.setAttribute('data-role', 'previewHost'); player.textContent = 'lecteur';
    player.getBoundingClientRect = () => ({ left: 0, top: 0, right: 500, bottom: 120, width: 500, height: 120 });
    host.append(btn, player); document.body.appendChild(host);
    guide.clicked = false; const before = guideStepTarget(st) === btn;
    guide.clicked = true; const after = guideStepTarget(st) === player;
    host.remove(); return { before, after };
  })()`);
  check('écoute : avant le clic la surbrillance est sur « Écouter »', hl.before === true);
  check('écoute : après le clic la surbrillance passe au lecteur', hl.after === true);
  // Bulle déplaçable : saisie hors boutons, position conservée tant qu'on reste sur l'étape, réinitialisée à l'étape suivante.
  const mv = w.eval(`(function () {
    const card = guide.root.querySelector('.tour-card');
    card.getBoundingClientRect = () => ({ left: 200, top: 120, right: 520, bottom: 400, width: 320, height: 280 });
    Object.defineProperty(card, 'offsetWidth', { value: 320, configurable: true });
    Object.defineProperty(card, 'offsetHeight', { value: 280, configurable: true });
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 250, clientY: 150, button: 0 });
    card.querySelector('.tour-title').dispatchEvent(down);
    const moved = guide.userMoved;
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 450, clientY: 300 }));
    const pos = { left: card.style.left, top: card.style.top };
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 450, clientY: 300 }));
    renderGuideStep(true);
    const kept = { left: card.style.left, top: card.style.top };
    guideGo(1);
    return { moved, pos, kept, resetOnNext: guide.userMoved };
  })()`);
  check('bulle : saisie puis déplacement suivent la souris', mv.moved === true && mv.pos.left === '400px' && mv.pos.top === '270px');
  check('bulle : la position est conservée tant qu’on reste sur l’étape', mv.kept.left === '400px' && mv.kept.top === '270px');
  check('bulle : retour au placement automatique à l’étape suivante', mv.resetOnNext === false);
  // Thèmes du menu et leçons publiques (version sans compte).
  const th = w.eval(`(function () {
    const ids = LESSON_THEMES.map(t => t.id);
    return { ids, allThemed: LESSONS.every(l => ids.includes(l.theme)), pub: LESSONS.filter(lessonIsPublic).map(l => l.id), total: LESSONS.length };
  })()`);
  check('3 thèmes : moteur audio, pitch, préproduction', th.ids.join() === 'engine,pitch,preprod');
  check('chaque leçon appartient à un thème', th.allThemed === true);
  check('toutes les leçons sont ouvertes sans compte (le tutoriel se joue toujours en mode sans compte)', th.pub.length === th.total);
  w.eval(`myFlags = { in_app_lessons: true }; renderTutorialMenu();`);
  // Sections (21/10) : titre + sous-titre coupés au « : », plus visibles que l'étiquette « Leçons » et que les leçons.
  const heads = [...w.document.querySelectorAll('#tutorialMenuList .tutorial-menu-section')].map(x => x.querySelector('strong').textContent + ' : ' + (x.querySelector('small') ? x.querySelector('small').textContent : '')).join('|');
  check('menu : leçons groupées par thème (moteur audio, AdReel, préproduction)', /moteur audio : Uploader de la musique interactive/.test(heads) && /Pitcher de la musique : Envoyer de la musique à un studio/.test(heads) && /Découvrir les outils de collaboration studio\/compositeur/.test(heads)
    && w.document.querySelectorAll('#tutorialMenuList .tutorial-menu-lesson').length > 0);
  // Échap quitte.
  w.eval(`guide.index = 7; guide.advancing = false; guide.cardKey = ''; renderGuideStep();`); // « Vérifie les infos » : étape manuelle
  check('bouton « Suivant » sur une étape manuelle', !!w.document.querySelector('[data-tour="next"]'));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Échap ferme la leçon', !w.document.querySelector('.tour-root'));
  check('après la leçon : bulles d’aide au survol rétablies', !w.document.body.classList.contains('lp-guide-active'));
  dom.window.close();
  process.exit(failures ? 1 : 0);
})();
