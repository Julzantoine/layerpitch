// 06/10 : dépôt de Sfx fusionné avec « + Sfx » (un fichier = un Sfx simple) et bouton global « Recalculer le niveau ».
const { loadBackstage } = require('./scripts/test-harness.js');
(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window, doc = w.document;
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const tick = () => new Promise(r => setTimeout(r, 0));

  check('l\'ancien bloc « Dépôt groupé de Sfx » a disparu', !doc.querySelector('[data-i18n="batchSfxDropLabel"]'));
  const row = doc.getElementById('btnAddSfx').parentElement;
  check('la zone de dépôt est dans la même rangée que « + Sfx »', !!row.querySelector('#sfxLibraryDrop'));

  w.eval('addSimpleSfxFromFile({ name: "Pas 1.wav" })');
  check('un fichier déposé crée un Sfx simple d\'une variation', w.eval('sfxLibrary.length') === 1 && w.eval('sfxLibrary[0].alternatives.length') === 1);
  w.eval('addSimpleSfxFromFile({ name: "Pas 2.wav" })');
  check('un 2e fichier de même famille complète le Sfx (pas de doublon)', w.eval('sfxLibrary.length') === 1 && w.eval('sfxLibrary[0].alternatives.length') === 2);

  // Bouton global
  const calls = { info: [], confirm: [] };
  w.LayerPitchNotify = { confirm: async m => { calls.confirm.push(m); return true; }, info: m => calls.info.push(m), error: m => calls.info.push('ERR ' + m) };
  const btn = doc.getElementById('btnRecomputeAllNormalization');
  check('bouton global présent', !!btn);
  btn.click(); await tick();
  check('aucun morceau coché : message dédié, aucune confirmation', calls.info.length === 1 && calls.confirm.length === 0);
  w.eval('library.push({ id: "t1", title: "T1", mode: "vertical", normalizeVolume: true, layers: [], base: "" })');
  w.eval('window.__recomputed = []; recomputeTrackNormalization = async t => { window.__recomputed.push(t.id); return { gain: 1, lufs: -20, missing: 0 }; }');
  btn.click(); await tick(); await tick(); await tick();
  check('morceau coché : confirmation puis recalcul', calls.confirm.length === 1 && w.eval('window.__recomputed').join() === 't1');
  console.log(failures ? failures + ' échec(s)' : 'Tout est vert');
  process.exit(failures ? 1 : 0);
})();
