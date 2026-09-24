// Prototype (v2) : prend une VRAIE capture (le JSON qu'exporterait pack.html) + les VRAIS fichiers audio
// du morceau/de la librairie Sfx (lus depuis data.json + audio/), et produit un .mp4 mixé -- même
// principe que render.js, mais avec de la vraie musique à la place des sinus de test.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const REPO_ROOT = path.join(__dirname, '..');
const capturePath = process.argv[2] || path.join(__dirname, 'capture.sample.json');
const outPath = process.argv[3] || path.join(__dirname, 'output-real.mp4');
const bgVideoPath = process.argv[4] || null; // fond réel (extrait déjà découpé/redimensionné) au lieu du carré noir de test
const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data.json'), 'utf8'));

const TAIL = 2;
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';

function findTrack(trackId) { return (data.library || []).find(t => t.id === trackId); }
function findSfx(sfxId) { return (data.sfxLibrary || []).find(s => s.id === sfxId); }
// Même fonction que window.LayerPlayerCore.cumulativeProfiles (player.js) : au niveau i, les calques
// 0..i sont TOUS actifs (empilage cumulatif, pas un calque exclusif par niveau -- corrigé le 2026-09-15
// après que Jules-Antoine a signalé qu'un niveau 2 sans les niveaux 0 et 1 n'a pas de sens sur ses morceaux).
function cumulativeProfiles(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Array.from({ length: n }, (_, j) => (j <= i ? 1 : 0)));
  return out;
}

// 1. Ne garde que les types d'événements qu'on sait convertir pour l'instant (mode "vertical" -- calques
// qui jouent tous en parallèle, seule l'intensité dominante change -- et stingers, valables quel que
// soit le mode). Les embranchements (seq_branch_select/embr_loop_select, mode narratif à segments qui
// s'enchaînent plutôt que de se superposer) demandent un modèle de montage différent, pas encore fait.
const intensityEvents = capture.events.filter(e => e.name === 'intensity_change');
const stingerEvents = capture.events.filter(e => e.name === 'stinger_play');

const levelWindows = intensityEvents.map((e, i) => ({
  trackId: e.detail.trackId,
  level: e.detail.level,
  start: e.t,
  end: i + 1 < intensityEvents.length ? intensityEvents[i + 1].t : null, // rempli après calcul de `total`
}));

const lastT = Math.max(0, ...capture.events.map(e => e.t));
const total = lastT + TAIL;
levelWindows.forEach(w => { if (w.end === null) w.end = total; });

console.log(`Durée totale : ${total}s -- ${levelWindows.length} fenêtre(s) de niveau, ${stingerEvents.length} stinger(s)`);

// 2. Résout les vrais fichiers audio (calques du morceau, variation de Sfx réellement déclenchée).
const inputs = [];
const filterParts = [];
const mixLabels = [];
let inIdx = 0;
let segN = 0;

function addInput(localFile) {
  inputs.push('-i', localFile);
  return inIdx++;
}

// Calques : empilage cumulatif -- au niveau N, les calques 0..N jouent TOUS ensemble (voir
// cumulativeProfiles ci-dessus), pas seulement le calque N seul. Toujours lus depuis le DEBUT du fichier
// (les calques d'un morceau vertical jouent en synchro depuis t=0, seule l'intensité affichée/dominante
// change) -- atrim prend la même fenêtre absolue sur la source, adelay la replace au bon moment. Les
// fenêtres consécutives où un calque reste actif sont fusionnées en une seule plage (un seul fondu à
// chaque bout) plutôt qu'un segment par bascule de niveau, pour éviter de re-couper le calque pour rien
// à chaque frontière interne.
const trackId0 = levelWindows[0] && levelWindows[0].trackId;
const track0 = trackId0 && findTrack(trackId0);
const numLayers = (track0 && track0.layers.length) || 0;
const cumulative = cumulativeProfiles(numLayers);
for (let layerIdx = 0; layerIdx < numLayers; layerIdx++) {
  const layer = track0.layers[layerIdx];
  if (!layer || !layer.file) continue;
  const file = path.join(REPO_ROOT, 'audio', trackId0, layer.file);
  if (!fs.existsSync(file)) { console.warn(`Fichier manquant: ${file}`); continue; }
  let run = null;
  const flushRun = () => {
    if (!run) return;
    const idx = addInput(file);
    const label = `seg${segN++}`;
    const delayMs = Math.round(run.start * 1000);
    const dur = run.end - run.start;
    const fade = Math.min(0.3, dur / 2);
    filterParts.push(
      `[${idx}:a]atrim=start=${run.start}:end=${run.end},asetpts=PTS-STARTPTS,` +
      `afade=t=in:st=0:d=${fade},afade=t=out:st=${Math.max(0, dur - fade)}:d=${fade},` +
      `aformat=channel_layouts=stereo,adelay=delays=${delayMs}:all=1[${label}]`
    );
    mixLabels.push(`[${label}]`);
    console.log(`  Calque "${layer.label}" actif de ${run.start}s à ${run.end}s`);
    run = null;
  };
  for (const w of levelWindows) {
    const profile = cumulative[w.level] || cumulative[0];
    const active = profile && !!profile[layerIdx];
    if (active) {
      if (run && run.end === w.start) run.end = w.end;
      else { flushRun(); run = { start: w.start, end: w.end }; }
    } else {
      flushRun();
    }
  }
  flushRun();
}

