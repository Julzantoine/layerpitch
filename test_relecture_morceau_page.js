const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Page de relecture d'un MORCEAU (23/11, relecture.html) avec un serveur et un lecteur simulés : le genre du lien vient de
// get_review_access, la preuve du lien est posée pour l'audio protégé, une remarque part avec l'instant ET l'état du lecteur retenu
// dès qu'on commence à écrire, l'état est mis en mots, « Écouter ici » remet le lecteur dans cet état, le compositeur est prévenu.
(async () => {
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf-8').replace(/<\/script/gi, '<\\/script');
  let html = fs.readFileSync(path.join(__dirname, 'relecture.html'), 'utf-8');
  html = html.replace(/<script src="https:[^>]*><\/script>/g, '').replace(/<script src="api\/supabase-client\.js[^>]*><\/script>/, '')
    .replace(/<script src="([^"?]+)(\?v=[^"]*)?"><\/script>/g, (m, f) => `<script>${read(f)}</script>`);
  const S = 'K'.repeat(64);
  const calls = [], fetches = [], applied = [];
  const data = { kind: 'track', trackId: 't1', title: 'Combat', comments: [] };
  let live = { v: 1, mode: 'embranchement-vertical', t: 42.5, where: 'Combat', level: 1, levelCount: 3, muted: ['layer-0'], voiceLabels: { 'layer-0': 'Piano' }, triggers: [{ id: 'a', label: 'Alarme' }] };
  const dom = new JSDOM(html, {
    url: 'http://localhost/relecture.html?s=combat-v1&lang=fr#k=' + S, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.LayerPitchSupabaseClient = { url: 'https://db.example', publishableKey: 'pk', getClient: () => ({ rpc: async (name, args) => {
        calls.push([name, JSON.parse(JSON.stringify(args))]);
        if (name === 'get_review_access') return { data: { mode: 'magic', kind: 'track' }, error: null };
        if (name === 'get_track_review') return { data: args.p_secret === S ? JSON.parse(JSON.stringify(data)) : null, error: null };
        if (name === 'add_track_review_comment') {
          data.comments.push({ id: 'c' + data.comments.length, parentId: args.p_parent_id, t: args.p_t, state: args.p_state, author: args.p_author, fromOwner: false, body: args.p_body, resolved: false, createdAt: '2026-11-23T10:00:0' + data.comments.length + 'Z' });
          return { data: { ok: true }, error: null };
        }
        return { data: null, error: { message: 'inconnu : ' + name } };
      } }) };
      // Lecteur simulé : les vrais moteurs sont couverts par leurs propres tests.
      win.LayerPlayerCore = {
        buildTrackRow: () => { const d = win.document.createElement('div'); d.className = 'track-row-wrapper'; d.innerHTML = '<div data-role="titleToggle"></div>'; return d; },
        initTrackPlayer: (track, row) => { row.lpReview = { state: () => JSON.parse(JSON.stringify(live)), apply: async st => { applied.push(st); return true; } }; },
        setSfxLibrary: () => {},
      };
      win.LayerPitchTracks = { getTrack: async id => ({ track: { id, title: 'Combat', mode: 'embranchement-vertical', sfxIds: [] } }) };
      win.LayerPitchSfx = { listSfxByIds: async () => ({ sfx: [] }) };
      win.fetch = (url, opts) => { fetches.push([url, opts]); return Promise.resolve({ ok: true }); };
    },
  });
  const W = dom.window, doc = W.document;
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const tick = (n = 1) => new Promise(r => setTimeout(r, 30 * n));
  await tick(6);
  check('le genre du lien vient de get_review_access : vue morceau', calls[0][0] === 'get_review_access' && calls.some(c => c[0] === 'get_track_review'));
  check('titre et lecteur affichés', doc.querySelector('h1').textContent === 'Combat' && !!doc.querySelector('#trackHost .track-row-wrapper'));
  check('la preuve du lien est posée pour l\'audio protégé', W.LpReviewProof && W.LpReviewProof.slug === 'combat-v1' && W.LpReviewProof.secret === S);
  check('le bouton dit l\'instant et l\'endroit entendus', doc.getElementById('atBtn').textContent.includes('0:42') && doc.getElementById('atBtn').textContent.includes('Combat'));

  doc.getElementById('nameInput').value = 'Camille'; doc.getElementById('nameInput').dispatchEvent(new W.Event('input'));
  doc.getElementById('cmText').dispatchEvent(new W.Event('focus'));
  live = Object.assign({}, live, { t: 80, where: 'Exploration' }); // la musique continue pendant qu'on écrit
  doc.getElementById('cmText').value = 'Ici c\'est trop chargé';
  doc.getElementById('atBtn').click(); await tick(4);
  const add = calls.find(c => c[0] === 'add_track_review_comment');
  check('la remarque garde l\'instant retenu en commençant à écrire (pas celui du clic)', add && add[1].p_t === 42.5 && add[1].p_state.where === 'Combat');
  check('la remarque part avec l\'état complet du lecteur', add && add[1].p_state.triggers[0].label === 'Alarme' && add[1].p_state.muted[0] === 'layer-0');
  const notify = fetches.find(f => /review-notify$/.test(f[0]));
  check('le compositeur est prévenu (envoi qui survit à la fermeture, lien seulement)', notify && notify[1].keepalive === true && JSON.parse(notify[1].body).slug === 'combat-v1' && JSON.parse(notify[1].body).leaving === false);
  const list = doc.getElementById('list').textContent;
  check('l\'état est mis en mots sous la remarque', list.includes('Intensité 2 / 3') && list.includes('Coupé : Piano') && list.includes('Événement : Alarme') && list.includes('Ici c\'est trop chargé'));
  doc.querySelector('[data-listen]').click(); await tick(2);
  check('« Écouter ici » remet le lecteur dans l\'état de la remarque', applied.length === 1 && applied[0].where === 'Combat' && applied[0].t === 42.5);
  Object.defineProperty(doc, 'visibilityState', { value: 'hidden', configurable: true });
  doc.dispatchEvent(new W.Event('visibilitychange')); await tick(1);
  check('en quittant la page : le récapitulatif part sans attendre', fetches.some(f => /review-notify$/.test(f[0]) && JSON.parse(f[1].body).leaving === true));

  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
  process.exit(failures ? 1 : 0);
})();
