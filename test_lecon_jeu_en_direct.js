// Leçon « Jouer en direct sur une vidéo » (05/11, pack.html?id=p-music-city&tuto&lesson=live-play, pack-lecons.js) : sur la page PUBLIQUE du pack
// « Music City », « Tester en jeu » ouvre la vidéo muette, et le visiteur joue la rue puis le club, couche par couche, puis les glaçons.
// Chaque étape exige son geste ; leçon réservée aux admins jusqu'à son feu vert ; textes FR + EN.
const fs = require('fs'), path = require('path'), vm = require('vm');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
(async () => {
  // Faux serveur : le pack « Music City » sur la page du pack, case « Tester en jeu » cochée, seulement pendant cette leçon.
  const client = search => {
    const sb = { window: { location: { pathname: '/pack.html', search } }, setTimeout, console, URLSearchParams };
    vm.createContext(sb); vm.runInContext(read('api/demo-client.js'), sb); return sb.window.LayerPitchDemoClient;
  };
  const c = client('?id=p-music-city&tuto&lesson=live-play');
  const packs = (await c.from('packs').select('*')).data;
  const trackIds = (await c.from('tracks').select('*')).data.map(t => t.id);
  check('page pack (leçon) : pack « Music City », « Tester en jeu » coché', packs.length === 1 && packs[0].id === 'p-music-city' && packs[0].video_test_mode_enabled === true);
  check('page pack (leçon) : la rue (Jazz Lo Static) et le club (Jazz Lo Lay. Add.) sont dans le pack', ['t-jazz-lo', 'bmvzpxrmghud9j'].every(id => trackIds.includes(id) && packs[0].pack_tracks.some(p => p.track_id === id)));
  check('page pack (leçon) : le Sfx « Glaçons » est là', (await c.from('sfx_library').select('*')).data.some(s => s.id === 'sfx-glacons'));
  check('page pack hors de cette leçon : pas de pack d’exemple', ((await client('?id=p-music-city&tuto&lesson=pack').from('packs').select('*')).data || []).length === 0);

  // Porte d'entrée : réservée aux admins sur la page du pack, même quand le tutoriel public est ouvert.
  const tuto = read('layerpitch-tuto.js');
  check('porte du tutoriel : « live-play » réservée aux admins', /const ADMIN_ONLY_LESSONS = \['live-play', 'versioning', 'versioning-adreel', 'pj-annotate'\];/.test(tuto) && /\|\| lessonAdminOnly\(\)\) && !\(await adminGate\(\)\)/.test(tuto));

  // Page du pack : la leçon n'est chargée que pour elle ; la vidéo muette est proposée dans « Tester en jeu ».
  const pack = read('pack.html');
  check('pack.html : moteur des bulles et leçon chargés seulement avec ?tuto&lesson=live-play', /if \(!q\.has\('tuto'\) \|\| q\.get\('lesson'\) !== 'live-play'\) return;/.test(pack)
    && /lpLoadScriptsInOrder\(\['\.\/layerpitch-guide\.js', '\.\/pack-lecons\.js'\]\)/.test(pack) && !/<script src="pack-lecons\.js/.test(pack) && !/<script src="layerpitch-guide\.js/.test(pack));
  check('pack.html : la vidéo muette remplace la bibliothèque du compte pendant la leçon', /window\.LayerPitchPackLessons && window\.LayerPitchPackLessons\.active\(\)/.test(pack) && /videoTestLibrary = \[window\.LayerPitchPackLessons\.KIT\.video\]/.test(pack));

  // La leçon elle-même.
  const loc = { search: '?id=p-music-city&tuto&lesson=live-play' };
  const sb = { window: { location: loc }, location: loc, URLSearchParams }; vm.createContext(sb); vm.runInContext(read('pack-lecons.js'), sb);
  let opened = null, host = null;
  sb.window.LayerPitchGuide = { create: h => { host = h; return { open: (_k, steps, id) => { opened = { steps, id }; } }; } };
  sb.document = { querySelector: () => null }; sb.localStorage = { getItem: () => null, setItem: () => {} };
  vm.runInContext('window.__L = window.LayerPitchPackLessons.init({ lang: "fr" }); window.__L.start()', sb);
  const L = sb.window.LayerPitchPackLessons, steps = opened.steps;
  const activeOn = L.active(); loc.search = '?id=p-music-city&lesson=live-play'; const offNoTuto = L.active(); loc.search = '?id=p-music-city&tuto&lesson=pack'; const offOther = L.active();
  check('leçon : active seulement avec ?tuto&lesson=live-play', activeOn === true && offNoTuto === false && offOther === false);
  check('leçon : vidéo muette de « Music City » (déjà en ligne)', L.KIT.video.base + L.KIT.video.file === 'https://media.layerpitch.com/tuto/music-city-gameplay-muette.mp4');
  check('leçon : ouverte sous son identifiant', opened.id === 'live-play');
  const order = steps.map(s => s.titleKey);
  check('leçon : ouvrir → vidéo → lecture → rue → porte → club → couche 2 → couche 3 → glaçons → fin', ['lpvWelcomeTitle', 'lpvOpenTitle', 'lpvVideoTitle', 'lpvPlayTitle', 'lpvStreetTitle', 'lpvWalkTitle', 'lpvClubTitle', 'lpvDrumsTitle', 'lpvKeysTitle', 'lpvIceTitle', 'lpvEndTitle'].join() === order.join());
  check('leçon : chaque étape (hors accueil et fin) exige son geste', steps.filter(s => !s.final && s.titleKey !== 'lpvWelcomeTitle').every(s => typeof s.done === 'function' || s.clickDone));
  check('leçon : rien n’est « fait » sur une page vide (pas d’étape qui passe toute seule)', steps.filter(s => typeof s.done === 'function').every(s => !s.done()));
  check('leçon : bulle finale → leçon 7 (intégrer un lecteur), dans le Backstage', host.nextLesson('live-play').lesson.id === 'embed' && host.nextLesson('live-play').n === 7);
  const src = read('pack-lecons.js');
  check('leçon : la porte du club est attendue (13,5 s) avant le club', /done: \(\) => videoAt\(13\.5\)/.test(src));
  check('leçon : couches testées sur le morceau du club en cours de lecture', /const layerOn = n => \{ const b = layerBtn\(n\); return !!\(b && b\.classList\.contains\('active'\)\) && playing\(CLUB\); \};/.test(src));

  // Menu Tutoriel du Backstage : thème AdReels, juste après « Vendre des assets audio », réservée aux admins, mène à la page du pack.
  const src43 = read('src/backstage/43-visite-guidee.js');
  const iPack = src43.indexOf("{ id: 'pack', theme: 'pitch'"), iLive = src43.indexOf("{ id: 'live-play'"), iEmbed = src43.indexOf("{ id: 'embed', theme: 'pitch'");
  check('Backstage : leçon juste après « pack », avant « embed »', iPack > 0 && iLive > iPack && iEmbed > iLive && !/\{ id: '[a-z-]+'/.test(src43.slice(src43.indexOf('] },', iPack), iLive).replace("{ id: 'live-play'", '')));
  check('Backstage : thème AdReels, réservée aux admins, page du pack', /\{ id: 'live-play', theme: 'pitch', public: true, adminOnly: true, page: 'pack', titleKey: 'lpvTitle', descKey: 'lpvDesc' \}/.test(src43)
    && /if \(l && l\.page === 'pack'\) return 'pack\.html\?id=p-music-city';/.test(src43));
  check('Backstage : bulle finale de « pack » → saute une leçon admin fermée', /while \(i >= 0 && LESSONS\[j\] && LESSONS\[j\]\.adminOnly && !lessonOpenToMe\(LESSONS\[j\]\)\) j\+\+;/.test(src43));

  // Textes FR + EN.
  const i18n = { window: {} }; vm.createContext(i18n); vm.runInContext(read('layerpitch-i18n.js'), i18n);
  const I = i18n.window.LAYERPITCH_I18N;
  const keys = [...new Set(steps.flatMap(s => [s.titleKey, s.textKey]))];
  check('leçon : ' + keys.length + ' textes présents en FR et EN (zone pack)', keys.every(k => I.fr.pack[k] && I.en.pack[k]));
  check('menu : titre et description FR + EN (zone backstage), « 6 bis »', ['lpvTitle', 'lpvDesc'].every(k => I.fr.backstage[k] && I.en.backstage[k]) && /^6 bis · /.test(I.fr.backstage.lpvTitle) && /^6 bis · /.test(I.en.backstage.lpvTitle));

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  process.exit(failures ? 1 : 0);
})();
