// Verrou des leçons (layerpitch-guide.js, 18/11) : pendant une leçon, un geste hors de la zone en surbrillance est refusé ;
// sur une étape de dépôt de fichiers, les boutons d'ajout/suppression de la zone le sont aussi (retour testeur : boucles créées à la main
// avant le dépôt = ordre inversé). Jamais verrouillé : visite guidée, étape finale, fenêtre modale, cible introuvable.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

function setup(kind, steps) {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="out">hors zone</button>
    <div id="zone"><div class="item" id="item">boucle</div><button id="add" data-action="add-embr-loop">+ Boucle</button><button id="other" data-action="preview-track">Écouter</button></div>
    <input id="field">
    <dialog open><button id="modalBtn">Appliquer</button></dialog></body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.Element.prototype.getBoundingClientRect = function () { return { top: 10, left: 10, right: 110, bottom: 50, width: 100, height: 40 }; };
  w.eval(read('layerpitch-guide.js'));
  w.__lpGuideTrustAll = true;
  w.eval(`window.G = LayerPitchGuide.create({ tr: (k) => k }); window.steps = (${steps}); G.open('${kind}', steps, 'demo');`);
  return w;
}
// renvoie true si le clic a été refusé (preventDefault)
function clickRefused(w, sel) {
  const el = w.document.querySelector(sel);
  const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
}

let w = setup('lesson', `[
  { selector: '#field', titleKey: 'A', textKey: 'a', done: () => false },
  { selector: '#zone', useSample: true, titleKey: 'B', textKey: 'b', done: () => false },
  { selector: '#zone', titleKey: 'C', textKey: 'c' },
  { titleKey: 'W', textKey: 'w' },
  { titleKey: 'F', textKey: 'f', final: true },
]`);
check('étape 1 : un clic hors de la zone en surbrillance est refusé', clickRefused(w, '#out'));
check('étape 1 : un clic dans la zone en surbrillance passe', !clickRefused(w, '#field'));
check('étape 1 : un clic dans la bulle passe', !clickRefused(w, '.tour-card'));
check('étape 1 : un clic dans une fenêtre modale ouverte passe', !clickRefused(w, '#modalBtn'));
check('un clic refusé affiche la note « pas maintenant »', !!w.document.querySelector('.tour-locknote'));
w.G.go(1);
check('étape de dépôt : le bouton « + Boucle » de la zone est refusé', clickRefused(w, '#add'));
check('étape de dépôt : un autre bouton de la zone (Écouter) passe', !clickRefused(w, '#other'));
check('étape de dépôt : un élément de la zone passe', !clickRefused(w, '#item'));
check('étape de dépôt : un clic hors zone est refusé', clickRefused(w, '#out'));
w.G.go(1);
check('étape sans dépôt : les boutons de la zone passent', !clickRefused(w, '#add'));
w.G.go(1);
check('étape sans zone désignée (accueil) : tout est refusé hors bulle', clickRefused(w, '#out'));
w.G.go(1);
check('étape finale (jeu libre) : rien n’est refusé', !clickRefused(w, '#out'));

w = setup('lesson', `[ { selector: '#nowhere', titleKey: 'A', textKey: 'a' }, { titleKey: 'F', textKey: 'f', final: true } ]`);
check('cible introuvable : on ne piège pas la personne', !clickRefused(w, '#out'));

w = setup('lesson', `[ { selector: '#zone', block: ['#other'], titleKey: 'A', textKey: 'a' }, { titleKey: 'F', textKey: 'f', final: true } ]`);
check('`block` : un sélecteur exclu dans la zone est refusé', clickRefused(w, '#other'));
check('`block` : le reste de la zone passe', !clickRefused(w, '#add'));

w = setup('tour', `[ { selector: '#zone', titleKey: 'A', textKey: 'a' }, { titleKey: 'F', textKey: 'f', final: true } ]`);
check('visite guidée (pas une leçon) : jamais verrouillée', !clickRefused(w, '#out'));

w = setup('lesson', `[ { selector: '#zone', titleKey: 'A', textKey: 'a', free: true }, { titleKey: 'F', textKey: 'f', final: true } ]`);
check('`free` : étape sans verrou', !clickRefused(w, '#out'));

w = setup('lesson', `[ { selector: '#zone', titleKey: 'A', textKey: 'a' }, { titleKey: 'F', textKey: 'f', final: true } ]`);
w.__lpGuideTrustAll = false; // geste non réel (ex. « Auto » de l'admin) : jamais refusé
check('geste non réel : jamais refusé', !clickRefused(w, '#out'));
w.G.close();
check('à la fermeture, plus aucun verrou', !clickRefused(w, '#out'));
w.__lpGuideTrustAll = true;
check('à la fermeture (verrou actif), plus aucun verrou', !clickRefused(w, '#out'));

if (failures) { console.log('\n' + failures + ' échec(s)'); process.exit(1); }
console.log('\nTous les tests passent');
process.exit(0); // les minuteurs des bulles (jsdom) garderaient le processus ouvert
