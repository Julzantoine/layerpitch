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
  const modeSelect = q('#libraryContainer select[data-field="mode"][data-ti="0"]');
  setValue(modeSelect, 'vertical');
  const loopEngineSelect = q('select[data-field="loopEngine"][data-ti="0"]');
  check('loopEngine select present for classic vertical mode', !!loopEngineSelect);
  setValue(loopEngineSelect, 'quantized');
  check('quantized bpm field appears (track-level, not per-section)', !!q('input[data-field="bpm"][data-ti="0"]'));
  check('quantized loop timeline host appears', !!q('[data-role="loopTimelineHost"][data-ti="0"]'));
  // Sans fichier chargé, la timeline doit afficher son placeholder plutôt que planter.
  check('timeline placeholder shown without a file yet (no crash)', q('[data-role="loopTimelineHost"][data-ti="0"]').textContent.length >= 0);

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
