// Le choix d'un fichier un par un (« Choisir un WAV ») lit le tempo et les mesures du nom, comme le dépôt groupé (21/10) :
// variation d'un emplacement séquentiel et transition d'un embranchement. Une valeur déjà saisie n'est jamais écrasée.
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window;
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };

  const slot = {}, alt = { bars: 8 };
  w.applySeqAltFileNameHints(slot, alt, { name: 'Synth city_4M_110bpm.wav' });
  check('variation : mesures lues dans le nom', alt.bars === 4);
  check('variation : tempo repris pour l\'emplacement sans tempo', slot.bpm === 110);
  const slot2 = { bpm: 90 }, alt2 = { bars: 8 };
  w.applySeqAltFileNameHints(slot2, alt2, { name: 'x_4M_110bpm.wav' });
  check('variation : tempo déjà réglé conservé', slot2.bpm === 90);
  const alt3 = { bars: 8 };
  w.applySeqAltFileNameHints({}, alt3, { name: 'sans_jeton.wav' });
  check('variation : sans jeton, rien ne change', alt3.bars === 8);

  const tr1 = { bars: 4 };
  w.applySeqTransitionFileNameHints(tr1, { name: 'Disco City_1M_110bpm.wav' });
  check('transition : mesures, tempo et unité posés', tr1.bars === 1 && tr1.bpm === 110 && tr1.durationUnit === 'bars');
  const tr2 = { bars: 4, bpm: 100, durationUnit: 'seconds', durationSeconds: 3 };
  w.applySeqTransitionFileNameHints(tr2, { name: 'a_1M_110bpm.wav' });
  check('transition : tempo et unité déjà saisis conservés', tr2.bpm === 100 && tr2.durationUnit === 'seconds');
  const tr3 = { bars: 4 };
  w.applySeqTransitionFileNameHints(tr3, { name: 'sans_jeton.wav' });
  check('transition : sans jeton, rien ne change', tr3.bars === 4 && !tr3.bpm && !tr3.durationUnit);

  process.exit(failures ? 1 : 0);
})();
