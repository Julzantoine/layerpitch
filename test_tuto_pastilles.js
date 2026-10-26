// Ouverture du tutoriel aux bêta-testeurs (23/10) : seules les leçons du moteur audio sont ouvertes (les autres, grisées « bientôt », restent
// jouables par les admins) ; une pastille avec le nombre de leçons restantes reste sur l'icône « Tutoriel » tant que toutes ne sont pas
// faites, et chaque leçon à faire porte sa propre pastille.
const { loadBackstage } = require('./scripts/test-harness.js');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window;
  const doc = w.document;
  w.eval(`myFlags = { in_app_lessons: true }; currentUserIsAdmin = false; localStorage.removeItem(LESSONS_DONE_STORAGE); renderTutorialMenu();`);
  const engine = w.eval(`LESSONS.filter(l => LESSON_THEMES_OPEN.includes(l.theme) && !l.soon).map(l => l.id)`);
  const others = w.eval(`LESSONS.filter(l => !(LESSON_THEMES_OPEN.includes(l.theme) && !l.soon)).map(l => l.id)`);
  const badge = () => doc.getElementById('tutorialMenuBadge');
  const lessonBtn = id => doc.querySelector('#tutorialMenuList [data-tutorial="' + id + '"]');

  check('icône Tutoriel : pastille présente dans la page', !!badge());
  check('bêta-testeur : pastille = nombre de leçons du moteur audio (' + engine.length + ')', !badge().hidden && badge().textContent === String(engine.length));
  check('bêta-testeur : chaque leçon du moteur audio est ouverte, avec sa pastille', engine.every(id => !lessonBtn(id).disabled && !!lessonBtn(id).querySelector('.tutorial-todo-dot')));
  check('bêta-testeur : les autres leçons (AdReel, préproduction) sont grisées, « bientôt », sans pastille', others.length > 0 && others.every(id => lessonBtn(id).disabled && !lessonBtn(id).querySelector('.tutorial-todo-dot') && /bientôt/.test(lessonBtn(id).textContent)));
  check('bêta-testeur : aucune de ces leçons n’est jouable', others.every(id => w.eval(`lessonPlayable(LESSONS.find(l => l.id === '${id}'))`) === false) && engine.every(id => w.eval(`lessonPlayable(LESSONS.find(l => l.id === '${id}'))`) === true));

  w.eval(`lessonMarkDone('${engine[0]}'); renderTutorialMenu();`);
  check('une leçon faite : la pastille baisse, la leçon passe au coche', badge().textContent === String(engine.length - 1) && !lessonBtn(engine[0]).querySelector('.tutorial-todo-dot') && !!lessonBtn(engine[0]).querySelector('svg'));
  w.eval(`${JSON.stringify(engine.slice(1))}.forEach(id => lessonMarkDone(id)); renderTutorialMenu();`);
  check('toutes les leçons faites : la pastille disparaît', badge().hidden);

  w.eval(`currentUserIsAdmin = true; renderTutorialMenu();`);
  const notSoon = others.filter(id => !w.eval(`!!LESSONS.find(l => l.id === '${id}').soon`));
  check('admin : les autres leçons restent jouables (sauf celles encore « bientôt » pour tous)', notSoon.length > 0 && notSoon.every(id => !lessonBtn(id).disabled));
  check('admin : la pastille ne compte que les leçons ouvertes à tous', badge().hidden);

  dom.window.close();
  process.exit(failures ? 1 : 0);
})();
