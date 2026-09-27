function closeCapturePanel() {
  if (videoCaptureState) stopCapture();
  if (capturePanelVersioning) { capturePanelVersioning.stop(); capturePanelVersioning = null; }
  const panel = document.getElementById('videoTestPanel');
  panel.classList.remove('active');
  document.body.classList.remove('video-panel-active');
  panel.innerHTML = ''; // libère l'URL objet de la vidéo en vidant le <video>, pas juste en le masquant
  const detached = capturePanelDetachedWindow;
  capturePanelDetachedWindow = null;
  if (detached && !detached.closed) detached.close();
}

// Déplace le VRAI contenu du panneau (pas une copie) dans une fenêtre séparée -- conserve tous les
// écouteurs déjà posés dessus (bouton d'enregistrement, glisser sur la frise, etc.), puisque déplacer
// un nœud DOM via appendChild ne détruit jamais ses écouteurs. Les feuilles <style> de la page sont
// recopiées (cloneNode) pour que le contenu déplacé garde son apparence -- le reste (polices Google)
// est chargé via un @import DANS cette même feuille, donc suit automatiquement.
function detachCapturePanel() {
  const panel = document.getElementById('videoTestPanel');
  if (!panel.firstChild || capturePanelDetachedWindow) return; // rien à détacher, ou déjà détaché
  const win = window.open('', '_blank', 'width=980,height=760');
  if (!win) return; // popup bloqué par le navigateur -- on reste comme avant, sans erreur bruyante
  capturePanelDetachedWindow = win;
  win.document.title = document.title;
  document.querySelectorAll('style').forEach(styleEl => win.document.head.appendChild(styleEl.cloneNode(true)));
  win.document.body.style.cssText = 'margin:0;background:#0d0d0d;';
  const wrapper = win.document.createElement('div');
  wrapper.className = 'video-test-panel active';
  wrapper.style.cssText = 'max-width:none;width:100%;';
  while (panel.firstChild) wrapper.appendChild(panel.firstChild); // déplace les vrais nœuds, pas une copie
  win.document.body.appendChild(wrapper);
  panel.classList.remove('active');
  document.body.classList.remove('video-panel-active');
  // Fermeture de la fenêtre détachée PAR L'UTILISATEUR (croix du navigateur, pas notre bouton ✕, qui
  // passe déjà par closeCapturePanel() ci-dessus et vide capturePanelDetachedWindow avant d'appeler
  // .close() -- ce garde évite donc un double nettoyage dans ce cas).
  win.addEventListener('pagehide', () => {
    if (capturePanelDetachedWindow !== win) return;
    capturePanelDetachedWindow = null;
    if (videoCaptureState) stopCapture();
  });
}

