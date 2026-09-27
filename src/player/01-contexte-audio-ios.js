(function() {
// player.js — Moteur de lecture partagé entre index.html et pack.html (LayerPitch)
// Un seul endroit pour le rendu des morceaux et toute la logique audio (bouclage simple + quantifié, stingers, intensité).
// Chargé comme script classique (<script src="player.js"></script>) — fonctionne en file:// comme en https://,
// contrairement aux modules ES qui sont bloqués par les navigateurs en ouverture locale directe.

const ctx = new (window.AudioContext || window.webkitAudioContext)();

// Contournement de l'interrupteur silencieux physique sur iOS Safari : le Web Audio API respecte cet
// interrupteur (contrairement à une balise <audio> classique, qui l'ignore déjà). Un visiteur qui ouvre
// un lien de pitch avec l'interrupteur activé n'entendrait donc rien et croirait le lecteur cassé.
// Technique connue et documentée (utilisée notamment par les librairies unmute-ios-audio et unmute) :
// faire jouer en boucle un très court son silencieux via <audio> force iOS à basculer tout l'audio de la
// page — Web Audio compris — sur le canal "média" plutôt que le canal "sonnerie", qui seul respecte
// l'interrupteur. Contournement non officiel (pas garanti par Apple), mais stable depuis plusieurs années.
// Le fichier est un WAV silencieux de 50ms encodé en base64, généré localement — aucune dépendance externe,
// compatible file://.
const SILENT_WAV_DATA_URI = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
let iosSilentUnlockDone = false;
function unlockIOSSilentSwitch() {
  if (iosSilentUnlockDone) return;
  iosSilentUnlockDone = true;
  try {
    const el = new Audio(SILENT_WAV_DATA_URI);
    el.loop = true;
    el.setAttribute('x-webkit-airplay', 'deny');
    el.play().catch(() => {});
  } catch (e) { /* best-effort : un échec ici ne doit jamais bloquer la lecture normale */ }
}
// Même endroit que ctx.resume() car les deux répondent au même besoin (débloquer l'audio suite à un
// geste utilisateur) — appeler les deux ensemble évite d'avoir à les dupliquer à chaque point d'appel.
function resumeAudioContext() {
  if (ctx.state === 'suspended') ctx.resume();
  unlockIOSSilentSwitch();
}

// Appareil approximatif (mobile/desktop uniquement, simplification actée pour le tableau de bord
// analytique compositeur, grille du 4 septembre) -- seuil 768px, cohérent avec le point de bascule
// déjà utilisé ailleurs dans le produit pour distinguer mobile/desktop.
function lpDeviceType() {
  try { return (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) ? 'mobile' : 'desktop'; }
  catch (e) { return null; }
}

// Dupliqué à l'identique dans index.html et pack.html : chaque script a sa propre closure, pas d'accès
// croisé possible. Jamais bloquant, silencieux si Umami n'est pas chargé.
// Le contexte (quel AdReel ou quel Pack a généré l'événement) est déposé sur `window.__lpTrackContext`
// par la page hôte (index.html ou pack.html) dès qu'elle connaît son propre identifiant — permet de
// distinguer dans Umami "le lien envoyé au Studio X" plutôt qu'un compteur global indifférencié.
// Repères de capture (outil vidéo « Test in game », 25/09) : TOUT ce que l'outil vidéo enregistre passe par cet
// évènement DOM -- les évènements de télémétrie ci-dessous (trackPublicEvent) ET des repères propres à la capture,
// jamais envoyés aux statistiques (démarrage de chaque génération d'une boucle, vraie bascule d'un embranchement,
// reprise après pause...). Chaque repère donne l'instant EXACT (heure du contexte audio) où le son a lieu : `at`, fourni
// par le moteur quand il programme le son (futur) ou l'annonce après coup (passé), sinon l'heure courante.
// `at` : heure EXACTE du contexte audio où le son a lieu (horloge du son, pas celle de la page ni de la vidéo) -- l'outil
// vidéo s'en sert pour caler tous les sons entre eux à l'échantillon près, puis les replace d'un bloc sur la vidéo.
function captureMark(name, detail) {
  try {
    const d = Object.assign({}, detail || {});
    if (d.at == null) d.at = ctx.currentTime;
    document.dispatchEvent(new CustomEvent('layerpitch-capture-mark', { detail: { name, detail: d } }));
  } catch (e) { /* jamais bloquant */ }
}
// captureExtra : détails utiles à la seule capture vidéo (jamais envoyés aux statistiques).
function trackPublicEvent(name, detail, captureExtra) {
  captureMark(name, captureExtra ? Object.assign({}, detail, captureExtra) : detail);
  try {
    if (!window.umami) return;
    const ctx = window.__lpTrackContext || {};
    // ownerId (identité du compositeur) ajouté le 4 septembre, à part du couple type/id ci-dessus :
    // un id d'AdReel/Pack seul ('main' notamment) n'est unique que PAR compositeur, pas globalement.
    // Umami lui-même ne sert plus qu'à la vue globale plateforme de Jules-Antoine (chantier du 5
    // septembre, tableau de bord compositeur basculé sur un système Postgres propriétaire, voir
    // logAnalyticsEvent ci-dessous) -- conservé ici pour une éventuelle inspection manuelle par
    // compositeur dans son propre tableau de bord Umami, bénéfice mineur mais inoffensif.
    window.umami.track(name, Object.assign({}, detail, ctx.type ? { [ctx.type]: ctx.id } : {}, ctx.ownerId ? { ownerId: ctx.ownerId } : {}));
  } catch (e) { /* jamais bloquant */ }
  // Tableau de bord analytique compositeur (chantier du 5 septembre, système Postgres propriétaire --
  // supabase/migrations/20260905010000_composer_analytics_events.sql) : distinct d'Umami ci-dessus.
  // Silencieux si api/analytics.js n'est pas chargé (chemin historique sans handle, data.json
  // statique) ou si le type de contexte n'est ni 'adreel' ni 'pack' (collections hors périmètre) --
  // jamais bloquant pour la lecture, mêmes garanties que trackPublicEvent lui-même.
  try {
    const ctx = window.__lpTrackContext || {};
    if (window.LayerPitchAnalytics && (ctx.type === 'adreel' || ctx.type === 'pack' || ctx.type === 'collection') && ctx.sessionId) {
      window.LayerPitchAnalytics.logAnalyticsEvent(ctx.type, ctx.id, ctx.sessionId, name, detail, lpDeviceType(), ctx.ownerId || null);
    }
  } catch (e) { /* jamais bloquant */ }
}

// Même `window.__lpTrackContext` que trackPublicEvent ci-dessus, réutilisé ici pour porter l'AdReel
// d'origine sur les liens vers pack.html générés depuis un AdReel (bouton "Retour" dynamique du pack —
// voir pack.html) : un pack intégré dans plusieurs AdReels différents doit renvoyer vers celui par
// lequel le visiteur est réellement arrivé, pas vers un `linkedAdReelId` fixe configuré une fois pour
// toutes en backstage.
//
// `u` (handle du compositeur) ajouté le 4 septembre, trouvé manquant en corrigeant le bouton
// "Retour" de pack.html : sans lui, le lien généré depuis l'AdReel d'un compositeur non-défaut
// (`?u=<handle>`) perdait cette identité au clic sur un pack -- pack.html serait retombé sur
// DEFAULT_OWNER_ID (le compte de Jules-Antoine) faute de handle, exactement le même bug que celui
// documenté dans docs/infrastructure.md pour les liens "← Retour" génériques. `location.search` ici
// reflète l'URL de la page qui a chargé player.js (index.html), pas un contexte propre à ce fichier.
function adReelFromParam() {
  const ctx = window.__lpTrackContext || {};
  if (ctx.type !== 'adreel' || !ctx.id) return '';
  const handle = new URLSearchParams(location.search).get('u');
  return `&from=${encodeURIComponent(ctx.id)}` + (handle ? `&u=${encodeURIComponent(handle)}` : '');
}

// Traductions de l'habillage généré par le moteur (statuts, boutons, libellés de mode...) — pas le
// Traductions de l'habillage généré par le moteur (statuts, boutons, libellés de mode...) — pas le
// contenu des morceaux eux-mêmes (titres, descriptions, labels de couches saisis par le compositeur).
// Vit dans layerpitch-i18n.js (zones "shared" + "player"), chargé avant ce script — édité via l'outil
// dédié, jamais à la main. Ce fichier n'a pas besoin de balayer le DOM après coup : le texte est inséré
// directement dans les gabarits au moment de leur construction, via t('clé').
//
// La langue n'est plus lue depuis localStorage ici : chaque page hôte (index.html, pack.html,
// layerpitch-backstage.html) la détermine elle-même selon son propre contexte (langue de l'AdReel,
// paramètre d'URL du pack, réglage du backstage) et l'impose via setLang() avant de construire quoi
// que ce soit. Évite qu'un visiteur voie une langue différente de celle choisie par le compositeur.
let CURRENT_LANG = 'fr';
function setLang(lang) { CURRENT_LANG = (lang === 'en') ? 'en' : 'fr'; }
// Bibliothèque de Sfx de la page en cours, fournie une fois par la page publique (index.html) avant le
// rendu des morceaux — permet à buildTrackRow/initTrackPlayer de résoudre track.sfxIds (simples id) en
// entrées Sfx complètes (titre, variations, réglage aléatoire/séquentiel) sans threader ce paramètre à
// travers toute la chaîne d'appel (renderTracksBlock -> buildTrackRow -> initTrackPlayer).
let SFX_LIBRARY_BY_ID = {};
function setSfxLibrary(byId) { SFX_LIBRARY_BY_ID = byId || {}; }
// Style de forme d'onde (Chantier Apparence, palier Pro, 05/09) : réglage global par compositeur (pas
// par bloc, pas par AdReel), résolu une fois par la page hôte (index.html/pack.html/collection.html,
// palier Pro effectif + réglage global du compositeur) et imposé via setWaveformStyle() avant tout rendu
// de piste -- même principe que setLang() ci-dessus. Free/Starter n'appellent jamais cette fonction avec
// autre chose que 'bars' (voir resolveEffectiveWaveformStyle plus bas pour le repli d'espace, séparé).
const WAVEFORM_STYLES = ['bars', 'mirror', 'dots', 'layers'];
let CURRENT_WAVEFORM_STYLE = 'bars';
function setWaveformStyle(style) { CURRENT_WAVEFORM_STYLE = WAVEFORM_STYLES.includes(style) ? style : 'bars'; }
function currentWaveformStyle() { return CURRENT_WAVEFORM_STYLE; }
// Thème (Clair/Sombre) de la carte des chemins (Chantier Apparence, palier Pro, 06/09) : même principe
// que le style de forme d'onde ci-dessus -- réglage global par compositeur, résolu une fois par la page
// hôte et imposé via setSeqMapTheme() avant tout rendu de piste séquentielle. Free/Starter n'appellent
// jamais cette fonction avec autre chose que 'light'.
const SEQ_MAP_THEMES = ['light', 'dark'];
let CURRENT_SEQ_MAP_THEME = 'light';
function setSeqMapTheme(theme) { CURRENT_SEQ_MAP_THEME = SEQ_MAP_THEMES.includes(theme) ? theme : 'light'; }
function currentSeqMapTheme() { return CURRENT_SEQ_MAP_THEME; }
// Densité de la carte des chemins (10/09, retour direct : la maquette montrée était "agréable à
// regarder", le vrai composant "tristounet" en comparaison) -- PAS un réglage de palier (contrairement
// au thème ci-dessus) : un simple choix de mise en page par TYPE de page, posé une fois par la page
// hôte avant tout rendu. 'compact' (par défaut, comportement historique) n'est plus utilisé par le
// Backstage depuis le 24/09 (grille jugée « toute moche » dans l'aperçu : il prend 'roomy' comme les pages
// publiques, la carte se réduisant seule à la largeur du panneau). 'roomy' (pages publiques) vise l'inverse : cartes nettement plus
// grandes et aérées, quitte à afficher moins d'étapes d'un coup d'œil -- voir updateSeqMap() pour le
// calcul de taille, qui devient sensible à la largeur réelle disponible en mode 'roomy' (pas seulement
// au nombre d'emplacements comme en 'compact').
const SEQ_MAP_DENSITIES = ['compact', 'roomy'];
let CURRENT_SEQ_MAP_DENSITY = 'compact';
function setSeqMapDensity(density) { CURRENT_SEQ_MAP_DENSITY = SEQ_MAP_DENSITIES.includes(density) ? density : 'compact'; }
function currentSeqMapDensity() { return CURRENT_SEQ_MAP_DENSITY; }
