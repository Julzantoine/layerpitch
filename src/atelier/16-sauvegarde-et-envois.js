// --- Sauvegarde côté serveur (2026-09-16) --------------------------------------------------------
// Décidé le 16 septembre : Jules-Antoine a explicitement écarté le JSON à télécharger/réimporter (trop
// de friction) au profit d'une sauvegarde hébergée dans le Backstage -- voir supabase/migrations/
// 20260916010000_video_captures.sql et decisions/2026-09-15-capture-tiers-sauvegarde.md (docs privés).
// La vidéo importée elle-même n'est PAS envoyée au serveur (choix délibéré, voir la migration) : seul
// son nom est conservé pour que le compositeur s'y retrouve, il doit réimporter le même fichier local
// à chaque reprise. Gating réel côté serveur (is_admin(), palier Boss pas encore implémenté) -- ces
// fonctions ne font que relayer l'appel, aucune vérification client à dupliquer ici.
// Le bouton "Télécharger le JSON" (v1 de la fonctionnalité, avant la sauvegarde serveur) a été retiré
// le 16 septembre : un export JSON en libre accès contournerait entièrement le futur gating par palier
// (Rookie/Warrior sans persistance, Boss avec) -- n'importe qui pourrait "sauvegarder" gratuitement en
// téléchargeant le fichier, rendant le futur verrou Boss sans objet. Toute persistance doit passer par
// ces RPC, jamais par un fichier que le client peut simplement garder.
// Montages d'un STUDIO (21/10, migration 20261021060000) : un compte studio (window.__lpStudioBuyer) enregistre ses montages, versions,
// sons et vidéos muettes AU NOM DU STUDIO -- tout membre de l'équipe les retouche, ils restent au studio, quota du studio. Chaque appel
// aux fonctions vidéo porte alors p_studio (et asStudio pour les envois de fichiers).
const videoAsStudio = () => !!window.__lpStudioBuyer;
const withStudio = args => (videoAsStudio() ? Object.assign({}, args, { p_studio: true }) : args);
async function saveVideoCapture(packId, id, title, videoFilename, events, laneOverrides, collapsedGroups) {
  const client = window.LayerPitchSupabaseClient.getClient();
  const { data, error } = await client.rpc('save_video_capture', withStudio({
    p_id: id, p_pack_id: packId, p_title: title || '', p_video_filename: videoFilename || null,
    p_events: events, p_lane_overrides: laneOverrides, p_collapsed_groups: collapsedGroups,
  }));
  if (error) throw error;
  return data;
}
async function listVideoCaptures(packId) {
  const client = window.LayerPitchSupabaseClient.getClient();
  const { data, error } = await client.rpc('list_my_video_captures', withStudio({ p_pack_id: packId }));
  if (error) throw error;
  return data || [];
}
async function loadVideoCapture(id) {
  const client = window.LayerPitchSupabaseClient.getClient();
  const { data, error } = await client.rpc('get_video_capture', withStudio({ p_id: id }));
  if (error) throw error;
  return data;
}

