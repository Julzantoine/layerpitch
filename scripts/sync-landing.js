#!/usr/bin/env node
/**
 * LayerPitch — recopie la landing (dossier nouvelle-landing/, la SEULE source à modifier) vers le dépôt qui sert
 * www.layerpitch.com (Julzantoine.github.io). Depuis la bascule du 15/11/2026 les fichiers sont identiques des deux côtés ;
 * seuls ajouts propres à l'autre dépôt, jamais écrasés ni supprimés : CNAME, et les pages de redirection des anciennes
 * adresses (landing.html, landing-en.html, en.html) que GitHub Pages ne sait pas faire autrement (pas de _redirects).
 * Usage : node scripts/sync-landing.js [dossier-du-dépôt-cible]   copie
 *         node scripts/sync-landing.js --check [dossier]           ne copie rien ; code 1 si les deux dépôts diffèrent
 * Dossier cible par défaut : ../Julzantoine.github.io à côté de ce dépôt, sinon ~/Documents/GitHub/Julzantoine.github.io
 * (utile depuis un worktree). Pas de commit ni de push : on relit (git diff) et on pousse soi-même.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..', 'nouvelle-landing');
const SKIP = new Set(['_redirects']); // propre à Cloudflare Pages, inutile sur GitHub Pages
const REDIRECTS = { 'landing.html': '/compositeurs', 'landing-en.html': '/en/composers', 'en.html': '/en/' };

function redirectPage(to) {
  return '<!DOCTYPE html>\n<html><head><meta charset="UTF-8"><meta name="robots" content="noindex"><link rel="canonical" href="https://www.layerpitch.com' + to +
    '"><meta http-equiv="refresh" content="0; url=' + to + '"><title>LayerPitch</title></head><body><a href="' + to + '">LayerPitch</a></body></html>\n';
}

function listFiles(dir, base) {
  base = base || dir;
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return listFiles(full, base);
    const rel = path.relative(base, full);
    return SKIP.has(rel) ? [] : [rel];
  });
}

// Liste (sans rien écrire) ce qui différerait dans le dépôt cible.
function diff(targetDir) {
  const out = [];
  listFiles(SRC).forEach(rel => {
    const dst = path.join(targetDir, rel);
    if (!fs.existsSync(dst) || !fs.readFileSync(dst).equals(fs.readFileSync(path.join(SRC, rel)))) out.push(rel);
  });
  Object.keys(REDIRECTS).forEach(rel => {
    const dst = path.join(targetDir, rel);
    if (!fs.existsSync(dst) || fs.readFileSync(dst, 'utf8') !== redirectPage(REDIRECTS[rel])) out.push(rel);
  });
  return out;
}

function sync(targetDir) {
  const done = [];
  diff(targetDir).forEach(rel => {
    const dst = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (REDIRECTS[rel]) fs.writeFileSync(dst, redirectPage(REDIRECTS[rel]));
    else fs.copyFileSync(path.join(SRC, rel), dst);
    done.push(rel);
  });
  return done;
}

if (require.main === module) {
  const args = process.argv.slice(2), check = args.includes('--check'), given = args.find(a => a !== '--check');
  const candidates = given ? [given] : [path.join(__dirname, '..', '..', 'Julzantoine.github.io'), path.join(os.homedir(), 'Documents', 'GitHub', 'Julzantoine.github.io')];
  const target = candidates.map(c => path.resolve(c)).find(c => fs.existsSync(path.join(c, 'CNAME')));
  if (!target) { console.error('Dépôt cible introuvable (dossier sans CNAME) : ' + candidates.join(' ou ')); process.exit(1); }
  if (check) {
    const d = diff(target);
    console.log(d.length ? 'Les deux dépôts diffèrent (' + d.length + ' fichier(s)) :\n  ' + d.join('\n  ') + '\nLance : node scripts/sync-landing.js' : 'Les deux dépôts sont identiques.');
    process.exit(d.length ? 1 : 0);
  }
  const done = sync(target);
  console.log(done.length ? 'Copié dans ' + target + ' :\n  ' + done.join('\n  ') : 'Déjà identique : ' + target);
}
module.exports = { sync, diff, redirectPage, REDIRECTS };
