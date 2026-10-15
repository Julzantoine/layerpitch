// Messages natifs modifiables (15/10) : le texte de bienvenue vit dans platform_message_templates (plus en dur
// dans mark_onboarding_complete) ; une modification ne touche que les futurs arrivants ; un message déjà envoyé
// (admin_messages) se corrige sur place. Tout est réservé aux admins.
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
  const fails = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  for (const [n, email] of [[1, 'admin@x.test'], [2, 'jean@x.test'], [3, 'lea@x.test']]) {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), email]);
    await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]);
  }
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);

  // --- la bienvenue d'origine est reprise telle quelle ---
  await as(1);
  const natives = await q(`select * from public.admin_list_native_messages()`);
  const welcome = natives.find(m => m.key === 'welcome');
  check('le message de bienvenue existe, titre et texte FR/EN',
    welcome && welcome.title.fr === 'Bienvenue sur LayerPitch' && welcome.title.en === 'Welcome to LayerPitch'
    && welcome.body.fr.startsWith('Bonjour et bienvenue sur LayerPitch') && welcome.body.en.startsWith('Hello and welcome to LayerPitch'));

  // --- un nouvel arrivant reçoit le texte courant ---
  await as(2);
  await q(`select public.mark_onboarding_complete()`);
  let inbox = await q(`select body, title from public.admin_messages where recipient_id = $1`, [U(2)]);
  check('nouvel arrivant : une bienvenue personnelle avec le texte du modèle', inbox.length === 1 && inbox[0].body.fr === welcome.body.fr && inbox[0].title.fr === 'Bienvenue sur LayerPitch');

  // --- modification : futurs arrivants seulement ---
  await as(1);
  await q(`select public.admin_update_native_message('welcome', $1::jsonb, $2::jsonb)`,
    [JSON.stringify({ fr: 'Nouveau texte', en: 'New text' }), JSON.stringify({ fr: 'Salut', en: ' ' })]);
  await as(3);
  await q(`select public.mark_onboarding_complete()`);
  const lea = await q(`select body, title from public.admin_messages where recipient_id = $1`, [U(3)]);
  check('le prochain arrivant reçoit le texte modifié', lea.length === 1 && lea[0].body.fr === 'Nouveau texte' && lea[0].title.fr === 'Salut');
  inbox = await q(`select body from public.admin_messages where recipient_id = $1`, [U(2)]);
  check('la boîte déjà remplie ne change pas', inbox.length === 1 && inbox[0].body.fr === welcome.body.fr);
  await q(`select public.mark_onboarding_complete()`);
  check('pas de doublon si l\'accueil est rejoué', Number(await val(`select count(*) from public.admin_messages where recipient_id = $1`, [U(3)])) === 1);

  // --- retouche d'un message déjà envoyé ---
  await as(1);
  const id = await val(`select public.admin_send_message($1::jsonb, null, false, $2::jsonb)`, [JSON.stringify({ fr: 'faute' }), JSON.stringify({ fr: 'Titre' })]);
  await q(`select public.admin_update_message($1::bigint, $2::jsonb, $3::jsonb)`, [id, JSON.stringify({ fr: 'corrigé', en: 'fixed' }), JSON.stringify({ fr: 'Titre 2' })]);
  const row = (await q(`select body, title from public.admin_messages where id = $1`, [id]))[0];
  check('message envoyé : texte et titre corrigés sur place', row.body.fr === 'corrigé' && row.body.en === 'fixed' && row.title.fr === 'Titre 2');

  // --- suppression du modèle : plus de bienvenue ; « enregistrer » la recrée ---
  await q(`select public.admin_delete_native_message('welcome')`);
  check('modèle supprimé : plus dans la liste', (await q(`select * from public.admin_list_native_messages()`)).length === 0);
  await as(2);
  await q(`delete from public.admin_messages where recipient_id = $1`, [U(2)]);
  await q(`select public.mark_onboarding_complete()`);
  check('sans modèle : l\'arrivant ne reçoit rien (et son accueil se termine quand même)', Number(await val(`select count(*) from public.admin_messages where recipient_id = $1`, [U(2)])) === 0);
  await as(1);
  await q(`select public.admin_update_native_message('welcome', $1::jsonb)`, [JSON.stringify({ fr: 'Recréé' })]);
  check('enregistrer après suppression recrée le message', (await q(`select * from public.admin_list_native_messages()`))[0].body.fr === 'Recréé');

  // --- LayerPitch 101 : rangé avec la bienvenue ---
  const idSent = await val(`select public.admin_send_message($1::jsonb, null, false, $2::jsonb)`, [JSON.stringify({ fr: 'Bonjour à toutes et à tous' }), JSON.stringify({ fr: 'LayerPitch 101 : le lecteur interactif' })]);
  check('un message envoyé n\'est pas d\'accueil par défaut', (await q(`select * from public.admin_list_messages()`)).find(m => m.id == idSent).welcome === false);
  await q(`update public.admin_messages set welcome = true where id = $1`, [idSent]);
  check('la liste admin expose le drapeau d\'accueil', (await q(`select * from public.admin_list_messages()`)).find(m => m.id == idSent).welcome === true);
  await q(`select public.admin_delete_message($1::bigint)`, [idSent]);
  check('un message d\'accueil diffusé se supprime comme les autres', !(await q(`select * from public.admin_list_messages()`)).some(m => m.id == idSent));

  // --- garde-fous ---
  check('message inconnu : refusé', await fails(`select public.admin_update_native_message('nope', '{"fr":"x"}'::jsonb)`, [], /inconnu/));
  check('texte qui n\'est pas un objet : refusé', await fails(`select public.admin_update_native_message('welcome', '"x"'::jsonb)`, [], /objet JSON/));
  check('retouche d\'un message absent : refusée', await fails(`select public.admin_update_message(999999, '{"fr":"x"}'::jsonb)`, [], /introuvable/));
  await as(2);
  check('compte ordinaire : lecture refusée', await fails(`select * from public.admin_list_native_messages()`, [], /réservé aux admins/));
  check('compte ordinaire : modification du modèle refusée', await fails(`select public.admin_update_native_message('welcome', '{"fr":"x"}'::jsonb)`, [], /réservé aux admins/));
  check('compte ordinaire : retouche d\'un message refusée', await fails(`select public.admin_update_message(${id}, '{"fr":"x"}'::jsonb)`, [], /réservé aux admins/));
  check('compte ordinaire : lecture directe de la table impossible', (await q(`select count(*) c from public.platform_message_templates`)).length >= 0 && await (async () => {
    try { await db.query(`set role authenticated`); const r = await db.query(`select * from public.platform_message_templates`); await db.query(`reset role`); return r.rows.length === 0; } catch (e) { try { await db.query(`reset role`); } catch (_) {} return true; }
  })());

  // --- page : api/admin.js ---
  const calls = [];
  global.window = { LayerPitchSupabaseClient: { getClient: () => ({ rpc: async (name, params) => { calls.push({ name, params }); return { data: name === 'admin_list_native_messages' ? [{ key: 'welcome', title: null, body: { fr: 'a' }, updated_at: 'x' }] : null, error: null }; } }) } };
  eval(fs.readFileSync(path.join(__dirname, 'api', 'admin.js'), 'utf8'));
  const A = window.LayerPitchAdmin;
  await A.updateAdminMessage(7, { fr: 'a' }, { fr: ' T ', en: '' });
  check('api : retouche envoie l\'identifiant, le texte et des titres nettoyés', calls[0].name === 'admin_update_message' && calls[0].params.p_id === 7 && JSON.stringify(calls[0].params.p_title) === '{"fr":"T"}');
  await A.deleteNativeMessage('welcome');
  check('api : suppression du modèle natif', calls[calls.length - 1].name === 'admin_delete_native_message' && calls[calls.length - 1].params.p_key === 'welcome');
  calls.length = 0; calls.push(null, null);
  await A.updateNativeMessage('welcome', { fr: 'a' }, { fr: 'T' });
  check('api : modification du modèle natif', calls[2].name === 'admin_update_native_message' && calls[2].params.p_key === 'welcome');
  const l = await A.listNativeMessages();
  check('api : liste des messages natifs normalisée', l.messages.length === 1 && l.messages[0].key === 'welcome' && JSON.stringify(l.messages[0].title) === '{}');

  // --- page admin : l'éditeur est branché ---
  const html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
  check('admin.html : bouton Modifier dans l\'historique et carte des messages automatiques', html.includes('data-admin-msg-edit') && html.includes('data-native-delete') && html.includes('id="adminNativeMsgs"') && html.includes('loadAdminNativeMsgs();'));
  const i18n = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8');
  check('i18n : libellés FR et EN', (i18n.match(/adminMsgEditBtn:/g) || []).length === 2 && (i18n.match(/adminNativeKey_welcome:/g) || []).length === 2 && (i18n.match(/adminNativeSentLabel:/g) || []).length === 2);

  if (failures) { console.log(`\n${failures} échec(s)`); process.exit(1); }
  console.log('\nTout est OK');
})();
