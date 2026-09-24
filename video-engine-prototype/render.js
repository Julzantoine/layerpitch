// Prototype : prouve qu'on peut prendre une "prise" capturée (timeline d'événements)
// et en sortir un vrai .mp4 mixé, via ffmpeg. Pistes synthétiques (sinus) à la place
// de vrais stems LayerPitch — on ne teste ici que la mécanique de mixage/mux.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const eventsPath = process.argv[2] || path.join(__dirname, 'events.sample.json');
const outPath = process.argv[3] || path.join(__dirname, 'output.mp4');
const data = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));

const TAIL = 2; // secondes de silence/noir ajoutées après le dernier événement
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';

// 1. Reconstitue les fenêtres "actif" de chaque calque (paires on/off) et les déclenchements de stingers.
const layerWindows = []; // { id, start, end }
const openLayer = {};
for (const ev of data.events) {
  if (ev.type !== 'layer') continue;
  if (ev.action === 'on') {
    openLayer[ev.id] = ev.t;
  } else if (ev.action === 'off' && openLayer[ev.id] !== undefined) {
    layerWindows.push({ id: ev.id, start: openLayer[ev.id], end: ev.t });
    delete openLayer[ev.id];
  }
}

const stingerHits = []; // { id, start, end }
for (const ev of data.events) {
  if (ev.type !== 'stinger') continue;
  const dur = data.stingers[ev.id].duration;
  stingerHits.push({ id: ev.id, start: ev.t, end: ev.t + dur });
}

const lastEventT = Math.max(0, ...data.events.map(e => e.t));
const lastStingerEnd = Math.max(0, ...stingerHits.map(s => s.end));
const total = Math.max(lastEventT, lastStingerEnd) + TAIL;

console.log(`Durée totale calculée : ${total}s`);
console.log(`Fenêtres de calques : ${layerWindows.length}, déclenchements de stinger : ${stingerHits.length}`);

// 2. Construit le graphe de filtres ffmpeg.
// Une source sinus par identifiant (calque ou stinger), longue de `total`, qu'on découpe
// ensuite par fenêtre avec atrim + adelay pour la replacer au bon moment absolu.
const inputs = [];
const sourceIndexById = {};
let idx = 0;
for (const [id, layer] of Object.entries(data.layers)) {
  inputs.push('-f', 'lavfi', '-i', `sine=frequency=${layer.tone}:duration=${total}:sample_rate=44100`);
  sourceIndexById[id] = idx++;
}
for (const [id, stinger] of Object.entries(data.stingers)) {
  inputs.push('-f', 'lavfi', '-i', `sine=frequency=${stinger.tone}:duration=${total}:sample_rate=44100`);
  sourceIndexById[id] = idx++;
}

const filterParts = [];
const mixLabels = [];
let segN = 0;
function addSegment(id, start, end) {
  const label = `seg${segN++}`;
  const delayMs = Math.round(start * 1000);
  filterParts.push(
    `[${sourceIndexById[id]}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,` +
    `aformat=channel_layouts=stereo,adelay=delays=${delayMs}:all=1[${label}]`
  );
  mixLabels.push(`[${label}]`);
}
for (const w of layerWindows) addSegment(w.id, w.start, w.end);
for (const s of stingerHits) addSegment(s.id, s.start, s.end);

filterParts.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0:duration=longest[aout]`);

// 3. Fond vidéo synthétique : fond noir + minuteur + libellé du calque actif + flash sur stinger,
// pour vérifier visuellement que l'audio et la vidéo restent synchronisés.
let videoChain = `color=c=0x101010:s=640x360:d=${total}[bg];[bg]`;
const drawtexts = [];
drawtexts.push(
  `drawtext=fontfile=${FONT}:text='%{pts\\:hms}':x=20:y=20:fontsize=28:fontcolor=white`
);
for (const w of layerWindows) {
  drawtexts.push(
    `drawtext=fontfile=${FONT}:text='${w.id.toUpperCase()}':x=(w-text_w)/2:y=(h-text_h)/2:` +
    `fontsize=48:fontcolor=0x88ccff:enable='between(t,${w.start},${w.end})'`
  );
}
for (const s of stingerHits) {
  drawtexts.push(
    `drawtext=fontfile=${FONT}:text='${s.id.toUpperCase()} !':x=(w-text_w)/2:y=(h-text_h)/2+70:` +
    `fontsize=44:fontcolor=0xff5555:enable='between(t,${s.start},${s.end})'`
  );
}
videoChain += drawtexts.join(',') + '[vout]';
filterParts.push(videoChain);

const filterComplex = filterParts.join(';\n');
fs.writeFileSync(path.join(__dirname, 'last-filter-complex.txt'), filterComplex);

const args = [
  ...inputs,
  '-filter_complex', filterComplex,
  '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-shortest',
  '-y', outPath,
];

console.log('Lancement de ffmpeg...');
execFileSync(ffmpegPath, args, { stdio: 'inherit' });
console.log(`\nOK -> ${outPath}`);
