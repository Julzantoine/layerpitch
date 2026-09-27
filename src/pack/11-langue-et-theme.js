function resolveThemePreset(presetId) {
  return THEME_PRESETS.find(p => p.id === presetId) || THEME_PRESETS[0];
}
const DEFAULT_SEPARATOR = { visible: false, color: '#E4E1DA', thickness: 1 };

// Traductions de l'habillage LayerPitch (pas le contenu des packs/morceaux, qui reste dans sa langue
// d'origine). Vit dans layerpitch-i18n.js (zones "shared" + "pack"), édité via l'outil dédié.
// Langue transmise par l'AdReel qui a mené ici (paramètre ?lang= dans le lien), jamais choisie par le
// visiteur. 'fr' par défaut si le pack est ouvert directement (lien ancien, accès direct sans AdReel).
const pageLang = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'fr';
function currentLang() { return pageLang; }
// Intégration externe (?embed=1, généré par le backstage — bouton "Code d'intégration") : ce pack
// tourne dans une iframe sur le site d'un tiers, pas sur layerpitch.com -- le lien "← Retour" n'a
// alors plus aucun sens (l'auditeur n'est jamais passé par le site du compositeur), remplacé par un
// vrai bouton qui ouvre l'AdReel PRINCIPAL du compositeur dans un nouvel onglet (jamais dans
// l'iframe elle-même, qui resterait minuscule et coincée sur le site tiers).
const embedMode = new URLSearchParams(location.search).get('embed') === '1';
// Texte bilingue (présentation de pack/collection) : montre la version qui correspond à la langue de
// la page ; si elle n'a jamais été remplie par le compositeur, on préfère montrer l'autre langue plutôt
// que rien du tout.
function pickBilingualText(fr, en) {
  return (pageLang === 'en' ? (en || fr) : (fr || en)) || '';
}
// tr('clé') pour le texte généré en JS ; data-i18n pour le HTML statique. Un même dictionnaire pour les
// deux. Ordre de repli : zone pack -> zone shared -> même chose en français -> la clé elle-même.
function tr(key) {
  const I18N = window.LAYERPITCH_I18N || { fr: { shared: {}, pack: {} }, en: { shared: {}, pack: {} } };
  const dict = I18N[currentLang()] || I18N.fr;
  const dictFr = I18N.fr;
  return (dict.pack && dict.pack[key]) || (dict.shared && dict.shared[key])
    || (dictFr.pack && dictFr.pack[key]) || (dictFr.shared && dictFr.shared[key]) || key;
}
function applyI18n() {
  document.documentElement.lang = currentLang();
  document.querySelectorAll('[data-i18n]').forEach(el => { const v = tr(el.dataset.i18n); if (v) el.textContent = v; });
}
window.LayerPlayerCore.setLang(pageLang);
applyI18n();

