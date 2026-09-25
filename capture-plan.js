// capture-plan.js — LayerPitch, outil vidéo « Test in game » : des évènements d'une capture au plan de rendu audio
// (25/09/2026).
//
// Une capture = la liste datée (temps de la vidéo) de ce qui s'est passé : les évènements du lecteur (intensité,
// sections, emplacements, boutons d'effet, curseurs, Sfx, tête...) ET des repères propres à la capture émis par le
// lecteur (voir captureMark dans player.js) : démarrage de chaque génération d'une boucle, arrêt des voix, commandes
// de volume de l'embranchement-vertical. Chaque repère porte l'instant où le son est réellement entendu.
//
// Ce fichier (auparavant dans pack.html) fait deux choses, sans rien savoir du DOM :
//   1. materialize() : ramène une capture brute à des blocs éditables sur la frise (calques, fenêtres de boucle,
//      segments d'effet...) ;
//   2. buildPlan() : traduit la frise (éventuellement retouchée) en une liste exacte de voix -- quel fichier, à partir
//      de quelle position, quand, en boucle ou non, jusqu'où, avec quelles commandes de volume -- selon les MÊMES règles
//      que le lecteur (rampes, queues de fin, coupures, générations), que capture-render.js rend ensuite.
// Vérifié en comparant, pour une capture non retouchée, le rendu à la sortie réelle du lecteur.
(function () {
  const C = () => window.LayerPlayerCore;
  const SEQ_TIMELINE_EVENT_NAMES = ['seq_intro_start', 'seq_slot_start', 'seq_transition_start', 'seq_outro_start'];
  const VR_TIMELINE_EVENT_NAMES = ['vr_intro_start', 'vr_section_start', 'vr_outro_start'];
  // Repères propres à la capture : jamais affichés comme blocs, mais membres du groupe de leur morceau (ils suivent un
  // glisser de tout le morceau).
  const CAPTURE_MARK_NAMES = ['layer_run', 'layer_gen', 'embr_gen', 'embr_gains', 'embr_duck', 'embr_detour_in', 'embr_detour_out', 'embr_transition', 'voices_stop', 'track_play'];
  const TAIL = 2; // marge de fin : queues de reverb / d'écho, Sfx lancés juste avant la fin

  // ---- Résolution des fichiers (mêmes règles que player.js) ----
  function resolveSeqAlternative(track, slotId, altIndex) {
    const slot = (track.segmentSlots || []).find(s => s.id === slotId);
    if (!slot) return null;
    const sourceSlot = slot.referencesSlotId ? (track.segmentSlots || []).find(s => s.id === slot.referencesSlotId) : slot;
    const alt = sourceSlot && (sourceSlot.alternatives || [])[altIndex];
    return alt ? { slot, alt } : null;
  }
  function resolveSeqTransition(track, fromSlotId, targetId) {
    const sourceSlot = (track.segmentSlots || []).find(s => s.id === fromSlotId);
    const opt = sourceSlot && (sourceSlot.nextOptions || []).find(o => o.targetId === targetId);
    return (opt && opt.transition && opt.transition.file) ? opt.transition : null;
  }
  function resolveVRSection(track, sectionIndex) {
    const sections = track.sections || [];
    const sec = sections[sectionIndex];
    if (!sec) return null;
    if (sec.referencesSectionId) return sections.find(s => s.id === sec.referencesSectionId) || sec;
    return sec;
  }
  const effGain = (track, item) => (track.normalizeVolume && item && item.gain) ? item.gain : 1;

  // ---- Fenêtres (frise) ----
  // Séquentiel : une seule variation audible à la fois ; chaque évènement ouvre une fenêtre et ferme la précédente.
  function buildSeqTimelineWindows(events, trackId, total) {
    const trackEvents = events.filter(e => SEQ_TIMELINE_EVENT_NAMES.indexOf(e.name) !== -1 && e.detail.trackId === trackId).sort((a, b) => a.t - b.t);
    return trackEvents.map((e, i) => {
      const w = { start: e.t, end: i + 1 < trackEvents.length ? trackEvents[i + 1].t : total, idx: events.indexOf(e), e };
      if (e.name === 'seq_intro_start') { w.kind = 'intro'; w.laneKey = 'intro'; }
      else if (e.name === 'seq_outro_start') { w.kind = 'outro'; w.laneKey = 'outro'; }
      else if (e.name === 'seq_transition_start') {
        w.kind = 'transition'; w.fromSlotId = e.detail.fromSlotId; w.targetId = e.detail.targetId;
        w.laneKey = 'transition:' + e.detail.fromSlotId + '>' + e.detail.targetId;
      } else { w.kind = 'slot'; w.slotId = e.detail.slotId; w.altIndex = e.detail.altIndex; w.laneKey = 'slot:' + e.detail.slotId; }
      return w;
    });
  }
  // Vertical-random : un cycle de section = une fenêtre, avec ses tirages (picks) et sa position dans les fichiers.
  function buildVRTimelineWindows(events, trackId, total) {
    const trackEvents = events.filter(e => VR_TIMELINE_EVENT_NAMES.indexOf(e.name) !== -1 && e.detail.trackId === trackId).sort((a, b) => a.t - b.t);
    return trackEvents.map((e, i) => {
      const w = { start: e.t, end: i + 1 < trackEvents.length ? trackEvents[i + 1].t : total, idx: events.indexOf(e), e };
      if (e.name === 'vr_intro_start') w.kind = 'intro';
      else if (e.name === 'vr_outro_start') w.kind = 'outro';
      else { w.kind = 'section'; w.sectionIndex = e.detail.sectionIndex; w.bufferOffset = e.detail.bufferOffset; w.picks = e.detail.picks || []; }
      return w;
    });
  }
  // Embranchement-vertical : boucle audible par fenêtre. La boucle de référence joue depuis le démarrage du morceau
  // jusqu'à la première bascule.
  function buildEmbrTimelineWindows(events, track, total) {
    const selects = events.filter(e => e.name === 'embr_loop_select' && e.detail.trackId === track.id).sort((a, b) => a.t - b.t);
    const initialLoop = (track.loops || []).find(l => l.isInitial) || (track.loops || [])[0];
    const startEv = events.filter(e => (e.name === 'embr_gen' || e.name === 'track_play') && e.detail.trackId === track.id).sort((a, b) => a.t - b.t)[0];
    const windows = [];
    if (initialLoop) windows.push({ loopId: initialLoop.id, start: startEv ? startEv.t : 0, isSwitch: false });
    selects.forEach(e => windows.push({ loopId: e.detail.loopId, start: e.t, isSwitch: true, e }));
    windows.forEach((w, i) => { w.end = i + 1 < windows.length ? windows[i + 1].start : total; });
    return windows;
  }

  // ---- Matérialisation (à l'arrêt d'une capture) ----
  // intensity_change (mode vertical : un niveau allume plusieurs calques) -> segments de calque INDÉPENDANTS
  // layer_segment, un par calque et par plage continue où il est actif (Jules-Antoine, 15/09 : chaque calque a son
  // propre interrupteur). Le niveau de départ d'une écoute est celui que le lecteur annonce à son démarrage (repère
  // layer_run / layer_gen), sinon 0. Statique : chaque démarrage donne un segment. track_play est conservé comme repère.
  function materializeLayerSegments(events, findTrack) {
    const intensityEvents = events.filter(e => e.name === 'intensity_change');
    const startEvents = events.filter(e => e.name === 'track_play' || e.name === 'layer_run' || e.name === 'layer_gen');
    if (!intensityEvents.length && !startEvents.length) return events;
    const byTrack = {};
    intensityEvents.forEach(e => (byTrack[e.detail.trackId] = byTrack[e.detail.trackId] || []).push(e));
    // Un démarrage sans changement d'intensité avant lui : niveau annoncé par le lecteur (ou 0), à cet instant -- n'écrase
    // jamais un vrai clic.
    startEvents.filter(e => e.name !== 'layer_gen').forEach(pe => {
      const list = (byTrack[pe.detail.trackId] = byTrack[pe.detail.trackId] || []);
      if (!list.some(e => e.t <= pe.t)) list.push({ t: pe.t, name: 'intensity_change', detail: { trackId: pe.detail.trackId, level: pe.detail.level || 0 } });
    });
    const total = Math.max(0, ...events.map(e => e.t)) + TAIL;
    const layerSegmentEvents = [];
    const consumedStatic = [];
    Object.keys(byTrack).forEach(trackId => {
      const track = findTrack(trackId);
      if (!track || track.mode !== 'vertical') return;
      const sorted = byTrack[trackId].slice().sort((a, b) => a.t - b.t);
      // Un changement d'intensité ANTÉRIEUR au premier démarrage règle seulement le niveau de départ.
      const numLayers = (track.layers || []).length;
      const cumulative = C().cumulativeProfiles(numLayers);
      const windows = sorted.map((e, i) => ({ level: e.detail.level, start: e.t, end: i + 1 < sorted.length ? sorted[i + 1].t : total }));
      for (let layerIndex = 0; layerIndex < numLayers; layerIndex++) {
        let run = null;
        windows.forEach(w => {
          const profile = cumulative[w.level] || cumulative[0];
          const active = profile && !!profile[layerIndex];
          if (active && run && run.end === w.start) { run.end = w.end; return; }
          if (run) layerSegmentEvents.push({ t: run.start, name: 'layer_segment', detail: { trackId, layerIndex, duration: run.end - run.start } });
          run = active ? { start: w.start, end: w.end } : null;
        });
        if (run) layerSegmentEvents.push({ t: run.start, name: 'layer_segment', detail: { trackId, layerIndex, duration: run.end - run.start } });
      }
    });
    const staticByTrack = {};
    events.filter(e => e.name === 'layer_run' || (e.name === 'track_play' && !events.some(r => r.name === 'layer_run' && r.detail.trackId === e.detail.trackId))).forEach(pe => {
      const track = findTrack(pe.detail.trackId);
      if (!track || track.mode !== 'static') return;
      (staticByTrack[pe.detail.trackId] = staticByTrack[pe.detail.trackId] || []).push(pe);
    });
    Object.keys(staticByTrack).forEach(trackId => {
      consumedStatic.push(trackId);
      const starts = staticByTrack[trackId].slice().sort((a, b) => a.t - b.t);
      const stops = events.filter(e => e.name === 'voices_stop' && e.detail.trackId === trackId).map(e => e.t);
      starts.forEach((pe, i) => {
        const next = i + 1 < starts.length ? starts[i + 1].t : total;
        const stop = stops.filter(t => t > pe.t && t <= next).sort((a, b) => a - b)[0];
        const end = stop != null ? stop : next;
        layerSegmentEvents.push({ t: pe.t, name: 'layer_segment', detail: { trackId, layerIndex: 0, duration: end - pe.t, offset: pe.detail.offset || 0 } });
      });
    });
    return events.filter(e => e.name !== 'intensity_change').concat(layerSegmentEvents).sort((a, b) => a.t - b.t);
  }
  // Embranchement-vertical : les bascules RÉELLES (repères embr_gains / embr_detour_in, émis quand le son change
  // vraiment -- après la quantification, la transition, ou par un retour automatique) deviennent les blocs de la frise
  // (embr_loop_select, avec la clé k de la bascule). Les clics bruts (statistiques) sont alors écartés. Une capture
  // d'avant ces repères garde ses clics tels quels.
  function materializeEmbrSwitches(events, findTrack) {
    const withMarks = new Set(events.filter(e => e.name === 'embr_gen').map(e => e.detail.trackId));
    if (!withMarks.size) return events;
    const out = events.filter(e => !(e.name === 'embr_loop_select' && withMarks.has(e.detail.trackId) && !e.detail.k));
    const seen = new Set(out.filter(e => e.name === 'embr_loop_select' && e.detail.k).map(e => e.detail.trackId + '|' + e.detail.k));
    events.forEach(e => {
      if (!withMarks.has(e.detail && e.detail.trackId) || !e.detail.k) return;
      const isStart = (e.name === 'embr_gains' && e.detail.loopId) || e.name === 'embr_detour_in';
      if (!isStart) return;
      const key = e.detail.trackId + '|' + e.detail.k;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ t: e.t, name: 'embr_loop_select', detail: { trackId: e.detail.trackId, loopId: e.detail.loopId, k: e.detail.k } });
    });
    return out.sort((a, b) => a.t - b.t);
  }
  // Tête et curseurs éclaircis en points-clés (un point tous les >= 3° / 2 % et >= 80 ms, et toujours le dernier d'un
  // geste), boutons d'effet en blocs fx_segment -- éditables sur la frise.
  function decimateHeadTurns(heads) {
    const sorted = heads.slice().sort((a, b) => a.t - b.t);
    const out = [];
    let last = null, pending = null;
    sorted.forEach(h => {
      if (pending && h.t - pending.t > 0.25) { out.push(pending); last = pending; pending = null; }
      if (!last || (Math.abs(h.detail.yaw - last.detail.yaw) >= 3 && h.t - last.t >= 0.08)) { out.push(h); last = h; pending = null; }
      else pending = h;
    });
    if (pending) out.push(pending);
    return out;
  }
  function decimateSliderKeys(keys) {
    const groups = {};
    keys.slice().sort((a, b) => a.t - b.t).forEach(k => (groups[k.detail.trackId + '|' + k.detail.sliderId] = groups[k.detail.trackId + '|' + k.detail.sliderId] || []).push(k));
    const out = [];
    Object.keys(groups).forEach(g => {
      let last = null, pending = null;
      groups[g].forEach(k => {
        if (pending && k.t - pending.t > 0.25) { out.push(pending); last = pending; pending = null; }
        if (!last || (Math.abs(k.detail.value - last.detail.value) >= 0.02 && k.t - last.t >= 0.08)) { out.push(k); last = k; pending = null; }
        else pending = k;
      });
      if (pending) out.push(pending);
    });
    return out;
  }
  function materializeCaptureExtras(events) {
    const rawTriggers = events.filter(e => e.name === 'fx_trigger').sort((a, b) => a.t - b.t);
    const heads = events.filter(e => e.name === 'head_turn');
    const sliderKeys = events.filter(e => e.name === 'fx_slider');
    if (!rawTriggers.length && !heads.length && !sliderKeys.length) return events;
    const total = Math.max(0, ...events.map(e => e.t)) + TAIL;
    const segments = [], cuts = [], open = {};
    const closeSeg = (k, trackId, triggerId, endT) => segments.push({ t: open[k], name: 'fx_segment', detail: { trackId, triggerId, duration: Math.max(0.1, endT - open[k]) } });
    rawTriggers.forEach(e => {
      const k = e.detail.trackId + '|' + e.detail.triggerId;
      if (e.detail.active) {
        if (open[k] !== undefined) closeSeg(k, e.detail.trackId, e.detail.triggerId, e.t);
        open[k] = e.t;
      } else if (open[k] !== undefined) {
        closeSeg(k, e.detail.trackId, e.detail.triggerId, e.t);
        delete open[k];
      } else cuts.push({ t: e.t, name: 'fx_cut', detail: { trackId: e.detail.trackId, triggerId: e.detail.triggerId } });
    });
    Object.keys(open).forEach(k => {
      const [trackId, triggerId] = k.split('|');
      segments.push({ t: open[k], name: 'fx_segment', detail: { trackId, triggerId, duration: Math.max(0.1, total - open[k]) } });
    });
    return events.filter(e => e.name !== 'fx_trigger' && e.name !== 'head_turn' && e.name !== 'fx_slider')
      .concat(segments, cuts, decimateHeadTurns(heads), decimateSliderKeys(sliderKeys)).sort((a, b) => a.t - b.t);
  }
  // Idempotent : une passe additive mélange des évènements déjà matérialisés et des évènements bruts.
  function materialize(events, findTrack) {
    return materializeCaptureExtras(materializeEmbrSwitches(materializeLayerSegments(events, findTrack), findTrack));
  }

  // Repères liés à une bascule d'embranchement (sa clé k et, de proche en proche, les bascules qu'elle a armées) : ils
  // suivent le bloc quand on le déplace, et disparaissent avec lui.
  function linkedMarks(events, e) {
    if (!e || e.name !== 'embr_loop_select' || !e.detail.k) return [];
    const keys = new Set([e.detail.k]);
    let grew = true;
    while (grew) {
      grew = false;
      events.forEach(o => {
        if (o.detail && o.detail.trackId === e.detail.trackId && o.detail.pk && keys.has(o.detail.pk) && o.detail.k && !keys.has(o.detail.k)) { keys.add(o.detail.k); grew = true; }
      });
    }
    return events.filter(o => o !== e && o.detail && o.detail.trackId === e.detail.trackId && o.detail.k && keys.has(o.detail.k));
  }

  function captureTotal(events) {
    const lastT = Math.max(0, ...events.map(e => e.t),
      ...events.filter(e => e.name === 'stinger_play').map(e => e.t + (e.detail.durationOverride || e.detail.fileDuration || 1)),
      ...events.filter(e => e.name === 'layer_segment' || e.name === 'fx_segment').map(e => e.t + e.detail.duration));
    return lastT + TAIL;
  }

  // ---- Enveloppes de volume ----
  // Commandes { t, target, ramp } appliquées comme le lecteur : depuis la valeur du moment, rampe linéaire vers la cible
  // (ramp 0 = saut). envAt donne la valeur à l'instant t ; automation() la traduit en commandes Web Audio pour une voix
  // qui démarre à `from` (même format que le journal de prise : 'set' / 'lin').
  function envAt(init, cmds, t) {
    let segStart = -Infinity, from = init, to = init, segEnd = -Infinity;
    const valAt = x => (x >= segEnd || segEnd === segStart) ? to : from + (to - from) * (x - segStart) / (segEnd - segStart);
    for (const c of cmds) {
      if (c.t > t) break;
      from = valAt(c.t); segStart = c.t; to = c.target; segEnd = c.t + (c.ramp || 0);
    }
    return valAt(t);
  }
  function automation(init, cmds, from, until) {
    const auto = [['set', from, envAt(init, cmds, from)]];
    cmds.forEach(c => {
      if (c.t <= from || (until != null && c.t >= until)) return;
      auto.push(['set', c.t, envAt(init, cmds, c.t - 1e-9)]);
      if (c.ramp > 0) auto.push(['lin', c.t + c.ramp, c.target]); else auto.push(['set', c.t, c.target]);
    });
    return { init: auto[0][2], auto };
  }
  const byT = (a, b) => a.t - b.t;

  // Mix du visiteur (muet / solo / volume par voix 'layer-i' / 'pool-i') au fil de la capture.
  function mixTimeline(events, trackId) {
    const st = { muted: new Set(), soloed: new Set(), volumes: {} };
    const snaps = [{ t: -Infinity, muted: [], soloed: [], volumes: {} }];
    events.filter(e => e.detail && e.detail.trackId === trackId && (e.name === 'voice_mute_toggle' || e.name === 'voice_solo_toggle' || e.name === 'voice_volume_change')).sort(byT).forEach(e => {
      if (e.name === 'voice_volume_change') st.volumes[e.detail.voice] = e.detail.value;
      else { const set = e.name === 'voice_solo_toggle' ? st.soloed : st.muted; if (e.detail.active) set.add(e.detail.voice); else set.delete(e.detail.voice); }
      snaps.push({ t: e.t, muted: [...st.muted], soloed: [...st.soloed], volumes: Object.assign({}, st.volumes) });
    });
    const at = t => { let s = snaps[0]; snaps.forEach(x => { if (x.t <= t) s = x; }); return s; };
    const gain = (key, t) => {
      const s = at(t);
      const sm = s.soloed.length ? (s.soloed.indexOf(key) >= 0 ? 1 : 0) : (s.muted.indexOf(key) >= 0 ? 0 : 1);
      return sm * (s.volumes[key] != null ? s.volumes[key] : 1);
    };
    return { times: snaps.slice(1).map(s => s.t), gain };
  }

  // ---- Plan de rendu ----
  // opts : findTrack, findSfx, total (facultatif). Renvoie { plan, windows } : plan pour LayerCaptureRender.render,
  // windows (embr / seq / vr, par morceau) pour les incrustations de l'export vidéo.
  function buildPlan(events, opts) {
    const findTrack = opts.findTrack, findSfx = opts.findSfx;
    const R = C().CAPTURE_RAMPS;
    const total = opts.total != null ? opts.total : captureTotal(events);
    const voices = [];
    const warn = (msg, o) => { try { console.warn(msg, o); } catch (e) {} };
    const trackIds = [...new Set(events.map(e => e.detail && e.detail.trackId).filter(Boolean))];
    const windows = { embr: {}, seq: {}, vr: {} };
    const stopsOf = trackId => events.filter(e => e.name === 'voices_stop' && e.detail.trackId === trackId).map(e => e.t).sort((a, b) => a - b);
    const firstStopAfter = (stops, t, eps) => { for (const s of stops) if (s > t + (eps || 1e-6)) return s; return null; };
    const voice = o => { const v = Object.assign({ gain: null, loop: null, stop: null, offset: 0, continuous: false }, o); if (v.stop != null && v.stop <= v.start) return; voices.push(v); };

    trackIds.forEach(trackId => {
      const track = findTrack(trackId);
      if (!track) return;
      const stops = stopsOf(trackId);
      const mix = mixTimeline(events, trackId);
      const url = file => track.base + encodeURIComponent(file) + (track.publishedAt ? '?v=' + encodeURIComponent(track.publishedAt) : '');

      // -- Vertical / statique --
      if (track.mode === 'vertical' || track.mode === 'static') {
        const layers = track.mode === 'static' ? [track.layers[0]] : (track.layers || []);
        const segs = events.filter(e => e.name === 'layer_segment' && e.detail.trackId === trackId);
        if (track.mode === 'static') {
          // Un segment = une écoute : le fichier depuis sa position de départ, en boucle si le morceau boucle.
          segs.forEach(s => {
            const layer = layers[0];
            if (!layer || !layer.file) return;
            const g = effGain(track, layer);
            voice({ url: url(layer.file), track, targetKey: 'layer:0', start: s.t, offset: s.detail.offset || 0,
              loop: track.loopable ? [0, track.duration] : null, stop: s.t + s.detail.duration, continuous: true,
              gain: automation(g, [], s.t) });
          });
          return;
        }
        // Calque actif ou non à l'instant t, et commandes de volume de chaque calque : bord d'un segment = rampe
        // d'intensité ; geste de mix = rampe courte.
        const on = (i, t) => segs.some(s => s.detail.layerIndex === i && s.t <= t && t < s.t + s.detail.duration);
        const target = (i, t) => (on(i, t) ? effGain(track, layers[i]) : 0) * mix.gain('layer-' + i, t);
        const edges = i => [...new Set(segs.filter(s => s.detail.layerIndex === i).flatMap(s => [s.t, s.t + s.detail.duration]))].sort((a, b) => a - b);
        const cmdsFor = (i, from, currentUntil) => {
          const list = [];
          edges(i).forEach(t => { if (t > from && (currentUntil == null || t < currentUntil)) list.push({ t, target: target(i, t + 1e-6), ramp: R.intensity }); });
          mix.times.forEach(t => { if (t > from) list.push({ t, target: target(i, t + 1e-6), ramp: R.voice }); });
          return list.sort(byT);
        };
        const runs = events.filter(e => e.name === 'layer_run' && e.detail.trackId === trackId).sort(byT);
        const gens = events.filter(e => e.name === 'layer_gen' && e.detail.trackId === trackId).sort(byT);
        const covered = [];
        // Moteur simple : chaque couche tourne en boucle depuis le démarrage (une seule source par couche et par écoute).
        runs.forEach(r => {
          const stop = firstStopAfter(stops, r.t);
          covered.push([r.t, stop != null ? stop : total]);
          layers.forEach((layer, i) => {
            if (!layer || !layer.file) return;
            const init = target(i, r.t);
            voice({ url: url(layer.file), track, targetKey: 'layer:' + i, voiceKey: 'layer-' + i, start: r.t, offset: r.detail.offset || 0,
              loop: r.detail.loop, stop, continuous: true, gain: automation(init, cmdsFor(i, r.t), r.t) });
          });
        });
        // Moteur quantifié : une génération de toutes les couches à chaque tour, jouée jusqu'au bout du fichier (la
        // queue chevauche la génération suivante) ; un changement d'intensité ne touche que la génération en cours.
        gens.forEach((g, gi) => {
          const stop = firstStopAfter(stops, g.t);
          const nextGen = gens[gi + 1] && (stop == null || gens[gi + 1].t < stop) ? gens[gi + 1].t : null;
          covered.push([g.t, nextGen != null ? nextGen : (stop != null ? stop : total)]);
          layers.forEach((layer, i) => {
            if (!layer || !layer.file) return;
            const init = target(i, g.t);
            const list = cmdsFor(i, g.t, nextGen).filter(c => c.ramp === R.voice || nextGen == null || c.t < nextGen);
            voice({ url: url(layer.file), track, targetKey: 'layer:' + i, voiceKey: 'layer-' + i, start: g.t, offset: g.detail.bufferOffset || 0,
              stop, gain: automation(init, list, g.t) });
          });
        });
        // Segments hors de toute écoute enregistrée (bloc ajouté à la main sur la frise, ou capture d'avant les repères) :
        // la couche joue en boucle sur la longueur du morceau, calée sur la dernière écoute connue (ou sur le début de la
        // vidéo), le temps du segment.
        const anchor = runs[0] || gens[0] || null;
        segs.forEach(s => {
          const i = s.detail.layerIndex, layer = layers[i];
          if (!layer || !layer.file) return;
          const a = s.t, b = s.t + s.detail.duration;
          if (covered.some(([x, y]) => x <= a + 1e-6 && b <= y + 1e-6)) return;
          const dur = track.duration || 0;
          const phase0 = anchor ? (anchor.detail.offset || anchor.detail.bufferOffset || 0) - anchor.t : 0;
          const offset = dur > 0 ? (((a + phase0) % dur) + dur) % dur : 0;
          voice({ url: url(layer.file), track, targetKey: 'layer:' + i, voiceKey: 'layer-' + i, start: a, offset, loop: dur > 0 ? [0, dur] : null, stop: b + R.intensity, continuous: true,
            gain: automation(0, [{ t: a, target: effGain(track, layer) * mix.gain('layer-' + i, a), ramp: R.intensity }, { t: b, target: 0, ramp: R.intensity }], a) });
        });
        return;
      }

      // -- Embranchement-vertical --
      if (track.mode === 'embranchement-vertical') {
        const loops = track.loops || [];
        const loopById = id => loops.find(l => l.id === id);
        const embrWindows = buildEmbrTimelineWindows(events, track, total);
        windows.embr[trackId] = embrWindows;
        const gens = events.filter(e => e.name === 'embr_gen' && e.detail.trackId === trackId).sort(byT);
        const marks = events.filter(e => e.detail && e.detail.trackId === trackId && (e.name === 'embr_gains' || e.name === 'embr_duck' || e.name === 'embr_detour_in' || e.name === 'embr_detour_out' || e.name === 'embr_transition'));
        const selects = events.filter(e => e.name === 'embr_loop_select' && e.detail.trackId === trackId);
        // Bascules ajoutées à la main (sans repères) ou capture d'avant les repères : on les traduit en commandes, avec le
        // fondu de la boucle visée (même règle que le lecteur).
        const synth = [];
        const peerIds = gens.length ? gens[0].detail.peers : loops.filter(l => !l.isDetour).map(l => l.id);
        selects.filter(e => !e.detail.k).forEach(e => {
          const loop = loopById(e.detail.loopId);
          if (!loop) return;
          const fade = C().embrCutFadeSec(loop);
          if (peerIds.indexOf(loop.id) >= 0) synth.push({ t: e.t, name: 'embr_gains', detail: { loopId: loop.id, fadeSec: fade } });
          else synth.push({ t: e.t, name: 'embr_detour_in', detail: { loopId: loop.id, fadeSec: fade, loop: loop.detourMode === 'loop' } });
        });
        // Une fenêtre (bascule) qui suit un détour synthétique le termine ; pendant le détour, les boucles jumelles se
        // taisent (le lecteur l'annonce lui-même par un repère embr_gains, ajouté ici pour les détours synthétiques).
        const all = marks.concat(synth).sort(byT);
        all.filter(m => m.name === 'embr_detour_in' && !m.detail.k).forEach(m => {
          all.push({ t: m.t, name: 'embr_gains', detail: { loopId: null, fadeSec: 0.15 } });
          const nextSel = embrWindows.find(w => w.start > m.t + 1e-6);
          if (nextSel) all.push({ t: nextSel.start, name: 'embr_detour_out', detail: { fadeSec: C().embrCutFadeSec(loopById(m.detail.loopId)) } });
        });
        all.sort(byT);
        // Enveloppe de chaque boucle jumelle : départ sur la boucle annoncée active, puis bascules et baisses.
        const firstActive = gens.length ? gens[0].detail.active : ((loops.find(l => l.isInitial) || loops[0] || {}).id);
        const envCmds = {};
        peerIds.forEach(id => { envCmds[id] = []; });
        all.forEach(m => {
          if (m.name === 'embr_gains') peerIds.forEach(id => envCmds[id].push({ t: m.t, target: id === m.detail.loopId ? 1 : 0, ramp: m.detail.fadeSec || 0 }));
          else if (m.name === 'embr_duck' && envCmds[m.detail.loopId]) envCmds[m.detail.loopId].push({ t: m.t, target: 0, ramp: m.detail.fadeSec || 0 });
        });
        const initOf = id => (id === firstActive ? 1 : 0);
        const genList = gens.length ? gens : [{ t: embrWindows.length ? embrWindows[0].start : 0, detail: { bufferOffset: 0 }, legacy: true }];
        genList.forEach(g => {
          const stop = firstStopAfter(stops, g.t);
          peerIds.forEach(id => {
            const loop = loopById(id);
            if (!loop || !loop.file) return;
            const cmds = envCmds[id].slice().sort(byT);
            voice({ url: url(loop.file), track, targetKey: 'loop:' + loops.indexOf(loop), start: g.t, offset: g.detail.bufferOffset || 0,
              loop: g.legacy && loop.duration ? [0, loop.duration] : null, stop,
              gain: automation(envAt(initOf(id), cmds, g.t), cmds, g.t) });
          });
        });
        // Détours : lecture fraîche de la boucle courte, fondu d'entrée, puis fondu de sortie à la bascule suivante.
        all.filter(m => m.name === 'embr_detour_in').forEach(m => {
          const loop = loopById(m.detail.loopId);
          if (!loop || !loop.file) return;
          const out = all.find(o => o.name === 'embr_detour_out' && o.t > m.t + 1e-6);
          const stop = firstStopAfter(stops, m.t);
          const cmds = [{ t: m.t, target: 1, ramp: m.detail.fadeSec || 0 }];
          let end = stop;
          if (out && (stop == null || out.t < stop)) { cmds.push({ t: out.t, target: 0, ramp: out.detail.fadeSec || 0 }); end = out.t + (out.detail.fadeSec || 0) + 0.05; }
          voice({ url: url(loop.file), track, targetKey: 'loop:' + loops.indexOf(loop), start: m.t, offset: 0,
            loop: m.detail.loop && loop.duration ? [0, loop.duration] : null, stop: end, gain: automation(0, cmds, m.t) });
        });
        // Transitions : le fichier de transition de la boucle visée, par-dessus.
        all.filter(m => m.name === 'embr_transition').forEach(m => {
          const loop = loopById(m.detail.loopId);
          const tr = loop && loop.transition;
          if (!tr || !tr.file) return;
          voice({ url: url(tr.file), track, targetKey: null, start: m.t, offset: 0, stop: firstStopAfter(stops, m.t) });
        });
        return;
      }

      // -- Séquentiel : chaque bloc joue son fichier jusqu'au bout (sa queue chevauche le suivant), sauf coupure --
      if (track.mode === 'sequential') {
        const ws = buildSeqTimelineWindows(events, trackId, total);
        windows.seq[trackId] = ws;
        ws.forEach((w, i) => {
          let src = null;
          if (w.kind === 'intro') src = track.intro;
          else if (w.kind === 'outro') src = track.outro;
          else if (w.kind === 'transition') src = resolveSeqTransition(track, w.fromSlotId, w.targetId);
          else { const r = resolveSeqAlternative(track, w.slotId, w.altIndex); src = r && r.alt; }
          if (!src || !src.file) { warn('Fichier séquentiel introuvable', w); return; }
          const g = effGain(track, src);
          const next = ws[i + 1];
          const cmds = [];
          let stop = firstStopAfter(stops, w.start);
          // Coupure (embranchement pris à une frontière) : le bloc s'éteint net ou en fondu quand le suivant démarre.
          if (next && next.e.detail.cut && (stop == null || next.start < stop)) {
            const cut = next.e.detail.cut;
            cmds.push({ t: next.start, target: 0, ramp: cut.hard ? 0 : (cut.fadeSec || 0) });
            const cutEnd = next.start + (cut.hard ? 0 : (cut.fadeSec || 0)) + 0.05;
            stop = stop == null ? cutEnd : Math.min(stop, cutEnd);
          }
          const targetKey = w.kind === 'intro' ? 'intro' : w.kind === 'outro' ? 'outro' : w.kind === 'slot' ? 'slot:' + (track.segmentSlots || []).findIndex(sl => sl.id === w.slotId) : 'transition';
          voice({ url: url(src.file), track, targetKey, start: w.start, offset: w.e.detail.offset || 0, stop, gain: automation(g, cmds, w.start) });
        });
        return;
      }

      // -- Vertical-random : un tirage par pool à chaque cycle, joué jusqu'au bout ; nouveau tirage / saut : coupure nette --
      if (track.mode === 'vertical-random') {
        const ws = buildVRTimelineWindows(events, trackId, total);
        windows.vr[trackId] = ws;
        ws.forEach((w, i) => {
          let stop = firstStopAfter(stops, w.start);
          const cutAt = ws.slice(i + 1).find(n => n.e.detail.cut);
          if (cutAt && (stop == null || cutAt.start < stop)) stop = cutAt.start;
          if (w.kind === 'intro' || w.kind === 'outro') {
            const src = w.kind === 'intro' ? track.intro : track.outro;
            if (!src || !src.file) return;
            voice({ url: url(src.file), track, targetKey: w.kind, start: w.start, offset: 0, stop, gain: automation(effGain(track, src), [], w.start) });
            return;
          }
          const section = resolveVRSection(track, w.sectionIndex);
          if (!section) { warn('Section vertical-random introuvable', w); return; }
          w.picks.forEach(pick => {
            if (pick.altIndex == null || pick.altIndex < 0) return;
            const pool = (section.pools || [])[pick.poolIndex];
            const alt = pool && (pool.alternatives || [])[pick.altIndex];
            if (!alt || !alt.file) return;
            const key = 'pool-' + pick.poolIndex;
            const base = effGain(track, alt);
            const cmds = mix.times.filter(t => t > w.start).map(t => ({ t, target: base * mix.gain(key, t + 1e-6), ramp: R.voice }));
            voice({ url: url(alt.file), track, targetKey: 'pool:' + w.sectionIndex + ':' + pick.poolIndex, baseFx: (pool && pool.fx) || null, voiceKey: key,
              start: w.start, offset: w.bufferOffset || 0, stop, gain: automation(base * mix.gain(key, w.start), cmds, w.start) });
          });
        });
      }
    });

    // -- Sfx : la variation tirée, à sa place dans la salle telle que jouée ; « duck » de la musique comme le lecteur --
    const sfxHits = [];
    const master = [];
    events.filter(e => e.name === 'stinger_play').sort(byT).forEach(s => {
      const sfx = findSfx(s.detail.sfxId);
      const alt = sfx && sfx.alternatives && sfx.alternatives[s.detail.variationIndex];
      if (!alt) { warn('Sfx introuvable', s); return; }
      sfxHits.push({ t: s.t, url: sfx.base + encodeURIComponent(alt.file), sfx, track: findTrack(s.detail.trackId), durationOverride: s.detail.durationOverride || null,
        stepIndex: s.detail.spatialStep, spatial: s.detail.spatial || null });
      const duck = s.detail.duck !== undefined ? s.detail.duck : !!(sfx && sfx.duckMainTrack);
      if (duck) master.push({ t: s.t, fileDuration: s.detail.fileDuration || null, url: sfx.base + encodeURIComponent(alt.file) });
    });

    const plan = {
      total, voices, sfxHits, duckHits: master,
      headEvents: events.filter(e => e.name === 'head_turn').map(e => ({ t: e.t, yaw: e.detail.yaw })),
      sliderKeys: events.filter(e => e.name === 'fx_slider').map(e => ({ t: e.t, trackId: e.detail.trackId, sliderId: e.detail.sliderId, value: e.detail.value }))
    };
    // Triggers : boutons enregistrés + activations déduites des embranchements (au moment où le son bascule réellement)
    // et des seuils de curseurs, puis règles entre triggers -- mêmes règles que le lecteur.
    const Rn = window.LayerCaptureRender;
    const derived = [];
    Object.keys(windows.embr).forEach(id => { const t = findTrack(id); if (t) derived.push(...Rn.deriveBranchChanges(t, 'embr', windows.embr[id])); });
    Object.keys(windows.seq).forEach(id => { const t = findTrack(id); if (t) derived.push(...Rn.deriveBranchChanges(t, 'seq', windows.seq[id])); });
    trackIds.forEach(id => { const t = findTrack(id); if (t && (t.fxSliders || []).length) derived.push(...Rn.deriveSliderTriggerChanges(t, plan.sliderKeys)); });
    plan.triggerChanges = Rn.resolveTriggerChanges(Rn.fxSegmentsToChanges(events), derived, findTrack);
    return { plan, windows };
  }

  window.LayerCapturePlan = {
    SEQ_TIMELINE_EVENT_NAMES, VR_TIMELINE_EVENT_NAMES, CAPTURE_MARK_NAMES, TAIL,
    resolveSeqAlternative, resolveSeqTransition, resolveVRSection,
    buildSeqTimelineWindows, buildVRTimelineWindows, buildEmbrTimelineWindows,
    materializeLayerSegments, materializeEmbrSwitches, materializeCaptureExtras, materialize, decimateHeadTurns, decimateSliderKeys,
    linkedMarks, captureTotal, envAt, automation, mixTimeline, buildPlan
  };
})();
