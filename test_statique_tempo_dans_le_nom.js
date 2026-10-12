// Morceau statique (08/10) : le tempo est lu dans le nom du fichier déposé et le titre n'en garde pas le jeton.
const { loadBackstage } = require('./scripts/test-harness.js');
(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  const fn = w.eval('applyStaticFileNameHints');
  check('fonction disponible', typeof fn === 'function');
  const t1 = { title: '', bpm: undefined };
  fn(t1, { name: 'ambiance_120bpm.wav' });
  check('tempo lu : 120', t1.bpm === 120);
  check('titre sans le jeton', t1.title === 'ambiance');
  const t2 = { title: 'Mon titre', bpm: 90 };
  fn(t2, { name: 'autre_140bpm.wav' });
  check('titre saisi jamais écrasé', t2.title === 'Mon titre');
  check('nouveau tempo pris en compte', t2.bpm === 140);
  const t3 = { title: '', bpm: 90 };
  fn(t3, { name: 'sans-tempo.wav' });
  check('sans jeton : tempo conservé', t3.bpm === 90);
  check('sans jeton : titre = nom du fichier', t3.title === 'sans tempo');
  const t4 = { title: '', bpm: undefined, beatsPerBar: 4 };
  fn(t4, { name: '1_RobotAdventure_WetDarkCave_120bpm_30M.wav' });
  check('mesures lues (_30M) : repère de sortie à 120 temps (mesure 31, temps 1)', t4.loopOutBeat === 120);
  const t5 = { title: '', loopInBeat: 8 };
  fn(t5, { name: 'ambiance_90bpm_16M.wav' });
  check('repère de sortie = entrée de boucle + mesures x temps par mesure (4 par défaut)', t5.loopOutBeat === 8 + 16 * 4);
  const t6 = { title: '', loopOutBeat: 99 };
  fn(t6, { name: 'sans-mesures_120bpm.wav' });
  check('sans « _NM » : repère de sortie inchangé', t6.loopOutBeat === 99);
  dom.window.close();
  process.exit(failures ? 1 : 0);
})();
