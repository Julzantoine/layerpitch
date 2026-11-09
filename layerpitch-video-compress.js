/* layerpitch-video-compress.js — compression des vidéos dans le navigateur (WebCodecs + Mediabunny), partagée par le Backstage
 * (bibliothèque vidéo) et l'Atelier (vidéo muette d'un montage). Créé le 09/11 en sortant la logique de
 * src/backstage/41-envoi-r2-et-bibliotheque-video.js pour qu'il n'y ait pas deux copies qui divergent.
 *
 * window.LayerPitchVideoCompress.compress(file, { onProgress(pct 0-100), log(msg, cls), keepAudio = true }) -> Promise<Blob mp4>
 * Rejette (Error) si le navigateur ne peut pas : l'appelant retombe alors sur ffmpeg.wasm (toujours prévoir ce repli).
 *
 * Règles (essais 09/11, Firefox 159 : ~6x le temps réel) :
 *  - IMAGE : recopiée sans ré-encodage si déjà H.264, <= 1280x720 et débit MOYEN du fichier entier <= COPY_MAX_BPS (taille / durée, son compris : estimation
 *    prudente -- ne jamais le mesurer sur les premières images seulement : un fichier de 267 Mo qui s'ouvrait sur un fondu quasi noir était pris pour
 *    « léger » et partait entier) ; sinon H.264 ~1,2 Mbps, plafonné à 1280x720, jamais agrandi.
 *  - SON (si keepAudio) : copié s'il est déjà en AAC ; sinon AAC natif du navigateur ; sinon Opus (Firefox n'encode pas l'AAC). PAS d'encodeur AAC
 *    WASM livré par nous : question de brevets AAC en attente de la réponse de Via LA (mail du 09/11). Ne copier JAMAIS un son PCM dans le MP4 (47 Mo au lieu de 24).
 *  - Mediabunny est en copie locale (vendor/mediabunny/, MPL-2.0), jamais depuis un CDN.
 */
(function () {
  const COPY_MAX_BPS = 2000000;
  const TARGET_BPS = 1200000;
  let mediabunny = null;
  async function loadMediabunny() {
    if (!mediabunny) mediabunny = await import('./vendor/mediabunny/mediabunny.min.mjs');
    return mediabunny;
  }

  async function compress(file, opts) {
    opts = opts || {};
    const log = opts.log || (() => {});
    const keepAudio = opts.keepAudio !== false;
    if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined' || !window.isSecureContext) {
      throw new Error('WebCodecs indisponible dans ce navigateur');
    }
    const MB = await loadMediabunny();
    const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('aucune piste vidéo lisible');
    const audioTrack = keepAudio ? await input.getPrimaryAudioTrack() : null;

    // IMAGE : copier ou réencoder ?
    const w = videoTrack.displayWidth, h = videoTrack.displayHeight;
    const fits = w <= 1280 && h <= 720;
    const duration = await input.computeDuration();
    const overallBps = duration > 0 ? file.size * 8 / duration : (await videoTrack.computePacketStats(2000)).averageBitrate;
    const videoOpts = { codec: 'avc' };
    if (videoTrack.codec === 'avc' && fits && overallBps <= COPY_MAX_BPS) {
      log(`Vidéo : déjà assez légère (${Math.round(overallBps / 1000)} kbps en moyenne, ${w}x${h}), image recopiée sans ré-encodage.`, 'info');
    } else {
      const scale = Math.min(1, 1280 / w, 720 / h);
      if (scale < 1) {
        // Dimensions paires (exigence de l'H.264). Jamais agrandie : le plafond ne s'applique qu'aux vidéos plus grandes.
        videoOpts.width = Math.max(2, 2 * Math.round(w * scale / 2));
        videoOpts.height = Math.max(2, 2 * Math.round(h * scale / 2));
        videoOpts.fit = 'fill';
      }
      videoOpts.bitrate = TARGET_BPS;
      videoOpts.forceTranscode = true;
    }

    // SON : rien, copie, AAC natif ou Opus.
    const audioOpts = keepAudio ? {} : { discard: true };
    let audioPlan = keepAudio ? 'aucun' : 'retiré';
    if (audioTrack) {
      if (audioTrack.codec === 'aac') audioPlan = 'copie AAC';
      else if (await MB.canEncodeAudio('aac')) { audioOpts.codec = 'aac'; audioOpts.bitrate = 128000; audioPlan = 'AAC natif'; }
      else if (await MB.canEncodeAudio('opus')) { audioOpts.codec = 'opus'; audioOpts.bitrate = 128000; audioPlan = 'Opus'; }
      else throw new Error('aucun encodeur audio (AAC/Opus) disponible');
    }
    log(`Compression WebCodecs : son ${audioPlan}${audioTrack ? ' (source ' + audioTrack.codec + ')' : ''}.`, 'info');

    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
    const conversion = await MB.Conversion.init({ input, output, video: videoOpts, audio: audioOpts });
    if (!conversion.isValid) {
      throw new Error('conversion impossible : ' + conversion.discardedTracks.map(t => t.reason).join(', '));
    }
    // Perdre l'image ou le son demandé est une erreur (les autres pistes écartées ne comptent pas).
    const lostVideo = !conversion.utilizedTracks.some(t => t.isVideoTrack());
    const lostAudio = !!audioTrack && !conversion.utilizedTracks.some(t => t.isAudioTrack());
    if (lostVideo || lostAudio) throw new Error('une piste a été écartée (' + conversion.discardedTracks.map(t => t.reason).join(', ') + ')');
    if (opts.onProgress) conversion.onProgress = (p) => opts.onProgress(Math.max(0, Math.min(100, Math.round(p * 100))));
    await conversion.execute();
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  }

  window.LayerPitchVideoCompress = { compress };
})();
