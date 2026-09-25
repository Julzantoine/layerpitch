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
// Entrée : un "plan" neutre construit par pack.html (voir exportCaptureVideo) --
//   { total, segments:[{url, track, trackId, targetKey, start, dur, fileStart, phaseLocked, fade, rate}],
//     sfxHits:[{t, url, sfx, durationOverride, stepIndex}], duckWindows:[{start,end}],
//     triggerChanges:[{t, trackId, triggerId, active}], headEvents:[{t, yaw}] }
// Aucune dépendance au DOM de pack.html : testable seul (avec player.js chargé, pour LayerPlayerCore).
(function () {
  const SR = 48000;
  const core = () => window.LayerPlayerCore;

  function hasKeys(o) { return !!o && typeof o === 'object' && Object.keys(o).length > 0; }
  function trackHasFx(track) {
    if (!track) return false;
    if (hasKeys(track.fx) || (track.fxTriggers && track.fxTriggers.length) || (track.fxSliders && track.fxSliders.length)) return true;
    const any = arr => (arr || []).some(x => x && hasKeys(x.fx));
    if (any(track.layers) || any(track.loops) || any(track.segmentSlots)) return true;
    if ((track.intro && hasKeys(track.intro.fx)) || (track.outro && hasKeys(track.outro.fx))) return true;
    return (track.sections || []).some(sec => any(sec && sec.pools));
  }
  // Faut-il le moteur Web Audio pour cette prise ? Sinon on garde le mixage ffmpeg historique, inchangé (plus
  // léger, et aucun risque de régression pour les prises sans effets ni spatialisation).
  function needsEngineRender(events, findTrack, findSfx) {
    const trackIds = new Set();
    events.forEach(e => { if (e.detail && e.detail.trackId) trackIds.add(e.detail.trackId); });
    for (const id of trackIds) if (trackHasFx(findTrack(id))) return true;
    return events.some(e => {
      if (e.name !== 'stinger_play') return false;
      const sfx = findSfx(e.detail.sfxId);
      return !!(sfx && sfx.spatial && sfx.spatial.enabled);
    });
  }

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

  async function render(plan, opts) {
    opts = opts || {};
    const progress = opts.onProgress || function () {};
    const C = core();
    if (!C) throw new Error('LayerPlayerCore introuvable : player.js doit être chargé.');
    const total = Math.max(0.5, plan.total);
    const oc = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
    const bufCache = new Map();
    async function getBuf(url) {
      if (bufCache.has(url)) return bufCache.get(url);
      const p = (async () => {
        const bytes = await opts.fetchBytes(url);
        return await oc.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      })();
      bufCache.set(url, p);
      return p;
    }

    // Tête de l'auditeur : l'orientation évolue au fil des gestes enregistrés.
    (plan.headEvents || []).slice().sort((a, b) => a.t - b.t).forEach(h => C.applyListenerYaw(oc, h.yaw, Math.max(0, h.t)));

    // Bus musique : creusé sous les Sfx marqués « duck » (mêmes 0,35 que l'export ffmpeg, avec de courtes rampes
    // pour éviter les clics).
    const musicBus = oc.createGain();
    musicBus.connect(oc.destination);
    musicBus.gain.setValueAtTime(1, 0);
    const wins = (plan.duckWindows || []).slice().sort((a, b) => a.start - b.start);
    const mergedDuck = [];
    wins.forEach(w => { const l = mergedDuck[mergedDuck.length - 1]; if (l && w.start <= l.end) l.end = Math.max(l.end, w.end); else mergedDuck.push({ start: w.start, end: w.end }); });
    mergedDuck.forEach(w => { musicBus.gain.setTargetAtTime(0.35, w.start, 0.01); musicBus.gain.setTargetAtTime(1, w.end, 0.05); });

    // Changements d'état des triggers, par morceau, triés.
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
    // Curseurs : points-clés enregistrés par (morceau, curseur), triés ; valeur en vigueur à l'instant t.
    const keysBySlider = {};
    (plan.sliderKeys || []).slice().sort((a, b) => a.t - b.t).forEach(k => (keysBySlider[k.trackId + '|' + k.sliderId] = keysBySlider[k.trackId + '|' + k.sliderId] || []).push(k));
    const slidersByTrack = new Map();
    const slidersOf = track => { if (!slidersByTrack.has(track.id)) slidersByTrack.set(track.id, C.fxSlidersValid(track)); return slidersByTrack.get(track.id); };
    const sliderValueAt = (trackId, sl, t) => { let v = sl.def; (keysBySlider[trackId + '|' + sl.id] || []).forEach(k => { if (k.t <= t) v = k.value; }); return v; };

    // Rapport de vitesse du morceau à l'instant t (mêmes règles que le lecteur : base, triggers « Vitesse » actifs, curseur « pitch.speed »).
    const isSpeedBinding = b => { const m = C.FX_SLIDER_PARAMS[b.param]; return !!(m && m.rate); };
    const hasDynamicRate = track => (track.fxTriggers || []).some(d => d && d.fx && d.fx.pitch && d.fx.pitch.mode === 'rate' && C.fxTargetKeyFromTarget(d.target) === 'track') || slidersOf(track).some(sl => sl.bindings.some(isSpeedBinding));
    function trackRateAt(track, t) {
      const defs = (track.fxTriggers || []).filter(d => d && d.id && d.fx && C.fxTargetKeyFromTarget(d.target) === 'track');
      const sliders = slidersOf(track);
      const active = activeAt(track.id, t).map(id => defs.find(d => d.id === id)).filter(Boolean);
      return C.fxTrackRatio(track, active, sliders, id => { const sl = sliders.find(x => x.id === id); return sl ? sliderValueAt(track.id, sl, t) : 0; });
    }

    // -- Musique --
    let n = 0;
    for (const seg of plan.segments || []) {
      const buf = await getBuf(seg.url);
      progress(++n, (plan.segments || []).length);
      // Vitesse du morceau (25/09) : si le morceau peut la changer en cours de route (trigger « Vitesse », curseur « pitch.speed »), le
      // rapport est celui en vigueur quand le lecteur a CRÉÉ la source -- ~0,9 s avant son démarrage pour un moteur programmé
      // (lookahead de 1 s), à son démarrage pour une voix qui tourne en continu (calée sur la ligne de temps). Sans ça : rapport de
      // base du plan (track.fx.pitch).
      const dynRate = !!(seg.track && hasDynamicRate(seg.track));
      const rate = dynRate ? trackRateAt(seg.track, seg.phaseLocked ? seg.start : Math.max(0, seg.start - 0.9)) : (seg.rate || 1);
      const offset = Math.max(0, seg.phaseLocked ? seg.fileStart * rate : (seg.fileStart || 0));
      if (offset >= buf.duration) continue;
      const dur = seg.dur != null ? seg.dur : (buf.duration - offset) / rate;
      if (!(dur > 0)) continue;
      const src = oc.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      // Voix en continu : elle suit les changements de vitesse pendant sa durée, comme le moteur simple du lecteur (glissement).
      if (dynRate && seg.phaseLocked) {
        const times = new Set();
        (changesByTrack[seg.track.id] || []).forEach(c => { if (c.t > seg.start && c.t < seg.start + dur) times.add(c.t); });
        slidersOf(seg.track).forEach(sl => (keysBySlider[seg.track.id + '|' + sl.id] || []).forEach(k => { if (k.t > seg.start && k.t < seg.start + dur) times.add(k.t); }));
        [...times].sort((a, b) => a - b).forEach(t => src.playbackRate.setTargetAtTime(trackRateAt(seg.track, t), t, 0.05));
      }
      const g = oc.createGain();
      const fade = Math.min(seg.fade || 0, dur / 2);
      if (fade > 0) {
        g.gain.setValueAtTime(0, seg.start);
        g.gain.linearRampToValueAtTime(1, seg.start + fade);
        g.gain.setValueAtTime(1, seg.start + dur - fade);
        g.gain.linearRampToValueAtTime(0, seg.start + dur);
      }
      // Chaîne d'effets de la voix : fx de base de sa cible + triggers actifs à son démarrage, puis changements
      // programmés pendant sa durée (mêmes règles de fusion que le lecteur).
      let chain = null;
      const track = seg.track;
      if (track && seg.targetKey) {
        const defs = (track.fxTriggers || []).filter(d => { if (!d || !d.id || !d.fx) return false; const k = C.fxTargetKeyFromTarget(d.target); return k === seg.targetKey || k === 'track'; });
        const sliders = slidersOf(track);
        const base = seg.baseFx !== undefined ? seg.baseFx : C.baseFxForTarget(track, seg.targetKey);
        const force = [...new Set(defs.flatMap(d => Object.keys(d.fx).filter(k => !(k === 'pitch' && d.fx.pitch && d.fx.pitch.mode === 'rate'))).concat(C.fxSliderForceKeys(sliders, seg.targetKey)))];
        const defOf = id => defs.find(d => d.id === id);
        const active = activeAt(track.id, seg.start);
        // fx effectif à l'instant t : base + triggers actifs, puis valeurs des curseurs par-dessus (mêmes règles que le lecteur).
        const sliderVals = new Map(sliders.map(sl => [sl.id, sliderValueAt(track.id, sl, seg.start)]));
        const effective = () => C.applyFxSliderOverrides(C.mergeTriggerFx(base, active.map(defOf).filter(Boolean)), C.fxSliderOverrides(sliders, id => sliderVals.get(id), seg.targetKey));
        chain = C.buildLayerFxChain(oc, effective(), src, seg.start, undefined, force);
        if (chain && (defs.length || force.length)) {
          // Tous les changements pendant la voix, dans l'ordre : appuis/états de triggers ET points-clés de curseurs.
          const timeline = [];
          (changesByTrack[track.id] || []).forEach(c => { if (c.t > seg.start && c.t < seg.start + dur) timeline.push({ t: c.t, c }); });
          sliders.forEach(sl => (keysBySlider[track.id + '|' + sl.id] || []).forEach(k => { if (k.t > seg.start && k.t < seg.start + dur) timeline.push({ t: k.t, k, sl }); }));
          timeline.sort((a, b) => a.t - b.t);
          timeline.forEach(ev => {
            let ramp = 0.1;
            if (ev.c) {
              const d = defOf(ev.c.triggerId); applyChange(active, ev.c); if (!d && !force.length) return;
              // même règle que le lecteur : fondu d'entrée / fondu de sortie (vide = même durée que l'entrée)
              const fin = d && d.fadeSec != null ? d.fadeSec : 0.1;
              ramp = ev.c.active ? fin : (d && d.fadeOutSec != null ? d.fadeOutSec : fin);
            }
            else { sliderVals.set(ev.sl.id, ev.k.value); ramp = ev.sl.smoothSec; }
            C.applyFxToChain(oc, chain, effective(), ramp, ev.t);
          });
        }
      }
      // Même compensation de latence que le lecteur : un morceau qui utilise bitcrusher/pitch-shift retarde ses voix
      // d'effet, toutes les autres voix du morceau reçoivent le même retard (transitions comprises).
      if (track && C.trackNeedsLatencyComp(track)) chain = C.withLatencyComp(oc, chain);
      if (chain) { src.connect(chain.input); chain.output.connect(g); } else src.connect(g);
      g.connect(musicBus);
      src.start(seg.start, offset);
      src.stop(seg.start + dur);
    }

    // -- Sfx (jamais duckés par leur propre passage) --
    const sfxBus = oc.createGain();
    sfxBus.connect(oc.destination);
    const hits = (plan.sfxHits || []).slice().sort((a, b) => a.t - b.t);
    for (const hit of hits) {
      const buf = await getBuf(hit.url);
      const src = oc.createBufferSource();
      src.buffer = buf;
      const sp = hit.sfx && hit.sfx.spatial;
      if (sp && sp.enabled) {
        // Curseurs liés à la position / reverb de ce Sfx : le son démarre à la valeur du curseur à cet instant, puis suit
        // les points-clés enregistrés pendant sa durée (comme en jeu, pour une source à position fixe).
        const track = hit.track;
        const sliders = track ? slidersOf(track).filter(sl => sl.bindings.some(b => b.key === 'sfx:' + hit.sfx.id)) : [];
        const valueOfAt = t => id => { const sl = sliders.find(x => x.id === id); return sl ? sliderValueAt(track.id, sl, t) : 0; };
        const ov0 = sliders.length ? C.fxSliderSfxOverrides(sliders, valueOfAt(hit.t), hit.sfx.id) : null;
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
  function replayParam(param, log, clampFrom) {
    if (!log) return;
    const lo = clampFrom || 0;
    const at = t => Math.max(lo, t);
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
      } catch (err) { /* commande refusée hors ligne (valeur hors bornes) : ignorée, comme le lecteur l'aurait vécu */ }
    });
  }
  async function renderTake(take, opts) {
    opts = opts || {};
    const C = core();
    if (!C) throw new Error('LayerPlayerCore introuvable : player.js doit être chargé.');
    if (!take || take.kind !== 'layerpitch-take') throw new Error('Prise invalide.');
    const tail = opts.tail != null ? opts.tail : 2;
    const end = Math.max(0.1, take.duration);
    const total = end + tail;
    const rate = take.sampleRate || SR;
    const oc = new OfflineAudioContext(2, Math.ceil(total * rate), rate);
    const progress = opts.onProgress || function () {};
    const bufCache = new Map();
    const getBuf = url => {
      if (!bufCache.has(url)) bufCache.set(url, (async () => {
        const bytes = await opts.fetchBytes(url);
        return await oc.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      })());
      return bufCache.get(url);
    };
    (take.yaw || []).forEach(([t, yaw]) => C.applyListenerYaw(oc, yaw, Math.max(0, t)));
    const master = oc.createGain();
    master.connect(oc.destination);
    replayParam(master.gain, take.master);

    const inWindow = v => v.url && v.start != null && v.start < end && !(v.stop != null && v.stop <= v.start);
    const voices = (take.voices || []).filter(inWindow);
    const sfx = (take.sfx || []).filter(inWindow);
    const n = voices.length + sfx.length;
    let i = 0;
    function makeSource(v, buf) {
      const src = oc.createBufferSource();
      src.buffer = buf;
      if (v.loop) { src.loop = true; src.loopStart = v.loop[0]; src.loopEnd = v.loop[1]; }
      replayParam(src.playbackRate, v.rate);
      return src;
    }
    function startSource(src, v) {
      if (v.dur != null) src.start(v.start, v.offset, v.dur); else src.start(v.start, v.offset);
      src.stop(Math.min(v.stop != null ? v.stop : Infinity, total));
    }
    for (const v of voices) {
      const buf = await getBuf(v.url);
      progress(++i, n);
      const src = makeSource(v, buf);
      let chain = null;
      if (v.fx) {
        chain = v.fx.fx || (v.fx.force && v.fx.force.length) ? C.buildLayerFxChain(oc, v.fx.fx, src, v.start, undefined, v.fx.force || []) : null;
        // Changements d'effet : même fonction que le lecteur, en mode programmé (un changement noté avant le démarrage
        // de la voix prend effet à son démarrage).
        if (chain) (v.fxLog || []).forEach(([t, fx, ramp]) => C.applyFxToChain(oc, chain, fx, ramp, Math.max(t, v.start)));
        if (v.fx.comp) chain = C.withLatencyComp(oc, chain);
      }
      let node = src;
      if (chain) { src.connect(chain.input); node = chain.output; }
      // Même retard qu'en direct pour les voix qui passent par un effet à ScriptProcessor ou par la compensation (voir
      // take.fxLatencySec) : les blocs hors-ligne sont plus petits, donc le retard natif plus court.
      if (chain && chain.nodes && (chain.nodes.bitcrush || chain.nodes.pitchShift || chain.nodes.latencyComp) && take.fxLatencySec) {
        const extra = take.fxLatencySec - C.fxSpLatencySec(oc);
        if (extra > 0) { const d = oc.createDelay(1); d.delayTime.value = extra; node.connect(d); node = d; }
      }
      if (v.gain) { const g = oc.createGain(); replayParam(g.gain, v.gain); node.connect(g); node = g; }
      node.connect(master);
      startSource(src, v);
    }
    for (const s of sfx) {
      const buf = await getBuf(s.url);
      progress(++i, n);
      const src = makeSource(s, buf);
      if (s.spatial) {
        const playRate = (s.rate && s.rate.init) || 1;
        const voice = C.buildSpatialVoice(oc, s.spatial.sp, { duration: buf.duration / playRate, stepKey: {}, stepIndex: s.spatial.stepIndex, startTime: s.start });
        src.connect(voice.input);
        (s.spatial.calls || []).forEach(c => {
          const t = Math.max(c[0], s.start);
          if (c[1] === 'pos') voice.setPosition(c[2], c[3], c[4], t);
          else if (c[1] === 'rev') voice.setReverbDb(c[2], c[3], t);
          else if (c[1] === 'bin') voice.setBinaural(c[2]); // pas de version programmée : l'état final l'emporte
        });
      } else src.connect(oc.destination);
      startSource(src, s);
    }
    const rendered = await oc.startRendering();
    // Une prise encore en cours (Figer pendant l'écoute) s'éteint en fondu à partir de sa fin ; une prise terminée
    // (arrêt, pause, fin naturelle) garde sa fin telle quelle, queues de reverb comprises. Appliqué au résultat : le
    // fondu touche tout, Sfx spatialisés et reverb de salle compris (ils sortent directement du contexte, comme en direct).
    if (!take.complete) {
      const f = opts.fadeOutSec != null ? opts.fadeOutSec : 1;
      const a = Math.floor(end * rate), b = Math.min(rendered.length, Math.floor((end + f) * rate));
      for (let c = 0; c < rendered.numberOfChannels; c++) {
        const d = rendered.getChannelData(c);
        for (let k = a; k < d.length; k++) d[k] *= k < b ? 1 - (k - a) / Math.max(1, b - a) : 0;
      }
    }
    return rendered;
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

  window.LayerCaptureRender = { render, renderTake, encodeWav, needsEngineRender, trackHasFx, fxSegmentsToChanges, deriveBranchChanges, deriveSliderTriggerChanges, resolveTriggerChanges, SR };
})();
