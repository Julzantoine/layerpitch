// Deux ajouts testés ici (demande du 13/08) :
// 1) Le panneau de réglages des embranchements (quantization/cutStyle/durée personnalisée/liste des
//    options) est maintenant repliable — déplié automatiquement dès qu'on coche "Prévoir des
//    embranchements" (pour ne pas le cacher juste après l'avoir activé), replié par défaut aux rendus
//    suivants tant qu'on ne l'a pas explicitement déplié.
// 2) Ordre des boutons dans l'en-tête d'une carte de morceau : replier/déplier en premier (à gauche),
//    puis les flèches de réorganisation.
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

  click(q('#btnAddLibraryTrack'));
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');
  click(q('button[data-action="add-segment-slot"][data-ti="0"]'));
  click(q('button[data-action="add-segment-slot"][data-ti="0"]'));

  // ---- 1) Panneau d'embranchements : absent avant activation, déplié juste après activation ----
  check('pas de panneau d\'embranchements avant activation', !q('[data-role="branchesBody"][data-ti="0"], [data-role="branchesToggle"]'));

  const hasBranchesBox = q('input[data-slot-field="hasBranches"][data-ti="0"][data-si="0"]');
  hasBranchesBox.checked = true;
  hasBranchesBox.dispatchEvent(new window.Event('input', { bubbles: true }));

  let branchesBody = q('[data-role="branchesBody"]');
  check('panneau d\'embranchements présent et DÉPLIÉ juste après avoir coché la case', !!branchesBody && !branchesBody.classList.contains('collapsed'));

  const branchesToggle = q('[data-role="branchesToggle"]');
  check('bouton de repli des embranchements présent', !!branchesToggle);
  click(branchesToggle);
  branchesBody = q('[data-role="branchesBody"]');
  check('un clic replie le panneau', branchesBody.classList.contains('collapsed'));

  // Changer de mode et revenir force un re-rendu complet : le repli manuel doit persister (pas de reset
  // intempestif à chaque rendu), même mécanisme que les autres pools de variations déjà en place.
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'vertical');
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');
  branchesBody = q('[data-role="branchesBody"]');
  check('l\'état replié persiste après un re-rendu complet (changement de mode aller-retour)', !!branchesBody && branchesBody.classList.contains('collapsed'));

  // Les champs à l'intérieur restent fonctionnels une fois repliés puis redépliés.
  click(q('[data-role="branchesToggle"]'));
  const quantSelect = q('select[data-slot-field="quantization"][data-ti="0"][data-si="0"]');
  check('le sélecteur de quantification reste fonctionnel une fois redéplié', !!quantSelect);
  setValue(quantSelect, 'immediate');
  check('la valeur saisie est bien reflétée', quantSelect.value === 'immediate');

  // ---- 2) Ordre complet de l'en-tête de la carte de morceau : repli / titre / Écouter / Supprimer / flèches ----
  const headLeft = q('.list-block-head-left');
  const actionEls = [...headLeft.children].filter(el => el.dataset && el.dataset.action);
  const actions = actionEls.map(el => el.dataset.action);
  check('ordre complet de l\'en-tête (' + actions.join(', ') + ')',
    JSON.stringify(actions) === JSON.stringify(['toggle-collapse-track', 'preview-track', 'remove-track', 'move-track-up', 'move-track-down']));
  const titleEl = headLeft.querySelector('strong');
  check('le titre se trouve bien entre le bouton de repli et le bouton Écouter',
    Boolean(headLeft.querySelector('[data-action="toggle-collapse-track"]').compareDocumentPosition(titleEl) & window.Node.DOCUMENT_POSITION_FOLLOWING)
    && Boolean(titleEl.compareDocumentPosition(headLeft.querySelector('[data-action="preview-track"]')) & window.Node.DOCUMENT_POSITION_FOLLOWING));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
