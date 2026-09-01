// Non-régression (bug trouvé le 13/08) : quand un dépôt de fichier crée un nouvel emplacement séquentiel
// (dépôt groupé sur la zone "Emplacements", dépôt groupé au niveau du morceau avec devinette de rôle, ou
// reclassification de rôle après un tel dépôt), le nom de L'EMPLACEMENT lui-même doit se remplir avec le
// nom du fichier — jusqu'ici seule l'alternative à l'intérieur héritait du nom, obligeant à ouvrir
// "Voir les variations" pour savoir quel fichier avait atterri où.
//
// Réécrit le 01/09 : la zone de dépôt directe des emplacements est désormais `[data-role="segmentSlotsMaster"]`
// (l'ancien `[data-role="segmentSlots"]` n'existe plus, confirmé par grep — remplacé par la liste maître de
// la disposition maître-détail du 18/08). Le champ libellé de l'emplacement créé n'est visible qu'une fois
// l'emplacement sélectionné (même mécanisme que test_backstage_slot_collapse.js) -- ajouté ci-dessous.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

(async () => {
  const backstageSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf-8')
    .replace(/<script[^>]*src="https:\/\/unpkg\.com[^"]*"[^>]*><\/script>\s*/g, '');
  function inlineExactLine(html, filename, tagline) {
    const content = fs.readFileSync(path.join(__dirname, filename), 'utf-8').replace(/<\/script/gi, '<\\/script');
    return html.split('\n').map(line => {
      const normalized = line.trim().replace(/\.js(\?[^"]*)?"/, '.js"');
      return normalized === tagline ? `<script>${content}</script>` : line;
    }).join('\n');
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
  const q = sel => doc.querySelector(sel);
  function fakeFile(name) { return { name, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }; }
  function drop(el, files) {
    const ev = new window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { files } });
    el.dispatchEvent(ev);
  }

  click(q('#btnAddLibraryTrack'));
  const modeSelect = q('#libraryContainer select[data-field="mode"][data-ti="0"]');
  modeSelect.value = 'sequential';
  modeSelect.dispatchEvent(new window.Event('input', { bubbles: true }));

  // ---- Dépôt direct sur la liste maître des emplacements : chaque fichier crée son propre emplacement,
  // dont le nom doit être repris du fichier, pas laissé vide. ----
  const host = q('[data-role="segmentSlotsMaster"]');
  check('zone de dépôt des emplacements trouvée', !!host);
  if (host) {
    drop(host, [fakeFile('#1_WetDarkCave_120bpm.wav')]);
    click(q('[data-action="select-seq-slot"][data-ti="0"][data-si="0"]'));
    const labelInput = q('input[data-slot-field="label"][data-ti="0"][data-si="0"]');
    // Depuis le 13/08, "120bpm" est reconnu comme donnée structurée (slot.bpm) plutôt que laissé comme du
    // texte dans le nom — le libellé n'en garde donc plus la trace, contrairement à avant cet ajout.
    check('le nom de l\'emplacement est repris automatiquement du fichier déposé (pas vide, jeton bpm retiré)', !!labelInput && labelInput.value === '#1 WetDarkCave');
    const bpmInput = q('input[data-slot-field="bpm"][data-ti="0"][data-si="0"]');
    check('le bpm détecté dans le nom du fichier est bien repris dans le champ dédié', !!bpmInput && bpmInput.value === '120');
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
