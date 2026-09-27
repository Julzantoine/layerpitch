// player.js et layerpitch-backstage.html sont fabriqués à partir de src/player/ et src/backstage/ (dette S4, 27/09) :
// ils doivent correspondre exactement à leurs sources. Échoue si l'un a été modifié à la main (la modification serait
// perdue au prochain build) ou si `npm run build` a été oublié après une modification des sources.
const { build, TARGETS } = require('./scripts/build-sources.js');
let failures = 0;
Object.keys(TARGETS).forEach(n => { const r = build(n, true); console.log((r.ok ? 'OK  ' : 'FAIL') + ' - ' + r.msg); if (!r.ok) failures++; });
process.exit(failures ? 1 : 0);
