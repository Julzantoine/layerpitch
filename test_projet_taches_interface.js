// Onglet « Tâches » — interface de projet.html (4/11) : onglet caché feu vert fermé, ajout rapide, cochage, filtres, groupes par
// section, dialogue (assignation, échéance, lien), aller à l'élément lié, « faire une tâche » depuis un message, glisser pour réordonner.
// La page tourne dans jsdom avec une fausse couche d'accès (LayerPitchProjects) qui garde l'état en mémoire.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const html = fs.readFileSync(path.join(__dirname, 'projet.html'), 'utf8');
  const inline = html.match(/<script>\n(const shellTr[\s\S]*?)<\/script>/)[1];

  async function boot(locked) {
    const dom = new JSDOM('<div id="content"></div><div id="presence"></div>', { url: 'https://beta.layerpitch.com/projet.html?id=p1&lang=fr', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    w.eval(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(__dirname, 'layerpitch-appearance.js'), 'utf8'));
    const db = { n: 0, tasks: [], msgs: [{ id: 'm1', body: 'Refaire la boucle combat\nelle est trop longue', createdAt: new Date().toISOString(), authorEmail: 'autre@x.test', mine: false, attachments: [] }],
      sections: [{ id: 's1', parentId: null, title: 'Forêt', position: 0 }, { id: 's2', parentId: null, title: 'Château', position: 1 }],
      assets: [{ id: 'a1', kind: 'image', origin: 'own', title: 'Plan du château', fileId: 'f1', notes: 0, pinned: false },
        { id: 'v1', kind: 'video', origin: 'own', title: 'Trailer', url: 'https://youtu.be/abcdefghij', notes: 0, pinned: false }] };
    const calls = [];
    const ok = data => Promise.resolve({ data, error: null });
    const email = id => ({ u1: 'me@x.test', u2: 'autre@x.test' }[id] || null);
    const view = t => Object.assign({}, t, { assigneeEmail: email(t.assigneeId), canDelete: true, mine: true });
    const P = {
      PRIVATE: '__me',
      get: () => ok({ id: 'p1', title: 'Hollow Manor', description: '', role: 'admin', archived: false,
        members: [{ id: 'mb1', profileId: 'u1', email: 'me@x.test', status: 'active', source: 'owner', role: 'admin', me: true }, { id: 'mb2', profileId: 'u2', email: 'autre@x.test', status: 'active', source: 'guest', me: false }] }),
      content: () => ok({ assets: db.assets.map(a => Object.assign({}, a)), moodboard: [], packs: [], albums: [] }),
      appearance: () => ok({}), preview: () => ok({}), snapshots: () => ok([]), activity: () => ok([]), vitrines: () => ok([]),
      demoStatus: () => ok({ eligible: false }), markRead: () => ok(null), markSeen: () => ok(null), annotations: () => ok([]),
      messages: () => ok(db.msgs.slice()), fileUrl: () => ok('https://example.test/x.png'),
      sections: () => ok({ sections: db.sections.map(s => Object.assign({}, s)), links: [] }), sectionPins: () => ok([]), sectionChatState: () => ok([]),
      listMaps: () => ok([{ id: 'mp1', title: 'Niveau 1', data: { nodes: [{ id: 'n1', type: 'boss', label: 'Le boss', x: 0, y: 0 }], edges: [] } }]),
      tasks: () => locked ? Promise.resolve({ data: null, error: 'Les tâches ne sont pas encore ouvertes' }) : ok(db.tasks.filter(t => !t.done).sort((a, b) => a.position - b.position).concat(db.tasks.filter(t => t.done)).map(view)),
      createTask: (pid, p) => { calls.push(['create', p]); const id = 't' + (++db.n); db.tasks.push(Object.assign({ id, notes: '', done: false, assigneeId: null, dueDate: null, sectionId: null, link: null }, p, { position: -db.n })); return ok({ id }); },
      updateTask: (id, p) => { calls.push(['update', id, p]); Object.assign(db.tasks.find(t => t.id === id), p); return ok(null); },
      setTaskDone: (id, done) => { calls.push(['done', id, done]); Object.assign(db.tasks.find(t => t.id === id), { done, doneByEmail: done ? 'me@x.test' : null }); return ok(null); },
      reorderTasks: (pid, ids) => { calls.push(['reorder', ids]); ids.forEach((id, i) => { db.tasks.find(t => t.id === id).position = i; }); return ok(null); },
      deleteTask: id => { calls.push(['delete', id]); db.tasks = db.tasks.filter(t => t.id !== id); return ok(null); },
    };
    w.LayerPitchProjects = P;
    w.LayerPitchAuth = { getSession: () => Promise.resolve({ session: { user: { id: 'u1', email: 'me@x.test' } } }), getMyComposerId: () => Promise.resolve({ composerId: null }), onAuthStateChange: cb => setTimeout(() => cb('INITIAL_SESSION'), 0) };
    w.LayerPitchNotify = { confirm: () => Promise.resolve(true), error: m => calls.push(['error', m]), info: () => {} };
    w.LayerPitchSupabaseClient = { getClient: () => ({ channel: () => ({ on() { return this; }, subscribe() {}, track() {}, presenceState: () => ({}), send() {} }) }) };
    w.LayerPitchTracks = { listTracksByIds: () => Promise.resolve({ tracks: [] }), listTracks: () => Promise.resolve({ tracks: [] }) };
    w.LayerPitchAlbums = { listAlbums: () => Promise.resolve({ albums: [] }) };
    w.LayerPitchShell = { mount() {}, update() {}, tr: k => k };
    w.LayerPitchLevelMap = { mount: (panel, ctx) => { calls.push(['mapMount', ctx.openId, ctx.openNode]); panel.innerHTML = '<div id="fakeMap"></div>'; return { destroy() {}, state: {} }; } };
    w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.eval(inline);
    await wait(150);
    return { w, d: w.document, db, calls };
  }
  const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const change = (w, el, v) => { if (typeof v === 'boolean') el.checked = v; else el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const tab = async (c, name) => { click(c.w, c.d.querySelector(`[data-tab="${name}"]`)); await wait(150); };
  const titles = d => [...d.querySelectorAll('.task-row:not(.done) .task-title')].map(e => e.textContent.trim());
  const quickAdd = async (c, text) => { c.d.getElementById('taskNew').value = text; click(c.w, c.d.getElementById('taskAddBtn')); await wait(120); };

  // ---- Feu vert fermé : pas d'onglet
  let c = await boot(true);
  check('feu vert fermé : pas d\'onglet Tâches', !c.d.querySelector('[data-tab="tasks"]'));
  check('feu vert fermé : pas de bouton « faire une tâche » dans la Discussion', !c.d.querySelector('[data-act="totask"]'));

  // ---- Ouvert
  c = await boot(false);
  const tabs = [...c.d.querySelectorAll('[data-tab]')].map(b => b.dataset.tab);
  check('onglet Tâches juste après Moodboard', tabs[0] === 'board' && tabs[1] === 'tasks');
  await tab(c, 'tasks');
  check('liste vide : message d\'accueil', /Aucune tâche pour l'instant/.test(c.d.getElementById('panel').textContent));
  await quickAdd(c, 'Monter la vidéo');
  await quickAdd(c, 'Mixer le thème');
  check('ajout rapide (bouton) : deux tâches, la plus récente en tête', JSON.stringify(titles(c.d)) === JSON.stringify(['Mixer le thème', 'Monter la vidéo']));
  c.d.getElementById('taskNew').value = 'Par Entrée';
  c.d.getElementById('taskNew').dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(120);
  check('ajout rapide (Entrée)', titles(c.d)[0] === 'Par Entrée');
  check('section « toutes » : la tâche n\'est rangée nulle part', c.calls.filter(x => x[0] === 'create').every(x => x[1].sectionId === null));

  // Cocher : passe dans « Faites »
  let row = [...c.d.querySelectorAll('.task-row')].find(r => r.textContent.includes('Monter la vidéo'));
  change(c.w, row.querySelector('[data-taskdone]'), true); await wait(120);
  check('cocher : la tâche quitte la liste à faire', !titles(c.d).includes('Monter la vidéo'));
  check('… et un bouton « Faites (1) » apparaît', /Faites \(1\)/.test(c.d.getElementById('taskDoneToggle').textContent));
  click(c.w, c.d.getElementById('taskDoneToggle')); await wait(80);
  check('déplier les faites : barrée, « faite par »', !!c.d.querySelector('.task-row.done') && /faite par me@x\.test/.test(c.d.querySelector('.task-row.done').textContent));

  // Dialogue : assigner, échéance passée, lien vers un point de carte
  row = [...c.d.querySelectorAll('.task-row')].find(r => r.textContent.includes('Mixer le thème'));
  click(c.w, row.querySelector('[data-taskedit]')); await wait(80);
  let box = c.d.querySelector('.sec-dialog');
  check('clic sur une tâche : le dialogue s\'ouvre, titre rempli', box && box.querySelector('#tTitle').value === 'Mixer le thème');
  box.querySelector('#tWho').value = 'u2';
  box.querySelector('#tDue').value = '2020-01-15';
  box.querySelector('#tSec').value = 's2';
  change(c.w, box.querySelector('#tLinkType'), 'map');
  check('lien carte : liste des points (« Toute la carte » + « Le boss »)', [...box.querySelectorAll('#tLinkSub option')].map(o => o.textContent).join('|') === 'Toute la carte|Le boss');
  box.querySelector('#tLinkSub').value = 'n1';
  click(c.w, box.querySelector('[data-x="save"]')); await wait(150);
  const up = c.calls.filter(x => x[0] === 'update').pop();
  check('enregistrer : assignée, échéance, section, lien carte + point', up && up[2].assigneeId === 'u2' && up[2].dueDate === '2020-01-15' && up[2].sectionId === 's2' && up[2].link.type === 'map' && up[2].link.id === 'mp1' && up[2].link.sub === 'n1');
  check('dialogue fermé après enregistrement', !c.d.querySelector('.sec-overlay'));
  check('groupes par section : « # Château » puis « Sans section »', [...c.d.querySelectorAll('.task-group h3')].map(h => h.textContent.trim()).slice(0, 2).join('|') === '# Château|Sans section');
  row = [...c.d.querySelectorAll('.task-row')].find(r => r.textContent.includes('Mixer le thème'));
  check('pastilles : personne assignée + échéance en retard', /autre@x\.test/.test(row.textContent) && !!row.querySelector('.pill.overdue'));
  check('lien affiché : carte · point', /Niveau 1 · Le boss/.test(row.querySelector('[data-tasklink]').textContent));

  // Filtres
  change(c.w, c.d.getElementById('taskMine'), true); await wait(80);
  check('« seulement les miennes » : la tâche assignée à un autre disparaît', !titles(c.d).includes('Mixer le thème'));
  change(c.w, c.d.getElementById('taskMine'), false); await wait(80);
  change(c.w, c.d.getElementById('taskSec'), 's2'); await wait(80);
  check('filtre par section : seulement Château', JSON.stringify(titles(c.d)) === JSON.stringify(['Mixer le thème']));
  await quickAdd(c, 'Dans le château');
  check('ajout rapide dans une section choisie : rangée dedans', c.calls.filter(x => x[0] === 'create').pop()[1].sectionId === 's2');
  change(c.w, c.d.getElementById('taskSec'), 'all'); await wait(80);

  // Aller à l'élément lié
  row = [...c.d.querySelectorAll('.task-row')].find(r => r.textContent.includes('Mixer le thème'));
  click(c.w, row.querySelector('[data-tasklink]')); await wait(150);
  const mm = c.calls.filter(x => x[0] === 'mapMount').pop();
  check('ouvrir le lien : onglet Carte, la bonne carte, le point sélectionné', mm && mm[1] === 'mp1' && mm[2] === 'n1');
  await tab(c, 'tasks');

  // Réordonner (glisser) : la tâche du bas passe en haut du groupe « Château »
  const host = c.d.querySelector('[data-taskgroup="s2"]');
  const items = [...host.querySelectorAll('.task-row')];
  const before = items.map(r => r.dataset.task);
  const dt = { setData() {}, effectAllowed: '' };
  const ev = (type, target, extra) => { const e = new c.w.Event(type, { bubbles: true, cancelable: true }); e.dataTransfer = dt; Object.assign(e, extra || {}); target.dispatchEvent(e); };
  items[items.length - 1].querySelector('.drag-handle').dispatchEvent(new c.w.Event('pointerdown', { bubbles: true }));
  ev('dragstart', items[items.length - 1]);
  items[0].getBoundingClientRect = () => ({ top: 0, height: 40, left: 0, width: 100 });
  ev('dragover', items[0], { clientY: 5, clientX: 5 });
  ev('drop', items[0]); await wait(150);
  const ro = c.calls.filter(x => x[0] === 'reorder').pop();
  check('glisser : nouvel ordre envoyé, les autres groupes gardent leur place', ro && ro[1].indexOf(before[before.length - 1]) < ro[1].indexOf(before[0]) && ro[1].length === c.db.tasks.filter(t => !t.done).length);

  // Supprimer depuis le dialogue
  row = [...c.d.querySelectorAll('.task-row')].find(r => r.textContent.includes('Par Entrée'));
  click(c.w, row.querySelector('[data-taskedit]')); await wait(80);
  click(c.w, c.d.querySelector('.sec-dialog [data-x="del"]')); await wait(150);
  check('supprimer depuis le dialogue', !titles(c.d).includes('Par Entrée') && c.calls.some(x => x[0] === 'delete'));

  // « Faire une tâche » depuis un message de la Discussion
  click(c.w, c.d.getElementById('chatOpenBtn') || c.d.body); await wait(120);
  const tk = c.d.querySelector('.bubble [data-act="totask"]');
  check('Discussion : bouton ☑ sur les messages des autres', !!tk);
  click(c.w, tk); await wait(120);
  box = c.d.querySelector('.sec-dialog');
  check('message → tâche : titre = première ligne, précisions = message + auteur', box && box.querySelector('#tTitle').value === 'Refaire la boucle combat' && /trop longue[\s\S]*autre@x\.test/.test(box.querySelector('#tNotes').value));
  click(c.w, box.querySelector('[data-x="save"]')); await wait(150);
  check('message → tâche : créée', c.calls.filter(x => x[0] === 'create').pop()[1].title === 'Refaire la boucle combat');

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est vert.');
  process.exit(failures ? 1 : 0);
})();
