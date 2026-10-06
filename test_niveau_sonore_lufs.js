// Niveau sonore d'un morceau (06/10) : mesure LUFS (BS.1770), loudness du morceau entier, gain unique sans saturation.
// Le module est un morceau du Backstage (portée commune) : on l'évalue tel quel dans un contexte vide.
const fs = require('fs'), vm = require('vm'), path = require('path');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const ctx = vm.createContext({ console, Math, Float32Array, Float64Array });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'src/backstage/40a-niveau-sonore-lufs.js'), 'utf8')
  + '\nthis.api = { measureLoudness, loudnessLufs, normalizationGainFor, trackReferenceLoudness, applyTrackGain, trackAudioItems, combineSimultaneous };', ctx);
const A = ctx.api;

const FS = 48000;
const sine = (amp, secs, freq = 1000) => { const d = new Float32Array(Math.round(FS * secs)); for (let i = 0; i < d.length; i++) d[i] = amp * Math.sin(2 * Math.PI * freq * i / FS); return d; };

// Référence BS.1770 : un sinus de 1 kHz pleine échelle (0 dBFS crête) mesure −3,01 LUFS en mono ; à −20 dBFS : −23,0 LUFS.
const mono = A.measureLoudness([sine(0.1, 5)], FS);
const stereo = A.measureLoudness([sine(0.1, 5), sine(0.1, 5)], FS);
check('sinus 1 kHz −20 dBFS mono ≈ −23,0 LUFS', near(A.loudnessLufs(mono.ms), -23.0, 0.15));
check('même signal sur deux canaux : +3 dB', near(A.loudnessLufs(stereo.ms) - A.loudnessLufs(mono.ms), 3.01, 0.1));
check('pic mesuré = amplitude', near(mono.peak, 0.1, 0.001));
check('doubler l\'amplitude = +6 dB', near(A.loudnessLufs(A.measureLoudness([sine(0.2, 5)], FS).ms) - A.loudnessLufs(mono.ms), 6.02, 0.1));

// Les graves très bas sont atténués par le filtre K (38 Hz et en dessous)
check('20 Hz mesure bien moins fort que 1 kHz à amplitude égale', A.loudnessLufs(A.measureLoudness([sine(0.1, 5, 20)], FS).ms) < A.loudnessLufs(mono.ms) - 3);

// Porte absolue : un silence prolongé n'abaisse pas la mesure
const withSilence = new Float32Array(FS * 10); withSilence.set(sine(0.1, 5), 0);
check('5 s de silence en plus ne changent pas la loudness (porte)', near(A.loudnessLufs(A.measureLoudness([withSilence], FS).ms), A.loudnessLufs(mono.ms), 0.2));
check('silence total : énergie nulle', A.measureLoudness([new Float32Array(FS * 2)], FS).ms === 0);
check('fichier très court (< 400 ms) mesurable', A.measureLoudness([sine(0.1, 0.2)], FS).ms > 0);

// Gain : baisse si trop fort, monte si trop doux, plafonné par le pic, jamais de saturation
const ms = lufs => Math.pow(10, (lufs + 0.691) / 10);
const db = g => 20 * Math.log10(g);
check('morceau à −12 LUFS : baisse de 4 dB', near(db(A.normalizationGainFor({ ms: ms(-12), peak: 0.5, seconds: 5 })), -4, 0.05));
check('morceau à −20 LUFS, pic bas : monte de 4 dB', near(db(A.normalizationGainFor({ ms: ms(-20), peak: 0.1, seconds: 5 })), 4, 0.05));
const capped = A.normalizationGainFor({ ms: ms(-20), peak: 0.8, seconds: 5 }); // pic −1,9 dB : marge 0,9 dB seulement
check('pic haut : la montée est limitée pour ne pas dépasser −1 dB', near(db(capped) + 20 * Math.log10(0.8), -1, 0.05));
check('déjà au plafond : jamais de montée', A.normalizationGainFor({ ms: ms(-25), peak: 0.95, seconds: 5 }) === 1);
check('le gain ne descend pas sous −12 dB', near(db(A.normalizationGainFor({ ms: ms(0), peak: 0.9, seconds: 5 })), -12, 0.05));
check('aucune mesure : gain neutre', A.normalizationGainFor(null) === 1);

// Un morceau à couches : un SEUL gain pour toutes, les écarts entre couches restent
const quiet = A.measureLoudness([sine(0.02, 5)], FS), loud = A.measureLoudness([sine(0.3, 5)], FS);
const track = { mode: 'vertical', layers: [{ remoteFile: 'a', _measure: quiet }, { remoteFile: 'b', _measure: loud }] };
const ref = A.trackReferenceLoudness(track, it => it._measure);
check('couches simultanées : les énergies s\'additionnent', ref.ms > loud.ms && near(ref.ms, quiet.ms + loud.ms, 1e-9));
const g = A.normalizationGainFor(ref);
A.applyTrackGain(track, g);
check('toutes les couches reçoivent exactement le même gain', track.layers[0].gain === g && track.layers[1].gain === g);
check('l\'écart entre les deux couches est inchangé', near(A.loudnessLufs(quiet.ms * g * g) - A.loudnessLufs(loud.ms * g * g), A.loudnessLufs(quiet.ms) - A.loudnessLufs(loud.ms), 1e-9));

// Séquentiel : moyenne pondérée par la durée, une alternative = une moyenne
const seqTrack = { mode: 'sequential', intro: { remoteFile: 'i', _measure: { ms: 1, peak: 0.5, seconds: 2 } },
  segmentSlots: [{ alternatives: [{ remoteFile: 'x', _measure: { ms: 4, peak: 0.6, seconds: 8 } }, { remoteFile: 'y', _measure: { ms: 2, peak: 0.7, seconds: 8 } }] }] };
const sref = A.trackReferenceLoudness(seqTrack, it => it._measure);
check('séquentiel : moyenne pondérée (intro 1×2 s, emplacement 3×8 s)', near(sref.ms, (1 * 2 + 3 * 8) / 10, 1e-9) && near(sref.peak, 0.7, 1e-9));
check('trackAudioItems : intro + alternatives', A.trackAudioItems(seqTrack).length === 3);

// Les pages construites utilisent bien le module
const page = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf8');
check('module présent dans le Backstage construit', /function measureLoudness\(/.test(page) && /trackNormalizeHtml\(track, ti\)/.test(page));
check('l\'ancien gain RMS par fichier a disparu', !/computeNormalizationGain|TARGET_RMS_DB/.test(page));

console.log(failures ? failures + ' échec(s)' : 'Tout est vert');
process.exit(failures ? 1 : 0);
