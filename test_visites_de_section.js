// Visites de section (14/11) : chaque onglet a sa mini-visite, ses zones existent, ses textes existent en FR et EN,
// la mini-visite ne vaut pas « visite générale faite », et la mémoire (feu vert + préférence) est déclarée en base.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const mod = read('src/backstage/43a-visites-de-section.js');
const tour = read('src/backstage/43-visite-guidee.js');
const page = read('layerpitch-backstage.html');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(read('layerpitch-i18n.js'), sandbox);
const I18N = sandbox.window.LAYERPITCH_I18N;

const table = mod.match(/var SECTION_TOURS = \{([\s\S]*?)\n\};/)[1];
const tabs = [...table.matchAll(/^  (\w+): \{ key: '(\w+)', lesson: '([\w-]+)'(?:, example: '(\w+)')?, zones: \[(.*)\] \},?$/gm)];
check('7 sections couvertes', tabs.length === 7);
tabs.forEach(([, tab, key, lesson, example, zones]) => {
  check('onglet « ' + tab + ' » existe dans la page', page.includes('data-panel="' + tab + '"'));
  check('leçon « ' + lesson + ' » existe', new RegExp("\\{ id: '" + lesson + "'").test(tour));
  ['fr', 'en'].forEach(lang => {
    const d = I18N[lang].backstage;
    check(tab + ' : titre et texte d’ouverture en ' + lang, d[key + 'Title'] && d[key + 'Text']);
    if (example) check(tab + ' : bouton « explorer l’exemple » en ' + lang, d[key + 'Explore']);
    [...zones.matchAll(/\['([^']+)', '(\w+)'(?:, '[^']+')?\]/g)].forEach(([, , name]) => check(tab + ' : zone ' + name + ' en ' + lang, d[key + name + 'Title'] && d[key + name + 'Text']));
  });
  [...zones.matchAll(/\['([^']+)', '(\w+)'(?:, '[^']+')?\]/g)].map(m => [m[0], m[1].replace(/^example:/, '')]).forEach(([, sel]) => check('zone présente dans la page : ' + sel, page.includes('id="' + sel.slice(1) + '"') || (sel.startsWith('.') && page.includes(sel.slice(1)))));
});
['fr', 'en'].forEach(lang => {
  const d = I18N[lang].backstage;
  check('textes communs en ' + lang, ['stLearn', 'stEndTitle', 'stEndText', 'stEndTextHome'].every(k => d[k]));
  check('rappel de l’Accueil en ' + lang, /\n/.test(d.stEndTextHome));
});
check('mini-visite ≠ visite générale faite', tour.includes('if (!sectionTourOpen) tourMarkDone()') && tour.includes('sectionTourOpen = false'));
check('choix à action branché', tour.includes('choiceAction') && read('layerpitch-guide.js').includes('host.choiceAction(action)'));
check('proposée à l’ouverture d’un onglet', read('src/backstage/14a-suivi-onglets-themes.js').includes('maybeOfferSectionTour(tabName)'));
check('jamais en mode tutoriel, feu vert requis', /!isTutoMode\(\) && flagOpen\('section_tours'\)/.test(mod));
check('page fabriquée contient les visites de section', page.includes('function maybeOfferSectionTour'));
const mig = read('supabase/migrations/20261114010000_section_tours.sql');
check('feu vert déclaré en base', mig.includes("'section_tours'"));
check('préférence acceptée par set_my_home_prefs', mig.includes("k = 'section_tours_seen'"));
// Page Projets : sa propre visite, même mémoire, mêmes textes.
const proj = read('projets.html');
check('Projets : visite proposée une seule fois, hors mode tutoriel', proj.includes('function maybeOfferProjectsTour') && /projectsTourTried \|\| TUTO \|\| !myFlags\.section_tours/.test(proj));
['tourSkip', 'tourNext', 'tourPrev', 'tourClose', 'tourFinish', 'lessonMoveHint', 'lessonMoveNote'].forEach(k => ['fr', 'en'].forEach(lang => check('Projets : bouton « ' + k + ' » lisible en ' + lang + ' (dictionnaire du Backstage)', I18N[lang].backstage[k] && !I18N[lang].shared[k] && !I18N[lang].projects[k] ? proj.includes('trGuide') : !!I18N[lang].backstage[k])));
check('Projets : la bulle lit aussi le dictionnaire du Backstage', proj.includes('tr: trGuide'));
check('Projets : zone de création ciblée', proj.includes("selector: '#createBtn'") && proj.includes('id="createBtn"'));
['fr', 'en'].forEach(lang => {
  const d = I18N[lang].shared;
  check('Projets : textes en ' + lang, ['stProjectsTitle', 'stProjectsText', 'stProjectsNewTitle', 'stProjectsNewText', 'stLearn', 'stEndTitle', 'stEndText', 'stEndTextHome'].every(k => d[k]));
});
const lecons = read('projet-lecons.js');
check('Projets : visite du projet d\'exemple (pj-tour) en kind tour', lecons.includes("lessons['pj-tour']") && lecons.includes("id === 'pj-tour' ? 'tour' : 'lesson'"));
check('Projets : choix « visiter le projet d\'exemple » branché', proj.includes("action: 'example-project'") && proj.includes('demo-music-city') && proj.includes('lesson=pj-tour'));
const pjKeys = [...lecons.slice(lecons.indexOf("lessons['pj-tour']")).split("function start")[0].matchAll(/(?:titleKey|textKey|labelKey): '(st\w+)'/g)].map(m => m[1]).concat(['stProjectsVisit']);
['fr', 'en'].forEach(lang => check('Projets : textes du projet d\'exemple en ' + lang + ' (' + pjKeys.length + ' clés)', pjKeys.every(k => I18N[lang].shared[k] || I18N[lang].backstage[k])));
check('préférence fusionnée côté serveur', mig.includes('union'));

