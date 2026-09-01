// Teste la détection de BPM et de nombre de mesures dans le nom de fichier lors du dépôt groupé (demande
// du 13/08, nomenclature de Jules-Antoine : "..._160bpm_40M.wav") — reprend l'exemple réel de sa capture
// d'écran (3 fichiers : 2 segments à 120 BPM/30 mesures, 1 segment à 160 BPM/40 mesures). Vérifie
// l'extraction ET l'absence de faux positif.
//
// Réécrit le 01/09 : `parseAudioFilenameHints` avait disparu du code (confirmé par grep, aucune trace de
// suppression volontaire contrairement aux refontes du 18/08) -- restaurée dans layerpitch-backstage.html
// (près de titleFromFilename) après confirmation explicite de Jules-Antoine que ce n'était pas voulu, et
// re-branchée au dépôt groupé sur la liste maître des emplacements. Partie UI adaptée à la disposition
// maître-détail (18/08) : la zone de dépôt est désormais `[data-role="segmentSlotsMaster"]` (l'ancien
// `[data-role="segmentSlots"]` n'existe plus), et chaque emplacement doit être sélectionné individuellement
// pour lire son détail (bpm, mesures de la première alternative).
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

  // ---- Fonction pure, testée isolément d'abord (pas de dépendance DOM) ----
  const parseAudioFilenameHints = window.parseAudioFilenameHints;
  check('parseAudioFilenameHints exposée globalement', typeof parseAudioFilenameHints === 'function');
  check('bpm + mesures détectés sur l\'exemple réel', JSON.stringify(parseAudioFilenameHints('#3_RobotAdventure_BattleFinal_160bpm_40M.wav')) === JSON.stringify({ bpm: 160, bars: 40 }));
  check('aucun jeton sur le fichier de transition (pas de faux positif)', JSON.stringify(parseAudioFilenameHints('#1bis_SecretLever_Transition.wav')) === JSON.stringify({ bpm: null, bars: null }));
  check('pas de faux positif sur un nombre suivi de "M" sans séparateur (Room40Meters)', JSON.stringify(parseAudioFilenameHints('Room40Meters_ambient.wav')) === JSON.stringify({ bpm: null, bars: null }));

  // ---- Dépôt groupé réel sur la liste maître des emplacements : 3 fichiers de l'exemple réel ----
  click(q('#btnAddLibraryTrack'));
  const modeSelect = q('#libraryContainer select[data-field="mode"][data-ti="0"]');
  modeSelect.value = 'sequential';
  modeSelect.dispatchEvent(new window.Event('input', { bubbles: true }));

  const host = q('[data-role="segmentSlotsMaster"]');
  check('zone de dépôt (liste maître des emplacements) trouvée', !!host);
  drop(host, [
    fakeFile('#1_RobotAdventure_WetDarkCave_120bpm_30M.wav'),
    fakeFile('#2_RobotAdventure_Corridor_120bpm_30M.wav'),
    fakeFile('#3_RobotAdventure_BattleFinal_160bpm_40M.wav')
  ]);

  const bpms = [], bars = [], labels = [];
  [0, 1, 2].forEach(si => {
    click(q(`[data-action="select-seq-slot"][data-ti="0"][data-si="${si}"]`));
    const bpmEl = q(`input[data-slot-field="bpm"][data-ti="0"][data-si="${si}"]`);
    const barsEl = q(`input[data-slot-alt-field="bars"][data-ti="0"][data-si="${si}"][data-ai="0"]`);
    const labelEl = q(`input[data-slot-field="label"][data-ti="0"][data-si="${si}"]`);
    bpms.push(bpmEl ? bpmEl.value : null);
    bars.push(barsEl ? barsEl.value : null);
    labels.push(labelEl ? labelEl.value : null);
  });

  check('BPM auto-rempli pour les 3 emplacements (120, 120, 160)', bpms.join(',') === '120,120,160');
  check('mesures auto-remplies pour les 3 alternatives (30, 30, 40)', bars.join(',') === '30,30,40');
  check('libellés propres, sans les jetons bpm/mesures',
    JSON.stringify(labels) === JSON.stringify(['#1 RobotAdventure WetDarkCave', '#2 RobotAdventure Corridor', '#3 RobotAdventure BattleFinal']));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