// Stingers : la variation EXACTE que le compositeur a déclenchée (round robin réel), jouée en entier
// depuis le début du fichier, puis replacée au moment du déclenchement.
for (const s of stingerEvents) {
  const sfx = findSfx(s.detail.sfxId);
  const alt = sfx && sfx.alternatives && sfx.alternatives[s.detail.variationIndex];
  if (!alt) { console.warn(`Sfx introuvable: ${JSON.stringify(s.detail)}`); continue; }
  const file = path.join(REPO_ROOT, 'audio', `sfx-${s.detail.sfxId}`, alt.file);
  if (!fs.existsSync(file)) { console.warn(`Fichier manquant: ${file}`); continue; }
  const idx = addInput(file);
  const label = `seg${segN++}`;
  const delayMs = Math.round(s.t * 1000);
  filterParts.push(
    `[${idx}:a]aformat=channel_layouts=stereo,adelay=delays=${delayMs}:all=1[${label}]`
  );
  mixLabels.push(`[${label}]`);
  console.log(`  Stinger "${sfx.title}" (variation ${s.detail.variationIndex}) à ${s.t}s`);
}

filterParts.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0:duration=longest[aout]`);

// 3. Fond vidéo : un vrai extrait de gameplay si fourni (bgVideoPath), sinon le carré noir de test du
// prototype v1. Dans les deux cas, mêmes incrustations (minuteur + libellé du niveau actif + flash sur
// stinger) pour vérifier visuellement la synchro avec le son mixé -- le son original de la vidéo n'est
// jamais repris (seul le mix [aout] ci-dessus est utilisé), comme le fait déjà le mode Test en jeu actuel.
let videoChain;
if (bgVideoPath) {
  const bgIdx = addInput(bgVideoPath);
  videoChain = `[${bgIdx}:v]`;
} else {
  videoChain = `color=c=0x101010:s=640x360:d=${total}[bg];[bg]`;
}
const drawtexts = [`drawtext=fontfile=${FONT}:text='%{pts\\:hms}':x=20:y=20:fontsize=28:fontcolor=white`];
for (const w of levelWindows) {
  const track = findTrack(w.trackId);
  const layer = track && track.layers[w.level];
  const label = (layer && layer.label || `niveau ${w.level}`).replace(/['\\:]/g, '');
  drawtexts.push(
    `drawtext=fontfile=${FONT}:text='${label}':x=(w-text_w)/2:y=(h-text_h)/2:` +
    `fontsize=40:fontcolor=0x88ccff:enable='between(t,${w.start},${w.end})'`
  );
}
for (const s of stingerEvents) {
  const sfx = findSfx(s.detail.sfxId);
  const label = ((sfx && sfx.title) || 'stinger').toUpperCase();
  drawtexts.push(
    `drawtext=fontfile=${FONT}:text='${label} !':x=(w-text_w)/2:y=(h-text_h)/2+70:` +
    `fontsize=44:fontcolor=0xff5555:enable='between(t,${s.t},${s.t + 1})'`
  );
}
videoChain += drawtexts.join(',') + '[vout]';
filterParts.push(videoChain);

const filterComplex = filterParts.join(';\n');
fs.writeFileSync(path.join(__dirname, 'last-filter-complex-real.txt'), filterComplex);

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
