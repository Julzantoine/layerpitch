// Panneau admin (10/10) : les demandes d'accès, l'invitation des testeurs, les invitations envoyées, les feux verts et le mode test
// ne sont plus dans le Backstage mais dans admin.html, rangés du général au particulier (navigation à gauche, contenu à droite ; dans
// « Accès et invitations », la demande -> l'invitation -> l'historique, de gauche à droite). La vraie page dans jsdom.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

  // ---- Le Backstage n'a plus ces panneaux
  const backstage = read('layerpitch-backstage.html'), src = read('src/backstage/14-connexion-abonnement-admin.js');
  for (const id of ['panelAccessRequests', 'panelFeatureFlags', 'panelInviteTester', 'panelInvitesSent', 'accessRequestsList', 'featureFlagsList', 'invitesSentList', 'btnInviteTester', 'modeTestToggle']) {
    check('Backstage : plus de « ' + id + ' »', !backstage.includes('id="' + id + '"'));
  }
  check('Backstage : plus de code d\'invitation ni de feux verts', !/renderAccessRequestsList|renderInvitesSentList|toggleFeatureFlag|set_feature_released/.test(backstage));
  check('Backstage : le lien vers le panneau admin reste (réservé aux admins)', backstage.includes('id="panelAdminLink"') && /ADMIN_ONLY_PANEL_IDS = \[[^\]]*'panelAdminLink'/.test(src));
  check('Backstage : le bouton « Recharger depuis la base » reste', backstage.includes('id="btnLoad"'));

  // ---- Le panneau admin
  const html = read('admin.html');
  const inline = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].pop()[1];
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), { url: 'https://beta.layerpitch.com/admin.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, doc = w.document;
  w.eval(read('layerpitch-i18n.js'));
  const calls = { invite: [], rpc: [], marked: [], deletedReq: [], deletedInv: [] };
  let flags = [{ key: 'projects', released: true, description: 'Espace Projet' }, { key: 'level_map', released: false, description: 'Carte de niveau' }];
  const tbl = rows => { const o = { select: () => o, order: () => Promise.resolve({ data: rows, error: null }) }; return o; };
  w.LayerPitchSupabaseClient = { getClient: () => ({ rpc: async (name, args) => { calls.rpc.push([name, args]); if (name === 'set_feature_released') { flags = flags.map(f => f.key === args.p_key ? Object.assign({}, f, { released: args.p_released }) : f); return { data: null, error: null }; } return { data: name === 'is_admin' ? true : [], error: null }; }, from: t => (t === 'feature_flags' ? { select: () => ({ order: async () => ({ data: flags, error: null }) }) } : tbl([])) }) };
  let authCb = null;
  w.LayerPitchAuth = { onAuthStateChange: cb => { authCb = cb; }, signOut: async () => {}, signInWithMagicLink: async () => ({ ok: true }), inviteTester: async (...a) => { calls.invite.push(a); return { ok: true }; }, suspendAccount: async () => ({ ok: true }), reinstateAccount: async () => ({ ok: true }) };
  w.LayerPitchAdmin = { getStats: async () => ({ stats: null }), getGrowthSeries: async () => ({ growth: null }), listAccounts: async () => ({ accounts: [] }), listAdminMessages: async () => ({ messages: [] }), getAdReelsReport: async () => ({ report: [] }) };
  w.LayerPitchAdminReport = { filterRows: r => r, reportHtml: () => '', reportCsv: () => '' };
  let requests = [
    { id: 1, email: 'compo@x.test', source: 'landing', intent: 'beta', created_at: '2026-10-07T08:00:00Z', message: null },
    { id: 2, email: 'studio@x.test', source: 'landing', intent: 'studio', created_at: '2026-10-07T09:00:00Z', message: 'Nous sommes 12.' }];
  w.LayerPitchAccessRequests = { getPendingAccessRequests: async () => ({ requests }), markAccessRequestInvited: async id => { calls.marked.push(id); requests = requests.filter(r => r.id !== id); return { ok: true }; }, deleteAccessRequest: async id => { calls.deletedReq.push(id); requests = requests.filter(r => r.id !== id); return { ok: true }; } };
  let invites = [{ id: 7, email: 'ancien@x.test', lang: 'fr', created_at: '2026-10-01T08:00:00Z', accepted_at: null }];
  w.LayerPitchInvites = { getInvites: async () => ({ invites }), deleteInvite: async id => { calls.deletedInv.push(id); invites = invites.filter(i => i.id !== id); return { ok: true }; } };
  w.LayerPitchNotify = { success() {}, info() {}, error() {}, confirm: async () => true };
  w.Element.prototype.scrollIntoView = () => {};
  w.eval(inline);
  authCb('SIGNED_IN', { user: { email: 'admin@x.test' } });
  await wait(150);

  const nav = [...doc.querySelectorAll('#adminNav [data-section]')];
  check('navigation à gauche : six familles, du général (vue d\'ensemble) au particulier (outils)', nav.map(b => b.dataset.section).join() === 'overview,access,accounts,announce,flags,tools');
  check('une seule famille affichée à la fois', [...doc.querySelectorAll('.admin-main section[data-section]')].filter(s => !s.hidden).length === 1);
  nav.find(b => b.dataset.section === 'access').click();
  const cols = [...doc.querySelectorAll('.access-cols > .card')].map(c => c.id);
  check('« Accès et invitations » : demandes -> invitation -> historique, de gauche à droite', cols.join() === 'panelAccessRequests,panelInviteTester,panelInvitesSent' && !doc.querySelector('[data-section="access"]').hidden);
  check('mémorise la famille choisie', w.localStorage.getItem('layerpitch_admin_section') === 'access');

  // ---- demandes / invitation studio
  const list = doc.getElementById('accessRequestsList').textContent;
  check('liste : la demande du studio est étiquetée « page Studios »', /page Studios/.test(list) && /landing — "Rejoindre la bêta"/.test(list));
  const persona = doc.getElementById('inviteTesterPersona');
  check('formulaire : compositeur par défaut', persona.value === 'composer');
  doc.querySelector('[data-request-id="2"]').click();
  check('« Inviter » sur la demande studio : « Studio » présélectionné, e-mail rempli', persona.value === 'studio' && doc.getElementById('inviteTesterEmail').value === 'studio@x.test');
  doc.getElementById('btnInviteTester').click(); await wait(60);
  check('envoi : lien d\'arrivée avec ?persona=studio', calls.invite.length === 1 && /bienvenue\.html\?lang=fr&persona=studio$/.test(calls.invite[0][1]));
  check('envoi : la demande est rattachée puis marquée traitée', calls.invite[0][3] === 2 && calls.marked.join() === '2');
  check('après l\'envoi : type de compte revenu à « Compositeur », formulaire vidé', persona.value === 'composer' && doc.getElementById('inviteTesterEmail').value === '');
  check('la demande traitée a disparu de la liste', !doc.querySelector('[data-request-id="2"]'));
  doc.getElementById('inviteTesterEmail').value = 'compo@x.test'; doc.getElementById('inviteTesterLang').value = 'en';
  doc.getElementById('btnInviteTester').click(); await wait(60);
  check('invitation compositeur : lien classique, sans persona', calls.invite.length === 2 && /bienvenue\.html\?lang=en$/.test(calls.invite[1][1]));
  doc.querySelector('[data-delete-request-id="1"]').click(); await wait(40);
  check('« Supprimer » écarte une demande sans inviter', calls.deletedReq.join() === '1');
  check('historique : l\'invitation existante est listée, avec sa croix', /ancien@x\.test/.test(doc.getElementById('invitesSentList').textContent) && !!doc.querySelector('.btn-invite-delete'));
  doc.querySelector('.btn-invite-delete').click(); await wait(40);
  check('historique : la croix efface l\'invitation', calls.deletedInv.join() === '7');
  doc.getElementById('inviteTesterEmail').value = '';
  doc.getElementById('btnInviteTester').click(); await wait(30);
  check('envoi sans e-mail : rien n\'est envoyé', calls.invite.length === 2);

  // ---- feux verts
  nav.find(b => b.dataset.section === 'flags').click();
  const rows = () => [...doc.querySelectorAll('#featureFlagsList button[data-flag-key]')];
  check('feux verts : les fermés d\'abord, avec le décompte', rows()[0].dataset.flagKey === 'level_map' && /1 fermé/.test(doc.getElementById('featureFlagsCount').textContent));
  rows()[0].click(); await wait(60);
  check('« Ouvrir à tous » : set_feature_released(level_map, true) après confirmation', calls.rpc.some(c => c[0] === 'set_feature_released' && c[1].p_key === 'level_map' && c[1].p_released === true));
  check('la liste est rechargée : plus aucun feu vert fermé', /0 fermé/.test(doc.getElementById('featureFlagsCount').textContent));
  const search = doc.getElementById('featureFlagsSearch'); search.value = 'proj'; search.dispatchEvent(new w.Event('input'));
  check('recherche de feu vert', rows().length === 1 && rows()[0].dataset.flagKey === 'projects');

  // ---- mode test (même clé que le Backstage)
  nav.find(b => b.dataset.section === 'tools').click();
  const mt = doc.getElementById('modeTestToggle');
  mt.checked = true; mt.dispatchEvent(new w.Event('change'));
  check('mode test : mémorisé sous la clé du Backstage (isModeTest() la relit)', w.localStorage.getItem('layerpitch_backstage_mode_test') === '1');

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon');
  process.exit(failures ? 1 : 0);
})();
