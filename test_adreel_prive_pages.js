// AdReel à lien privé côté navigateur (6/10) : page publique (formulaire de mot de passe, lien magique, noindex, secret transmis
// à l'audio protégé) et réglage dans le Backstage. Le serveur est testé par test_adreels_prives.js.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const { loadBackstage } = require('./scripts/test-harness.js');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const tick = () => new Promise(r => setTimeout(r, 0));

  // ---- Page publique : la fonction de index.html, dans une page jetable ----
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const fnSrc = /async function loadPrivateAdReel[\s\S]*?\n}\n\nasync function init\(\)/.exec(html)[0].replace(/\n\nasync function init\(\)$/, '');
  const dom = new JSDOM('<div id="c"></div>', { url: 'https://beta.layerpitch.com/boite-son/corp', runScripts: 'outside-only' });
  const w = dom.window;
  const calls = [];
  w.LayerPitchAdReels = {
    getAdReelAccessMode: async () => ({ mode: w.__mode }),
    getPrivateAdReel: async (o, id, secret) => { calls.push(secret); return secret === 'bon' ? { adReel: { id, accessMode: 'private' } } : { adReel: null, error: 'wrong' }; }
  };
  w.eval(`let pageLang = 'fr'; function tr(k) { return k; } function applyI18n() {} let privateAccessSecret = ''; ${fnSrc}; window.__load = loadPrivateAdReel; window.__setSecret = v => { privateAccessSecret = v; };`);
  const c = w.document.getElementById('c');

  w.__mode = 'public';
  check('AdReel public : pas de passage par la voie privée', (await w.__load('o', 'corp', c)) === null && !w.document.querySelector('meta[name=robots]'));

  w.__mode = 'magic';
  check('lien magique sans jeton : message, aucun contenu', (await w.__load('o', 'corp', c)) === null && /privateAdReelNeedLink/.test(c.innerHTML));
  check('page privée : noindex posé', w.document.querySelector('meta[name=robots]').content === 'noindex');
  w.__setSecret('bon');
  check('lien magique avec le bon jeton : AdReel rendu', (await w.__load('o', 'corp', c)).id === 'corp');
  w.__setSecret('mauvais');
  check('lien magique avec un mauvais jeton : refusé', (await w.__load('o', 'corp', c)) === null);

  w.__mode = 'password'; w.__setSecret('');
  const pending = w.__load('o', 'corp', c);
  await tick();
  const input = c.querySelector('input[type=password]');
  check('mot de passe : formulaire affiché', !!input && !!c.querySelector('form'));
  input.value = 'faux'; c.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  check('mauvais mot de passe : message, formulaire gardé', /privateAdReelWrong/.test(c.innerHTML) && !!c.querySelector('form'));
  input.value = 'bon'; c.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  const got = await pending;
  check('bon mot de passe : AdReel rendu', got && got.id === 'corp');

  // ---- Audio protégé : le secret part avec la demande de liens signés ----
  const audio = fs.readFileSync(path.join(__dirname, 'src/player/02a-audio-protege.js'), 'utf8');
  check('l\'audio protégé joint l\'AdReel privé et son secret', /__lpPrivateAccess/.test(audio) && /body\.adReelId/.test(audio) && /body\.secret/.test(audio));
  check('l\'Edge Function relaie le secret aux deux fonctions de droit', /privateProof/.test(fs.readFileSync(path.join(__dirname, 'supabase/functions/track-audio-url/index.ts'), 'utf8')));
  check('404.html garde le fragment (#k=) à la redirection', /location\.hash/.test(fs.readFileSync(path.join(__dirname, '404.html'), 'utf8')));

  // ---- Backstage ----
  const bs = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const b = bs.window, doc = b.document;
  b.eval(`adReels.push({ id: 'main', label: 'Principal', blocks: [], profile: {}, trackIds: [], accessMode: 'public' }); currentAdReelId = 'main';`);
  const sel = doc.getElementById('appAccessMode');
  check('sélecteur d\'accès présent, public par défaut', !!sel && sel.value === 'public');
  const rpc = [];
  b.loadPostgresReadScripts = async () => {};
  b.LayerPitchAdReels = Object.assign(b.LayerPitchAdReels || {}, { setAdReelAccess: async (id, mode, pw) => { rpc.push([id, mode, pw]); return mode === 'magic' ? { ok: true, mode, token: 'a'.repeat(64) } : { ok: true, mode }; } });
  b.eval(`myEntitlements = Object.assign({}, myEntitlements, { private_links: { allowed: true } }); fillAdReelAccessField(adReels.find(a => a.id === currentAdReelId));`);
  sel.value = 'password'; sel.dispatchEvent(new b.Event('change')); await tick();
  check('mot de passe choisi : rangée affichée, rien d\'envoyé tant que non enregistré', !doc.getElementById('appAccessPasswordRow').hidden && rpc.length === 0);
  doc.getElementById('appAccessPassword').value = 'sesame-2026'; doc.getElementById('btnSaveAccessPassword').click(); await tick(); await tick();
  check('mot de passe enregistré par le serveur', rpc.length === 1 && rpc[0][1] === 'password' && rpc[0][2] === 'sesame-2026');
  sel.value = 'magic'; sel.dispatchEvent(new b.Event('change')); await tick();
  doc.getElementById('btnGenerateMagic').click(); await tick(); await tick();
  const link = doc.getElementById('appAccessMagicLink').value;
  check('lien magique : jeton dans le fragment (#k=), affiché une fois', /#k=a{64}$/.test(link) && !doc.getElementById('appAccessMagicOut').hidden);
  sel.value = 'public'; sel.dispatchEvent(new b.Event('change')); await tick(); await tick();
  check('retour en public envoyé au serveur', rpc[rpc.length - 1][1] === 'public');

  console.log(failures ? failures + ' échec(s)' : 'Tout est vert');
  process.exit(failures ? 1 : 0);
})();
