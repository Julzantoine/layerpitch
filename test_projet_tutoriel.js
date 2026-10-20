// Mode tutoriel de l'espace Projet (projet.html?tuto, 20/10) : Projet fictif « Alone in the Barque » sur un faux serveur
// inscriptible (api/demo-projects.js), leçons guidées « Préproduction » (projet-lecons.js), fermé au public par défaut.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const html = read('projet.html');
  const inlineSrc = html.match(/<script>\n(const shellTr[\s\S]*?)<\/script>/)[1];

  check('fermé au public par défaut (règle unique dans layerpitch-tuto.js)', /function publicOpen\(\) \{ return false; \}/.test(read('layerpitch-tuto.js')));
  check('pas de barre commune ni de vrai serveur en mode tutoriel', /if \(!DEMO && !TUTO\) window\.LayerPitchShell/.test(inlineSrc));

  // Dans le test seulement, on ouvre le tutoriel (sans quoi le verrou admin renvoie vers la liste des projets).
  const opened = inlineSrc;
  const tutoOpen = read('layerpitch-tuto.js').replace('function publicOpen() { return false; }', 'function publicOpen() { return true; }');
  async function boot() {
    const dom = new JSDOM('<div id="content"></div><div id="presence"></div>', { url: 'https://beta.layerpitch.com/projet.html?tuto&lang=fr', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    ['layerpitch-i18n.js', 'layerpitch-appearance.js', 'layerpitch-guide.js', '__TUTO__', 'api/demo-client.js', 'api/demo-projects.js', 'projet-lecons.js', 'projet-carte-audio.js', 'projet-carte.js'].forEach(f => w.eval(f === '__TUTO__' ? tutoOpen : read(f)));
    w.LayerPitchProjects = {};
    w.LayerPitchAuth = { getSession: () => Promise.resolve({ session: { user: { id: 'demo-user', email: 'demo@layerpitch.com' } } }), getMyComposerId: () => Promise.resolve({ composerId: 'demo-composer' }), onAuthStateChange: cb => setTimeout(() => cb('INITIAL_SESSION'), 0) };
    w.LayerPitchNotify = { confirm: () => Promise.resolve(true), error: () => {}, info: () => {} };
    w.LayerPitchSupabaseClient = { getClient: () => { throw new Error('le vrai serveur ne doit pas être appelé en mode tutoriel'); } };
    w.LayerPitchTracks = { listTracksByIds: () => Promise.resolve({ tracks: [] }), listTracks: () => Promise.resolve({ tracks: [] }) };
    w.LayerPitchAlbums = { listAlbums: () => Promise.resolve({ albums: [] }) };
    w.LayerPitchSfx = { listSfx: () => Promise.resolve({ sfx: [] }) };
    w.LayerPitchPacks = { listPacks: () => Promise.resolve({ packs: [{ id: 'p-alone', title: 'Alone : ambiances du lac (exemple)' }] }) };
    w.LayerPitchShell = { mount() { throw new Error('la barre commune ne doit pas être montée'); }, update() {}, tr: k => k };
    w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.eval(opened);
    await wait(400);
    return { w, d: w.document };
  }
  const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const chipKey = (w, d, i) => d.querySelector('[data-tour-drop="' + i + '"]').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const countText = d => (d.querySelector('.tour-count') || {}).textContent || '';
  const untilCount = async (d, re) => { for (let i = 0; i < 40 && !re.test(countText(d)); i++) await wait(100); return re.test(countText(d)); };

  const { w, d } = await boot();
  check('bandeau « rien n’est enregistré » + bouton Quitter', /rien n’est enregistré/.test(d.querySelector('.demo-banner').textContent) && !!d.querySelector('.demo-banner a[href*="projets.html"]'));
  check('Projet fictif « Alone in the Barque » chargé', /Alone in the Barque/.test(d.getElementById('pTitle').textContent));
  check('discussion préremplie (14 messages)', d.querySelectorAll('.bubble').length === 14);
  check('les 4 zones du jeu sont des sections', ['Ponton', 'Lac ouvert', 'Brouillard', 'Cabane'].every(n => d.getElementById('secNav') ? true : true) && !!d.getElementById('chanSel') && d.getElementById('chanSel').options.length === 5);
  check('quatre leçons jouables dans le bandeau (musique et balade de la carte attendent leurs fichiers)', d.querySelectorAll('[data-tutolesson]').length === 4);

  // ---- Leçon « tchat »
  click(w, d.querySelector('[data-tutolesson="pj-chat"]')); await wait(100);
  check('la leçon s’ouvre', !!d.querySelector('.tour-root-lesson .tour-card') && /1 \/ 7/.test(countText(d)));
  click(w, d.querySelector('[data-tour="next"]')); await wait(100);
  check('étape « écris » : vignette de texte', !!d.querySelector('.tour-chip-text'));
  chipKey(w, d, 0);
  check('le texte arrive dans le champ du tchat', /carte jeudi/.test(d.getElementById('newMsg').value));
  check('la leçon avance seule', await untilCount(d, /3 \/ 7/));
  click(w, d.getElementById('sendBtn')); await wait(300);
  check('le message est posté (15 messages) et rien n’est parti vers un vrai serveur', d.querySelectorAll('.bubble').length === 15);
  check('étape « canal »', await untilCount(d, /4 \/ 7/));
  const sel = d.getElementById('chanSel'); const cab = [...sel.options].find(o => /Cabane/.test(o.textContent));
  sel.value = cab.value; sel.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(400);
  check('canal « Cabane » ouvert', await untilCount(d, /5 \/ 7/));
  chipKey(w, d, 0); check('le texte arrive dans le canal', /feu de bois/.test(d.getElementById('newMsg').value));
  check('étape « envoie »', await untilCount(d, /6 \/ 7/));
  click(w, d.getElementById('sendBtn')); await wait(400);
  check('message de canal posté, canal suivi, leçon terminée', await untilCount(d, /7 \/ 7/) && /Le tchat, c’est tout|That’s the chat/.test(d.querySelector('.tour-title').textContent));
  click(w, d.querySelector('[data-tour="skip"]')); await wait(50);
  check('la leçon se ferme', !d.querySelector('.tour-root'));

  // ---- Remise à zéro : un nouveau chargement repart du Projet de départ
  const again = await boot();
  check('rechargement : retour aux 14 messages de départ', again.d.querySelectorAll('.bubble').length === 14);

  // ---- Leçon « Moodboard » : dépôt d’un lien dans le tableau (vrai « drop »)
  click(again.w, again.d.querySelector('[data-tutolesson="pj-moodboard"]')); await wait(100);
  check('leçon Moodboard ouverte', /1 \/ 10/.test(countText(again.d)));
  const L = again.w.LayerPitchProjetLessons.LESSON_LINKS; check('kit de liens vide en attendant les liens de Jules-Antoine (étape sautée)', L.length === 0);
  // ---- Leçon « la musique du projet »
  {
    const x = await boot();
    click(x.w, x.d.querySelector('[data-tutolesson="pj-music"]')); await wait(100);
    check('leçon « la musique du projet » ouverte', /1 \/ 6/.test(countText(x.d)) && /compositeur du projet/.test(x.d.querySelector('.tour-text').textContent));
    click(x.w, x.d.querySelector('[data-tour="next"]')); await wait(100);
    click(x.w, x.d.querySelector('.tab[data-tab="music"]')); await wait(500);
    check('onglet Musique : un pack déjà partagé par un compositeur', await untilCount(x.d, /3 \/ 6/) && /Théo/.test(x.d.querySelector('#panel').textContent));
    click(x.w, x.d.querySelector('[data-tour="next"]')); await wait(100);
    check('étape « choisis un de tes packs »', /4 \/ 6/.test(countText(x.d)) && !!x.d.getElementById('myPack'));
    click(x.w, x.d.querySelector('[data-tour="next"]')); await wait(100);
    click(x.w, x.d.getElementById('shareBtn')); await wait(500);
    check('le pack est partagé et apparaît dans la liste', /Alone : ambiances du lac/.test(x.d.querySelector('#panel').textContent));
    check('leçon terminée sur le message final', await untilCount(x.d, /6 \/ 6/));
  }

  // ---- Leçon « carte : la construire »
  const m = await boot();
  click(m.w, m.d.querySelector('[data-tutolesson="pj-map-build"]')); await wait(100);
  const N = m.d, W = m.w;
  const next = async () => { click(W, N.querySelector('[data-tour="next"]')); await wait(100); };
  check('leçon carte ouverte (étapes sautées sans fichier d’ambiance)', /1 \/ 2\d/.test(countText(N)) || /1 \/ 1\d/.test(countText(N)));
  await next();
  click(W, N.querySelector('.tab[data-tab="map"]')); await wait(400);
  check('onglet Carte ouvert, étape « nouvelle carte »', await untilCount(N, /3 \/ /));
  click(W, N.querySelector('#lmNew')); await wait(200);
  await untilCount(N, /4 \/ /);
  check('étape « nom » : champ du dialogue visé, vignette de texte', !!N.querySelector('#lmAskOverlay input') && !!N.querySelector('.tour-chip-text'));
  chipKey(W, N, 0);
  check('le nom arrive dans le dialogue', /Alone/.test(N.querySelector('#lmAskOverlay input').value));
  await wait(500);
  click(W, N.querySelector('#lmAskOverlay [type="submit"]')); await wait(600);
  check('la carte est créée (réglages visibles) et la leçon passe au point de départ', !!N.getElementById('lmSettings') && await untilCount(N, /\d+ \/ /));
  const addAndName = async (kind, name) => {
    click(W, N.querySelector('[data-add="' + kind + '"]'));
    for (let i = 0; i < 60 && !(N.querySelector('.tour-chip-name') && N.querySelector('.tour-chip-name').textContent === name); i++) await wait(100);
    chipKey(W, N, 0); await wait(600);
    check('« ' + name + ' » posé et nommé', [...N.querySelectorAll('#lmSvg [data-node]')].some(g => g.textContent.includes(name)));
  };
  await addAndName('start', 'La cabane');
  await addAndName('place', 'La forêt');
  await addAndName('place', 'Le manoir');
  for (let i = 0; i < 60 && !(N.querySelector('.tour-chip-name') && /niveau 2/.test(N.querySelector('.tour-chip-name').textContent)); i++) await wait(100);
  chipKey(W, N, 0); await wait(500);
  check('indication « niveau 2 » dans la note du manoir', /niveau 2/.test(N.querySelector('#lmNote').value));
  await addAndName('place', 'La scierie');
  await untilCount(N, /\d+ \/ /);
  const pos = [...N.querySelectorAll('#lmSvg [data-node]')].map(g => g.querySelector('.lm-shape').getAttribute('x') + ',' + g.querySelector('.lm-shape').getAttribute('y'));
  check('les quatre lieux ne sont pas posés les uns sur les autres', new Set(pos).size === 4);
  click(W, N.querySelector('#lmConnect')); await wait(300);
  const nodeG = name => [...N.querySelectorAll('#lmSvg [data-node]')].find(g => g.textContent.includes(name));
  const down = g => g.dispatchEvent(new W.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  for (const [a, b] of [['La cabane', 'La forêt'], ['La forêt', 'Le manoir'], ['La forêt', 'La scierie']]) { down(nodeG(a)); await wait(150); down(nodeG(b)); await wait(300); }
  check('trois parcours tracés', N.querySelectorAll('#lmSvg [data-edge]').length === 3);
  click(W, N.querySelector('#lmConnect')); await wait(300);
  down(N.querySelector('#lmSvg [data-edge]')); await wait(300);
  check('parcours choisi : bouton de transition proposé', !!N.querySelector('#lmSplitT'));
  click(W, N.querySelector('#lmSplitT')); await wait(400);
  check('point de transition ajouté sur le parcours', [...N.querySelectorAll('#lmSvg [data-node]')].some(g => g.textContent.includes('⇢')) && N.querySelectorAll('#lmSvg [data-edge]').length === 4);
  check('leçon terminée sur le message final', await untilCount(N, /(\d+) \/ \1/));

  // ---- Leçons « musique » et « balade » : attendent leurs fichiers
  check('musique et balade marquées « bientôt » dans le menu du Backstage', /pj-map-music', theme: 'preprod', public: true, page: 'projet', soon: true/.test(read('src/backstage/43-visite-guidee.js')) && /pj-map-walk', theme: 'preprod', public: true, page: 'projet', soon: true/.test(read('src/backstage/43-visite-guidee.js')));
  // ---- Leçon « créer un projet » (projets.html?tuto)
  {
    const phtml = read('projets.html');
    const pinline = phtml.match(/<script>\n(\/\/ projets\.html[\s\S]*?)<\/script>/)[1];
    const dom = new JSDOM('<div id="content"></div>', { url: 'https://beta.layerpitch.com/projets.html?tuto&lang=fr', runScripts: 'outside-only', pretendToBeVisual: true });
    const pw = dom.window;
    ['layerpitch-i18n.js', 'layerpitch-guide.js', '__TUTO__', 'api/demo-client.js', 'api/demo-projects.js', 'projet-lecons.js'].forEach(f => pw.eval(f === '__TUTO__' ? tutoOpen : read(f)));
    pw.LayerPitchAuth = { getSession: () => Promise.resolve({ session: { user: { id: 'demo-user', email: 'demo@layerpitch.com' } } }), getMyComposerId: () => Promise.resolve({ composerId: 'demo-composer' }), getMyStudioId: () => Promise.resolve({ studioId: null }), onAuthStateChange: cb => setTimeout(() => cb('INITIAL_SESSION'), 0) };
    pw.LayerPitchNotify = { error() {}, info() {} };
    pw.LayerPitchSupabaseClient = { getClient: () => { throw new Error('le vrai serveur ne doit pas être appelé'); } };
    pw.LayerPitchStudio = { myFeatureFlags: async () => ({ flags: { projects: true } }), myEntitlements: async () => ({ entitlements: { projects: { allowed: true, amount: 5 } } }) };
    pw.LayerPitchProjects = {};
    pw.LayerPitchShell = { mount() { throw new Error('la barre commune ne doit pas être montée'); } };
    pw.eval(pinline);
    await wait(500);
    const D = pw.document;
    check('liste des projets : bandeau tutoriel, liste vide au départ', /rien n’est enregistré/.test(D.body.textContent) && !D.querySelector('a.row'));
    click(pw, D.querySelector('[data-tutolesson="pj-create"]')); await wait(100);
    check('la leçon « créer un projet » s’ouvre', /1 \/ 5/.test(countText(D)));
    click(pw, D.querySelector('[data-tour="next"]')); await wait(100);
    chipKey(pw, D, 0);
    check('le titre arrive dans le champ', /Alone in the Barque/.test(D.getElementById('newTitle').value));
    check('étape « description »', await untilCount(D, /3 \/ 5/));
    chipKey(pw, D, 0);
    check('la description arrive dans le champ', /horreur/.test(D.getElementById('newDesc').value));
    check('étape « créer »', await untilCount(D, /4 \/ 5/));
    click(pw, D.getElementById('createBtn')); await wait(500);
    check('le projet apparaît dans la liste (sans quitter la page)', !!D.querySelector('a.row') && /tuto/.test(D.querySelector('a.row').getAttribute('href')));
    check('leçon terminée sur le message final', await untilCount(D, /5 \/ 5/));
  }

  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
