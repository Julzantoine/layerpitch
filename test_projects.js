// Étape 5 du chantier profils et permissions (migrations 20260928070000 et 20260928080000) : Projets.
// Création et quotas (compositeur Warrior 1 / Boss 5, studio Indie 1), accès uniforme, équipe du studio d'office, invités
// gratuits, discussion + recherche, tableau (coexistence : morceaux et packs par leur propriétaire seulement), fichiers et
// quota du PROPRIÉTAIRE, vidéos et annotations horodatées adressées (notification), packs partagés / offerts, albums,
// versions, vitrine publique, feu vert, isolation. Base jetable PGlite.
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

  await mk(1, 'compo@x.test'); await mk(2, 'boss@studio.test'); await mk(3, 'marie@studio.test'); await mk(4, 'invite@x.test'); await mk(5, 'intrus@x.test');
  const c1 = (await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'starter') returning id`, [U(1)]))[0].id;
  await as(1);
  check('feu vert fermé : création refusée à un non-admin', await fails(`select public.create_project('X')`, [], /pas inclus/));
  await db.query(`update public.feature_flags set released = true where key in ('projects', 'studio_space')`);
  const pc = await val(`select public.create_project('Jeu forêt', 'préprod')`);
  check('compositeur Warrior : 1 Projet créé', !!pc);
  check('compositeur Warrior : 2e Projet refusé (limite 1)', await fails(`select public.create_project('Deux')`, [], /Limite atteinte : 1/));

  // Studio Indie avec Marie dans l'équipe
  await as(2);
  const sid = await val(`select public.ensure_studio_profile()`);
  await q(`update public.studio_profiles set plan = 'indie' where id = $1`, [sid]);
  const mm = await val(`select public.invite_team_member('marie@studio.test')`);
  await as(3); await q(`select public.respond_team_invitation($1, true)`, [mm]);
  await as(2);
  const ps = await val(`select public.create_project('OST officielle', '', true)`);
  check('studio Indie : Projet de studio créé', !!ps);
  await as(3);
  check('Marie (équipe du studio) a accès d\'office, sans invitation', (await val(`select public.get_project($1)`, [ps])).role === 'member');
  check('Marie : 2e Projet du studio refusé (limite Indie 1, projets de toute l\'équipe)', await fails(`select public.create_project('Bis', '', true)`, [], /Limite atteinte : 1/));

  // Invité gratuit : le compositeur est invité dans le Projet du studio
  await as(2);
  check('un membre simple ne peut pas inviter (administrateur seulement)', await (async () => { await as(3); const r = await fails(`select public.invite_project_member($1, 'x@x.test')`, [ps], /administrateur/); await as(2); return r; })());
  const inv = await val(`select public.invite_project_member($1, 'compo@x.test')`, [ps]);
  await as(5);
  check('un intrus ne voit pas le Projet', await fails(`select public.get_project($1)`, [ps], /introuvable/));
  check('un intrus ne peut pas accepter l\'invitation d\'un autre', await fails(`select public.respond_project_invitation($1, true)`, [inv], /introuvable/));
  await as(1);
  check('l\'invité voit son invitation', (await val(`select public.my_project_invitations()`)).length === 1);
  await q(`select public.respond_project_invitation($1, true)`, [inv]);
  check('invité accepté : accès complet (membre)', (await val(`select public.get_project($1)`, [ps])).role === 'member');
  check('liste de mes Projets : le mien + celui du studio', (await val(`select public.list_my_projects()`)).length === 2);
  const members = (await val(`select public.get_project($1)`, [ps])).members;
  check('membres du Projet de studio : propriétaire, Marie (équipe) et l\'invité', members.length === 3 && members.some(m => m.source === 'guest' && m.status === 'active'));

  // Discussion + recherche
  const m1 = await val(`select public.post_project_message($1, 'On garde le thème du boss en mineur ?')`, [ps]);
  await as(3); await q(`select public.post_project_message($1, 'Oui, et la forêt reste calme')`, [ps]);
  check('recherche plein texte : « boss » trouve le bon message', (await val(`select public.list_project_messages($1, null, 50, 'boss')`, [ps])).length === 1);
  check('seul l\'auteur modifie son message', await fails(`select public.edit_project_message($1, 'piraté')`, [m1], /introuvable/));

  // Tableau : coexistence
  await q(`insert into public.tracks (id, owner_id, title, mode) values ('t1', $1, 'Thème forêt', 'static')`, [c1]);
  await q(`insert into public.packs (id, owner_id, title, price_eur_cents) values ('pk1', $1, 'Pack forêt', 1000)`, [c1]);
  await q(`insert into public.tracks (id, owner_id, title, mode) values ('t9', $1, 'Dans le pack', 'static')`, [c1]);
  await q(`insert into public.pack_tracks (pack_id, track_id, position) values ('pk1', 't9', 0)`);
  await as(3);
  check('Marie ne peut pas ajouter le morceau d\'un autre', await fails(`select public.add_project_item($1, '{"kind":"track","trackId":"t1"}'::jsonb)`, [ps], /propres morceaux/));
  await q(`select public.add_project_item($1, '{"kind":"link","url":"https://youtu.be/abc","title":"Référence"}'::jsonb)`, [ps]);
  check('lien sans http refusé', await fails(`select public.add_project_item($1, '{"kind":"link","url":"javascript:alert(1)"}'::jsonb)`, [ps], /Lien invalide/));
  await as(1);
  const it = await val(`select public.add_project_item($1, '{"kind":"track","trackId":"t1","title":"Thème"}'::jsonb)`, [ps]);
  check('le compositeur ajoute son propre morceau (lien, pas de copie)', !!it);

  // Packs : partager puis offrir au studio
  await q(`select public.share_pack_in_project($1, 'pk1', 'share')`, [ps]);
  await as(3);
  check('pack partagé : Marie peut l\'épingler au tableau', !!(await val(`select public.add_project_item($1, '{"kind":"pack","packId":"pk1"}'::jsonb)`, [ps])));
  check('Marie ne peut pas « offrir » un pack qui ne lui appartient pas', await fails(`select public.share_pack_in_project($1, 'pk1', 'offer')`, [ps], /propres packs/));
  await as(1);
  await q(`select public.share_pack_in_project($1, 'pk1', 'offer')`, [ps]);
  check('pack offert : acquis par le studio (compte propriétaire), à 0 €, source cadeau', (await q(`select price_paid, source from public.pack_purchases where studio_id = $1 and pack_id = 'pk1'`, [U(2)]))[0].source === 'gift');
  await as(3);
  check('la bibliothèque de l\'équipe contient le pack offert', (await q(`select * from public.my_owned_assets()`)).some(a => a.pack_id === 'pk1'));
  check('offrir au Projet d\'un compositeur : refusé', await (async () => { await as(1); return fails(`select public.share_pack_in_project($1, 'pk1', 'offer')`, [pc], /studio propriétaire/); })());

  // Fichiers : quota du propriétaire (studio Indie 20 Go)
  await as(3);
  check('type non accepté (.html) refusé', await fails(`select public.reserve_project_file($1, 'page.html', 1000)`, [ps], /non accepté/));
  const f = await val(`select public.reserve_project_file($1, 'capture.mp4', 1000000)`, [ps]);
  check('réservation d\'un fichier : chemin rangé sous projects/<id>/', f.path.startsWith('projects/' + ps + '/') && f.mimeType === 'video/mp4');
  check('fichier plus lourd que la limite du type (vidéo 2 Go) : refusé', await fails(`select public.reserve_project_file($1, 'enorme.mp4', $2)`, [ps, 3 * 1024 * 1024 * 1024], /trop lourd/));
  await q(`insert into public.account_entitlement_overrides (profile_id, feature, allowed, amount, note) values ($1, 'studio_storage_gb', true, 0.001, 'test : ~1 Mo')`, [U(2)]);
  check('quota du PROPRIÉTAIRE (studio) dépassé : refusé, même pour un membre qui envoie', await fails(`select public.reserve_project_file($1, 'b.mp4', 500000)`, [ps], /Quota de stockage du propriétaire/));
  await q(`delete from public.account_entitlement_overrides where profile_id = $1`, [U(2)]);
  await q(`select public.complete_project_file($1)`, [f.fileId]);
  const vid = await val(`select public.add_project_video($1, 'upload', $2, null, 'Gameplay niveau 1')`, [ps, f.fileId]);
  check('lien vidéo non YouTube/Vimeo refusé', await fails(`select public.add_project_video($1, 'link', null, 'https://exemple.com/v', 'x')`, [ps], /YouTube ou Vimeo/));
  // Annotation horodatée adressée au compositeur → notification
  await q(`select public.add_project_annotation($1, 'video', $2, 12.5, 'La musique doit monter ici', $3)`, [ps, vid, U(1)]);
  check('annotation adressée à un non-membre : refusée', await fails(`select public.add_project_annotation($1, 'video', $2, 3, 'x', $3)`, [ps, vid, U(5)], /destinataire/));
  await as(1);
  const notes = await val(`select public.my_project_notifications(true)`);
  check('le destinataire reçoit une notification (extrait, instant)', notes.length === 1 && notes[0].payload.atSeconds === 12.5);
  const ann = await val(`select public.list_project_annotations($1, 'video', $2)`, [ps, vid]);
  check('annotations de la vidéo, triées par instant', ann.length === 1 && Number(ann[0].atSeconds) === 12.5);
  await q(`select public.resolve_project_annotation($1, true)`, [ann[0].id]);
  check('annotation résolue', (await val(`select public.list_project_annotations($1, 'video', $2)`, [ps, vid]))[0].resolved === true);
  await q(`select public.mark_project_notifications_read($1)`, [ps]);
  check('notifications marquées lues', (await val(`select public.my_project_notifications(true)`)).length === 0);

  // Versions du tableau
  const snap = await val(`select public.create_project_snapshot($1, 'Avant refonte')`, [ps]);
  const before = (await val(`select public.get_project_content($1)`, [ps])).items.length;
  await q(`select public.delete_project_item($1)`, [it]);
  await q(`select public.restore_project_snapshot($1)`, [snap]);
  const content = await val(`select public.get_project_content($1)`, [ps]);
  check('retour à une version : le tableau retrouve ses éléments, l\'état d\'avant est figé', content.items.length === before && (await val(`select public.list_project_snapshots($1)`, [ps])).length === 2);

  // Vitrine publique
  const vlink = await val(`select public.add_project_video($1, 'link', null, 'https://www.youtube.com/watch?v=xyz', 'Trailer')`, [ps]);
  await as(3);
  check('un membre simple ne publie pas la vitrine', await fails(`select public.save_project_showcase($1, '{"published":true}'::jsonb)`, [ps], /administrateur/));
  await as(2);
  check('vitrine : une vidéo envoyée (privée) ne peut pas y figurer', await fails(`select public.save_project_showcase($1, $2::jsonb)`, [ps, JSON.stringify({ published: true, entries: [{ kind: 'video', refId: vid }] })], /introuvable/));
  await q(`select public.save_project_showcase($1, $2::jsonb)`, [ps, JSON.stringify({ published: true, title: 'OST', steamUrl: 'https://store.steampowered.com/app/1', entries: [{ kind: 'track', refId: 't1' }, { kind: 'video', refId: vlink }] })]);
  await as(0); await db.query(`set role anon`);
  const pub = await val(`select public.get_project_showcase($1)`, [ps]);
  await db.query(`reset role`);
  check('vitrine publiée lisible sans compte, sans rien d\'autre du Projet', pub && pub.entries.length === 2 && pub.entries[0].title === 'Thème forêt' && !('items' in pub));
  await as(2);
  await q(`select public.save_project_showcase($1, '{"published":false}'::jsonb)`, [ps]);
  await as(5);
  check('vitrine dépubliée : invisible pour un inconnu', (await val(`select public.get_project_showcase($1)`, [ps])) === null);

  // Départ, suppression, isolation
  await as(1);
  const myRow = (await val(`select public.get_project($1)`, [ps])).members.find(m => m.me && m.source === 'guest');
  await q(`select public.remove_project_member($1)`, [myRow.id]);
  check('l\'invité quitte le Projet : plus d\'accès', await fails(`select public.get_project($1)`, [ps], /introuvable/));
  await as(3);
  check('un membre simple ne supprime pas le Projet', await fails(`select public.delete_project($1)`, [ps], /administrateur/));
  await as(2);
  const del = await val(`select public.delete_project($1)`, [ps]);
  check('suppression par l\'administrateur : chemins des fichiers rendus pour effacement', del.filePaths.length === 1 && (await val(`select count(*)::int from public.project_items`)) === 0);
  await db.query(`set role authenticated`);
  check('tables des Projets illisibles directement', (await q(`select * from public.projects`)).length === 0 && (await q(`select * from public.project_messages`)).length === 0);
  await db.query(`reset role`);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
