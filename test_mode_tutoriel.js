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

  // Leçons Sfx et événements d'effets (22/10) : le morceau « Jazz Lo Static » est préchargé ; dans la leçon des événements, les trois Sfx de la leçon
  // précédente sont déjà dans la bibliothèque et attachés au morceau (pour jouer l'ambiance du bar).
  for (const lesson of ['sfx', 'events']) {
    const sbL = { window: { location: { pathname: '/layerpitch-backstage.html', search: '?tuto&lesson=' + lesson } }, setTimeout, console, URLSearchParams };
    vm.createContext(sbL);
    vm.runInContext(read('api/demo-client.js'), sbL);
    const cl = sbL.window.LayerPitchDemoClient;
    const tl = (await cl.from('tracks').select('*')).data;
    check('leçon ' + lesson + ' : « Jazz Lo Static » préchargé, fichier lisible (dossier dans l’adresse de base)', tl.length === 1 && tl[0].title === 'Jazz Lo Static' && /\/tuto\/Jazz%20Lo\/$/.test(tl[0].base) && tl[0].layers[0].file.indexOf('/') < 0);
    const sl = (await cl.from('sfx_library').select('*')).data;
    if (lesson === 'events') {
      check('leçon events : les trois Sfx sont dans la bibliothèque', Array.isArray(sl) && sl.length === 3 && sl.every(x => x.spatial && x.spatial.enabled));
      check('leçon events : ils sont attachés au morceau', tl[0].track_sfx.length === 3 && tl[0].track_sfx.every(r => sl.some(x => x.id === r.sfx_id)));
      check('leçon events : l’ambiance du bar glisse sur 20 s, les glaçons vont pas à pas', sl.find(x => x.id === 'sfx-bar').spatial.path.mode === 'glide' && sl.find(x => x.id === 'sfx-bar').spatial.path.durationSec === 20 && sl.find(x => x.id === 'sfx-glacons').spatial.path.mode === 'steps');
    } else {
      check('leçon sfx : bibliothèque Sfx vide au départ', !sl || sl.length === 0);
      check('leçon sfx : morceau sans Sfx attaché', tl[0].track_sfx.length === 0);
    }
  }
  // Leçon AdReel : la vidéo d'Alone en deux versions (même montage), et le palier qui montre les versions dans le bloc vidéo.
  const sbA = { window: { location: { pathname: '/layerpitch-backstage.html', search: '?tuto&lesson=adreel' } }, setTimeout, console, URLSearchParams };
  vm.createContext(sbA);
  vm.runInContext(read('api/demo-client.js'), sbA);
  const cA = sbA.window.LayerPitchDemoClient;
  const vids = (await cA.rpc('list_my_videos')).data.videos;
  const caps = (await cA.rpc('list_my_video_captures', { p_pack_id: null })).data;
  const vers = (await cA.rpc('list_video_capture_versions', { p_capture_id: caps[0] && caps[0].id })).data;
  check('leçon AdReel : deux vidéos d’Alone = export du montage (musique 1) + une version vidéo (musique 2)', vids.length === 2 && caps.length === 1 && caps[0].lastExportVideoId === vids[0].id && vers.length === 1 && vers[0].lastExportVideoId === vids[1].id);
  const entA = (await cA.rpc('my_entitlements')).data.find(e => e.feature === 'versioning');
  const flagsA = (await cA.rpc('my_feature_flags')).data.map(f => f.key);
  check('leçon AdReel : bibliothèque vidéo ouverte et versions enregistrées visibles', entA && entA.level === 'saved' && flagsA.includes('video_upload'));
  check('hors leçon AdReel : bibliothèque vidéo vide', (await c.rpc('list_my_videos')).data.videos.length === 0);
  check('migration : le montage retient son export direct, proposé comme « montage d’origine »', /add column if not exists last_export_video_id/.test(read('supabase/migrations/20261021010000_video_capture_export_link.sql')) && /c\.lastExportVideoId \? \[\{ key: 'original', versionId: null/.test(read('src/backstage/41-envoi-r2-et-bibliotheque-video.js')) && /set_video_capture_export/.test(read('src/atelier/18-panneau-de-capture.js')));
  check('bloc vidéo : choix de la version affichée + bouton « Créer une version vidéo »', /data-role="versionSelect"/.test(read('src/backstage/29-selecteur-de-sfx.js')) && /videoBlockVersionNew/.test(read('src/backstage/29-selecteur-de-sfx.js')));

  // Branchements dans les sources du Backstage.
  const load = read('src/backstage/13-suivi-d-usage.js');
  check('fermé au public par défaut (feu vert public_tutorial illisible = fermé), règle unique dans layerpitch-tuto.js', /let flagOpen = false;/.test(read('layerpitch-tuto.js')) && /key=eq\.public_tutorial/.test(read('layerpitch-tuto.js')) && /function publicOpen\(\) \{ return flagOpen; \}/.test(read('layerpitch-tuto.js')) && /function tutoPublicOpen\(\) \{ return window\.LayerPitchTuto\.publicOpen\(\); \}/.test(load));
  check('garde de connexion avant le faux serveur (bêta-testeurs : tout compte connecté ; admin : accès complet)', /if \(!tutoPublicOpen\(\)\) tutoFullAccess = \(await tutoAccessGate\(\)\) === 'admin'/.test(load));
  check('SDK réel non chargé en version publique', /needRealSdk = !tuto \|\| !tutoPublicOpen\(\)/.test(load));
  check('bascule du client en une ligne (layerpitch-tuto.js)', /window\.LayerPitchSupabaseClient = \{ getClient: \(\) => window\.LayerPitchDemoClient \}/.test(read('layerpitch-tuto.js')) && /window\.LayerPitchTuto\.switchToDemo\(\)/.test(load));
  check('aucun brouillon en mode tutoriel', /let draftDisabled = isTutoMode\(\)/.test(read('src/backstage/39-brouillon-automatique.js')));
  check('publication simulée en mode tutoriel', /async function publishAll\(\) \{[^\n]*\n[^\n]*\n?\s*if \(isTutoMode\(\)\)/.test(read('src/backstage/42-publication.js')));
  const page = read('layerpitch-backstage.html');
  check('bandeau + bouton Quitter dans la page', page.includes('id="tutoBanner"') && page.includes('id="btnTutoQuit"'));
  check('lecture publique : leçons limitées aux leçons publiques, et aux thèmes ouverts hors admin', /function lessonPlayable\(lesson\) \{ return lessonOpenToMe\(lesson\) && \(!isTutoMode\(\) \|\| tutoFullAccess \|\| lessonIsPublic\(lesson\)\); \}/.test(read('src/backstage/43-visite-guidee.js')));

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
