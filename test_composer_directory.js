// Annuaire des compositeurs (23/10, migration 20261023010000, annuaire.html) : feu vert, qui apparaît,
// réglages du compositeur (case + cadrage ; les tags et l'ordre : test_directory_tags.js), noms réservés, routage /compositeurs, textes FR/EN. Base jetable PGlite.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const as = uid => db.query(`select set_config('test.uid', $1, false)`, [uid || '']);
  const mk = async (n, handle, plan, extra) => {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), `c${n}@x.test`]);
    await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]);
    const id = (await q(`insert into public.composer_profiles (profile_id, handle, plan) values ($1, $2, $3) returning id`, [U(n), handle, plan || 'free']))[0].id;
    if (!extra || !extra.noMain) {
      await q(`insert into public.ad_reels (id, owner_id, label, profile) values ('main', $1, 'Principal', $2::jsonb)`, [id, JSON.stringify({ title: 'Nom ' + n, bio: 'Bio ' + n, photo: `p${n}.jpg` })]);
      await q(`insert into public.tracks (id, owner_id, title, mode) values ($1, $2, 'T', 'static')`, ['t' + n, id]);
      await q(`insert into public.ad_reel_tracks (ad_reel_id, owner_id, track_id, position) values ('main', $1, $2, 0)`, [id, 't' + n]);
    }
    return id;
  };
  await mk(1, 'ana', 'free'); await mk(2, 'bob', 'pro'); await mk(3, 'cleo', 'starter');
  await mk(4, 'dan', 'pro', { noMain: true }); await mk(5, null, 'pro'); await mk(6, 'eve', 'pro'); await mk(7, 'fay', 'pro');
  await q(`update public.composer_profiles set directory_opt_in = false where handle = 'eve'`);
  await q(`update public.profiles set suspended = true where id = $1`, [U(7)]);

  check('case cochée par défaut pour un nouveau compte', (await val(`select directory_opt_in from public.composer_profiles where handle = 'ana'`)) === true);
  await as(null);
  check('annuaire fermé (pas de feu vert) : statut fermé et liste vide pour un visiteur', (await val(`select public.directory_status()->>'open'`)) === 'false' && (await q(`select * from public.composer_directory()`)).length === 0);
  await q(`update public.feature_flags set released = true where key = 'composer_directory'`);
  check('feu vert donné : statut ouvert sans compte', (await val(`select public.directory_status()->>'open'`)) === 'true');
  const list0 = await q(`select * from public.composer_directory()`);
  check('pendant la bêta (tout le monde Pro) : tous au même niveau, ordre du jour', list0.every(r => r.tier === 'pro') && list0.length === 3);
  await q(`update public.beta_program set full_access = false`);
  const list = await q(`select * from public.composer_directory()`);
  const handles = list.map(r => r.handle);
  check('sans AdReel principal, sans identifiant, case décochée ou compte suspendu : absent', ['dan', 'eve', 'fay'].every(h => !handles.includes(h)) && handles.length === 3);
  const bob = list.find(r => r.handle === 'bob');
  check('fiche : nom, bio et photo viennent de l\'AdReel principal', bob.name === 'Nom 2' && bob.bio === 'Bio 2' && bob.photo === 'p2.jpg');
  check('aucune adresse e-mail dans la liste', !Object.keys(bob).some(k => /mail|profile_id|owner/.test(k)));

  await as(U(1));
  check('lecture de ses réglages', (await val(`select public.get_my_directory()`)).optIn === true);
  await val(`select public.set_my_directory(false, array['rpg']::text[])`);
  const fr1 = await val(`select public.set_my_directory(true, array['rpg']::text[], '{"x": 130, "y": -5, "zoom": 9}'::jsonb)`);
  check('cadrage : ramené dans les bornes (x ≤ 100, y ≥ 0, zoom ≤ 3)', fr1.photoFrame.x === 100 && fr1.photoFrame.y === 0 && fr1.photoFrame.zoom === 3);
  check('cadrage : inchangé quand on n\'en envoie pas', (await val(`select public.set_my_directory(true, array['rpg']::text[])`)).photoFrame.zoom === 3);
  await as(null);
  check('cadrage : visible dans la liste publique', (await q(`select photo_frame from public.composer_directory() where handle = 'ana'`))[0].photo_frame.zoom === 3);
  await as(U(1));
  check('cadrage : « {} » recentre', (await val(`select public.set_my_directory(true, array['rpg']::text[], '{}'::jsonb)`)).photoFrame === null);
  await as(null);
  await as(U(1)); await val(`select public.set_my_directory(false, array['rpg']::text[])`); await as(null);
  check('case décochée : disparaît de l\'annuaire', !(await q(`select handle from public.composer_directory()`)).some(r => r.handle === 'ana'));
  await as(U(1)); await val(`select public.set_my_directory(true, array['rpg']::text[])`); await as(null);
  await q(`insert into auth.users (id, email) values ($1, 'studio@x.test')`, [U(20)]);
  await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(20)]);
  await as(U(20));
  check('un compte sans profil compositeur ne peut pas régler', await (async () => { try { await db.query(`select public.set_my_directory(true, '{}')`); return false; } catch (e) { return /compositeur/.test(e.message); } })());
  check('… et n\'a pas de réglages à lire', (await val(`select public.get_my_directory()`)) === null);
  await as(null);
  check('noms réservés : compositeurs, composers, annuaire, directory', (await val(`select bool_and(public.handle_is_reserved(h)) from unnest(array['compositeurs','composers','annuaire','directory']) h`)) === true && (await val(`select public.handle_is_reserved('shop')`)) === true);

  // Routage /compositeurs -> annuaire.html
  const html404 = fs.readFileSync(path.join(__dirname, '404.html'), 'utf8');
  const script = html404.match(/<script>([\s\S]*?)<\/script>/)[1];
  const route = pathname => { let t = null; vm.runInNewContext(script, { location: { pathname, search: '?lang=en', replace: u => { t = u; } }, URLSearchParams, decodeURIComponent }); return t; };
  check('/compositeurs et /composers -> annuaire.html (langue gardée)', /^\/annuaire\.html\?/.test(route('/compositeurs') || '') && /lang=en/.test(route('/composers/') || '') && /^\/annuaire\.html/.test(route('/composers/') || ''));

  // Textes FR/EN et branchements
  const sb = { window: {} }; vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8'), sb);
  const I = sb.window.LAYERPITCH_I18N;
  const keys = ['pageTitle', 'h1', 'intro', 'searchPlaceholder', 'filterPlaceholder', 'filterRemove', 'filterNone', 'listen', 'listenClose', 'listenTitle', 'openAdReel', 'contact', 'noMatch', 'empty', 'loadError', 'comingSoonTitle', 'comingSoonHint'];
  check('page : textes FR et EN', keys.every(k => I.fr.directory[k] && I.en.directory[k]));
  check('contact : textes FR et EN', ['title', 'hint', 'name', 'email', 'message', 'send', 'sent', 'error'].every(k => I.fr.directoryContact[k] && I.en.directoryContact[k]));
  check('carte Mon compte : textes FR et EN', ['directoryKeywordsLabel', 'directoryKeywordsHint', 'directoryTagCreate', 'directoryTagRemove', 'directoryHidden_no_tracks', 'directoryHidden_private', 'directoryHidden_no_adreel', 'directoryHidden_no_handle', 'directorySave', 'directorySaved', 'directoryOpenLink', 'directoryNotOpen', 'directoryPhotoLabel', 'directoryPhotoZoom', 'directoryPhotoReset', 'directoryPhotoHint'].every(k => I.fr.monCompte[k] && I.en.monCompte[k]));
  check('barre latérale et menu Compte : libellés FR et EN', !!(I.fr.shell.item_directory && I.en.shell.item_directory && I.fr.backstage.navDirectory && I.en.backstage.navDirectory));
  const page = fs.readFileSync(path.join(__dirname, 'annuaire.html'), 'utf8');
  check('annuaire.html : ouvert sans compte (aucune redirection de connexion), clic vers l\'AdReel, contact par identifiant', !/requireSession|redirectToLogin/.test(page) && /adReelHref/.test(page) && /kind: 'composer'/.test(page));
  const fn = fs.readFileSync(path.join(__dirname, 'supabase/functions/submit-contact-message/index.ts'), 'utf8');
  check('Edge Function : accepte { handle } seulement pour un compositeur visible dans l\'annuaire', /directory_opt_in/.test(fn) && /shopKind === 'composer'/.test(fn));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
