/* ---------------- Upload R2 (audio/Sfx — Décision 3, docs/infrastructure.md) ----------------
 * L'audio n'est plus servi depuis GitHub mais depuis media.layerpitch.com (bucket R2) — trouvé le
 * 31 août : track.base/sfx.base étaient réécrits vers github.io à CHAQUE publication, ce qui
 * cassait silencieusement le site en production dès la publication suivante (games déjà migrés
 * vers R2 remis sur l'ancienne URL). Corrigé ici : base pointe désormais vers R2.
 *
 * Écriture/suppression toujours via l'Edge Function create-media-signed-url (4 septembre) : une URL
 * R2 pré-signée à usage unique et courte durée de vie (5 min), jamais les clés secrètes R2
 * elles-mêmes. Avant le 11 septembre, un panneau admin permettait de coller les clés R2 maîtresses
 * en clair dans le navigateur (persistées en localStorage) pour signer les requêtes soi-même en
 * repli -- retiré (audit sécurité) : ces clés donnent un accès total au bucket, y compris aux
 * factures, et l'Edge Function couvre déjà tous les cas d'usage sans ce risque.
 */
const MEDIA_BASE = 'https://media.layerpitch.com/';
// size : taille exacte d'un envoi (PUT), vérifiée et verrouillée par le serveur avec le type de fichier (27/09).
async function r2SignedUrl(path, method, size) {
  await loadPostgresReadScripts();
  const { data, error } = await window.LayerPitchSupabaseClient.getClient()
    .functions.invoke('create-media-signed-url', { body: { path, method, size } });
  if (error) throw new Error(await window.LayerPitchAuth.describeFunctionError(error));
  if (!data || !data.url) throw new Error((data && data.error) || 'Réponse inattendue.');
  return data;
}
// onProgress(envoyé, total) (09/11, demande de Jules-Antoine : « un état d'avancement de l'upload ») : fetch() ne dit rien de la progression d'un
// envoi, donc avec un onProgress on passe par XMLHttpRequest (upload.onprogress). `bytes` peut être un Blob (évite de copier une grosse vidéo en mémoire).
function putWithProgress(url, headers, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    Object.entries(headers || {}).forEach(([k, v]) => { if (k.toLowerCase() !== 'content-length') xhr.setRequestHeader(k, v); });
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: async () => xhr.responseText });
    xhr.onerror = () => reject(new Error('envoi interrompu (réseau)'));
    xhr.onabort = () => reject(new Error('envoi annulé'));
    xhr.send(body);
  });
}
async function r2PutFile(key, bytes, contentType, onProgress) {
  const { url, headers } = await r2SignedUrl(key, 'PUT', bytes.byteLength != null ? bytes.byteLength : bytes.size);
  // En-têtes imposés et signés par le serveur (type, et pour un SVG Content-Disposition) : renvoyés tels quels, sinon
  // R2 refuse l'envoi. contentType ne sert plus que si le serveur n'en renvoie pas (ancienne version).
  const putHeaders = headers || { 'content-type': contentType };
  const res = onProgress
    ? await putWithProgress(url, putHeaders, bytes, onProgress)
    : await fetch(url, { method: 'PUT', headers: putHeaders, body: bytes });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PUT R2 ${key} → ${res.status} ${text.slice(0, 300)}`);
  }
}
// Supprime un fichier sur R2 — ajouté le 01/09 pour que la suppression d'un morceau/Sfx/couche/
// alternative dans le backstage supprime aussi le fichier distant, plutôt que de le laisser
// orphelin sur R2 (voir docs/LAYERPITCH_CHANGELOG.md).
// Renvoie 'kept' quand le serveur refuse l'effacement parce qu'une version d'album (prise d'un fan ou version du
// compositeur) utilise encore ce fichier (27/09, create-media-signed-url) : le fichier reste, rien d'anormal.
async function r2DeleteFile(key) {
  await loadPostgresReadScripts();
  const { data, error } = await window.LayerPitchSupabaseClient.getClient()
    .functions.invoke('create-media-signed-url', { body: { path: key, method: 'DELETE' } });
  if (error) throw new Error(await window.LayerPitchAuth.describeFunctionError(error));
  if (data && data.kept) return 'kept';
  if (!data || !data.url) throw new Error((data && data.error) || 'Réponse inattendue.');
  const url = data.url;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`DELETE R2 ${key} → ${res.status} ${text.slice(0, 300)}`);
  }
}
// Fire-and-forget : appelée depuis les points de suppression du backstage (synchrones, la donnée locale
// est déjà retirée du tableau avant cet appel) -- une erreur R2 (CORS pas encore ouvert au DELETE,
// identifiants absents...) ne doit jamais bloquer ni annuler la suppression déjà faite côté données.
function r2DeleteFileLogged(key) {
  if (!key) return;
  r2DeleteFile(key)
    .then(r => log(r === 'kept' ? `Fichier gardé (utilisé par des versions d'album) : ${key}` : `Suppression R2 : ${key}`, r === 'kept' ? 'info' : 'ok'))
    .catch(err => log(`Suppression R2 échouée pour ${key} : ${err.message}`, 'warn'));
}

// ============================================================================
// Bibliothèque vidéo compositeur (16 septembre) -- composer_videos / list_my_videos / upsert_video /
// delete_video (supabase/migrations/20260916020000_composer_videos.sql). Contrairement à la
// bibliothèque musicale/Sfx/packs ci-dessus (édition différée, publiée via publishAll()), l'upload
// agit tout de suite : compression, envoi R2, puis upsert_video -- rien à "publier" séparément,
// même logique immédiate que la sauvegarde de prise dans pack.html (video_captures).
//
// Compression systématique côté client via ffmpeg.wasm (même bibliothèque vendorée que pack.html,
// vendor/ffmpeg/) avant l'envoi -- jamais le fichier brut importé, pour ne pas exploser le quota de
// stockage (Jules-Antoine, 16 septembre : "un algorithme comme celui de youtube... pour ne pas
// exploser le compteur"). Réencodée en H.264/AAC, plafonnée à 720p/~1,2 Mbps (jamais agrandie) --
// abaissé depuis 1080p/2 Mbps le même jour, la compression restait bien trop lente sinon (voir
// compressVideoForLibrary ci-dessous pour le pourquoi précis : coeur ffmpeg.wasm mono-thread).
// ============================================================================
// Coeur multi-thread DÉFINITIVEMENT désactivé pour l'instant (16 septembre -- plusieurs tentatives le
// même jour : activation simple, alignement de version 0.12.6, -threads 2 explicite pour éviter le
// deadlock connu du pool -- https://github.com/ffmpegwasm/ffmpeg.wasm/issues/772). Aucune n'a résolu le
// blocage chez Jules-Antoine (Firefox). Conclusion : bug amont pas fiable à corriger sans reconstruire
// le binaire ffmpeg.wasm nous-mêmes (hors scope). Alternative de fond si la vitesse redevient
// bloquante : compression côté serveur (ex. Cloudflare Stream, ~10-15$/mois à l'échelle actuelle,
// discuté le même jour) plutôt que continuer à chasser ce bug côté client. Ne pas repasser à true sans
// une piste nouvelle et vérifiable.
const FFMPEG_MULTITHREAD_ENABLED = false;
let videoLibraryFfmpegSingleton = null;
async function loadVideoLibraryFfmpeg() {
  if (videoLibraryFfmpegSingleton) return videoLibraryFfmpegSingleton;
  const { FFmpeg } = await import('./vendor/ffmpeg/ffmpeg/index.js');
  const ffmpeg = new FFmpeg();
  // Coeur multi-thread (vendor/ffmpeg/core-mt/) si la page est servie avec les en-têtes d'isolation
  // (window.crossOriginIsolated -- voir le Worker Cloudflare mis en place le 16 septembre pour
  // beta.layerpitch.com/layerpitch-backstage.html, seule page où ils sont envoyés). Repli silencieux
  // sur le coeur mono-thread existant sinon (Worker désactivé/en échec, ou page visitée par un autre
  // chemin) -- ne jamais transformer un problème de vitesse en un plantage complet de la compression.
  const useMultiThread = FFMPEG_MULTITHREAD_ENABLED && typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated;
  const coreDir = useMultiThread ? 'core-mt' : 'core';
  log(`Compression vidéo : coeur ffmpeg ${useMultiThread ? 'multi-coeur' : 'mono-coeur'} chargé.`, 'info');
  await ffmpeg.load({
    coreURL: new URL(`./vendor/ffmpeg/${coreDir}/ffmpeg-core.js`, location.href).href,
    wasmURL: new URL(`./vendor/ffmpeg/${coreDir}/ffmpeg-core.wasm`, location.href).href,
  });
  videoLibraryFfmpegSingleton = ffmpeg;
  return ffmpeg;
}
// Durée d'un fichier vidéo local, lue via un <video> hors-DOM plutôt qu'en parsant les logs ffmpeg --
// sur le fichier ORIGINAL, avant compression (plus rapide, pas besoin d'attendre le réencodage).
function readVideoLibraryDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration || null); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    v.src = url;
  });
}
// ---- Compression par WebCodecs + Mediabunny (09/11) -----------------------------------------------------------------
// Remplace ffmpeg.wasm comme premier choix : l'encodeur H.264 du navigateur (souvent matériel) tourne ~6x plus vite que le
// temps réel, contre ~8x LA DURÉE de la vidéo en 1080p avec ffmpeg.wasm mono-thread (essais 09/11 dans Firefox 159 : 150 s de
// vidéo en ~22 s). Et ffmpeg-core est compilé avec --enable-gpl (x264) : le sortir du chemin principal réduit l'exposition GPL.
// Règles et seuils (image recopiée si déjà légère, son copié si AAC sinon AAC natif sinon Opus) : voir l'en-tête de layerpitch-video-compress.js.
//  - Toute erreur ici (navigateur sans WebCodecs, codec non encodable, source illisible) retombe sur ffmpeg.wasm : on ne
//    transforme jamais un défaut de vitesse en échec complet.
// La logique elle-même (règles image/son, seuils) vit dans layerpitch-video-compress.js, partagée avec l'Atelier.
async function compressVideoWithWebCodecs(file, onProgress) {
  return window.LayerPitchVideoCompress.compress(file, {
    log,
    onProgress: (pct) => { onProgress && onProgress(tr('videoLibraryCompressingProgress', { pct })); },
  });
}
async function compressVideoForLibrary(file, onProgress) {
  onProgress && onProgress(tr('videoLibraryCompressing'));
  try {
    return await compressVideoWithWebCodecs(file, onProgress);
  } catch (e) {
    console.warn('LayerPitch — compression WebCodecs impossible, repli sur ffmpeg.wasm :', e);
    log(`Compression rapide indisponible (${e.message}) : repli sur ffmpeg.wasm, plus lent.`, 'warn');
    return compressVideoWithFfmpeg(file, onProgress);
  }
}
async function compressVideoWithFfmpeg(file, onProgress) {
  onProgress && onProgress(tr('videoLibraryCompressing'));
  const ffmpeg = await loadVideoLibraryFfmpeg();
  const inName = 'in' + (file.name.slice(file.name.lastIndexOf('.')) || '.mp4');
  await ffmpeg.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
  // Vraie progression (2026-09-16, retour direct de Jules-Antoine : une compression sans aucun repère
  // ne se distingue pas d'un plantage quand elle prend plusieurs minutes) -- ffmpeg.wasm remonte un
  // événement 'progress' ({progress: 0-1}) pendant exec(), écouteur retiré après coup (off()) pour ne
  // pas s'accumuler d'un upload à l'autre sur cette même instance singleton.
  // Repli sur un temps écoulé (même jour, découvert juste après avoir activé le coeur multi-thread) :
  // l'événement 'progress' ne remonte plus du tout quand ffmpeg.wasm tourne sur le coeur core-mt (le
  // calcul se fait dans le sous-thread pthread qui fait le vrai travail, qui ne le relaie jamais vers
  // la page -- limitation connue de la lib, pas un bug introduit ici). Un chrono qui avance reste un
  // repère "ça tourne toujours" même sans pourcentage exact ; écrasé par le vrai pourcentage dès qu'un
  // événement 'progress' arrive (donc toujours le plus précis des deux affiché).
  const compressionStartedAt = Date.now();
  let lastKnownPct = null;
  const renderProgress = () => {
    if (lastKnownPct != null) { onProgress && onProgress(tr('videoLibraryCompressingProgress', { pct: lastKnownPct })); return; }
    const sec = Math.round((Date.now() - compressionStartedAt) / 1000);
    onProgress && onProgress(tr('videoLibraryCompressingElapsed', { sec }));
  };
  const onFfmpegProgress = ({ progress }) => {
    lastKnownPct = Math.max(0, Math.min(100, Math.round((progress || 0) * 100)));
    renderProgress();
  };
  ffmpeg.on('progress', onFfmpegProgress);
  const elapsedTickerId = setInterval(renderProgress, 1000);
  try {
    await ffmpeg.exec([
      // -threads 2 en entrée ET en sortie (16 septembre, bug connu du coeur multi-thread -- voir
      // FFMPEG_MULTITHREAD_ENABLED ci-dessus) : sans plafond explicite, le décodeur ET l'encodeur
      // réclament chacun un nombre de threads déduit automatiquement du nombre de coeurs de la machine
      // -- si leur somme dépasse la taille (fixe, décidée à la compilation du .wasm) du pool de threads
      // du coeur core-mt, pthread_create reste bloqué indéfiniment, sans la moindre erreur ni log
      // (https://github.com/ffmpegwasm/ffmpeg.wasm/issues/772). Sans effet quand FFMPEG_MULTITHREAD_ENABLED
      // est false (coeur mono-thread, ignore silencieusement -threads > 1).
      '-threads', '2', '-i', inName,
      // Plafonné à 720p, pas 1080p (2026-09-16, second retour le même jour : même en 'veryfast', un
      // encodage 1080p prenait encore ~8x la durée réelle de la vidéo) -- réduire le nombre de pixels à
      // encoder reste utile même avec le coeur multi-thread (core-mt) activé depuis, voir
      // loadVideoLibraryFfmpeg ci-dessus (repli sur le coeur mono-thread si la page n'est pas isolée
      // COOP/COEP, ex. Worker Cloudflare désactivé).
      '-vf', "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease",
      // 'ultrafast' plutôt que 'veryfast' : même raisonnement que ci-dessus, la vitesse prime largement
      // sur le taux de compression optimal ici (coût de stockage R2 négligeable, voir
      // decisions/2026-09-16, docs privés) -- le débit est aussi baissé en conséquence (720p n'a pas
      // besoin de 2 Mbps).
      '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-b:v', '1200k', '-maxrate', '1400k', '-bufsize', '2800k',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      'out.mp4',
    ]);
  } finally {
    ffmpeg.off('progress', onFfmpegProgress);
    clearInterval(elapsedTickerId);
  }
  const outData = await ffmpeg.readFile('out.mp4');
  return new Blob([outData.buffer], { type: 'video/mp4' });
}

