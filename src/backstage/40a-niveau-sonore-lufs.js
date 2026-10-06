/* ---------------- Niveau sonore d'un morceau (LUFS) ---------------- */
// Remplace (06/10) l'ancienne « harmonisation » : un gain RMS calculé fichier par fichier, qui écrasait les écarts voulus
// entre les couches d'un même morceau (un pad discret devenait aussi fort que la batterie).
// Principe actuel : on MESURE chaque fichier (loudness BS.1770 : filtre « K » + blocs de 400 ms + portes), on estime la
// loudness du MORCEAU ENTIER (couches jouées ensemble = énergies additionnées ; suite de blocs = moyenne pondérée par la
// durée), puis on calcule UN SEUL gain pour tout le morceau, appliqué identiquement à tous ses fichiers : les écarts
// entre couches sont conservés. Un gain pur -- jamais de compression, jamais de limiteur.
// Le gain est écrit dans le champ `gain` de chaque fichier (déjà publié et lu par le lecteur : aucun changement de base).
const NORM_TARGET_LUFS = -16;
const NORM_PEAK_CEILING_DB = -1;   // on ne monte jamais le son au-delà : sinon il sature
const NORM_MAX_GAIN_DB = 12;       // garde-fou : un fichier presque muet n'est pas gonflé n'importe comment

// Coefficients du filtre « K » (BS.1770-4) pour une fréquence d'échantillonnage quelconque : un étage de
// haute-fréquence (shelf) puis un passe-haut (RLB).
function kWeightingCoefficients(fs) {
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0,
    a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0
  };
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
  K = Math.tan(Math.PI * f1 / fs);
  a0 = 1 + K / Q1 + K * K;
  const highpass = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q1 + K * K) / a0 };
  return { shelf, highpass };
}

// Mesure un fichier décodé : { ms (énergie pondérée, portes comprises), peak (pic d'échantillon, linéaire), seconds }.
// chData = tableau de Float32Array (un par canal ; au-delà de 2 canaux on ne mesure que les 2 premiers).
function measureLoudness(chData, sampleRate) {
  const channels = chData.slice(0, 2);
  const n = channels.length ? channels[0].length : 0;
  const out = { ms: 0, peak: 0, seconds: n / sampleRate };
  if (!n) return out;
  const { shelf, highpass } = kWeightingCoefficients(sampleRate);
  const segLen = Math.max(1, Math.round(sampleRate * 0.1));
  const nSeg = Math.floor(n / segLen);
  const segEnergy = new Float64Array(Math.max(nSeg, 1));
  let peak = 0;
  channels.forEach(data => {
    let s1x1 = 0, s1x2 = 0, s1y1 = 0, s1y2 = 0, s2x1 = 0, s2x2 = 0, s2y1 = 0, s2y2 = 0;
    for (let i = 0; i < n; i++) {
      const x = data[i];
      const ax = x < 0 ? -x : x;
      if (ax > peak) peak = ax;
      const y1 = shelf.b0 * x + shelf.b1 * s1x1 + shelf.b2 * s1x2 - shelf.a1 * s1y1 - shelf.a2 * s1y2;
      s1x2 = s1x1; s1x1 = x; s1y2 = s1y1; s1y1 = y1;
      const y2 = highpass.b0 * y1 + highpass.b1 * s2x1 + highpass.b2 * s2x2 - highpass.a1 * s2y1 - highpass.a2 * s2y2;
      s2x2 = s2x1; s2x1 = y1; s2y2 = s2y1; s2y1 = y2;
      const seg = Math.floor(i / segLen);
      if (seg < segEnergy.length) segEnergy[seg] += y2 * y2;
    }
  });
  out.peak = peak;
  // Énergie par bloc : 4 segments consécutifs (400 ms, recouvrement 75 %). Fichier plus court que 400 ms : un seul bloc.
  const blocks = [];
  if (nSeg < 4) {
    let total = 0;
    segEnergy.forEach(v => { total += v; });
    blocks.push(total / (Math.max(nSeg, 1) * segLen));
  } else {
    for (let b = 0; b + 4 <= nSeg; b++) {
      blocks.push((segEnergy[b] + segEnergy[b + 1] + segEnergy[b + 2] + segEnergy[b + 3]) / (4 * segLen));
    }
  }
  const lufsOf = z => -0.691 + 10 * Math.log10(z);
  const aboveAbs = blocks.filter(z => z > 0 && lufsOf(z) > -70);
  if (!aboveAbs.length) return out;
  const meanAbs = aboveAbs.reduce((a, z) => a + z, 0) / aboveAbs.length;
  const relThreshold = lufsOf(meanAbs) - 10;
  const kept = aboveAbs.filter(z => lufsOf(z) > relThreshold);
  out.ms = (kept.length ? kept : aboveAbs).reduce((a, z) => a + z, 0) / (kept.length ? kept.length : aboveAbs.length);
  return out;
}

function loudnessLufs(ms) { return ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity; }

