/* ---------------- Tracking d'usage (bêta) ---------------- */
// Vocabulaire fermé, volontairement limité pour rester lisible dans la console admin (Analytics,
// fusionnée avec l'ex-admin-analytics.html) : tab_switch, track_add, track_delete, pack_add, pack_delete,
// collection_add, collection_delete, adreel_add, adreel_delete, block_add, sfx_add, sfx_remove,
// custom_font_add, custom_font_delete, publish_click, publish_success, preview_play. Erreurs captées
// automatiquement.
// Envoyé à Umami (déjà chargé par cette page), comme les statistiques globales de la plateforme -- jamais bloquant.
// Avant le 24/09 : tamponné en localStorage et envoyé dans events.json d'un dépôt GitHub, que plus rien ne lisait.
const MODE_TEST_KEY = 'layerpitch_backstage_mode_test';

function isModeTest() {
  const cb = document.getElementById('modeTestToggle');
  return cb ? cb.checked : (localStorage.getItem(MODE_TEST_KEY) === '1');
}

// var (pas let) : enforceBackstageAuthGate() (plus haut dans ce même script) appelle
// loadPostgresReadScripts() dès le chargement de la page, donc avant que l'exécution linéaire du
// script n'atteigne cette ligne -- avec let, ça lève "Cannot access before initialization" (zone
// morte temporelle) pour absolument tout le monde, la connexion étant alors toujours traitée comme
// absente. var est hissée avec une valeur undefined dès le début du script, donc sans ce piège.
// Trouvé le 7 septembre en testant la boîte de réception des messages admin (bug indépendant,
// présent depuis 56ed331 "Ajoute un verrou de connexion sur le backstage compositeur").
var postgresReadScriptsLoaded = null;
function loadPostgresReadScripts() {
  if (postgresReadScriptsLoaded) return postgresReadScriptsLoaded;
  // Même principe que public-page.js (pages publiques) : téléchargement en parallèle mais exécution DANS L'ORDRE
  // (async = false), et version du déploiement -- celle de la balise layerpitch-i18n.js de cette page, montée par
  // scripts/bump-version.js -- au lieu de Date.now(), qui interdisait tout cache. Une vraie Error en cas d'échec
  // pour que le message affiché nomme le script en cause.
  const v = (document.querySelector('script[src*="layerpitch-i18n.js?v="]') || {}).src;
  const version = v ? new URL(v).searchParams.get('v') : '';
  const srcs = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
    './api/supabase-client.js', './api/auth.js', './api/tracks.js', './api/packs.js', './api/albums.js',
    './api/collections.js', './api/sfx.js', './api/settings.js', './api/adreels.js', './api/site-data.js',
    './api/subscriptions.js', './api/admin.js', './api/analytics.js', './api/access-requests.js', './api/invites.js',
    './api/notification-prefs.js',
  ];
  postgresReadScriptsLoaded = Promise.all(srcs.map(src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = (src.startsWith('http') || !version) ? src : src + '?v=' + version;
    s.async = false;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Échec du chargement de ' + s.src));
    document.head.appendChild(s);
  })));
  return postgresReadScriptsLoaded;
}
// Retourne exactement la même forme que le data.json parsé (voir api/site-data.js) — null si aucun
// contenu trouvé (premier lancement), pour que loadData() garde sa logique de repli existante.
async function fetchSiteData() {
  await loadPostgresReadScripts();
  // Isolation multi-compositeur (1er septembre) : la lecture exige une session (auto-provisionne le
  // composer_profile s'il n'existe pas encore) -- sans ça, impossible de savoir quel catalogue charger.
  const { composerId, error } = await window.LayerPitchAuth.ensureMyComposerProfile();
  if (error) throw new Error('Aucune session active — connecte-toi avant de recharger (' + error + ').');
  loadedComposerId = composerId; // clé du brouillon automatique (un par compte)
  return window.LayerPitchSiteData.loadSiteDataFromPostgres(composerId);
}

