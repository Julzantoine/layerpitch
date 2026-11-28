#!/usr/bin/env node
// Usage : node scripts/wwise-report.js <dossier du projet Wwise> [--json] [--draft fichier.json] [--initial Nom=valeur ...]
// Lit les .wwu du projet, affiche le rapport de correspondance Wwise -> LayerPitch (Markdown), ou le brouillon complet en JSON.
const fs = require('fs');
const path = require('path');
const W = require('../layerpitch-wwise-import.js');

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.error('Usage : node scripts/wwise-report.js <dossier du projet Wwise> [--json]'); process.exit(1); }
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === '__MACOSX') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.wwu$/i.test(e.name)) files.push({ path: path.relative(dir, p), text: fs.readFileSync(p, 'utf8') });
  }
})(dir);
const model = W.readWwiseProject(files);
const draft = W.draftFromModel(model);
const di = process.argv.indexOf('--draft');
if (di > 0) { const out = process.argv[di + 1]; if (!out) { console.error('--draft demande un nom de fichier'); process.exit(1); } const initialValues = {}; process.argv.forEach((a, i) => { if (process.argv[i - 1] === '--initial') { const m = a.match(/^(.+)=(-?[\d.]+)$/); if (m) initialValues[m[1]] = +m[2]; else { console.error('--initial attend Nom=valeur : ' + a); process.exit(1); } } });
  fs.writeFileSync(out, JSON.stringify(W.buildLayerPitchTracks(model, draft, { initialValues }), null, 2)); console.error('Brouillon écrit : ' + out); }
console.log(process.argv.includes('--json') ? JSON.stringify({ model, draft }, null, 2) : W.reportMarkdown(model, draft));
