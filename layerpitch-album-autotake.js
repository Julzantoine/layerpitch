// layerpitch-album-autotake.js — LayerPitch, « version officielle automatique » d'un morceau d'album (26/10/2026 : statique, vertical,
// puis séquentiel, vertical-aléatoire et embranchement-vertical). Cadrage : layerpitch-docs/2026-10-26-cadrage-version-officielle-rapide.md (approche 1).
//
// Au lieu de jouer le lecteur à la main (LayerPitchAlbumShared.openRecorder), on FABRIQUE une frise datée à partir de la
// config du morceau (couches qui entrent à intervalles réguliers, un Sfx « stinger » posé sur un temps fort, fin avec sa
// queue ou en fondu), on la traduit en voix exactes avec LayerCapturePlan.buildPlan (mêmes règles que le lecteur : rampes,
// générations, queues), puis en PRISE -- le même format que celle du journal du lecteur (getTrackTake), que
// LayerCaptureRender.playTake / renderTake rejouent déjà. Aucun second moteur de lecture.
//
//   LayerPitchAutoTake.supports(track)                 true pour les cinq modes (static, vertical, sequential, vertical-random, embranchement-vertical)
//   LayerPitchAutoTake.defaults(track, sfxList)        réglages de départ { duration, intervalSec, stinger, sfxId, fadeSec, seed }
//   LayerPitchAutoTake.describe(track)                 { fixedDuration, quantized, barSec, layers, loopSec } pour l'écran de réglages
//   await LayerPitchAutoTake.generate(track, sfxById, settings, { measure })
//        -> { take, info:{ duration, musicEnd, stingerAt, intervalSec, layerEntries, fadeSec, sfxId } }
//        measure(url) -> durée en secondes d'un fichier (pour le « duck » de la musique sous un Sfx qui le demande)
//   LayerPitchAutoTake.planToTake(plan, opts)          (exposé pour les tests)
//
// Le hasard (position du stinger, variation tirée) est fixé par `settings.seed` : une prise générée est stable, « Régénérer »
// change la graine.
(function () {
  const C = () => window.LayerPlayerCore;
  const P = () => window.LayerCapturePlan;
  const MODES = ['static', 'vertical', 'sequential', 'vertical-random', 'embranchement-vertical'];
  const hasFile = x => !!(x && x.file);
  const supports = track => !!track && MODES.indexOf(track.mode) !== -1;
  const isQuantized = track => track.mode !== 'static' ? track.loopEngine === 'quantized' : (!!track.loopable && track.loopEngine === 'quantized');
  const loops = track => track.mode === 'vertical' || !!track.loopable;
  const round3 = x => Math.round(x * 1000) / 1000;

  // Petit générateur pseudo-aléatoire à graine (mulberry32) : même graine, mêmes tirages.
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Premier emplacement / première section jouable, pour les durées de départ et le tempo de l'intro.
  const playableSlots = track => (track.segmentSlots || []).filter(sl => slotAlts(track, sl).some(hasFile));
  const slotAlts = (track, slot) => { const src = slot && slot.referencesSlotId ? (track.segmentSlots || []).find(x => x.id === slot.referencesSlotId) : slot; return (src && src.alternatives) || []; };
  const playableSections = track => (track.sections || []).map((sec, i) => i).filter(i => { const r = P().resolveVRSection(track, i); return r && (r.pools || []).some(pl => (pl.alternatives || []).some(hasFile)); });

  function describe(track) {
    const tt = C().trackTempo(track);
    const barSec = tt.beatsPerBar * tt.secondsPerBeat;
    const mode = track.mode;
    const layerMode = mode === 'static' || mode === 'vertical';
    const quantized = layerMode && isQuantized(track);
    const layers = mode === 'static' ? 1 : (track.layers || []).filter(l => l && l.file).length;
    const loopSec = quantized ? C().quantizedLoopTiming(track).cycleLength : (Number(track.duration) || 0);
    // Ce que signifie « le rythme » selon le mode : une couche de plus (vertical), une boucle de plus (embranchement),
    // l'emplacement suivant (séquentiel), la section suivante (vertical-aléatoire).
    const intervalKind = mode === 'vertical' ? 'layers' : mode === 'embranchement-vertical' ? 'loops' : mode === 'sequential' ? 'slots' : mode === 'vertical-random' ? 'sections' : null;
    const fade = (layerMode && !quantized && loops(track)) || mode === 'embranchement-vertical';
    return { fixedDuration: layerMode && !loops(track), quantized, barSec, layers, loopSec, tempoKnown: !!track.bpm, intervalKind, fade };
  }

  function sfxWithFiles(sfx) { return sfx ? (sfx.alternatives || []).filter(a => a.file || a.localFile || a.localUrl) : []; }

  // Réglages de départ. 2 minutes ; vertical : une couche de plus toutes les 4 mesures (resserré si le morceau a beaucoup de
  // couches pour que la dernière entre avant 60 % de la durée) ; autres modes : on reste 2 tours (de la boucle, de
  // l'emplacement, de la section) avant de passer à la suite ; le premier Sfx du morceau en stinger ; 3 s de fondu en fin.
  function defaults(track, sfxList) {
    const d = describe(track);
    const sfxs = (sfxList || []).filter(s => sfxWithFiles(s).length);
    let interval = 0;
    if (track.mode === 'vertical') interval = d.layers > 1 ? Math.max(d.barSec, Math.min(4 * d.barSec, 0.6 * 120 / (d.layers - 1))) : 0;
    else if (track.mode === 'embranchement-vertical') interval = 2 * (C().embrLoopTimingOf(track).cycleLength || d.barSec * 4);
    else if (track.mode === 'sequential') { const sl = playableSlots(track)[0]; const alt = sl && slotAlts(track, sl).find(hasFile); interval = 2 * C().seqBlockSeconds(track, alt && alt.bars, sl); }
    else if (track.mode === 'vertical-random') { const i = playableSections(track)[0]; const sec = i != null ? P().resolveVRSection(track, i) : null; interval = 2 * (sec ? C().vrSectionTiming(sec).cycleLength : d.barSec * 4); }
    return { duration: d.fixedDuration ? Number(track.duration) || 0 : 120, intervalSec: round3(interval), stinger: sfxs.length > 0, sfxId: sfxs[0] ? sfxs[0].id : null, fadeSec: 3, seed: 1 };
  }

  // Stinger : un Sfx du morceau posé sur le début d'une mesure, entre 50 % et 80 % du morceau (après `after` si possible) --
  // l'endroit exact et la variation sont tirés avec la graine.
  function placeStinger(events, info, track, settings, sfxById, R, musicEnd, after) {
    info.stingerAt = null; info.sfxId = null;
    const sfx = settings.stinger && settings.sfxId ? sfxById[settings.sfxId] : null;
    const alts = sfx ? sfxWithFiles(sfx) : [];
    if (!sfx || !alts.length) return;
    const bar = describe(track).barSec;
    const lo = Math.max(0.5 * musicEnd, after || 0);
    const hi = Math.max(lo, 0.8 * musicEnd);
    const kLo = Math.ceil(lo / bar - 1e-9), kHi = Math.max(kLo, Math.floor(hi / bar + 1e-9));
    const k = kLo + Math.floor(R() * (kHi - kLo + 1));
    const at = round3(Math.min(k * bar, Math.max(0, musicEnd - 0.5)));
    const variationIndex = Math.floor(R() * alts.length);
    const detail = { trackId: track.id, sfxId: sfx.id, variationIndex, spatialStep: 0 };
    if (alts[variationIndex].duration > 0) detail.fileDuration = alts[variationIndex].duration;
    events.push({ t: at, name: 'stinger_play', detail });
    info.stingerAt = at; info.sfxId = sfx.id;
  }

  // ---- Frise ----
  function buildLayerEvents(track, settings, sfxById) {
    const id = track.id, d = describe(track), R = rng(settings.seed);
    const dur = Number(track.duration) || 0;
    const layerCount = Math.max(1, d.layers);
    const events = [];
    const info = { fadeSec: 0 };
    let musicEnd, segEnd; // musicEnd : instant « musical » de fin ; segEnd : fin des blocs de couche (queue du fichier comprise)
    let D = Math.max(1, Number(settings.duration) || 0);

    if (d.fixedDuration) {
      // Statique qui ne boucle pas : le fichier joue une fois, de bout en bout.
      musicEnd = segEnd = dur;
      events.push({ t: 0, name: 'layer_segment', detail: { trackId: id, layerIndex: 0, duration: dur, offset: 0 } });
    } else if (d.quantized) {
      // Moteur quantifié : une génération par tour ; la dernière joue jusqu'au bout du fichier (sa queue sonne seule).
      const qt = C().quantizedLoopTiming(track);
      const first = Math.max(0.01, qt.loopOutSec - qt.startTrackSec);
      const n = Math.max(1, 1 + Math.round((D - first) / qt.cycleLength));
      events.push({ t: 0, name: 'layer_gen', detail: { trackId: id, bufferOffset: qt.startTrackSec, level: 0 } });
      for (let k = 1; k < n; k++) events.push({ t: round3(first + (k - 1) * qt.cycleLength), name: 'layer_gen', detail: { trackId: id, bufferOffset: qt.loopInSec, level: 0 } });
      const lastStart = n > 1 ? first + (n - 2) * qt.cycleLength : 0;
      musicEnd = n > 1 ? lastStart + qt.cycleLength : first;
      segEnd = lastStart + Math.max(0.01, dur - (n > 1 ? qt.loopInSec : qt.startTrackSec));
    } else {
      // Moteur simple : chaque couche boucle nativement ; la durée est un nombre entier de tours, fin en fondu.
      const turns = dur > 0 ? Math.max(1, Math.round(D / dur)) : 1;
      musicEnd = segEnd = turns * (dur || D);
      events.push({ t: 0, name: 'layer_run', detail: { trackId: id, offset: 0, loop: [0, dur], level: 0 } });
      events.push({ t: musicEnd, name: 'voices_stop', detail: { trackId: id } });
      info.fadeSec = Math.max(0, Math.min(Number(settings.fadeSec) || 0, musicEnd / 2));
    }

    // Entrée des couches : la couche i entre à i × intervalle (calé sur la mesure), puis reste jusqu'à la fin.
    const layerEntries = [];
    if (!d.fixedDuration) {
      const bar = d.barSec;
      const interval = layerCount > 1 ? Math.max(bar, Math.round((Number(settings.intervalSec) || bar) / bar) * bar) : 0;
      info.intervalSec = interval;
      for (let i = 0; i < layerCount; i++) {
        const a = round3(i * interval);
        if (a >= musicEnd - 1e-6) break; // une couche qui entrerait après la fin n'entre pas
        layerEntries.push(a);
        events.push({ t: a, name: 'layer_segment', detail: { trackId: id, layerIndex: i, duration: round3(segEnd - a), offset: 0 } });
      }
      // Statique bouclable : un seul segment (la couche 0), déjà posé ci-dessus (layerCount = 1).
    } else layerEntries.push(0);

    placeStinger(events, info, track, settings, sfxById, R, musicEnd, layerEntries.length ? layerEntries[layerEntries.length - 1] : 0);
    info.musicEnd = musicEnd; info.layerEntries = layerEntries; info.segEnd = segEnd;
    events.sort((x, y) => x.t - y.t);
    return { events, info };
  }

  // ---- Séquentiel ----
  // Intro, puis les emplacements dans l'ordre de la chaîne (ou brassés si le morceau le demande) : un emplacement sans
  // embranchement joue son nombre de répétitions, un emplacement à embranchements reste `intervalSec` puis prend une de ses
  // sorties (on tourne sur les sorties pour tout faire entendre), avec sa transition ; à la durée visée, l'outro (s'il y en a
  // une) ou la fin du dernier bloc. Les blocs s'enchaînent aux fins de répétition : jamais de coupure.
  function buildSeqEvents(track, settings, sfxById, R) {
    const id = track.id, slots = track.segmentSlots || [], events = [], info = {};
    const D = Math.max(1, Number(settings.duration) || 0);
    const playable = slots.map((sl, i) => (slotAlts(track, sl).some(hasFile) ? i : -1)).filter(i => i >= 0);
    if (!playable.length) throw new Error('aucun emplacement jouable');
    const shuffled = () => { const o = playable.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = o[i]; o[i] = o[j]; o[j] = t; } return o; };
    let order = track.randomizeSections ? shuffled() : playable.slice();
    let pos = 0, t = 0, cycles = 0, last = null;
    const used = {};
    if (hasFile(track.intro)) { events.push({ t: 0, name: 'seq_intro_start', detail: { trackId: id } }); t += C().seqIntroSeconds(track, slots[playable[0]]); }
    const pickAlt = (slot, slotIdx) => {
      const alts = slotAlts(track, slot), valid = alts.map((a, i) => (hasFile(a) ? i : -1)).filter(i => i >= 0);
      let k = valid[Math.floor(R() * valid.length)];
      if (slot.avoidImmediateRepeat && valid.length > 1) while (k === last) k = valid[Math.floor(R() * valid.length)];
      last = k;
      return k;
    };
    let cur = order[0], guard = 0;
    while (t < D && guard++ < 400) {
      const slot = slots[cur];
      const branching = (slot.nextOptions || []).length > 0;
      let reps = 1;
      if (branching) { const a0 = slotAlts(track, slot).find(hasFile); reps = Math.max(1, Math.round((Number(settings.intervalSec) || 0) / C().seqBlockSeconds(track, a0 && a0.bars, slot))); }
      else reps = Math.max(1, slot.repeatCount || 1);
      for (let r = 0; r < reps; r++) {
        const altIndex = pickAlt(slot, cur), alt = slotAlts(track, slot)[altIndex];
        events.push({ t: round3(t), name: 'seq_slot_start', detail: { trackId: id, slotId: slot.id, altIndex } });
        t += C().seqBlockSeconds(track, alt && alt.bars, slot);
      }
      if (t >= D) break;
      if (branching) {
        const opts = slot.nextOptions.filter(o => { const ti = slots.findIndex(x => x.id === o.targetId); return ti >= 0 && playable.indexOf(ti) >= 0; });
        if (opts.length) {
          // l'option la moins empruntée d'abord (tirage à égalité) : toutes les sorties finissent par s'entendre
          const min = Math.min(...opts.map(o => used[slot.id + '>' + o.targetId] || 0));
          const cands = opts.filter(o => (used[slot.id + '>' + o.targetId] || 0) === min);
          const opt = cands[Math.floor(R() * cands.length)];
          used[slot.id + '>' + opt.targetId] = min + 1;
          if (hasFile(opt.transition)) {
            events.push({ t: round3(t), name: 'seq_transition_start', detail: { trackId: id, fromSlotId: slot.id, targetId: opt.targetId } });
            t += C().seqTransitionDurationSec(track, opt, slot) || 0;
          }
          cur = slots.findIndex(x => x.id === opt.targetId);
          pos = order.indexOf(cur);
          continue;
        }
      }
      pos++;
      if (pos >= order.length) { pos = 0; cycles++; if (track.maxChainLoops && cycles >= track.maxChainLoops) break; if (track.randomizeSections) order = shuffled(); }
      cur = order[pos];
    }
    const musicEnd = round3(t);
    if (hasFile(track.outro)) events.push({ t: musicEnd, name: 'seq_outro_start', detail: { trackId: id } });
    placeStinger(events, info, track, settings, sfxById, R, musicEnd, 0);
    info.musicEnd = musicEnd; info.segEnd = musicEnd + 60; info.fadeSec = 0;
    return { events: events.sort((x, y) => x.t - y.t), info };
  }

  // ---- Vertical-aléatoire ----
  // Intro, puis les sections dans l'ordre (ou brassées) : chaque section fait `maxLoops` cycles (ou, à défaut, le rythme
  // choisi), avec un tirage par pool à chaque cycle ; à la durée visée, l'outro (s'il y en a une) ou la fin du dernier cycle.
  function buildVrEvents(track, settings, sfxById, R) {
    const id = track.id, events = [], info = {};
    const D = Math.max(1, Number(settings.duration) || 0);
    const playable = playableSections(track);
    if (!playable.length) throw new Error('aucune section jouable');
    const shuffled = () => { const o = playable.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = o[i]; o[i] = o[j]; o[j] = t; } return o; };
    let order = track.randomizeSections ? shuffled() : playable.slice();
    let t = 0, pos = 0, cycles = 0, guard = 0;
    const started = {}, lastPick = {};
    if (hasFile(track.intro)) { events.push({ t: 0, name: 'vr_intro_start', detail: { trackId: id } }); t += C().vrIntroDurationSec(track, P().resolveVRSection(track, playable[0])); }
    while (t < D && guard++ < 400) {
      const secIdx = order[pos], section = P().resolveVRSection(track, secIdx), timing = C().vrSectionTiming(section);
      const n = section.maxLoops ? section.maxLoops : Math.max(1, Math.round((Number(settings.intervalSec) || 0) / timing.cycleLength));
      for (let k = 0; k < n; k++) {
        const first = !started[secIdx];
        started[secIdx] = true;
        const offset = first ? timing.startTrackSec : timing.loopInSec;
        const picks = (section.pools || []).map((pool, poolIndex) => {
          const alts = pool.alternatives || [];
          if (!alts.length) return { poolIndex, altIndex: -1 };
          let idx = Math.floor(R() * alts.length);
          const key = secIdx + ':' + poolIndex;
          if (pool.avoidImmediateRepeat && alts.length > 1) while (idx === lastPick[key]) idx = Math.floor(R() * alts.length);
          lastPick[key] = idx;
          return { poolIndex, altIndex: idx };
        });
        events.push({ t: round3(t), name: 'vr_section_start', detail: { trackId: id, sectionId: (track.sections[secIdx] || {}).id || null, sectionIndex: secIdx, bufferOffset: offset, picks } });
        t += first ? timing.loopOutSec - timing.startTrackSec : timing.cycleLength;
      }
      pos++;
      if (pos >= order.length) { pos = 0; cycles++; if (track.maxChainLoops && cycles >= track.maxChainLoops) break; if (track.randomizeSections) order = shuffled(); }
    }
    const musicEnd = round3(t);
    if (hasFile(track.outro)) events.push({ t: musicEnd, name: 'vr_outro_start', detail: { trackId: id } });
    placeStinger(events, info, track, settings, sfxById, R, musicEnd, 0);
    info.musicEnd = musicEnd; info.segEnd = musicEnd + 60; info.fadeSec = 0;
    return { events: events.sort((x, y) => x.t - y.t), info };
  }

  // ---- Embranchement-vertical ----
  // Départ sur la boucle de référence ; toutes les `intervalSec` (calées sur le cycle) on bascule sur la boucle suivante de la
  // liste -- boucles jumelles d'abord, détours ensuite -- puis retour à la référence. Le MOTEUR de l'embranchement (quantification
  // de la bascule, fichier de transition, baisse de la boucle quittée, retour automatique, fin d'un détour) est celui du
  // lecteur, via LayerCaptureRetarget.replayEmbrGestures. Fin en fondu sur le gain maître.
  async function buildEmbrEvents(track, settings, sfxById, R, opts) {
    const id = track.id, loopsList = track.loops || [], info = {};
    const timing = C().embrLoopTimingOf(track);
    const cycle = timing.cycleLength || describe(track).barSec * 4;
    const stay = Math.max(1, Math.round((Number(settings.intervalSec) || 0) / cycle)) * cycle;
    const D = Math.max(cycle, Math.round(Math.max(1, Number(settings.duration) || 0) / cycle) * cycle);
    const ref = C().embrReferenceIndex(track), peers = C().embrPeerIndicesOf(track);
    const withFile = i => hasFile(loopsList[i]);
    const queue = peers.filter(i => i !== ref && withFile(i)).concat(loopsList.map((l, i) => i).filter(i => peers.indexOf(i) < 0 && withFile(i)));
    if (queue.length) queue.push(ref);
    // Durée des fichiers de transition (réglée « durée du fichier » : il faut la mesurer pour savoir quand la bascule arrive).
    const fd = {};
    for (const l of loopsList) { if (hasFile(l.transition) && !l.transition.durationUnit && opts.measure) fd[l.transition.file] = await opts.measure(track.base + encodeURIComponent(l.transition.file) + (track.publishedAt ? '?v=' + encodeURIComponent(track.publishedAt) : '')); }
    const gestures = [{ t: 0, name: 'track_play', detail: { trackId: id } }];
    queue.forEach((i, k) => { const t = round3((k + 1) * stay); if (t < D - cycle) gestures.push({ t, name: 'embr_loop_select', detail: { trackId: id, loopId: loopsList[i].id } }); });
    gestures.push({ t: D, name: 'voices_stop', detail: { trackId: id } });
    const replay = window.LayerCaptureRetarget.replayEmbrGestures(gestures, track, { fileDuration: (t, file) => (file in fd ? fd[file] : null) });
    const events = [{ t: 0, name: 'track_play', detail: { trackId: id } }].concat(replay.events, [{ t: D, name: 'voices_stop', detail: { trackId: id } }]);
    placeStinger(events, info, track, settings, sfxById, R, D, 0);
    info.musicEnd = D; info.segEnd = D + 60;
    info.fadeSec = Math.max(0, Math.min(Number(settings.fadeSec) || 0, D / 2));
    info.switches = events.filter(e => e.name === 'embr_loop_select').length;
    return { events: events.sort((x, y) => x.t - y.t), info };
  }

  // ---- Plan -> prise ----
  // Mêmes décisions que LayerCaptureRender.render() pour la vitesse, la chaîne d'effets de chaque voix et le « duck » de la
  // musique, mais écrites sous la forme du journal du lecteur (voir getTrackTake) pour que playTake / renderTake / le lecteur
  // d'album les rejouent sans rien savoir de la génération.
  async function planToTake(plan, opts) {
    const core = C(), CP = P();
    const measure = opts.measure || (async () => 1);
    const sliderCache = new Map();
    const slidersOf = track => { if (!sliderCache.has(track.id)) sliderCache.set(track.id, core.fxSlidersValid(track)); return sliderCache.get(track.id); };
    const defOf = sliders => id => { const sl = sliders.find(x => x.id === id); return sl ? sl.def : 0; };
    // Triggers d'effet activés par le scénario (ex. effet lié à une boucle d'embranchement) : états après les règles, par morceau.
    const changesByTrack = {};
    (plan.triggerChanges || []).slice().sort((a, b) => a.t - b.t).forEach(c => (changesByTrack[c.trackId] = changesByTrack[c.trackId] || []).push(c));
    const applyChange = (list, c) => { const i = list.indexOf(c.triggerId); if (c.active && i < 0) list.push(c.triggerId); else if (!c.active && i >= 0) list.splice(i, 1); };
    const activeAt = (trackId, t) => { const list = []; (changesByTrack[trackId] || []).forEach(c => { if (c.t <= t) applyChange(list, c); }); return list; };
    let naturalEnd = 0;
    const voices = [];
    for (const v of plan.voices) {
      const track = v.track, sliders = slidersOf(track), sv = defOf(sliders);
      // Vitesse : même règle que render() (triggers « vitesse » et curseur compris).
      const defsAll = core.expandTriggerSteps(track.fxTriggers).filter(d => d && d.id && d.fx);
      const dyn = v.rate == null && (defsAll.some(d => d.fx.pitch && d.fx.pitch.mode === 'rate') || sliders.some(sl => sl.bindings.some(b => { const m = core.FX_SLIDER_PARAMS[b.param]; return !!(m && m.rate); })));
      const rateAt = t => core.fxTrackRatio(track, activeAt(track.id, t).map(id => defsAll.find(d => d.id === id)).filter(Boolean), sliders, sv);
      const rate = v.rate != null ? v.rate : (dyn ? rateAt(v.continuous ? v.start : Math.max(0, v.start - 0.9)) : core.fxTrackRatio(track, [], null));
      const rateAuto = [];
      const end0 = v.stop != null ? v.stop : (opts.fileEnds ? v.start + ((await measure(v.url)) - (v.offset || 0)) / (rate || 1) : v.start + Math.max(0, (Number(track.duration) || 0) - (v.offset || 0)) / (rate || 1));
      naturalEnd = Math.max(naturalEnd, end0);
      // Chaîne d'effets : fx de base de la cible + triggers actifs au démarrage, puis chaque changement pendant la voix.
      let fx = null, force = [], fxLog = [];
      if (v.targetKey) {
        const defs = defsAll.filter(d => { const k = core.fxTargetKeyFromTarget(d.target); return k === v.targetKey || k === 'track'; });
        const base = v.baseFx != null ? v.baseFx : core.baseFxForTarget(track, v.targetKey);
        force = [...new Set(defs.flatMap(d => Object.keys(d.fx).filter(k => !(k === 'pitch' && d.fx.pitch && d.fx.pitch.mode === 'rate'))).concat(core.fxSliderForceKeys(sliders, v.targetKey)))];
        const defById = id => defs.find(d => d.id === id);
        const active = activeAt(track.id, v.start);
        const effective = () => core.applyFxSliderOverrides(core.mergeTriggerFx(base, active.map(defById).filter(Boolean)), core.fxSliderOverrides(sliders, sv, v.targetKey));
        fx = effective();
        if (defs.length || force.length) {
          (changesByTrack[track.id] || []).forEach(c => {
            if (c.t <= v.start || c.t >= (v.stop != null ? v.stop : end0)) return;
            const d = defById(c.triggerId); applyChange(active, c);
            if (!d && !force.length) return;
            const fin = d && d.fadeSec != null ? d.fadeSec : 0.1;
            fxLog.push([c.t, JSON.parse(JSON.stringify(effective())), c.active ? fin : (d && d.fadeOutSec != null ? d.fadeOutSec : fin)]);
          });
        }
        if (dyn) {
          const times = new Set();
          (changesByTrack[track.id] || []).forEach(c => { if (c.t > v.start) times.add(c.t); });
          if (v.continuous) [...times].sort((a, b) => a - b).forEach(t => rateAuto.push(['tgt', t, rateAt(t), 0.05]));
        }
      }
      voices.push({
        url: v.url, start: v.start, offset: v.offset || 0, dur: null, loop: v.loop || null, stop: v.stop != null ? v.stop : null,
        rate: { init: rate, auto: rateAuto }, gain: v.gain || null,
        fx: { fx: fx && Object.keys(fx).length ? JSON.parse(JSON.stringify(fx)) : null, force: force.slice(), comp: !!core.trackNeedsLatencyComp(track) },
        fxLog
      });
    }
    const sfx = [];
    for (const h of plan.sfxHits) {
      const sp = h.spatial || (h.sfx && h.sfx.spatial);
      const dur = h.durationOverride || null;
      sfx.push({
        url: h.url, start: h.t, offset: 0, dur: null, loop: null, stop: dur ? h.t + dur : null, rate: { init: 1, auto: [] },
        spatial: sp && sp.enabled ? { sp: JSON.parse(JSON.stringify(sp)), stepIndex: h.stepIndex != null ? h.stepIndex : 0, calls: [] } : null
      });
      naturalEnd = Math.max(naturalEnd, h.t + (dur || (await measure(h.url)) || 0));
    }
    // Gain maître : « duck » sous les Sfx qui le demandent (comme render()), puis fondu de sortie éventuel.
    const RP = core.CAPTURE_RAMPS;
    let cmds = [];
    for (const d of plan.duckHits.slice().sort((a, b) => a.t - b.t)) {
      const dur = d.fileDuration != null ? d.fileDuration : (await measure(d.url));
      cmds = cmds.filter(c => c.t <= d.t);
      const restoreAt = d.t + Math.max(RP.duckAttack, dur / 2);
      cmds.push({ t: d.t, target: RP.duckLevel, ramp: RP.duckAttack }, { t: restoreAt, target: RP.duckLevel, ramp: 0 }, { t: restoreAt, target: 1, ramp: RP.duckRelease });
    }
    const duration = naturalEnd;
    if (opts.fade && opts.fade.sec > 0) {
      const from = Math.max(0, opts.fade.end - opts.fade.sec);
      cmds = cmds.filter(c => c.t < from);
      cmds.push({ t: from, target: 0, ramp: opts.fade.end - from });
    }
    const master = CP.automation(1, cmds, 0);
    return {
      v: 1, kind: 'layerpitch-take', trackId: opts.trackId, publishedAt: opts.publishedAt || null, recordedAt: new Date().toISOString(),
      duration: round3(duration), complete: true, missing: 0,
      fxLatencySec: core.liveFxLatencySec ? core.liveFxLatencySec() : 0, sampleRate: core.liveSampleRate ? core.liveSampleRate() : 44100,
      voices, sfx, master: { init: master.init, auto: master.auto }, yaw: [[0, 0]]
    };
  }

  async function generate(track, sfxById, settings, opts) {
    if (!supports(track)) throw new Error('mode non géré : ' + track.mode);
    opts = opts || {};
    const R = rng(settings.seed);
    let built;
    if (track.mode === 'sequential') built = buildSeqEvents(track, settings, sfxById || {}, R);
    else if (track.mode === 'vertical-random') built = buildVrEvents(track, settings, sfxById || {}, R);
    else if (track.mode === 'embranchement-vertical') built = await buildEmbrEvents(track, settings, sfxById || {}, R, opts);
    else built = buildLayerEvents(track, settings, sfxById || {});
    // Statique en moteur quantifié : le plan gère les générations pour le mode « vertical » ; on lui présente le morceau comme
    // un vertical à une seule couche (même fichier, mêmes réglages).
    const asVertical = track.mode === 'static' && isQuantized(track);
    const planTrack = asVertical ? Object.assign({}, track, { mode: 'vertical', layers: [track.layers[0]] }) : track;
    const findTrack = id => (id === track.id ? planTrack : null);
    const findSfx = id => (sfxById || {})[id] || null;
    // `total` du plan : jusqu'au bout de la queue de la dernière génération (+ la marge de queue habituelle).
    const { plan } = P().buildPlan(built.events, { findTrack, findSfx, total: built.info.segEnd + P().TAIL });
    const fadeSec = built.info.fadeSec || 0; // fondu de sortie : moteur simple et embranchement (les autres finissent par leur queue naturelle)
    const layerMode = track.mode === 'static' || track.mode === 'vertical';
    const take = await planToTake(plan, {
      trackId: track.id, publishedAt: track.publishedAt, measure: opts.measure, fileEnds: !layerMode,
      fade: fadeSec > 0 ? { end: built.info.musicEnd, sec: fadeSec } : null
    });
    take.generated = { v: 1, mode: track.mode, settings: { duration: settings.duration, intervalSec: settings.intervalSec, stinger: !!settings.stinger, sfxId: settings.sfxId || null, fadeSec: settings.fadeSec, seed: settings.seed } };
    const info = Object.assign({}, built.info, { duration: take.duration });
    return { take, info };
  }

  window.LayerPitchAutoTake = { supports, defaults, describe, generate, planToTake };
})();
