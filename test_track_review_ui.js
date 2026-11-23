// Relecture client d'un morceau (23/11) : garde-fous de branchement entre la page du client, le lecteur, le Backstage, la cloche et
// l'e-mail. Le comportement en base est couvert par test_track_review.js.
const fs = require('fs');
let failures = 0;
const check = (name, ok) => { console.log((ok ? 'OK   - ' : 'FAIL - ') + name); if (!ok) failures++; };
const read = f => fs.readFileSync(f, 'utf8');

const page = read('relecture.html');
check('page : le genre du lien (vidéo ou morceau) vient de get_review_access', /rpc\('get_review_access'/.test(page) && /access\.kind === 'track'/.test(page));
check('page : le lecteur n\'est chargé que pour un morceau', /async function loadPlayer\(\)/.test(page) && !/<script src="player\.js/.test(page));
check('page : la preuve du lien est posée pour les morceaux protégés', /window\.LpReviewProof = \{ slug: SLUG, secret: SECRET \}/.test(page));
check('page : une remarque part avec l\'état du lecteur', /rpc\('add_track_review_comment', \{[^}]*p_state: st/.test(page) && /lpReview\.state\(\)/.test(page));
check('page : « Écouter ici » remet le lecteur dans l\'état', /row\.lpReview\.apply\(c\.state\)/.test(page));
check('page : le compositeur est prévenu après une remarque et en quittant la page (envoi qui survit à la fermeture)',
  /notifyOwner\(false\)/.test(page) && /visibilityState === 'hidden' && posted\) notifyOwner\(true\)/.test(page) && /keepalive: true/.test(page) && /review-notify/.test(page));

const player = ['src/player/32-pause-reprise-lecture.js', 'src/player/34-sequentiel-hybride.js'].map(read).join('\n');
check('lecteur : chaque lecteur expose lpReview.state / apply', (player.match(/wrapper\.lpReview = \{/g) || []).length === 2);
check('lecteur : la remise en place passe par la reprise exacte après pause', /pausedResume = \{ kind: 'sequential'/.test(player) && /pausedResume = \{ kind: 'embrVert'/.test(player) && /pausedResume = \{ kind: 'verticalRandom'/.test(player));
check('lecteur : la preuve de relecture est envoyée à track-audio-url', /body\.review = \{ slug: rp\.slug, secret: rp\.secret \}/.test(read('src/player/02a-audio-protege.js')));
check('track-audio-url : accepte la preuve de relecture', /can_hear_track_by_review/.test(read('supabase/functions/track-audio-url/index.ts')) && /can_hear_sfx_by_review/.test(read('supabase/functions/track-audio-url/index.ts')));

const panel = read('src/backstage/35b-relecture-client.js');
check('Backstage : bouton derrière le feu vert track_review, repère ADMIN tant qu\'il est fermé', /flagOpen\('track_review'\)/.test(panel) && /lp-admin-only/.test(panel));
check('Backstage : un lien par client (liste, création sans identifiant, suppression)', /list_track_review_links/.test(panel) && /set\(null, \{/.test(panel) && /delete_track_review_link/.test(panel));
check('Backstage : remarques rangées par lien', /c\.linkId === id/.test(panel));
check('Backstage : « Écouter dans cet état » ouvre l\'aperçu sans lecture automatique puis remet l\'état', /togglePreview\(ti, cardEl, \{ autoplay: false \}\)/.test(panel) && /row\.lpReview\.apply\(comment\.state\)/.test(panel));
check('Backstage : la lecture automatique de l\'aperçu peut être coupée', /!\(opts && opts\.autoplay === false\)/.test(read('src/backstage/16-bibliotheque-de-morceaux.js')));
check('Backstage : le texte de l\'état est le même que sur la page du client', /LayerPitchReviewState\.describe/.test(panel) && /layerpitch-review-state\.js/.test(read('src/backstage/03-ecran-et-scripts.html')) && /layerpitch-review-state\.js/.test(page));

const shell = read('layerpitch-shell.js');
check('cloche : les remarques reçues (morceaux et vidéos) y apparaissent', /client\.rpc\('my_review_updates'\)/.test(shell) && /review=' \+ encodeURIComponent\(u\.targetId\)/.test(shell));
const fn = read('supabase/functions/review-notify/index.ts');
check('e-mail : rien n\'est cru du client, le serveur choisit (claim) et rend les avis en cas d\'échec', /claim_review_notices/.test(fn) && /release_review_notices/.test(fn) && !/body\.(email|to|owner)/.test(fn));

console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
process.exit(failures ? 1 : 0);
