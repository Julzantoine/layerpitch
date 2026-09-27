/* ---------------- Conversion WAV -> OGG ---------------- */
// Harmonisation des volumes : mesure RMS à la conversion (approximation raisonnable de l'intensité perçue —
// pas une vraie mesure LUFS/broadcast, plus lourde à implémenter). Le résultat est une correction de gain
// appliquée à la LECTURE (voir player.js), non destructive : le fichier OGG publié reste inchangé.
const TARGET_RMS_DB = -18;
function computeNormalizationGain(chData) {
  let sumSquares = 0, count = 0;
  chData.forEach(data => {
    for (let i = 0; i < data.length; i++) { sumSquares += data[i] * data[i]; count++; }
  });
  const rms = Math.sqrt(sumSquares / Math.max(1, count));
  if (!rms || !isFinite(rms)) return 1;
  const rmsDb = 20 * Math.log10(rms);
  // Correction plafonnée à ±12dB pour éviter une sur-amplification extrême sur un fichier presque silencieux.
  const gainDb = Math.max(-12, Math.min(12, TARGET_RMS_DB - rmsDb));
  return Math.round(Math.pow(10, gainDb / 20) * 1000) / 1000;
}
async function wavFileToOgg(file) {
  if (!oggEncoder) oggEncoder = await WasmMediaEncoder.createOggEncoder();
  const arrayBuf = await file.arrayBuffer();
  const actx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuf = await actx.decodeAudioData(arrayBuf.slice(0));
  const channels = Math.min(audioBuf.numberOfChannels, 2);
  const sampleRate = audioBuf.sampleRate;
  oggEncoder.configure({ channels, sampleRate, vbrQuality: 5 });
  const chData = [];
  for (let c = 0; c < channels; c++) chData.push(audioBuf.getChannelData(c));
  const gain = computeNormalizationGain(chData);
  const chunkSize = 4096;
  const parts = [];
  let offset = 0;
  while (offset < audioBuf.length) {
    const end = Math.min(offset + chunkSize, audioBuf.length);
    const chunk = chData.map(d => d.subarray(offset, end));
    const encoded = oggEncoder.encode(channels === 1 ? [chunk[0]] : chunk);
    if (encoded.length) parts.push(new Uint8Array(encoded));
    offset = end;
  }
  const tail = oggEncoder.finalize();
  if (tail.length) parts.push(new Uint8Array(tail));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return { bytes: out, duration: audioBuf.duration, gain };
}

