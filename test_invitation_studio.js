// Invitations de studios (7/10) : la demande venue de la page Studios porte l'intention « studio » (contrainte de base, base jetable
// PGlite), et le panneau d'invitation du Backstage la reconnaît : type de compte « Studio » présélectionné, lien d'arrivée avec
// ?persona=studio (bienvenue.html crée alors le profil studio et mène à l'espace studio). Le vrai Backstage dans jsdom.
const fs = require('fs');
const { loadBackstage } = require('./scripts/test-harness.js');
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };

  // --- base ---
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  const ins = async intent => { try { await db.query(`insert into public.access_requests (email, source, intent) values ('a@b.test', 'landing', $1)`, [intent]); return true; } catch (e) { return false; } };
  check('base : « studio » accepté', await ins('studio'));
  check('base : « beta », « waitlist » et aucune intention toujours acceptés', (await ins('beta')) && (await ins('waitlist')) && (await ins(null)));
  check('base : une intention inconnue est refusée', !(await ins('fan')));

  // --- fonction et formulaires ---
  const fn = fs.readFileSync('supabase/functions/submit-access-request/index.ts', 'utf8');
  check('fonction : accepte l\'intention « studio »', /intent === 'studio'/.test(fn));
  for (const f of ['nouvelle-landing/studios.html', 'nouvelle-landing/en/studios.html']) {
    const h = fs.readFileSync(f, 'utf8');
    check(f + ' : envoie l\'intention « studio », plus de préfixe « [STUDIO] »', /intent: 'studio'/.test(h) && !/\[STUDIO\]/.test(h));
  }

  // --- panneau d'invitation ---
  const dom = await loadBackstage();
  const w = dom.window, doc = w.document, ev = c => w.eval(c);
  const settle = () => new Promise(r => setTimeout(r, 30));
  w.LayerPitchAccessRequests = { getPendingAccessRequests: async () => ({ requests: [
    { id: 1, email: 'compo@x.test', source: 'landing', intent: 'beta', created_at: '2026-10-07T08:00:00Z', message: null },
    { id: 2, email: 'studio@x.test', source: 'landing', intent: 'studio', created_at: '2026-10-07T09:00:00Z', message: 'Nous sommes 12.' }] }),
    markAccessRequestInvited: async () => ({ ok: true }), deleteAccessRequest: async () => ({ ok: true }) };
  w.Element.prototype.scrollIntoView = () => {}; // jsdom ne l'implémente pas
  w.LayerPitchInvites = { getInvites: async () => ({ invites: [] }), listInvites: async () => ({ invites: [] }) };
  const calls = [];
  w.LayerPitchAuth = Object.assign({}, w.LayerPitchAuth, { inviteTester: async (...a) => { calls.push(a); return { ok: true }; } });
  ev('loadPostgresReadScripts = async () => {}');
  ev("window.LayerPitchNotify.success = () => {}; window.LayerPitchNotify.info = () => {}; window.LayerPitchNotify.error = () => {};");
  if (!doc.getElementById('accessRequestsList')) { const d = doc.createElement('div'); d.id = 'accessRequestsList'; doc.body.appendChild(d); }
  await ev('renderAccessRequestsList()'); await settle();
  const list = doc.getElementById('accessRequestsList').textContent;
  check('liste : la demande du studio est étiquetée « page Studios »', /page Studios/.test(list) && /landing — "Rejoindre la bêta"/.test(list));
  const persona = doc.getElementById('inviteTesterPersona');
  check('panneau : choix « Compositeur / Studio », compositeur par défaut', !!persona && persona.value === 'composer');
  doc.querySelector('[data-request-id="2"]').click();
  check('« Inviter » sur la demande studio : type de compte « Studio » présélectionné', persona.value === 'studio' && doc.getElementById('inviteTesterEmail').value === 'studio@x.test');
  doc.getElementById('btnInviteTester').click(); await settle(); await settle();
  check('envoi : le lien d\'arrivée porte ?persona=studio', calls.length === 1 && /bienvenue\.html\?lang=fr&persona=studio$/.test(calls[0][1]));
  check('envoi : la demande est rattachée à l\'invitation', calls[0][3] === 2);
  check('après l\'envoi : le type de compte revient à « Compositeur »', persona.value === 'composer');
  doc.getElementById('inviteTesterEmail').value = 'compo@x.test'; doc.getElementById('inviteTesterLang').value = 'en';
  doc.getElementById('btnInviteTester').click(); await settle(); await settle();
  check('invitation compositeur : lien classique, sans persona', calls.length === 2 && /bienvenue\.html\?lang=en$/.test(calls[1][1]));

  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
