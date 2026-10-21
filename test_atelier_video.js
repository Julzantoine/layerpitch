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
  check('atelier : studio = packs achetés par l’équipe, compositeur = ses packs', /client\.rpc\('my_team_purchases'\)/.test(atelier) && /\.eq\('owner_id', composerId\)/.test(atelier));
  check('atelier : plus besoin du réglage « Tester en jeu » du pack', !/if \(!pack\.videoTestModeEnabled\) return/.test(atelier));
  check('atelier : données publiées du compositeur du pack (le sien ou le vendeur)', /lastResolvedOwnerId = owner\.owner_id/.test(atelier) && /loadSiteDataFromPostgres\(owner\.owner_id\)/.test(atelier));
  check('atelier : prévient la page qui l’accueille (même origine)', /postMessage\(Object\.assign\(\{ source: 'lp-atelier', type \}/.test(atelier) && /location\.origin\)/.test(atelier));

  // Backstage : sous-onglet Atelier (cadre), Versioning et bloc vidéo l'ouvrent.
  const bs = read('layerpitch-backstage.html');
  check('Backstage : sous-onglet Atelier = cadre atelier.html', /<iframe id="videoAtelierFrame"/.test(bs) && /return '\.\/atelier\.html\?' \+/.test(bs));
  check('Backstage : plus de lien vers l’outil de la page pack', !/pack\.html\?[^`'"]*capture=1/.test(bs) && !/capture=1&montage/.test(bs));
  check('Backstage : « Ouvrir » (Versioning) et « Créer une version vidéo » (bloc) ouvrent l’atelier sur le montage',
    /openVideoAtelier\(\{ packId: b\.dataset\.atelierPack, montageId: b\.dataset\.atelierMontage \}\)/.test(bs) && /openVideoAtelier\(\{ packId: newVersion\.dataset\.pack, montageId: newVersion\.dataset\.montage \}\)/.test(bs));
  check('Backstage : bloc vidéo → « Faire une vidéo avec un pack (atelier) »', /data-role="openAtelier"/.test(bs) && /atelierBtn\.addEventListener\('click', \(\) => openVideoAtelier\(\)\)/.test(bs));
  check('Backstage : messages de l’atelier acceptés de la même origine seulement', /if \(e\.origin !== location\.origin \|\| !e\.data \|\| e\.data\.source !== 'lp-atelier'\) return;/.test(bs));
  const studio = read('studio.html');
  check('espace studio : un rafraîchissement de session (provoqué par l’atelier) ne redessine pas la page (sinon l’atelier se recharge en boucle)',
    /if \(userId === lastAuthUserId\) return;/.test(studio) && !/onAuthStateChange\(\(\) => render\(\)\)/.test(studio));
  check('espace studio : atelier au nom du studio dans l’onglet Vidéos', /<iframe id="svAtelier"/.test(studio) && /studio: '1'/.test(studio) && !/pack\.html\?[^`]*capture=1/.test(studio));
  check('atelier : chaque enregistrement prévient la page hôte (« changed »)', /c\.rpc = async \(name, args\) => \{ const r = await rpc\(name, args\); if \(ATELIER_WRITES\.has\(name\) && r && !r\.error\) atelierTell\('changed'\)/.test(atelier) && /atelierWatchWrites\(\);/.test(atelier));
  check('Backstage et studio : listes rafraîchies sans recharger l’atelier', /if \(e\.data\.type === 'changed'\) \{\s*videoVersioningIndexPromise = null;/.test(bs)
    && /e\.data\.type !== 'changed'\) return;\s*const host = \$\('svLists'\);\s*if \(host\) renderVideoLists\(host\);/.test(studio));

  // Faux serveur : dans l'atelier, la leçon part de zéro (montages en mémoire) ; dans le Backstage, le montage d'« Alone » déjà publié.
  const at = { window: { location: { pathname: '/atelier.html', search: '?id=p-alone&tuto&lesson=versioning' } }, setTimeout, console, URLSearchParams };
  vm.createContext(at); vm.runInContext(read('api/demo-client.js'), at);
  const c = at.window.LayerPitchDemoClient;
  const packs = (await c.from('packs').select('*')).data;
  check('atelier (leçon) : pack d’exemple du compositeur fictif et ses morceaux', packs.length === 1 && packs[0].owner_id === 'demo-composer' && (await c.from('tracks').select('*')).data.length >= 2);
  const ent = (await c.rpc('my_entitlements')).data;
  check('droits de la leçon : enregistrer un montage et versionner', ent.some(e => e.feature === 'test_in_game' && e.level === 'saved') && ent.some(e => e.feature === 'versioning' && e.level === 'saved'));
  check('atelier : aucun montage au départ', (await c.rpc('list_my_video_captures', {})).data.length === 0);
  await c.rpc('save_video_capture', { p_id: 'm1', p_pack_id: 'p-alone', p_title: 'Musique 1', p_video_filename: 'alone-gameplay-muette.mp4', p_events: [{ t: 1, name: 'x' }] });
  check('montage gardé en mémoire (liste + lecture)', (await c.rpc('list_my_video_captures', { p_pack_id: 'p-alone' })).data.length === 1 && (await c.rpc('get_video_capture', { p_id: 'm1' })).data.title === 'Musique 1');
  await c.rpc('save_video_capture_version', { p_id: 'v2', p_capture_id: 'm1', p_title: 'Musique 2', p_substitutions: { a: 'b' } });
  check('version vidéo gardée en mémoire', (await c.rpc('list_video_capture_versions', { p_capture_id: 'm1' })).data.map(v => v.title).join() === 'Musique 2');
  const bk = { window: { location: { pathname: '/layerpitch-backstage.html', search: '?tuto&lesson=versioning' } }, setTimeout, console, URLSearchParams };
  vm.createContext(bk); vm.runInContext(read('api/demo-client.js'), bk);
  const caps = (await bk.window.LayerPitchDemoClient.rpc('list_my_video_captures', {})).data;
  check('Backstage (leçon) : le montage d’« Alone » publié en deux musiques, pour le bloc vidéo', caps.length === 1 && caps[0].id === 'cap-alone' && (await bk.window.LayerPitchDemoClient.rpc('list_my_videos')).data.videos.length === 2);
  const sb2 = { window: { location: { pathname: '/atelier.html', search: '?id=p-alone' } }, setTimeout, console, URLSearchParams };
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
  const first = runLesson('?tuto&lesson=versioning'), second = runLesson('?id=p-alone&tuto&lesson=versioning');
  check('atelier : sans pack, la leçon fait choisir le pack', first.opened.length === 2 && first.opened[1].selector === '#atelierPackSelect');
  check('atelier : pack choisi (rechargé), la leçon reprend à « Choisir la vidéo »', second.opened[0].selector === '.video-capture-trigger-btn' && second.opened[second.opened.length - 1].final);
  const keys = new Set(first.all.flatMap(s => [s.titleKey, s.textKey]));
  check('leçon (atelier) : ' + keys.size + ' textes présents en FR et EN', [...keys].every(has));
  const src43 = read('src/backstage/43-visite-guidee.js');
  const lv = src43.slice(src43.indexOf("{ id: 'versioning'"), src43.indexOf('] },', src43.indexOf("{ id: 'versioning'")));
  check('leçon (Backstage) : onglet Vidéo → Atelier → bloc vidéo, sans page pack', /data-tab="videoLibrary"/.test(lv) && /data-video-subtab="capture"/.test(lv) && /#videoAtelierFrame/.test(lv)
    && /\[data-role="versionNew"\]/.test(lv) && !/page: 'pack'/.test(src43) && /reload: true, soon: true/.test(lv));
  const bkeys = [...lv.matchAll(/(?:titleKey|textKey): '([^']+)'/g)].map(m => m[1]);
  check('leçon (Backstage) : ' + bkeys.length + ' textes présents en FR et EN', bkeys.every(has));

  // Suite : annoter le montage dans l'espace Projet (projet.html?tuto&lesson=pj-annotate).
  const dp = { window: {}, console, setTimeout }; vm.createContext(dp); vm.runInContext(read('api/demo-projects.js'), dp);
  const PJ = dp.window.LayerPitchDemoProjects.create({ seedMontage: true });
  const content = (await PJ.content('demo-barque')).data;
  check('Projet (leçon) : le montage d’« Alone » est dans le Projet', content.assets.some(a => a.kind === 'montage' && a.montageId === 'cap-alone'));
  const mont = (await bk.window.LayerPitchDemoClient.rpc('get_public_video_montage', { p_capture_id: 'cap-alone' })).data;
  check('lecteur à versions : deux musiques sur la même scène', mont && mont.versions.length === 2 && mont.versions.every(v => v.url && v.kind === 'video'));
  check('page Projet : le montage d’exemple seulement pour cette leçon', /seedMontage: params\.get\('lesson'\) === 'pj-annotate'/.test(read('projet.html')));
  const pl = read('projet-lecons.js');
  const ann = pl.slice(pl.indexOf("'pj-annotate': ["), pl.indexOf("'pj-moodboard': ["));
  check('leçon « Annoter » : onglet Vidéos, version, instant, note adressée', /data-tab="videos"/.test(ann) && /lp-video-versions select/.test(ann) && /noteHere/.test(ann) && /noteTo/.test(ann) && /noteAdd/.test(ann));
  const akeys = [...ann.matchAll(/(?:titleKey|textKey): '([^']+)'/g)].map(m => m[1]).concat(['plAnnTitle', 'plAnnDesc']);
  check('leçon « Annoter » : ' + akeys.length + ' textes présents en FR et EN', akeys.every(has));
  check('leçon « Annoter » : au menu du Backstage (Préproduction), « bientôt » tant que les vidéos manquent', /\{ id: 'pj-annotate', theme: 'preprod', public: true, page: 'projet', soon: true/.test(src43));
  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
