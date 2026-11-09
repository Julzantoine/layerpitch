// Fondu à l'arrêt (05/11, demande de Jules-Antoine) : durée par défaut, retenue sur cet appareil. Le lecteur la lit dans
// window.__lpStopFadeSec tant que l'atelier est ouvert (fondu en direct, posé sur chaque arrêt enregistré, retouchable sur la frise).
const CAPTURE_STOP_FADE_KEY = 'lpAtelierStopFadeSec';
const CAPTURE_STOP_FADE_DEFAULT = 2;
function captureStopFadePref() {
  try { const v = localStorage.getItem(CAPTURE_STOP_FADE_KEY); if (v != null && v !== '' && isFinite(Number(v))) return Math.max(0, Math.min(10, Number(v))); } catch (e) {}
  return CAPTURE_STOP_FADE_DEFAULT;
}
function closeCapturePanel() {
  window.__lpStopFadeSec = 0; // hors de l'atelier, les lecteurs s'arrêtent net
  if (window.__lpDisposeMontage) window.__lpDisposeMontage(); // enregistrement automatique et publication du montage : fin avec le panneau
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

// Image accrochée en haut (05/11, demande de Jules-Antoine) : vidéo au-dessus de la page (atelier dans le cadre du Backstage, écran étroit),
// quand on fait défiler vers les morceaux, les Sfx ou la frise, la vidéo reste fixée en haut de l'écran (au plus 40 % de sa hauteur).
// Une marque sans hauteur, posée avant la vidéo, dit si elle est sortie par le haut ; une cale garde sa place dans la page. Vaut aussi
// côte à côte depuis le 05/11 (panneau en grande colonne, plus « sticky ») ; panneau détaché dans une autre fenêtre : rien à faire. scroll-padding-top garde les cibles
// des bulles du tutoriel (scrollIntoView) sous l'image, pas derrière.
function pinCaptureVideo(panel) {
  // Depuis le 06/11 (demande de Jules-Antoine) : ce qui s'accroche n'est plus la seule image mais le « dock » = image + barre de
  // commandes (Enregistrer, Écouter...), et l'image garde la MÊME taille accrochée ou non (largeur fixée en CSS, 40 % de la hauteur de l'écran).
  const dock = panel.querySelector('.video-capture-dock');
  if (!dock) return;
  const mark = document.createElement('div');
  const spacer = document.createElement('div');
  dock.before(mark, spacer);
  const root = document.documentElement;
  const update = () => {
    if (!mark.isConnected) { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); root.style.scrollPaddingTop = ''; return; }
    const pinned = dock.ownerDocument === document && panel.classList.contains('active') && !panel.classList.contains('video-capture-image-hidden') && mark.getBoundingClientRect().top < 0;
    dock.classList.toggle('video-capture-pinned', pinned);
    if (pinned) {
      // Le panneau n'est plus forcément centré (grande colonne à gauche, morceaux à droite) : le dock suit sa colonne.
      const r = panel.getBoundingClientRect();
      dock.style.width = panel.clientWidth + 'px';
      dock.style.left = r.left + 'px';
      spacer.style.height = dock.dataset.restHeight || dock.offsetHeight + 'px';
      root.style.scrollPaddingTop = (dock.offsetHeight + 12) + 'px';
    } else {
      dock.style.width = '';
      dock.style.left = '';
      spacer.style.height = '';
      dock.dataset.restHeight = dock.offsetHeight + 'px'; // hauteur réelle au repos
      root.style.scrollPaddingTop = '';
    }
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

// Image masquée pendant l'incrustation (05/11, demande de Jules-Antoine : l'incrustation sert à gagner de la place, l'écran « en cours de
// lecture en mode incrustation » ne doit pas rester). Chrome / Safari préviennent (enterpictureinpicture) : l'image se replie et revient
// toute seule. Firefox ne prévient pas (son incrustation n'est pas visible par la page) : bouton ▭ dans l'en-tête, et « Réafficher
// l'image ». La vidéo n'est pas retirée (hauteur nulle seulement) : elle continue de jouer et de piloter la capture.
function wireCaptureImageHiding(panel, videoEl) {
  const setHidden = (hidden) => {
    panel.classList.toggle('video-capture-image-hidden', hidden);
    window.dispatchEvent(new Event('scroll')); // l'image accrochée (pinCaptureVideo) se remet à jour
  };
  panel.querySelector('#videoCaptureHideImageBtn').addEventListener('click', () => setHidden(!panel.classList.contains('video-capture-image-hidden')));
  panel.querySelector('#videoCaptureShowImageBtn').addEventListener('click', () => {
    setHidden(false);
    if (document.pictureInPictureElement === videoEl && document.exitPictureInPicture) document.exitPictureInPicture().catch(() => {});
  });
  videoEl.addEventListener('enterpictureinpicture', () => setHidden(true));
  videoEl.addEventListener('leavepictureinpicture', () => setHidden(false));
}

// Plein écran de tout l'atelier (05/11, demande de Jules-Antoine : trop chargé dans le cadre du Backstage). Le cadre l'autorise
// (allow="fullscreen" côté Backstage et studio). Tous les boutons .atelier-fullscreen-toggle suivent l'état, Échap compris.
// Dans le cadre du Backstage, le plein écran est celui de la page hôte (07/11 : sa barre « Sauvegarder / publier » reste visible) ; sans réponse de
// l'hôte (espace studio, atelier seul), on retombe sur le plein écran du navigateur.
let atelierHostFull = false;
function atelierIsFullscreen() { return atelierHostFull || !!(document.fullscreenElement || document.webkitFullscreenElement); }
window.addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.source !== 'lp-backstage' || e.data.type !== 'fullState') return;
  atelierHostFull = !!e.data.on;
  atelierHostAnswered = true;
  syncAtelierFullscreenButtons();
});
let atelierHostAnswered = false;
function toggleAtelierFullscreen() {
  if (atelierHostFull) { window.parent.postMessage({ source: 'lp-atelier', type: 'setFull', on: false }, location.origin); return; }
  const root = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
  const realFullscreen = () => { const req = root.requestFullscreen || root.webkitRequestFullscreen; if (req) { const r = req.call(root); if (r && r.catch) r.catch(err => console.warn('LayerPitch — plein écran refusé :', err)); } };
  if (window.parent === window) { realFullscreen(); return; }
  atelierHostAnswered = false;
  try { window.parent.postMessage({ source: 'lp-atelier', type: 'toggleFull' }, location.origin); } catch (err) { realFullscreen(); return; }
  setTimeout(() => { if (!atelierHostAnswered) realFullscreen(); }, 400); // hôte qui ne répond pas
}
// Échap dans le cadre : quitte le plein écran de la page hôte (le clavier ne remonte pas jusqu'à elle).
document.addEventListener('keydown', e => { if (e.key === 'Escape' && atelierHostFull) window.parent.postMessage({ source: 'lp-atelier', type: 'setFull', on: false }, location.origin); });
function syncAtelierFullscreenButtons() {
  const on = atelierIsFullscreen();
  document.body.classList.toggle('atelier-fullscreen', on);
  document.querySelectorAll('.atelier-fullscreen-toggle').forEach(b => {
    const label = tr(on ? 'atelierFullscreenExitBtn' : 'atelierFullscreenBtn');
    b.title = label; b.setAttribute('aria-label', label);
    if (b.dataset.withText) b.textContent = (on ? '✕ ' : '⛶ ') + label;
  });
}
function wireAtelierFullscreenButtons(root) {
  const can = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  root.querySelectorAll('.atelier-fullscreen-toggle').forEach(b => {
    if (b.dataset.fsBound) return;
    b.dataset.fsBound = '1';
    if (!can) { b.hidden = true; return; }
    b.addEventListener('click', toggleAtelierFullscreen);
  });
  if (!document.__lpFsWatched) {
    document.__lpFsWatched = true;
    document.addEventListener('fullscreenchange', syncAtelierFullscreenButtons);
    document.addEventListener('webkitfullscreenchange', syncAtelierFullscreenButtons);
  }
  syncAtelierFullscreenButtons();
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
  // Depuis le 06/11 (demande de Jules-Antoine) : l'écran revient à sa place dans la page, attaché, au lieu de disparaître.
  // Une prise en cours s'arrête proprement (comme au clic sur « Arrêter la capture ») pour garder ce qui a été joué.
  win.addEventListener('pagehide', () => {
    if (capturePanelDetachedWindow !== win) return;
    capturePanelDetachedWindow = null;
    if (videoCaptureState) {
      const recordBtn = wrapper.querySelector('#videoCaptureRecordBtn');
      if (recordBtn) recordBtn.click(); else stopCapture();
    }
    while (wrapper.firstChild) panel.appendChild(wrapper.firstChild); // les vrais nœuds reviennent, écouteurs compris
    panel.classList.add('active');
    document.body.classList.add('video-panel-active');
    syncAtelierFullscreenButtons();
  });
}

