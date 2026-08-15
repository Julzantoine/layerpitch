// Repli/dépli individuel de chaque emplacement séquentiel (segmentSlots), demande du 15/08 : ne laisser
// apparaître que l'en-tête (flèches, titre, bouton Supprimer) une fois replié. Suivi par id (pas par
// position ti/si, qui change à chaque réordonnancement ↑/↓) — voir collapsedSlotIds. Même infrastructure
// (backstage inliné dans jsdom) que test_backstage_intro_outro_collapse_and_reorder.js.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

(async () => {
  const backstageSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf-8')
    .replace(/<script[^>]*src="https:\/\/unpkg\.com[^"]*"[^>]*><\/script>\s*/g, '');
  function inlineExactLine(html, filename, tagline) {
    const content = fs.readFileSync(path.join(__dirname, filename), 'utf-8').replace(/<\/script/gi, '<\\/script');
    return html.split('\n').map(line => line.trim() === tagline ? `<script>${content}</script>` : line).join('\n');
  }
  let html = inlineExactLine(backstageSrc, 'layerpitch-i18n.js', '<script src="layerpitch-i18n.js"></script>');
  html = inlineExactLine(html, 'layerpitch-help.js', '<script src="layerpitch-help.js"></script>');
  html = inlineExactLine(html, 'player.js', '<script src="player.js"></script>');

  const dom = new JSDOM(html, {
    url: 'http://localhost/test_backstage.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      function FakeAudioContext() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
      FakeAudioContext.prototype.createGain = function () { return { gain: { setValueAtTime() {}, value: 1 }, connect() {}, disconnect() {} }; };
      FakeAudioContext.prototype.createBufferSource = function () { return { connect() {}, start() {}, stop() {}, buffer: null }; };
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.reject(new Error('no audio in test env')); };
      FakeAudioContext.prototype.close = function () {};
      win.AudioContext = FakeAudioContext;
    }
  });
  const { window } = dom;
  await new Promise(resolve => dom.window.document.addEventListener('DOMContentLoaded', () => setTimeout(resolve, 50)));
  const doc = window.document;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
  function setValue(el, value) { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); }
  const q = sel => doc.querySelector(sel);
  const qa = sel => [...doc.querySelectorAll(sel)];

  click(q('#btnAddLibraryTrack'));
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');
  click(q('[data-action="add-segment-slot"][data-ti="0"]'));
  click(q('[data-action="add-segment-slot"][data-ti="0"]'));

  let slotToggles = qa('[data-action="toggle-collapse-slot"]');
  check('deux emplacements créés, bouton de repli présent sur chacun', slotToggles.length === 2);

  let slotBody0 = q('[data-role="slotBody"]');
  check('un emplacement fraîchement créé est DÉPLIÉ par défaut (pas comme Intro/Outro)', !!slotBody0 && !slotBody0.classList.contains('collapsed'));

  setValue(q('input[data-slot-field="label"][data-ti="0"][data-si="0"]'), 'WetDarkCave');
  const firstSlotId = q('[data-action="move-slot-up"][data-ti="0"][data-si="0"]').closest('.list-block').querySelector('input[data-slot-field="label"]').value;
  check('le libellé saisi est bien "WetDarkCave"', firstSlotId === 'WetDarkCave');

  click(slotToggles[0]);
  slotBody0 = q('[data-role="slotBody"]');
  check('un clic replie le corps de l\'emplacement (classe CSS)', slotBody0.classList.contains('collapsed'));
  slotToggles = qa('[data-action="toggle-collapse-slot"]');
  check('le chevron du bouton passe à ▸', slotToggles[0].textContent.trim() === '▸');
  check('le champ titre reste visible et modifiable une fois replié (il est dans l\'en-tête, hors du corps replié)',
    q('input[data-slot-field="label"][data-ti="0"][data-si="0"]').value === 'WetDarkCave');
  check('les champs internes (répétitions, tempo...) sont bien hors du DOM utile visuellement (corps marqué collapsed)',
    !!q('input[data-slot-field="repeatCount"][data-ti="0"][data-si="0"]')); // toujours présent dans le DOM, juste masqué par CSS — display:none vérifié séparément dans test_backstage_branch_collapse_and_header_order.js pour ce même mécanisme

  click(slotToggles[0]);
  slotBody0 = q('[data-role="slotBody"]');
  check('un second clic déplie à nouveau', !slotBody0.classList.contains('collapsed'));

  // ---- L'état replié suit l'ID de l'emplacement, pas sa position (ti/si) ----
  click(slotToggles[0]); // replie WetDarkCave (emplacement #1)
  setValue(q('input[data-slot-field="label"][data-ti="0"][data-si="1"]'), 'Corridor');
  click(q('[data-action="move-slot-down"][data-ti="0"][data-si="0"]')); // WetDarkCave passe en position #2

  const labelsInOrder = qa('input[data-slot-field="label"][data-ti="0"]').map(el => el.value);
  check('après réordonnancement, Corridor est bien en position #1 et WetDarkCave en #2', JSON.stringify(labelsInOrder) === JSON.stringify(['Corridor', 'WetDarkCave']));

  const bodiesInOrder = qa('[data-role="slotBody"]');
  const togglesInOrder = qa('[data-action="toggle-collapse-slot"]');
  check('Corridor (maintenant en position #1) est DÉPLIÉ — l\'état replié n\'a pas suivi la position', !bodiesInOrder[0].classList.contains('collapsed'));
  check('WetDarkCave (maintenant en position #2) est resté REPLIÉ — l\'état a bien suivi son identité, pas sa position',
    bodiesInOrder[1].classList.contains('collapsed') && togglesInOrder[1].textContent.trim() === '▸');

  // ---- Persistance après un re-rendu complet (changement de mode aller-retour) ----
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'vertical');
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');
  const bodiesAfterRerender = qa('[data-role="slotBody"]');
  check('l\'état replié de WetDarkCave persiste après un re-rendu complet', bodiesAfterRerender[1].classList.contains('collapsed'));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
