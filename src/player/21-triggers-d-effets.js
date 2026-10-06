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
  // Même table que l'export vidéo (fxTargetKeyFromTarget) : une seule source pour savoir quelle chaîne un trigger vise.
  function fxTargetKeyOf(target) { return fxTargetKeyFromTarget(target); }
  expandTriggerSteps(track.fxTriggers).forEach(d => {
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
  const fxChipEls = [...wrapper.querySelectorAll('[data-fx-chip-of]')];
  function updateFxTriggerButtons() {
    fxChipEls.forEach(c => c.classList.toggle('on', fxRules.isActive(c.dataset.fxChipOf)));
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
