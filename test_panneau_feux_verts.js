// Panneau « Feux verts » du Backstage (08/10) : réservé aux admins, lit feature_flags, change via set_feature_released
// avec confirmation, aucune nouvelle table ni fonction.
const fs = require('fs');
const path = require('path');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const js = read('src/backstage/44-panneau-feux-verts.js');
const page = read('layerpitch-backstage.html');
const admin = read('src/backstage/14-connexion-abonnement-admin.js');
check('panneau présent, caché par défaut', /<fieldset id="panelFeatureFlags" hidden>/.test(page));
check('panneau dans la liste des panneaux admin', /ADMIN_ONLY_PANEL_IDS = \[[^\]]*'panelFeatureFlags'/.test(admin));
check('chargement déclenché pour les admins seulement', /if \(isAdmin\) \{[^}]*loadFeatureFlagsPanel/.test(admin));
check('lecture de la table feature_flags', js.includes(".from('feature_flags')"));
check('changement via set_feature_released', js.includes("rpc('set_feature_released', { p_key: key, p_released: open })"));
check('confirmation avant changement', /await window\.LayerPitchNotify\.confirm\(msg/.test(js));
check('page fabriquée contient le panneau', page.includes('function toggleFeatureFlag'));
process.exit(failures ? 1 : 0);
