// layerpitch-album-autotake.js — LayerPitch, « version officielle automatique » d'un morceau d'album (26/10/2026, étape 1 :
// morceaux STATIQUES et VERTICAUX). Cadrage : layerpitch-docs/2026-10-26-cadrage-version-officielle-rapide.md (approche 1).
//
// Au lieu de jouer le lecteur à la main (LayerPitchAlbumShared.openRecorder), on FABRIQUE une frise datée à partir de la
// config du morceau (couches qui entrent à intervalles réguliers, un Sfx « stinger » posé sur un temps fort, fin avec sa
// queue ou en fondu), on la traduit en voix exactes avec LayerCapturePlan.buildPlan (mêmes règles que le lecteur : rampes,
// générations, queues), puis en PRISE -- le même format que celle du journal du lecteur (getTrackTake), que
// LayerCaptureRender.playTake / renderTake rejouent déjà. Aucun second moteur de lecture.
//
//   LayerPitchAutoTake.supports(track)                 true pour les modes « static » et « vertical »
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
  const MODES = ['static', 'vertical'];
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

  function describe(track) {
    const tt = C().trackTempo(track);
    const barSec = tt.beatsPerBar * tt.secondsPerBeat;
    const quantized = isQuantized(track);
    const layers = track.mode === 'static' ? 1 : (track.layers || []).filter(l => l && l.file).length;
    const loopSec = quantized ? C().quantizedLoopTiming(track).cycleLength : (Number(track.duration) || 0);
    return { fixedDuration: !loops(track), quantized, barSec, layers, loopSec, tempoKnown: !!track.bpm };
  }

  function sfxWithFiles(sfx) { return sfx ? (sfx.alternatives || []).filter(a => a.file || a.localFile || a.localUrl) : []; }

  // Réglages de départ. 2 minutes, une couche de plus toutes les 4 mesures (resserré si le morceau a beaucoup de couches pour
  // que la dernière entre avant 60 % de la durée), le premier Sfx du morceau en stinger, 3 s de fondu en fin de morceau.
  function defaults(track, sfxList) {
    const d = describe(track);
    const sfxs = (sfxList || []).filter(s => sfxWithFiles(s).length);
    const interval = d.layers > 1 ? Math.max(d.barSec, Math.min(4 * d.barSec, 0.6 * 120 / (d.layers - 1))) : 0;
    return { duration: d.fixedDuration ? Number(track.duration) || 0 : 120, intervalSec: round3(interval), stinger: sfxs.length > 0, sfxId: sfxs[0] ? sfxs[0].id : null, fadeSec: 3, seed: 1 };
  }

  // ---- Frise ----
  function buildEvents(track, settings, sfxById) {
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

    // Stinger : un Sfx du morceau posé sur le début d'une mesure, entre 50 % et 80 % du morceau (et après la dernière entrée
    // de couche si possible) -- l'endroit exact est tiré avec la graine.
    let stingerAt = null, sfxId = null;
    const sfx = settings.stinger && settings.sfxId ? sfxById[settings.sfxId] : null;
    const alts = sfx ? sfxWithFiles(sfx) : [];
    if (sfx && alts.length) {
      const bar = d.barSec;
      const lo = Math.max(0.5 * musicEnd, layerEntries.length ? layerEntries[layerEntries.length - 1] : 0);
      const hi = Math.max(lo, 0.8 * musicEnd);
      const kLo = Math.ceil(lo / bar - 1e-9), kHi = Math.max(kLo, Math.floor(hi / bar + 1e-9));
      const k = kLo + Math.floor(R() * (kHi - kLo + 1));
      stingerAt = round3(Math.min(k * bar, Math.max(0, musicEnd - 0.5)));
      const variationIndex = Math.floor(R() * alts.length);
      sfxId = sfx.id;
      const detail = { trackId: id, sfxId: sfx.id, variationIndex, spatialStep: 0 };
      if (alts[variationIndex].duration > 0) detail.fileDuration = alts[variationIndex].duration;
      events.push({ t: stingerAt, name: 'stinger_play', detail });
    }
    info.musicEnd = musicEnd; info.stingerAt = stingerAt; info.sfxId = sfxId; info.layerEntries = layerEntries; info.segEnd = segEnd;
    events.sort((x, y) => x.t - y.t);
    return { events, info };
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
    let naturalEnd = 0;
    const voices = plan.voices.map(v => {
      const track = v.track, sliders = slidersOf(track);
      const rate = v.rate != null ? v.rate : core.fxTrackRatio(track, [], sliders, defOf(sliders));
      const base = v.baseFx != null ? v.baseFx : core.baseFxForTarget(track, v.targetKey);
      const fx = core.applyFxSliderOverrides(core.mergeTriggerFx(base, []), core.fxSliderOverrides(sliders, defOf(sliders), v.targetKey));
      const force = core.fxSliderForceKeys(sliders, v.targetKey);
      const end = v.stop != null ? v.stop : v.start + Math.max(0, (Number(track.duration) || 0) - (v.offset || 0)) / (rate || 1);
      naturalEnd = Math.max(naturalEnd, end);
      return {
        url: v.url, start: v.start, offset: v.offset || 0, dur: null, loop: v.loop || null, stop: v.stop != null ? v.stop : null,
        rate: { init: rate, auto: [] }, gain: v.gain || null,
        fx: { fx: Object.keys(fx).length ? JSON.parse(JSON.stringify(fx)) : null, force: force.slice(), comp: !!core.trackNeedsLatencyComp(track) },
        fxLog: []
      };
    });
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
    const built = buildEvents(track, settings, sfxById || {});
    // Statique en moteur quantifié : le plan gère les générations pour le mode « vertical » ; on lui présente le morceau comme
    // un vertical à une seule couche (même fichier, mêmes réglages).
    const asVertical = track.mode === 'static' && isQuantized(track);
    const planTrack = asVertical ? Object.assign({}, track, { mode: 'vertical', layers: [track.layers[0]] }) : track;
    const findTrack = id => (id === track.id ? planTrack : null);
    const findSfx = id => (sfxById || {})[id] || null;
    // `total` du plan : jusqu'au bout de la queue de la dernière génération (+ la marge de queue habituelle).
    const { plan } = P().buildPlan(built.events, { findTrack, findSfx, total: built.info.segEnd + P().TAIL });
    const fadeSec = built.info.fadeSec || 0; // fondu de sortie : moteur simple seulement (le quantifié finit par sa queue naturelle)
    const take = await planToTake(plan, {
      trackId: track.id, publishedAt: track.publishedAt, measure: opts.measure,
      fade: fadeSec > 0 ? { end: built.info.musicEnd, sec: fadeSec } : null
    });
    take.generated = { v: 1, mode: track.mode, settings: { duration: settings.duration, intervalSec: settings.intervalSec, stinger: !!settings.stinger, sfxId: settings.sfxId || null, fadeSec: settings.fadeSec, seed: settings.seed } };
    const info = Object.assign({}, built.info, { duration: take.duration });
    return { take, info };
  }

  window.LayerPitchAutoTake = { supports, defaults, describe, generate, planToTake };
})();
