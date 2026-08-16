// Test de fumée jsdom — refonte hiérarchie/navigation/liste de blocs du backstage (session du 16/08).
// Pattern repris des autres suites jsdom du backstage : stripper les <script src> externes, stubber
// window.LayerPlayerCore, exécuter (i18n + script principal + assertions) en UN SEUL window.eval --
// des `let`/`const` de haut niveau déclarés dans des évals séparés ne partagent PAS le même scope
// lexical (vrai aussi dans un vrai navigateur, un script ne "voit" pas les `let` d'un autre script),
// d'où la concaténation en un seul bloc plutôt que plusieurs eval() successifs.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, 'layerpitch-backstage.html');
const raw = fs.readFileSync(HTML_PATH, 'utf8');

const scriptMatches = [...raw.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
const mainScriptSrc = scriptMatches
  .map(m => m[1])
  .filter(body => body.includes('window.LayerPlayerCore'))
  .join('\n');
if (!mainScriptSrc) throw new Error('Script principal introuvable dans layerpitch-backstage.html');

const htmlWithoutScripts = raw.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');

const dom = new JSDOM(htmlWithoutScripts, { url: 'https://example.invalid/backstage.html', runScripts: 'dangerously' });
const { window } = dom;

window.LayerPlayerCore = {
  buildTrackRow: () => window.document.createElement('div'),
  initTrackPlayer: () => {},
  layerHasSource: () => true,
  setLang: () => {},
  setSfxLibrary: () => {},
  shareOrCopy: async () => true,
};
window.fetch = () => Promise.reject(new Error('network disabled in test'));
window.__failures = [];
window.__log = (ok, label) => { console.log((ok ? 'OK   - ' : 'FAIL - ') + label); if (!ok) window.__failures.push(label); };

const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8');

const assertions = `
function check(label, cond) { window.__log(!!cond, label); }

// 1) Construction initiale (état seedé à la main, pas de dépendance au réseau).
blocks = [
  { id: 'b1', type: 'header' },
  { id: 'b2', type: 'tracks' },
  { id: 'b3', type: 'testimonials' },
  { id: 'b4', type: 'contact' },
];
profile.title = 'Julzantoine';
profile.subtitle = 'Game Music Composer';
trackIds = ['t1', 't2', 't3'];
testimonials = [{ text: 'a', author: 'A' }, { text: 'b', author: 'B' }];
rebuildAllCards();

check('4 cartes de blocs construites', document.querySelectorAll('.block-editor-card').length === 4);
check('aucune fleche move-up/move-down', document.querySelectorAll('[data-action="move-up"], [data-action="move-down"]').length === 0);
check('poignee de glisser-deposer presente sur chaque bloc', document.querySelectorAll('.block-drag-handle').length === 4);
check('position affichee au format compact "01"', document.querySelector('.block-editor-card[data-id="b1"] .pos').textContent === '01');

// 2) Resume compact par type de bloc.
check('resume Header = titre - sous-titre', document.querySelector('.block-editor-card[data-id="b1"] .block-summary').textContent === 'Julzantoine — Game Music Composer');
check('resume Musique = "3 morceaux"', document.querySelector('.block-editor-card[data-id="b2"] .block-summary').textContent === '3 morceaux');
check('resume Temoignages = "2 citations"', document.querySelector('.block-editor-card[data-id="b3"] .block-summary').textContent === '2 citations');
check('resume Contact signale le formulaire manquant par defaut', document.querySelector('.block-editor-card[data-id="b4"] .block-summary').textContent === 'Formulaire non configuré');

trackIds = ['t1'];
refreshAllBlockSummaries();
check('resume au singulier ("1 morceau")', document.querySelector('.block-editor-card[data-id="b2"] .block-summary').textContent === '1 morceau');

profile.formspreeEndpoint = 'https://formspree.io/f/xxxx';
refreshAllBlockSummaries();
check('resume Contact passe a "Email + formulaire" une fois configure', document.querySelector('.block-editor-card[data-id="b4"] .block-summary').textContent === 'Email + formulaire');

// 3) Tout replier / Tout deplier.
const collapseAllBtn = () => document.getElementById('btnToggleCollapseAllBlocks');
check('bouton "Tout replier" affiche initialement (tout est deplie)', collapseAllBtn().textContent === 'Tout replier');

collapseAllBtn().dispatchEvent(new Event('click', { bubbles: true }));
check('un clic replie tous les blocs', [...document.querySelectorAll('.block-editor-body')].every(b => b.classList.contains('collapsed')));
check('le libelle bascule en "Tout deplier"', collapseAllBtn().textContent === 'Tout déplier');

collapseAllBtn().dispatchEvent(new Event('click', { bubbles: true }));
check('un second clic deplie tous les blocs', [...document.querySelectorAll('.block-editor-body')].every(b => !b.classList.contains('collapsed')));
check('le libelle revient a "Tout replier"', collapseAllBtn().textContent === 'Tout replier');

document.querySelector('.block-editor-card[data-id="b1"] [data-action="toggle-collapse"]').dispatchEvent(new Event('click', { bubbles: true }));
check('repli d un seul bloc ne bascule pas le libelle global', collapseAllBtn().textContent === 'Tout replier');

// 4) Compteur de blocs.
check('compteur de blocs = "4 blocs"', document.getElementById('blocksCountLabel').textContent === '4 blocs');

// 5) Glisser-deposer : la poignee seule active draggable.
const card1 = document.querySelector('.block-editor-card[data-id="b1"]');
const handle1 = card1.querySelector('.block-drag-handle');
check('draggable=false avant tout pointerdown', card1.draggable === false);
handle1.dispatchEvent(new Event('pointerdown', { bubbles: true }));
check('draggable=true apres pointerdown sur la poignee', card1.draggable === true);
document.dispatchEvent(new Event('pointerup', { bubbles: true }));
check('draggable revient a false apres pointerup (n importe ou)', card1.draggable === false);

const titleEl = card1.querySelector('strong');
titleEl.dispatchEvent(new Event('pointerdown', { bubbles: true }));
check('pointerdown hors poignee n active jamais draggable', card1.draggable === false);

// 6) Reordonnancement effectif via drop.
blocks = [
  { id: 'x1', type: 'header' },
  { id: 'x2', type: 'tracks' },
  { id: 'x3', type: 'testimonials' },
];
rebuildAllCards();
draggedBlockId = 'x1';
const targetCard = document.querySelector('.block-editor-card[data-id="x3"]');
const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
Object.defineProperty(dropEvent, 'clientY', { value: 0 });
targetCard.dispatchEvent(dropEvent);
// jsdom ne calcule pas de vrai layout : getBoundingClientRect() renvoie top=0/height=0 pour toute
// carte, donc (clientY=0 - top=0) < height/2=0 est FAUX -> la logique classe ça comme "après la cible",
// pas "avant". C'est un artefact du test (pas de vrai layout en jsdom), pas un bug du code : en usage
// réel, height/2 > 0 et le calcul se comporte comme prévu (avant si le curseur est sur la moitié haute).
check('glisser-deposer reordonne bien le tableau blocks (x1 apres x3, valeur clientY=0 + rect nulle de jsdom)', blocks.map(b => b.id).join(',') === 'x2,x3,x1');

// 7) Audit du 16/08 -- drop sur l'espace vide du conteneur (pas sur une carte) : déplace en fin de liste.
blocks = [
  { id: 'y1', type: 'header' },
  { id: 'y2', type: 'tracks' },
  { id: 'y3', type: 'testimonials' },
];
rebuildAllCards();
draggedBlockId = 'y1';
const container = document.getElementById('blocksEditorContainer');
const emptySpaceDrop = new Event('drop', { bubbles: true, cancelable: true });
Object.defineProperty(emptySpaceDrop, 'target', { value: container });
container.dispatchEvent(emptySpaceDrop);
check('drop sur l espace vide du conteneur deplace le bloc en fin de liste', blocks.map(b => b.id).join(',') === 'y2,y3,y1');

// 8) Audit du 16/08 -- hasContactFormEndpoint() : un seul point de vérité pour le statut du formulaire.
profile.formspreeEndpoint = '';
check('hasContactFormEndpoint() = false sans endpoint', hasContactFormEndpoint() === false);
profile.formspreeEndpoint = 'https://formspree.io/f/abcd';
check('hasContactFormEndpoint() = true avec un endpoint renseigné', hasContactFormEndpoint() === true);
`;

window.eval(i18nSrc + '\n' + mainScriptSrc + '\n' + assertions);

console.log('');
if (window.__failures.length > 0) {
  console.log(window.__failures.length + ' echec(s).');
  process.exit(1);
} else {
  console.log('Tous les tests sont passes.');
}