// Combinaisons de mesures (chaque mesure : { ms, peak, seconds } ou null).
// Jouées ENSEMBLE : les énergies s'ajoutent (sources non corrélées -- approximation raisonnable), le pic estimé aussi.
function combineSimultaneous(list) {
  const items = list.filter(Boolean);
  if (!items.length) return null;
  return {
    ms: items.reduce((a, m) => a + m.ms, 0),
    peak: Math.sqrt(items.reduce((a, m) => a + m.peak * m.peak, 0)),
    seconds: Math.max.apply(null, items.map(m => m.seconds))
  };
}
// Jouées À LA SUITE : énergie moyenne pondérée par la durée, pic = le plus haut.
function combineSequential(list) {
  const items = list.filter(m => m && m.seconds > 0);
  if (!items.length) return null;
  const total = items.reduce((a, m) => a + m.seconds, 0);
  return {
    ms: items.reduce((a, m) => a + m.ms * m.seconds, 0) / total,
    peak: Math.max.apply(null, items.map(m => m.peak)),
    seconds: total
  };
}
// Alternatives interchangeables (une seule sonne à la fois) : moyenne simple.
function combineAlternatives(list) {
  const items = list.filter(Boolean);
  if (!items.length) return null;
  return {
    ms: items.reduce((a, m) => a + m.ms, 0) / items.length,
    peak: Math.max.apply(null, items.map(m => m.peak)),
    seconds: items.reduce((a, m) => a + m.seconds, 0) / items.length
  };
}

// Tous les fichiers audio d'un morceau (objets { remoteFile, pendingFile, gain, ... }), quel que soit son mode.
function trackAudioItems(track) {
  const items = [];
  (track.layers || []).forEach(l => items.push(l));
  if (track.intro) items.push(track.intro);
  if (track.outro) items.push(track.outro);
  (track.segmentSlots || []).forEach(sl => {
    (sl.alternatives || []).forEach(a => items.push(a));
    (sl.nextOptions || []).forEach(o => { if (o && o.transition) items.push(o.transition); });
  });
  (track.sections || []).forEach(sec => (sec.pools || []).forEach(p => (p.alternatives || []).forEach(a => items.push(a))));
  (track.loops || []).forEach(l => { items.push(l); if (l.transition) items.push(l.transition); });
  return items.filter(it => it && (it.remoteFile || it.pendingFile || it._measure));
}

// Loudness estimée du morceau entier à partir des mesures de ses fichiers. measureOf(item) -> mesure ou null.
function trackReferenceLoudness(track, measureOf) {
  const m = measureOf;
  if (track.mode === 'static') return combineSimultaneous((track.layers || []).slice(0, 1).map(m));
  if (track.mode === 'vertical') return combineSimultaneous((track.layers || []).map(m));
  if (track.mode === 'vertical-random') {
    const sections = (track.sections || []).map(sec => combineSimultaneous((sec.pools || []).map(p => combineAlternatives((p.alternatives || []).map(m)))));
    return combineSequential([m(track.intro), ...sections, m(track.outro)].filter(Boolean));
  }
  if (track.mode === 'embranchement-vertical') return combineSequential((track.loops || []).map(m));
  // séquentiel (et repli) : intro, un représentant par emplacement, outro
  const slots = (track.segmentSlots || []).map(sl => combineAlternatives((sl.alternatives || []).map(m)));
  return combineSequential([track.intro ? m(track.intro) : null, ...slots, track.outro ? m(track.outro) : null]);
}

// Gain (facteur linéaire) à appliquer à tout le morceau pour atteindre la cible, sans jamais saturer.
function normalizationGainFor(ref) {
  if (!ref || !(ref.ms > 0)) return 1;
  let gainDb = Math.max(-NORM_MAX_GAIN_DB, Math.min(NORM_MAX_GAIN_DB, NORM_TARGET_LUFS - loudnessLufs(ref.ms)));
  if (gainDb > 0 && ref.peak > 0) {
    const headroomDb = NORM_PEAK_CEILING_DB - 20 * Math.log10(ref.peak);
    gainDb = Math.min(gainDb, Math.max(0, headroomDb));
  }
  return Math.round(Math.pow(10, gainDb / 20) * 1000) / 1000;
}

// Écrit le même gain sur tous les fichiers du morceau.
function applyTrackGain(track, gain) {
  trackAudioItems(track).forEach(it => { it.gain = gain; });
}

// Décode un fichier (File/Blob, ou ArrayBuffer) et le mesure.
async function measureAudioBuffer(arrayBuf) {
  const actx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audioBuf = await actx.decodeAudioData(arrayBuf);
    const chData = [];
    for (let c = 0; c < Math.min(audioBuf.numberOfChannels, 2); c++) chData.push(audioBuf.getChannelData(c));
    return measureLoudness(chData, audioBuf.sampleRate);
  } finally { try { actx.close(); } catch (e) { /* déjà fermé */ } }
}

// Complète les mesures manquantes d'un morceau (fichiers déjà publiés : on les retélécharge), puis calcule et applique
// le gain unique. Renvoie { gain, lufs, missing } ; `missing` = fichiers impossibles à lire (le gain est alors calculé
// sans eux, à signaler au compositeur).
async function recomputeTrackNormalization(track) {
  let missing = 0;
  for (const it of trackAudioItems(track)) {
    if (it._measure) continue;
    try {
      let buf = null;
      if (it.pendingFile) buf = await it.pendingFile.arrayBuffer();
      else if (it.remoteFile) {
        const res = await fetch(`${track.base || ''}${it.remoteFile}`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        buf = await res.arrayBuffer();
      }
      if (buf) it._measure = await measureAudioBuffer(buf);
    } catch (e) { console.warn('Mesure impossible', it.remoteFile, e); missing++; }
  }
  const ref = trackReferenceLoudness(track, it => (it && it._measure) || null);
  const gain = normalizationGainFor(ref);
  applyTrackGain(track, gain);
  track._normDirty = false;
  return { gain, lufs: ref ? loudnessLufs(ref.ms) : null, missing };
}
