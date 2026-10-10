// Notification d'une demande d'accès à la bêta (10/10) : la cloche commune montre les demandes en attente (admin), avec un lien vers le
// panneau admin, famille « Accès et invitations » ; rien pour un compte ordinaire (la fonction renvoie une liste vide).
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  async function inbox(accessRpc, lang) {
    const dom = new JSDOM('<div id="lpBellHost"></div>', { url: 'https://beta.layerpitch.com/projets.html' + (lang === 'en' ? '?lang=en' : ''), runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    w.eval(read('layerpitch-i18n.js'));
    const q = () => { const o = { select: () => o, order: () => o, limit: () => o, then: res => res({ data: [], error: null }) }; return o; };
    w.LayerPitchSupabaseClient = { getClient: () => ({ from: q, rpc: name => Promise.resolve(name === 'get_pending_access_requests' ? accessRpc : { data: [], error: null }) }) };
    w.LayerPitchAuth = { getSession: () => Promise.resolve({ session: { user: { id: 'u1' } } }) };
    const toasts = []; w.LayerPitchNotify = { info: m => toasts.push(m), success() {}, error() {} };
    w.eval(read('layerpitch-shell.js'));
    let got = null; w.LayerPitchShell.onInbox(l => { got = l; });
    w.LayerPitchShell.startInbox(); await wait(150);
    return { items: got || [], w, toasts };
  }
  const one = await inbox({ data: [{ id: 5, email: 'nouveau@x.test', source: 'landing', intent: 'beta', created_at: '2026-10-10T10:00:00Z', message: 'Je compose pour des jeux.' }], error: null });
  const it = one.items.find(x => x.kind === 'access');
  check('une demande en attente : un élément de cloche', !!it);
  check('titre : l\'e-mail du demandeur', !!it && /nouveau@x\.test/.test(it.title));
  check('texte : son message', !!it && /Je compose pour des jeux/.test(it.text));
  check('un clic mène au panneau admin, famille « Accès et invitations »', !!it && it.href === 'admin.html?section=access');
  check('compté comme non lu', !!it && it.unread === true);
  const many = await inbox({ data: [{ id: 5, email: 'a@x.test', created_at: '2026-10-10T10:00:00Z' }, { id: 9, email: 'b@x.test', created_at: '2026-10-10T11:00:00Z' }], error: null });
  const im = many.items.find(x => x.kind === 'access');
  check('plusieurs demandes : un seul élément, avec le nombre et la dernière', !!im && /2 demandes/.test(im.title) && /b@x\.test/.test(im.text));
  check('la clé change à chaque nouvelle demande (donc le bandeau d\'arrivée s\'affiche)', !!im && im.key !== it.key && /^access:9:2$/.test(im.key));
  const none = await inbox({ data: [], error: null });
  check('aucune demande (ou compte non admin) : rien', !none.items.some(x => x.kind === 'access'));
  const missing = await inbox({ data: null, error: { message: 'function not found' } });
  check('fonction indisponible : la cloche marche quand même', !missing.items.some(x => x.kind === 'access'));
  const en = await inbox({ data: [{ id: 1, email: 'z@x.test', created_at: '2026-10-10T10:00:00Z' }], error: null }, 'en');
  check('en anglais : libellé anglais', /Beta access request/.test((en.items.find(x => x.kind === 'access') || {}).title || ''));

  // admin.html : ?section=access ouvre la bonne famille
  const html = read('admin.html'), inline = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].pop()[1];
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), { url: 'https://beta.layerpitch.com/admin.html?section=access', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(read('layerpitch-i18n.js'));
  w.LayerPitchSupabaseClient = { getClient: () => ({ rpc: async () => ({ data: [], error: null }), from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) }) };
  w.LayerPitchAuth = { onAuthStateChange() {}, signOut: async () => {}, signInWithMagicLink: async () => ({}) };
  w.LayerPitchNotify = { success() {}, info() {}, error() {}, confirm: async () => true };
  w.eval(inline);
  const visible = [...w.document.querySelectorAll('.admin-main section[data-section]')].filter(s => !s.hidden).map(s => s.dataset.section);
  check('panneau admin : ?section=access ouvre « Accès et invitations »', visible.join() === 'access');
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon');
  process.exit(failures ? 1 : 0);
})();
