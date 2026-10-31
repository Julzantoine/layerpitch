// Séquentiel hybride (31/10), côté Backstage : feu vert, sections qui désignent des morceaux, conservation à la publication et au
// rechargement, suppression d'un morceau utilisé.
const { loadBackstage } = require('./scripts/test-harness.js');
(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const { window } = dom;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  const q = sel => window.document.querySelector(sel);
  const pick = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); el.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  window.eval("library.push({ id: 'st', title: 'Statique', mode: 'static', layers: [{ label: 'a', remoteFile: 'a.mp3' }] }, { id: 'vt', title: 'Additif', mode: 'vertical', layers: [{ label: 'a', remoteFile: 'a.mp3' }] }, { id: 'sq', title: 'Séquentiel', mode: 'sequential', layers: [] }, { id: 'h', title: 'Hybride', mode: 'static', layers: [{}], sfxIds: [] }); manageLibrarySelectedId = 'h'; renderLibrary();");
  const modeSel = () => q('#libraryContainer select[data-field="mode"]');
  const opt = () => modeSel().querySelector('option[value="hybrid-sequential"]');
  check('feu vert fermé : option grisée', opt().disabled);
  check('l\'ancien additif à sections n\'est plus proposé', modeSel().querySelector('option[value="vertical-additive-sequential"]').disabled);
  window.eval('myFlags.hybrid_sequential = true; renderLibrary();');
  check('feu vert ouvert : option disponible', !opt().disabled);
  pick(modeSel(), 'hybrid-sequential');
  check('mode enregistré', window.eval("library.find(l => l.id === 'h').mode") === 'hybrid-sequential');
  click(q('[data-role="hybridAdd"]'));
  const trackSel = () => q('select[data-hybrid="track"]');
  const options = [...trackSel().options].map(o => o.value);
  check('seuls le statique et l\'additif sont proposés', options.join() === ',st,vt');
  pick(trackSel(), 'vt');
  pick(q('select[data-hybrid="loops"]'), '2');
  pick(q('input[data-hybrid="label"]'), 'Exploration');
  click(q('[data-role="hybridAdd"]'));
  pick([...window.document.querySelectorAll('select[data-hybrid="track"]')][1], 'st');
  click([...window.document.querySelectorAll('[data-hybrid="up"]')][1]);
  check('ordre modifiable', window.eval("library.find(l => l.id === 'h').sections[0].trackId") === 'st');

  // Réglage du passage, points, fondu, fichier de transition.
  window.eval("library.find(l => l.id === 'vt').duration = 8; library.find(l => l.id === 'vt').bpm = 120; renderLibrary();");
  const switches = () => [...window.document.querySelectorAll('select[data-hybrid="switch"]')];
  check('réglage par défaut : fin de la section', switches()[1].value === 'end');
  pick(switches()[1], 'point');
  const pts = () => [...window.document.querySelectorAll('.hybrid-point')];
  check('frise : une case par temps du morceau', pts().length === 16);
  click(pts()[4]);
  click(pts()[8]);
  click(pts()[4]);
  check('un clic pose, un second enlève', JSON.stringify(window.eval("library.find(l => l.id === 'h').sections[1].transitionPoints")) === '[8]');
  check('fondu proposé', !!q('input[data-hybrid="fade"]'));
  check('dernière section : pas de fichier de transition', window.document.querySelectorAll('[data-role="hybridTransFile"]').length === 1);
  window.eval("library.find(l => l.id === 'h').sections[0].transition = { remoteFile: 'section-x-transition.ogg', originalFileName: 'x.wav', pendingFile: null, bars: 2 }; renderLibrary();");
  const snap = window.eval("JSON.stringify(buildDataSnapshot({}, 1).library.find(l => l.id === 'h').sections)");
  const sec = JSON.parse(snap);
  check('publication : champs des sections conservés', sec.length === 2 && sec[1].trackId === 'vt' && sec[1].maxLoops === 2 && sec[1].label === 'Exploration' && !('pools' in sec[1]) && !('track' in sec[1]));
  check('publication : réglages du passage conservés', sec[1].switchMode === 'point' && JSON.stringify(sec[1].transitionPoints) === '[8]' && sec[0].transition.file === 'section-x-transition.ogg' && sec[0].transition.bars === 2);
  check('fichier de transition supprimé avec le morceau', window.eval("trackRemoteFileKeys(library.find(l => l.id === 'h'))").length === 1);
  check('rechargement : lecture du format publié', /remoteFile: sec\.transition\.file/.test(require('fs').readFileSync('src/backstage/38-chargement.js', 'utf-8')));
  const preview = JSON.parse(window.eval("JSON.stringify(buildPreviewTrack(library.find(l => l.id === 'h')))"));
  check('aperçu : la section porte son morceau', preview.sections[1].track && preview.sections[1].track.mode === 'vertical');
  const copy = JSON.parse(window.eval("JSON.stringify(cloneTrackWithRemap(library.find(l => l.id === 'h')))"));
  check('duplication : les sections gardent leur morceau', copy.sections[1].trackId === 'vt' && copy.sections[1].maxLoops === 2);

  // Morceau utilisé puis supprimé : la section disparaît.
  window.eval("manageLibrarySelectedId = 'st'; renderLibrary(); window.LayerPitchNotify = { confirm: () => Promise.resolve(true), info() {} };");
  click(q('[data-action="remove-track"]'));
  await new Promise(r => setTimeout(r, 50));
  check('morceau supprimé : section retirée', window.eval("library.find(l => l.id === 'h').sections.length") === 1);

  // Un morceau qui a déjà ses propres sections ne devient pas hybride.
  window.eval("library.push({ id: 'vr', title: 'VR', mode: 'vertical-random', layers: [], sections: [{ id: 'z', pools: [{ alternatives: [] }] }] }); manageLibrarySelectedId = 'vr'; renderLibrary();");
  pick(modeSel(), 'hybrid-sequential');
  check('sections existantes protégées', window.eval("library.find(l => l.id === 'vr').mode") === 'vertical-random' && window.eval("library.find(l => l.id === 'vr').sections.length") === 1);

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