// --- Export vidéo (ffmpeg.wasm) ---------------------------------------------------------------
// Même logique que video-engine-prototype/render-from-capture.js (validée côté Node avec de vrais
// morceaux), portée ici pour tourner directement dans le navigateur -- fichiers servis en local
// (vendor/ffmpeg/) plutôt que depuis un CDN : le Worker que la librairie construit en interne doit
// être de même origine que la page, un CDN cross-origin le fait échouer silencieusement (SecurityError).
// Coeur multi-thread DÉFINITIVEMENT désactivé -- voir le même flag dans layerpitch-backstage.html pour
// le détail : plusieurs tentatives le 16 septembre (dont -threads 2 pour éviter le deadlock connu,
// https://github.com/ffmpegwasm/ffmpeg.wasm/issues/772), aucune n'a résolu le blocage. Ne pas repasser
// à true sans une piste nouvelle et vérifiable.
const FFMPEG_MULTITHREAD_ENABLED = false;
let ffmpegSingleton = null;
async function loadFfmpegWasm(onProgress) {
  if (ffmpegSingleton) return ffmpegSingleton;
  onProgress && onProgress(tr('captureFfmpegLoading'));
  const { FFmpeg } = await import('./vendor/ffmpeg/ffmpeg/index.js');
  const ffmpeg = new FFmpeg();
  // Coeur multi-thread (vendor/ffmpeg/core-mt/) uniquement si la page est servie avec les en-têtes
  // d'isolation (window.crossOriginIsolated) -- le Worker Cloudflare mis en place le 16 septembre ne
  // les envoie que pour pack.html?capture=1, jamais pour une visite normale d'un pack. Repli
  // silencieux sur le coeur mono-thread existant sinon.
  const useMultiThread = FFMPEG_MULTITHREAD_ENABLED && typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated;
  const coreDir = useMultiThread ? 'core-mt' : 'core';
  await ffmpeg.load({
    coreURL: new URL(`./vendor/ffmpeg/${coreDir}/ffmpeg-core.js`, location.href).href,
    wasmURL: new URL(`./vendor/ffmpeg/${coreDir}/ffmpeg-core.wasm`, location.href).href,
  });
  ffmpegSingleton = ffmpeg;
  return ffmpeg;
}

function findCaptureTrack(trackId) { return (window.__lpCaptureLibrary.library || []).find(t => t.id === trackId); }
function findCaptureSfx(sfxId) { return (window.__lpCaptureLibrary.sfxLibrary || []).find(s => s.id === sfxId); }

async function fetchAsUint8Array(url) {
  const res = await window.LayerPlayerCore.fetchAudio(url); // audio des morceaux protégés : lien signé (player.js)
  if (!res.ok) throw new Error(tr('captureFetchError').replace('{url}', url));
  return new Uint8Array(await res.arrayBuffer());
}