async function loadMyVideos() {
  const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc('list_my_videos');
  if (error) { log('Échec du chargement de la bibliothèque vidéo : ' + error.message, 'warn'); return { videos: [], interrupted: [], quotaGb: null }; }
  return data || { videos: [], interrupted: [], quotaGb: null };
}
function formatVideoBytes(n) { return n ? (n / (1024 * 1024)).toFixed(1) + ' Mo' : ''; }
function formatVideoDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

async function renderVideoLibrary() {
  const listEl = document.getElementById('videoLibraryList');
  const quotaEl = document.getElementById('videoLibraryQuota');
  if (!listEl) return;
  // Page rechargée sur l'onglet Vidéo (05/11, retour de Jules-Antoine : « mes vidéos ne s'affichent pas ») : l'onglet est rouvert avant que
  // les scripts du serveur (chargés à la demande) soient là -- la liste plantait en silence. On les attend, et toute erreur s'affiche.
  try {
    await loadPostgresReadScripts();
    await renderVideoLibraryNow(listEl, quotaEl);
  } catch (e) {
    console.error('LayerPitch — bibliothèque vidéo :', e);
    listEl.innerHTML = `<div class="video-library-empty">${escapeHtml(tr('videoLibraryLoadFailed', { error: e.message || String(e) }))}</div>`;
  }
}
// Lecture d'une vidéo de la bibliothèque (09/11, demande de Jules-Antoine : « on ne peut pas visionner la vidéo ici ») : la vignette de chaque ligne est
// la première image de la vidéo elle-même (<video preload="metadata">, le navigateur ne charge que le début), un clic ouvre un lecteur dans une fenêtre.
function openLibraryVideoPlayer(v) {
  if (!v) return;
  const overlay = document.getElementById('videoPlayerOverlay');
  const player = document.getElementById('videoPlayerEl');
  if (!overlay || !player) return;
  document.getElementById('videoPlayerTitle').textContent = v.title || v.originalName || v.file;
  player.src = v.base + encodeURIComponent(v.file);
  overlay.style.display = 'flex';
  player.play().catch(() => { /* lecture automatique refusée : les contrôles restent là */ });
}
(function setupLibraryVideoPlayer() {
  const overlay = document.getElementById('videoPlayerOverlay');
  const player = document.getElementById('videoPlayerEl');
  if (!overlay || !player) return;
  const close = () => { player.pause(); player.removeAttribute('src'); player.load(); overlay.style.display = 'none'; };
  document.getElementById('videoPlayerClose').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.style.display === 'flex') close(); });
})();
async function renderVideoLibraryNow(listEl, quotaEl) {
  // interrupted : envois réservés côté serveur mais jamais terminés (27/09, reserve_video_upload) -- comptés dans le
  // quota, supprimables comme une vidéo (le fichier éventuellement arrivé sur R2 est effacé avec).
  const { videos, quotaGb, usedBytes, interrupted = [] } = await loadMyVideos();
  if (!videos.length && !interrupted.length) {
    listEl.innerHTML = `<div class="video-library-empty">${tr('videoLibraryEmpty')}</div>`;
  } else {
    listEl.innerHTML = interrupted.map(v => `
      <div class="video-library-item">
        <div class="video-library-item-main">
          <div class="video-library-item-title">${escapeHtml(v.file)}</div>
          <div class="video-library-item-meta">${[formatVideoBytes(v.sizeBytes), tr('videoLibraryInterrupted')].filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" class="btn btn-small video-library-delete-btn" data-id="${v.id}">${tr('deleteBtn')}</button>
      </div>
    `).join('') + videos.map(v => `
      <div class="video-library-item">
        <button type="button" class="video-library-thumb" data-id="${v.id}" title="${escapeHtml(tr('videoLibraryPlayTitle'))}" aria-label="${escapeHtml(tr('videoLibraryPlayTitle'))}">
          <video muted playsinline preload="metadata" src="${escapeHtml(v.base + encodeURIComponent(v.file))}#t=0.5"></video>
          <span class="video-library-thumb-play" aria-hidden="true">&#9654;</span>
        </button>
        <div class="video-library-item-main">
          <div class="video-library-item-title">${escapeHtml(v.title || v.originalName || v.file)}</div>
          <div class="video-library-item-meta">${[formatVideoBytes(v.sizeBytes), formatVideoDuration(v.durationSeconds), new Date(v.updatedAt).toLocaleDateString()].filter(Boolean).join(' · ')}</div>
        </div>
        <span class="video-library-kind-badge">${v.kind === 'capture_export' ? tr('videoLibraryKindExport') : tr('videoLibraryKindUpload')}</span>
        <button type="button" class="btn btn-small video-library-rename-btn" data-id="${v.id}">${tr('videoLibraryRenameBtn')}</button>
        <button type="button" class="btn btn-small video-library-delete-btn" data-id="${v.id}">${tr('deleteBtn')}</button>
      </div>
    `).join('');
    listEl.querySelectorAll('.video-library-thumb').forEach(btn => {
      btn.addEventListener('click', () => openLibraryVideoPlayer(videos.find(x => x.id === btn.dataset.id)));
    });
    listEl.querySelectorAll('.video-library-rename-btn').forEach(btn => {
      btn.addEventListener('click', () => renameLibraryVideo(btn.dataset.id, videos));
    });
    listEl.querySelectorAll('.video-library-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteLibraryVideo(btn.dataset.id, interrupted.concat(videos)));
    });
  }
  const usedGb = ((usedBytes != null ? usedBytes : videos.reduce((s, v) => s + (v.sizeBytes || 0), 0)) / (1024 * 1024 * 1024)).toFixed(2);
  // quotaGb === 0 : import verrouillé (Free, ou bêta = réservé aux admins, voir
  // 20260923040000_video_upload_admin_only_during_beta.sql) ; null = illimité (admin) ; sinon quota en Go.
  const dropzoneEl = document.getElementById('videoLibraryDropzone');
  const locked = quotaGb === 0;
  if (dropzoneEl) {
    dropzoneEl.classList.toggle('locked', locked);
    dropzoneEl.textContent = tr(locked ? 'videoLibraryLocked' : 'videoLibraryDropHint');
  }
  if (locked) { quotaEl.textContent = ''; return; }
  quotaEl.textContent = quotaGb == null
    ? tr('videoLibraryQuotaUnlimited', { used: usedGb })
    : tr('videoLibraryQuotaHint', { used: usedGb, quota: quotaGb });
  renderVideoHistoryCleanup(quotaGb != null && Number(usedGb) >= quotaGb * 0.9);
}

