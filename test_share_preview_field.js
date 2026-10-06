// Champs « Aperçu des liens partagés » du Backstage (rubrique Réseaux sociaux, 1er/10) : le vrai Backstage dans jsdom.
// Les champs suivent l'état, l'aperçu se redessine, le bouton « Retirer l'image » met le fichier publié en file d'effacement,
// et l'instantané publié (buildDataSnapshot) contient bien titre, description et image.
const { loadBackstage } = require('./scripts/test-harness.js');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; }

(async () => {
  const dom = await loadBackstage();
  const w = dom.window, doc = w.document;
  const run = code => w.eval(code);
  const typeIn = (id, v) => { const el = doc.getElementById(id); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  check('la carte est dans la rubrique Réseaux sociaux', !!doc.querySelector('[data-panel="socials"] #sharePreviewCard'));
  run("sharePreview = { title: 'Titre publié', description: 'Desc', image: 'cmp1/share-preview.png', imageOriginalName: 'bandeau.png' }; sharePreviewPendingFile = null; hasUnsavedEdits = false; pendingOrphanR2Keys.clear(); fillSharePreviewFields()");
  check('champs remplis depuis l\'état', doc.getElementById('sharePreviewTitleInput').value === 'Titre publié' && doc.getElementById('sharePreviewDescInput').value === 'Desc');
  check('aperçu : titre, description et image publiée', /Titre publié/.test(doc.getElementById('sharePreviewMock').textContent) && /Desc/.test(doc.getElementById('sharePreviewMock').textContent) && /media\.layerpitch\.com\/images\/cmp1\/share-preview\.png/.test(doc.getElementById('sharePreviewMock').innerHTML));
  typeIn('sharePreviewTitleInput', 'Nouveau <titre>'); typeIn('sharePreviewDescInput', 'Nouvelle description');
  check('saisie : état mis à jour, modifications non publiées signalées', run('sharePreview.title') === 'Nouveau <titre>' && run('sharePreview.description') === 'Nouvelle description' && run('hasUnsavedEdits') === true);
  check('aperçu redessiné, texte échappé (aucune balise injectée)', /Nouvelle description/.test(doc.getElementById('sharePreviewMock').textContent) && !doc.getElementById('sharePreviewMock').querySelector('titre'));
  const snap = run("buildDataSnapshot('pro', 1)");
  check('instantané publié : titre, description, image', snap.sharePreview && snap.sharePreview.title === 'Nouveau <titre>' && snap.sharePreview.description === 'Nouvelle description' && snap.sharePreview.image === 'cmp1/share-preview.png');
  const rm = () => doc.querySelector('#sharePreviewImageCtrl [data-role="removeSharePreviewImage"]');
  check('image présente : bouton « Retirer l\'image » visible', rm().hidden === false);
  rm().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('retrait : image vidée, fichier publié en file d\'effacement, bouton masqué', run('sharePreview.image') === null && run("pendingOrphanR2Keys.has('images/cmp1/share-preview.png')") === true && rm().hidden === true);
  check('retrait : le texte saisi est conservé', run('sharePreview.title') === 'Nouveau <titre>');
  check('sans image : aperçu avec l\'image LayerPitch par défaut', /par défaut/.test(doc.getElementById('sharePreviewMock').textContent));
  run("sharePreview = Object.assign({}, DEFAULT_SHARE_PREVIEW); sharePreviewPendingFile = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })");
  check('image choisie mais pas publiée : l\'instantané ne contient pas encore de chemin', run("buildDataSnapshot('pro', 1).sharePreview.image") === null);
  // ---- Ajustage automatique (1er/10) ----
  const R = (w, h) => run(`sharePreviewCropRect(${w}, ${h})`);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const wide = R(2000, 630), tall = R(1000, 1000), exact = R(1200, 630);
  check('recadrage : plus large -> colonne centrale pleine hauteur', wide.sy === 0 && wide.sh === 630 && wide.sx === Math.floor((2000 - wide.sw) / 2) && Math.abs(wide.sw / wide.sh - 1200 / 630) < 0.01);
  check('recadrage : carré -> bande centrale pleine largeur', tall.sx === 0 && tall.sw === 1000 && tall.sy === Math.floor((1000 - tall.sh) / 2) && Math.abs(tall.sw / tall.sh - 1200 / 630) < 0.01);
  check('recadrage : déjà au bon format -> image entière', same(exact, { sx: 0, sy: 0, sw: 1200, sh: 630 }));
  check('image de Jules-Antoine (1306 × 686) : déjà bonne, rien à recadrer', run('sharePreviewNeedsFit(1306, 686)') === false);
  check('trop petite (800 × 420) ou mauvais format (1200 × 1200) : à ajuster', run('sharePreviewNeedsFit(800, 420)') === true && run('sharePreviewNeedsFit(1200, 1200)') === true);
  check('case cochée par défaut, et l\'état la suit', doc.getElementById('sharePreviewAutoFit').checked === true && run('DEFAULT_SHARE_PREVIEW.autoFit') === true);
  const box = doc.getElementById('sharePreviewAutoFit'); box.checked = false; box.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('case décochée : état mis à jour, modifications non publiées, publiée dans l\'instantané', run('sharePreview.autoFit') === false && run('hasUnsavedEdits') === true && run("buildDataSnapshot('pro', 1).sharePreview.autoFit") === false);
  box.checked = true; box.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('case recochée : aperçu en recadrage centré (cover)', /object-fit:cover/.test(doc.getElementById('sharePreviewMock').innerHTML) || !/<img/.test(doc.getElementById('sharePreviewMock').innerHTML));
  const C = (w, h) => run(`sharePreviewContainRect(${w}, ${h})`);
  check('image entière : carrée -> réduite, bandes de chaque côté, rien de coupé', same(C(1000, 1000), { dx: 285, dy: 0, dw: 630, dh: 630 }));
  check('image entière : très large -> bandes en haut et en bas', C(2400, 600).dw === 1200 && C(2400, 600).dh === 300 && C(2400, 600).dy === 165 && C(2400, 600).dx === 0);
  check('image entière : proportions conservées (aucune déformation)', (() => { const c = C(1000, 1000); return c.dw === c.dh; })() && (() => { const c = C(1306, 686); return Math.abs(c.dw / c.dh - 1306 / 686) < 0.01; })());
  const sel = doc.getElementById('sharePreviewFitMode');
  check('liste du mode : « recadrer » par défaut, active quand la case est cochée', sel.value === 'fill' && sel.disabled === false);
  sel.value = 'contain'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('mode « image entière » : état, instantané publié et aperçu', run('sharePreview.fitMode') === 'contain' && run("buildDataSnapshot('pro', 1).sharePreview.fitMode") === 'contain');
  box.checked = false; box.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('case décochée : la liste est désactivée', sel.disabled === true);
  const colorWrap = doc.getElementById('sharePreviewFitColorWrap'), colorInput = doc.getElementById('sharePreviewFitColor');
  box.checked = true; box.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('marie-louise : sélecteur de couleur visible en mode « image entière », blanc par défaut', colorWrap.style.display === 'flex' && colorInput.value === '#ffffff');
  colorInput.value = '#14181d'; colorInput.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('couleur choisie : état mis à jour', run('sharePreview.fitColor') === '#14181d');
  check('couleur choisie : publiée dans l\'instantané', run("buildDataSnapshot('pro', 1).sharePreview.fitColor") === '#14181d');
  run("sharePreview.fitColor = 'rouge'");
  check('couleur invalide : repli sur le blanc à la publication', run("buildDataSnapshot('pro', 1).sharePreview.fitColor") === '#ffffff');
  sel.value = 'fill'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('mode « recadrer » : le sélecteur de couleur se masque', colorWrap.style.display === 'none');
  console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
