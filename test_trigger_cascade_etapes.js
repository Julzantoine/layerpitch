// Cascade par étapes (6/10) : un trigger porte des étapes (effets + « après N s », 0 = simultané). Fonction pure d'expansion,
// moteur de règles (temps simulé, comme l'export vidéo) et éditeur dans le vrai Backstage (ajout, réglage, publication, retrait).
const { loadBackstage } = require('./scripts/test-harness.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window;
  const ev = code => w.eval(code);
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const settle = () => new Promise(r => setTimeout(r, 20));

  const data = { library: [{ id: 'tk', title: 'T', mode: 'vertical', base: 'https://m/tk/', layers: [{ label: 'L', file: 'l.ogg' }],
    fxTriggers: [{ id: 'T', label: 'Low life', target: { type: 'track' }, fx: { lowcut: { frequency: 150, slope: 24 } }, visible: true, fadeSec: 1, steps: [] }] }],
    packs: [], collections: [], sfxLibrary: [], socials: [], adReels: [], customFonts: [] };
  w.fetchSiteData = async () => JSON.parse(JSON.stringify(data));
  ev("currentUserIsAdmin = true; myFlags = new Proxy({}, { get: () => true }); myEntitlements = new Proxy({}, { get: () => ({ allowed: true, level: 'saved', amount: null }) });");
  await ev('loadData(true)'); await settle();

  // --- fonction pure + moteur de règles ---
  const core = w.LayerPlayerCore;
  const trg = { id: 'T', label: 'Low life', target: { type: 'track' }, fx: { lowcut: { frequency: 150 } }, visible: true, fadeSec: 1, relations: { autoOffSec: 0 },
    steps: [{ id: 's1', delaySec: 2, fx: { bitcrush: { bits: 6, reduction: 6 } } }, { id: 's2', delaySec: 0, fx: { reverb: { decay: 2, wet: 0.3 } } }, { id: 's3', delaySec: 5, fx: { delay: { time: 0.3, feedback: 0.35, wet: 0.25 } } }] };
  const plain = { id: 'P', fx: {}, target: { type: 'track' } };
  const flat = core.expandTriggerSteps([trg, plain]);
  check('expansion : le parent + 3 étapes + le trigger sans étape (inchangé)', flat.length === 5 && flat[4] === plain);
  check('expansion : étapes invisibles, même cible, mêmes fondus', flat.slice(1, 4).every(k => k.visible === false && k.target.type === 'track' && k.fadeSec === 1));
  check('expansion : le parent « Active aussi » chaque étape avec son délai', JSON.stringify(flat[0].relations.activates.map(a => a.delaySec)) === '[2,0,5]');
  check('expansion : le trigger d\'origine n\'est pas modifié', !trg.relations.activates);
  const changes = core.simulateTriggerRules(flat, [{ t: 0, id: 'T', active: true, source: 'visitor' }, { t: 10, id: 'T', active: false, source: 'visitor' }]);
  const at = (id, on) => changes.filter(c => c.id === id && c.active === on).map(c => c.t);
  check('moteur : le trigger part à 0 s', JSON.stringify(at('T', true)) === '[0]');
  check('moteur : étape 1 à 2 s, étape 2 en même temps que le trigger, étape 3 à 5 s',
    JSON.stringify(at('T~s1', true)) === '[2]' && JSON.stringify(at('T~s2', true)) === '[0]' && JSON.stringify(at('T~s3', true)) === '[5]');
  check('moteur : tout s\'arrête avec le trigger (10 s)', ['T', 'T~s1', 'T~s2', 'T~s3'].every(id => JSON.stringify(at(id, false)) === '[10]'));
  const cut = core.simulateTriggerRules(flat, [{ t: 0, id: 'T', active: true, source: 'visitor' }, { t: 1, id: 'T', active: false, source: 'visitor' }]);
  check('moteur : coupé avant l\'échéance, les étapes en attente n\'ont jamais lieu', !cut.some(c => c.id === 'T~s1' && c.active) && !cut.some(c => c.id === 'T~s3' && c.active));

  // --- éditeur ---
  const doc = w.document, count = sel => doc.querySelectorAll(sel).length;
  const show = async () => { ev("manageLibrarySelectedId = 'tk'; renderLibrary();"); await settle(); };
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const input = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  await show();
  check('éditeur : section Cascade avec le bouton « Ajouter une étape »', count('[data-action="add-fx-step"]') === 1);
  click(doc.querySelector('[data-action="add-fx-step"]')); await settle();
  check('ajout : une étape est créée, dépliée', ev('library[0].fxTriggers[0].steps.length') === 1 && /^<details|<details[^>]*\sopen/.test((doc.querySelector('details[data-fxt-section-key^="s:"]') || { outerHTML: '' }).outerHTML.slice(0, 200)));
  click(doc.querySelector('[data-action="add-fx-step"]')); await settle();
  check('ajout : la 2e étape reprend le délai de la précédente', ev('library[0].fxTriggers[0].steps.length') === 2 && ev('library[0].fxTriggers[0].steps[1].delaySec') === 0);
  const delay = doc.querySelectorAll('[data-fxs-prop="delaySec"]')[0];
  input(delay, '2');
  check('délai de l\'étape 1 : 2 s dans le modèle', ev('library[0].fxTriggers[0].steps[0].delaySec') === 2);
  input(doc.querySelectorAll('[data-fxs-prop="label"]')[0], 'Écrasé');
  check('nom de l\'étape enregistré', ev('library[0].fxTriggers[0].steps[0].label') === 'Écrasé');
  const crush = doc.querySelector('[data-fx-target="trstep"][data-sti="0"][data-fx-effect="bitcrush"][data-fx-param="enabled"]');
  check('chaque étape a son propre bloc d\'effets', !!crush);
  crush.checked = true; crush.dispatchEvent(new w.Event('input', { bubbles: true })); await settle();
  check('bitcrusher activé dans l\'étape 1 (pas dans le trigger)', !!ev('library[0].fxTriggers[0].steps[0].fx.bitcrush') && !ev('library[0].fxTriggers[0].fx.bitcrush'));
  const snap = ev('buildDataSnapshot("pro", 1)');
  const pt = snap.library[0].fxTriggers[0];
  check('publication : les étapes partent avec le trigger (délai, nom, effets)', pt.steps.length === 2 && pt.steps[0].delaySec === 2 && pt.steps[0].label === 'Écrasé' && !!pt.steps[0].fx.bitcrush);
  click(doc.querySelectorAll('[data-action="remove-fx-step"]')[1]); await settle();
  check('retrait : une étape en moins', ev('library[0].fxTriggers[0].steps.length') === 1);
  click(doc.querySelector('[data-action="remove-fx-step"]')); await settle();
  check('retrait de la dernière : plus de champ « steps »', ev('library[0].fxTriggers[0].steps') === undefined && ev('buildDataSnapshot("pro", 1)').library[0].fxTriggers[0].steps === undefined);

  // Hiérarchie visuelle : plus l'étape est éloignée, plus elle est décalée ; même délai = même niveau ; ordre d'affichage = ordre de départ
  const lv = ev("fxStepLevels([{ id: 'a', delaySec: 5 }, { id: 'b', delaySec: 0 }, { id: 'c', delaySec: 2 }, { id: 'd', delaySec: 2 }]).map(x => x.st.id + x.level).join(',')");
  check('niveaux : 0 s -> 1, 2 s -> 2 (partagé), 5 s -> 3, affichés dans l\'ordre du temps', lv === 'b1,c2,d2,a3');
  ev("library[0].fxTriggers[0].steps = [{ id: 'x', delaySec: 5, fx: {} }, { id: 'y', delaySec: 0, fx: {} }]; renderLibrary();"); await settle();
  const lvls = [...doc.querySelectorAll('details[data-fx-step-level]')].map(d => d.dataset.fxStepLevel + ':' + d.style.marginLeft);
  check('rendu : l\'étape à 0 s d\'abord (niveau 1, 18px), celle à 5 s ensuite (niveau 2, 36px)', lvls.join(',') === '1:18px,2:36px');
  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
