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
async function r2PutFile(key, bytes, contentType) {
  const { url, headers } = await r2SignedUrl(key, 'PUT', bytes.byteLength);
  // En-têtes imposés et signés par le serveur (type, et pour un SVG Content-Disposition) : renvoyés tels quels, sinon
  // R2 refuse l'envoi. contentType ne sert plus que si le serveur n'en renvoie pas (ancienne version).
  const res = await fetch(url, { method: 'PUT', headers: headers || { 'content-type': contentType }, body: bytes });
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
async function compressVideoForLibrary(file, onProgress) {
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
        <div class="video-library-item-main">
          <div class="video-library-item-title">${escapeHtml(v.title || v.originalName || v.file)}</div>
          <div class="video-library-item-meta">${[formatVideoBytes(v.sizeBytes), formatVideoDuration(v.durationSeconds), new Date(v.updatedAt).toLocaleDateString()].filter(Boolean).join(' · ')}</div>
        </div>
        <span class="video-library-kind-badge">${v.kind === 'capture_export' ? tr('videoLibraryKindExport') : tr('videoLibraryKindUpload')}</span>
        <button type="button" class="btn btn-small video-library-delete-btn" data-id="${v.id}">${tr('deleteBtn')}</button>
      </div>
    `).join('');
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
}

async function deleteLibraryVideo(id, knownVideos) {
  if (!(await window.LayerPitchNotify.confirm(tr('videoLibraryDeleteConfirm'), { danger: true }))) return;
  const v = (knownVideos || []).find(x => x.id === id);
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
    statusEl.textContent = withName(tr('videoLibraryCompressing'));
    const duration = await readVideoLibraryDuration(file);
    const blob = await compressVideoForLibrary(file, (msg) => { statusEl.textContent = withName(msg); });
    statusEl.textContent = withName(tr('videoLibraryUploading'));
    const base = `${MEDIA_BASE}video/${id}/`;
    await r2PutFile(`video/${id}/source.mp4`, new Uint8Array(await blob.arrayBuffer()), 'video/mp4');
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

// Sous-onglets Bibliothèque/Capture du panneau Vidéo (16 septembre) -- toggle purement local, pas le
// switchTab() global (réservé aux panneaux de premier niveau). Le sous-onglet Capture ne réimplémente
// pas le moteur de capture ici : il liste les packs du compositeur et ouvre la page en direct du pack
// choisi (pack.html?...&capture=1), dialogue de capture pré-ouvert -- voir setupCaptureTrigger dans
// pack.html, élargi le même jour de is_admin() uniquement à "admin OU propriétaire du pack".
function switchVideoSubtab(name) {
  document.querySelectorAll('#panelVideoLibrary .video-subpanel').forEach(p => p.classList.toggle('active', p.dataset.videoSubpanel === name));
  document.querySelectorAll('#panelVideoLibrary [data-video-subtab]').forEach(b => b.classList.toggle('active', b.dataset.videoSubtab === name));
  if (name === 'capture') renderVideoCapturePacksList();
  if (name === 'versioning') renderVideoVersioningList();
}
document.querySelectorAll('#panelVideoLibrary [data-video-subtab]').forEach(btn => {
  btn.addEventListener('click', () => switchVideoSubtab(btn.dataset.videoSubtab));
});
function renderVideoCapturePacksList() {
  const listEl = document.getElementById('videoCapturePacksList');
  if (!listEl) return;
  if (!packs.length) {
    listEl.innerHTML = `<div class="video-library-empty">${tr('videoCaptureNoPacks')}</div>`;
    return;
  }
  listEl.innerHTML = packs.map(p => {
    const enabled = !!p.videoTestModeEnabled;
    const url = `./pack.html?id=${encodeURIComponent(p.id)}&lang=${encodeURIComponent(currentLang())}&capture=1`;
    return `
      <div class="video-library-item">
        <div class="video-library-item-main">
          <div class="video-capture-pack-row-title">${escapeHtml(p.title || tr('defaultPackTitle'))}</div>
          ${enabled ? '' : `<div class="video-capture-pack-row-hint">${escapeHtml(tr('videoCaptureNeedsTestMode'))}</div>`}
        </div>
        ${enabled
          ? `<a class="btn btn-small" href="${url}" target="_blank" rel="noopener">${tr('videoCaptureOpenBtn')}</a>`
          : `<span class="btn btn-small" style="opacity:.4;pointer-events:none;">${tr('videoCaptureOpenBtn')}</span>`}
      </div>
    `;
  }).join('');
}

async function renderVideoVersioningList() {
  const listEl = document.getElementById('videoVersioningList');
  if (!listEl) return;
  if (!currentUserIsAdmin) { listEl.innerHTML = `<div class="video-library-empty">${escapeHtml(tr('videoVersioningAdminOnly'))}</div>`; return; }
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
    const enabled = !!(pack && pack.videoTestModeEnabled);
    const url = `./pack.html?id=${encodeURIComponent(c.packId)}&lang=${encodeURIComponent(currentLang())}&capture=1&montage=${encodeURIComponent(c.id)}`;
    const vs = versionsByCapture[c.id];
    const meta = [pack ? (pack.title || tr('defaultPackTitle')) : tr('videoVersioningPackMissing'), c.videoFilename ? tr('videoVersioningVideo').replace('{video}', c.videoFilename) : '', new Date(c.updatedAt).toLocaleDateString()].filter(Boolean).join(' · ');
    const chips = vs === null ? `<span class="video-versioning-chip">${escapeHtml(tr('videoVersioningVersionsUnavailable'))}</span>`
      : vs.length ? vs.map(v => `<span class="video-versioning-chip ${v.lastExportVideoId && videoIds.has(v.lastExportVideoId) ? 'exported' : ''}" title="${escapeHtml(v.lastExportVideoId && videoIds.has(v.lastExportVideoId) ? tr('videoVersioningExported') : '')}">${escapeHtml(v.title || tr('videoVersioningUntitled'))}</span>`).join('')
      : `<span class="video-versioning-chip">${escapeHtml(tr('videoVersioningNoVersion'))}</span>`;
    return `
      <div class="video-library-item">
        <div class="video-library-item-main">
          <div class="video-capture-pack-row-title">${escapeHtml(c.title || tr('videoVersioningUntitled'))}</div>
          <div class="video-library-item-meta">${escapeHtml(meta)}</div>
          ${enabled ? '' : `<div class="video-capture-pack-row-hint">${escapeHtml(tr('videoCaptureNeedsTestMode'))}</div>`}
          <div class="video-versioning-versions">${chips}</div>
        </div>
        ${enabled
          ? `<a class="btn btn-small" href="${url}" target="_blank" rel="noopener">${escapeHtml(tr('videoVersioningOpenBtn'))}</a>`
          : `<span class="btn btn-small" style="opacity:.4;pointer-events:none;">${escapeHtml(tr('videoVersioningOpenBtn'))}</span>`}
      </div>`;
  }).join('');
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
  });
  (track.loops || []).forEach(loop => { collect(loop); collect(loop.transition); });
  return keys;
}
// Même principe que trackRemoteFileKeys mais pour un Sfx (audio/sfx-<sfxId>/<fichier>).
function sfxRemoteFileKeys(sfx) {
  return (sfx.alternatives || []).filter(a => a.remoteFile).map(a => `audio/sfx-${sfx.id}/${a.remoteFile}`);
}

