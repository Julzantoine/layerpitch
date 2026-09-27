// Éligibilité (élargie le 16 septembre) : admin OU le compositeur propriétaire de CE pack --
// auparavant is_admin() uniquement. `lastResolvedOwnerId` est déjà le composer_id propriétaire des
// données affichées (résolu par loadSiteData()) -- comparé à l'id du compositeur connecté
// (ensure_composer_profile(), même RPC que le reste du produit pour "mon propre id"). Barrière
// d'AFFICHAGE seulement (même remarque qu'avant) -- la vraie barrière de sécurité vit dans les RPC
// SECURITY DEFINER elles-mêmes (save_video_capture/upsert_video, etc.), voir
// supabase/migrations/20260916040000_open_capture_video_to_composers.sql. POINT EXPLICITEMENT
// TEMPORAIRE (dit par Jules-Antoine) : à filtrer par palier d'abonnement (Rookie/Warrior/Boss) au
// lancement -- pas construit par anticipation ici, rien à quoi le rattacher n'existe encore. Ne
// charge les scripts d'auth que si nécessaire, comme le fait déjà loadPurchaseScripts() pour l'achat
// -- page publique, rien de tout ça ne doit ralentir un visiteur ordinaire.
async function setupCaptureTrigger(pack, container) {
  if (!pack.videoTestModeEnabled) return;
  let eligible = false;
  try {
    await loadPurchaseScripts();
    const { session } = await window.LayerPitchAuth.getSession();
    if (!session) return;
    const client = window.LayerPitchSupabaseClient.getClient();
    const { data: isAdmin } = await client.rpc('is_admin');
    // Export complet (image ré-encodée) réservé à l'admin tant que l'abonnement multicoeur n'existe pas (voir
    // openCapturePanel) -- barrière d'affichage, comme le reste de cet outil.
    window.__lpCaptureIsAdmin = !!isAdmin;
    if (isAdmin) {
      eligible = true;
    } else {
      const { data: myComposerId } = await client.rpc('ensure_composer_profile');
      eligible = !!myComposerId && myComposerId === lastResolvedOwnerId;
    }
    if (!eligible) return;
  } catch (e) { return; } // jamais bloquant pour le reste de la page

  const captureBtn = document.createElement('button');
  captureBtn.type = 'button';
  captureBtn.className = 'video-capture-trigger-btn';
  captureBtn.textContent = tr('captureDialogTitle');
  captureBtn.addEventListener('click', () => openVideoCaptureDialog());
  container.insertBefore(captureBtn, container.firstChild);
  // Lien direct depuis le Backstage (bibliothèque vidéo, sous-onglet "Capture", ?capture=1) : ouvre le
  // dialogue tout de suite, sans clic supplémentaire depuis la liste des packs du compositeur.
  // &montage=<id> (Backstage → Vidéo → Versioning, 26/09) : ce montage sauvegardé s'ouvre dès que la vidéo est choisie.
  if (new URLSearchParams(location.search).get('capture') === '1') {
    openVideoCaptureDialog(new URLSearchParams(location.search).get('montage'));
  }

  // Boutons ⏺ "Armer" -- un par morceau, posés directement à côté de son propre bouton de lecture dans
  // le VRAI lecteur du pack (pas un sélecteur séparé dans le panneau de capture) : plus logique puisque
  // c'est là que le compositeur manipule déjà les morceaux (confirmé par Jules-Antoine 2026-09-15).
  // Exclusif -- en armer un désarme automatiquement l'ancien. `[data-track-id]` posé par
  // renderTracksBlock (player.js, décoratif) permet de retrouver quel bloc correspond à quel morceau.
  document.querySelectorAll('[data-track-id]').forEach(row => {
    const playBtn = row.querySelector('[data-role="playBtn"]');
    if (!playBtn || row.querySelector('.video-capture-arm-track-btn')) return;
    const armBtn = document.createElement('button');
    armBtn.type = 'button';
    armBtn.className = 'video-capture-arm-track-btn';
    armBtn.textContent = '⏺';
    armBtn.title = tr('captureArmBtnTitle');
    armBtn.addEventListener('click', () => {
      const trackId = row.dataset.trackId;
      armedTrackId = (armedTrackId === trackId) ? null : trackId; // reclique = désarme
      document.querySelectorAll('.video-capture-arm-track-btn').forEach(b => b.classList.remove('armed'));
      if (armedTrackId === trackId) armBtn.classList.add('armed');
      updateArmedStatusDisplay();
    });
    playBtn.insertAdjacentElement('afterend', armBtn);
  });
}

