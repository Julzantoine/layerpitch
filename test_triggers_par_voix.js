// Triggers partout (7/10) : chaque voix (couche, boucle, emplacement, pool) porte ses propres triggers -- cartes complètes (réglages,
// effets, cascade, relations) et « + Trigger » préréglé sur la voix ; le morceau entier n'est plus proposé à la création, ses anciens
// triggers restent visibles et se rattachent à une voix. Le vrai Backstage dans jsdom, les quatre modes.
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window, doc = w.document, ev = c => w.eval(c);
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const settle = () => new Promise(r => setTimeout(r, 30));
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const data = { library: [
    { id: 'v', title: 'Vertical', mode: 'vertical', base: 'https://m/v/', layers: [{ id: 'l0', label: 'Basse', file: 'a.ogg' }, { id: 'l1', label: 'Batterie', file: 'b.ogg' }],
      fxTriggers: [{ id: 'old', label: 'Ancien', target: { type: 'track' }, fx: { lowcut: { frequency: 150 } }, visible: true }] },
    { id: 'e', title: 'Embr', mode: 'embranchement-vertical', base: 'https://m/e/', loops: [{ id: 'L0', label: 'L0', file: 'l0.ogg', bars: 4, isInitial: true }, { id: 'L1', label: 'L1', file: 'l1.ogg', bars: 4 }] },
    { id: 's', title: 'Seq', mode: 'sequential', base: 'https://m/s/', segmentSlots: [{ id: 'S0', label: 'A', alternatives: [{ id: 'a0', file: 'a.ogg' }] }, { id: 'S1', label: 'B', alternatives: [{ id: 'a1', file: 'b.ogg' }] }] },
    { id: 'r', title: 'Rand', mode: 'vertical-random', base: 'https://m/r/', sections: [{ id: 'SEC', label: 'S', pools: [{ id: 'P', alternatives: [{ file: 'p.ogg' }] }] }] },
  ], packs: [], collections: [], sfxLibrary: [], socials: [], adReels: [], customFonts: [] };
  w.fetchSiteData = async () => JSON.parse(JSON.stringify(data));
  ev("currentUserIsAdmin = true; myFlags = new Proxy({}, { get: () => true }); myEntitlements = new Proxy({}, { get: () => ({ allowed: true, level: 'saved', amount: null }) });");
  await ev('loadData(true)'); await settle();
  const show = async (id, sel) => { ev(`manageLibrarySelectedId = '${id}'; ${sel !== undefined ? `seqSelectedSlotIndex.set('${id}', ${JSON.stringify(sel)});` : ''} renderLibrary();`); await settle(); };
  const addBtns = () => [...doc.querySelectorAll('[data-action="add-fx-trigger"][data-target]')];

  // --- vertical : une section « Triggers de cette voix » par couche ---
  await show('v', 0);
  let b = addBtns();
  check('vertical : un « + Trigger » préréglé sur la couche affichée', b.length >= 1 && b.some(x => x.dataset.target === 'layer:0'));
  click(b.find(x => x.dataset.target === 'layer:0')); await settle();
  const t = ev('library[0].fxTriggers');
  check('création : le trigger vise la couche 0 (pas le morceau entier)', t.length === 2 && t[1].target.type === 'layer' && t[1].target.li === 0);
  check('le bouton « + Trigger » du morceau entier a disparu', !doc.querySelector('[data-action="add-fx-trigger"]:not([data-target])'));
  check('la section de la voix montre la carte du nouveau trigger, avec son sélecteur « Agit sur »', !!doc.querySelector('select[data-fxt-prop="target"][data-tri="1"]'));
  // l'ancien trigger « morceau entier » reste visible (panneau Infos du morceau) et se rattache à une voix
  ev("seqSelectedSlotIndex.delete('v'); manageLibrarySelectedId = 'v'; renderLibrary();"); await settle();
  const old = doc.querySelector('select[data-fxt-prop="target"][data-tri="0"]');
  check('ancien trigger « morceau entier » : visible, proposé comme « Tout le morceau »', !!old && /Tout le morceau \(ancien\)/.test(old.innerHTML));
  old.value = 'layer:1'; old.dispatchEvent(new w.Event('input', { bubbles: true })); old.dispatchEvent(new w.Event('change', { bubbles: true })); await settle();
  check('rattacher l\'ancien trigger à la couche 1 : la cible suit', ev('library[0].fxTriggers[0].target.type') === 'layer' && ev('library[0].fxTriggers[0].target.li') === 1);
  check('…et le panneau Infos le signale comme rattaché à une voix', /rattach/.test(doc.body.textContent));
  // la voix 1 affiche le trigger rattaché, pas la voix 0
  await show('v', 1);
  check('couche 1 : porte le trigger rattaché (sélecteur sur sa carte)', !!doc.querySelector('select[data-fxt-prop="target"][data-tri="0"]'));
  await show('v', 0);
  check('couche 0 : ne porte que le sien', !doc.querySelector('select[data-fxt-prop="target"][data-tri="0"]') && !!doc.querySelector('select[data-fxt-prop="target"][data-tri="1"]'));

  // --- les trois autres modes ---
  await show('e', 1);
  check('embranchement-vertical : « + Trigger » sur la boucle', addBtns().some(x => x.dataset.target === 'loop:1'));
  click(addBtns().find(x => x.dataset.target === 'loop:1')); await settle();
  check('…le trigger vise la boucle 1', ev('library[1].fxTriggers[0].target.type') === 'loop' && ev('library[1].fxTriggers[0].target.li') === 1);
  await show('s', 1);
  check('séquentiel : « + Trigger » sur l\'emplacement', addBtns().some(x => x.dataset.target === 'slot:1'));
  click(addBtns().find(x => x.dataset.target === 'slot:1')); await settle();
  check('…le trigger vise l\'emplacement 1', ev('library[2].fxTriggers[0].target.type') === 'slot' && ev('library[2].fxTriggers[0].target.si') === 1);
  await show('r', 0);
  check('vertical-random : « + Trigger » sur le pool', addBtns().some(x => x.dataset.target === 'pool:0:0'));
  click(addBtns().find(x => x.dataset.target === 'pool:0:0')); await settle();
  check('…le trigger vise le pool', ev('library[3].fxTriggers[0].target.type') === 'pool' && ev('library[3].fxTriggers[0].target.pi') === 0);

  // --- cascade et durées disponibles dans la carte d'une voix ---
  await show('v', 0);
  check('carte d\'une voix : cascade (« Ajouter une étape »), réglages et relations', !!doc.querySelector('[data-action="add-fx-step"][data-tri="1"]') && !!doc.querySelector('[data-fxt-prop="autoOffSec"][data-tri="1"]'));
  // publication : les cibles partent avec les triggers
  const snap = ev('buildDataSnapshot("pro", 1)');
  check('publication : triggers par voix envoyés avec leur cible', snap.library[0].fxTriggers[1].target.type === 'layer' && snap.library[3].fxTriggers[0].target.type === 'pool');
  // lecteur : un trigger de voix agit sur la voix (cible exploitée)
  const core = w.LayerPlayerCore;
  const flat = core.expandTriggerSteps([{ id: 'T', target: { type: 'layer', li: 0 }, fx: { lowcut: {} }, steps: [{ id: 's', delaySec: 1, fx: { reverb: {} } }] }]);
  check('cascade d\'un trigger de voix : les étapes visent la même voix', flat.length === 2 && flat[1].target.type === 'layer' && flat[1].target.li === 0);

  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
