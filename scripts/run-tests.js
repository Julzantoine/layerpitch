#!/usr/bin/env node
// scripts/run-tests.js — lance tous les tests hors base de données (test_*.js et test-*.js à la racine) et résume.
//   npm test
// Les tests de scripts/test-*.js interrogent la VRAIE base (connexion .env) : ils ne sont pas lancés ici.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = fs.readdirSync(root).filter(f => /^test[_-].*\.js$/.test(f)).sort();
const failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [f], { cwd: root, encoding: 'utf8', timeout: 120000 });
  if (r.status === 0) { process.stdout.write('.'); continue; }
  failed.push(f);
  process.stdout.write('F');
  const out = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-6).join('\n    ');
  failed[failed.length - 1] = `${f}\n    ${out}`;
}
console.log(`\n${files.length - failed.length}/${files.length} fichiers de test OK`);
if (failed.length) { console.log('\nÉchecs :\n  ' + failed.join('\n  ')); process.exit(1); }
