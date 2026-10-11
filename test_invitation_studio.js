// Invitations de studios (7/10) : la demande venue de la page Studios porte l'intention « studio » (contrainte de base, base jetable
// PGlite), et le panneau d'invitation la reconnaît (voir test_panneau_admin_invitations.js : type de compte « Studio » présélectionné, lien
// d'arrivée avec ?persona=studio ; bienvenue.html crée alors le profil studio et mène à l'espace studio).
const fs = require('fs');
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

  // Le panneau d'invitation (type de compte « Studio », ?persona=studio) est testé dans test_panneau_admin_invitations.js : il vit
  // désormais dans le panneau admin (admin.html) et non plus dans le Backstage.

  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