// Régression du 14/11 : au chargement, restoreBackstageTab() rouvre le dernier onglet AVANT que 43a-visites-de-section.js soit lu ; des const/let y plantaient
// tout le démarrage (« can't access lexical declaration 'SECTION_TOURS' before initialization » : Backstage vide). Les déclarations doivent être des « var »,
// et l'appel dans openTab() ne doit jamais pouvoir bloquer.
check('visites de section : déclarations sans zone morte (var)', /^var SECTION_TOURS = /m.test(mod) && /^var sectionTourOpen/m.test(mod) && !/^(const|let) (SECTION_TOURS|sectionTourOpen)\b/m.test(mod));
check('openTab : l\'offre de visite ne peut jamais bloquer le démarrage', /try \{ if \(typeof maybeOfferSectionTour === 'function'\) maybeOfferSectionTour\(tabName\); \} catch/.test(read('src/backstage/14a-suivi-onglets-themes.js')));

// Comportement réel (jsdom) : la bulle s'ouvre une seule fois à la première arrivée, finit sur les bons choix, et ne vaut pas « visite générale faite ».
(async () => {
  const { loadBackstage } = require('./scripts/test-harness.js');
  // Démarrage avec un dernier onglet mémorisé (cas réel : tout le monde sauf « Contenu ») : la page doit démarrer sans erreur.
  const errors = [];
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'], beforeParse: win => { win.localStorage.setItem('lp_backstage_tab', 'library'); win.sessionStorage.setItem('lp_backstage_tab', 'library'); win.addEventListener('error', e => errors.push(e.message)); } });
  const w = dom.window;
  check('démarrage avec un onglet mémorisé : aucune erreur (' + (errors[0] || 'ok') + ')', errors.length === 0 && w.eval(`document.querySelector('.backstage-panel.active').dataset.panel`) === 'library');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  w.eval(`window.__log = []; myFlags = { section_tours: true, in_app_lessons: true }; localStorage.clear(); library.push({ id: 'ex1', title: 'Exemple', exampleSourceId: 'src', folderId: 'fEx', modes: {} }); collapsedLibraryFolderIds.add('fEx'); openTab('library');`);
  check('rien tout de suite (l\'onglet se dessine d\'abord)', w.eval(`!document.querySelector('.tour-root')`));
  await wait(900);
  check('bulle ouverte à la première arrivée', w.eval(`!!document.querySelector('.tour-root')`));
  check('bulle d\'accueil de la section', w.eval(`document.querySelector('.tour-title').textContent`) === I18N.fr.backstage.stLibraryTitle);
  check('section notée « vue »', w.eval(`sectionToursSeen().includes('library')`));
  const total = w.eval(`guide.steps.length`);
  w.eval(`guideGo(guide.steps.length - 1 - guide.index)`);
  check('dernière bulle : choix exemple + tutoriel', w.eval(`document.querySelectorAll('.tour-choices button').length`) === 2 && total >= 2);
  check('dernière bulle : rappel de l\'Accueil seulement si l\'Accueil est ouvert', !w.eval(`document.querySelector('.tour-text').textContent`).includes('accueil'));
  w.eval(`document.querySelector('[data-action^="example:"]').click()`);
  check('« explorer l\'exemple » ouvre le morceau d\'exemple', w.eval(`manageLibrarySelectedId`) === 'ex1');
  check('« explorer l\'exemple » déplie le dossier d\'exemple', w.eval(`!collapsedLibraryFolderIds.has('fEx')`));
  check('la mini-visite ne vaut pas « visite générale faite »', w.eval(`!tourAlreadyDone()`));
  w.eval(`openTab('sfxLibrary'); openTab('library');`);
  await wait(900);
  check('jamais re-proposée', w.eval(`!document.querySelector('.tour-root')`));
  w.eval(`myFlags = { section_tours: false }; openTab('packs');`);
  await wait(900);
  check('rien sans le feu vert', w.eval(`!document.querySelector('.tour-root')`));
  process.exit(failures ? 1 : 0);
})();
