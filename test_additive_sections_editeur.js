// Layering additif à sections (30/10), côté éditeur du Backstage : option du mode selon le feu vert,
// niveau de départ de la section, conservé dans le morceau.
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const { window } = dom;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  const q = sel => window.document.querySelector(sel);
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const pick = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); el.dispatchEvent(new window.Event('change', { bubbles: true })); };

  click(q('#btnAddLibraryTrack'));
  const modeSel = () => q('#libraryContainer select[data-field="mode"][data-ti="0"]');
  const opt = () => modeSel().querySelector('option[value="vertical-additive-sequential"]');
  check('feu vert fermé : option grisée, marquée à venir', opt().disabled && /à venir|coming soon/.test(opt().textContent));

  window.eval('myFlags.additive_sections = true; renderLibrary();');
  check('feu vert ouvert : option disponible', !opt().disabled && !/à venir|coming soon/.test(opt().textContent));

  pick(modeSel(), 'vertical-additive-sequential');
  check('mode enregistré sur le morceau', window.eval('library[0].mode') === 'vertical-additive-sequential');
  click(q('[data-action="add-section"][data-ti="0"]'));
  window.eval("library[0].sections[0].pools = [{ id: 'x', label: 'Basse', alternatives: [] }, { id: 'y', label: 'Cuivres', alternatives: [] }]; renderLibrary();");
  if (!q('select[data-section-field="startLevel"]')) {
    const item = [...window.document.querySelectorAll('#libraryContainer .seq-master-item')].find(e => /section/i.test(e.textContent) && !/\+/.test(e.textContent));
    if (item) click(item);
  }
  const startSel = q('select[data-section-field="startLevel"]');
  check('niveau de départ proposé, une option par couche', !!startSel && startSel.options.length === 2);
  if (startSel) pick(startSel, '1');
  check('niveau de départ enregistré sur la section', window.eval('library[0].sections[0].startLevel') === 1);

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
