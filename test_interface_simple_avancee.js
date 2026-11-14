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

  // Recherche rapide : un réglage masqué reste trouvable ; le choisir passe en avancée et ouvre son onglet.
  ev("myFlags = { simple_advanced_ui: true, quick_search: true }; setUiAdvanced(false);");
  await wait(60);
  const qsItems = ev('quickSearchItems()');
  const qsRecompute = qsItems.find(i => i.kind === 'setting' && /Recalculer le niveau/.test(i.label));
  check('recherche rapide : « Recalculer le niveau… » proposé comme réglage avancé', !!qsRecompute);
  check('recherche rapide : filtré par quelques lettres', ev("quickSearchFilter('recalc')").some(i => i.kind === 'setting'));
  qsRecompute.run();
  await wait(150);
  check('recherche rapide : le choisir passe en interface avancée', !body.classList.contains('lp-ui-simple'));
  check('recherche rapide : ouvre l\'onglet Bibliothèque', doc.querySelector('.backstage-panel.active').dataset.panel === 'library');
  check('recherche rapide : en avancé, plus de réglage proposé en double', !ev('quickSearchItems()').some(i => i.kind === 'setting'));
  ev('setUiAdvanced(false)');
  await wait(60);

  // Atelier vidéo (page à part dans un cadre) : éléments avancés étiquetés, niveau reçu du Backstage, repère qui demande « avancée ».
  const fs = require('fs');
  const cap = fs.readFileSync('src/atelier/18-panneau-de-capture.js', 'utf8'), fri = fs.readFileSync('src/atelier/15-frise-edition.js', 'utf8'), atCss = fs.readFileSync('src/atelier/02b-styles-atelier.css', 'utf8');
  ['id="videoCaptureHideImageBtn"', 'id="videoAltPropagate"', 'id="videoAltRefBtn"', 'id="videoCaptureKeepOldLabel"', 'id="atelierExportCredit"', 'id="atelierExportKeepOld"'].forEach(s => {
    const i = cap.indexOf(s); const start = Math.max(cap.lastIndexOf('<label', i), cap.lastIndexOf('<button', i));
    check('Atelier : avancé ' + s, i > 0 && cap.slice(start, i + s.length).includes('data-adv'));
  });
  check('Atelier : pistes FX, curseurs et Tête étiquetées avancé', (fri.match(/vct-lane vct-lane-nested" data-adv/g) || []).length === 3);
  check('Atelier : ducking d\'un stinger avancé', /video-capture-duck-label" data-adv/.test(fri));
  check('Atelier : crédit compositeur reste coché par défaut (case cachée cochée)', /id="videoCaptureCreditCheckbox" checked hidden/.test(cap));
  check('Atelier : reçoit le niveau (uiLevel) du Backstage', /type !== 'uiLevel'/.test(cap) && /body\.lp-ui-simple \[data-adv\]/.test(atCss));
  check('Atelier : le repère demande l\'interface avancée au Backstage', /type: 'uiAdvanced'/.test(cap));
  const bs = fs.readFileSync('src/backstage/49-interface-simple-avancee.js', 'utf8');
  check('Backstage : envoie le niveau au cadre de l\'Atelier et écoute « uiAdvanced »', /type: 'uiLevel'/.test(bs) && /type !== 'uiAdvanced'/.test(bs));

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

// ---- Page Projets (14/11) : lit le même choix, masque data-adv et l'onglet Activité ----
{
  const fs2 = require('fs');
  const pj = fs2.readFileSync(require('path').join(__dirname, 'projet.html'), 'utf8');
  const carte = fs2.readFileSync(require('path').join(__dirname, 'projet-carte.js'), 'utf8');
  const must = (c, m) => { if (!c) { console.error('ÉCHEC : ' + m); process.exit(1); } };
  must(/body\.lp-ui-simple \[data-adv\]/.test(pj), 'projet.html : règle CSS de masquage');
  must(/simple_advanced_ui/.test(pj) && /ui_advanced/.test(pj), 'projet.html : flag + préférence');
  must(/!\(t === 'activity' && S\.uiSimple\)/.test(pj), 'projet.html : onglet Activité masqué en simple');
  must(/await loadUiLevel\(\)/.test(pj), 'projet.html : niveau chargé au démarrage');
  must((pj.match(/data-adv/g) || []).length >= 8, 'projet.html : éléments étiquetés');
  must(/data-adv id="lmLinkSec"/.test(carte) && /data-adv id="lmDetach"/.test(carte), 'projet-carte.js : étiquettes');
  console.log('Projets : lecture du niveau simple/avancée OK');
}
