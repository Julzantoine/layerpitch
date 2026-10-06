// Le dé de la page fan (mes-albums.html, 6/10) : écoute aléatoire à chaque écoute, autorisée par le compositeur pour l'album, allumable pour
// mode démo local (versions en mémoire), avec un faux lecteur et un faux moteur de lecture des prises (aucun son, aucune
// base). Vérifie : Figer garde la prise en cours, les playlists (créer, renommer, ajouter une version depuis Morceaux ou
// l'Atelier, « Nouvelle playlist… », écouter, réordonner, retirer, suppression en cascade d'une version, supprimer), la version jouée dans l'album (choix du fan, sinon celle du compositeur,
// sinon la plus récente du fan), un morceau sans version sauté, pause / reprise à la même position, enchaînement, l'atelier
// qui coupe la barre, renommer, supprimer (confirmation dans l'interface), et le verrou admin hors démo.
// l'album entier ou morceau par morceau (choix rangé en base, par compte) ; le morceau « vivant » joue dans le lecteur habituel (faux ici), se
// termine seul ou après 2 boucles, et la barre enchaîne le suivant. Même banc d'essai que test_fan_albums_page.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const wait = ms => new Promise(r => setTimeout(r, ms));

const html = fs.readFileSync(path.join(__dirname, 'mes-albums.html'), 'utf-8');
const i18n = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
const notify = fs.readFileSync(path.join(__dirname, 'layerpitch-notify.js'), 'utf-8');
const pageScript = html.match(/<script>\n\(async \(\) => \{[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, '');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));

check('page non indexée', /<meta name="robots" content="noindex, nofollow">/.test(html));
check('styles du lecteur partagés (player.css)', /<link rel="stylesheet" href="player\.css\?v=/.test(html) && fs.existsSync(path.join(__dirname, 'player.css')));
check('le prototype du 25/09 a disparu', !fs.existsSync(path.join(__dirname, 'prototype-lecteur-album.html')));

const take = (trackId, duration) => ({ v: 1, kind: 'layerpitch-take', trackId, duration, voices: [{ url: 'x.ogg' }], sfx: [], missing: 0 });

function makeWindow({ url, session, isAdmin }) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${body}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false });
  w.LayerPitchAppearance = { getTheme: () => 'light', setTheme() {} }; // apparence commune (layerpitch-appearance.js)
  w.CSS = { escape: s => String(s).replace(/"/g, '\\"') };
  const state = { plays: [], stops: 0, liveTakes: {}, atelierStops: [], inited: [], started: [], stopped: [], rows: {} };
  w.LayerPlayerCore = {
    escapeHtml: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    setTakeRecording: on => { state.recording = on; },
    setSfxLibrary: () => {},
    buildTrackRow: t => { const d = w.document.createElement('div'); d.className = 'track'; d.dataset.track = t.id; return d; },
    initTrackPlayer: (t, row) => { state.inited.push(t); row.lpControl = { _end: null, _on: false, start(l) { this._on = true; state.started.push(t.id); }, stop() { this._on = false; state.stopped.push(t.id); }, isPlaying() { return this._on; }, onEnded(cb) { this._end = cb; }, elapsed: () => state.liveClock || 0 }; state.rows[t.id] = row; },
    getTrackTake: id => state.liveTakes[id] || null,
  };
  // Faux moteur de lecture des prises : horloge manuelle (state.clock), fin déclenchée à la main (state.end()).
  w.LayerCaptureRender = {
    playTake: async (tk, opts) => {
      const p = { take: tk, from: opts.from || 0, stopped: false };
      state.plays.push(p); state.end = () => opts.onEnd();
      return { stop() { p.stopped = true; state.stops++; }, position: () => p.from + (state.clock || 0), duration: tk.duration };
    },
  };
  // Téléchargement (A.8) : rendu et encodages simulés ; le fichier « enregistré » est capturé.
  Object.assign(w.LayerCaptureRender, {
    renderTake: async tk => { state.rendered = tk; return { fake: true }; },
    encodeWav: () => new Uint8Array([1, 2, 3]),
    encodeMp3: async (buf, o) => { state.mp3Opts = o; o.onProgress(0.5); return new Uint8Array([4, 5]); },
  });
  w.lamejs = {};
  w.URL.createObjectURL = b => { state.blob = b; return 'blob:x'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { state.saved = this.download; };
  w.LayerPitchTracks = { getTrack: async id => ({ track: { id, title: 'Titre ' + id, sfxIds: [], mode: 'static', duration: 30 } }) };
  w.LayerPitchSfx = { getSfx: async () => null };
  w.LayerPitchAuth = { getSession: async () => ({ session }) };
  w.LayerPitchSupabaseClient = { getClient: () => ({ rpc: async () => ({ data: isAdmin }) }) };
  w.document.addEventListener('stop-track', e => state.atelierStops.push(e.detail));
  w.eval(i18n);
  w.eval(notify);
  w.eval(pageScript);
  return { w, state, $: id => w.document.getElementById(id) };
}

(async () => {
  localStorage_reset();
  const url = 'http://localhost:8420/mes-albums.html?demo=1&ids=t1,t2,t3&official=t1,t2,t3';
  // ---- Sans l'accord du compositeur : aucun dé ----
  {
    const { w, $ } = makeWindow({ url, session: null, isAdmin: false });
    await wait(50);
    check('album non autorisé : aucun dé (album ni morceaux)', !w.document.getElementById('albumDiceBtn') && !w.document.querySelector('[data-dice]'));
  }
  // ---- Album autorisé ----
  const { w, state, $ } = makeWindow({ url: url + '&random=1', session: null, isAdmin: false });
  await wait(50);
  const doc = w.document;
  check('album autorisé : un dé pour l\'album et un par morceau', !!$('albumDiceBtn') && doc.querySelectorAll('[data-dice]').length === 3);
  check('dés éteints au départ', $('albumDiceBtn').getAttribute('aria-pressed') === 'false' && doc.querySelector('[data-dice="t1"]').getAttribute('aria-pressed') === 'false');

  // Lecture sans dé : version du compositeur
  $('playAlbumBtn').click(); await wait(30);
  check('sans dé : la barre joue la version figée du compositeur', state.plays.length === 1 && state.started.length === 0);
  $('playBtn').click(); await wait(10); // pause

  // Dé d'album : tous les morceaux vivants
  $('albumDiceBtn').click(); await wait(10);
  check('dé d\'album allumé : tous les morceaux le sont', doc.querySelectorAll('[data-dice][aria-pressed="true"]').length === 3);
  check('le sous-titre annonce l\'écoute aléatoire', /Aléatoire à chaque écoute/.test(doc.querySelector('.tracks tbody tr').textContent));
  check('morceau aléatoire : pas de menu de version, ni ajout à une playlist', !doc.querySelector('[data-choice="t1"]') && doc.querySelector('[data-add-track="t1"]').disabled);
  state.plays.length = 0;
  $('playAlbumBtn').click(); await wait(40);
  check('la barre lance le morceau VIVANT du 1er morceau (pas de prise figée)', state.started.join() === 't1' && state.plays.length === 0);
  check('le lecteur vivant reçoit des limites de boucles (2) sans toucher au morceau de l\'Atelier', (l => l.maxLoops === 2 && l.maxChainLoops === 2)(state.inited[state.inited.length - 1]) && state.inited[0].maxLoops == null);
  check('titre en cours : le morceau', /Titre t1/.test($('nowTitle').textContent));

  // Fin naturelle -> morceau suivant
  state.rows.t1.lpControl._end(); await wait(40);
  check('fin naturelle du 1er : la barre enchaîne le 2e (vivant aussi)', state.started.join() === 't1,t2' && /Titre t2/.test($('nowTitle').textContent));
  // Pause = arrêt (pas de fin naturelle), reprise = nouveau tirage
  $('playBtn').click(); await wait(20);
  check('pause : le morceau vivant est arrêté, la file n\'avance pas', state.stopped.includes('t2') && /Titre t2/.test($('nowTitle').textContent));
  $('playBtn').click(); await wait(40);
  check('reprise : nouveau tirage depuis le début (le morceau repart)', state.started.join() === 't1,t2,t2');
  // Suivant / précédent
  $('nextBtn').click(); await wait(40);
  check('Suivant : le 3e, vivant', state.started[state.started.length - 1] === 't3');
  // Recherche inopérante sur un morceau tiré au hasard
  const before = state.started.length;
  $('progTrack').click(); await wait(20);
  check('cliquer sur la barre de progression ne relance rien', state.started.length === before);

  // Surcharge par morceau : t1 éteint -> version figée pour lui seul
  doc.querySelector('[data-dice="t1"]').click(); await wait(10);
  check('dé du morceau éteint : seul lui repasse en version figée', doc.querySelector('[data-dice="t1"]').getAttribute('aria-pressed') === 'false' && doc.querySelector('[data-dice="t2"]').getAttribute('aria-pressed') === 'true' && /Version du compositeur/.test(doc.querySelector('.tracks tbody tr').textContent));
  check('… et son menu de versions revient', !!doc.querySelector('[data-choice="t1"]'));
  state.plays.length = 0; state.started.length = 0;
  doc.querySelector('[data-play="t1"]').click(); await wait(40);
  check('lancer t1 : prise figée du compositeur, pas de morceau vivant', state.plays.length >= 1 && state.started.length === 0);

  // Le choix est gardé sur l'ordinateur
  const saved = w.__lpDemoPrefs.demo;
  check('choix enregistré côté « base » (dé de l\'album allumé, t1 éteint) -- plus rien dans le navigateur', saved && saved.dice === true && saved.tracks.t1 === 'off' && !w.localStorage.getItem('lp_dice'));
  // L'Atelier ne pause pas la barre quand c'est le morceau vivant de la barre lui-même qui démarre ; il la pause sinon
  doc.querySelector('[data-dice="t1"]').click(); await wait(10); // t1 de nouveau vivant
  state.started.length = 0;
  doc.querySelector('[data-play="t1"]').click(); await wait(40);
  w.document.dispatchEvent(new w.CustomEvent('layerpitch-capture-mark', { detail: { name: 'track_play', detail: { trackId: 't1' } } }));
  await wait(10);
  check('le démarrage du morceau vivant de la barre ne la met pas en pause', state.rows.t1.lpControl._on === true);
  w.document.dispatchEvent(new w.CustomEvent('layerpitch-capture-mark', { detail: { name: 'track_play', detail: { trackId: 'autre' } } }));
  await wait(20);
  check('un autre morceau (l\'Atelier) lancé : la barre se met en pause', state.rows.t1.lpControl._on === false);

  console.log(failures ? failures + ' échec(s)' : 'Tout est vert');
  process.exit(failures ? 1 : 0);
})();
function localStorage_reset() { /* chaque fenêtre jsdom a son propre stockage */ }
