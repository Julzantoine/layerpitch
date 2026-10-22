// « Prévisualiser » (Backstage, 12/10) lance aussi la lecture : plus besoin de rappuyer sur Lecture. Le bouton Lecture est grisé pendant le
// chargement des fichiers ; la lecture démarre dès qu'il s'active. Refermer l'aperçu avant la fin du chargement n'en lance aucune.
const { loadBackstage, installTimedFakeAudio } = require('./scripts/test-harness.js');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'], beforeParse: win => installTimedFakeAudio(win) });
  const w = dom.window, doc = w.document;
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const slowFile = (name, ms) => ({ name, size: 8, type: 'audio/wav', arrayBuffer: () => new Promise(r => setTimeout(() => r(new ArrayBuffer(8)), ms)) });

  click(doc.querySelector('#btnAddLibraryTrack'));
  // un morceau d'une couche avec un fichier lent à charger (fichier « en attente » comme après un dépôt)
  w.eval("library[0].mode = 'vertical'; library[0].layers = [{ label: 'L1', pendingFile: null }]; renderLibrary();");
  w.__slowLayer = slowFile('lent.wav', 500);
  w.eval("library[0].layers[0].pendingFile = window.__slowLayer; renderLibrary();");
  const btn = doc.querySelector('#libraryDetail [data-action="preview-track"], #libraryContainer [data-action="preview-track"]');
  check('bouton « Prévisualiser » présent', !!btn);
  click(btn);
  const host = doc.querySelector('[data-role="previewHost"]');
  const play = () => host.querySelector('[data-role="playBtn"]');
  check('l\'aperçu est monté, le bouton Lecture est grisé pendant le chargement', !!play() && play().disabled === true);
  let clicks = 0; play().addEventListener('click', () => { clicks++; });
  await sleep(250);
  check('pendant le chargement : la lecture n\'est pas encore lancée', clicks === 0 && play().disabled === true);
  const t0 = Date.now();
  while (Date.now() - t0 < 4000 && play().disabled) await sleep(80);
  await sleep(400);
  check('chargement terminé : le bouton Lecture a été actionné tout seul, une seule fois', clicks === 1 && play().disabled === false);

  // refermer l'aperçu avant la fin du chargement : rien ne démarre
  click(btn); await sleep(50); // referme
  w.__slowLayer2 = slowFile('lent2.wav', 600);
  w.eval("library[0].layers[0].pendingFile = window.__slowLayer2; renderLibrary();");
  const btn2 = doc.querySelector('[data-action="preview-track"]');
  click(btn2); await sleep(100);
  click(doc.querySelector('[data-action="preview-track"]')); // referme pendant le chargement
  await sleep(1200);
  check('aperçu refermé pendant le chargement : plus d\'aperçu monté, donc aucune lecture', !doc.querySelector('[data-role="previewHost"] [data-role="playBtn"]'));
  // relances successives (flèche d'un champ numérique, 22/10) : l'aperçu repart, mais une seule lecture démarre au final
  w.__slowLayer3 = slowFile('lent3.wav', 500);
  w.eval("library[0].layers[0].pendingFile = window.__slowLayer3; renderLibrary();");
  click(doc.querySelector('[data-action="preview-track"]')); await sleep(60);
  const hostR = doc.querySelector('[data-role="previewHost"]');
  const plays = [];
  const watch = () => { const b = hostR.querySelector('[data-role="playBtn"]'); if (b && !b._watched) { b._watched = true; b.addEventListener('click', () => plays.push(1)); } };
  watch();
  for (let i = 0; i < 4; i++) { w.eval("togglePreview(0, document.querySelector('[data-role=\"previewHost\"]').closest('.list-block') || document.getElementById('libraryContainer')); togglePreview(0, document.querySelector('[data-role=\"previewHost\"]').closest('.list-block') || document.getElementById('libraryContainer'));"); watch(); await sleep(60); }
  await sleep(1800);
  check('aperçu relancé plusieurs fois de suite : une seule lecture démarre', plays.length === 1);
  console.log(failures ? failures + ' échec(s)' : 'Tout est bon');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
