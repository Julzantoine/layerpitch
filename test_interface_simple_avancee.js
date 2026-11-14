// Interface simple / avancée (14/11, feu vert simple_advanced_ui) : les éléments data-adv sont masqués en interface simple
// (niveau de départ de tout le monde), avec un repère « N option(s) avancée(s) masquée(s) · Afficher » ; l'interrupteur de l'Accueil
// et le repère basculent ; fermé ou dans le tutoriel = rien ne change ; un élément masqué garde sa valeur (rien n'est retiré).
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage();
  const { window } = dom;
  const doc = window.document;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  const ev = code => window.eval(code);
  const wait = ms => new Promise(r => setTimeout(r, ms || 40));
  window.localStorage.clear();
  window.open = () => null;
  ev('homeDbOk = false'); // pas de base ici : repli navigateur (le compte est testé en vrai avec la migration)
  const body = doc.body;
  const btn = doc.getElementById('btnRecomputeAllNormalization');
  const hints = () => [...doc.querySelectorAll('.lp-adv-hint')];

  // Feu vert fermé : rien ne change.
  ev("myFlags = {}; homePrefs = null;");
  ev('syncHome()');
  await wait();
  check('feu vert fermé : pas de classe lp-ui-simple', !body.classList.contains('lp-ui-simple'));
  check('feu vert fermé : aucun repère', hints().length === 0);
  check('l\'élément est étiqueté data-adv', btn.hasAttribute('data-adv'));

  // Feu vert ouvert : interface simple par défaut.
  ev("myFlags = { simple_advanced_ui: true };");
  ev('syncHome()');
  await wait(120);
  check('ouvert : interface simple par défaut', body.classList.contains('lp-ui-simple') && ev('uiSimpleActive()') === true);
  check('ouvert : le bouton avancé est masqué (CSS)', /body\.lp-ui-simple \[data-adv\]\s*\{\s*display:\s*none/.test(doc.querySelector('style, link') ? ev("[...document.querySelectorAll('style')].map(s => s.textContent).join('')") : ''));
  const libHints = hints().filter(h => h.closest('[data-panel="library"]'));
  check('repère dans la Bibliothèque : 1 option avancée masquée', libHints.length === 1 && /1 option avancée masquée/.test(libHints[0].textContent));
  check('le repère vient APRÈS l\'élément masqué', libHints[0] && btn.compareDocumentPosition(libHints[0]) & 4);
  check('rien n\'est retiré : le bouton existe toujours (sa valeur par défaut s\'applique)', !!btn && btn.isConnected);

  // Tutoriel : pas de masquage.
  ev("window.__tutoBackup = isTutoMode; isTutoMode = () => true;");
  ev('applyUiLevel()');
  check('tutoriel : interface complète', !body.classList.contains('lp-ui-simple') && hints().length === 0);
  ev("isTutoMode = window.__tutoBackup;");
  ev('applyUiLevel()');
  check('hors tutoriel : de nouveau simple', body.classList.contains('lp-ui-simple'));


  // Classement validé le 14/11 (écrans fixes) : avancé masqué, visible jamais masqué.
  const advSelectors = ['#btnAddPacksBlock', '#btnAddCollectionsBlock', '#btnAddSfxBlock', '#btnAddSocialsBlock', '#embedAllowedBox', '#analyticsCustomDetails', '#analyticsRawDetails',
    '[data-video-view="review"]', '[data-video-view="settings"]', '#appAdminTierOverrideWrap', '#btnRecomputeAllNormalization'];
  advSelectors.forEach(s => check('avancé : ' + s, !!doc.querySelector(s) && doc.querySelector(s).closest('[data-adv]') !== null));
  ['#appThemeSectionLabelColor', '#appThemePlayButtonColor', '#appThemeBgImageOpacity', '#appSeparatorVisible', '#sharePreviewAutoFit', '#sharePreviewFitMode', '#skillWwise'].forEach(s =>
    check('avancé (dans un bloc) : ' + s, !!doc.querySelector(s) && doc.querySelector(s).closest('[data-adv]') !== null));
  ['#btnAddContactBlock', '#btnAddTextBlock', '#btnAddText', '#btnAddVideoBlock', '#appAllowIndexing', '#appSlug', '#appAccessMode', '#appThemeBgColor', '#appThemeTitleColor', '#appThemeFont', '#sharePreviewTitleInput',
   '#btnAddPack', '#btnAddAlbum', '#btnAddCollection', '#btnAddSocial', '#btnAddSfx', '[data-video-view="versioning"]', '[data-video-view="atelier"]', '#btnAddLibraryTrack', '#noAiCertifiedGlobal'].forEach(s => {
    const el = doc.querySelector(s);
    if (el) check('visible, jamais masqué : ' + s, el.closest('[data-adv]') === null);
  });

  check('advHtml : vide reste vide, sinon enveloppe data-adv', ev("advHtml('') === '' && advHtml('<b>x</b>').includes('data-adv')"));
  check('bloc « Effets » étiqueté avancé', ev("fxBlockHtml({}, 'data-fx-target=\"layer\" data-ti=\"0\"')").includes('data-adv'));

  // Le repère bascule en avancée, retenu (ici repli navigateur), sans repère.
  hints().filter(h => h.closest('[data-panel="library"]'))[0].querySelector('.lp-adv-show').click();
  await wait();
  check('« Afficher » : interface avancée', !body.classList.contains('lp-ui-simple') && hints().length === 0);
  check('« Afficher » : choix retenu', JSON.parse(window.localStorage.getItem('lp_home_prefs_v1')).ui_advanced === true);

  // Retour à simple par l'API de l'interrupteur (l'Accueil l'appelle).
  ev('setUiAdvanced(false)');
  await wait(120);
  check('retour à simple : masqué + repère de nouveau', body.classList.contains('lp-ui-simple') && hints().some(h => h.closest('[data-panel="library"]')));
  check('retour à simple : retenu', JSON.parse(window.localStorage.getItem('lp_home_prefs_v1')).ui_advanced === false);

  // Interrupteur dans l'Accueil (Réglages rapides).
  ev("myFlags = { home_dashboard: true, simple_advanced_ui: true }; renderHome();");
  const seg = doc.querySelectorAll('#homeRoot [data-home-ui]');
  check('Accueil : interrupteur Interface Simple / Avancée', seg.length === 2 && seg[0].classList.contains('on'));
  seg[1].click();
  await wait();
  check('Accueil : « Avancée » affiche tout', !body.classList.contains('lp-ui-simple'));
  check('Accueil : l\'interrupteur suit', doc.querySelector('#homeRoot [data-home-ui="advanced"]').classList.contains('on'));

  // Feu vert refermé : on revient à tout afficher.
  ev("myFlags = {}; syncHome();");
  await wait();
  check('feu vert refermé : plus de masquage', !body.classList.contains('lp-ui-simple') && hints().length === 0);

  console.log(failures ? failures + ' échec(s)' : 'Tous les tests passent.');
  process.exit(failures ? 1 : 0);
})();
