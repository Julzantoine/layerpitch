/* ---------------- Conversion WAV -> OGG ---------------- */
// Le niveau sonore n'est plus corrigé fichier par fichier ici : on se contente de MESURER chaque fichier (voir
// 40a-niveau-sonore-lufs.js), le gain unique du morceau est calculé une fois tous ses fichiers connus (publication).
// Sécurité (audit 16/11, I3) : la bibliothèque d'encodage télécharge son moteur (ogg.wasm) à part, hors du contrôle
// d'empreinte de la balise <script>. On le télécharge nous-mêmes, on vérifie son empreinte, puis on le lui donne.
// Version et empreinte à changer EN MÊME TEMPS que la balise de src/backstage/01-tete.html.
const OGG_WASM_URL = 'https://unpkg.com/wasm-media-encoders@0.7.0/wasm/ogg.wasm';
const OGG_WASM_SHA384 = 'ppdbvMbJ0Kpo809cSarkc3X2O26gmL9RXsO8Nd0B/mxVn4pZVoZjjjie2lhcIE8S';
async function loadVerifiedOggWasm() {
  const res = await fetch(OGG_WASM_URL);
  if (!res.ok) throw new Error('Encodeur OGG introuvable (' + res.status + ')');
  const buf = await res.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-384', buf));
  let bin = ''; for (let i = 0; i < digest.length; i++) bin += String.fromCharCode(digest[i]);
  if (btoa(bin) !== OGG_WASM_SHA384) throw new Error('Encodeur OGG refusé : le fichier reçu ne correspond pas à la version attendue');
  return buf;
}
async function wavFileToOgg(file) {
  if (!oggEncoder) oggEncoder = await WasmMediaEncoder.createEncoder('audio/ogg', await loadVerifiedOggWasm());
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

