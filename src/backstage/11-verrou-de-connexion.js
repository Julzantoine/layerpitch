/* ---------------- Verrou de connexion (7 septembre) ----------------
 * Avant ce verrou, n'importe qui pouvait charger cette page et voir tout l'outil compositeur
 * (formulaires, panneaux) sans être connecté -- seule la lecture Postgres échouait ensuite en
 * silence (ensureMyComposerProfile() sans session). Cloudflare Access masquait ce problème tant
 * qu'il protégeait ce chemin ; son retrait (docs/infrastructure.md, Partie C) l'a rendu visible.
 * Ce verrou bloque désormais l'appel à loadData(true) (seul point d'entrée qui charge du contenu
 * réel, voir plus bas) tant qu'aucune session Supabase n'est confirmée, et redirige sinon vers
 * bienvenue.html -- le point d'entrée déjà construit pour la connexion/l'inscription, jamais
 * dupliqué ici. #authGateOverlay (CSS, en tête de fichier) reste affiché par-dessus tout le reste
 * pendant la vérification, pour qu'aucun panneau ne soit visible avant la décision.
 */
const backstageAuthGateReady = (async function enforceBackstageAuthGate() {
  try {
    await loadPostgresReadScripts();
    const { session } = await window.LayerPitchAuth.getSession();
    if (session && session.user) {
      const overlay = document.getElementById('authGateOverlay');
      if (overlay) overlay.remove();
      return true;
    }
  } catch (e) {
    // Panne réseau/Supabase pendant la vérification : traité comme non connecté plutôt que de
    // laisser le voile levé sans certitude -- même repli que l'absence de session.
  }
  window.location.replace('bienvenue.html');
  return false;
})();

// Traductions de l'habillage du backstage (pas le contenu que Jules-Antoine ou les bêta-testeurs
// saisissent — titres de morceaux, textes de blocs, etc., qui restent dans leur langue d'origine).
// Vit dans layerpitch-i18n.js (zones "shared" + "backstage"), édité via l'outil dédié, jamais à la main.
function currentLang() { return localStorage.getItem('layerpitch_lang') || 'fr'; }
// tr('clé', {placeholder: valeur}) — remplace {placeholder} dans la chaîne traduite si fourni.
// Ordre de repli : zone backstage -> zone shared -> même chose en français -> la clé elle-même.
function tr(key, vars) {
  const I18N = window.LAYERPITCH_I18N || { fr: { shared: {}, backstage: {} }, en: { shared: {}, backstage: {} } };
  const dict = I18N[currentLang()] || I18N.fr;
  const dictFr = I18N.fr;
  let str = (dict.backstage && dict.backstage[key]) || (dict.shared && dict.shared[key])
    || (dictFr.backstage && dictFr.backstage[key]) || (dictFr.shared && dictFr.shared[key]) || key;
  if (vars) Object.keys(vars).forEach(k => { str = str.replace('{' + k + '}', vars[k]); });
  return str;
}
function applyI18n() {
  document.documentElement.lang = currentLang();
  document.documentElement.style.setProperty('--drop-hint-text', JSON.stringify(tr('dropFilesHint')));
  document.querySelectorAll('[data-i18n]').forEach(el => { const v = tr(el.dataset.i18n); if (v) el.textContent = v; });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { const v = tr(el.dataset.i18nTitle); if (v) el.title = v; });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { const v = tr(el.dataset.i18nPlaceholder); if (v) el.placeholder = v; });
  document.querySelectorAll('.lang-toggle button').forEach(b => b.classList.toggle('active', b.dataset.lang === currentLang()));
  // L'aperçu "Écouter" du backstage réutilise player.js — sa langue doit suivre celle de l'outil (le
  // compositeur qui teste), pas celle de l'AdReel en cours d'édition (langue de PUBLICATION, différente).
  if (window.LayerPlayerCore) window.LayerPlayerCore.setLang(currentLang());
}

