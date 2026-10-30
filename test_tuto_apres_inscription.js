// test_tuto_apres_inscription.js — après une inscription compositeur, le tutoriel public est proposé par une fenêtre et dans le mail (30/10).
const fs = require('fs');
let failed = 0;
function check(label, ok) { console.log((ok ? 'OK   ' : 'FAIL ') + label); if (!ok) failed++; }

const pages = { 'landing.html': 'fr', 'landing-en.html': 'en', 'nouvelle-landing/compositeurs.html': 'fr', 'nouvelle-landing/en/composers.html': 'en' };
for (const [file, lang] of Object.entries(pages)) {
  const h = fs.readFileSync(file, 'utf8');
  check(file + ' : fenêtre ouverte après un envoi réussi', /form\.innerHTML = [^\n]*\n[^\n]*tutoPopupTitle[^\n]*\n\s*tutoPopup\.showModal\(\);/.test(h));
  check(file + ' : lien vers le tutoriel dans la bonne langue', h.includes('layerpitch-backstage.html?tuto&amp;lang=' + lang));
  check(file + ' : la fenêtre se ferme sans suivre le lien', h.includes('id="tutoPopupLater"'));
}

const fn = fs.readFileSync('supabase/functions/submit-access-request/index.ts', 'utf8');
check('mail : emplacement du tutoriel présent en français et en anglais', (fn.match(/\{\{TUTORIAL\}\}/g) || []).length === 3); // 2 gabarits + le remplacement
check('mail : tutoriel dans les deux langues', /&amp;lang=fr/.test(fn) && /&amp;lang=en/.test(fn));
check('mail : pas de tutoriel pour un studio ni depuis le tutoriel', /offerTutorial = v_intent !== 'studio' && !\(v_message && v_message\.startsWith\('Depuis le tutoriel'\)\)/.test(fn));
const guide = fs.readFileSync('layerpitch-guide.js', 'utf8');
check('mail : le préfixe attendu est bien celui envoyé par le tutoriel', guide.includes("message: 'Depuis le tutoriel"));

if (failed) { console.error(failed + ' échec(s)'); process.exit(1); }
