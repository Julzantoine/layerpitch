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
  ['lessonSampleDownload', 'lsVerifyTitle', 'lsVerifyText', 'lessonSampleSoon', 'lessonDoIt', 'lessonQuit', 'lessonSkipStep', 'tutorialMenuTitle', 'tutorialTourDesc', 'tutorialLessonsHeading'].forEach(k => keys.add(k));
  ['fr', 'en'].forEach(l => check('textes présents en ' + l + ' (' + keys.size + ' clés)', [...keys].every(k => sb.window.LAYERPITCH_I18N[l].backstage[k])));

  const page = read('layerpitch-backstage.html');
  check('feu vert in_app_lessons déclaré en base', read('supabase/migrations/20261008070000_in_app_lessons_flag.sql').includes("'in_app_lessons'"));
  check('menu Tutoriel piloté par in_app_lessons, visite par in_app_tour', /function lessonsAccessOpen\(\) \{ return flagOpen\('in_app_lessons'\)/.test(src) && /lessonsOpen = lessonsAccessOpen\(\)/.test(src) && /flagOpen\('in_app_tour'\)/.test(src));
  check('menu Tutoriel caché par défaut', /id="tutorialMenuWrap" hidden/.test(page));
  ['btnTutorialMenu', 'tutorialMenuDropdown', 'tutorialMenuList', 'btnAddLibraryTrack', 'btnPublish', 'libraryDetail'].forEach(id => check('élément ' + id + ' présent', page.includes('id="' + id + '"')));
  ['data-field="mode"', 'data-role="staticFileCtrl"', 'data-field="loopable"', 'data-field="loopEngine"', 'data-role="loopTimelineHost"', 'data-action="preview-track"', 'data-role="modeMaster"', 'data-role="previewHost"', 'data-role="fxSlidersHost"', 'data-role="vrsPools"', 'data-action="add-section"', 'data-action="add-pool"', 'data-section-field="bpm"', 'data-seq-key="seqIntro"', 'data-seq-key="seqOutro"', 'data-seq-key="trackinfo"', 'data-action="add-segment-slot"', 'data-role="segmentSlotsMaster"', 'data-field="introBars"', 'data-field="introBeatsPerBar"', 'data-slot-field="repeatCount"']
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
    var __r = { lessons: LESSONS.length, soon: LESSONS.filter(l => l.soon).length, add: (LESSONS.find(l => l.id === 'additive').steps || []).length, rnd: (LESSONS.find(l => l.id === 'random').steps || []).length, seq: (LESSONS.find(l => l.id === 'sequential').steps || []).length };
    startLesson('static');
    window.__r = __r;
  `);
  check('leçon refusée tant que in_app_lessons est fermé', w.__closed === true);
  check('6 leçons déclarées, 2 « bientôt » (4 construites)', w.__r.lessons === 6 && w.__r.soon === 2);
  check('leçon 4 : 18 étapes', w.__r.seq === 18);
  check('leçon 3 : 13 étapes', w.__r.rnd === 13);
  check('leçon 2 : 13 étapes', w.__r.add === 13);
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
  // « Passer l’étape » existe sur une étape automatique, et Échap quitte.
  check('bouton « Suivant » sur une étape manuelle', !!w.document.querySelector('[data-tour="next"]'));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Échap ferme la leçon', !w.document.querySelector('.tour-root'));
  dom.window.close();
  process.exit(failures ? 1 : 0);
})();
