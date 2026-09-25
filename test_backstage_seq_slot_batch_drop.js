// Dépôt groupé d'un slot séquentiel (25/09, demande de Jules-Antoine) : comme la section du vertical-random,
// on crée le slot à la main puis on y dépose tous ses fichiers -- chacun devient une variation.
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
  function setValue(el, value) { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); }
  const q = sel => doc.querySelector(sel);
  const qa = sel => [...doc.querySelectorAll(sel)];

  function drop(el, files) {
    const dt = { files, types: ['Files'] };
    const over = new window.Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: dt });
    el.dispatchEvent(over);
    const ev = new window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    el.dispatchEvent(ev);
    return ev;
  }

  const F = name => new window.File([new Uint8Array(8)], name, { type: 'audio/wav' });
  const track = () => window.eval('library[0]');

  click(q('#btnAddLibraryTrack'));
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');
  click(q('[data-action="add-segment-slot"][data-ti="0"]'));
  check('slot créé à la main, avec sa variation vide', track().segmentSlots.length === 1 && track().segmentSlots[0].alternatives.length === 1);
  click(q('[data-action="select-seq-slot"][data-ti="0"][data-si="0"]'));
  const zone = () => q('#libraryContainer .seq-slot-drop-panel');
  check('le panneau du slot est une zone de dépôt', !!zone());
  check('plus de grande zone de dépôt au niveau du morceau', !q('[data-role="allBlocksDrop"]'));

  drop(zone(), ['The Last Door #1.1_120bpm_16M.wav', 'The Last Door #1.2.wav', 'TheLast Door #1.3_8M.wav'].map(F));
  const slot = track().segmentSlots[0];
  check('un seul slot (pas un slot par fichier)', track().segmentSlots.length === 1);
  check('3 variations, la variation vide remplacée', slot.alternatives.length === 3 && slot.alternatives.every(a => a.pendingFile));
  check('mesures lues dans les noms (16, 8 par défaut, 8)', slot.alternatives.map(a => a.bars).join(',') === '16,8,8');
  check('tempo du slot repris du nom', slot.bpm === 120);
  check('libellés sans jetons tempo/mesures', slot.alternatives[0].label === 'The Last Door #1.1');
  check('slot sans nom : nommé d\'après les fichiers', slot.label === 'The Last Door #1');
  check('liste des variations dépliée après le dépôt', !q('#libraryContainer [data-role="altPoolBody"]').classList.contains('collapsed'));

  drop(zone(), [F('The Last Door #1.4.wav')]);
  check('2e dépôt : complète le slot', track().segmentSlots[0].alternatives.length === 4 && track().segmentSlots[0].label === 'The Last Door #1');

  // ---- Fichier lâché sur le sélecteur d'une variation précise : remplace SON fichier, n'ajoute rien ----
  const altCtrl = q('#libraryContainer [data-role="slotAltFileCtrl"] .file-ctrl');
  drop(altCtrl, [F('Replacement.wav')]);
  check('sélecteur d\'une variation : fichier remplacé, pas de variation ajoutée', track().segmentSlots[0].alternatives.length === 4 && track().segmentSlots[0].alternatives[0].pendingFile.name === 'Replacement.wav');

  // ---- Dépôt sur les noms de la liste de gauche ----
  drop(q('[data-action="select-seq-slot"][data-ti="0"][data-seq-key="seqIntro"]'), [F('Door_Intro_6M_90bpm.wav')]);
  check('Intro : fichier posé, mesures et tempo lus dans le nom', track().intro.pendingFile && track().intro.bars === 6 && track().intro.bpm === 90);
  drop(q('[data-action="select-seq-slot"][data-ti="0"][data-seq-key="seqOutro"]'), [F('Door_Outro.wav')]);
  check('Outro : fichier posé', track().outro.pendingFile && track().outro.pendingFile.name === 'Door_Outro.wav');
  click(q('[data-action="add-segment-slot"][data-ti="0"]'));
  drop(q('[data-action="select-seq-slot"][data-ti="0"][data-si="1"]'), ['Door #2.1.wav', 'Door #2.2.wav'].map(F));
  const s2 = track().segmentSlots[1];
  check('Slot 2 (nom dans la liste) : 2 variations, nommé "Door #2"', s2.alternatives.length === 2 && s2.label === 'Door #2');
  check('le slot déposé devient la sélection', !!q('.seq-master-item.active[data-si="1"]'));

  // ---- Vertical-random : toute la carte d'un pool est une zone de dépôt ----
  click(q('#btnAddLibraryTrack'));
  const ti = window.eval('library.length - 1');
  setValue(q(`#libraryContainer select[data-field="mode"][data-ti="${ti}"]`), 'vertical-random');
  const pools = () => window.eval(`library[${ti}].sections[0] && library[${ti}].sections[0].pools`);
  if (!window.eval(`(library[${ti}].sections || []).length`)) click(q(`[data-action="add-section"][data-ti="${ti}"]`));
  click(q(`.seq-master-item[data-action="select-seq-slot"][data-ti="${ti}"][data-si="0"]`)); // sections : clé numérique
  if (!pools() || !pools().length) { const addPool = q(`[data-action="add-pool"][data-ti="${ti}"]`); if (addPool) click(addPool); }
  const poolCard = q('#libraryContainer [data-role="vrsPools"] > .list-block');
  check('carte de pool trouvée', !!poolCard);
  if (poolCard) {
    drop(poolCard, ['Perc 1.wav', 'Perc 2.wav'].map(F));
    const p0 = pools()[0];
    check('pool : 2 variations ajoutées, la variation vide remplacée', p0.alternatives.length === 2 && p0.alternatives.every(a => a.pendingFile));
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