function openCapturePanel(file, opts) {
  opts = opts || {};
  if (window.__lpDisposeMontage) window.__lpDisposeMontage(); // un panneau déjà ouvert est remplacé : plus d'enregistrement automatique pour lui
  const panel = document.getElementById('videoTestPanel');
  const objectUrl = URL.createObjectURL(file);
  panel.innerHTML = `
    <div class="video-test-panel-header">
      <span class="video-test-panel-title">${tr('capturePanelTitle').replace('{name}', window.LayerPlayerCore.escapeHtml(file.name))}</span>
      <input type="text" class="video-capture-title-input video-capture-name-field" id="videoCaptureTitleInput" placeholder="${tr('captureTitleInputPlaceholder')}" title="${tr('captureTitleInputPlaceholder')}" aria-label="${tr('captureTitleInputPlaceholder')}">
      <div class="video-test-panel-actions">
        <button type="button" class="video-test-panel-btn" id="videoCaptureHideImageBtn" title="${tr('captureHideImageBtn')}" aria-label="${tr('captureHideImageBtn')}">▭</button>
        <button type="button" class="video-test-panel-btn" id="videoCaptureInfoBtn" title="${tr('atelierInfoToggle')}" aria-label="${tr('atelierInfoToggle')}">ⓘ</button>
        <button type="button" class="video-test-panel-btn atelier-fullscreen-toggle" title="${tr('atelierFullscreenBtn')}" aria-label="${tr('atelierFullscreenBtn')}">⛶</button>
        <button type="button" class="video-test-panel-btn" id="videoCaptureDetachBtn" title="${tr('detachBtn')}" aria-label="${tr('detachBtn')}">⤢</button>
        <button type="button" class="video-test-panel-btn" id="videoCaptureCloseBtn" title="${tr('closeBtn')}" aria-label="${tr('closeBtn')}">✕</button>
      </div>
    </div>
    <div class="video-capture-dock">
    <div class="video-test-panel-frame-wrap"><video id="videoCaptureEl" src="${objectUrl}" controls muted></video></div>
    <div class="video-capture-image-hidden-note" id="videoCaptureImageHiddenNote">${tr('captureImageHiddenNote')} <button type="button" class="video-capture-download-btn" id="videoCaptureShowImageBtn">${tr('captureShowImageBtn')}</button></div>
    <div class="video-capture-bar">
      <button type="button" class="video-capture-record-btn" id="videoCaptureRecordBtn"><span class="dot"></span><span id="videoCaptureRecordLabel">${tr('captureStartBtn')}</span></button>
      <button type="button" class="video-capture-download-btn" id="videoCaptureListenBtn" disabled title="${tr('captureListenHelp')}">${tr('captureListenBtn')}</button>
      <label class="video-capture-export-opt" id="videoCaptureAdditiveLabel" title="${tr('captureAdditiveHelp')}" hidden>
        <input type="checkbox" id="videoCaptureAdditiveCheckbox"> ${tr('captureAdditiveLabel')}
      </label>
      <label class="video-capture-export-opt" title="${tr('captureStopFadeHelp')}">
        ${tr('captureStopFadeLabel')} <input type="number" id="videoCaptureStopFade" min="0" max="10" step="0.5"> s
      </label>
      <span class="video-capture-armed-status" id="videoCaptureArmedStatus" title="${tr('captureArmedHelp')}"></span>
      <span class="video-capture-count" id="videoCaptureCount"></span>
    </div>
    </div>
    <div class="video-capture-bar">
      <label class="video-capture-export-opt" title="${tr('captureCreditHelp')}">
        <input type="checkbox" id="videoCaptureCreditCheckbox" checked> ${tr('captureCreditLabel')}
      </label>
      <button type="button" class="video-capture-download-btn" id="videoCaptureExportBtn" disabled>${tr('captureExportBtn')}</button>
      <button type="button" class="video-capture-download-btn" id="videoCaptureExportAudioBtn" disabled title="${tr('captureExportAudioHelp')}">${tr('captureExportAudioBtn')}</button>
      <button type="button" class="video-capture-download-btn" id="videoCaptureExportCopyBtn" disabled title="${tr('captureExportCopyHelp')}">${tr('captureExportCopyBtn')}</button>
      <button type="button" class="video-capture-download-btn" id="videoCaptureAddToLibraryBtn" hidden>${tr('captureAddToLibraryBtn')}</button>
      <button type="button" class="video-capture-download-btn" id="videoCaptureUpdateEverywhereBtn" title="${tr('captureUpdateEverywhereHelp')}">${tr('captureUpdateEverywhereBtn')}</button>
      <label class="video-capture-count" id="videoCaptureKeepOldLabel" style="display:inline-flex;align-items:center;gap:4px" title="${tr('captureKeepOldHelp')}"><input type="checkbox" id="videoCaptureKeepOld" checked style="width:auto;margin:0"> ${tr('captureKeepOldLabel')}</label>
      <span class="video-capture-count" id="videoCaptureExportStatus"></span>
    </div>
    <div class="video-capture-history" id="videoCaptureHistory" hidden></div>
    <div class="video-capture-bar">
      <select class="video-capture-load-select" id="videoCaptureLoadSelect" disabled><option value="">${tr('captureLoadOptionDefault')}</option></select>
      <button type="button" class="video-capture-download-btn" id="videoCaptureLoadBtn" disabled>${tr('captureLoadBtn')}</button>
      <span class="video-capture-count" id="videoCaptureSaveStatus"></span>
    </div>
    <div class="video-capture-timeline" id="videoCaptureTimeline"></div>
    <div class="video-capture-versioning" id="videoCaptureVersioning" hidden></div>
  `;
  panel.classList.add('active');
  document.body.classList.add('video-panel-active');
  pinCaptureVideo(panel);
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
  // Échelle Test in game (15/09, matrice du 27/09) : Rookie = capture seule (frise non modifiable), Warrior = frise
  // modifiable mais rien d'enregistré, Boss = modifiable + enregistré. Le serveur refuse aussi l'enregistrement hors Boss.
  const captureLevel = window.__lpCaptureLevel || 'capture';
  const captureCanEdit = captureLevel !== 'capture';
  const captureCanSave = captureLevel === 'saved';
  const setExportButtonsDisabled = (v) => { exportBtn.disabled = v || fullExportLocked; exportAudioBtn.disabled = v; exportCopyBtn.disabled = v; };
  if (fullExportLocked) {
    exportBtn.title = tr('captureExportFullLockedHint');
    exportBtn.insertAdjacentHTML('afterend', `<span class="video-capture-count" id="videoCaptureFullLockedNote">${tr('captureExportFullLockedNote')}</span>`);
  }
  const addToLibraryBtn = document.getElementById('videoCaptureAddToLibraryBtn');
  const updateEverywhereBtn = document.getElementById('videoCaptureUpdateEverywhereBtn');
  const keepOldCheckbox = document.getElementById('videoCaptureKeepOld');
  const historyEl = document.getElementById('videoCaptureHistory');
  // Historique des exports du montage (21/10, migration 20261021030000) : les 3 dernières vidéos remplacées, du montage et de ses
  // versions, avec « Revenir à celle-ci » (elle redevient la vidéo affichée partout).
  async function renderExportHistory() {
    if (!savedCaptureId || versioningLevelForHistory() !== 'saved') { historyEl.hidden = true; return; }
    const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc('list_video_export_history', withStudio({ p_capture_id: savedCaptureId }));
    if (error || !data || !data.length) { historyEl.hidden = true; historyEl.innerHTML = ''; return; }
    historyEl.hidden = false;
    historyEl.innerHTML = `<div class="video-capture-count">${tr('captureHistoryTitle')}</div>` + data.map(h => `
      <div class="video-capture-history-row"><span>${new Date(h.createdAt).toLocaleString()}${h.versionId ? ' · ' + tr('captureHistoryVersion') : ' · ' + tr('captureHistoryMontage')}${h.sizeBytes ? ' · ' + (h.sizeBytes / 1048576).toFixed(1) + ' Mo' : ''}</span>
        <a class="video-capture-download-btn" href="${h.url}" target="_blank" rel="noopener">${tr('captureHistoryView')}</a>
        <button type="button" class="video-capture-download-btn" data-restore="${h.id}">${tr('captureHistoryRestore')}</button></div>`).join('');
  }
  const versioningLevelForHistory = () => window.__lpVersioningLevel || 'saved';
  historyEl.addEventListener('click', async e => {
    const b = e.target.closest('[data-restore]');
    if (!b) return;
    b.disabled = true;
    const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc('restore_video_export', withStudio({ p_history_id: Number(b.dataset.restore) }));
    if (error) { exportStatus.textContent = tr('captureExportFailed').replace('{error}', error.message); b.disabled = false; return; }
    await r2DeleteRemovedVideos(data && data.removed);
    exportStatus.textContent = tr('captureHistoryRestored');
    if (versioning) versioning.refresh();
    renderExportHistory();
  });
  const exportStatus = document.getElementById('videoCaptureExportStatus');
  const additiveLabel = document.getElementById('videoCaptureAdditiveLabel');
  const additiveCheckbox = document.getElementById('videoCaptureAdditiveCheckbox');
  const creditCheckbox = document.getElementById('videoCaptureCreditCheckbox');
  const titleInput = document.getElementById('videoCaptureTitleInput');
  const defaultMontageName = (file.name || '').replace(/\.[^.]+$/, ''); // sans nom choisi, le montage porte le nom de sa vidéo (plus de « Sans titre »)
  titleInput.value = defaultMontageName;
  const loadSelect = document.getElementById('videoCaptureLoadSelect');
  const loadBtn = document.getElementById('videoCaptureLoadBtn');
  const saveStatus = document.getElementById('videoCaptureSaveStatus');
  const timelineEl = document.getElementById('videoCaptureTimeline');
  const stopFadeInput = document.getElementById('videoCaptureStopFade');
  stopFadeInput.value = captureStopFadePref();
  window.__lpStopFadeSec = Number(stopFadeInput.value) || 0;
  stopFadeInput.addEventListener('change', () => {
    const v = Math.max(0, Math.min(10, parseFloat(stopFadeInput.value) || 0));
    stopFadeInput.value = v;
    window.__lpStopFadeSec = v;
    try { localStorage.setItem(CAPTURE_STOP_FADE_KEY, String(v)); } catch (e) {}
  });
  let lastEvents = [];
  let lastExportBlob = null; // dernier export réussi, en attente d'un envoi optionnel vers la bibliothèque
  let lastExportName = ''; // dernier nom donné à un export (proposé à nouveau, et pour la bibliothèque)
  // Enregistrement automatique et publication du montage (06/11) : voir « Enregistrement automatique » plus bas.
  let autosaveTimer = 0;
  let autosaveRunning = null;
  let lastSavedKey = null;     // état de la prise à la dernière sauvegarde réussie (ou au chargement) : rien à renvoyer s'il n'a pas bougé
  let lastPublishedKey = null; // état du son publié la dernière fois (null : pas publié dans cette séance)
  let publishRunning = null;
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
  // Marqueurs de la frise (05/11) : { id, t, label }, enregistrés avec le montage -- voir renderCaptureTimeline. Gardés d'une prise
  // à l'autre tant que le panneau reste ouvert (ce sont des repères sur la vidéo, pas sur la musique).
  let timelineMarkers = [];
  // Écraser ou passe additive (2026-09-16, demande explicite de Jules-Antoine : "la possibilité d'écraser
  // ou de faire des passes additives") -- pendingBaseEvents porte les événements de la prise précédente à
  // fusionner au prochain arrêt de capture, vide = la prochaine capture remplace tout (comportement
  // d'origine). Réglé au moment où l'enregistrement DÉMARRE (voir recordBtn ci-dessous), pas à l'arrêt --
  // la case à cocher ne doit plus pouvoir changer d'avis une fois l'enregistrement en cours.
  let pendingBaseEvents = [];
  function refreshActionButtons() {
    setExportButtonsDisabled(lastEvents.length === 0);
    montageBuffer = null; montageGen++; // la frise a changé : la musique calculée n'est plus à jour
    if (montageListen) stopMontageListen(); // ... ni l'écoute en cours
    else listenBtn.disabled = lastEvents.length === 0 || !!videoCaptureState;
    scheduleAutosave(); // toute retouche de la prise ou de la frise passe par ici : enregistrement automatique (06/11)
    // La case "Passe additive" n'a de sens que s'il existe déjà quelque chose à préserver.
    additiveLabel.hidden = lastEvents.length === 0;
    if (lastEvents.length === 0) additiveCheckbox.checked = false;
  }
  // Nombre de gestes affiché : les repères techniques de la capture (générations, arrêts, commandes de volume) ne
  // comptent pas.
  function captureCountText(evs) { return tr('captureEventCount').replace('{n}', evs.filter(e => CAPTURE_MARK_NAMES.indexOf(e.name) === -1 && e.name.indexOf('embr_') !== 0 || e.name === 'embr_loop_select').length); }
  // Écouter le montage (05/11, montage à la souris) : la musique de la frise est calculée (même rendu que l'export), puis jouée avec la
  // vidéo depuis la tête de lecture. Pause de la vidéo = fin de l'écoute. Une retouche de la frise demande une nouvelle écoute.
  const listenBtn = document.getElementById('videoCaptureListenBtn');
  let montageListen = null;
  let montagePreparing = false;
  // Musique du montage déjà calculée (05/11) : resservie tant que la frise ne change pas (vidée par refreshActionButtons), pour que
  // la lecture de la vidéo et les sauts dans l'image relancent le son sans attendre un nouveau calcul.
  let montageBuffer = null;
  let montageGen = 0; // change à chaque retouche : un calcul lancé avant n'est pas gardé
  const stopMontageListen = () => {
    const l = montageListen; montageListen = null;
    if (l) l.stop();
    listenBtn.textContent = tr('captureListenBtn');
    listenBtn.disabled = lastEvents.length === 0 || !!videoCaptureState;
  };
  async function startMontageListen() {
    if (montageListen || montagePreparing || videoCaptureState || !lastEvents.length) return;
    if (versioning) versioning.stop(); // et l'inverse : une écoute de version en cours s'arrête
    montagePreparing = true;
    listenBtn.disabled = true;
    listenBtn.textContent = tr('versioningPreparingListen');
    try {
      let buffer = montageBuffer;
      if (!buffer) {
        const gen = montageGen;
        const plan = window.LayerCapturePlan.buildPlan(lastEvents, { findTrack: findCaptureTrack, findSfx: findCaptureSfx }).plan;
        buffer = await window.LayerCaptureRender.render(plan, { fetchBytes: fetchAsUint8Array, onProgress: (i, n) => { listenBtn.textContent = tr('captureEngineProgress').replace('{i}', i).replace('{n}', n); } });
        if (gen === montageGen) montageBuffer = buffer;
      }
      const P = window.LayerPlayerCore;
      await P.resumeAudio();
      const ac = P.audioContext();
      let src = null;
      // Source calée sur la position actuelle de l'image (au départ, puis à chaque saut dans la vidéo).
      const playFromVideo = () => {
        if (src) { src.onended = null; try { src.stop(); } catch (e) { /* déjà arrêtée */ } }
        const from = videoEl.currentTime || 0;
        src = ac.createBufferSource();
        src.buffer = buffer;
        src.connect(ac.destination);
        src.start(ac.currentTime + 0.05, Math.min(from, buffer.duration));
        src.onended = () => { if (montageListen) stopMontageListen(); };
      };
      playFromVideo();
      // Attendre que l'image reparte AVANT d'écouter ses pauses : la pause posée par le bouton lecture de l'image (plus bas) arrive
      // en retard et couperait aussitôt l'écoute (lecture → pause → lecture… en boucle).
      await videoEl.play().catch(() => {});
      if (videoEl.paused) { // lecture refusée par le navigateur, ou arrêtée entre-temps : pas de son sans image
        src.onended = null; try { src.stop(); } catch (e) { /* déjà arrêtée */ }
        listenBtn.disabled = false; listenBtn.textContent = tr('captureListenBtn');
        return;
      }
      const onPause = () => stopMontageListen();
      const onSeeked = () => { if (montageListen && !videoEl.paused) playFromVideo(); };
      videoEl.addEventListener('pause', onPause);
      videoEl.addEventListener('seeked', onSeeked);
      montageListen = { stop() {
        videoEl.removeEventListener('pause', onPause);
        videoEl.removeEventListener('seeked', onSeeked);
        if (src) { src.onended = null; try { src.stop(); } catch (e) { /* déjà arrêtée */ } }
        if (!videoEl.paused) videoEl.pause();
      } };
      listenBtn.disabled = false;
      listenBtn.textContent = tr('captureStopListenBtn');
    } catch (e) {
      console.error(e);
      montageListen = null;
      listenBtn.textContent = tr('captureListenBtn');
      listenBtn.disabled = false;
      countEl.textContent = tr('versioningListenFailed').replace('{error}', e.message);
    } finally {
      montagePreparing = false;
    }
  }
  listenBtn.addEventListener('click', () => {
    if (montageListen) { stopMontageListen(); return; }
    startMontageListen();
  });
  // Bouton lecture de l'image (05/11, retour de Jules-Antoine : « je n'ai pas de son », la vidéo est muette et la musique ne partait
  // qu'avec « Écouter le montage ») : lire la vidéo joue aussi le montage, depuis la tête de lecture. Rien ne change pendant une capture,
  // une écoute de version (elles lancent l'image elles-mêmes) ou avec une frise vide. Réservé aux admins tant que le feu vert n'est pas donné.
  videoEl.addEventListener('play', () => {
    if (!window.__lpCaptureIsAdmin) return;
    if (montageListen || montagePreparing || videoCaptureState || !lastEvents.length) return;
    if (versioning && versioning.isListening && versioning.isListening()) return;
    // L'image attend le son : startMontageListen la relance une fois la musique prête, au même endroit.
    videoEl.pause();
    startMontageListen();
  });
  // Fin de la vidéo pendant une prise (05/11, retour de Jules-Antoine) : la capture s'arrête toute seule, comme au clic sur « Arrêter
  // la capture » (la musique s'arrête aussi) -- sinon la musique continuait et la frise s'allongeait bien au-delà de l'image.
  videoEl.addEventListener('ended', () => { if (videoCaptureState) recordBtn.click(); });
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
      // train de jouer. Couvre la piste armée ET toutes celles lancées pendant la prise (04/11 : la leçon Versioning
      // passe de la rue au club en changeant de morceau, le second continuait de jouer après l'arrêt).
      new Set([armedTrackId].concat(newPassEvents.map(e => e.detail && e.detail.trackId)).filter(Boolean))
        .forEach(id => document.dispatchEvent(new CustomEvent('stop-track', { detail: id })));
      videoEl.pause();
      recordBtn.classList.remove('recording');
      recordLabel.textContent = tr('captureStartBtn');
      countEl.textContent = captureCountText(lastEvents);
      additiveCheckbox.disabled = false;
      refreshActionButtons();
      renderCaptureTimeline(timelineEl, lastEvents, captureCanEdit, () => {
        countEl.textContent = captureCountText(lastEvents);
        refreshActionButtons();
      }, laneOverrides, collapsedGroups, videoEl, timelineMarkers);
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
      clearTimeout(autosaveTimer); // pas d'enregistrement pendant que la prise s'écrit
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
        lastSavedKey = null; lastPublishedKey = null; // nouvelle prise : ni enregistrée ni publiée
        saveStatus.textContent = ''; saveStatus.dataset.state = '';
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
        renderCaptureTimeline(timelineEl, liveEvents, false, null, laneOverrides, collapsedGroups, videoEl, timelineMarkers);
      }, 500);
    }
  });
  // Tête de lecture en continu pendant que la vidéo avance -- repositionne juste la ligne (pas de
  // ré-affichage complet de la frise, trop coûteux à chaque frame).
  videoEl.addEventListener('timeupdate', () => positionCapturePlayhead(timelineEl, videoEl));
  async function runExport(mode) {
    if (mode === 'video' && fullExportLocked) return; // garde-fou : même si le bouton était réactivé à la main
    // Nom du fichier (09/11, demande de Jules-Antoine : « export-nombre » à chaque fois) : demandé AVANT l'export (il peut durer longtemps),
    // proposé d'après le nom du montage. Annuler = pas d'export. Le même nom sert de proposition si on ajoute ensuite l'export à la bibliothèque.
    const askedName = await window.LayerPitchNotify.prompt(tr('captureDownloadNamePrompt'), { inputValue: lastExportName || titleInput.value || '' });
    if (askedName === null) return;
    const fileBase = askedName.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/\.(mp4|wav)$/i, '').trim().replace(/^\.+/, '') || ('export-' + Date.now());
    lastExportName = askedName.trim();
    setExportButtonsDisabled(true);
    try {
      // Sélecteur de palier retiré du panneau le 16 septembre (retour direct de Jules-Antoine : "ça ne
      // sert à rien" -- confusion en testant, aucun palier réel n'existe encore pour lui donner du
      // sens) -- "on le garde pour les vrais réglages que personne ne verra". La mécanique de filigrane
      // dans exportCaptureVideo reste intacte, juste plus exposée en UI : figé sur 'boss' (aucun
      // filigrane) en attendant un vrai palier compositeur à brancher ici, invisible pour l'instant.
      const exportOptions = { tier: window.__lpNoWatermark ? 'boss' : 'warrior', showComposerCredit: creditCheckbox.checked, mode };
      const blob = await exportCaptureVideo(lastEvents, file, (msg) => { exportStatus.textContent = msg; }, laneOverrides, exportOptions);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileBase}.${mode === 'audio' ? 'wav' : 'mp4'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      exportStatus.textContent = tr(mode === 'audio' ? 'captureAudioDone' : 'captureExportDone');
      // Garde le Blob pour un envoi optionnel vers la bibliothèque vidéo (voir addToLibraryBtn ci-dessous) -- distinct du téléchargement
      // local ci-dessus, jamais automatique (2026-09-16). Un export audio seul n'est pas une vidéo : rien à envoyer à la bibliothèque.
      // (06/11 : ce que les AdReels et les Projets affichent, c'est le montage lui-même, publié par « Sauvegarder / publier ».)
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
    // Nom de la vidéo (6/11, demande de Jules-Antoine) : demandé à l'ajout, proposé d'après le nom de la prise ; renommable ensuite
    // dans la bibliothèque. Annuler = on n'envoie rien.
    const exportName = await window.LayerPitchNotify.prompt(tr('captureExportNamePrompt'), { inputValue: lastExportName || titleInput.value || '' });
    if (exportName === null) return;
    addToLibraryBtn.disabled = true;
    exportStatus.textContent = tr('captureAddingToLibrary');
    try {
      const videoId = await saveExportToVideoLibrary(lastExportBlob, packId, exportName.trim(), videoEl.duration || null, undefined, (msg) => { exportStatus.textContent = msg; });
      // (Vidéo complète : à télécharger ou publier ailleurs. Les pages LayerPitch, elles, jouent la vidéo muette du montage et le son de
      // chaque version : voir « Mettre à jour la vidéo partout ».)
      exportStatus.textContent = tr('captureAddedToLibrary');
      addToLibraryBtn.hidden = true; // évite un second envoi du même export
    } catch (e) {
      console.error(e);
      exportStatus.textContent = tr('captureAddToLibraryFailed').replace('{error}', e.message);
    } finally {
      addToLibraryBtn.disabled = false;
    }
  });
  // « Mettre à jour la vidéo partout » (21/10) : après une retouche, refait l'export rapide (image d'origine + nouveau son, sans
  // incrustation, quelques secondes), le dépose dans la bibliothèque et y relie le montage avec ses nouvelles étiquettes. Partout où le
  // montage est affiché (AdReels, espace Projet), la nouvelle vidéo et la nouvelle étiquette apparaissent, sans rien republier.
  // Vidéo muette une fois + un son par version (21/10, migration 20261021040000) : la première publication d'un montage range sa vidéo
  // muette (l'image d'origine sans son) ; ensuite, chaque export n'est plus qu'un fichier son (+ étiquettes), joué sur cette image.
  async function ensureMontageBase(onStatus) {
    const client = window.LayerPitchSupabaseClient.getClient();
    const cur = await client.rpc('video_capture_base', withStudio({ p_capture_id: savedCaptureId }));
    if (!cur.error && cur.data) return cur.data;
    onStatus(tr('captureMakingSilentVideo'));
    const blob = await makeSilentVideo(file, onStatus);
    const id = await saveExportToVideoLibrary(blob, packId, (titleInput.value || file.name) + ' — ' + tr('captureSilentVideoSuffix'), videoEl.duration || null, 'capture_base', onStatus);
    const { error } = await client.rpc('set_video_capture_base', withStudio({ p_capture_id: savedCaptureId, p_video_id: id }));
    if (error) throw error;
    return id;
  }
  async function publishMontageSound(events, title) {
    const onStatus = (msg) => { exportStatus.textContent = msg; };
    await ensureMontageBase(onStatus);
    const exportOptions = { tier: window.__lpNoWatermark ? 'boss' : 'warrior', showComposerCredit: creditCheckbox.checked, mode: 'audio' };
    const wav = await exportCaptureVideo(events, file, onStatus, laneOverrides, exportOptions);
    onStatus(tr('captureEncodingSound'));
    const sound = await encodeSoundForLibrary(wav, onStatus);
    onStatus(tr('captureAddingToLibrary'));
    return saveExportToVideoLibrary(sound, packId, title || '', videoEl.duration || null, 'capture_audio', onStatus);
  }
  // --- Enregistrement automatique et publication du montage (06/11, décidé avec Jules-Antoine) -------------------------------------
  // Plus de bouton « Sauvegarder » : toute retouche (prise, frise, noms, repères, titre) est enregistrée toute seule, sans geste, une
  // seconde et demie après la dernière modification. La clé d'état (captureStateKey) évite de renvoyer ce qui n'a pas changé (chargement,
  // retouche annulée). Boss seulement (captureCanSave) : le serveur refuse l'enregistrement des autres paliers.
  // Publication : « tout enregistrer » du Backstage demande à l'atelier de terminer le montage (message finishMontage, voir
  // 20-demarrage-atelier.js) ; dans le studio (pas de bouton global), « Publier le montage » fait la même chose à la main.
  const captureStateKey = () => JSON.stringify({ e: lastEvents, l: laneOverrides, g: collapsedGroups, m: timelineMarkers, t: titleInput.value });
  const creditNameForCues = () => (creditCheckbox.checked && window.__lpCaptureLibrary && window.__lpCaptureLibrary.composerName) || '';
  const soundKey = () => JSON.stringify({ e: lastEvents, l: laneOverrides, c: creditNameForCues() }); // ce qui change le son et les étiquettes publiés
  const montageNeedsPublish = () => captureCanSave && !!packId && lastEvents.length > 0 && soundKey() !== lastPublishedKey;
  const hostPublishes = typeof atelierEmbedded !== 'undefined' && atelierEmbedded && !atelierAsStudio; // composeur dans le Backstage : son bouton global publie
  const setSaveState = (state, text) => { saveStatus.dataset.state = state; saveStatus.textContent = text; };
  function scheduleAutosave() {
    if (!captureCanSave || !packId) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { saveCaptureNow().catch(() => { /* déjà affiché dans la zone d'état */ }); }, 1500);
  }
  async function saveCaptureNow() {
    if (autosaveRunning) { try { await autosaveRunning; } catch (e) { /* l'erreur a été montrée ; on réessaie ci-dessous */ } }
    if (!captureCanSave || !packId || !lastEvents.length) return;
    const key = captureStateKey();
    if (key === lastSavedKey) return;
    autosaveRunning = (async () => {
      setSaveState('saving', tr('captureSaving'));
      try {
        if (!currentCaptureId) {
          currentCaptureId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        }
        await saveVideoCapture(packId, currentCaptureId, titleInput.value, file.name, lastEvents, laneOverrides, collapsedGroups, timelineMarkers);
        lastSavedKey = key;
        setSaveState('saved', tr(hostPublishes ? 'captureSavedAutoHost' : 'captureSavedAutoStudio'));
        refreshLoadOptions();
        if (savedCaptureId !== currentCaptureId) { savedCaptureId = currentCaptureId; if (versioning) versioning.refresh(); renderExportHistory(); }
      } catch (e) {
        console.error(e);
        setSaveState('error', tr('captureSaveFailed').replace('{error}', e.message));
        throw e;
      }
    })();
    try { await autosaveRunning; } finally { autosaveRunning = null; }
  }
  titleInput.addEventListener('input', scheduleAutosave);
  // Un seul nom : renommer le montage renomme aussi sa vidéo muette dans la bibliothèque vidéo (« <nom> — montage »), à la sortie du champ.
  titleInput.addEventListener('change', async () => {
    try {
      const name = titleInput.value.trim();
      if (!name) { titleInput.value = defaultMontageName; scheduleAutosave(); return; }
      await saveCaptureNow();
      if (!savedCaptureId) return;
      const client = window.LayerPitchSupabaseClient.getClient();
      const cur = await client.rpc('video_capture_base', withStudio({ p_capture_id: savedCaptureId }));
      if (cur.error || !cur.data) return;
      await client.rpc('rename_video', withStudio({ p_id: cur.data, p_title: name + ' — ' + tr('captureSilentVideoSuffix') }));
    } catch (e) { console.warn('LayerPitch — renommage de la vidéo muette :', e); }
  });
  // Publie le montage : son (+ image muette la première fois) et étiquettes, reliés au montage ; les AdReels et les Projets qui l'affichent
  // le montrent aussitôt, sans rien republier. Renvoie 'none' (rien à publier) ou 'done'. force : republier même sans changement.
  async function publishMontageNow(opts) {
    opts = opts || {};
    if (!captureCanSave || !packId) return 'none';
    if (publishRunning) return publishRunning;
    clearTimeout(autosaveTimer);
    publishRunning = (async () => {
      await saveCaptureNow(); // ce qui est publié est toujours ce qui est enregistré
      if (!savedCaptureId || !lastEvents.length) return 'none';
      const key = soundKey();
      if (!opts.force && key === lastPublishedKey) return 'none';
      const videoId = await publishMontageSound(lastEvents, titleInput.value);
      const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc('set_video_capture_export', withStudio({ p_capture_id: savedCaptureId, p_video_id: videoId, p_cues: buildCaptureCues(lastEvents, laneOverrides, creditNameForCues()), p_keep_old: keepOldCheckbox.checked }));
      if (error) throw error;
      await r2DeleteRemovedVideos(data && data.removed); // exports trop anciens (au-delà de 3) ou ancienne vidéo non gardée
      lastPublishedKey = key;
      renderExportHistory();
      return 'done';
    })();
    try { return await publishRunning; } finally { publishRunning = null; }
  }
  updateEverywhereBtn.addEventListener('click', async () => {
    if (!lastEvents.length || !packId) return;
    updateEverywhereBtn.disabled = true; setExportButtonsDisabled(true);
    try {
      await publishMontageNow({ force: true });
      exportStatus.textContent = tr('captureUpdatedEverywhere');
    } catch (e) {
      console.error(e);
      exportStatus.textContent = tr('captureExportFailed').replace('{error}', e.message);
    } finally {
      updateEverywhereBtn.disabled = false; setExportButtonsDisabled(lastEvents.length === 0);
    }
  });
  // Dans le Backstage, le bouton global publie : le bouton et sa case disparaissent, un seul geste reste (« Sauvegarder / publier »).
  if (hostPublishes || !captureCanSave) {
    updateEverywhereBtn.hidden = true;
    document.getElementById('videoCaptureKeepOldLabel').hidden = true;
  }
  // Appelée par 20-demarrage-atelier.js quand le Backstage demande de terminer le montage ; 'none' : rien à publier.
  window.__lpFinishMontage = async () => {
    setExportButtonsDisabled(true);
    try {
      const r = await publishMontageNow();
      if (r === 'done') exportStatus.textContent = tr('captureUpdatedEverywhere');
      return r;
    } catch (e) {
      console.error(e);
      exportStatus.textContent = tr('captureExportFailed').replace('{error}', e.message);
      throw e;
    } finally {
      setExportButtonsDisabled(lastEvents.length === 0);
    }
  };
  window.__lpDisposeMontage = () => { clearTimeout(autosaveTimer); window.__lpFinishMontage = null; window.__lpDisposeMontage = null; };
  // Prise chargée (depuis la liste, ou montage « détaché » d'une version vidéo) : elle devient la prise en cours.
  function applyLoadedCapture(capture) {
    currentCaptureId = capture.id;
    savedCaptureId = capture.id;
    setTimeout(renderExportHistory, 0); // historique des exports de ce montage
    lastEvents = capture.events || [];
    laneOverrides = capture.laneOverrides || {};
    collapsedGroups = capture.collapsedGroups || {};
    timelineMarkers = Array.isArray(capture.markers) ? capture.markers.map(m => Object.assign({}, m)) : []; // copie : la frise les modifie sur place
    titleInput.value = capture.title || defaultMontageName;
    // Prise tout juste chargée : rien à enregistrer. Déjà publiée (elle a une image de montage) : rien à publier tant qu'on ne la retouche pas.
    lastSavedKey = captureStateKey();
    lastPublishedKey = null;
    { const loadedId = capture.id, loadedSound = soundKey();
      window.LayerPitchSupabaseClient.getClient().rpc('video_capture_base', withStudio({ p_capture_id: loadedId }))
        .then(r => { if (!r.error && r.data && currentCaptureId === loadedId && lastPublishedKey === null) lastPublishedKey = loadedSound; }).catch(() => {}); }
    setSaveState('', '');
    countEl.textContent = captureCountText(lastEvents);
    refreshActionButtons();
    renderCaptureTimeline(timelineEl, lastEvents, captureCanEdit, () => {
      countEl.textContent = captureCountText(lastEvents);
      refreshActionButtons();
    }, laneOverrides, collapsedGroups, videoEl, timelineMarkers);
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
  // Hors Boss : pas d'enregistrement de montage (barre masquée, explication à la place).
  if (!captureCanSave) {
    [loadSelect, loadBtn, titleInput].forEach(el => { el.hidden = true; });
    saveStatus.textContent = tr(captureLevel === 'edit' ? 'captureSaveTierNoteWarrior' : 'captureSaveTierNoteRookie');
  } else {
    refreshLoadOptions();
  }
  // Versioning (26/09) : les versions vidéo d'un montage -- même montage rejoué sur d'autres morceaux / Sfx
  // (capture-retarget.js, capture-versioning.js). Droit lu dans la matrice (28/09) : Boss = versions enregistrées
  // (rattachées au montage sauvegardé) ; Warrior = versions de la séance, gardées en mémoire, perdues à la fermeture.
  // Feu vert 'versioning' : admin seulement d'ici là ; les fonctions serveur le vérifient aussi.
  const versioningHost = document.getElementById('videoCaptureVersioning');
  const versioningLevel = window.__lpVersioningLevel;
  if (versioningLevel && window.LayerCaptureVersioning) {
    versioningHost.hidden = false;
    versioning = window.LayerCaptureVersioning.mount(versioningHost, {
      sessionOnly: versioningLevel !== 'saved',
      tr, videoEl, fetchBytes: fetchAsUint8Array, fullExportLocked,
      library: capturePackLibrary(), otherPacks: (window.__lpCaptureLibrary.otherPacks || []),
      extraPackContent: (pid) => { const L = window.__lpCaptureLibrary, pk = (L.otherPacks || []).find(x => x.id === pid); if (!pk) return null;
        const t = new Set(pk.trackIds), sx = new Set(pk.sfxIds); return { tracks: (L.library || []).filter(x => t.has(x.id)), sfx: (L.sfxLibrary || []).filter(x => sx.has(x.id)) }; },
      findTrack: findCaptureTrack, findSfx: findCaptureSfx,
      getEvents: () => lastEvents, getCaptureId: () => (versioningLevel === 'saved' ? savedCaptureId : 'session'), getCaptureTitle: () => titleInput.value,
      exportEvents: (events, mode, onProgress) => exportCaptureVideo(events, file, onProgress, laneOverrides, { tier: window.__lpNoWatermark ? 'boss' : 'warrior', showComposerCredit: creditCheckbox.checked, mode }),
      saveToLibrary: (blob, title) => saveExportToVideoLibrary(blob, packId, title, videoEl.duration || null),
      cuesOf: (events) => buildCaptureCues(events, laneOverrides, creditNameForCues()), // étiquettes rangées avec la vidéo d'une version (21/10)
      keepOld: () => keepOldCheckbox.checked, // garder ou non l'ancienne vidéo d'une version dans l'historique
      publishVersion: (events, title) => publishMontageSound(events, title), // une version publiée = un son, joué sur la vidéo muette
      afterExport: (result) => { r2DeleteRemovedVideos(result && result.removed); renderExportHistory(); },
      // « Détacher » : la version devient un montage indépendant (sauvegardé tout de suite), ouvert à la place de celui-ci.
      detach: async (events, title) => {
        const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        await saveVideoCapture(packId, id, title, file.name, events, {}, collapsedGroups, timelineMarkers);
        applyLoadedCapture({ id, title, videoFilename: file.name, events, laneOverrides: {}, collapsedGroups, markers: timelineMarkers.map(m => Object.assign({}, m)) });
        saveStatus.textContent = tr('versioningDetachedLoaded');
        refreshLoadOptions();
      },
    });
    capturePanelVersioning = versioning;
    // Une seule musique à la fois (05/11, retour de Jules-Antoine : les deux se superposaient) : tout bouton du Versioning (créer une
    // version, l'écouter…) arrête d'abord l'écoute du montage.
    versioningHost.addEventListener('click', e => { if (montageListen && e.target.closest && e.target.closest('[data-act]')) stopMontageListen(); }, true);
  }
  // Montage demandé à l'ouverture (lien du Backstage) : chargé tout de suite, puis la section Versioning est amenée à l'écran.
  // Frise prête dès l'ouverture (montage à la souris, 05/11) : les morceaux du pack et leurs couches vides, à remplir au double-clic.
  // Redessinée quand la vidéo connaît sa durée (la frise couvre toute la vidéo).
  const renderEditableTimeline = () => renderCaptureTimeline(timelineEl, lastEvents, captureCanEdit, () => {
    countEl.textContent = captureCountText(lastEvents);
    refreshActionButtons();
  }, laneOverrides, collapsedGroups, videoEl, timelineMarkers);
  renderEditableTimeline();
  videoEl.addEventListener('loadedmetadata', () => { if (!videoCaptureState) renderEditableTimeline(); });
  if (opts.montageId) {
    saveStatus.textContent = tr('captureLoading');
    loadVideoCapture(opts.montageId).then(capture => {
      applyLoadedCapture(capture);
      loadSelect.value = capture.id;
      if (versioning) setTimeout(() => versioningHost.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    }).catch(e => { console.error(e); saveStatus.textContent = tr('captureLoadFailed').replace('{error}', e.message); });
  }
  document.getElementById('videoCaptureCloseBtn').addEventListener('click', async () => {
    // Panneau détaché (06/11) : la croix du panneau fait comme la croix de la fenêtre -- le lecteur se raccroche à la page, il ne se perd jamais.
    if (capturePanelDetachedWindow && !capturePanelDetachedWindow.closed) { capturePanelDetachedWindow.close(); return; }
    // Montage retouché mais pas encore publié : une fois le panneau fermé, la vidéo d'origine n'est plus là pour fabriquer le son.
    if (montageNeedsPublish() && !(typeof atelierParams !== 'undefined' && atelierParams.has('tuto'))
        && await window.LayerPitchNotify.confirm(tr('captureCloseUnpublishedAsk'), { okLabel: tr('captureClosePublishBtn'), cancelLabel: tr('captureCloseWithoutBtn') })) {
      try { await window.__lpFinishMontage(); } catch (e) { return; } // l'erreur est affichée dans le panneau, qui reste ouvert
    }
    URL.revokeObjectURL(objectUrl);
    closeCapturePanel();
  });
  // Replier / déplier les infos (titre, pack, étapes) : toutes les commandes restent dans la partie lecteur (06/11). Retenu sur cet appareil.
  const infoBtn = document.getElementById('videoCaptureInfoBtn');
  const applyInfoFold = (fold) => { document.body.classList.toggle('atelier-info-collapsed', fold); infoBtn.classList.toggle('active', fold); infoBtn.setAttribute('aria-pressed', fold ? 'true' : 'false'); };
  try { applyInfoFold(localStorage.getItem('lpAtelierInfoFolded') === '1'); } catch (e) { applyInfoFold(false); }
  infoBtn.addEventListener('click', () => {
    const fold = !document.body.classList.contains('atelier-info-collapsed');
    applyInfoFold(fold);
    try { localStorage.setItem('lpAtelierInfoFolded', fold ? '1' : '0'); } catch (e) {}
  });
  document.getElementById('videoCaptureDetachBtn').addEventListener('click', detachCapturePanel);
  wireCaptureImageHiding(panel, videoEl);
  wireAtelierFullscreenButtons(panel);
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

