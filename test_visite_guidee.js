// Visite guidée du Backstage (08/10) : chaque étape pointe une zone qui existe, les textes existent en FR et EN,
// le feu vert est déclaré en base et branché, le menu du compte propose de relancer la visite.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

const tour = read('src/backstage/43-visite-guidee.js');
const page = read('layerpitch-backstage.html');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(read('layerpitch-i18n.js'), sandbox);
const I18N = sandbox.window.LAYERPITCH_I18N;

const stepsSrc = tour.match(/const TOUR_STEPS = \[([\s\S]*?)\n\];/)[1];
const selectors = [...stepsSrc.matchAll(/selector: '([^']+)'/g)].map(m => m[1]);
const keys = [...stepsSrc.matchAll(/(?:titleKey|textKey): '([^']+)'/g)].map(m => m[1]);
check('au moins 5 étapes ciblées', selectors.length >= 5);
selectors.forEach(sel => {
  const id = sel.match(/^#(\w+)$/);
  const tab = sel.match(/data-tab="(\w+)"/);
  check('zone ciblée présente dans la page : ' + sel, id ? page.includes('id="' + id[1] + '"') : page.includes('data-tab="' + tab[1] + '"'));
});
['fr', 'en'].forEach(lang => {
  const dict = I18N[lang].backstage;
  const all = keys.concat(['tourSkip', 'tourClose', 'tourPrev', 'tourNext', 'tourFinish', 'accountMenuTour']);
  check('textes présents en ' + lang, all.every(k => dict[k]));
});
check('feu vert déclaré en base', read('supabase/migrations/20261008030000_in_app_tour_flag.sql').includes("'in_app_tour'"));
check('feu vert branché sur l’affichage', read('src/backstage/14-connexion-abonnement-admin.js').includes('syncBackstageTour') && tour.includes("flagOpen('in_app_tour')"));
check('entrée du menu du compte masquée par défaut', /id="accountMenuTour" type="button" hidden/.test(page));
check('page fabriquée contient la visite', page.includes('function startBackstageTour'));
process.exit(failures ? 1 : 0);
