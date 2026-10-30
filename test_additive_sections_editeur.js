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

  // Une couche = un seul fichier : ni alternatives, ni anti-répétition, ni vocabulaire « pool ».
  window.eval("library[0].sections[0].pools = [{ id: 'x', label: 'Basse', alternatives: [{ label: 'a', remoteFile: 'a.wav', pendingFile: null }, { label: 'b', remoteFile: 'b.wav', pendingFile: null }] }]; renderLibrary();");
  const detail = () => q('#libraryContainer').textContent;
  check("pas de bouton d'alternative dans une couche", !q('[data-action="add-pool-alt"]'));
  check('pas de réglage anti-répétition dans une couche', !q('[data-pool-field="avoidImmediateRepeat"]'));
  check('bouton + Couche', /\+ (Couche|Layer)/.test(q('[data-action="add-pool"]').textContent));
  check('plus aucun mot « pool » dans la section', !/\bpools?\b/i.test(detail()));
  check('fichiers en trop signalés, pas perdus', /autre\(s\) fichier|other file/.test(detail()) && window.eval('library[0].sections[0].pools[0].alternatives.length') === 2);
  window.eval("window.__g = null; var __o = openGroupedDropDialog; openGroupedDropDialog = function (o) { window.__g = o; }; openVrsBatchDropDialog(library[0], library[0].sections[0], ['Basse 2.wav', 'Basse 10.wav', 'Basse 1.wav', 'Intro.wav'].map(function (n) { return { name: n }; })); openGroupedDropDialog = __o;");
  check('dépôt groupé : un fichier = une couche, dans l\'ordre des noms', window.eval("__g.groups.map(function (g) { return g.files.length + g.files[0].name; }).join('|')") === '1Basse 1.wav|1Basse 2.wav|1Basse 10.wav');
  check('dépôt groupé : intro reconnue, pas de piste vide', window.eval('__g.intro.name') === 'Intro.wav' && window.eval('__g.withSilent') === false);

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
