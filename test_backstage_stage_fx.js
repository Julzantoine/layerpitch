// Effets propres aux intros, outros et transitions (27/09, proposition d'Antoine B.2). Charge le VRAI Backstage dans
// jsdom : le réglage survit au chargement (données publiées -> Backstage), s'affiche dans les six éditeurs (intro/outro
// du séquentiel et du vertical-random, transition d'embranchement séquentiel, transition d'embranchement-vertical), se
// modifie, et repart à la publication (buildDataSnapshot). Le lecteur et l'export sont vérifiés par
// test_capture_plan.js et à l'usage (voir changelog [2026-09-27g]).
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

  // Données « publiées » : un séquentiel (intro, outro, transition) et un embranchement-vertical (transition), avec effets.
  const reverb = { mix: 0.4, decay: 2 };
  const data = {
    library: [
      { id: 'sq', title: 'Seq', mode: 'sequential', base: 'https://m/sq/',
        intro: { label: 'Intro', file: 'i.ogg', bars: 4, fx: { reverb } }, outro: { label: 'Outro', file: 'o.ogg', fx: { delay: { time: 0.3, feedback: 0.2, mix: 0.3 } } },
        segmentSlots: [{ id: 'A', label: 'A', alternatives: [{ file: 'a.ogg' }], nextOptions: [{ targetId: 'B', transition: { label: 'T', file: 't.ogg', bars: 2, fx: { lowcut: { frequency: 300, slope: 24 } } } }] },
                       { id: 'B', label: 'B', alternatives: [{ file: 'b.ogg' }] }] },
      { id: 'em', title: 'Embr', mode: 'embranchement-vertical', base: 'https://m/em/',
        loops: [{ id: 'L0', label: 'L0', file: 'l0.ogg', bars: 4, isInitial: true }, { id: 'L1', label: 'L1', file: 'l1.ogg', bars: 4, transition: { label: 'X', file: 'x.ogg', fx: { highcut: { frequency: 2000, slope: 12 } } } }] },
      { id: 'vr', title: 'VR', mode: 'vertical-random', base: 'https://m/vr/',
        intro: { label: 'Intro', file: 'vi.ogg', bars: 2, fx: { bitcrush: { bits: 8 } } }, outro: { label: 'Outro', file: 'vo.ogg', fx: null },
        sections: [{ id: 'S', label: 'S', pools: [{ id: 'P', alternatives: [{ file: 'p.ogg' }] }] }] },
    ],
    packs: [], collections: [], sfxLibrary: [], socials: [], adReels: [], customFonts: [],
  };
  w.fetchSiteData = async () => JSON.parse(JSON.stringify(data));
  ev('currentUserIsAdmin = true');
  await ev('loadData(true)'); await settle();
  const lib = ev('library');
  check('chargement : effets de l’intro et de l’outro gardés', !!(lib[0].intro.fx && lib[0].intro.fx.reverb) && !!(lib[0].outro.fx && lib[0].outro.fx.delay));
  check('chargement : effets de la transition séquentielle gardés', !!(lib[0].segmentSlots[0].nextOptions[0].transition.fx && lib[0].segmentSlots[0].nextOptions[0].transition.fx.lowcut));
  check('chargement : effets de la transition d’embranchement-vertical gardés', !!(lib[1].loops[1].transition.fx && lib[1].loops[1].transition.fx.highcut));

  // Élément affiché dans l'éditeur du morceau (liste maître) : 'seqIntro' / 'seqOutro' / index d'emplacement ou de boucle /
  // 'vrsIntro' / 'vrsOutro'.
  const show = async (id, sel) => { ev(`manageLibrarySelectedId = '${id}'; seqSelectedSlotIndex.set('${id}', ${JSON.stringify(sel)}); renderLibrary();`); await settle(); };
  const count = sel => w.document.querySelectorAll(sel).length;
  await show('sq', 'seqIntro');
  check('séquentiel : bloc Effets sur l’intro', count('[data-fx-target="intro"]') > 0);
  await show('sq', 0);
  check('séquentiel : bloc Effets sur la transition de l’embranchement', count('[data-fx-target="seqTransition"]') > 0);
  const transLowcut = w.document.querySelector('[data-fx-target="seqTransition"][data-fx-effect="lowcut"][data-fx-param="enabled"]');
  transLowcut.checked = false; transLowcut.dispatchEvent(new w.Event('input', { bubbles: true })); await settle();
  check('transition séquentielle : effet retiré -> plus de réglage', !ev('library[0].segmentSlots[0].nextOptions[0].transition.fx'));
  await show('sq', 'seqOutro');
  check('séquentiel : bloc Effets sur l’outro', count('[data-fx-target="outro"]') > 0);
  // Activer une reverb sur l'outro via la vraie case
  const outroReverb = w.document.querySelector('[data-fx-target="outro"][data-fx-effect="reverb"][data-fx-param="enabled"]');
  check('case « reverb » de l’outro présente', !!outroReverb);
  outroReverb.checked = true; outroReverb.dispatchEvent(new w.Event('input', { bubbles: true })); await settle();
  check('outro : reverb ajoutée à ses effets (delay conservé)', !!(ev('library[0].outro.fx.reverb')) && !!(ev('library[0].outro.fx.delay')));
  await show('em', 1);
  check('embranchement-vertical : bloc Effets sur la transition', count('[data-fx-target="embrTransition"]') > 0);
  await show('vr', 'vrsIntro');
  check('vertical-random : bloc Effets sur l’intro', count('[data-fx-target="intro"]') > 0);
  await show('vr', 'vrsOutro');
  check('vertical-random : bloc Effets sur l’outro', count('[data-fx-target="outro"]') > 0);

  const snap = ev('buildDataSnapshot("pro", 1)');
  const pub = id => snap.library.find(t => t.id === id);
  check('publication : effets de l’intro et de l’outro envoyés', !!pub('sq').intro.fx.reverb && !!pub('sq').outro.fx.reverb && !!pub('sq').outro.fx.delay);
  check('publication : transition d’embranchement-vertical avec ses effets', !!pub('em').loops[1].transition.fx.highcut);
  check('publication : intro du vertical-random avec ses effets', !!pub('vr').intro.fx.bitcrush);
  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
