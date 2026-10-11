// Morceau « couches aléatoires » (08/10) : le tempo d'une section est lu dans le nom du fichier déposé sur un pool,
// seulement si la section n'avait encore aucun fichier.
const { loadBackstage } = require('./scripts/test-harness.js');
(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  const apply = w.eval('applySectionTempoFromFileNames');
  const has = w.eval('sectionHasAnyFile');
  const s1 = { bpm: 120, pools: [{ alternatives: [{ label: '', remoteFile: null, pendingFile: null }] }] };
  check('section vide : aucun fichier', has(s1) === false);
  check('tempo 90 lu dans le nom', apply(s1, [{ name: 'couche_90bpm.wav' }], has(s1)) === 90 && s1.bpm === 90);
  check('temps par mesure par défaut : 4', s1.beatsPerBar === 4);
  const s2 = { bpm: 100, pools: [{ alternatives: [{ pendingFile: {} }] }] };
  check('section déjà garnie : tempo inchangé', apply(s2, [{ name: 'autre_140bpm.wav' }], has(s2)) === null && s2.bpm === 100);
  const s3 = { bpm: 120, pools: [] };
  check('nom sans tempo : inchangé', apply(s3, [{ name: 'variante.wav' }], false) === null && s3.bpm === 120);
  check('premier nom avec tempo retenu', (apply(s3, [{ name: 'a.wav' }, { name: 'b_80bpm.wav' }], false), s3.bpm === 80));
  dom.window.close();
  process.exit(failures ? 1 : 0);
})();
