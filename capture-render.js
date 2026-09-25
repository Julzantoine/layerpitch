// capture-render.js — LayerPitch, rendu audio hors-ligne de l'outil vidéo « Test in game » (23/09/2026).
//
// Pourquoi ce fichier : l'export vidéo historique (pack.html, exportCaptureVideo) mixe la musique avec des
// FILTRES ffmpeg (atrim/adelay/amix). Ça ne sait rien des effets par voix, du pitch, des triggers d'effets, de
// la spatialisation des Sfx ni de la tête de l'auditeur -- tout ce qui vit dans le moteur Web Audio du lecteur.
// Plutôt que de réécrire chacun de ces effets une seconde fois en filtres ffmpeg (avec un son qui différerait de
// celui que le compositeur teste en jeu), on rejoue la prise dans un OfflineAudioContext avec LES MÊMES chaînes
// d'effets que le lecteur (LayerPlayerCore.buildLayerFxChain, buildSpatialVoice...), plus vite que le temps réel
// et sans rien émettre. ffmpeg ne sert plus alors qu'à assembler cet audio avec l'image.
//
// Deux entrées : render(plan) pour une capture de l'outil vidéo (plan construit par capture-plan.js, qui traduit la
// frise en voix exactes) et renderTake(take) pour une prise du lecteur (Figer, journal exact de ce qui a été joué).
// L'export vidéo passe TOUJOURS par ce moteur depuis le 25/09 (l'ancien mixage par filtres ffmpeg, approximatif, a été
// retiré) ; ffmpeg ne sert plus qu'à assembler ce son avec l'image.
// Aucune dépendance au DOM de pack.html : testable seul (avec player.js chargé, pour LayerPlayerCore).
(function () {
  const SR = 48000;
  const core = () => window.LayerPlayerCore;

  // fx_segment (un bouton d'effet maintenu entre t et t+durée) -> changements d'état on/off, en fusionnant les
  // segments qui se chevauchent pour un même trigger.
  function fxSegmentsToChanges(events) {
    const byKey = {};
    events.forEach(e => {
      if (e.name !== 'fx_segment') return;
      const k = e.detail.trackId + '|' + e.detail.triggerId;
      (byKey[k] = byKey[k] || { trackId: e.detail.trackId, triggerId: e.detail.triggerId, list: [] }).list.push([e.t, e.t + e.detail.duration]);
    });
    const out = [];
    // fx_cut : le visiteur a coupé lui-même un trigger qui n'était actif que par cascade (aucun segment à fermer).
    events.forEach(e => { if (e.name === 'fx_cut') out.push({ t: e.t, trackId: e.detail.trackId, triggerId: e.detail.triggerId, active: false }); });
    Object.keys(byKey).forEach(k => {
      const g = byKey[k];
      const list = g.list.sort((a, b) => a[0] - b[0]);
      const merged = [];
      list.forEach(iv => {
        const last = merged[merged.length - 1];
        // Strictement chevauchants seulement : deux segments qui se touchent (le trigger s'est coupé de lui-même puis
        // le visiteur l'a rallumé) restent DEUX demandes, sinon le rallumage serait perdu.
        if (last && iv[0] < last[1]) last[1] = Math.max(last[1], iv[1]); else merged.push(iv.slice());
      });
      merged.forEach(iv => {
        out.push({ t: iv[0], trackId: g.trackId, triggerId: g.triggerId, active: true });
        out.push({ t: iv[1], trackId: g.trackId, triggerId: g.triggerId, active: false });
      });
    });
    return out;
  }
  // Activations déduites des embranchements (fxActions d'une boucle d'embranchement-vertical ou d'une option de
  // bascule séquentielle) : pas capturées comme geste, elles découlent des bascules -- donc elles suivent
  // automatiquement une bascule que l'on déplace sur la frise.
  function deriveBranchChanges(track, kind, windows) {
    const out = [];
    const push = (t, actions) => (actions || []).forEach(a => { if (a && a.triggerId) out.push({ t, trackId: track.id, triggerId: a.triggerId, active: a.active !== false }); });
    if (kind === 'embr') {
      windows.forEach(w => { const loop = (track.loops || []).find(l => l.id === w.loopId); if (loop) push(w.start, loop.fxActions); });
    } else if (kind === 'seq') {
      let prevSlotIdx = -1;
      windows.forEach((w, i) => {
        if (w.kind !== 'slot') return;
        if (prevSlotIdx >= 0) {
          const from = windows[prevSlotIdx];
          const src = (track.segmentSlots || []).find(s => s.id === from.slotId);
          const opt = src && (src.nextOptions || []).find(o => o.targetId === w.slotId);
          // L'option s'exécute à la coupure : début de la fenêtre qui suit le segment source (transition ou cible).
          if (opt) push(windows[prevSlotIdx + 1].start, opt.fxActions);
        }
        prevSlotIdx = i;
      });
    }
    return out;
  }

  // Seuils des curseurs -> demandes de triggers « du compositeur » : pour chaque curseur, l'état voulu de chaque trigger
  // relié (en dessous / au-dessus d'un seuil) à sa position de départ puis après chaque point-clé enregistré ; une
  // demande n'est émise que lorsque l'état voulu CHANGE (comme le lecteur : un choix manuel n'est pas écrasé).
  function deriveSliderTriggerChanges(track, sliderKeys) {
    const C = core();
    const out = [];
    C.fxSlidersValid(track).forEach(sl => {
      if (!sl.thresholds.length) return;
      const last = new Map();
      const evalAt = (t, v) => C.fxSliderThresholdWants(sl, v).forEach(w => {
        if (last.get(w.triggerId) === w.want) return;
        last.set(w.triggerId, w.want);
        out.push({ t, trackId: track.id, triggerId: w.triggerId, active: w.want });
      });
      evalAt(0, sl.def);
      (sliderKeys || []).filter(k => k.trackId === track.id && k.sliderId === sl.id).sort((a, b) => a.t - b.t).forEach(k => evalAt(Math.max(0, k.t), k.value));
    });
    return out;
  }

  // Demandes du visiteur (boutons enregistrés) et des embranchements (déduites) -> changements d'état RÉELS après
  // application des règles entre triggers (cascades temporisées, exclusions, conditions, coupures automatiques), avec
  // les mêmes règles que le lecteur (LayerPlayerCore.simulateTriggerRules). À instant égal, l'embranchement passe
  // avant le visiteur (il peut remplir une condition « Nécessite »). Un morceau sans trigger valide : tel quel.
  function resolveTriggerChanges(visitorChanges, derivedChanges, findTrack) {
    const C = core();
    const byTrack = {};
    (visitorChanges || []).forEach(c => (byTrack[c.trackId] = byTrack[c.trackId] || []).push({ t: c.t, id: c.triggerId, active: c.active, source: 'visitor' }));
    (derivedChanges || []).forEach(c => (byTrack[c.trackId] = byTrack[c.trackId] || []).push({ t: c.t, id: c.triggerId, active: c.active, source: 'composer' }));
    const out = [];
    Object.keys(byTrack).forEach(trackId => {
      const track = findTrack(trackId);
      const defs = track ? (track.fxTriggers || []).filter(d => d && d.id && d.fx && C.fxTargetKeyFromTarget(d.target)) : [];
      const reqs = byTrack[trackId].sort((a, b) => (a.t - b.t) || ((a.source === 'composer' ? 0 : 1) - (b.source === 'composer' ? 0 : 1)));
      if (!defs.length) { reqs.forEach(r => out.push({ t: r.t, trackId, triggerId: r.id, active: r.active })); return; }
      C.simulateTriggerRules(defs, reqs).forEach(c => out.push({ t: c.t, trackId, triggerId: c.id, active: c.active }));
    });
    return out;
  }

  // Rendu d'une capture de l'outil vidéo. Entrée : le plan de LayerCapturePlan.buildPlan --
  //   { total, voices:[{url, track, targetKey, baseFx, start, offset, loop, stop, continuous, gain:{init, auto}}],
  //     sfxHits:[{t, url, sfx, track, durationOverride, stepIndex, spatial}], duckHits:[{t, fileDuration, url}],
  //     triggerChanges:[{t, trackId, triggerId, active}], headEvents:[{t, yaw}], sliderKeys:[{t, trackId, sliderId, value}] }
  // Chaque voix est un fichier placé exactement comme le lecteur l'a joué (ou le jouerait, pour un bloc retouché) ;
  // les effets de sa cible suivent les triggers et les curseurs de la capture, mêmes règles que le lecteur.
  async function render(plan, opts) {
    opts = opts || {};
    const progress = opts.onProgress || function () {};
    const C = core();
    if (!C) throw new Error('LayerPlayerCore introuvable : player.js doit être chargé.');
    const rate = C.liveSampleRate ? C.liveSampleRate() : SR; // même fréquence qu'à l'écoute : mêmes fichiers décodés, mêmes reverbs
    const liveLatency = C.liveFxLatencySec ? C.liveFxLatencySec() : null;
    const total = Math.max(0.5, plan.total);
    const oc = new OfflineAudioContext(2, Math.ceil(total * rate), rate);
    const bufCache = new Map();
    const getBuf = url => {
      if (!bufCache.has(url)) bufCache.set(url, (async () => {
        const bytes = await opts.fetchBytes(url);
        return await oc.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      })());
      return bufCache.get(url);
    };

    // Tête de l'auditeur : l'orientation évolue au fil des gestes enregistrés.
    (plan.headEvents || []).slice().sort((a, b) => a.t - b.t).forEach(h => C.applyListenerYaw(oc, h.yaw, Math.max(0, h.t)));

    // Bus musique (gain maître du morceau) : « duck » sous les Sfx qui le demandent, exactement comme duckMainTrack --
    // chaque nouveau duck annule la remontée programmée du précédent.
    const musicBus = oc.createGain();
    musicBus.connect(oc.destination);
    const RP = C.CAPTURE_RAMPS;
    let duckCmds = [];
    for (const d of (plan.duckHits || []).slice().sort((a, b) => a.t - b.t)) {
      const dur = d.fileDuration != null ? d.fileDuration : (await getBuf(d.url)).duration;
      duckCmds = duckCmds.filter(c => c.t <= d.t);
      const restoreAt = d.t + Math.max(RP.duckAttack, dur / 2);
      duckCmds.push({ t: d.t, target: RP.duckLevel, ramp: RP.duckAttack }, { t: restoreAt, target: RP.duckLevel, ramp: 0 }, { t: restoreAt, target: 1, ramp: RP.duckRelease });
    }
    replayParam(musicBus.gain, window.LayerCapturePlan.automation(1, duckCmds, 0));

    // Triggers (états après les règles), par morceau ; curseurs : valeur en vigueur à l'instant t.
    const changesByTrack = {};
    (plan.triggerChanges || []).slice().sort((a, b) => a.t - b.t).forEach(c => (changesByTrack[c.trackId] = changesByTrack[c.trackId] || []).push(c));
    function applyChange(list, c) {
      const i = list.indexOf(c.triggerId);
      if (c.active && i < 0) list.push(c.triggerId); else if (!c.active && i >= 0) list.splice(i, 1);
    }
    function activeAt(trackId, t) {
      const list = [];
      (changesByTrack[trackId] || []).forEach(c => { if (c.t <= t) applyChange(list, c); });
      return list;
    }
    const keysBySlider = {};
    (plan.sliderKeys || []).slice().sort((a, b) => a.t - b.t).forEach(k => (keysBySlider[k.trackId + '|' + k.sliderId] = keysBySlider[k.trackId + '|' + k.sliderId] || []).push(k));
    const slidersByTrack = new Map();
    const slidersOf = track => { if (!slidersByTrack.has(track.id)) slidersByTrack.set(track.id, C.fxSlidersValid(track)); return slidersByTrack.get(track.id); };
    const sliderValueAt = (trackId, sl, t) => { let v = sl.def; (keysBySlider[trackId + '|' + sl.id] || []).forEach(k => { if (k.t <= t) v = k.value; }); return v; };
    // Vitesse du morceau à l'instant t (base, triggers « Vitesse » actifs, curseur « pitch.speed ») -- mêmes règles que le lecteur.
    const isSpeedBinding = b => { const m = C.FX_SLIDER_PARAMS[b.param]; return !!(m && m.rate); };
    const hasDynamicRate = track => (track.fxTriggers || []).some(d => d && d.fx && d.fx.pitch && d.fx.pitch.mode === 'rate' && C.fxTargetKeyFromTarget(d.target) === 'track') || slidersOf(track).some(sl => sl.bindings.some(isSpeedBinding));
    function trackRateAt(track, t) {
      const defs = (track.fxTriggers || []).filter(d => d && d.id && d.fx && C.fxTargetKeyFromTarget(d.target) === 'track');
      const sliders = slidersOf(track);
      const active = activeAt(track.id, t).map(id => defs.find(d => d.id === id)).filter(Boolean);
      return C.fxTrackRatio(track, active, sliders, id => { const sl = sliders.find(x => x.id === id); return sl ? sliderValueAt(track.id, sl, t) : 0; });
    }

    // -- Musique --
    const voices = (plan.voices || []).filter(v => v.url && v.start < total);
    let n = 0;
    for (const v of voices) {
      const buf = await getBuf(v.url);
      progress(++n, voices.length);
      const track = v.track;
      // Vitesse : celle en vigueur quand le lecteur a créé la source (juste avant son démarrage pour un moteur programmé) ;
      // une voix continue (moteur simple) suit les changements pendant qu'elle joue.
      const dynRate = !!(track && hasDynamicRate(track));
      const r0 = track ? (dynRate ? trackRateAt(track, v.continuous ? v.start : Math.max(0, v.start - 0.9)) : C.fxTrackRatio(track, [], null)) : 1;
      const src = oc.createBufferSource();
      src.buffer = buf;
      if (v.loop) { src.loop = true; src.loopStart = v.loop[0]; src.loopEnd = v.loop[1]; }
      src.playbackRate.value = r0;
      if (dynRate && v.continuous) {
        const times = new Set();
        (changesByTrack[track.id] || []).forEach(c => { if (c.t > v.start) times.add(c.t); });
        slidersOf(track).forEach(sl => (keysBySlider[track.id + '|' + sl.id] || []).forEach(k => { if (k.t > v.start) times.add(k.t); }));
        [...times].sort((a, b) => a - b).forEach(t => src.playbackRate.setTargetAtTime(trackRateAt(track, t), t, 0.05));
      }
      // Chaîne d'effets de la voix : fx de base de sa cible + triggers actifs à son démarrage, puis changements
      // programmés pendant qu'elle joue (triggers et curseurs), mêmes règles de fusion que le lecteur.
      let chain = null;
      if (track && v.targetKey) {
        const defs = (track.fxTriggers || []).filter(d => { if (!d || !d.id || !d.fx) return false; const k = C.fxTargetKeyFromTarget(d.target); return k === v.targetKey || k === 'track'; });
        const sliders = slidersOf(track);
        const base = v.baseFx != null ? v.baseFx : C.baseFxForTarget(track, v.targetKey);
        const force = [...new Set(defs.flatMap(d => Object.keys(d.fx).filter(k => !(k === 'pitch' && d.fx.pitch && d.fx.pitch.mode === 'rate'))).concat(C.fxSliderForceKeys(sliders, v.targetKey)))];
        const defOf = id => defs.find(d => d.id === id);
        const active = activeAt(track.id, v.start);
        const sliderVals = new Map(sliders.map(sl => [sl.id, sliderValueAt(track.id, sl, v.start)]));
        const effective = () => C.applyFxSliderOverrides(C.mergeTriggerFx(base, active.map(defOf).filter(Boolean)), C.fxSliderOverrides(sliders, id => sliderVals.get(id), v.targetKey));
        chain = C.buildLayerFxChain(oc, effective(), src, v.start, undefined, force);
        if (chain && (defs.length || force.length)) {
          const end = v.stop != null ? v.stop : total;
          const timeline = [];
          (changesByTrack[track.id] || []).forEach(c => { if (c.t > v.start && c.t < end) timeline.push({ t: c.t, c }); });
          sliders.forEach(sl => (keysBySlider[track.id + '|' + sl.id] || []).forEach(k => { if (k.t > v.start && k.t < end) timeline.push({ t: k.t, k, sl }); }));
          timeline.sort((a, b) => a.t - b.t).forEach(ev => {
            let ramp = 0.1;
            if (ev.c) {
              const d = defOf(ev.c.triggerId); applyChange(active, ev.c); if (!d && !force.length) return;
              const fin = d && d.fadeSec != null ? d.fadeSec : 0.1;
              ramp = ev.c.active ? fin : (d && d.fadeOutSec != null ? d.fadeOutSec : fin);
            } else { sliderVals.set(ev.sl.id, ev.k.value); ramp = ev.sl.smoothSec; }
            C.applyFxToChain(oc, chain, effective(), ramp, ev.t);
          });
        }
      }
      // Compensation de latence comme le lecteur (morceau à bitcrusher / pitch-shift), puis le retard propre au direct
      // (blocs de 1024 à l'écoute contre 256 hors ligne) pour que les Sfx restent calés comme à l'écoute.
      if (track && C.trackNeedsLatencyComp(track)) chain = C.withLatencyComp(oc, chain);
      let node = src;
      if (chain) { src.connect(chain.input); node = chain.output; }
      if (liveLatency && chain && chain.nodes && (chain.nodes.bitcrush || chain.nodes.pitchShift || chain.nodes.latencyComp)) {
        const extra = liveLatency - C.fxSpLatencySec(oc);
        if (extra > 0) { const d = oc.createDelay(1); d.delayTime.value = extra; node.connect(d); node = d; }
      }
      if (v.gain) { const g = oc.createGain(); replayParam(g.gain, v.gain); node.connect(g); node = g; }
      node.connect(musicBus);
      src.start(v.start, Math.max(0, v.offset || 0));
      src.stop(Math.min(v.stop != null ? v.stop : Infinity, total));
    }

    // -- Sfx (jamais duckés par leur propre passage) : à leur place dans la salle telle que jouée --
    const sfxBus = oc.createGain();
    sfxBus.connect(oc.destination);
    const hits = (plan.sfxHits || []).slice().sort((a, b) => a.t - b.t);
    for (const hit of hits) {
      const buf = await getBuf(hit.url);
      const src = oc.createBufferSource();
      src.buffer = buf;
      const sp = hit.spatial || (hit.sfx && hit.sfx.spatial);
      if (sp && sp.enabled) {
        // Curseurs liés à la position / reverb de ce Sfx : départ à la valeur du curseur à cet instant (déjà comprise dans
        // hit.spatial pour une capture récente), puis points-clés pendant sa durée (source à position fixe).
        const track = hit.track;
        const sliders = track ? slidersOf(track).filter(sl => sl.bindings.some(b => b.key === 'sfx:' + hit.sfx.id)) : [];
        const valueOfAt = t => id => { const sl = sliders.find(x => x.id === id); return sl ? sliderValueAt(track.id, sl, t) : 0; };
        const ov0 = !hit.spatial && sliders.length ? C.fxSliderSfxOverrides(sliders, valueOfAt(hit.t), hit.sfx.id) : null;
        const voice = C.buildSpatialVoice(oc, ov0 ? C.fxSpatialWithOverride(sp, ov0) : sp, { duration: buf.duration, stepKey: hit.sfx, stepIndex: hit.stepIndex, startTime: hit.t });
        src.connect(voice.input);
        if (voice.fixed && sliders.length) {
          const end = hit.t + (hit.durationOverride || buf.duration);
          const times = [];
          sliders.forEach(sl => (keysBySlider[track.id + '|' + sl.id] || []).forEach(k => { if (k.t > hit.t && k.t < end) times.push({ t: k.t, ramp: sl.smoothSec }); }));
          times.sort((a, b) => a.t - b.t).forEach(kt => {
            const sp2 = C.fxSpatialWithOverride(sp, C.fxSliderSfxOverrides(sliders, valueOfAt(kt.t), hit.sfx.id));
            voice.setPosition(sp2.x, sp2.y, kt.ramp, kt.t);
            voice.setReverbDb(sp2.reverbDb, kt.ramp, kt.t);
          });
        }
      } else src.connect(sfxBus);
      src.start(hit.t);
      if (hit.durationOverride) src.stop(hit.t + hit.durationOverride);
    }
    return await oc.startRendering();
  }

  // ---- Rendu d'une prise du lecteur (Adaptive OST, Figer -- 25/09) ----
  // Entrée : le journal renvoyé par LayerPlayerCore.getTrackTake -- chaque voix (fichier, instant, position de départ,
  // boucle, arrêt), les commandes de son volume et de sa vitesse, sa chaîne d'effets (réglage de départ + chaque
  // changement), les Sfx (réglage de la salle au départ + déplacements), le gain maître (duck) et la tête. On rejoue
  // tout à l'identique dans un OfflineAudioContext avec les briques du lecteur : ni tirage au sort, ni règle de
  // triggers à re-simuler, ni fenêtre à reconstituer -- la version rendue est ce qui a été entendu.
  // opts : fetchBytes(url) -> Uint8Array ; tail (secondes après la fin, pour les queues de reverb ; 2 par défaut) ;
  // fadeOutSec (si la prise est encore en cours : fondu de sortie à partir de sa fin, 1 s par défaut) ; onProgress(i, n).
  // Rejoue un journal de commandes (temps de la prise) sur un paramètre : shift = heure du contexte à laquelle correspond
  // le temps 0 de la prise ; une commande antérieure à `from` (lecture reprise en cours de prise) s'applique à `from`,
  // dans l'ordre, pour retrouver l'état du moment.
  function replayParam(param, log, clampFrom, shift) {
    if (!log) return;
    const lo = clampFrom || 0, sh = shift || 0;
    const at = t => Math.max(lo, t + sh);
    try { param.value = log.init; } catch (e) {}
    (log.auto || []).forEach(e => {
      const tag = e[0], t = at(e[1]);
      try {
        if (tag === 'set') param.setValueAtTime(e[2], t);
        else if (tag === 'lin') param.linearRampToValueAtTime(e[2], t);
        else if (tag === 'exp') param.exponentialRampToValueAtTime(e[2], t);
        else if (tag === 'tgt') param.setTargetAtTime(e[2], t, e[3]);
        else if (tag === 'cancel') param.cancelScheduledValues(t);
        else if (tag === 'hold') { if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t); else param.cancelScheduledValues(t); }
      } catch (err) { /* commande refusée (valeur hors bornes) : ignorée, comme le lecteur l'aurait vécu */ }
    });
  }

  // Construit, dans le contexte c, le graphe d'une prise : chaque voix (fichier, position, boucle, arrêt, volume, vitesse,
  // chaîne d'effets et ses changements), chaque Sfx à sa place dans la salle, le gain maître, la tête. Le temps τ de la
  // prise correspond à l'heure t0 + τ du contexte ; `from` = position de départ dans la prise (0 pour un rendu complet,
  // la position de reprise pour le lecteur d'album). Commun au rendu en fichier (OfflineAudioContext) et à la lecture en
  // direct : le son est le même. Renvoie les sources créées (pour pouvoir tout arrêter) et la sortie.
  async function buildTakeGraph(c, take, o) {
    const C = core();
    const t0 = o.t0, from = o.from || 0;
    const end = Math.max(0.1, take.duration);
    const stopAt = o.stopAt; // heure du contexte où tout s'arrête (rendu : fin + queue)
    const T = tau => t0 + tau;
    const now0 = T(from);
    const out = c.createGain();
    out.connect(c.destination);
    (take.yaw || []).forEach(([t, yaw]) => C.applyListenerYaw(c, yaw, Math.max(now0, T(t))));
    const master = c.createGain();
    master.connect(out);
    replayParam(master.gain, take.master, now0, t0);
    const inWindow = v => v.url && v.start != null && v.start < end && !(v.stop != null && (v.stop <= v.start || v.stop <= from));
    const voices = (take.voices || []).filter(inWindow);
    const sfx = (take.sfx || []).filter(inWindow);
    const n = voices.length + sfx.length;
    const sources = [];
    let i = 0;
    // Voix déjà commencée à `from` : on la démarre maintenant, à la position qu'elle aurait atteinte.
    function placement(v) {
      if (v.start >= from) return { when: T(v.start), offset: v.offset, dur: v.dur };
      const rate = (v.rate && v.rate.init) || 1;
      let off = v.offset + (from - v.start) * rate;
      if (v.loop && off > v.loop[1]) { const len = v.loop[1] - v.loop[0]; off = v.loop[0] + ((off - v.loop[0]) % len); }
      return { when: now0, offset: off, dur: v.dur != null ? Math.max(0, v.dur - (from - v.start)) : null };
    }
    function makeSource(v, buf) {
      const src = c.createBufferSource();
      src.buffer = buf;
      if (v.loop) { src.loop = true; src.loopStart = v.loop[0]; src.loopEnd = v.loop[1]; }
      replayParam(src.playbackRate, v.rate, now0, t0);
      return src;
    }
    function startSource(src, v, pl) {
      if (pl.offset >= src.buffer.duration && !v.loop) return false;
      if (pl.dur != null) src.start(pl.when, pl.offset, pl.dur); else src.start(pl.when, pl.offset);
      const stop = Math.min(v.stop != null ? T(v.stop) : Infinity, stopAt != null ? stopAt : Infinity);
      if (isFinite(stop)) src.stop(Math.max(pl.when, stop));
      sources.push(src);
      return true;
    }
    for (const v of voices) {
      const buf = await o.getBuf(v.url);
      if (o.onProgress) o.onProgress(++i, n);
      const pl = placement(v);
      const src = makeSource(v, buf);
      let chain = null;
      if (v.fx) {
        chain = v.fx.fx || (v.fx.force && v.fx.force.length) ? C.buildLayerFxChain(c, v.fx.fx, src, pl.when, undefined, v.fx.force || []) : null;
        // Changements d'effet : même fonction que le lecteur, en mode programmé (un changement noté avant le démarrage
        // de la voix prend effet à son démarrage).
        if (chain) (v.fxLog || []).forEach(([t, fx, ramp]) => C.applyFxToChain(c, chain, fx, ramp, Math.max(T(t), pl.when)));
        if (v.fx.comp) chain = C.withLatencyComp(c, chain);
      }
      let node = src;
      if (chain) { src.connect(chain.input); node = chain.output; }
      // Même retard qu'à l'écoute pour les voix qui passent par un effet à ScriptProcessor ou par la compensation : hors
      // ligne, les blocs sont plus petits, donc le retard natif plus court (en direct : aucune différence).
      if (chain && chain.nodes && (chain.nodes.bitcrush || chain.nodes.pitchShift || chain.nodes.latencyComp) && take.fxLatencySec) {
        const extra = take.fxLatencySec - C.fxSpLatencySec(c);
        if (extra > 0) { const d = c.createDelay(1); d.delayTime.value = extra; node.connect(d); node = d; }
      }
      if (v.gain) { const g = c.createGain(); replayParam(g.gain, v.gain, now0, t0); node.connect(g); node = g; }
      node.connect(master);
      startSource(src, v, pl);
    }
    for (const s of sfx) {
      const buf = await o.getBuf(s.url);
      if (o.onProgress) o.onProgress(++i, n);
      const pl = placement(s);
      const src = makeSource(s, buf);
      if (s.spatial) {
        const playRate = (s.rate && s.rate.init) || 1;
        const voice = C.buildSpatialVoice(c, s.spatial.sp, { duration: buf.duration / playRate, stepKey: {}, stepIndex: s.spatial.stepIndex, startTime: T(s.start) });
        src.connect(voice.input);
        (s.spatial.calls || []).forEach(cl => {
          const t = Math.max(T(cl[0]), pl.when);
          if (cl[1] === 'pos') voice.setPosition(cl[2], cl[3], cl[4], t);
          else if (cl[1] === 'rev') voice.setReverbDb(cl[2], cl[3], t);
          else if (cl[1] === 'bin') voice.setBinaural(cl[2]); // pas de version programmée : l'état final l'emporte
        });
      } else src.connect(out);
      startSource(src, s, pl);
    }
    return { sources, out, end };
  }

  // Rendu d'une prise en fichier (téléchargement d'une version figée). opts : fetchBytes(url) -> Uint8Array ; tail
  // (secondes après la fin, pour les queues de reverb ; 2 par défaut) ; fadeOutSec (prise encore en cours : fondu à partir
  // de sa fin, 1 s par défaut) ; onProgress(i, n).
  async function renderTake(take, opts) {
    opts = opts || {};
    if (!core()) throw new Error('LayerPlayerCore introuvable : player.js doit être chargé.');
    if (!take || take.kind !== 'layerpitch-take') throw new Error('Prise invalide.');
    const tail = opts.tail != null ? opts.tail : 2;
    const end = Math.max(0.1, take.duration);
    const total = end + tail;
    const rate = take.sampleRate || SR;
    const oc = new OfflineAudioContext(2, Math.ceil(total * rate), rate);
    const bufCache = new Map();
    const getBuf = url => {
      if (!bufCache.has(url)) bufCache.set(url, (async () => {
        const bytes = await opts.fetchBytes(url);
        return await oc.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      })());
      return bufCache.get(url);
    };
    await buildTakeGraph(oc, take, { t0: 0, from: 0, stopAt: total, getBuf, onProgress: opts.onProgress });
    const rendered = await oc.startRendering();
    // Une prise encore en cours (Figer pendant l'écoute) s'éteint en fondu à partir de sa fin ; une prise terminée
    // (arrêt, pause, fin naturelle) garde sa fin telle quelle, queues de reverb comprises. Appliqué au résultat : le
    // fondu touche tout, Sfx spatialisés et reverb de salle compris (ils sortent directement du contexte, comme en direct).
    if (!take.complete) {
      const f = opts.fadeOutSec != null ? opts.fadeOutSec : 1;
      const a = Math.floor(end * rate), b = Math.min(rendered.length, Math.floor((end + f) * rate));
      for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
        const d = rendered.getChannelData(ch);
        for (let k = a; k < d.length; k++) d[k] *= k < b ? 1 - (k - a) / Math.max(1, b - a) : 0;
      }
    }
    return rendered;
  }

  // Lecture EN DIRECT d'une version figée (lecteur d'album, 25/09) : même graphe que le rendu, dans le contexte audio de
  // la page, à partir de la position `from` -- démarrage quasi immédiat (aucun rendu préalable), pause / reprise / saut.
  // Fichiers décodés une fois pour toutes (cache partagé entre les versions : elles réutilisent les mêmes fichiers).
  // opts : from (secondes), fetchBytes(url), onEnd() (appelé à la fin de la version, queue comprise), fadeOutSec.
  // Renvoie un contrôleur { stop(), position(), duration }.
  const _liveBufCache = new Map();
  async function playTake(take, opts) {
    opts = opts || {};
    const C = core();
    if (!take || take.kind !== 'layerpitch-take') throw new Error('Prise invalide.');
    const c = C.audioContext();
    await C.resumeAudio();
    const getBuf = url => {
      if (!_liveBufCache.has(url)) _liveBufCache.set(url, (async () => {
        const bytes = await opts.fetchBytes(url);
        return await C.decodeAudioCompat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      })().catch(e => { _liveBufCache.delete(url); throw e; }));
      return _liveBufCache.get(url);
    };
    // Tous les fichiers d'abord (pour que chaque voix parte à l'heure), puis le graphe calé juste après.
    await Promise.all([...new Set((take.voices || []).concat(take.sfx || []).map(v => v.url).filter(Boolean))].map(getBuf));
    const from = Math.max(0, Math.min(opts.from || 0, take.duration));
    const lead = 0.05;
    const t0 = c.currentTime + lead - from;
    const tail = opts.tail != null ? opts.tail : 2;
    const g = await buildTakeGraph(c, take, { t0, from, stopAt: t0 + take.duration + tail, getBuf });
    // Version encore en cours au moment où elle a été figée : fondu à sa fin (musique et Sfx non spatialisés).
    if (!take.complete) {
      const f = opts.fadeOutSec != null ? opts.fadeOutSec : 1;
      g.out.gain.setValueAtTime(1, t0 + take.duration);
      g.out.gain.linearRampToValueAtTime(0, t0 + take.duration + f);
    }
    let stopped = false;
    const endTimer = setTimeout(() => { if (!stopped) { stopped = true; if (opts.onEnd) opts.onEnd(); } }, Math.max(0, (t0 + take.duration + (take.complete ? 0.3 : 1) - c.currentTime) * 1000));
    return {
      duration: take.duration,
      position: () => Math.max(0, Math.min(take.duration, c.currentTime - t0)),
      stop() {
        if (stopped) return;
        stopped = true;
        clearTimeout(endTimer);
        const now = c.currentTime;
        // Fondu court pour éviter un clic, puis arrêt de toutes les sources.
        try { g.out.gain.cancelScheduledValues(now); g.out.gain.setValueAtTime(g.out.gain.value, now); g.out.gain.linearRampToValueAtTime(0, now + 0.03); } catch (e) {}
        g.sources.forEach(src => { try { src.stop(now + 0.04); } catch (e) {} });
      }
    };
  }

  // AudioBuffer -> fichier WAV PCM 16 bits (donné tel quel à ffmpeg).
  function encodeWav(buffer) {
    const ch = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate;
    const bytes = new Uint8Array(44 + len * ch * 2);
    const dv = new DataView(bytes.buffer);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    w(36, 'data'); dv.setUint32(40, len * ch * 2, true);
    const data = []; for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7FFF, true); o += 2;
    }
    return bytes;
  }

  window.LayerCaptureRender = { render, renderTake, playTake, encodeWav, fxSegmentsToChanges, deriveBranchChanges, deriveSliderTriggerChanges, resolveTriggerChanges, SR };
})();