// Montage à ouvrir dès que la vidéo est choisie (lien du Backstage), et sa fiche (titre, nom de la vidéo d'origine).
let pendingMontageId = null;
let pendingMontage = null;
let openVideoCaptureDialog = () => {};
(function setupVideoCaptureDialog() {
  const dialog = document.getElementById('videoCaptureDialog');
  const dropzone = document.getElementById('videoCaptureDropzone');
  const fileInput = document.getElementById('videoCaptureFileInput');
  const errorEl = document.getElementById('videoCaptureError');
  const cancelBtn = document.getElementById('videoCaptureCancelBtn');
  const montageNote = document.getElementById('videoCaptureMontageNote');
  const libPick = document.getElementById('videoCaptureLibraryPick');
  const libSelect = document.getElementById('videoCaptureLibrarySelect');
  const libBtn = document.getElementById('videoCaptureLibraryBtn');
  const libStatus = document.getElementById('videoCaptureLibraryStatus');
  if (!dialog) return;
  let libraryVideos = [];
  function handleFile(file) {
    if (!file || !file.type.startsWith('video/')) {
      errorEl.textContent = tr('captureChooseVideoError');
      return;
    }
    errorEl.textContent = '';
    dialog.close();
    const montageId = pendingMontageId;
    pendingMontageId = null;
    openCapturePanel(file, { montageId });
  }
  // Ouverture du dialogue ; montageId (facultatif) : montage sauvegardé à ouvrir dans la foulée. La vidéo n'étant jamais
  // sauvegardée avec le montage (seul son nom), elle se choisit ici -- sur le disque, ou (admin, 26/09) directement dans
  // la bibliothèque vidéo du compositeur, la vidéo d'origine présélectionnée si elle s'y trouve.
  openVideoCaptureDialog = async (montageId) => {
    pendingMontageId = montageId || null;
    pendingMontage = null;
    montageNote.hidden = true;
    libPick.hidden = true;
    libStatus.textContent = '';
    dialog.showModal();
    if (pendingMontageId) {
      try {
        pendingMontage = await loadVideoCapture(pendingMontageId);
        montageNote.textContent = tr('captureMontageToOpen').replace('{title}', pendingMontage.title || tr('captureUntitled'))
          + (pendingMontage.videoFilename ? ' ' + tr('captureMontageOriginalVideo').replace('{video}', pendingMontage.videoFilename) : '');
        montageNote.hidden = false;
      } catch (e) {
        console.error(e);
        pendingMontageId = null;
        errorEl.textContent = tr('captureLoadFailed').replace('{error}', e.message);
      }
    }
    if (!window.__lpCaptureIsAdmin) return; // nouveauté réservée à l'admin jusqu'au feu vert
    try {
      const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc('list_my_videos');
      if (error) throw error;
      libraryVideos = (data && data.videos) || [];
    } catch (e) { console.error(e); libraryVideos = []; }
    if (!libraryVideos.length) return;
    const wanted = pendingMontage && pendingMontage.videoFilename;
    const match = wanted ? libraryVideos.find(v => v.originalName === wanted || v.title === wanted || v.file === wanted) : null;
    libSelect.innerHTML = libraryVideos.map(v => `<option value="${window.LayerPlayerCore.escapeHtml(v.id)}" ${match && match.id === v.id ? 'selected' : ''}>${window.LayerPlayerCore.escapeHtml(v.title || v.originalName || v.file)}${v.kind === 'capture_export' ? ' — ' + window.LayerPlayerCore.escapeHtml(tr('captureLibraryKindExport')) : ''}</option>`).join('');
    libPick.hidden = false;
    if (wanted && !match) libStatus.textContent = tr('captureLibraryNoMatch').replace('{video}', wanted);
  };
  libBtn.addEventListener('click', async () => {
    const v = libraryVideos.find(x => x.id === libSelect.value);
    if (!v) return;
    libBtn.disabled = true;
    libStatus.textContent = tr('captureLibraryDownloading');
    try {
      const res = await fetch(v.base + encodeURIComponent(v.file));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      // Nom du fichier d'origine : c'est lui que le montage a retenu (vérification « bonne vidéo » au chargement).
      const name = v.originalName || v.title || v.file;
      handleFile(new File([blob], name, { type: v.mimeType || blob.type || 'video/mp4' }));
    } catch (e) {
      console.error(e);
      libStatus.textContent = tr('captureLibraryDownloadFailed').replace('{error}', e.message);
    } finally {
      libBtn.disabled = false;
    }
  });
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
  });
  cancelBtn.addEventListener('click', () => { pendingMontageId = null; dialog.close(); });
  dialog.addEventListener('close', () => { errorEl.textContent = ''; fileInput.value = ''; });
})();

