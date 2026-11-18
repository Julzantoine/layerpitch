// Sections d'un Projet — interface de projet.html (7/10) : colonne Sections, filtre, rangement, auto-rangement, feu vert fermé.
// La page tourne dans jsdom avec une fausse couche d'accès (LayerPitchProjects) qui garde l'état en mémoire.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const html = fs.readFileSync(path.join(__dirname, 'projet.html'), 'utf8');
  const inline = html.match(/<script>\n(const shellTr[\s\S]*?)<\/script>/)[1];

  async function boot(locked, channel, seed, opts) {
    opts = opts || {};
    const dom = new JSDOM('<div id="content"></div><div id="presence"></div>', { url: 'https://beta.layerpitch.com/projet.html?id=p1&lang=fr' + (channel ? '&channel=' + channel : ''), runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    w.eval(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(__dirname, 'layerpitch-appearance.js'), 'utf8'));
    const db = { sections: [], links: [], pins: [], mood: [], msgs: [], chatState: [], assets: [
      { id: 'a1', kind: 'image', origin: 'own', title: 'Forêt', fileId: 'f1', fileName: 'foret.png', fileSize: 1000, notes: 0, pinned: false },
      { id: 'a2', kind: 'image', origin: 'own', title: 'Château', fileId: 'f2', fileName: 'chateau.png', fileSize: 2000, notes: 0, pinned: false },
      { id: 'v1', kind: 'video', origin: 'own', title: 'Trailer', url: 'https://youtu.be/abcdefghij', notes: 0, pinned: false }], n: 0 };
    if (channel) { db.sections.push({ id: 's1', parentId: null, title: 'Niveau 1', position: 0 }); db.chatState.push({ sectionId: 's1', followed: true, unread: 2 }); }
    if (seed) seed(db);
    const calls = [];
    const ok = data => Promise.resolve({ data, error: null });
    const P = {
      PRIVATE: '__me',
      get: () => ok({ id: 'p1', title: 'Hollow Manor', description: '', role: opts.role || 'admin', archived: false, members: [] }),
      content: () => ok({ assets: db.assets.map(a => Object.assign({}, a)), moodboard: db.mood.slice(), packs: [], albums: [] }),
      appearance: () => opts.appearance === 'locked' ? Promise.resolve({ data: null, error: "L'apparence des Projets n'est pas encore ouverte" }) : ok(opts.appearance || {}),
      setAppearance: (id, p) => { calls.push(['setApp', p]); return ok(null); },
      preview: () => ok({}), snapshots: () => ok([]), activity: () => ok([]), vitrines: () => ok([]),
      demoStatus: () => ok({ eligible: false }), markRead: () => ok(null), markSeen: () => ok(null), messages: () => ok([]), annotations: () => ok([]),
      fileUrl: () => ok('https://example.test/x.png'),
      sections: () => locked ? Promise.resolve({ data: null, error: 'Les sections ne sont pas encore ouvertes' }) : ok({ sections: db.sections.map(s => Object.assign({}, s)), links: db.links.map(l => Object.assign({}, l)) }),
      createSection: (pid, title, parent) => { const id = 's' + (++db.n); db.sections.push({ id, parentId: parent || null, title, position: db.sections.length }); calls.push(['create', title, parent]); return ok({ id }); },
      renameSection: (id, title) => { db.sections.find(s => s.id === id).title = title; return ok(null); },
      deleteSection: id => { const s = db.sections.find(x => x.id === id); db.sections.forEach(x => { if (x.parentId === id) x.parentId = s.parentId; }); db.sections = db.sections.filter(x => x.id !== id); db.links = db.links.filter(l => l.sectionId !== id); return ok(null); },
      moveSection: (id, parent, pos) => { db.sections.find(s => s.id === id).parentId = parent || null; calls.push(['move', id, parent, pos]); return ok(null); },
      setAssetSections: (assetId, ids) => { db.links = db.links.filter(l => l.assetId !== assetId).concat(ids.map(sectionId => ({ sectionId, assetId }))); calls.push(['set', assetId, ids]); return ok(null); },
      updateAsset: (id, patch) => { calls.push(['update', id, patch]); const x = db.assets.find(y => y.id === id); Object.assign(x, patch); return ok(null); },
      sectionPins: () => ok(db.pins.map(k => Object.assign({}, k))),
      pinInSection: (sid, assetId, on) => { calls.push(['pinIn', sid, assetId, on]); db.pins = db.pins.filter(k => !(k.sectionId === sid && k.assetId === assetId)); if (on) { db.pins.push({ sectionId: sid, assetId, position: db.pins.length, starred: false }); if (!db.links.some(l => l.sectionId === sid && l.assetId === assetId)) db.links.push({ sectionId: sid, assetId }); } return ok(null); },
      starSectionPin: (sid, assetId, on) => { calls.push(['starPin', sid, assetId, on]); db.pins.find(k => k.sectionId === sid && k.assetId === assetId).starred = on; return ok(null); },
      reorderSectionPins: () => ok(null),
      pin: (assetId, on) => { calls.push(['pinGeneral', assetId, on]); const a = db.assets.find(x => x.id === assetId); a.pinned = on; db.mood = db.mood.filter(i => i !== assetId).concat(on ? [assetId] : []); return ok(null); },
      sectionChatState: () => ok(db.chatState.map(x => Object.assign({}, x))),
      sectionMessages: sid => ok(db.msgs.filter(m => m.sectionId === sid).map(m => ({ id: m.id, body: m.body, createdAt: m.createdAt, authorEmail: m.mine ? 'me@x.test' : 'autre@x.test', mine: m.mine, attachments: m.attachments || [] })).reverse()),
      upload: (pid, file) => { calls.push(['upload', file.name]); return ok({ fileId: 'F' + file.name }); },
      postSectionMessage: (sid, body, atts) => { calls.push(['post', sid, body, atts]); const attachments = (atts || []).map(a => { const id = 'att' + (++db.n); db.assets.push({ id, kind: 'image', origin: 'own', title: a.title, fileId: a.fileId, notes: 0, pinned: false }); db.links.push({ sectionId: sid, assetId: id }); return { assetId: id, kind: 'image', title: a.title, fileId: a.fileId }; }); db.msgs.push({ id: 'm' + (++db.n), sectionId: sid, body, attachments, createdAt: new Date(Date.now() + db.n).toISOString(), mine: true }); if (!db.chatState.some(x => x.sectionId === sid)) db.chatState.push({ sectionId: sid, followed: true, unread: 0 }); return ok('m'); },
      setSectionFollow: (sid, on) => { calls.push(['follow', sid, on]); db.chatState = db.chatState.filter(x => x.sectionId !== sid).concat(on ? [{ sectionId: sid, followed: true, unread: 0 }] : []); return ok(null); },
      markSectionRead: sid => { calls.push(['read', sid]); const x = db.chatState.find(y => y.sectionId === sid); if (x) x.unread = 0; return ok(null); },
      deleteSectionMessage: id => { db.msgs = db.msgs.filter(m => m.id !== id); return ok(null); },
      listMaps: () => ok([{ id: 'mp1', title: 'Niveau 1', data: { nodes: [], edges: [] } }]),
      setSectionMap: (sid, mid) => { calls.push(['map', sid, mid]); db.sections.find(s => s.id === sid).mapId = mid; return ok(null); },
      removeAssetsFromSection: (sid, ids) => { calls.push(['removeFrom', sid, ids]); db.links = db.links.filter(l => !(l.sectionId === sid && ids.includes(l.assetId))); return ok(null); },
      addAssetsToSection: (sid, ids) => { ids.forEach(assetId => { if (!db.links.some(l => l.sectionId === sid && l.assetId === assetId)) db.links.push({ sectionId: sid, assetId }); }); calls.push(['addTo', sid, ids]); return ok(null); },
      addAsset: (pid, p, pin) => { calls.push(['add', p.kind, p.title || p.url, pin]); const id = 'n' + (++db.n); db.assets.push({ id, kind: p.kind, origin: 'own', title: p.title || '', url: p.url || null, fileId: p.fileId || null, notes: 0, pinned: false }); return ok({ id }); },
    };
    w.LayerPitchProjects = P;
    w.LayerPitchAuth = { getSession: () => Promise.resolve({ session: { user: { id: 'u1', email: 'me@x.test' } } }), getMyComposerId: () => Promise.resolve({ composerId: null }), onAuthStateChange: cb => setTimeout(() => cb('INITIAL_SESSION'), 0) };
    const confirms = [];
    w.LayerPitchNotify = { confirm: m => { confirms.push(m); return Promise.resolve(true); }, error: () => {}, info: () => {} };
    w.LayerPitchSupabaseClient = { getClient: () => ({ channel: () => ({ on() { return this; }, subscribe() {}, track() {}, presenceState: () => ({}), send() {} }) }) };
    w.LayerPitchTracks = { listTracksByIds: () => Promise.resolve({ tracks: [] }), listTracks: () => Promise.resolve({ tracks: [] }) };
    w.LayerPitchAlbums = { listAlbums: () => Promise.resolve({ albums: [] }) };
    w.LayerPitchShell = { mount() {}, update() {}, tr: k => k };
    w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
    w.HTMLElement.prototype.scrollIntoView = function () {};
    // Sections et tchat sont repliés d'office (retour Joris 18/11) : les essais existants les ouvrent, sauf demande contraire.
    if (!opts.freshStorage) { w.localStorage.setItem('layerpitch_project_sections_open', '1'); w.localStorage.setItem('layerpitch_project_chat_open', '1'); }
    w.eval(inline);
    await wait(150);
    return { w, d: w.document, db, calls, confirms };
  }
  const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const tab = async (ctx, name) => { click(ctx.w, ctx.d.querySelector(`[data-tab="${name}"]`)); await wait(150); };
  const cards = d => [...d.querySelectorAll('.item .item-title')].map(e => e.textContent.trim());
  // Colonne de filtres (19/11) : « pick(id) » = ne cocher que cette étiquette ('all' : tout effacer, 'none' : « sans étiquette »).
  const pickIn = async (ctx, id) => {
    const nv = ctx.d.getElementById('secNav');
    const clr = nv.querySelector('[data-fclear]'); if (clr) { click(ctx.w, clr); await wait(60); }
    if (id !== 'all') { const cb = ctx.d.getElementById('secNav').querySelector(`[data-ftag="${id}"]`); cb.checked = true; cb.dispatchEvent(new ctx.w.Event('change', { bubbles: true })); }
    await wait(100);
  };

  // ---- Feu vert fermé : rien n'apparaît
  let c = await boot(true);
  await tab(c, 'images');
  check('feu vert fermé : pas de colonne Sections', !c.d.getElementById('secNav'));
  check('feu vert fermé : les images s\'affichent toujours', cards(c.d).length === 2);
  check('feu vert fermé : pas de bouton de rangement', !c.d.querySelector('[data-secassign]'));

  // ---- Feu vert ouvert
  c = await boot(false);
  await tab(c, 'images');
  const nav = () => c.d.getElementById('secNav');
  c.w.localStorage.setItem('layerpitch_project_sections_open', '1');
  check('colonne de filtres affichée (étiquettes + « sans étiquette »)', !!nav() && /Étiquettes/.test(nav().textContent) && /Sans étiquette/.test(nav().textContent));
  check('« sans étiquette » compte les images de l\'onglet au départ', /Sans étiquette\s*2/.test(nav().textContent));
  check('message « aucune section »', /Aucune étiquette/.test(nav().textContent));

  // créer une section à la racine
  click(c.w, nav().querySelector('[data-secact="add"]'));
  let input = c.d.getElementById('secInput');
  check('champ de saisie inline', !!input);
  input.value = 'Niveau 1'; input.dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(150);
  check('étiquette créée (et listée à plat)', c.db.sections.length === 1 && /Niveau 1/.test(nav().textContent) && !!nav().querySelector('[data-ftag="s1"]'));
  await pickIn(c, 's1');
  check('filtre : étiquette vide = aucune image', cards(c.d).length === 0);

  // sous-section
  click(c.w, nav().querySelector('[data-secact="add"]'));
  input = c.d.getElementById('secInput'); input.value = 'Forêt'; input.dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(150);
  check('deuxième étiquette créée', c.db.sections.length === 2 && c.db.sections[1].title === 'Forêt');

  // ranger une image : Toute la réserve > bouton 🗂
  await pickIn(c, 'all');
  check('aucun filtre : 2 images', cards(c.d).length === 2);
  click(c.w, c.d.querySelector('[data-secassign="a1"]')); await wait(50);
  const boxes = [...c.d.querySelectorAll('.sec-dialog input[type="checkbox"]')];
  check('boîte « ranger » : une case par section', boxes.length === 2);
  boxes.find(b => b.value === 's2').checked = true;
  click(c.w, c.d.querySelector('.sec-dialog [data-x="save"]')); await wait(150);
  check('image rangée dans la sous-section', c.db.links.length === 1 && c.db.links[0].sectionId === 's2' && c.db.links[0].assetId === 'a1');
  check('boîte fermée', !c.d.querySelector('.sec-overlay'));
  check('« sans étiquette » descend à 1', /Sans étiquette\s*1/.test(nav().textContent));

  // filtre : une étiquette ; plusieurs étiquettes élargissent (ou, réglable, « toutes »)
  await pickIn(c, 's2');
  check('filtre sur une étiquette : ses objets seulement', cards(c.d).length === 1 && cards(c.d)[0] === 'Forêt');
  await pickIn(c, 'none');
  check('filtre « sans étiquette »', cards(c.d).length === 1 && cards(c.d)[0] === 'Château');

  // glisser-déposer d'un objet sur une section
  const drag = (el, type, data) => { const ev = new c.w.Event(type, { bubbles: true, cancelable: true }); ev.dataTransfer = { types: ['text/x-lp-asset'], data: { 'text/x-lp-asset': data }, setData(k, v) { this.data[k] = v; }, getData(k) { return this.data[k]; } }; el.dispatchEvent(ev); return ev; };
  const card = [...c.d.querySelectorAll('[data-dragasset]')].find(e => e.dataset.dragasset === 'a2');
  check('les cartes d\'images sont glissables', !!card && card.draggable);
  const over = drag(nav().querySelector('[data-dropsec="s1"]'), 'dragover', 'a2');
  check('survol d\'une section : dépôt accepté', over.defaultPrevented);
  drag(nav().querySelector('[data-dropsec="s1"]'), 'drop', 'a2'); await wait(150);
  check('déposer une image sur une section l\'y range', c.db.links.some(l => l.sectionId === 's1' && l.assetId === 'a2'));
  c.db.links = c.db.links.filter(l => l.assetId !== 'a2'); // on remet comme avant

  // un objet dans deux sections
  await pickIn(c, 'all');
  click(c.w, c.d.querySelector('[data-secassign="a1"]')); await wait(50);
  [...c.d.querySelectorAll('.sec-dialog input[type="checkbox"]')].forEach(b => { b.checked = true; });
  click(c.w, c.d.querySelector('.sec-dialog [data-x="save"]')); await wait(150);
  check('un objet dans plusieurs sections', c.db.links.filter(l => l.assetId === 'a1').length === 2);

  // auto-rangement : on choisit une section puis on ajoute une vidéo (lien)
  await tab(c, 'videos');
  await pickIn(c, 's2');
  check('onglet Vidéos : même colonne Sections', !!nav() && /Aucun|Trailer|vidéo/i.test(c.d.getElementById('panel').textContent));
  c.d.getElementById('vUrl').value = 'https://youtu.be/zzzzzzzzzz';
  click(c.w, c.d.getElementById('vLinkBtn')); await wait(200);
  check('objet ajouté pendant qu\'une section est choisie : rangé dedans', c.calls.some(x => x[0] === 'addTo' && x[1] === 's2' && x[2][0] === 'n3' || x[0] === 'addTo' && x[1] === 's2' && /^n/.test(x[2][0])));

  // renommer, déplacer, supprimer
  await pickIn(c, 's2');
  click(c.w, nav().querySelector('[data-secact="rename"][data-id="s2"]'));
  input = c.d.getElementById('secInput'); input.value = 'Forêt sombre'; input.dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(150);
  check('renommer', c.db.sections[1].title === 'Forêt sombre' && /Forêt sombre/.test(nav().textContent));
  await pickIn(c, 's2');
  click(c.w, nav().querySelector('[data-secact="del"][data-id="s2"]')); await wait(200);
  check('supprimer demande confirmation et rend les objets au « sans section »', c.confirms.length === 1 && c.db.sections.length === 1 && !c.db.assets.every(a => !a) && c.db.assets.length >= 3);
  check('après suppression, l\'étiquette n\'est plus cochée', !nav().querySelector('[data-ftag="s2"]') && !nav().querySelector('[data-fclear]'));

  // ---- Moodboard unique, filtré par la colonne de gauche (19/11)
  await tab(c, 'board');
  check('onglet Moodboard : colonne avec Type et Étiquettes', !!nav() && /Type/.test(nav().textContent) && /Étiquettes/.test(nav().textContent) && !nav().querySelector('[data-pick]'));
  check('Moodboard : un seul, avec ses versions', !!c.d.getElementById('snapBtn') && !c.d.getElementById('alsoGeneral'));
  const kind = c.d.getElementById('addKind'); kind.value = 'fromProject'; kind.dispatchEvent(new c.w.Event('change', { bubbles: true }));
  c.d.getElementById('fAsset').value = 'a2'; click(c.w, c.d.getElementById('addBtn')); await wait(200);
  const k2 = c.d.getElementById('addKind'); k2.value = 'fromProject'; k2.dispatchEvent(new c.w.Event('change', { bubbles: true }));
  c.d.getElementById('fAsset').value = 'a1'; click(c.w, c.d.getElementById('addBtn')); await wait(250);
  check('épingler des objets du Projet : au Moodboard général', c.db.mood.includes('a2') && c.db.mood.includes('a1') && cards(c.d).length === 2);
  await pickIn(c, 's1');
  check('filtre par étiquette : seules les cartes de cette étiquette', cards(c.d).length === 1 && cards(c.d)[0] === 'Forêt');
  check('filtre actif : pas de réordonnancement (poignée absente)', !c.d.querySelector('#grid .drag-handle'));
  const cb = k => c.d.getElementById('secNav').querySelector(k);
  const box = cb('[data-ftag="none"]'); box.checked = true; box.dispatchEvent(new c.w.Event('change', { bubbles: true })); await wait(100);
  check('deux étiquettes cochées : elles élargissent (l\'une ou l\'autre)', cards(c.d).length === 2 && !!cb('[name="fmode"]'));
  const imgBox = cb('[data-fkind="images"]'); imgBox.checked = true; imgBox.dispatchEvent(new c.w.Event('change', { bubbles: true })); await wait(100);
  check('type « Images » + étiquettes : les deux familles de filtres se cumulent', cards(c.d).length === 2 && /Filtres appliqués \(3\)/.test(nav().textContent));
  const vidBox = cb('[data-fkind="videos"]'); vidBox.checked = true; vidBox.dispatchEvent(new c.w.Event('change', { bubbles: true })); await wait(100);
  check('Images + Vidéos cochés : le type élargit aussi', cards(c.d).length === 2);
  click(c.w, cb('[data-fclear]')); await wait(100);
  check('« Effacer tout » : tout revient', cards(c.d).length === 2 && !cb('[data-fclear]'));
  await pickIn(c, 's1');
  // dépôt en vrac sur le Moodboard d'une section
  const dropOn = (host, types, files, uris) => { const ev = new c.w.Event('drop', { bubbles: true, cancelable: true }); ev.dataTransfer = { types, files, getData: k => (k === 'text/uri-list' ? uris || '' : '') }; host.dispatchEvent(ev); return ev; };
  const mf = (name, type) => new c.w.File(['x'], name, { type });
  const nAdd = c.calls.filter(x => x[0] === 'add').length;
  const hostB = c.d.getElementById('secMain');
  const ov = new c.w.Event('dragover', { bubbles: true, cancelable: true }); ov.dataTransfer = { types: ['Files'] }; hostB.dispatchEvent(ov);
  check('survol de fichiers : zone de dépôt acceptée', ov.defaultPrevented && hostB.classList.contains('drop-files'));
  dropOn(hostB, ['Files'], [mf('ambiance.png', 'image/png'), mf('theme.mp3', 'audio/mpeg'), mf('trailer.mp4', 'video/mp4'), mf('brief.pdf', 'application/pdf'), mf('virus.exe', 'application/x-msdownload')]); await wait(500);
  const added = c.calls.filter(x => x[0] === 'add').slice(nAdd);
  check('fichiers en vrac : chacun rangé selon son type (image, audio, vidéo, document)', ['image', 'audio', 'video', 'file'].every(k => added.some(x => x[1] === k)) && added.length === 4);
  check('un type refusé n\'est pas ajouté', !added.some(x => /virus/.test(x[2])));
  check('étiquette cochée : les fichiers déposés y sont rangés', c.calls.filter(x => x[0] === 'addTo' && x[1] === 's1').length >= 4);
  const nAdd2 = c.calls.filter(x => x[0] === 'add').length;
  dropOn(c.d.getElementById('secMain'), ['text/uri-list'], [], 'https://youtu.be/abcdefghijk\nhttps://exemple.test/page'); await wait(400);
  const lk = c.calls.filter(x => x[0] === 'add').slice(nAdd2);
  check('liens en vrac : vidéo YouTube et lien simple', lk.length === 2 && lk[0][1] === 'video' && lk[1][1] === 'link');
  await pickIn(c, 'all');
  check('retour au Moodboard général : la carte y est', cards(c.d).includes('Château'));

  // ---- Tchat par section
  await tab(c, 'images');
  const chat = () => c.d.getElementById('chat');
  check('sélecteur de canal dans la colonne de discussion', !!c.d.getElementById('chanSel') && /Discussion générale/.test(c.d.getElementById('chanSel').textContent));
  await pickIn(c, 's1');
  click(c.w, nav().querySelector('[data-secact="chat"]')); await wait(200);
  check('ouvrir le canal de la section', /# Niveau 1/.test(chat().textContent) && /Personne n'a encore écrit/.test(chat().textContent));
  c.d.getElementById('newMsg').value = 'Salut le niveau 1';
  click(c.w, c.d.getElementById('sendBtn')); await wait(250);
  check('écrire dans le canal', c.calls.some(x => x[0] === 'post' && x[2] === 'Salut le niveau 1') && /Salut le niveau 1/.test(chat().textContent));
  check('écrire = suivre : le bouton propose « Ne plus suivre »', /Ne plus suivre/.test(chat().textContent));
  click(c.w, c.d.getElementById('followBtn')); await wait(200);
  check('ne plus suivre', c.calls.some(x => x[0] === 'follow' && x[2] === false) && /Suivre/.test(c.d.getElementById('followBtn').textContent) && !/Ne plus/.test(c.d.getElementById('followBtn').textContent));
  click(c.w, c.d.getElementById('followBtn')); await wait(200);
  c.db.chatState[0].unread = 3; await c.w.eval('loadSections().then(() => { renderSecNav(); renderChat(); })'); await wait(150);
  check('pastille de non lus sur la section', !!nav().querySelector('.sec-unread') && nav().querySelector('.sec-unread').textContent === '3');
  check('non lus dans la liste des canaux', /Niveau 1 \(3\)/.test(c.d.getElementById('chanSel').textContent));
  const sel = c.d.getElementById('chanSel'); sel.value = ''; sel.dispatchEvent(new c.w.Event('change', { bubbles: true })); await wait(200);
  check('retour au tchat général', /Discussion générale/.test(c.d.getElementById('chanSel').options[0].textContent) && !/# Niveau 1/.test(chat().textContent.split('Niveau 1 (')[0].slice(0, 80)) && !!c.d.getElementById('q'));

  // pièce jointe dans le canal : rangée automatiquement dans la section
  const selB = c.d.getElementById('chanSel'); selB.value = 's1'; selB.dispatchEvent(new c.w.Event('change', { bubbles: true })); await wait(200);
  check('le canal propose 📎', !!c.d.getElementById('attachBtn') && !!c.d.getElementById('attachInput'));
  const fileInput = c.d.getElementById('attachInput');
  Object.defineProperty(fileInput, 'files', { value: [new c.w.File(['x'], 'plan.png', { type: 'image/png' })], configurable: true });
  fileInput.dispatchEvent(new c.w.Event('change', { bubbles: true })); await wait(100);
  check('fichier en attente d\'envoi', /plan\.png/.test(c.d.getElementById('pending').textContent));
  click(c.w, c.d.getElementById('sendBtn')); await wait(300);
  check('envoyé avec la pièce jointe (message sans texte)', c.calls.some(x => x[0] === 'post' && x[1] === 's1' && x[3] && x[3][0] && x[3][0].fileId === 'Fplan.png'));
  check('le message du canal montre sa pièce jointe, rangée dans la section', /Rangé dans « Niveau 1 »/.test(chat().textContent));
  check('la pièce jointe est bien dans la section (filtre Images)', c.db.links.some(l => l.sectionId === 's1' && /^att/.test(l.assetId)));
  await tab(c, 'images'); await pickIn(c, 's1');
  check('et visible dans l\'onglet Images de la section', cards(c.d).includes('plan.png'));
  // lien depuis la cloche : ?channel=
  const c2 = await boot(false, 's1');
  check('lien de la cloche : ouvre le canal de la section', /# Niveau 1/.test(c2.d.getElementById('chat').textContent));

  // ---- Lien section ↔ carte
  await tab(c, 'images');
  await pickIn(c, 's1');
  check('pas de lien de carte au départ', !nav().querySelector('[data-openmap]'));
  click(c.w, nav().querySelector('[data-secact="map"]')); await wait(200);
  const radios2 = [...c.d.querySelectorAll('.sec-dialog input[type="radio"]')];
  check('choix de carte : aucune + les cartes du Projet', radios2.length === 2 && radios2[1].value === 'mp1');
  radios2[1].checked = true; click(c.w, c.d.querySelector('.sec-dialog [data-x="save"]')); await wait(200);
  check('section reliée à la carte', c.calls.some(x => x[0] === 'map' && x[1] === 's1' && x[2] === 'mp1') && !!nav().querySelector('[data-openmap="mp1"]'));
  check('le bouton « Ouvrir la carte » est là', /Ouvrir la carte/.test(nav().textContent));

  // ---- Sélection multiple, réordonner les sections, télécharger
  const seed = db => {
    db.sections.push({ id: 'A', parentId: null, title: 'Alpha', position: 0 }, { id: 'B', parentId: null, title: 'Bravo', position: 1 }, { id: 'C', parentId: null, title: 'Charlie', position: 2 });
    db.links.push({ sectionId: 'A', assetId: 'a1' }, { sectionId: 'A', assetId: 'a2' });
  };
  const k = await boot(false, null, seed);
  const kn = () => k.d.getElementById('secNav');
  await tab(k, 'images');
  check('mode sélection : pas de cases au départ', !k.d.querySelector('.sel-box'));
  click(k.w, kn().querySelector('[data-secact="select"]')); await wait(150);
  check('mode sélection : une case par image et une barre d\'actions', k.d.querySelectorAll('.sel-box').length === 2 && !!k.d.getElementById('selBar'));
  click(k.w, k.d.querySelector('[data-sel="all"]')); await wait(100);
  check('Tout sélectionner', /2 sélectionné/.test(k.d.getElementById('selBar').textContent));
  click(k.w, k.d.querySelector('[data-sel="add"]')); await wait(50);
  const targets = [...k.d.querySelectorAll('.sec-dialog input[type="radio"]')];
  targets.find(r => r.value === 'B').checked = true;
  click(k.w, k.d.querySelector('.sec-dialog [data-x="save"]')); await wait(200);
  check('ajouter la sélection à une section (en masse)', k.calls.some(x => x[0] === 'addTo' && x[1] === 'B' && x[2].length === 2) && k.db.links.filter(l => l.sectionId === 'B').length === 2);
  check('la sélection est vidée, le mode reste', /0 sélectionné/.test(k.d.getElementById('selBar').textContent));
  await pickIn(k, 'A');
  click(k.w, k.d.querySelector('[data-sel="all"]')); await wait(100);
  click(k.w, k.d.querySelector('[data-sel="move"]')); await wait(50);
  const mv = [...k.d.querySelectorAll('.sec-dialog input[type="radio"]')];
  check('déplacer : la section courante n\'est pas proposée', mv.length === 2 && mv.every(r => r.value !== 'A'));
  mv.find(r => r.value === 'C').checked = true;
  click(k.w, k.d.querySelector('.sec-dialog [data-x="save"]')); await wait(250);
  check('déplacer la sélection vers une autre section (ajoute puis retire)', k.db.links.filter(l => l.sectionId === 'C').length === 2 && k.db.links.filter(l => l.sectionId === 'A').length === 0);
  click(k.w, k.d.querySelector('[data-sel="close"]')); await wait(100);
  check('terminer : les cases disparaissent', !k.d.querySelector('.sel-box') && !k.d.getElementById('selBar'));

  // télécharger
  const zipped = [];
  k.w.JSZip = class { file(p) { zipped.push(p); } generateAsync() { return Promise.resolve(new k.w.Blob(['x'])); } };
  k.w.fetch = () => Promise.resolve({ ok: true, blob: () => Promise.resolve(new k.w.Blob(['x'])) });
  k.w.URL.createObjectURL = () => 'blob:x'; k.w.URL.revokeObjectURL = () => {};
  k.w.HTMLAnchorElement.prototype.click = function () { zipped.push('DL:' + this.download); };
  k.db.links = [{ sectionId: 'A', assetId: 'a1' }, { sectionId: 'B', assetId: 'a1' }, { sectionId: 'B', assetId: 'v1' }];
  await pickIn(k, 'B');
  await k.w.eval('loadSections()'); k.w.eval('renderSecNav()');
  click(k.w, kn().querySelector('[data-secact="download"]')); await wait(400);
  check('télécharger une section : zip nommé comme la section', zipped.includes('DL:Bravo.zip'));
  check('dossier de la section, nom du fichier', zipped.includes('Bravo/foret.png'));
  check('une vidéo en lien (sans fichier) n\'est pas dans le zip', !zipped.some(p => /Trailer/.test(p)));
  zipped.length = 0;
  await pickIn(k, 'all');
  click(k.w, kn().querySelector('[data-secact="download"]')); await wait(400);
  check('télécharger tout : un dossier par section, « Sans étiquette » pour le reste', zipped.includes('Alpha/foret.png') && zipped.includes('Bravo/foret.png') && zipped.includes('Sans étiquette/chateau.png') && zipped.includes('DL:Hollow Manor.zip'));

  // télécharger les fichiers d'une carte
  zipped.length = 0;
  await k.w.eval("downloadMapFiles({ title: 'Niveau 1', data: { roomTone: { kind: 'asset', id: 'a1' }, nodes: [{ label: 'Château', sounds: { main: [{ kind: 'asset', id: 'a2' }, { kind: 'track', id: 't' }] } }], edges: [] } })"); await wait(300);
  check('fichiers d\'une carte : un dossier par élément, fond d\'ambiance à part', zipped.includes("Niveau 1/Fond d'ambiance/foret.png") && zipped.includes('Niveau 1/Château/chateau.png') && zipped.includes('DL:Niveau 1.zip'));
  check('fichiers d\'une carte : les morceaux du Backstage ne sont pas inclus', zipped.filter(p => !p.startsWith('DL:')).length === 2);

  // relier la carte à des sections, depuis l'onglet Carte
  k.db.sections.forEach(x => { x.mapId = null; }); k.db.sections.find(x => x.id === 'C').mapId = 'autre';
  await k.w.eval('loadSections()'); k.calls.length = 0;
  k.w.eval("openMapSectionsDialog({ id: 'mp1', title: 'Niveau 1' })"); await wait(50);
  const lb = [...k.d.querySelectorAll('.sec-dialog input[type="checkbox"]')];
  check('depuis la carte : une case par section, rien de coché au départ', lb.length === 3 && lb.every(x => !x.checked));
  check('une section déjà reliée à une autre carte est signalée', /déjà reliée à une autre carte/.test(k.d.querySelector('.sec-dialog').textContent));
  lb.find(x => x.value === 'A').checked = true; lb.find(x => x.value === 'C').checked = true;
  click(k.w, k.d.querySelector('.sec-dialog [data-x="save"]')); await wait(250);
  check('relier la carte à deux sections', k.calls.filter(x => x[0] === 'map' && x[2] === 'mp1').map(x => x[1]).sort().join() === 'A,C');
  k.w.eval("openMapSectionsDialog({ id: 'mp1', title: 'Niveau 1' })"); await wait(50);
  [...k.d.querySelectorAll('.sec-dialog input[type="checkbox"]')].find(x => x.value === 'A').checked = false;
  click(k.w, k.d.querySelector('.sec-dialog [data-x="save"]')); await wait(250);
  check('décocher retire le lien de cette section seulement', k.calls.some(x => x[0] === 'map' && x[1] === 'A' && x[2] === null) && !k.calls.some(x => x[0] === 'map' && x[1] === 'C' && x[2] === null));
  k.calls.length = 0; k.w.eval("openMapSectionsDialog({ isNew: true, title: 'x' })"); await wait(50);
  check('carte pas encore enregistrée : pas de boîte, on demande d\'enregistrer', !k.d.querySelector('.sec-dialog'));

  // ---- Apparence du Projet
  const ap0 = await boot(true, null, null, { appearance: 'locked' });
  check('apparence fermée : pas de bouton', !ap0.d.getElementById('appearanceBtn'));
  const ap1 = await boot(false, null, null, { role: 'admin', appearance: {} });
  check('apparence ouverte : bouton « Apparence » dans la barre du Projet', !!ap1.d.getElementById('appearanceBtn'));
  click(ap1.w, ap1.d.getElementById('appearanceBtn')); await wait(50);
  check('administrateur : réglage d\'équipe proposé, aucun choix « équipe / moi » tant que rien n\'est réglé', !!ap1.d.getElementById('appBgOn') && !ap1.d.querySelector('[name="appWho"]'));
  const bgIn = ap1.d.getElementById('appBg'); bgIn.value = '#336699'; bgIn.dispatchEvent(new ap1.w.Event('input', { bubbles: true }));
  check('aperçu en direct de la couleur', ap1.d.documentElement.style.getPropertyValue('--backstage-bg') === '#336699' && ap1.d.getElementById('appBgOn').checked);
  click(ap1.w, ap1.d.querySelector('.sec-dialog [data-x="save"]')); await wait(150);
  check('enregistrement du réglage d\'équipe', ap1.calls.some(x => x[0] === 'setApp' && x[1].bg === '#336699'));
  const ap2 = await boot(false, null, null, { role: 'member', appearance: { bg: '#112233', image: null, opacity: 8, fixed: true } });
  check('membre : l\'apparence d\'équipe est appliquée d\'office', ap2.d.documentElement.style.getPropertyValue('--backstage-bg') === '#112233');
  click(ap2.w, ap2.d.getElementById('appearanceBtn')); await wait(50);
  check('membre : pas de réglage d\'équipe, mais le choix équipe / ma propre apparence', !ap2.d.getElementById('appBgOn') && ap2.d.querySelectorAll('[name="appWho"]').length === 2);
  ap2.d.querySelector('[name="appWho"][value="mine"]').checked = true; ap2.d.querySelector('[name="appWho"][value="mine"]').dispatchEvent(new ap2.w.Event('change', { bubbles: true }));
  click(ap2.w, ap2.d.querySelector('.sec-dialog [data-x="save"]')); await wait(150);
  check('« ma propre apparence » : l\'apparence d\'équipe n\'est plus appliquée, et le choix est mémorisé', ap2.d.documentElement.style.getPropertyValue('--backstage-bg') === '' && ap2.w.localStorage.getItem('layerpitch_project_appearance_mine_p1') === '1');
  check('un membre n\'écrit jamais l\'apparence d\'équipe', !ap2.calls.some(x => x[0] === 'setApp'));

  // ---- Modifier une note épinglée sur place (18/11)
  const ed = await boot(false, null, db => { db.assets.push({ id: 'n1', kind: 'note', origin: 'own', title: 'Ma note', body: 'Texte', notes: 0, pinned: true }); db.mood.push('n1'); });
  await tab(ed, 'board');
  const editBtn = ed.d.querySelector('#grid [data-act="edit"]');
  check('note épinglée : bouton Modifier présent', !!editBtn);
  click(ed.w, editBtn); await wait(50);
  const f = ed.d.querySelector('#grid .edit-form');
  check('modifier : formulaire prérempli (titre et commentaire)', !!f && f.querySelector('.e-title').value === 'Ma note' && f.querySelector('.e-body').value === 'Texte');
  f.querySelector('.e-title').value = 'Note corrigée'; f.querySelector('.e-body').value = 'Nouveau texte';
  click(ed.w, f.querySelector('[data-x="save"]')); await wait(200);
  check('modifier : enregistrement envoyé avec titre et commentaire', ed.calls.some(x => x[0] === 'update' && x[1] === 'n1' && x[2].title === 'Note corrigée' && x[2].body === 'Nouveau texte'));
  check('modifier : la carte affiche le nouveau texte', /Note corrigée/.test(ed.d.querySelector('#grid').textContent) && !ed.d.querySelector('#grid .edit-form'));

  // ---- Repliés d'office : un onglet vertical, un clic pour ouvrir, le choix est mémorisé
  const fr = await boot(false, null, null, { freshStorage: true });
  await tab(fr, 'images');
  check('sections repliées d\'office : onglet vertical, pas de liste', !!fr.d.getElementById('secOpenBtn') && !fr.d.querySelector('#secNav .sec-row'));
  check('tchat replié d\'office : onglet avec pastille possible', !!fr.d.getElementById('chatOpenBtn'));
  click(fr.w, fr.d.getElementById('secOpenBtn')); await wait(50);
  check('un clic ouvre les sections, et le choix est mémorisé', /Étiquettes/.test(fr.d.getElementById('secNav').textContent) && fr.w.localStorage.getItem('layerpitch_project_sections_open') === '1');
  click(fr.w, fr.d.querySelector('[data-secact="collapse"]')); await wait(50);
  check('le bouton « » » replie de nouveau', !!fr.d.getElementById('secOpenBtn') && fr.w.localStorage.getItem('layerpitch_project_sections_open') === '0');

  // Garde : `.item { display:flex }` l'emporte sur l'attribut hidden ; sans cette règle, les filtres du Moodboard n'ont aucun effet (18/11).
  check('filtres du Moodboard : une carte masquée disparaît vraiment', /\.mood-grid \.item\[hidden\]\s*\{\s*display:\s*none/.test(fs.readFileSync(path.join(__dirname, 'projet.html'), 'utf8')));

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon');
  process.exit(failures ? 1 : 0);
})();
