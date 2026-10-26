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
// MODE TUTORIEL (20/10) : layerpitch-backstage.html?tuto -- le Backstage tourne sur un faux serveur local (api/demo-client.js) :
// compte fictif, rien n'est lu ni écrit en base, tout est remis à zéro à chaque chargement. Ce sont des FONCTIONS (et non
// des variables) pour rester utilisables dès le tout premier appel, avant que le script n'ait fini de se dérouler.
function isTutoMode() { return new URLSearchParams(window.location.search).has('tuto'); }
// Tant que Jules-Antoine n'a pas ouvert le tutoriel au public : seules les personnes connectées pour de vrai (bêta-testeurs, admins) peuvent y entrer.
// Pour l'ouvrir à tout le monde : faire répondre « true » ici (une seule ligne).
function tutoPublicOpen() { return window.LayerPitchTuto.publicOpen(); } // règle d'accès unique : layerpitch-tuto.js
// Vrai si l'accès est celui d'un admin (tutoriel complet) ; en version publique, seules les leçons marquées « public »
// sont jouables (les autres restent visibles avec « le tuto complet nécessite un compte »).
var tutoFullAccess = false;
// Vérifie, AVANT de passer sur le faux serveur, qu'un vrai admin est connecté (SDK réel + vrai client). Sinon on
// retourne au Backstage normal (qui renverra vers la connexion si besoin).
async function tutoAccessGate() {
  // Tout compte réellement connecté entre (bêta-testeurs) ; seul un admin a le tutoriel complet (tutoFullAccess).
  const level = await window.LayerPitchTuto.accessLevel();
  if (level) return level;
  window.location.replace(window.location.pathname);
  return new Promise(() => {}); // la page s'en va : on ne laisse rien se charger
}
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
  const tuto = isTutoMode();
  // Une personne déjà connectée (session mémorisée) charge quand même le SDK : le tutoriel public ne doit pas lui retirer l'accès complet d'un admin (leçons réservées).
  const storedSession = (() => { try { return Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k)); } catch (e) { return false; } })();
  // Mode tutoriel public : pas de SDK Supabase du tout (rien à contacter) ; fermé au public : SDK chargé seulement pour
  // vérifier qu'un vrai admin entre.
  // Le feu vert « public_tutorial » (lecture asynchrone) est lu avant de décider quoi charger.
  postgresReadScriptsLoaded = (tuto ? window.LayerPitchTuto.ready : Promise.resolve()).then(() => {
  const needRealSdk = !tuto || !tutoPublicOpen() || storedSession;
  const list = (needRealSdk ? srcs : srcs.filter(src => !src.startsWith('http')));
  if (tuto) list.push('./api/demo-client.js');
  return Promise.all(list.map(src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = (src.startsWith('http') || !version) ? src : src + '?v=' + version;
    s.async = false;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Échec du chargement de ' + s.src));
    document.head.appendChild(s);
  })));
  }).then(async () => {
    if (!tuto) return;
    if (!tutoPublicOpen()) tutoFullAccess = (await tutoAccessGate()) === 'admin';
    else if (storedSession) tutoFullAccess = (await window.LayerPitchTuto.accessLevel()) === 'admin'; // tutoriel public : un admin connecté garde l'accès complet
    // Bascule : tous les api/*.js appellent window.LayerPitchSupabaseClient.getClient() à chaque usage, donc cette
    // seule ligne les met tous sur le faux serveur.
    window.LayerPitchTuto.switchToDemo();
  });
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

