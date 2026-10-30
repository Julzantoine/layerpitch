// Tutoriel impossible à rater (30/10, retours de bêta) : bouton « Tutoriel » écrit en toutes lettres, accueil tant que la bibliothèque
// est vide (nouveau compte compris), masquable.
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage();
  const { window } = dom;
  const doc = window.document;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  const ev = code => window.eval(code);
  const box = doc.getElementById('backstageWelcome');
  const opened = [];
  window.open = url => { opened.push(url); return null; };
  window.localStorage.removeItem('layerpitch_welcome_dismissed_v1');

  check('bouton Tutoriel : texte visible', /Tutori/.test(doc.getElementById('btnTutorialMenu').textContent));
  check('accueil masqué avant le chargement', box.hidden === true);

  // Nouveau compte : aucune donnée en base.
  ev('fetchSiteData = async () => null;');
  await ev('loadData(true)');
  check('nouveau compte : accueil affiché', box.hidden === false);
  check('accueil visible sur l\'onglet ouvert par défaut', !box.closest('.backstage-panel'));

  doc.getElementById('btnWelcomeTuto').click();
  check('le bouton ouvre la première leçon en mode tutoriel', opened.length === 1 && /\?tuto&lesson=static/.test(opened[0]));

  // Catalogue avec un morceau : plus d'accueil, et il suit les changements de la bibliothèque.
  ev(`fetchSiteData = async () => ({ library: [{ id: 't1', title: 'Morceau', mode: 'static' }], adReels: [{ id: 'main', label: 'P', trackIds: ['t1'], blocks: [] }] });`);
  await ev('loadData(true)');
  check('un morceau en bibliothèque : accueil masqué', box.hidden === true);
  ev('library.length = 0; renderLibrary();');
  check('bibliothèque revidée : accueil de retour', box.hidden === false);

  doc.getElementById('btnWelcomeDismiss').click();
  check('« Plus tard » : masqué', box.hidden === true);
  ev('renderLibrary();');
  check('« Plus tard » : reste masqué', box.hidden === true);

  // Première connexion : une fenêtre propose la visite, une seule fois.
  const confirms = [];
  let answer = true;
  window.LayerPitchNotify.confirm = async msg => { confirms.push(msg); return answer; };
  const wait = () => new Promise(r => setTimeout(r, 700));
  ev("flagOpen = k => k === 'in_app_tour'; startBackstageTour = () => { window.__tourStarted = (window.__tourStarted || 0) + 1; };");
  window.localStorage.removeItem('layerpitch_tour_done_v1');
  ev('syncBackstageTour(); syncBackstageTour();');
  await wait();
  check('première connexion : une seule fenêtre', confirms.length === 1);
  check('accepter lance la visite', window.__tourStarted === 1);
  answer = false; confirms.length = 0;
  ev('tourOffered = false; syncBackstageTour();');
  await wait();
  check('refuser ne lance pas la visite', window.__tourStarted === 1 && confirms.length === 1);
  check('refuser : mémorisé', window.localStorage.getItem('layerpitch_tour_done_v1') === '1');
  confirms.length = 0;
  ev('tourOffered = false; syncBackstageTour();');
  await wait();
  check('connexion suivante : plus de fenêtre', confirms.length === 0);

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
