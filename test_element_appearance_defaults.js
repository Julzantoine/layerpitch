// Vérifie les utilitaires couleur du Chantier Apparence (réglage par élément, palier Pro, 05/09) :
// calcul du contraste WCAG AA (contrastRatio) et la variante atténuée par défaut (mutedVariant) utilisée
// pour la couleur "à jouer" avant toute personnalisation (point d'architecture 2 du chantier -- "ne pas
// livrer un état visuellement cassé tant que le compositeur n'a rien réglé"). Même harnais que
// test_backstage_content_nav_redesign.js : stripper les <script src> externes, stubber
// window.LayerPlayerCore, exécuter (i18n + script principal + assertions) en UN SEUL window.eval.
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
  WAVEFORM_STYLES: ['bars', 'mirror', 'dots', 'layers'],
  setWaveformStyle: () => {},
  SEQ_MAP_THEMES: ['light', 'dark'],
  setSeqMapTheme: () => {},
};
window.fetch = () => Promise.reject(new Error('network disabled in test'));
window.__failures = [];
window.__log = (ok, label) => { console.log((ok ? 'OK   - ' : 'FAIL - ') + label); if (!ok) window.__failures.push(label); };

const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8');

const assertions = `
function check(label, cond) { window.__log(!!cond, label); }

// ---- contrastRatio (WCAG AA) : cas connus vérifiables à la main ----
check('contraste noir/blanc = 21:1 (maximum théorique)', Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
check('contraste identique = 1:1 (minimum théorique)', Math.abs(contrastRatio('#336699', '#336699') - 1) < 0.01);
check('contraste symétrique (ordre des deux couleurs indifférent)', contrastRatio('#111111', '#eeeeee') === contrastRatio('#eeeeee', '#111111'));
check('contraste noir/blanc franchit le seuil AA texte (4.5:1)', contrastRatio('#000000', '#ffffff') >= WCAG_AA_TEXT_RATIO);
check('contraste de deux gris proches échoue le seuil AA texte', contrastRatio('#888888', '#999999') < WCAG_AA_TEXT_RATIO);

// ---- mutedVariant : variante atténuée, jamais identique ni opposée à l'originale ----
const muted = mutedVariant('#c9713c');
check('mutedVariant retourne un hex valide (#rrggbb)', /^#[0-9a-f]{6}$/.test(muted));
check('mutedVariant produit une couleur différente de l\\'originale', muted !== '#c9713c');
check('mutedVariant reste dans un contraste modéré avec l\\'originale (ni identique ni extrême)', contrastRatio(muted, '#c9713c') > 1 && contrastRatio(muted, '#c9713c') < 3);
const mutedDark = mutedVariant('#000000');
const mutedLight = mutedVariant('#ffffff');
check('mutedVariant rapproche le noir du gris neutre (plus clair que #000000)', hexToRgb(mutedDark).r > 0);
check('mutedVariant rapproche le blanc du gris neutre (plus sombre que #ffffff)', hexToRgb(mutedLight).r < 255);

// ---- Valeurs par défaut avant toute personnalisation (point d'architecture 2 du chantier) : la couleur
// "jouée" par défaut est alignée sur titleColor, la couleur "à jouer" par défaut en est une variante
// atténuée -- jamais deux couleurs identiques (état visuellement cassé : forme d'onde invisible).
const defaultTitleColor = '#1A1A1A';
const defaultPlayed = defaultTitleColor;
const defaultUnplayed = mutedVariant(defaultTitleColor);
check('valeurs par défaut waveform/progressBar : jouée alignée sur titleColor', defaultPlayed === defaultTitleColor);
check('valeurs par défaut waveform/progressBar : à jouer distincte de jouée (jamais invisible)', defaultUnplayed !== defaultPlayed);

// ---- ELEMENT_APPEARANCE_REGISTRY : structure minimale attendue par le reste du chantier ----
check('ELEMENT_APPEARANCE_REGISTRY couvre les 11 types de bloc', Object.keys(ELEMENT_APPEARANCE_REGISTRY).length === 11);
check('registre "tracks" contient bien les deux éléments à deux états', ELEMENT_APPEARANCE_REGISTRY.tracks.some(e => e.key === 'waveform' && e.type === 'twostate') && ELEMENT_APPEARANCE_REGISTRY.tracks.some(e => e.key === 'progressBar' && e.type === 'twostate'));
check('aucun élément à deux états en dehors du bloc "tracks" (hors périmètre du chantier ailleurs)', Object.entries(ELEMENT_APPEARANCE_REGISTRY).every(([type, entries]) => type === 'tracks' || entries.every(e => e.type !== 'twostate')));
`;

window.eval(i18nSrc + '\n' + mainScriptSrc + '\n' + assertions);

const failures = window.__failures.length;
console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
