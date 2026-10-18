// Aucun fichier suivi par Git ne doit contenir de marqueurs de conflit de fusion (<<<<<<<, =======, >>>>>>>).
// Cause d'un incident le 15/10/2026 : deux branches avaient chacune changé les ?v= des scripts, la fusion a laissé
// ses marqueurs au milieu des <script> de 24 pages, qui sont alors restées à moitié vides en ligne.
const { execSync } = require('child_process');
const fs = require('fs');
const files = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(f => f && !f.startsWith('node_modules/') && !/\.(png|jpe?g|webp|gif|ico|mp3|wav|ogg|mp4|webm|zip|pdf|woff2?|ttf)$/i.test(f));
const marker = /^(<{7} |={7}$|>{7} )/m;
let failures = 0;
files.forEach(f => {
  let t; try { t = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
  if (marker.test(t)) { console.log('FAIL - marqueur de conflit dans ' + f); failures++; }
});
if (!failures) console.log('OK   - aucun marqueur de conflit dans ' + files.length + ' fichiers');
process.exit(failures ? 1 : 0);
