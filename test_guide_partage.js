// Moteur de bulles guidées partagé (layerpitch-guide.js, 20/10) : marche seul sur une page quelconque, sans le Backstage ;
// vignettes de LIENS et de TEXTE (clavier / clic) -> champ de saisie rempli ou « drop » ordinaire envoyé à la zone.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dom = new JSDOM('<!doctype html><body><input id="name"><div id="zone" style="width:100px;height:40px">dépôt</div></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  // jsdom ne mesure rien : on donne une taille aux zones pour qu'elles comptent comme visibles.
  w.Element.prototype.getBoundingClientRect = function () { return { top: 10, left: 10, right: 110, bottom: 50, width: 100, height: 40 }; };
  w.eval(read('layerpitch-guide.js'));
  w.__events = [];
  w.eval(`
    const dict = { tourNext: 'Suivant', lessonDoIt: 'À toi', lessonQuit: 'Quitter', tourClose: 'Fermer', tourPrev: 'Précédent', tourFinish: 'Terminer', lessonDropHint: 'Glisse', lessonMoveHint: 'Déplacer' };
    window.G = LayerPitchGuide.create({ tr: (k, v) => dict[k] || k });
    window.steps = [
      { selector: '#name', titleKey: 'T1', textKey: 'X1', done: () => document.getElementById('name').value === 'Alone in the Barque',
        drops: [{ kind: 'text', label: 'Alone in the Barque', value: 'Alone in the Barque' }] },
      { selector: '#zone', titleKey: 'T2', textKey: 'X2', done: () => window.__dropped === 'https://youtu.be/abc',
        drops: [{ kind: 'link', label: 'Référence YouTube', value: 'https://youtu.be/abc' }] },
      { titleKey: 'T3', textKey: 'X3', final: true },
    ];
    document.getElementById('zone').addEventListener('drop', e => { e.preventDefault(); window.__dropped = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'); });
    G.open('lesson', steps, 'demo');
  `);
  check('la bulle s’ouvre sur la page sans le Backstage', !!w.document.querySelector('.tour-root-lesson .tour-card'));
  check('vignette de texte affichée', !!w.document.querySelector('.tour-chip-text [data-tour-drop], .tour-chip-text[data-tour-drop]'));
  const chip1 = w.document.querySelector('[data-tour-drop="0"]');
  chip1.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  check('le texte est écrit dans le champ en surbrillance', w.document.getElementById('name').value === 'Alone in the Barque');
  for (let i = 0; i < 30 && !/2 \/ 3/.test((w.document.querySelector('.tour-count') || {}).textContent || ''); i++) await wait(100);
  check('la leçon avance toute seule à l’étape 2', /2 \/ 3/.test(w.document.querySelector('.tour-count').textContent));
  check('vignette de lien affichée', !!w.document.querySelector('.tour-chip-link'));
  w.document.querySelector('[data-tour-drop="0"]').dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  check('le lien arrive à la zone comme un vrai dépôt (text/uri-list)', w.__dropped === 'https://youtu.be/abc');
  for (let i = 0; i < 30 && !/3 \/ 3/.test((w.document.querySelector('.tour-count') || {}).textContent || ''); i++) await wait(100);
  check('étape finale atteinte', /3 \/ 3/.test(w.document.querySelector('.tour-count').textContent));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Échap ferme la bulle', !w.document.querySelector('.tour-root'));
  check('plus aucune minuterie après fermeture', w.G.state() === null);
  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
