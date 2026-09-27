function initTrackPlayer(track, wrapper, elementColors) {
  const { bg: waveBgColor, fg: waveFgColor } = resolveWaveformColors(elementColors);
  const isStatic = track.mode === 'static';
  const isVerticalRandom = track.mode === 'vertical-random';
  const isSequential = track.mode === 'sequential';
  const isEmbrVert = track.mode === 'embranchement-vertical';
  const supported = PLAYABLE_MODES.includes(track.mode);
  // Pitch "vitesse" (chantier 2, 22/09) — réglage de MORCEAU ENTIER, jamais par couche/boucle/emplacement/
  // pool : change la durée de lecture en plus de la hauteur, donc tout ce qui doit rester ensemble (couches
  // simultanées d'un vertical, boucles jumelles d'un embranchement-vertical, pools d'une même section)
  // doit bouger à EXACTEMENT la même vitesse, sous peine de dérive relative. Le pitch "traditionnel"
  // (fx.pitch.mode==='shift' porté par couche/boucle/emplacement/pool, voir buildLayerFxChain) ne change
  // pas la durée -- lui n'a pas ce problème, reste réglable indépendamment par élément.
  // Admin-only pour l'instant (voir fxBlockHtml, currentUserIsAdmin côté backstage) : correctif appliqué
  // aux boucles de planification "au fil de l'eau" des 4 moteurs (vérifié), PAS encore aux chemins de
  // reprise après pause/veille ni au seek pendant qu'un pitch est actif -- portée volontairement réduite
  // tant que ce n'est pas testé en conditions réelles, pas un oubli silencieux.
  // 25/09 : devenu VARIABLE -- un trigger ou un curseur peut changer la vitesse du morceau en cours de lecture (voir
  // refreshTrackRate plus bas). Les moteurs programmés le lisent à chaque génération : le changement s'applique à la prochaine
  // boucle / au prochain segment ; le moteur simple (bouclage natif) le suit en direct.
  const trackBaseRatio = (track.fx && track.fx.pitch && track.fx.pitch.mode !== 'shift') ? Math.pow(2, (track.fx.pitch.semitones || 0) / 12) : 1;
  let trackPitchRatio = trackBaseRatio;
  // Applique le pitch de morceau entier à UNE source -- appelé à chaque création de BufferSource, quel
  // que soit le moteur. No-op si aucun pitch actif (trackPitchRatio===1), donc sans coût pour l'immense
  // majorité des morceaux qui n'utilisent pas ce réglage.
  // allowFade : seul le moteur simple (bouclage natif, aucun planificateur JS) peut faire glisser le ratio
  // en cours de lecture. Les moteurs programmés recréent une source à chaque génération et calculent leurs
  // durées avec le ratio CIBLE : une rampe y recommencerait à chaque cycle et fausserait le minutage --
  // le fondu y est donc ignoré (ratio cible constant), voir trackPitchFxHtml() côté Backstage.
  function applyTrackPitchRate(src, startTime, allowFade) {
    if (trackPitchRatio === 1) return;
    const p = track.fx && track.fx.pitch || {};
    const when = startTime != null ? startTime : ctx.currentTime;
    if (allowFade && trackPitchRatio === trackBaseRatio && p.fadeFromSemitones != null && p.fadeDurationSec > 0) {
      src.playbackRate.setValueAtTime(Math.pow(2, p.fadeFromSemitones / 12), when);
      src.playbackRate.linearRampToValueAtTime(trackPitchRatio, when + p.fadeDurationSec);
    } else {
      src.playbackRate.value = trackPitchRatio;
    }
  }
  /* ---- Triggers d'effets (23/09) ----
     track.fxTriggers[] : { id, label, target:{type:'layer'|'loop'|'slot'|'pool', li|si|pi}, fx:{...},
     visible, fadeSec? }. Un trigger ACTIF fusionne son `fx` PAR-DESSUS celui de sa cible (clé par clé) ;
     inactif, la cible retrouve sa configuration de base. Deux façons de l'actionner : un bouton public
     (visible=true, choisi par le compositeur) ou une option de branchement / une boucle qui porte
     fxActions:[{triggerId, active}] (séquentiel : nextOptions[] ; embranchement-vertical : loops[]).
     Les chaînes d'effets vivantes de chaque cible sont tenues dans un registre pour pouvoir être
     modifiées EN DIRECT (applyFxToChain) -- seules les cibles visées par au moins un trigger y sont
     inscrites et construites avec tous les effets que ces triggers peuvent toucher (forceKeys), pour
     qu'aucune reconstruction ne soit jamais nécessaire en cours de lecture. */
  const fxTriggerDefs = new Map();
  const fxTriggerTargetKey = new Map();
  function fxTargetKeyOf(target) {
    if (!target) return null;
    if (target.type === 'track') return 'track';
    if (target.type === 'layer') return 'layer:' + (target.li || 0);
    if (target.type === 'loop') return 'loop:' + target.li;
    if (target.type === 'slot') return 'slot:' + target.si;
    if (target.type === 'pool') return 'pool:' + target.si + ':' + target.pi;
    return null;
  }
  (track.fxTriggers || []).forEach(d => {
    const key = d && d.id && d.fx ? fxTargetKeyOf(d.target) : null;
    if (key) { fxTriggerDefs.set(d.id, d); fxTriggerTargetKey.set(d.id, key); }
  });
  const fxActiveTriggerIds = []; // dans l'ordre d'activation : le dernier activé l'emporte sur un même paramètre
  const fxChainsByTarget = new Map();
  // Curseurs de paramètre (24/09) : leurs effets liés font partie des « clés forcées » (nœuds construits d'emblée) et
  // leurs valeurs s'appliquent PAR-DESSUS base + triggers.
  const fxSliders = fxSlidersValid(track);
  const fxSliderValues = new Map(fxSliders.map(sl => [sl.id, sl.def]));
  const fxSliderValueOf = id => (fxSliderValues.has(id) ? fxSliderValues.get(id) : 0);
  function fxForceKeysFor(targetKey) {
    const keys = new Set(fxSliderForceKeys(fxSliders, targetKey));
    fxTriggerDefs.forEach((d, id) => { const k = fxTriggerTargetKey.get(id); if (k === targetKey || k === 'track') Object.keys(d.fx).forEach(x => { if (x === 'pitch' && d.fx.pitch && d.fx.pitch.mode === 'rate') return; keys.add(x); }); });
    return [...keys];
  }
  // Chaînes vivantes concernées par une clé de cible : 'track' = TOUTES les voix du morceau.
  function fxChainsFor(key) {
    if (key !== 'track') return [...(fxChainsByTarget.get(key) || [])];
    const all = [];
    fxChainsByTarget.forEach(set => set.forEach(ch => all.push(ch)));
    return all;
  }
  function fxEffectiveFor(targetKey, baseFx) {
    let out = baseFx ? Object.assign({}, baseFx) : {};
    fxActiveTriggerIds.forEach(id => {
      const tk = fxTriggerTargetKey.get(id);
      if (tk !== targetKey && tk !== 'track') return;
      const d = fxTriggerDefs.get(id);
      Object.keys(d.fx).forEach(k => { out[k] = Object.assign({}, out[k], d.fx[k]); });
    });
    if (fxSliders.length) out = applyFxSliderOverrides(out, fxSliderOverrides(fxSliders, fxSliderValueOf, targetKey));
    return out;
  }
  // Compensation de latence (voir withLatencyComp) : calculée une fois par morceau.
  const fxNeedsComp = trackNeedsLatencyComp(track);
  // Journal de prise : la chaîne retient de quoi être reconstruite à l'identique au rendu (réglage de départ, effets
  // forcés, compensation de latence) et consignera chacun de ses changements (voir applyFxToChain).
  function journalChain(out, fx, force) {
    if (takeRecordingEnabled && out) { out.__lpMeta = { fx: fx ? JSON.parse(JSON.stringify(fx)) : null, force: force.slice(), comp: !!fxNeedsComp }; out.__lpFxLog = []; }
    return out;
  }
  function buildTargetFxChain(targetKey, baseFx, src, startTime) {
    const force = (fxTriggerDefs.size || fxSliders.length) ? fxForceKeysFor(targetKey) : [];
    if (!force.length) {
      const plain = buildLayerFxChain(ctx, baseFx, src, startTime);
      return journalChain(fxNeedsComp ? withLatencyComp(ctx, plain) : plain, baseFx, force);
    }
    const effective0 = fxEffectiveFor(targetKey, baseFx);
    const chain = buildLayerFxChain(ctx, effective0, src, startTime, undefined, force);
    if (chain) {
      chain.baseFx = baseFx; chain.targetKey = targetKey;
      let set = fxChainsByTarget.get(targetKey);
      if (!set) { set = new Set(); fxChainsByTarget.set(targetKey, set); }
      set.add(chain);
      // addEventListener (pas .onended) : plusieurs gestionnaires de fin coexistent déjà sur ces sources
      // (nettoyage du bitcrusher, marqueurs de fin de morceau) -- jamais d'écrasement possible.
      src.addEventListener('ended', () => { set.delete(chain); });
    }
    return journalChain(fxNeedsComp ? withLatencyComp(ctx, chain) : chain, effective0, force);
  }
  const fxTriggerBtns = [...wrapper.querySelectorAll('[data-fx-trigger]')];
  // Boutons : état enfoncé + état « bloqué » (condition « Nécessite » non remplie) -- grisé mais visible, avec en
  // infobulle ce qui le débloque. Recalculé après CHAQUE changement d'état, la condition d'un bouton dépendant de
  // l'état des autres.
  function updateFxTriggerButtons() {
    fxTriggerBtns.forEach(b => {
      const id = b.dataset.fxTrigger;
      const on = fxRules.isActive(id);
      const locked = !fxRules.canActivate(id);
      b.classList.toggle('active', on);
      b.classList.toggle('fx-locked', locked);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (locked) {
        b.setAttribute('aria-disabled', 'true');
        b.title = t('fxLockedHint', { names: fxRules.missingRequirements(id).map(r => (fxTriggerDefs.get(r) && fxTriggerDefs.get(r).label) || t('fxTriggerFallbackLabel', { n: [...fxTriggerDefs.keys()].indexOf(r) + 1 })).join(', ') });
      } else { b.removeAttribute('aria-disabled'); b.removeAttribute('title'); }
    });
  }
  // Application d'un changement d'état DÉJÀ décidé par le moteur de règles (voir createTriggerRuleEngine) : met à jour
  // la liste des triggers actifs (ordre d'activation = priorité de fusion), reprogramme les chaînes vivantes.
  let fxRampOverride = null;
  function applyFxTriggerState(id, active) {
    const d = fxTriggerDefs.get(id);
    if (!d) return;
    const i = fxActiveTriggerIds.indexOf(id);
    if (active && i < 0) fxActiveTriggerIds.push(id);
    else if (!active && i >= 0) fxActiveTriggerIds.splice(i, 1);
    else return;
    const chains = fxChainsFor(fxTriggerTargetKey.get(id));
    // Fondu d'ENTRÉE (fadeSec) et fondu de SORTIE, au retour à la normale (fadeOutSec ; vide = même durée que l'entrée) --
    // demande de Jules-Antoine (24/09).
    const fadeIn = d.fadeSec != null ? d.fadeSec : 0.1;
    const ramp = fxRampOverride != null ? fxRampOverride : (active ? fadeIn : (d.fadeOutSec != null ? d.fadeOutSec : fadeIn));
    chains.forEach(ch => applyFxToChain(ctx, ch, fxEffectiveFor(ch.targetKey, ch.baseFx), ramp));
    refreshTrackRate(ramp);
    updateFxTriggerButtons();
  }
  // Vitesse du morceau (25/09) : recalculée après chaque changement de trigger ou de curseur (voir fxTrackRatio). Moteurs
  // programmés : seule la variable change -- chaque nouvelle génération (boucle / segment) la lira, les sons déjà programmés
  // gardent leur vitesse jusqu'au bout, donc tout reste synchrone. Moteur simple (bouclage natif) : les sources en cours
  // glissent vers la nouvelle vitesse et l'origine de la position est recalée pour que la tête de lecture ne saute pas.
  function fxComputeTrackRatio() {
    // Tous les triggers actifs, quelle que soit leur cible : fxTrackRatio ne lit que leur pitch « vitesse », qui vaut
    // toujours pour le morceau entier (27/09 -- un ancien trigger « vitesse » visant une couche était ignoré).
    const defs = fxActiveTriggerIds.map(id => fxTriggerDefs.get(id)).filter(Boolean);
    return fxTrackRatio(track, defs, fxSliders, fxSliderValueOf);
  }
  function refreshTrackRate(rampSec) {
    const next = fxComputeTrackRatio();
    if (!(next > 0) || Math.abs(next - trackPitchRatio) < 1e-9) return;
    const prev = trackPitchRatio;
    trackPitchRatio = next;
    const simple = !(useQuantizedLoop || isVerticalRandom || isSequential || isEmbrVert);
    if (!playing || !simple) return;
    const now = ctx.currentTime;
    startedAt = now - ((now - startedAt) * prev) / next;
    const tc = Math.max(0.005, (rampSec || 0.1) / 3);
    captureMark('track_rate', { trackId: track.id, rate: next, tc, at: now }); // glissement des sources en cours (export exact)
    sources.forEach(sn => {
      if (!sn) return;
      sn.playbackRate.cancelScheduledValues(now);
      sn.playbackRate.setValueAtTime(sn.playbackRate.value, now);
      sn.playbackRate.setTargetAtTime(next, now, tc);
    });
  }
  const fxRules = createTriggerRuleEngine([...fxTriggerDefs.values()], {
    schedule: (d, fn) => setTimeout(fn, d * 1000),
    cancel: h => clearTimeout(h),
    apply: (id, active) => applyFxTriggerState(id, active)
  });
  function setFxTrigger(id, active, rampSec, source) {
    fxRampOverride = rampSec != null ? rampSec : null;
    try { return fxRules.request(id, active, source || 'composer'); } finally { fxRampOverride = null; }
  }
  // Activations liées à un embranchement (décision du compositeur) : passent par les mêmes règles (cascade,
  // exclusion, coupure auto) mais ne sont pas bridées par « Nécessite ».
  function applyFxActions(actions) {
    if (Array.isArray(actions)) actions.forEach(a => { if (a && a.triggerId) setFxTrigger(a.triggerId, a.active !== false, null, 'composer'); });
  }
  // Un vrai démarrage à froid repart de l'état de base : sans ça, un bouton "low life" resté enfoncé (ou une
  // bascule qui l'avait activé) survivrait à un arrêt alors que le morceau repart du début. Annule aussi les
  // cascades et coupures automatiques encore en attente.
  function resetFxTriggers() {
    fxRampOverride = 0.05;
    try { fxRules.reset(); } finally { fxRampOverride = null; }
    updateFxTriggerButtons();
    resetFxSliders();
  }
  // ---- Curseurs (24/09) : exécution ----
  const fxSliderInputs = [...wrapper.querySelectorAll('[data-fx-slider]')];
  const fxSliderLastWant = new Map(); // triggerId -> dernier état voulu par un seuil (ne redemande que sur franchissement)
  function paintFxSlider(id) {
    fxSliderInputs.forEach(inp => {
      if (inp.dataset.fxSlider !== id) return;
      inp.value = Math.round(fxSliderValueOf(id) * 100);
      const out = inp.parentElement && inp.parentElement.querySelector('output');
      if (out) out.textContent = Math.round(fxSliderValueOf(id) * 100) + '%';
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

  // ---- Journal de prise de CE morceau (voir setTakeRecording plus haut) ----
  // Une prise commence à chaque vrai démarrage (pas une reprise après pause, un saut dans la frise ou un retour de
  // veille : ceux-là continuent la même prise, et le journal note simplement ce qui a été rejoué). Pendant une pause,
  // le temps d'écoute s'arrête. Chaque moteur signale ses voix via journalVoice / journalSfxVoice juste avant de les
  // lancer ; tout le reste (volumes, vitesse, effets) est consigné par les nœuds eux-mêmes.
  let take = null;
  function startTake() {
    if (!takeRecordingEnabled) { take = null; return; }
    journalParam(trackMasterGain.gain); // morceau initialisé avant l'activation : on rattrape son gain maître
    take = {
      startCtx: ctx.currentTime, pauses: [], pausedAt: null, voices: [], sfx: [], recordedAt: new Date().toISOString(),
      master0: trackMasterGain.gain.value, masterFrom: trackMasterGain.gain.__lpLog ? trackMasterGain.gain.__lpLog.auto.length : 0,
      yaw0: getListenerYaw(), yawFrom: _takeYawLog.length
    };
  }
  function pauseTake() { if (take && take.pausedAt == null) take.pausedAt = ctx.currentTime; }
  function resumeTake() {
    if (!take) return;
    take.resumable = false;
    if (take.pausedAt != null) { take.pauses.push([take.pausedAt, ctx.currentTime]); take.pausedAt = null; }
  }
  function journalVoice(src, g, chain) {
    if (take && take.pausedAt == null && src && src.__lpInfo) take.voices.push({ src, g, chain });
  }
  function journalSfxVoice(src, spatialVoice) {
    if (take && take.pausedAt == null && src && src.__lpInfo) take.sfx.push({ src, voice: spatialVoice || null });
  }
  trackTakeReaders[track.id] = () => {
    const J = take;
    if (!J) return null;
    const endCtx = J.pausedAt != null ? J.pausedAt : ctx.currentTime;
    // Heure du contexte audio -> temps d'écoute : on retire les pauses déjà closes, et un instant tombé PENDANT une
    // pause (ou après la pause en cours) se ramène au moment où elle a commencé.
    const pauses = J.pausedAt != null ? J.pauses.concat([[J.pausedAt, Infinity]]) : J.pauses;
    const tt = c => {
      let t = c - J.startCtx;
      pauses.forEach(([a, b]) => { if (c >= b) t -= (b - a); else if (c > a) t -= (c - a); });
      return Math.round(t * 1e6) / 1e6;
    };
    const param = log => (log ? { init: log.init, auto: log.auto.map(e => [e[0], tt(e[1])].concat(e.slice(2))) } : null);
    // Plusieurs stop() : le dernier appel l'emporte, sauf si la source s'était déjà arrêtée avant qu'il arrive.
    const stopOf = info => {
      let s = null;
      info.stops.forEach(([call, when]) => { if (s == null || call < s) s = when; });
      return s == null ? null : tt(s);
    };
    const base = src => {
      const info = src.__lpInfo, st = info.starts[0];
      return { url: st.url, start: tt(st.when), offset: st.offset, dur: st.duration, loop: st.loop, stop: stopOf(info), rate: param(src.playbackRate.__lpLog) };
    };
    const started = x => x.src.__lpInfo && x.src.__lpInfo.starts.length;
    const voices = J.voices.filter(started).map(({ src, g, chain }) => Object.assign(base(src), {
      gain: g ? param(g.gain.__lpLog) : null,
      fx: chain && chain.__lpMeta ? chain.__lpMeta : null,
      fxLog: chain && chain.__lpFxLog ? chain.__lpFxLog.map(([c, fx, r]) => [tt(c), fx, r]) : []
    }));
    const sfx = J.sfx.filter(started).map(({ src, voice }) => {
      const sp = voice && voice.__lpSpatial;
      return Object.assign(base(src), { spatial: sp ? { sp: sp.sp, stepIndex: sp.stepIndex, calls: sp.calls.map(c => [tt(c[0])].concat(c.slice(1))) } : null });
    });
    const masterLog = trackMasterGain.gain.__lpLog;
    const all = voices.concat(sfx);
    return JSON.parse(JSON.stringify({
      v: 1, kind: 'layerpitch-take', trackId: track.id, publishedAt: track.publishedAt || null, recordedAt: J.recordedAt,
      duration: tt(endCtx), complete: J.pausedAt != null, missing: all.filter(x => !x.url).length,
      // Retard propre aux effets à ScriptProcessor (bitcrusher, pitch-shift) EN DIRECT : le rendu hors-ligne, plus rapide,
      // en a un plus court -- il ajoute la différence pour que ces voix restent calées comme à l'écoute (Sfx compris).
      fxLatencySec: fxSpLatencySec(ctx),
      sampleRate: ctx.sampleRate, // le rendu se fait à la même fréquence : mêmes fichiers décodés, mêmes réverbérations
      voices, sfx,
      // Gain maître : commandes passées pendant une pause (autre morceau lancé, remise à 1 d'un arrêt) écartées -- rien
      // ne sonnait, et elles changeraient une prise déjà close.
      master: { init: J.master0, auto: masterLog ? masterLog.auto.slice(J.masterFrom).filter(e => !pauses.some(([a, b]) => e[1] > a + 1e-6 && e[1] < b)).map(e => [e[0], tt(e[1])].concat(e.slice(2))) : [] },
      yaw: [[0, J.yaw0]].concat(_takeYawLog.slice(J.yawFrom).filter(([c]) => c >= J.startCtx && c <= endCtx).map(([c, y]) => [tt(c), y]))
    }));
  };
  // Ducking : abaisse brièvement le gain maître du morceau pendant qu'un Sfx réglé pour ça est en train
  // de jouer, pour le mettre en valeur, puis remonte — réglage propre à chaque Sfx (duckMainTrack), pas
  // au morceau. Rampes linéaires plutôt qu'un changement instantané, moins désagréable à l'oreille.
  // Baisse plafonnée à 30% (DUCK_LEVEL = 0.7) : la descente reste rapide et nette, mais la remontée
  // démarre dès la moitié du Sfx et s'étale sur une rampe longue — quitte à se terminer après la fin du
  // Sfx lui-même, plutôt que la remontée courte et collée à la toute fin d'avant.
  function duckMainTrack(sfxDurationSec, atTime) {
    const now = atTime != null ? atTime : ctx.currentTime;
    trackMasterGain.gain.cancelScheduledValues(now);
    trackMasterGain.gain.setValueAtTime(trackMasterGain.gain.value, now);
    trackMasterGain.gain.linearRampToValueAtTime(DUCK_LEVEL, now + DUCK_ATTACK_SEC);
    const restoreAt = now + Math.max(DUCK_ATTACK_SEC, sfxDurationSec / 2);
    trackMasterGain.gain.setValueAtTime(DUCK_LEVEL, restoreAt);
    trackMasterGain.gain.linearRampToValueAtTime(1, restoreAt + DUCK_RELEASE_SEC);
  }

  // Paramètres du moteur quantifié (BPM/mesures + queue de fin superposée) — ignorés si useQuantizedLoop est faux
  const { bpm, beatsPerBar, secondsPerBeat } = trackTempo(track);
  const { loopInSec, loopOutSec, cycleLength, startTrackSec } = quantizedLoopTiming(track);
  // Pour vertical-random, track.duration reflète le fichier le PLUS LONG de tout le pool (couches fixes
  // + toutes les alternatives de tous les groupes), pas la longueur du cycle qui boucle réellement —
  // un seul alternative par groupe joue à la fois, souvent bien plus courte que la plus longue du pool.
  // Sans ce plafond, cliquer loin dans la barre programme un bufferOffset au-delà de la longueur réelle
  // des buffers en cours de lecture (silence, plus de boucle). Les autres modes gardent track.duration :
  // toutes leurs couches partagent la même durée par convention, donc pas le même risque.
  // Fonction plutôt que valeur figée : track.duration n'est connu avec certitude qu'une fois le
  // décodage terminé (voir plus bas), donc on le relit à chaque appel plutôt que de le geler trop tôt.
  // Pour vertical-random, la durée affichée est celle du cycle de la section EN COURS (celle qui joue
  // réellement, ou à défaut la première jouable avant tout démarrage) — plus un tempo unique partagé par
  // tout le morceau, chaque section ayant désormais sa propre timeline (30/07).
  function progressMaxSec() {
    if (!isVerticalRandom) return track.duration;
    const origIdx = vrCurrentSectionOriginalIndex >= 0 ? vrCurrentSectionOriginalIndex : (playableSectionOriginalIndex[0] !== undefined ? playableSectionOriginalIndex[0] : -1);
    if (origIdx < 0) return track.duration;
    const section = resolveVRSection(track, origIdx);
    return (section ? sectionTiming(section).loopOutSec : 0) || track.duration;
  }
  // StartTrackPoint (startTrackSec, calculé plus haut par quantizedLoopTiming) : où démarre la toute première lecture
  // (permet de sauter un silence en tête). Ne s'applique qu'au moteur quantifié — le moteur simple garde son
  // comportement natif inchangé.

  const playBtn = wrapper.querySelector('[data-role="playBtn"]');
  const stopBtn = wrapper.querySelector('[data-role="stopBtn"]');
  const playIcon = wrapper.querySelector('[data-role="playIcon"]');
  const details = wrapper.querySelector('[data-role="details"]');
  const statusEl = wrapper.querySelector('[data-role="status"]');
  const wrap = wrapper.querySelector('[data-role="progressWrap"]');
  const progressTrackEl = wrapper.querySelector('[data-role="progressTrack"]');
  const fill = wrapper.querySelector('[data-role="progressFill"]');
  const head = wrapper.querySelector('[data-role="progressHead"]');
  // Barre de progression "à deux états" (Chantier Apparence par élément, palier Pro, 05/09) : simple
  // barre CSS (pas un canvas), donc appliquée une seule fois en style inline plutôt que reconstruite à
  // chaque tick -- même repli que la forme d'onde si non réglée (couleurs générales inchangées).
  if (elementColors && elementColors.progressBar) {
    if (progressTrackEl && elementColors.progressBar.unplayedColor) progressTrackEl.style.background = elementColors.progressBar.unplayedColor;
    if (elementColors.progressBar.playedColor) {
      if (fill) fill.style.background = elementColors.progressBar.playedColor;
      if (head) head.style.background = elementColors.progressBar.playedColor;
    }
  }
  // Recale max-height si le contenu change de taille pendant que la piste est dépliée (ex. le statut
  // qui passe de "Chargement…" à "Prêt", ou une waveform qui apparaît) — sinon la hauteur mesurée au
  // moment du dépli deviendrait obsolète et couperait ou laisserait un vide sous le contenu.
  const detailsInnerEl = details.querySelector('.track-row-details-inner');
  if (detailsInnerEl && window.ResizeObserver) {
    new ResizeObserver(() => {
      if (details.classList.contains('expanded')) details.style.maxHeight = detailsInnerEl.scrollHeight + 'px';
    }).observe(detailsInnerEl);
  }
  // Waveform (mode statique uniquement — une seule couche jouée à la fois, donc "la" forme d'onde du
  // morceau a un sens ; ambigu pour vertical/vertical-random où plusieurs couches sonnent ensemble).
  const waveformBg = wrapper.querySelector('[data-role="waveformBg"]');
  const waveformFg = wrapper.querySelector('[data-role="waveformFg"]');
  let waveformBuffer = null;
  function redrawWaveforms() {
    renderWaveformPair(waveformBg, waveformFg, waveformBuffer, waveBgColor, waveFgColor);
  }
  if (waveformBg && waveformFg) {
    // Redessine si le contraste renforcé change (couleurs différentes) ou si le conteneur change de taille
    // (redimensionnement de fenêtre, ou premier dépli depuis l'état replié).
    document.addEventListener('layerpitch-contrast-changed', redrawWaveforms);
    if (window.ResizeObserver) new ResizeObserver(redrawWaveforms).observe(waveformBg);
  }
  const timeCurrent = wrapper.querySelector('[data-role="timeCurrent"]');
  const timeTotal = wrapper.querySelector('[data-role="timeTotal"]');
  const notchDots = [...wrapper.querySelectorAll('.intensity-chip')];
  const embrLoopBtns = [...wrapper.querySelectorAll('.embr-loop-btn')];
  const stingerBtns = [...wrapper.querySelectorAll('.stinger-btn')];
  const loopCountSelect = wrapper.querySelector('[data-role="loopCountSelect"]');
  const chainLoopCountSelect = wrapper.querySelector('[data-role="chainLoopCountSelect"]');
  // Vertical-random (fusionné avec l'ex-"vertical random séquentiel" le 30/07) : le graphe affiche des
  // "emplacements de voix" génériques (pool-0, pool-1, ...), dimensionnés au plus grand nombre de pools
  // parmi toutes les sections — quand la section en cours en a moins, les emplacements excédentaires sont
  // simplement masqués (même mécanisme que les tirages silencieux déjà existants), plutôt que de
  // reconstruire le graphe en HTML à chaque changement de section.
  const vrMaxPoolCount = isVerticalRandom ? Math.max(0, ...(track.sections || []).map((s, i) => (resolveVRSection(track, i) || {}).pools?.length || 0)) : 0;
  const voiceWavePools = Array.from({ length: vrMaxPoolCount }, (_, pi) => ({
    bg: wrapper.querySelector(`[data-role="voiceWaveBg-${pi}"]`),
    fg: wrapper.querySelector(`[data-role="voiceWaveFg-${pi}"]`)
  }));
  const voiceCurrents = Array.from({ length: vrMaxPoolCount }, (_, pi) => wrapper.querySelector(`[data-role="voiceCurrent-${pi}"]`));
  // Dessine la waveform d'une voix vertical-random (alternative piochée dans un pool) — même principe
  // fond/avant-plan que la waveform du mode statique et les blocs du mode séquentiel.
  function drawVoiceWave(els, buffer) {
    if (!els || !els.bg || !els.fg || !buffer) return;
    renderWaveformPair(els.bg, els.fg, buffer, waveBgColor, waveFgColor);
  }
  // Graphe de nœuds façon Wwise (Voice Graph) pour vertical-random : source -> une voix par emplacement
  // de pool -> bus de sortie, reliés par des connecteurs courbes dessinés en SVG. Le nombre d'emplacements
  // est fixe pour un morceau donné (seul le libellé/l'état de chaque emplacement change selon la section
  // en cours et le tirage), donc les connecteurs ne sont redessinés qu'au premier rendu, au
  // redimensionnement, et quand un emplacement apparaît/disparaît (changement de section).
  const wwiseGraphEl = wrapper.querySelector('[data-role="wwiseGraph"]');
  const wwiseLinesEl = wrapper.querySelector('[data-role="wwiseLines"]');
  const wwiseSourceEl = wrapper.querySelector('[data-role="wwiseSource"]');
  const wwiseBusEl = wrapper.querySelector('[data-role="wwiseBus"]');
  const wwisePoolVoiceEls = Array.from({ length: vrMaxPoolCount }, (_, pi) => wrapper.querySelector(`[data-role="wwiseVoice-pool-${pi}"]`));
  const wwiseVoiceEls = wwisePoolVoiceEls;
  function drawWwiseLines() {
    if (!wwiseGraphEl || !wwiseLinesEl || !wwiseSourceEl || !wwiseBusEl) return;
    const rect = wwiseGraphEl.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    wwiseLinesEl.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    wwiseLinesEl.innerHTML = '';
    const srcRect = wwiseSourceEl.getBoundingClientRect();
    const busRect = wwiseBusEl.getBoundingClientRect();
    const srcPoint = { x: srcRect.right - rect.left, y: srcRect.top + srcRect.height / 2 - rect.top };
    const busPoint = { x: busRect.left - rect.left, y: busRect.top + busRect.height / 2 - rect.top };
    wwiseVoiceEls.forEach(voiceEl => {
      if (!voiceEl || voiceEl.style.display === 'none') return; // voix actuellement silencieuse : pas de connecteur vers du vide
      const vRect = voiceEl.getBoundingClientRect();
      const vLeft = { x: vRect.left - rect.left, y: vRect.top + vRect.height / 2 - rect.top };
      const vRight = { x: vRect.right - rect.left, y: vRect.top + vRect.height / 2 - rect.top };
      const mid1 = (srcPoint.x + vLeft.x) / 2;
      const path1 = document.createElementNS(svgNS, 'path');
      path1.setAttribute('d', `M ${srcPoint.x} ${srcPoint.y} C ${mid1} ${srcPoint.y}, ${mid1} ${vLeft.y}, ${vLeft.x} ${vLeft.y}`);
      path1.setAttribute('class', 'wwise-line');
      wwiseLinesEl.appendChild(path1);
      const mid2 = (vRight.x + busPoint.x) / 2;
      const path2 = document.createElementNS(svgNS, 'path');
      path2.setAttribute('d', `M ${vRight.x} ${vRight.y} C ${mid2} ${vRight.y}, ${mid2} ${busPoint.y}, ${busPoint.x} ${busPoint.y}`);
      path2.setAttribute('class', 'wwise-line');
      wwiseLinesEl.appendChild(path2);
    });
  }
  if (wwiseGraphEl) {
    requestAnimationFrame(drawWwiseLines); // laisse le temps à un premier passage de mise en page
    if (window.ResizeObserver) new ResizeObserver(drawWwiseLines).observe(wwiseGraphEl);
  }
  // Vumètres du mode vertical classique — remplissage en direct sur le vrai gain de chaque couche,
  // visible pendant le fondu enchaîné quand l'intensité change (voir tick() plus bas).
  const vertMeterFills = (track.mode === 'vertical' ? track.layers : []).map((l, i) => wrapper.querySelector(`[data-role="vertMeter-${i}"] .voice-meter-bar-fill`));
  const seqMeterEl = wrapper.querySelector('[data-role="seqMeter"]');
  const seqCurrentEl = wrapper.querySelector('[data-role="seqCurrent"]');
  // Texte affiché par-dessus la description du morceau pendant la lecture séquentielle — mis à jour
  // uniquement quand l'emplacement/transition en cours en déclare un (voir pickStageDescription()) : un
  // champ vide laisse volontairement le texte précédent affiché plutôt que de revenir à la description du
  // morceau (ex. une intro sans texte propre doit laisser voir la description du morceau jusqu'au premier
  // emplacement qui en a un — comportement demandé explicitement le 15/08, obtenu gratuitement par cette
  // règle "ne jamais écraser par du vide" sans cas particulier à coder).
  const trackDescEl = wrapper.querySelector('[data-role="trackDesc"]');
  const seqPendingIndicatorEl = wrapper.querySelector('[data-role="seqPendingIndicator"]');
  // Carte globale des chemins (02/09) -- voir updateSeqMap()/drawSeqMapLines() plus bas.
  // Carte globale des chemins (02/09) : .seq-map-graph est la fenêtre défilable (overflow-x:auto),
  // .seq-map-canvas le contenu dimensionné par JS (voir updateSeqMap()), .seq-map-lines/.seq-map-nodes
  // deux calques superposés à l'intérieur de ce contenu. Positions calculées en JS, sans mesure DOM en
  // mode 'compact' (pas besoin de ResizeObserver, contrairement au graphe Wwise voisin/drawWwiseLines) --
  // MAIS le mode 'roomy' (10/09, pages publiques) mesure bel et bien seqMapGraphEl.clientWidth pour
  // s'adapter à la largeur réelle disponible (voir updateSeqMap()), donc redessiné au redimensionnement
  // comme le graphe Wwise, dans ce mode uniquement -- en 'compact', la taille ne dépend que du nombre
  // d'emplacements, ce ResizeObserver n'aurait rien à faire.
  const seqMapGraphEl = wrapper.querySelector('[data-role="seqMapGraph"]');
  // seqMapLastRoomyWidth : garde-fou contre une boucle de ResizeObserver observée en usage réel (Clarity,
  // 17/09) -- en mode 'roomy', updateSeqMap() dimensionne .seq-map-canvas selon seqMapGraphEl.clientWidth ;
  // si ce canvas devient plus large que l'espace dispo, la barre de défilement horizontale qui apparaît
  // (.seq-map-graph a overflow-x:auto) grignote sa hauteur, ce que la même ResizeObserver détecte aussi
  // (elle observe toute la content-box, pas juste la largeur) et redéclenche updateSeqMap() -- alors même
  // que la largeur, seule dimension qui nous intéresse ici, n'a pas changé. On ne relance donc que si elle
  // a effectivement bougé.
  let seqMapLastRoomyWidth = -1;
  if (seqMapGraphEl && window.ResizeObserver && currentSeqMapDensity() === 'roomy') {
    new ResizeObserver(() => {
      const w = seqMapGraphEl.clientWidth;
      if (w === seqMapLastRoomyWidth) return;
      seqMapLastRoomyWidth = w;
      updateSeqMap(seqMapLastCurrentIdx);
    }).observe(seqMapGraphEl);
  }
  const seqMapCanvasEl = wrapper.querySelector('[data-role="seqMapCanvas"]');
  const seqMapLinesEl = wrapper.querySelector('[data-role="seqMapLines"]');
  const seqMapNodesEl = wrapper.querySelector('[data-role="seqMapNodes"]');
  const goToEndBtn = wrapper.querySelector('[data-role="goToEndBtn"]');
  const goToNextSectionBtn = wrapper.querySelector('[data-role="goToNextSectionBtn"]');
  const sectionCurrentEl = wrapper.querySelector('[data-role="sectionCurrent"]');
  const vrBlockEls = (track.sections || []).map((s, i) => wrapper.querySelector(`[data-role="vrBlock-${i}"]`));
  const vrBlockFillEls = (track.sections || []).map((s, i) => wrapper.querySelector(`[data-role="vrBlockFill-${i}"]`));
  const vrSectionLoopSelectEls = (track.sections || []).map((s, i) => wrapper.querySelector(`[data-role="vrSectionLoop-${i}"]`));
  // Référence live vers les objets réellement lus par sectionScheduler.decideNext() à chaque cycle — les
  // muter en place (voir vrSectionLoopSelectEls ci-dessous) fait donc effet au vol, sans recréer le
  // scheduler ni interrompre la lecture en cours (même principe que track.maxLoops pour le moteur quantifié).
  let vrPlayableSectionRefs = [];

  let buffers = [], sources = [], gains = [], layerFxChains = []; // moteur simple
  let activeGenSources = []; // moteur quantifié : [{src, gain}], toutes générations (dont queues) confondues
  // ---- État moteur embranchement-vertical (voir bloc dédié plus bas pour la logique) ----
  let embrLoopBuffers = []; // un buffer par boucle déclarée (même ordre que track.loops), null si manquante
  let embrTransitionBuffers = []; // idem, un buffer de transition optionnel par boucle (24/08), null si absente/pas de fichier
  let embrActiveTransitionSources = []; // sources de transition actuellement en train de sonner -- suivies pour pouvoir les couper sur Stop (voir stopEmbrVertical)
  let embrActiveGenSources = []; // {src, gain, loopIdx} des générations "pairs" (même longueur que la référence) en cours
  let embrActiveLoopIdx = -1; // index (dans track.loops) de la boucle actuellement AUDIBLE
  let embrSchedulerTimer = null;
  let embrNextStartCtxTime = 0;
  let embrDetourTimeout = null; // minuterie du retour auto à la référence après une boucle courte
  let embrDetourSource = null; // {src, gain} du détour en cours, si il y en a un
  let embrDetourBtn = null; // bouton désactivé le temps de ce détour, si il y en a un
  // ---- Ajouts 24/08 : timing de bascule quantifié, minuteur de retour pour les boucles paires, mode
  // "en boucle jusqu'à un bouton" pour les boucles détour (voir bloc moteur dédié plus bas) ----
  // Horloge de phase de l'embranchement-vertical (position dans le cycle, en temps NOMINAL du fichier) : morceaux de droite
  // { ctx, nominal, ratio }. Un changement de vitesse (27/09) ne s'entend qu'à la génération suivante : l'horloge
  // change de pente à cet instant-là, pas avant -- sinon la jauge sautait et les bascules quantifiées tombaient à côté
  // pendant la fin de la boucle en cours.
  let embrClock = [{ ctx: 0, nominal: 0, ratio: 1 }];
  function embrClockReset(ctxT, nominal) { embrClock = [{ ctx: ctxT, nominal: nominal || 0, ratio: trackPitchRatio }]; }
  function embrClockSegAt(t) { let seg = embrClock[0]; for (const x of embrClock) if (x.ctx <= t) seg = x; return seg; }
  function embrNominalAt(t) { const seg = embrClockSegAt(t); return seg.nominal + (t - seg.ctx) * seg.ratio; }
  // Une génération démarre à ctxT avec la vitesse en vigueur : nouveau morceau de droite si la vitesse change, et
  // l'animation des lignes riches reprend sa cadence à l'instant où la nouvelle vitesse devient audible.
  function embrClockAtGeneration(ctxT) {
    const last = embrClock[embrClock.length - 1];
    if (Math.abs(last.ratio - trackPitchRatio) < 1e-9) return;
    embrClock.push({ ctx: ctxT, nominal: embrNominalAt(ctxT), ratio: trackPitchRatio });
    const keepFrom = embrClock.findIndex(x => x.ctx > ctx.currentTime);
    if (keepFrom > 1) embrClock = embrClock.slice(keepFrom - 1);
    // Position et vitesse lues à l'instant du changement (pas à l'heure du minuteur, qui peut partir un peu avant).
    const ratioAt = trackPitchRatio;
    voiceGraphTimeouts.push(setTimeout(() => {
      if (!playing) return;
      const cycle = embrCycleLengthSec();
      const t = Math.max(ctx.currentTime, ctxT);
      const pos = cycle > 0 ? ((embrNominalAt(t) % cycle) + cycle) % cycle : 0;
      applyEmbrWaveAnimation(pos, ratioAt);
    }, Math.max(0, (ctxT - ctx.currentTime) * 1000)));
  }
  let embrPendingSwitchTimeout = null; // bascule quantifiée en attente (annulée/remplacée si un nouveau clic arrive avant qu'elle ne s'exécute)
  let embrAutoReturnTimeout = null; // minuterie de retour auto d'une boucle PAIRE (différent de embrDetourTimeout, qui concerne les boucles courtes)
  let embrEndLoopBtnEl = null; // bouton "Mettre fin à la boucle" inséré dynamiquement pendant un détour en mode "en boucle jusqu'à un bouton"
  let embrIntroLockTimeout = null; // verrouillage des boutons pendant le segment Départ→Entrée de la référence au tout premier lancement (29/08) -- voir playEmbrVertical()
  let embrPendingTransitionSwitchTimeout = null; // bascule réelle en attente le temps qu'un fichier de transition finisse de jouer (29/08, voir performEmbrSwitch) -- distinct de embrPendingSwitchTimeout (quantification), les deux peuvent s'enchaîner
  let currentGainNodes = []; // moteur quantifié : gains de la génération la plus récente, par couche (contrôle d'intensité en direct)
  let schedulerTimer = null;
  let voiceGraphTimeouts = [];
  let nextGenStartCtxTime = 0, nextGenBufferOffset = 0;
  // Historique des générations programmées : { ctxStartTime, bufferOffset }. Sert à retrouver la position
  // RÉELLEMENT audible à un instant donné (voir currentPlaybackOffset ci-dessous) — pas simplement "la dernière
  // programmée", qui à cause du lookahead scheduler (jusqu'à 1s d'avance) peut encore être dans le futur au
  // moment où on la lit, ce qui donnait une tête de lecture visuellement en avance sur le son.
  let scheduledGens = [];
  function currentPlaybackOffset() {
    let chosen = null;
    for (const g of scheduledGens) {
      if (g.ctxStartTime <= ctx.currentTime && (!chosen || g.ctxStartTime > chosen.ctxStartTime)) chosen = g;
    }
    if (!chosen) return 0;
    return Math.min(chosen.bufferOffset + (ctx.currentTime - chosen.ctxStartTime) * (chosen.ratio || trackPitchRatio), progressMaxSec());
  }
  // Nombre de boucles (moteur quantifié) : loopsPlayed compte les passages programmés par le scheduler
  // récurrent (pas le tout premier, déclenché directement par playQuantized). Une fois track.maxLoops
  // atteint (si non nul), on arrête de programmer de nouvelles générations et on laisse la dernière
  // en cours filer seule jusqu'à sa fin naturelle (l'outro = la queue déjà présente dans le fichier).
  let loopsPlayed = 0;
  let lastGenSources = [];
  let finalGenerationMarkerSrc = null;

  // Spécifique au mode vertical-random (fusionné avec l'ex-"vertical random séquentiel" le 30/07)
  // sectionBuffers[secIdx][poolIdx] = [buffer, buffer, ...] pour chaque alternative jouable de ce pool,
  // secIdx étant l'index DÉCLARÉ de la section (pas résolu) — une section qui duplique une autre
  // (referencesSectionId) pointe directement vers le MÊME tableau que sa source (pas une copie), exactement
  // comme les groupes/emplacements dupliqués des autres modes. L'anti-répétition par pool se garde donc par
  // identifiant canonique (l'id du pool réellement porteur du contenu), pas par index brut.
  let sectionBuffers = [];
  let lastPickedPoolIndex = {}; // lastPickedPoolIndex[canonicalPoolId] = index de la dernière alternative tirée pour ce pool
  // playableSectionOriginalIndex[i] = index RÉEL dans track.sections pour la i-ème section jouable — le
  // scheduler pur (createSectionPlaybackScheduler) ne connaît que des positions 0..N-1 parmi les sections
  // jouables, il faut donc toujours repasser par cette table pour retrouver la vraie section (et ses
  // buffers déjà chargés) à jouer.
  let playableSectionOriginalIndex = [];
  let sectionScheduler = null; // recréé à chaque vrai démarrage (pas une reprise), voir playVerticalRandom
  function canonicalPoolKey(secIdx, poolIdx) {
    const section = resolveVRSection(track, secIdx);
    const pool = (section && section.pools || [])[poolIdx];
    return (pool && pool.referencesPoolId) || (pool && pool.id) || ('s' + secIdx + 'p' + poolIdx);
  }
  function pickPoolAlternativeIndex(secIdx, poolIdx) {
    const section = resolveVRSection(track, secIdx);
    const pool = (section && section.pools || [])[poolIdx];
    const bufs = (sectionBuffers[secIdx] && sectionBuffers[secIdx][poolIdx]) || [];
    const n = bufs.length;
    if (n === 0) return -1;
    const key = canonicalPoolKey(secIdx, poolIdx);
    let idx = Math.floor(Math.random() * n);
    if (pool && pool.avoidImmediateRepeat && n > 1) {
      while (idx === lastPickedPoolIndex[key]) idx = Math.floor(Math.random() * n);
    }
    lastPickedPoolIndex[key] = idx;
    return idx;
  }
  // Minutage d'une section résolue (bpm/mesures/timeline propres à CETTE section — plus un tempo unique
  // partagé par tout le morceau, voir décision du 30/07). Calculé à la demande plutôt que figé une fois,
  // puisque la section "courante" change au fil de la lecture.
  function sectionTiming(section) { return vrSectionTiming(section); }

  // Buffers des Sfx attachés : un tableau de buffers (une entrée par variation round robin) par Sfx,
  // indexé par son id — remplace l'ancien tableau plat "un buffer par stinger".
  let sfxBuffersById = {};
  let sfxLastIndexById = {}; // dernier index tiré par Sfx (anti-répétition aléatoire / avance séquentielle)
  let activeStingerSources = [];

  // introBuffer/outroBuffer : partagés entre séquentiel et vertical-random (même forme de champs, fusion
  // du 30/07) — jamais utilisés par les deux modes à la fois, un morceau n'ayant qu'un seul mode.
  let introBuffer = null, outroBuffer = null;
  // slotBuffers[s] = [buffer, buffer, ...] pour chaque alternative jouable de l'emplacement s — même
  // principe que sectionBuffers du vertical-random (y compris la duplication/référence pour économiser la
  // mémoire, voir canonicalPoolKey plus bas), mais ici l'ORDRE des emplacements compte en plus : ils
  // s'enchaînent dans l'ordre défini par le compositeur (contrairement aux pools d'une même section, qui
  // jouent tous simultanément et n'ont pas de notion d'ordre entre eux).
  let slotBuffers = [];
  // transitionBuffers[s][o] = buffer du fichier de transition déclaré pour le o-ième embranchement sortant
  // de l'emplacement s (nextOptions[o].transition), ou null si aucun n'est défini pour cette paire précise
  // — chaque embranchement a le sien, contrairement à slotBuffers qui est par emplacement (voir schéma
  // "Embranchement séquentiel avec transitions" validé le 02/08).
  let transitionBuffers = [];
  const seqTransitionDefByBuffer = new Map(); // fichier de transition décodé -> sa définition (effets propres, 27/09)
  let lastPickedSlotAltIndex = {}; // lastPickedSlotAltIndex[canonicalSlotId] = index de la dernière alternative tirée pour ce pool — partagé entre tous les emplacements qui dupliquent le même pool (ex. structure AABA : les deux "A" évitent la même dernière alternative jouée)
  let currentSlotIndex = 0; // position dans le cycle d'emplacements ; boucle sur elle-même (0,1,...,N-1,0,1,...)
  let currentSlotRepeatsPlayed = 0; // combien de fois l'emplacement courant a déjà rejoué depuis qu'on y est arrivé, pour respecter repeatCount avant de passer au suivant
  // Embranchement séquentiel (optionnel, par emplacement — voir schéma `nextOptions` validé le 31/07,
  // étendu le 02/08 avec `quantization`/`cutStyle`/`transition` par embranchement) : id de l'emplacement
  // choisi par le visiteur, en attente d'être consommé par performSeqBranchCut(). Un nouveau clic écrase
  // la valeur précédente (dernier clic gagne) ; remis à null une fois consommé.
  let pendingNextSegmentId = null;
  // Carte globale des chemins (02/09) : historique des emplacements déjà devenus audibles depuis le
  // (re)démarrage -- rien de tel n'existait avant ce chantier (aucun état de ce genre à réutiliser), voir
  // activateSeqStage() pour l'alimentation. seqMapFullReveal (posé par buildPreviewTrack() côté Backstage
  // uniquement) affiche la carte en entier dès le chargement -- outil de vérification de sa propre
  // structure pendant qu'on la construit ; côté public, révélation progressive comme demandé.
  let seqVisitedSlotIds = new Set();
  // Ordre aléatoire : slots entendus pendant le tour en cours (coches de la carte), tenu à partir de ce qui
  // est réellement joué -- chainState.order a souvent un tour d'avance (le slot suivant est préparé à l'avance).
  let seqRoundPlayedIds = new Set(), seqRoundLastIdx = -1;
  const seqMapFullReveal = !!track.seqMapFullReveal;
  const seqMapRandom = track.mode === 'sequential' && !!track.randomizeSections; // voir seqMapForwardTargets/seqMapComputeLayout
  // Boule de transition "en train de jouer" (05/09, retour direct : "est-ce que la boule qui symbolise la
  // transition peut se colorer lorsqu'elle joue ?") -- currentTransitionEdge identifie l'arête source->cible
  // dont le fichier de transition est actuellement audible (posé/retiré par activateSeqStage(), voir plus
  // bas), null le reste du temps. seqMapLastCurrentIdx retient le dernier index passé à updateSeqMap() pour
  // pouvoir la redessiner à l'identique (même nœud "current") au moment où une transition démarre/se termine,
  // sans devoir faire remonter cet index jusqu'ici depuis performSeqBranchCut().
  let currentTransitionEdge = null;
  let seqMapLastCurrentIdx = -1;
  // Amorçage à chaud de la disposition "à ressorts" (mode 'roomy', 10/09) -- positions du dernier calcul,
  // par emplacement, réutilisées comme point de départ du suivant plutôt que recalculées de zéro à chaque
  // updateSeqMap() (révélation progressive publique : la carte s'étend en douceur au lieu de sauter à
  // chaque nouvel emplacement révélé). Voir seqMapForceLayout().
  let seqMapForcePositions = {};
  let chainState = { cyclesCompleted: 0, capReached: false }; // compteur de cycles complets pour maxChainLoops — voir advanceChainIndex(), remis à zéro à chaque vrai redémarrage (pas une reprise)
  let seqSchedulerTimer = null;
  let seqNextStartCtxTime = 0;
  let seqActiveSources = []; // {src, gain} toutes générations confondues (dont queues en train de finir)
  let seqLastGenSources = [];
  let seqFinalMarkerSrc = null;
  let seqTimeouts = [];
  let goToEndRequested = false;
  // ---- État pour la coupure fine des embranchements séquentiels (voir schéma "quantization"/"cutStyle"/
  // "transition" validé le 02/08) — voir armNextSeqBranchBoundary()/performSeqBranchCut() plus bas. ----
  let forcedNextBlock = null; // bloc à jouer en priorité au prochain decideNextSeqBlock() (la transition injectée par une coupure), consommé et vidé aussitôt lu
  let seqBranchEpoch = 0; // incrémenté à chaque nouveau passage sur un emplacement et à chaque coupure — invalide les chaînes de vérification de frontière héritées d'un passage précédent (voir armNextSeqBranchBoundary)
  // Tempo effectif d'un emplacement séquentiel — même principe que sectionTiming() pour le vertical-random
  // (une seule formule de repli, réutilisée partout plutôt que dupliquée) : slot.bpm/beatsPerBar si réglés
  // sur CET emplacement, sinon le tempo du morceau.
  function slotTiming(slot) { return seqSlotTiming(track, slot); }
  // slot fourni ET porteur d'un tempo propre (bpm ou beatsPerBar) : grille de CET emplacement. Sinon (pas de slot, ou
  // slot sans réglage propre) : grille du morceau, comportement historique inchangé (track.bpm || 120).
  function blockSeconds(bars, slot) { return seqBlockSeconds(track, bars, slot); }
  // Tempo effectif d'un fichier de transition (nextOptions[].transition) — même principe de repli que
  // slotTiming(), mais à un niveau de plus : tempo propre à la transition si réglé, sinon celui de
  // l'emplacement source qu'on quitte, sinon celui du morceau. Distinct de slotTiming() car une transition
  // peut délibérément changer de tempo par rapport à l'emplacement qu'elle quitte (impact, riser...), alors
  // qu'un emplacement hérite normalement du morceau.
  function transitionTiming(tr, sourceSlot) { return seqTransitionTiming(track, tr, sourceSlot); }
  // Durée nominale d'un fichier de transition avant que le crossfade-tail classique vers la cible ne prenne
  // le relais (voir schéma "durationUnit" validé le 14/08, complété le 29/08 avec l'unité "temps"). Quatre
  // cas :
  // - `durationUnit` absent (transitions déjà publiées avant ce chantier) : comportement historique
  //   strictement inchangé, blockSeconds() sur le tempo de l'emplacement source — rétrocompatibilité totale.
  // - `durationUnit: 'bars'` : mesures sur le tempo PROPRE de la transition (transitionTiming), pas
  //   forcément celui de l'emplacement source.
  // - `durationUnit: 'beats'` (29/08) : temps individuels sur ce même tempo propre -- pour un réglage plus
  //   fin qu'une mesure entière (ex. un stinger d'1.5 temps). Même `transitionTiming()` que 'bars', sans la
  //   multiplication par beatsPerBar puisqu'on compte déjà des temps, pas des mesures.
  // - `durationUnit: 'seconds'` : durée brute en secondes, aucune notion de tempo.
  function transitionDurationSecFor(opt, sourceSlot) { return seqTransitionDurationSec(track, opt, sourceSlot); }
  function canonicalSlotKey(s) {
    const slot = (track.segmentSlots || [])[s];
    return (slot && slot.referencesSlotId) || (slot && slot.id) || ('s' + s);
  }
  // Pour un emplacement qui duplique un autre, ses propres "alternatives" sont vides (le contenu vit chez
  // la source) — on va chercher le bon libellé là où sont réellement les fichiers, plutôt que d'afficher
  // seulement le nom générique de l'emplacement.
  function resolveSlotAlternative(slotIdx, altIdx) {
    const slot = (track.segmentSlots || [])[slotIdx];
    if (!slot) return null;
    if (slot.referencesSlotId) {
      const source = (track.segmentSlots || []).find(sl => sl.id === slot.referencesSlotId);
      return (source && source.alternatives || [])[altIdx] || null;
    }
    return (slot.alternatives || [])[altIdx] || null;
  }
  function pickSlotAlternativeIndex(slotIdx) {
    const bufs = slotBuffers[slotIdx] || [];
    const n = bufs.length;
    if (n === 0) return -1;
    // L'anti-répétition (case à cocher) est réglée sur l'emplacement "porteur" du contenu quand celui-ci
    // est dupliqué ailleurs — dupliquer un pool n'a pas sa propre notion d'anti-répétition indépendante,
    // puisque le pool (et son historique de tirage) est justement partagé.
    const key = canonicalSlotKey(slotIdx);
    const sourceSlot = (track.segmentSlots || []).find(sl => sl.id === key) || (track.segmentSlots || [])[slotIdx];
    let idx = Math.floor(Math.random() * n);
    if (sourceSlot && sourceSlot.avoidImmediateRepeat && n > 1) {
      while (idx === lastPickedSlotAltIndex[key]) idx = Math.floor(Math.random() * n);
    }
    lastPickedSlotAltIndex[key] = idx;
    return idx;
  }
  // Prochain emplacement jouable dans le cycle, en partant de la position courante — saute silencieusement
  // les emplacements sans aucune alternative chargée (ex. tous les fichiers manquants) plutôt que de casser
  // la chaîne. Reste sur le même emplacement jusqu'à épuiser son repeatCount (nombre de répétitions avant
  // de passer au suivant) avant d'avancer dans la chaîne. Renvoie null s'il n'y a strictement aucun
  // emplacement jouable.
  function pickNextSegmentSlot() {
    const slots = track.segmentSlots || [];
    if (!slots.length) return null;
    for (let i = 0; i < slots.length; i++) {
      const slotIdx = currentSlotIndex;
      const altIdx = pickSlotAlternativeIndex(slotIdx);
      if (altIdx < 0) {
        // emplacement totalement vide : on l'ignore, on passe au suivant sans consommer de répétition
        currentSlotIndex = advanceChainIndex(currentSlotIndex, slots.length, chainState, track.maxChainLoops, !!track.randomizeSections);
        currentSlotRepeatsPlayed = 0;
        continue;
      }
      // Un emplacement à embranchements ne quitte JAMAIS sa position tout seul, quel que soit repeatCount
      // (qui n'a plus de sens ici) — l'avancement automatique n'a plus lieu d'être dès lors que le visiteur
      // peut cliquer pour choisir (validé le 02/08). Seule une coupure fine (performSeqBranchCut(), voir
      // plus bas) peut faire avancer currentSlotIndex pour un tel emplacement.
      if (slots[slotIdx].nextOptions && slots[slotIdx].nextOptions.length) {
        return { slotIdx, altIdx };
      }
      currentSlotRepeatsPlayed++;
      const repeatCount = Math.max(1, slots[slotIdx].repeatCount || 1);
      if (currentSlotRepeatsPlayed >= repeatCount) {
        currentSlotIndex = advanceChainIndex(currentSlotIndex, slots.length, chainState, track.maxChainLoops, !!track.randomizeSections);
        currentSlotRepeatsPlayed = 0;
      }
      // Un cycle complet de la chaîne vient d'atteindre la limite maxChainLoops (toutes deux causes
      // d'avancement ci-dessus y mènent pareil) : même mécanisme que "Aller vers la fin" manuel, pris en
      // compte au prochain decideNextSeqBlock() — l'emplacement en cours de programmation ici va tout de
      // même jusqu'à son terme, seul ce qui vient après bascule vers l'outro (ou la fin naturelle).
      if (chainState.capReached) { chainState.capReached = false; goToEndRequested = true; }
      return { slotIdx, altIdx };
    }
    return null; // aucun emplacement n'a la moindre alternative chargée
  }
  // Visualisation en blocs (intro / segment en cours / outro), qui se remplissent au rythme de la lecture —
  // demande directe d'un retour compositeur : "montrer un bloc pour le cue de départ qui se remplit en jouant,
  // puis un bloc pour la boucle tirée au sort, puis un bloc pour le cue de fin".
  const seqBlockEls = {
    intro: wrapper.querySelector('[data-role="seqBlock-intro"]'),
    segment: wrapper.querySelector('[data-role="seqBlock-segment"]'),
    outro: wrapper.querySelector('[data-role="seqBlock-outro"]')
  };
  // Chaque bloc affiche la vraie waveform du fichier qui y joue (pas un simple aplat de couleur) — pour
  // l'intro/l'outro le buffer est fixe, pour "segment" il change à chaque tirage et est donc recalculé
  // à chaque nouvelle activation. Même principe fond/avant-plan que la waveform du mode statique.
  const seqWaveEls = {
    intro: { bg: wrapper.querySelector('[data-role="seqWaveBg-intro"]'), fg: wrapper.querySelector('[data-role="seqWaveFg-intro"]') },
    segment: { bg: wrapper.querySelector('[data-role="seqWaveBg-segment"]'), fg: wrapper.querySelector('[data-role="seqWaveFg-segment"]') },
    outro: { bg: wrapper.querySelector('[data-role="seqWaveBg-outro"]'), fg: wrapper.querySelector('[data-role="seqWaveFg-outro"]') }
  };
  // Contrairement au mode statique et vertical-random, ce bloc n'avait jusqu'ici AUCUN redessin au
  // redimensionnement — le canevas restait figé à la taille capturée lors de son tout premier dessin
  // (ex. juste avant qu'une transition de layout ne se termine), d'où une forme d'onde qui semblait
  // "correcte sur une partie, plate ensuite" alors que le son continuait bel et bien. Même principe que
  // waveformBg/waveformFg (mode statique) et voiceWave* (vertical-random) : on retient le dernier buffer
  // dessiné par bloc (+ sa durée de rognage éventuelle) et on redessine dès que le conteneur change de taille.
  const seqLastBuffers = { intro: null, segment: null, outro: null };
  const seqLastCropSec = { intro: null, segment: null, outro: null };
  const seqBlocksContainer = wrapper.querySelector('.seq-blocks');
  if (seqBlocksContainer && window.ResizeObserver) {
    new ResizeObserver(() => {
      Object.keys(seqLastBuffers).forEach(k => { if (seqLastBuffers[k]) drawSeqBlockWave(k, seqLastBuffers[k], seqLastCropSec[k]); });
    }).observe(seqBlocksContainer);
  }
  // maxDurationSec (optionnel) : pour Intro/Segment, dont le fichier réel déborde volontairement au-delà
  // de sa durée musicale nominale (queue de recouvrement crossfade), n'affiche que la portion nominale —
  // la queue technique ne fait pas partie de "la" forme d'onde du bloc du point de vue du visiteur.
  // Pour l'Outro (pas de notion de durée nominale, fin ouverte), ce paramètre vaut simplement la durée
  // réelle du fichier : aucun rognage effectif, comportement inchangé.
  function drawSeqBlockWave(kind, buffer, maxDurationSec) {
    seqLastBuffers[kind] = buffer || seqLastBuffers[kind]; // conservé pour le redessin au resize (voir plus bas)
    seqLastCropSec[kind] = (maxDurationSec != null) ? maxDurationSec : seqLastCropSec[kind];
    const els = seqWaveEls[kind];
    if (!els || !els.bg || !els.fg || !buffer) return;
    renderWaveformPair(els.bg, els.fg, buffer, waveBgColor, waveFgColor, seqLastCropSec[kind]);
  }
  // État du bloc actuellement en cours de lecture, retenu pour permettre le seek (glisser sur sa waveform) :
  // sans ça, impossible de savoir quel buffer/gain relancer, ni à quelle position on se trouve réellement
  // dedans (le curseur visuel seul ne suffit pas — il faut aussi la référence temporelle audio exacte).
  let currentSeqBlockInfo = null; // { kind, buffer, gain, totalSec, virtualZero, terminal, slotIdx }
  // startCtxTime : instant AUDIO où ce bloc a démarré (25/09) -- origine exacte de la grille des mesures/temps des
  // coupures (armNextSeqBranchBoundary). Avant, l'heure de ce rappel (un minuteur, quelques ms en retard) servait
  // d'origine : les coupures tombaient quelques ms après la vraie barre de mesure.
  function activateSeqStage(kind, remainingSec, totalSec, buffer, gainValue, terminal, slotIdx, gainNode, fromSlotIdx, toSlotIdx, startCtxTime) {
    // Boule de transition en train de jouer (05/09) : posée uniquement pendant le stade "transition" lui-même,
    // retirée dès que n'importe quel autre stade devient audible (le seul qui suit systématiquement une
    // transition est le "segment" cible, mais un stop/seek peut aussi couper court -- dans tous les cas, plus
    // de transition en cours dès qu'on n'est plus sur "transition").
    if (kind === 'transition') {
      currentTransitionEdge = (fromSlotIdx != null && toSlotIdx != null) ? { from: fromSlotIdx, to: toSlotIdx } : null;
      updateSeqMap(seqMapLastCurrentIdx);
    } else if (currentTransitionEdge) {
      currentTransitionEdge = null;
    }
    const order = ['intro', 'segment', 'outro'];
    const idx = order.indexOf(kind);
    // Tout ce qui précède ce stade (hors "segment", qui se remplit à nouveau à chaque tirage plutôt que
    // de passer "fait") est figé plein — reflète la lecture qui vient réellement de passer ce point.
    order.forEach((k, i) => {
      if (i >= idx || k === 'segment') return;
      const block = seqBlockEls[k], els = seqWaveEls[k];
      if (!block) return;
      block.classList.remove('active'); block.classList.add('done');
      if (els && els.fg) { els.fg.style.transition = 'none'; els.fg.style.clipPath = 'inset(0 0% 0 0)'; }
    });
    const block = seqBlockEls[kind], els = seqWaveEls[kind];
    const startFraction = totalSec > 0 ? Math.max(0, Math.min(1, 1 - (remainingSec / totalSec))) : 0;
    currentSeqBlockInfo = { kind, buffer, gain: gainValue, gainNode: gainNode || null, totalSec, virtualZero: (startCtxTime != null ? startCtxTime : ctx.currentTime) - (startFraction * totalSec), terminal: !!terminal, slotIdx: (slotIdx != null ? slotIdx : -1) };
    // L'indicateur "en attente" reste pertinent quelle que soit la façon dont le choix a été fait (bouton,
    // retiré le 05/09 -- ou nœud de la carte globale) -- rafraîchi à chaque nouveau stade audible.
    updateSeqPendingIndicator();
    // Carte globale (02/09) : un emplacement rejoint l'historique dès qu'il devient audible -- alimente
    // seqVisitedSlotIds (rien de tel n'existait avant ce chantier). Pas de forme d'onde/progression sur le
    // nœud lui-même (retiré le 03/09, voir updateSeqMap()) -- juste rafraîchir quel nœud porte "current".
    if (kind === 'segment' && slotIdx != null && slotIdx >= 0) {
      seqVisitedSlotIds.add(slotIdx);
      updateSeqMap(slotIdx);
    }
    // Chaque nouveau passage sur UN emplacement (y compris une simple répétition du même) a ses propres
    // frontières de temps/mesure à surveiller — l'epoch invalide toute chaîne héritée d'un passage
    // précédent (voir armNextSeqBranchBoundary), pour ne jamais laisser deux chaînes tourner en parallèle.
    if (kind === 'segment' && slotIdx != null && slotIdx >= 0) {
      seqBranchEpoch++;
      const slot = (track.segmentSlots || [])[slotIdx];
      // "immediate" n'a pas besoin de surveillance de frontière : géré directement au clic (voir
      // handleSeqBranchChoice). Seuls "beat"/"bar" ont une frontière à attendre.
      if (slot && slot.nextOptions && slot.nextOptions.length && (slot.quantization || 'bar') !== 'immediate') {
        armNextSeqBranchBoundary(seqBranchEpoch);
      }
    }
    if (block) {
      block.classList.remove('done'); block.classList.add('active');
      if (buffer) drawSeqBlockWave(kind, buffer, totalSec);
      if (els && els.fg) {
        els.fg.style.transition = 'none'; els.fg.style.clipPath = `inset(0 ${(1 - startFraction) * 100}% 0 0)`;
        void els.fg.offsetWidth; // force le reflow avant de relancer la transition, sinon le navigateur la fusionne avec le reset ci-dessus
        if (remainingSec > 0) { els.fg.style.transition = `clip-path ${remainingSec}s linear`; els.fg.style.clipPath = 'inset(0 0% 0 0)'; }
      }
    }
    // Le passage à l'outro clôt définitivement le stade "segment" (plus de nouveau tirage à suivre).
    if (kind === 'outro' && seqBlockEls.segment && seqWaveEls.segment.fg) {
      seqBlockEls.segment.classList.remove('active'); seqBlockEls.segment.classList.add('done');
      seqWaveEls.segment.fg.style.transition = 'none'; seqWaveEls.segment.fg.style.clipPath = 'inset(0 0% 0 0)';
    }
  }
  function resetSeqStages() {
    currentSeqBlockInfo = null;
    Object.keys(seqBlockEls).forEach(k => {
      const block = seqBlockEls[k], els = seqWaveEls[k];
      if (block) block.classList.remove('active', 'done');
      if (els && els.fg) { els.fg.style.transition = 'none'; els.fg.style.clipPath = 'inset(0 100% 0 0)'; }
    });
  }
  // Choix d'un embranchement : appelé depuis un clic sur un nœud cliquable de la carte globale (voir
  // updateSeqMap()) -- seule façon de choisir désormais (les boutons de destination .seq-branch-btn ont
  // été retirés le 05/09, retour direct : "plus besoin des boutons de destination non plus, la carte se
  // suffit également à elle-même" -- la carte couvrait déjà exactement les mêmes cibles).
  function handleSeqBranchChoice(targetId, currentSlot) {
    // Dernier clic gagne (validé le 31/07) : un second clic sur une autre option remplace simplement le
    // choix précédent, il n'y a jamais de verrou sur le premier clic.
    pendingNextSegmentId = targetId;
    if (seqMapNodesEl) seqMapNodesEl.querySelectorAll('.seq-map-node').forEach(n => n.classList.toggle('pending', n.dataset.slotId === targetId));
    updateSeqPendingIndicator();
    trackPublicEvent('seq_branch_select', { trackId: track.id, targetId });
    // "immediate" (validé le 02/08) : pas de frontière à attendre, la coupure se déclenche directement au
    // clic — pour "beat"/"bar", c'est armNextSeqBranchBoundary (armée dès le début de CET emplacement dans
    // activateSeqStage) qui surveille déjà la prochaine frontière et lira ce choix à son tour.
    if (currentSlot && (currentSlot.quantization || 'bar') === 'immediate') performSeqBranchCut();
  }
  function updateSeqPendingIndicator() {
    if (!seqPendingIndicatorEl) return;
    seqPendingIndicatorEl.style.display = pendingNextSegmentId ? '' : 'none';
  }
  // ---- Carte globale des chemins (02/09, réécrite le même jour après un premier passage en grille en
  // flux -- voir CHANGELOG "reprise en flowchart" pour le contexte) : disposition en couches façon
  // flowchart, colonnes = distance (en arêtes AVANT) depuis le premier emplacement découvert, lignes =
  // ordre de première découverte au sein d'une colonne. Positions calculées entièrement en JS (pas de
  // mesure getBoundingClientRect comme drawWwiseLines()) -- un vrai graphe avec boucles a besoin de
  // connaître la colonne de la cible AVANT de choisir comment tracer l'arête (tout droit si elle avance,
  // en boucle si elle revient en arrière), ce que la seule position DOM ne donne pas. Dégradation (nombre
  // de nœuds simultanément visibles) : seuils repris de la même logique que le vertical à embranchement
  // (voir CHANGELOG pour le raisonnement détaillé des valeurs choisies) -- au-delà du plancher, repli sur
  // une simple liste de puces en flux, sans position ni arêtes (même principe que le repli compact déjà
  // utilisé côté embr-vertical). ----
  const SEQ_MAP_FULL_SIZE_MAX = 6, SEQ_MAP_DEGRADE_MAX = 14;
  // Écarts entre colonnes/lignes, et marges des boucles de retour, dépendants de la densité (10/09) --
  // fonctions plutôt que constantes fixes car currentSeqMapDensity() peut différer d'une page hôte à
  // l'autre (Backstage vs public) mais jamais PENDANT la vie d'une page (posé une fois par la page hôte
  // avant tout rendu, comme currentSeqMapTheme()) -- lues à chaque appel plutôt que figées une fois pour
  // ne pas dupliquer cette logique entre updateSeqMap() et seqMapDrawEdges(), qui en ont toutes deux besoin.
  function seqMapColGap() { return currentSeqMapDensity() === 'roomy' ? 56 : 40; }
  function seqMapRowGap() { return currentSeqMapDensity() === 'roomy' ? 24 : 16; }
  // Boucles de retour (03/09, retour direct "elles sont tracées un peu aléatoirement") : marge sous TOUTE
  // la grille avant la première boucle, puis un écart entre boucles successives -- voir seqMapDrawEdges.
  function seqMapLoopMargin() { return currentSeqMapDensity() === 'roomy' ? 32 : 22; }
  function seqMapLoopStagger() { return currentSeqMapDensity() === 'roomy' ? 26 : 18; }
  // Taille des nœuds en mode 'roomy' (pages publiques, 10/09) : "pleine" taille visée quand la place ne
  // manque pas, jamais dépassée même sur un très grand écran (un unique nœud géant serait absurde) --
  // plancher en dessous duquel .seq-map-graph prend le relais en défilement horizontal plutôt que des
  // cartes ratatinées. Largeur de repli si le conteneur n'est pas encore mesurable (ex. carte construite
  // avant d'être visible/dépliée, clientWidth encore à 0) : une largeur de carte plausible, pas 0.
  const SEQ_MAP_ROOMY_FULL_W = 148, SEQ_MAP_ROOMY_FULL_H = 56; // 24/09 : 168x64 -> 148x56 (« un peu surdimensionnée », Jules-Antoine)
  const SEQ_MAP_ROOMY_MIN_W = 112, SEQ_MAP_ROOMY_MIN_H = 46;
  const SEQ_MAP_ROOMY_FALLBACK_WIDTH = 640;
  // Une couleur par case (10/09, retour direct : "essayons une par case ?") -- identité stable de
  // l'emplacement (dérivée de son index dans segmentSlots, pas de l'ordre de révélation qui change en
  // cours de lecture), pas un indicateur d'état -- les états (courant/visité/sélectionnable) restent
  // portés par la bordure existante, cette couleur-ci n'apparaît qu'en filet sur le bord gauche (voir
  // CSS .seq-map-roomy .seq-map-node) pour ne jamais entrer en conflit visuel avec eux. Palette reprise
  // de l'ancienne palette des boucles de retour (retirée le 07/09, réutilisée ici pour un usage différent
  // -- identité de case, pas type d'arête).
  const SEQ_MAP_NODE_PALETTE = ['#4e79a7', '#59a14f', '#b07aa1', '#e15759', '#499894', '#d4a72c'];
  // Point sur le pourtour d'un nœud rectangulaire (centré en `from`, largeur/hauteur nodeW/nodeH), à
  // l'intersection avec le segment reliant `from` à `to` -- utilisé uniquement par la disposition "à
  // ressorts" ci-dessous (seqMapForceLayout), où les nœuds ne sont plus alignés en grille et une arête
  // peut arriver de n'importe quelle direction (contrairement à rightOf/leftOf/bottomOf, qui supposent un
  // flux strictement gauche-à-droite/haut-en-bas).
  function seqMapEdgePoint(from, to, nodeW, nodeH) {
    const dx = to.x - from.x, dy = to.y - from.y;
    if (!dx && !dy) return { x: from.x, y: from.y };
    const halfW = nodeW / 2, halfH = nodeH / 2;
    const scale = Math.min(dx ? halfW / Math.abs(dx) : Infinity, dy ? halfH / Math.abs(dy) : Infinity);
    return { x: from.x + dx * scale, y: from.y + dy * scale };
  }
  // Disposition "à ressorts" (10/09 -- la disposition en triangle qui la précédait, limitée à 3
  // emplacements, ne réglait qu'un cas précis ; retour direct : "essaie de résoudre la mise en
  // visualisation" pour des suites d'embranchements générées au hasard, avec ou sans retours). Algorithme
  // général type Fruchterman-Reingold : tous les nœuds se repoussent entre eux (jamais superposés, jamais
  // entassés), chaque arête tire ses deux extrémités l'une vers l'autre (jamais trop éloignées), relaxé
  // sur plusieurs itérations jusqu'à un arrangement stable -- se généralise naturellement au triangle pour
  // 3 nœuds mutuellement reliés, sans avoir besoin d'un cas particulier dédié. Les arêtes se tracent en
  // lignes directes entre pourtours de nœuds (seqMapEdgePoint), plus jamais en U sous la grille (qui n'a
  // plus de sens dès que les nœuds ne sont plus alignés en colonnes/lignes strictes) -- voir seqMapDrawEdges.
  //
  // Amorçage à chaud (seedPositions = seqMapForcePositions, persisté par instance de piste) : un
  // emplacement déjà positionné à l'appel précédent repart de LÀ, pas d'un point neutre -- sans ça, chaque
  // nouvel emplacement révélé (lecture publique, révélation progressive) aurait fait sauter TOUTE la
  // disposition existante au lieu de l'étendre en douceur. Un emplacement jamais vu est amorcé sur la
  // grille classique (layout.col/row) à l'échelle `k`, pas au hasard -- garde une tendance de lecture
  // gauche-à-droite cohérente avec le reste de la carte, la simulation affine ensuite depuis ce point de
  // départ plutôt que d'ignorer complètement la topologie.
  function seqMapForceLayout(visibleIdx, layout, w, h, seedPositions) {
    const k = Math.max(w, h) * 1.6; // distance "au repos" visée entre deux nœuds reliés par une arête (1,9 avant le 24/09 : carte trop grande)
    const pos = {};
    visibleIdx.forEach(idx => {
      pos[idx] = seedPositions[idx] ? { x: seedPositions[idx].x, y: seedPositions[idx].y } : { x: (layout.col[idx] || 0) * k, y: (layout.row[idx] || 0) * k };
      // Départ légèrement décalé (24/09) : deux nœuds de même colonne/ligne (ex. deux emplacements seulement, reliés dans les
      // deux sens) partaient exactement au même point -- direction de répulsion nulle, ils restaient superposés pour toujours.
      if (!seedPositions[idx]) { pos[idx].x += Math.cos(idx * 2.4) * 2; pos[idx].y += Math.sin(idx * 2.4) * 2; }
    });
    const visibleSet = new Set(visibleIdx);
    const edges = [];
    visibleIdx.forEach(idx => {
      seqMapForwardTargets(idx, visibleSet).forEach(ti => { if (ti !== idx) edges.push({ from: idx, to: ti }); });
    });
    const n = visibleIdx.length;
    let temp = k / 2;
    for (let iter = 0; iter < 220; iter++) {
      const disp = {};
      visibleIdx.forEach(idx => { disp[idx] = { x: 0, y: 0 }; });
      // Répulsion : chaque PAIRE de nœuds s'écarte, proportionnellement à k²/distance (classique
      // Fruchterman-Reingold) -- c'est ce terme, appliqué à TOUTE paire (pas seulement les nœuds reliés),
      // qui garantit qu'aucun couple ne finit jamais superposé ni collé, contrairement à la grille où deux
      // nœuds non reliés directement pouvaient partager la même colonne sans aucune force les séparant.
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = visibleIdx[i], b = visibleIdx[j];
          const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const force = (k * k) / dist;
          const ux = dx / dist, uy = dy / dist;
          disp[a].x += ux * force; disp[a].y += uy * force;
          disp[b].x -= ux * force; disp[b].y -= uy * force;
        }
      }
      // Attraction : chaque arête rapproche ses deux extrémités, proportionnellement à distance²/k --
      // équilibre la répulsion ci-dessus pour que les nœuds RELIÉS restent proches malgré tout.
      edges.forEach(e => {
        const dx = pos[e.from].x - pos[e.to].x, dy = pos[e.from].y - pos[e.to].y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const force = (dist * dist) / k;
        const ux = dx / dist, uy = dy / dist;
        disp[e.from].x -= ux * force; disp[e.from].y -= uy * force;
        disp[e.to].x += ux * force; disp[e.to].y += uy * force;
      });
      // Déplacement limité par la "température" (refroidie à chaque itération, recuit simulé classique) --
      // grands pas au début (échappe vite un mauvais point de départ), pas de plus en plus fins ensuite
      // (converge sans osciller indéfiniment autour de l'équilibre).
      visibleIdx.forEach(idx => {
        const dx = disp[idx].x, dy = disp[idx].y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const lim = Math.min(dist, temp);
        pos[idx].x += (dx / dist) * lim;
        pos[idx].y += (dy / dist) * lim;
      });
      temp *= 0.965;
    }
    visibleIdx.forEach(idx => { seedPositions[idx] = { x: pos[idx].x, y: pos[idx].y }; });
    // Normalise en coordonnées positives (coin haut-gauche de chaque nœud), avec une marge constante --
    // même principe que l'ancienne disposition en triangle qu'elle remplace.
    // Marge égale des quatre côtés autour de la BOÎTE ENGLOBANTE des nœuds (24/09, « toujours mal centrée ») : avant, la marge
    // de gauche/haut se calculait depuis le CENTRE du premier nœud (- w/2) alors que celle de droite/bas partait de son bord,
    // ce qui décalait tout le graphe vers la gauche et le haut dans son cadre.
    const pad = Math.max(w, h) * 0.35;
    const lefts = visibleIdx.map(idx => pos[idx].x - w / 2), tops = visibleIdx.map(idx => pos[idx].y - h / 2);
    const minL = Math.min(...lefts), minT = Math.min(...tops);
    const positions = {};
    let maxRight = 0, maxBottom = 0;
    visibleIdx.forEach(idx => {
      const p = { x: pos[idx].x - w / 2 - minL + pad, y: pos[idx].y - h / 2 - minT + pad };
      positions[idx] = p;
      maxRight = Math.max(maxRight, p.x + w);
      maxBottom = Math.max(maxBottom, p.y + h);
    });
    return { positions, totalW: maxRight + pad, totalH: maxBottom + pad };
  }
  // Ensemble des index d'emplacements à révéler pour l'état courant -- toujours tout en mode
  // seqMapFullReveal (Backstage), sinon déjà-visités + courant + options immédiates depuis le courant
  // (effet de découverte demandé le 1er septembre).
  function seqMapVisibleSlotIndices(currentIdx) {
    const slots = track.segmentSlots || [];
    if (seqMapFullReveal) return slots.map((s, i) => i);
    const visible = new Set(seqVisitedSlotIds);
    if (currentIdx >= 0) {
      visible.add(currentIdx);
      const cur = slots[currentIdx];
      ((cur && cur.nextOptions) || []).forEach(opt => {
        const ti = slots.findIndex(sl => sl.id === opt.targetId);
        if (ti >= 0) visible.add(ti);
      });
    }
    return [...visible];
  }
  // Cibles "en avant" d'un emplacement, restreintes aux emplacements révélés -- embranchement déclaré
  // (nextOptions) ou, à défaut, avancement automatique vers le suivant dans l'ordre du tableau (même
  // approximation volontaire que dans la première version : ne rejoue pas la logique de saut des
  // emplacements vides de pickNextSegmentSlot(), suffisante pour un aperçu topologique).
  function seqMapForwardTargets(idx, revealedSet) {
    const slots = track.segmentSlots || [];
    const slot = slots[idx];
    if (!slot) return [];
    const opts = slot.nextOptions || [];
    if (opts.length) return opts.map(o => slots.findIndex(sl => sl.id === o.targetId)).filter(ti => ti >= 0 && revealedSet.has(ti));
    // Ordre aléatoire (25/09) : aucune flèche "au suivant de la liste", qui annoncerait un ordre qui n'existe
    // pas -- seuls les embranchements (choix du visiteur, ci-dessus) gardent leurs flèches.
    if (seqMapRandom) return [];
    const nextIdx = (idx + 1) % slots.length;
    return (nextIdx !== idx && revealedSet.has(nextIdx)) ? [nextIdx] : [];
  }
  // Colonne = distance en arêtes AVANT depuis la racine (le premier emplacement découvert encore révélé,
  // ou l'emplacement 0 si rien n'a encore été découvert -- cas Backstage avant toute lecture), par simple
  // parcours en largeur sur le sous-graphe des emplacements révélés. Une arête vers un emplacement déjà
  // affecté à une colonne (boucle/retour) n'avance jamais sa colonne -- c'est justement ce qui la
  // distingue d'une avancée (voir seqMapDrawEdges, tracé en boucle plutôt qu'en ligne droite pour ces
  // arêtes-là). Ligne = position dans sa colonne, dans l'ordre de première découverte
  // (seqVisitedSlotIds étant un Set, son ordre d'itération EST l'ordre d'insertion -- aucun état
  // supplémentaire à tenir pour ça).
  function seqMapComputeLayout(visibleIdx, currentIdx) {
    const revealedSet = new Set(visibleIdx);
    const visitedOrder = [...seqVisitedSlotIds];
    if (seqMapRandom) {
      // Ordre aléatoire (25/09, validé par Jules-Antoine) : les slots forment un groupe sans ordre -- grille
      // de 4 de large, remplie dans l'ordre de découverte (un slot révélé s'ajoute au bout, rien ne bouge),
      // puis par index pour ceux pas encore joués (Backstage, tout révélé).
      const orderOf = idx => { const p = visitedOrder.indexOf(idx); return p === -1 ? Infinity : p; };
      const sorted = visibleIdx.slice().sort((a, b) => orderOf(a) - orderOf(b) || a - b);
      const perRow = Math.min(4, sorted.length);
      const col = {}, row = {};
      sorted.forEach((idx, i) => { col[idx] = i % perRow; row[idx] = Math.floor(i / perRow); });
      return { col, row, maxCol: Math.max(0, perRow - 1), maxRows: Math.max(1, Math.ceil(sorted.length / perRow)) };
    }
    const startIdx = visitedOrder.find(i => revealedSet.has(i));
    const root = startIdx != null ? startIdx : visibleIdx[0];
    const col = {};
    if (root != null) {
      col[root] = 0;
      const queue = [root];
      while (queue.length) {
        const idx = queue.shift();
        seqMapForwardTargets(idx, revealedSet).forEach(ti => {
          if (col[ti] == null) { col[ti] = col[idx] + 1; queue.push(ti); }
        });
      }
    }
    // Emplacement révélé mais jamais atteint par le parcours (composante détachée de la racine -- ne
    // devrait pas arriver en pratique étant donné comment revealedSet est construit, mais ne doit jamais
    // faire planter le rendu) : colonne 0 par défaut plutôt qu'un index manquant.
    visibleIdx.forEach(idx => { if (col[idx] == null) col[idx] = 0; });
    const orderOf = idx => { const p = visitedOrder.indexOf(idx); return p === -1 ? Infinity : p; };
    const byCol = {};
    visibleIdx.slice().sort((a, b) => orderOf(a) - orderOf(b) || a - b).forEach(idx => {
      (byCol[col[idx]] = byCol[col[idx]] || []).push(idx);
    });
    const row = {};
    Object.keys(byCol).forEach(c => byCol[c].forEach((idx, i) => { row[idx] = i; }));
    const maxCol = Math.max(0, ...visibleIdx.map(idx => col[idx]));
    const maxRows = Math.max(1, ...Object.values(byCol).map(arr => arr.length));
    return { col, row, maxCol, maxRows };
  }
  function updateSeqMap(currentIdx) {
    if (!seqMapNodesEl || !seqMapCanvasEl) return;
    seqMapLastCurrentIdx = currentIdx;
    const slots = track.segmentSlots || [];
    const visibleIdx = seqMapVisibleSlotIndices(currentIdx);
    if (!visibleIdx.length) {
      seqMapNodesEl.innerHTML = ''; if (seqMapLinesEl) seqMapLinesEl.innerHTML = '';
      seqMapCanvasEl.style.width = ''; seqMapCanvasEl.style.height = '';
      return;
    }
    // Nœuds cliquables (04/09) : uniquement ceux qui sont une vraie option depuis l'emplacement COURANT,
    // jamais un nœud "visité" par ailleurs qui n'est pas une option depuis ici -- on ne clique pas sur
    // l'historique, seulement sur ce qui est réellement proposé maintenant. Rien de sélectionnable hors
    // lecture (currentIdx < 0, ex. état "Prêt").
    const currentSlot = currentIdx >= 0 ? (slots[currentIdx] || null) : null;
    const selectableIds = new Set(((currentSlot && currentSlot.nextOptions) || []).map(o => o.targetId));
    // Coche "déjà joué" : en ordre aléatoire, seulement pour le tour en cours -- sinon, dès le 2e tour, tout
    // resterait coché et la carte ne dirait plus rien. Chaque slot joue une fois par tour : dès qu'un slot déjà
    // entendu revient, un nouveau tour a commencé. Ailleurs, inchangé : tout emplacement déjà visité.
    if (seqMapRandom && currentIdx >= 0 && currentIdx !== seqRoundLastIdx) {
      if (seqRoundLastIdx >= 0) seqRoundPlayedIds.add(seqRoundLastIdx);
      if (seqRoundPlayedIds.has(currentIdx)) seqRoundPlayedIds = new Set();
      seqRoundLastIdx = currentIdx;
    }
    const playedThisRound = seqMapRandom ? seqRoundPlayedIds : null;
    const wasPlayed = idx => (playedThisRound ? playedThisRound.has(idx) : seqVisitedSlotIds.has(idx));
    const nodeStateCls = (idx, slot) => {
      const isCurrent = idx === currentIdx;
      const isVisited = wasPlayed(idx) && !isCurrent;
      const isSelectable = selectableIds.has(slot.id);
      const isPending = pendingNextSegmentId === slot.id;
      return (isCurrent ? ' current' : '') + (isVisited ? ' visited' : '') + (isSelectable ? ' selectable' : '') + (isPending ? ' pending' : '');
    };
    const n = visibleIdx.length;
    const compact = n > SEQ_MAP_DEGRADE_MAX;
    seqMapNodesEl.classList.toggle('compact', compact);
    if (compact) {
      // Repli : simple liste de puces en flux, aucune position ni arête -- même esprit que le repli
      // compact déjà utilisé côté embr-vertical (au-delà du plancher, la topologie exacte importe moins
      // que rester lisible d'un coup d'œil).
      seqMapCanvasEl.style.width = ''; seqMapCanvasEl.style.height = '';
      if (seqMapLinesEl) seqMapLinesEl.innerHTML = '';
      seqMapNodesEl.innerHTML = visibleIdx.map(idx => {
        const slot = slots[idx] || {};
        const label = slot.label || t('slotFallback', { n: idx + 1 });
        const cls = 'seq-map-node' + nodeStateCls(idx, slot);
        const check = (wasPlayed(idx) && idx !== currentIdx) ? '<span class="seq-map-node-check">✓</span>' : '';
        return `<div class="${cls}" data-slot-idx="${idx}" data-slot-id="${escapeHtml(slot.id || '')}"><span class="seq-map-node-label">${escapeHtml(label)}</span>${check}</div>`;
      }).join('');
      attachSeqMapNodeClicks(currentSlot);
      return;
    }
    const layout = seqMapComputeLayout(visibleIdx, currentIdx);
    const roomy = currentSeqMapDensity() === 'roomy';
    let w, h;
    if (roomy) {
      // Mode 'roomy' (pages publiques, 10/09, retour direct : la maquette montrée était "agréable à
      // regarder", le vrai composant "tristounet" en comparaison, et devait pouvoir "s'adapter à la
      // fois à la taille de l'écran et au nombre d'embranchements") : contrairement au mode 'compact'
      // ci-dessous, la taille des nœuds dépend de la largeur RÉELLEMENT disponible -- seule mesure
      // DOM (clientWidth) de toute cette carte, dérogation volontaire au principe "tout en JS pur" du
      // commentaire plus haut, nécessaire ici car "s'adapter à l'écran" ne peut pas se déduire de la
      // seule topologie du graphe.
      const availableWidth = (seqMapGraphEl && seqMapGraphEl.clientWidth) || SEQ_MAP_ROOMY_FALLBACK_WIDTH;
      const cols = layout.maxCol + 1;
      const idealW = (availableWidth - (cols - 1) * seqMapColGap()) / cols;
      w = Math.max(SEQ_MAP_ROOMY_MIN_W, Math.min(SEQ_MAP_ROOMY_FULL_W, Math.round(idealW)));
      h = Math.max(SEQ_MAP_ROOMY_MIN_H, Math.round(SEQ_MAP_ROOMY_FULL_H * (w / SEQ_MAP_ROOMY_FULL_W)));
    } else {
      const span = SEQ_MAP_DEGRADE_MAX - SEQ_MAP_FULL_SIZE_MAX;
      const over = Math.max(0, Math.min(n, SEQ_MAP_DEGRADE_MAX) - SEQ_MAP_FULL_SIZE_MAX);
      w = Math.round(96 - over * (36 / span));
      h = Math.round(40 - over * (12 / span));
    }
    seqMapNodesEl.style.setProperty('--seq-map-node-w', w + 'px');
    seqMapNodesEl.style.setProperty('--seq-map-node-h', h + 'px');
    // Police proportionnelle uniquement en mode 'roomy' -- en 'compact', 10px fixe reste approprié même
    // au node le plus large (96px, taille "pleine" de ce mode), jamais aussi grand qu'un node 'roomy'.
    if (roomy) seqMapNodesEl.style.setProperty('--seq-map-node-font', Math.max(12, Math.round(w / 9)) + 'px');
    // Disposition "à ressorts" (10/09) en mode 'roomy' -- voir seqMapForceLayout ci-dessus pour le
    // pourquoi. Sinon (mode 'compact'), grille habituelle (colonnes/lignes déjà calculées par
    // seqMapComputeLayout) convertie en positions ABSOLUES une fois pour toutes ici -- seqMapDrawEdges ne
    // connaît plus que ces positions, ce qui lui permet de tracer des arêtes correctement quelle que soit
    // la disposition (grille ou ressorts) sans savoir laquelle des deux l'a produite.
    let positions, totalW, totalH;
    if (roomy && !seqMapRandom) { // ordre aléatoire : toujours la grille (sans flèches, les ressorts écarteraient les nœuds sans fin)
      ({ positions, totalW, totalH } = seqMapForceLayout(visibleIdx, layout, w, h, seqMapForcePositions));
    } else {
      const colGap = seqMapColGap(), rowGap = seqMapRowGap();
      const colW = w + colGap, rowH = h + rowGap;
      positions = {};
      visibleIdx.forEach(idx => { positions[idx] = { x: layout.col[idx] * colW, y: layout.row[idx] * rowH }; });
      totalW = (layout.maxCol + 1) * colW - colGap;
      // Marge verticale supplémentaire si des arêtes de retour existent -- chacune plonge volontairement
      // sous TOUTE la grille (voir seqMapDrawEdges), une par une, en s'étalant verticalement pour rester
      // distinctes. Sans cette marge elles seraient coupées par overflow-y:hidden sur .seq-map-graph (bug
      // trouvé en vérification visuelle réelle : la boucle existait bien dans le SVG mais restait invisible,
      // coupée sous le bord de la carte).
      const backEdgeCount = visibleIdx.reduce((n, idx) => n + seqMapForwardTargets(idx, new Set(visibleIdx)).filter(ti => layout.col[ti] <= layout.col[idx]).length, 0);
      totalH = layout.maxRows * rowH - rowGap + (backEdgeCount > 0 ? seqMapLoopMargin() + (backEdgeCount - 1) * seqMapLoopStagger() + Math.round(h / 2) + 6 : 0);
    }
    // Taille explicite sur le conteneur défilable (pas sur .seq-map-graph, qui reste la fenêtre visible) --
    // permet un défilement horizontal si le graphe est plus large que la carte, plutôt que l'effondrement
    // en une seule colonne trouvé en situation réelle avec la première version (nœuds superposés, arêtes
    // invisibles derrière eux, voir CHANGELOG).
    seqMapCanvasEl.style.width = totalW + 'px';
    seqMapCanvasEl.style.height = totalH + 'px';
    // Centré dans la carte (24/09, « toujours mal centrée ») : le canvas est dimensionné sur le graphe seul, plus petit
    // que la carte ; sans marges automatiques il restait collé à gauche. Sans effet s'il déborde (défilement).
    seqMapCanvasEl.style.marginLeft = 'auto';
    seqMapCanvasEl.style.marginRight = 'auto';
    // Ajusté à la largeur disponible (24/09, carte de l'aperçu du Backstage, panneau étroit) : en 'roomy', un graphe de plusieurs
    // nœuds dépasse la carte et obligeait à faire défiler horizontalement -- il est réduit d'un bloc (nœuds, flèches, texte)
    // jusqu'à 60 % au plus ; en dessous, le défilement reste le repli.
    if (roomy && seqMapGraphEl) {
      const cs = getComputedStyle(seqMapGraphEl);
      const avail = seqMapGraphEl.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const k = avail > 0 && totalW > avail ? Math.max(0.6, avail / totalW) : 1;
      seqMapCanvasEl.style.zoom = k < 1 ? String(k) : '';
    }
    // Pas de forme d'onde sur les nœuds (retiré le 03/09 sur retour direct de Jules-Antoine en situation
    // réelle -- en plus de ne pas être demandée ici, elle ne reflétait pas fidèlement le fichier : Corridor
    // et Battle s'arrêtaient visiblement à mi-chemin). L'état (courant/visité/pas encore atteint) se lit
    // uniquement via la bordure (voir CSS .seq-map-node.current/.visited) -- aucune donnée audio à charger
    // ni dessiner ici, juste le libellé. Couleur par case (10/09) : identité stable de l'emplacement (voir
    // SEQ_MAP_NODE_PALETTE) posée en filet CSS, uniquement consommée en 'roomy' -- inoffensive ailleurs.
    seqMapNodesEl.innerHTML = visibleIdx.map(idx => {
      const slot = slots[idx] || {};
      const label = slot.label || t('slotFallback', { n: idx + 1 });
      const cls = 'seq-map-node' + nodeStateCls(idx, slot);
      const check = (wasPlayed(idx) && idx !== currentIdx) ? '<span class="seq-map-node-check">✓</span>' : '';
      const accent = roomy ? SEQ_MAP_NODE_PALETTE[idx % SEQ_MAP_NODE_PALETTE.length] : null;
      const style = `left:${positions[idx].x}px;top:${positions[idx].y}px` + (accent ? `;--seq-map-node-accent:${accent}` : '');
      return `<div class="${cls}" data-slot-idx="${idx}" data-slot-id="${escapeHtml(slot.id || '')}" style="${style}"><span class="seq-map-node-label">${escapeHtml(label)}</span>${check}</div>`;
    }).join('');
    seqMapDrawEdges(layout, visibleIdx, positions, w, h, totalW, totalH, roomy);
    attachSeqMapNodeClicks(currentSlot);
  }
  // Attache le clic sur les nœuds sélectionnables -- rappelée à chaque reconstruction de seqMapNodesEl,
  // son innerHTML étant entièrement remplacé à chaque appel d'updateSeqMap() (donc les écouteurs d'un
  // passage précédent n'existent plus).
  function attachSeqMapNodeClicks(currentSlot) {
    seqMapNodesEl.querySelectorAll('.seq-map-node.selectable').forEach(el => {
      el.addEventListener('click', () => handleSeqBranchChoice(el.dataset.slotId, currentSlot));
    });
  }
  // Arêtes SVG entre nœuds révélés, positions calculées directement depuis `layout` (pas de mesure DOM).
  // Arête "en avant" (colonne cible > colonne source) : courbe en S classique entre le bord droit de la
  // source et le bord gauche de la cible. Arête "en arrière ou même colonne" (boucle/retour, colonne
  // cible <= colonne source) : réécrite deux fois le 03/09 sur retours directs -- d'abord une courbe (l'
  // ancienne version sortait par la droite avec un décalage fixe, forme différente selon la distance,
  // "tracées un peu aléatoirement"), puis un tracé ORTHOGONAL (droites + angles droits, "plus clair
  // notamment dans les systèmes complexes") : descend tout droit depuis le BAS de la source, traverse à
  // l'horizontale sous TOUTE la grille (pas juste sous la ligne des deux nœuds concernés -- ne risque donc
  // jamais de croiser un nœud intermédiaire), remonte tout droit dans le BAS de la cible. Même tracé
  // prévisible quelle que soit la distance entre les deux nœuds. totalW/totalH reçus tels quels depuis updateSeqMap() (pas recalculés ici) pour que
  // le viewBox du SVG corresponde exactement à .seq-map-canvas, marge des boucles de retour comprise --
  // sinon une boucle qui dépasse la dernière ligne de nœuds serait coupée par overflow-y:hidden (bug
  // trouvé en vérification visuelle réelle).
  function seqMapDrawEdges(layout, visibleIdx, positions, nodeW, nodeH, totalW, totalH, freeform) {
    if (!seqMapLinesEl) return;
    const slots = track.segmentSlots || [];
    seqMapLinesEl.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    seqMapLinesEl.setAttribute('width', totalW);
    seqMapLinesEl.setAttribute('height', totalH);
    seqMapLinesEl.innerHTML = '';
    const svgNS = 'http://www.w3.org/2000/svg';
    // Coordonnées dérivées de `positions` (calculées une fois par updateSeqMap(), grille ou triangle
    // selon le cas -- voir seqMapForceLayout) plutôt que recalculées ici depuis colonne/ligne :
    // cette fonction n'a plus besoin de savoir QUELLE disposition a produit ces positions.
    const centerOf = idx => ({ x: positions[idx].x + nodeW / 2, y: positions[idx].y + nodeH / 2 });
    const rightOf = idx => ({ x: positions[idx].x + nodeW, y: positions[idx].y + nodeH / 2 });
    const leftOf = idx => ({ x: positions[idx].x, y: positions[idx].y + nodeH / 2 });
    const bottomOf = (idx, offsetX) => ({ x: positions[idx].x + nodeW / 2 + (offsetX || 0), y: positions[idx].y + nodeH });
    const visibleSet = new Set(visibleIdx);
    // gridBottom (mode grille uniquement, voir plus bas) : bas du nœud le plus bas parmi ceux visibles --
    // équivalent de l'ancien layout.maxRows*rowH, mais dérivé des positions réelles, pas du nombre de
    // lignes de la grille (qui n'a plus de sens uniforme si une future disposition n'était plus en grille).
    const gridBottom = Math.max(0, ...visibleIdx.map(idx => positions[idx].y)) + nodeH;
    // Flèches de sens (03/09, retour direct : "ajoute une flèche pour bien expliciter le sens de
    // lecture") -- une définition <marker> par couleur utilisée (le gris par défaut des arêtes "en avant",
    // plus une par couleur de la palette des boucles de retour ci-dessous), réutilisées par toutes les
    // arêtes de cette couleur via marker-end. Redéfinies à chaque appel (innerHTML vidé juste au-dessus) --
    // coût négligeable, une poignée d'éléments SVG.
    const defs = document.createElementNS(svgNS, 'defs');
    seqMapLinesEl.appendChild(defs);
    const markerIds = {};
    function ensureArrowMarker(color, key) {
      if (markerIds[key]) return markerIds[key];
      const id = 'seqMapArrow-' + key;
      const marker = document.createElementNS(svgNS, 'marker');
      marker.setAttribute('id', id);
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '8.5');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '6');
      marker.setAttribute('markerHeight', '6');
      marker.setAttribute('orient', 'auto-start-reverse');
      const arrowPath = document.createElementNS(svgNS, 'path');
      arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
      arrowPath.setAttribute('fill', color);
      marker.appendChild(arrowPath);
      defs.appendChild(marker);
      markerIds[key] = id;
      return id;
    }
    // Couleur unique pour toutes les boucles de retour (07/09, retour direct de Jules-Antoine : "plus
    // besoin des couleurs sur les trajets de retour" une fois leur tracé fiabilisé -- voir écartement
    // minimal ci-dessous) -- même teinte neutre que les arêtes "en avant", les boucles se distinguent
    // déjà par leur tracé en U et leur étalement vertical/horizontal, pas besoin d'un code couleur en
    // plus. Remplace la palette aléatoire par paire source/cible utilisée jusqu'ici.
    const SEQ_MAP_LOOP_COLOR = cssVar('--text-dimmer', '#a8a399');
    // Étale chaque boucle de retour un peu plus bas que la précédente (backEdgeIndex incrémenté à chaque
    // arête en arrière rencontrée) -- sans ça, deux boucles de retour finissaient à la même hauteur et se
    // confondaient visuellement. updateSeqMap() réserve la marge verticale correspondante dans totalH,
    // avec les mêmes fonctions (seqMapLoopMargin()/seqMapLoopStagger()).
    //
    // Ancrages horizontaux (06/09, suite au fouillis signalé par Jules-Antoine sur un morceau à
    // plusieurs boucles) : quand plusieurs boucles de retour partagent le même nœud en départ ou en
    // arrivée, les ancrer toutes au centre du nœud les faisait converger exactement au même point --
    // réparties ici le long du bas du nœud, une par boucle. Calculé en une passe préalable (avant tout
    // tracé) car le nombre d'arêtes partageant un nœud n'est connu qu'une fois toutes les arêtes
    // recensées.
    // Tout ce bloc de précalcul (ancrages/écartement des boucles de retour en grille) ne concerne QUE le
    // tracé orthogonal en U du mode grille -- inutile et sauté en disposition "à ressorts" (roomy), qui
    // trace des lignes directes entre pourtours de nœuds (voir seqMapEdgePoint) sans jamais avoir besoin
    // de plonger sous la grille.
    const backEdgeAnchors = new Map();
    if (!freeform) {
      const backEdgePairs = [];
      visibleIdx.forEach(idx => {
        if (!slots[idx]) return;
        seqMapForwardTargets(idx, visibleSet).forEach(ti => {
          if (layout.col[ti] <= layout.col[idx]) backEdgePairs.push({ from: idx, to: ti });
        });
      });
      const ANCHOR_SPACING = 12;
      const fromTotals = {}, toTotals = {}, fromSeen = {}, toSeen = {};
      backEdgePairs.forEach(e => {
        fromTotals[e.from] = (fromTotals[e.from] || 0) + 1;
        toTotals[e.to] = (toTotals[e.to] || 0) + 1;
      });
      function spreadOffset(seenMap, totalsMap, key) {
        const total = totalsMap[key] || 1;
        const seen = seenMap[key] || 0;
        seenMap[key] = seen + 1;
        return total > 1 ? (seen - (total - 1) / 2) * ANCHOR_SPACING : 0;
      }
      backEdgePairs.forEach(e => {
        const anchor = {
          fromOffset: spreadOffset(fromSeen, fromTotals, e.from),
          toOffset: spreadOffset(toSeen, toTotals, e.to),
        };
        // Deux nœuds de la MÊME colonne (07/09, retour direct de Jules-Antoine après avoir réordonné des
        // embranchements : "c'est tout écrasé") : leur centre partage le même x, donc la boucle qui les
        // relie s'effondrait en un simple trait vertical (largeur nulle) au lieu d'un rectangle, quel que
        // soit l'écartement ci-dessus (qui ne sépare que des arêtes partageant un même nœud, pas deux
        // nœuds distincts alignés par hasard). Écartement minimal forcé dans ce cas précis -- ce bloc ne
        // s'exécute qu'en mode 'compact' (voir `if (!freeform)` plus haut) : en 'roomy', la disposition à
        // ressorts est le VRAI correctif (deux nœuds qui n'ont plus de raison de partager le même x) ;
        // cet écartement minimal reste le filet de sécurité pour le Backstage, qui reste en grille.
        if (layout.col[e.from] === layout.col[e.to]) {
          const minGap = Math.max(ANCHOR_SPACING * 2, nodeW * 0.5);
          if (Math.abs(anchor.fromOffset - anchor.toOffset) < minGap) {
            anchor.fromOffset -= minGap / 2;
            anchor.toOffset += minGap / 2;
          }
        }
        backEdgeAnchors.set(e.from + '>' + e.to, anchor);
      });
    }
    let backEdgeIndex = 0;
    const drawEdge = (fromIdx, toIdx, cls, label, hasTransition) => {
      const isBack = layout.col[toIdx] <= layout.col[fromIdx];
      const path = document.createElementNS(svgNS, 'path');
      let d, a, b, mid, markerId;
      if (freeform) {
        // Disposition "à ressorts" (10/09) : plus de notion "en avant"/"en arrière" pour le TRACÉ -- une
        // simple ligne courbe entre les pourtours des deux nœuds, dans n'importe quelle direction. isBack (calculé
        // plus haut) ne sert plus qu'à choisir la couleur (neutre "boucle" ou neutre "en avant" -- déjà
        // la même teinte depuis le 07/09, gardé séparé ici seulement pour rester cohérent avec le reste
        // du fichier si l'un des deux devait un jour redevenir distinct). Léger arc plutôt qu'une droite
        // pure : une paire de nœuds reliée dans les deux sens (aller ET retour) doit rester lisible comme
        // deux arêtes distinctes, pas une seule ligne se chevauchant elle-même.
        const cA = centerOf(fromIdx), cB = centerOf(toIdx);
        a = seqMapEdgePoint(cA, cB, nodeW, nodeH);
        b = seqMapEdgePoint(cB, cA, nodeW, nodeH);
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const bow = Math.max(10, nodeW * 0.12);
        const mx = (a.x + b.x) / 2 + (-dy / len) * bow, my = (a.y + b.y) / 2 + (dx / len) * bow;
        d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
        mid = { x: mx, y: my };
        const color = isBack ? SEQ_MAP_LOOP_COLOR : cssVar('--text-dimmer', '#a8a399');
        path.style.stroke = color;
        markerId = ensureArrowMarker(color, isBack ? 'loop' : 'default');
      } else if (isBack) {
        // Tracé orthogonal (droites + angles droits, 03/09 sur retour direct : "plus clair, notamment
        // dans les systèmes complexes") plutôt qu'une courbe -- descend tout droit, traverse à
        // l'horizontale, remonte tout droit. Aucune ambiguïté de lecture même avec plusieurs boucles
        // imbriquées, contrairement à des courbes qui peuvent se confondre visuellement dans un graphe
        // chargé.
        const anchor = backEdgeAnchors.get(fromIdx + '>' + toIdx) || {};
        a = bottomOf(fromIdx, anchor.fromOffset); b = bottomOf(toIdx, anchor.toOffset);
        const loopY = gridBottom + seqMapLoopMargin() + backEdgeIndex * seqMapLoopStagger();
        backEdgeIndex++;
        d = `M ${a.x} ${a.y} L ${a.x} ${loopY} L ${b.x} ${loopY} L ${b.x} ${b.y}`;
        mid = { x: (a.x + b.x) / 2, y: loopY };
        path.style.stroke = SEQ_MAP_LOOP_COLOR;
        markerId = ensureArrowMarker(SEQ_MAP_LOOP_COLOR, 'loop');
      } else {
        a = rightOf(fromIdx); b = leftOf(toIdx);
        const midX = (a.x + b.x) / 2;
        d = `M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`;
        mid = { x: midX, y: (a.y + b.y) / 2 };
        markerId = ensureArrowMarker(cssVar('--text-dimmer', '#a8a399'), 'default');
      }
      path.setAttribute('d', d);
      path.setAttribute('class', 'seq-map-edge' + (cls ? ' ' + cls : ''));
      path.setAttribute('marker-end', `url(#${markerId})`);
      // <title> (infobulle au survol) plutôt qu'un <text> toujours affiché comme dans la version
      // précédente : avec plusieurs embranchements/retours proches, des libellés SVG en permanence
      // visibles se chevauchaient et devenaient illisibles (retour direct en situation réelle, "tout
      // moche, tout recroquevillé") -- même principe que le graphe Wwise du vertical-random, qui n'a
      // lui-même aucun libellé permanent sur ses connecteurs.
      if (label) {
        const title = document.createElementNS(svgNS, 'title');
        title.textContent = label;
        path.appendChild(title);
      }
      seqMapLinesEl.appendChild(path);
      // Repère de transition (03/09) : un disque au milieu du chemin -- couleur retirée du liseré lui-même
      // sur retour direct ("oublie la couleur du liseré bleu"), gardée uniquement sur ce disque, agrandi
      // ("un peu plus visible") pour rester le seul indicateur de transition sur cette arête.
      if (hasTransition) {
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', String(mid.x));
        dot.setAttribute('cy', String(mid.y));
        dot.setAttribute('r', '6.5');
        // "Est-ce que la boule peut se colorer lorsqu'elle joue ?" (05/09, retour direct) : classe .playing
        // posée seulement pendant que CE fichier de transition précis est audible (currentTransitionEdge,
        // voir activateSeqStage()) -- distingue "cette arête a une transition" (toujours visible, disque de
        // base) de "cette transition est en train de jouer là, maintenant" (le reste du temps, aucune arête
        // n'est concernée).
        const isPlaying = !!(currentTransitionEdge && currentTransitionEdge.from === fromIdx && currentTransitionEdge.to === toIdx);
        dot.setAttribute('class', 'seq-map-transition-dot' + (isPlaying ? ' playing' : ''));
        const dotTitle = document.createElementNS(svgNS, 'title');
        dotTitle.textContent = t('branchTransitionBadgeTitle');
        dot.appendChild(dotTitle);
        seqMapLinesEl.appendChild(dot);
      }
    };
    visibleIdx.forEach(idx => {
      const slot = slots[idx];
      if (!slot) return;
      const options = slot.nextOptions || [];
      if (options.length) {
        options.forEach((opt, oi) => {
          const targetIdx = slots.findIndex(sl => sl.id === opt.targetId);
          if (targetIdx < 0 || !visibleSet.has(targetIdx)) return; // cible pas encore révélée -- pas d'arête vers du vide
          const hasTransition = !!(transitionBuffers[idx] && transitionBuffers[idx][oi]);
          const label = opt.label || (slots[targetIdx] && slots[targetIdx].label) || '';
          drawEdge(idx, targetIdx, 'branch' + (hasTransition ? ' transition' : ''), label, hasTransition);
        });
      } else if (!seqMapRandom) { // ordre aléatoire : pas de flèche "au suivant", voir seqMapForwardTargets
        const nextIdx = (idx + 1) % slots.length;
        if (nextIdx !== idx && visibleSet.has(nextIdx)) drawEdge(idx, nextIdx, '', '');
      }
    });
  }
  // Surveille la prochaine frontière de temps ("beat") ou de mesure ("bar") de l'emplacement ACTUELLEMENT
  // audible, et déclenche la coupure dès qu'elle est atteinte SI un choix est en attente à ce moment-là —
  // sinon se réarme pour la frontière suivante (l'emplacement continue de se rejouer normalement tant
  // qu'aucun choix n'est fait). myEpoch protège contre les chaînes héritées d'un passage précédent sur cet
  // emplacement (ou un autre) : si l'epoch global a changé entretemps (nouveau passage, coupure survenue
  // par un autre chemin), cette chaîne s'éteint silencieusement au lieu de continuer à tourner en double.
  // afterTime : chercher la frontière qui suit cet instant (au lieu de « maintenant ») -- le minuteur se réveille un peu
  // AVANT la frontière (ENGINE_START_LEAD_SEC) pour programmer la coupure pile dessus, à l'échantillon près.
  function armNextSeqBranchBoundary(myEpoch, afterTime) {
    if (myEpoch !== seqBranchEpoch) return;
    if (!currentSeqBlockInfo || currentSeqBlockInfo.kind !== 'segment') return;
    const slotIdx = currentSeqBlockInfo.slotIdx;
    const slot = (slotIdx != null && slotIdx >= 0) ? (track.segmentSlots || [])[slotIdx] : null;
    if (!slot || !slot.nextOptions || !slot.nextOptions.length) return;
    const quant = slot.quantization || 'bar';
    const segStart = currentSeqBlockInfo.virtualZero;
    const timing = slotTiming(slot);
    const unitSec = quant === 'beat' ? timing.secondsPerBeat : (timing.beatsPerBar * timing.secondsPerBeat);
    const elapsed = Math.max(0, (afterTime != null ? afterTime : ctx.currentTime) - segStart);
    const stepsElapsed = Math.floor(elapsed / unitSec + 1e-6);
    const cutTime = segStart + (stepsElapsed + 1) * unitSec; // toujours la PROCHAINE frontière, strictement après maintenant
    const delayMs = Math.max(0, (cutTime - ENGINE_START_LEAD_SEC - ctx.currentTime) * 1000);
    const id = setTimeout(() => {
      if (myEpoch !== seqBranchEpoch) return; // périmée pendant l'attente (nouveau passage ou coupure survenue par ailleurs)
      if (pendingNextSegmentId) performSeqBranchCut(cutTime);
      else armNextSeqBranchBoundary(myEpoch, cutTime); // rien choisi à cette frontière : on surveille la suivante
    }, delayMs);
    seqTimeouts.push(id);
  }
  // Exécute la coupure : termine net ou en fondu (cutStyle) l'emplacement actuellement audible au point de
  // quantification atteint, annule toute génération déjà programmée mais pas encore audible (voir filtrage
  // de seqActiveSources plus bas), puis bascule vers la cible choisie — via un fichier de transition si l'embranchement
  // en déclare un (rejoue ensuite normalement, chevauchement crossfade-tail classique vers la cible), sinon
  // directement. Schéma "quantization"/"cutStyle"/"transition" validé le 02/08.
  // atTime : instant exact de la coupure (frontière de mesure / de temps) ; sans lui (quantification « immédiate »), juste
  // après l'appui.
  function performSeqBranchCut(atTime) {
    const targetId = pendingNextSegmentId;
    pendingNextSegmentId = null;
    updateSeqPendingIndicator();
    if (!currentSeqBlockInfo || currentSeqBlockInfo.kind !== 'segment' || currentSeqBlockInfo.slotIdx == null || currentSeqBlockInfo.slotIdx < 0 || !targetId) return;
    const sourceSlotIdx = currentSeqBlockInfo.slotIdx;
    const sourceSlot = (track.segmentSlots || [])[sourceSlotIdx];
    if (!sourceSlot) return;
    const targetIdx = (track.segmentSlots || []).findIndex(sl => sl.id === targetId);
    if (targetIdx < 0) return; // cible introuvable (id orphelin, ex. emplacement supprimé depuis) : l'emplacement continue de se rejouer normalement, rien de cassé
    seqBranchEpoch++; // invalide toute chaîne de vérification de frontière encore en vol pour l'emplacement qu'on quitte
    // Un choix de cible précis est plus spécifique qu'une demande générique "aller vers la fin" déjà en
    // attente (les deux boutons coexistent, rien n'empêche de cliquer les deux) — sans ça, decideNextSeqBlock()
    // route vers l'outro dès le prochain calcul et le visiteur n'entend jamais la cible qu'il vient de choisir.
    goToEndRequested = false;
    if (goToEndBtn) { goToEndBtn.disabled = false; goToEndBtn.textContent = t('goToEndBtn'); }
    const cutStyle = sourceSlot.cutStyle || 'fade';
    const now = atTime != null ? Math.max(atTime, ctx.currentTime) : startSoon(); // coupure pile sur la frontière (voir armNextSeqBranchBoundary)
    const opt = (sourceSlot.nextOptions || []).find(o => o.targetId === targetId);
    const oi = opt ? sourceSlot.nextOptions.indexOf(opt) : -1;
    applyFxActions(opt && opt.fxActions); // triggers d'effets liés à cette bascule (23/09)
    const transitionBuf = (oi >= 0 && transitionBuffers[sourceSlotIdx]) ? transitionBuffers[sourceSlotIdx][oi] : null;
    const transitionDurationSec = transitionBuf ? transitionDurationSecFor(opt, sourceSlot) : null;
    // Trois styles de coupure : "hard" (fin nette), "fade" (fondu court fixe, 0.15s — même durée que les
    // autres fondus courts du morceau, solo/muet, embranchement-vertical), "custom" (durée choisie par le
    // compositeur, `sourceSlot.customCutFadeSec`, en secondes réelles — pas en mesures, un fondu de sortie
    // n'a pas besoin d'être quantifié musicalement comme un segment).
    const fadeOutSec = cutStyle === 'custom' ? (sourceSlot.customCutFadeSec != null ? sourceSlot.customCutFadeSec : 0.15) : 0.15;
    // Repère de capture : le bloc suivant (transition ou cible) part sur une COUPURE -- l'outil vidéo éteint alors le
    // bloc quitté comme ici (net ou en fondu), au lieu de le laisser finir sa queue comme dans un enchaînement normal.
    seqPendingCut = { hard: cutStyle === 'hard', fadeSec: cutStyle === 'hard' ? 0 : fadeOutSec };
    if (currentSeqBlockInfo.gainNode) {
      const g = currentSeqBlockInfo.gainNode;
      g.gain.cancelScheduledValues(now);
      if (cutStyle === 'hard') {
        g.gain.setValueAtTime(0, now);
      } else {
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + fadeOutSec);
      }
    }
    // Le scheduler normal programme jusqu'à 1s à l'avance (voir seqSchedulerTick) : au moment d'une coupure,
    // une ou PLUSIEURS générations peuvent déjà être programmées (source.start() déjà appelé sur le
    // contexte audio) sans être encore audibles — un emplacement court peut suffire à en empiler plusieurs
    // dans la même fenêtre. Toutes sont maintenant caduques et doivent être coupées avant leur heure de
    // départ, sinon elles sonnent quand même par-dessus la nouvelle destination : Web Audio ne sait pas
    // qu'elles sont devenues obsolètes tant qu'on ne les arrête pas explicitement une par une. Ne retenir
    // que "la dernière programmée" (ancien seqNextScheduled, une seule référence) ne suffisait pas dès que
    // plus d'une génération future était en attente — bug trouvé le 06/08 (chevauchement audible entre
    // l'ancien et le nouvel emplacement, signalé par Jules-Antoine). La génération ACTUELLEMENT audible
    // (ctxStartTime <= now) n'est jamais concernée ici : elle est déjà en train de s'éteindre via son
    // gainNode juste au-dessus.
    seqActiveSources = seqActiveSources.filter(({ src, ctxStartTime: st }) => {
      if (st > ctx.currentTime) { try { src.stop(); } catch (e) {} return false; } // pas encore audible : annulé
      return true;
    });
    seqTimeouts.forEach(id => clearTimeout(id)); seqTimeouts = [];
    if (transitionBuf) {
      // Repère pour le mode Capture (pack.html, 2026-09-15), même principe que seq_slot_start : contrairement
      // à une génération normale (programmée jusqu'à 1s à l'avance), une coupure part quasi immédiatement --
      // pas de décalage d'anticipation à corriger ici.
      seqOutcomeByBuffer.set(transitionBuf, { name: 'seq_transition_start', detail: { trackId: track.id, fromSlotId: sourceSlot.id, targetId } });
      forcedNextBlock = {
        buffer: transitionBuf, label: (opt.transition && opt.transition.label) || t('transitionFallbackLabel'),
        durationSec: transitionDurationSec, terminal: false, kind: 'transition',
        gain: effGain(opt.transition), slotIdx: -1, desc: pickStageDescription(opt.transition),
        // Identité de l'arête (05/09, boule "en train de jouer") -- portée par le bloc plutôt que déduite
        // plus tard : au moment où ce bloc devient réellement audible (voir activateSeqStage), currentSlotIndex
        // pointe déjà sur la cible (posé juste en dessous), donc source/cible ne sont plus récupérables autrement.
        fromSlotIdx: sourceSlotIdx, toSlotIdx: targetIdx
      };
    }
    // currentSlotIndex pointe maintenant sur la cible : que le bloc immédiatement suivant soit la
    // transition injectée (forcedNextBlock, consommée une seule fois) ou directement la cible (pas de
    // transition définie pour cet embranchement), decideNextSeqBlock() retombera ensuite naturellement sur
    // pickNextSegmentSlot() pour CET emplacement — exactement le même mécanisme qu'un enchaînement normal.
    currentSlotIndex = targetIdx;
    currentSlotRepeatsPlayed = 0;
    seqNextStartCtxTime = now;
    seqSchedulerTick();
  }
  // fillDurationSec : temps restant à animer jusqu'à 100% (pas forcément la durée totale du bloc — après
  // un seek, on reprend au milieu). totalDurationSec : durée nominale complète du bloc, nécessaire pour
  // savoir où se trouve le curseur de seek même après plusieurs reprises successives.
  function scheduleSeqLabelUpdate(ctxStartTime, label, kind, fillDurationSec, totalDurationSec, buffer, gainValue, terminal, slotIdx, gainNode, desc, fromSlotIdx, toSlotIdx) {
    const delayMs = Math.max(0, (ctxStartTime - ctx.currentTime) * 1000);
    const id = setTimeout(() => {
      pulseMeter(seqMeterEl);
      if (seqCurrentEl) seqCurrentEl.textContent = label;
      // "" (aucun texte propre à cet élément) laisse volontairement le texte déjà affiché tel quel — voir
      // pickStageDescription().
      if (desc && trackDescEl) trackDescEl.innerHTML = linkify(desc);
      if (kind) activateSeqStage(kind, (fillDurationSec != null) ? fillDurationSec : buffer.duration, totalDurationSec, buffer, gainValue, terminal, slotIdx, gainNode, fromSlotIdx, toSlotIdx, ctxStartTime);
    }, delayMs);
    seqTimeouts.push(id);
  }
  // Repères de capture du séquentiel (25/09) : quel évènement annoncer quand un fichier devient audible (renseigné par
  // celui qui choisit le bloc, relu par scheduleSeqGeneration -- aussi pour une reprise en cours de fichier), et la
  // coupure en attente d'être signalée par le prochain bloc.
  const seqOutcomeByBuffer = new Map();
  let seqPendingCut = null;
  function scheduleSeqGeneration(ctxStartTime, buffer, label, kind, fillDurationSec, gainValue, offsetSec, totalDurationSec, terminal, slotIdx, desc, fromSlotIdx, toSlotIdx) {
    if (!buffer) return;
    const off = offsetSec || 0;
    const total = totalDurationSec != null ? totalDurationSec : ((fillDurationSec != null) ? fillDurationSec + off : buffer.duration);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    applyTrackPitchRate(src, ctxStartTime);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainValue != null ? gainValue : 1, ctxStartTime);
    // fx : porté par l'emplacement (segmentSlot) pour un segment -- même chaîne quel que soit le tirage
    // qui le remplit, cf. la logique retenue pour vertical-random (pool) -- ou par intro/outro directement
    // pour ces deux cas particuliers, qui n'ont qu'un seul fichier chacun.
    const fxSource = kind === 'segment' ? (slotIdx != null ? (track.segmentSlots || [])[slotIdx] : null)
      : kind === 'intro' ? track.intro : kind === 'outro' ? track.outro
      : kind === 'transition' ? seqTransitionDefByBuffer.get(buffer) : null; // transition : ses propres effets (27/09)
    const fxChain = buildTargetFxChain(kind === 'segment' && slotIdx != null ? 'slot:' + slotIdx : kind, fxSource && fxSource.fx, src, ctxStartTime);
    if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
    g.connect(trackMasterGain);
    // Chaque bloc rejoue une fois sans boucle -- onended est un point de nettoyage fiable pour le
    // bitcrusher, comme pour les autres moteurs. armSeqFinalEnd() (bloc terminal) CHAÎNE sur ce handler
    // plutôt que de l'écraser -- voir son commentaire.
    if (fxChainHasLeakyNode(fxChain)) {
      src.onended = () => { disconnectLeakyFxNodes(fxChain); };
    }
    journalVoice(src, g, fxChain);
    src.start(ctxStartTime, off);
    seqActiveSources.push({ src, gain: g, ctxStartTime });
    // Télémétrie + repère de capture du bloc, émis au moment où il devient AUDIBLE (pas quand il est programmé,
    // jusqu'à 1 s plus tôt) : un bloc programmé puis annulé par une coupure (seqTimeouts vidé) n'est jamais annoncé.
    // Un bloc repris en cours de fichier (saut dans la frise, reprise après pause) n'est qu'un repère de capture :
    // il ne compte pas une deuxième fois dans les statistiques.
    const outcome = seqOutcomeByBuffer.get(buffer);
    const rateAtCreate = trackPitchRatio; // vitesse de CE bloc (programmé jusqu'à 1 s avant d'être audible) -- pour l'export
    const cut = off > 0 ? null : seqPendingCut;
    if (off <= 0) seqPendingCut = null;
    if (outcome) {
      const emitId = setTimeout(() => {
        const detail = Object.assign({}, outcome.detail, cut ? { cut } : {});
        if (off > 0) captureMark(outcome.name, Object.assign(detail, { offset: off, resumed: true, at: ctxStartTime, rate: rateAtCreate }));
        else trackPublicEvent(outcome.name, detail, { at: ctxStartTime, rate: rateAtCreate });
      }, Math.max(0, (ctxStartTime - ctx.currentTime) * 1000));
      seqTimeouts.push(emitId);
    }
    seqLastGenSources = [src];
    // Sans durée explicite (cas de l'outro, qui ne programme rien après elle) : on anime le remplissage
    // sur la durée réelle du fichier décodé, seule longueur connue dans ce cas.
    scheduleSeqLabelUpdate(ctxStartTime, label, kind, fillDurationSec, total, buffer, gainValue, terminal, slotIdx, g, desc, fromSlotIdx, toSlotIdx);
  }
  // Détermine le prochain bloc à programmer : soit l'outro (si "Aller vers la fin" a été demandé et
  // qu'une outro existe), soit rien du tout (demande faite mais pas d'outro : on laisse filer), soit
  // un segment tiré au sort. `terminal: true` signifie "rien à programmer après ce bloc".
  function decideNextSeqBlock() {
    if (forcedNextBlock) { const b = forcedNextBlock; forcedNextBlock = null; return b; }
    if (goToEndRequested) {
      goToEndRequested = false;
      if (outroBuffer) {
        // Repère pour le mode Capture -- l'outro est terminale (rien après), donc sa durée réelle n'a pas
        // besoin d'être anticipée par materializeLayerSegments : elle va jusqu'à la fin de la prise.
        seqOutcomeByBuffer.set(outroBuffer, { name: 'seq_outro_start', detail: { trackId: track.id } });
        return { buffer: outroBuffer, label: (track.outro && track.outro.label) || 'Outro', durationSec: null, terminal: true, kind: 'outro', gain: effGain(track.outro), desc: pickStageDescription(track.outro) };
      }
      return null;
    }
    const picked = pickNextSegmentSlot();
    if (!picked) return null;
    const slot = track.segmentSlots[picked.slotIdx];
    const alt = resolveSlotAlternative(picked.slotIdx, picked.altIdx);
    // Repère générique pour le mode Capture (pack.html, 2026-09-15) : contrairement à seq_branch_select
    // (qui ne fire que sur un clic manuel d'embranchement), ce point de passage voit TOUJOURS un nouveau
    // segment, qu'il vienne d'un enchaînement automatique ou d'une coupure -- même principe que
    // embr_loop_select pour l'embranchement-vertical. altIndex précise quelle variation a été tirée au
    // sort, indispensable pour rejouer fidèlement ce qui a vraiment été entendu. Purement une nouvelle
    // ligne d'analytics, silencieuse si personne ne l'écoute -- aucun effet sur la lecture elle-même.
    // Note : programmé jusqu'à `lookahead` (1s) avant de devenir réellement audible (voir seqSchedulerTick
    // plus bas), donc légèrement en avance sur le son perçu -- acceptable pour une capture, pas pour un
    // minutage sample-accurate.
    seqOutcomeByBuffer.set(slotBuffers[picked.slotIdx][picked.altIdx], { name: 'seq_slot_start', detail: { trackId: track.id, slotId: slot.id, altIndex: picked.altIdx } });
    return { buffer: slotBuffers[picked.slotIdx][picked.altIdx], label: (alt && alt.label) || (slot.label || ('Emplacement ' + (picked.slotIdx + 1))), durationSec: blockSeconds(alt && alt.bars, slot), terminal: false, kind: 'segment', gain: effGain(alt), slotIdx: picked.slotIdx, desc: pickStageDescription(slot) };
  }
  function armSeqFinalEnd() {
    const marker = seqLastGenSources[0];
    if (!marker) return;
    seqFinalMarkerSrc = marker;
    // Chaîne sur un éventuel onended déjà posé par scheduleSeqGeneration (nettoyage du bitcrusher, voir
    // plus haut) plutôt que de l'écraser -- affecter .onended REMPLACE tout gestionnaire précédent, pas
    // un addEventListener -- l'écraser aurait fait fuir le ScriptProcessorNode du bloc terminal.
    const previousOnEnded = marker.onended;
    marker.onended = () => {
      if (previousOnEnded) previousOnEnded();
      if (seqFinalMarkerSrc !== marker) return; // piste arrêtée/relancée entretemps : on ignore
      seqActiveSources = [];
      playing = false;
      playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
      setStoppedUI();
      if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('goToEndBtn'); }
      if (activeTrackId === track.id) activeTrackId = null;
    };
  }
  function seqSchedulerTick() {
    const lookahead = 1.0;
    while (seqNextStartCtxTime < ctx.currentTime + lookahead) {
      const next = decideNextSeqBlock();
      if (!next) {
        clearInterval(seqSchedulerTimer); seqSchedulerTimer = null;
        armSeqFinalEnd();
        return;
      }
      scheduleSeqGeneration(seqNextStartCtxTime, next.buffer, next.label, next.kind, next.terminal ? null : next.durationSec, next.gain, 0, null, next.terminal, next.slotIdx, next.desc, next.fromSlotIdx, next.toSlotIdx);
      if (next.terminal) {
        clearInterval(seqSchedulerTimer); seqSchedulerTimer = null;
        armSeqFinalEnd();
        return;
      }
      seqNextStartCtxTime += next.durationSec / trackPitchRatio;
    }
  }
  function stopSequential() {
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
    seqFinalMarkerSrc = null;
    if (seqSchedulerTimer) { clearInterval(seqSchedulerTimer); seqSchedulerTimer = null; }
    seqActiveSources.forEach(({ src }) => { try { src.stop(); } catch(e){} });
    seqActiveSources = [];
    seqTimeouts.forEach(id => clearTimeout(id));
    seqTimeouts = [];
    goToEndRequested = false;
    pendingNextSegmentId = null;
    seqBranchEpoch++; // éteint silencieusement toute chaîne de vérification de frontière encore en vol
    forcedNextBlock = null;
    if (seqMeterEl) seqMeterEl.classList.remove('pulse');
    if (seqCurrentEl) seqCurrentEl.textContent = '—';
    // Symétrique à seqCurrentEl ci-dessus : à un vrai arrêt (pas une reprise, voir seekSequential qui ne
    // passe jamais par ici), le texte affiché revient à la description de base du morceau plutôt que de
    // rester figé sur le dernier emplacement/transition entendu.
    if (trackDescEl) trackDescEl.innerHTML = linkify(track.description || '');
    if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('goToEndBtn'); }
    resetSeqStages();
    updateSeqPendingIndicator();
    // Carte globale (02/09) : plus aucun nœud "courant" une fois arrêté -- l'historique (seqVisitedSlotIds)
    // reste volontairement affiché tel quel (ce qui a été découvert cette session le reste), voir
    // playSequential() pour le seul cas où il est vraiment remis à zéro (un vrai redémarrage, pas juste Stop).
    // Idem pour la boule de transition (05/09) : plus rien n'est audible à l'arrêt, jamais "en train de jouer".
    currentTransitionEdge = null;
    updateSeqMap(-1);
  }
  function playSequential(isContinuation) {
    stopSequential();
    // Un vrai démarrage (pas une reprise après pause/veille) repart du premier emplacement de la chaîne —
    // la reprise, elle, continue le cycle là où il en était plutôt que de tout redémarrer. La carte globale
    // suit la même règle : un vrai redémarrage efface l'historique de découverte, une reprise le conserve.
    if (!isContinuation) {
      chainState = { cyclesCompleted: 0, capReached: false };
      // Ordre aléatoire : le premier emplacement est tiré dans le premier tour mélangé, pas forcément le n°1.
      currentSlotIndex = (track.randomizeSections && (track.segmentSlots || []).length)
        ? advanceChainIndex(-1, track.segmentSlots.length, chainState, track.maxChainLoops, true) : 0;
      seqVisitedSlotIds = new Set();
      seqRoundPlayedIds = new Set(); seqRoundLastIdx = -1;
    }
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    let firstBuffer, firstLabel, firstDurationSec, firstKind, firstGain, firstDesc, firstSlotIdx = -1;
    if (!isContinuation && introBuffer) {
      // L'intro n'appartient à aucun emplacement — son tempo suit celui du premier emplacement de la
      // chaîne (position 0, point de départ conventionnel), même principe que le vertical-random dont
      // l'intro suit le tempo de la première section jouable.
      const firstSlot = (track.segmentSlots || [])[0];
      firstBuffer = introBuffer; firstLabel = (track.intro && track.intro.label) || 'Intro'; firstDurationSec = blockSeconds(track.intro && track.intro.bars, firstSlot); firstKind = 'intro'; firstGain = effGain(track.intro); firstDesc = pickStageDescription(track.intro);
      // Repère pour le mode Capture -- l'intro ne passe jamais par decideNextSeqBlock() (voir son
      // commentaire pour seq_slot_start), donc pas couverte par ce repère-là : son propre événement.
      seqOutcomeByBuffer.set(introBuffer, { name: 'seq_intro_start', detail: { trackId: track.id } });
    } else {
      const picked = pickNextSegmentSlot();
      if (!picked) { if (statusEl) statusEl.textContent = t('noSegmentAvailable'); return; }
      const slot = track.segmentSlots[picked.slotIdx];
      const alt = resolveSlotAlternative(picked.slotIdx, picked.altIdx);
      // Même repère que dans decideNextSeqBlock() ci-dessus, pour le tout premier segment (celui-ci ne
      // passe jamais par decideNextSeqBlock() -- voir le commentaire là-bas pour le raisonnement complet).
      seqOutcomeByBuffer.set(slotBuffers[picked.slotIdx][picked.altIdx], { name: 'seq_slot_start', detail: { trackId: track.id, slotId: slot.id, altIndex: picked.altIdx } });
      firstBuffer = slotBuffers[picked.slotIdx][picked.altIdx]; firstLabel = (alt && alt.label) || (slot.label || ('Emplacement ' + (picked.slotIdx + 1))); firstDurationSec = blockSeconds(alt && alt.bars, slot); firstKind = 'segment'; firstGain = effGain(alt); firstSlotIdx = picked.slotIdx; firstDesc = pickStageDescription(slot);
    }
    scheduleSeqGeneration(now, firstBuffer, firstLabel, firstKind, firstDurationSec, firstGain, 0, null, false, firstSlotIdx, firstDesc);
    seqNextStartCtxTime = now + firstDurationSec / trackPitchRatio;
    seqSchedulerTimer = setInterval(seqSchedulerTick, 200);
    if (goToEndBtn) goToEndBtn.disabled = false;
  }
  // Seek dans le bloc actuellement actif (glisser sur sa waveform) : on arrête proprement tout ce qui est
  // programmé (comme un stop classique), puis on relance le MÊME buffer à la nouvelle position, et on
  // reprend la boucle de planification pour la suite comme si de rien n'était — le prochain segment tiré
  // au sort, ou la fin, ne sont pas affectés par le seek.
  function seekSequential(targetSec) {
    if (!currentSeqBlockInfo || !playing) return;
    const { kind, buffer, gain, totalSec, terminal, slotIdx } = currentSeqBlockInfo;
    const off = Math.max(0, Math.min(totalSec - 0.05, targetSec));
    const remaining = totalSec - off;
    // Capturé AVANT stopSequential() (qui remet le libellé affiché à "—") — bug trouvé le 13/08 en
    // réutilisant cette fonction pour la reprise après changement d'onglet : l'audio rejouait bien le bon
    // segment à la bonne position, mais l'étiquette affichée retombait à "—" au lieu de son nom, capturée
    // une fois déjà écrasée par l'arrêt.
    const label = seqCurrentEl ? seqCurrentEl.textContent : '';
    // Même piège que pour `label` juste au-dessus (et déjà corrigé une fois pour lui, le 13/08) : ma propre
    // remise à zéro de trackDescEl dans stopSequential() (ajoutée le 15/08) écraserait le texte affiché par
    // un vrai arrêt alors qu'un seek n'est qu'un redémarrage interne du même bloc. Capturé avant, restauré
    // après, à l'identique.
    const descHtml = trackDescEl ? trackDescEl.innerHTML : '';
    // stopSequential() remet goToEndRequested à false (comportement voulu pour un vrai arrêt) — mais un
    // seek n'est qu'un redémarrage interne du même bloc, pas un arrêt demandé par le visiteur. Si "Aller
    // vers la fin" avait été cliqué et n'était pas encore consommé (bloc courant non terminal), la demande
    // doit survivre au seek, sans quoi le morceau continue de boucler comme si rien n'avait été cliqué.
    // Même logique pour un choix d'embranchement en attente : un seek ne doit pas l'annuler.
    const wasGoToEndRequested = goToEndRequested;
    const wasPendingNextSegmentId = pendingNextSegmentId;
    stopSequential();
    goToEndRequested = wasGoToEndRequested;
    pendingNextSegmentId = wasPendingNextSegmentId;
    if (trackDescEl) trackDescEl.innerHTML = descHtml;
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    // Important : on transmet TOUJOURS `remaining` (durée réellement restante après le seek), y compris
    // pour un bloc terminal (l'outro). Le passer à null ici (comme le fait le premier appel normal, sans
    // seek, où l'décalage est de toute façon 0) ferait retomber le calcul du remplissage visuel sur
    // buffer.duration — la durée TOTALE du fichier plutôt que ce qu'il en reste après le point de seek —
    // et le curseur se recalerait visuellement comme si la lecture repartait du tout début, alors que
    // l'audio, lui, joue bien depuis la bonne position.
    scheduleSeqGeneration(now, buffer, label, kind, remaining, gain, off, totalSec, terminal, slotIdx);
    if (terminal) {
      armSeqFinalEnd();
      if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('endingWithOutro'); }
    } else {
      seqNextStartCtxTime = now + remaining / trackPitchRatio;
      seqSchedulerTimer = setInterval(seqSchedulerTick, 200);
      // Le bouton doit refléter l'état réel : si la demande est encore en attente (restaurée ci-dessus),
      // il doit rester désactivé avec son texte "en cours de fin", pas se réactiver comme si de rien n'était.
      if (goToEndBtn) {
        if (goToEndRequested) {
          goToEndBtn.disabled = true;
          goToEndBtn.textContent = track.outro ? t('endingWithOutro') : t('endingLastSegment');
        } else {
          goToEndBtn.disabled = false;
        }
      }
    }
  }
  let level = 0, playing = false, startedAt = 0, offsetAt = (useQuantizedLoop ? startTrackSec : 0), rafId = null, ready = false;
  let isDraggingSeek = false; // vrai pendant qu'on glisse sur la barre de lecture — tick() ne doit pas écraser la position affichée pendant ce temps

  const PLAY_SVG = '<path d="M8 5v14l11-7z"/>';
  const PAUSE_SVG = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
  // En cas d'échec de chargement : arrête l'icône qui tourne (elle donnerait l'impression que ça continue
  // de charger indéfiniment) et affiche un repère visuel statique d'erreur, cohérent avec le texte de
  // statut déjà présent dans le panneau déplié.
  function setLoadErrorIcon() {
    playIcon.classList.remove('loading-icon');
    playIcon.classList.add('error-icon');
    playIcon.innerHTML = '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v6"/><circle cx="12" cy="16.7" r="0.9" fill="currentColor" stroke="none"/>';
    playBtn.setAttribute('aria-label', t('loadErrorAriaLabel'));
  }

  function updateStingerAvailability() {
    const expanded = details.classList.contains('expanded');
    setStingerButtonsEnabled(expanded && ready);
  }

  function setStingerButtonsEnabled(enabled) {
    stingerBtns.forEach(b => { b.disabled = !enabled; });
    fxTriggerBtns.forEach(b => { b.disabled = !enabled; });
    fxSliderInputs.forEach(i => { i.disabled = !enabled; });
  }
  function killStingers() {
    activeStingerSources.forEach(s => { try { s.stop(); } catch(e){} });
    activeStingerSources = [];
  }
  trackCollapsers[track.id] = () => { setDetailsExpanded(details, false); updateStingerAvailability(); };
  trackStingerKillers[track.id] = killStingers;

  function updateProgressAt(elapsed) {
    if (!wrap) return;
    const pct = (elapsed / progressMaxSec()) * 100;
    if (fill) fill.style.width = pct + '%';
    if (head) head.style.left = pct + '%';
    if (waveformFg) waveformFg.style.clipPath = `inset(0 ${Math.max(0, 100 - pct)}% 0 0)`;
    timeCurrent.textContent = formatTime(elapsed);
  }
  function computeElapsed() {
    return (useQuantizedLoop || isVerticalRandom)
      ? currentPlaybackOffset()
      : (loops ? ((ctx.currentTime - startedAt) * trackPitchRatio) % track.duration : Math.min((ctx.currentTime - startedAt) * trackPitchRatio, track.duration));
  }
  function tick() {
    if (!playing || isSequential || isEmbrVert) return;
    const elapsed = computeElapsed();
    if (isDraggingSeek) { rafId = requestAnimationFrame(tick); return; } // laisse la position glissée visible, ne pas l'écraser
    updateProgressAt(elapsed);
    if (vertMeterFills.length) {
      const gainArr = useQuantizedLoop ? currentGainNodes : gains;
      vertMeterFills.forEach((fillEl, i) => {
        if (!fillEl) return;
        const g = gainArr[i];
        const v = g ? Math.min(1, Math.max(0, g.gain.value)) : 0;
        fillEl.style.width = Math.round(v * 100) + '%';
      });
    }
    if (isVerticalRandom) {
      // Toutes les voix d'une même section redémarrent ensemble à chaque cycle (même scheduler partagé) :
      // une seule fraction de progression suffit à synchroniser le recouvrement de toutes les waveforms —
      // recalculée sur le tempo/timeline de la section EN COURS, plus un cycle unique pour tout le morceau.
      const origIdx = vrCurrentSectionOriginalIndex >= 0 ? vrCurrentSectionOriginalIndex : (playableSectionOriginalIndex[0] !== undefined ? playableSectionOriginalIndex[0] : -1);
      const currentSection = origIdx >= 0 ? resolveVRSection(track, origIdx) : null;
      if (currentSection) {
        const timing = sectionTiming(currentSection);
        const frac = timing.cycleLength > 0 ? Math.min(1, Math.max(0, (elapsed - timing.loopInSec) / timing.cycleLength)) : 0;
        const clip = `inset(0 ${(1 - frac) * 100}% 0 0)`;
        voiceWavePools.forEach(els => { if (els && els.fg) els.fg.style.clipPath = clip; });
        if (!vrIsDraggingSeek && vrBlockFillEls[origIdx]) vrBlockFillEls[origIdx].style.width = (frac * 100) + '%';
      }
    }
    rafId = requestAnimationFrame(tick);
  }
  function setStoppedUI() {
    pauseTake(); // pause, arrêt ou fin naturelle : le temps d'écoute de la prise s'arrête là
    playIcon.innerHTML = PLAY_SVG;
    if (statusEl) statusEl.textContent = t('pausedStatus');
    updateStopBtn();
  }

  /* ---- Moteur simple (bouclage natif, comportement existant inchangé) ---- */
  function stopSimple(keepPosition) {
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
    if (keepPosition !== false) {
      offsetAt = computeElapsed();
    }
    sources.forEach(s => { if (s) { try { s.stop(); } catch(e){} } });
    // Un ScriptProcessorNode fx (bitcrusher/pitch-shift) continue de traiter du silence tant qu'il reste
    // connecté -- déconnexion explicite ici, contrairement aux autres nœuds fx (coût négligeable une fois
    // la source arrêtée, laissés au ramasse-miettes comme le reste du graphe).
    layerFxChains.forEach(chain => disconnectLeakyFxNodes(chain));
    sources = []; gains = []; layerFxChains = [];
  }
  function playSimple() {
    const nowStart = startSoon(); // toutes les couches sur un même instant (voir startSoon)
    startedAt = nowStart - offsetAt / trackPitchRatio;
    const p = profiles[level] || profiles[0];
    // Repère de capture : toutes les couches démarrent ici, à cette position du fichier, en boucle ou non, au niveau
    // d'intensité en cours (le visiteur a pu le choisir avant d'appuyer sur Lecture).
    // rate / rateFade : vitesse réellement donnée aux sources (27/09 -- l'export la reprend telle quelle au lieu de la deviner).
    const pFx = (track.fx && track.fx.pitch) || {};
    const rateFade = (trackPitchRatio !== 1 && trackPitchRatio === trackBaseRatio && pFx.fadeFromSemitones != null && pFx.fadeDurationSec > 0)
      ? { from: Math.pow(2, pFx.fadeFromSemitones / 12), sec: pFx.fadeDurationSec } : null;
    captureMark('layer_run', { trackId: track.id, offset: offsetAt % track.duration, loop: loops ? [0, track.duration] : null, level, at: nowStart, rate: trackPitchRatio, rateFade });
    for (let i = 0; i < buffers.length; i++) {
      const src = ctx.createBufferSource();
      src.buffer = buffers[i];
      if (loops) { src.loop = true; src.loopStart = 0; src.loopEnd = track.duration; }
      // Moteur simple : le bouclage natif (loopStart/loopEnd, en temps de BUFFER) reste correct quel que
      // soit playbackRate -- pas besoin de diviser une durée programmée par ailleurs, contrairement aux
      // moteurs qui calculent eux-mêmes "dans x secondes réelles" en JS (voir plus bas dans ce fichier).
      applyTrackPitchRate(src, nowStart, true);
      const g = ctx.createGain();
      g.gain.setValueAtTime((p[i] || 0) * effGain(layersToLoad[i]) * voiceGain('layer-' + i), nowStart);
      const fxChain = buildTargetFxChain('layer:' + i, layersToLoad[i] && layersToLoad[i].fx, src, nowStart);
      if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
      g.connect(trackMasterGain);
      journalVoice(src, g, fxChain);
      src.start(nowStart, offsetAt % track.duration);
      sources[i] = src; gains[i] = g; layerFxChains[i] = fxChain;
      if (isStatic && !loops) {
        const layerIndex = i;
        src.onended = () => {
          // Un morceau statique non bouclable finit ici SANS jamais passer par stopSimple() -- sans ce
          // nettoyage propre, un fx à ScriptProcessorNode (s'il y en a un) continuerait de tourner
          // indéfiniment après une fin naturelle (trouvé le 22/09, en écho au même souci déjà réglé pour
          // le moteur quantifié -- même risque, chemin de code différent, pas détecté au premier passage).
          disconnectLeakyFxNodes(fxChain);
          // Si cette source a depuis été remplacée ou arrêtée manuellement (seek, stop, changement de piste),
          // sources[layerIndex] ne pointe plus vers elle -> ce n'est pas une vraie fin naturelle, on ignore.
          if (sources[layerIndex] !== src) return;
          naturalEnd();
        };
      }
    }
  }

  function pulseMeter(el) {
    if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth; // force le reflow pour pouvoir rejouer l'animation même si elle est déjà active
    el.classList.add('pulse');
  }
  // poolPicks : [{ pi, label, silent, buf }] où pi est la position d'affichage (0..vrMaxPoolCount-1) —
  // PAS l'index du pool dans la section en cours, qui peut varier d'une section à l'autre. Le mappage
  // entre "position d'affichage" et "pool réel de la section courante" est fait par l'appelant.
  function scheduleVoiceGraphUpdate(ctxStartTime, poolPicks, secIdx) {
    const delayMs = Math.max(0, (ctxStartTime - ctx.currentTime) * 1000);
    const timeoutId = setTimeout(() => {
      let topologyChanged = false;
      poolPicks.forEach(({ pi, label, silent, buf }) => {
        if (voiceCurrents[pi]) voiceCurrents[pi].textContent = label;
        const nodeEl = wwisePoolVoiceEls[pi];
        if (nodeEl) {
          const wasHidden = nodeEl.style.display === 'none';
          nodeEl.style.display = silent ? 'none' : '';
          if (wasHidden !== !!silent) topologyChanged = true;
        }
        if (!silent && buf) {
          drawVoiceWave(voiceWavePools[pi], buf);
          const fg = voiceWavePools[pi] && voiceWavePools[pi].fg;
          if (fg) { fg.style.transition = 'none'; fg.style.clipPath = 'inset(0 100% 0 0)'; }
        }
      });
      if (topologyChanged) drawWwiseLines();
      // Le libellé "section en cours" et le bloc de progression actif ne doivent changer qu'au moment où
      // cette génération devient réellement AUDIBLE — pas dès qu'elle est programmée. Avec la fenêtre de
      // programmation à l'avance (jusqu'à 1s), plusieurs décisions peuvent s'enchaîner en une seule fois
      // de façon synchrone (ex. une section à très peu de boucles qui avance presque aussitôt) : sans ce
      // délai, l'affichage sauterait déjà à la section suivante avant même que celle-ci ne se fasse
      // entendre, voire "clignoterait" sur une section jamais réellement audible pour le visiteur.
      if (secIdx != null && vrCurrentSectionOriginalIndex !== secIdx) {
        vrCurrentSectionOriginalIndex = secIdx;
        const declaredSection = (track.sections || [])[secIdx];
        if (sectionCurrentEl) sectionCurrentEl.textContent = (declaredSection && declaredSection.label) || t('sectionFallback', { n: secIdx + 1 });
        vrBlockEls.forEach((el, i) => { if (el) el.classList.toggle('active', i === secIdx); });
      }
    }, delayMs);
    voiceGraphTimeouts.push(timeoutId);
  }

  /* ---- Moteur quantifié classique (vertical/statique avec loopEngine "quantized" — BPM + mesures,
     retrigger avec queue de fin superposée). Le vertical-random a désormais son propre moteur séparé,
     voir plus bas, puisque son minutage varie section par section plutôt que d'être fixe pour tout le
     morceau. ---- */
  function scheduleGeneration(ctxStartTime, bufferOffset) {
    // Repère de capture : une nouvelle génération de toutes les couches (moteur quantifié), depuis bufferOffset, au niveau
    // d'intensité en cours -- programmée jusqu'à 1 s plus tôt (at = son instant de départ). Une génération programmée puis annulée par un
    // arrêt est effacée par le repère voices_stop qui la précède.
    captureMark('layer_gen', { trackId: track.id, bufferOffset, level, at: ctxStartTime, rate: trackPitchRatio });
    const thisGenSources = [];
    const p = profiles[level] || profiles[0];
    const gensThisRound = [];
    for (let i = 0; i < buffers.length; i++) {
      if (!buffers[i]) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffers[i];
      applyTrackPitchRate(src, ctxStartTime);
      const g = ctx.createGain();
      const key = 'layer-' + i;
      const base = (p[i] || 0) * effGain(layersToLoad[i]);
      g.gain.setValueAtTime(base * voiceGain(key), ctxStartTime);
      const fxChain = buildTargetFxChain('layer:' + i, layersToLoad[i] && layersToLoad[i].fx, src, ctxStartTime);
      if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
      g.connect(trackMasterGain);
      // Ce moteur régénère une chaîne à chaque nouvelle génération sans jamais les déconnecter -- sans
      // conséquence pour les nœuds fx natifs (filtre/reverb/écho, coût quasi nul une fois la source
      // arrêtée), mais un bitcrusher (ScriptProcessorNode) continuerait de traiter du silence en boucle
      // indéfiniment si on le laissait connecté. src.onended se déclenche de façon fiable à la fin
      // naturelle de CETTE génération (chaque source ici joue une fois, sans loop -- la suivante prend le
      // relais) et aussi si stopSimple()-équivalent l'arrête manuellement (.stop() déclenche onended) --
      // point de nettoyage correct dans les deux cas, jamais de fuite à accumuler sur une session longue.
      if (fxChainHasLeakyNode(fxChain)) {
        src.onended = () => { disconnectLeakyFxNodes(fxChain); };
      }
      journalVoice(src, g, fxChain);
      src.start(ctxStartTime, bufferOffset);
      activeGenSources.push({ src, gain: g, voiceKey: key, baseGain: base });
      thisGenSources.push(src);
      gensThisRound[i] = g;
    }
    currentGainNodes = gensThisRound;
    lastGenSources = thisGenSources;
    scheduledGens.push({ ctxStartTime, bufferOffset, ratio: trackPitchRatio });
    const cutoff = ctx.currentTime - Math.max(cycleLength / trackPitchRatio, 4) * 2;
    if (scheduledGens.length > 6) scheduledGens = scheduledGens.filter(g => g.ctxStartTime >= cutoff);
  }
  function schedulerTick() {
    const lookahead = 1.0;
    while (nextGenStartCtxTime < ctx.currentTime + lookahead) {
      if (track.maxLoops && loopsPlayed >= track.maxLoops) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
        armFinalGenerationEnd();
        return;
      }
      scheduleGeneration(nextGenStartCtxTime, nextGenBufferOffset);
      loopsPlayed++;
      // /trackPitchRatio : cycleLength reste la durée MUSICALE nominale (réutilisée telle quelle ailleurs,
      // ex. affichage) -- seul l'avancement du planificateur en temps RÉEL doit en tenir compte, puisqu'un
      // buffer joué à trackPitchRatio défile trackPitchRatio fois plus vite que sa durée nominale.
      nextGenStartCtxTime += cycleLength / trackPitchRatio;
      nextGenBufferOffset = loopInSec;
    }
  }
  // Une fois la limite de boucles atteinte : on n'interrompt pas la génération en cours (qui contient
  // la queue déjà présente dans le fichier après le point de sortie) — elle continue de jouer seule,
  // sans rien programmer par-dessus. C'est ça, l'outro : pas un fichier séparé, juste l'absence de relance.
  function armFinalGenerationEnd() {
    const marker = lastGenSources[0];
    if (!marker) return;
    finalGenerationMarkerSrc = marker;
    // Chaîne sur un éventuel onended déjà posé par scheduleGeneration (nettoyage du bitcrusher) plutôt
    // que de l'écraser -- même risque et même correctif que armSeqFinalEnd()/armVRFinalEnd().
    const previousOnEnded = marker.onended;
    marker.onended = () => {
      if (previousOnEnded) previousOnEnded();
      if (finalGenerationMarkerSrc !== marker) return; // piste arrêtée/relancée entretemps : on ignore
      activeGenSources = [];
      playing = false;
      playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
      cancelAnimationFrame(rafId);
      offsetAt = startTrackSec;
      updateProgressAt(offsetAt);
      setStoppedUI();
      if (activeTrackId === track.id) activeTrackId = null;
    };
  }
  function stopQuantized() {
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
    finalGenerationMarkerSrc = null;
    if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch(e){} });
    activeGenSources = [];
    voiceGraphTimeouts.forEach(id => clearTimeout(id));
    voiceGraphTimeouts = [];
  }
  function playQuantized(fromOffsetSec) {
    stopQuantized();
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    scheduleGeneration(now, fromOffsetSec);
    let timeUntilNext;
    if (fromOffsetSec < loopInSec) {
      timeUntilNext = loopOutSec - fromOffsetSec;
    } else {
      const positionInLoop = (fromOffsetSec - loopInSec) % cycleLength;
      timeUntilNext = cycleLength - positionInLoop;
    }
    nextGenStartCtxTime = now + Math.max(0.02, timeUntilNext / trackPitchRatio);
    nextGenBufferOffset = loopInSec;
    schedulerTimer = setInterval(schedulerTick, 200);
  }

  /* ---- Moteur embranchement-vertical : N boucles nommées et autonomes, calées sur le même BPM,
     jouant simultanément en arrière-plan pour les boucles de MÊME longueur que la référence (celle
     marquée isInitial) — bascule entre elles par pure rampe de gain (0.15s, même mécanisme que le
     solo/muet ci-dessus), sans redémarrage audio donc sans décalage. Une boucle plus courte que la
     référence n'est PAS jouée en arrière-plan (aucun verrouillage de phase naturel avec le cycle de
     référence) : au clic, lecture fraîche en fondu d'entrée, puis retour automatique à la référence une
     fois sa durée nominale écoulée (voir schéma validé le 31/07). Réutilise blockSeconds() du moteur
     séquentiel pour rester sur une seule notion de "durée en mesures" dans tout le fichier. ---- */
  const embrReferenceIdx = embrReferenceIndex(track);
  // Classification paire/détour explicite (isDetour, 24/08) plutôt qu'une comparaison implicite des
  // mesures -- avec repli sur l'ancienne comparaison si le champ est absent du JSON chargé (morceau publié
  // avant ce changement, pas encore republié depuis). Une fois republié via le backstage, `isDetour` est
  // toujours explicitement présent (migré à la volée côté loadData()) et ce repli ne joue plus.
  const embrPeerIndices = embrPeerIndicesOf(track);
  // Durée nominale du fichier de transition d'une boucle avant que la boucle cible ne commence réellement
  // à monter (29/08, même mécanisme que transitionDurationSecFor() côté branching séquentiel, décision
  // confirmée par Jules-Antoine, complété le 29/08 avec l'unité "temps" pour rester cohérent avec le
  // séquentiel) : `durationUnit` réglé -> mesures ou temps individuels (tempo propre à la transition,
  // repli sur celui de la boucle quittée puis celui du morceau, via transitionTiming()) ou secondes
  // explicites, mêmes conventions que le séquentiel. Rien de réglé -> durée réelle du fichier décodé
  // lui-même plutôt que blockSeconds() : contrairement aux transitions séquentielles (toujours créées avec
  // `bars: 4` par défaut), une transition d'embranchement-vertical n'a par défaut AUCUNE valeur de mesures
  // -- un repli par mesures y donnerait une durée arbitraire (potentiellement plusieurs secondes de silence
  // sur la cible) plutôt que la durée réelle du fichier déposé.
  function embrTransitionDurationSecFor(loopDef, sourceLoopDef, buf) { return embrTransitionDurationSec(track, loopDef, sourceLoopDef, buf ? buf.duration : 0); }
  // Joue le fichier de transition (24/08) de la boucle CIBLE, s'il en existe un -- en overlay, superposé au
  // fondu de coupure plutôt qu'inséré séquentiellement entre les deux boucles (bien plus simple à
  // synchroniser correctement, et suffisant pour l'usage visé : un whoosh/une texture qui accompagne la
  // bascule plutôt qu'un vrai montage Wwise à embranchements). Suivie dans embrActiveTransitionSources
  // (contrairement à une vraie source "fire-and-forget") uniquement pour pouvoir la couper sur Stop --
  // bug trouvé à la relecture du 24/08 : sans ce suivi, une transition encore audible continuerait de
  // sonner après un Stop, la seule source de ce moteur à ne pas être coupée proprement.
  function playEmbrTransitionIfAny(loopIdx, ctxStartTime) {
    const buf = embrTransitionBuffers[loopIdx];
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    applyTrackPitchRate(src, ctxStartTime);
    // Effets (27/09) : ceux de la transition elle-même, plus les triggers du morceau entier -- même chaîne que les autres
    // éléments (qui gère aussi le retard des effets à ScriptProcessor, comme avant pour cet overlay).
    const transDef = ((track.loops || [])[loopIdx] || {}).transition;
    const fxChain = buildTargetFxChain('transition', transDef && transDef.fx, src, ctxStartTime);
    if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(trackMasterGain); } else src.connect(trackMasterGain);
    journalVoice(src, null, fxChain);
    src.start(ctxStartTime, 0);
    embrMark('embr_transition', { loopId: ((track.loops || [])[loopIdx] || {}).id, at: ctxStartTime });
    embrActiveTransitionSources.push(src);
    src.onended = () => {
      if (fxChainHasLeakyNode(fxChain)) disconnectLeakyFxNodes(fxChain);
      const i = embrActiveTransitionSources.indexOf(src);
      if (i !== -1) embrActiveTransitionSources.splice(i, 1);
    };
  }
  // Points de boucle (Départ/Entrée/Sortie) de la boucle de référence (24/08) -- optionnels. S'ils sont
  // réglés (Sortie > Entrée), remplacent le calcul de durée de cycle par simple nombre de mesures : la
  // fenêtre de lecture Entrée->Sortie devient le cycle réel, et TOUTE génération (référence et boucles
  // paires, sur leur PROPRE fichier -- verrouillage de phase, décision validée le 24/08) démarre à
  // "Entrée" plutôt qu'au tout début du fichier. Le tout premier lancement démarre en revanche à "Départ"
  // (peut être avant "Entrée"), qui ne joue donc qu'une seule fois -- même principe que le moteur quantifié
  // classique (voir bufferOffset plus haut dans ce fichier). Aucun réglage -> comportement d'origine
  // inchangé (durée = nombre de mesures, démarrage à l'offset 0 pour toutes les générations).
  // Pas encore de fichier probé : ancien calcul par mesures. Pas de Sortie réglée : le cycle va jusqu'à la fin réelle du
  // fichier (24/08, "Mesures" est vestige une fois un fichier chargé). Voir embrLoopTimingOf.
  function embrLoopTiming() { return embrLoopTimingOf(track); }
  function embrCycleLengthSec() { return embrLoopTiming().cycleLength; }
  // Le bouton d'une boucle EST masqué (pas seulement désactivé) tant qu'elle est celle effectivement
  // audible -- inutile d'afficher un bouton vers ce qui joue déjà (retour de Jules-Antoine, 29/08).
  // S'applique aussi bien à une boucle "paire" (embrActiveLoopIdx) qu'à un détour en cours (embrDetourBtn,
  // déjà désactivé par ailleurs -- le masquage remplace ici ce simple grisage). Seulement pendant une
  // lecture réelle (`playing`) : dans l'état "Prêt" avant tout premier clic sur Écouter, la référence est
  // déjà marquée .active par défaut (rendu serveur) mais rien ne joue encore -- son bouton doit rester
  // visible et cliquable comme les autres à ce stade.
  function updateEmbrButtonsUI() {
    embrLoopBtns.forEach(btn => {
      const idx = parseInt(btn.dataset.loopIdx, 10);
      btn.classList.toggle('active', idx === embrActiveLoopIdx);
      // Gabarit riche (2-7 boucles paires, voir buildTrackRow) : jamais masqué, même la boucle
      // actuellement audible -- sa forme d'onde doit rester visible et continuer d'avancer (demande du
      // 02/09). Le masquage display:none n'est conservé que pour le gabarit compact ci-dessous, inchangé.
      if (btn.classList.contains('embr-wave-btn')) { btn.style.display = ''; return; }
      const isCurrentlyAudible = playing && (idx === embrActiveLoopIdx || btn === embrDetourBtn);
      btn.style.display = isCurrentlyAudible ? 'none' : '';
    });
  }
  // Anime la progression continue des lignes riches -- calée UNE SEULE FOIS par (re)démarrage de
  // l'horloge de phase (embrClockReset vient justement d'être appelé par
  // l'appelant, playEmbrVertical()/resumeEmbrVerticalAfterBackground()), jamais recalculée à chaque
  // bascule : le verrouillage de phase entre boucles paires ne change pas quand on change laquelle est
  // audible (refreshEmbrGains est une pure rampe de gain, voir son commentaire d'en-tête). N'affecte que
  // les boutons en gabarit riche (classe .embr-wave-btn) -- silencieusement ignoré pour les autres.
  // startPosSec (25/09, seek par clic sur la forme d'onde) : position dans le cycle à laquelle l'animation
  // reprend (délai négatif). L'animation est toujours REDÉMARRÉE (animation: none + reflow) plutôt que
  // simplement relancée -- sinon elle repartirait de là où elle avait été mise en pause, désynchronisée
  // de l'audio, et un clip-path posé pendant un glisser resterait masqué par l'animation.
  function applyEmbrWaveAnimation(startPosSec, ratioOverride) {
    const cycle = embrCycleLengthSec();
    if (!(cycle > 0)) return;
    embrLoopBtns.forEach(btn => {
      const fg = btn.querySelector('.embr-wave-fg');
      if (!fg) return;
      fg.style.animation = 'none';
      fg.style.clipPath = '';
      void fg.offsetWidth;
      fg.style.animation = '';
      // Durées RÉELLES : cycle et position sont en temps nominal, joués à la vitesse audible (27/09 -- avant, l'animation
      // ignorait la vitesse du morceau et se décalait dès qu'elle n'était pas à 1).
      const r = ratioOverride || embrClockSegAt(ctx.currentTime).ratio || 1;
      fg.style.animationDuration = (cycle / r) + 's';
      fg.style.animationDelay = (-(startPosSec || 0) / r) + 's';
      fg.style.animationPlayState = 'running';
    });
  }
  // Repasse toutes les lignes riches en pause (état "Prêt", plus rien ne joue) -- évite une animation qui
  // continue de tourner dans le vide après un Stop.
  function pauseEmbrWaveAnimation() {
    embrLoopBtns.forEach(btn => {
      const fg = btn.querySelector('.embr-wave-fg');
      if (fg) fg.style.animationPlayState = 'paused';
    });
  }
  // Ligne overlay "en surimpression" affichée pendant la lecture d'un fichier de transition (voir
  // playEmbrTransitionIfAny) -- même mécanisme one-shot clip-path que animateMainWaveProgress() du
  // lecteur Sfx (buildSfxPlayer), réutilisé via renderWaveformPair() plutôt que dupliqué. Pendant qu'elle
  // est affichée, les lignes riches de la boucle quittée ET de la boucle ciblée passent "en filigrane"
  // (classe .embr-transition-dim, opacity 0.5 -- sans effet sur un bouton non riche) sans jamais
  // interrompre leur propre animation continue.
  let embrTransitionRowEl = null;
  function removeEmbrTransitionOverlay() {
    if (embrTransitionRowEl) { embrTransitionRowEl.remove(); embrTransitionRowEl = null; }
    embrLoopBtns.forEach(btn => btn.classList.remove('embr-transition-dim'));
  }
  function showEmbrTransitionOverlay(fromIdx, toIdx, buf, durationSec) {
    removeEmbrTransitionOverlay();
    const picker = wrapper.querySelector('[data-role="embrLoopPicker"]');
    if (!picker || !buf || !(durationSec > 0)) return;
    const row = document.createElement('div');
    row.className = 'embr-transition-row';
    row.innerHTML = '<canvas class="embr-wave-bg"></canvas><canvas class="embr-wave-fg"></canvas>';
    picker.appendChild(row);
    embrTransitionRowEl = row;
    const bg = row.querySelector('.embr-wave-bg'), fg = row.querySelector('.embr-wave-fg');
    renderWaveformPair(bg, fg, buf, waveBgColor, waveFgColor);
    fg.style.animation = 'none';
    fg.style.transition = 'none';
    fg.style.clipPath = 'inset(0 100% 0 0)';
    void fg.offsetWidth; // force le reflow avant de redémarrer la transition, même truc qu'ailleurs dans ce fichier
    fg.style.transition = `clip-path ${durationSec}s linear`;
    fg.style.clipPath = 'inset(0 0% 0 0)';
    [fromIdx, toIdx].forEach(idx => {
      const btn = embrLoopBtns.find(b => parseInt(b.dataset.loopIdx, 10) === idx);
      if (btn) btn.classList.add('embr-transition-dim');
    });
  }
  // Ligne dédiée à un détour en cours -- deux variantes : one-shot (clip-path fixe sur sa durée nominale,
  // même mécanisme que la ligne de transition ci-dessus) pour un détour minuté, boucle infinie (même
  // mécanisme que applyEmbrWaveAnimation, durée = celle du buffer lui-même) pour un détour "en boucle
  // jusqu'à un bouton" (detourMode === 'loop', src.loop = true côté moteur -- voir startDetour()).
  let embrDetourRowEl = null;
  function removeEmbrDetourWaveRow() {
    if (embrDetourRowEl) { embrDetourRowEl.remove(); embrDetourRowEl = null; }
  }
  function showEmbrDetourWaveRow(buf, durationSec, isLooping) {
    removeEmbrDetourWaveRow();
    const picker = wrapper.querySelector('[data-role="embrLoopPicker"]');
    if (!picker || !buf) return;
    const row = document.createElement('div');
    row.className = 'embr-detour-wave-row';
    row.innerHTML = '<canvas class="embr-wave-bg"></canvas><canvas class="embr-wave-fg"></canvas>';
    picker.appendChild(row);
    embrDetourRowEl = row;
    const bg = row.querySelector('.embr-wave-bg'), fg = row.querySelector('.embr-wave-fg');
    renderWaveformPair(bg, fg, buf, waveBgColor, waveFgColor);
    if (isLooping) {
      // durationSec = durée RÉELLE d'un tour (vitesse du morceau comprise, 27/09) ; avant, la durée du fichier était prise
      // telle quelle et l'animation se décalait dès que la vitesse n'était pas à 1.
      fg.style.animationDuration = (durationSec > 0 ? durationSec : buf.duration) + 's';
      fg.style.animationDelay = '0s';
      fg.style.animationPlayState = 'running';
    } else if (durationSec > 0) {
      fg.style.animation = 'none';
      fg.style.transition = 'none';
      fg.style.clipPath = 'inset(0 100% 0 0)';
      void fg.offsetWidth;
      fg.style.transition = `clip-path ${durationSec}s linear`;
      fg.style.clipPath = 'inset(0 0% 0 0)';
    }
  }
  // Programme une génération de toutes les boucles "paires" (même longueur que la référence) en simultané,
  // gain à 1 pour celle actuellement active, 0 pour les autres — même principe que scheduleGeneration()
  // du moteur quantifié classique (retrigger périodique avec queue de fin superposée), généralisé à des
  // buffers indépendants au lieu des couches d'un seul morceau. isFirst (24/08) : seule la toute première
  // génération de la lecture démarre à "Départ" (offset embrLoopTiming().startSec) -- toutes les
  // suivantes démarrent à "Entrée" (embrLoopTiming().loopInSec), même principe que le moteur quantifié
  // classique.
  function scheduleEmbrGeneration(ctxStartTime, isFirst, offsetOverride) {
    const timing = embrLoopTiming();
    const bufferOffset = offsetOverride != null ? offsetOverride : (isFirst ? timing.startSec : timing.loopInSec);
    // Repère de capture : nouvelle génération des boucles jumelles (toutes démarrent ensemble, seule la boucle active
    // est audible).
    captureMark('embr_gen', { trackId: track.id, bufferOffset, at: ctxStartTime, rate: trackPitchRatio,
      active: embrActiveLoopIdx >= 0 ? ((track.loops || [])[embrActiveLoopIdx] || {}).id : null,
      peers: embrPeerIndices.map(i => ((track.loops || [])[i] || {}).id) });
    embrPeerIndices.forEach(idx => {
      const buf = embrLoopBuffers[idx];
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      applyTrackPitchRate(src, ctxStartTime);
      const g = ctx.createGain();
      g.gain.setValueAtTime(idx === embrActiveLoopIdx ? 1 : 0, ctxStartTime);
      const loopDef = (track.loops || [])[idx];
      const fxChain = buildTargetFxChain('loop:' + idx, loopDef && loopDef.fx, src, ctxStartTime);
      if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
      g.connect(trackMasterGain);
      // Même raisonnement que scheduleGeneration() (moteur quantifié) : cette génération rejoue une fois
      // sans boucle, son onended est donc un point de nettoyage fiable pour le bitcrusher.
      if (fxChainHasLeakyNode(fxChain)) {
        src.onended = () => { disconnectLeakyFxNodes(fxChain); };
      }
      journalVoice(src, g, fxChain);
      src.start(ctxStartTime, bufferOffset);
      embrActiveGenSources.push({ src, gain: g, loopIdx: idx, ctxStartTime });
    });
    // Purge des générations trop anciennes pour ne plus jamais sonner (même logique de nettoyage que
    // scheduledGens du moteur quantifié) — évite une croissance illimitée du tableau sur une lecture longue.
    const cutoff = ctx.currentTime - Math.max(embrCycleLengthSec() / trackPitchRatio, 4) * 2;
    if (embrActiveGenSources.length > 40) embrActiveGenSources = embrActiveGenSources.filter(g => g.ctxStartTime >= cutoff);
  }
  function embrSchedulerTick() {
    const lookahead = 1.0;
    while (embrNextStartCtxTime < ctx.currentTime + lookahead) {
      embrClockAtGeneration(embrNextStartCtxTime);
      scheduleEmbrGeneration(embrNextStartCtxTime, false); // jamais "Départ" ici, uniquement au tout premier lancement (playEmbrVertical)
      embrNextStartCtxTime += embrCycleLengthSec() / trackPitchRatio;
    }
  }
  // Recalcule en direct le gain de toutes les sources "paires" actuellement audibles ou en train de finir
  // (queue) — sans ça, un clic ne prendrait effet qu'à la prochaine génération programmée. Reprend
  // exactement le principe de refreshVoiceGains() ci-dessus, avec une seule "voix" active à la fois
  // plutôt que la logique solo/muet à plusieurs voix simultanées.
  // targetIdx : boucle qui doit monter à 1 (-1 si aucune, cas du détour où plus aucune voix paire n'est
  // active). Bascule toujours IMMÉDIATE (29/08) : une éventuelle transition est gérée en amont par
  // l'appelant (performEmbrSwitch), qui attend sa fin avant d'appeler cette fonction -- jamais de délai
  // géré ICI. Un délai géré à ce niveau avait été tenté (24/08→29/08) mais se heurtait au planificateur
  // périodique de générations (scheduleEmbrGeneration), qui ignore tout délai en cours et réinitialise le
  // gain de la cible dès le cycle suivant -- source de silences et de boucles superposées (bug signalé par
  // Jules-Antoine). Voir le commentaire d'en-tête de performEmbrSwitch pour le mécanisme retenu à la place.
  function refreshEmbrGains(targetIdx) {
    const now = ctx.currentTime;
    const activeLoopDef = (track.loops || [])[targetIdx];
    const fadeSec = embrCutFadeSec(activeLoopDef);
    embrMark('embr_gains', { loopId: activeLoopDef ? activeLoopDef.id : null, fadeSec });
    embrActiveGenSources.forEach(({ gain, loopIdx }) => {
      if (!gain) return;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      if (loopIdx === targetIdx) {
        if (fadeSec <= 0) gain.gain.setValueAtTime(1, now); // "hard" : coupure nette, aucune rampe
        else gain.gain.linearRampToValueAtTime(1, now + fadeSec);
      } else {
        if (fadeSec <= 0) gain.gain.setValueAtTime(0, now);
        else gain.gain.linearRampToValueAtTime(0, now + fadeSec);
      }
    });
  }
  // Fondu de sortie IMMÉDIAT d'une boucle "paire" quittée, déclenché dès qu'une transition démarre plutôt
  // que d'attendre la fin de celle-ci (05/09, retour direct : "la boucle continue de jouer pendant la
  // transition, je ne veux plus ça"). Avant ce correctif, la boucle quittée restait à plein volume pendant
  // toute la durée de la transition -- gain remis à 0 seulement par refreshEmbrGains() une fois la
  // transition terminée (voir performEmbrSwitch) -- d'où un mélange boucle+transition entendu par
  // Jules-Antoine. Même principe que performSeqBranchCut() côté séquentiel (le bloc quitté y est fondu
  // tout de suite, la transition suivant en bloc distinct) : ici la boucle ducke sur son propre
  // cutStyle/customCutFadeSec (embrCutFadeSec, "fondu de sortie propre à CETTE boucle", même repli que
  // fadeOutCurrentDetour) pendant que le fichier de transition joue seul par-dessus. Ne touche que la
  // source `sourceIdx` -- les autres boucles paires sont déjà à gain 0, refreshEmbrGains() s'occupera de
  // faire monter la cible une fois la transition terminée.
  function duckEmbrSourceLoop(sourceIdx, sourceLoopDef) {
    if (sourceIdx < 0) return; // aucune boucle paire active à ce moment (détour en cours, déjà géré par fadeOutCurrentDetour())
    const now = ctx.currentTime;
    const fadeSec = embrCutFadeSec(sourceLoopDef);
    embrMark('embr_duck', { loopId: sourceLoopDef ? sourceLoopDef.id : null, fadeSec });
    embrActiveGenSources.forEach(({ gain, loopIdx }) => {
      if (!gain || loopIdx !== sourceIdx) return;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      if (fadeSec <= 0) gain.gain.setValueAtTime(0, now);
      else gain.gain.linearRampToValueAtTime(0, now + fadeSec);
    });
  }
  // Reprise après mise en veille (29/08, bug signalé par Jules-Antoine : changer d'onglet relançait le
  // morceau depuis la référence). Contrairement au séquentiel/vertical-random, l'embranchement-vertical
  // n'a pas de notion de "position dans le temps" à laquelle chercher (plusieurs boucles phase-verrouillées
  // tournent en parallèle indéfiniment, pas une seule chronologie linéaire) -- on ne cherche donc pas à
  // retrouver la phase exacte d'avant la mise en veille (potentiellement longue, aucun repère fiable), mais
  // à relancer proprement une nouvelle horloge de phase à partir de maintenant, EN PRÉSERVANT la boucle qui
  // était effectivement active plutôt que de repartir de la référence comme le ferait playEmbrVertical().
  // Cas d'un détour en cours au moment de la mise en veille (embrActiveLoopIdx déjà à -1 à cet instant,
  // pas de boucle "paire" à préserver) : repli sur la référence -- un détour est un aparté ponctuel, pas la
  // boucle de fond que l'auditeur associe au morceau, le perdre au retour d'un onglet resté longtemps en
  // arrière-plan est un compromis acceptable plutôt que de tenter de reconstituer sa position exacte.
  function resumeEmbrVerticalAfterBackground() {
    const preservedIdx = embrActiveLoopIdx >= 0 ? embrActiveLoopIdx : embrReferenceIdx;
    stopEmbrVertical();
    embrActiveLoopIdx = preservedIdx;
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    embrClockReset(now, 0);
    scheduleEmbrGeneration(now, true); // fixe déjà le bon gain (1) sur preservedIdx via embrActiveLoopIdx ci-dessus
    embrNextStartCtxTime = now + embrCycleLengthSec() / trackPitchRatio;
    embrSchedulerTimer = setInterval(embrSchedulerTick, 200);
    updateEmbrButtonsUI();
    applyEmbrWaveAnimation();
  }
  // Seek (25/09, demande directe : "on ne peut pas cliquer dans la barre de lecture pour faire avancer la
  // tête de lecture") : `fraction` = position dans le cycle Entrée->Sortie, la même échelle que le
  // remplissage animé des lignes riches. Toutes les boucles paires restant verrouillées en phase, on les
  // relance TOUTES au même point -- la boucle audible reste la même, seule la position change. Contrairement
  // à resumeEmbrVerticalAfterBackground(), on ne passe pas par stopEmbrVertical() : un minuteur de retour
  // auto en cours doit survivre au seek (même raisonnement que seekSequential()). L'horloge de phase est
  // recalée pour que la quantification des bascules suivantes (embrQuantizeDelaySec) reste juste.
  function seekEmbrVertical(fraction) {
    const timing = embrLoopTiming();
    const cycle = timing.cycleLength;
    if (!(cycle > 0) || embrActiveLoopIdx < 0) return;
    const posSec = Math.max(0, Math.min(1, fraction)) * cycle;
    if (embrSchedulerTimer) { clearInterval(embrSchedulerTimer); embrSchedulerTimer = null; }
    // Repère de capture : seules les générations des boucles jumelles s'arrêtent (transition ou détour éventuels continuent).
    captureMark('voices_stop', { trackId: track.id, scope: 'embr_gens' });
    embrActiveGenSources.forEach(({ src }) => { try { src.stop(); } catch (e) {} });
    embrActiveGenSources = [];
    // Un seek pendant le segment Départ->Entrée du premier lancement saute directement dans le cycle :
    // le verrouillage des boutons propre à ce segment n'a plus lieu d'être.
    if (embrIntroLockTimeout) {
      clearTimeout(embrIntroLockTimeout); embrIntroLockTimeout = null;
      embrLoopBtns.forEach(btn => { btn.disabled = false; });
    }
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    embrClockReset(now, posSec);
    scheduleEmbrGeneration(now, false, timing.loopInSec + posSec);
    embrNextStartCtxTime = now + (cycle - posSec) / trackPitchRatio;
    embrSchedulerTimer = setInterval(embrSchedulerTick, 200);
    applyEmbrWaveAnimation(posSec);
  }
  function playEmbrVertical() {
    stopEmbrVertical();
    embrActiveLoopIdx = embrReferenceIdx;
    applyFxActions(((track.loops || [])[embrReferenceIdx] || {}).fxActions); // état de départ = celui de la boucle de référence
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    embrClockReset(now, 0); // point zéro de l'horloge de phase, utilisée par embrQuantizeDelaySec()
    scheduleEmbrGeneration(now, true); // seul appel avec isFirst=true -- démarre à "Départ", pas "Entrée"
    embrNextStartCtxTime = now + embrCycleLengthSec() / trackPitchRatio;
    embrSchedulerTimer = setInterval(embrSchedulerTick, 200);
    updateEmbrButtonsUI();
    applyEmbrWaveAnimation();
    // Verrouillage des boutons pendant le segment Départ→Entrée (29/08, retour visuel) : ce segment ne
    // joue qu'une seule fois au tout premier lancement (voir embrLoopTiming()) et n'a pas de verrouillage
    // de phase établi avec les boucles paires avant d'avoir atteint "Entrée" -- une bascule pendant cette
    // fenêtre serait prématurée. Sans réglage de Départ/Entrée sur la référence, les deux valent 0 et ce
    // verrouillage dure 0s (comportement d'origine inchangé).
    const timing = embrLoopTiming();
    const introSec = timing.loopInSec - timing.startSec;
    if (introSec > 0) {
      embrLoopBtns.forEach(btn => { btn.disabled = true; });
      embrIntroLockTimeout = setTimeout(() => {
        embrIntroLockTimeout = null;
        embrLoopBtns.forEach(btn => { btn.disabled = false; });
      }, introSec * 1000 / trackPitchRatio);
    }
  }
  function stopEmbrVertical() {
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
    if (embrSchedulerTimer) { clearInterval(embrSchedulerTimer); embrSchedulerTimer = null; }
    if (embrDetourTimeout) { clearTimeout(embrDetourTimeout); embrDetourTimeout = null; }
    if (embrAutoReturnTimeout) { clearTimeout(embrAutoReturnTimeout); embrAutoReturnTimeout = null; }
    if (embrPendingSwitchTimeout) { clearTimeout(embrPendingSwitchTimeout); embrPendingSwitchTimeout = null; }
    if (embrPendingTransitionSwitchTimeout) { clearTimeout(embrPendingTransitionSwitchTimeout); embrPendingTransitionSwitchTimeout = null; }
    if (embrIntroLockTimeout) { clearTimeout(embrIntroLockTimeout); embrIntroLockTimeout = null; }
    removeEmbrEndLoopButton();
    removeEmbrDetourWaveRow();
    removeEmbrTransitionOverlay();
    // Le détour d'une boucle courte (voir selectEmbrLoop) n'est jamais poussé dans embrActiveGenSources —
    // ce n'est pas une génération "paire" en arrière-plan, juste une lecture ponctuelle — donc sans cet
    // arrêt explicite, elle continuerait de jouer jusqu'à sa fin naturelle après un Stop (bug trouvé et
    // corrigé le 31/07, voir CHANGELOG).
    if (embrDetourSource) { try { embrDetourSource.src.stop(); } catch (e) {} embrDetourSource = null; }
    if (embrDetourBtn) { embrDetourBtn.disabled = false; embrDetourBtn = null; }
    embrActiveGenSources.forEach(({ src }) => { try { src.stop(); } catch (e) {} });
    embrActiveGenSources = [];
    // Transitions encore audibles (24/08, bug trouvé à la relecture) -- même raisonnement que le détour
    // ci-dessus : sans cet arrêt explicite, une transition en cours continuerait de sonner après Stop.
    // Itère sur une COPIE (slice()) plutôt que le tableau live : src.stop() peut déclencher onended, qui
    // mute embrActiveTransitionSources pendant l'itération -- sans cette copie, un forEach sur le tableau
    // live sauterait l'élément suivant après chaque suppression en cours de boucle (bug détecté par le
    // test avant même d'atteindre un vrai navigateur, où onended est généralement asynchrone -- mais
    // s'appuyer sur cette hypothèse de timing pour la justesse du code serait fragile).
    embrActiveTransitionSources.slice().forEach(src => { try { src.stop(); } catch (e) {} });
    embrActiveTransitionSources = [];
    embrActiveLoopIdx = -1;
    embrLoopBtns.forEach(btn => { btn.disabled = false; });
    updateEmbrButtonsUI();
    pauseEmbrWaveAnimation();
  }
  // Interrompt en douceur (fondu de EMBR_CROSSFADE_SEC) un détour en cours, sans décider de ce qui doit
  // devenir actif ensuite — à la charge de l'appelant. Réutilisée à la fois pour le retour naturel à la
  // référence (durée nominale écoulée) et pour une interruption volontaire (le visiteur fait un nouveau
  // choix avant la fin du détour précédent) : sans ça, l'ancien détour restait orphelin — jamais coupé,
  // son bouton jamais réactivé (bug trouvé le 31/07, voir CHANGELOG).
  function fadeOutCurrentDetour() {
    if (embrDetourTimeout) { clearTimeout(embrDetourTimeout); embrDetourTimeout = null; }
    removeEmbrEndLoopButton();
    removeEmbrDetourWaveRow();
    if (!embrDetourSource) return;
    const t2 = ctx.currentTime;
    const dg = embrDetourSource.gain;
    // Fondu de sortie propre à CETTE boucle détour (24/08) -- même réglage cutStyle/customCutFadeSec que
    // celui utilisé pour son fondu d'entrée, retrouvé via le bouton désactivé pendant qu'elle joue.
    const leavingIdx = embrDetourBtn ? parseInt(embrDetourBtn.dataset.loopIdx, 10) : -1;
    const leavingLoopDef = leavingIdx >= 0 ? (track.loops || [])[leavingIdx] : null;
    const fadeSec = embrCutFadeSec(leavingLoopDef);
    embrMark('embr_detour_out', { loopId: leavingLoopDef ? leavingLoopDef.id : null, fadeSec });
    dg.gain.cancelScheduledValues(t2);
    dg.gain.setValueAtTime(dg.gain.value, t2);
    if (fadeSec <= 0) dg.gain.setValueAtTime(0, t2);
    else dg.gain.linearRampToValueAtTime(0, t2 + fadeSec);
    embrDetourSource = null;
    if (embrDetourBtn) { embrDetourBtn.disabled = false; embrDetourBtn = null; }
  }
  // Durée en secondes d'un minuteur de retour auto (boucle paire), quelle que soit son unité de réglage
  // (temps/mesures/secondes) -- même conversion bpm/beatsPerBar que le reste du moteur quantifié.
  function embrDurationToSeconds(value, unit) { return embrDurationToSec(track, value, unit); }
  // Délai (en secondes) avant qu'une bascule demandée ne s'exécute réellement, selon le réglage de
  // quantification de la boucle CIBLE (24/08) -- calculé par rapport à la phase de la référence, seule
  // horloge qui tourne en continu en arrière-plan (y compris pour déclencher un détour, qui n'a pas
  // encore de cycle propre avant de démarrer). 'immediate' (ou absent) -> 0, aucune attente.
  function embrQuantizeDelaySec(quantize) {
    // Temps RÉEL : le cycle et le temps musical sont en temps nominal du fichier (pitch "vitesse", 23/09) ; la conversion
    // se fait à la vitesse AUDIBLE maintenant (celle de la génération en cours), pas à celle qui vient d'être demandée.
    const now = ctx.currentTime;
    return embrQuantizeDelayAt(track, quantize, embrNominalAt(now)) / embrClockSegAt(now).ratio;
  }
  // Affiche/retire le bouton "Mettre fin à la boucle" inséré dynamiquement à la suite des boutons de
  // boucle habituels, uniquement pendant qu'un détour en mode "en boucle jusqu'à un bouton" est actif
  // (24/08). Un clic dessus redemande la boucle de référence -- en repassant par selectEmbrLoop(), donc en
  // respectant lui aussi le timing de bascule quantifié réglé sur la boucle de référence.
  function removeEmbrEndLoopButton() {
    if (embrEndLoopBtnEl) { embrEndLoopBtnEl.remove(); embrEndLoopBtnEl = null; }
  }
  function showEmbrEndLoopButton(loopDef) {
    removeEmbrEndLoopButton();
    const picker = wrapper.querySelector('[data-role="embrLoopPicker"]');
    if (!picker) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'embr-loop-btn embr-end-loop-btn';
    btn.textContent = (loopDef.endLoopButtonLabel && loopDef.endLoopButtonLabel.trim()) || t('embrEndLoopDefaultLabel');
    btn.addEventListener('click', () => { selectEmbrLoop(embrReferenceIdx); });
    picker.appendChild(btn);
    embrEndLoopBtnEl = btn;
  }
  // Exécute réellement la bascule vers `idx` -- toute la logique qui existait auparavant directement dans
  // selectEmbrLoop(), désormais appelée soit tout de suite (quantification "immédiat"), soit après le
  // délai calculé par embrQuantizeDelaySec() pour "prochain temps"/"prochaine mesure" (24/08).
  // Repères de capture de l'embranchement-vertical (25/09) : chaque commande de volume réellement donnée par le moteur
  // (bascule entre boucles jumelles, baisse de la boucle quittée pendant une transition, entrée/sortie d'un détour,
  // départ d'une transition) est annoncée à l'outil vidéo au moment où elle a lieu, avec la clé de la bascule qui l'a
  // provoquée (k) et celle de sa bascule « parente » (pk : un retour automatique suit la bascule qui l'a armé). Déplacer
  // une bascule sur la frise déplace ainsi tout ce qu'elle a déclenché, et rien d'autre.
  let embrSwitchSeq = 0, embrMarkKey = null, embrMarkParentKey = null, embrPendingParentKey = null;
  function embrMark(name, detail) {
    // rate : vitesse des sources créées à ce moment (détour, transition) -- reprise telle quelle par l'export (27/09).
    captureMark(name, Object.assign({ trackId: track.id, rate: trackPitchRatio }, embrMarkKey ? { k: embrMarkKey } : {}, embrMarkParentKey ? { pk: embrMarkParentKey } : {}, detail));
  }
  function withEmbrKey(k, pk, fn) {
    const k0 = embrMarkKey, pk0 = embrMarkParentKey;
    embrMarkKey = k; embrMarkParentKey = pk;
    try { return fn(); } finally { embrMarkKey = k0; embrMarkParentKey = pk0; }
  }
  function performEmbrSwitch(idx) {
    const swKey = 'sw' + (++embrSwitchSeq), swParent = embrPendingParentKey;
    embrPendingParentKey = null;
    return withEmbrKey(swKey, swParent, () => performEmbrSwitchInner(idx, swKey, swParent));
  }
  function performEmbrSwitchInner(idx, swKey, swParent) {
    const buf = embrLoopBuffers[idx];
    if (!buf) return;
    const loopDef = (track.loops || [])[idx];
    // Une bascule "transition en attente" précédente n'a plus lieu d'être si un nouveau choix arrive avant
    // qu'elle ne s'exécute (29/08, corrige un bug réel : le planificateur périodique de générations ignore
    // totalement une bascule en attente et réinitialise le gain de la cible à 1 dès le cycle suivant, quel
    // que soit le délai en cours -- laissé tel quel, ça produisait un silence pendant la transition ET des
    // boucles superposées selon le moment du clic par rapport aux cycles. Correctif : la bascule RÉELLE
    // (embrActiveLoopIdx, gains, UI) n'a plus lieu tant que la transition ne s'est pas terminée -- jusque
    // là, embrActiveLoopIdx reste sur l'ancienne boucle, donc le planificateur continue de la régénérer
    // normalement, sans connaître ni se soucier de la bascule en attente).
    if (embrPendingTransitionSwitchTimeout) { clearTimeout(embrPendingTransitionSwitchTimeout); embrPendingTransitionSwitchTimeout = null; }
    // Une transition affichée pour cette bascule annulée n'a plus lieu d'être -- sans ce retrait
    // inconditionnel, un nouveau choix SANS transition propre laisserait l'ancienne ligne affichée
    // indéfiniment (showEmbrTransitionOverlay() ne serait alors jamais rappelée pour la nettoyer).
    removeEmbrTransitionOverlay();
    if (embrPeerIndices.includes(idx)) {
      if (idx === embrActiveLoopIdx && !embrDetourSource) return; // déjà la voix active, rien à faire --
      // AVANT le nettoyage du minuteur ci-dessous (bug corrigé le 24/08 : un reclic accidentel sur le
      // bouton déjà actif annulait silencieusement son propre minuteur de retour sans jamais le
      // reprogrammer, laissant la boucle active indéfiniment au lieu de revenir comme prévu).
      if (embrAutoReturnTimeout) { clearTimeout(embrAutoReturnTimeout); embrAutoReturnTimeout = null; }
      fadeOutCurrentDetour(); // sans effet si aucun détour n'était en cours
      const sourceLoopDef = (track.loops || [])[embrActiveLoopIdx]; // boucle quittée -- repli de tempo pour la transition
      // Transition (29/08, ducking ajouté le 05/09) : jouée tout de suite. La boucle quittée ducke
      // immédiatement sur son propre fondu de sortie (duckEmbrSourceLoop) plutôt que de continuer à plein
      // volume pendant toute la transition -- seul le fichier de transition doit s'entendre entre les deux
      // boucles. La bascule réelle (embrActiveLoopIdx + gains + UI) n'intervient elle qu'une fois la
      // transition terminée, exactement comme une coupure immédiate ordinaire à cet instant-là -- jamais de
      // gain différé en parallèle du planificateur périodique.
      const transBuf = embrTransitionBuffers[idx];
      const transDelay = transBuf ? embrTransitionDurationSecFor(loopDef, sourceLoopDef, transBuf) / trackPitchRatio : 0; // temps réel (la transition joue aussi à trackPitchRatio)
      if (transBuf) { playEmbrTransitionIfAny(idx, ctx.currentTime); duckEmbrSourceLoop(embrActiveLoopIdx, sourceLoopDef); }
      if (transBuf) showEmbrTransitionOverlay(embrActiveLoopIdx, idx, transBuf, transDelay);
      const doSwitch = () => withEmbrKey(swKey, swParent, () => {
        removeEmbrTransitionOverlay();
        applyFxActions(loopDef && loopDef.fxActions); // triggers d'effets liés à cette boucle (23/09)
        embrActiveLoopIdx = idx;
        refreshEmbrGains(idx);
        updateEmbrButtonsUI();
        // Minuteur de retour auto (24/08) -- seulement si réglé sur cette boucle, jamais sur la référence
        // elle-même (revenir "vers" la référence n'aurait pas de sens).
        if (loopDef && !loopDef.isInitial && loopDef.autoReturnEnabled) {
          const sec = embrDurationToSeconds(loopDef.autoReturnValue, loopDef.autoReturnUnit);
          if (sec > 0) {
            embrAutoReturnTimeout = setTimeout(() => {
              embrAutoReturnTimeout = null;
              embrPendingParentKey = swKey; // le retour suit la bascule qui l'a armé (voir embrMark)
              performEmbrSwitch(embrReferenceIdx); // retour direct, sans quantification supplémentaire -- le délai est déjà exprimé en unités musicales
            }, sec * 1000 / trackPitchRatio);
          }
        }
      });
      if (transDelay > 0) embrPendingTransitionSwitchTimeout = setTimeout(() => { embrPendingTransitionSwitchTimeout = null; doSwitch(); }, transDelay * 1000);
      else doSwitch();
    } else {
      // Ce détour précis est déjà celui en cours (son bouton est de toute façon désactivé pendant qu'il
      // joue -- double sécurité si l'appel venait d'ailleurs qu'un clic utilisateur).
      if (embrDetourBtn && parseInt(embrDetourBtn.dataset.loopIdx, 10) === idx) return;
      if (embrAutoReturnTimeout) { clearTimeout(embrAutoReturnTimeout); embrAutoReturnTimeout = null; } // on quitte le groupe des boucles paires -- son minuteur n'a plus lieu d'être
      fadeOutCurrentDetour(); // coupe en douceur un éventuel détour précédent avant d'en démarrer un nouveau
      const btn = embrLoopBtns.find(b => parseInt(b.dataset.loopIdx, 10) === idx);
      if (btn) btn.disabled = true; // pas de retrigger possible tant que le détour joue (validé le 31/07)
      const sourceLoopDef = (track.loops || [])[embrActiveLoopIdx]; // boucle quittée -- repli de tempo pour la transition
      // Transition (29/08, ducking ajouté le 05/09) : même principe que la branche "paire" ci-dessus --
      // jouée tout de suite, la voix paire encore active (si elle existe -- fadeOutCurrentDetour() a déjà
      // géré le cas d'un détour précédent juste au-dessus) ducke immédiatement sur son propre fondu de
      // sortie plutôt que de continuer à plein volume jusqu'au démarrage réel du détour.
      const transBuf = embrTransitionBuffers[idx];
      const transDelay = transBuf ? embrTransitionDurationSecFor(loopDef, sourceLoopDef, transBuf) / trackPitchRatio : 0; // temps réel (la transition joue aussi à trackPitchRatio)
      if (transBuf) { playEmbrTransitionIfAny(idx, ctx.currentTime); duckEmbrSourceLoop(embrActiveLoopIdx, sourceLoopDef); }
      if (transBuf) showEmbrTransitionOverlay(embrActiveLoopIdx, idx, transBuf, transDelay);
      const startDetour = () => withEmbrKey(swKey, swParent, () => {
        removeEmbrTransitionOverlay();
        applyFxActions(loopDef && loopDef.fxActions); // triggers d'effets liés à ce détour (23/09)
        embrActiveLoopIdx = -1; // plus aucune voix "paire" n'est active pendant le détour
        refreshEmbrGains(-1);
        const now = ctx.currentTime;
        const fadeSec = embrCutFadeSec(loopDef);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, now);
        if (fadeSec <= 0) g.gain.setValueAtTime(1, now); // "hard" : coupure nette, pas de fondu d'entrée
        else g.gain.linearRampToValueAtTime(1, now + fadeSec);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const loopsUntilButton = loopDef && loopDef.detourMode === 'loop';
        if (loopsUntilButton) { src.loop = true; src.loopStart = 0; src.loopEnd = buf.duration; }
        applyTrackPitchRate(src, now);
        const fxChain = buildTargetFxChain('loop:' + idx, loopDef && loopDef.fx, src, now);
        if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
        g.connect(trackMasterGain);
        // onended se déclenche aussi bien à la fin naturelle (détour non bouclé) qu'à l'arrêt manuel
        // (stopEmbrVertical()/fadeOutCurrentDetour() appellent .stop(), qui déclenche onended) -- un seul
        // point de nettoyage couvre les deux cas.
        if (fxChainHasLeakyNode(fxChain)) {
          src.onended = () => { disconnectLeakyFxNodes(fxChain); };
        }
        journalVoice(src, g, fxChain);
        src.start(now, 0);
        embrMark('embr_detour_in', { loopId: loopDef && loopDef.id, fadeSec, loop: !!loopsUntilButton });
        embrDetourSource = { src, gain: g };
        embrDetourBtn = btn;
        if (loopsUntilButton) {
          // Pas de minuterie de retour ici : ça tourne jusqu'à ce qu'on clique sur "Mettre fin à la boucle"
          // (ou sur le bouton d'une autre boucle, qui interrompt aussi ce détour via fadeOutCurrentDetour()).
          showEmbrEndLoopButton(loopDef);
          showEmbrDetourWaveRow(buf, buf.duration / trackPitchRatio, true);
        } else {
          // Durée propre à CETTE boucle détour si elle a son propre tempo (bpm/beatsPerBar, 24/08) --
          // blockSeconds() accepte déjà un `slot` optionnel avec repli sur le tempo du morceau, exactement
          // le même mécanisme que slotTiming()/sectionTiming() ailleurs dans ce fichier, réutilisé tel quel.
          const durationSec = blockSeconds(loopDef && loopDef.bars, loopDef) / trackPitchRatio; // temps réel
          showEmbrDetourWaveRow(buf, durationSec, false);
          embrDetourTimeout = setTimeout(() => withEmbrKey(swKey + ':ret', swKey, () => { // fin du détour : suit son départ
            fadeOutCurrentDetour();
            embrActiveLoopIdx = embrReferenceIdx;
            refreshEmbrGains(embrReferenceIdx);
            updateEmbrButtonsUI();
          }), durationSec * 1000);
        }
        updateEmbrButtonsUI();
      });
      if (transDelay > 0) embrPendingTransitionSwitchTimeout = setTimeout(() => { embrPendingTransitionSwitchTimeout = null; startDetour(); }, transDelay * 1000);
      else startDetour();
    }
    trackPublicEvent('embr_loop_select', { trackId: track.id, loopId: loopDef && loopDef.id });
  }
  // Clic sur un bouton nommé : bascule pure (rampe de gain) si la boucle ciblée est "paire" avec la
  // référence (elle tourne déjà en silence en arrière-plan, verrouillée en phase) ; détour ponctuel en
  // aller-retour si elle est plus courte (pas de verrouillage de phase possible, donc pas de lecture en
  // arrière-plan avant sélection — voir commentaire d'en-tête du moteur). Depuis le 24/08, la bascule
  // réelle (performEmbrSwitch) peut être différée selon le réglage de quantification de la boucle CIBLE --
  // un nouveau clic avant l'exécution d'une bascule en attente l'annule et la remplace, plutôt que
  // d'empiler les bascules.
  function selectEmbrLoop(idx) {
    if (!playing) return;
    if (!embrLoopBuffers[idx]) return;
    if (embrPendingSwitchTimeout) { clearTimeout(embrPendingSwitchTimeout); embrPendingSwitchTimeout = null; }
    const loopDef = (track.loops || [])[idx];
    const delaySec = embrQuantizeDelaySec(loopDef && loopDef.switchQuantize);
    if (delaySec <= 0.001) {
      performEmbrSwitch(idx);
    } else {
      embrPendingSwitchTimeout = setTimeout(() => { embrPendingSwitchTimeout = null; performEmbrSwitch(idx); }, delaySec * 1000);
    }
  }
  embrLoopBtns.forEach(btn => {
    btn.addEventListener('click', () => selectEmbrLoop(parseInt(btn.dataset.loopIdx, 10)));
  });
  // Cliquer/glisser sur la forme d'onde de la boucle EN COURS (gabarit riche uniquement) déplace la tête
  // de lecture -- même principe que les blocs séquentiels : position affichée en direct pendant le
  // glisser, seek audio réel seulement au relâchement. Un clic sur une AUTRE ligne reste une bascule de
  // boucle (inchangé). Pas de seek pendant un détour, une transition ou une bascule quantifiée en attente :
  // l'horloge de phase y est déjà engagée vers autre chose.
  embrLoopBtns.forEach(btn => {
    if (!btn.classList.contains('embr-wave-btn')) return;
    const idx = parseInt(btn.dataset.loopIdx, 10);
    let dragging = false;
    function fractionFromEvent(e) {
      const rect = btn.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    function showFraction(frac) {
      embrLoopBtns.forEach(b => {
        const fg = b.querySelector('.embr-wave-fg');
        if (!fg) return;
        fg.style.animation = 'none';
        fg.style.clipPath = `inset(0 ${(1 - frac) * 100}% 0 0)`;
      });
    }
    function isSeekable() {
      return playing && idx === embrActiveLoopIdx && !embrDetourSource
        && !embrPendingSwitchTimeout && !embrPendingTransitionSwitchTimeout;
    }
    btn.addEventListener('pointerdown', (e) => {
      if (!isSeekable()) return;
      dragging = true;
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      showFraction(fractionFromEvent(e));
    });
    btn.addEventListener('pointermove', (e) => {
      if (dragging) showFraction(fractionFromEvent(e));
    });
    btn.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      if (!isSeekable()) { applyEmbrWaveAnimation(embrCurrentCyclePosSec()); return; }
      trackPublicEvent('embr_seek', { trackId: track.id });
      seekEmbrVertical(fractionFromEvent(e));
    });
    btn.addEventListener('pointercancel', () => {
      if (!dragging) return;
      dragging = false;
      applyEmbrWaveAnimation(embrCurrentCyclePosSec());
    });
  });
  // Position actuelle dans le cycle (temps nominal du fichier) -- sert à remettre l'animation en place
  // quand un glisser est annulé sans seek.
  function embrCurrentCyclePosSec() {
    const cycle = embrCycleLengthSec();
    if (!(cycle > 0)) return 0;
    const elapsed = embrNominalAt(ctx.currentTime);
    return ((elapsed % cycle) + cycle) % cycle;
  }

  /* ---- Moteur vertical-random : sections chaînées, chacune avec ses pools simultanés et son propre
     tempo/timeline (30/07). La décision "quoi jouer ensuite" vient entièrement de
     createSectionPlaybackScheduler (logique pure, testée indépendamment — voir test-section-scheduler.js) ;
     ce qui suit ne fait que traduire ses décisions en programmation Web Audio réelle. ---- */
  let vrNextStartCtxTime = 0;
  let vrIsDraggingSeek = false; // pendant un glissement sur le bloc de section actif : le tick() n'écrase pas le remplissage affiché
  let vrSchedulerTimer = null;
  let vrCurrentSectionOriginalIndex = -1; // pour savoir quand la section affichée doit changer (rebuild du graphe)
  let vrPendingCut = false;
  function emitVROutcome(name, at, detail) {
    const cut = vrPendingCut; vrPendingCut = false;
    const rate = trackPitchRatio; // appelé à la programmation du cycle : vitesse de ses sources (pour l'export)
    voiceGraphTimeouts.push(setTimeout(() => {
      trackPublicEvent(name, Object.assign({}, detail, cut ? { cut: { hard: true, fadeSec: 0 } } : {}), { at, rate });
    }, Math.max(0, (at - ctx.currentTime) * 1000)));
  }
  function scheduleSectionGeneration(ctxStartTime, secIdx, isFirstEverForThisSection, offsetOverride) {
    const section = resolveVRSection(track, secIdx);
    const declaredSection = (track.sections || [])[secIdx];
    const timing = sectionTiming(section);
    const bufferOffset = offsetOverride != null ? offsetOverride : (isFirstEverForThisSection ? timing.startTrackSec : timing.loopInSec);
    const pools = section.pools || [];
    const poolPicks = [];
    const telemetryPicks = []; // { poolIndex, altIndex } par pool réellement tiré CE cycle -- seule donnée qui
    // permette de reproduire fidèlement l'audio à l'export (moteur de capture, pack.html) sans pour autant
    // détailler le pool dans l'éditeur de frise lui-même (demande explicite de Jules-Antoine le 2026-09-16 :
    // "dans l'éditeur, on ne détaille pas le contenu du pool" -- ce champ reste un détail interne à
    // l'événement, jamais affiché comme une piste séparée).
    pools.forEach((pool, poolIdx) => {
      const displaySlot = poolIdx; // les sections d'un même morceau ont chacune leur propre liste de pools,
      // affichée dans les mêmes emplacements visuels 0..N-1 (voir vrMaxPoolCount) — une section avec moins
      // de pools laisse simplement les emplacements suivants masqués.
      const bufs = (sectionBuffers[secIdx] && sectionBuffers[secIdx][poolIdx]) || [];
      const idx = pickPoolAlternativeIndex(secIdx, poolIdx);
      telemetryPicks.push({ poolIndex: displaySlot, altIndex: idx });
      let label = '—', silent = true, pickedBuf = null;
      if (idx >= 0) {
        const alt = (pool.alternatives || [])[idx];
        const buf = bufs[idx];
        silent = !buf;
        pickedBuf = buf;
        label = buf ? ((alt && alt.label) ? alt.label : t('altFallback', { n: idx + 1 })) : t('silenceLabel');
        if (buf) {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          applyTrackPitchRate(src, ctxStartTime);
          const g = ctx.createGain();
          const key = 'pool-' + displaySlot;
          const base = effGain(alt);
          g.gain.setValueAtTime(base * voiceGain(key), ctxStartTime);
          // fx : porté par le pool (la "voix"/l'emplacement), pas par l'alternative tirée au sort -- même
          // chaîne quel que soit le tirage, cf. la logique retenue pour les emplacements séquentiels.
          const fxChain = buildTargetFxChain('pool:' + secIdx + ':' + poolIdx, pool.fx, src, ctxStartTime);
          if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
          g.connect(trackMasterGain);
          // Chaque génération de pool rejoue une fois sans boucle -- onended fiable pour le nettoyage du
          // bitcrusher, comme pour les autres moteurs. armVRFinalEnd() chaîne sur ce handler plutôt que de
          // l'écraser -- voir son commentaire.
          if (fxChainHasLeakyNode(fxChain)) {
            src.onended = () => { disconnectLeakyFxNodes(fxChain); };
          }
          journalVoice(src, g, fxChain);
          src.start(ctxStartTime, bufferOffset);
          activeGenSources.push({ src, gain: g, voiceKey: key, baseGain: base });
        }
      }
      poolPicks.push({ pi: displaySlot, label, silent, buf: pickedBuf });
    });
    // Emplacements au-delà du nombre de pools de CETTE section (mais existants pour une autre section
    // du même morceau, donc présents dans le graphe) : masqués, pas juste silencieux.
    for (let pi = pools.length; pi < vrMaxPoolCount; pi++) poolPicks.push({ pi, label: '—', silent: true, buf: null });
    scheduleVoiceGraphUpdate(ctxStartTime, poolPicks, secIdx);
    lastGenSources = activeGenSources.slice(-Math.max(1, pools.length)).map(s => s.src);
    scheduledGens.push({ ctxStartTime, bufferOffset, ratio: trackPitchRatio });
    // Capture/export (2026-09-16, voir pack.html) : un cycle de section = une fenêtre autonome à reproduire
    // fidèlement (mêmes tirages, même offset dans les fichiers) -- déclenché à CHAQUE appel de cette
    // fonction, donc aussi bien un vrai changement de section qu'un simple bouclage de la section courante
    // OU un seek manuel (seekVerticalRandom réutilise ce même point d'entrée) : les trois sont des moments
    // où de nouvelles sources démarrent réellement, donc trois moments valides à capturer.
    // Émis au moment où le cycle devient AUDIBLE (25/09, comme le séquentiel) : un cycle programmé puis annulé
    // (nouveau tirage, saut, arrêt -- voiceGraphTimeouts vidé) n'est jamais annoncé. cut : ce cycle remplace net les
    // sources précédentes (nouveau tirage / saut), au lieu de laisser finir leur queue.
    emitVROutcome('vr_section_start', ctxStartTime, {
      trackId: track.id, sectionId: (declaredSection && declaredSection.id) || null, sectionIndex: secIdx,
      bufferOffset, picks: telemetryPicks,
    });
    const roughCutoffWindow = 8; // les sections n'ont pas de cycleLength unique commun, fenêtre fixe raisonnable
    const cutoff = ctx.currentTime - roughCutoffWindow;
    if (scheduledGens.length > 12) scheduledGens = scheduledGens.filter(g => g.ctxStartTime >= cutoff);
    return timing;
  }
  function sectionSchedulerTick() {
    const lookahead = 1.0;
    while (vrNextStartCtxTime < ctx.currentTime + lookahead) {
      const next = sectionScheduler.decideNext();
      if (!next) {
        clearInterval(vrSchedulerTimer); vrSchedulerTimer = null;
        armVRFinalEnd();
        return;
      }
      if (next.type === 'intro') {
        if (!introBuffer) continue; // pas de fichier intro chargé : ignoré, on redemande immédiatement la suite
        const src = ctx.createBufferSource();
        src.buffer = introBuffer;
        applyTrackPitchRate(src, vrNextStartCtxTime);
        const g = ctx.createGain();
        g.gain.setValueAtTime(effGain(track.intro), vrNextStartCtxTime);
        const fxChain = buildTargetFxChain('intro', track.intro && track.intro.fx, src, vrNextStartCtxTime);
        if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
        g.connect(trackMasterGain);
        if (fxChainHasLeakyNode(fxChain)) {
          src.onended = () => { disconnectLeakyFxNodes(fxChain); };
        }
        journalVoice(src, g, fxChain);
        src.start(vrNextStartCtxTime, 0);
        activeGenSources.push({ src, gain: g, voiceKey: 'intro', baseGain: effGain(track.intro) });
        lastGenSources = [src];
        scheduledGens.push({ ctxStartTime: vrNextStartCtxTime, bufferOffset: 0, ratio: trackPitchRatio });
        emitVROutcome('vr_intro_start', vrNextStartCtxTime, { trackId: track.id });
        // Durée nominale de l'intro : mesures déclarées, au tempo de la PREMIÈRE section jouable (elle
        // seule a un sens ici, l'intro n'appartenant à aucune section) — la partie du fichier qui dépasse
        // cette durée nominale forme la queue de chevauchement, exactement comme en séquentiel.
        const firstPlayableOrigIdx = playableSectionOriginalIndex[0];
        const firstSection = firstPlayableOrigIdx !== undefined ? resolveVRSection(track, firstPlayableOrigIdx) : null;
        // Tempo propre à l'intro s'il a été réglé dans le Backstage (25/09), sinon celui de la première section.
        const introDurationSec = vrIntroDurationSec(track, firstSection);
        vrNextStartCtxTime += introDurationSec / trackPitchRatio;
        continue;
      }
      if (next.type === 'outro') {
        if (!outroBuffer) { clearInterval(vrSchedulerTimer); vrSchedulerTimer = null; armVRFinalEnd(); return; }
        const src = ctx.createBufferSource();
        src.buffer = outroBuffer;
        applyTrackPitchRate(src, vrNextStartCtxTime);
        const g = ctx.createGain();
        g.gain.setValueAtTime(effGain(track.outro), vrNextStartCtxTime);
        const fxChain = buildTargetFxChain('outro', track.outro && track.outro.fx, src, vrNextStartCtxTime);
        if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
        g.connect(trackMasterGain);
        if (fxChainHasLeakyNode(fxChain)) {
          src.onended = () => { disconnectLeakyFxNodes(fxChain); };
        }
        journalVoice(src, g, fxChain);
        src.start(vrNextStartCtxTime, 0);
        activeGenSources.push({ src, gain: g, voiceKey: 'outro', baseGain: effGain(track.outro) });
        lastGenSources = [src];
        scheduledGens.push({ ctxStartTime: vrNextStartCtxTime, bufferOffset: 0, ratio: trackPitchRatio });
        emitVROutcome('vr_outro_start', vrNextStartCtxTime, { trackId: track.id });
        clearInterval(vrSchedulerTimer); vrSchedulerTimer = null;
        armVRFinalEnd();
        return;
      }
      // next.type === 'section'
      const origIdx = playableSectionOriginalIndex[next.index];
      const timing = scheduleSectionGeneration(vrNextStartCtxTime, origIdx, next.isFirstEverForThisSection);
      vrNextStartCtxTime += (next.isFirstEverForThisSection ? (timing.loopOutSec - timing.startTrackSec) : timing.cycleLength) / trackPitchRatio;
    }
  }
  function armVRFinalEnd() {
    const marker = lastGenSources[0];
    if (!marker) return;
    finalGenerationMarkerSrc = marker;
    // Chaîne sur un éventuel onended déjà posé (nettoyage du bitcrusher, voir scheduleSectionGeneration et
    // le bloc outro plus haut) plutôt que de l'écraser -- même raisonnement que armSeqFinalEnd().
    const previousOnEnded = marker.onended;
    marker.onended = () => {
      if (previousOnEnded) previousOnEnded();
      if (finalGenerationMarkerSrc !== marker) return;
      activeGenSources = [];
      playing = false;
      playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
      cancelAnimationFrame(rafId);
      updateProgressAt(0);
      setStoppedUI();
      if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('goToEndBtn'); }
      if (goToNextSectionBtn) goToNextSectionBtn.disabled = true;
      if (activeTrackId === track.id) activeTrackId = null;
    };
  }
  function stopVerticalRandom() {
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
    finalGenerationMarkerSrc = null;
    if (vrSchedulerTimer) { clearInterval(vrSchedulerTimer); vrSchedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch(e){} });
    activeGenSources = [];
    voiceGraphTimeouts.forEach(id => clearTimeout(id));
    voiceGraphTimeouts = [];
    voiceWavePools.forEach(els => { if (els && els.fg) { els.fg.style.transition = 'none'; els.fg.style.clipPath = 'inset(0 100% 0 0)'; } });
    voiceCurrents.forEach(el => { if (el) el.textContent = '—'; });
    let anyWasHidden = false;
    wwisePoolVoiceEls.forEach(el => { if (el && el.style.display === 'none') { anyWasHidden = true; el.style.display = ''; } });
    if (anyWasHidden) drawWwiseLines();
    if (sectionCurrentEl) sectionCurrentEl.textContent = '—';
    vrBlockEls.forEach(el => { if (el) el.classList.remove('active'); });
    vrBlockFillEls.forEach(el => { if (el) el.style.width = '0%'; });
    vrCurrentSectionOriginalIndex = -1;
  }
  function playVerticalRandom(isContinuation) {
    stopVerticalRandom();
    // Un vrai démarrage (pas une reprise après pause/veille) repart de zéro : nouvel ordre de sections
    // (rebrassé si "randomiser" est coché), intro rejouée si présente. Une reprise continue la chaîne là
    // où elle en était — même convention que playSequential(isContinuation) pour le séquentiel.
    if (!isContinuation || !sectionScheduler) {
      vrPlayableSectionRefs = playableSectionOriginalIndex.map(origIdx => ({ maxLoops: resolveVRSection(track, origIdx).maxLoops }));
      sectionScheduler = createSectionPlaybackScheduler(
        vrPlayableSectionRefs,
        {
          randomize: !!track.randomizeSections, hasIntro: !!introBuffer, hasOutro: !!outroBuffer,
          // Getter plutôt qu'une valeur figée à la création : le sélecteur visiteur mute track.maxChainLoops
          // directement (voir plus bas), donc chaque cycle voit la valeur à jour sans recréer le scheduler.
          get maxChainLoops() { return track.maxChainLoops || null; }
        }
      );
    }
    vrNextStartCtxTime = startSoon(); // toutes les voix du premier cycle sur un même instant (voir startSoon)
    sectionSchedulerTick();
    vrSchedulerTimer = setInterval(sectionSchedulerTick, 200);
    if (goToEndBtn) goToEndBtn.disabled = false;
    if (goToNextSectionBtn) goToNextSectionBtn.disabled = false;
  }
  // Glisser sur le bloc de la section EN COURS (voir vrBlockEls) : recherche à l'intérieur du cycle de
  // CETTE section uniquement, sans faire avancer la chaîne (même esprit que rerollPool) — les autres
  // blocs ne sont pas cliquables, une "position" n'ayant de sens que dans la section qui joue réellement.
  function seekVerticalRandom(fraction) {
    if (!playing || vrCurrentSectionOriginalIndex < 0) return;
    const origIdx = vrCurrentSectionOriginalIndex;
    const section = resolveVRSection(track, origIdx);
    const timing = sectionTiming(section);
    const offset = timing.loopInSec + fraction * timing.cycleLength;
    if (vrSchedulerTimer) { clearInterval(vrSchedulerTimer); vrSchedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch (e) {} });
    activeGenSources = [];
    voiceGraphTimeouts.forEach(id => clearTimeout(id));
    voiceGraphTimeouts = [];
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    vrPendingCut = true;
    scheduleSectionGeneration(now, origIdx, false, offset);
    const timeUntilNext = timing.cycleLength - (fraction * timing.cycleLength);
    vrNextStartCtxTime = now + Math.max(0.02, timeUntilNext / trackPitchRatio);
    vrSchedulerTimer = setInterval(sectionSchedulerTick, 200);
  }

  // État nécessaire pour qu'un vrai Pause manuel (bouton Lecture/Pause) reprenne EXACTEMENT où la lecture
  // en était, plutôt que de repartir du tout début (bug signalé le 07/09 par Jules-Antoine : "pause"
  // stoppait complètement la lecture au lieu de la mettre en pause). Pour le séquentiel, l'embranchement
  // vertical et le vertical-random, les fonctions stop* ci-dessous réinitialisent volontairement l'identité
  // du bloc/de la boucle/de la section en cours (comportement voulu pour un vrai Stop, ou pour la reprise
  // après veille qui a ses propres mécanismes dédiés, voir seekSequential/seekVerticalRandom/
  // resumeEmbrVerticalAfterBackground) — donc capturé ICI, AVANT l'appel au stop du moteur. Pour le moteur
  // simple/quantifié, rien à faire : offsetAt (mis à jour par stopSimple/stopQuantized) suffit déjà.
  let pausedResume = null;
  function captureResumeState() {
    if (isSequential) {
      const b = currentSeqBlockInfo;
      if (!b) { pausedResume = null; return; }
      pausedResume = {
        kind: 'sequential',
        blockKind: b.kind, buffer: b.buffer, gain: b.gain, totalSec: b.totalSec, terminal: b.terminal, slotIdx: b.slotIdx,
        offsetSec: Math.max(0, Math.min(b.totalSec - 0.05, ctx.currentTime - b.virtualZero)),
        label: seqCurrentEl ? seqCurrentEl.textContent : '',
        descHtml: trackDescEl ? trackDescEl.innerHTML : '',
        goToEndRequested, pendingNextSegmentId
      };
    } else if (isEmbrVert) {
      pausedResume = { kind: 'embrVert', embrLoopIdx: embrActiveLoopIdx >= 0 ? embrActiveLoopIdx : embrReferenceIdx };
    } else if (isVerticalRandom) {
      if (vrCurrentSectionOriginalIndex < 0) { pausedResume = null; return; }
      const origIdx = vrCurrentSectionOriginalIndex;
      const section = resolveVRSection(track, origIdx);
      const timing = sectionTiming(section);
      const elapsed = currentPlaybackOffset();
      const frac = timing.cycleLength > 0 ? Math.min(1, Math.max(0, (elapsed - timing.loopInSec) / timing.cycleLength)) : 0;
      pausedResume = { kind: 'verticalRandom', origIdx, frac };
    } else {
      pausedResume = null;
    }
  }
  // Reprend précisément l'état capturé par captureResumeState() ci-dessus. Appelée par playThisTrack() une
  // fois que playing/activeTrackId/etc. sont déjà remis à jour — reprend le rôle que jouerait normalement
  // playSequential()/playEmbrVertical()/playVerticalRandom() pour un vrai (re)démarrage.
  function resumeFromPause() {
    const r = pausedResume; pausedResume = null;
    if (!r) return false;
    if (r.kind === 'sequential') {
      goToEndRequested = r.goToEndRequested;
      pendingNextSegmentId = r.pendingNextSegmentId;
      const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
      const remaining = Math.max(0.05, r.totalSec - r.offsetSec);
      // `remaining` transmis TOUJOURS (jamais null), y compris pour un bloc terminal (l'outro) — même
      // raison que seekSequential() ci-dessus : passer null ferait recaler le remplissage visuel sur
      // buffer.duration (durée totale) plutôt que ce qu'il en reste après la reprise.
      scheduleSeqGeneration(now, r.buffer, r.label, r.blockKind, remaining, r.gain, r.offsetSec, r.totalSec, r.terminal, r.slotIdx);
      if (trackDescEl) trackDescEl.innerHTML = r.descHtml;
      if (r.terminal) {
        armSeqFinalEnd();
        if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('endingWithOutro'); }
      } else {
        seqNextStartCtxTime = now + remaining / trackPitchRatio;
        seqSchedulerTimer = setInterval(seqSchedulerTick, 200);
        if (goToEndBtn) {
          if (goToEndRequested) {
            goToEndBtn.disabled = true;
            goToEndBtn.textContent = track.outro ? t('endingWithOutro') : t('endingLastSegment');
          } else {
            goToEndBtn.disabled = false;
          }
        }
      }
    } else if (r.kind === 'embrVert') {
      embrActiveLoopIdx = r.embrLoopIdx;
      const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
      embrClockReset(now, 0);
      scheduleEmbrGeneration(now, true);
      embrNextStartCtxTime = now + embrCycleLengthSec() / trackPitchRatio;
      embrSchedulerTimer = setInterval(embrSchedulerTick, 200);
      updateEmbrButtonsUI();
      applyEmbrWaveAnimation();
    } else if (r.kind === 'verticalRandom') {
      vrCurrentSectionOriginalIndex = r.origIdx;
      const declaredSection = (track.sections || [])[r.origIdx];
      if (sectionCurrentEl) sectionCurrentEl.textContent = (declaredSection && declaredSection.label) || t('sectionFallback', { n: r.origIdx + 1 });
      vrBlockEls.forEach((el, i) => { if (el) el.classList.toggle('active', i === r.origIdx); });
      seekVerticalRandom(r.frac);
    }
    return true;
  }
  // Repeint par-dessus l'UI que stopAllSources() vient de remettre à plat (libellé "—", bloc/boucle/section
  // désactivés) avec l'état figé au moment de la pause, capturé juste avant par captureResumeState() —
  // pour qu'une pause manuelle donne l'impression de vraiment "geler" l'affichage plutôt que de l'effacer
  // puis de le faire réapparaître à la reprise (peaufinage demandé le 10/09 par Jules-Antoine). Purement
  // visuel : aucune de ces valeurs ne relance quoi que ce soit tant que playing reste false.
  function applyPausedUI() {
    const r = pausedResume;
    if (!r) return;
    if (r.kind === 'sequential') {
      if (seqCurrentEl) seqCurrentEl.textContent = r.label;
      if (trackDescEl) trackDescEl.innerHTML = r.descHtml;
      const block = seqBlockEls[r.blockKind], els = seqWaveEls[r.blockKind];
      if (block) { block.classList.remove('done'); block.classList.add('active'); }
      if (els && els.fg) {
        const frac = r.totalSec > 0 ? Math.max(0, Math.min(1, r.offsetSec / r.totalSec)) : 0;
        els.fg.style.transition = 'none';
        els.fg.style.clipPath = `inset(0 ${(1 - frac) * 100}% 0 0)`;
      }
      if (r.slotIdx != null && r.slotIdx >= 0) updateSeqMap(r.slotIdx);
    } else if (r.kind === 'embrVert') {
      embrLoopBtns.forEach(btn => { btn.classList.toggle('active', parseInt(btn.dataset.loopIdx, 10) === r.embrLoopIdx); });
    } else if (r.kind === 'verticalRandom') {
      const declaredSection = (track.sections || [])[r.origIdx];
      if (sectionCurrentEl) sectionCurrentEl.textContent = (declaredSection && declaredSection.label) || t('sectionFallback', { n: r.origIdx + 1 });
      vrBlockEls.forEach((el, i) => { if (el) el.classList.toggle('active', i === r.origIdx); });
      if (vrBlockFillEls[r.origIdx]) vrBlockFillEls[r.origIdx].style.width = (r.frac * 100) + '%';
    }
  }
  // Stop (25/09, demande de Jules-Antoine) : contrairement à Pause, oublie la position -- la prochaine
  // lecture est un vrai démarrage (intro, premier emplacement/section, boucle de référence, offset 0) et
  // ouvre une nouvelle prise. Le bouton n'est visible que lorsqu'il y a quelque chose à arrêter (lecture
  // en cours ou pause en milieu de morceau).
  function stopThisTrack() {
    pausedResume = null;
    stopAllSources(false);
    // Moteur quantifié : la position de départ est le point de départ réglé par le compositeur (startTrackBeat), pas
    // le tout début du fichier -- comme au tout premier chargement et après une fin naturelle.
    offsetAt = useQuantizedLoop ? startTrackSec : 0;
    updateProgressAt(offsetAt);
    if (take) take.resumable = false;
    if (statusEl) statusEl.textContent = t('readyStatus');
    if (activeTrackId === track.id) activeTrackId = null;
    trackPublicEvent('track_stop', { trackId: track.id, mode: track.mode });
    updateStopBtn();
  }
  function updateStopBtn() {
    if (stopBtn) stopBtn.style.display = (playing || pausedResume || offsetAt > (useQuantizedLoop ? startTrackSec : 0)) ? '' : 'none'; // pas l'attribut hidden : .play-btn impose display:flex
  }
  function pauseThisTrack() {
    captureResumeState();
    stopAllSources();
    applyPausedUI();
    // Prise : seule une vraie pause se reprend dans la même prise (une fin naturelle ou un autre morceau lancé entre-temps
    // en ouvriront une nouvelle au prochain démarrage). Pas pausedResume : le moteur simple reprend sans lui (offsetAt).
    if (take) take.resumable = true;
  }
  function stopAllSources(keepPosition) {
    playing = false;
    playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
    // Annule toute rampe de ducking en cours et revient à 1 immédiatement — sinon une prochaine lecture
    // pourrait démarrer avec un gain maître encore abaissé (ou en cours de remontée programmée dans le
    // futur) si le morceau est arrêté pile pendant qu'un Sfx joue.
    trackMasterGain.gain.cancelScheduledValues(ctx.currentTime);
    trackMasterGain.gain.setValueAtTime(1, ctx.currentTime);
    if (isSequential) {
      stopSequential();
    } else if (isEmbrVert) {
      stopEmbrVertical();
    } else if (isVerticalRandom) {
      // Comme le séquentiel, la reprise après pause/veille passe par l'état déjà conservé du scheduler
      // (sectionScheduler persiste tant que la piste n'est pas complètement relancée) — jamais par
      // offsetAt, qui n'a plus de sens unique sur plusieurs sections potentiellement enchaînées.
      stopVerticalRandom();
    } else if (useQuantizedLoop) {
      if (keepPosition !== false) {
        offsetAt = currentPlaybackOffset();
      }
      stopQuantized();
    } else {
      stopSimple(keepPosition);
    }
    cancelAnimationFrame(rafId);
    vertMeterFills.forEach(el => { if (el) { el.style.transition = 'none'; el.style.width = '0%'; } });
    setStoppedUI();
  }
  function naturalEnd() {
    playing = false;
    playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
    trackMasterGain.gain.cancelScheduledValues(ctx.currentTime);
    trackMasterGain.gain.setValueAtTime(1, ctx.currentTime);
    cancelAnimationFrame(rafId);
    offsetAt = 0;
    updateProgressAt(0);
    setStoppedUI();
    if (activeTrackId === track.id) activeTrackId = null;
  }
  function playThisTrack(reroll, isContinuation) {
    if (activeTrackId && activeTrackId !== track.id) {
      document.dispatchEvent(new CustomEvent('stop-track', { detail: activeTrackId }));
      if (trackStingerKillers[activeTrackId]) trackStingerKillers[activeTrackId]();
    }
    Object.keys(trackCollapsers).forEach(id => {
      if (id !== track.id) trackCollapsers[id]();
    });
    activeTrackId = track.id;
    setDetailsExpanded(details, true);
    updateStingerAvailability();
    resumeAudioContext();
    playing = true;
    playingTrackIds.add(track.id); requestWakeLock();
    // Capture vidéo : niveau d'intensité de départ (le visiteur a pu le choisir avant d'appuyer sur Lecture).
    if (!isContinuation) trackPublicEvent('track_play', { trackId: track.id, mode: track.mode }, { level });
    if (!isContinuation && !pausedResume) resetFxTriggers();
    // Prise (Figer) : un vrai démarrage en ouvre une nouvelle ; une reprise, un saut ou un retour de veille continue la
    // même (le journal note ce qui est réellement rejoué, quel que soit le chemin pris par le moteur).
    if (isContinuation || (take && take.resumable)) resumeTake(); else startTake();
    if (pausedResume && resumeFromPause()) {
      // Reprise exacte après un vrai Pause manuel — voir captureResumeState()/resumeFromPause() ci-dessus.
    } else if (isSequential) {
      playSequential(isContinuation);
    } else if (isEmbrVert) {
      playEmbrVertical();
    } else if (isVerticalRandom) {
      playVerticalRandom(isContinuation);
    } else if (useQuantizedLoop) {
      // Un vrai démarrage à froid réinitialise le budget de boucles (le premier passage compte déjà comme 1) ;
      // un reroll ou une recherche en cours de lecture (isContinuation) ne remet pas le compteur à zéro et ne l'avance pas non plus.
      // Note : on ne peut pas déduire ça de `playing`, qui est déjà retombé à false par le stopAllSources(false)
      // que ces deux appelants font juste avant — d'où ce paramètre explicite plutôt qu'une lecture d'état ambiant.
      if (!isContinuation) loopsPlayed = 1;
      playQuantized(offsetAt % track.duration);
    } else {
      playSimple();
    }
    playIcon.innerHTML = PAUSE_SVG;
    if (statusEl) statusEl.textContent = t('playingStatus');
    updateStopBtn();
    tick();
  }

  function rerollPool() {
    if (!isVerticalRandom) return;
    trackPublicEvent('pool_refresh', { trackId: track.id });
    if (!playing || vrCurrentSectionOriginalIndex < 0) {
      Object.keys(lastPickedPoolIndex).forEach(k => { lastPickedPoolIndex[k] = -1; });
      return;
    }
    // Rejoue la MÊME section avec de nouveaux tirages, sans faire avancer la chaîne d'un cran (contrairement
    // à un vrai changement de section) — n'arrête donc que les sources en cours, pas le scheduler pur
    // sous-jacent (sectionScheduler), dont l'état de progression reste intact.
    const origIdx = vrCurrentSectionOriginalIndex;
    if (vrSchedulerTimer) { clearInterval(vrSchedulerTimer); vrSchedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch (e) {} });
    activeGenSources = [];
    voiceGraphTimeouts.forEach(id => clearTimeout(id));
    voiceGraphTimeouts = [];
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    vrPendingCut = true;
    const timing = scheduleSectionGeneration(now, origIdx, false);
    vrNextStartCtxTime = now + timing.cycleLength / trackPitchRatio;
    vrSchedulerTimer = setInterval(sectionSchedulerTick, 200);
  }

  const titleToggle = wrapper.querySelector('[data-role="titleToggle"]');
  if (titleToggle) titleToggle.addEventListener('click', updateStingerAvailability);
  const refreshPoolBtn = wrapper.querySelector('[data-role="refreshPool"]');
  if (refreshPoolBtn) refreshPoolBtn.addEventListener('click', rerollPool);

  wrapper.querySelectorAll('[data-voice-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.voiceKey;
      const action = btn.dataset.voiceAction;
      const set = action === 'solo' ? soloedVoices : mutedVoices;
      if (set.has(key)) set.delete(key); else set.add(key);
      const active = set.has(key);
      btn.classList.toggle('active', active);
      refreshVoiceGains();
      trackPublicEvent(action === 'solo' ? 'voice_solo_toggle' : 'voice_mute_toggle', { trackId: track.id, voice: key, active });
    });
  });
  // Volume par voix : 'input' pour un retour audio et visuel immédiat pendant le glissement (même
  // rampe courte que refreshVoiceGains partout ailleurs) ; 'change' pour ne tracker que la valeur
  // finale relâchée, pas chaque pas intermédiaire du curseur.
  wrapper.querySelectorAll('.voice-volume-slider').forEach(slider => {
    const key = slider.dataset.voiceKey;
    const valueEl = wrapper.querySelector(`[data-role="volumeValue-${key}"]`);
    slider.addEventListener('input', () => {
      layerVolumes.set(key, parseFloat(slider.value));
      // Repère de capture à chaque pas du glisser (le son suit le curseur en direct) ; la statistique, elle, ne
      // retient que la valeur relâchée (voir 'change').
      captureMark('voice_volume_change', { trackId: track.id, voice: key, value: parseFloat(slider.value) });
      if (valueEl) valueEl.textContent = Math.round(parseFloat(slider.value) * 100) + '%';
      refreshVoiceGains();
    });
    slider.addEventListener('change', () => {
      trackPublicEvent('voice_volume_change', { trackId: track.id, voice: key, value: parseFloat(slider.value) });
    });
  });
  if (goToEndBtn) {
    goToEndBtn.addEventListener('click', () => {
      if (!playing) return;
      if (isVerticalRandom) {
        if (!sectionScheduler) return;
        sectionScheduler.requestGoToEnd();
        goToEndBtn.disabled = true;
        goToEndBtn.textContent = layerHasSource(track.outro) ? t('endingWithOutro') : t('endingLastSegment');
      } else {
        if (goToEndRequested) return;
        goToEndRequested = true;
        goToEndBtn.disabled = true;
        goToEndBtn.textContent = track.outro ? t('endingWithOutro') : t('endingLastSegment');
      }
      trackPublicEvent('go_to_end_click', { trackId: track.id });
    });
  }
  if (goToNextSectionBtn) {
    goToNextSectionBtn.addEventListener('click', () => {
      if (!playing || !sectionScheduler) return;
      sectionScheduler.requestGoToNextSection();
      trackPublicEvent('go_to_next_section_click', { trackId: track.id });
    });
  }

  // Glisser sur la waveform du bloc séquentiel actuellement actif pour avancer/reculer dedans — même
  // principe que la barre de lecture des autres modes (position affichée en direct pendant le glisser,
  // seek audio réel seulement au relâchement), mais limité au bloc en cours : impossible de glisser sur
  // un bloc déjà terminé (figé) ou pas encore atteint (son contenu n'est pas encore tiré au sort).
  Object.keys(seqBlockEls).forEach(kind => {
    const block = seqBlockEls[kind];
    const els = seqWaveEls[kind];
    if (!block || !els || !els.fg) return;
    let dragging = false;
    function fractionFromEvent(e) {
      const rect = block.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    function isSeekable() { return playing && currentSeqBlockInfo && currentSeqBlockInfo.kind === kind && block.classList.contains('active'); }
    block.addEventListener('pointerdown', (e) => {
      if (!isSeekable()) return;
      dragging = true;
      try { block.setPointerCapture(e.pointerId); } catch (err) {}
      els.fg.style.transition = 'none';
      els.fg.style.clipPath = `inset(0 ${(1 - fractionFromEvent(e)) * 100}% 0 0)`;
    });
    block.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      els.fg.style.clipPath = `inset(0 ${(1 - fractionFromEvent(e)) * 100}% 0 0)`;
    });
    block.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      const targetSec = fractionFromEvent(e) * currentSeqBlockInfo.totalSec;
      trackPublicEvent('seq_block_seek', { trackId: track.id, kind });
      seekSequential(targetSec);
    });
    block.addEventListener('pointercancel', () => { dragging = false; });
  });

  document.addEventListener('stop-track', (e) => { if (e.detail === track.id) stopAllSources(); });
  // Reprise après mise en veille de l'écran ou passage en arrière-plan : les minuteurs de programmation
  // et l'horloge audio peuvent avoir été suspendus pendant ce temps, laissant une programmation obsolète
  // qui resterait silencieuse indéfiniment sans ça. On relance proprement depuis la position actuelle
  // plutôt que de laisser un état incohérent qui obligerait à recharger la page.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !playing) return;
    resumeAudioContext();
    // Séquentiel et vertical-random (bug trouvé le 13/08) : le chemin générique ci-dessous arrêtait tout
    // puis relançait la chaîne via un tout nouveau tirage (isContinuation=true préserve la position dans
    // la CHAÎNE, mais le bloc en cours au moment du passage en arrière-plan était perdu, remplacé par un
    // nouveau bloc qui, lui, repart de sa propre position 0 — d'où l'impression de "repartir de zéro").
    // Correctif : réutiliser les mêmes primitives de recherche (seek) déjà éprouvées pour le glissement
    // manuel sur la waveform, qui rejouent précisément le bloc/section EN COURS à sa position réelle
    // plutôt que d'en tirer un nouveau.
    if (isSequential) {
      if (currentSeqBlockInfo) seekSequential(ctx.currentTime - currentSeqBlockInfo.virtualZero);
      return;
    }
    if (isVerticalRandom) {
      if (vrCurrentSectionOriginalIndex >= 0) {
        const section = resolveVRSection(track, vrCurrentSectionOriginalIndex);
        const timing = sectionTiming(section);
        const elapsed = currentPlaybackOffset();
        const frac = timing.cycleLength > 0 ? Math.min(1, Math.max(0, (elapsed - timing.loopInSec) / timing.cycleLength)) : 0;
        seekVerticalRandom(frac);
      }
      return;
    }
    // Embranchement-vertical (29/08, bug signalé par Jules-Antoine : changer d'onglet relançait le morceau
    // depuis la référence) : chemin dédié plutôt que le repli générique ci-dessous, qui appelle
    // playEmbrVertical() sans discernement -- or cette fonction réinitialise TOUJOURS embrActiveLoopIdx sur
    // la référence, perdant la boucle réellement active (ex. "On est repéré !") au profit d'un retour
    // silencieux à la case départ.
    if (isEmbrVert) {
      // (05/09, retour direct : "on veut que l'audio continue même si on va sur un autre onglet -- ce
      // qu'il fait déjà -- mais qu'il ne reprenne pas au début quand on revient"). Le Web Audio de ce
      // moteur continue réellement de jouer en arrière-plan la plupart du temps (aucune vraie coupure) --
      // reconstruire systématiquement toute la programmation à CHAQUE retour d'onglet, sans savoir si
      // quelque chose a vraiment été interrompu, provoquait donc un redémarrage audible depuis le début du
      // fichier alors que rien n'en avait besoin. On ne relance que si quelque chose a RÉELLEMENT été
      // interrompu : le contexte audio a été suspendu par le navigateur (ctx.state), ou le planificateur
      // périodique (setInterval, que certains navigateurs ralentissent ou gèlent en arrière-plan) a pris du
      // retard au point de ne plus avoir de génération programmée à l'heure -- sinon, on ne touche à rien,
      // la lecture en cours continue exactement telle quelle.
      const schedulerLate = embrSchedulerTimer && embrNextStartCtxTime < ctx.currentTime - 0.5;
      if (ctx.state === 'running' && !schedulerLate) return;
      resumeEmbrVerticalAfterBackground();
      return;
    }
    const resumeFrom = computeElapsed();
    stopAllSources(false);
    offsetAt = resumeFrom;
    playThisTrack(false, true);
  });
  playBtn.addEventListener('click', () => { playing ? pauseThisTrack() : playThisTrack(true); });
  if (stopBtn) stopBtn.addEventListener('click', stopThisTrack);

  // Vertical-random (fusionné le 30/07) : pas de recherche par glissement — avec plusieurs sections
  // potentiellement enchaînées dans un ordre mélangé, "une position dans le temps" n'a plus de sens
  // unique à faire glisser vers. La barre reste un indicateur visuel de progression dans la section en
  // cours, juste non interactive pour ce mode.
  if (wrap && !isVerticalRandom) {
    // Glisser-déposer sur la barre de lecture (pas juste un tap) : la position se met à jour en direct
    // pendant le glissement (y compris la waveform), et la vraie recherche audio (arrêt/redémarrage des
    // sources) ne se déclenche qu'au relâchement — sinon on redémarrerait l'audio à chaque pixel parcouru.
    function seekPctFromEvent(e) {
      const rect = wrap.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    wrap.addEventListener('pointerdown', (e) => {
      isDraggingSeek = true;
      try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
      updateProgressAt(seekPctFromEvent(e) * progressMaxSec());
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!isDraggingSeek) return;
      updateProgressAt(seekPctFromEvent(e) * progressMaxSec());
    });
    wrap.addEventListener('pointerup', (e) => {
      if (!isDraggingSeek) return;
      isDraggingSeek = false;
      const seekTo = seekPctFromEvent(e) * progressMaxSec();
      if (playing) { stopAllSources(false); offsetAt = seekTo; playThisTrack(false, true); }
      else { offsetAt = seekTo; updateProgressAt(offsetAt); }
    });
    wrap.addEventListener('pointercancel', () => { isDraggingSeek = false; });
  }

  // Glisser sur le bloc de la section EN COURS uniquement (voir seekVerticalRandom) — les autres blocs
  // ne réagissent pas, une "position" n'ayant de sens que dans la section qui joue réellement.
  vrBlockEls.forEach((block, i) => {
    if (!block) return;
    function fractionFromEvent(e) {
      const rect = block.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    block.addEventListener('pointerdown', (e) => {
      if (vrCurrentSectionOriginalIndex !== i) return;
      vrIsDraggingSeek = true;
      try { block.setPointerCapture(e.pointerId); } catch (err) {}
      if (vrBlockFillEls[i]) vrBlockFillEls[i].style.width = (fractionFromEvent(e) * 100) + '%';
    });
    block.addEventListener('pointermove', (e) => {
      if (!vrIsDraggingSeek || vrCurrentSectionOriginalIndex !== i) return;
      if (vrBlockFillEls[i]) vrBlockFillEls[i].style.width = (fractionFromEvent(e) * 100) + '%';
    });
    block.addEventListener('pointerup', (e) => {
      if (!vrIsDraggingSeek || vrCurrentSectionOriginalIndex !== i) { vrIsDraggingSeek = false; return; }
      vrIsDraggingSeek = false;
      seekVerticalRandom(fractionFromEvent(e));
    });
    block.addEventListener('pointercancel', () => { vrIsDraggingSeek = false; });
  });

  notchDots.forEach(dot => {
    dot.addEventListener('click', () => {
      level = parseInt(dot.dataset.level, 10);
      notchDots.forEach(d => d.classList.toggle('active', d === dot));
      trackPublicEvent('intensity_change', { trackId: track.id, level });
      if (!playing) return;
      const p = profiles[level];
      const now = ctx.currentTime;
      const gainsToRamp = useQuantizedLoop ? currentGainNodes : gains;
      gainsToRamp.forEach((g, i) => {
        if (!g) return;
        const layerGain = effGain(layersToLoad[i]);
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime((p[i] || 0) * layerGain * voiceGain('layer-' + i), now + INTENSITY_RAMP_SEC);
      });
    });
  });

  stingerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const sfx = SFX_LIBRARY_BY_ID[btn.dataset.sfxId];
      const bufs = sfx && sfxBuffersById[sfx.id];
      if (!sfx || !bufs || !bufs.length) return;
      // Tirage round robin : aléatoire sans rejouer deux fois de suite la même variation, ou avance
      // séquentielle bouclée — selon le réglage propre à ce Sfx (même logique que le bloc de contenu Sfx).
      const n = bufs.length;
      let idx;
      if (n <= 1) idx = 0;
      else if (sfx.rrMode === 'sequential') {
        idx = ((sfxLastIndexById[sfx.id] != null ? sfxLastIndexById[sfx.id] : -1) + 1) % n;
      } else {
        do { idx = Math.floor(Math.random() * n); } while (idx === sfxLastIndexById[sfx.id]);
      }
      sfxLastIndexById[sfx.id] = idx;
      const buf = bufs[idx];
      if (!buf) return;
      resumeAudioContext();
      // Départ à un instant PRÉCIS, 20 ms après l'appui (25/09), plutôt que « dès que possible » (start(0)) : le navigateur
      // ne dit pas quand tombe ce « dès que possible » (2 à 20 ms plus tard selon sa charge), si bien qu'aucun
      // enregistrement (outil vidéo, Figer) ne pouvait caler le Sfx exactement sur la musique. Inaudible à l'appui.
      const startAt = ctx.currentTime + SFX_START_LEAD_SEC;
      if (sfx.duckMainTrack) duckMainTrack(buf.duration, startAt);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      // Curseurs liés à la position / reverb de ce Sfx : le son démarre à la position actuelle du curseur, puis suit ses
      // déplacements tant qu'il joue (voir applyFxSliderToSfx).
      const spatialVoice = connectSfxSource(src, sfx, fxSfxOverrideFor(sfx.id), startAt);
      if (spatialVoice && spatialVoice.fixed) {
        let vs = activeSfxVoices.get(sfx.id);
        if (!vs) { vs = new Set(); activeSfxVoices.set(sfx.id, vs); }
        vs.add(spatialVoice);
        src.addEventListener('ended', () => vs.delete(spatialVoice));
      }
      journalSfxVoice(src, spatialVoice);
      src.start(startAt);
      activeStingerSources.push(src);
      src.onended = () => { activeStingerSources = activeStingerSources.filter(s => s !== src); };
      // spatialStep : point de trajectoire réellement joué (mode "pas à pas") -- l'outil vidéo le rejoue à l'identique.
      // Capture : réglage de salle réellement utilisé (le visiteur a pu déplacer le son sur la matrice publique), et durée
      // du fichier (le « duck » de la musique en dépend).
      trackPublicEvent('stinger_play', Object.assign({ trackId: track.id, sfxId: sfx.id, variationIndex: idx },
        spatialVoice && spatialVoice.stepIndex != null ? { spatialStep: spatialVoice.stepIndex } : {}),
        Object.assign({ fileDuration: buf.duration, at: startAt }, spatialVoice && spatialVoice.__spUsed ? { spatial: spatialVoice.__spUsed } : {}));
    });
  });

  if (loopCountSelect) {
    loopCountSelect.addEventListener('change', () => {
      // Mutation directe de l'objet track lu par schedulerTick à chaque cycle — s'applique donc au vol,
      // y compris en cours de lecture, sans avoir à relancer la piste.
      track.maxLoops = loopCountSelect.value === '' ? null : parseInt(loopCountSelect.value, 10);
      trackPublicEvent('track_loop_change', { trackId: track.id, maxLoops: track.maxLoops });
    });
  }

  if (chainLoopCountSelect) {
    chainLoopCountSelect.addEventListener('change', () => {
      // Mutation directe de track.maxChainLoops : lu au vol par pickNextSegmentSlot (séquentiel) à chaque
      // avancement, et par le getter passé à createSectionPlaybackScheduler (vertical-random) à chaque
      // cycle — dans les deux cas, pas besoin de relancer la piste pour que le changement s'applique.
      track.maxChainLoops = chainLoopCountSelect.value === '' ? null : parseInt(chainLoopCountSelect.value, 10);
      trackPublicEvent('track_chain_loop_change', { trackId: track.id, maxChainLoops: track.maxChainLoops });
    });
  }

  // Boucles par section (vertical-random uniquement) : chaque petit sélecteur mute en place l'objet
  // réellement lu par sectionScheduler.decideNext() (voir vrPlayableSectionRefs) — pas d'effet si la
  // section touchée n'est pas (encore) jouable, la mutation est alors simplement un no-op silencieux.
  vrSectionLoopSelectEls.forEach((sel, origIdx) => {
    if (!sel) return;
    sel.addEventListener('change', () => {
      const value = sel.value === '' ? null : parseInt(sel.value, 10);
      const j = playableSectionOriginalIndex.indexOf(origIdx);
      if (j >= 0 && vrPlayableSectionRefs[j]) vrPlayableSectionRefs[j].maxLoops = value;
      trackPublicEvent('track_section_loop_change', { trackId: track.id, sectionIndex: origIdx, maxLoops: value });
    });
  });

  // Compteurs utilisés pour distinguer un vrai échec de chargement d'une simple propagation encore en
  // cours côté GitHub Pages (fichiers fraîchement publiés, pas encore servis par le CDN — jusqu'à 10
  // minutes, voir docs/infrastructure.md) : si TOUTES les requêtes réseau tentées pour cette piste ont
  // échoué en 404/non-ok, plutôt qu'un mélange d'échecs ordinaires, c'est le signe le plus probable d'une
  // publication toute récente. Ne compte que les vrais fichiers distants (item.localFile/localUrl
  // ignorés, aperçu local du backstage jamais concerné par ce problème).
  let remoteFetchAttempts = 0;
  // Fichiers locaux (aperçu du Backstage) impossibles à lire ou à décoder -- voir loadArrayBuffer().
  const unreadableLocalFiles = new Set();
  const _localFileNames = new WeakMap(); // octets lus -> nom du fichier local, le temps du décodage
  let remoteFetchNotFound = 0;
  async function loadArrayBuffer(item) {
    if (item.localFile) {
      // Fichier choisi dans le Backstage mais pas encore publié : le navigateur ne garde qu'un lien vers le fichier
      // sur le disque. Modifié/réexporté/déplacé depuis sa sélection, il devient illisible (vécu le 25/09 sous
      // Firefox : "Erreur de chargement (aucune section)" alors que la section avait bien un fichier). Nom retenu
      // pour que le message d'erreur dise lequel choisir à nouveau, au lieu d'un "aucune section" trompeur.
      let ab;
      try { ab = await item.localFile.arrayBuffer(); }
      catch (e) { unreadableLocalFiles.add(item.localFile.name); throw e; }
      _localFileNames.set(ab, item.localFile.name);
      return ab;
    }
    // localUrl (18/09) : variante de localFile pour l'Aperçu public (?preview=1, nouvel onglet) -- un
    // fichier pas encore publié y arrive en URL locale temporaire (blob:, voir pendingPreviewUrl() côté
    // backstage) plutôt qu'en objet File directement utilisable, un objet File ne survivant pas au
    // passage par localStorage (JSON) entre le backstage et cet onglet. fetch() sait lire une URL blob:
    // aussi bien qu'une URL distante, d'où ce simple embranchement plutôt qu'un chemin de code séparé.
    if (item.localUrl) return await (await fetch(item.localUrl)).arrayBuffer();
    remoteFetchAttempts++;
    const v = track.publishedAt ? ('?v=' + encodeURIComponent(track.publishedAt)) : '';
    const url = track.base + encodeURIComponent(item.file) + v;
    const res = await fetch(url);
    if (!res.ok) remoteFetchNotFound++;
    const ab = await res.arrayBuffer();
    _arrayBufferUrls.set(ab, url); // journal de prise : le rendu hors-ligne retéléchargera ce fichier
    return ab;
  }
  // Vrai uniquement si CHAQUE requête réseau tentée a échoué — un seul fichier chargé avec succès suffit à
  // écarter l'hypothèse "propagation encore en cours" (ce serait alors un vrai fichier manquant/corrompu).
  function looksLikePropagationDelay() {
    return remoteFetchAttempts > 0 && remoteFetchNotFound === remoteFetchAttempts;
  }
  function loadErrorMessageFor(fallbackKey) {
    if (unreadableLocalFiles.size) return t('loadErrorLocalFileUnreadable', { files: [...unreadableLocalFiles].map(n => '« ' + n + ' »').join(', ') });
    return t(looksLikePropagationDelay() ? 'loadErrorPropagating' : fallbackKey);
  }
  // Relais de décodage : Safari (Mac et iOS, donc tout navigateur sur iPhone/iPad puisqu'Apple impose
  // WebKit) ne sait pas décoder l'Ogg Vorbis nativement via decodeAudioData — échec silencieux, capté
  // plus bas par le try/catch ("Erreur de chargement"). On tente d'abord le décodage natif (rapide, ne
  // change rien pour les navigateurs qui le supportent déjà), et seulement s'il échoue, on bascule sur
  // un décodeur Ogg Vorbis en JavaScript/WebAssembly, indépendant du support natif.
  // Volontairement une instance PAR PISTE (pas partagée au niveau du module) : plusieurs pistes chargent
  // leurs fichiers en parallèle au chargement de la page, et un décodeur partagé verrait ses appels
  // .reset()/.decode() de pistes différentes s'entremêler — corruption silencieuse plutôt qu'erreur.
  let vorbisDecoderPromise = null;
  function getVorbisDecoder() {
    if (!vorbisDecoderPromise) {
      vorbisDecoderPromise = (async () => {
        if (!window['ogg-vorbis-decoder']) throw new Error('Décodeur Ogg Vorbis de secours introuvable (bibliothèque non chargée)');
        const decoder = new window['ogg-vorbis-decoder'].OggVorbisDecoder();
        await decoder.ready;
        return decoder;
      })();
    }
    return vorbisDecoderPromise;
  }
  async function decodeAudioDataCompat(arrayBuffer) {
    let buf;
    try { buf = await decodeAudioDataCompatRaw(arrayBuffer); }
    catch (e) { const localName = _localFileNames.get(arrayBuffer); if (localName) unreadableLocalFiles.add(localName); throw e; }
    const url = _arrayBufferUrls.get(arrayBuffer);
    if (url && buf) _bufferUrls.set(buf, url);
    return buf;
  }
  async function decodeAudioDataCompatRaw(arrayBuffer) {
    try {
      return await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch (nativeError) {
      const decoder = await getVorbisDecoder();
      await decoder.reset();
      const { channelData, samplesDecoded, sampleRate } = await decoder.decode(new Uint8Array(arrayBuffer));
      if (!samplesDecoded || !channelData || !channelData.length) throw nativeError;
      const audioBuffer = ctx.createBuffer(channelData.length, samplesDecoded, sampleRate);
      for (let ch = 0; ch < channelData.length; ch++) audioBuffer.copyToChannel(channelData[ch], ch);
      return audioBuffer;
    }
  }

  (async () => {
    let loaded = 0;
    let total;
    if (isVerticalRandom) {
      const rawSections = track.sections || [];
      const hasIntro = layerHasSource(track.intro);
      const hasOutro = layerHasSource(track.outro);
      // Total de fichiers à charger : intro/outro + toutes les alternatives ayant un fichier, dans les
      // sections NON dupliquées (une section qui duplique une autre ne charge rien en propre, voir 2e passe).
      const poolAltsWithSource = rawSections.reduce((sum, sec) => {
        if (sec.referencesSectionId) return sum;
        return sum + (sec.pools || []).reduce((s2, p) => s2 + (p.alternatives || []).filter(layerHasSource).length, 0);
      }, 0);
      total = (hasIntro ? 1 : 0) + (hasOutro ? 1 : 0) + poolAltsWithSource + totalSfxFilesToLoad;
      if (hasIntro) {
        try {
          const ab = await loadArrayBuffer(track.intro);
          introBuffer = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* intro manquante : la lecture démarrera directement sur la première section */ }
      }
      if (hasOutro) {
        try {
          const ab = await loadArrayBuffer(track.outro);
          outroBuffer = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* outro manquante : "Aller vers la fin" laissera simplement filer la section en cours */ }
      }
      // Deux passes, même principe que les groupes/emplacements ailleurs : d'abord les sections avec leur
      // propre contenu, puis celles qui dupliquent (referencesSectionId) pointent vers le MÊME tableau —
      // aucun fichier n'est chargé ni décodé deux fois.
      for (let si = 0; si < rawSections.length; si++) {
        if (rawSections[si].referencesSectionId) continue; // traité en 2e passe
        const pools = rawSections[si].pools || [];
        sectionBuffers[si] = [];
        for (let pi = 0; pi < pools.length; pi++) {
          const alts = pools[pi].alternatives || [];
          // Même longueur que les alternatives déclarées, y compris les slots vides (intentionnels : ils
          // restent un choix possible du tirage, avec pour effet un cycle silencieux pour ce pool).
          sectionBuffers[si][pi] = new Array(alts.length).fill(null);
          lastPickedPoolIndex[canonicalPoolKey(si, pi)] = -1;
          for (let ai = 0; ai < alts.length; ai++) {
            if (!layerHasSource(alts[ai])) continue;
            try {
              const ab = await loadArrayBuffer(alts[ai]);
              sectionBuffers[si][pi][ai] = await decodeAudioDataCompat(ab);
              loaded++;
              if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
            } catch (e) { /* alternative manquante : ce tirage restera silencieux pour ce pool, ne bloque pas le reste */ }
          }
        }
      }
      for (let si = 0; si < rawSections.length; si++) {
        if (!rawSections[si].referencesSectionId) continue;
        const sourceIdx = rawSections.findIndex(s => s.id === rawSections[si].referencesSectionId);
        sectionBuffers[si] = sourceIdx >= 0 ? sectionBuffers[sourceIdx] : [];
      }
      // Sections effectivement jouables : celles qui ont, une fois les duplications résolues, au moins un
      // pool avec au moins un fichier chargé — ordre DÉCLARÉ conservé (même convention que
      // pickNextSegmentSlot pour le séquentiel, qui saute silencieusement les emplacements vides).
      playableSectionOriginalIndex = rawSections.map((s, i) => i).filter(i => (sectionBuffers[i] || []).some(bufs => bufs.some(b => b)));
      if (!playableSectionOriginalIndex.length) { if (statusEl) statusEl.textContent = loadErrorMessageFor('loadErrorNoSections'); setLoadErrorIcon(); return; }
    } else if (isSequential) {
      const hasIntro = layerHasSource(track.intro);
      const hasOutro = layerHasSource(track.outro);
      const rawSlots = track.segmentSlots || [];
      const slotAltsWithSource = rawSlots.reduce((sum, sl) => sum + (sl.alternatives || []).filter(layerHasSource).length, 0);
      const transitionsWithSource = rawSlots.reduce((sum, sl) => sum + (sl.nextOptions || []).filter(opt => layerHasSource(opt.transition)).length, 0);
      total = (hasIntro ? 1 : 0) + (hasOutro ? 1 : 0) + slotAltsWithSource + transitionsWithSource + totalSfxFilesToLoad;
      if (hasIntro) {
        try {
          const ab = await loadArrayBuffer(track.intro);
          introBuffer = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* intro manquante : la lecture démarrera directement sur un emplacement */ }
      }
      if (hasOutro) {
        try {
          const ab = await loadArrayBuffer(track.outro);
          outroBuffer = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* outro manquante : "Aller vers la fin" laissera simplement filer l'emplacement en cours */ }
      }
      for (let si = 0; si < rawSlots.length; si++) {
        if (rawSlots[si].referencesSlotId) continue; // traité en 2e passe
        const alts = rawSlots[si].alternatives || [];
        // Même longueur que les alternatives déclarées, y compris les slots vides (intentionnel, même
        // convention que les groupes du vertical-random) : ça reste un choix possible du tirage, avec pour
        // effet un cycle silencieux pour cet emplacement — pas un fichier à charger.
        slotBuffers[si] = new Array(alts.length).fill(null);
        lastPickedSlotAltIndex[canonicalSlotKey(si)] = -1;
        for (let ai = 0; ai < alts.length; ai++) {
          if (!layerHasSource(alts[ai])) continue;
          try {
            const ab = await loadArrayBuffer(alts[ai]);
            slotBuffers[si][ai] = await decodeAudioDataCompat(ab);
            loaded++;
            if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
          } catch (e) { /* alternative manquante : ce tirage restera silencieux pour cet emplacement, ne bloque pas le reste */ }
        }
      }
      for (let si = 0; si < rawSlots.length; si++) {
        if (!rawSlots[si].referencesSlotId) continue;
        const sourceIdx = rawSlots.findIndex(sl => sl.id === rawSlots[si].referencesSlotId);
        slotBuffers[si] = sourceIdx >= 0 ? slotBuffers[sourceIdx] : [];
      }
      // Fichiers de transition (optionnels, un par embranchement précis — paire source→cible, PAS par
      // emplacement) : même convention d'indexation que slotBuffers, mais un niveau plus loin puisque
      // c'est nextOptions[oi], pas alternatives[ai], qui porte le fichier. transitionBuffers[si][oi] reste
      // null si aucun fichier n'est déclaré pour cet embranchement précis — la bascule sera alors directe
      // (pas de fichier de transition à jouer) plutôt qu'une erreur de chargement.
      for (let si = 0; si < rawSlots.length; si++) {
        const opts = rawSlots[si].nextOptions || [];
        transitionBuffers[si] = new Array(opts.length).fill(null);
        for (let oi = 0; oi < opts.length; oi++) {
          if (!layerHasSource(opts[oi].transition)) continue;
          try {
            const ab = await loadArrayBuffer(opts[oi].transition);
            transitionBuffers[si][oi] = await decodeAudioDataCompat(ab);
            seqTransitionDefByBuffer.set(transitionBuffers[si][oi], opts[oi].transition); // ses effets propres (27/09)
            loaded++;
            if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
          } catch (e) { /* transition manquante : la bascule vers cette cible se fera directement, sans fichier intermédiaire */ }
        }
      }
      if (slotBuffers.every(bufs => bufs.every(b => !b))) { if (statusEl) statusEl.textContent = loadErrorMessageFor('loadErrorNoSegments'); setLoadErrorIcon(); return; }
      // Carte globale (02/09) : côté Backstage (seqMapFullReveal), affichée en entier dès le chargement --
      // outil de vérification de sa propre structure, pas besoin d'attendre une première lecture. Côté
      // public, rien à afficher tant que rien n'a joué (révélation progressive, voir updateSeqMap()).
      if (seqMapFullReveal) updateSeqMap(-1);
    } else if (isEmbrVert) {
      const rawLoops = track.loops || [];
      const loopsWithSource = rawLoops.filter(layerHasSource).length;
      const transitionsWithSource = rawLoops.filter(l => layerHasSource(l && l.transition)).length;
      total = loopsWithSource + transitionsWithSource + totalSfxFilesToLoad;
      embrLoopBuffers = new Array(rawLoops.length).fill(null);
      embrTransitionBuffers = new Array(rawLoops.length).fill(null);
      for (let li = 0; li < rawLoops.length; li++) {
        if (!layerHasSource(rawLoops[li])) continue;
        try {
          const ab = await loadArrayBuffer(rawLoops[li]);
          embrLoopBuffers[li] = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* boucle manquante : ce bouton restera désactivé, ne bloque pas les autres */ }
      }
      // Formes d'onde des boutons de boucle (02/09) : les canvases .embr-wave-bg/.embr-wave-fg existent dans
      // le HTML depuis le premier chantier, mais rien ne les dessinait jamais -- bug confirmé le 05/09 en
      // situation réelle (retour direct : "on devrait voir les deux formes d'ondes des deux boucles paires
      // ici"), chaque bouton "riche" restait entièrement vide (juste le fond CSS + le libellé, indiscernable
      // d'un bouton plat). embrLoopBtns porte déjà data-loop-idx, posé une seule fois par buildTrackRow --
      // aucun besoin de reconstruire l'association bouton/buffer ici.
      embrLoopBtns.forEach(btn => {
        if (!btn.classList.contains('embr-wave-btn')) return;
        const idx = parseInt(btn.dataset.loopIdx, 10);
        const buf = embrLoopBuffers[idx];
        const bg = btn.querySelector('.embr-wave-bg'), fg = btn.querySelector('.embr-wave-fg');
        if (buf && bg && fg) renderWaveformPair(bg, fg, buf, waveBgColor, waveFgColor);
      });
      // Fichiers de transition (24/08) -- optionnels, un par boucle. Une transition manquante/en échec ne
      // bloque jamais la boucle elle-même : la bascule se fait juste sans overlay, comme si aucune
      // transition n'avait été réglée (même tolérance que les transitions du séquentiel).
      for (let li = 0; li < rawLoops.length; li++) {
        const trans = rawLoops[li] && rawLoops[li].transition;
        if (!layerHasSource(trans)) continue;
        try {
          const ab = await loadArrayBuffer(trans);
          embrTransitionBuffers[li] = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* transition manquante : la bascule vers cette boucle se fera sans overlay */ }
      }
      if (embrLoopBuffers.every(b => !b)) { if (statusEl) statusEl.textContent = loadErrorMessageFor('loadErrorNoSegments'); setLoadErrorIcon(); return; }
    } else {
      total = layersToLoad.length + totalSfxFilesToLoad;
      for (let i = 0; i < layersToLoad.length; i++) {
        try {
          const ab = await loadArrayBuffer(layersToLoad[i]);
          buffers[i] = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { if (statusEl) statusEl.textContent = loadErrorMessageFor('loadErrorStatus'); setLoadErrorIcon(); return; }
      }
      if (isStatic && buffers[0] && waveformBg) {
        try {
          waveformBuffer = buffers[0];
          redrawWaveforms();
        } catch (e) { /* la waveform est un bonus visuel : un échec ici ne doit jamais bloquer la lecture */ }
      }
    }
    for (const sfx of attachedSfx) {
      const alts = (sfx.alternatives || []).filter(a => a.file || a.localFile || a.localUrl);
      sfxBuffersById[sfx.id] = new Array(alts.length).fill(null);
      for (let ai = 0; ai < alts.length; ai++) {
        try {
          // Base propre au Sfx (audio/sfx-{id}/), jamais celle du morceau — un Sfx est une entrée de
          // bibliothèque partagée, potentiellement attachée à plusieurs morceaux à la fois.
          const alt = alts[ai];
          let ab;
          if (alt.localFile) ab = await alt.localFile.arrayBuffer();
          else if (alt.localUrl) ab = await (await fetch(alt.localUrl)).arrayBuffer(); // voir loadArrayBuffer() plus haut
          else {
            const v = sfx.publishedAt ? ('?v=' + encodeURIComponent(sfx.publishedAt)) : '';
            const sfxUrl = sfx.base + encodeURIComponent(alt.file) + v;
            const res = await fetch(sfxUrl);
            ab = await res.arrayBuffer();
            _arrayBufferUrls.set(ab, sfxUrl);
          }
          sfxBuffersById[sfx.id][ai] = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* une variation manquante ne bloque pas la lecture principale */ }
      }
    }
    // Reverb de salle des Sfx spatialisés préparée dès le chargement (25/09) : la calculer au premier appui bloquait la page
    // quelques dizaines de ms (accroc audible sur les effets à ScriptProcessor, départ du Sfx en retard).
    // Même chose pour le rendu 3D au casque : le navigateur ne charge ses données de spatialisation (HRTF) qu'à la création
    // du premier panoramique binaural, et joue ce premier son en mode dégradé en attendant.
    attachedSfx.forEach(sfx => { if (sfx.spatial && sfx.spatial.enabled) { try { getRoomBus(ctx, normalizeSpatial(sfx.spatial).room); } catch (e) {} } });
    if (attachedSfx.some(sfx => sfx.spatial && sfx.spatial.enabled)) { try { if (!_hrtfWarmPanner) { _hrtfWarmPanner = ctx.createPanner(); _hrtfWarmPanner.panningModel = 'HRTF'; } } catch (e) {} }
    // Pour une source locale non encore publiée, la durée réelle n'est connue qu'une fois décodée.
    const allMainBuffers = isVerticalRandom
      ? [introBuffer, outroBuffer, ...sectionBuffers.flat(2)].filter(Boolean)
      : isSequential
      ? [introBuffer, outroBuffer, ...slotBuffers.flat()].filter(Boolean)
      : isEmbrVert
      ? embrLoopBuffers.filter(Boolean)
      : buffers.filter(Boolean);
    const allSfxBuffers = Object.values(sfxBuffersById).flat().filter(Boolean);
    const decodedMax = Math.max(0, ...allMainBuffers.map(b => b.duration), ...allSfxBuffers.map(b => b.duration));
    if (decodedMax > (track.duration || 0)) {
      track.duration = decodedMax;
      if (timeTotal) timeTotal.textContent = formatTime(progressMaxSec());
    }
    if (statusEl) statusEl.textContent = t('readyStatus');
    playBtn.disabled = false;
    playBtn.setAttribute('aria-label', t('playAriaLabel'));
    playIcon.classList.remove('loading-icon');
    playIcon.innerHTML = PLAY_SVG;
    ready = true;
    updateStingerAvailability();
  })();
}

