// Vérifie le "départ rapide" par preset sur le palier Pro (10 septembre) : contrairement à la galerie
// Free (qui écrit profile.theme.presetId), un clic Pro doit copier les valeurs CONCRÈTES du preset dans
// les champs éditables normaux (bgColor/titleColor/contentColor/font/separator) -- aucun presetId
// écrit, le compositeur reste ensuite libre de tout retoucher comme s'il avait choisi ces valeurs à la
// main. Vérifie aussi les 6 thèmes supplémentaires réservés au Pro (THEME_PRESETS_PRO, ajoutés le 10
// septembre) : résolus via resolveAnyThemePreset() (12 presets), jamais via resolveThemePreset() (reste
// à 6, lecture Free/rendu public inchangée). Extrait les VRAIES fonctions de layerpitch-backstage.html
// via regex + vm, pas une réimplémentation -- backstage.html dans son ensemble (auth, Supabase,
// Postgres) est trop lourd à faire tourner tel quel dans un test unitaire, donc seules ces fonctions
// pures sont isolées (même principe que test_publish_effective_plan.js pour effectiveTierFromTrialStatus).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf-8');

function extract(re, label) {
  const m = src.match(re);
  if (!m) throw new Error(label + ' introuvable dans layerpitch-backstage.html -- ajuster ce test.');
  return m[0];
}

const themePresetsSrc = extract(/const THEME_PRESETS = \[[\s\S]*?\n\];/, 'THEME_PRESETS');
const resolvePresetSrc = extract(/function resolveThemePreset\(presetId\) \{[\s\S]*?\n\}/, 'resolveThemePreset');
const themePresetsProSrc = extract(/const THEME_PRESETS_PRO = \[[\s\S]*?\n\];/, 'THEME_PRESETS_PRO');
const resolveAnyPresetSrc = extract(/function resolveAnyThemePreset\(presetId\) \{[\s\S]*?\n\}/, 'resolveAnyThemePreset');
const defaultThemeSrc = extract(/const DEFAULT_THEME = \{[\s\S]*?\};/, 'DEFAULT_THEME');
const quickFillSrc = extract(/function applyThemePresetQuickFill\(presetId\) \{[\s\S]*?\n\}/, 'applyThemePresetQuickFill');

const sandbox = {
  profile: { theme: null },
  hasUnsavedEdits: false,
  fillAppearanceFieldsCalls: 0,
};
sandbox.fillAppearanceFields = function () { sandbox.fillAppearanceFieldsCalls++; };
vm.createContext(sandbox);
vm.runInContext(
  `${defaultThemeSrc}\n${themePresetsSrc}\n${resolvePresetSrc}\n${themePresetsProSrc}\n${resolveAnyPresetSrc}\n${quickFillSrc}\n` +
  `this.__run = applyThemePresetQuickFill;\nthis.__presetsPro = THEME_PRESETS_PRO;\nthis.__presetsFree = THEME_PRESETS;`,
  sandbox
);

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

// ---- profile.theme absent -> initialisé, puis rempli avec le preset "forest" ----
sandbox.__run('forest');
const t1 = sandbox.profile.theme;
check('profile.theme initialisé si absent', !!t1);
check('bgColor copié depuis le preset (#16321F)', t1.bgColor === '#16321F');
check('titleColor copié depuis le preset (#D4AF37)', t1.titleColor === '#D4AF37');
check('contentColor copié depuis le preset (#EDE6D6)', t1.contentColor === '#EDE6D6');
check('font copiée depuis le preset (google:Zilla Slab)', t1.font === 'google:Zilla Slab');
check('separator copié depuis le preset (visible, #8C7A3D, 1px)', t1.separator.visible === true && t1.separator.color === '#8C7A3D' && t1.separator.thickness === 1);
check('AUCUN presetId écrit (départ rapide, pas un mode à part)', t1.presetId === undefined);
check('hasUnsavedEdits posé à true', sandbox.hasUnsavedEdits === true);
check('fillAppearanceFields() rappelé pour rafraîchir les champs visibles', sandbox.fillAppearanceFieldsCalls === 1);

