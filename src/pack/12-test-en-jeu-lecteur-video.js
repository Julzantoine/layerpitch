// Reconnaît une URL YouTube ou Vimeo et en extrait l'identifiant — gère les formats courants de chaque
// service (watch?v=, youtu.be, /embed/, /shorts/ pour YouTube ; vimeo.com/ID et player.vimeo.com/video/ID).
function parseVideoUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl.trim()); } catch (e) { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (u.pathname === '/watch') id = u.searchParams.get('v');
    else if (u.pathname.startsWith('/embed/')) id = u.pathname.split('/')[2];
    else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2];
    if (id) return { service: 'youtube', id };
    return null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    const id = parts[parts.length - 1];
    if (id && /^\d+$/.test(id)) return { service: 'vimeo', id };
    return null;
  }
  return null;
}

// Multi-écrans : window.screen.isExtended n'existe que sur Chromium (Chrome/Edge desktop) et dit si le
// bureau de la personne s'étend sur plusieurs écrans, sans avoir besoin de lui demander la permission
// (contrairement à l'API complète Window Management / getScreenDetails()). Sur Safari, Firefox, mobile —
// où la propriété n'existe simplement pas — on considère qu'il n'y a qu'un seul écran, ce qui est le cas
// le plus sûr par défaut (mieux vaut intégrer à tort que perdre la vidéo dans une fenêtre égarée).
function isMultiScreen() {
  try { return !!(window.screen && window.screen.isExtended); } catch (e) { return false; }
}

function videoTestUrl(parsed) {
  return `./video-test.html?service=${parsed.service}&id=${encodeURIComponent(parsed.id)}&lang=${pageLang}`;
}

// Positionnement approximatif sur le second écran : sans permission Window Management, on ne connaît pas
// la vraie disposition des écrans, donc on décale simplement la fenêtre de la largeur de l'écran principal.
// Fonctionne bien pour la disposition la plus courante (écrans côte à côte) ; à défaut, la personne peut
// toujours la déplacer elle-même — les navigateurs se souviennent en général de la position choisie.
function openInWindow(parsed) {
  const left = (window.screen && window.screen.width) ? window.screen.width : 0;
  window.open(videoTestUrl(parsed), '_blank', `left=${left},top=40,width=960,height=600`);
  trackPublicEvent('video_test_open', { service: parsed.service, mode: 'window' });
}

function closeVideoPanel() {
  const panel = document.getElementById('videoTestPanel');
  panel.classList.remove('active');
  document.body.classList.remove('video-panel-active');
  panel.innerHTML = ''; // vide l'iframe pour couper la vidéo, pas juste la masquer
}

function openInPanel(parsed) {
  const panel = document.getElementById('videoTestPanel');
  panel.innerHTML = `
    <div class="video-test-panel-header">
      <span class="video-test-panel-title">${tr('videoTestPanelTitle')}</span>
      <div class="video-test-panel-actions">
        <button type="button" class="video-test-panel-btn" id="videoTestDetachBtn" title="${tr('detachBtn')}" aria-label="${tr('detachBtn')}">⤢</button>
        <button type="button" class="video-test-panel-btn" id="videoTestCloseBtn" title="${tr('closeBtn')}" aria-label="${tr('closeBtn')}">✕</button>
      </div>
    </div>
    <div class="video-test-panel-frame-wrap"><iframe src="${videoTestUrl(parsed)}" allow="autoplay"></iframe></div>
  `;
  panel.classList.add('active');
  document.body.classList.add('video-panel-active');
  document.getElementById('videoTestCloseBtn').addEventListener('click', closeVideoPanel);
  document.getElementById('videoTestDetachBtn').addEventListener('click', () => {
    closeVideoPanel();
    openInWindow(parsed);
  });
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  trackPublicEvent('video_test_open', { service: parsed.service, mode: 'embedded' });
}

// Boîte de dialogue Mode Test Gameplay — mise en place une fois, indépendamment du fait que ce pack
// l'active ou non (la balise <dialog> ne s'ouvre de toute façon que si le bouton déclencheur existe).
(function setupVideoTestDialog() {
  const dialog = document.getElementById('videoTestDialog');
  const input = document.getElementById('videoTestUrlInput');
  const errorEl = document.getElementById('videoTestError');
  const cancelBtn = document.getElementById('videoTestCancelBtn');
  const openBtn = document.getElementById('videoTestOpenBtn');
  if (!dialog) return;
  function tryOpen() {
    const parsed = parseVideoUrl(input.value);
    if (!parsed) {
      errorEl.textContent = tr('invalidUrl');
      trackPublicEvent('video_test_invalid_url', {});
      return;
    }
    errorEl.textContent = '';
    if (isMultiScreen()) { openInWindow(parsed); } else { openInPanel(parsed); }
    dialog.close();
    input.value = '';
  }
  cancelBtn.addEventListener('click', () => dialog.close());
  openBtn.addEventListener('click', tryOpen);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tryOpen(); } });
  dialog.addEventListener('close', () => { errorEl.textContent = ''; });
})();

// --- Mode Capture (admin, prototype moteur vidéo) --------------------------------------------
// Enregistre l'horodatage (vs. la vidéo importée) de chaque interaction du lecteur adaptatif pendant
// une "prise" -- calques (intensity_change), stingers (stinger_play), embranchements (seq_branch_select,
// embr_loop_select), etc. Plutôt que de raccorder ces déclencheurs un par un (5 modes de lecture,
// logique interne à player.js), on intercepte le point de passage déjà unique par lequel TOUTE
// interaction transite : trackPublicEvent() y appelle systématiquement window.umami.track(name, detail)
// (voir player.js). On substitue temporairement window.umami par un objet qui journalise avant de
// relayer au vrai umami s'il existe déjà -- aucune modification de player.js nécessaire.
let videoCaptureState = null; // { events, videoEl, markHandler, headHandler, sliderHandler }

// Piste armée pour la capture (2026-09-15) -- réglée depuis un bouton ⏺ posé à côté du lecteur de CHAQUE
// morceau (voir setupCaptureTrigger), exclusif (armer une piste désarme l'ancienne). Persiste tant que la
// page reste ouverte, indépendamment du panneau de capture -- on arme d'abord dans le lecteur du pack,
// avant même d'ouvrir "Capturer une prise" (confirmé par Jules-Antoine 2026-09-15 : "on va d'abord
// s'intéresser au lecteur du pack, avant d'aller dans l'éditeur vidéo").
let armedTrackId = null;
