// Suivi des envois (migration 20261123010000) : feu vert, création d'un envoi avec code, modification, statuts, « j'ai relancé »,
// visites rattachées par le code (#r=), écoutes retrouvées dans analytics_events, visites du compositeur ignorées, autre
// compositeur tenu à l'écart, palier Free sans détail, historique gardé après suppression de l'AdReel. Base jetable PGlite.
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const fails = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const mk = async (n, email) => { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), email]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); };

  await mk(1, 'admin@x.test'); await mk(2, 'compo@x.test'); await mk(3, 'autre@x.test'); await mk(4, 'visiteur@x.test');
  const c1 = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'adm') returning id`, [U(1)]))[0].id;
  const c2 = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'compo') returning id`, [U(2)]))[0].id;
  const c3 = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'autre') returning id`, [U(3)]))[0].id;
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await q(`insert into public.ad_reels (id, owner_id, label, profile) values ('main', $1, 'Principal', '{}'), ('jeux', $1, 'Jeux vidéo', '{}'), ('main', $2, 'Autre', '{}')`, [c2, c3]);
  await q(`insert into public.ad_reels (id, owner_id, label, profile) values ('main', $1, 'Admin', '{}')`, [c1]);

  // ---- Feu vert ----
  check('le feu vert existe et est fermé', (await val(`select released from public.feature_flags where key = 'sends_tracking'`)) === false);
  await as(2);
  check('feu vert fermé : un compositeur ne crée pas d\'envoi', await fails(`select public.create_adreel_send('main', 'Ubisoft')`, [], /pas encore ouvert/));
  check('feu vert fermé : ni ne liste', await fails(`select public.list_my_adreel_sends()`, [], /pas encore ouvert/));
  await as(1);
  const a0 = await val(`select public.create_adreel_send('main', 'Studio admin')`);
  check('admin : envoi créé malgré le feu vert fermé', !!(a0 && a0.id));
  await as(0);
  check('sans connexion : refusé', await fails(`select public.create_adreel_send('main', 'X')`, [], /Connexion requise/));
  await q(`update public.feature_flags set released = true where key = 'sends_tracking'`);

  // ---- Création ----
  await as(2);
  const s1 = await val(`select public.create_adreel_send('main', '  Ubisoft  ', ' Marie ', 'Rencontrée à la Paris Games Week')`);
  check('envoi créé : id + code de 12 caractères', s1.id && /^[a-f0-9]{12}$/.test(s1.code));
  const s2 = await val(`select public.create_adreel_send('jeux', 'Ubisoft')`);
  const s3 = await val(`select public.create_adreel_send('main', 'Don''t Nod', '', '')`);
  check('chaque envoi a son propre code', new Set([s1.code, s2.code, s3.code]).size === 3);
  check('AdReel d\'un autre compositeur refusé', await fails(`select public.create_adreel_send('inexistant', 'X')`, [], /AdReel introuvable/));
  check('studio vide refusé', await fails(`select public.create_adreel_send('main', '   ')`, [], /1 à 120/));
  await q(`update public.adreel_sends set created_at = now() - interval '2 days' where id = $1`, [s1.id]);
  await q(`update public.adreel_sends set created_at = now() - interval '1 day' where id = $1`, [s2.id]);
  let list = await val(`select public.list_my_adreel_sends()`);
  let x = list.sends.find(s => s.id === s1.id);
  check('liste : le plus récent en premier', list.sends[0].id === s3.id && list.sends.length === 3);
  check('studio et personne nettoyés, note gardée, nom de l\'AdReel retenu', x.studio === 'Ubisoft' && x.person === 'Marie' && x.note.includes('Paris') && x.adReelLabel === 'Principal');
  check('statut par défaut : envoyé, pas encore écouté', x.status === 'sent' && x.listened === false && x.visits === 0 && x.plays === 0);
  check('pro : détail présent', list.detailed === true && Array.isArray(x.trackIds));

  // ---- Isolation ----
  await as(3);
  check('un autre compositeur ne voit pas ces envois', (await val(`select public.list_my_adreel_sends()`)).sends.length === 0);
  check('ni ne les modifie', await fails(`select public.update_adreel_send($1, '{"status":"signed"}'::jsonb)`, [s1.id], /introuvable/));
  check('ni ne les supprime', await fails(`select public.delete_adreel_send($1)`, [s1.id], /introuvable/));
  await db.exec(`set role authenticated`);
  check('tables fermées en lecture directe', await fails(`select * from public.adreel_sends`, [], /permission/));
  check('table des visites fermée aussi', await fails(`select * from public.adreel_send_visits`, [], /permission/));
  await db.exec(`reset role`);

  // ---- Visites ----
  const sess = id => `sess-${id}`;
  await as(4); // visiteur connecté à un autre compte : compte comme n'importe qui
  await q(`select public.register_send_visit($1, $2, 'main', $3)`, [s1.code, sess('a'), c2]);
  await q(`select public.register_send_visit($1, $2, 'main', $3)`, [s1.code, sess('a'), c2]); // même session : une seule visite
  await as(0);
  await q(`select public.register_send_visit($1, $2, 'main', null)`, [s1.code, sess('b')]);
  await q(`select public.register_send_visit($1, $2, 'jeux', $3)`, [s1.code, sess('c'), c2]); // code collé sur un autre AdReel : ignoré
  await q(`select public.register_send_visit($1, $2, 'main', $3)`, [s1.code, sess('d'), c3]); // mauvais compositeur : ignoré
  await q(`select public.register_send_visit('zzzzzzzzzzzz', 'x', 'main', null)`);              // code inconnu : muet
  await q(`select public.register_send_visit('<script>', 'x', 'main', null)`);                  // code mal formé : muet
  await as(2);
  await q(`select public.register_send_visit($1, $2, 'main', $3)`, [s1.code, sess('own'), c2]); // le compositeur lui-même : ignoré
  // Écoutes : analytics_events de ces sessions (track_play) ; une écoute d'une autre session ne compte pas.
  for (const [s, t] of [['a', 'tA'], ['a', 'tB'], ['b', 'tA'], ['zz', 'tC']]) {
    await q(`insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, detail, tier) values ($1, 'adreel', 'main', $2, 'track_play', $3::jsonb, 'pro')`, [c2, sess(s), JSON.stringify({ trackId: t })]);
  }
  await q(`insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, detail, tier) values ($1, 'adreel', 'main', $2, 'page_open', '{}'::jsonb, 'pro')`, [c2, sess('a')]);
  list = await val(`select public.list_my_adreel_sends()`);
  x = list.sends.find(s => s.id === s1.id);
  check('2 visites rattachées (doublon, autre AdReel, autre compositeur et visite du compositeur ignorés)', x.visits === 2);
  check('écouté, avec date de première et dernière visite', x.listened === true && !!x.firstVisitAt && !!x.lastVisitAt);
  check('3 écoutes, 2 morceaux distincts', x.plays === 3 && x.trackIds.length === 2 && x.trackIds.includes('tA') && x.trackIds.includes('tB'));
  check('les autres envois restent non écoutés', list.sends.find(s => s.id === s2.id).listened === false);

  // ---- Modification ----
  await q(`select public.update_adreel_send($1, '{"status":"replied","note":"A répondu le 24","person":"Marie D."}'::jsonb)`, [s1.id]);
  x = (await val(`select public.list_my_adreel_sends()`)).sends.find(s => s.id === s1.id);
  check('statut, note et personne modifiés, date du statut posée', x.status === 'replied' && x.note === 'A répondu le 24' && x.person === 'Marie D.' && !!x.statusChangedAt);
  check('statut inconnu refusé', await fails(`select public.update_adreel_send($1, '{"status":"perdu"}'::jsonb)`, [s1.id], /Statut inconnu/));
  check('studio vidé refusé', await fails(`select public.update_adreel_send($1, '{"studio":""}'::jsonb)`, [s1.id], /1 à 120/));
  await q(`select public.update_adreel_send($1, '{"followedUp":true}'::jsonb)`, [s2.id]);
  check('« j\'ai relancé » enregistré', !!(await val(`select public.list_my_adreel_sends()`)).sends.find(s => s.id === s2.id).followedUpAt);
  await q(`select public.update_adreel_send($1, '{"followedUp":false}'::jsonb)`, [s2.id]);
  check('« j\'ai relancé » annulé', !(await val(`select public.list_my_adreel_sends()`)).sends.find(s => s.id === s2.id).followedUpAt);

  // ---- Palier Free : pas de détail ----
  await q(`update public.composer_profiles set plan = 'free' where id = $1`, [c2]);
  await q(`update public.app_settings set value = 'false'::jsonb where key = 'beta_program.full_access'`).catch(() => {});
  const tier = await val(`select public.composer_effective_tier($1)`, [c2]);
  list = await val(`select public.list_my_adreel_sends()`);
  x = list.sends.find(s => s.id === s1.id);
  if (tier === 'free') {
    check('Free : écouté et dernière visite visibles, sans nombre de visites ni morceaux', list.detailed === false && x.listened === true && !!x.lastVisitAt && x.visits === undefined && x.plays === undefined && x.trackIds === undefined);
  } else {
    check('palier effectif ' + tier + ' (accès bêta) : détail présent', list.detailed === true && x.visits === 2);
  }
  await q(`update public.composer_profiles set plan = 'pro' where id = $1`, [c2]);

  // ---- AdReel supprimé : l'historique reste ----
  await q(`delete from public.ad_reels where owner_id = $1 and id = 'jeux'`, [c2]);
  x = (await val(`select public.list_my_adreel_sends()`)).sends.find(s => s.id === s2.id);
  check('AdReel supprimé : l\'envoi reste, marqué comme disparu, avec son nom', x && x.adReelExists === false && x.adReelLabel === 'Jeux vidéo');

  // ---- Suppression ----
  await q(`select public.delete_adreel_send($1)`, [s1.id]);
  check('envoi supprimé avec ses visites', (await val(`select public.list_my_adreel_sends()`)).sends.length === 2 && (await val(`select count(*)::int from public.adreel_send_visits`)) === 0);

  // ---- Compte supprimé : les envois partent avec lui ----
  await q(`delete from public.composer_profiles where id = $1`, [c2]);
  check('suppression du compte : envois effacés', (await val(`select count(*)::int from public.adreel_sends where owner_id = $1`, [c2])) === 0);

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  process.exit(failures ? 1 : 0);
})();
