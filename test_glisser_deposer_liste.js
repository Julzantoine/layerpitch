// Glisser-déposer de la liste des morceaux (6/10) : le geste complet rejoué dans le vrai Backstage (positions de lignes fictives,
// jsdom n'en calcule pas). Ce que montre la barre est ce qui se passe au lâcher ; un lâcher dans un interstice vise la ligne la plus
// proche ; Alt (Option) enfoncé = copie, ce qui exige que la prise annonce « copyMove » (sinon le navigateur refuse le dépôt).
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window, doc = w.document, ev = c => w.eval(c);
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const settle = () => new Promise(r => setTimeout(r, 30));
  const mk = (id, t) => ({ id, title: t, mode: 'vertical', base: 'https://m/' + id + '/', layers: [{ id: 'l' + id, label: 'L', file: 'x.ogg' }] });
  const data = { library: ['A', 'B', 'C', 'D', 'E'].map(x => mk('t' + x, 'Morceau ' + x)), libraryFolders: [], packs: [], collections: [], sfxLibrary: [], socials: [], adReels: [], customFonts: [] };
  w.fetchSiteData = async () => JSON.parse(JSON.stringify(data));
  ev("currentUserIsAdmin = true; myFlags = new Proxy({}, { get: () => true }); myEntitlements = new Proxy({}, { get: () => ({ allowed: true, level: 'saved', amount: null }) });");
  await ev('loadData(true)'); await settle();
  ev("manageLibrarySelectedId = 'tA'; renderLibrary();"); await settle();
  const ids = () => ev('library.map(t => t.id).join(",")');
  const rowOf = id => [...doc.querySelectorAll('.org-row')].find(r => r.dataset.dragId === id);
  const place = () => [...doc.querySelectorAll('.org-row')].forEach((r, i) => { r.getBoundingClientRect = () => ({ top: i * 60, bottom: i * 60 + 50, height: 50, left: 0, right: 300, width: 300 }); });
  const send = (type, target, y, opts) => { const e = new w.Event(type, { bubbles: true, cancelable: true }); e.clientY = y; e.altKey = !!(opts && opts.alt); e.dataTransfer = { setData() {}, effectAllowed: '', dropEffect: '' }; target.dispatchEvent(e); return e; };
  const drag = (fromId, toId, y, opts) => {
    place();
    const from = rowOf(fromId), to = rowOf(toId);
    from.querySelector('.block-drag-handle').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    const start = send('dragstart', from, 0, opts);
    send('dragover', to, y, opts);
    const marked = to.classList.contains('drag-over-top') ? 'top' : (to.classList.contains('drag-over-bottom') ? 'bottom' : null);
    const drop = send('drop', to, y, opts);
    send('dragend', from, y, opts);
    return { marked, start, drop };
  };
  const top = r => rowOf(r) && true;
  const rowsTop = id => [...doc.querySelectorAll('.org-row')].findIndex(r => r.dataset.dragId === id) * 60;

  // 1. déplacement vers le haut, moitié haute de la cible
  let r = drag('tE', 'tB', rowsTop('tB') + 5);
  check('barre en haut de B, lâcher : E passe juste avant B', r.marked === 'top' && ids() === 'tA,tE,tB,tC,tD');
  ev("renderLibrary()"); await settle();
  // 2. moitié basse
  r = drag('tA', 'tC', rowsTop('tC') + 40);
  check('barre sous C, lâcher : A passe juste après C', r.marked === 'bottom' && ids() === 'tE,tB,tC,tA,tD');
  ev("renderLibrary()"); await settle();
  // 3. lâcher dans un interstice (entre deux lignes) : la ligne la plus proche
  place();
  const from = rowOf('tD'), gapTo = rowOf('tE');
  from.querySelector('.block-drag-handle').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  send('dragstart', from, 0);
  const over = send('dragover', gapTo, rowsTop('tE') - 3); // 3 px au-dessus de la ligne E : interstice
  send('drop', gapTo, rowsTop('tE') - 3); send('dragend', from, 0);
  check('lâcher dans l\'interstice au-dessus de E : D passe avant E (la barre le montrait)', over.defaultPrevented && ids() === 'tD,tE,tB,tC,tA');
  ev("renderLibrary()"); await settle();
  // 4. Alt : la prise annonce copyMove, le dépôt copie

  w.LayerPitchTracks = Object.assign({}, w.LayerPitchTracks, { copyTrackFiles: async (f, t) => ({ ok: true, files: 1 }) });
  ev('loadPostgresReadScripts = async () => {}');
  ev("library.forEach(t => t.layers.forEach(l => { l.remoteFile = null; }))"); // aucun fichier publié : pas d'appel serveur
  const n0 = ev('library.length');
  r = drag('tC', 'tB', rowsTop('tB') + 5, { alt: true });
  check('Alt : la prise annonce « copyMove » (sinon le navigateur refuse la copie)', r.start.dataTransfer.effectAllowed === 'copyMove');
  await settle(); await settle();
  check('Alt + glisser : une copie de plus, l\'original est resté en place', ev('library.length') === n0 + 1 && ev('library.some(t => t.id === "tC")'));
  const order = ev('library.map(t => t.title).join("|")');
  check('Alt + glisser : la copie est juste avant la cible (moitié haute de B)', /Morceau C \(copie\)\|Morceau B/.test(order));
  r = drag('tC', 'tE', rowsTop('tE') + 5);
  check('sans Alt : la prise n\'annonce toujours que le déplacement ou la copie, et ça déplace', ev('library.length') === n0 + 1);

  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
