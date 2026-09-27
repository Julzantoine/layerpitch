function updateArmedStatusDisplay() {
  const statusEl = document.getElementById('videoCaptureArmedStatus');
  if (!statusEl) return; // panneau de capture pas encore ouvert
  if (!armedTrackId) { statusEl.textContent = tr('captureArmedNone'); return; }
  const row = document.querySelector(`[data-track-id="${armedTrackId}"]`);
  const titleEl = row && row.querySelector('[data-role="titleToggle"]');
  statusEl.textContent = tr('captureArmedLabel').replace('{name}', titleEl ? titleEl.textContent.trim() : armedTrackId);
}

function startCapture(videoEl) {
  const events = [];
  // Tout ce que le lecteur annonce passe par ses repères de capture (player.js, captureMark -- 25/09) : évènements de
  // télémétrie ET repères propres à la capture (générations de boucles, arrêts, bascules réelles...). Chacun est daté
  // à l'instant exact où le son a lieu (at : heure du contexte audio, donnée par le lecteur).
  // Horloge : celle du son (at, heure exacte du contexte audio), replacée sur la vidéo par un seul décalage relevé au
  // démarrage -- tous les sons restent calés entre eux à l'échantillon près.
  const P = window.LayerPlayerCore;
  const audio0 = P.audioNow(), video0 = videoEl.currentTime;
  const stamp = at => Math.max(0, video0 + (at - audio0));
  const markHandler = (e) => {
    const d = e.detail || {};
    const detail = Object.assign({}, d.detail || {});
    const at = detail.at != null ? detail.at : P.audioNow();
    delete detail.at;
    events.push({ t: stamp(at), name: d.name, detail });
  };
  document.addEventListener('layerpitch-capture-mark', markHandler);
  // Tête de l'auditeur (23/09) : pas un évènement de télémétrie (le curseur en émettrait des dizaines par seconde) mais
  // un évènement DOM du moteur -- écouté ici seulement pendant la prise. L'orientation déjà réglée avant de démarrer est
  // enregistrée comme point de départ.
  const headHandler = (e) => events.push({ t: stamp(P.audioNow()), name: 'head_turn', detail: { yaw: e.detail } });
  document.addEventListener('layerpitch-head-yaw', headHandler);
  const yaw0 = window.LayerPlayerCore && window.LayerPlayerCore.getListenerYaw ? window.LayerPlayerCore.getListenerYaw() : 0;
  if (yaw0) events.push({ t: stamp(P.audioNow()), name: 'head_turn', detail: { yaw: yaw0 } });
  // Curseurs de paramètre (24/09) : même principe, évènement DOM du lecteur. Au démarrage d'une piste armée, le lecteur
  // remet les curseurs à leur position de départ SANS émettre : l'état initial d'une prise est la valeur par défaut.
  const sliderHandler = (e) => events.push({ t: stamp(P.audioNow()), name: 'fx_slider', detail: { trackId: e.detail.trackId, sliderId: e.detail.sliderId, value: e.detail.value } });
  document.addEventListener('layerpitch-fx-slider', sliderHandler);
  videoCaptureState = { events, videoEl, markHandler, headHandler, sliderHandler, stamp };
}

function stopCapture() {
  if (!videoCaptureState) return [];
  // Fin de la prise : ce qui jouait s'arrête ici (l'arrêt réel de la musique suit, une fois l'enregistrement fermé) --
  // sans ce repère, le rendu laisserait sonner les boucles au-delà de la fin de la capture.
  const tEnd = videoCaptureState.stamp(window.LayerPlayerCore.audioNow());
  [...new Set(videoCaptureState.events.map(e => e.detail && e.detail.trackId).filter(Boolean))]
    .forEach(trackId => videoCaptureState.events.push({ t: tEnd, name: 'voices_stop', detail: { trackId } }));
  document.removeEventListener('layerpitch-capture-mark', videoCaptureState.markHandler);
  document.removeEventListener('layerpitch-head-yaw', videoCaptureState.headHandler);
  document.removeEventListener('layerpitch-fx-slider', videoCaptureState.sliderHandler);
  const events = videoCaptureState.events;
  videoCaptureState = null;
  return events;
}

