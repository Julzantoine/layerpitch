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
  check('menu Tutoriel caché par défaut', /id="tutorialMenuWrap" hidden/.test(page));
  ['btnTutorialMenu', 'tutorialMenuDropdown', 'tutorialMenuList', 'btnAddLibraryTrack', 'btnPublish', 'libraryDetail'].forEach(id => check('élément ' + id + ' présent', page.includes('id="' + id + '"')));
  ['data-field="mode"', 'data-role="staticFileCtrl"', 'data-field="loopable"', 'data-field="loopEngine"', 'data-role="loopTimelineHost"', 'data-action="preview-track"']
    .forEach(a => check('cible de leçon ' + a + ' présente dans les sources', page.includes(a)));

  // Moteur : la leçon avance toute seule quand le geste est fait.
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window;
  w.eval(`
    document.querySelector('.nav-item[data-tab="library"]').hidden = false;
    var __r = { lessons: LESSONS.length, soon: LESSONS.filter(l => l.soon).length };
    startLesson('static');
    window.__r = __r;
  `);
  check('6 leçons déclarées, 5 « bientôt »', w.__r.lessons === 6 && w.__r.soon === 5);
  check('la leçon ouvre une bulle', !!w.document.querySelector('.tour-root-lesson .tour-card'));
  check('étape 1 sur 11', /1 \/ 11/.test(w.document.querySelector('.tour-count').textContent));
  // Geste : l'onglet bibliothèque devient actif -> étape 2 (après le délai d'avance).
  w.eval(`document.querySelector('.backstage-panel[data-panel="library"]').classList.add('active');`);
  for (let i = 0; i < 40 && !/2 \/ 11/.test((w.document.querySelector('.tour-count') || {}).textContent || ''); i++) await new Promise(r => setTimeout(r, 100));
  check('avance seule à l’étape 2', /2 \/ 11/.test((w.document.querySelector('.tour-count') || {}).textContent || ''));
  // « Passer l’étape » existe sur une étape automatique, et Échap quitte.
  check('bouton « Passer l’étape »', !!w.document.querySelector('[data-tour="next"]'));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Échap ferme la leçon', !w.document.querySelector('.tour-root'));
  dom.window.close();
  process.exit(failures ? 1 : 0);
})();
