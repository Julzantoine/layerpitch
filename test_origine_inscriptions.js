// Origine des inscriptions (15/11) : chaque formulaire de demande d'accès envoie les étiquettes du lien (utm_*),
// les pages d'entrée sans formulaire les retiennent, et la fonction les nettoie avant de les enregistrer.
const fs = require('fs');
const path = require('path');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

for (const f of ['nouvelle-landing/compositeurs.html', 'nouvelle-landing/studios.html', 'nouvelle-landing/en/composers.html', 'nouvelle-landing/en/studios.html']) {
  const h = read(f);
  check(`${f} : envoie ...lpOrigin() avec la demande`, /JSON\.stringify\(\{ email:[^\n]*\.\.\.lpOrigin\(\) \}\)/.test(h));
  check(`${f} : retient les étiquettes (sessionStorage lp_origin)`, /sessionStorage\.setItem\('lp_origin'/.test(h));
}
for (const f of ['nouvelle-landing/index.html', 'nouvelle-landing/en/index.html']) {
  check(`${f} : retient les étiquettes à l'arrivée`, /sessionStorage\.setItem\('lp_origin'/.test(read(f)));
}
const fn = read('supabase/functions/submit-access-request/index.ts');
check('fonction : lit utm_source / utm_medium / utm_campaign', /utm_source, utm_medium, utm_campaign \} = await req\.json\(\)/.test(fn));
check('fonction : nettoie (caractères simples, 80 max) et enregistre', /cleanTag/.test(fn) && /\.slice\(0, 80\)/.test(fn) && /utm_campaign: v_utm_campaign/.test(fn));
const mig = read('supabase/migrations/20261115010000_access_requests_origin.sql');
check('migration : 3 colonnes facultatives limitées à 80 caractères', ['utm_source', 'utm_medium', 'utm_campaign'].every(c => new RegExp(`add column ${c}\\s+text check`).test(mig) || mig.includes(c)) && /<= 80/.test(mig));
process.exit(failures ? 1 : 0);
