// Libellé humain d'un événement capturé (calques/sfx résolus depuis window.__lpCaptureLibrary) --
// utilisé à la fois par la liste affichée dans le panneau et implicitement par l'incrustation vidéo
// de exportCaptureVideo (mêmes données sources, cohérent entre ce que le compositeur voit ici et ce qui
// finit à l'écran dans l'export).
// laneOverrides : renomme l'affichage d'un calque pour CETTE prise uniquement (ex. "Ca va, c'est cool"
// -> "Intensité basse") -- ne touche jamais au vrai `layer.label` du morceau (ça resterait le nom parlant
// pour l'AdReel), voir exportCaptureVideo qui utilise le même nom pour l'incrustation vidéo. Clé :
// `${trackId}:${levelIdx}`.
function captureLaneLabel(track, levelIdx, laneOverrides) {
  const key = track.id + ':' + levelIdx;
  const layer = track.layers[levelIdx];
  return (laneOverrides && laneOverrides[key]) || (layer && layer.label) || ('Niveau ' + levelIdx);
}

// Même principe que captureLaneLabel ci-dessus, pour une piste de boucle (mode embranchement-vertical) --
// clé `${trackId}:loop:${loopId}` pour ne jamais entrer en collision avec les clés `${trackId}:${levelIdx}`
// des calques (un morceau ne peut de toute façon pas être les deux modes à la fois, mais autant garder
// les espaces de clés distincts).
function captureLoopLaneLabel(track, loopId, laneOverrides) {
  const key = track.id + ':loop:' + loopId;
  const loop = (track.loops || []).find(l => l.id === loopId);
  return (laneOverrides && laneOverrides[key]) || (loop && loop.label) || loopId;
}

// Même principe, pour une piste d'emplacement (mode séquentiel) -- clé `${trackId}:slot:${slotId}`.
function captureSlotLaneLabel(track, slotId, laneOverrides) {
  const key = track.id + ':slot:' + slotId;
  const slot = (track.segmentSlots || []).find(s => s.id === slotId);
  return (laneOverrides && laneOverrides[key]) || (slot && slot.label) || slotId;
}

// Briques communes de la capture (capture-plan.js, 25/09) : fenêtres de la frise, résolution des fichiers,
// matérialisation d'une capture brute -- partagées avec le rendu audio pour ne jamais diverger.
const SEQ_TIMELINE_EVENT_NAMES = window.LayerCapturePlan.SEQ_TIMELINE_EVENT_NAMES;
const VR_TIMELINE_EVENT_NAMES = window.LayerCapturePlan.VR_TIMELINE_EVENT_NAMES;
const CAPTURE_MARK_NAMES = window.LayerCapturePlan.CAPTURE_MARK_NAMES;
const resolveCaptureSeqAlternative = window.LayerCapturePlan.resolveSeqAlternative;
const resolveCaptureSeqTransition = window.LayerCapturePlan.resolveSeqTransition;
const resolveCaptureVRSection = window.LayerCapturePlan.resolveVRSection;
const buildSeqTimelineWindows = window.LayerCapturePlan.buildSeqTimelineWindows;
const buildVRTimelineWindows = window.LayerCapturePlan.buildVRTimelineWindows;
function materializeCapture(events) { return window.LayerCapturePlan.materialize(events, findCaptureTrack); }

// Même principe que captureSlotLaneLabel, pour la piste d'UNE transition séquentielle précise -- clé
// `${trackId}:seqtransition:${fromSlotId}>${targetId}` pour distinguer chaque embranchement (un même
// emplacement source peut avoir plusieurs transitions vers des cibles différentes).
function captureSeqTransitionLaneLabel(track, fromSlotId, targetId, laneOverrides) {
  const key = track.id + ':seqtransition:' + fromSlotId + '>' + targetId;
  const transition = resolveCaptureSeqTransition(track, fromSlotId, targetId);
  return (laneOverrides && laneOverrides[key]) || (transition && transition.label) || 'Transition';
}

