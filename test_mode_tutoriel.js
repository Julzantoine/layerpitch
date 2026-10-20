// Mode tutoriel (?tuto, 20/10) : faux serveur local (api/demo-client.js) -- compte fictif, lectures vides, écritures jetées,
// aucune vraie base touchée ; branchements dans le Backstage (verrou, brouillon, publication simulée) ; fermé au public.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

(async () => {
  const sb = { window: {}, setTimeout, console };
  vm.createContext(sb);
  vm.runInContext(read('api/demo-client.js'), sb);
  const c = sb.window.LayerPitchDemoClient;
  check('faux client exposé', !!c && typeof c.rpc === 'function');

  const sess = await c.auth.getSession();
  check('session fictive d’office', sess.data.session && sess.data.session.user.id === 'demo-user');
  let cbSession = null;
  c.auth.onAuthStateChange((ev, s) => { cbSession = s; });
  await new Promise(r => setTimeout(r, 10));
  check('onAuthStateChange rappelé avec la session fictive', !!cbSession);

  check('pas admin', (await c.rpc('is_admin')).data === false);
  const flags = (await c.rpc('my_feature_flags')).data;
  check('leçons ouvertes, nouveautés fermées', flags.some(f => f.key === 'in_app_lessons' && f.allowed) && !flags.some(f => f.key === 'video_upload' || f.key === 'projects'));
  const ent = (await c.rpc('my_entitlements')).data;
  check('vente fermée dans la matrice', ent.filter(e => /^sell_/.test(e.feature)).every(e => !e.allowed));
  check('profil compositeur fictif', (await c.from('composer_profiles').select('id').maybeSingle()).data.id === 'demo-composer' && (await c.rpc('ensure_composer_profile')).data === 'demo-composer');
  const lib = await c.from('tracks').select('*').eq('owner_id', 'demo-composer');
  check('bibliothèque vide au départ', Array.isArray(lib.data) && lib.data.length === 0 && !lib.error);
  check('maybeSingle sans ligne : null', (await c.from('settings').select('*').maybeSingle()).data === null);
  const w = await c.rpc('upsert_track', { payload: { id: 'x' } });
  check('écriture acceptée mais rien ne persiste', !w.error && (await c.from('tracks').select('*')).data.length === 0);
  const fn = await c.functions.invoke('create-media-signed-url', { body: {} });
  check('fonctions serveur indisponibles (erreur claire)', !!fn.error && /tutoriel/.test(fn.error.message));

  // Leçon AdReel : la vidéo d'Alone en deux versions (même montage), et le palier qui montre les versions dans le bloc vidéo.
  const sbA = { window: { location: { pathname: '/layerpitch-backstage.html', search: '?tuto&lesson=adreel' } }, setTimeout, console, URLSearchParams };
  vm.createContext(sbA);
  vm.runInContext(read('api/demo-client.js'), sbA);
  const cA = sbA.window.LayerPitchDemoClient;
  const vids = (await cA.rpc('list_my_videos')).data.videos;
  const caps = (await cA.rpc('list_my_video_captures', { p_pack_id: null })).data;
  const vers = (await cA.rpc('list_video_capture_versions', { p_capture_id: caps[0] && caps[0].id })).data;
  check('leçon AdReel : deux vidéos d’Alone, un montage, deux versions qui pointent vers ces vidéos', vids.length === 2 && caps.length === 1 && vers.length === 2 && vers.every(v => vids.some(x => x.id === v.lastExportVideoId)));
  const entA = (await cA.rpc('my_entitlements')).data.find(e => e.feature === 'versioning');
  const flagsA = (await cA.rpc('my_feature_flags')).data.map(f => f.key);
  check('leçon AdReel : bibliothèque vidéo ouverte et versions enregistrées visibles', entA && entA.level === 'saved' && flagsA.includes('video_upload'));
  check('hors leçon AdReel : bibliothèque vidéo vide', (await c.rpc('list_my_videos')).data.videos.length === 0);
  check('bloc vidéo : choix de la version affichée + bouton « Créer une version vidéo »', /data-role="versionSelect"/.test(read('src/backstage/29-selecteur-de-sfx.js')) && /videoBlockVersionNew/.test(read('src/backstage/29-selecteur-de-sfx.js')));

  // Branchements dans les sources du Backstage.
  const load = read('src/backstage/13-suivi-d-usage.js');
  check('fermé au public par défaut, règle unique dans layerpitch-tuto.js', /function publicOpen\(\) \{ return false; \}/.test(read('layerpitch-tuto.js')) && /function tutoPublicOpen\(\) \{ return window\.LayerPitchTuto\.publicOpen\(\); \}/.test(load));
  check('garde admin avant le faux serveur', /if \(!tutoPublicOpen\(\)\) tutoFullAccess = await tutoAdminGate\(\)/.test(load));
  check('SDK réel non chargé en version publique', /needRealSdk = !tuto \|\| !tutoPublicOpen\(\)/.test(load));
  check('bascule du client en une ligne (layerpitch-tuto.js)', /window\.LayerPitchSupabaseClient = \{ getClient: \(\) => window\.LayerPitchDemoClient \}/.test(read('layerpitch-tuto.js')) && /window\.LayerPitchTuto\.switchToDemo\(\)/.test(load));
  check('aucun brouillon en mode tutoriel', /let draftDisabled = isTutoMode\(\)/.test(read('src/backstage/39-brouillon-automatique.js')));
  check('publication simulée en mode tutoriel', /async function publishAll\(\) \{[^\n]*\n[^\n]*\n?\s*if \(isTutoMode\(\)\)/.test(read('src/backstage/42-publication.js')));
  const page = read('layerpitch-backstage.html');
  check('bandeau + bouton Quitter dans la page', page.includes('id="tutoBanner"') && page.includes('id="btnTutoQuit"'));
  check('lecture publique : leçons limitées aux leçons publiques', /function lessonPlayable\(lesson\) \{ return !isTutoMode\(\) \|\| tutoFullAccess \|\| lessonIsPublic\(lesson\); \}/.test(read('src/backstage/43-visite-guidee.js')));

  const sel = read('src/backstage/15-selecteur-de-morceaux.js');
  check('aucun lien public réel en mode tutoriel', /function computeAdReelUrl\(adReelId\) \{\n  if \(isTutoMode\(\)\) return null;/.test(sel) && /linkButtons\.hidden = isTutoMode\(\)/.test(sel));
  check('« Visualiser le résultat » grisé en mode tutoriel', /viewBtn\.disabled = true/.test(read('src/backstage/43-visite-guidee.js')));

  const i18n = { window: {} };
  vm.createContext(i18n);
  vm.runInContext(read('layerpitch-i18n.js'), i18n);
  ['tutoBannerText', 'tutoQuit', 'tutoSaveSimulated', 'tutoNeedsAccount', 'tutoAccountBadge', 'tutoTryTitle', 'tutoTryDesc', 'tutoNoPublicLink']
    .forEach(k => check('texte ' + k + ' en FR et EN', ['fr', 'en'].every(l => i18n.window.LAYERPITCH_I18N[l].backstage[k])));

  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
