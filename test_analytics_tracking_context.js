// test_analytics_tracking_context.js — LayerPitch, chantier "tableau de bord analytique
// compositeur" (4-5 septembre). Anciennement test_umami_owner_context.js -- élargi le 5 septembre
// quand le tableau de bord a basculé de l'API Umami Cloud (abandonnée, accès payant) vers un
// système propriétaire Postgres (log_analytics_event()) : le contexte de tracking construit par
// index.html/pack.html/collection.html sert désormais aux DEUX (Umami, conservé pour la vue globale
// plateforme de Jules-Antoine, ET la nouvelle RPC Postgres).
//
// Vérifie deux choses distinctes :
// 1. Le correctif d'ambiguïté trouvé en préparant ce chantier (4 septembre) : `ad_reels.id` n'est
//    unique que PAR compositeur (20260903120000_ad_reels_owner_scoped_id.sql), 'main' étant l'id
//    par défaut du tout premier AdReel de CHAQUE compositeur -- sans l'ownerId ajouté au contexte,
//    deux compositeurs différents avec un AdReel 'main' seraient indiscernables, aussi bien côté
//    Umami que côté RPC Postgres (qui l'utilise comme indice de désambiguïsation, voir
//    supabase/migrations/20260905020000_analytics_log_event_owner_hint.sql).
// 2. Le câblage du 5 septembre : trackPublicEvent (player.js) appelle bien
//    window.LayerPitchAnalytics.logAnalyticsEvent() avec le sessionId/ownerId du contexte, pour les
//    seuls types 'adreel'/'pack' (les collections restent hors périmètre du tableau de bord),
//    jamais si sessionId est absent ou si api/analytics.js n'est pas chargé.
//
// Extrait les vraies fonctions sources par regex (même pattern que test_publish_effective_plan.js)
// plutôt que de réimplémenter leur logique -- pas de framework de test dans ce dépôt.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function extractFn(src, name, label) {
  const re = new RegExp(`(async )?function ${name}\\([\\s\\S]*?\\n\\}`);
  const m = src.match(re);
  if (!m) throw new Error(`${name} introuvable dans ${label}`);
  return m[0];
}
function extractLet(src, name, label) {
  const re = new RegExp(`let ${name} = [\\s\\S]*?;\\n`);
  const m = src.match(re);
  if (!m) throw new Error(`${name} introuvable dans ${label}`);
  return m[0];
}
function extractConst(src, name, label) {
  const re = new RegExp(`const ${name} = [\\s\\S]*?;\\n`);
  const m = src.match(re);
  if (!m) throw new Error(`${name} introuvable dans ${label}`);
  return m[0];
}

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

// ---- player.js trackPublicEvent : ownerId propagé à Umami, ET événement loggué côté Postgres ----
{
  const src = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8');
  const deviceFnSrc = extractFn(src, 'lpDeviceType', 'player.js');
  const fnSrc = extractFn(src, 'trackPublicEvent', 'player.js');
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(deviceFnSrc + '\n' + fnSrc + '\nthis.trackPublicEvent = trackPublicEvent;', sandbox);

  let umamiTracked = null, rpcLogged = null;
  sandbox.window.umami = { track: (name, data) => { umamiTracked = { name, data }; } };
  sandbox.window.LayerPitchAnalytics = { logAnalyticsEvent: (...args) => { rpcLogged = args; } };
  sandbox.window.__lpTrackContext = { type: 'adreel', id: 'main', ownerId: 'composer-A', sessionId: 'sess-1' };
  sandbox.trackPublicEvent('track_play', { trackId: 't1' });
  check('player.js trackPublicEvent : ownerId ajouté au payload Umami', umamiTracked && umamiTracked.data.ownerId === 'composer-A');
  check('player.js trackPublicEvent : type/id toujours présents (adreel)', umamiTracked && umamiTracked.data.adreel === 'main');
  check('player.js trackPublicEvent : detail d\'origine conservé côté Umami', umamiTracked && umamiTracked.data.trackId === 't1');
  check('player.js trackPublicEvent : logAnalyticsEvent() appelé pour un AdReel avec sessionId',
    rpcLogged && rpcLogged[0] === 'adreel' && rpcLogged[1] === 'main' && rpcLogged[2] === 'sess-1' && rpcLogged[3] === 'track_play' && rpcLogged[6] === 'composer-A');

  umamiTracked = null; rpcLogged = null;
  sandbox.window.__lpTrackContext = { type: 'pack', id: 'p1' }; // pas d'ownerId ni de sessionId
  sandbox.trackPublicEvent('track_play', { trackId: 't1' });
  check('player.js trackPublicEvent : pas de clé ownerId côté Umami si absente du contexte (rétrocompatible)',
    umamiTracked && !('ownerId' in umamiTracked.data));
  check('player.js trackPublicEvent : logAnalyticsEvent() jamais appelé sans sessionId', rpcLogged === null);

  rpcLogged = null;
  sandbox.window.__lpTrackContext = { type: 'collection', id: 'c1', sessionId: 'sess-2' }; // hors périmètre du tableau de bord
  sandbox.trackPublicEvent('some_event', {});
  check('player.js trackPublicEvent : logAnalyticsEvent() jamais appelé pour une collection (hors périmètre)', rpcLogged === null);

  rpcLogged = null;
  delete sandbox.window.LayerPitchAnalytics; // api/analytics.js non chargé (chemin sans handle)
  sandbox.window.__lpTrackContext = { type: 'adreel', id: 'main', sessionId: 'sess-3' };
  let threw = false;
  try { sandbox.trackPublicEvent('track_play', {}); } catch (e) { threw = true; }
  check('player.js trackPublicEvent : silencieux (jamais bloquant) si LayerPitchAnalytics absent', !threw && rpcLogged === null);
}

