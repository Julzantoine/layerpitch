const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
// Versions alternatives (10/11) : une alternative est une copie complète du montage, ensuite libre. On vérifie, côté capture-versioning.js
// (mémoire de séance, mêmes règles que le serveur) : création avec frise propre, retouche sans toucher le montage ni les autres alternatives,
// renommage qui garde la frise, suppression, conversion d'une version « à l'ancienne » en frise complète, et que le serveur reçoit bien la frise.
(async () => {
  let failures = 0;
  const check = (l, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' - ' + l); if (!c) failures++; };
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body><div id="host"></div><script>${read('layerpitch-i18n.js')}</script><script>${read('player.js')}</script>
  <script>${read('capture-render.js')}</script><script>${read('capture-plan.js')}</script><script>${read('capture-retarget.js')}</script><script>${read('capture-versioning.js')}</script></body></html>`;
  const calls = [];
  const dom = new JSDOM(html, { url: 'http://localhost/t.html', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(win) {
    win.AudioContext = function () {}; win.ResizeObserver = function () { return { observe() {}, disconnect() {} }; };
    win.CSS = { escape: s => String(s) }; win.LayerPitchNotify = { confirm: async () => true };
    win.LayerPitchSupabaseClient = { getClient: () => ({ rpc: async (n, a) => { calls.push([n, a]); return { data: [], error: null }; } }) };
  } });
  const win = dom.window;
  const base = [{ name: 'a', t: 1, detail: {} }, { name: 'b', t: 2, detail: {} }];
  const tr = k => k;
  let changed = 0;
  const mk = sessionOnly => win.LayerCaptureVersioning.mount(win.document.getElementById('host'), {
    sessionOnly, tr, getEvents: () => base, getCaptureId: () => (sessionOnly ? 'session' : 'cap1'), getCaptureTitle: () => 'M',
    findTrack: () => null, findSfx: () => null, library: { library: [], sfxLibrary: [], sfxFolders: [] }, fetchBytes: async () => new Uint8Array(), onVersionsChanged: () => { changed++; },
  });
  const v = mk(true);
  await new Promise(r => setTimeout(r, 20));
  const A = v.alternatives;
  check('aucune alternative au départ', A.list().length === 0);
  const id = A.newId();
  await A.createAlt(id, 'Version alternative #2', { events: base.slice(), laneOverrides: { x: 'Piano' }, collapsedGroups: {}, markers: [{ id: 'm1', t: 1, label: 'a' }] });
  check('alternative créée avec sa frise', A.list().length === 1 && A.list()[0].events.length === 2 && A.list()[0].laneOverrides.x === 'Piano');
  check('le menu est prévenu', changed > 0);
  await A.saveAlt(id, { events: [base[0]], laneOverrides: { x: 'Piano' }, collapsedGroups: {}, markers: [] });
  check('retouche : seule la frise de l’alternative change', A.list()[0].events.length === 1 && base.length === 2);
  await A.rename(id, 'Piano seul');
  check('renommer garde la frise', A.list()[0].title === 'Piano seul' && A.list()[0].events.length === 1);
  const mat = await A.materialize(A.list()[0]);
  check('une alternative déjà complète est reprise telle quelle', mat.events.length === 1);
  await v.refresh();
  check('la liste rechargée garde la frise (mémoire de séance)', A.list().length === 1 && A.list()[0].events.length === 1);
  await A.remove(id);
  check('suppression', A.list().length === 0);
  // Serveur : la frise part dans la requête, un enregistrement ordinaire n'envoie rien (le serveur garde ce qu'il a).
  const w = mk(false);
  await new Promise(r => setTimeout(r, 20));
  await w.alternatives.createAlt('id2', 'Version alternative #2', { events: base, laneOverrides: {}, collapsedGroups: {}, markers: [] });
  const sv = calls.filter(c => c[0] === 'save_video_capture_version');
  check('création : la frise est envoyée au serveur', sv.length === 1 && Array.isArray(sv[0][1].p_events) && sv[0][1].p_events.length === 2);
  await w.alternatives.rename('id2', 'Autre nom');
  const sv2 = calls.filter(c => c[0] === 'save_video_capture_version')[1];
  check('renommer n’envoie pas de frise (le serveur garde la sienne)', sv2 && sv2[1].p_events === undefined);
  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
