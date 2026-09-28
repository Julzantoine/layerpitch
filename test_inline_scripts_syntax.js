// Filet de sécurité (28/09) : aucune page ne doit contenir un script inline qui ne se lit même pas (erreur de syntaxe =
// page blanche, sans qu'aucun autre test ne s'en aperçoive si la page n'a pas de test dédié). Vérifie tous les <script>
// inline de toutes les pages .html de la racine (fichiers fabriqués compris), sans les exécuter.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let failures = 0, count = 0;
for (const f of fs.readdirSync(__dirname).filter(n => n.endsWith('.html')).sort()) {
  const html = fs.readFileSync(path.join(__dirname, f), 'utf-8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/\bsrc=/.test(m[0].slice(0, m[0].indexOf('>'))) && !/type="(application\/ld\+json|module|text\/template)"/.test(m[0].slice(0, m[0].indexOf('>'))))
    .map(m => m[1]).filter(s => s.trim());
  scripts.forEach((src, i) => {
    count++;
    try { new vm.Script(src, { filename: `${f} (script ${i + 1})` }); }
    catch (e) { failures++; console.log(`FAIL - ${f}, script inline n°${i + 1} : ${e.message}`); }
  });
}
console.log(failures ? `\n${failures} CHECK(S) FAILED` : `OK   - ${count} scripts inline lisibles\n\nALL CHECKS PASSED`);
process.exit(failures ? 1 : 0);
