/* ---------------- État partagé entre toutes les pistes de la page (une seule instance par page chargée) ---------------- */
const trackCollapsers = {};
const trackStingerKillers = {};
let activeTrackId = null;

/* ---------------- Constantes de volume partagées avec le rendu hors-ligne (outil vidéo, 25/09) ----------------
 * Le rendu d'une capture reproduit les mêmes rampes que le lecteur : elles vivent ici, une seule fois. */
// Ducking : abaisse brièvement le gain maître du morceau pendant qu'un Sfx réglé pour ça est en train de jouer, puis
// remonte. Baisse plafonnée à 30 % (DUCK_LEVEL = 0.7) : descente rapide et nette, remontée qui démarre dès la moitié
// du Sfx et s'étale sur une rampe longue.
const DUCK_ATTACK_SEC = 0.08;
const DUCK_RELEASE_SEC = 1.2;
const DUCK_LEVEL = 0.7;
const INTENSITY_RAMP_SEC = 1.4; // changement d'intensité (mode vertical)
const VOICE_RAMP_SEC = 0.15; // muet / solo / volume d'une voix
// Départ d'un moteur (lecture, reprise, saut, nouveau tirage) : TOUTES ses voix sont programmées sur un même instant, un
// peu après l'appui (25/09). Lancées « maintenant » une par une, elles partaient en fait décalées de quelques ms entre
// elles (le temps de préparer les suivantes, l'horloge audio avançait : léger flou rythmique au démarrage).
const ENGINE_START_LEAD_SEC = 0.03;
function startSoon() { return ctx.currentTime + ENGINE_START_LEAD_SEC; }
const SFX_START_LEAD_SEC = 0.02; // départ d'un Sfx de morceau : instant précis, juste après l'appui (voir le bouton Sfx)
const EMBR_CROSSFADE_SEC = 0.15; // repli par défaut ("fade" standard, sans réglage personnalisé) -- même durée que les voix
// Durée de fondu à utiliser pour la bascule VERS une boucle d'embranchement (24/08). "hard" = coupure nette (0s,
// aucune rampe) ; "custom" = valeur réglée sur cette boucle précise ; "fade" (par défaut) ou réglage absent =
// EMBR_CROSSFADE_SEC.
function embrCutFadeSec(loopDef) {
  if (!loopDef) return EMBR_CROSSFADE_SEC;
  if (loopDef.cutStyle === 'hard') return 0;
  if (loopDef.cutStyle === 'custom') return loopDef.customCutFadeSec != null ? loopDef.customCutFadeSec : EMBR_CROSSFADE_SEC;
  return EMBR_CROSSFADE_SEC;
}

/* ---------------- Minutages musicaux (26/09) ----------------
 * Formules de tempo d'un morceau, sans aucun état de lecture : le lecteur s'en sert (ses fonctions internes slotTiming,
 * blockSeconds, sectionTiming, embrLoopTiming... ne font plus que les appeler), et l'outil vidéo aussi, pour rejouer un
 * montage sur un AUTRE morceau (capture-retarget.js, Versioning) : une seule définition, pour que la traduction tombe
 * exactement sur la grille qu'aurait suivie une vraie écoute. */
