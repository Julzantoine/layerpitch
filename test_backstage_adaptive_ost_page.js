const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Chantier Adaptive OST côté studio — vérifie backstage-adaptive-ost.html de bout en bout contre
// un faux backend en mémoire (mêmes règles que les RPC Postgres réelles, déjà vérifiées
// séparément) : créer un album, modifier sa liste de pistes, régler un défaut puis l'enregistrer,
// et le cas "aucun profil compositeur".

(async () => {
  const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
  const playerSrc = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const pageHtml = fs.readFileSync(path.join(__dirname, 'backstage-adaptive-ost.html'), 'utf-8');
  const inlineScriptMatch = pageHtml.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
  if (!inlineScriptMatch) throw new Error('Script inline introuvable dans backstage-adaptive-ost.html');
  const pageScript = inlineScriptMatch[1];

  // ---- Faux backend : mêmes règles que 20260910140000_upsert_album_rpc.sql, déjà vérifiées
  // contre une vraie instance Postgres (préservation de default_settings entre deux
  // sauvegardes, refus des pistes étrangères, etc.) ----
  const COMPOSER_ID = 'composer-1';
  const db = { albums: [] };
  function findAlbum(id) { return db.albums.find(a => a.id === id); }

  const fakeAuth = {
    async getSession() { return { session: { user: { email: 'composer@test.com' } } }; },
    onAuthStateChange(cb) { cb(); return () => {}; },
    async getMyComposerId() { return { composerId: COMPOSER_ID, error: null }; },
    async signInWithMagicLink() { return { ok: true, error: null }; },
    async verifyEmailOtp() { return { ok: true, error: null }; },
  };

  function fakeFile(name) { return { name, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }; }
  const MY_TRACKS = [
    { id: 't1', title: 'Combat', mode: 'vertical', description: '', duration: 0, base: '', publishedAt: 1, layers: [{ label: 'L1', localFile: fakeFile('l1.wav') }, { label: 'L2', localFile: fakeFile('l2.wav') }], sfxIds: [] },
    { id: 't2', title: 'Exploration', mode: 'vertical', description: '', duration: 0, base: '', publishedAt: 1, layers: [{ label: 'L1', localFile: fakeFile('l1.wav') }], sfxIds: [] },
  ];
  const fakeTracks = {
    async listTracks(opts) { return { tracks: opts && opts.ownerId === COMPOSER_ID ? MY_TRACKS : [], error: null }; },
  };

  const fakeAlbums = {
    async myAlbums(ownerId) {
      if (ownerId !== COMPOSER_ID) return { albums: [], error: null };
      return {
        albums: db.albums.map(a => ({
          id: a.id, title: a.title, illustration: null,
          tracks: a.trackIds.map((tid, i) => ({ trackId: tid, position: i, defaultSettings: a.defaultSettings[tid] || {} })),
        })),
        error: null,
      };
    },
    async upsertAlbum(payload) {
      const validIds = new Set(MY_TRACKS.map(t => t.id));
      if ((payload.trackIds || []).some(id => !validIds.has(id))) return { ok: false, error: "Non autorisé : une ou plusieurs pistes n'appartiennent pas à ce compositeur" };
      let album = findAlbum(payload.id);
      if (!album) { album = { id: payload.id, title: '', trackIds: [], defaultSettings: {} }; db.albums.push(album); }
      album.title = payload.title || '';
      album.trackIds = payload.trackIds || [];
      // même règle que la RPC réelle : ne purge que les défauts des pistes qui sortent de l'album.
      Object.keys(album.defaultSettings).forEach(tid => { if (!album.trackIds.includes(tid)) delete album.defaultSettings[tid]; });
      return { ok: true, error: null };
    },
    async setAlbumTrackDefaultSettings(albumId, trackId, settings) {
      const album = findAlbum(albumId);
      if (!album || !album.trackIds.includes(trackId)) return { ok: false, error: 'introuvable' };
      album.defaultSettings[trackId] = settings;
      return { ok: true, error: null };
    },
  };

  const html = `<!DOCTYPE html><html><body><div class="page"><div id="content"></div></div>
  <script>${i18nSrc}</script>
  <script>${playerSrc}</script>
  </body></html>`;

  const dom = new JSDOM(html, {
    url: 'http://localhost/backstage-adaptive-ost.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      const epoch = Date.now();
      function FakeAudioContext() { this.destination = {}; }
      Object.defineProperty(FakeAudioContext.prototype, 'currentTime', { get() { return (Date.now() - epoch) / 1000; } });
      FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
      FakeAudioContext.prototype.createGain = function () {
        return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} };
      };
      FakeAudioContext.prototype.createBufferSource = function () {
        const ctxRef = this;
        const node = {
          buffer: null, onended: null, connect() {},
          stop() { if (node._endTimer) clearTimeout(node._endTimer); if (!node._ended) { node._ended = true; if (node.onended) node.onended(); } },
          start(when) {
            const dur = (node.buffer && node.buffer.duration) || 1;
            const delaySec = Math.max(0, (when - ctxRef.currentTime) + dur);
            node._endTimer = setTimeout(() => { if (!node._ended) { node._ended = true; if (node.onended) node.onended(); } }, delaySec * 1000);
          }
        };
        return node;
      };
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: 2 }); };
      win.AudioContext = FakeAudioContext;
      win.ResizeObserver = win.ResizeObserver || function () { return { observe() {}, disconnect() {} }; };
      win.requestAnimationFrame = win.requestAnimationFrame || (cb => setTimeout(cb, 16));
      win.cancelAnimationFrame = win.cancelAnimationFrame || (id => clearTimeout(id));
      // jsdom n'implémente pas scrollIntoView (contrairement à tout navigateur réel) -- même
      // traitement que ResizeObserver/requestAnimationFrame ci-dessus, pas un vrai bug de page.
      win.Element.prototype.scrollIntoView = win.Element.prototype.scrollIntoView || function () {};
      win.alert = (msg) => { win.__lastAlert = msg; };
      win.LayerPitchAuth = fakeAuth;
      win.LayerPitchTracks = fakeTracks;
      win.LayerPitchAlbums = fakeAlbums;
    }
  });
  const { window } = dom;
  await new Promise(resolve => setTimeout(resolve, 50));
  const doc = window.document;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }
  function submit(form) { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }

  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  window.eval(pageScript);
  await sleep(200);

  const content = doc.getElementById('content');
  check('état initial : aucun album affiché', content.textContent.includes('Aucune Adaptive OST créée'));
  check('état initial : les 2 pistes du compositeur sont proposées dans le formulaire', doc.querySelectorAll('.track-checklist input').length === 2);

  // ---- créer un album avec 1 piste ----
  doc.getElementById('albumTitle').value = 'Mon jeu OST';
  doc.querySelector('.track-checklist input[value="t1"]').checked = true;
  submit(doc.getElementById('albumForm'));
  await sleep(150);
  check('album créé et affiché', content.textContent.includes('Mon jeu OST'));
  check('album créé : 1 piste', db.albums.length === 1 && db.albums[0].trackIds.length === 1);

  // ---- déplier l'album, régler le mix, enregistrer comme défaut ----
  const toggleEl = doc.querySelector('[data-toggle-album]');
  click(toggleEl);
  await sleep(150);
  check('album déplié : la piste est rendue via player.js', !!doc.querySelector('.track-row'));

  const muteBtn = doc.querySelector('[data-voice-action="mute"][data-voice-key="layer-0"]');
  check('bouton mute trouvé', !!muteBtn);
  if (muteBtn) click(muteBtn);
  await sleep(50);

  const saveBtn = doc.querySelector('.remove-track-row button');
  check('bouton "Enregistrer comme défaut" présent', !!saveBtn);
  click(saveBtn);
  await sleep(150);
  check('défaut enregistré en base avec la voix muette réglée juste avant', !!(db.albums[0].defaultSettings.t1 && db.albums[0].defaultSettings.t1.mutedVoices.includes('layer-0')));

  // ---- modifier l'album : ajouter t2, retirer t1 -- le défaut de t1 doit disparaître (règle réelle) ----
  const editBtn = doc.querySelector('[data-edit-album]');
  click(editBtn);
  await sleep(50);
  check('formulaire pré-rempli en mode édition (titre)', doc.getElementById('albumTitle').value === 'Mon jeu OST');
  check('formulaire pré-rempli en mode édition (piste déjà incluse cochée)', doc.querySelector('.track-checklist input[value="t1"]').checked);
  doc.querySelector('.track-checklist input[value="t1"]').checked = false;
  doc.querySelector('.track-checklist input[value="t2"]').checked = true;
  submit(doc.getElementById('albumForm'));
  await sleep(150);
  check('édition : t2 a remplacé t1 dans l\'album', JSON.stringify(db.albums[0].trackIds) === JSON.stringify(['t2']));
  check('édition : le défaut de t1 (retiré de l\'album) a été purgé', !db.albums[0].defaultSettings.t1);

  // ---- refus : un compte sans composer_profile ne voit rien ----
  fakeAuth.getMyComposerId = async () => ({ composerId: null, error: null });
  await window.eval('render()');
  await sleep(150);
  check('sans profil compositeur : message explicite, pas de plantage', content.textContent.includes('Aucun profil compositeur'));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
