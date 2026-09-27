const { loadBackstage } = require('./scripts/test-harness.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const { window } = dom;
  const doc = window.document;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
  function setValue(el, value) { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); }
  const q = sel => doc.querySelector(sel);

  click(q('#btnAddLibraryTrack'));

  // ---- vertical-random ----
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'vertical-random');
  check('vertical-random : plus de select loopEngine (champ mort retiré)', !q('select[data-field="loopEngine"][data-ti="0"]'));
  check('vertical-random : plus de select maxLoops au niveau morceau (champ mort retiré)', !q('select[data-field="maxLoops"][data-ti="0"]'));
  check('vertical-random : select maxChainLoops présent', !!q('select[data-field="maxChainLoops"][data-ti="0"]'));
  setValue(q('select[data-field="maxChainLoops"][data-ti="0"]'), '3');
  // Force un re-rendu (changement de mode puis retour) pour vérifier que la valeur a bien été
  // écrite dans le modèle de données, pas seulement laissée telle quelle sur l'élément DOM.
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'vertical-random');
  check('vertical-random : maxChainLoops persiste après re-rendu (bien écrit dans le modèle)', q('select[data-field="maxChainLoops"][data-ti="0"]').value === '3');

  // ---- sequential ----
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');
  check('sequential : select maxChainLoops présent', !!q('select[data-field="maxChainLoops"][data-ti="0"]'));
  check('sequential : BPM/mesures toujours présents (pas cassés par le fix)', !!q('input[data-field="bpm"][data-ti="0"]'));
  setValue(q('select[data-field="maxChainLoops"][data-ti="0"]'), '5');
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'vertical-random');
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');
  check('sequential : maxChainLoops persiste après re-rendu (bien écrit dans le modèle)', q('select[data-field="maxChainLoops"][data-ti="0"]').value === '5');

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
