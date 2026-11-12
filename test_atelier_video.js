// Atelier vidéo (21/10, décidé par Jules-Antoine) : l'outil de capture et de Versioning quitte la page publique du pack pour un atelier
// (atelier.html) ouvert dans le Backstage (onglet Vidéo → Atelier) et l'espace studio (onglet Vidéos) ; la page du pack ne garde que le
// test public (+ une vidéo de sa bibliothèque si le visiteur est connecté). Leçon « Versioning » : Backstage + atelier ; textes FR + EN.
const fs = require('fs'), path = require('path'), vm = require('vm');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
(async () => {
  // Pages fabriquées : l'atelier réutilise les morceaux partagés de la page pack, l'outil n'existe qu'une fois.
  const { TARGETS } = require('./scripts/build-sources.js');
  check('atelier.html fabriqué depuis src/atelier + styles/données/langue de src/pack', TARGETS.atelier && TARGETS.atelier.out === 'atelier.html'
    && TARGETS.atelier.sources.some(s => s.dir === 'src/pack' && s.pattern.test('02-styles.css') && s.pattern.test('10-donnees-et-achat.js') && !s.pattern.test('20-demarrage-de-la-page.js')));
  check('outil de capture déplacé (pas recopié) : plus aucune tranche 13-19 dans src/pack', !fs.readdirSync(path.join(__dirname, 'src/pack')).some(f => /^1[3-9]-/.test(f)));
  const pack = read('pack.html'), atelier = read('atelier.html');
  check('page pack : plus d’outil de capture ni de leçon', !/setupCaptureTrigger|videoCaptureDialog|capture-plan\.js|atelier-lecons\.js|openCapturePanel/.test(pack));
  check('page pack : test public gardé + vidéo de sa bibliothèque si connecté (admin jusqu’au feu vert)', /id="videoTestDialog"/.test(pack) && /id="videoTestLibraryPick" hidden/.test(pack)
    && /openVideoTestDialog = \(\) => \{ dialog\.showModal\(\); loadLibrary\(\); \}/.test(pack) && /if \(!isAdmin\) return; \/\/ nouveauté réservée/.test(pack) && /service: 'library'/.test(pack));
  check('page pack : la vidéo de la bibliothèque se joue ici, son coupé', /<video src="\$\{escapeHtml\(parsed\.url\)\}" controls muted playsinline><\/video>/.test(pack));
  check('atelier : choix du pack, outil, dialogue de la vidéo, leçon', /id="atelierPackSelect"/.test(atelier) && /async function setupCaptureTrigger\(pack, container, opts\)/.test(atelier)
    && /id="videoCaptureDialog"/.test(atelier) && /function openCapturePanel/.test(atelier) && /atelier-lecons\.js/.test(atelier) && /capture-versioning\.js/.test(atelier));
  // 04/11 : ces trois fonctions s'étaient perdues au déplacement (21/10), l'atelier ne pouvait plus rien enregistrer.
  check('atelier : la capture démarre et s’arrête', ['startCapture', 'stopCapture'].every(f => new RegExp('function ' + f + '\\(').test(atelier)));
  check('atelier : plus d’armement : ni bouton ⏺ ni piste armée', !/armedTrackId|video-capture-arm-track-btn/.test(atelier));
  check('atelier : arrêter la capture arrête aussi les morceaux lancés pendant la prise', /new Set\(newPassEvents\.map/.test(atelier));
  check('atelier : studio = packs achetés par l’équipe, compositeur = ses packs', /client\.rpc\('my_team_purchases'\)/.test(atelier) && /\.eq\('owner_id', composerId\)/.test(atelier));
  check('atelier : plus besoin du réglage « Tester en jeu » du pack', !/if \(!pack\.videoTestModeEnabled\) return/.test(atelier));
  check('atelier : données publiées du compositeur du pack (le sien ou le vendeur)', /lastResolvedOwnerId = owner\.owner_id/.test(atelier) && /loadSiteDataFromPostgres\(owner\.owner_id\)/.test(atelier));
  check('atelier : prévient la page qui l’accueille (même origine)', /postMessage\(Object\.assign\(\{ source: 'lp-atelier', type \}/.test(atelier) && /location\.origin\)/.test(atelier));

  // Backstage : sous-onglet Projets vidéo (cadre) et bloc vidéo l'ouvrent.
  const bs = read('layerpitch-backstage.html');
  check('Backstage : sous-onglet Atelier = cadre atelier.html', /<iframe id="videoAtelierFrame"/.test(bs) && /return '\.\/atelier\.html\?' \+/.test(bs));
  check('Backstage : plus de lien vers l’outil de la page pack', !/pack\.html\?[^`'"]*capture=1/.test(bs) && !/capture=1&montage/.test(bs));
  check('Backstage : projet vidéo choisi (et « Créer une version vidéo » du bloc) ouvrent l’atelier sur le montage',
    /function videoProjectFrameUrl\(p\) \{ return videoAtelierUrl\(\{ packId: p\.packId, montageId: p\.id \}\); \}/.test(bs) && /openVideoAtelier\(\{ packId: newVersion\.dataset\.pack, montageId: newVersion\.dataset\.montage \}\)/.test(bs));
  check('Backstage : bloc vidéo → « Faire une vidéo avec un pack (atelier) »', /data-role="openAtelier"/.test(bs) && /atelierBtn\.addEventListener\('click', \(\) => openVideoAtelier\(\)\)/.test(bs));
  check('Backstage : messages de l’atelier acceptés de la même origine seulement', /if \(e\.origin !== location\.origin \|\| !e\.data \|\| e\.data\.source !== 'lp-atelier'\) return;/.test(bs));
  const studio = read('studio.html');
  check('espace studio : un rafraîchissement de session (provoqué par l’atelier) ne redessine pas la page (sinon l’atelier se recharge en boucle)',
    /if \(userId === lastAuthUserId\) return;/.test(studio) && !/onAuthStateChange\(\(\) => render\(\)\)/.test(studio));
  check('espace studio : atelier au nom du studio dans l’onglet Vidéos', /<iframe id="svAtelier"/.test(studio) && /studio: '1'/.test(studio) && !/pack\.html\?[^`]*capture=1/.test(studio));
  check('atelier : chaque enregistrement prévient la page hôte (« changed »)', /c\.rpc = async \(name, args\) => \{ const r = await rpc\(name, args\); if \(ATELIER_WRITES\.has\(name\) && r && !r\.error\) atelierTell\('changed'\)/.test(atelier) && /atelierWatchWrites\(\);/.test(atelier));
  check('Backstage et studio : listes rafraîchies sans recharger l’atelier', /if \(e\.data\.type === 'changed'\) \{\s*videoVersioningIndexPromise = null;/.test(bs)
    && /e\.data\.type !== 'changed'\) return;\s*const host = \$\('svLists'\);\s*if \(host\) renderVideoLists\(host\);/.test(studio));

  // Faux serveur : dans l'atelier, la leçon part de zéro (montages en mémoire) ; dans le Backstage, le montage de « Music City » déjà publié.
  const at = { window: { location: { pathname: '/atelier.html', search: '?id=p-joris&tuto&lesson=versioning' } }, setTimeout, console, URLSearchParams };
  vm.createContext(at); vm.runInContext(read('api/demo-client.js'), at);
  const c = at.window.LayerPitchDemoClient;
  const packs = (await c.from('packs').select('*')).data;
  check('atelier (leçon) : packs « Joris » et « Footsteps » du compositeur fictif, trois morceaux de Joris', packs.map(p => p.id).join() === 'p-joris,p-footsteps' && packs.every(p => p.owner_id === 'demo-composer') && (await c.from('tracks').select('*')).data.length === 3 && (await c.from('sfx_library').select('*')).data.length === 3);
  const ent = (await c.rpc('my_entitlements')).data;
  check('droits de la leçon : enregistrer un montage et versionner', ent.some(e => e.feature === 'test_in_game' && e.level === 'saved') && ent.some(e => e.feature === 'versioning' && e.level === 'saved'));
  check('atelier : aucun montage au départ', (await c.rpc('list_my_video_captures', {})).data.length === 0);
  await c.rpc('save_video_capture', { p_id: 'm1', p_pack_id: 'p-music-city', p_title: 'Musique 1', p_video_filename: 'music-city-gameplay-muette.mp4', p_events: [{ t: 1, name: 'x' }] });
  check('montage gardé en mémoire (liste + lecture)', (await c.rpc('list_my_video_captures', { p_pack_id: 'p-music-city' })).data.length === 1 && (await c.rpc('get_video_capture', { p_id: 'm1' })).data.title === 'Musique 1');
  await c.rpc('save_video_capture_version', { p_id: 'v2', p_capture_id: 'm1', p_title: 'Musique 2', p_substitutions: { a: 'b' } });
  check('version vidéo gardée en mémoire', (await c.rpc('list_video_capture_versions', { p_capture_id: 'm1' })).data.map(v => v.title).join() === 'Musique 2');
  const bk = { window: { location: { pathname: '/layerpitch-backstage.html', search: '?tuto&lesson=versioning' } }, setTimeout, console, URLSearchParams };
  vm.createContext(bk); vm.runInContext(read('api/demo-client.js'), bk);
  const caps = (await bk.window.LayerPitchDemoClient.rpc('list_my_video_captures', {})).data;
  check('Backstage (leçon) : le montage de « Music City » publié en deux musiques, pour le bloc vidéo', caps.length === 1 && caps[0].id === 'cap-music-city' && (await bk.window.LayerPitchDemoClient.rpc('list_my_videos')).data.videos.length === 2);
  const sb2 = { window: { location: { pathname: '/atelier.html', search: '?id=p-music-city' } }, setTimeout, console, URLSearchParams };
  vm.createContext(sb2); vm.runInContext(read('api/demo-client.js'), sb2);
  check('hors leçon : pas de pack ni de montage d’exemple', (await sb2.window.LayerPitchDemoClient.from('packs').select('*')).data.length === 0);
  check('chargeur des scripts du compte : ne remet pas le vrai client en mode tutoriel', /window\.LayerPitchTuto\.switchToDemo\(\)/.test(read('src/pack/10-donnees-et-achat.js')));

  // Leçon : partie atelier (choisir le pack, puis le reste après rechargement), partie Backstage (onglet Vidéo, bloc vidéo).
  const i18n = { window: {} }; vm.createContext(i18n); vm.runInContext(read('layerpitch-i18n.js'), i18n);
  const I = i18n.window.LAYERPITCH_I18N;
  const has = k => ['fr', 'en'].every(l => Object.values(I[l]).some(z => z && z[k]));
  const runLesson = search => {
    const sbl = { window: {}, location: { search }, URLSearchParams }; vm.createContext(sbl); vm.runInContext(read('atelier-lecons.js'), sbl);
    let opened = null;
    sbl.window.LayerPitchGuide = { create: () => ({ open: (_k, steps) => { opened = steps; } }) };
    sbl.document = { querySelector: () => null }; sbl.localStorage = { getItem: () => null };
    vm.runInContext('window.__L = window.LayerPitchAtelierLessons.init({ lang: "fr" }); window.__L.start()', sbl);
    return { all: sbl.window.__L.steps, opened };
  };
  const first = runLesson('?tuto&lesson=versioning'), second = runLesson('?id=p-joris&tuto&lesson=versioning');
  check('atelier : sans pack, la leçon fait directement choisir le pack', first.opened.length === 1 && first.opened[0].selector === '#atelierPackSelect');
  check('atelier : pack choisi (rechargé), la leçon reprend à « Choisir la vidéo »', second.opened[0].selector === '.video-capture-trigger-btn' && second.opened[second.opened.length - 1].final);
  const keys = new Set(first.all.flatMap(s => [s.titleKey, s.textKey]));
  check('leçon (atelier) : ' + keys.size + ' textes présents en FR et EN', [...keys].every(has));
  const src43pre = read('src/backstage/43-visite-guidee.js');
  const order = second.opened.map(s => s.titleKey);
  // 07/11 : leçon sur « Joris » : marqueurs d'après l'image -> blocs à la souris (musique 1, ascenseur, musique 2) -> passe additive (pas en temps réel) -> écoute -> nom -> enregistrement -> version.
  const seq = ['pvVideoTitle', 'pvMark1Title', 'pvMark2Title', 'pvMusic1Title', 'pvMusic1EndTitle', 'pvElevTitle', 'pvMusic2Title', 'pvAdditiveTitle', 'pvRecordTitle', 'pvStepsTitle', 'pvStopTitle', 'pvHearTitle', 'pvNameTitle', 'pvSaveTitle', 'pvNewTitle', 'pvPickTitle', 'pvAddPackTitle', 'pvPickStepsTitle', 'pvListenTitle', 'pvKeepTitle'];
  check('atelier (Joris) : marqueurs → musique 1 → ascenseur → musique 2 → passe additive (pas) → écoute → nom → version (drone, pack Footsteps, pas stone)',
    seq.every((k, i) => order.indexOf(k) >= 0 && (i === 0 || order.indexOf(k) === order.indexOf(seq[i - 1]) + 1)));
  const al = read('atelier-lecons.js');
  check('atelier : la version demande le drone « urbex » (fichier) à la place du drone « rencontre », et les pas stone', /RENC = 'bmw3ds8idckeds', URBEX = 'bmw41gclr2m44q'/.test(al) && /sel\.value === URBEX/.test(al) && /sel\.value === STONE/.test(al));
  check('atelier : la vidéo de la leçon est la copie muette de Joris', /tuto\/Joris\/joris-gameplay-muette\.mp4/.test(al));
  const dc = read('api/demo-client.js');
  check('atelier (leçon) : pack Joris (3 morceaux, ascenseur, pas) et pack Footsteps (Stone Walk), seulement dans la leçon Versioning', /joPack\('p-joris', 'Joris', \['bmw3drvaib1os9', 'bmw41gclr2m44q', 'bmw3ds8idckeds'\], \['bmw3dfcf4ye93a', 'bmw40wgx1bwy7y'\]\)/.test(dc) && /joPack\('p-footsteps', 'Footsteps', \[\], \['bmw3dg2foqzndw'\]\)/.test(dc) && /lessonParam\(\) === 'versioning' && table === 'packs'/.test(dc));
  check('atelier : la prise s’arrête toute seule à la fin de la vidéo, sans déborder', /videoEl\.addEventListener\('ended', \(\) => \{ if \(videoCaptureState\) recordBtn\.click\(\); \}\)/.test(read('atelier.html')) && /Number\.isFinite\(dur\) \? dur : Infinity/.test(read('atelier.html')));
  check('pack Music City : glaçons et verre (leçons AdReel et « Jouer en direct »)', /\['sfx-glacons', 'sfx-verre'\]\.includes\(x\.id\)/.test(read('api/demo-client.js')));
  check('frise sans capture : morceaux du pack proposés, bouton « Écouter le montage »', /handTrackIds/.test(read('atelier.html')) && /id="videoCaptureListenBtn"/.test(read('atelier.html')));
  check('frise : ajout au double-clic, couche qui entre à la mesure suivante, départ de couche jusqu’à la fin de la musique, pistes vides pour les Sfx du morceau, tête de lecture déplaçable', /addEventListener\('dblclick'/.test(read('atelier.html')) && /musicEnd > at \+ 0\.5/.test(read('atelier.html')) && /Math\.ceil\(\(at - anchor\) \/ bar - 1e-3\) \* bar/.test(read('atelier.html')) && /sfxGroups\[sid\] = \{ 0: \[\] \}/.test(read('atelier.html')) && /vct-scrub/.test(read('atelier.html')));
  check('une seule bulle à la fois : le Backstage cache la sienne pendant celles de l’atelier ; leçon lancée aussi sans pack', /lp-atelier-lesson-open \.tour-root-lesson \{ display: none; \}/.test(read('layerpitch-backstage.html')) && /type === 'lessonOpen'/.test(read('layerpitch-backstage.html')) && /atelierTell\('lessonOpen'\)/.test(read('atelier.html')) && /atelierPickPackHint'\)\)\); startAtelierLessonIfAsked\(\); return;/.test(read('atelier.html')));
  check('plein écran de l’atelier (bouton, étape de la leçon) ; une seule écoute à la fois', /id="videoAtelierFullBtn"/.test(read('layerpitch-backstage.html')) && /lvFullTitle/.test(src43pre) && /if \(versioning\) versioning\.stop\(\)/.test(read('atelier.html')) && /if \(montageListen && e\.target\.closest/.test(read('atelier.html')));
  check('lire l’image joue aussi le montage (admins), musique gardée tant que la frise ne change pas, resynchro au saut', /videoEl\.addEventListener\('play'/.test(read('atelier.html')) && /__lpCaptureIsAdmin\) return;/.test(read('atelier.html')) && /montageBuffer = null; montageGen\+\+/.test(read('atelier.html')) && /LayerPitchAVSync\.follow\(videoEl, \{ buffers: \[buffer\]/.test(read('atelier.html')) && /seeked: start/.test(read('layerpitch-av-sync.js')) && /isListening: \(\) => !!listening/.test(read('capture-versioning.js')));
  check('atelier : la vidéo reste accrochée en haut quand on fait défiler (sticky, sans saut de mise en page)', /function pinCaptureVideo/.test(read('atelier.html')) && /\.video-capture-dock \{ position: sticky; top: 0/.test(read('atelier.html')) && !/video-capture-pinned \{ position: fixed/.test(read('atelier.html')));
  const src43 = src43pre;
  const lv = src43.slice(src43.indexOf("{ id: 'versioning'"), src43.indexOf('] },', src43.indexOf("{ id: 'versioning'")));
  check('leçon (Backstage) : onglet Vidéo → Atelier, sans page pack ; s’arrête à la sortie de l’atelier', /data-tab="videoLibrary"/.test(lv) && /data-video-subtab="capture"/.test(lv) && /#videoAtelierFrame/.test(lv)
    && !/versionNew/.test(lv) && !/page: 'pack'/.test(lv) && /reload: true, titleKey/.test(lv) && !/soon: true/.test(lv));
  // 05/11 : la partie « bloc vidéo d'un AdReel » est sa propre leçon, juste après.
  const lva = src43.slice(src43.indexOf("{ id: 'versioning-adreel'"), src43.indexOf('] },', src43.indexOf("{ id: 'versioning-adreel'")));
  check('leçon « Montrer les versions dans un AdReel » : juste après, bloc vidéo, versions, nouvelle version', src43.indexOf("{ id: 'versioning-adreel'") > src43.indexOf("{ id: 'versioning'") && /\[data-role="versionSelect"\]/.test(lva) && /\[data-role="versionNew"\]/.test(lva) && /reload: true/.test(lva)
    && [...lva.matchAll(/(?:titleKey|textKey|descKey): '([^']+)'/g)].every(m => has(m[1])) && /\['versioning', 'versioning-adreel'\]\.includes\(lessonParam\(\)\)/.test(read('api/demo-client.js')));
  const bkeys = [...lv.matchAll(/(?:titleKey|textKey): '([^']+)'/g)].map(m => m[1]);
  check('leçon (Backstage) : ' + bkeys.length + ' textes présents en FR et EN', bkeys.every(has));

  // Suite : annoter le montage dans l'espace Projet (projet.html?tuto&lesson=pj-annotate).
  const dp = { window: {}, console, setTimeout }; vm.createContext(dp); vm.runInContext(read('api/demo-projects.js'), dp);
  const PJ = dp.window.LayerPitchDemoProjects.create({ seedMontage: true });
  const content = (await PJ.content('demo-music-city')).data;
  check('Projet (leçon) : le montage de « Music City » est dans le Projet', content.assets.some(a => a.kind === 'montage' && a.montageId === 'cap-music-city'));
  const mont = (await bk.window.LayerPitchDemoClient.rpc('get_public_video_montage', { p_capture_id: 'cap-music-city' })).data;
  check('lecteur à versions : deux musiques sur la même scène', mont && mont.versions.length === 2 && mont.versions.every(v => v.url && v.kind === 'video'));
  check('page Projet : le montage d’exemple seulement pour cette leçon', /seedMontage: params\.get\('lesson'\) === 'pj-annotate'/.test(read('projet.html')));
  const pl = read('projet-lecons.js');
  const ann = pl.slice(pl.indexOf("'pj-annotate': ["), pl.indexOf("'pj-moodboard': ["));
  check('leçon « Annoter » : onglet Vidéos, version, instant, note adressée', /data-tab="videos"/.test(ann) && /lp-video-versions select/.test(ann) && /noteHere/.test(ann) && /noteTo/.test(ann) && /noteAdd/.test(ann));
  const akeys = [...ann.matchAll(/(?:titleKey|textKey): '([^']+)'/g)].map(m => m[1]).concat(['plAnnTitle', 'plAnnDesc']);
  check('leçon « Annoter » : ' + akeys.length + ' textes présents en FR et EN', akeys.every(has));
  check('leçon « Annoter » : fermée (admin seulement, 12/11, le temps de la refaire) au menu du Backstage (Préproduction), chaque geste exigé', /\{ id: 'pj-annotate', theme: 'preprod', public: true, adminOnly: true, page: 'projet', titleKey/.test(src43) && !/id: 'pj-annotate'[^\n]*soon: true/.test(pl) && /v\.paused && v\.currentTime >= 7/.test(ann) && /joshua/.test(ann));
  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
