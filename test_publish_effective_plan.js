// Vérifie la résolution du palier effectif utilisée par publishAll() avant de le figer dans data.json
// (Chantier Apparence Phase 3, 4 septembre) : les 4 cas free/starter/pro/essai actif. Teste la VRAIE
// fonction effectiveTierFromTrialStatus() extraite de layerpitch-backstage.html (regex + vm, pas une
// réimplémentation) -- publishAll() lui-même appelle de vrais RPC Supabase/GitHub et ne peut pas
// raisonnablement tourner dans ce test sans identifiants réels ; c'est pourquoi cette logique de
// résolution a délibérément été isolée dans sa propre fonction pure (voir plan de chantier).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf-8');
const match = src.match(/function effectiveTierFromTrialStatus\(status\) \{[\s\S]*?\n\}/);
if (!match) throw new Error('effectiveTierFromTrialStatus introuvable dans layerpitch-backstage.html -- ajuster ce test.');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(match[0] + '\nthis.effectiveTierFromTrialStatus = effectiveTierFromTrialStatus;', sandbox);
const effectiveTierFromTrialStatus = sandbox.effectiveTierFromTrialStatus;

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();

check('aucun profil compositeur -> free', effectiveTierFromTrialStatus(null) === 'free');
check('plan free, pas d\'essai -> free', effectiveTierFromTrialStatus({ plan: 'free', trialEndsAt: null }) === 'free');
check('plan starter, pas d\'essai -> starter', effectiveTierFromTrialStatus({ plan: 'starter', trialEndsAt: null }) === 'starter');
check('plan pro -> pro', effectiveTierFromTrialStatus({ plan: 'pro', trialEndsAt: null }) === 'pro');
check('plan free + essai actif -> pro (quotas boostés)', effectiveTierFromTrialStatus({ plan: 'free', trialEndsAt: future }) === 'pro');
check('plan starter + essai déjà expiré -> starter (pas de boost)', effectiveTierFromTrialStatus({ plan: 'starter', trialEndsAt: past }) === 'starter');
check('plan free + essai déjà expiré -> free (retombée automatique, pas pro)', effectiveTierFromTrialStatus({ plan: 'free', trialEndsAt: past }) === 'free');

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
