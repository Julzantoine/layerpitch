// Accueil de l'espace studio (migration 20261116010000, cadrage layerpitch-docs/2026-11-16-accueil-studio-cadrage.md) :
// feu vert, clés d'Accueil de set_my_home_prefs (sans perdre celles des migrations précédentes), projets avec leur dernier message,
// puis vérifications sur les fichiers (onglet, menu, fenêtre de tchat avec saisie, cartes, adresse ?tab=). Base jetable PGlite.
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
  await db.query(`update public.beta_program set full_access = false`);

  check('feu vert studio_home créé, fermé', (await q(`select released from public.feature_flags where key = 'studio_home'`))[0].released === false);

  await mk(1, 'boss@studio.test'); await mk(2, 'marie@studio.test'); await mk(3, 'intrus@x.test');
  await db.query(`update public.feature_flags set released = true where key in ('projects', 'studio_space')`);
  await as(1);
  const sid = await val(`select public.ensure_studio_profile()`);
  await q(`update public.studio_profiles set plan = 'indie' where id = $1`, [sid]);
  await q(`update public.plan_entitlements set allowed = true, amount = 10 where feature = 'studio_projects'`); // limite relevée : le test porte sur la liste, pas sur les quotas
  const mm = await val(`select public.invite_team_member('marie@studio.test')`);
  await as(2); await q(`select public.respond_team_invitation($1, true)`, [mm]);
  await as(1);
  const pa = await val(`select public.create_project('Projet A', '', true)`);
  await q(`select public.post_project_message($1, 'Premier message de A')`, [pa]);
  await q(`update public.projects set updated_at = now() - interval '2 days' where id = $1`, [pa]);

  // Réglages d'Accueil : nouvelles clés acceptées, anciennes conservées, inconnues ignorées
  const prefs = await val(`select public.set_my_home_prefs('{"studio_tour_dismissed": true, "studio_cards_hidden": ["news"], "home_cards_hidden": ["mail"], "ui_advanced": true, "help_off": true, "n_importe_quoi": 1}'::jsonb)`);
  check('prefs : studio_tour_dismissed, studio_cards_hidden et home_cards_hidden retenus', prefs.studio_tour_dismissed === true && prefs.studio_cards_hidden[0] === 'news' && prefs.home_cards_hidden[0] === 'mail');
  check('prefs : clés des migrations précédentes (ui_advanced, help_off) toujours acceptées', prefs.ui_advanced === true && prefs.help_off === true);
  check('prefs : clé inconnue ignorée', prefs.n_importe_quoi === undefined);
  check('prefs : studio_tour_dismissed doit être vrai/faux', await fails(`select public.set_my_home_prefs('{"studio_tour_dismissed": "oui"}'::jsonb)`, [], /vrai ou faux/));
  check('prefs : studio_cards_hidden limité à 20 éléments', await fails(`select public.set_my_home_prefs(jsonb_build_object('studio_cards_hidden', (select jsonb_agg(g) from generate_series(1, 21) g)))`, [], /20 éléments/));
  check('prefs : section_tours_seen toujours gérée (fusion)', (await val(`select public.set_my_home_prefs('{"section_tours_seen": ["board"]}'::jsonb)`)).section_tours_seen[0] === 'board');

  // Projets et dernier message
  const pb = await val(`select public.create_project('Projet B', '', true)`);
  let list = await val(`select public.my_projects_latest_messages()`);
  check('projets : 2 projets du studio listés', list.length === 2);
  check('projets : sans message, un projet passe après ceux qui ont un message', list[0].id === pa && list[1].id === pb && list[1].lastAt === null);
  await new Promise(r => setTimeout(r, 20));
  await q(`select public.post_project_message($1, 'Dernier mot sur B')`, [pb]);
  await new Promise(r => setTimeout(r, 20));
  await q(`select public.post_project_message($1, 'Dernier mot sur A')`, [pa]);
  list = await val(`select public.my_projects_latest_messages()`);
  check('projets : le projet au message le plus récent passe en tête', list[0].id === pa && list[0].lastBody === 'Dernier mot sur A' && list[1].id === pb);
  check('projets : auteur du dernier message', list[0].lastAuthor === 'boss@studio.test');
  await as(2);
  check('projets : un membre de l\'équipe voit les mêmes projets', (await val(`select public.my_projects_latest_messages()`)).length === 2);
  await as(3);
  check('projets : un intrus ne voit rien', (await val(`select public.my_projects_latest_messages()`)).length === 0);
  await as(0);
  check('projets : sans compte, rien', (await val(`select public.my_projects_latest_messages()`)).length === 0);
  await as(1);
  await q(`select public.archive_project($1, true)`, [pb]);
  check('projets : un projet archivé n\'apparaît pas', (await val(`select public.my_projects_latest_messages()`)).length === 1);

  // Fichiers
  const fs = require('fs'), read = f => fs.readFileSync(require('path').join(__dirname, f), 'utf8');
  const studio = read('studio.html'), home = read('layerpitch-studio-home.js'), shell = read('layerpitch-shell.js'), projet = read('projet.html');
  check('studio.html : onglet home, composant et api/projects.js chargés', /STUDIO_TABS = \['home'/.test(studio) && /layerpitch-studio-home\.js/.test(studio) && /api\/projects\.js/.test(studio) && /renderHomeTab/.test(studio));
  check('studio.html : Accueil par défaut seulement avec le feu vert et sans onglet demandé', /state\.flags\.studio_home && !tabChosen/.test(studio) && /!state\.flags\.studio_home && state\.tab === 'home'/.test(studio));
  check('menu : entrée « Accueil » de l\'espace studio derrière le feu vert, Albums toujours avant Équipe', /ctx\.flags\.studio_home \? \[\{ id: 'studio\.home'/.test(shell) && /findIndex\(i => i\.id === 'studio\.team'\)/.test(shell));
  check('tchat : lit le projet au dernier message et POSTE (post_project_message via PJ.post)', /my_projects_latest_messages/.test(home) && /PJ\(\)\.post\(chat\.projectId/.test(home) && /id="homeSend"/.test(home) && /homeChatSel/.test(home));
  check('choix : créer, reprendre, moodboard, map, tâches, vidéo, tutoriel', ['home_doCreate', 'home_doResume', 'home_doBoard', 'home_doMap', 'home_doTasks', 'home_doVideo', 'home_doLearn'].every(k => home.includes(k)));
  check('cartes : continuer, essentiels, équipe+palier, packs, activité (si vitrine), nouveautés, réglages', /continueHtml\(\)/.test(home) && /essentialsHtml\(\)/.test(home) && /teamHtml\(\)/.test(home) && /packsHtml\(\)/.test(home) && /!activity\.hasVitrine\) return ''/.test(home) && /newsHtml\(\)/.test(home) && /quickHtml\(\)/.test(home));
  check('idées de l\'Accueil du 14/11 reprises : catalogue, packs, pack custom, équipe, vendre un album (feu vert)', ['home_doCatalog', 'home_doLibrary', 'home_doCustom', 'home_doTeam', 'home_doAlbums'].every(k => home.includes(k)) && /ctx\.flags && ctx\.flags\.sell_albums/.test(home));
  check('Continuer : projets + 3 derniers montages vidéo (list_my_video_captures), ouverts dans l\'atelier', /list_my_video_captures/.test(home) && /data-montage/.test(home) && /onOpenMontage/.test(home) && /onOpenMontage: \(packId, montageId\)/.test(studio) && /svAtelierUrl\(packId, montageId\)/.test(studio));
  check('palier : crédits affichés (myCredits)', /myCredits/.test(home) && /home_teamCredits/.test(home));
  check('cartes : repliables et personnalisables (studio_cards_hidden)', /data-fold/.test(home) && /studio_cards_hidden/.test(home));
  check('Nouveautés : liste vide tant que Jules-Antoine n\'a rien validé', /const NEWS = \[\];/.test(home));
  check('projet.html : ?tab= ouvre l\'onglet, un onglet absent retombe sur le Moodboard', /includes\(params\.get\('tab'\)\)\) S\.tab = params\.get\('tab'\)/.test(projet) && /!visibleTabs\(\)\.includes\(S\.tab\)\) S\.tab = 'board'/.test(projet));
  // Textes FR + EN pour chaque clé home_* du composant
  const i18n = read('layerpitch-i18n.js');
  const keys = [...new Set([...home.matchAll(/\b(home_[A-Za-z_]+)/g)].map(m => m[1]))].filter(k => k !== 'home_prefs').concat(['tab_home']);
  const missing = keys.filter(k => (i18n.split(`${k}:`).length - 1) < 2);
  check('textes FR + EN pour chaque clé home_* du composant (' + keys.length + ' clés)' + (missing.length ? ' — manquent : ' + missing.join(', ') : ''), missing.length === 0);
  check('menu : libellé « Accueil » FR + EN', /"item_studio\.home": "Accueil"/.test(i18n) && /"item_studio\.home": "Home"/.test(i18n));

  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