// Libellé d'une fenêtre séquentielle (voir buildSeqTimelineWindows plus bas) quel que soit son type --
// partagé entre la frise, l'export (incrustation vidéo) et describeCaptureEvent pour ne jamais diverger.
function captureSeqWindowLabel(track, w, laneOverrides) {
  if (w.kind === 'intro') return (track && track.intro && track.intro.label) || 'Intro';
  if (w.kind === 'outro') return (track && track.outro && track.outro.label) || 'Outro';
  if (w.kind === 'transition') return track ? captureSeqTransitionLaneLabel(track, w.fromSlotId, w.targetId, laneOverrides) : 'Transition';
  return track ? captureSlotLaneLabel(track, w.slotId, laneOverrides) : w.slotId;
}

function captureVRWindowLabel(track, w) {
  if (w.kind === 'intro') return (track && track.intro && track.intro.label) || 'Intro';
  if (w.kind === 'outro') return (track && track.outro && track.outro.label) || 'Outro';
  const section = track && (track.sections || [])[w.sectionIndex];
  return (section && section.label) || ('Section ' + (w.sectionIndex + 1));
}

function describeCaptureEvent(e, laneOverrides) {
  if (e.name === 'layer_segment') {
    const track = findCaptureTrack(e.detail.trackId);
    const label = track ? captureLaneLabel(track, e.detail.layerIndex, laneOverrides) : tr('captureLayerFallback').replace('{n}', e.detail.layerIndex);
    return tr('captureLayerDesc').replace('{label}', label).replace('{duration}', e.detail.duration.toFixed(2));
  }
  if (e.name === 'embr_loop_select') {
    const track = findCaptureTrack(e.detail.trackId);
    return tr('captureLoopDesc').replace('{label}', track ? captureLoopLaneLabel(track, e.detail.loopId, laneOverrides) : e.detail.loopId);
  }
  if (e.name === 'seq_slot_start') {
    const track = findCaptureTrack(e.detail.trackId);
    return tr('captureSlotDesc').replace('{label}', track ? captureSlotLaneLabel(track, e.detail.slotId, laneOverrides) : e.detail.slotId);
  }
  if (e.name === 'seq_intro_start') return 'Intro';
  if (e.name === 'seq_outro_start') return 'Outro';
  if (e.name === 'seq_transition_start') {
    const track = findCaptureTrack(e.detail.trackId);
    return tr('captureTransitionDesc').replace('{label}', track ? captureSeqTransitionLaneLabel(track, e.detail.fromSlotId, e.detail.targetId, laneOverrides) : 'Transition');
  }
  if (e.name === 'vr_intro_start') return 'Intro';
  if (e.name === 'vr_outro_start') return 'Outro';
  if (e.name === 'vr_section_start') {
    const track = findCaptureTrack(e.detail.trackId);
    return tr('captureSectionDesc').replace('{label}', captureVRWindowLabel(track, { kind: 'section', sectionIndex: e.detail.sectionIndex }));
  }
  if (e.name === 'fx_segment') {
    const track = findCaptureTrack(e.detail.trackId);
    const trg = track && (track.fxTriggers || []).find(d => d.id === e.detail.triggerId);
    return tr('captureFxSegDesc').replace('{label}', (trg && trg.label) || e.detail.triggerId).replace('{duration}', e.detail.duration.toFixed(2));
  }
  if (e.name === 'fx_cut') {
    const track = findCaptureTrack(e.detail.trackId);
    const trg = track && (track.fxTriggers || []).find(d => d.id === e.detail.triggerId);
    return tr('captureFxCutDesc').replace('{label}', (trg && trg.label) || e.detail.triggerId);
  }
  if (e.name === 'fx_slider') {
    const track = findCaptureTrack(e.detail.trackId);
    const sl = track && (track.fxSliders || []).find(d => d.id === e.detail.sliderId);
    return tr('captureSliderDesc').replace('{label}', (sl && sl.label) || e.detail.sliderId).replace('{value}', Math.round(e.detail.value * 100));
  }
  if (e.name === 'head_turn') return tr('captureHeadDesc').replace('{yaw}', Math.round(e.detail.yaw));
  if (e.name === 'stinger_play') {
    const sfx = findCaptureSfx(e.detail.sfxId);
    const base = tr('captureStingerDesc').replace('{title}', sfx ? sfx.title : e.detail.sfxId);
    return e.detail.durationOverride ? base + ' (' + e.detail.durationOverride.toFixed(2) + 's)' : base;
  }
  return e.name;
}

