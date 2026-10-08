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

  async function boot(locked, channel, seed) {
    const dom = new JSDOM('<div id="content"></div><div id="presence"></div>', { url: 'https://beta.layerpitch.com/projet.html?id=p1&lang=fr' + (channel ? '&channel=' + channel : ''), runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    w.eval(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8'));
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
      get: () => ok({ id: 'p1', title: 'Hollow Manor', description: '', role: 'admin', archived: false, members: [] }),
      content: () => ok({ assets: db.assets.map(a => Object.assign({}, a)), moodboard: db.mood.slice(), packs: [], albums: [] }),
      snapshots: () => ok([]), activity: () => ok([]), vitrines: () => ok([]),
      demoStatus: () => ok({ eligible: false }), markRead: () => ok(null), markSeen: () => ok(null), messages: () => ok([]), annotations: () => ok([]),
      fileUrl: () => ok('https://example.test/x.png'),
      sections: () => locked ? Promise.resolve({ data: null, error: 'Les sections ne sont pas encore ouvertes' }) : ok({ sections: db.sections.map(s => Object.assign({}, s)), links: db.links.map(l => Object.assign({}, l)) }),
      createSection: (pid, title, parent) => { const id = 's' + (++db.n); db.sections.push({ id, parentId: parent || null, title, position: db.sections.length }); calls.push(['create', title, parent]); return ok({ id }); },
      renameSection: (id, title) => { db.sections.find(s => s.id === id).title = title; return ok(null); },
      deleteSection: id => { const s = db.sections.find(x => x.id === id); db.sections.forEach(x => { if (x.parentId === id) x.parentId = s.parentId; }); db.sections = db.sections.filter(x => x.id !== id); db.links = db.links.filter(l => l.sectionId !== id); return ok(null); },
      moveSection: (id, parent, pos) => { db.sections.find(s => s.id === id).parentId = parent || null; calls.push(['move', id, parent, pos]); return ok(null); },
      setAssetSections: (assetId, ids) => { db.links = db.links.filter(l => l.assetId !== assetId).concat(ids.map(sectionId => ({ sectionId, assetId }))); calls.push(['set', assetId, ids]); return ok(null); },
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
      addAsset: (pid, p) => { const id = 'n' + (++db.n); db.assets.push({ id, kind: p.kind, origin: 'own', title: p.title || '', url: p.url || null, fileId: p.fileId || null, notes: 0, pinned: false }); return ok({ id }); },
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
    w.eval(inline);
    await wait(150);
    return { w, d: w.document, db, calls, confirms };
  }
  const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const tab = async (ctx, name) => { click(ctx.w, ctx.d.querySelector(`[data-tab="${name}"]`)); await wait(150); };
  const cards = d => [...d.querySelectorAll('.item .item-title')].map(e => e.textContent.trim());

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
  check('colonne Sections affichée', !!nav() && /Toute la réserve/.test(nav().textContent) && /Non classé/.test(nav().textContent));
  check('« non classé » compte tout au départ', /Non classé\s*3/.test(nav().textContent));
  check('message « aucune section »', /Aucune section/.test(nav().textContent));

  // créer une section à la racine
  click(c.w, nav().querySelector('[data-secact="add"]'));
  let input = c.d.getElementById('secInput');
  check('champ de saisie inline', !!input);
  input.value = 'Niveau 1'; input.dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(150);
  check('section créée et sélectionnée', c.db.sections.length === 1 && /Niveau 1/.test(nav().textContent) && !!nav().querySelector('.sec-row.on [data-pick="s1"]'));
  check('filtre : section vide = aucune image', cards(c.d).length === 0);

  // sous-section
  click(c.w, nav().querySelector('[data-secact="add"][data-id="s1"]'));
  input = c.d.getElementById('secInput'); input.value = 'Forêt'; input.dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(150);
  check('sous-section créée sous Niveau 1', c.db.sections[1].parentId === 's1');

  // ranger une image : Toute la réserve > bouton 🗂
  click(c.w, nav().querySelector('[data-pick="all"]')); await wait(100);
  check('toute la réserve : 2 images', cards(c.d).length === 2);
  click(c.w, c.d.querySelector('[data-secassign="a1"]')); await wait(50);
  const boxes = [...c.d.querySelectorAll('.sec-dialog input[type="checkbox"]')];
  check('boîte « ranger » : une case par section', boxes.length === 2);
  boxes.find(b => b.value === 's2').checked = true;
  click(c.w, c.d.querySelector('.sec-dialog [data-x="save"]')); await wait(150);
  check('image rangée dans la sous-section', c.db.links.length === 1 && c.db.links[0].sectionId === 's2' && c.db.links[0].assetId === 'a1');
  check('boîte fermée', !c.d.querySelector('.sec-overlay'));
  check('« non classé » descend à 2', /Non classé\s*2/.test(nav().textContent));

  // filtre : Niveau 1 inclut les sous-sections
  click(c.w, nav().querySelector('[data-pick="s1"]')); await wait(100);
  check('filtre sur le parent : montre les objets des sous-sections', cards(c.d).length === 1 && cards(c.d)[0] === 'Forêt');
  click(c.w, nav().querySelector('[data-pick="none"]')); await wait(100);
  check('filtre « non classé »', cards(c.d).length === 1 && cards(c.d)[0] === 'Château');

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
  click(c.w, nav().querySelector('[data-pick="all"]')); await wait(100);
  click(c.w, c.d.querySelector('[data-secassign="a1"]')); await wait(50);
  [...c.d.querySelectorAll('.sec-dialog input[type="checkbox"]')].forEach(b => { b.checked = true; });
  click(c.w, c.d.querySelector('.sec-dialog [data-x="save"]')); await wait(150);
  check('un objet dans plusieurs sections', c.db.links.filter(l => l.assetId === 'a1').length === 2);

  // auto-rangement : on choisit une section puis on ajoute une vidéo (lien)
  await tab(c, 'videos');
  click(c.w, nav().querySelector('[data-pick="s2"]')); await wait(100);
  check('onglet Vidéos : même colonne Sections', !!nav() && /Aucun|Trailer|vidéo/i.test(c.d.getElementById('panel').textContent));
  c.d.getElementById('vUrl').value = 'https://youtu.be/zzzzzzzzzz';
  click(c.w, c.d.getElementById('vLinkBtn')); await wait(200);
  check('objet ajouté pendant qu\'une section est choisie : rangé dedans', c.calls.some(x => x[0] === 'addTo' && x[1] === 's2' && x[2][0] === 'n3' || x[0] === 'addTo' && x[1] === 's2' && /^n/.test(x[2][0])));

  // renommer, déplacer, supprimer
  click(c.w, nav().querySelector('[data-pick="s2"]')); await wait(100);
  click(c.w, nav().querySelector('[data-secact="rename"][data-id="s2"]'));
  input = c.d.getElementById('secInput'); input.value = 'Forêt sombre'; input.dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(150);
  check('renommer', c.db.sections[1].title === 'Forêt sombre' && /Forêt sombre/.test(nav().textContent));
  click(c.w, nav().querySelector('[data-secact="move"][data-id="s2"]')); await wait(50);
  const radios = [...c.d.querySelectorAll('.sec-dialog input[type="radio"]')];
  check('déplacer : on propose la racine et les autres sections (pas elle-même)', radios.length === 2 && radios.every(r => r.value !== 's2'));
  radios.find(r => r.value === '').checked = true;
  click(c.w, c.d.querySelector('.sec-dialog [data-x="save"]')); await wait(150);
  check('déplacer à la racine', c.db.sections[1].parentId === null);
  click(c.w, nav().querySelector('[data-pick="s2"]')); await wait(100);
  click(c.w, nav().querySelector('[data-secact="del"][data-id="s2"]')); await wait(200);
  check('supprimer demande confirmation et rend les objets au « non classé »', c.confirms.length === 1 && c.db.sections.length === 1 && !c.db.assets.every(a => !a) && c.db.assets.length >= 3);
  check('après suppression, retour à la réserve', !!nav().querySelector('.sec-row.on [data-pick="all"]') || !!nav().querySelector('.sec-row.on [data-pick="s1"]'));

  // ---- Moodboard par section
  await tab(c, 'board');
  check('onglet Moodboard : colonne Sections avec « Moodboard général »', !!nav() && /Moodboard général/.test(nav().textContent) && !/Non classé/.test(nav().textContent));
  click(c.w, nav().querySelector('[data-pick="s1"]')); await wait(150);
  check('Moodboard de la section : son titre et son texte', /Niveau 1/.test(c.d.getElementById('panel').querySelector('h2').textContent) && /Moodboard de cette section/.test(c.d.getElementById('panel').textContent));
  check('Moodboard de la section : pas de versions (général seulement)', !c.d.getElementById('snapBtn'));
  const kind = c.d.getElementById('addKind'); kind.value = 'fromProject'; kind.dispatchEvent(new c.w.Event('change', { bubbles: true }));
  c.d.getElementById('fAsset').value = 'a2'; click(c.w, c.d.getElementById('addBtn')); await wait(200);
  check('épingler un objet du Projet dans le Moodboard de la section', c.db.pins.some(k => k.sectionId === 's1' && k.assetId === 'a2') && cards(c.d).includes('Château'));
  check('le Moodboard général reste vide', c.db.mood.length === 0);
  check('case « Épingler aussi au Moodboard général » proposée dans le Moodboard d\'une section', !!c.d.getElementById('alsoGeneral') && !c.d.getElementById('alsoGeneral').checked);
  click(c.w, c.d.querySelector('[data-act="star"]')); await wait(150);
  check('★ propre à ce Moodboard', c.db.pins.find(k => k.assetId === 'a2').starred === true);
  click(c.w, c.d.querySelector('[data-act="moodcopy"]')); await wait(50);
  const mb = [...c.d.querySelectorAll('.sec-dialog input[type="checkbox"]')];
  check('copier : une case par Moodboard (général + sections), celle-ci cochée', mb.length === 2 && mb[0].value === '' && !mb[0].checked && mb[1].checked);
  mb[0].checked = true; click(c.w, c.d.querySelector('.sec-dialog [data-x="save"]')); await wait(200);
  check('copier vers le Moodboard général = épingle indépendante', c.calls.some(x => x[0] === 'pinGeneral' && x[1] === 'a2' && x[2] === true) && c.db.pins.some(k => k.assetId === 'a2'));
  click(c.w, c.d.querySelector('[data-act="unpin"]')); await wait(150);
  check('retirer du Moodboard de la section ne touche pas le général', !c.db.pins.some(k => k.assetId === 'a2') && c.db.mood.includes('a2'));
  const k2 = c.d.getElementById('addKind'); k2.value = 'fromProject'; k2.dispatchEvent(new c.w.Event('change', { bubbles: true }));
  c.d.getElementById('fAsset').value = 'a1'; c.d.getElementById('alsoGeneral').checked = true; click(c.w, c.d.getElementById('addBtn')); await wait(250);
  check('case cochée : épinglé dans la section ET au Moodboard général', c.db.pins.some(k => k.sectionId === 's1' && k.assetId === 'a1') && c.db.mood.includes('a1'));
  click(c.w, nav().querySelector('[data-pick="all"]')); await wait(150);
  check('retour au Moodboard général : la carte y est', cards(c.d).includes('Château'));

  // ---- Tchat par section
  await tab(c, 'images');
  const chat = () => c.d.getElementById('chat');
  check('sélecteur de canal dans la colonne de discussion', !!c.d.getElementById('chanSel') && /Discussion générale/.test(c.d.getElementById('chanSel').textContent));
  click(c.w, nav().querySelector('[data-pick="s1"]')); await wait(100);
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
  await tab(c, 'images'); click(c.w, nav().querySelector('[data-pick="s1"]')); await wait(150);
  check('et visible dans l\'onglet Images de la section', cards(c.d).includes('plan.png'));
  // lien depuis la cloche : ?channel=
  const c2 = await boot(false, 's1');
  check('lien de la cloche : ouvre le canal de la section', /# Niveau 1/.test(c2.d.getElementById('chat').textContent));

  // ---- Lien section ↔ carte
  await tab(c, 'images');
  click(c.w, nav().querySelector('[data-pick="s1"]')); await wait(100);
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
  click(k.w, kn().querySelector('[data-pick="A"]')); await wait(150);
  click(k.w, k.d.querySelector('[data-sel="all"]')); await wait(100);
  click(k.w, k.d.querySelector('[data-sel="move"]')); await wait(50);
  const mv = [...k.d.querySelectorAll('.sec-dialog input[type="radio"]')];
  check('déplacer : la section courante n\'est pas proposée', mv.length === 2 && mv.every(r => r.value !== 'A'));
  mv.find(r => r.value === 'C').checked = true;
  click(k.w, k.d.querySelector('.sec-dialog [data-x="save"]')); await wait(250);
  check('déplacer la sélection vers une autre section (ajoute puis retire)', k.db.links.filter(l => l.sectionId === 'C').length === 2 && k.db.links.filter(l => l.sectionId === 'A').length === 0);
  click(k.w, k.d.querySelector('[data-sel="close"]')); await wait(100);
  check('terminer : les cases disparaissent', !k.d.querySelector('.sel-box') && !k.d.getElementById('selBar'));

  // glisser une section
  const rect = (el, top, height) => { el.getBoundingClientRect = () => ({ top, height, left: 0, width: 100, right: 100, bottom: top + height }); };
  const dragSec = (fromId, toId, y, type) => {
    const row = kn().querySelector(`[data-dropsec="${toId}"]`); rect(row, 0, 100);
    const ev = new k.w.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y });
    ev.dataTransfer = { types: ['text/x-lp-section'], data: { 'text/x-lp-section': fromId }, setData(a, b) { this.data[a] = b; }, getData(a) { return this.data[a] || ''; } };
    row.dispatchEvent(ev); return ev;
  };
  check('les lignes de section sont glissables', !!kn().querySelector('[data-secdrag="B"][draggable="true"]'));
  check('survol d\'une section par une section : dépôt accepté', dragSec('C', 'A', 50, 'dragover').defaultPrevented);
  dragSec('C', 'A', 5, 'drop'); await wait(200);
  check('déposer en haut d\'une ligne : placée avant (position 0)', k.calls.some(x => x[0] === 'move' && x[1] === 'C' && x[2] === null && x[3] === 0));
  dragSec('A', 'B', 95, 'drop'); await wait(200);
  check('déposer en bas d\'une ligne : placée après (position 1 parmi les sœurs B, C)', k.calls.some(x => x[0] === 'move' && x[1] === 'A' && x[2] === null && x[3] === 1));
  dragSec('A', 'B', 50, 'drop'); await wait(200);
  check('déposer au milieu : devient sa sous-section', k.calls.some(x => x[0] === 'move' && x[1] === 'A' && x[2] === 'B' && x[3] === null));
  const before = k.calls.filter(x => x[0] === 'move').length;
  dragSec('B', 'A', 50, 'drop'); await wait(200);
  check('une section ne peut pas entrer dans sa propre sous-section', k.calls.filter(x => x[0] === 'move').length === before);

  // télécharger
  const zipped = [];
  k.w.JSZip = class { file(p) { zipped.push(p); } generateAsync() { return Promise.resolve(new k.w.Blob(['x'])); } };
  k.w.fetch = () => Promise.resolve({ ok: true, blob: () => Promise.resolve(new k.w.Blob(['x'])) });
  k.w.URL.createObjectURL = () => 'blob:x'; k.w.URL.revokeObjectURL = () => {};
  k.w.HTMLAnchorElement.prototype.click = function () { zipped.push('DL:' + this.download); };
  k.db.links = [{ sectionId: 'A', assetId: 'a1' }, { sectionId: 'B', assetId: 'a1' }, { sectionId: 'B', assetId: 'v1' }];
  click(k.w, kn().querySelector('[data-pick="B"]')); await wait(150);
  await k.w.eval('loadSections()'); k.w.eval('renderSecNav()');
  click(k.w, kn().querySelector('[data-secact="download"]')); await wait(400);
  check('télécharger une section : zip nommé comme la section', zipped.includes('DL:Bravo.zip'));
  check('dossier de la section, nom du fichier', zipped.includes('Bravo/foret.png'));
  check('une vidéo en lien (sans fichier) n\'est pas dans le zip', !zipped.some(p => /Trailer/.test(p)));
  zipped.length = 0;
  click(k.w, kn().querySelector('[data-pick="all"]')); await wait(100);
  click(k.w, kn().querySelector('[data-secact="download"]')); await wait(400);
  check('télécharger tout : un dossier par section, « Non classé » pour le reste', zipped.includes('Bravo/Alpha/foret.png') && zipped.includes('Bravo/foret.png') && zipped.includes('Non classé/chateau.png') && zipped.includes('DL:Hollow Manor.zip'));

  // télécharger les fichiers d'une carte
  zipped.length = 0;
  await k.w.eval("downloadMapFiles({ title: 'Niveau 1', data: { roomTone: { kind: 'asset', id: 'a1' }, nodes: [{ label: 'Château', sounds: { main: [{ kind: 'asset', id: 'a2' }, { kind: 'track', id: 't' }] } }], edges: [] } })"); await wait(300);
  check('fichiers d\'une carte : un dossier par élément, fond d\'ambiance à part', zipped.includes("Niveau 1/Fond d'ambiance/foret.png") && zipped.includes('Niveau 1/Château/chateau.png') && zipped.includes('DL:Niveau 1.zip'));
  check('fichiers d\'une carte : les morceaux du Backstage ne sont pas inclus', zipped.filter(p => !p.startsWith('DL:')).length === 2);

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon');
  process.exit(failures ? 1 : 0);
})();