// ---- champs déjà personnalisés à la main -> écrasés par un second clic sur un autre preset ----
sandbox.profile.theme.bgColor = '#custom';
sandbox.__run('neon');
const t2 = sandbox.profile.theme;
check('un second clic sur un autre preset écrase bien les champs (départ rapide, pas cumulatif)', t2.bgColor === '#1B1035');
check('le séparateur suit aussi le nouveau preset (#7A5FFF)', t2.separator.color === '#7A5FFF');

// ---- presetId inconnu -> repli sur "Défaut", même comportement que côté Free/page publique ----
sandbox.__run('does-not-exist');
check('preset inconnu : repli silencieux sur "Défaut" (#FAFAF8)', sandbox.profile.theme.bgColor === '#FAFAF8');

// ---- 6 thèmes réservés au Pro : exactement 6, ids distincts des 6 Free, résolus par le départ rapide ----
check('THEME_PRESETS_PRO contient exactement 6 thèmes', sandbox.__presetsPro.length === 6);
const freeIds = sandbox.__presetsFree.map(p => p.id);
const proIds = sandbox.__presetsPro.map(p => p.id);
check('aucun id du Pro ne recoupe un id Free (12 thèmes distincts)', proIds.every(id => !freeIds.includes(id)));

sandbox.__run('ocean');
const tOcean = sandbox.profile.theme;
check('preset Pro "ocean" résolu par le départ rapide (#0A2E36)', tOcean.bgColor === '#0A2E36' && tOcean.titleColor === '#4ECDC4');
check('preset Pro "ocean" : toujours aucun presetId écrit', tOcean.presetId === undefined);

sandbox.__run('crimson');
check('preset Pro "crimson" résolu (#1A0A0A)', sandbox.profile.theme.bgColor === '#1A0A0A');
sandbox.__run('sakura');
check('preset Pro "sakura" résolu (#FDF2F4)', sandbox.profile.theme.bgColor === '#FDF2F4');
sandbox.__run('steel');
check('preset Pro "steel" résolu (#1C1F26)', sandbox.profile.theme.bgColor === '#1C1F26');
sandbox.__run('royal');
check('preset Pro "royal" résolu (#2E0F1D)', sandbox.profile.theme.bgColor === '#2E0F1D');
sandbox.__run('dune');
check('preset Pro "dune" résolu (#EDE0C8)', sandbox.profile.theme.bgColor === '#EDE0C8');

// ---- resolveThemePreset() (lecture Free/rendu public) reste à 6, jamais étendue aux presets Pro ----
vm.runInContext(`this.__resolveFree = resolveThemePreset('ocean');`, sandbox);
check('resolveThemePreset() (Free/rendu public) ignore les presets Pro -- repli sur "Défaut"', sandbox.__resolveFree.id === 'default');

// ---- contraste WCAG AA sur les 6 nouveaux thèmes (formule officielle, même que layerpitch-backstage.html) ----
function hexToRgb(hex) { hex = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function linearize(c) { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function relLuminance(hex) { const [r, g, b] = hexToRgb(hex).map(linearize); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function contrastRatio(hex1, hex2) {
  const l1 = relLuminance(hex1), l2 = relLuminance(hex2);
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
sandbox.__presetsPro.forEach(p => {
  const titleRatio = contrastRatio(p.bgColor, p.titleColor);
  const contentRatio = contrastRatio(p.bgColor, p.contentColor);
  check(`WCAG AA ${p.id} : titre (grand texte, seuil 3:1) = ${titleRatio.toFixed(2)}:1`, titleRatio >= 3);
  check(`WCAG AA ${p.id} : contenu (texte normal, seuil 4.5:1) = ${contentRatio.toFixed(2)}:1`, contentRatio >= 4.5);
});

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
