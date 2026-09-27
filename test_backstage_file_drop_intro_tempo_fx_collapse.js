// Trois retouches du Backstage (25/09, demandes de Jules-Antoine) :
// 1) glisser-déposer d'un fichier directement sur un sélecteur de fichier (ici l'intro du vertical-random) ;
// 2) BPM / temps par mesure de l'intro du vertical-random réellement enregistrés (un upload, qui redessine
//    le formulaire, les remettait à 4 / 120 : les champs n'étaient branchés sur rien) ;
// 3) panneau d'effets repliable, replié par défaut, état conservé entre deux rendus.
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

  // ---- 1) + 2) Intro du vertical-random ----
  click(q('#btnAddLibraryTrack'));
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'vertical-random');
  click(q('[data-action="select-seq-slot"][data-ti="0"][data-seq-key="vrsIntro"]'));
  const bpmInput = () => q('input[data-field="introBpm"][data-ti="0"]');
  const bpbInput = () => q('input[data-field="introBeatsPerBar"][data-ti="0"]');
  check('champs BPM / temps par mesure de l\'intro présents', !!bpmInput() && !!bpbInput());
  setValue(bpmInput(), '90');
  setValue(bpbInput(), '1');

  const ctrl = q('[data-role="introCtrl"] .file-ctrl');
  const wav = new window.File([new Uint8Array(8)], 'Intro Riser.wav', { type: 'audio/wav' });
  const ev = drop(ctrl, [wav]);
  check('le dépôt est pris en charge (pas d\'ouverture du fichier par le navigateur)', ev.defaultPrevented);
  await new Promise(r => setTimeout(r, 50));
  const status = q('[data-role="introCtrl"] [data-role="fileStatus"]');
  check('le fichier déposé est sélectionné pour l\'intro', status && status.textContent.includes('Intro Riser.wav'));
  check('BPM de l\'intro conservé après le dépôt (et le re-rendu)', bpmInput().value === '90');
  check('temps par mesure de l\'intro conservé après le dépôt (plus de retour à 4)', bpbInput().value === '1');

  const txt = new window.File(['x'], 'notes.txt', { type: 'text/plain' });
  drop(q('[data-role="introCtrl"] .file-ctrl'), [txt]);
  check('un fichier refusé (.txt) ne remplace pas le fichier choisi', q('[data-role="introCtrl"] [data-role="fileStatus"]').textContent.includes('Intro Riser.wav'));

  // ---- 3) Panneau d'effets repliable (morceau statique : une seule couche) ----
  click(q('#btnAddLibraryTrack'));
  setValue(q('#libraryContainer select[data-field="mode"]'), 'static');
  const fxToggle = () => q('[data-role="staticFxHost"] [data-role="fxBlockToggle"]');
  const fxBody = () => q('[data-role="staticFxHost"] [data-role="fxBlockBody"]');
  check('bouton de repli des effets présent', !!fxToggle());
  check('effets repliés par défaut', fxBody().classList.contains('collapsed'));
  click(fxToggle());
  check('un clic déplie les effets', !fxBody().classList.contains('collapsed'));
  setValue(q('input[data-field="title"]'), 'Statique'); // n'importe quelle saisie
  click(q('#libraryMaster .org-row:last-child') || q('#libraryMaster .org-row')); // force un re-rendu
  check('l\'état déplié survit à un re-rendu', fxToggle() && !fxBody().classList.contains('collapsed'));
  click(fxToggle());
  check('un second clic replie', fxBody().classList.contains('collapsed'));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
