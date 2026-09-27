// Deux ajouts testés ici (demande du 13/08) :
// 1) Le panneau de réglages des embranchements (quantization/cutStyle/durée personnalisée/liste des
//    options) est maintenant repliable — déplié automatiquement dès qu'on coche "Prévoir des
//    embranchements" (pour ne pas le cacher juste après l'avoir activé), replié par défaut aux rendus
//    suivants tant qu'on ne l'a pas explicitement déplié.
// 2) Ordre des boutons dans l'en-tête d'une carte de morceau : replier/déplier en premier (à gauche),
//    puis les flèches de réorganisation.
const { loadBackstage } = require('./scripts/test-harness.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const { window } = dom;
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
  // Depuis la restructuration en master/détail des emplacements séquentiels (seqSelectedSlotIndex,
  // voir layerpitch-backstage.html ~ligne 3885), seule la carte sélectionnée reçoit son détail
  // complet dans le DOM — il faut désormais sélectionner explicitement l'emplacement #1 pour que
  // ses champs (hasBranches, quantization, etc.) existent avant de les interroger.
  click(q('[data-action="select-seq-slot"][data-ti="0"][data-si="0"]'));

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
  check('un clic replie le panneau (classe CSS)', branchesBody.classList.contains('collapsed'));
  // Bug réel trouvé le 13/08 : la classe se posait bien, mais sans la classe de base "list-block-body"
  // requise par la règle CSS ".list-block-body.collapsed" — la flèche changeait d'état sans que rien ne
  // se masque visuellement. Vérification du rendu réel, pas seulement de la présence de la classe.
  check('le panneau est réellement masqué visuellement (display:none, pas juste la classe posée)',
    window.getComputedStyle(branchesBody).display === 'none');
  click(branchesToggle);
  branchesBody = q('[data-role="branchesBody"]');
  check('un second clic déplie à nouveau visuellement', window.getComputedStyle(branchesBody).display !== 'none');
  click(branchesToggle); // on referme pour la suite du test (persistance après re-rendu)

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

  // ---- 2) Ordre complet de l'en-tête de la carte de morceau ----
  // Réécrit le 01/09 : depuis la restructuration en disposition maître-détail (18/08) et le passage de la
  // bibliothèque de morceaux au glisser-déposer (20/08), toggle-collapse-track/move-track-up/move-track-down
  // n'existent plus DU TOUT (confirmés absents par grep) -- le repli d'un morceau est désormais la sélection
  // dans la liste maître (#libraryMaster, un seul morceau affiché en détail à la fois, voir
  // test_backstage_intro_outro_collapse_and_reorder.js), et la réorganisation se fait par glisser-déposer sur
  // cette même liste maître (poignée .block-drag-handle, testé lui aussi dans le même fichier). L'en-tête de
  // la carte de détail elle-même n'a donc plus aucun bouton de repli/réorganisation : seuls titre+mode (à
  // gauche) et Écouter+Supprimer (à droite) y subsistent. Vérifié ci-dessous.
  const headLeft = q('.list-block-head-left');
  const leftFieldEls = [...headLeft.children];
  check('en-tête gauche : titre puis sélecteur de mode, dans cet ordre',
    leftFieldEls.length === 2
    && leftFieldEls[0].dataset.field === 'title'
    && leftFieldEls[1].dataset.field === 'mode');
  const actionEls = [...q('.list-block-head').children].find(el => el !== headLeft && el.querySelector('[data-action]'));
  const rightActions = actionEls ? [...actionEls.querySelectorAll('[data-action]')].map(el => el.dataset.action) : [];
  check('en-tête droite : Écouter puis Supprimer, plus aucun bouton de repli ni de réorganisation',
    JSON.stringify(rightActions) === JSON.stringify(['preview-track', 'remove-track']));
  check('aucun bouton toggle-collapse-track/move-track-up/move-track-down nulle part dans l\'en-tête (mécanisme entièrement déplacé vers la liste maître)',
    !q('.list-block-head [data-action="toggle-collapse-track"]')
    && !q('.list-block-head [data-action="move-track-up"]')
    && !q('.list-block-head [data-action="move-track-down"]'));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
