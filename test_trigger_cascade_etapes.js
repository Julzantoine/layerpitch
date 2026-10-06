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
  check('éditeur : section Cascade avec le bouton « Ajouter une étape »', count('[data-action="add-fx-step"]:not([data-sti])') === 1);
  click(doc.querySelector('[data-action="add-fx-step"]:not([data-sti])')); await settle();
  check('ajout : une étape est créée, dépliée', ev('library[0].fxTriggers[0].steps.length') === 1 && /^<details|<details[^>]*\sopen/.test((doc.querySelector('details[data-fxt-section-key^="s:"]') || { outerHTML: '' }).outerHTML.slice(0, 200)));
  click(doc.querySelector('[data-action="add-fx-step"]:not([data-sti])')); await settle();
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
  click(doc.querySelector('[data-action="remove-fx-step"][data-sti="1"]')); await settle();
  check('retrait : une étape en moins', ev('library[0].fxTriggers[0].steps.length') === 1);
  click(doc.querySelector('[data-action="remove-fx-step"][data-sti="0"]')); await settle();
  check('retrait de la dernière : plus de champ « steps »', ev('library[0].fxTriggers[0].steps') === undefined && ev('buildDataSnapshot("pro", 1)').library[0].fxTriggers[0].steps === undefined);


  // --- étapes enfants (délai compté depuis l'étape mère) ---
  ev("library[0].fxTriggers[0].steps = [{ id: 'a', delaySec: 2, fx: { bitcrush: { bits: 6, reduction: 6 } } }]; renderLibrary();"); await settle();
  click(doc.querySelector('[data-action="add-fx-step"][data-sti="0"]')); await settle();
  check('enfant : ajouté sous l\'étape 1', ev('library[0].fxTriggers[0].steps[0].children.length') === 1);
  input(doc.querySelector('[data-fxs-prop="delaySec"][data-sti="0.0"]'), '3');
  check('enfant : délai 3 s compté depuis l\'étape mère', ev('library[0].fxTriggers[0].steps[0].children[0].delaySec') === 3);
  const kidCrush = doc.querySelector('[data-fx-target="trstep"][data-sti="0.0"][data-fx-effect="reverb"][data-fx-param="enabled"]');
  kidCrush.checked = true; kidCrush.dispatchEvent(new w.Event('input', { bubbles: true })); await settle();
  check('enfant : son propre bloc d\'effets', !!ev('library[0].fxTriggers[0].steps[0].children[0].fx.reverb'));
  const pk = ev('buildDataSnapshot("pro", 1)').library[0].fxTriggers[0];
  check('publication : l\'enfant part avec son étape', pk.steps[0].children.length === 1 && pk.steps[0].children[0].delaySec === 3 && !!pk.steps[0].children[0].fx.reverb);
  const flat2 = core.expandTriggerSteps([{ id: 'T', target: { type: 'track' }, fx: {}, steps: pk.steps }]);
  const ch2 = core.simulateTriggerRules(flat2, [{ t: 0, id: 'T', active: true, source: 'visitor' }, { t: 20, id: 'T', active: false, source: 'visitor' }]);
  const on2 = id => ch2.filter(c => c.id === id && c.active).map(c => c.t)[0];
  const kidId = flat2.find(k => k.stepOf && k.stepOf !== 'T').id;
  check('moteur : étape à 2 s, enfant à 2 + 3 = 5 s (départ cumulé 5)', on2(flat2[1].id) === 2 && on2(kidId) === 5 && flat2.find(k => k.id === kidId).startSec === 5);
  check('moteur : tout s\'éteint avec le trigger', ch2.filter(c => !c.active).length === 3);
  const cutKid = core.simulateTriggerRules(flat2, [{ t: 0, id: 'T', active: true, source: 'visitor' }, { t: 3, id: 'T', active: false, source: 'visitor' }]);
  check('moteur : coupé à 3 s, l\'enfant prévu à 5 s n\'a jamais lieu', !cutKid.some(c => c.id === kidId && c.active));
  click(doc.querySelector('[data-action="remove-fx-step"][data-sti="0.0"]')); await settle();
  check('retrait de l\'enfant : plus de champ « children »', ev('library[0].fxTriggers[0].steps[0].children') === undefined);

  // --- case « afficher au public » (cochée par défaut) et pastilles ---
  const showBox = () => doc.querySelector('[data-fxt-prop="showEffects"]');
  check('case « afficher les effets au public » : cochée par défaut', !!showBox() && showBox().checked === true);
  showBox().checked = false; showBox().dispatchEvent(new w.Event('input', { bubbles: true })); await settle();
  check('décochée : le modèle et la publication en tiennent compte', ev('library[0].fxTriggers[0].showEffects') === false && ev('buildDataSnapshot("pro", 1)').library[0].fxTriggers[0].showEffects === false);
  const trk = (sh) => ({ fxTriggers: [{ id: 'T', label: 'Low life', target: { type: 'track' }, visible: true, showEffects: sh, fx: { lowcut: { frequency: 150 } }, steps: [{ id: 'a', delaySec: 2, fx: { bitcrush: { bits: 6 } }, children: [{ id: 'b', delaySec: 3, fx: { reverb: {}, delay: {} } }] }] }] });
  const chipsHtml = sh => core.fxEffectChipsHtml(trk(sh), trk(sh).fxTriggers);
  const h = chipsHtml(undefined);
  check('public : une pastille par effet (parent, étape, enfant)', (h.match(/class="fx-chip"/g) || []).length === 4 && /Low cut/.test(h) && /Bitcrusher/.test(h) && /Reverb/.test(h) && /Écho/.test(h));
  check('public : les pastilles d\'étapes annoncent leur départ (+2 s, +5 s)', /\+2 s/.test(h) && /\+5 s/.test(h));
  check('public : showEffects=false -> aucune pastille', chipsHtml(false) === '');

  // --- durées indépendantes (7/10) : la fin d'un effet ne rend pas inaudibles ceux qui suivent ---
  const onT = (chs, id) => chs.filter(c => c.id === id && c.active).map(c => c.t);
  const offT = (chs, id) => chs.filter(c => c.id === id && !c.active).map(c => c.t);
  const base = { id: 'R', target: { type: 'track' }, fx: { lowcut: { frequency: 150 } }, visible: true, relations: { autoOffSec: 3 } };
  // (a) effet du parent 3 s, étape à +5 s qui dure 4 s : on l'entend bien de 5 à 9 s
  const fa = core.expandTriggerSteps([Object.assign({}, base, { steps: [{ id: 'x', delaySec: 5, durationSec: 4, fx: { bitcrush: {} } }] })]);
  const ca = core.simulateTriggerRules(fa, [{ t: 0, id: 'R', active: true, source: 'visitor' }]);
  check('parent 3 s + étape à +5 s : l\'étape démarre quand même à 5 s', JSON.stringify(onT(ca, 'R~x')) === '[5]');
  check('…les effets propres du parent s\'arrêtent à 3 s (étape « self »), pas l\'étape', JSON.stringify(offT(ca, 'R~self')) === '[3]' && JSON.stringify(offT(ca, 'R~x')) === '[9]');
  check('…toutes les durées connues : le trigger se termine seul à 9 s', JSON.stringify(offT(ca, 'R')) === '[9]');
  check('…le trigger lui-même ne porte plus d\'effet (ils sont dans « self »)', fa[0].fx && Object.keys(fa[0].fx).length === 0 && fa.some(k => k.isSelf && k.fx.lowcut));
  // (b) une étape sans durée : le trigger dure jusqu'au second appui
  const fb = core.expandTriggerSteps([Object.assign({}, base, { steps: [{ id: 'x', delaySec: 5, fx: { bitcrush: {} } }] })]);
  const cb = core.simulateTriggerRules(fb, [{ t: 0, id: 'R', active: true, source: 'visitor' }, { t: 20, id: 'R', active: false, source: 'visitor' }]);
  check('étape sans durée : elle dure jusqu\'au second appui, le trigger aussi', JSON.stringify(onT(cb, 'R~x')) === '[5]' && JSON.stringify(offT(cb, 'R~x')) === '[20]' && JSON.stringify(offT(cb, 'R')) === '[20]');
  check('…et les effets propres du parent ont bien fini à 3 s', JSON.stringify(offT(cb, 'R~self')) === '[3]');
  // (c) une étape qui s'arrête ne coupe pas son enfant (départ cumulé : 2 + 4 = 6 s, alors que l'étape mère finit à 5 s)
  const fc = core.expandTriggerSteps([{ id: 'R', target: { type: 'track' }, fx: {}, visible: true, steps: [{ id: 'm', delaySec: 2, durationSec: 3, fx: {}, children: [{ id: 'k', delaySec: 4, durationSec: 2, fx: { reverb: {} } }] }] }]);
  const cc = core.simulateTriggerRules(fc, [{ t: 0, id: 'R', active: true, source: 'visitor' }, { t: 30, id: 'R', active: false, source: 'visitor' }]);
  check('étape mère de 2 à 5 s, enfant à +4 s (donc 6 s) : l\'enfant joue après la fin de sa mère', JSON.stringify(offT(cc, 'R~m')) === '[5]' && JSON.stringify(onT(cc, 'R~m~k')) === '[6]' && JSON.stringify(offT(cc, 'R~m~k')) === '[8]');
  // (d) coupé à la main avant : tout s'arrête, rien de prévu n'a lieu
  const cd = core.simulateTriggerRules(fa, [{ t: 0, id: 'R', active: true, source: 'visitor' }, { t: 4, id: 'R', active: false, source: 'visitor' }]);
  check('second appui à 4 s : l\'étape prévue à 5 s n\'a jamais lieu', onT(cd, 'R~x').length === 0);
  // (e) sans durée propre : comportement inchangé (effets sur le trigger, pas d'étape « self »)
  const fe = core.expandTriggerSteps([{ id: 'R', target: { type: 'track' }, fx: { lowcut: {} }, steps: [{ id: 'x', delaySec: 1, fx: {} }] }]);
  check('sans durée propre : pas d\'étape « self », le trigger garde ses effets', !fe.some(k => k.isSelf) && !!fe[0].fx.lowcut);
  // éditeur : durée de l'étape
  ev("library[0].fxTriggers[0].steps = [{ id: 'q', delaySec: 1, fx: {} }]; renderLibrary();"); await settle();
  const dur = doc.querySelector('[data-fxs-prop="durationSec"][data-sti="0"]');
  check('éditeur : champ « Dure (s) » par étape, vide par défaut', !!dur && dur.value === '');
  input(dur, '4');
  check('durée de l\'étape enregistrée et publiée', ev('library[0].fxTriggers[0].steps[0].durationSec') === 4 && ev('buildDataSnapshot("pro", 1)').library[0].fxTriggers[0].steps[0].durationSec === 4);
  input(dur, '');
  check('champ vidé : plus de durée (jusqu\'à la fin)', ev('library[0].fxTriggers[0].steps[0].durationSec') === undefined);
  // Hiérarchie visuelle : plus l'étape est éloignée, plus elle est décalée ; même délai = même niveau ; ordre d'affichage = ordre de départ
  const lv = ev("fxStepLevels([{ id: 'a', delaySec: 5 }, { id: 'b', delaySec: 0 }, { id: 'c', delaySec: 2 }, { id: 'd', delaySec: 2 }]).map(x => x.st.id + x.level).join(',')");
  check('niveaux : 0 s -> 1, 2 s -> 2 (partagé), 5 s -> 3, affichés dans l\'ordre du temps', lv === 'b1,c2,d2,a3');
  ev("library[0].fxTriggers[0].steps = [{ id: 'x', delaySec: 5, fx: {} }, { id: 'y', delaySec: 0, fx: {} }]; renderLibrary();"); await settle();
  const lvls = [...doc.querySelectorAll('details[data-fx-step-level]')].map(d => d.dataset.fxStepLevel + ':' + d.style.marginLeft);
  check('rendu : l\'étape à 0 s d\'abord (niveau 1, 18px), celle à 5 s ensuite (niveau 2, 36px)', lvls.join(',') === '1:18px,2:36px');
  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
