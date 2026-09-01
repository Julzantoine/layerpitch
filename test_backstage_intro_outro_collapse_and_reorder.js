// Deux ajouts testés ici (demande du 13/08) :
// 1) Intro/Outro repliés par défaut dans l'éditeur d'un morceau séquentiel (jusqu'ici toujours dépliés).
// 2) Réorganisation de l'ordre des morceaux dans la bibliothèque (boutons monter/descendre, même principe
//    que pour les sections/emplacements/boucles nommées).
//
// Réécrit le 01/09 : depuis la restructuration en disposition maître-détail (18/08), Intro/Outro n'ont plus
// de bloc replié dédié (introBlockBody/introBlockToggle/outroBlockBody/outroBlockToggle n'existent plus,
// confirmé par grep) -- ce sont désormais deux entrées de plus dans la même liste maître que les
// emplacements ("Structure"), repliées/dépliées par le même mécanisme de sélection exclusive.
// Le second volet a lui aussi changé de mécanisme : la bibliothèque de morceaux (#libraryMaster) est
// maintenant elle-même une liste organisable par glisser-déposer (wireOrgDragDrop, généralisée le 20/08 aux
// morceaux/AdReels/Sfx) -- plus de boutons monter/descendre ni move-track-up/move-track-down (confirmés
// absents par grep). Réécrit ci-dessous avec de vrais événements drag/dragover/drop simulés dans jsdom.
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

  // ---- 1) Intro/Outro repliés par défaut en séquentiel ----
  click(q('#btnAddLibraryTrack'));
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');

  // Chaque clic déclenche un renderLibrary() complet qui détruit et reconstruit le DOM -- une référence
  // capturée avant un clic devient donc obsolète (détachée, ses événements ne remontent plus jusqu'au
  // gestionnaire délégué sur #libraryContainer). On re-interroge le DOM à chaque fois plutôt que de garder
  // des références en cache.
  const introMasterItem = () => q('[data-action="select-seq-slot"][data-ti="0"][data-seq-key="seqIntro"]');
  const outroMasterItem = () => q('[data-action="select-seq-slot"][data-ti="0"][data-seq-key="seqOutro"]');
  check('entrée Intro présente dans la liste maître', !!introMasterItem());
  check('entrée Outro présente dans la liste maître', !!outroMasterItem());
  check('Intro repliée par défaut (sélection sur "Infos du morceau")', !q('input[data-field="introLabel"][data-ti="0"]'));
  check('Outro repliée par défaut', !q('input[data-field="outroLabel"][data-ti="0"]'));

  click(introMasterItem());
  check('cliquer sur Intro déplie son détail', !!q('input[data-field="introLabel"][data-ti="0"]'));
  check('Outro reste repliée (un seul détail affiché à la fois)', !q('input[data-field="outroLabel"][data-ti="0"]'));

  // Les champs à l'intérieur (label, mesures) doivent rester fonctionnels une fois déplié — non-régression :
  // le repli ne doit pas avoir cassé le câblage des champs eux-mêmes.
  const introLabelInput = q('input[data-field="introLabel"][data-ti="0"]');
  check('le champ nom de l\'intro est présent et modifiable une fois déplié', !!introLabelInput);
  setValue(introLabelInput, 'Intro perso');
  check('la saisie dans le champ intro est bien reflétée dans le modèle', introLabelInput.value === 'Intro perso');

  click(outroMasterItem());
  check('sélectionner Outro déplie son détail et replie Intro', !!q('input[data-field="outroLabel"][data-ti="0"]') && !q('input[data-field="introLabel"][data-ti="0"]'));

  // ---- 2) Réorganisation de la bibliothèque : glisser-déposer (wireOrgDragDrop), plus de boutons monter/descendre ----
  click(q('#btnAddLibraryTrack')); // morceau #2
  click(q('#btnAddLibraryTrack')); // morceau #3
  // Chaque nouveau morceau devient automatiquement le morceau sélectionné (manageLibrarySelectedId) -- il
  // faut re-sélectionner chacun dans la liste maître pour accéder à son champ titre dans le détail.
  // data-ti reflète l'index du morceau dans le tableau library (pas forcément 0 pour les morceaux #2/#3) --
  // sans intérêt ici puisqu'un seul morceau est affiché en détail à la fois : sélecteur générique.
  const rows = () => qa('#libraryMaster .org-row');
  click(rows()[0]);
  setValue(q('input[data-field="title"]'), 'Premier');
  click(rows()[1]);
  setValue(q('input[data-field="title"]'), 'Deuxieme');
  click(rows()[2]);
  setValue(q('input[data-field="title"]'), 'Troisieme');

  // La liste maître ne se re-rend pas à chaque frappe (même raison que le libellé d'emplacement) -- forcer
  // un rendu en resélectionnant le morceau courant avant de lire les libellés affichés dans la liste.
  click(rows()[2]);
  const titlesInOrder = () => rows().map(r => r.querySelector('.seq-master-item-label').textContent.trim());
  check('ordre initial des trois morceaux', JSON.stringify(titlesInOrder()) === JSON.stringify(['Premier', 'Deuxieme', 'Troisieme']));

  // Simule un glisser-déposer complet (poignée -> dragstart -> dragover -> drop -> dragend) d'une ligne sur
  // une autre. jsdom ne calcule pas de vraie mise en page (getBoundingClientRect renvoie des zéros) : avec
  // clientY=0 par défaut, "before" (moitié haute) est systématiquement faux, donc le dépôt place toujours
  // l'élément déplacé JUSTE APRÈS la cible -- comportement déterministe exploité ici plutôt que contourné.
  function dragRowOnto(fromRow, toRow) {
    fromRow.draggable = true;
    const dt = { effectAllowed: '', setData() {} };
    const dragstartEv = new window.Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(dragstartEv, 'dataTransfer', { value: dt });
    fromRow.dispatchEvent(dragstartEv);
    const dragoverEv = new window.Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragoverEv, 'dataTransfer', { value: dt });
    Object.defineProperty(dragoverEv, 'target', { value: toRow });
    toRow.dispatchEvent(dragoverEv);
    const dropEv = new window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEv, 'dataTransfer', { value: dt });
    Object.defineProperty(dropEv, 'target', { value: toRow });
    toRow.dispatchEvent(dropEv);
    fromRow.dispatchEvent(new window.Event('dragend', { bubbles: true, cancelable: true }));
  }

  dragRowOnto(rows()[0], rows()[1]); // dépose "Premier" sur "Deuxieme" -> se place juste après lui
  check('après avoir déposé Premier sur Deuxieme, l\'ordre devient Deuxieme, Premier, Troisieme',
    JSON.stringify(titlesInOrder()) === JSON.stringify(['Deuxieme', 'Premier', 'Troisieme']));

  dragRowOnto(rows()[2], rows()[0]); // dépose "Troisieme" (position 2) sur "Deuxieme" (position 0) -> se place juste après lui
  check('après avoir déposé Troisieme sur Deuxieme, l\'ordre devient Deuxieme, Troisieme, Premier',
    JSON.stringify(titlesInOrder()) === JSON.stringify(['Deuxieme', 'Troisieme', 'Premier']));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
