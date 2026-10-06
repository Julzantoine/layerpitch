/* ---------------- Conversion WAV -> OGG ---------------- */
// Le niveau sonore n'est plus corrigé fichier par fichier ici : on se contente de MESURER chaque fichier (voir
// 40a-niveau-sonore-lufs.js), le gain unique du morceau est calculé une fois tous ses fichiers connus (publication).
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
  const measure = measureLoudness(chData, sampleRate);
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
  return { bytes: out, duration: audioBuf.duration, measure };
}

