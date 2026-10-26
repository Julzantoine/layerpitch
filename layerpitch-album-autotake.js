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
//   LayerPitchAutoTake.draft(track, sfxById, settings)  -> partition { mode, end, fadeSec, seed, markers, info } (voir « Partition »)
//   await LayerPitchAutoTake.compile(track, sfxById, score, { measure })
//        -> { take, info:{ duration, musicEnd, stingerAt, intervalSec, layerEntries, fadeSec, sfxId }, resolved:{ idMarqueur: instant joué | null } }
//        measure(url) -> durée en secondes d'un fichier (pour le « duck » de la musique sous un Sfx qui le demande)
//   await LayerPitchAutoTake.generate(track, sfxById, settings, { measure })   draft puis compile ; renvoie aussi `score`
//   LayerPitchAutoTake.grid(track)                     { beatSec, barSec } (aimant de la timeline)
//   LayerPitchAutoTake.planToTake(plan, opts)          (exposé pour les tests)
//
// Le hasard (position du stinger, variation tirée, ordre brassé) est fixé par la graine : une prise générée est stable,
// « Régénérer » change la graine. La timeline de l'éditeur (layerpitch-album-timeline.js, 26/10) retouche la partition et
// recompile : ce qu'on voit est ce qu'on entend.
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

  // ---- Partition (26/10, Jules-Antoine : « bascule n°1 de… vers… au bout de… secondes », marqueurs déplaçables) ----
  // Une version = une PARTITION : la durée visée et des marqueurs datés, que la timeline de l'éditeur affiche et qu'on
  // retouche à la main.
  //   { kind: 'layers',  t, on: [indices des couches actives] }   statique / vertical (bascule verticale)
  //   { kind: 'slot',    t, slotId }                              séquentiel (bascule horizontale vers un emplacement)
  //   { kind: 'section', t, sectionIndex }                        vertical-aléatoire
  //   { kind: 'loop',    t, loopId }                              embranchement-vertical
  //   { kind: 'stinger', t, sfxId, variationIndex }
  // Le premier marqueur de bascule (le départ) est `fixed` : il ne bouge pas. draft() fabrique une partition depuis les
  // réglages ; compile() la traduit en frise puis en prise. Une bascule horizontale se cale sur la fin de bloc / de cycle la
  // plus proche (jamais de coupure) : `resolved[id]` donne l'instant réellement joué (null : marqueur après la fin).
  const SWITCH_KINDS = ['layers', 'slot', 'section', 'loop'];
  const SWITCH_KIND_OF = { static: 'layers', vertical: 'layers', sequential: 'slot', 'vertical-random': 'section', 'embranchement-vertical': 'loop' };
  const byT = (a, b) => a.t - b.t;
  let idSeq = 0;
  const newId = () => 'm' + (++idSeq).toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const mk = o => Object.assign({ id: newId() }, o);
  // Bascules triées ; le départ (marqueur `fixed`, sinon le plus tôt) en tête.
  function switchesOf(score) {
    const kind = SWITCH_KIND_OF[score.mode];
    const list = (score.markers || []).filter(m => m.kind === kind).sort(byT);
    const start = list.find(m => m.fixed) || list[0];
    return start ? [start].concat(list.filter(m => m !== start)) : [];
  }
  const fileLayers = track => (track.mode === 'static' ? [0] : (track.layers || []).map((l, i) => (l && l.file ? i : -1)).filter(i => i >= 0));

  // Stinger : un Sfx du morceau posé sur le début d'une mesure, entre 50 % et 80 % du morceau (après `after` si possible) --
  // l'endroit exact et la variation sont tirés avec la graine.
  function draftStinger(track, settings, sfxById, R, musicEnd, after) {
    const sfx = settings.stinger && settings.sfxId ? sfxById[settings.sfxId] : null;
    const alts = sfx ? sfxWithFiles(sfx) : [];
    if (!sfx || !alts.length) return null;
    const bar = describe(track).barSec;
    const lo = Math.max(0.5 * musicEnd, after || 0);
    const hi = Math.max(lo, 0.8 * musicEnd);
    const kLo = Math.ceil(lo / bar - 1e-9), kHi = Math.max(kLo, Math.floor(hi / bar + 1e-9));
    const k = kLo + Math.floor(R() * (kHi - kLo + 1));
    const at = round3(Math.min(k * bar, Math.max(0, musicEnd - 0.5)));
    return mk({ kind: 'stinger', t: at, sfxId: sfx.id, variationIndex: Math.floor(R() * alts.length) });
  }
  function stingerEvents(track, score, sfxById, limit, events, info, resolved) {
    info.stingerAt = null; info.sfxId = null;
    (score.markers || []).filter(m => m.kind === 'stinger').sort(byT).forEach(m => {
      const sfx = sfxById[m.sfxId], alts = sfxWithFiles(sfx);
      if (!alts.length || !(m.t >= 0) || m.t > limit) { resolved[m.id] = null; return; }
      const variationIndex = Math.max(0, Math.min(alts.length - 1, m.variationIndex | 0));
      const detail = { trackId: track.id, sfxId: sfx.id, variationIndex, spatialStep: 0 };
      if (alts[variationIndex].duration > 0) detail.fileDuration = alts[variationIndex].duration;
      events.push({ t: round3(m.t), name: 'stinger_play', detail });
      resolved[m.id] = round3(m.t);
      if (info.stingerAt == null) { info.stingerAt = round3(m.t); info.sfxId = sfx.id; }
    });
  }

  // ---- Statique / vertical ----
  // Fin du morceau pour une durée visée E : fichier joué une fois (durée imposée), générations du moteur quantifié (la
  // dernière joue jusqu'au bout du fichier, sa queue sonne seule), ou nombre entier de tours du moteur simple.
  function layerSpan(track, E) {
    const d = describe(track), dur = Number(track.duration) || 0;
    if (d.fixedDuration) return { engine: 'fixed', musicEnd: dur, segEnd: dur };
    if (d.quantized) {
      const qt = C().quantizedLoopTiming(track);
      const first = Math.max(0.01, qt.loopOutSec - qt.startTrackSec);
      const n = Math.max(1, 1 + Math.round((E - first) / qt.cycleLength));
      const lastStart = n > 1 ? first + (n - 2) * qt.cycleLength : 0;
      return { engine: 'quant', qt, first, n, musicEnd: n > 1 ? lastStart + qt.cycleLength : first, segEnd: lastStart + Math.max(0.01, dur - (n > 1 ? qt.loopInSec : qt.startTrackSec)) };
    }
    const turns = dur > 0 ? Math.max(1, Math.round(E / dur)) : 1;
    const m = turns * (dur || E);
    return { engine: 'simple', musicEnd: m, segEnd: m };
  }
  // Réglages -> une couche de plus toutes les `intervalSec` (calé sur la mesure), chacune reste jusqu'à la fin.
  function draftLayers(track, settings, sfxById, R) {
    const d = describe(track), avail = fileLayers(track);
    const end = d.fixedDuration ? Number(track.duration) || 0 : Math.max(1, Number(settings.duration) || 0);
    const sp = layerSpan(track, end);
    const markers = [mk({ kind: 'layers', t: 0, on: avail.slice(0, 1), fixed: true })];
    let interval = 0;
    if (!d.fixedDuration && track.mode === 'vertical' && avail.length > 1) {
      const bar = d.barSec;
      interval = Math.max(bar, Math.round((Number(settings.intervalSec) || bar) / bar) * bar);
      for (let i = 1; i < avail.length; i++) {
        const a = round3(i * interval);
        if (a >= sp.musicEnd - 1e-6) break; // une couche qui entrerait après la fin n'entre pas
        markers.push(mk({ kind: 'layers', t: a, on: avail.slice(0, i + 1) }));
      }
    }
    const st = draftStinger(track, settings, sfxById, R, sp.musicEnd, markers[markers.length - 1].t);
    if (st) markers.push(st);
    return { end, markers, info: { intervalSec: interval } };
  }
  function compileLayers(track, score, sfxById) {
    const id = track.id, d = describe(track);
    const E = d.fixedDuration ? Number(track.duration) || 0 : Math.max(1, Number(score.end) || 0);
    const sp = layerSpan(track, E);
    const events = [], info = { fadeSec: 0 }, resolved = {};
    if (sp.engine === 'fixed') events.push({ t: 0, name: 'layer_segment', detail: { trackId: id, layerIndex: 0, duration: sp.musicEnd, offset: 0 } });
    else if (sp.engine === 'quant') {
      const qt = sp.qt;
      events.push({ t: 0, name: 'layer_gen', detail: { trackId: id, bufferOffset: qt.startTrackSec, level: 0 } });
      for (let k = 1; k < sp.n; k++) events.push({ t: round3(sp.first + (k - 1) * qt.cycleLength), name: 'layer_gen', detail: { trackId: id, bufferOffset: qt.loopInSec, level: 0 } });
    } else {
      // Moteur simple : chaque couche boucle nativement ; fin en fondu.
      events.push({ t: 0, name: 'layer_run', detail: { trackId: id, offset: 0, loop: [0, Number(track.duration) || 0], level: 0 } });
      events.push({ t: sp.musicEnd, name: 'voices_stop', detail: { trackId: id } });
      info.fadeSec = Math.max(0, Math.min(Number(score.fadeSec) || 0, sp.musicEnd / 2));
    }
    // Couches : une plage continue par couche active (layer_segment), d'un marqueur qui l'allume à celui qui l'éteint.
    const sw = switchesOf(score), states = [];
    sw.forEach((m, k) => {
      const t = k === 0 ? 0 : round3(Math.max(0, m.t));
      if (k > 0 && t >= sp.musicEnd - 1e-6) { resolved[m.id] = null; return; }
      resolved[m.id] = t;
      states.push({ t, on: track.mode === 'static' ? [0] : (m.on || []) });
    });
    if (!states.length) states.push({ t: 0, on: fileLayers(track).slice(0, 1) });
    if (sp.engine !== 'fixed') {
      fileLayers(track).forEach(i => {
        let from = null;
        states.forEach(s => {
          const on = s.on.indexOf(i) >= 0;
          if (on && from == null) from = s.t;
          else if (!on && from != null) { if (s.t > from) events.push({ t: from, name: 'layer_segment', detail: { trackId: id, layerIndex: i, duration: round3(s.t - from), offset: 0 } }); from = null; }
        });
        if (from != null) events.push({ t: from, name: 'layer_segment', detail: { trackId: id, layerIndex: i, duration: round3(sp.segEnd - from), offset: 0 } });
      });
    }
    stingerEvents(track, score, sfxById, sp.musicEnd, events, info, resolved);
    Object.assign(info, { musicEnd: sp.musicEnd, segEnd: sp.segEnd, layerEntries: states.map(s => s.t) });
    return { events: events.sort(byT), info, resolved };
  }

  // ---- Séquentiel ----
  // Réglages -> intro, puis les emplacements dans l'ordre de la chaîne (ou brassés si le morceau le demande) : un emplacement
  // sans embranchement joue son nombre de répétitions, un emplacement à embranchements reste `intervalSec` puis prend une de ses
  // sorties (on tourne sur les sorties pour tout faire entendre) ; à la durée visée, la fin.
  const nominalSlotSec = (track, slot) => { const a0 = slotAlts(track, slot).find(hasFile); return C().seqBlockSeconds(track, a0 && a0.bars, slot); };
  function draftSeq(track, settings, sfxById, R) {
    const slots = track.segmentSlots || [], markers = [];
    const D = Math.max(1, Number(settings.duration) || 0);
    const playable = slots.map((sl, i) => (slotAlts(track, sl).some(hasFile) ? i : -1)).filter(i => i >= 0);
    if (!playable.length) throw new Error('aucun emplacement jouable');
    const shuffled = () => { const o = playable.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = o[i]; o[i] = o[j]; o[j] = t; } return o; };
    let order = track.randomizeSections ? shuffled() : playable.slice();
    let pos = 0, t = 0, cycles = 0, cur = order[0], guard = 0;
    const used = {};
    if (hasFile(track.intro)) t += C().seqIntroSeconds(track, slots[cur]);
    markers.push(mk({ kind: 'slot', t: round3(t), slotId: slots[cur].id, fixed: true }));
    while (t < D && guard++ < 400) {
      const slot = slots[cur];
      const branching = (slot.nextOptions || []).length > 0;
      const nom = nominalSlotSec(track, slot);
      t += nom * (branching ? Math.max(1, Math.round((Number(settings.intervalSec) || 0) / nom)) : Math.max(1, slot.repeatCount || 1));
      if (t >= D) break;
      let next = -1, opt = null;
      if (branching) {
        const opts = slot.nextOptions.filter(o => { const ti = slots.findIndex(x => x.id === o.targetId); return ti >= 0 && playable.indexOf(ti) >= 0; });
        if (opts.length) {
          // l'option la moins empruntée d'abord (tirage à égalité) : toutes les sorties finissent par s'entendre
          const min = Math.min(...opts.map(o => used[slot.id + '>' + o.targetId] || 0));
          const cands = opts.filter(o => (used[slot.id + '>' + o.targetId] || 0) === min);
          opt = cands[Math.floor(R() * cands.length)];
          used[slot.id + '>' + opt.targetId] = min + 1;
          next = slots.findIndex(x => x.id === opt.targetId);
          pos = Math.max(0, order.indexOf(next));
        }
      }
      if (next < 0) {
        pos++;
        if (pos >= order.length) { pos = 0; cycles++; if (track.maxChainLoops && cycles >= track.maxChainLoops) break; if (track.randomizeSections) order = shuffled(); }
        next = order[pos];
      }
      if (opt || next !== cur) markers.push(mk({ kind: 'slot', t: round3(t), slotId: slots[next].id }));
      if (opt && hasFile(opt.transition)) t += C().seqTransitionDurationSec(track, opt, slot) || 0;
      cur = next;
    }
    const st = draftStinger(track, settings, sfxById, R, t, 0);
    if (st) markers.push(st);
    return { end: round3(t), markers, info: { intervalSec: Number(settings.intervalSec) || 0 } };
  }
  // Partition -> blocs : l'emplacement courant répète ses blocs jusqu'à la fin de bloc la plus proche de la bascule suivante
  // (au moins un bloc), puis la transition prévue entre les deux emplacements (s'il y en a une), etc. ; l'outro à la fin.
  function compileSeq(track, score, sfxById, R) {
    const id = track.id, slots = track.segmentSlots || [], events = [], resolved = {};
    const idxOf = sid => slots.findIndex(x => x.id === sid);
    const playable = i => i >= 0 && slotAlts(track, slots[i]).some(hasFile);
    let sw = switchesOf(score).filter(m => { const ok = playable(idxOf(m.slotId)); if (!ok) resolved[m.id] = null; return ok; });
    if (!sw.length) {
      const first = slots.findIndex((sl, i) => playable(i));
      if (first < 0) throw new Error('aucun emplacement jouable');
      sw = [{ id: null, t: 0, slotId: slots[first].id }];
    }
    let t = 0, last = null, guard = 0, cur = idxOf(sw[0].slotId);
    if (hasFile(track.intro)) { events.push({ t: 0, name: 'seq_intro_start', detail: { trackId: id } }); t += C().seqIntroSeconds(track, slots[cur]); }
    if (sw[0].id) resolved[sw[0].id] = round3(t);
    const pickAlt = slot => {
      const valid = slotAlts(track, slot).map((a, i) => (hasFile(a) ? i : -1)).filter(i => i >= 0);
      let k = valid[Math.floor(R() * valid.length)];
      if (slot.avoidImmediateRepeat && valid.length > 1) while (k === last) k = valid[Math.floor(R() * valid.length)];
      last = k;
      return k;
    };
    const playUntil = T => {
      const slot = slots[cur], half = nominalSlotSec(track, slot) / 2;
      do {
        const altIndex = pickAlt(slot), alt = slotAlts(track, slot)[altIndex];
        events.push({ t: round3(t), name: 'seq_slot_start', detail: { trackId: id, slotId: slot.id, altIndex } });
        t += C().seqBlockSeconds(track, alt && alt.bars, slot);
      } while (t + half < T - 1e-6 && guard++ < 2000);
    };
    for (let k = 1; k < sw.length; k++) {
      const m = sw[k], slot = slots[cur];
      playUntil(m.t);
      resolved[m.id] = round3(t);
      const opt = (slot.nextOptions || []).find(o => o.targetId === m.slotId);
      if (opt && hasFile(opt.transition)) {
        events.push({ t: round3(t), name: 'seq_transition_start', detail: { trackId: id, fromSlotId: slot.id, targetId: m.slotId } });
        t += C().seqTransitionDurationSec(track, opt, slot) || 0;
      }
      cur = idxOf(m.slotId);
    }
    playUntil(Number(score.end) || 0);
    const musicEnd = round3(t);
    if (hasFile(track.outro)) events.push({ t: musicEnd, name: 'seq_outro_start', detail: { trackId: id } });
    const info = { musicEnd, segEnd: musicEnd + 60, fadeSec: 0 };
    stingerEvents(track, score, sfxById, musicEnd, events, info, resolved);
    return { events: events.sort(byT), info, resolved };
  }

  // ---- Vertical-aléatoire ----
  // Réglages -> intro, puis les sections dans l'ordre (ou brassées) : chaque section fait `maxLoops` cycles (ou, à défaut, le
  // rythme choisi) ; à la durée visée, la fin. Le premier cycle d'une section part de son point de départ (plus long ou plus
  // court que les suivants, qui partent de l'entrée de boucle).
  function vrCycleSec(track, idx, started) { const tm = C().vrSectionTiming(P().resolveVRSection(track, idx)); return started ? tm.cycleLength : tm.loopOutSec - tm.startTrackSec; }
  function draftVr(track, settings, sfxById, R) {
    const D = Math.max(1, Number(settings.duration) || 0), markers = [];
    const playable = playableSections(track);
    if (!playable.length) throw new Error('aucune section jouable');
    const shuffled = () => { const o = playable.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = o[i]; o[i] = o[j]; o[j] = t; } return o; };
    let order = track.randomizeSections ? shuffled() : playable.slice();
    let t = 0, pos = 0, cycles = 0, guard = 0;
    const started = {};
    if (hasFile(track.intro)) t += C().vrIntroDurationSec(track, P().resolveVRSection(track, order[0]));
    markers.push(mk({ kind: 'section', t: round3(t), sectionIndex: order[0], fixed: true }));
    while (t < D && guard++ < 400) {
      const secIdx = order[pos], section = P().resolveVRSection(track, secIdx), timing = C().vrSectionTiming(section);
      const n = section.maxLoops ? section.maxLoops : Math.max(1, Math.round((Number(settings.intervalSec) || 0) / timing.cycleLength));
      for (let k = 0; k < n; k++) { t += vrCycleSec(track, secIdx, started[secIdx]); started[secIdx] = true; }
      pos++;
      if (pos >= order.length) { pos = 0; cycles++; if (track.maxChainLoops && cycles >= track.maxChainLoops) break; if (track.randomizeSections) order = shuffled(); }
      if (t >= D) break;
      if (order[pos] !== secIdx) markers.push(mk({ kind: 'section', t: round3(t), sectionIndex: order[pos] }));
    }
    const st = draftStinger(track, settings, sfxById, R, t, 0);
    if (st) markers.push(st);
    return { end: round3(t), markers, info: { intervalSec: Number(settings.intervalSec) || 0 } };
  }
  function compileVr(track, score, sfxById, R) {
    const id = track.id, events = [], resolved = {};
    const ok = i => playableSections(track).indexOf(i) >= 0;
    let sw = switchesOf(score).filter(m => { const good = ok(m.sectionIndex); if (!good) resolved[m.id] = null; return good; });
    if (!sw.length) {
      const first = playableSections(track)[0];
      if (first == null) throw new Error('aucune section jouable');
      sw = [{ id: null, t: 0, sectionIndex: first }];
    }
    const started = {}, lastPick = {};
    let t = 0, guard = 0, cur = sw[0].sectionIndex;
    if (hasFile(track.intro)) { events.push({ t: 0, name: 'vr_intro_start', detail: { trackId: id } }); t += C().vrIntroDurationSec(track, P().resolveVRSection(track, cur)); }
    if (sw[0].id) resolved[sw[0].id] = round3(t);
    const playUntil = T => {
      do {
        const section = P().resolveVRSection(track, cur), timing = C().vrSectionTiming(section);
        const first = !started[cur];
        started[cur] = true;
        const picks = (section.pools || []).map((pool, poolIndex) => {
          const alts = pool.alternatives || [];
          if (!alts.length) return { poolIndex, altIndex: -1 };
          let idx = Math.floor(R() * alts.length);
          const key = cur + ':' + poolIndex;
          if (pool.avoidImmediateRepeat && alts.length > 1) while (idx === lastPick[key]) idx = Math.floor(R() * alts.length);
          lastPick[key] = idx;
          return { poolIndex, altIndex: idx };
        });
        events.push({ t: round3(t), name: 'vr_section_start', detail: { trackId: id, sectionId: (track.sections[cur] || {}).id || null, sectionIndex: cur, bufferOffset: first ? timing.startTrackSec : timing.loopInSec, picks } });
        t += first ? timing.loopOutSec - timing.startTrackSec : timing.cycleLength;
      } while (t + vrCycleSec(track, cur, true) / 2 < T - 1e-6 && guard++ < 2000);
    };
    for (let k = 1; k < sw.length; k++) {
      playUntil(sw[k].t);
      resolved[sw[k].id] = round3(t);
      cur = sw[k].sectionIndex;
    }
    playUntil(Number(score.end) || 0);
    const musicEnd = round3(t);
    if (hasFile(track.outro)) events.push({ t: musicEnd, name: 'vr_outro_start', detail: { trackId: id } });
    const info = { musicEnd, segEnd: musicEnd + 60, fadeSec: 0 };
    stingerEvents(track, score, sfxById, musicEnd, events, info, resolved);
    return { events: events.sort(byT), info, resolved };
  }

  // ---- Embranchement-vertical ----
  // Réglages -> départ sur la boucle de référence ; toutes les `intervalSec` (calées sur le cycle) bascule sur la boucle
  // suivante de la liste -- boucles jumelles d'abord, détours ensuite -- puis retour à la référence. Le MOTEUR de
  // l'embranchement (quantification de la bascule, fichier de transition, baisse de la boucle quittée, retour automatique,
  // fin d'un détour) est celui du lecteur, via LayerCaptureRetarget.replayEmbrGestures. Fin en fondu sur le gain maître.
  const embrCycle = track => C().embrLoopTimingOf(track).cycleLength || describe(track).barSec * 4;
  const embrEnd = (track, end) => { const cycle = embrCycle(track); return Math.max(cycle, Math.round(Math.max(1, Number(end) || 0) / cycle) * cycle); };
  function draftEmbr(track, settings, sfxById, R) {
    const loopsList = track.loops || [], cycle = embrCycle(track);
    const stay = Math.max(1, Math.round((Number(settings.intervalSec) || 0) / cycle)) * cycle;
    const D = embrEnd(track, settings.duration);
    const ref = C().embrReferenceIndex(track), peers = C().embrPeerIndicesOf(track);
    const withFile = i => hasFile(loopsList[i]);
    const queue = peers.filter(i => i !== ref && withFile(i)).concat(loopsList.map((l, i) => i).filter(i => peers.indexOf(i) < 0 && withFile(i)));
    if (queue.length) queue.push(ref);
    const markers = [mk({ kind: 'loop', t: 0, loopId: (loopsList[ref] || {}).id, fixed: true })];
    queue.forEach((i, k) => { const t = round3((k + 1) * stay); if (t < D - cycle) markers.push(mk({ kind: 'loop', t, loopId: loopsList[i].id })); });
    const st = draftStinger(track, settings, sfxById, R, D, 0);
    if (st) markers.push(st);
    return { end: D, markers, info: { intervalSec: Number(settings.intervalSec) || 0 } };
  }
  async function compileEmbr(track, score, sfxById, opts) {
    const id = track.id, loopsList = track.loops || [], resolved = {};
    const D = embrEnd(track, score.end);
    // Durée des fichiers de transition (réglée « durée du fichier » : il faut la mesurer pour savoir quand la bascule arrive).
    const fd = {};
    for (const l of loopsList) { if (hasFile(l.transition) && !l.transition.durationUnit && opts.measure) fd[l.transition.file] = await opts.measure(track.base + encodeURIComponent(l.transition.file) + (track.publishedAt ? '?v=' + encodeURIComponent(track.publishedAt) : '')); }
    const gestures = [{ t: 0, name: 'track_play', detail: { trackId: id } }];
    switchesOf(score).forEach((m, k) => {
      if (k === 0) { resolved[m.id] = 0; return; } // départ : toujours la boucle de référence (règle du lecteur)
      const ok = m.t > 0 && m.t < D && loopsList.some(l => l.id === m.loopId && hasFile(l));
      resolved[m.id] = ok ? round3(m.t) : null;
      if (!ok) return;
      // Bascule sans transition posée pile sur un début de génération : 10 ms plus tard, sinon la génération qui démarre à
      // cet instant garderait l'ancienne boucle jusqu'au cycle suivant (le changement de volume doit tomber DANS la génération).
      const loop = loopsList.find(l => l.id === m.loopId), cycle = embrCycle(track);
      const onEdge = cycle > 0 && Math.abs(m.t / cycle - Math.round(m.t / cycle)) * cycle < 1e-3;
      const nudge = !hasFile(loop.transition) && onEdge ? 0.01 : 0;
      gestures.push({ t: round3(m.t + nudge), name: 'embr_loop_select', detail: { trackId: id, loopId: m.loopId }, mid: m.id, nudge });
    });
    gestures.push({ t: D, name: 'voices_stop', detail: { trackId: id } });
    const replay = window.LayerCaptureRetarget.replayEmbrGestures(gestures, track, { fileDuration: (t, file) => (file in fd ? fd[file] : null) });
    const events = [{ t: 0, name: 'track_play', detail: { trackId: id } }].concat(replay.events, [{ t: D, name: 'voices_stop', detail: { trackId: id } }]);
    // Instant réellement joué de chaque bascule : la bascule du moteur vers la même boucle, au plus tôt après le geste.
    const played = replay.events.filter(e => e.name === 'embr_loop_select');
    gestures.filter(gs => gs.mid).forEach(gs => {
      const i = played.findIndex(e => e.detail.loopId === gs.detail.loopId && e.t >= gs.t - 1e-6);
      resolved[gs.mid] = i >= 0 ? round3(played.splice(i, 1)[0].t - gs.nudge) : null;
    });
    const info = { musicEnd: D, segEnd: D + 60, fadeSec: Math.max(0, Math.min(Number(score.fadeSec) || 0, D / 2)) };
    stingerEvents(track, score, sfxById, D, events, info, resolved);
    info.switches = events.filter(e => e.name === 'embr_loop_select').length;
    return { events: events.sort(byT), info, resolved };
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

  // Réglages -> partition (rien n'est joué ni mesuré).
  function draft(track, sfxById, settings) {
    if (!supports(track)) throw new Error('mode non géré : ' + track.mode);
    const R = rng(settings.seed);
    const f = track.mode === 'sequential' ? draftSeq : track.mode === 'vertical-random' ? draftVr : track.mode === 'embranchement-vertical' ? draftEmbr : draftLayers;
    const d = f(track, settings, sfxById || {}, R);
    return { v: 1, mode: track.mode, end: d.end, fadeSec: Number(settings.fadeSec) || 0, seed: settings.seed, markers: d.markers, info: d.info };
  }

  // Partition -> prise. Renvoie aussi `resolved` (instant réellement joué de chaque marqueur) pour la timeline.
  async function compile(track, sfxById, score, opts) {
    if (!supports(track)) throw new Error('mode non géré : ' + track.mode);
    opts = opts || {};
    sfxById = sfxById || {};
    const R = rng(score.seed);
    let built;
    if (track.mode === 'sequential') built = compileSeq(track, score, sfxById, R);
    else if (track.mode === 'vertical-random') built = compileVr(track, score, sfxById, R);
    else if (track.mode === 'embranchement-vertical') built = await compileEmbr(track, score, sfxById, opts);
    else built = compileLayers(track, score, sfxById);
    // Statique en moteur quantifié : le plan gère les générations pour le mode « vertical » ; on lui présente le morceau comme
    // un vertical à une seule couche (même fichier, mêmes réglages).
    const asVertical = track.mode === 'static' && isQuantized(track);
    const planTrack = asVertical ? Object.assign({}, track, { mode: 'vertical', layers: [track.layers[0]] }) : track;
    const findTrack = id => (id === track.id ? planTrack : null);
    const findSfx = id => sfxById[id] || null;
    // `total` du plan : jusqu'au bout de la queue de la dernière génération (+ la marge de queue habituelle).
    const { plan } = P().buildPlan(built.events, { findTrack, findSfx, total: built.info.segEnd + P().TAIL });
    const fadeSec = built.info.fadeSec || 0; // fondu de sortie : moteur simple et embranchement (les autres finissent par leur queue naturelle)
    const layerMode = track.mode === 'static' || track.mode === 'vertical';
    const take = await planToTake(plan, {
      trackId: track.id, publishedAt: track.publishedAt, measure: opts.measure, fileEnds: !layerMode,
      fade: fadeSec > 0 ? { end: built.info.musicEnd, sec: fadeSec } : null
    });
    const clean = { v: 1, mode: score.mode, end: score.end, fadeSec: score.fadeSec, seed: score.seed, markers: (score.markers || []).map(m => Object.assign({}, m)) };
    take.generated = Object.assign({ v: 2, mode: track.mode, score: clean }, opts.settings ? { settings: opts.settings } : {});
    const info = Object.assign({}, score.info || {}, built.info, { duration: take.duration });
    return { take, info, resolved: built.resolved, events: built.events };
  }

  async function generate(track, sfxById, settings, opts) {
    const score = draft(track, sfxById, settings);
    const settingsCopy = { duration: settings.duration, intervalSec: settings.intervalSec, stinger: !!settings.stinger, sfxId: settings.sfxId || null, fadeSec: settings.fadeSec, seed: settings.seed };
    const res = await compile(track, sfxById, score, Object.assign({}, opts, { settings: settingsCopy }));
    return Object.assign(res, { score });
  }

  // Grille de la timeline (aimant) : un temps, une mesure.
  function grid(track) { const tt = C().trackTempo(track); return { beatSec: tt.secondsPerBeat, barSec: tt.beatsPerBar * tt.secondsPerBeat }; }

  window.LayerPitchAutoTake = { supports, defaults, describe, draft, compile, generate, grid, planToTake, SWITCH_KIND_OF, fileLayers };
})();
