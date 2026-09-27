// ---- Curseurs de paramètre (24/09) -- l'équivalent d'un RTPC de Wwise / d'un "game parameter" de FMOD ----
// track.fxSliders = [{ id, label, defaultValue (0..1), smoothSec, visible,
//   bindings:[{ target:{type,li|si|pi}, param:'highcut.frequency'|..., from, to }],
//   thresholds:[{ at (0..1), mode:'below'|'above', triggerId }] }]
// Un curseur public de 0 à 100 % : chaque liaison convertit sa valeur en un réglage d'effet sur une cible (couche,
// boucle, emplacement, pool) -- de `from` (curseur à 0) à `to` (curseur à 100 %), exponentiellement pour une
// fréquence -- et les seuils activent/coupent des triggers ("santé < 25 % => Low life"). Le réglage est LISSÉ (smoothSec,
// le « seek speed » de FMOD) : rien ne change brutalement. Fonctions pures, partagées avec l'export de l'outil vidéo.
const FX_SLIDER_PARAMS = {
  'lowcut.frequency': { fx: 'lowcut', key: 'frequency', log: true, min: 20, max: 20000 },
  'highcut.frequency': { fx: 'highcut', key: 'frequency', log: true, min: 20, max: 20000 },
  'volume.db': { fx: 'volume', key: 'db', min: -60, max: 12 },
  'reverb.wet': { fx: 'reverb', key: 'wet', min: 0, max: 1 },
  'delay.wet': { fx: 'delay', key: 'wet', min: 0, max: 1 },
  'delay.feedback': { fx: 'delay', key: 'feedback', min: 0, max: 0.9 },
  'bitcrush.bits': { fx: 'bitcrush', key: 'bits', min: 1, max: 16, round: true },
  'bitcrush.reduction': { fx: 'bitcrush', key: 'reduction', min: 1, max: 50, round: true },
  'pitch.semitones': { fx: 'pitch', key: 'semitones', min: -24, max: 24 },
  // Pitch en mode « vitesse » (25/09) : règle la vitesse de TOUT le morceau (change aussi la durée) -- pas un réglage de
  // chaîne d'effets par voix (rate:true) : il alimente le rapport de vitesse du lecteur, voir fxSliderRateSemitones.
  'pitch.speed': { fx: 'pitch', key: 'semitones', min: -24, max: 24, rate: true },
  // Paramètres de spatialisation d'un Sfx attaché au morceau (kind 'sfx' : la cible est un Sfx, pas une voix) --
  // position en mètres (x vers la droite, y vers l'avant), OU distance/angle polaires (0° = devant, +90° = à droite),
  // et niveau de reverb. Valables pour les Sfx à position fixe.
  'spatial.x': { kind: 'sfx', key: 'x', min: -50, max: 50 },
  'spatial.y': { kind: 'sfx', key: 'y', min: -50, max: 50 },
  'spatial.distance': { kind: 'sfx', key: 'distance', min: 0, max: 50 },
  'spatial.angle': { kind: 'sfx', key: 'angle', min: -180, max: 180 },
  'spatial.reverbDb': { kind: 'sfx', key: 'reverbDb', min: -18, max: 6 }
};
// Courbe libre d'une liaison (24/09) : points {x, y} de 0 à 1 -- x = position du curseur, y = avancement entre la
// valeur « à 0 % » et la valeur « à 100 % » -- reliés par des segments. Sans courbe : la droite (0,0) -> (1,1).
function fxCurveSanitize(raw) {
  if (!Array.isArray(raw)) return null;
  const c = v => Math.max(0, Math.min(1, +v));
  const pts = raw.filter(q => q && Number.isFinite(+q.x) && Number.isFinite(+q.y)).map(q => ({ x: c(q.x), y: c(q.y) })).sort((a, b) => a.x - b.x);
  if (pts.length < 2) return null;
  pts[0].x = 0; pts[pts.length - 1].x = 1; // les extrémités sont toujours aux bords du curseur
  return pts;
}
function fxCurveEval(curve, v) {
  if (!curve || curve.length < 2) return v;
  if (v <= curve[0].x) return curve[0].y;
  for (let i = 1; i < curve.length; i++) {
    if (v <= curve[i].x) {
      const a = curve[i - 1], b = curve[i], span = b.x - a.x;
      return span > 1e-9 ? a.y + (b.y - a.y) * (v - a.x) / span : b.y;
    }
  }
  return curve[curve.length - 1].y;
}
function fxSliderTargetKey(target) {
  if (target && target.type === 'sfx' && target.id) return 'sfx:' + target.id;
  return fxTargetKeyFromTarget(target);
}
// Valeurs par défaut des autres réglages d'un effet que le curseur fait apparaître sans qu'il soit configuré ailleurs.
const FX_SLIDER_DEFAULT_FX = { lowcut: { slope: 24 }, highcut: { slope: 24 }, reverb: { decay: 2 }, delay: { time: 0.3, feedback: 0.35 }, bitcrush: { bits: 16, reduction: 1 }, pitch: { mode: 'shift' }, volume: {} };
function fxSlidersValid(track) {
  const clamp01 = v => Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 0));
  return ((track && track.fxSliders) || []).filter(d => d && d.id).map(d => ({
    id: d.id, label: d.label || '', visible: !!d.visible,
    def: clamp01(d.defaultValue),
    smoothSec: Number.isFinite(+d.smoothSec) && +d.smoothSec >= 0 ? +d.smoothSec : 0.15,
    bindings: (d.bindings || []).filter(b => {
      if (!b || !FX_SLIDER_PARAMS[b.param] || !Number.isFinite(+b.from) || !Number.isFinite(+b.to)) return false;
      const key = fxSliderTargetKey(b.target);
      // Un paramètre de spatialisation ne se lie qu'à un Sfx, un paramètre d'effet qu'à une voix.
      return !!key && ((FX_SLIDER_PARAMS[b.param].kind === 'sfx') === (key.indexOf('sfx:') === 0));
    }).map(b => ({ key: fxSliderTargetKey(b.target), param: b.param, from: +b.from, to: +b.to, curve: fxCurveSanitize(b.curve) })),
    thresholds: (d.thresholds || []).filter(x => x && x.triggerId && Number.isFinite(+x.at)).map(x => ({ at: clamp01(x.at), mode: x.mode === 'above' ? 'above' : 'below', triggerId: x.triggerId }))
  })).filter(sl => sl.bindings.length || sl.thresholds.length);
}
function fxSliderBindingValue(b, v0) {
  const meta = FX_SLIDER_PARAMS[b.param];
  const v = b.curve ? fxCurveEval(b.curve, v0) : v0; // courbe libre éventuelle, puis interpolation from -> to
  let p = (meta.log && b.from > 0 && b.to > 0) ? b.from * Math.pow(b.to / b.from, v) : b.from + (b.to - b.from) * v;
  p = Math.max(meta.min, Math.min(meta.max, p));
  return meta.round ? Math.round(p) : p;
}
// Réglages imposés à UNE cible par les curseurs, valeurs = getter (id -> 0..1) : { effet: { paramètre: valeur } }.
function fxSliderOverrides(sliders, valueOf, targetKey) {
  const out = {};
  sliders.forEach(sl => sl.bindings.forEach(b => {
    if (b.key !== targetKey && b.key !== 'track') return; // une liaison « tout le morceau » vise chaque voix
    const meta = FX_SLIDER_PARAMS[b.param];
    if (meta.rate) return; // la vitesse du morceau n'est pas un réglage de voix
    (out[meta.fx] = out[meta.fx] || {})[meta.key] = fxSliderBindingValue(b, valueOf(sl.id));
  }));
  return out;
}
// Réglages imposés à UN Sfx par les curseurs : { x?, y?, distance?, angle?, reverbDb? } (null si aucune liaison).
function fxSliderSfxOverrides(sliders, valueOf, sfxId) {
  let out = null;
  sliders.forEach(sl => sl.bindings.forEach(b => {
    if (b.key !== 'sfx:' + sfxId) return;
    (out = out || {})[FX_SLIDER_PARAMS[b.param].key] = fxSliderBindingValue(b, valueOf(sl.id));
  }));
  return out;
}
// Position/reverb finales d'un Sfx : réglage de base + réglages des curseurs (cartésien d'abord, puis polaire).
function fxSpatialWithOverride(sp, ov) {
  const out = Object.assign({}, sp);
  if (!ov) return out;
  if (ov.x != null) out.x = ov.x;
  if (ov.y != null) out.y = ov.y;
  if (ov.distance != null || ov.angle != null) {
    const bx = +out.x || 0, by = +out.y || 0;
    const d = ov.distance != null ? ov.distance : Math.hypot(bx, by);
    const a = ov.angle != null ? ov.angle * Math.PI / 180 : Math.atan2(bx, by);
    out.x = d * Math.sin(a); out.y = d * Math.cos(a);
  }
  if (ov.reverbDb != null) out.reverbDb = ov.reverbDb;
  return out;
}
function fxSliderForceKeys(sliders, targetKey) {
  const keys = new Set();
  sliders.forEach(sl => sl.bindings.forEach(b => { if ((b.key === targetKey || b.key === 'track') && !FX_SLIDER_PARAMS[b.param].rate) keys.add(FX_SLIDER_PARAMS[b.param].fx); }));
  return [...keys];
}
// Vitesse du morceau imposée par les curseurs (25/09) : demi-tons de la dernière liaison « pitch.speed » sur tout le morceau,
// ou null si aucune. Fonction pure, partagée avec l'export de l'outil vidéo.
function fxSliderRateSemitones(sliders, valueOf) {
  let out = null;
  sliders.forEach(sl => sl.bindings.forEach(b => {
    if (b.key !== 'track' || !FX_SLIDER_PARAMS[b.param].rate) return;
    out = fxSliderBindingValue(b, valueOf(sl.id));
  }));
  return out;
}
// Rapport de vitesse EFFECTIF d'un morceau (25/09) : réglage de base (track.fx.pitch, mode « vitesse » implicite) ; par-dessus,
// les triggers actifs qui portent un pitch en mode « rate » (dans l'ordre d'activation, le dernier l'emporte) ; par-dessus, un
// curseur « pitch.speed ». activeDefs = définitions des triggers ACTIFS visant tout le morceau. Pure : le lecteur et l'export
// vidéo l'appellent avec leur propre état.
function fxTrackRatio(track, activeDefs, sliders, valueOf) {
  const base = track && track.fx && track.fx.pitch && track.fx.pitch.mode !== 'shift' ? track.fx.pitch : null;
  let st = base ? (base.semitones || 0) : 0, on = !!base;
  (activeDefs || []).forEach(d => { const q = d && d.fx && d.fx.pitch; if (q && q.mode === 'rate') { st = q.semitones || 0; on = true; } });
  const sv = sliders && sliders.length ? fxSliderRateSemitones(sliders, valueOf) : null;
  if (sv != null) { st = sv; on = true; }
  return on ? Math.pow(2, st / 12) : 1;
}
// Applique les réglages des curseurs PAR-DESSUS un fx déjà fusionné (base + triggers).
function applyFxSliderOverrides(fx, overrides) {
  const out = Object.assign({}, fx);
  Object.keys(overrides).forEach(k => { out[k] = Object.assign({}, FX_SLIDER_DEFAULT_FX[k], out[k], overrides[k]); });
  return out;
}
// État voulu des triggers reliés par les seuils d'un curseur pour la valeur v.
function fxSliderThresholdWants(sl, v) {
  return sl.thresholds.map(x => ({ triggerId: x.triggerId, want: x.mode === 'above' ? v >= x.at : v < x.at }));
}
// Un ScriptProcessorNode (bitcrusher ET pitch-shift "shift", chantier 2) continue de tourner tant qu'il
// reste connecté -- un seul point de nettoyage pour les deux plutôt que de dupliquer la même paire de
// lignes à chacun des neuf appels concernés (voir les commentaires "onended" plus bas dans ce fichier).
function disconnectLeakyFxNodes(fxChain) {
  if (!fxChain) return;
  if (fxChain.nodes.bitcrush) { try { fxChain.nodes.bitcrush.disconnect(); } catch (e) {} }
  if (fxChain.nodes.pitchShift) { try { fxChain.nodes.pitchShift.disconnect(); } catch (e) {} }
}
function fxChainHasLeakyNode(fxChain) {
  return !!(fxChain && (fxChain.nodes.bitcrush || fxChain.nodes.pitchShift));
}
