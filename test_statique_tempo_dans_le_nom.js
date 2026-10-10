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
  dom.window.close();
  process.exit(failures ? 1 : 0);
})();
