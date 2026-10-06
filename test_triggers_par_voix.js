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

  // --- intro, outro, transitions (7/10) ---
  check('cibles du lecteur : intro / outro / transition reconnues, comme les voix',
    core.fxTargetKeyFromTarget({ type: 'intro' }) === 'intro' && core.fxTargetKeyFromTarget({ type: 'outro' }) === 'outro' && core.fxTargetKeyFromTarget({ type: 'transition' }) === 'transition'
    && core.fxTargetKeyFromTarget({ type: 'layer', li: 2 }) === 'layer:2' && core.fxTargetKeyFromTarget({ type: 'bidon' }) === null);
  const stage = { fxTriggers: [], mode: 'sequential', segmentSlots: [{ id: 'S0', label: 'A', alternatives: [{}] }] };
  const vals = m => ev(`fxTriggerTargetChoices({ mode: '${m}', layers: [], loops: [], segmentSlots: [], sections: [] }).map(c => c.value).join(',')`);
  check('choix de cible : séquentiel = intro, outro, transitions', /intro,outro,transition/.test(vals('sequential')));
  check('choix de cible : vertical-random = intro, outro', /intro,outro/.test(vals('vertical-random')) && !/transition/.test(vals('vertical-random')));
  check('choix de cible : embranchement-vertical = transitions', /transition/.test(vals('embranchement-vertical')) && !/intro/.test(vals('embranchement-vertical')));
  check('choix de cible : vertical = couches seulement (pas d\'intro ni de transition)', !/intro|outro|transition/.test(vals('vertical')));
  check('aller-retour cible <-> valeur : intro, outro, transition', ['intro', 'outro', 'transition'].every(v => ev(`fxTriggerTargetToValue(parseFxTriggerTarget('${v}'))`) === v));
  // éditeur : sections de triggers sous l'effet de l'intro, de l'outro et des transitions
  ev("library[2].intro = { id: 'i', label: 'Intro', file: 'i.ogg', bars: 2, fx: null }; library[2].outro = { id: 'o', label: 'Outro', file: 'o.ogg', fx: null }; library[2].segmentSlots[0].nextOptions = [{ targetId: 'S1', label: 'vers B', transition: { id: 'tr1', label: 'T', file: 't.ogg', bars: 2, fx: null } }];");
  await show('s', 'seqIntro');
  check('séquentiel, intro : « + Trigger » ciblé sur l\'intro', addBtns().some(x => x.dataset.target === 'intro'));
  click(addBtns().find(x => x.dataset.target === 'intro')); await settle();
  check('…le trigger vise l\'intro', ev('library[2].fxTriggers.some(t => t.target.type === "intro")'));
  await show('s', 'seqOutro');
  check('séquentiel, outro : « + Trigger » ciblé sur l\'outro', addBtns().some(x => x.dataset.target === 'outro'));
  await show('s', 0);
  check('séquentiel, transition d\'embranchement : « + Trigger » ciblé sur les transitions', addBtns().some(x => x.dataset.target === 'transition'));
  click(addBtns().find(x => x.dataset.target === 'transition')); await settle();
  check('…le trigger vise toutes les transitions', ev('library[2].fxTriggers.some(t => t.target.type === "transition")'));
  ev("library[1].loops[1].transition = { id: 'tt', label: 'X', file: 'x.ogg', fx: null };");
  await show('e', 1);
  check('embranchement-vertical, transition : « + Trigger » ciblé sur les transitions', addBtns().some(x => x.dataset.target === 'transition'));
  ev("library[3].intro = { id: 'vi', label: 'Intro', file: 'vi.ogg', bars: 2, fx: null }; library[3].outro = { id: 'vo', label: 'Outro', file: 'vo.ogg', fx: null };");
  await show('r', 'vrsIntro');
  check('vertical-random, intro : « + Trigger » ciblé sur l\'intro', addBtns().some(x => x.dataset.target === 'intro'));
  await show('r', 'vrsOutro');
  check('vertical-random, outro : « + Trigger » ciblé sur l\'outro', addBtns().some(x => x.dataset.target === 'outro'));
  // cascade : les étapes d'un trigger d'intro visent l'intro
  const fi = core.expandTriggerSteps([{ id: 'T', target: { type: 'intro' }, fx: { lowcut: {} }, steps: [{ id: 's', delaySec: 1, fx: {} }] }]);
  check('cascade d\'un trigger d\'intro : les étapes visent l\'intro', fi[1].target.type === 'intro');
  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