function trackTempo(track) {
  const bpm = (track && track.bpm) || 120;
  const beatsPerBar = (track && track.beatsPerBar) || 4;
  return { bpm, beatsPerBar, secondsPerBeat: 60 / bpm };
}
// Tempo effectif d'un emplacement séquentiel (ou d'une boucle d'embranchement, même convention) : bpm/beatsPerBar
// propres s'ils sont réglés, sinon ceux du morceau.
function seqSlotTiming(track, slot) {
  const tt = trackTempo(track);
  return { secondsPerBeat: 60 / ((slot && slot.bpm) || tt.bpm), beatsPerBar: (slot && slot.beatsPerBar) || tt.beatsPerBar };
}
// Durée nominale d'un bloc de `bars` mesures (défaut : autant de mesures que de temps par mesure) : grille de
// l'emplacement s'il a un tempo propre, sinon celle du morceau (comportement historique).
function seqBlockSeconds(track, bars, slot) {
  if (slot && (slot.bpm || slot.beatsPerBar)) {
    const timing = seqSlotTiming(track, slot);
    return (bars || timing.beatsPerBar) * timing.beatsPerBar * timing.secondsPerBeat;
  }
  const tt = trackTempo(track);
  return (bars || tt.beatsPerBar) * tt.beatsPerBar * tt.secondsPerBeat;
}
// Tempo d'un fichier de transition : le sien, sinon celui de l'emplacement (ou de la boucle) quitté, sinon le morceau.
function seqTransitionTiming(track, tr, sourceSlot) {
  const tt = trackTempo(track);
  return {
    secondsPerBeat: 60 / ((tr && tr.bpm) || (sourceSlot && sourceSlot.bpm) || tt.bpm),
    beatsPerBar: (tr && tr.beatsPerBar) || (sourceSlot && sourceSlot.beatsPerBar) || tt.beatsPerBar
  };
}
// Durée nominale d'une transition séquentielle (nextOptions[].transition) -- voir le détail des quatre cas au-dessus de
// transitionDurationSecFor() dans initTrackPlayer.
function seqTransitionDurationSec(track, opt, sourceSlot) {
  const tr = opt && opt.transition;
  if (!tr) return null;
  if (tr.durationUnit === 'seconds') return tr.durationSeconds != null ? tr.durationSeconds : 0;
  if (tr.durationUnit === 'beats') return (tr.durationBeats || 1) * seqTransitionTiming(track, tr, sourceSlot).secondsPerBeat;
  if (tr.durationUnit === 'bars') {
    const timing = seqTransitionTiming(track, tr, sourceSlot);
    return (tr.bars || timing.beatsPerBar) * timing.beatsPerBar * timing.secondsPerBeat;
  }
  return seqBlockSeconds(track, tr.bars, sourceSlot);
}
// Durée nominale d'une transition d'embranchement-vertical (boucle CIBLE) : sans unité réglée, la durée réelle du
// fichier (fileDuration, connue seulement une fois décodé).
function embrTransitionDurationSec(track, loopDef, sourceLoopDef, fileDuration) {
  const tr = loopDef && loopDef.transition;
  if (!tr) return 0;
  if (tr.durationUnit === 'seconds') return tr.durationSeconds != null ? tr.durationSeconds : (fileDuration || 0);
  if (tr.durationUnit === 'beats') return (tr.durationBeats || 1) * seqTransitionTiming(track, tr, sourceLoopDef).secondsPerBeat;
  if (tr.durationUnit === 'bars') {
    const timing = seqTransitionTiming(track, tr, sourceLoopDef);
    return (tr.bars || timing.beatsPerBar) * timing.beatsPerBar * timing.secondsPerBeat;
  }
  return fileDuration || 0;
}
// Moteur quantifié (vertical / statique) : points de boucle du morceau et point de départ de la première lecture.
function quantizedLoopTiming(track) {
  const tt = trackTempo(track);
  const loopInSec = (track.loopInBeat || 0) * tt.secondsPerBeat;
  const loopOutSec = Math.max(loopInSec + tt.secondsPerBeat, (track.loopOutBeat || tt.beatsPerBar * 4) * tt.secondsPerBeat);
  const startTrackSec = Math.min((track.startTrackBeat || 0) * tt.secondsPerBeat, loopInSec);
  return { loopInSec, loopOutSec, cycleLength: loopOutSec - loopInSec, startTrackSec };
}
// Vertical-random : minutage d'une section résolue (bpm/mesures/timeline propres à CETTE section, décision du 30/07).
function vrSectionTiming(section) {
  const spb = 60 / (section.bpm || 120);
  const loopInSec = (section.loopInBeat || 0) * spb;
  const loopOutSec = Math.max(loopInSec + spb, (section.loopOutBeat || (section.beatsPerBar || 4) * 4) * spb);
  const startTrackSec = Math.min((section.startTrackBeat || 0) * spb, loopInSec);
  return { loopInSec, loopOutSec, cycleLength: loopOutSec - loopInSec, startTrackSec };
}
// Vertical-random : durée nominale de l'intro -- son tempo propre s'il est réglé (25/09), sinon celui de la première
// section jouable (l'intro n'appartient à aucune section) ; la partie du fichier au-delà forme la queue.
function vrIntroDurationSec(track, firstSection) {
  const intro = track.intro;
  const introBpm = (intro && intro.bpm) || (firstSection && firstSection.bpm) || 120;
  const introBeatsPerBar = (intro && intro.beatsPerBar) || (firstSection && firstSection.beatsPerBar) || 4;
  return ((intro && intro.bars) || introBeatsPerBar) * introBeatsPerBar * (60 / introBpm);
}
// Embranchement-vertical : boucle de référence, boucles « paires » (verrouillées en phase) et cycle de la référence.
function embrReferenceIndex(track) {
  const idx = (track.loops || []).findIndex(l => l && l.isInitial);
  return idx >= 0 ? idx : 0;
}
function embrPeerIndicesOf(track) {
  const loops = track.loops || [];
  const refIdx = embrReferenceIndex(track);
  const refBars = (loops[refIdx] || {}).bars;
  // Classification explicite (isDetour, 24/08), repli sur la comparaison des mesures pour un morceau publié avant.
  return loops.map((l, i) => i).filter(i => i === refIdx || ('isDetour' in loops[i] ? !loops[i].isDetour : (loops[i].bars === refBars)));
}
function embrLoopTimingOf(track) {
  const refLoop = (track.loops || [])[embrReferenceIndex(track)] || {};
  const duration = refLoop.duration || 0;
  if (!duration) return { startSec: 0, loopInSec: 0, cycleLength: seqBlockSeconds(track, refLoop.bars) };
  const spb = trackTempo(track).secondsPerBeat;
  const loopInSec = (refLoop.loopInBeat || 0) * spb;
  const loopOutSec = refLoop.loopOutBeat != null ? Math.max(loopInSec + spb, refLoop.loopOutBeat * spb) : duration;
  const startSec = Math.min((refLoop.startTrackBeat || 0) * spb, loopInSec);
  return { startSec, loopInSec, cycleLength: loopOutSec - loopInSec };
}
// Durée d'un minuteur de retour automatique (boucle paire), en temps / mesures / secondes.
function embrDurationToSec(track, value, unit) {
  const v = value || 0;
  const tt = trackTempo(track);
  if (unit === 'seconds') return v;
  if (unit === 'beats') return v * tt.secondsPerBeat;
  return v * tt.beatsPerBar * tt.secondsPerBeat; // 'bars', réglage par défaut
}
// Attente avant qu'une bascule demandée ne s'exécute (quantification de la boucle CIBLE), `elapsed` secondes après le
// point zéro de la référence. Durées en temps nominal ('immediate' ou absent : 0).
function embrQuantizeDelayAt(track, quantize, elapsed) {
  if (quantize !== 'beat' && quantize !== 'bar') return 0;
  const cycle = embrLoopTimingOf(track).cycleLength;
  if (!(cycle > 0)) return 0;
  const pos = ((elapsed % cycle) + cycle) % cycle;
  const tt = trackTempo(track);
  const unit = quantize === 'beat' ? tt.secondsPerBeat : tt.beatsPerBar * tt.secondsPerBeat;
  return (unit - (pos % unit)) % unit;
}

