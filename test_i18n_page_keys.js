// Chaque texte marqué data-i18n="clé" dans une page doit exister, en FR et en EN, dans une des sections
// de layerpitch-i18n.js que la fonction tr() de cette page lit vraiment (dict.<section>[key]).
// Né du 31/10 : bienvenue.html ne lisait que « welcome », pas « shared », et son bandeau cookies
// affichait en production les clés brutes (cookieBannerTitle, cookieBannerAccept…).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };

const root = __dirname;
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'layerpitch-i18n.js'), 'utf-8'), ctx);
const I18N = ctx.window.LAYERPITCH_I18N;

let pagesChecked = 0;
for (const f of fs.readdirSync(root).filter(n => n.endsWith('.html')).sort()) {
  const html = fs.readFileSync(path.join(root, f), 'utf-8');
  const sections = [...new Set([...html.matchAll(/dict\.(\w+)\s*&&\s*dict\.\1\[key\]/g)].map(m => m[1]))];
  // ${…} = clé fabriquée en JS dans un gabarit, pas une clé écrite dans la page.
  const keys = [...new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]))].filter(k => !k.includes('${'));
  if (!sections.length || !keys.length) continue;
  pagesChecked++;
  for (const lang of ['fr', 'en']) {
    const missing = keys.filter(k => !sections.some(s => I18N[lang][s] && I18N[lang][s][k] != null));
    check(`${f} (${lang}, sections ${sections.join('+')}) : toutes les clés data-i18n ont un texte`
      + (missing.length ? ` — manquent : ${missing.join(', ')}` : ''), missing.length === 0);
  }
}
check('au moins les pages principales sont vérifiées', pagesChecked >= 5);

// Le cas d'origine, explicitement : le bandeau cookies de bienvenue.html se traduit.
const bienvenue = fs.readFileSync(path.join(root, 'bienvenue.html'), 'utf-8');
check('bienvenue.html lit la section shared (bandeau cookies)', /dict\.shared\s*&&\s*dict\.shared\[key\]/.test(bienvenue));

if (failures) { console.log(`\n${failures} échec(s)`); process.exit(1); }
console.log('\nTout est OK');
