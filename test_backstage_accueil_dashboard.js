// Accueil du Backstage (13/11, feu vert home_dashboard) : page d'arrivée avec rappels (visite, profil), question du jour,
// boîte aux lettres, cartes ; fermé = rien ne change ; la cloche mène à la boîte aux lettres ; l'aide contextuelle se coupe.
const fs = require('fs');
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage();
  const { window } = dom;
  const doc = window.document;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  const ev = code => window.eval(code);
  const wait = ms => new Promise(r => setTimeout(r, ms || 30));
  const nav = doc.getElementById('navItemHome');
  const root = () => doc.getElementById('homeRoot');
  window.localStorage.clear();
  window.open = () => null;

  // Feu vert fermé : rien ne change.
  ev("myFlags = {}; myOnboardingProfile = null;");
  ev('syncHome()');
  check('feu vert fermé : onglet Accueil caché', nav.hidden === true);
  check('feu vert fermé : homeOpen() faux', ev('homeOpen()') === false);
  check('feu vert fermé : la cloche garde son menu', ev('homeBellIntercept()') === false);
  check('feu vert fermé : le cadre Apparence du backstage reste en place', !!doc.getElementById('backstageAppearanceHost').closest('fieldset') && doc.getElementById('backstageAppearanceHost').closest('fieldset').hidden === false);
  check('feu vert fermé : Contenu reste le panneau actif', doc.querySelector('.backstage-panel.active').dataset.panel === 'content');

  // Feu vert ouvert (visite et leçons ouvertes, profil jamais répondu).
  ev("myFlags = { home_dashboard: true, in_app_tour: true, in_app_lessons: true, onboarding_profile: true }; myOnboardingProfile = null;");
  window.localStorage.removeItem('layerpitch_tour_done_v1');
  const confirms = [];
  window.LayerPitchNotify.confirm = async msg => { confirms.push(msg); return false; };
  ev('syncBackstageTour()');
  await wait(900);
  check('feu vert ouvert : onglet Accueil visible', nav.hidden === false);
  check('arrivée sur l\'Accueil', doc.querySelector('.backstage-panel.active').dataset.panel === 'home');
  check('plus de fenêtre de visite à l\'arrivée', confirms.length === 0);
  check('cadre Apparence du backstage déménagé (caché dans l\'ancien emplacement)', doc.querySelector('legend[data-i18n="backstageAppearanceLegend"]').closest('fieldset').hidden === true);
  check('l\'apparence se retrouve dans la carte Réglages rapides', !!doc.querySelector('#homeMoreHost #backstageAppearanceHost'));
  const txt = () => root().textContent;
  check('question du jour + 6 choix', /Que veux-tu faire/.test(txt()) && root().querySelectorAll('[data-home-do]').length >= 6);
  check('rappel de la visite guidée', !!root().querySelector('[data-home-reminder="tour"]'));
  check('rappel du profil', !!root().querySelector('[data-home-reminder="profile"]'));
  check('boîte aux lettres : vide au départ', /Aucun message/.test(txt()));
  check('5 cartes', root().querySelectorAll('.home-cards .home-card').length === 5);
  check('Nouveautés : toutes les entrées, la plus récente en tête, date courte', root().querySelectorAll('.home-news-item').length === 23 && /Accueil/.test(root().querySelector('.home-news-item b').textContent) && /14/.test(root().querySelector('.home-news-item small').textContent));

  // Croix de la visite : le rappel disparaît, sur le compte (ici repli navigateur).
  root().querySelector('[data-home-act="tour-dismiss"]').click();
  await wait();
  check('croix : le rappel de la visite disparaît', !root().querySelector('[data-home-reminder="tour"]'));
  check('croix : retenu', JSON.parse(window.localStorage.getItem('lp_home_prefs_v1')).tour_dismissed === true);

  // Profil répondu : le rappel disparaît et les essentiels apparaissent.
  ev("myOnboardingProfile = { role: 'composer', career: 'starting' }; renderHome();");
  check('profil répondu : plus de rappel', !root().querySelector('[data-home-reminder="profile"]'));
  check('profil répondu : leçons essentielles listées', root().querySelectorAll('.home-essential').length >= 3);
  ev("myOnboardingProfile = { skipped: true }; renderHome();");
  check('questionnaire passé : le rappel revient', !!root().querySelector('[data-home-reminder="profile"]'));

  // Fin de visite : plus de questionnaire (rappelé sur l'Accueil), le double choix d'avant reste.
  ev("myOnboardingProfile = null;");
  check('Accueil ouvert : la visite ne finit pas sur le questionnaire', !(ev('tourFinalStep()') || {}).profileQuiz);

  // Question du jour.
  root().querySelector('[data-home-do="video"]').click();
  check('« Mettre du son sur une vidéo » mène à Vidéo', doc.querySelector('.backstage-panel.active').dataset.panel === 'videoLibrary');
  ev("openTab('home')");
  root().querySelector('[data-home-do="learn"]').click();
  check('« Apprendre » ouvre la bulle', !!root().querySelector('.home-learn-pop'));
  check('bulle : au plus 4 besoins, chacun avec ses leçons', root().querySelectorAll('.home-need').length >= 3 && root().querySelectorAll('.home-need').length <= 4);
  root().querySelector('[data-home-do="learn-close"]').click();
  check('bulle refermée', !root().querySelector('.home-learn-pop'));

  // Boîte aux lettres.
  ev("homeInboxItems = [{ title: 'Bienvenue', text: 'Bonjour', unread: true, kind: 'announcement', createdAt: new Date().toISOString() }]; renderHome();");
  check('boîte aux lettres : message et non lu', /Bienvenue/.test(txt()) && !!root().querySelector('.home-mail-item.unread'));
  check('cloche : mène à la boîte de l\'Accueil', ev('homeBellIntercept()') === true && doc.querySelector('.backstage-panel.active').dataset.panel === 'home');

  // Aide contextuelle.
  const toggle = () => doc.getElementById('homeHelpToggle');
  check('aide contextuelle : active par défaut', toggle().checked === true && !doc.body.classList.contains('lp-help-off'));
  toggle().checked = false; toggle().dispatchEvent(new window.Event('change', { bubbles: true }));
  check('aide coupée : classe posée', doc.body.classList.contains('lp-help-off'));
  check('aide coupée : retenue', JSON.parse(window.localStorage.getItem('lp_home_prefs_v1')).help_off === true);

  // Personnaliser le menu.
  const menuBox = doc.querySelector('[data-home-menu="library"]');
  check('menu : la Bibliothèque est proposée', !!menuBox && !doc.querySelector('[data-home-menu="content"]'));
  menuBox.checked = false; menuBox.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('menu : entrée décochée = masquée', doc.querySelector('.nav-item[data-tab="library"]').classList.contains('nav-user-hidden'));
  check('menu : retenu', JSON.parse(window.localStorage.getItem('lp_home_prefs_v1')).menu_hidden.includes('library'));
  doc.querySelector('[data-home-menu="library"]').checked = true; doc.querySelector('[data-home-menu="library"]').dispatchEvent(new window.Event('change', { bubbles: true }));
  check('menu : recochée = de retour', !doc.querySelector('.nav-item[data-tab="library"]').classList.contains('nav-user-hidden'));

  // Continuer.
  ev("library = [{ id: 't1', title: 'Mon morceau' }]; manageLibrarySelectedId = 't1'; openTab('library'); openTab('home');");
  check('Continuer : le morceau touché est proposé', /Mon morceau/.test(txt()));

  // Mode tutoriel : pas d'Accueil.
  const dom2 = await loadBackstage({ url: 'http://localhost/test_backstage.html?tuto' });
  dom2.window.eval("myFlags = { home_dashboard: true };");
  check('mode tutoriel : pas d\'Accueil', dom2.window.eval('homeOpen()') === false);

  // Les textes existent en FR et en EN.
  const i18n = fs.readFileSync('layerpitch-i18n.js', 'utf8');
  const keys = [...fs.readFileSync('src/backstage/48-accueil.js', 'utf8').matchAll(/tr\('(home[A-Za-z0-9]+)'/g)].map(m => m[1]);
  const missing = [...new Set(keys)].filter(k => (i18n.match(new RegExp('\\b' + k + ':', 'g')) || []).length < 2);
  check('textes FR + EN pour chaque clé home* (' + missing.join(', ') + ')', missing.length === 0);

  console.log(failures ? failures + ' échec(s)' : 'Tous les tests passent.');
  process.exit(failures ? 1 : 0);
})();
