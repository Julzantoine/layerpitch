/* ---------------- Retour bêta (formulaire vers Formspree, compte Jules-Antoine) ---------------- */
// Endpoint fixe (pas celui du testeur) : tous les retours bêta doivent arriver au même endroit,
// quel que soit le repo depuis lequel ils sont envoyés. Réutilise volontairement le même endpoint
// Formspree que le formulaire de contact public (compte Jules-Antoine) — les deux flux se distinguent
// dans la boîte mail via le sujet auto-généré ci-dessous (repo/testeur).
const BETA_FEEDBACK_ENDPOINT = 'https://formspree.io/f/mojognrj';

// Compression côté navigateur (18/09) : une capture plein écran (surtout Retina) peut peser plusieurs
// Mo en PNG -- largement au-dessus de ce que Formspree accepte en pièce jointe côté gratuit. Redimensionne
// (largeur/hauteur max) et ré-encode en JPEG via <canvas> avant l'envoi -- opération légère et instantanée,
// rien à voir avec la compression vidéo (mise de côté ailleurs pour cause de coût CPU en simple thread).
// Jamais appliqué à un fichier déjà compact (pas la peine de recompresser une petite capture), ni à un
// type que <canvas> ne saurait pas redessiner correctement (SVG notamment).
const SCREENSHOT_MAX_DIMENSION = 1600;
const SCREENSHOT_COMPRESS_THRESHOLD_BYTES = 900 * 1024; // sous ce seuil, envoyé tel quel
async function compressScreenshotIfNeeded(file) {
  if (!file || file.size <= SCREENSHOT_COMPRESS_THRESHOLD_BYTES || !/^image\/(png|jpe?g|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, SCREENSHOT_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close && bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.75));
    // Repli sur le fichier d'origine s'il était déjà plus compact que le résultat recompressé (rare,
    // ex. petite image déjà en JPEG optimisé) -- jamais envoyer un fichier PLUS gros après "compression".
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch (e) {
    return file; // décodage/canvas indisponible ou échoué -- on envoie l'original plutôt que de bloquer le retour
  }
}

// Capture d'écran jointe au retour en cours (18/09) : un seul fichier à la fois, choisi via le champ
// fichier ou collé (Cmd/Ctrl+V) directement dans le textarea -- geste naturel pour un bug visuel.
// feedbackScreenshotReady : promesse de la compression en cours, attendue par l'envoi (feedbackSend
// ci-dessous) pour ne jamais envoyer un fichier pas encore compressé si Envoyer est cliqué très vite
// après avoir choisi/collé l'image.
let feedbackScreenshotFile = null;
let feedbackScreenshotToken = 0;
let feedbackScreenshotReady = Promise.resolve();
function setFeedbackScreenshot(file) {
  const myToken = ++feedbackScreenshotToken;
  const info = document.getElementById('feedbackAttachInfo');
  const fileInput = document.getElementById('feedbackScreenshot');
  if (!file) {
    feedbackScreenshotFile = null;
    info.innerHTML = '';
    if (fileInput) fileInput.value = '';
    feedbackScreenshotReady = Promise.resolve();
    return;
  }
  info.textContent = tr('feedbackAttachCompressing');
  feedbackScreenshotReady = compressScreenshotIfNeeded(file).then(compressed => {
    if (myToken !== feedbackScreenshotToken) return; // un autre fichier a été choisi entretemps
    feedbackScreenshotFile = compressed;
    info.innerHTML = '';
    const name = document.createElement('span');
    name.textContent = compressed.name;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.title = tr('feedbackAttachRemove');
    removeBtn.addEventListener('click', () => setFeedbackScreenshot(null));
    info.append(name, removeBtn);
  });
}
document.getElementById('feedbackScreenshot').addEventListener('change', (e) => {
  setFeedbackScreenshot(e.target.files[0] || null);
});
// Collage d'une capture directement dans le champ de message (ex. Cmd+Shift+4 puis Cmd+V sur Mac) :
// évite l'aller-retour par le Finder pour le cas d'usage le plus courant (bug visuel constaté à l'instant).
document.getElementById('feedbackMessage').addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) setFeedbackScreenshot(file);
      e.preventDefault();
      break;
    }
  }
});

function openFeedbackModal() {
  document.getElementById('feedbackMessage').value = '';
  setFeedbackScreenshot(null);
  const statusEl = document.getElementById('feedbackModalStatus');
  statusEl.textContent = '';
  statusEl.className = '';
  document.getElementById('feedbackModalOverlay').style.display = 'flex';
  document.getElementById('feedbackMessage').focus();
}
document.getElementById('btnOpenFeedback').addEventListener('click', openFeedbackModal);
document.getElementById('feedbackCancel').addEventListener('click', () => {
  document.getElementById('feedbackModalOverlay').style.display = 'none';
});
document.getElementById('feedbackSend').addEventListener('click', async () => {
  const message = document.getElementById('feedbackMessage').value.trim();
  const statusEl = document.getElementById('feedbackModalStatus');
  if (!message) return;
  const sendBtn = document.getElementById('feedbackSend');
  sendBtn.disabled = true;
  statusEl.className = '';
  statusEl.textContent = tr('feedbackSendingStatus');
  try {
    await feedbackScreenshotReady; // ne jamais envoyer avant la fin de la compression en cours
    // Email du compte connecté (Supabase) : identifie qui écrit de façon fiable, contrairement au
    // champ repo ci-dessous qui reste vide tant que le testeur n'a pas rempli owner/repo à la main.
    let testerEmail = '';
    try {
      const { session } = await window.LayerPitchAuth.getSession();
      if (session && session.user) testerEmail = session.user.email || '';
    } catch (e) { /* session indisponible : on envoie quand même le retour, sans email */ }
    const body = new FormData();
    body.append('message', message);
    body.append('email', testerEmail);
    // Contexte auto-inclus : quel repo (donc quel testeur) envoie ce retour, sans avoir à le redemander.
    body.append('handle', myComposerHandle || '');
    body.append('_subject', `Retour LayerPitch — ${testerEmail || myComposerHandle || 'compositeur'}`);
    if (feedbackScreenshotFile) body.append('attachment', feedbackScreenshotFile, feedbackScreenshotFile.name);
    const res = await fetch(BETA_FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body
    });
    if (res.ok) {
      statusEl.className = 'ok';
      statusEl.textContent = tr('feedbackSentStatus');
      document.getElementById('feedbackMessage').value = '';
      setFeedbackScreenshot(null);
      setTimeout(() => { document.getElementById('feedbackModalOverlay').style.display = 'none'; }, 1200);
    } else {
      statusEl.className = 'err';
      statusEl.textContent = tr('feedbackErrorStatus');
    }
  } catch (e) {
    statusEl.className = 'err';
    statusEl.textContent = tr('feedbackErrorStatus');
  } finally {
    sendBtn.disabled = false;
  }
});

