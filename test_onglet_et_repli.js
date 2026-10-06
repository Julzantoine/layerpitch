// Backstage : l'onglet ouvert est retenu au rafraîchissement (sessionStorage) et la section « Triggers » est fermée par défaut,
// avec mémoire de ce qu'on ouvre (localStorage). Le vrai Backstage dans jsdom.
const { loadBackstage } = require('./scripts/test-harness.js');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; }

(async () => {
  const dom = await loadBackstage();
  const w = dom.window, doc = w.document;
  const run = code => w.eval(code);

  // Onglet retenu
  run("switchTab('library')");
  check('ouvrir un onglet le mémorise', w.sessionStorage.getItem('lp_backstage_tab') === 'library');
  run("switchTab('content')");
  run("restoreBackstageTab()");
  check('onglet « content » : rien à restaurer', doc.querySelector('.backstage-panel[data-panel="content"]').classList.contains('active'));
  w.sessionStorage.setItem('lp_backstage_tab', 'library');
  run("restoreBackstageTab()");
  check('au rafraîchissement : retour sur la bibliothèque musicale', doc.querySelector('.backstage-panel[data-panel="library"]').classList.contains('active')
    && doc.querySelector('.nav-item[data-tab="library"]').classList.contains('active'));
  w.sessionStorage.setItem('lp_backstage_tab', 'nexistepas');
  run("restoreBackstageTab()");
  check('onglet inconnu : on ne casse rien', doc.querySelector('.backstage-panel[data-panel="library"]').classList.contains('active'));

  // Section Triggers (fonctionnalité ouverte pour ce test)
  run('fxOpen = () => true');
  check('section Triggers : rien d\'ouvert au départ', run('fxTriggersSectionOpen.size') === 0);
  run("fxTriggersSectionOpen.add('t1')");
  check('clé ouverte : le rendu porte « open »', /data-fxt-section-key="t1"\s+open/.test(run("(function(){ const o = {}; return fxTriggersEditorHtml({ id: 't1', fxTriggers: [{ id: 'a', name: 'A', effects: [] }] }, 0); })()")));
  check('clé inconnue : fermée par défaut', !/data-fxt-section-key="t2"\s+open/.test(run("fxTriggersEditorHtml({ id: 't2', fxTriggers: [{ id: 'a', name: 'A', effects: [] }] }, 0)")));

  // Chaque trigger se replie séparément : fermé par défaut, ouvert si retenu ; un trigger sans nom est numéroté dans les relations
  const two = "{ id: 't3', fxTriggers: [{ id: 'a', label: 'Low life', fx: { highcut: { frequency: 3000, slope: 24 } } }, { id: 'b', label: '', fx: {} }] }";
  const cardsOpen = () => run(`fxTriggersEditorHtml(${two}, 0)`).match(/<details class="list-block"[^>]*>/g) || [];
  run("fxTriggersSectionOpen.clear(); fxTriggersSectionOpen.add('t3')");
  check('deux triggers : deux cartes repliables, fermées par défaut', cardsOpen().length === 2 && cardsOpen().every(c => !/\sopen/.test(c)));
  run("fxTriggersSectionOpen.add('c:b')");
  check('carte retenue ouverte : seule celle-là s\'ouvre', cardsOpen().filter(c => /\sopen/.test(c)).length === 1 && /data-fxt-section-key="c:b"[^>]*open/.test(cardsOpen()[1]));
  check('événement sans nom : « Événement 2 (sans nom) » dans les relations de l\'autre', /Événement 2 \(sans nom\)/.test(run(`fxTriggersEditorHtml(${two}, 0)`)));
  check('le titre de la carte porte le nom du trigger', /<summary[^>]*>Low life/.test(run(`fxTriggersEditorHtml(${two}, 0)`)));
  console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
