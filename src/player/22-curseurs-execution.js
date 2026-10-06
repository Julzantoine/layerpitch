  // ---- Curseurs (24/09) : exécution ----
  const fxSliderInputs = [...wrapper.querySelectorAll('[data-fx-slider]')];
  const fxSliderLastWant = new Map(); // triggerId -> dernier état voulu par un seuil (ne redemande que sur franchissement)
  // ---- Curseur qui pilote la structure du morceau (26/09 vertical, 30/09 tous les modes) ----
  // Chaque zone du curseur = une couche (vertical) ou une boucle (embranchement-vertical). Franchir une limite fait la MÊME
  // chose que le bouton qu'il remplace : mêmes fondus, mêmes quantifications, mêmes repères pour l'outil vidéo.
  const fxStructureSlider = fxSliders.find(sl => sl.intensity) || null;
  const fxStructureNames = fxStructureZones(track);
  const fxZoneOfValue = v => fxSliderIntensityLevel(fxStructureSlider.intensity, v);
  let fxStructureZone = fxStructureSlider ? fxZoneOfValue(fxStructureSlider.def) : -1; // dernière zone demandée
  function applyStructureZone(z) {
    if (z < 0) return;
    if (isEmbrVert) selectEmbrLoop(z);
    else if (level !== z) applyIntensityLevel(z);
  }
  function followStructureSlider(sl) {
    if (!sl.intensity) return;
    const z = fxZoneOfValue(fxSliderValueOf(sl.id));
    if (z === fxStructureZone) return;
    fxStructureZone = z;
    applyStructureZone(z);
  }
  // Au vrai démarrage : le curseur repart de sa position de départ ; les moteurs qui ne démarrent pas sur la bonne zone
  // (l'embranchement-vertical ; le vertical lit fxStructureZone à son initialisation) la rejoignent aussitôt.
  function startStructureSlider() {
    if (!fxStructureSlider) return;
    fxStructureZone = fxZoneOfValue(fxStructureSlider.def);
    if (isEmbrVert && fxStructureZone !== embrReferenceIdx) setTimeout(() => { if (playing) applyStructureZone(fxStructureZone); }, 100);
  }
  function paintFxSlider(id) {
    fxSliderInputs.forEach(inp => {
      if (inp.dataset.fxSlider !== id) return;
      inp.value = Math.round(fxSliderValueOf(id) * 100);
      const out = inp.parentElement && inp.parentElement.querySelector('output');
      if (out) out.textContent = Math.round(fxSliderValueOf(id) * 100) + '%';
      const cap = inp.parentElement && inp.parentElement.querySelector('[data-fx-zone]');
      if (cap && fxStructureSlider && fxStructureSlider.id === id) {
        const z = fxZoneOfValue(fxSliderValueOf(id));
        cap.textContent = '· ' + (fxStructureNames[z] || t('fxZoneFallback', { n: z + 1 }));
      }
    });
  }
  function evalFxSliderThresholds(sl, force) {
    fxSliderThresholdWants(sl, fxSliderValueOf(sl.id)).forEach(w => {
      if (!force && fxSliderLastWant.get(sl.id + '|' + w.triggerId) === w.want) return;
      fxSliderLastWant.set(sl.id + '|' + w.triggerId, w.want);
      fxRules.request(w.triggerId, w.want, 'composer'); // décision du compositeur : ne subit pas « Nécessite »
    });
  }
  function applyFxSliderToChains(sl, rampSec) {
    const keys = new Set(sl.bindings.map(b => b.key));
    keys.forEach(key => {
      fxChainsFor(key).forEach(ch => applyFxToChain(ctx, ch, fxEffectiveFor(ch.targetKey, ch.baseFx), rampSec));
    });
  }
  // Sfx spatialisés en cours de lecture dans CE morceau : un curseur lié à leur position/reverb les déplace en direct.
  const activeSfxVoices = new Map(); // sfxId -> Set(voix spatiales)
  function fxSfxOverrideFor(sfxId) { return fxSliders.length ? fxSliderSfxOverrides(fxSliders, fxSliderValueOf, sfxId) : null; }
  function applyFxSliderToSfx(sl, rampSec) {
    new Set(sl.bindings.filter(b => b.key.indexOf('sfx:') === 0).map(b => b.key.slice(4))).forEach(sfxId => {
      const sfx = SFX_LIBRARY_BY_ID[sfxId];
      const voices = activeSfxVoices.get(sfxId);
      if (!sfx || !sfx.spatial || !voices) return;
      const sp = fxSpatialWithOverride(sfx.spatial, fxSfxOverrideFor(sfxId));
      voices.forEach(v => { v.setPosition(sp.x, sp.y, rampSec); v.setReverbDb(sp.reverbDb, rampSec); });
    });
  }
  function setFxSlider(id, value, emit) {
    const sl = fxSliders.find(x => x.id === id);
    if (!sl) return;
    fxSliderValues.set(id, Math.max(0, Math.min(1, value)));
    applyFxSliderToChains(sl, sl.smoothSec);
    applyFxSliderToSfx(sl, sl.smoothSec);
    refreshTrackRate(sl.smoothSec);
    evalFxSliderThresholds(sl, false);
    followStructureSlider(sl);
    paintFxSlider(id);
    // Évènement DOM (pas de la télémétrie : un curseur émet des dizaines de valeurs par seconde) -- l'outil vidéo
    // l'enregistre pendant une prise, comme "tourner la tête".
    if (emit) { try { document.dispatchEvent(new CustomEvent('layerpitch-fx-slider', { detail: { trackId: track.id, sliderId: id, value: fxSliderValueOf(id) } })); } catch (e) {} }
  }
  function resetFxSliders() {
    fxSliders.forEach(sl => {
      fxSliderValues.set(sl.id, sl.def);
      applyFxSliderToChains(sl, 0.05);
      paintFxSlider(sl.id);
    });
    refreshTrackRate(0.05);
    fxSliderLastWant.clear();
    fxSliders.forEach(sl => evalFxSliderThresholds(sl, true));
    startStructureSlider();
  }
  fxSliderInputs.forEach(inp => inp.addEventListener('input', () => setFxSlider(inp.dataset.fxSlider, (+inp.value) / 100, true)));
  fxTriggerBtns.forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.fxTrigger;
    const willBeActive = !fxRules.isActive(id);
    const accepted = setFxTrigger(id, willBeActive, null, 'visitor');
    if (!accepted) return; // bouton bloqué : rien ne se passe, rien n'est enregistré
    // Seuls les appuis de bouton sont un geste du visiteur (les activations liées à un embranchement se déduisent
    // des bascules, déjà capturées) -- l'outil vidéo les enregistre et les rejoue.
    trackPublicEvent('fx_trigger', { trackId: track.id, triggerId: id, active: willBeActive });
  }));
  updateFxTriggerButtons();
  // Harmonisation des volumes : décision du compositeur (case à cocher dans le backstage), jamais
  // automatique — sinon un fichier qui sonne différemment de ce qu'il a exporté serait déroutant.
  // Le gain mesuré à la conversion reste stocké dans tous les cas ; ce n'est que son application à la
  // lecture qui dépend de ce réglage.
  function effGain(item) {
    return (track.normalizeVolume && item && item.gain) ? item.gain : 1;
  }
  // Solo/muet par voix (vertical et vertical-random) : plusieurs voix peuvent être soloées en même temps
  // (convention DAW classique) — dès qu'au moins une l'est, tout le reste se tait, quel que soit son
  // propre état muet. "Voix" = une couche (vertical), une couche fixe ou un groupe entier (vertical-random,
  // pas chaque alternative individuellement, puisqu'une seule alternative par groupe sonne à la fois).
  const mutedVoices = new Set();
  const soloedVoices = new Set();
  // Volume par voix (vertical et vertical-random) : réglage continu (slider 0-150%, défaut 100% = volume
  // du fichier source, rien d'atténué au départ) — même clé que Solo/Muet ('layer-i' / 'pool-i'), même
  // principe de vie : en mémoire seulement, jamais persisté, remis à 100% au rechargement de la page.
  const layerVolumes = new Map();
  function getLayerVolume(key) {
    return layerVolumes.has(key) ? layerVolumes.get(key) : 1;
  }
  function voiceGain(key) {
    const soloMute = soloedVoices.size > 0 ? (soloedVoices.has(key) ? 1 : 0) : (mutedVoices.has(key) ? 0 : 1);
    return soloMute * getLayerVolume(key);
  }
  // Recalcule en direct le gain de toutes les sources actuellement en train de sonner (génération en
  // cours et éventuelles queues encore audibles) — sans ça, un solo/muet ne prendrait effet qu'à la
  // prochaine génération programmée, avec un délai pouvant aller jusqu'à la longueur du cycle.
  function refreshVoiceGains() {
    const now = ctx.currentTime;
    const p = profiles[level] || profiles[0];
    activeGenSources.forEach(({ gain, voiceKey, baseGain }) => {
      if (!voiceKey || !gain) return;
      // Vertical classique : le gain dépend de l'intensité courante, qui peut avoir changé depuis que
      // cette génération a été programmée (via le curseur) — on le recalcule plutôt que de se fier à
      // une valeur figée, sinon un changement d'intensité récent serait ignoré par ce recalcul.
      let base = baseGain != null ? baseGain : 1;
      if (voiceKey.indexOf('layer-') === 0) {
        const i = parseInt(voiceKey.slice(6), 10);
        base = (p[i] || 0) * effGain(layersToLoad[i]);
      }
      const target = base * voiceGain(voiceKey);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(target, now + VOICE_RAMP_SEC);
    });
    // Moteur simple (vertical sans moteur quantifié) : les gains vivent dans gains[], pas activeGenSources.
    if (!useQuantizedLoop && gains.length && playing) {
      gains.forEach((g, i) => {
        if (!g) return;
        const base = (p[i] || 0) * effGain(layersToLoad[i]);
        const target = base * voiceGain('layer-' + i);
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(target, now + VOICE_RAMP_SEC);
      });
    }
  }
  const hasFiles = supported && (isVerticalRandom
    ? (track.sections || []).some((s, i) => vrSectionIsPlayable(track, i))
    : isSequential
    ? (track.segmentSlots || []).some(sl => (sl.alternatives || []).some(layerHasSource))
    : isEmbrVert
    ? (track.loops || []).some(layerHasSource)
    : layerHasSource(track.layers[0]) && (isStatic || track.layers.every(layerHasSource)));
  if (!hasFiles) return;

  const layersToLoad = (isVerticalRandom || isSequential || isEmbrVert) ? [] : (isStatic ? [track.layers[0]] : track.layers);
  const profiles = (isVerticalRandom || isSequential || isEmbrVert) ? [] : (isStatic ? [[1]] : cumulativeProfiles(track.layers.length));
  const loops = !isStatic || !!track.loopable; // toujours vrai pour vertical-random (isStatic est faux)
  const useQuantizedLoop = !isSequential && !isVerticalRandom && !isEmbrVert && (loops && track.loopEngine === 'quantized');
  // Sfx attachés à ce morceau (ex-"stingers") — résolus depuis la Bibliothèque Sfx partagée, chacun
  // pouvant porter plusieurs variations round robin (contrairement à l'ancien stinger, un seul fichier).
  const attachedSfx = (track.sfxIds || []).map(id => SFX_LIBRARY_BY_ID[id]).filter(Boolean);
  const totalSfxFilesToLoad = attachedSfx.reduce((n, sfx) => n + (sfx.alternatives || []).filter(a => a.file || a.localFile || a.localUrl).length, 0);
  // Gain maître de CE morceau : tout ce qui sonne pour lui (une seule couche statique, plusieurs couches
  // vertical/vertical-random simultanées, ou les générations successives du moteur séquentiel) route par
  // ici plutôt que directement vers la destination — point d'accroche unique pour le ducking (Phase 4),
  // qui doit baisser TOUT le morceau en cours d'un coup, peu importe son mode de lecture.
  const trackMasterGain = ctx.createGain();
  trackMasterGain.connect(ctx.destination);

