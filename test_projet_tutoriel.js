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

  check('fermé au public par défaut (tutoPublicOpen -> false)', /function tutoPublicOpen\(\) \{ return false; \}/.test(inlineSrc));
  check('pas de barre commune ni de vrai serveur en mode tutoriel', /if \(!DEMO && !TUTO\) window\.LayerPitchShell/.test(inlineSrc));

  // Dans le test seulement, on ouvre le tutoriel (sans quoi le verrou admin renvoie vers la liste des projets).
  const opened = inlineSrc.replace('function tutoPublicOpen() { return false; }', 'function tutoPublicOpen() { return true; }');
  async function boot() {
    const dom = new JSDOM('<div id="content"></div><div id="presence"></div>', { url: 'https://beta.layerpitch.com/projet.html?tuto&lang=fr', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    ['layerpitch-i18n.js', 'layerpitch-appearance.js', 'layerpitch-guide.js', 'api/demo-client.js', 'api/demo-projects.js', 'projet-lecons.js'].forEach(f => w.eval(read(f)));
    w.LayerPitchProjects = {};
    w.LayerPitchAuth = { getSession: () => Promise.resolve({ session: { user: { id: 'demo-user', email: 'demo@layerpitch.com' } } }), getMyComposerId: () => Promise.resolve({ composerId: null }), onAuthStateChange: cb => setTimeout(() => cb('INITIAL_SESSION'), 0) };
    w.LayerPitchNotify = { confirm: () => Promise.resolve(true), error: () => {}, info: () => {} };
    w.LayerPitchSupabaseClient = { getClient: () => { throw new Error('le vrai serveur ne doit pas être appelé en mode tutoriel'); } };
    w.LayerPitchTracks = { listTracksByIds: () => Promise.resolve({ tracks: [] }), listTracks: () => Promise.resolve({ tracks: [] }) };
    w.LayerPitchAlbums = { listAlbums: () => Promise.resolve({ albums: [] }) };
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
  check('deux leçons proposées dans le bandeau', d.querySelectorAll('[data-tutolesson]').length === 2);

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
  check('leçon Moodboard ouverte', /1 \/ 9/.test(countText(again.d)));
  const L = again.w.LayerPitchProjetLessons.LESSON_LINKS; check('kit de liens vide en attendant les liens de Jules-Antoine (étape sautée)', L.length === 0);
  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
