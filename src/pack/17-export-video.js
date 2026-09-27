// Reprend exactement la logique de conversion de render-from-capture.js (mode "vertical" -- calques en
// parallèle -- + stingers). Les embranchements/séquentiel ne sont pas encore gérés ici non plus.
async function exportCaptureVideo(events, videoFile, onProgress, laneOverrides, exportOptions) {
  onProgress = onProgress || (() => {});
  laneOverrides = laneOverrides || {};
  // Filigrane + crédit compositeur (2026-09-16, decisions/2026-09-16-capture-watermark-composer-credit.md,
  // docs privés) : `tier` reste un réglage manuel du panneau tant que Rookie/Warrior/Boss n'existe nulle
  // part ailleurs dans le produit -- une fois ce palier réel, remplacer par le vrai palier du compositeur
  // qui capture. `showComposerCredit` reste coché par défaut côté UI (voir openCapturePanel) : sans
  // vérification d'achat automatisée, mieux vaut créditer par défaut que l'omettre par erreur.
  exportOptions = exportOptions || {};
  const exportTier = exportOptions.tier || 'boss';
  const showWatermark = exportTier !== 'boss';
  const showComposerCredit = exportOptions.showComposerCredit !== false;
  const composerName = (window.__lpCaptureLibrary && window.__lpCaptureLibrary.composerName) || '';
  // Modes d'export (23/09). 'video' : l'export complet (image ré-encodée + incrustations -- long, ffmpeg.wasm
  // n'utilise qu'un seul coeur). 'audio' : seulement le son, rendu par le moteur du lecteur, en fichier WAV --
  // quelques secondes, ffmpeg n'est même pas chargé. 'copy' : l'image d'origine recopiée SANS ré-encodage avec le
  // nouveau son (pas d'incrustations) -- quelques secondes aussi. Les deux modes rapides passent toujours par le
  // moteur de rendu, même sans effet.
  const exportMode = exportOptions.mode === 'audio' || exportOptions.mode === 'copy' ? exportOptions.mode : 'video';
  const ffmpeg = exportMode === 'audio' ? null : await loadFfmpegWasm(onProgress);

  const stingerEvents = events.filter(e => e.name === 'stinger_play');
  const layerSegmentEvents = events.filter(e => e.name === 'layer_segment');
  const fxSegmentEvents = events.filter(e => e.name === 'fx_segment');
  // Le son est TOUJOURS rendu par le moteur du lecteur depuis le 25/09 (capture-plan.js -> capture-render.js) : chaque
  // fichier est replacé exactement comme le lecteur l'a joué -- générations de boucles, queues de fin, coupures,
  // rampes de volume, effets, Sfx, tête. L'ancien mixage par filtres ffmpeg (fenêtres rognées, boucles non rebouclées,
  // calage approximatif) a été retiré. ffmpeg ne sert plus qu'à assembler ce son avec l'image.
  const built = window.LayerCapturePlan.buildPlan(events, { findTrack: findCaptureTrack, findSfx: findCaptureSfx });
  const embrWindowsByTrack = built.windows.embr, seqWindowsByTrack = built.windows.seq, vrWindowsByTrack = built.windows.vr;
  const switchCount = Object.keys(embrWindowsByTrack).reduce((n, id) => n + embrWindowsByTrack[id].filter(w => w.isSwitch).length, 0);
  onProgress(tr('captureExportPreparing').replace('{n}', layerSegmentEvents.length).replace('{m}', switchCount).replace('{k}', stingerEvents.length));
  onProgress(tr('captureEngineRendering'));
  const rendered = await window.LayerCaptureRender.render(built.plan, {
    fetchBytes: fetchAsUint8Array,
    onProgress: (i, n) => onProgress(tr('captureEngineProgress').replace('{i}', i).replace('{n}', n))
  });
  const wavBytes = window.LayerCaptureRender.encodeWav(rendered);
  if (exportMode === 'audio') return new Blob([wavBytes], { type: 'audio/wav' });
  await ffmpeg.writeFile('mix.wav', wavBytes);
  if (exportMode === 'copy') {
    // Image d'origine recopiée telle quelle (-c:v copy : aucun ré-encodage, donc rapide) + nouveau son ; le son
    // d'origine de la vidéo est écarté. Pas d'incrustations (elles exigent de ré-encoder l'image).
    onProgress(tr('captureFetchVideo'));
    const copyExt = videoFile.name.slice(videoFile.name.lastIndexOf('.')) || '.mp4';
    await ffmpeg.writeFile('bg' + copyExt, new Uint8Array(await videoFile.arrayBuffer()));
    onProgress(tr('captureCopying'));
    const copyLogs = [];
    const onCopyLog = ({ message }) => copyLogs.push(message);
    ffmpeg.on('log', onCopyLog);
    let copyCode;
    try {
      copyCode = await ffmpeg.exec(['-i', 'bg' + copyExt, '-i', 'mix.wav', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest', 'out.mp4']);
    } finally { ffmpeg.off('log', onCopyLog); }
    if (copyCode !== 0) throw new Error('ffmpeg a échoué : ' + copyLogs.slice(-6).join(' | '));
    const copyData = await ffmpeg.readFile('out.mp4');
    return new Blob([copyData.buffer], { type: 'video/mp4' });
  }
  const inputs = ['mix.wav'];
  const filterParts = [];
  let inIdx = 1;
  const audioMap = '0:a';

  onProgress(tr('captureFetchVideo'));
  const videoExt = videoFile.name.slice(videoFile.name.lastIndexOf('.')) || '.mp4';
  const videoName = `bg${videoExt}`;
  await ffmpeg.writeFile(videoName, new Uint8Array(await videoFile.arrayBuffer()));
  inputs.push(videoName);
  const videoIdx = inIdx++;

  // Incrustation à l'écran (libellé du niveau d'intensité actif + flash sur stinger) : volontaire dans le
  // vrai export, pas juste un aide-debug -- montrer concrètement l'adaptativité de la musique est tout
  // l'intérêt de la démo. Le moteur ffmpeg.wasm n'a aucune police embarquée par défaut (drawtext échoue
  // sans fontfile) -- on lui fournit celle déjà utilisée par le reste du site (JetBrains Mono, licence
  // libre, vendor/fonts/).
  onProgress(tr('captureFetchFont'));
  await ffmpeg.writeFile('font.ttf', await fetchAsUint8Array(new URL('./vendor/fonts/JetBrainsMono-Regular.ttf', location.href).href));
  // Plafonné à 720p (16 septembre, retour direct : un export de 3 min prenait ~10 min -- cet export
  // encodait la vidéo source à sa résolution d'origine, souvent 1080p+, SANS le plafond déjà appliqué
  // côté bibliothèque vidéo -- voir compressVideoForLibrary dans layerpitch-backstage.html). Le
  // drawtext qui suit coûte aussi moins cher sur moins de pixels.
  let videoChain = `[${videoIdx}:v]scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease`;
  const drawtexts = [];
  // Un calque = une hauteur d'incrustation qui lui est propre (dérivée de son layerIndex) -- plusieurs
  // calques pouvant désormais être actifs en même temps (segments indépendants), superposer leurs
  // libellés à la même hauteur les rendrait illisibles.
  for (const seg of layerSegmentEvents) {
    const track = findCaptureTrack(seg.detail.trackId);
    const label = (track ? captureLaneLabel(track, seg.detail.layerIndex, laneOverrides) : 'calque ' + seg.detail.layerIndex).replace(/['\\:]/g, '');
    drawtexts.push(
      `drawtext=fontfile=font.ttf:text='${label}':x=24:y=h-56-${seg.detail.layerIndex * 30}:fontsize=22:fontcolor=white:box=1:boxcolor=0x000000AA:boxborderw=6:` +
      `enable='between(t,${seg.t},${seg.t + seg.detail.duration})'`
    );
  }
  Object.keys(embrWindowsByTrack).forEach(trackId => {
    const track = findCaptureTrack(trackId);
    embrWindowsByTrack[trackId].forEach(w => {
      const label = (track ? captureLoopLaneLabel(track, w.loopId, laneOverrides) : w.loopId).replace(/['\\:]/g, '');
      drawtexts.push(
        `drawtext=fontfile=font.ttf:text='${label}':x=24:y=h-56:fontsize=26:fontcolor=white:box=1:boxcolor=0x000000AA:boxborderw=8:` +
        `enable='between(t,${w.start},${w.end})'`
      );
    });
  });
  Object.keys(seqWindowsByTrack).forEach(trackId => {
    const track = findCaptureTrack(trackId);
    seqWindowsByTrack[trackId].forEach(w => {
      const label = captureSeqWindowLabel(track, w, laneOverrides).replace(/['\\:]/g, '');
      drawtexts.push(
        `drawtext=fontfile=font.ttf:text='${label}':x=24:y=h-56:fontsize=26:fontcolor=white:box=1:boxcolor=0x000000AA:boxborderw=8:` +
        `enable='between(t,${w.start},${w.end})'`
      );
    });
  });
  Object.keys(vrWindowsByTrack).forEach(trackId => {
    const track = findCaptureTrack(trackId);
    vrWindowsByTrack[trackId].forEach(w => {
      const label = captureVRWindowLabel(track, w).replace(/['\\:]/g, '');
      drawtexts.push(
        `drawtext=fontfile=font.ttf:text='${label}':x=24:y=h-56:fontsize=26:fontcolor=white:box=1:boxcolor=0x000000AA:boxborderw=8:` +
        `enable='between(t,${w.start},${w.end})'`
      );
    });
  });
  for (const s of stingerEvents) {
    const sfx = findCaptureSfx(s.detail.sfxId);
    const label = ((sfx && sfx.title) || 'stinger').toUpperCase().replace(/['\\:]/g, '');
    const flashDur = s.detail.durationOverride || 1; // sans retouche, flash d'1s par défaut (durée réelle inconnue sans sonder le fichier)
    drawtexts.push(
      `drawtext=fontfile=font.ttf:text='${label} !':x=24:y=24:fontsize=26:fontcolor=0xffaa55:box=1:boxcolor=0x000000AA:boxborderw=8:` +
      `enable='between(t,${s.t},${s.t + flashDur})'`
    );
  }
  // Effets déclenchés par bouton : un libellé violet sous le flash Sfx pendant que le bouton est enfoncé (une ligne
  // par trigger pour que plusieurs effets simultanés restent lisibles).
  for (const fs of fxSegmentEvents) {
    const track = findCaptureTrack(fs.detail.trackId);
    const list = ((track && track.fxTriggers) || []).filter(d => d && d.id && d.fx);
    const ti = Math.max(0, list.findIndex(d => d.id === fs.detail.triggerId));
    const label = (((list[ti] && list[ti].label) || 'FX')).replace(/['\\:]/g, '');
    drawtexts.push(
      `drawtext=fontfile=font.ttf:text='FX ${label}':x=24:y=${64 + ti * 30}:fontsize=22:fontcolor=0xc9a0ff:box=1:boxcolor=0x000000AA:boxborderw=6:` +
      `enable='between(t,${fs.t},${fs.t + fs.detail.duration})'`
    );
  }
  // Filigrane "powered by LayerPitch" (Rookie/Warrior, voir tout en haut de la fonction) -- permanent,
  // pas de fenêtre `enable`, coin bas-droit pour ne jamais chevaucher les libellés de calque/boucle/
  // emplacement (toujours en bas-gauche ci-dessus).
  if (showWatermark) {
    drawtexts.push(
      `drawtext=fontfile=font.ttf:text='Powered by LayerPitch':x=w-tw-16:y=h-32:fontsize=16:` +
      `fontcolor=white@0.75:box=1:boxcolor=0x000000AA:boxborderw=5`
    );
  }
  // Crédit compositeur (tant que le pack n'a pas été acheté par la personne qui exporte -- voir le
  // commentaire tout en haut de la fonction) -- permanent, coin haut-droit, distinct du flash stinger
  // (toujours en haut-gauche ci-dessus).
  if (showComposerCredit && composerName) {
    const creditLabel = composerName.replace(/['\\:]/g, '');
    drawtexts.push(
      `drawtext=fontfile=font.ttf:text='Musique\\: ${creditLabel}':x=w-tw-16:y=16:fontsize=18:` +
      `fontcolor=white:box=1:boxcolor=0x000000AA:boxborderw=6`
    );
  }
  videoChain += (drawtexts.length ? ',' + drawtexts.join(',') : '') + '[vout]';
  filterParts.push(videoChain);

  const filterComplex = filterParts.join(';');
  // -threads 2 (16 septembre, même bug connu que layerpitch-backstage.html -- voir
  // FFMPEG_MULTITHREAD_ENABLED en haut de ce fichier) : sans plafond explicite, décodeur et encodeur
  // réclament chacun un nombre de threads auto-détecté qui peut dépasser la taille fixe du pool du
  // coeur core-mt, bloquant pthread_create indéfiniment sans erreur ni log
  // (https://github.com/ffmpegwasm/ffmpeg.wasm/issues/772). Sans effet sur le coeur mono-thread.
  const args = ['-threads', '2'];
  inputs.forEach(name => args.push('-i', name));
  args.push(
    '-filter_complex', filterComplex,
    '-map', '[vout]', '-map', audioMap,
    '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-shortest',
    'out.mp4'
  );

  onProgress(tr('captureRendering'));
  const logs = [];
  const onLog = ({ message }) => logs.push(message);
  ffmpeg.on('log', onLog);
  let exitCode;
  try {
    exitCode = await ffmpeg.exec(args);
  } finally {
    ffmpeg.off('log', onLog);
  }
  if (exitCode !== 0) {
    throw new Error('ffmpeg a échoué : ' + logs.slice(-6).join(' | '));
  }
  const data = await ffmpeg.readFile('out.mp4');
  return new Blob([data.buffer], { type: 'video/mp4' });
}

// Fenêtre du panneau de capture détaché (2026-09-16, retour direct de Jules-Antoine : "il faut pouvoir
// détacher la fenêtre de capture"), si actif -- null sinon. Voir detachCapturePanel() plus bas.
let capturePanelDetachedWindow = null;
let capturePanelVersioning = null; // section Versioning du panneau ouvert (arrêtée à la fermeture : écoute en cours)

