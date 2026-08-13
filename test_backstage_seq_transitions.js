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

  check('pas de sélecteurs quantization/cutStyle avant d\'activer les embranchements', !q('select[data-slot-field="quantization"][data-ti="0"][data-si="0"]'));

  const hasBranchesBox = q('input[data-slot-field="hasBranches"][data-ti="0"][data-si="0"]');
  check('case "prévoir un ou plusieurs embranchements" présente', !!hasBranchesBox);
  hasBranchesBox.checked = true;
  hasBranchesBox.dispatchEvent(new window.Event('input', { bubbles: true }));

  const quantSelect = q('select[data-slot-field="quantization"][data-ti="0"][data-si="0"]');
  const cutSelect = q('select[data-slot-field="cutStyle"][data-ti="0"][data-si="0"]');
  check('sélecteur quantization apparaît une fois les embranchements activés, "bar" par défaut', !!quantSelect && quantSelect.value === 'bar');
  check('sélecteur cutStyle apparaît, "fade" par défaut', !!cutSelect && cutSelect.value === 'fade');

  setValue(quantSelect, 'immediate');
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'vertical');
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');
  check('quantization persiste après re-rendu (bien écrit dans le modèle)', q('select[data-slot-field="quantization"][data-ti="0"][data-si="0"]').value === 'immediate');

  const transBox = q('input[data-branch-field="hasTransition"][data-ti="0"][data-si="0"][data-bi="0"]');
  check('case fichier de transition présente sur le premier embranchement', !!transBox);
  check('pas de contrôle de fichier de transition avant de cocher la case', !q('[data-role="transitionFileCtrl"]'));
  transBox.checked = true;
  transBox.dispatchEvent(new window.Event('input', { bubbles: true }));

  check('contrôle de fichier de transition apparaît une fois la case cochée', !!q('[data-role="transitionFileCtrl"]') && q('[data-role="transitionFileCtrl"]').children.length > 0);
  check('champ mesures de la transition présent, 4 par défaut', q('input[data-branch-transition-field="bars"][data-ti="0"][data-si="0"][data-bi="0"]').value === '4');

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
