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
  console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
