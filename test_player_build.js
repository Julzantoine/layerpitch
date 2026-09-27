// player.js est fabriqué à partir de src/player/ (dette S4, 27/09) : il doit correspondre exactement à ses sources.
// Échoue si quelqu'un a modifié player.js à la main (la modification serait perdue au prochain build) ou oublié
// `npm run build-player` après avoir modifié src/player/.
const { spawnSync } = require('child_process');
const path = require('path');
const r = spawnSync(process.execPath, [path.join(__dirname, 'scripts', 'build-player.js'), '--check'], { encoding: 'utf8' });
console.log((r.status === 0 ? 'OK  ' : 'FAIL') + ' - ' + (r.stdout || r.stderr).trim());
process.exit(r.status === 0 ? 0 : 1);
