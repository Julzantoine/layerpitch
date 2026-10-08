// Messages admin ciblés (8/10) : historique complet pour l'admin (admin_list_messages, avec l'adresse du destinataire),
// refusé aux autres ; envoi un message par compte choisi (api/admin.js), diffusion à tous quand aucun compte n'est choisi.
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; };

(async () => {
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); } catch (e) { console.log('FAIL PGlite absent : ' + e.message); process.exit(1); }
  const db = await freshDb();
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const fails = async (sql, re) => { try { await db.query(sql); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  for (const [n, email] of [[1, 'admin@x.test'], [2, 'jean@x.test'], [3, 'lea@x.test']]) {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), email]);
    await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]);
  }
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);

  // --- base : admin_list_messages ---
  await as(1);
  await q(`select public.admin_send_message($1::jsonb)`, [JSON.stringify({ fr: 'pour tous' })]);
  await q(`select public.admin_send_message($1::jsonb, $2::uuid)`, [JSON.stringify({ fr: 'pour Jean' }), U(2)]);
  const list = await q(`select * from public.admin_list_messages()`);
  check('l\'admin voit le message diffusé et le message personnel', list.length === 2);
  const perso = list.find(m => m.recipient_id);
  check('le message personnel porte l\'adresse du destinataire', perso && perso.recipient_email === 'jean@x.test' && perso.body.fr === 'pour Jean');
  check('le message diffusé n\'a ni destinataire ni adresse', list.find(m => !m.recipient_id).recipient_email === null);
  await as(2);
  check('un compte ordinaire ne peut pas lire l\'historique complet', await fails(`select * from public.admin_list_messages()`, /réservé aux admins/));
  await as(null);
  check('sans compte : refusé', await fails(`select * from public.admin_list_messages()`, /réservé aux admins/));

  // --- page : api/admin.js, envoi un message par compte ---
  const calls = [];
  let failOn = null;
  global.window = { LayerPitchSupabaseClient: { getClient: () => ({ rpc: async (name, params) => { calls.push({ name, params }); return { data: null, error: params.p_recipient_id && params.p_recipient_id === failOn ? { message: 'refusé' } : null }; } }) } };
  eval(fs.readFileSync(path.join(__dirname, 'api', 'admin.js'), 'utf8'));
  const A = window.LayerPitchAdmin;
  let r = await A.sendAdminMessage({ fr: 'a' }, true, { fr: ' Titre ', en: '' });
  check('sans destinataire : un seul envoi diffusé, « comptes existants » respecté', r.ok && r.sent === 1 && calls.length === 1 && !('p_recipient_id' in calls[0].params) && calls[0].params.p_existing_accounts_only === true);
  check('titre : espaces retirés, langue vide écartée', JSON.stringify(calls[0].params.p_titles) === '{"fr":"Titre"}');
  calls.length = 0;
  r = await A.sendAdminMessage({ fr: 'a' }, true, null, ['id-1', 'id-2', 'id-3']);
  check('3 comptes choisis : 3 envois personnels', r.ok && r.sent === 3 && calls.length === 3 && calls.map(c => c.params.p_recipient_id).join() === 'id-1,id-2,id-3');
  check('envoi ciblé : jamais « comptes existants uniquement »', calls.every(c => c.params.p_existing_accounts_only === false));
  calls.length = 0; failOn = 'id-2';
  r = await A.sendAdminMessage({ fr: 'a' }, false, null, ['id-1', 'id-2', 'id-3']);
  check('échec au 2e : arrêt, 1 déjà parti signalé', !r.ok && r.sent === 1 && calls.length === 2 && r.error === 'refusé');

  process.exit(failures ? 1 : 0);
})();
