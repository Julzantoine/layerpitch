// Événements à plusieurs cibles (7/10, « un événement agit sur plusieurs voix, comme dans Wwise ») : un événement se crée UNE fois,
// dans les infos du morceau ; ses effets visent une ou plusieurs voix (ou « Toutes les voix », l'intro, l'outro, les transitions),
// et chaque étape de la cascade peut choisir ses propres cibles. Le vrai Backstage dans jsdom + le moteur de règles (temps simulé).
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window, doc = w.document, ev = c => w.eval(c);
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const settle = () => new Promise(r => setTimeout(r, 30));
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const tick = (el, on) => { el.checked = on; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const data = { library: [
    { id: 'v', title: 'Vertical', mode: 'vertical', base: 'https://m/v/', layers: [{ id: 'l0', label: 'Basse', file: 'a.ogg' }, { id: 'l1', label: 'Batterie', file: 'b.ogg' }, { id: 'l2', label: 'Voix', file: 'c.ogg' }],
      fxTriggers: [{ id: 'old', label: 'Ancien', target: { type: 'layer', li: 1 }, fx: { lowcut: { frequency: 150 } }, visible: true }] },
    { id: 's', title: 'Seq', mode: 'sequential', base: 'https://m/s/', segmentSlots: [{ id: 'S0', label: 'A', alternatives: [{ id: 'a0', file: 'a.ogg' }] }] },
    { id: 'e', title: 'Embr', mode: 'embranchement-vertical', base: 'https://m/e/', loops: [{ id: 'L0', label: 'L0', file: 'l0.ogg', bars: 4, isInitial: true }] },
  ], packs: [], collections: [], sfxLibrary: [], socials: [], adReels: [], customFonts: [] };
  w.fetchSiteData = async () => JSON.parse(JSON.stringify(data));
  ev("currentUserIsAdmin = true; myFlags = new Proxy({}, { get: () => true }); myEntitlements = new Proxy({}, { get: () => ({ allowed: true, level: 'saved', amount: null }) });");
  await ev('loadData(true)'); await settle();
  const info = async (id) => { ev(`seqSelectedSlotIndex.delete('${id}'); manageLibrarySelectedId = '${id}'; renderLibrary();`); await settle(); };
  const box = (owner, value, tri, sti) => doc.querySelector(`[data-field="fxTargets"][data-fxtg-owner="${owner}"][data-fxtg-value="${value}"][data-tri="${tri}"]${sti != null ? `[data-sti="${sti}"]` : ''}`);
  const core = w.LayerPlayerCore;

  // --- un seul endroit : les infos du morceau ---
  await info('v');
  check('« + Événement » dans les infos du morceau (une fois, pas par voix)', doc.querySelectorAll('[data-action="add-fx-trigger"]').length === 1);
  await ev("seqSelectedSlotIndex.set('v', 0); renderLibrary();"); await settle();
  check('plus de section « Événements » sous chaque voix', doc.querySelectorAll('[data-action="add-fx-trigger"]').length === 0);
  await info('v');

  // --- données anciennes : cible unique conservée ---
  check('ancien événement sur la couche 2 (Batterie) : sa case est cochée, pas « Toutes les voix »', box('trigger', 'layer:1', 0).checked && !box('trigger', 'track', 0).checked);

  // --- création et choix des cibles ---
  click(doc.querySelector('[data-action="add-fx-trigger"]')); await settle();
  check('nouvel événement : « Toutes les voix » par défaut', ev('library[0].fxTriggers[1].target.type') === 'track' && box('trigger', 'track', 1).checked);
  tick(box('trigger', 'layer:0', 1), true); await settle();
  check('cocher la Basse : « Toutes les voix » se décoche', ev('JSON.stringify(library[0].fxTriggers[1].targets)') === '[{"type":"layer","li":0}]' && !box('trigger', 'track', 1).checked);
  tick(box('trigger', 'layer:2', 1), true); await settle();
  check('cocher aussi la Voix : deux cibles', ev('library[0].fxTriggers[1].targets.length') === 2 && ev('library[0].fxTriggers[1].target.li') === 0);
  tick(box('trigger', 'layer:0', 1), false); tick(box('trigger', 'layer:2', 1), false); await settle();
  check('tout décocher : retour à « Toutes les voix »', ev('JSON.stringify(library[0].fxTriggers[1].targets)') === '[{"type":"track"}]');
  tick(box('trigger', 'layer:0', 1), true); tick(box('trigger', 'layer:2', 1), true); await settle();
  check('fonction pure : cocher « Toutes les voix » efface les autres', JSON.stringify(ev("fxToggleTargetValue(['layer:0','layer:2'], 'track', true)")) === '["track"]');

  // --- cibles propres à une étape ---
  click(doc.querySelector('[data-action="add-fx-step"][data-tri="1"]:not([data-sti])')); await settle();
  const same = doc.querySelector('[data-field="fxTargets"][data-fxtg-same="1"][data-tri="1"][data-sti="0"]');
  check('étape : « Comme l\'événement » cochée par défaut, sans cibles propres', same.checked && ev('library[0].fxTriggers[1].steps[0].targets') === undefined);
  tick(same, false); await settle();
  check('décocher : l\'étape part d\'une copie des cibles de l\'événement', ev('library[0].fxTriggers[1].steps[0].targets.length') === 2);
  tick(box('step', 'layer:0', 1, '0'), false); await settle();
  check('étape : une seule voix (la Voix), choisie à part de l\'événement', ev('JSON.stringify(library[0].fxTriggers[1].steps[0].targets)') === '[{"type":"layer","li":2}]' && ev('library[0].fxTriggers[1].targets.length') === 2);
  const pub = ev('buildDataSnapshot("pro", 1)').library[0].fxTriggers[1];
  check('publication : cibles de l\'événement et de l\'étape envoyées', pub.targets.length === 2 && pub.steps[0].targets.length === 1);

  // --- choix selon le mode : intro, outro, transitions ---
  const opts = m => ev(`fxTriggerTargetChoices({ mode: '${m}', layers: [], loops: [], segmentSlots: [], sections: [] }).map(c => c.value).join(',')`);
  check('séquentiel : intro, outro, transitions', /intro,outro,transition/.test(opts('sequential')));
  check('vertical-random : intro, outro', /intro,outro/.test(opts('vertical-random')) && !/transition/.test(opts('vertical-random')));
  check('embranchement-vertical : transitions', /transition/.test(opts('embranchement-vertical')));
  check('vertical : couches seulement', !/intro|outro|transition/.test(opts('vertical')));
  await info('s'); click(doc.querySelector('[data-action="add-fx-trigger"]')); await settle();
  check('séquentiel : les cases intro / outro / transitions sont proposées', !!box('trigger', 'intro', 0) && !!box('trigger', 'outro', 0) && !!box('trigger', 'transition', 0));

  // --- moteur : une copie par cible, même départ, mêmes durées ---
  const ev1 = { id: 'R', label: 'Mur', target: { type: 'layer', li: 0 }, targets: [{ type: 'layer', li: 0 }, { type: 'layer', li: 2 }], fx: { lowcut: {} }, visible: true, relations: { autoOffSec: 3 },
    steps: [{ id: 'a', delaySec: 2, durationSec: 4, fx: { bitcrush: {} }, targets: [{ type: 'layer', li: 1 }] }, { id: 'b', delaySec: 2, fx: { reverb: {} } }] };
  const flat = core.expandTriggerSteps([ev1]);
  const byId = id => flat.find(k => k.id === id);
  check('moteur : les effets propres sont copiés sur chaque cible (R~self@0, R~self@1)', !!byId('R~self@0') && !!byId('R~self@1') && byId('R~self@0').target.li === 0 && byId('R~self@1').target.li === 2);
  check('moteur : une étape à cibles propres vise sa voix, l\'autre reprend celles de l\'événement', byId('R~a').target.li === 1 && !!byId('R~b@0') && !!byId('R~b@1'));
  check('moteur : l\'événement lui-même n\'est plus qu\'un porteur sans effet', Object.keys(byId('R').fx).length === 0);
  const ch = core.simulateTriggerRules(flat, [{ t: 0, id: 'R', active: true, source: 'visitor' }, { t: 30, id: 'R', active: false, source: 'visitor' }]);
  const on = id => ch.filter(c => c.id === id && c.active).map(c => c.t)[0];
  const off = id => ch.filter(c => c.id === id && !c.active).map(c => c.t)[0];
  check('moteur : les deux copies « self » partent à 0 s et s\'arrêtent à 3 s', on('R~self@0') === 0 && on('R~self@1') === 0 && off('R~self@0') === 3 && off('R~self@1') === 3);
  check('moteur : l\'étape à 2 s sur la Batterie dure 4 s (jusqu\'à 6 s)', on('R~a') === 2 && off('R~a') === 6);
  check('moteur : l\'étape sans durée sur les deux voix démarre à 2 s et dure jusqu\'au second appui', on('R~b@0') === 2 && on('R~b@1') === 2 && off('R~b@0') === 30);
  // sans étape, mais deux cibles : toujours scindé
  const two = core.expandTriggerSteps([{ id: 'T', target: { type: 'layer', li: 0 }, targets: [{ type: 'layer', li: 0 }, { type: 'layer', li: 1 }], fx: { lowcut: {} } }]);
  check('deux cibles sans étape : une copie par voix', two.length === 3 && two.filter(k => k.isSelf).length === 2);
  const one = core.expandTriggerSteps([{ id: 'T', target: { type: 'layer', li: 0 }, fx: { lowcut: {} } }]);
  check('une seule cible, sans étape : l\'événement est inchangé', one.length === 1 && Object.keys(one[0].fx).length === 1);
  check('cibles par défaut : à défaut de targets, l\'ancienne cible unique, sinon tout le morceau', core.triggerTargets({ target: { type: 'slot', si: 1 } })[0].type === 'slot' && core.triggerTargets({})[0].type === 'track');

  // --- côté public : une pastille par étape et par effet (pas une par voix) ---
  const html = core.fxEffectChipsHtml({ fxTriggers: [ev1] }, [ev1]);
  const chips = (html.match(/class="fx-chip"/g) || []).length;
  check('pastilles : Low cut, Bitcrusher, Reverb = 3 (malgré deux voix visées)', chips === 3);

  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