function openCapturePanel(file, opts) {
  opts = opts || {};
  const panel = document.getElementById('videoTestPanel');
  const objectUrl = URL.createObjectURL(file);
  panel.innerHTML = `
    <div class="video-test-panel-header">
      <span class="video-test-panel-title">${tr('capturePanelTitle').replace('{name}', window.LayerPlayerCore.escapeHtml(file.name))}</span>
      <div class="video-test-panel-actions">
        <button type="button" class="video-test-panel-btn" id="videoCaptureDetachBtn" title="${tr('detachBtn')}" aria-label="${tr('detachBtn')}">⤢</button>
        <button type="button" class="video-test-panel-btn" id="videoCaptureCloseBtn" title="${tr('closeBtn')}" aria-label="${tr('closeBtn')}">✕</button>
      </div>
    </div>
    <div class="video-test-panel-frame-wrap"><video id="videoCaptureEl" src="${objectUrl}" controls muted></video></div>
    <div class="video-capture-bar">
      <button type="button" class="video-capture-record-btn" id="videoCaptureRecordBtn"><span class="dot"></span><span id="videoCaptureRecordLabel">${tr('captureStartBtn')}</span></button>
      <label class="video-capture-export-opt" id="videoCaptureAdditiveLabel" title="${tr('captureAdditiveHelp')}" hidden>
        <input type="checkbox" id="videoCaptureAdditiveCheckbox"> ${tr('captureAdditiveLabel')}
      </label>
      <span class="video-capture-armed-status" id="videoCaptureArmedStatus" title="${tr('captureArmedHelp')}"></span>
      <span class="video-capture-count" id="videoCaptureCount"></span>
    </div>
    <div class="video-capture-bar">
      <label class="video-capture-export-opt" title="${tr('captureCreditHelp')}">
        <input type="checkbox" id="videoCaptureCreditCheckbox" checked> ${tr('captureCreditLabel')}
      </label>
      <button type="button" class="video-capture-download-btn" id="videoCaptureExportBtn" disabled>${tr('captureExportBtn')}</button>
      <button type="button" class="video-capture-download-btn" id="videoCaptureExportAudioBtn" disabled title="${tr('captureExportAudioHelp')}">${tr('captureExportAudioBtn')}</button>
      <button type="button" class="video-capture-download-btn" id="videoCaptureExportCopyBtn" disabled title="${tr('captureExportCopyHelp')}">${tr('captureExportCopyBtn')}</button>
      <button type="button" class="video-capture-download-btn" id="videoCaptureAddToLibraryBtn" hidden>${tr('captureAddToLibraryBtn')}</button>
      <span class="video-capture-count" id="videoCaptureExportStatus"></span>
    </div>
    <div class="video-capture-bar">
      <input type="text" class="video-capture-title-input" id="videoCaptureTitleInput" placeholder="${tr('captureTitleInputPlaceholder')}">
      <button type="button" class="video-capture-download-btn" id="videoCaptureSaveBtn" disabled>${tr('captureSaveBtn')}</button>
      <select class="video-capture-load-select" id="videoCaptureLoadSelect" disabled><option value="">${tr('captureLoadOptionDefault')}</option></select>
      <button type="button" class="video-capture-download-btn" id="videoCaptureLoadBtn" disabled>${tr('captureLoadBtn')}</button>
      <span class="video-capture-count" id="videoCaptureSaveStatus"></span>
    </div>
    <div class="video-capture-timeline" id="videoCaptureTimeline"></div>
    <div class="video-capture-versioning" id="videoCaptureVersioning" hidden></div>
  `;
  panel.classList.add('active');
  document.body.classList.add('video-panel-active');
  updateArmedStatusDisplay(); // reflète tout de suite une piste déjà armée avant l'ouverture du panneau
  const videoEl = document.getElementById('videoCaptureEl');
  const recordBtn = document.getElementById('videoCaptureRecordBtn');
  const recordLabel = document.getElementById('videoCaptureRecordLabel');
  const countEl = document.getElementById('videoCaptureCount');
  const exportBtn = document.getElementById('videoCaptureExportBtn');
  const exportAudioBtn = document.getElementById('videoCaptureExportAudioBtn');
  const exportCopyBtn = document.getElementById('videoCaptureExportCopyBtn');
  // Export COMPLET grisé pour tout compte non-admin (24/09, demande de Jules-Antoine) : ré-encoder l'image avec
  // ffmpeg.wasm mono-coeur prend ~10 min pour 3 min de vidéo -- réservé à l'admin tant qu'il n'y a pas d'abonnement
  // multicoeur (compression côté serveur, voir la note sur les limites de ffmpeg.wasm). Les deux exports rapides
  // (audio seul, vidéo sans ré-encodage) restent ouverts à tous les éligibles.
  const fullExportLocked = !window.__lpCaptureIsAdmin;
  const setExportButtonsDisabled = (v) => { exportBtn.disabled = v || fullExportLocked; exportAudioBtn.disabled = v; exportCopyBtn.disabled = v; };
  if (fullExportLocked) {
    exportBtn.title = tr('captureExportFullLockedHint');
    exportBtn.insertAdjacentHTML('afterend', `<span class="video-capture-count" id="videoCaptureFullLockedNote">${tr('captureExportFullLockedNote')}</span>`);
  }
  const addToLibraryBtn = document.getElementById('videoCaptureAddToLibraryBtn');
  const exportStatus = document.getElementById('videoCaptureExportStatus');
  const additiveLabel = document.getElementById('videoCaptureAdditiveLabel');
  const additiveCheckbox = document.getElementById('videoCaptureAdditiveCheckbox');
  const creditCheckbox = document.getElementById('videoCaptureCreditCheckbox');
  const titleInput = document.getElementById('videoCaptureTitleInput');
  const saveBtn = document.getElementById('videoCaptureSaveBtn');
  const loadSelect = document.getElementById('videoCaptureLoadSelect');
  const loadBtn = document.getElementById('videoCaptureLoadBtn');
  const saveStatus = document.getElementById('videoCaptureSaveStatus');
  const timelineEl = document.getElementById('videoCaptureTimeline');
  let lastEvents = [];
  let lastExportBlob = null; // dernier export réussi, en attente d'un envoi optionnel vers la bibliothèque
  // Identifiant de la prise sauvegardée en cours (null tant qu'aucune sauvegarde n'a encore été faite
  // pour CETTE prise -- généré au premier clic sur Sauvegarder, réutilisé ensuite pour que les
  // sauvegardes successives mettent à jour la même ligne plutôt que d'en créer une nouvelle à chaque
  // fois). Remplacé par l'id chargé si le compositeur reprend une prise existante via "Charger".
  let currentCaptureId = null;
  // Montage réellement présent en base (sauvegarde réussie ou chargement) -- les versions vidéo (Versioning) s'y
  // rattachent ; null tant que la prise en cours n'a jamais été sauvegardée.
  let savedCaptureId = null;
  let versioning = null; // section Versioning (capture-versioning.js), admin seulement -- montée plus bas
  const packId = window.__lpTrackContext && window.__lpTrackContext.id;
  // Noms de piste retouchés pour cette prise (ex. "Ca va, c'est cool" -> "Intensité basse") -- persistent
  // tant que ce panneau reste ouvert (plusieurs prises successives sur la même vidéo gardent les mêmes
  // noms), remis à zéro à la prochaine ouverture d'un nouveau fichier. Voir captureLaneLabel().
  let laneOverrides = {};
  // Groupes repliés (par clé "track:<id>" ou "sfx:<id>") -- persistent tant que ce panneau reste ouvert,
  // même logique que laneOverrides ci-dessus.
  let collapsedGroups = {};
  // Écraser ou passe additive (2026-09-16, demande explicite de Jules-Antoine : "la possibilité d'écraser
  // ou de faire des passes additives") -- pendingBaseEvents porte les événements de la prise précédente à
  // fusionner au prochain arrêt de capture, vide = la prochaine capture remplace tout (comportement
  // d'origine). Réglé au moment où l'enregistrement DÉMARRE (voir recordBtn ci-dessous), pas à l'arrêt --
  // la case à cocher ne doit plus pouvoir changer d'avis une fois l'enregistrement en cours.
  let pendingBaseEvents = [];
  function refreshActionButtons() {
    setExportButtonsDisabled(lastEvents.length === 0);
    saveBtn.disabled = lastEvents.length === 0;
    // La case "Passe additive" n'a de sens que s'il existe déjà quelque chose à préserver.
    additiveLabel.hidden = lastEvents.length === 0;
    if (lastEvents.length === 0) additiveCheckbox.checked = false;
  }
  // Nombre de gestes affiché : les repères techniques de la capture (générations, arrêts, commandes de volume) ne
  // comptent pas.
  function captureCountText(evs) { return tr('captureEventCount').replace('{n}', evs.filter(e => CAPTURE_MARK_NAMES.indexOf(e.name) === -1 && e.name.indexOf('embr_') !== 0 || e.name === 'embr_loop_select').length); }
  recordBtn.addEventListener('click', () => {
    if (videoCaptureState) {
      // Fusionne avec la prise précédente (passe additive) si demandé à l'armement de CET enregistrement
      // -- voir la branche "else" ci-dessous. materializeLayerSegments accepte sans problème un mélange
      // d'événements déjà matérialisés (layer_segment de la passe précédente) et bruts (intensity_change/
      // track_play de la passe qui vient de s'arrêter) : seuls ces derniers sont (re)convertis, le reste
      // traverse tel quel -- voir son propre commentaire plus haut dans le fichier.
      const newPassEvents = stopCapture();
      lastEvents = materializeCapture(pendingBaseEvents.concat(newPassEvents));
      pendingBaseEvents = [];
      // Arrêter la capture doit vraiment arrêter la musique en cours (2026-09-16, même retour direct de
      // Jules-Antoine que pour Démarrer). 'stop-track' est l'événement global que player.js écoute déjà
      // pour arrêter n'importe quelle piste (mécanisme "une seule piste à la fois" de playThisTrack) --
      // réutilisé tel quel plutôt que de deviner l'état interne (playing) depuis l'extérieur du closure
      // de player.js, qu'aucun signal DOM fiable n'expose. Sans effet si la piste n'était déjà plus en
      // train de jouer. Ne couvre que la piste ARMÉE -- si le compositeur a manuellement démarré une
      // AUTRE piste sans l'armer, celle-là continue (limite connue, cas rare vu le flux armer/capturer).
      if (armedTrackId) document.dispatchEvent(new CustomEvent('stop-track', { detail: armedTrackId }));
      videoEl.pause();
      recordBtn.classList.remove('recording');
      recordLabel.textContent = tr('captureStartBtn');
      countEl.textContent = captureCountText(lastEvents);
      additiveCheckbox.disabled = false;
      refreshActionButtons();
      renderCaptureTimeline(timelineEl, lastEvents, true, () => {
        countEl.textContent = captureCountText(lastEvents);
        refreshActionButtons();
      }, laneOverrides, collapsedGroups, videoEl);
    } else {
      // Écraser ou passe additive : décidé ICI, au démarrage -- la case reste figée pendant tout
      // l'enregistrement (voir additiveCheckbox.disabled ci-dessous), pas de changement d'avis en cours
      // de route. Décochée ou rien à préserver (lastEvents vide) : comportement d'origine, la nouvelle
      // capture remplacera tout à l'arrêt.
      const additive = additiveCheckbox.checked && lastEvents.length > 0;
      pendingBaseEvents = additive ? lastEvents.slice() : [];
      // Une passe additive DOIT repartir du tout début de la vidéo (2026-09-16, Jules-Antoine) : les
      // horaires de la passe précédente (pendingBaseEvents) sont comptés depuis t=0 -- si la nouvelle
      // passe démarrait ailleurs (ex. la vidéo laissée en cours de lecture après la passe précédente),
      // ses propres événements seraient décalés par rapport à ceux déjà acquis, et la fusion produirait
      // une frise incohérente. Pas de remise à zéro en mode écrasement -- rien à réaligner puisqu'il n'y
      // a alors qu'une seule passe.
      if (additive) videoEl.currentTime = 0;
      startCapture(videoEl);
      // Démarrer la capture doit vraiment lancer la vidéo ET la piste armée (2026-09-16, retour direct
      // de Jules-Antoine en testant : "Start capture doit lancer la vidéo et la musique qui est armée.
      // Ça ne fait ni l'un ni l'autre") -- avant, seul un repère track_play SYNTHÉTIQUE était injecté
      // dans les événements, sans jamais vraiment démarrer quoi que ce soit à l'écran ni au casque.
      // videoEl.play() ET un vrai clic simulé sur le bouton de lecture réel de la piste armée, tous les
      // deux SYNCHRONES dans le même geste utilisateur que le clic sur "Démarrer la capture" (nécessaire
      // pour que les navigateurs autorisent la lecture -- un geste différé, même de quelques
      // millisecondes via un timeout, serait refusé). Le clic réel traverse toute la vraie logique de
      // player.js (choix initial selon le mode, vraie télémétrie track_play...) -- capturée normalement
      // par l'interception déjà active (startCapture ci-dessus) -- pas besoin de réimplémenter "démarrer
      // une piste" ni de deviner ce que "niveau 0"/"boucle de référence" veut dire selon le mode.
      videoEl.play().catch(() => {}); // ignore un refus navigateur (rare -- ex. vidéo déjà en lecture)
      if (armedTrackId) {
        const armedPlayBtn = document.querySelector(`[data-track-id="${armedTrackId}"] [data-role="playBtn"]`);
        if (armedPlayBtn) {
          armedPlayBtn.click();
        } else {
          // Repli si le bouton n'est plus dans le DOM (cas limite) -- au moins un repère, comme avant.
          videoCaptureState.events.push({ t: 0, name: 'track_play', detail: { trackId: armedTrackId } });
        }
      }
      recordBtn.classList.add('recording');
      recordLabel.textContent = tr('captureStopBtn');
      countEl.textContent = tr('captureInProgress');
      setExportButtonsDisabled(true);
      saveBtn.disabled = true;
      additiveCheckbox.disabled = true;
      exportStatus.textContent = '';
      // Un nouvel export sera nécessaire pour la nouvelle prise -- l'ancien Blob n'a plus de sens.
      lastExportBlob = null;
      addToLibraryBtn.hidden = true;
      // Une nouvelle capture EN MODE ÉCRASEMENT = une nouvelle prise à sauvegarder (jamais un écrasement
      // silencieux d'une sauvegarde précédente) -- currentCaptureId reparti à zéro, un nouveau clic sur
      // Sauvegarder créera une ligne distincte plutôt que de mettre à jour l'ancienne. Une passe ADDITIVE,
      // elle, continue de construire la MÊME prise -- currentCaptureId (et son titre) sont conservés, un
      // Sauvegarder après coup met à jour la même ligne.
      if (!additive) {
        currentCaptureId = null;
        savedCaptureId = null;
        saveStatus.textContent = '';
        if (versioning) versioning.refresh();
      }
      const tick = setInterval(() => {
        if (!videoCaptureState) { clearInterval(tick); return; }
        // En passe additive, on affiche la prise précédente (déjà matérialisée) ET les événements bruts
        // de la passe en cours superposés -- pour une piste touchée uniquement dans la passe précédente,
        // la frise reste fidèle à ce qui est déjà acquis ; limite connue : une piste retouchée dans LES
        // DEUX passes ne montre pas encore l'aperçu en direct de la seconde tant qu'elle n'est pas
        // matérialisée à l'arrêt (le résultat final, lui, est toujours correct).
        const liveEvents = pendingBaseEvents.concat(videoCaptureState.events);
        countEl.textContent = captureCountText(liveEvents);
        renderCaptureTimeline(timelineEl, liveEvents, false, null, laneOverrides, collapsedGroups, videoEl);
      }, 500);
    }
  });
  // Tête de lecture en continu pendant que la vidéo avance -- repositionne juste la ligne (pas de
  // ré-affichage complet de la frise, trop coûteux à chaque frame).
  videoEl.addEventListener('timeupdate', () => positionCapturePlayhead(timelineEl, videoEl));
  async function runExport(mode) {
    if (mode === 'video' && fullExportLocked) return; // garde-fou : même si le bouton était réactivé à la main
    setExportButtonsDisabled(true);
    try {
      // Sélecteur de palier retiré du panneau le 16 septembre (retour direct de Jules-Antoine : "ça ne
      // sert à rien" -- confusion en testant, aucun palier réel n'existe encore pour lui donner du
      // sens) -- "on le garde pour les vrais réglages que personne ne verra". La mécanique de filigrane
      // dans exportCaptureVideo reste intacte, juste plus exposée en UI : figé sur 'boss' (aucun
      // filigrane) en attendant un vrai palier compositeur à brancher ici, invisible pour l'instant.
      const exportOptions = { tier: 'boss', showComposerCredit: creditCheckbox.checked, mode };
      const blob = await exportCaptureVideo(lastEvents, file, (msg) => { exportStatus.textContent = msg; }, laneOverrides, exportOptions);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export-${Date.now()}.${mode === 'audio' ? 'wav' : 'mp4'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      exportStatus.textContent = tr(mode === 'audio' ? 'captureAudioDone' : 'captureExportDone');
      // Garde le Blob pour un envoi optionnel vers la bibliothèque vidéo (voir addToLibraryBtn
      // ci-dessous) -- distinct du téléchargement local ci-dessus, jamais automatique (2026-09-16).
      // Un export audio seul n'est pas une vidéo : rien à envoyer à la bibliothèque.
      if (mode === 'audio') { lastExportBlob = null; addToLibraryBtn.hidden = true; }
      else { lastExportBlob = blob; addToLibraryBtn.hidden = false; }
    } catch (e) {
      console.error(e);
      exportStatus.textContent = tr('captureExportFailed').replace('{error}', e.message);
    } finally {
      setExportButtonsDisabled(lastEvents.length === 0);
    }
  }
  exportBtn.addEventListener('click', () => runExport('video'));
  exportAudioBtn.addEventListener('click', () => runExport('audio'));
  exportCopyBtn.addEventListener('click', () => runExport('copy'));
  // Dépose l'export dans la bibliothèque vidéo du compositeur (2026-09-16, voir composer_videos) --
  // action séparée et volontaire, jamais automatique après un export (un compositeur peut vouloir
  // exporter plusieurs essais avant de choisir lequel garder). Réutilise le champ "Nom de la prise"
  // déjà présent pour Sauvegarder -- même prise, même nom.
  addToLibraryBtn.addEventListener('click', async () => {
    if (!lastExportBlob || !packId) return;
    addToLibraryBtn.disabled = true;
    exportStatus.textContent = tr('captureAddingToLibrary');
    try {
      await saveExportToVideoLibrary(lastExportBlob, packId, titleInput.value, videoEl.duration || null);
      exportStatus.textContent = tr('captureAddedToLibrary');
      addToLibraryBtn.hidden = true; // évite un second envoi du même export
    } catch (e) {
      console.error(e);
      exportStatus.textContent = tr('captureAddToLibraryFailed').replace('{error}', e.message);
    } finally {
      addToLibraryBtn.disabled = false;
    }
  });
  // Sauvegarde/reprise côté serveur (2026-09-16) -- voir saveVideoCapture/listVideoCaptures/loadVideoCapture
  // plus haut. `packId` vient de window.__lpTrackContext.id (déjà résolu par init()), jamais redemandé ici.
  saveBtn.addEventListener('click', async () => {
    if (!packId || !lastEvents.length) return;
    saveBtn.disabled = true;
    saveStatus.textContent = tr('captureSaving');
    try {
      if (!currentCaptureId) {
        currentCaptureId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
      }
      await saveVideoCapture(packId, currentCaptureId, titleInput.value, file.name, lastEvents, laneOverrides, collapsedGroups);
      saveStatus.textContent = tr('captureSaved');
      refreshLoadOptions();
      if (savedCaptureId !== currentCaptureId) { savedCaptureId = currentCaptureId; if (versioning) versioning.refresh(); }
    } catch (e) {
      console.error(e);
      saveStatus.textContent = tr('captureSaveFailed').replace('{error}', e.message);
    } finally {
      saveBtn.disabled = lastEvents.length === 0;
    }
  });
  // Prise chargée (depuis la liste, ou montage « détaché » d'une version vidéo) : elle devient la prise en cours.
  function applyLoadedCapture(capture) {
    currentCaptureId = capture.id;
    savedCaptureId = capture.id;
    lastEvents = capture.events || [];
    laneOverrides = capture.laneOverrides || {};
    collapsedGroups = capture.collapsedGroups || {};
    titleInput.value = capture.title || '';
    countEl.textContent = captureCountText(lastEvents);
    refreshActionButtons();
    renderCaptureTimeline(timelineEl, lastEvents, true, () => {
      countEl.textContent = captureCountText(lastEvents);
      refreshActionButtons();
    }, laneOverrides, collapsedGroups, videoEl);
    // La vidéo elle-même n'est jamais sauvegardée (voir la migration) -- seul son nom d'origine permet
    // de vérifier qu'on a bien réimporté le bon fichier avant de faire confiance aux horaires chargés.
    saveStatus.textContent = capture.videoFilename && capture.videoFilename !== file.name
      ? tr('captureLoadedVideoMismatch').replace('{video}', capture.videoFilename)
      : tr('captureLoaded');
    if (versioning) versioning.refresh();
  }
  loadSelect.addEventListener('change', () => { loadBtn.disabled = !loadSelect.value; });
  loadBtn.addEventListener('click', async () => {
    if (!loadSelect.value) return;
    loadBtn.disabled = true;
    saveStatus.textContent = tr('captureLoading');
    try {
      applyLoadedCapture(await loadVideoCapture(loadSelect.value));
    } catch (e) {
      console.error(e);
      saveStatus.textContent = tr('captureLoadFailed').replace('{error}', e.message);
    } finally {
      loadBtn.disabled = false;
    }
  });
  async function refreshLoadOptions() {
    if (!packId) return;
    try {
      const captures = await listVideoCaptures(packId);
      const current = loadSelect.value;
      loadSelect.innerHTML = `<option value="">${tr('captureLoadOptionDefault')}</option>` + captures.map(c =>
        `<option value="${c.id}">${window.LayerPlayerCore.escapeHtml(c.title || tr('captureUntitled'))} — ${new Date(c.updatedAt).toLocaleString()}</option>`
      ).join('');
      loadSelect.value = captures.some(c => c.id === current) ? current : '';
      loadSelect.disabled = captures.length === 0;
      loadBtn.disabled = !loadSelect.value;
    } catch (e) {
      console.error('Échec de la liste des prises sauvegardées', e);
    }
  }
  refreshLoadOptions();
  // Versioning (26/09) : les versions vidéo du montage sauvegardé -- même montage rejoué sur d'autres morceaux / Sfx
  // (capture-retarget.js, capture-versioning.js). Admin seulement jusqu'au feu vert (layerpitch-docs/feux-verts-admin.md) ;
  // les fonctions serveur le vérifient aussi.
  const versioningHost = document.getElementById('videoCaptureVersioning');
  if (window.__lpCaptureIsAdmin && window.LayerCaptureVersioning) {
    versioningHost.hidden = false;
    versioning = window.LayerCaptureVersioning.mount(versioningHost, {
      tr, videoEl, fetchBytes: fetchAsUint8Array, fullExportLocked,
      library: window.__lpCaptureLibrary, findTrack: findCaptureTrack, findSfx: findCaptureSfx,
      getEvents: () => lastEvents, getCaptureId: () => savedCaptureId, getCaptureTitle: () => titleInput.value,
      exportEvents: (events, mode, onProgress) => exportCaptureVideo(events, file, onProgress, laneOverrides, { tier: 'boss', showComposerCredit: creditCheckbox.checked, mode }),
      saveToLibrary: (blob, title) => saveExportToVideoLibrary(blob, packId, title, videoEl.duration || null),
      // « Détacher » : la version devient un montage indépendant (sauvegardé tout de suite), ouvert à la place de celui-ci.
      detach: async (events, title) => {
        const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        await saveVideoCapture(packId, id, title, file.name, events, {}, collapsedGroups);
        applyLoadedCapture({ id, title, videoFilename: file.name, events, laneOverrides: {}, collapsedGroups });
        saveStatus.textContent = tr('versioningDetachedLoaded');
        refreshLoadOptions();
      },
    });
    capturePanelVersioning = versioning;
  }
  // Montage demandé à l'ouverture (lien du Backstage) : chargé tout de suite, puis la section Versioning est amenée à l'écran.
  if (opts.montageId) {
    saveStatus.textContent = tr('captureLoading');
    loadVideoCapture(opts.montageId).then(capture => {
      applyLoadedCapture(capture);
      loadSelect.value = capture.id;
      if (versioning) setTimeout(() => versioningHost.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    }).catch(e => { console.error(e); saveStatus.textContent = tr('captureLoadFailed').replace('{error}', e.message); });
  }
  document.getElementById('videoCaptureCloseBtn').addEventListener('click', () => {
    URL.revokeObjectURL(objectUrl);
    closeCapturePanel();
  });
  document.getElementById('videoCaptureDetachBtn').addEventListener('click', detachCapturePanel);
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

