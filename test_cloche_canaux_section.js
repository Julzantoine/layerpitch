// Cloche commune du site (layerpitch-shell.js) : les canaux de section suivis qui ont du neuf apparaissent, avec un lien vers le canal.
// La fonction my_section_updates est testée côté base par test_projet_sections.js.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function run(sectionRpc) {
    const dom = new JSDOM('<div id="lpBellHost"></div>', { url: 'https://beta.layerpitch.com/projets.html?lang=fr', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    w.eval(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8'));
    const q = () => { const o = { select: () => o, order: () => o, limit: () => o, then: res => res({ data: [], error: null }) }; return o; };
    w.LayerPitchSupabaseClient = { getClient: () => ({ from: q, rpc: name => Promise.resolve(name === 'my_section_updates' ? sectionRpc : name === 'my_project_updates' ? { data: [], error: null } : { data: [], error: null }) }) };
    w.LayerPitchAuth = { getSession: () => Promise.resolve({ session: { user: { id: 'u1' } } }) };
    w.eval(fs.readFileSync(path.join(__dirname, 'layerpitch-shell.js'), 'utf8'));
    let got = null; w.LayerPitchShell.onInbox(l => { got = l; });
    w.LayerPitchShell.startInbox(); await wait(200);
    return got || [];
  }
  const list = await run({ data: [{ projectId: 'p1', title: 'Hollow Manor', sectionId: 's9', sectionTitle: 'Niveau 2', unread: 3, lastMessage: { authorEmail: 'a@x.test', excerpt: 'Tu as vu le plan ?', createdAt: '2026-10-07T10:00:00Z' }, latestAt: '2026-10-07T10:00:00Z' }], error: null });
  const it = list.find(x => /^section:/.test(x.key));
  check('un élément de cloche pour le canal suivi', !!it);
  check('titre : projet, # section et nombre de messages', !!it && /Hollow Manor/.test(it.title) && /# Niveau 2/.test(it.title) && /3 nouveau/.test(it.title));
  check('texte : auteur et dernier message', !!it && /a@x\.test/.test(it.text) && /Tu as vu le plan/.test(it.text));
  check('lien vers le canal', !!it && it.href === 'projet.html?id=p1&channel=s9');
  const none = await run({ data: null, error: { message: 'function not found' } });
  check('fonction absente (migration pas encore appliquée) : la cloche marche quand même', Array.isArray(none) && !none.some(x => /^section:/.test(x.key)));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon');
  process.exit(failures ? 1 : 0);
})();
