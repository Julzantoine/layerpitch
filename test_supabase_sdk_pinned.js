// SDK Supabase du navigateur figé (13/11) : `supabase-js@2` flottant laissait chaque navigateur garder une copie en cache de n'importe quelle
// version 2.x. Jusqu'à la 2.105, deux onglets du même site se bloquaient (verrou de session entre onglets, 5 s d'attente à chaque appel) :
// l'admin restait blanche tant qu'un autre onglet (Backstage) tenait le verrou. Depuis la 2.110 il n'y a plus d'attente (vérifié à la main
// le 13/11 avec un onglet gardant le verrou : 2.119.0 répond en 2 ms). Toutes les pages doivent donc charger une version précise ≥ 2.110.
const fs = require('fs');
const path = require('path');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; };
const SKIP = new Set(['node_modules', '.git', '.claude', 'functions', 'vendor']);
const hits = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(dir, e.name)); continue; }
    if (!/\.(html|js|mjs)$/.test(e.name) || /^test[_-]/.test(e.name)) continue;
    const p = path.join(dir, e.name);
    const s = fs.readFileSync(p, 'utf8');
    for (const m of s.matchAll(/supabase-js@([0-9][0-9.]*)?([^\s"'`]*)/g)) hits.push({ file: path.relative(__dirname, p), version: m[1] || '' });
  }
})(__dirname);
check('au moins une page charge le SDK Supabase', hits.length > 0);
const floating = hits.filter(h => !/^\d+\.\d+\.\d+$/.test(h.version));
check('aucune page ne charge un SDK « flottant » (@2) : ' + (floating.map(h => h.file).join(', ') || 'ok'), floating.length === 0);
const ge = v => { const [a, b] = v.split('.').map(Number); return a > 2 || (a === 2 && b >= 110); };
const old = hits.filter(h => /^\d+\.\d+\.\d+$/.test(h.version) && !ge(h.version));
check('toutes les versions figées sont ≥ 2.110 (sans verrou entre onglets) : ' + (old.map(h => h.file + '@' + h.version).join(', ') || 'ok'), old.length === 0);
check('une seule version dans tout le site (pas de mélange)', new Set(hits.map(h => h.version)).size === 1);
process.exit(failures ? 1 : 0);