// --- Bibliothèque vidéo (2026-09-16) -- déposer un export du moteur de capture dans composer_videos,
// voir supabase/migrations/20260916020000_composer_videos.sql et 20260916040000_open_capture_video_to_
// composers.sql. Même mécanisme d'URL R2 pré-signée que layerpitch-backstage.html (create-media-signed-
// url), jamais utilisé jusqu'ici dans pack.html -- dupliqué ici plutôt que partagé entre les deux
// fichiers (aucun module commun entre eux, même raisonnement que trackPublicEvent()).
const MEDIA_BASE = 'https://media.layerpitch.com/';
// size : taille exacte d'un envoi (PUT), vérifiée et verrouillée par le serveur avec le type de fichier (27/09).
// Envois vidéo AU NOM D'UN STUDIO : prêts seulement quand la fonction create-media-signed-url (asStudio, 21/10) est redéployée.
// D'ici là, bloqués ici (seul point de passage des envois) : sinon l'ancienne fonction créerait un profil compositeur au compte studio.
// Passer à true une fois le redéploiement fait.
window.__lpStudioVideoUploadsReady = false;
async function r2SignedUrl(path, method, size) {
  if (window.__lpStudioBuyer && path.startsWith('video/') && !window.__lpStudioVideoUploadsReady) throw new Error(tr('captureStudioUploadSoon'));
  const { data, error } = await window.LayerPitchSupabaseClient.getClient()
    .functions.invoke('create-media-signed-url', { body: window.__lpStudioBuyer && path.startsWith('video/') ? { path, method, size, asStudio: true } : { path, method, size } }); // vidéo d'un studio : à son nom
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
// Vidéo muette d'un montage (21/10) : l'image d'origine recopiée sans son (-an, -c:v copy : aucun réencodage, quelques secondes).
async function makeSilentVideo(videoFile, onProgress) {
  const ffmpeg = await loadFfmpegWasm(onProgress);
  const ext = videoFile.name.slice(videoFile.name.lastIndexOf('.')) || '.mp4';
  await ffmpeg.writeFile('src' + ext, new Uint8Array(await videoFile.arrayBuffer()));
  const code = await ffmpeg.exec(['-i', 'src' + ext, '-an', '-c:v', 'copy', 'base.mp4']);
  if (code !== 0) throw new Error('ffmpeg (vidéo muette) a échoué');
  const out = await ffmpeg.readFile('base.mp4');
  return new Blob([out.buffer], { type: 'video/mp4' });
}
// Son d'une version (21/10) : le WAV rendu par le moteur du lecteur, compressé en AAC dans un conteneur .mp4 (léger, lu partout).
async function encodeSoundForLibrary(wavBlob, onProgress) {
  const ffmpeg = await loadFfmpegWasm(onProgress);
  await ffmpeg.writeFile('mix.wav', new Uint8Array(await wavBlob.arrayBuffer()));
  const code = await ffmpeg.exec(['-i', 'mix.wav', '-vn', '-c:a', 'aac', '-b:a', '160k', 'sound.mp4']);
  if (code !== 0) throw new Error('ffmpeg (son) a échoué');
  const out = await ffmpeg.readFile('sound.mp4');
  return new Blob([out.buffer], { type: 'video/mp4' });
}
// Efface du stockage les fichiers des vidéos retirées de la bibliothèque par l'historique des exports (21/10, migration 20261021030000) :
// le serveur rend leurs chemins, la page les efface (même URL signée que la bibliothèque du Backstage). Jamais bloquant.
async function r2DeleteRemovedVideos(removed) {
  for (const r of (removed || [])) {
    try {
      const data = await r2SignedUrl(r.path, 'DELETE');
      if (data && data.url && !data.kept) await fetch(data.url, { method: 'DELETE' });
    } catch (e) { console.warn('Effacement du fichier ' + r.path + ' :', e.message || e); }
  }
}
// Envoie un export terminé (Blob mp4) dans la bibliothèque vidéo du compositeur -- kind:'capture_export'
// pour le distinguer d'un simple import (voir composer_videos.kind), pack_id relie l'export à CE pack.
// Pas de recompression ffmpeg ici (contrairement à un import dans le Backstage) : le fichier sort déjà
// de exportCaptureVideo en H.264, faire subir une deuxième passe ffmpeg.wasm juste après l'export
// initial (déjà long) serait une attente supplémentaire dont le gain resterait marginal.
// kind (21/10) : 'capture_export' (vidéo complète, par défaut), 'capture_base' (vidéo muette d'un montage) ou 'capture_audio' (son seul
// d'une version, dans un conteneur .mp4) -- voir la migration 20261021040000.
async function saveExportToVideoLibrary(blob, packId, title, durationSeconds, kind) {
  const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
  const base = `${MEDIA_BASE}video/${id}/`;
  let uploaded = false;
  try {
    const fileName = kind === 'capture_audio' ? 'audio.mp4' : (kind === 'capture_base' ? 'base.mp4' : 'export.mp4');
    await r2PutFile(`video/${id}/${fileName}`, new Uint8Array(await blob.arrayBuffer()), 'video/mp4');
    uploaded = true;
    const { error } = await window.LayerPitchSupabaseClient.getClient().rpc('upsert_video', {
      payload: {
        id, kind: kind || 'capture_export', packId, title: title || '', base, file: fileName, asStudio: videoAsStudio(),
        mimeType: 'video/mp4', sizeBytes: blob.size, durationSeconds: durationSeconds || null,
      },
    });
    if (error) throw error;
  } catch (e) {
    // Envoi raté après la réservation serveur (27/09, reserve_video_upload) : si le fichier n'est pas arrivé, la ligne
    // « envoi en cours » est retirée (sans effet si rien n'avait été réservé). S'il est arrivé, elle reste : comptée
    // dans le quota et supprimable depuis la bibliothèque du Backstage, qui efface aussi le fichier.
    if (!uploaded) window.LayerPitchSupabaseClient.getClient().rpc('delete_video', withStudio({ p_id: id })).then(() => {}, () => {});
    throw e;
  }
  return id;
}

