// Sécurité (audit du 16/11, I2) : le webhook Stripe ignore tout événement venu du compte Stripe d'un compositeur (adresse
// « comptes connectés » ou event.account), sauf account.updated — sinon un compositeur pourrait fabriquer chez lui un
// paiement portant nos métadonnées et se faire créditer. Contrôles de texte (la fonction tourne sur Deno, hors de ce banc).
const fs = require('fs'), path = require('path');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const wh = fs.readFileSync(path.join(__dirname, 'supabase/functions/stripe-webhook/index.ts'), 'utf8');
const guard = wh.indexOf("if ((viaConnectEndpoint || event.account) && event.type !== 'account.updated')");
check('garde présente', guard > 0);
check('l\'adresse « comptes connectés » est repérée', /connectSecret\);\s*viaConnectEndpoint = true;/.test(wh));
const handlers = [...wh.matchAll(/if \(event\.type === '([^']+)'\)/g)];
check('garde placée avant TOUS les traitements d\'événements', handlers.length >= 5 && handlers.every(m => m.index > guard));
check('la garde répond 200 (Stripe ne réessaie pas)', /ignored: 'connected-account event'/.test(wh.slice(guard, guard + 400)) && !/status: 4\d\d/.test(wh.slice(guard, guard + 400)));
const cs = fs.readFileSync(path.join(__dirname, 'supabase/functions/create-checkout-session/index.ts'), 'utf8');
check('nos ventes restent des paiements « à destination » (arrivent sur l\'adresse principale)', /transfer_data: \{ destination/.test(cs) && !/stripeAccount/.test(cs));
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