// Nettoyage des historiques d'exports (21/10, migration 20261021030000) : chaque montage et chaque version garde ses 3 dernières vidéos
// remplacées ; quand le quota approche, un bouton les efface toutes d'un coup (les vidéos affichées et celles placées à la main dans un
// AdReel ne sont jamais touchées).
async function renderVideoHistoryCleanup(nearQuota) {
  const el = document.getElementById('videoLibraryHistory');
  if (!el) return;
  const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc('my_video_history_usage');
  if (error || !data || !data.count) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<span>${escapeHtml(tr(nearQuota ? 'videoHistoryNearQuota' : 'videoHistoryUsage', { n: data.count, size: formatVideoBytes(Number(data.bytes)) }))}</span>
    <button type="button" class="btn btn-small${nearQuota ? ' btn-primary' : ''}" id="btnClearVideoHistory">${escapeHtml(tr('videoHistoryClearBtn'))}</button>`;
  document.getElementById('btnClearVideoHistory').onclick = async () => {
    if (!(await window.LayerPitchNotify.confirm(tr('videoHistoryClearConfirm'), { danger: true }))) return;
    const res = await window.LayerPitchSupabaseClient.getClient().rpc('clear_video_export_history');
    if (res.error) { window.LayerPitchNotify.error(tr('videoLibraryDeleteFailed', { error: res.error.message })); return; }
    ((res.data && res.data.removed) || []).forEach(r => r2DeleteFileLogged(r.path));
    window.LayerPitchNotify.info(tr('videoHistoryCleared', { n: ((res.data && res.data.removed) || []).length }));
    renderVideoLibrary();
  };
}

// Renomme une vidéo de la bibliothèque (6/11) : le nom affiché partout où la vidéo est choisie (liste du Backstage, menu de l'Atelier).
async function renameLibraryVideo(id, knownVideos) {
  const v = (knownVideos || []).find(x => x.id === id);
  const current = v ? (v.title || v.originalName || v.file || '') : '';
  const name = await window.LayerPitchNotify.prompt(tr('videoLibraryRenamePrompt'), { inputValue: current });
  if (name === null || !name.trim() || name.trim() === current) return;
  try {
    const { error } = await window.LayerPitchSupabaseClient.getClient().rpc('rename_video', { p_id: id, p_title: name.trim() });
    if (error) throw error;
    renderVideoLibrary();
  } catch (e) {
    window.LayerPitchNotify.error(tr('videoLibraryRenameFailed', { error: e.message }));
  }
}

// Prises de l'Atelier liées à cette vidéo (09/11, demande de Jules-Antoine : « supprimé de la bibliothèque, pourtant encore dans l'atelier »).
// Une prise (video_captures) se souvient de sa vidéo par le NOM du fichier d'origine (video_filename), et par base_video_id / last_export_video_id
// quand elles viennent d'une version ou d'un export. Supprimer la vidéo ne supprime PAS ces prises : on prévient seulement, jamais d'effacement surprise.
// Toute erreur de lecture -> 0 (on retombe sur la confirmation habituelle, sans bloquer la suppression).
async function countCapturesLinkedToVideo(v) {
  if (!v) return 0;
  try {
    const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc('list_my_video_captures', {});
    if (error) return 0;
    const names = [v.originalName, v.title, v.file].filter(Boolean);
    return (data || []).filter(c => c.baseVideoId === v.id || c.lastExportVideoId === v.id || (c.videoFilename && names.includes(c.videoFilename))).length;
  } catch (e) { return 0; }
}
async function deleteLibraryVideo(id, knownVideos) {
  const v = (knownVideos || []).find(x => x.id === id);
  const linked = await countCapturesLinkedToVideo(v);
  const confirmText = linked > 0 ? tr('videoLibraryDeleteConfirmLinked', { n: linked }) : tr('videoLibraryDeleteConfirm');
  if (!(await window.LayerPitchNotify.confirm(confirmText, { danger: true }))) return;
  try {
    const { error } = await window.LayerPitchSupabaseClient.getClient().rpc('delete_video', { p_id: id });
    if (error) throw error;
    if (v && v.base && v.file) r2DeleteFileLogged(v.base.replace(MEDIA_BASE, '') + v.file);
    renderVideoLibrary();
  } catch (e) {
    window.LayerPitchNotify.error(tr('videoLibraryDeleteFailed', { error: e.message }));
  }
}

// Un seul upload à la fois (16 septembre, retour direct de Jules-Antoine : rien n'empêchait de glisser
// une deuxième vidéo pendant qu'une première compressait -- pas juste troublant, ffmpeg.wasm tourne
// sur une instance UNIQUE partagée (videoLibraryFfmpegSingleton) : deux exec() concurrents écraseraient
// le même fichier virtuel in.mp4/out.mp4 l'un sur l'autre, un vrai bug de résultat silencieusement faux,
// pas seulement un souci d'affichage). videoLibraryUploadBusy gèle la zone de dépôt tant qu'un upload
// n'est pas terminé (succès ou échec) -- voir setupVideoLibraryDropzone ci-dessous pour l'affichage.
let videoLibraryUploadBusy = false;
// Envoi raté après la réservation serveur (27/09) : retire la ligne « envoi en cours » et le fichier s'il est arrivé,
// pour ne pas laisser de place comptée dans le quota. Sans effet si rien n'avait été réservé (quota refusé...).
function discardVideoReservation(id, file) {
  window.LayerPitchSupabaseClient.getClient().rpc('delete_video', { p_id: id })
    .then(({ error }) => { if (error) console.warn('delete_video', error.message); else r2DeleteFileLogged(`video/${id}/${file}`); });
}
async function uploadLibraryVideo(file) {
  const statusEl = document.getElementById('videoLibraryStatus');
  const dropzone = document.getElementById('videoLibraryDropzone');
  const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
  videoLibraryUploadBusy = true;
  if (dropzone) dropzone.classList.add('busy');
  statusEl.classList.add('busy');
  const withName = (msg) => `${file.name} — ${msg}`;
  try {
    // Mode tutoriel : envoi SIMULÉ (ni compression ni envoi au stockage) ; la vidéo apparaît dans la bibliothèque du compte fictif.
    const tuto = isTutoMode();
    statusEl.textContent = withName(tr('videoLibraryCompressing'));
    const duration = await readVideoLibraryDuration(file);
    const blob = tuto ? file : await compressVideoForLibrary(file, (msg) => { statusEl.textContent = withName(msg); });
    statusEl.textContent = withName(tr('videoLibraryUploading'));
    const base = `${MEDIA_BASE}video/${id}/`;
    if (tuto) await new Promise(r => setTimeout(r, 1200));
    else {
      // Avancement de l'envoi : pourcentage + Mo envoyés. Mis à jour au plus 4 fois par seconde (l'événement tombe très souvent).
      let lastShown = 0;
      await r2PutFile(`video/${id}/source.mp4`, blob, 'video/mp4', (done, total) => {
        const now = Date.now();
        if (done < total && now - lastShown < 250) return;
        lastShown = now;
        statusEl.textContent = withName(tr('videoLibraryUploadingProgress', {
          pct: Math.round(done / total * 100), done: (done / 1048576).toFixed(1), total: (total / 1048576).toFixed(1),
        }));
      });
    }
    const { error } = await window.LayerPitchSupabaseClient.getClient().rpc('upsert_video', {
      payload: {
        id, kind: 'upload', title: file.name.replace(/\.[^.]+$/, ''), base, file: 'source.mp4',
        originalName: file.name, mimeType: 'video/mp4', sizeBytes: blob.size, durationSeconds: duration,
      },
    });
    if (error) throw error;
    statusEl.textContent = withName(tr('videoLibraryUploadDone'));
    renderVideoLibrary();
  } catch (e) {
    console.error(e);
    statusEl.textContent = withName(tr('videoLibraryUploadFailed', { error: e.message }));
    discardVideoReservation(id, 'source.mp4');
    renderVideoLibrary();
  } finally {
    videoLibraryUploadBusy = false;
    if (dropzone) dropzone.classList.remove('busy');
    statusEl.classList.remove('busy');
  }
}

(function setupVideoLibraryDropzone() {
  const dropzone = document.getElementById('videoLibraryDropzone');
  const fileInput = document.getElementById('videoLibraryFileInput');
  if (!dropzone || !fileInput) return;
  function handleFile(file) {
    if (videoLibraryUploadBusy || dropzone.classList.contains('locked') || !file || !file.type.startsWith('video/')) return;
    uploadLibraryVideo(file);
  }
  dropzone.addEventListener('click', () => { if (!videoLibraryUploadBusy && !dropzone.classList.contains('locked')) fileInput.click(); });
  fileInput.addEventListener('change', () => { handleFile(fileInput.files[0]); fileInput.value = ''; });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); if (!videoLibraryUploadBusy) dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
  });
})();

// Sous-onglets Bibliothèque/Atelier/Versioning du panneau Vidéo (16 septembre) -- toggle purement local, pas le switchTab() global
// (réservé aux panneaux de premier niveau).
function switchVideoSubtab(name) {
  document.querySelectorAll('#panelVideoLibrary .video-subpanel').forEach(p => p.classList.toggle('active', p.dataset.videoSubpanel === name));
  document.querySelectorAll('#panelVideoLibrary [data-video-subtab]').forEach(b => b.classList.toggle('active', b.dataset.videoSubtab === name));
  if (name === 'capture') { ensureVideoAtelierLoaded(); refreshAtelierUnsavedNote(); }
  if (name === 'versioning') renderVideoVersioningList();
}
document.querySelectorAll('#panelVideoLibrary [data-video-subtab]').forEach(btn => {
  btn.addEventListener('click', () => switchVideoSubtab(btn.dataset.videoSubtab));
});

// Atelier vidéo (21/10, décidé par Jules-Antoine) : l'outil de capture et de Versioning vit ici, dans un cadre (atelier.html : son code
// est celui qui était sur la page du pack, déplacé, jamais recopié dans le Backstage). Le choix du pack se fait dans l'atelier.
// Mode tutoriel : l'atelier aussi (?tuto&lesson=…), pour que la leçon Versioning s'y poursuive avec le faux serveur.
function videoAtelierUrl(opts) {
  const o = opts || {};
  const q = new URLSearchParams({ lang: currentLang() });
  if (o.packId) q.set('id', o.packId);
  if (o.montageId) q.set('montage', o.montageId);
  if (isTutoMode()) { q.set('tuto', ''); const lesson = new URLSearchParams(location.search).get('lesson'); if (lesson) q.set('lesson', lesson); }
  return './atelier.html?' + q.toString().replace(/tuto=(&|$)/, 'tuto$1');
}
function ensureVideoAtelierLoaded() {
  const frame = document.getElementById('videoAtelierFrame');
  if (frame && !frame.getAttribute('src')) frame.src = videoAtelierUrl();
}
// 04/11 : l'atelier ne lit que ce qui est en base. Ligne d'avertissement tant qu'il reste des changements non sauvegardés (un pack tout
// juste créé n'y apparaît qu'après « Sauvegarder / publier ») ; revérifiée après chaque clic ou saisie (toute modification en passe par
// là), rien à brancher sur chaque modification. Pas de minuterie : elle empêchait les tests (Node) de se terminer.
function refreshAtelierUnsavedNote() {
  const note = document.getElementById('videoAtelierUnsavedNote');
  if (!note) return;
  const show = !!hasUnsavedEdits && !isTutoMode();
  if (note.hidden === show) note.hidden = !show;
}
['click', 'input', 'change', 'keyup'].forEach(type => document.addEventListener(type, () => setTimeout(refreshAtelierUnsavedNote, 0)));
// Après une sauvegarde réussie : l'atelier (s'il est déjà ouvert) remet à jour sa liste de packs, sans recharger un montage en cours.
function notifyAtelierPacksChanged() {
  refreshAtelierUnsavedNote();
  const frame = document.getElementById('videoAtelierFrame');
  if (!frame || !frame.getAttribute('src') || !frame.contentWindow) return;
  try { frame.contentWindow.postMessage({ source: 'lp-backstage', type: 'packsChanged' }, location.origin); } catch (e) { /* cadre pas encore prêt : il lira la base à son ouverture */ }
}
// Atelier en plein écran (05/11, demande de Jules-Antoine : « trop petit, ingérable ») : le cadre couvre toute la fenêtre, le bouton reste
// en haut à droite pour revenir (ou Échap). Pas l'API plein écran du navigateur : les bulles du tutoriel doivent rester visibles.
function setVideoAtelierFull(on) {
  document.body.classList.toggle('video-atelier-full', on);
  const btn = document.getElementById('videoAtelierFullBtn');
  if (btn) btn.textContent = tr(on ? 'videoAtelierFullExit' : 'videoAtelierFull');
  const frame = document.getElementById('videoAtelierFrame');
  try { if (frame && frame.contentWindow) frame.contentWindow.postMessage({ source: 'lp-backstage', type: 'fullState', on: !!on }, location.origin); } catch (e) { /* cadre pas prêt */ }
}
// Le bouton « Plein écran » de l'atelier (dans le cadre) passe par ici : ainsi la barre du Backstage reste visible (07/11).
window.addEventListener('message', e => {
  const frame = document.getElementById('videoAtelierFrame');
  if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow || !e.data || e.data.source !== 'lp-atelier') return;
  if (e.data.type === 'toggleFull' || e.data.type === 'setFull') {
    const on = e.data.type === 'toggleFull' ? !document.body.classList.contains('video-atelier-full') : !!e.data.on;
    setVideoAtelierFull(on);
  }
});
(function wireVideoAtelierFull() {
  const btn = document.getElementById('videoAtelierFullBtn');
  if (btn) btn.addEventListener('click', () => setVideoAtelierFull(!document.body.classList.contains('video-atelier-full')));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('video-atelier-full')) setVideoAtelierFull(false); });
})();
// Ouvre l'atelier (onglet Vidéo → Atelier), sur un pack et un montage s'ils sont donnés (Versioning, bloc vidéo d'un AdReel).
function openVideoAtelier(opts) {
  openTab('videoLibrary');
  switchVideoSubtab('capture');
  const frame = document.getElementById('videoAtelierFrame');
  if (frame && opts && (opts.packId || opts.montageId)) frame.src = videoAtelierUrl(opts);
  else ensureVideoAtelierLoaded();
  if (frame && frame.scrollIntoView) frame.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// « Terminer le montage » (06/11) : étape de « Sauvegarder / publier » (voir publishAll), juste avant les AdReels qui affichent les montages.
// Demande à l'atelier (s'il est ouvert dans son cadre) de publier le montage retouché : son + étiquettes. Réponses : 'none' (rien à publier,
// pas d'atelier, ou atelier qui ne répond pas dans les 4 s : ancienne version en cache), 'done' ; un échec lève une erreur avec la raison.
function finishAtelierMontage() {
  const frame = document.getElementById('videoAtelierFrame');
  if (!frame || !frame.getAttribute('src') || !frame.contentWindow) return Promise.resolve('none');
  const id = Date.now() + '-' + Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    let ackTimer = 0, longTimer = 0;
    const finish = fn => { clearTimeout(ackTimer); clearTimeout(longTimer); window.removeEventListener('message', onMsg); fn(); };
    function onMsg(e) {
      if (e.origin !== location.origin || !e.data || e.data.source !== 'lp-atelier' || e.data.id !== id) return;
      if (e.data.type === 'finishMontageAck') { clearTimeout(ackTimer); return; }
      if (e.data.type !== 'finishMontageResult') return;
      if (e.data.status === 'error') finish(() => reject(new Error(e.data.message || 'erreur inconnue')));
      else finish(() => resolve(e.data.status === 'done' ? 'done' : 'none'));
    }
    window.addEventListener('message', onMsg);
    ackTimer = setTimeout(() => finish(() => resolve('none')), 4000);
    longTimer = setTimeout(() => finish(() => reject(new Error(tr('montageFinishTimeout')))), 15 * 60 * 1000);
    try { frame.contentWindow.postMessage({ source: 'lp-backstage', type: 'finishMontage', id }, location.origin); }
    catch (err) { finish(() => resolve('none')); }
  });
}
// Messages de l'atelier (même origine seulement) : fin de sa partie de la leçon Versioning -> le Backstage reprend la main.
window.addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.source !== 'lp-atelier') return;
  if (e.data.type === 'lessonDone' && typeof onAtelierLessonDone === 'function') onAtelierLessonDone();
  // Bulles de l'atelier à l'écran : la bulle du Backstage (« Dans l'atelier ») se cache, pour n'en avoir qu'une à la fois (05/11).
  if (e.data.type === 'lessonOpen') document.body.classList.add('lp-atelier-lesson-open');
  if (e.data.type === 'lessonClose' || e.data.type === 'lessonDone') document.body.classList.remove('lp-atelier-lesson-open');
  if (e.data.type === 'lessonDone') setVideoAtelierFull(false); // fin de la partie atelier : retour au Backstage, pour sa dernière bulle
  // Enregistrement dans l'atelier : listes à jour (index des montages des blocs vidéo, bibliothèque, Versioning).
  if (e.data.type === 'changed') {
    videoVersioningIndexPromise = null;
    const sub = document.querySelector('#panelVideoLibrary .video-subpanel.active');
    if (sub && sub.dataset.videoSubpanel === 'versioning') renderVideoVersioningList();
    else renderVideoLibrary();
  }
});

// Versioning depuis le bloc vidéo d'un AdReel (21/10) : index « vidéo de la bibliothèque -> montage d'origine et versions sœurs », lu une fois
// (les RPC sont celles du sous-onglet Versioning). Une vidéo issue d'une version vidéo (last_export_video_id) retrouve son montage et les autres
// versions rendues du même montage ; une vidéo envoyée à la main n'a pas de montage, rien ne s'affiche pour elle. Palier « enregistré »
// (comme la liste du sous-onglet). Choisir une version = choisir une autre vidéo de la bibliothèque (rien de plus dans l'AdReel).
let videoVersioningIndexPromise = null;
function loadVideoVersioningIndex(force) {
  if (videoVersioningIndexPromise && !force) return videoVersioningIndexPromise;
  const empty = { byVideoId: {}, captures: [], available: false };
  videoVersioningIndexPromise = (async () => {
    if (entitlementLevel('versioning') !== 'saved') return empty;
    const client = window.LayerPitchSupabaseClient.getClient();
    const res = await client.rpc('list_my_video_captures', { p_pack_id: null });
    if (res.error) return empty;
    const out = { byVideoId: {}, captures: [], available: true };
    await Promise.all((res.data || []).map(async c => {
      const r = await client.rpc('list_video_capture_versions', { p_capture_id: c.id });
      if (r.error) return;
      // Le montage lui-même (sa musique d'origine, s'il a été déposé dans la bibliothèque : migration 20261021010000), puis ses versions.
      const siblings = (c.lastExportVideoId ? [{ key: 'original', versionId: null, title: tr('videoBlockVersionOriginal'), videoId: c.lastExportVideoId }] : [])
        .concat((r.data || []).filter(v => v.lastExportVideoId).map(v => ({ key: v.id, versionId: v.id, title: v.title || '', videoId: v.lastExportVideoId })));
      out.captures.push({ capture: c, siblings }); // liste des montages (menu « Un de mes montages » du bloc vidéo)
      siblings.forEach(sib => { out.byVideoId[sib.videoId] = { capture: c, siblings }; });
      if (c.baseVideoId) out.byVideoId[c.baseVideoId] = { capture: c, siblings }; // la vidéo muette du montage (migration 20261021040000) mène aussi au montage
    }));
    return out;
  })().catch(() => empty);
  return videoVersioningIndexPromise;
}
// Champs « montage » d'une vidéo de bloc (21/10) : le lecteur public propose alors toutes les versions du montage (menu) avec une
// étiquette « ce qui joue », lues en direct ; defaultVersion = 'original' (musique d'origine) ou l'identifiant d'une version vidéo ;
// hiddenVersions = versions à ne pas proposer à cet endroit. Vides pour une vidéo qui ne vient pas d'un montage.
function videoMontageFields(v) {
  return v && v.source === 'library' && v.montageId
    ? { montageId: v.montageId, defaultVersion: v.defaultVersion || 'original', hiddenVersions: Array.isArray(v.hiddenVersions) ? v.hiddenVersions.slice() : [] }
    : { montageId: null, defaultVersion: null, hiddenVersions: [] };
}
async function renderVideoVersioningList() {
  const listEl = document.getElementById('videoVersioningList');
  if (!listEl) return;
  // 28/09 : liste des versions ENREGISTRÉES = palier Boss (versioning 'saved') ; Warrior versionne pendant la session, dans le pack.
  if (entitlementLevel('versioning') !== 'saved') { listEl.innerHTML = `<div class="video-library-empty">${escapeHtml(tr(flagOpen('versioning') ? 'videoVersioningTierOnly' : 'videoVersioningAdminOnly'))}</div>`; return; }
  listEl.innerHTML = `<div class="video-library-empty">${escapeHtml(tr('videoVersioningLoading'))}</div>`;
  const client = window.LayerPitchSupabaseClient.getClient();
  let captures = [], videos = [];
  try {
    const res = await client.rpc('list_my_video_captures', { p_pack_id: null });
    if (res.error) throw res.error;
    captures = res.data || [];
    videos = (await loadMyVideos()).videos || [];
  } catch (e) {
    listEl.innerHTML = `<div class="video-library-empty">${escapeHtml(tr('videoVersioningLoadFailed').replace('{error}', e.message))}</div>`;
    return;
  }
  if (!captures.length) { listEl.innerHTML = `<div class="video-library-empty">${escapeHtml(tr('videoVersioningEmpty'))}</div>`; return; }
  // Versions de chaque montage (une lecture par montage, en parallèle).
  const versionsByCapture = {};
  await Promise.all(captures.map(async c => {
    const r = await client.rpc('list_video_capture_versions', { p_capture_id: c.id });
    versionsByCapture[c.id] = r.error ? null : (r.data || []);
  }));
  const videoIds = new Set(videos.map(v => v.id));
  listEl.innerHTML = captures.map(c => {
    const pack = packs.find(p => p.id === c.packId);
    const vs = versionsByCapture[c.id];
    const meta = [pack ? (pack.title || tr('defaultPackTitle')) : tr('videoVersioningPackMissing'), c.videoFilename ? tr('videoVersioningVideo').replace('{video}', c.videoFilename) : '', new Date(c.updatedAt).toLocaleDateString()].filter(Boolean).join(' · ');
    const chips = vs === null ? `<span class="video-versioning-chip">${escapeHtml(tr('videoVersioningVersionsUnavailable'))}</span>`
      : vs.length ? vs.map(v => { const st = ['draft', 'sent', 'changes_requested', 'approved'].includes(v.status) ? v.status : 'draft'; const exp = v.lastExportVideoId && videoIds.has(v.lastExportVideoId); return `<span class="video-versioning-chip st-${st} ${exp ? 'exported' : ''}" title="${escapeHtml([tr('versioningStatus_' + st), exp ? tr('videoVersioningExported') : ''].filter(Boolean).join(' · '))}">${escapeHtml(v.title || tr('videoVersioningUntitled'))}${st === 'draft' ? '' : ' · ' + escapeHtml(tr('versioningStatus_' + st))}</span>`; }).join('')
      : `<span class="video-versioning-chip">${escapeHtml(tr('videoVersioningNoVersion'))}</span>`;
    return `
      <div class="video-library-item">
        <div class="video-library-item-main">
          <div class="video-capture-pack-row-title">${escapeHtml(c.title || (c.videoFilename || '').replace(/\.[^.]+$/, '') || tr('videoVersioningUntitled'))}</div>
          <div class="video-library-item-meta">${escapeHtml(meta)}</div>
          <div class="video-versioning-versions">${chips}</div>
        </div>
        <button class="btn btn-small" type="button" data-atelier-pack="${escapeHtml(c.packId)}" data-atelier-montage="${escapeHtml(c.id)}">${escapeHtml(tr('videoVersioningOpenBtn'))}</button>
      </div>`;
  }).join('');
  listEl.querySelectorAll('[data-atelier-montage]').forEach(b => b.addEventListener('click', () => openVideoAtelier({ packId: b.dataset.atelierPack, montageId: b.dataset.atelierMontage })));
}

// Construit la liste des clés R2 (audio/<trackId>/<fichier>) de tous les fichiers déjà publiés
// (remoteFile non nul -- un pendingFile jamais uploadé n'existe pas sur R2, rien à supprimer) d'un
// morceau, sur tous ses points de stockage possibles (mêmes parcours que la boucle de publication
// ci-dessous, pour rester exhaustif si de nouveaux points de stockage apparaissent).
function trackRemoteFileKeys(track) {
  const keys = [];
  const collect = obj => { if (obj && obj.remoteFile) keys.push(`audio/${track.id}/${obj.remoteFile}`); };
  (track.layers || []).forEach(collect);
  collect(track.intro);
  collect(track.outro);
  (track.segmentSlots || []).forEach(slot => {
    (slot.alternatives || []).forEach(collect);
    (slot.nextOptions || []).forEach(opt => collect(opt.transition));
  });
  (track.sections || []).forEach(section => {
    (section.pools || []).forEach(pool => (pool.alternatives || []).forEach(collect));
    collect(section.transition);
    (section.branches || []).forEach(b => collect(b.transition));
  });
  (track.loops || []).forEach(loop => { collect(loop); collect(loop.transition); });
  return keys;
}
// Même principe que trackRemoteFileKeys mais pour un Sfx (audio/sfx-<sfxId>/<fichier>).
function sfxRemoteFileKeys(sfx) {
  return (sfx.alternatives || []).filter(a => a.remoteFile).map(a => `audio/sfx-${sfx.id}/${a.remoteFile}`);
}

