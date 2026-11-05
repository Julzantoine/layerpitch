// Chargement complet du Backstage (30/10, signalé par William R.) : un appel à une fonction supprimée
// (fillAllowEmbeddingField) faisait planter la fin de loadData() depuis le 26/10 : bibliothèque affichée, mais
// « Sauvegarder / publier » bloqué pour tous les comptes. Vérifie, avec un catalogue non vide :
// 1) le chargement va au bout sans erreur et le bouton de publication s'active ;
// 2) le garde-fou reste en place si les données ne peuvent pas être lues.
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage();
  const { window } = dom;
  const doc = window.document;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  const ev = code => window.eval(code);
  const btn = doc.getElementById('btnPublish');
  const logText = () => doc.getElementById('log').textContent;

  // Le garde-fou d'abord : tant qu'aucun chargement n'a réussi, une lecture en panne garde la publication bloquée.
  ev('dataLoadOk = false; fetchSiteData = async () => { throw new Error("panne simulée"); };');
  btn.disabled = false;
  await ev('loadData(true)');
  check('lecture en panne : publication bloquée', btn.disabled === true);
  check('lecture en panne : erreur affichée', logText().includes('panne simulée'));

  doc.getElementById('log').textContent = '';
  ev(`fetchSiteData = async () => ({
    publishedAt: 1,
    library: [{ id: 't1', title: 'Morceau', mode: 'static' }],
    packs: [{ id: 'p1', title: 'Pack', trackIds: ['t1'] }],
    collections: [{ id: 'c1', title: 'Collection', packIds: ['p1'] }],
    socials: [],
    adReels: [{ id: 'main', label: 'Principal', trackIds: ['t1'], blocks: [] }],
  });`);
  await ev('loadData(true)');
  check('catalogue non vide : aucune erreur', !/not defined|is not a function|Cannot read/.test(logText()));
  check('catalogue non vide : chargement terminé', ev('dataLoadOk') === true);
  check('catalogue non vide : publication active', btn.disabled === false);

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
