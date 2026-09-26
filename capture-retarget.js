// capture-retarget.js — LayerPitch, outil vidéo, Versioning (26/09/2026) : rejouer un montage sur d'autres morceaux /
// d'autres Sfx, sans rejouer la capture.
//
// Un montage (video_captures) est la liste datée, sur le temps de la vidéo, de ce qui s'est passé (voir capture-plan.js).
// Une « version vidéo » = ce même montage + une table de remplacement (morceau X -> morceau Y, Sfx A -> Sfx B). retarget()
// traduit le journal : les GESTES restent (à tel instant on monte l'intensité, on passe au slot 3, on prend la boucle 2,
// on joue le Sfx « pas »), mais ils sont rejoués sur le nouveau morceau selon SES règles -- son tempo, la durée de ses
// slots, ses transitions, ses retours automatiques, ses fondus -- exactement comme une vraie écoute qui aurait reçu les
// mêmes clics au même moment. Le résultat passe ensuite tel quel dans buildPlan() / capture-render.js, inchangés.
//
// Étape 1 du cadrage (layerpitch-docs/2026-09-26-cadrage-variantes-video.md) : même mode, même structure (même nombre de
// couches / slots / boucles / sections et pools) ; correspondance par position. Tempo (décision Q2) : chaque bascule
// retombe sur la grille du NOUVEAU morceau, au point le plus proche de l'instant d'origine (tempo propre du slot s'il est
// réglé, grille du slot qu'on quitte, quantification du slot / de la boucle cible) ; l'option « caler sur l'image »
// (snapToImage) garde au contraire les instants exacts de la vidéo. Les formules de tempo sont celles du lecteur
// (LayerPlayerCore : seqBlockSeconds, vrSectionTiming, embrLoopTimingOf...), jamais recopiées ici.
//
// Entrée : un journal MATÉRIALISÉ (état de la frise, tel que sauvegardé). Sortie : { events, notes } -- notes = tout ce
// qui mérite d'être signalé au compositeur (élément absent du nouveau morceau, bascule décalée de plus d'une demi-seconde,
// Sfx à choisir...), jamais silencieusement ignoré.
(function () {
  const C = () => window.LayerPlayerCore;
  const P = () => window.LayerCapturePlan;
  const EPS = 1e-3;
  const DRIFT_NOTE_SEC = 0.5; // au-delà, la bascule recalée est signalée (Q2 : « avertissement si le décalage est trop grand »)
  const START_GRACE_SEC = 0.05; // un arrêt des voix juste après un démarrage est celui du redémarrage lui-même
  const num = (a, b) => a - b;
  const byT = (a, b) => a.t - b.t;
  const hasFile = x => !!(x && x.file);

  const SEQ_NAMES = ['seq_intro_start', 'seq_slot_start', 'seq_transition_start', 'seq_outro_start'];
  const VR_NAMES = ['vr_intro_start', 'vr_section_start', 'vr_outro_start'];
  const EMBR_NAMES = ['embr_loop_select', 'embr_gen', 'embr_gains', 'embr_duck', 'embr_detour_in', 'embr_detour_out', 'embr_transition'];
  const LAYER_NAMES = ['layer_run', 'layer_gen', 'intensity_change'];
  // Évènements que la traduction RECALCULE pour le nouveau morceau (les autres sont recopiés, identifiants traduits).
  const regenNames = mode => mode === 'sequential' ? SEQ_NAMES : mode === 'vertical-random' ? VR_NAMES
    : mode === 'embranchement-vertical' ? EMBR_NAMES : LAYER_NAMES;

  // ---------------------------------------------------------------------------------------------------------------
  // Compatibilité de structure (étape 1 : même mode, même nombre d'éléments, mêmes rôles)
  // ---------------------------------------------------------------------------------------------------------------
  function resolvedSlotAlts(track, slot) {
    const src = slot && slot.referencesSlotId ? (track.segmentSlots || []).find(s => s.id === slot.referencesSlotId) : slot;
    return (src && src.alternatives) || [];
  }
  function vrPools(track, idx) {
    const section = window.LayerCapturePlan.resolveVRSection(track, idx);
    return (section && section.pools) || [];
  }
  // { compatible, issues:[{ code, severity:'block'|'warn', ... }] } -- 'block' : la version vidéo ne peut pas utiliser ce
  // morceau à l'étape 1 (structure différente, prévue plus tard via l'intensité relative / les rôles) ; 'warn' : utilisable,
  // avec une différence que le compositeur doit voir.
  function compareTracks(src, dst) {
    const issues = [];
    const block = (code, extra) => issues.push(Object.assign({ code, severity: 'block' }, extra));
    const warn = (code, extra) => issues.push(Object.assign({ code, severity: 'warn' }, extra));
    if (!src || !dst) { block('missing'); return { compatible: false, issues }; }
    if (src.mode !== dst.mode) { block('mode', { from: src.mode, to: dst.mode }); return { compatible: false, issues }; }
    const count = (code, a, b) => { if (a !== b) block(code, { from: a, to: b }); };
    if (src.mode === 'vertical') count('layers', (src.layers || []).length, (dst.layers || []).length);
    if (src.mode === 'sequential') {
      const a = src.segmentSlots || [], b = dst.segmentSlots || [];
      count('slots', a.length, b.length);
      if (a.length === b.length) {
        a.forEach((sl, i) => {
          (sl.nextOptions || []).forEach(o => {
            const j = a.findIndex(x => x.id === o.targetId);
            const dSlot = b[i], dTarget = b[j];
            const dOpt = dSlot && dTarget && (dSlot.nextOptions || []).find(x => x.targetId === dTarget.id);
            if (!dOpt) warn('branch', { fromPos: i, toPos: j });
            else if (o.transition && o.transition.file && !(dOpt.transition && dOpt.transition.file)) warn('transition', { fromPos: i, toPos: j });
          });
        });
      }
      if (hasFile(src.intro) && !hasFile(dst.intro)) warn('intro');
      if (hasFile(src.outro) && !hasFile(dst.outro)) warn('outro');
    }
    if (src.mode === 'vertical-random') {
      const a = src.sections || [], b = dst.sections || [];
      count('sections', a.length, b.length);
      if (a.length === b.length) a.forEach((s, i) => { const pa = vrPools(src, i).length, pb = vrPools(dst, i).length; if (pa !== pb) block('pools', { section: i, from: pa, to: pb }); });
      if (hasFile(src.intro) && !hasFile(dst.intro)) warn('intro');
      if (hasFile(src.outro) && !hasFile(dst.outro)) warn('outro');
    }
    if (src.mode === 'embranchement-vertical') {
      const a = src.loops || [], b = dst.loops || [];
      count('loops', a.length, b.length);
      if (a.length === b.length) {
        const pa = C().embrPeerIndicesOf(src), pb = C().embrPeerIndicesOf(dst);
        const ra = C().embrReferenceIndex(src), rb = C().embrReferenceIndex(dst);
        if (ra !== rb || a.some((l, i) => (pa.indexOf(i) >= 0) !== (pb.indexOf(i) >= 0))) block('loop_roles');
      }
    }
    const fa = (src.fxTriggers || []).length, fb = (dst.fxTriggers || []).length;
    if (fa > fb) warn('fx_triggers', { from: fa, to: fb });
    const sa = (src.fxSliders || []).length, sb = (dst.fxSliders || []).length;
    if (sa > sb) warn('fx_sliders', { from: sa, to: sb });
    return { compatible: !issues.some(i => i.severity === 'block'), issues };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Correspondance automatique des Sfx (décision Q3 : proposée, le compositeur valide ou choisit lui-même)
  // ---------------------------------------------------------------------------------------------------------------
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const STOP_WORDS = ['de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'et', 'qui', 'en', 'au', 'aux', 'the', 'of', 'a', 'an', 'and', 'on', 'in', 'sfx'];
  const words = s => norm(s).split(' ').filter(w => w.length > 1 && !/^\d+$/.test(w) && STOP_WORDS.indexOf(w) < 0);
  // Deux mots se rejoignent s'ils sont égaux ou de même racine (« grince » / « grincement », « step » / « steps »).
  const sameWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.indexOf(b) === 0 || b.indexOf(a) === 0));
  // Meilleur équivalent de srcSfx parmi candidates : même étiquette d'abord (« Footsteps » -> « Footsteps »), puis titre
  // proche (mots communs). null s'il n'y a rien de convaincant -- jamais un choix au hasard.
  function suggestSfx(srcSfx, candidates) {
    if (!srcSfx) return null;
    const list = (candidates || []).filter(c => c && c.id !== srcSfx.id);
    const tag = norm(srcSfx.tag);
    if (tag) {
      const byTag = list.filter(c => norm(c.tag) === tag);
      if (byTag.length) return { sfx: byTag[0], by: 'tag' };
    }
    const sw = words(srcSfx.title);
    if (!sw.length) return null;
    let best = null, bestScore = 0;
    list.forEach(c => {
      const cw = words(c.title).concat(words(c.tag));
      if (!cw.length) return;
      const common = sw.filter(w => cw.some(c => sameWord(w, c))).length;
      const score = common / Math.min(sw.length, cw.length);
      if (score > bestScore) { best = c; bestScore = score; }
    });
    return best && bestScore >= 0.5 ? { sfx: best, by: 'title' } : null;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Écoutes : une écoute = de son démarrage au prochain arrêt des voix du morceau
  // ---------------------------------------------------------------------------------------------------------------
  function listensOf(events, trackId, names, total) {
    const own = events.filter(e => e.detail && e.detail.trackId === trackId);
    const stops = own.filter(e => e.name === 'voices_stop' && !e.detail.scope).map(e => e.t).sort(num);
    const opens = own.filter(e => e.name === 'track_play' || names.indexOf(e.name) >= 0).map(e => e.t).sort(num);
    const listens = [];
    let i = 0;
    while (i < opens.length) {
      const a = opens[i];
      const stop = stops.find(s => s > a + START_GRACE_SEC);
      const b = stop != null ? stop : total;
      listens.push({ a, b, stopped: stop != null });
      while (i < opens.length && opens[i] < b - EPS) i++;
    }
    return listens;
  }
  // Instant où l'écoute devient audible (le repère du moteur suit le clic de quelques ms).
  const audibleStart = (events, trackId, names, L) => {
    const first = events.filter(e => e.detail && e.detail.trackId === trackId && names.indexOf(e.name) >= 0 && e.t >= L.a - EPS && e.t < L.b).sort(byT)[0];
    return first ? first.t : L.a;
  };

  // ---------------------------------------------------------------------------------------------------------------
  // Vertical / statique : les segments de couche gardent leurs instants (l'intensité change sans attendre de mesure) ;
  // les repères du moteur (layer_run / layer_gen) sont recalculés avec le moteur du nouveau morceau.
  // ---------------------------------------------------------------------------------------------------------------
  function retargetLayers(ctx) {
    const { events, src, dst, total, out } = ctx;
    const listens = listensOf(events, src.id, LAYER_NAMES, total);
    const srcQ = src.loopEngine === 'quantized' ? C().quantizedLoopTiming(src) : null;
    listens.forEach(L => {
      const t0 = audibleStart(events, src.id, LAYER_NAMES, L);
      const first = events.filter(e => e.detail && e.detail.trackId === src.id && (e.name === 'layer_run' || e.name === 'layer_gen') && e.t >= L.a - EPS && e.t < L.b).sort(byT)[0];
      const level = first && first.detail.level != null ? first.detail.level : 0;
      if (dst.loopEngine === 'quantized') {
        const q = C().quantizedLoopTiming(dst);
        // Reprise en cours de morceau (moteur quantifié d'origine, position au-delà du point de départ) : même position
        // relative dans le cycle du nouveau morceau. Sinon, départ au point « Départ » du nouveau morceau.
        let offset = q.startTrackSec;
        if (first && first.name === 'layer_gen' && srcQ && first.detail.bufferOffset > srcQ.startTrackSec + EPS) {
          const rel = first.detail.bufferOffset - srcQ.loopInSec;
          offset = rel >= 0 ? q.loopInSec + (rel % q.cycleLength) : q.startTrackSec;
        } else if (first && first.name === 'layer_run' && first.detail.offset > EPS) {
          offset = q.loopInSec + (first.detail.offset % q.cycleLength);
        }
        const maxGens = dst.maxLoops || Infinity;
        let t = t0, n = 0;
        let next = offset < q.loopInSec ? q.loopOutSec - offset : q.cycleLength - ((offset - q.loopInSec) % q.cycleLength);
        while (t < L.b - EPS && n < maxGens) {
          out.push({ t, name: 'layer_gen', detail: { trackId: dst.id, bufferOffset: n === 0 ? offset : q.loopInSec, level } });
          n++;
          t += n === 1 ? Math.max(0.02, next) : q.cycleLength;
        }
      } else {
        const dur = dst.duration || 0;
        const srcOffset = first && first.name === 'layer_run' ? (first.detail.offset || 0) : 0;
        const loops = dst.mode !== 'static' || !!dst.loopable;
        out.push({ t: t0, name: 'layer_run', detail: { trackId: dst.id, offset: dur > 0 ? srcOffset % dur : 0, loop: loops && dur > 0 ? [0, dur] : null, level } });
      }
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Séquentiel : les gestes sont des ÉTAPES (rester sur tel slot jusqu'à tel instant, passer par telle transition...),
  // rejouées avec les durées du nouveau morceau. Un slot se répète à sa durée nominale tant qu'on y reste ; la bascule
  // suivante tombe sur la fin de répétition la plus proche (enchaînement naturel) ou, si c'était une coupure, sur la
  // frontière de mesure / de temps la plus proche du slot qu'on quitte (même règle que performSeqBranchCut).
  // ---------------------------------------------------------------------------------------------------------------
  function seqCutOf(slot) {
    const cutStyle = (slot && slot.cutStyle) || 'fade';
    const fadeSec = cutStyle === 'custom' ? (slot.customCutFadeSec != null ? slot.customCutFadeSec : 0.15) : 0.15;
    return { hard: cutStyle === 'hard', fadeSec: cutStyle === 'hard' ? 0 : fadeSec };
  }
  function retargetSequential(ctx) {
    const { events, src, dst, total, out, note, snapToImage } = ctx;
    const srcSlots = src.segmentSlots || [], dstSlots = dst.segmentSlots || [];
    const posOf = id => srcSlots.findIndex(s => s.id === id);
    const listens = listensOf(events, src.id, SEQ_NAMES, total);
    const allWindows = P().buildSeqTimelineWindows(events, src.id, total);
    listens.forEach(L => {
      const ws = allWindows.filter(w => w.start >= L.a - EPS && w.start < L.b - EPS);
      // Étapes : fenêtres consécutives d'un même slot fusionnées (ses répétitions), sauf coupure vers lui-même.
      const stages = [];
      ws.forEach(w => {
        const last = stages[stages.length - 1];
        const cut = w.e.detail.cut || null;
        if (last && w.kind === 'slot' && last.kind === 'slot' && last.slotId === w.slotId && !cut) { last.alts.push(w.altIndex); return; }
        stages.push({ kind: w.kind, slotId: w.slotId, fromSlotId: w.fromSlotId, targetId: w.targetId, start: w.start, cut, offset: w.e.detail.offset || 0, alts: w.kind === 'slot' ? [w.altIndex] : [] });
      });
      // Résolution dans le nouveau morceau ; une étape sans équivalent disparaît (signalée), ses voisines se rejoignent.
      // Une intro ou une transition absente cède son instant à l'étape suivante (qui part alors au début de l'écoute, ou
      // au moment de la bascule d'origine, avec sa coupure).
      const resolved = [];
      let carry = null;
      stages.forEach(st => {
        if (carry) { st.start = carry.start; st.cut = carry.cut || st.cut; carry = null; }
        if (st.kind === 'intro' || st.kind === 'outro') {
          const item = dst[st.kind];
          if (!hasFile(item)) { note('warn', st.kind + '_missing', { t: st.start }); if (st.kind === 'intro') carry = { start: st.start, cut: null }; return; }
          resolved.push(Object.assign(st, { item }));
        } else if (st.kind === 'transition') {
          const i = posOf(st.fromSlotId), j = posOf(st.targetId);
          const from = dstSlots[i], target = dstSlots[j];
          const opt = from && target && (from.nextOptions || []).find(o => o.targetId === target.id);
          if (!opt || !hasFile(opt.transition)) { note('warn', 'transition_missing', { t: st.start, fromPos: i, toPos: j }); carry = { start: st.start, cut: st.cut }; return; }
          resolved.push(Object.assign(st, { from, target, opt }));
        } else {
          const p = posOf(st.slotId);
          const slot = dstSlots[p];
          const valid = resolvedSlotAlts(dst, slot).map((a, i) => (hasFile(a) ? i : -1)).filter(i => i >= 0);
          if (!slot || !valid.length) { note('warn', 'slot_empty', { t: st.start, pos: p }); return; }
          resolved.push(Object.assign(st, { slot, valid }));
        }
      });
      let cursor = resolved.length ? resolved[0].start : L.a;
      let pendingCut = null;
      resolved.forEach((st, si) => {
        const next = resolved[si + 1];
        const T = next ? Math.min(next.start, L.b) : L.b; // instant d'origine de la bascule suivante
        const base = { trackId: dst.id };
        const push = (t, name, detail) => { if (t < L.b - EPS) out.push({ t, name, detail: Object.assign({}, base, detail) }); };
        const withCut = d => { if (pendingCut) d.cut = pendingCut; pendingCut = null; return d; };
        if (st.kind === 'outro') { push(cursor, 'seq_outro_start', withCut({})); cursor = L.b; return; }
        if (st.kind === 'intro' || st.kind === 'transition') {
          const nominal = st.kind === 'intro' ? C().seqBlockSeconds(dst, st.item.bars, dstSlots[0]) : C().seqTransitionDurationSec(dst, st.opt, st.from);
          const detail = st.kind === 'intro' ? {} : { fromSlotId: st.from.id, targetId: st.target.id };
          push(cursor, st.kind === 'intro' ? 'seq_intro_start' : 'seq_transition_start', withCut(detail));
          // Une intro / une transition ne se coupe pas dans le lecteur : la suite part à sa fin nominale -- sauf « caler
          // sur l'image », qui garde l'instant d'origine (en coupant en fondu si elle est plus courte).
          let end = cursor + nominal;
          if (snapToImage && next) { if (T < end - EPS) pendingCut = { hard: false, fadeSec: 0.15 }; end = T; }
          if (next && !snapToImage && Math.abs(end - T) > DRIFT_NOTE_SEC) note('info', 'shifted', { t: T, by: end - T });
          cursor = end;
          return;
        }
        // Slot : répétitions à sa durée nominale (une variation par répétition, dans l'ordre des tirages d'origine).
        const altAt = k => st.valid[((st.alts[k % st.alts.length] || 0) % st.valid.length + st.valid.length) % st.valid.length];
        const lenAt = k => C().seqBlockSeconds(dst, (resolvedSlotAlts(dst, st.slot)[altAt(k)] || {}).bars, st.slot);
        const reps = [cursor]; // débuts de répétition
        const repEnd = k => reps[k] + lenAt(k);
        const growTo = t => { while (repEnd(reps.length - 1) <= t + EPS) reps.push(repEnd(reps.length - 1)); };
        let end;
        if (!next) end = L.b;
        else if (snapToImage) end = T;
        else if (next.cut) {
          // Coupure : frontière de la grille du slot quitté (quantification du slot), la plus proche de T.
          const quant = st.slot.quantization || 'bar';
          if (quant === 'immediate') end = T;
          else {
            const timing = C().seqSlotTiming(dst, st.slot);
            const unit = quant === 'beat' ? timing.secondsPerBeat : timing.beatsPerBar * timing.secondsPerBeat;
            growTo(T);
            const k = Math.max(0, reps.findIndex((r, i) => T < repEnd(i) + EPS));
            // Frontière la plus proche dans la répétition en cours -- son propre début compris (fin de la répétition
            // précédente), jamais le début de l'étape elle-même.
            end = reps[k] + Math.round((T - reps[k]) / unit) * unit;
            if (end <= cursor + EPS) end = cursor + unit;
            if (end > repEnd(k) + EPS) end = repEnd(k);
          }
        } else {
          // Enchaînement naturel : la fin de répétition la plus proche de T.
          growTo(T);
          const ends = reps.map((r, i) => repEnd(i));
          end = ends.reduce((b, e) => (Math.abs(e - T) < Math.abs(b - T) ? e : b), ends[0]);
        }
        end = Math.min(end, L.b);
        growTo(end - EPS);
        reps.forEach((r, k) => { if (r < end - EPS) push(r, 'seq_slot_start', k === 0 ? withCut(Object.assign({ slotId: st.slot.id, altIndex: altAt(0) }, st.offset > 0 ? { offset: Math.min(st.offset, lenAt(0) - EPS), resumed: true } : {})) : { slotId: st.slot.id, altIndex: altAt(k) }); });
        // La suite part sur une coupure si la bascule ne tombe pas sur une fin de répétition.
        if (next) {
          const onBoundary = reps.some((r, i) => Math.abs(repEnd(i) - end) < EPS) || reps.some(r => Math.abs(r - end) < EPS);
          pendingCut = onBoundary ? null : seqCutOf(st.slot);
          if (!snapToImage && Math.abs(end - T) > DRIFT_NOTE_SEC) note('info', 'shifted', { t: T, by: end - T });
        }
        cursor = end;
      });
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Vertical-random : chaque cycle de section dure le cycle de la section du NOUVEAU morceau (premier passage : depuis
  // son point « Départ ») ; une section change toujours à la fin d'un cycle -- la fin de cycle la plus proche. Tirages
  // d'origine rejoués pool par pool (même rang de variation, ramené au nombre de variations du nouveau pool ; un pool
  // tiré « silence » le reste). Un nouveau tirage / un saut (coupure nette) garde son instant et la position courante.
  // ---------------------------------------------------------------------------------------------------------------
  function retargetVR(ctx) {
    const { events, src, dst, total, out, note, snapToImage } = ctx;
    const listens = listensOf(events, src.id, VR_NAMES, total);
    const allWindows = P().buildVRTimelineWindows(events, src.id, total);
    const firstPlayable = (() => { const i = (dst.sections || []).findIndex((s, idx) => vrPools(dst, idx).some(p => (p.alternatives || []).some(hasFile))); return i >= 0 ? P().resolveVRSection(dst, i) : null; })();
    const mapPicks = (secIdx, picks) => vrPools(dst, secIdx).map((pool, poolIndex) => {
      const pick = (picks || []).find(p => p.poolIndex === poolIndex);
      const valid = (pool.alternatives || []).map((a, i) => (hasFile(a) ? i : -1)).filter(i => i >= 0);
      if (!pick || pick.altIndex == null || pick.altIndex < 0 || !valid.length) return { poolIndex, altIndex: -1 };
      return { poolIndex, altIndex: valid[pick.altIndex % valid.length] };
    });
    listens.forEach(L => {
      const ws = allWindows.filter(w => w.start >= L.a - EPS && w.start < L.b - EPS);
      const stages = [];
      ws.forEach(w => {
        const last = stages[stages.length - 1];
        const cut = !!w.e.detail.cut;
        if (last && w.kind === 'section' && last.kind === 'section' && last.sectionIndex === w.sectionIndex && !cut) { last.picks.push(w.picks); return; }
        stages.push({ kind: w.kind, sectionIndex: w.sectionIndex, start: w.start, cut, srcOffset: w.bufferOffset || 0, picks: w.kind === 'section' ? [w.picks] : [] });
      });
      const everStarted = {};
      let cursor = stages.length ? stages[0].start : L.a;
      let cycle = null; // cycle en cours { start, offset, length }
      stages.forEach((st, si) => {
        const next = stages[si + 1];
        const T = next ? Math.min(next.start, L.b) : L.b;
        const push = (t, name, detail) => { if (t < L.b - EPS) out.push({ t, name, detail: Object.assign({ trackId: dst.id }, detail) }); };
        if (st.kind === 'intro' || st.kind === 'outro') {
          if (!hasFile(dst[st.kind])) { note('warn', st.kind + '_missing', { t: st.start }); return; }
          push(cursor, st.kind === 'intro' ? 'vr_intro_start' : 'vr_outro_start', {});
          if (st.kind === 'outro') { cursor = L.b; return; }
          const end = snapToImage && next ? T : cursor + C().vrIntroDurationSec(dst, firstPlayable);
          if (next && !snapToImage && Math.abs(end - T) > DRIFT_NOTE_SEC) note('info', 'shifted', { t: T, by: end - T });
          cursor = end; cycle = null;
          return;
        }
        const section = P().resolveVRSection(dst, st.sectionIndex);
        if (!section) { note('warn', 'section_missing', { t: st.start, section: st.sectionIndex }); return; }
        const timing = C().vrSectionTiming(section);
        // Coupure (nouveau tirage / saut) : à son instant d'origine, à la même position musicale.
        let start = cursor, firstOffset;
        if (st.forcedCut) firstOffset = everStarted[st.sectionIndex] ? timing.loopInSec : timing.startTrackSec;
        else if (st.cut && si > 0) {
          start = st.start;
          if (cycle && cycle.sectionIndex === st.sectionIndex) firstOffset = cycle.offset + (start - cycle.start);
          else {
            const srcSection = P().resolveVRSection(src, st.sectionIndex);
            const srcTiming = srcSection ? C().vrSectionTiming(srcSection) : null;
            const rel = srcTiming ? st.srcOffset - srcTiming.loopInSec : 0;
            firstOffset = rel >= 0 ? timing.loopInSec + (rel % timing.cycleLength) : timing.startTrackSec;
          }
        } else firstOffset = everStarted[st.sectionIndex] ? timing.loopInSec : timing.startTrackSec;
        everStarted[st.sectionIndex] = true;
        const cycles = [{ start, offset: firstOffset, length: timing.loopOutSec - firstOffset }];
        const lastEnd = () => { const c = cycles[cycles.length - 1]; return c.start + c.length; };
        const growTo = t => { while (lastEnd() <= t + EPS) cycles.push({ start: lastEnd(), offset: timing.loopInSec, length: timing.cycleLength }); };
        let end;
        if (!next) end = L.b;
        else if (snapToImage || next.cut) end = T;
        else {
          growTo(T);
          const ends = cycles.map(c => c.start + c.length);
          end = ends.reduce((b, e) => (Math.abs(e - T) < Math.abs(b - T) ? e : b), ends[0]);
          if (Math.abs(end - T) > DRIFT_NOTE_SEC) note('info', 'shifted', { t: T, by: end - T });
        }
        end = Math.min(end, L.b);
        growTo(end - EPS);
        cycles.forEach((c, k) => {
          if (c.start >= end - EPS) return;
          const detail = { sectionId: (dst.sections[st.sectionIndex] || {}).id || null, sectionIndex: st.sectionIndex, bufferOffset: c.offset, picks: mapPicks(st.sectionIndex, st.picks[k % st.picks.length]) };
          if (k === 0 && ((st.cut && si > 0) || st.forcedCut)) detail.cut = true;
          push(c.start, 'vr_section_start', detail);
          cycle = Object.assign({ sectionIndex: st.sectionIndex }, c);
        });
        // « Caler sur l'image » : la section suivante coupe net la précédente à l'instant d'origine.
        if (next && snapToImage && !next.cut && next.kind === 'section') next.forcedCut = !cycles.some(c => Math.abs(c.start + c.length - end) < EPS);
        cursor = end;
      });
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Embranchement-vertical : les CLICS d'origine (bascules vers une boucle) sont rejoués ; tout ce que le moteur fait de
  // lui-même -- générations des boucles jumelles, fichier de transition, baisse de la boucle quittée, retour automatique,
  // fin d'un détour -- est recalculé avec les réglages du nouveau morceau (mêmes règles que performEmbrSwitchInner). Les
  // bascules automatiques d'origine (retours) ne sont PAS rejouées : le nouveau morceau a les siennes.
  // ---------------------------------------------------------------------------------------------------------------
  function retargetEmbr(ctx) {
    const { events, src, dst, total, out, note, snapToImage, fileDuration } = ctx;
    const srcLoops = src.loops || [], loops = dst.loops || [];
    const peers = C().embrPeerIndicesOf(dst);
    const refIdx = C().embrReferenceIndex(dst);
    const fade = l => C().embrCutFadeSec(l);
    const timing = C().embrLoopTimingOf(dst);
    const own = events.filter(e => e.detail && e.detail.trackId === src.id);
    // Clé d'une bascule automatique (retour) : ses repères portent la clé de la bascule qui l'a armée (pk).
    const autoKeys = new Set(own.filter(e => e.detail.k && e.detail.pk).map(e => e.detail.k));
    const listens = listensOf(events, src.id, EMBR_NAMES, total);
    let keySeq = 0;
    listens.forEach(L => {
      const a0 = audibleStart(events, src.id, ['embr_gen'], L);
      const intents = own.filter(e => e.name === 'embr_loop_select' && e.t > a0 + EPS && e.t < L.b - EPS && !(e.detail.k && autoKeys.has(e.detail.k))).sort(byT)
        .map(e => ({ t: e.t, idx: srcLoops.findIndex(l => l.id === e.detail.loopId) })).filter(x => x.idx >= 0);
      const marks = [];
      const mark = (t, name, detail, k, pk) => { if (t < L.b - EPS) marks.push({ t, name, detail: Object.assign({ trackId: dst.id }, k ? { k } : {}, pk ? { pk } : {}, detail) }); };
      const activeChanges = [{ t: -Infinity, id: (loops[refIdx] || {}).id || null }];
      let active = refIdx, detour = null; // détour en cours { idx }
      let pending = []; // bascules automatiques à venir { t, kind:'switch'|'return'|'detourEnd', ... }
      const cancel = kind => { pending = pending.filter(p => p.kind !== kind); };
      const gains = (t, idx, k, pk) => {
        const l = loops[idx];
        mark(t, 'embr_gains', { loopId: l ? l.id : null, fadeSec: fade(l) }, k, pk);
        activeChanges.push({ t, id: l ? l.id : null });
      };
      const leaveDetour = (t, k, pk) => { if (!detour) return; mark(t, 'embr_detour_out', { loopId: loops[detour.idx].id, fadeSec: fade(loops[detour.idx]) }, k, pk); detour = null; cancel('detourEnd'); };
      const perform = (S, idx, k, pk) => {
        const l = loops[idx];
        if (!l || !hasFile(l)) { note('warn', 'loop_missing', { t: S, pos: idx }); return; }
        const isPeer = peers.indexOf(idx) >= 0;
        cancel('switch'); // une bascule encore en attente de la fin de sa transition est annulée d'abord, comme le lecteur
        if (isPeer && idx === active && !detour) return; // déjà la boucle audible : le lecteur ne fait rien de plus
        if (!isPeer && detour && detour.idx === idx) return;
        cancel('return');
        leaveDetour(S, k, pk);
        const leaving = active >= 0 ? loops[active] : null;
        let delay = 0;
        if (hasFile(l.transition)) {
          const fd = fileDuration ? fileDuration(dst, l.transition.file) : null;
          if (fd == null && !l.transition.durationUnit) note('warn', 'transition_duration_unknown', { t: S, pos: idx });
          delay = C().embrTransitionDurationSec(dst, l, leaving, fd || 0);
          mark(S, 'embr_transition', { loopId: l.id }, k, pk);
          if (leaving) mark(S, 'embr_duck', { loopId: leaving.id, fadeSec: fade(leaving) }, k, pk);
        }
        pending.push({ t: S + delay, kind: 'switch', idx, k, pk });
      };
      const execSwitch = p => {
        const l = loops[p.idx];
        if (peers.indexOf(p.idx) >= 0) {
          gains(p.t, p.idx, p.k, p.pk);
          active = p.idx;
          if (!l.isInitial && l.autoReturnEnabled) {
            const sec = C().embrDurationToSec(dst, l.autoReturnValue, l.autoReturnUnit);
            if (sec > 0) pending.push({ t: p.t + sec, kind: 'return', parent: p.k });
          }
          out.push({ t: p.t, name: 'embr_loop_select', detail: { trackId: dst.id, loopId: l.id, k: p.k } });
        } else {
          gains(p.t, -1, p.k, p.pk);
          active = -1;
          const loopsUntilButton = l.detourMode === 'loop';
          mark(p.t, 'embr_detour_in', { loopId: l.id, fadeSec: fade(l), loop: loopsUntilButton }, p.k, p.pk);
          detour = { idx: p.idx };
          if (!loopsUntilButton) pending.push({ t: p.t + C().seqBlockSeconds(dst, l.bars, l), kind: 'detourEnd', parent: p.k });
          out.push({ t: p.t, name: 'embr_loop_select', detail: { trackId: dst.id, loopId: l.id, k: p.k } });
        }
      };
      const runPendingUntil = t => {
        for (;;) {
          pending.sort(byT);
          const p = pending[0];
          if (!p || p.t > t + EPS || p.t >= L.b - EPS) return;
          pending.shift();
          if (p.kind === 'switch') execSwitch(p);
          else if (p.kind === 'return') perform(p.t, refIdx, p.parent + ':ret', p.parent); // retour direct, sans quantification
          else if (p.kind === 'detourEnd') {
            const k = p.parent + ':ret';
            mark(p.t, 'embr_detour_out', { loopId: loops[detour.idx].id, fadeSec: fade(loops[detour.idx]) }, k, p.parent);
            detour = null;
            gains(p.t, refIdx, k, p.parent);
            active = refIdx;
            out.push({ t: p.t, name: 'embr_loop_select', detail: { trackId: dst.id, loopId: loops[refIdx].id, k } });
          }
        }
      };
      intents.forEach(it => {
        const l = loops[it.idx];
        // Quantification de la boucle CIBLE sur l'horloge de la référence : la frontière la plus proche de l'instant
        // d'origine (Q2), ou l'instant d'origine lui-même (« caler sur l'image »).
        let S = it.t;
        if (!snapToImage && l && (l.switchQuantize === 'beat' || l.switchQuantize === 'bar')) {
          const after = it.t + C().embrQuantizeDelayAt(dst, l.switchQuantize, it.t - a0);
          const tt = C().trackTempo(dst);
          const unit = l.switchQuantize === 'beat' ? tt.secondsPerBeat : tt.beatsPerBar * tt.secondsPerBeat;
          const pos = (((it.t - a0) % timing.cycleLength) + timing.cycleLength) % timing.cycleLength;
          const before = Math.max(it.t - pos, after - unit); // frontière précédente, jamais avant le début du cycle
          S = (it.t - before < after - it.t && before > a0 + EPS) ? before : after;
          if (Math.abs(S - it.t) > DRIFT_NOTE_SEC) note('info', 'shifted', { t: it.t, by: S - it.t });
        }
        runPendingUntil(S - EPS);
        perform(S, it.idx, 'v' + (++keySeq));
        runPendingUntil(S); // bascule sans transition : exécutée à cet instant même
      });
      runPendingUntil(L.b);
      // Générations des boucles jumelles, du départ à la fin de l'écoute (première depuis « Départ », puis « Entrée »).
      // Boucle active juste AVANT t (une génération est programmée à l'avance, avant une bascule tombant au même instant).
      const activeAt = t => { let id = activeChanges[0].id; activeChanges.forEach(c => { if (c.t < t - EPS) id = c.id; }); return id; };
      const peerIds = peers.map(i => loops[i].id);
      for (let t = a0, n = 0; t < L.b - EPS && timing.cycleLength > 0; t += timing.cycleLength, n++) {
        out.push({ t, name: 'embr_gen', detail: { trackId: dst.id, bufferOffset: n === 0 ? timing.startSec : timing.loopInSec, active: activeAt(t), peers: peerIds } });
      }
      out.push(...marks);
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Traduction complète d'un journal
  // ---------------------------------------------------------------------------------------------------------------
  // subs = { tracks: { [idOrigine]: { to: idNouveau, snapToImage?: bool } }, sfx: { [idOrigine]: idNouveau | null } }
  // opts = { findTrack, findSfx, fileDuration(trackOuSfx, fichier) -> secondes | null }
  function retarget(events, subs, opts) {
    const findTrack = opts.findTrack, findSfx = opts.findSfx;
    const notes = [];
    const trackSubs = (subs && subs.tracks) || {}, sfxSubs = (subs && subs.sfx) || {};
    const total = P().captureTotal(events);
    const out = [];
    const handled = new Set();
    const mapTrackId = {};
    Object.keys(trackSubs).forEach(srcId => {
      const sub = trackSubs[srcId] || {};
      const src = findTrack(srcId), dst = sub.to ? findTrack(sub.to) : null;
      if (!sub.to || sub.to === srcId) return;
      // Le morceau de remplacement joue déjà ailleurs dans ce montage (et n'y est pas lui-même remplacé) : deux écoutes
      // du même morceau se mélangeraient.
      const dstInUse = events.some(e => e.detail && e.detail.trackId === sub.to) && !(trackSubs[sub.to] && trackSubs[sub.to].to && trackSubs[sub.to].to !== sub.to);
      if (dstInUse) { notes.push({ severity: 'block', code: 'target_in_use', trackId: srcId, to: sub.to }); return; }
      const cmp = compareTracks(src, dst);
      if (!cmp.compatible) { notes.push({ severity: 'block', code: 'track_incompatible', trackId: srcId, to: sub.to, issues: cmp.issues }); return; }
      cmp.issues.forEach(i => notes.push(Object.assign({ trackId: srcId, to: sub.to }, i)));
      handled.add(srcId);
      mapTrackId[srcId] = dst.id;
      const note = (severity, code, extra) => notes.push(Object.assign({ severity, code, trackId: srcId, to: dst.id }, extra));
      const ctx = { events, src, dst, total, out, note, snapToImage: !!sub.snapToImage, fileDuration: opts.fileDuration };
      if (src.mode === 'sequential') retargetSequential(ctx);
      else if (src.mode === 'vertical-random') retargetVR(ctx);
      else if (src.mode === 'embranchement-vertical') retargetEmbr(ctx);
      else retargetLayers(ctx);
    });
    // Autres évènements : recopiés, identifiants traduits (morceau, triggers et curseurs d'effet par position, cible d'un
    // clic d'embranchement), sauf ceux que la traduction a recalculés.
    const sfxCounters = {};
    events.forEach(e => {
      const d = e.detail || {};
      if (e.name === 'stinger_play') { out.push(retargetStinger(e, sfxSubs, findSfx, mapTrackId, opts.fileDuration, sfxCounters, notes)); return; }
      if (!d.trackId || !handled.has(d.trackId)) { out.push(e); return; }
      const src = findTrack(d.trackId), dst = findTrack(mapTrackId[d.trackId]);
      if (regenNames(src.mode).indexOf(e.name) >= 0) return;
      const detail = Object.assign({}, d, { trackId: dst.id });
      if (d.triggerId) {
        const i = (src.fxTriggers || []).findIndex(x => x.id === d.triggerId);
        const tr = (dst.fxTriggers || [])[i];
        if (!tr) { notes.push({ severity: 'warn', code: 'trigger_missing', trackId: src.id, to: dst.id, t: e.t, pos: i }); return; }
        detail.triggerId = tr.id;
      }
      if (d.sliderId) {
        const i = (src.fxSliders || []).findIndex(x => x.id === d.sliderId);
        const sl = (dst.fxSliders || [])[i];
        if (!sl) return; // déjà signalé par compareTracks (fx_sliders)
        detail.sliderId = sl.id;
      }
      if (e.name === 'seq_branch_select' && d.targetId) {
        const i = (src.segmentSlots || []).findIndex(s => s.id === d.targetId);
        detail.targetId = ((dst.segmentSlots || [])[i] || {}).id || d.targetId;
      }
      if (e.name === 'layer_segment' && dst.mode === 'static' && d.offset) detail.offset = dst.duration > 0 ? d.offset % dst.duration : 0;
      out.push({ t: e.t, name: e.name, detail });
    });
    return { events: out.sort(byT), notes: dedupeNotes(notes) };
  }
  // Un Sfx remplacé : la variation suit la règle de tirage du NOUVEAU Sfx (séquentiel : dans l'ordre ; sinon même rang,
  // ramené à son nombre de variations), sa place dans la salle est la sienne (réglage de salle d'origine oublié). Sans
  // remplaçant choisi, l'original reste (Q3) -- signalé.
  function retargetStinger(e, sfxSubs, findSfx, mapTrackId, fileDuration, counters, notes) {
    const d = e.detail;
    const trackId = mapTrackId[d.trackId] || d.trackId;
    if (!(d.sfxId in sfxSubs)) return trackId === d.trackId ? e : { t: e.t, name: e.name, detail: Object.assign({}, d, { trackId }) };
    const toId = sfxSubs[d.sfxId];
    if (toId === d.sfxId) return trackId === d.trackId ? e : { t: e.t, name: e.name, detail: Object.assign({}, d, { trackId }) };
    const dst = toId ? findSfx(toId) : null;
    if (!dst) {
      notes.push({ severity: 'warn', code: 'sfx_to_choose', sfxId: d.sfxId, t: e.t });
      return trackId === d.trackId ? e : { t: e.t, name: e.name, detail: Object.assign({}, d, { trackId }) };
    }
    const alts = (dst.alternatives || []).filter(a => a.file || a.localFile || a.localUrl);
    if (!alts.length) { notes.push({ severity: 'warn', code: 'sfx_empty', sfxId: d.sfxId, to: dst.id, t: e.t }); return e; }
    let idx;
    if (dst.rrMode === 'sequential') { idx = counters[dst.id] = counters[dst.id] == null ? 0 : (counters[dst.id] + 1) % alts.length; }
    else idx = (d.variationIndex || 0) % alts.length;
    const detail = Object.assign({}, d, { trackId, sfxId: dst.id, variationIndex: idx });
    delete detail.spatialStep; delete detail.spatial;
    const fd = fileDuration && alts[idx].file ? fileDuration(dst, alts[idx].file) : null;
    if (fd != null) detail.fileDuration = fd; else delete detail.fileDuration;
    return { t: e.t, name: e.name, detail };
  }
  // Une même remarque répétée (ex. une transition absente, prise dix fois) n'est listée qu'une fois, avec son nombre.
  function dedupeNotes(notes) {
    const out = [], seen = {};
    notes.forEach(n => {
      const key = [n.severity, n.code, n.trackId, n.to, n.sfxId, n.pos, n.fromPos, n.toPos, n.section].join('|');
      if (n.code === 'shifted' || !(key in seen)) { seen[key] = out.length; out.push(Object.assign({ count: 1 }, n)); }
      else out[seen[key]].count++;
    });
    return out;
  }

  window.LayerCaptureRetarget = { compareTracks, suggestSfx, retarget, listensOf };
})();
