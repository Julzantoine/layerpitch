// « Retirer l'image de fond » (1er/10) : une fois l'image de fond du thème posée, le compositeur peut la retirer. Le vrai Backstage
// dans jsdom : bouton visible seulement s'il y a une image, un clic vide l'image du thème, annule le fichier en attente, marque
// des modifications non publiées et met le fichier publié en file d'effacement (supprimé à la publication, jamais avant).
const { loadBackstage } = require('./scripts/test-harness.js');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; }

(async () => {
  const dom = await loadBackstage();
  const w = dom.window, doc = w.document;
  const run = code => w.eval(code);
  run("profile.theme = Object.assign({}, DEFAULT_THEME)"); // pas d'image
  run('fillAppearanceFields()');
  const btn = () => doc.querySelector('#appThemeBgImageCtrl [data-role="removeBgImage"]');
  check('sans image : bouton « Retirer » présent mais masqué', !!btn() && btn().hidden === true);

  run("profile.theme.bgImage = 'cmp1/theme-bg-main.jpg'; profile.theme.bgImageOriginalName = 'steampunk.jpg'; hasUnsavedEdits = false; pendingOrphanR2Keys.clear()");
  run('fillAppearanceFields()');
  check('image publiée : bouton « Retirer l\'image de fond » visible', btn().hidden === false && /Retirer l'image de fond/.test(btn().textContent));
  btn().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('clic : image et nom d\'origine vidés', run('profile.theme.bgImage') === null && run('profile.theme.bgImageOriginalName') === null);
  check('clic : modifications non publiées signalées', run('hasUnsavedEdits') === true);
  check('clic : fichier publié mis en file d\'effacement (images/…)', run("pendingOrphanR2Keys.has('images/cmp1/theme-bg-main.jpg')") === true);
  check('clic : le bouton se masque de nouveau', btn().hidden === true);

  run("themeBgImagePendingFile = new File([new Uint8Array([1])], 'neuve.png', { type: 'image/png' }); hasUnsavedEdits = false; pendingOrphanR2Keys.clear()");
  run('fillAppearanceFields()');
  check('image seulement choisie (pas encore publiée) : bouton visible', btn().hidden === false);
  btn().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('retirer une image choisie : fichier en attente annulé, rien à effacer du stockage', run('themeBgImagePendingFile') === null && run('pendingOrphanR2Keys.size') === 0);

  console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
