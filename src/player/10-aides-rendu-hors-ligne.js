// ---- Aides pour le rendu hors-ligne (outil vidéo "Test in game", 23/09) ----
// Mêmes règles que initTrackPlayer (registre de triggers) mais sans état vivant : l'export rejoue une prise
// enregistrée sur un OfflineAudioContext en réutilisant EXACTEMENT les mêmes chaînes d'effets et la même
// fusion des triggers que le lecteur -- c'est ce qui garantit que le son exporté est celui qu'on teste en jeu.
function fxTargetKeyFromTarget(target) {
  if (!target) return null;
  // 'track' (24/09, décision de Jules-Antoine) : le trigger / la liaison agit sur TOUT le morceau, quelle que soit la
  // section ou le moment -- plus de bouton « par section » (usine à gaz). Les cibles précises (couche, boucle,
  // emplacement, pool) restent comprises pour les données déjà créées, mais l'éditeur ne les propose plus.
  if (target.type === 'track') return 'track';
  if (target.type === 'layer') return 'layer:' + (target.li || 0);
  if (target.type === 'loop') return 'loop:' + target.li;
  if (target.type === 'slot') return 'slot:' + target.si;
  if (target.type === 'pool') return 'pool:' + target.si + ':' + target.pi;
  // Intro, outro et transitions (7/10) : les chaînes d'effets de ces éléments portent déjà ces clés (buildTargetFxChain). « transition »
  // vise TOUTES les transitions du morceau (séquentiel et embranchement-vertical).
  if (target.type === 'intro' || target.type === 'outro' || target.type === 'transition') return target.type;
  return null;
}
// fx de base porté par une cible ('layer:i', 'loop:i', 'slot:i', 'pool:s:p', 'intro', 'outro') -- même
// source que les buildTargetFxChain de initTrackPlayer.
function baseFxForTarget(track, key) {
  if (!track || !key) return null;
  const p = key.split(':');
  if (p[0] === 'layer') { const l = (track.layers || [])[+p[1]]; return l && l.fx || null; }
  if (p[0] === 'loop') { const l = (track.loops || [])[+p[1]]; return l && l.fx || null; }
  if (p[0] === 'slot') { const l = (track.segmentSlots || [])[+p[1]]; return l && l.fx || null; }
  if (p[0] === 'pool') { const sec = (track.sections || [])[+p[1]]; const pl = sec && (sec.pools || [])[+p[2]]; return pl && pl.fx || null; }
  if (p[0] === 'intro') return track.intro && track.intro.fx || null;
  if (p[0] === 'outro') return track.outro && track.outro.fx || null;
  return null;
}
// Fusion d'un fx de base avec les triggers ACTIFS de sa cible, dans l'ordre d'activation (le dernier activé
// l'emporte, clé par clé).
function mergeTriggerFx(baseFx, activeTriggerDefs) {
  const out = baseFx ? Object.assign({}, baseFx) : {};
  (activeTriggerDefs || []).forEach(d => { Object.keys(d.fx || {}).forEach(k => { out[k] = Object.assign({}, out[k], d.fx[k]); }); });
  return out;
}
