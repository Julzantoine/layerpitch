// Bulle d'aide du bouton « Recalculer le niveau de tous les morceaux » (11/10) : le bouton porte data-help et la clé existe dans les deux
// langues, avec une explication de ce que fait le bouton.
const fs = require('fs');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const page = fs.readFileSync('layerpitch-backstage.html', 'utf8');
check('le bouton porte la bulle d\'aide', /id="btnRecomputeAllNormalization"[^>]*data-help="recomputeAllNormalization"/.test(page));
const sandbox = { window: {} };
new Function('window', fs.readFileSync('layerpitch-help.js', 'utf8'))(sandbox.window);
const H = sandbox.window.LAYERPITCH_HELP;
const fr = H.fr.library.recomputeAllNormalization, en = H.en.library.recomputeAllNormalization;
check('aide en français : dit ce que le bouton recalcule, et qu\'il ne publie rien', /recalcule/.test(fr) && /publie/.test(fr) && /Égaliser le niveau/.test(fr));
check('aide en anglais', /recalculates/.test(en) && /publish/.test(en));
process.exit(failures ? 1 : 0);
