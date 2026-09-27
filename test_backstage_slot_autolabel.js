// Non-régression (bug trouvé le 13/08) : quand un dépôt de fichier crée un nouvel emplacement séquentiel
// (dépôt groupé sur la zone "Emplacements", dépôt groupé au niveau du morceau avec devinette de rôle, ou
// reclassification de rôle après un tel dépôt), le nom de L'EMPLACEMENT lui-même doit se remplir avec le
// nom du fichier — jusqu'ici seule l'alternative à l'intérieur héritait du nom, obligeant à ouvrir
// "Voir les variations" pour savoir quel fichier avait atterri où.
//
// Adapté le 25/09 : dépôt sur l'entrée d'un slot créé avec « + Slot » (la liste entière n'accepte plus de dépôt).
// Réécrit le 01/09 : la zone de dépôt directe des emplacements est désormais `[data-role="segmentSlotsMaster"]`
// (l'ancien `[data-role="segmentSlots"]` n'existe plus, confirmé par grep — remplacé par la liste maître de
// la disposition maître-détail du 18/08). Le champ libellé de l'emplacement créé n'est visible qu'une fois
// l'emplacement sélectionné (même mécanisme que test_backstage_slot_collapse.js) -- ajouté ci-dessous.
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

  // ---- Dépôt sur le nom d'un slot dans la liste de gauche (25/09 : plus de dépôt "un slot par fichier" sur
  // la liste entière -- on crée le slot, puis on y dépose). Le slot sans nom prend celui du fichier. ----
  click(q('[data-action="add-segment-slot"][data-ti="0"]'));
  const host = q('[data-action="select-seq-slot"][data-ti="0"][data-si="0"]');
  check('entrée du slot trouvée dans la liste', !!host);
  if (host) {
    drop(host, [fakeFile('#1_WetDarkCave_120bpm.wav')]);
    const labelInput = q('input[data-slot-field="label"][data-ti="0"][data-si="0"]');
    check('le slot est sélectionné et nommé d\'après le fichier (jeton bpm retiré)', !!labelInput && labelInput.value === '#1 WetDarkCave');
    const bpmInput = q('input[data-slot-field="bpm"][data-ti="0"][data-si="0"]');
    check('le bpm détecté dans le nom du fichier est bien repris dans le champ dédié', !!bpmInput && bpmInput.value === '120');
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
