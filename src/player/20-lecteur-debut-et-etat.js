// opts.concurrent (6/10, Carte de niveau du Projet) : ce lecteur joue EN MÊME TEMPS que d'autres (fond d'ambiance, morceau qui entre pendant
// que l'autre s'éteint) au lieu d'arrêter le morceau actif ; il expose alors wrapper.lpControl (voir 32-pause-reprise-lecture.js).
function initTrackPlayer(track, wrapper, elementColors, opts) {
  const concurrent = !!(opts && opts.concurrent);
  const { bg: waveBgColor, fg: waveFgColor } = resolveWaveformColors(elementColors);
  const isStatic = track.mode === 'static';
  const isVerticalRandom = track.mode === 'vertical-random';
  const isSequential = track.mode === 'sequential';
  const isEmbrVert = track.mode === 'embranchement-vertical';
  const supported = PLAYABLE_MODES.includes(track.mode);
  // Pitch "vitesse" (chantier 2, 22/09) — réglage de MORCEAU ENTIER, jamais par couche/boucle/emplacement/
  // pool : change la durée de lecture en plus de la hauteur, donc tout ce qui doit rester ensemble (couches
  // simultanées d'un vertical, boucles jumelles d'un embranchement-vertical, pools d'une même section)
  // doit bouger à EXACTEMENT la même vitesse, sous peine de dérive relative. Le pitch "traditionnel"
  // (fx.pitch.mode==='shift' porté par couche/boucle/emplacement/pool, voir buildLayerFxChain) ne change
  // pas la durée -- lui n'a pas ce problème, reste réglable indépendamment par élément.
  // Admin-only pour l'instant (voir fxBlockHtml, currentUserIsAdmin côté backstage) : correctif appliqué
  // aux boucles de planification "au fil de l'eau" des 4 moteurs (vérifié), PAS encore aux chemins de
  // reprise après pause/veille ni au seek pendant qu'un pitch est actif -- portée volontairement réduite
  // tant que ce n'est pas testé en conditions réelles, pas un oubli silencieux.
  // 25/09 : devenu VARIABLE -- un trigger ou un curseur peut changer la vitesse du morceau en cours de lecture (voir
  // refreshTrackRate plus bas). Les moteurs programmés le lisent à chaque génération : le changement s'applique à la prochaine
  // boucle / au prochain segment ; le moteur simple (bouclage natif) le suit en direct.
  const trackBaseRatio = (track.fx && track.fx.pitch && track.fx.pitch.mode !== 'shift') ? Math.pow(2, (track.fx.pitch.semitones || 0) / 12) : 1;
  let trackPitchRatio = trackBaseRatio;
  // Applique le pitch de morceau entier à UNE source -- appelé à chaque création de BufferSource, quel
  // que soit le moteur. No-op si aucun pitch actif (trackPitchRatio===1), donc sans coût pour l'immense
  // majorité des morceaux qui n'utilisent pas ce réglage.
  // allowFade : seul le moteur simple (bouclage natif, aucun planificateur JS) peut faire glisser le ratio
  // en cours de lecture. Les moteurs programmés recréent une source à chaque génération et calculent leurs
  // durées avec le ratio CIBLE : une rampe y recommencerait à chaque cycle et fausserait le minutage --
  // le fondu y est donc ignoré (ratio cible constant), voir trackPitchFxHtml() côté Backstage.
  function applyTrackPitchRate(src, startTime, allowFade) {
    if (trackPitchRatio === 1) return;
    const p = track.fx && track.fx.pitch || {};
    const when = startTime != null ? startTime : ctx.currentTime;
    if (allowFade && trackPitchRatio === trackBaseRatio && p.fadeFromSemitones != null && p.fadeDurationSec > 0) {
      src.playbackRate.setValueAtTime(Math.pow(2, p.fadeFromSemitones / 12), when);
      src.playbackRate.linearRampToValueAtTime(trackPitchRatio, when + p.fadeDurationSec);
    } else {
      src.playbackRate.value = trackPitchRatio;
    }
  }