// ---- collection.html trackPublicEvent (copie inline distincte, spread direct de __lpTrackContext) ----
// Conservé pour Umami uniquement -- les collections restent hors périmètre du tableau de bord
// Postgres, aucun appel logAnalyticsEvent attendu de ce côté.
{
  const src = fs.readFileSync(path.join(__dirname, 'collection.html'), 'utf-8');
  const fnSrc = extractFn(src, 'trackPublicEvent', 'collection.html');
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fnSrc + '\nthis.trackPublicEvent = trackPublicEvent;', sandbox);

  let tracked = null;
  sandbox.window.umami = { track: (name, data) => { tracked = { name, data }; } };
  sandbox.window.__lpTrackContext = { type: 'collection', id: 'c1', ownerId: 'composer-A' };
  sandbox.trackPublicEvent('some_event', { foo: 'bar' });
  check('collection.html trackPublicEvent : ownerId propagé à Umami (même correctif que player.js)',
    tracked && tracked.data.ownerId === 'composer-A');
}

// ---- index.html/pack.html/collection.html : loadSiteData() résout lastResolvedOwnerId ----
function testLoadSiteDataOwnerId(file) {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf-8');
  const defaultOwnerConst = extractConst(src, 'DEFAULT_OWNER_ID', file);
  const lastResolvedLet = extractLet(src, 'lastResolvedOwnerId', file);
  const loadSiteDataFn = extractFn(src, 'loadSiteData', file);

  const sandbox = {
    console,
    location: { search: '' },
    URLSearchParams,
    window: {
      LayerPitchComposers: { resolveHandle: async (h) => ({ ownerId: 'resolved-' + h, error: null }) },
      LayerPitchSiteData: { loadSiteDataFromPostgres: async () => ({ adReels: [], packs: [], collections: [] }) },
    },
    fetch: async () => ({ json: async () => ({ adReels: [], packs: [], collections: [] }) }),
    loadPostgresReadScripts: async () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(defaultOwnerConst + lastResolvedLet + loadSiteDataFn, sandbox);

  return sandbox;
}

async function runOwnerIdChecks() {
  for (const file of ['index.html', 'pack.html', 'collection.html']) {
    // Chemin par défaut (pas de ?u=, data.json statique) -- ownerId reste DEFAULT_OWNER_ID.
    // (`let`/`const` de haut niveau ne deviennent pas des propriétés de l'objet sandbox dans un
    // contexte vm -- relues via une expression runInContext, pas un accès direct à sandbox.xxx.)
    {
      const sandbox = testLoadSiteDataOwnerId(file);
      sandbox.location.search = '';
      await vm.runInContext('loadSiteData()', sandbox);
      const [resolved, def] = [vm.runInContext('lastResolvedOwnerId', sandbox), vm.runInContext('DEFAULT_OWNER_ID', sandbox)];
      check(`${file} : loadSiteData() sans ?u= laisse lastResolvedOwnerId = DEFAULT_OWNER_ID`, resolved === def);
    }
    // Chemin par handle (?u=somehandle) -- ownerId doit être résolu via resolveHandle(), pas rester au défaut.
    {
      const sandbox = testLoadSiteDataOwnerId(file);
      sandbox.location.search = '?u=somehandle';
      await vm.runInContext('loadSiteData()', sandbox);
      const resolved = vm.runInContext('lastResolvedOwnerId', sandbox);
      check(`${file} : loadSiteData() avec ?u= résout lastResolvedOwnerId via resolveHandle()`,
        resolved === 'resolved-somehandle');
    }
  }
}

runOwnerIdChecks().then(() => {
  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}).catch(e => { console.error('TEST THREW:', e); process.exit(1); });
