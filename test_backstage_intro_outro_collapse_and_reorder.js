// Deux ajouts testés ici (demande du 13/08) :
// 1) Intro/Outro repliés par défaut dans l'éditeur d'un morceau séquentiel (jusqu'ici toujours dépliés).
// 2) Réorganisation de l'ordre des morceaux dans la bibliothèque (boutons monter/descendre, même principe
//    que pour les sections/emplacements/boucles nommées).
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

  // ---- 1) Intro/Outro repliés par défaut en séquentiel ----
  click(q('#btnAddLibraryTrack'));
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');

  const introBody = q('[data-role="introBlockBody"]');
  const outroBody = q('[data-role="outroBlockBody"]');
  check('bloc Intro présent et replié par défaut', !!introBody && introBody.classList.contains('collapsed'));
  check('bloc Outro présent et replié par défaut', !!outroBody && outroBody.classList.contains('collapsed'));

  const introToggle = q('[data-role="introBlockToggle"]');
  click(introToggle);
  check('clic sur le bouton Intro déplie son corps', !introBody.classList.contains('collapsed'));
  click(introToggle);
  check('un second clic replie à nouveau', introBody.classList.contains('collapsed'));

  // Les champs à l'intérieur (label, mesures) doivent rester fonctionnels une fois déplié — non-régression :
  // le repli ne doit pas avoir cassé le câblage des champs eux-mêmes.
  click(introToggle);
  const introLabelInput = q('input[data-field="introLabel"][data-ti="0"]');
  check('le champ nom de l\'intro est toujours présent et modifiable une fois déplié', !!introLabelInput);
  setValue(introLabelInput, 'Intro perso');
  check('la saisie dans le champ intro est bien reflétée dans le modèle', introLabelInput.value === 'Intro perso');

  // ---- 2) Réorganisation de la bibliothèque ----
  click(q('#btnAddLibraryTrack')); // morceau #2
  click(q('#btnAddLibraryTrack')); // morceau #3
  setValue(qa('#libraryContainer input[data-field="title"]')[0], 'Premier');
  setValue(qa('#libraryContainer input[data-field="title"]')[1], 'Deuxieme');
  setValue(qa('#libraryContainer input[data-field="title"]')[2], 'Troisieme');

  const titlesInOrder = () => qa('#libraryContainer input[data-field="title"]').map(el => el.value);
  check('ordre initial des trois morceaux', JSON.stringify(titlesInOrder()) === JSON.stringify(['Premier', 'Deuxieme', 'Troisieme']));

  const upBtn0 = q('[data-action="move-track-up"][data-ti="0"]');
  const downBtn0 = q('[data-action="move-track-down"][data-ti="0"]');
  check('bouton monter désactivé pour le premier morceau', upBtn0.disabled === true);
  check('bouton descendre actif pour le premier morceau', downBtn0.disabled === false);

  click(downBtn0); // Premier <-> Deuxieme
  check('après "descendre" sur le 1er, l\'ordre devient Deuxieme, Premier, Troisieme', JSON.stringify(titlesInOrder()) === JSON.stringify(['Deuxieme', 'Premier', 'Troisieme']));

  const upBtn2 = q('[data-action="move-track-up"][data-ti="2"]');
  const downBtn2 = q('[data-action="move-track-down"][data-ti="2"]');
  check('bouton descendre désactivé pour le dernier morceau', downBtn2.disabled === true);
  check('bouton monter actif pour le dernier morceau', upBtn2.disabled === false);

  click(upBtn2); // Troisieme remonte devant Premier
  check('après "monter" sur le dernier, l\'ordre devient Deuxieme, Troisieme, Premier', JSON.stringify(titlesInOrder()) === JSON.stringify(['Deuxieme', 'Troisieme', 'Premier']));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
