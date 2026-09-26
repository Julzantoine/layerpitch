// Page fan des Adaptive OST (mes-albums.html, étape A.5, 26/09) : fait tourner le vrai script de la page dans jsdom, en
// mode démo local (versions en mémoire), avec un faux lecteur et un faux moteur de lecture des prises (aucun son, aucune
// base). Vérifie : Figer garde la prise en cours, les playlists (créer, renommer, ajouter une version depuis Morceaux ou
// l'Atelier, « Nouvelle playlist… », écouter, réordonner, retirer, suppression en cascade d'une version, supprimer), la version jouée dans l'album (choix du fan, sinon celle du compositeur,
// sinon la plus récente du fan), un morceau sans version sauté, pause / reprise à la même position, enchaînement, l'atelier
// qui coupe la barre, renommer, supprimer (confirmation dans l'interface), et le verrou admin hors démo.
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
  w.CSS = { escape: s => String(s).replace(/"/g, '\\"') };
  const state = { plays: [], stops: 0, liveTakes: {}, atelierStops: [] };
  w.LayerPlayerCore = {
    escapeHtml: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    setTakeRecording: on => { state.recording = on; },
    setSfxLibrary: () => {},
    buildTrackRow: t => { const d = w.document.createElement('div'); d.className = 'track'; d.dataset.track = t.id; return d; },
    initTrackPlayer: () => {},
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
  w.LayerPitchTracks = { getTrack: async id => ({ track: { id, title: 'Titre ' + id, sfxIds: [] } }) };
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
  // ---- Verrou : hors démo, connexion puis admin ----
  {
    const { $ } = makeWindow({ url: 'https://beta.layerpitch.com/mes-albums.html', session: null, isAdmin: false });
    await wait(30);
    check('non connecté : invitation à se connecter', /Connecte-toi/.test($('center').textContent) && $('bar').hidden);
  }
  {
    const { $ } = makeWindow({ url: 'https://beta.layerpitch.com/mes-albums.html', session: { user: { id: 'u' } }, isAdmin: false });
    await wait(30);
    check('connecté non admin : page refusée', /réservée à l’administrateur/.test($('center').textContent));
  }
  {
    const { $ } = makeWindow({ url: 'https://beta.layerpitch.com/mes-albums.html?demo=1&ids=t1', session: null, isAdmin: false });
    await wait(30);
    check('mode démo ignoré hors localhost', /Connecte-toi/.test($('center').textContent));
  }

  // ---- Démo locale : trois morceaux ----
  const { w, state, $ } = makeWindow({ url: 'http://localhost:8420/mes-albums.html?demo=1&ids=t1,t2,t3&official=t1', session: null, isAdmin: false });
  await wait(50);
  const doc = w.document;
  const rowsText = () => [...doc.querySelectorAll('.tracks tbody tr')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
  check('enregistrement de l’atelier activé en permanence', state.recording === true);
  check('album ouvert : t1 a la version du compositeur, t2 et t3 aucune', rowsText().length === 3 && /Version du compositeur/.test(rowsText()[0]) && /Pas encore de version/.test(rowsText()[1]) && /Pas encore de version/.test(rowsText()[2]));

  // Figer dans l'atelier (t1), deux fois ; la version du compositeur s'enregistre dans le Backstage, jamais ici
  $('tabAtelier').click();
  check('aucun bouton « version de l’album » sur la page fan', !$('officialBtn'));
  check('onglet Atelier affiché, lecteur vivant du 1er morceau', !$('panelAtelier').hidden && doc.querySelector('#atelierPlayer .track').dataset.track === 't1');
  $('freezeBtn').click(); await wait(10);
  check('Figer sans écoute : message', /Rien à figer/.test($('freezeMsg').textContent));
  state.liveTakes.t1 = take('t1', 30);
  $('freezeName').value = 'Calme';
  $('freezeBtn').click(); await wait(20);
  state.liveTakes.t1 = take('t1', 45);
  $('freezeBtn').click(); await wait(20);
  const vnames = () => [...doc.querySelectorAll('#atelierVersions .v-row .v-name')].map(e => e.textContent.trim());
  check('compositeur puis deux versions, la plus récente d’abord, sans nom = « Version 2 »', JSON.stringify(vnames().slice(1)) === JSON.stringify(['Version 2', 'Calme']));
  check('le lecteur vivant n’est pas reconstruit après Figer', doc.querySelectorAll('#atelierPlayer .track').length === 1);
  check('version du compositeur en tête et jouée par défut', /Version du compositeur/.test(vnames()[0]) && /Jouée dans l’album/.test(doc.querySelector('#atelierVersions .v-row').textContent));

  // Atelier sur t3, une version
  doc.querySelector('[data-pick="t3"]').click();
  check('changer de morceau arrête le précédent', state.atelierStops.includes('t1') && doc.querySelector('#atelierPlayer .track').dataset.track === 't3');
  state.liveTakes.t3 = take('t3', 20);
  $('freezeBtn').click(); await wait(20);
  check('sans version du compositeur, l’album joue la plus récente du fan', /Jouée dans l’album/.test(doc.querySelector('#atelierVersions .v-row').textContent));

  // Morceaux : t2 sauté ; choix d'une version pour t1
  $('tabTracks').click();
  const r = rowsText();
  check('t1 : version du compositeur ; t2 : sauté ; t3 : version du fan', /Version du compositeur/.test(r[0]) && /Pas encore de version/.test(r[1]) && /Version 1/.test(r[2]));
  const sel = doc.querySelector('[data-choice="t1"]');
  check('menu de t1 : compositeur + 2 versions', sel.options.length === 3);
  sel.value = [...sel.options].find(o => /Calme/.test(o.text)).value; sel.dispatchEvent(new w.Event('change')); await wait(20);
  check('choix mémorisé : t1 joue « Calme »', /Calme/.test(rowsText()[0]));

  // Écouter l'album : t1 (Calme, 30 s) puis t3, t2 sauté
  $('playAlbumBtn').click(); await wait(20);
  check('barre : t1 « Calme » en lecture', state.plays.length === 1 && state.plays[0].take.duration === 30 && $('nowSub').textContent === 'Calme');
  check('la barre coupe l’atelier', state.atelierStops.filter(x => x === 't3').length >= 1);
  state.clock = 12;
  $('playBtn').click(); // pause
  check('pause : lecture arrêtée', state.plays[0].stopped && $('playBtn').getAttribute('aria-label') === 'Lecture');
  state.clock = 0;
  $('playBtn').click(); await wait(20); // reprise
  check('reprise à la même position (12 s)', state.plays[1].from === 12 && state.plays[1].take.duration === 30);
  state.end(); await wait(20);
  check('enchaîne sur t3 (t2 sans version sauté)', state.plays[2].take.trackId === 't3' && $('nowTitle').textContent === 'Titre t3');
  check('bouton suivant désactivé sur le dernier', $('nextBtn').disabled);
  state.end(); await wait(20);
  check('fin de l’album', $('nowSub').textContent === 'Fin de l’album');

  // L'atelier qui démarre met la barre en pause
  $('playAlbumBtn').click(); await wait(20);
  const before = state.stops;
  doc.dispatchEvent(new w.CustomEvent('layerpitch-capture-mark', { detail: { name: 'track_play', detail: { trackId: 't3' } } }));
  check('l’atelier démarre : la barre se met en pause', state.stops === before + 1 && $('playBtn').getAttribute('aria-label') === 'Lecture');

  // Renommer puis supprimer (confirmation dans l'interface) une version de t1
  $('tabAtelier').click();
  doc.querySelector('[data-pick="t1"]').click();
  const target = [...doc.querySelectorAll('#atelierVersions .v-row')].find(rw => /Version 2/.test(rw.textContent));
  target.querySelector('[data-vrename]').click();
  const input = doc.querySelector('.v-name input');
  input.value = 'Énergique';
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' })); await wait(20);
  check('renommer', vnames().includes('Énergique') && !vnames().includes('Version 2'));
  [...doc.querySelectorAll('#atelierVersions .v-row')].find(rw => /Énergique/.test(rw.textContent)).querySelector('[data-vdel]').click();
  await wait(10);
  const overlay = doc.getElementById('lpConfirmOverlay');
  check('confirmation dans l’interface (pas de confirm natif)', !!overlay);
  const btns = [...overlay.querySelectorAll('button')];
  btns[btns.length - 1].click(); await wait(30);
  check('version supprimée', !vnames().includes('Énergique') && vnames().some(n => /Calme/.test(n)));

  // ---- Playlists (26/09) : une entrée = une version précise, morceaux de tous les albums ----
  const plNames = () => [...doc.querySelectorAll('#plList .lib-item-title')].map(e => e.textContent);
  check('aucune playlist au départ', plNames().length === 0);
  $('newPlaylistBtn').click(); await wait(30);
  check('« + Nouvelle playlist » : créée, ouverte, titre en saisie', plNames().join() === 'Ma playlist 1' && /Playlist/.test($('center').textContent) && !!doc.querySelector('.pl-title-input'));
  const titleInput = doc.querySelector('.pl-title-input');
  titleInput.value = 'Pour bosser';
  titleInput.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' })); await wait(30);
  check('renommer la playlist', plNames().join() === 'Pour bosser' && $('plTitle').textContent === 'Pour bosser');
  check('playlist vide : message, lecture désactivée', /Cette playlist est vide/.test($('center').textContent) && $('playPlaylistBtn').disabled);

  // Retour à l'album ; « + » sur t1 (joue « Calme » dans l'album) -> Pour bosser
  doc.querySelector('#lib [data-album]').click(); await wait(30);
  $('tabTracks').click();
  doc.querySelector('[data-add-track="t1"]').click(); await wait(10);
  const menu = () => doc.getElementById('plMenu');
  check('menu « Ajouter à une playlist » : la playlist + « Nouvelle playlist… »', !!menu() && /Pour bosser/.test(menu().textContent) && /Nouvelle playlist/.test(menu().textContent));
  [...menu().querySelectorAll('[data-to]')].find(b => b.dataset.to).click(); await wait(30);
  check('ajouté : menu fermé, confirmation, compteur « 1 morceau »', !menu() && /Ajouté à « Pour bosser »/.test(doc.body.textContent) && /1 morceau/.test($('plList').textContent));
  check('morceau sans version : « + » désactivé', doc.querySelector('[data-add-track="t2"]').disabled);
  // Atelier de t1 : la version du compositeur -> Nouvelle playlist… (créée avec ce morceau)
  $('tabAtelier').click();
  doc.querySelector('[data-pick="t1"]').click();
  doc.querySelector('[data-vadd="official"]').click(); await wait(10);
  menu().querySelector('[data-to=""]').click(); await wait(40);
  check('« Nouvelle playlist… » : créée avec le morceau dedans', plNames().join() === 'Pour bosser,Ma playlist 2' && /Ajouté à « Ma playlist 2 »/.test(doc.body.textContent));
  // t3 (Version 1) et la version du compositeur de t1 -> Pour bosser
  doc.querySelector('[data-pick="t3"]').click();
  doc.querySelector('#atelierVersions [data-vadd]').click(); await wait(10);
  [...menu().querySelectorAll('[data-to]')].find(b => /Pour bosser/.test(b.textContent)).click(); await wait(30);
  doc.querySelector('[data-pick="t1"]').click();
  doc.querySelector('[data-vadd="official"]').click(); await wait(10);
  [...menu().querySelectorAll('[data-to]')].find(b => /Pour bosser/.test(b.textContent)).click(); await wait(30);

  // Vue playlist : 3 entrées dans l'ordre d'ajout, avec album et version
  [...doc.querySelectorAll('#plList [data-playlist]')].find(b => /Pour bosser/.test(b.textContent)).click(); await wait(40);
  const plRows = () => [...doc.querySelectorAll('.tracks tbody tr')].map(r => r.querySelector('.t-sub').textContent);
  check('playlist : Calme, Version 1, compositeur (deux versions du même morceau)', JSON.stringify(plRows()) === JSON.stringify(['Album de démonstration · Calme', 'Album de démonstration · Version 1', 'Album de démonstration · Version du compositeur']));
  check('durée totale affichée (30 + 20 + 21 s = 1:11)', /3 morceaux · 1:11/.test($('center').textContent));
  // Écouter la playlist : enchaîne ses versions, puis fin
  const before2 = state.plays.length;
  $('playPlaylistBtn').click(); await wait(30);
  check('lecture de la playlist : 1re entrée (Calme, 30 s)', state.plays.length === before2 + 1 && state.plays[before2].take.duration === 30 && doc.querySelector('.tracks tbody tr').classList.contains('playing'));
  state.end(); await wait(20); state.end(); await wait(20);
  check('enchaînement : 3e entrée = version du compositeur de t1', state.plays[state.plays.length - 1].take.duration === 21);
  state.end(); await wait(20);
  check('fin de la playlist', $('nowSub').textContent === 'Fin de l’album');
  // Réordonner : descendre la 1re
  doc.querySelector('[data-pl-move][data-dir="1"]').click(); await wait(40);
  check('réordonner : Version 1 passe en tête', plRows()[0] === 'Album de démonstration · Version 1' && plRows()[1] === 'Album de démonstration · Calme');
  check('flèche « Monter » désactivée sur la 1re', doc.querySelector('[data-pl-move][data-dir="-1"]').disabled);
  // Retirer une entrée
  doc.querySelectorAll('[data-pl-remove]')[2].click(); await wait(40);
  check('retirer de la playlist', plRows().length === 2 && /2 morceaux/.test($('plList').textContent));
  // Supprimer la version « Calme » dans l'atelier : elle quitte aussi la playlist
  doc.querySelector('#lib [data-album]').click(); await wait(30);
  $('tabAtelier').click();
  doc.querySelector('[data-pick="t1"]').click();
  [...doc.querySelectorAll('#atelierVersions .v-row')].find(rw => /Calme/.test(rw.textContent)).querySelector('[data-vdel]').click(); await wait(10);
  { const bs = [...doc.getElementById('lpConfirmOverlay').querySelectorAll('button')]; bs[bs.length - 1].click(); } await wait(40);
  check('version supprimée : retirée de la playlist', /1 morceau/.test([...doc.querySelectorAll('#plList .lib-item')].find(b => /Pour bosser/.test(b.textContent)).textContent));
  // Supprimer la playlist
  [...doc.querySelectorAll('#plList [data-playlist]')].find(b => /Pour bosser/.test(b.textContent)).click(); await wait(40);
  $('deletePlaylistBtn').click(); await wait(10);
  check('suppression de playlist : confirmation qui rassure sur les versions', /ne sont pas supprimées/.test(doc.getElementById('lpConfirmOverlay').textContent));
  { const bs = [...doc.getElementById('lpConfirmOverlay').querySelectorAll('button')]; bs[bs.length - 1].click(); } await wait(40);
  check('playlist supprimée, retour à l’album', plNames().join() === 'Ma playlist 2' && /Album de démonstration/.test($('center').querySelector('.album-title').textContent));

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
