// Aperçus « Ce qu’on va construire » (02/11, layerpitch-lesson-previews.js) : chaque leçon dessinée a son texte de bulle, chaque mot
// du dessin existe en FR et en EN (zone shared de layerpitch-i18n.js), et les pages qui jouent les leçons chargent le module.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const root = __dirname;

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'layerpitch-i18n.js'), 'utf-8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'layerpitch-lesson-previews.js'), 'utf-8'), ctx);
const I18N = ctx.window.LAYERPITCH_I18N, PV = ctx.window.LayerPitchLessonPreviews;

const ids = ['static', 'embranchement', 'additive', 'random', 'sequential', 'branching', 'sfx', 'events',
  'adreel-intro', 'adreel', 'appearance', 'share', 'tracking', 'pack', 'embed', 'album', 'upload',
  'pj-create', 'pj-chat', 'pj-moodboard', 'pj-music', 'pj-map-build', 'pj-map-music', 'pj-map-walk'];
check('24 leçons ont un schéma (la leçon hybride garde sa carte)', ids.every(id => PV.has(id)) && !PV.has('hybrid'));

for (const lang of ['fr', 'en']) {
  const missing = new Set();
  const tr = (k, vars) => {
    let s = I18N[lang].shared[k];
    if (s == null) { missing.add(k); return k; }
    if (vars) Object.keys(vars).forEach(v => { s = s.split('{' + v + '}').join(vars[v]); });
    return s;
  };
  tr('glTitle');
  const doc = new JSDOM('').window.document;
  let broken = [];
  for (const id of ids) {
    const html = PV.html(id, tr);
    const host = doc.createElement('div'); host.innerHTML = html;
    const svg = host.querySelector('svg.tour-map-preview');
    if (!svg || !svg.getAttribute('aria-label') || svg.querySelectorAll('text').length < 2 || /undefined|NaN/.test(html)) broken.push(id);
  }
  check(`${lang} : chaque schéma est un dessin complet, décrit pour les lecteurs d’écran`, broken.length === 0 || console.log('   ', broken));
  check(`${lang} : tous les textes des schémas existent` + (missing.size ? ' — manquent : ' + [...missing].join(', ') : ''), missing.size === 0);
}

for (const f of ['layerpitch-backstage.html', 'projet.html', 'projets.html']) {
  const html = fs.readFileSync(path.join(root, f), 'utf-8');
  const guide = html.indexOf('layerpitch-guide.js'), pv = html.indexOf('layerpitch-lesson-previews.js');
  check(`${f} charge le module des schémas`, pv > 0 && guide > 0);
}
const projet = fs.readFileSync(path.join(root, 'projet-lecons.js'), 'utf-8');
check('projet-lecons.js glisse la bulle après l’accueil et affiche le schéma', /PV\.step\(id\)/.test(projet) && /cardExtras:.*PV\.html/.test(projet));

if (failures) { console.log(`\n${failures} échec(s)`); process.exit(1); }
console.log('\nTous les tests passent.');
