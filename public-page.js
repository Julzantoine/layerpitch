// public-page.js — LayerPitch, briques communes aux trois pages publiques (index.html = AdReel, pack.html,
// collection.html). Créé le 24/09/2026 (revue de code) : ces fonctions étaient recopiées à la main dans chaque page
// et avaient commencé à diverger (suivi Umami différent sur la collection, commentaires contradictoires). Une seule
// source désormais.
//
// Chargé par une balise <script> classique AVANT le script inline de la page : les fonctions ci-dessous sont des
// déclarations de haut niveau, donc globales, et gardent exactement les noms qu'utilisaient les pages.

// ---- Version des fichiers (anti-cache) ----
// Un seul numéro par déploiement : celui de la balise <script src="public-page.js?v=…"> elle-même, monté sur toutes
// les pages d'un coup par scripts/bump-version.js. Les scripts chargés à la demande (api/*.js) le réutilisent au lieu
// de Date.now(), qui interdisait tout cache navigateur à chaque visite.
const LP_ASSET_VERSION = (function () {
  try { return new URL(document.currentScript.src).searchParams.get('v') || ''; } catch (e) { return ''; }
})();

function lpVersioned(src) {
  if (/^https?:/.test(src) || !LP_ASSET_VERSION) return src;
  return src + (src.includes('?') ? '&' : '?') + 'v=' + LP_ASSET_VERSION;
}

// Charge une liste de scripts EN PARALLÈLE mais les exécute DANS L'ORDRE (async = false sur un script inséré
// dynamiquement) : le SDK Supabase passe avant api/supabase-client.js, qui passe avant les autres api/*.js, sans
// attendre la fin de chaque téléchargement pour lancer le suivant (avant : 11 allers-retours réseau en série).
function lpLoadScriptsInOrder(srcs) {
  return Promise.all(srcs.map(src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = lpVersioned(src);
    s.async = false;
    s.onload = resolve;
    // Event DOM sans .message : une vraie Error pour que le message d'erreur affiché nomme le script en cause.
    s.onerror = () => reject(new Error('Échec du chargement de ' + s.src));
    document.head.appendChild(s);
  })));
}

// SDK Supabase + modules de lecture, chargés une seule fois à la première demande (aucun visiteur ne les paie tant
// que la page n'en a pas besoin).
let postgresReadScriptsLoaded = null;
function loadPostgresReadScripts() {
  if (!postgresReadScriptsLoaded) {
    postgresReadScriptsLoaded = lpLoadScriptsInOrder([
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
      './api/supabase-client.js',
      './api/tracks.js',
      './api/packs.js',
      './api/collections.js',
      './api/sfx.js',
      './api/settings.js',
      './api/adreels.js',
      './api/site-data.js',
      './api/composers.js',
      './api/analytics.js',
    ]);
  }
  return postgresReadScriptsLoaded;
}

// ---- Suivi Umami des événements de PAGE ----
// Les événements du lecteur passent par la fonction équivalente de player.js (qui alimente aussi le tableau de bord
// analytique Postgres). Ici : Umami seulement, avec EXACTEMENT la même forme de contexte que player.js
// ({ [type]: id, ownerId }), pour que les événements restent comparables d'une page à l'autre.
function trackPublicEvent(name, detail) {
  try {
    if (!window.umami || typeof window.umami.track !== 'function') return;
    const ctx = window.__lpTrackContext || {};
    window.umami.track(name, Object.assign({}, detail, ctx.type ? { [ctx.type]: ctx.id } : {}, ctx.ownerId ? { ownerId: ctx.ownerId } : {}));
  } catch (e) { /* jamais bloquant */ }
}

