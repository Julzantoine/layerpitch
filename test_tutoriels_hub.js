// La page « Tous les tutoriels » (tutoriels.js) doit rester alignée sur les leçons du Backstage (src/backstage/43-visite-guidee.js).
const fs = require('fs'), path = require('path');
let failures = 0;
const check = (l, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' - ' + l); if (!c) failures++; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const src = read('src/backstage/43-visite-guidee.js');
const real = [...src.matchAll(/^  \{ id: '([^']+)', theme: '([^']+)'([^\n]*?)titleKey: '(\w+)', descKey: '(\w+)'/gm)].map(m => ({ id: m[1], theme: m[2], adminOnly: /adminOnly: true/.test(m[3]), titleKey: m[4], descKey: m[5] }));
const w = {}; new Function('window', 'localStorage', read('tutoriels.js'))(w, { getItem: () => null });
const hub = w.LayerPitchTutorialsHub.LESSONS;
check('catalogue du Backstage lu (' + real.length + ' leçons)', real.length > 25);
check('mêmes leçons, même ordre', JSON.stringify(real.map(l => l.id)) === JSON.stringify(hub.map(l => l.id)));
check('mêmes thèmes, clés de texte et statut admin', JSON.stringify(real) === JSON.stringify(hub.map(l => ({ id: l.id, theme: l.theme, adminOnly: l.adminOnly, titleKey: l.titleKey, descKey: l.descKey }))));
const open = (src.match(/LESSON_THEMES_OPEN = \[([^\]]*)\]/)[1].match(/'(\w+)'/g) || []).map(s => s.replace(/'/g, ''));
check('thèmes ouverts identiques', JSON.stringify(open) === JSON.stringify(w.LayerPitchTutorialsHub.THEMES.filter(t => t.open).map(t => t.id)));
const i18n = read('layerpitch-i18n.js');
check('textes FR et EN présents pour chaque leçon visible', hub.every(l => [l.titleKey, l.descKey].every(k => (i18n.match(new RegExp('^      ' + k + ':', 'gm')) || []).length >= 2)));
check('boutons Tutoriel des démos pointent vers la page', /tutoriels\.html/.test(read('adreel-demo-tour.js')) && /id="demoTutoBtn" href="\.\/tutoriels\.html/.test(read('projet.html')));
process.exit(failures ? 1 : 0);
