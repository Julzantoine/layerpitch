#!/usr/bin/env node
// scripts/bump-version.js — donne UN SEUL numéro de version anti-cache (?v=…) à tous les scripts locaux de toutes les
// pages HTML du site. À lancer après toute modification d'un fichier .js servi aux navigateurs, avant le commit :
//
//   node scripts/bump-version.js
//
// Pourquoi (revue du 24/09) : trois méthodes coexistaient -- numéro monté à la main sur certaines pages (oublié une
// fois sur deux), ?v=Date.now() pour les api/*.js (aucun cache possible), et aucune version du tout sur admin/
// mon-compte/bienvenue/library (copie périmée servie après une mise à jour). Désormais : ce script pour les balises
// <script src>, et les chargements à la demande (public-page.js, Backstage) réutilisent le numéro de la page.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const version = String(Date.now());
const pages = execSync('git ls-files "*.html"', { cwd: root }).toString().split('\n').filter(Boolean)
  .filter(f => !f.startsWith('vendor/') && !f.startsWith('video-engine-prototype/'));

let touchedPages = 0, touchedTags = 0;
for (const page of pages) {
  const file = path.join(root, page);
  const before = fs.readFileSync(file, 'utf8');
  // Balises <script src="…"> vers un fichier .js LOCAL (pas http(s)://, pas //cdn) : on remplace ou on ajoute ?v=.
  const after = before.replace(/(<script\b[^>]*\bsrc=")(?!https?:|\/\/)([^"?]+\.js)(\?v=[^"]*)?(")/g, (m, a, src, _v, z) => {
    touchedTags++;
    return `${a}${src}?v=${version}${z}`;
  });
  if (after !== before) { fs.writeFileSync(file, after); touchedPages++; }
}
console.log(`Version ${version} : ${touchedTags} balises dans ${touchedPages} pages.`);
