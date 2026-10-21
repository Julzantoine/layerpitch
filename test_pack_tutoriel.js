// Leçon « Versioning vidéo » sur la page d'un pack (pack.html?id=p-alone&u=demo&tuto&lesson=versioning, 21/10) : faux serveur avec le
// pack d'exemple (outil vidéo ouvert), montages et versions gardés en mémoire ; page publique inchangée sans ?tuto ; textes FR + EN.
const fs = require('fs'), path = require('path'), vm = require('vm');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
(async () => {
  const sb = { window: { location: { pathname: '/pack.html', search: '?id=p-alone&u=demo&tuto&lesson=versioning' } }, setTimeout, console, URLSearchParams };
  vm.createContext(sb);
  vm.runInContext(read('api/demo-client.js'), sb);
  const c = sb.window.LayerPitchDemoClient;
  check('le nom « demo » mène au compositeur fictif (propriétaire du pack)', (await c.rpc('resolve_composer_handle', { p_handle: 'demo' })).data === 'demo-composer');
  const packs = (await c.from('packs').select('*')).data;
  check('pack d’exemple avec l’outil vidéo ouvert et ses morceaux', packs.length === 1 && packs[0].video_test_mode_enabled === true && (await c.from('tracks').select('*')).data.length >= 2);
  const ent = (await c.rpc('my_entitlements')).data;
  check('droits de la leçon : enregistrer un montage et versionner', ent.some(e => e.feature === 'test_in_game' && e.level === 'saved') && ent.some(e => e.feature === 'versioning' && e.level === 'saved'));
  await c.rpc('save_video_capture', { p_id: 'm1', p_pack_id: 'p-alone', p_title: 'Musique 1', p_video_filename: 'alone-gameplay-muette.mp4', p_events: [{ t: 1, name: 'x' }] });
  check('montage gardé en mémoire (liste + lecture)', (await c.rpc('list_my_video_captures', { p_pack_id: 'p-alone' })).data.length === 1 && (await c.rpc('get_video_capture', { p_id: 'm1' })).data.title === 'Musique 1');
  await c.rpc('save_video_capture_version', { p_id: 'v2', p_capture_id: 'm1', p_title: 'Musique 2', p_substitutions: { a: 'b' } });
  check('version vidéo gardée en mémoire', (await c.rpc('list_video_capture_versions', { p_capture_id: 'm1' })).data.map(v => v.title).join() === 'Musique 2');

  const sb2 = { window: { location: { pathname: '/pack.html', search: '?id=p-alone' } }, setTimeout, console, URLSearchParams };
  vm.createContext(sb2); vm.runInContext(read('api/demo-client.js'), sb2);
  check('hors leçon : pas de pack ni de montage d’exemple', (await sb2.window.LayerPitchDemoClient.from('packs').select('*')).data.length === 0);

  const pub = read('public-page.js');
  check('pages publiques : sans ?tuto, rien ne change ; avec ?tuto, faux serveur + porte unique', /const tuto = new URLSearchParams\(location\.search\)\.has\('tuto'\)/.test(pub) && /\(tuto \? \['\.\/layerpitch-tuto\.js', '\.\/api\/demo-client\.js', '\.\/api\/auth\.js'\] : \[\]\)/.test(pub) && /tuto \? window\.LayerPitchTuto\.enter\(/.test(pub));
  check('page pack : le chargeur d’achat ne remet pas le vrai client en mode tutoriel', /window\.LayerPitchTuto\.switchToDemo\(\)/.test(read('src/pack/10-donnees-et-achat.js')));
  const page = read('pack.html');
  check('page pack : moteur de bulles, leçon et bandeau', /layerpitch-guide\.js/.test(page) && /pack-lecons\.js/.test(page) && /startPackLessonIfAsked/.test(page));

  const sbl = { window: {} }; vm.createContext(sbl); vm.runInContext(read('pack-lecons.js'), sbl);
  const doc = { querySelector: () => null };
  sbl.window.LayerPitchGuide = { create: () => ({ open() {} }) };
  sbl.document = doc; sbl.localStorage = { getItem: () => null };
  vm.runInContext('window.__L = window.LayerPitchPackLessons.init({ lang: "fr" })', sbl);
  const keys = new Set(sbl.window.__L.steps.flatMap(s => [s.titleKey, s.textKey]));
  const i18n = { window: {} }; vm.createContext(i18n); vm.runInContext(read('layerpitch-i18n.js'), i18n);
  check('leçon Versioning : ' + keys.size + ' textes présents en FR et EN', [...keys].every(k => ['fr', 'en'].every(l => i18n.window.LAYERPITCH_I18N[l].shared[k])));
  check('parcours : vidéo muette → capture de la musique 1 → montage → version musique 2 → écoute en direct', sbl.window.__L.steps.length === 14);
  check('menu du Backstage : leçon « bientôt » jouée sur la page du pack', /id: 'versioning', theme: 'pitch', public: true, soon: true, page: 'pack'/.test(read('src/backstage/43-visite-guidee.js')));
  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