// ---- Polices ----
// Le nom et le fichier d'une police personnalisée sont saisis par le compositeur : on retire tout caractère capable
// de sortir d'une chaîne CSS ('"\ ; { } < > et retours à la ligne) avant de les insérer dans une feuille de style.
function lpCssString(s) { return String(s == null ? '' : s).replace(/['"\\;{}<>\r\n]/g, ''); }

// Résout une valeur de police ('default' | 'google:Nom' | 'custom:id') en une déclaration font-family CSS utilisable.
// null pour 'default' (aucun override — le body garde son font-family de base).
function fontCssFamily(fontValue, customFonts) {
  if (!fontValue || fontValue === 'default') return null;
  if (fontValue.startsWith('google:')) return `'${lpCssString(fontValue.slice(7))}', sans-serif`;
  if (fontValue.startsWith('custom:')) {
    const id = fontValue.slice(7);
    const font = (customFonts || []).find(f => f.id === id);
    return font ? `'${lpCssString(font.name)}', sans-serif` : null;
  }
  return null;
}

// Injecte uniquement les assets des polices réellement utilisées sur cette page (thème général + réglages par bloc),
// jamais toute la bibliothèque du compositeur, ni deux fois le même lien/@font-face.
const injectedFontAssets = new Set();
function injectFontAssets(usedFontValues, customFonts) {
  usedFontValues.forEach(val => {
    if (!val || val === 'default' || injectedFontAssets.has(val)) return;
    injectedFontAssets.add(val);
    if (val.startsWith('google:')) {
      const family = val.slice(7);
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`;
      document.head.appendChild(link);
    } else if (val.startsWith('custom:')) {
      const font = (customFonts || []).find(f => f.id === val.slice(7));
      if (!font || !font.file) return;
      const style = document.createElement('style');
      style.textContent = `@font-face { font-family: '${lpCssString(font.name)}'; src: url('./fonts/${encodeURIComponent(font.file)}'); font-display: swap; }`;
      document.head.appendChild(style);
    }
  });
}

// ---- Bandeau de consentement cookies (Microsoft Clarity uniquement, 17/09) ----
// RGPD/CNIL, vérifié avant de coder : les heatmaps/enregistrements de session sont exclus de l'exemption de
// consentement pour la mesure d'audience (contrairement à Umami, sans cookie, pas concerné). Le script Clarity n'est
// donc JAMAIS chargé tant qu'un choix "accepted" n'est pas mémorisé — plus strict que le "mode sans consentement" de
// Clarity lui-même. Prérequis côté compte Clarity (fait par Jules-Antoine) : Settings > Setup > "Cookies" désactivé.
// Lancé automatiquement une fois le DOM prêt (le bandeau doit exister), sauf en aperçu (?preview=1) : ni bandeau, ni Clarity.
const COOKIE_CONSENT_KEY = 'layerpitch_cookie_consent';
function getCookieConsent() {
  try { const raw = localStorage.getItem(COOKIE_CONSENT_KEY); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}
function setCookieConsent(choice) {
  try { localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({ choice, at: new Date().toISOString() })); }
  catch (e) { /* stockage bloqué -- le choix ne sera pas mémorisé, rebandeau à la prochaine visite */ }
}
function loadClarityScript() {
  (function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, 'clarity', 'script', 'yjd22i9kce');
}
// consentv2 : API recommandée par Microsoft. ad_Storage toujours "denied" (aucune publicité sur LayerPitch),
// analytics_Storage reflète le choix réel. Refus : efface les cookies déjà posés si Clarity était déjà chargé.
function signalClarityConsent(granted) {
  try {
    if (typeof window.clarity !== 'function') return;
    if (granted) window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
    else window.clarity('consent', false);
  } catch (e) { /* jamais bloquant */ }
}
function initCookieBanner() {
  const banner = document.getElementById('cookieBanner');
  if (!banner) return;
  const reopenBtn = document.getElementById('cookieReopenBtn');
  const detailToggle = document.getElementById('cookieDetailToggle');
  const detail = document.getElementById('cookieDetail');
  function apply(choice) {
    if (choice === 'accepted') {
      if (typeof window.clarity !== 'function') loadClarityScript();
      signalClarityConsent(true);
    } else if (choice === 'refused') {
      signalClarityConsent(false);
    }
  }
  function hide() { banner.hidden = true; if (reopenBtn) reopenBtn.hidden = false; }
  function show() { banner.hidden = false; if (reopenBtn) reopenBtn.hidden = true; }
  const consent = getCookieConsent();
  if (consent) { apply(consent.choice); hide(); } else { show(); }
  const acceptBtn = document.getElementById('cookieAcceptBtn');
  const refuseBtn = document.getElementById('cookieRefuseBtn');
  if (acceptBtn) acceptBtn.addEventListener('click', () => { setCookieConsent('accepted'); apply('accepted'); hide(); });
  if (refuseBtn) refuseBtn.addEventListener('click', () => { setCookieConsent('refused'); apply('refused'); hide(); });
  if (detailToggle && detail) detailToggle.addEventListener('click', () => { detail.hidden = !detail.hidden; });
  if (reopenBtn) reopenBtn.addEventListener('click', show);
}
if (new URLSearchParams(location.search).get('preview') !== '1') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCookieBanner);
  else initCookieBanner();
}
