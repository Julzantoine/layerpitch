// Protection par défaut des nouveaux morceaux (retour bêta 11/11, décision 12/11) : garde-fous de structure.
const fs = require('fs');
let failures = 0;
const check = (name, ok) => { console.log((ok ? 'OK   - ' : 'FAIL - ') + name); if (!ok) failures++; };
const pub = fs.readFileSync('src/backstage/42-publication.js', 'utf8');
const i = pub.indexOf("flagOpen('protect_by_default')");
check('publication : protection automatique derrière le feu vert protect_by_default', i > 0);
const block = pub.slice(i, pub.indexOf("log('Écriture en base : packs...')"));
check('publication : seulement les morceaux absents de la base (publishedCatalog), jamais les exemples ni les déjà protégés',
  /!publishedCatalog\.tracks\.has\(t\.id\)/.test(block) && /!isExample\(t\)/.test(block) && /!t\.protected/.test(block));
check('publication : une panne ne bloque pas (avertissement, pas d\'exception)', /'warn'/.test(block) && !/throw/.test(block));
check('publication : après l\'écriture des morceaux en base', pub.indexOf("morceau(x) OK.") > 0 && pub.indexOf("morceau(x) OK.") < i);
const mig = fs.readdirSync('supabase/migrations').filter(f => /protect_by_default_flag/.test(f));
check('migration du feu vert présente', mig.length === 1 && /'protect_by_default'/.test(fs.readFileSync('supabase/migrations/' + mig[0], 'utf8')));
const i18n = fs.readFileSync('layerpitch-i18n.js', 'utf8');
['protectingNewTrack', 'protectedNewTrack', 'protectNewTrackFailed', 'trackLockedTip'].forEach(k => check('i18n FR + EN : ' + k, (i18n.match(new RegExp('\\b' + k + ':', 'g')) || []).length === 2));
// « _ » gardés dans les titres, regroupement inchangé.
const engine = require('./layerpitch-import-engine.js');
check('titre : les « _ » du nom de fichier sont gardés', engine.titleFromFilename('My_Cool_Track.wav') === 'My_Cool_Track');
check('titre : jetons bpm/mesures retirés, « _ » gardés', engine.titleFromFilenameStrippingHints('Alt_Perc_120bpm_8M.wav') === 'Alt_Perc');
console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'Tout est bon.'));
process.exit(failures ? 1 : 0);
