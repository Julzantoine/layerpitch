#!/usr/bin/env node
// scripts/run-tests.js — lance tous les tests hors base de données (test_*.js et test-*.js à la racine) et résume.
//   npm test
// Les tests de scripts/test-*.js interrogent la VRAIE base (connexion .env) : ils ne sont pas lancés ici.
// Les fichiers de test sont indépendants : ils tournent en parallèle (un par cœur du processeur, 27/10), ce qui divise
// la durée totale ; TEST_JOBS=1 pour revenir à un seul à la fois.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const files = fs.readdirSync(root).filter(f => /^test[_-].*\.js$/.test(f)).sort();
const jobs = Math.max(1, Number(process.env.TEST_JOBS) || os.cpus().length);
const failed = [];

function runOne(f) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [f], { cwd: root });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) { process.stdout.write('.'); return resolve(); }
      process.stdout.write('F');
      // Les lignes « FAIL » d'abord (elles peuvent être loin du bas de la sortie), puis les dernières lignes.
      const lines = out.trim().split('\n');
      const fails = lines.filter(l => /^FAIL\b/.test(l));
      failed.push(`${f}\n    ${fails.concat(fails.length ? ['…'] : [], lines.slice(-6)).join('\n    ')}`);
      resolve();
    });
  });
}

(async () => {
  const queue = files.slice();
  await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await runOne(queue.shift()); }));
  failed.sort();
  console.log(`\n${files.length - failed.length}/${files.length} fichiers de test OK`);
  if (failed.length) { console.log('\nÉchecs :\n  ' + failed.join('\n  ')); process.exit(1); }
})();
