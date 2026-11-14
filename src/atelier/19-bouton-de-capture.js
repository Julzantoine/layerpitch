// Droits de l'atelier vidéo (21/10 : l'outil a quitté la page publique du pack pour l'atelier, voir 20-demarrage-atelier.js).
// Compositeur : admin OU propriétaire de CE pack (élargi le 16 septembre). Studio (?studio=1) : pack acheté par un compte de
// l'équipe (D10, 27/09). Barrière d'AFFICHAGE seulement -- la vraie barrière de sécurité vit dans les RPC SECURITY DEFINER
// (save_video_capture, upsert_video, etc.). Plus besoin du réglage « Tester en jeu » du pack : il ne concerne que la page publique.
// Renvoie true si l'outil est ouvert à ce compte sur ce pack.
async function setupCaptureTrigger(pack, container, opts) {
  const asStudio = !!(opts && opts.asStudio);
  let eligible = false;
  try {
    await loadPurchaseScripts();
    const { session } = await window.LayerPitchAuth.getSession();
    if (!session) return false;
    const client = window.LayerPitchSupabaseClient.getClient();
    const { data: isAdmin } = await client.rpc('is_admin');
    // Export complet (image ré-encodée) réservé à l'admin tant que l'abonnement multicoeur n'existe pas (voir
    // openCapturePanel) -- barrière d'affichage, comme le reste de cet outil.
    window.__lpCaptureIsAdmin = !!isAdmin;
    window.__lpStudioBuyer = false;
    if (asStudio) {
      // Achat par n'importe quel compte de l'équipe du studio (équipes, 28/09) ; repli sur ses propres achats tant que
      // la fonction team_owns_pack n'existe pas en base.
      let owns = false;
      const teamRes = await client.rpc('team_owns_pack', { p_pack_id: pack.id });
      if (!teamRes.error) owns = !!teamRes.data;
      else {
        const { data: bought } = await client.from('pack_purchases').select('id').eq('pack_id', pack.id).limit(1);
        owns = !!(bought && bought.length);
      }
      if (owns) { eligible = true; window.__lpStudioBuyer = true; }
    } else if (isAdmin) {
      eligible = true;
    } else {
      // getMyComposerId (lecture) plutôt qu'ensure_composer_profile : un studio ne doit pas se voir créer un profil compositeur au passage.
      const { composerId: myComposerId } = await window.LayerPitchAuth.getMyComposerId();
      eligible = !!myComposerId && myComposerId === lastResolvedOwnerId;
    }
    if (!eligible) return false;
    // Droits de l'outil vidéo lus dans la matrice (28/09, chantier profils et permissions) : Test in game
    // (capture / edit / saved), Versioning (session / saved), filigrane. En cas d'erreur : droits Rookie (le serveur
    // refuse de toute façon ce que la matrice n'accorde pas).
    window.__lpCaptureLevel = 'capture'; window.__lpVersioningLevel = null; window.__lpNoWatermark = false;
    try {
      const { data: ent } = await client.rpc('my_entitlements');
      const byF = {};
      (ent || []).forEach(r => { byF[r.feature] = r; });
      const lvl = f => (byF[f] && byF[f].allowed ? byF[f].level : null);
      if (window.__lpStudioBuyer) {
        // Droits du palier STUDIO (studio_test_in_game, studio_versioning, studio_no_watermark). Depuis le 21/10 (migration
        // 20261021060000), un studio enregistre ses montages et ses versions vidéo AU NOM DU STUDIO (toute l'équipe les retouche).
        if (!(byF.studio_test_in_game && byF.studio_test_in_game.allowed)) return false; // feu vert studio_space fermé
        window.__lpCaptureLevel = lvl('studio_test_in_game') || 'capture';
        window.__lpVersioningLevel = lvl('studio_versioning');
        window.__lpNoWatermark = !!(byF.studio_no_watermark && byF.studio_no_watermark.allowed);
      } else {
        window.__lpCaptureLevel = lvl('test_in_game') || 'capture';
        window.__lpVersioningLevel = lvl('versioning');
        window.__lpNoWatermark = !!(byF.no_watermark && byF.no_watermark.allowed);
      }
    } catch (e) { console.warn('my_entitlements() indisponible, droits Rookie par défaut', e); }
  } catch (e) { return false; } // jamais bloquant pour le reste de la page

  const captureBtn = document.createElement('button');
  captureBtn.type = 'button';
  captureBtn.className = 'video-capture-trigger-btn';
  captureBtn.textContent = tr('atelierChooseVideoBtn');
  captureBtn.addEventListener('click', () => { if (!videoCaptureState) openVideoCaptureDialog(); }); // pas pendant une prise : elle se perdrait
  container.insertBefore(captureBtn, container.firstChild);
  // &montage=<id> (Backstage → Vidéo → Versioning, bloc vidéo d'un AdReel, espace studio) : ce montage sauvegardé s'ouvre dès que
  // la vidéo est choisie -- le dialogue s'ouvre tout de suite.
  const montageParam = new URLSearchParams(location.search).get('montage');
  if (montageParam) openVideoCaptureDialog(montageParam);

  return true;
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
  // Vidéo reconnue à son type, ou à défaut à son extension (12/11 : un .mov / .mkv / .m4v arrive parfois sans type, selon le système).
  const looksLikeVideo = f => !!f && (/^video\//.test(f.type || '') || (!f.type && /\.(mp4|m4v|mov|webm|mkv|ogv)$/i.test(f.name || '')));
  function handleFile(file) {
    if (!looksLikeVideo(file)) {
      errorEl.textContent = tr('captureChooseVideoError');
      libStatus.textContent = '';
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
    if (!dialog.open) dialog.showModal(); // déjà ouvert (pack republié pendant le choix) : showModal() lèverait une erreur
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
      const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc('list_my_videos', window.__lpStudioBuyer ? { p_studio: true } : {});
      if (error) throw error;
      libraryVideos = (data && data.videos) || [];
    } catch (e) { console.error(e); libraryVideos = []; }
    if (!libraryVideos.length) return;
    const wanted = pendingMontage && pendingMontage.videoFilename;
    const match = wanted ? libraryVideos.find(v => v.originalName === wanted || v.title === wanted || v.file === wanted) : null;
    libSelect.innerHTML = libraryVideos.map(v => `<option value="${window.LayerPlayerCore.escapeHtml(v.id)}" ${match && match.id === v.id ? 'selected' : ''}>${window.LayerPlayerCore.escapeHtml(v.title || v.originalName || v.file)}${v.kind === 'capture_export' ? ' — ' + window.LayerPlayerCore.escapeHtml(tr('captureLibraryKindExport')) : ''}</option>`).join('');
    libPick.hidden = false;
    if (wanted && !match) libStatus.textContent = tr('captureLibraryNoMatch').replace('{video}', wanted);
    // Montage à rouvrir dont la vidéo d'origine est dans la bibliothèque : on la charge directement, sans redemander (06/11).
    if (match && dialog.open) libBtn.click();
  };
  let libAbort = null; // téléchargement de la bibliothèque en cours (arrêté par Annuler)
  libBtn.addEventListener('click', async () => {
    const v = libraryVideos.find(x => x.id === libSelect.value);
    if (!v) return;
    libBtn.disabled = true;
    libStatus.textContent = tr('captureLibraryDownloading');
    try {
      // Lecture par morceaux, avec reprise (13/11, « vidéo bloquée à 47 % ») : un flux qui s'arrête sans erreur laissait l'attente infinie.
      // Maintenant : si plus rien n'arrive pendant 15 s, la connexion est coupée et le téléchargement REPREND là où il s'était arrêté
      // (en-tête Range ; si le serveur l'ignore, on repart du début), jusqu'à 5 essais. « Annuler » arrête aussi le téléchargement.
      libAbort = new AbortController();
      const url = v.base + encodeURIComponent(v.file);
      const STALL_MS = 15000, MAX_TRIES = 5;
      const parts = []; let got = 0, total = 0, blob = null, lastErr = null, ctype = '';
      for (let attempt = 0; attempt < MAX_TRIES && !blob; attempt++) {
        if (libAbort.signal.aborted) break;
        const ctl = new AbortController();
        const onAll = () => ctl.abort();
        libAbort.signal.addEventListener('abort', onAll);
        let timer = null, stalled = false;
        const arm = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; ctl.abort(); }, STALL_MS); };
        try {
          arm();
          const res = await fetch(url, { headers: got > 0 ? { Range: 'bytes=' + got + '-' } : {}, signal: ctl.signal });
          if (res.status === 206) {
            // Content-Range n'est lisible entre sites que si le serveur l'expose (CORS) ; sinon on fait confiance au 206 (la reprise
            // demandée commence à `got`) et le total vaut ce qu'on a déjà + la longueur de cette réponse (Content-Length est toujours lisible).
            const m = /bytes (\d+)-\d+\/(\d+|\*)/.exec(res.headers.get('content-range') || '');
            if (m && Number(m[1]) !== got) { parts.length = 0; got = 0; throw new Error('Reprise décalée'); }
            if (m && m[2] !== '*') total = Number(m[2]);
            else if (!m) total = got + (Number(res.headers.get('content-length')) || 0);
          } else if (res.ok) {
            if (got > 0) { parts.length = 0; got = 0; } // le serveur a ignoré la reprise : on repart du début
            total = Number(res.headers.get('content-length')) || 0;
          } else throw new Error('HTTP ' + res.status);
          ctype = res.headers.get('content-type') || ctype;
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            arm(); parts.push(value); got += value.length;
            libStatus.textContent = tr('captureLibraryDownloading') + ' ' + (total ? Math.round(got * 100 / total) + ' %' : Math.round(got / 1048576) + ' Mo');
          }
          if (total && got < total) throw new Error('Flux interrompu (' + Math.round(got / 1048576) + ' / ' + Math.round(total / 1048576) + ' Mo)');
          blob = new Blob(parts, { type: ctype });
        } catch (e) {
          lastErr = stalled ? new Error('plus rien reçu depuis ' + (STALL_MS / 1000) + ' s') : e;
          if (libAbort.signal.aborted) break;
          console.warn('[atelier] téléchargement de la vidéo interrompu :', lastErr && lastErr.message, '| reçu', got, '/', total, 'octets | essai', attempt + 1, '/', MAX_TRIES, '| connexion', (navigator.connection && navigator.connection.effectiveType) || '?');
          if (attempt < MAX_TRIES - 1) {
            libStatus.textContent = tr('captureLibraryResuming').replace('{n}', String(attempt + 2)).replace('{max}', String(MAX_TRIES)).replace('{reason}', (lastErr && lastErr.message) || '?');
            await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
          }
        } finally {
          clearTimeout(timer);
          libAbort.signal.removeEventListener('abort', onAll);
        }
      }
      if (libAbort.signal.aborted) { libStatus.textContent = ''; return; } // annulé par l'utilisateur
      if (!blob) throw new Error((lastErr && lastErr.name ? lastErr.name + ' : ' : '') + (lastErr && lastErr.message || '') + ' (' + Math.round(got / 1048576) + ' Mo reçus)');
      // Nom du fichier d'origine : c'est lui que le montage a retenu (vérification « bonne vidéo » au chargement).
      const name = v.originalName || v.title || v.file;
      // Le type enregistré peut être générique (application/octet-stream) : on retombe sur le type d'après l'extension, sinon mp4.
      const guess = /\.webm$/i.test(name) ? 'video/webm' : /\.mov$/i.test(name) ? 'video/quicktime' : 'video/mp4';
      const type = [v.mimeType, blob.type].find(t => t && t.startsWith('video/')) || guess;
      libStatus.textContent = '';
      handleFile(new File([blob], name, { type }));
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
  cancelBtn.addEventListener('click', () => { pendingMontageId = null; if (libAbort) libAbort.abort(); dialog.close(); });
  dialog.addEventListener('close', () => { errorEl.textContent = ''; fileInput.value = ''; });
})();

