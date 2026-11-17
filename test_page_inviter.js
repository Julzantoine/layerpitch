// Page « Inviter » (17/11) : e-mails + destination (Projet / équipe studio). Garde-fous : elle réutilise les
// fonctions d'invitation existantes (aucune règle de droit dupliquée), le menu y mène derrière le feu vert
// « projects », et ses textes existent en FR et EN.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const root = __dirname;
const page = fs.readFileSync(path.join(root, 'inviter.html'), 'utf-8');
const shell = fs.readFileSync(path.join(root, 'layerpitch-shell.js'), 'utf-8');
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'layerpitch-i18n.js'), 'utf-8'), ctx);
const I = ctx.window.LAYERPITCH_I18N;

check('la page réutilise LayerPitchProjects.invite', /LayerPitchProjects\.invite\(/.test(page));
check('la page réutilise LayerPitchStudio.inviteTeamMember', /LayerPitchStudio\.inviteTeamMember\(/.test(page));
check('les relances passent par les fonctions existantes', /resendInvite\(/.test(page) && /resendTeamInvitation\(/.test(page));
check('seuls les Projets dont on est admin sont proposés', /p\.role === 'admin'/.test(page));
check("l'équipe n'est proposée qu'au propriétaire", /team\.isOwner && team\.allowed/.test(page));
check('derrière le feu vert projects', /flags\.projects/.test(page));
check('le menu mène à inviter.html derrière le feu vert projects', /ctx\.flags\.projects\) common\.push\(\{ id: 'inviter'/.test(shell));
for (const lang of ['fr', 'en']) {
  const keys = [...new Set([...page.matchAll(/tr\('(\w+)'/g)].map(m => m[1]).concat([...page.matchAll(/data-i18n="(\w+)"/g)].map(m => m[1])))];
  const missing = keys.filter(k => !(I[lang].inviter && I[lang].inviter[k] != null) && !(I[lang].shared && I[lang].shared[k] != null));
  check(`${lang} : toutes les clés de la page existent` + (missing.length ? ' — manquent : ' + missing.join(', ') : ''), !missing.length);
  check(`${lang} : entrée de menu item_inviter`, Object.values(I[lang]).some(s => s && s.item_inviter));
}
if (failures) { console.log(`\n${failures} échec(s)`); process.exit(1); }
console.log('\nTout est OK');
