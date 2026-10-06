// Courbe du filtre et paliers « léger / moyen / dur » (6/10) : calcul de la courbe, affichage dans le vrai éditeur, mise à jour en
// direct, et un clic sur un palier remplit les champs ET le modèle (mêmes événements que la frappe).
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
  ev("currentUserIsAdmin = true; myFlags = new Proxy({}, { get: () => true }); myEntitlements = new Proxy({}, { get: () => ({ allowed: true, level: 'saved', amount: null }) });");
  await ev('loadData(true)'); await settle();
  const near = (a, b) => Math.abs(a - b) < 0.05;
  check('courbe : au point de coupure, -3 dB (passe-bas)', near(ev("fxFilterGain('highcut', 3000, 3000, 24)"), -3.01));
  check('courbe : 24 dB/octave, une octave au-dessus, environ -24,1 dB', near(ev("fxFilterGain('highcut', 6000, 3000, 24)"), -24.1));
  check('courbe : passe-haut symétrique, une octave en dessous', near(ev("fxFilterGain('lowcut', 75, 150, 24)"), -24.1));
  check('courbe : 12 dB/octave moins raide que 48', ev("fxFilterGain('highcut', 6000, 3000, 12)") > ev("fxFilterGain('highcut', 6000, 3000, 48)"));
  check('courbe : bande passante intacte (0 dB loin de la coupure)', near(ev("fxFilterGain('highcut', 100, 10000, 24)"), 0));

  const doc = w.document, count = sel => doc.querySelectorAll(sel).length;
  ev("manageLibrarySelectedId = 'sq'; seqSelectedSlotIndex.set('sq', 0); renderLibrary();"); await settle();
  check('filtre actif : la courbe est affichée', count('[data-fx-target="seqTransition"] ~ * svg[data-fx-graph], svg[data-fx-graph="lowcut"]') > 0);
  const svg = doc.querySelector('svg[data-fx-graph="lowcut"]');
  const before = svg.innerHTML;
  const freq = svg.closest('[data-fx-box]').querySelector('[data-fx-param="frequency"]');
  freq.value = '1000'; freq.dispatchEvent(new w.Event('input', { bubbles: true })); await settle();
  check('changer la fréquence redessine la courbe en direct', svg.innerHTML !== before && /1 kHz/.test(svg.innerHTML));
  check('…et le modèle suit', ev('library[0].segmentSlots[0].nextOptions[0].transition.fx.lowcut.frequency') === 1000);
  const hard = doc.querySelector('[data-fx-presets="lowcut"] [data-fx-level="2"]');
  hard.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await settle();
  check('palier « dur » du low cut : 500 Hz dans le champ et dans le modèle', freq.value === '500' && ev('library[0].segmentSlots[0].nextOptions[0].transition.fx.lowcut.frequency') === 500);
  check('…la courbe suit, le bouton est mis en avant', /500 Hz/.test(svg.innerHTML) && hard.classList.contains('primary'));

  // Bitcrusher sur l'intro du vertical-random (bits 8, pas de reduction enregistrée)
  ev("manageLibrarySelectedId = 'vr'; seqSelectedSlotIndex.set('vr', 'vrsIntro'); renderLibrary();"); await settle();
  const hint = '[data-fx-presets="bitcrush"]';
  check('bitcrusher : trois paliers proposés', count(hint + ' [data-fx-preset]') === 3);
  doc.querySelector(hint + ' [data-fx-level="2"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await settle();
  check('bitcrusher « dur » : 3 bits, réduction 12', ev('library[2].intro.fx.bitcrush.bits') === 3 && ev('library[2].intro.fx.bitcrush.reduction') === 12);
  doc.querySelector(hint + ' [data-fx-level="0"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await settle();
  check('bitcrusher « léger » : 10 bits, réduction 2', ev('library[2].intro.fx.bitcrush.bits') === 10 && ev('library[2].intro.fx.bitcrush.reduction') === 2);
  check('modifications non publiées signalées', ev('hasUnsavedEdits') === true);
  check('paliers aussi pour reverb et écho (rendus pour un bloc neuf)', /data-fx-presets="reverb"/.test(ev("fxBlockHtml({ reverb: { decay: 2, wet: 0.3 }, delay: { time: 0.3, feedback: 0.35, wet: 0.25 } }, 'data-fx-target=\"layer\" data-ti=\"0\"')")) && /data-fx-presets="delay"/.test(ev("fxBlockHtml({ delay: { time: 0.3, feedback: 0.35, wet: 0.25 } }, 'data-fx-target=\"layer\" data-ti=\"0\"')")));
  check('palier courant reconnu (reverb moyen = 2 s / 0,3)', ev("fxPresetMatches('reverb', 1, { decay: 2, wet: 0.3 })") === true && ev("fxPresetMatches('reverb', 0, { decay: 2, wet: 0.3 })") === false);
  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
