// Demande du 15/08 : "toutes les flèches repliées par défaut quand on ouvre le backstage" + "il faut une
// flèche pour sfx" (le sélecteur de Sfx attachés à un morceau n'avait aucun repli).
//
// Réécrit le 01/09 : depuis la restructuration en disposition maître-détail (18/08), le bootstrap
// collapsedSlotIds/collapsedSfxIds (Sets peuplés au chargement pour tout replier) n'existe plus du tout
// (confirmé par grep) -- il n'a plus de raison d'être, puisque le nouveau mécanisme de sélection exclusive
// (seqSelectedSlotIndex) n'affiche QUE l'élément sélectionné par défaut ('trackinfo'), donc "tout est replié
// sauf un" est désormais la position de repos naturelle du design, sans Set à maintenir. Couvert par
// test_backstage_slot_collapse.js ("aucun détail d'emplacement affiché par défaut").
// Le second volet (repli des Sfx attachés à un morceau, trackSfxToggle/trackSfxBody) a lui aussi disparu de
// ce nom -- le contenu "Sfx (déclenchables à la main pendant la lecture)" est désormais une entrée virtuelle
// de plus dans la même liste maître ('sfx', juste après les emplacements), donc replié/déplié par le MÊME
// mécanisme de sélection que les emplacements, pas par un toggle dédié. Réécrit ci-dessous.
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

  const sfxMasterItem = q('[data-action="select-seq-slot"][data-ti="0"][data-seq-key="sfx"]');
  check('l\'entrée "Contenu additionnel" (Sfx) est présente dans la liste maître', !!sfxMasterItem);
  check('les Sfx attachés au morceau sont REPLIÉS par défaut (sélection sur "Infos du morceau")', !q('[data-role="trackSfxSelector"][data-ti="0"]'));

  click(sfxMasterItem);
  check('cliquer sur l\'entrée Sfx déplie son détail (sélecteur de Sfx affiché)', !!q('[data-role="trackSfxSelector"][data-ti="0"]'));

  click(q('[data-action="select-seq-slot"][data-ti="0"][data-seq-key="trackinfo"]'));
  check('sélectionner "Infos du morceau" replie à nouveau les Sfx (un seul détail affiché à la fois)', !q('[data-role="trackSfxSelector"][data-ti="0"]'));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
