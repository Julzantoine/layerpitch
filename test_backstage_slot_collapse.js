// Repli/dépli individuel de chaque emplacement séquentiel (segmentSlots), demande du 15/08 : ne laisser
// apparaître que l'en-tête (flèches, titre, bouton Supprimer) une fois replié. À l'origine suivi par un
// mécanisme dédié par id (collapsedSlotIds).
//
// Réécrit le 01/09 : depuis la restructuration en disposition maître-détail (18/08, voir
// seqSelectedSlotIndex dans layerpitch-backstage.html ~ligne 3787), collapsedSlotIds/toggle-collapse-slot/
// data-role="slotBody" n'existent plus du tout (confirmé par grep) -- remplacés par UN SEUL mécanisme de
// sélection partagé avec "Infos du morceau"/"Contenu additionnel"/"Infos additionnelles" : seul l'emplacement
// sélectionné reçoit son détail complet dans le DOM, les autres ne montrent que leur ligne de résumé dans la
// liste maître (equivalent du "replié" d'avant, mais par sélection exclusive plutôt que par repli individuel).
// Différence de comportement réelle et assumée par le nouveau design : la sélection suit la POSITION
// (l'index si), pas l'identité de l'emplacement -- contrairement à l'ancien collapsedSlotIds qui suivait
// l'id. Un réordonnancement change donc quel emplacement apparaît sélectionné, testé explicitement plus bas.
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

  click(q('#btnAddLibraryTrack'));
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');
  click(q('[data-action="add-segment-slot"][data-ti="0"]'));
  click(q('[data-action="add-segment-slot"][data-ti="0"]'));

  check('deux entrées d\'emplacement présentes dans la liste maître',
    !!q('[data-action="select-seq-slot"][data-ti="0"][data-si="0"]') && !!q('[data-action="select-seq-slot"][data-ti="0"][data-si="1"]'));

  check('aucun détail d\'emplacement affiché par défaut (sélection sur "Infos du morceau", pas sur un emplacement)',
    !q('input[data-slot-field="label"][data-ti="0"][data-si="0"]') && !q('input[data-slot-field="label"][data-ti="0"][data-si="1"]'));

  click(q('[data-action="select-seq-slot"][data-ti="0"][data-si="0"]'));
  let label0 = q('input[data-slot-field="label"][data-ti="0"][data-si="0"]');
  check('sélectionner le premier emplacement affiche son détail (champ libellé présent)', !!label0);
  check('le second emplacement, non sélectionné, n\'a toujours aucun détail affiché', !q('input[data-slot-field="label"][data-ti="0"][data-si="1"]'));
  setValue(label0, 'WetDarkCave');
  // La saisie ne déclenche pas de re-rendu (pour ne pas perdre le focus pendant la frappe, même principe que
  // le titre du morceau) -- la liste maître ne reflète le modèle qu'au prochain rendu complet, provoqué ici
  // par un simple clic (sans effet de bord) sur l'emplacement déjà sélectionné.
  click(q('[data-action="select-seq-slot"][data-ti="0"][data-si="0"]'));

  const masterLabel0 = q('[data-action="select-seq-slot"][data-ti="0"][data-si="0"] .seq-master-item-label');
  check('la ligne de la liste maître reflète le libellé saisi', !!masterLabel0 && masterLabel0.textContent.trim() === '#1 WetDarkCave');

  click(q('[data-action="select-seq-slot"][data-ti="0"][data-si="1"]'));
  check('sélectionner le second emplacement bascule le détail (le premier disparaît du DOM)', !q('input[data-slot-field="label"][data-ti="0"][data-si="0"]'));
  const label1 = q('input[data-slot-field="label"][data-ti="0"][data-si="1"]');
  check('le détail du second emplacement est bien affiché', !!label1);
  setValue(label1, 'Corridor');

  click(q('[data-action="select-seq-slot"][data-ti="0"][data-si="0"]'));
  label0 = q('input[data-slot-field="label"][data-ti="0"][data-si="0"]');
  check('en resélectionnant le premier emplacement, sa donnée "WetDarkCave" a bien persisté malgré le va-et-vient', !!label0 && label0.value === 'WetDarkCave');

  // ---- Comportement réel du nouveau design : la sélection suit la POSITION, pas l'identité ----
  click(q('[data-action="move-slot-down"][data-ti="0"][data-si="0"]')); // échange les positions 0 et 1 (WetDarkCave <-> Corridor)
  const labelAtPos0 = q('input[data-slot-field="label"][data-ti="0"][data-si="0"]');
  check('après l\'échange, la sélection (toujours "position 0") affiche désormais Corridor, pas WetDarkCave',
    !!labelAtPos0 && labelAtPos0.value === 'Corridor');
  check('la position 1 (désormais WetDarkCave) n\'est plus sélectionnée, donc pas de détail affiché pour elle',
    !q('input[data-slot-field="label"][data-ti="0"][data-si="1"]'));

  // ---- Persistance de la sélection après un re-rendu complet (changement de mode aller-retour) ----
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'vertical');
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');
  const labelAfterRerender = q('input[data-slot-field="label"][data-ti="0"][data-si="0"]');
  check('la sélection (position 0, "Corridor") persiste après un re-rendu complet', !!labelAfterRerender && labelAfterRerender.value === 'Corridor');

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
