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

// parsed : { service: 'youtube' | 'vimeo', id } (lien collé), ou { service: 'library', url, title } (vidéo de la bibliothèque du
// visiteur connecté, 21/10) -- celle-ci se joue directement ici, son coupé, comme le ferait la fenêtre YouTube/Vimeo.
function openInPanel(parsed) {
  const panel = document.getElementById('videoTestPanel');
  const media = parsed.service === 'library'
    ? `<video src="${escapeHtml(parsed.url)}" controls muted playsinline></video>`
    : `<iframe src="${videoTestUrl(parsed)}" allow="autoplay"></iframe>`;
  panel.innerHTML = `
    <div class="video-test-panel-header">
      <span class="video-test-panel-title">${tr('videoTestPanelTitle')}</span>
      <div class="video-test-panel-actions">
        <button type="button" class="video-test-panel-btn" id="videoTestDetachBtn" title="${tr('detachBtn')}" aria-label="${tr('detachBtn')}">⤢</button>
        <button type="button" class="video-test-panel-btn" id="videoTestCloseBtn" title="${tr('closeBtn')}" aria-label="${tr('closeBtn')}">✕</button>
      </div>
    </div>
    <div class="video-test-panel-frame-wrap">${media}</div>
  `;
  panel.classList.add('active');
  document.body.classList.add('video-panel-active');
  document.getElementById('videoTestCloseBtn').addEventListener('click', closeVideoPanel);
  const detachBtn = document.getElementById('videoTestDetachBtn');
  // Une vidéo de la bibliothèque reste dans la page (pas de fenêtre séparée prévue pour elle).
  if (parsed.service === 'library') detachBtn.hidden = true;
  else detachBtn.addEventListener('click', () => {
    closeVideoPanel();
    openInWindow(parsed);
  });
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  trackPublicEvent('video_test_open', { service: parsed.service, mode: 'embedded' });
}

// Ouverture du dialogue « Tester en jeu ». Visiteur connecté à un compte LayerPitch (21/10, décidé par Jules-Antoine) : en plus du
// lien YouTube/Vimeo, une vidéo de SA bibliothèque (compositeur, ou studio de son équipe). Les scripts du compte ne sont chargés
// qu'à ce moment-là (jamais au chargement de la page publique). Réservé à l'admin jusqu'au feu vert (même règle que le choix dans la
// bibliothèque de l'atelier). Rien n'est enregistré : la vidéo se joue ici, son coupé.
let videoTestLibrary = [];
let openVideoTestDialog = () => document.getElementById('videoTestDialog').showModal();
(function setupVideoTestLibrary() {
  const dialog = document.getElementById('videoTestDialog');
  const pick = document.getElementById('videoTestLibraryPick');
  const select = document.getElementById('videoTestLibrarySelect');
  const btn = document.getElementById('videoTestLibraryBtn');
  if (!dialog || !pick) return;
  let loaded = false;
  async function loadLibrary() {
    if (loaded) return;
    loaded = true;
    try {
      await loadPurchaseScripts();
      const { session } = await window.LayerPitchAuth.getSession();
      if (!session) return;
      const client = window.LayerPitchSupabaseClient.getClient();
      const { data: isAdmin } = await client.rpc('is_admin');
      if (!isAdmin) return; // nouveauté réservée à l'admin jusqu'au feu vert
      const [mine, studio] = await Promise.all([client.rpc('list_my_videos'), client.rpc('list_my_videos', { p_studio: true })]);
      const seen = new Set();
      videoTestLibrary = [].concat((mine.data && mine.data.videos) || [], (!studio.error && studio.data && studio.data.videos) || [])
        .filter(v => v.kind !== 'capture_audio' && !seen.has(v.id) && seen.add(v.id));
    } catch (e) { console.warn('LayerPitch — bibliothèque vidéo indisponible :', e); videoTestLibrary = []; }
    if (!videoTestLibrary.length) return;
    select.innerHTML = videoTestLibrary.map(v => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.title || v.originalName || v.file)}</option>`).join('');
    pick.hidden = false;
  }
  openVideoTestDialog = () => { dialog.showModal(); loadLibrary(); };
  btn.addEventListener('click', () => {
    const v = videoTestLibrary.find(x => x.id === select.value);
    if (!v) return;
    dialog.close();
    openInPanel({ service: 'library', url: v.base + encodeURIComponent(v.file), title: v.title || v.originalName || v.file });
  });
})();

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
