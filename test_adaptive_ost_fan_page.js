const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Chantier Adaptive OST — vérifie la page fan (mes-adaptive-ost.html) de bout en bout contre un
// faux backend en mémoire (mêmes règles que les RPC Postgres réelles, déjà vérifiées séparément
// contre une vraie instance) : créer une playlist, ajouter/retirer une piste, régler le mix,
// Figer, renommer, supprimer. Le script inline de la page est extrait du HTML et évalué dans le
// même jsdom que layerpitch-i18n.js/player.js, avec window.LayerPitchAuth/Playlists/Tracks
// remplacés par ce faux backend — pas de SDK Supabase ni d'appel réseau réel.

(async () => {
  const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
  const playerSrc = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const pageHtml = fs.readFileSync(path.join(__dirname, 'mes-adaptive-ost.html'), 'utf-8');
  const inlineScriptMatch = pageHtml.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
  if (!inlineScriptMatch) throw new Error('Script inline introuvable dans mes-adaptive-ost.html');
  const pageScript = inlineScriptMatch[1];

  // ---- Faux backend en mémoire : mêmes règles que les RPC réelles (ownership déjà vérifié contre
  // Postgres séparément, voir supabase/migrations/20260910120100_playlists_schema.sql). ----
  const db = { playlists: [], nextId: 1 };
  function newId() { return 'pl' + (db.nextId++); }
  function findPlaylist(id) { return db.playlists.find(p => p.id === id); }

  const fakeAuth = {
    async getSession() { return { session: { user: { email: 'fan@test.com' } } }; },
    onAuthStateChange(cb) { cb(); return () => {}; },
    async signInWithMagicLink() { return { ok: true, error: null }; },
    async verifyEmailOtp() { return { ok: true, error: null }; },
  };

  const OWNED_TRACK_IDS = ['t1', 't2'];
  const fakePlaylists = {
    async myAlbumPurchases() {
      return { purchases: [{ purchaseId: 'pu1', albumId: 'alb1', album: { id: 'alb1', title: 'OST du jeu', illustration: null, trackIds: OWNED_TRACK_IDS } }], error: null };
    },
    async myPlaylists() {
      return {
        playlists: db.playlists.map(p => ({
          id: p.id, name: p.name, tracks: p.tracks.map(t => ({ trackId: t.trackId, position: t.position, settings: t.settings })),
        })),
        error: null,
      };
    },
    async createPlaylist(name) {
      const id = newId();
      db.playlists.push({ id, name, tracks: [] });
      return { playlistId: id, error: null };
    },
    async renamePlaylist(id, name) {
      const p = findPlaylist(id);
      if (!p) return { ok: false, error: 'introuvable' };
      p.name = name;
      return { ok: true, error: null };
    },
    async deletePlaylist(id) {
      const idx = db.playlists.findIndex(p => p.id === id);
      if (idx < 0) return { ok: false, error: 'introuvable' };
      db.playlists.splice(idx, 1);
      return { ok: true, error: null };
    },
    async addTrackToPlaylist(id, trackId) {
      const p = findPlaylist(id);
      if (!p) return { ok: false, error: 'introuvable' };
      if (!OWNED_TRACK_IDS.includes(trackId)) return { ok: false, error: 'Non autorisé : piste non possédée' };
      if (p.tracks.some(t => t.trackId === trackId)) return { ok: true, error: null };
      p.tracks.push({ trackId, position: p.tracks.length, settings: {} });
      return { ok: true, error: null };
    },
    async removeTrackFromPlaylist(id, trackId) {
      const p = findPlaylist(id);
      if (!p) return { ok: false, error: 'introuvable' };
      p.tracks = p.tracks.filter(t => t.trackId !== trackId);
      return { ok: true, error: null };
    },
    async setPlaylistTrackSettings(id, trackId, settings) {
      const p = findPlaylist(id);
      const t = p && p.tracks.find(t => t.trackId === trackId);
      if (!t) return { ok: false, error: 'introuvable' };
      t.settings = settings;
      return { ok: true, error: null };
    },
    async reorderPlaylistTracks() { return { ok: true, error: null }; },
    async freezePlaylist(id, name) {
      const p = findPlaylist(id);
      if (!p) return { ok: false, error: 'introuvable' };
      p.freezes = p.freezes || [];
      const freeze = { id: 'fz' + p.freezes.length, name: name || '', snapshot: JSON.parse(JSON.stringify(p.tracks)), createdAt: new Date().toISOString() };
      p.freezes.push(freeze);
      return { freezeId: freeze.id, error: null };
    },
    async listPlaylistFreezes(id) {
      const p = findPlaylist(id);
      return { freezes: (p && p.freezes) || [], error: null };
    },
  };

  function fakeFile(name) { return { name, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }; }
  const TRACKS_BY_ID = {
    t1: { id: 't1', title: 'Combat', mode: 'vertical', description: '', duration: 0, base: '', publishedAt: 1, layers: [{ label: 'L1', localFile: fakeFile('l1.wav') }, { label: 'L2', localFile: fakeFile('l2.wav') }], sfxIds: [] },
    t2: { id: 't2', title: 'Exploration', mode: 'vertical', description: '', duration: 0, base: '', publishedAt: 1, layers: [{ label: 'L1', localFile: fakeFile('l1.wav') }], sfxIds: [] },
  };
  const fakeTracks = {
    async listTracksByIds(ids) { return { tracks: ids.map(id => TRACKS_BY_ID[id]).filter(Boolean), error: null }; },
  };

  const html = `<!DOCTYPE html><html><body><div class="page"><div id="content"></div></div>
  <script>${i18nSrc}</script>
  <script>${playerSrc}</script>
  </body></html>`;

  const dom = new JSDOM(html, {
    url: 'http://localhost/mes-adaptive-ost.html',
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
      win.confirm = () => true;
      win.alert = (msg) => { win.__lastAlert = msg; };
      win.LayerPitchAuth = fakeAuth;
      win.LayerPitchPlaylists = fakePlaylists;
      win.LayerPitchTracks = fakeTracks;
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

  // Évalue le script de la page DANS ce même jsdom (mêmes globals que les <script src> déjà
  // chargés), maintenant que les stubs sont posés.
  window.eval(pageScript);
  await sleep(200);

  const content = doc.getElementById('content');
  check('état initial : aucune playlist affichée', content.textContent.includes('Aucune playlist pour l\'instant'));
  check('état initial : l\'Adaptive OST possédée est listée', content.textContent.includes('OST du jeu'));

  // ---- créer une playlist (se déplie automatiquement) ----
  doc.getElementById('newPlaylistName').value = 'Ma tournée';
  submit(doc.getElementById('newPlaylistForm'));
  await sleep(150);
  check('playlist créée et affichée', content.textContent.includes('Ma tournée'));
  check('playlist créée : dépliée automatiquement (formulaire d\'ajout de piste visible)', !!doc.querySelector('[data-add-track-playlist]'));

  const playlistId = db.playlists[0].id;

  // ---- ajouter une piste possédée ----
  let addForm = doc.querySelector('[data-add-track-playlist]');
  addForm.querySelector('select').value = 't1';
  submit(addForm);
  await sleep(200);
  check('piste ajoutée : présente en base', db.playlists[0].tracks.some(t => t.trackId === 't1'));
  check('piste ajoutée : rendue via player.js (buildTrackRow)', !!doc.querySelector('.track-row'));
  check('piste ajoutée : bouton retirer présent', !!doc.querySelector('.remove-track-row button'));

  // ---- régler le mix (mute une voix), puis Figer ----
  const muteBtn = doc.querySelector('[data-voice-action="mute"][data-voice-key="layer-0"]');
  check('bouton mute trouvé sur la piste rendue', !!muteBtn);
  if (muteBtn) click(muteBtn);
  await sleep(50);
  check('mute appliqué visuellement', muteBtn.classList.contains('active'));

  const freezeForm = doc.querySelector('[data-freeze-playlist]');
  submit(freezeForm);
  await sleep(150);
  check('Figer : une version enregistrée en base', (db.playlists[0].freezes || []).length === 1);
  check('Figer : le snapshot capture bien la voix muette réglée juste avant', !!(db.playlists[0].freezes && db.playlists[0].freezes[0].snapshot.find(t => t.trackId === 't1').settings.mutedVoices.includes('layer-0')));
  check('historique des versions affiché après Figer', content.textContent.includes('(sans nom)') || /\d{4}/.test(content.textContent));

  // ---- retirer la piste ----
  const removeBtn = doc.querySelector('.remove-track-row button');
  click(removeBtn);
  await sleep(200);
  check('piste retirée : plus en base', !db.playlists[0].tracks.some(t => t.trackId === 't1'));
  check('piste retirée : le picker la propose à nouveau', !!doc.querySelector('option[value="t1"]'));

  // ---- renommer ----
  const renameBtn = doc.querySelector('[data-rename-playlist]');
  click(renameBtn);
  await sleep(20);
  const renameForm = doc.querySelector('[data-rename-form]');
  check('formulaire de renommage révélé au clic', !renameForm.hidden);
  renameForm.querySelector('input').value = 'Playlist renommée';
  submit(renameForm);
  await sleep(150);
  check('renommage : reflété en base', db.playlists[0].name === 'Playlist renommée');
  check('renommage : reflété dans le DOM', content.textContent.includes('Playlist renommée'));

  // ---- supprimer (confirm() stubbé à true) ----
  const deleteBtn = doc.querySelector('[data-delete-playlist]');
  click(deleteBtn);
  await sleep(150);
  check('suppression : plus aucune playlist en base', db.playlists.length === 0);
  check('suppression : reflétée dans le DOM', content.textContent.includes('Aucune playlist pour l\'instant'));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
