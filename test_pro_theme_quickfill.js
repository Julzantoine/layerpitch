// Vérifie le "départ rapide" par preset sur le palier Pro (10 septembre) : contrairement à la galerie
// Free (qui écrit profile.theme.presetId), un clic Pro doit copier les valeurs CONCRÈTES du preset dans
// les champs éditables normaux (bgColor/titleColor/contentColor/font/separator) -- aucun presetId
// écrit, le compositeur reste ensuite libre de tout retoucher comme s'il avait choisi ces valeurs à la
// main. Extrait les VRAIES fonctions de layerpitch-backstage.html (THEME_PRESETS, resolveThemePreset,
// applyThemePresetQuickFill) via regex + vm, pas une réimplémentation -- backstage.html dans son
// ensemble (auth, Supabase, Postgres) est trop lourd à faire tourner tel quel dans un test unitaire,
// donc seule cette fonction pure est isolée (même principe que test_publish_effective_plan.js pour
// effectiveTierFromTrialStatus).
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
  `${defaultThemeSrc}\n${themePresetsSrc}\n${resolvePresetSrc}\n${quickFillSrc}\n` +
  `this.__run = applyThemePresetQuickFill;`,
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

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
