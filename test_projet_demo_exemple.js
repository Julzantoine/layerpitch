// Projet de démonstration copié dans les Projets de chaque bêta-testeur (migration 20261118020000) : feu vert, une seule fois,
// copie à soi (compositeur ou studio), références redirigées, rien de lourd copié, vitrines non publiées, jamais la démo publique,
// hors quota, suppression en un clic sans toucher à la source. Base jetable PGlite. Prérequis : npm install.
const path = require('path');
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
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  const fails = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const mk = async (n, email, opts) => {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), email]);
    await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]);
    await q(`update public.profiles set onboarding_completed = $2, lang = 'fr' where id = $1`, [U(n), !(opts && opts.noOnboarding)]);
    if (!opts || !opts.noComposer) await q(`insert into public.composer_profiles (profile_id, handle, plan) values ($1, $2, 'pro')`, [U(n), 'h' + n]);
  };
  await q(`update public.beta_program set full_access = false`);
  await q(`update public.feature_flags set released = true where key in ('projects', 'project_sections', 'project_tasks', 'project_appearance')`);

  // ---- Source : le Projet de démonstration (compte 1, administrateur), construit avec les vraies fonctions.
  await mk(1, 'jules@x.test');
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await as(1);
  const src = await val(`select public.create_project('Dernier Étage', 'Projet fictif')`);
  const compSrc = await val(`select id from public.composer_profiles where profile_id = $1`, [U(1)]);
  await q(`insert into public.packs (id, owner_id, title) values ('pack-demo', $1, 'Pack démo')`, [compSrc]);
  const add = async (p, pin) => (await val(`select public.add_project_asset($1, $2::jsonb, $3)`, [src, JSON.stringify(p), !!pin])).id;
  const note = await add({ kind: 'note', title: 'La lampe', body: 'Objet de jeu' }, true);
  const link = await add({ kind: 'link', url: 'https://example.com/ref', title: 'Référence' }, true);
  const packAsset = await add({ kind: 'pack', packId: 'pack-demo', title: 'Pack démo' }, false);
  const f = await val(`select public.reserve_project_file($1, 'couloir.png', 1000)`, [src]);
  await q(`select public.complete_project_file($1)`, [f.fileId]);
  await add({ kind: 'image', fileId: f.fileId, title: 'Couloir' }, true);
  const sec = (await val(`select public.create_project_section($1, 'Musique')`, [src])).id;
  const sec2 = (await val(`select public.create_project_section($1, 'Sous-musique', $2)`, [src, sec])).id;
  await q(`select public.pin_asset_in_section($1, $2, true)`, [sec, note]);
  const map = (await val(`select public.save_project_map($1, $2::jsonb)`, [src, JSON.stringify({ title: 'Niveau 1', data: { nodes: [], edges: [] } })])).id;
  const task = (await val(`select public.create_project_task($1, $2::jsonb)`, [src, JSON.stringify({ title: 'Poser le drone', notes: 'x', sectionId: sec })])).id;
  await q(`update public.project_tasks set done = true, done_at = now(), done_by = $2 where id = $1`, [task, U(1)]);
  await q(`select public.post_project_message($1, 'Théo : bonjour')`, [src]);
  await q(`select public.post_project_message($1, 'Inès : salut')`, [src]);
  await q(`select public.add_project_annotation($1, 'asset', $2, null, 'Note publique', null, null, false)`, [src, note]);
  await q(`select public.add_project_annotation($1, 'asset', $2, null, 'Note privée', null, null, true)`, [src, note]);
  await q(`select public.set_project_appearance($1, $2::jsonb)`, [src, JSON.stringify({ bg: '#2f80c0' })]);
  await q(`select public.save_project_vitrine($1, $2::jsonb)`, [src, JSON.stringify({ audience: 'players', display: 'page', title: 'Dernier Étage', subtitle: 's', published: true, theme: {}, blocks: [{ id: 'vb1', type: 'packs', assetIds: [packAsset] }] })]);
  await q(`select public.save_project_vitrine($1, $2::jsonb)`, [src, JSON.stringify({ audience: 'publisher', display: 'page', title: 'Dernier Étage éditeur', subtitle: 's', published: true, theme: {}, blocks: [{ id: 'vb1', type: 'text', content: 'x' }] })]);
  await q(`select public.set_public_demo($1, true)`, [src]);
  const srcCounts = async () => JSON.stringify(await q(`select (select count(*) from public.project_assets where project_id = '${src}') a,
    (select count(*) from public.project_files where project_id = '${src}') f, (select count(*) from public.project_messages where project_id = '${src}') m,
    (select count(*) from public.packs where id = 'pack-demo') p`));
  const before = await srcCounts();

  // ---- Comptes : un compositeur, un studio (propriétaire), un compte avant l'accueil, un compte sans profil studio/compositeur.
  await mk(2, 'ana@x.test');
  await mk(3, 'studio@x.test', { noComposer: true });
  await q(`insert into public.studio_profiles (profile_id) values ($1)`, [U(3)]);
  await mk(4, 'nouveau@x.test', { noOnboarding: true });
  await mk(5, 'rien@x.test', { noComposer: true });

  // ---- Feu vert fermé : rien pour un non-admin
  await as(2);
  check('feu vert fermé : rien n\'est ajouté pour un non-admin', (await val(`select public.seed_my_demo_project()`)).skipped === 'flag'
    && (await val(`select count(*)::int from public.projects where created_by = $1`, [U(2)])) === 0);
  await q(`update public.feature_flags set released = true where key = 'example_project'`);
  await as(4);
  check('avant l\'accueil : rien n\'est ajouté', (await val(`select public.seed_my_demo_project()`)).skipped === 'onboarding');
  await as(5);
  check('compte sans profil compositeur : rien', (await val(`select public.seed_my_demo_project()`)).skipped === 'no_composer');
  check('compte sans profil studio (copie studio demandée) : rien', (await val(`select public.seed_my_demo_project(true)`)).skipped === 'no_studio');
  await as(1);
  check('le propriétaire de la démo ne se fait pas de copie', (await val(`select public.seed_my_demo_project()`)).skipped === 'source_owner');

  // ---- Ajout (compositeur)
  await as(2);
  const r1 = await val(`select public.seed_my_demo_project()`);
  check('ajout : une copie à soi, signalée seeded', r1.seeded === true && !!r1.projectId);
  const copy = r1.projectId;
  const P = (await q(`select * from public.projects where id = $1`, [copy]))[0];
  check('la copie porte le titre de la source, appartient au compositeur, n\'est pas la démo publique',
    P.title === 'Dernier Étage' && P.owner_kind === 'composer' && P.owner_profile_id === U(2) && P.created_by === U(2) && P.demo_source_id === src && P.public_demo === false);
  check('la liste dit que c\'est une démo', (await val(`select public.list_my_projects()`)).some(p => p.id === copy && p.isDemo === true && p.role === 'admin'));
  check('la fiche dit que c\'est une démo', (await val(`select public.get_project($1)`, [copy])).isDemo === true);
  check('la source n\'est pas marquée démo dans sa liste', (await (async () => { await as(1); const l = await val(`select public.list_my_projects()`); await as(2); return l.find(p => p.id === src).isDemo === false; })()));

  const A = await q(`select * from public.project_assets where project_id = $1 order by created_at`, [copy]);
  check('objets copiés : note, lien, pack (les images déposées ne sont pas reprises)', A.length === 3 && A.some(a => a.kind === 'note' && a.title === 'La lampe')
    && A.some(a => a.kind === 'link') && A.some(a => a.kind === 'pack' && a.pack_id === 'pack-demo'));
  check('aucun fichier déposé n\'est copié', (await val(`select count(*)::int from public.project_files where project_id = $1`, [copy])) === 0 && A.every(a => a.file_id === null));
  check('nouveaux identifiants, auteur = le compte', A.every(a => ![note, link, packAsset].includes(a.id) && a.created_by === U(2)));
  const noteCopy = A.find(a => a.kind === 'note').id;
  check('Moodboard : la note et le lien sont épinglés, pas le pack', (await val(`select count(*)::int from public.project_moodboard_pins where project_id = $1`, [copy])) === 2);
  const S = await q(`select * from public.project_sections where project_id = $1`, [copy]);
  const sMus = S.find(s => s.title === 'Musique'), sSub = S.find(s => s.title === 'Sous-musique');
  check('sections copiées, arbre conservé', S.length === 2 && sSub.parent_id === sMus.id && sMus.id !== sec && sMus.parent_id === null);
  check('la note est dans la section copiée', (await val(`select count(*)::int from public.project_section_assets where section_id = $1 and asset_id = $2`, [sMus.id, noteCopy])) === 1);
  check('carte de niveau copiée', (await val(`select count(*)::int from public.project_maps where project_id = $1 and title = 'Niveau 1' and id <> $2`, [copy, map])) === 1);
  const T = (await q(`select * from public.project_tasks where project_id = $1`, [copy]))[0];
  check('tâche copiée : case cochée, rattachée à la section copiée', T && T.done === true && T.section_id === sMus.id && T.done_by === U(2));
  const M = await q(`select * from public.project_messages where project_id = $1 order by created_at`, [copy]);
  check('discussion copiée à son nom, datée d\'avant maintenant, dans le même ordre', M.length === 2 && M[0].body.startsWith('Théo') && M[1].body.startsWith('Inès')
    && M.every(m => m.author_id === U(2) && new Date(m.created_at) <= new Date()) && new Date(M[0].created_at) < new Date(M[1].created_at));
  const N = await q(`select * from public.project_annotations where project_id = $1`, [copy]);
  check('notes : seulement les publiques, rattachées à la copie de l\'objet', N.length === 1 && N[0].body === 'Note publique' && N[0].target_id === noteCopy && N[0].private === false);
  check('apparence copiée', (await val(`select data->>'bg' from public.project_appearance where project_id = $1`, [copy])) === '#2f80c0');
  const V = await q(`select * from public.project_vitrines where project_id = $1 order by audience`, [copy]);
  const packCopy = A.find(a => a.kind === 'pack').id;
  check('vitrines copiées NON publiées, adresses libres et uniques', V.length === 2 && V.every(v => v.published === false)
    && new Set([...V.map(v => v.slug), ...(await q(`select slug from public.project_vitrines where project_id = $1`, [src])).map(v => v.slug)]).size === 4);
  check('vitrine : le bloc pointe vers la copie du pack', V.find(v => v.audience === 'players').blocks[0].assetIds[0] === packCopy);
  check('vitrine éditeur : lien secret neuf', !!V.find(v => v.audience === 'publisher').secret_token
    && V.find(v => v.audience === 'publisher').secret_token !== (await val(`select secret_token from public.project_vitrines where project_id = $1 and audience = 'publisher'`, [src])));
  check('une cloche explique la démarche', (await val(`select count(*)::int from public.admin_messages where recipient_id = $1 and title->>'fr' = 'Un projet de démo dans tes Projets'`, [U(2)])) === 1);
  check('la source est intacte', (await srcCounts()) === before);

  // ---- Une seule fois
  check('deuxième appel : rien de plus', (await val(`select public.seed_my_demo_project()`)).skipped === 'done'
    && (await val(`select count(*)::int from public.projects where demo_source_id is not null and created_by = $1`, [U(2)])) === 1);

  // ---- Jamais la démo publique ; hors quota
  await as(1);
  check('une copie ne peut pas devenir la démo publique (même par un administrateur)', await fails(`select public.set_public_demo($1, true)`, [copy], /ne peut pas devenir/));
  await q(`update public.feature_flags set released = true where key = 'projects'`);
  await as(2);
  await q(`delete from public.plan_entitlements where feature = 'projects' and plan = 'pro'`);
  await q(`insert into public.plan_entitlements (plan, feature, allowed, amount) values ('pro', 'projects', true, 1)`);
  const own = await val(`select public.create_project('Mon vrai projet')`);
  check('la démo ne compte pas dans la limite de Projets (limite 1, démo + un vrai Projet)', !!own);
  check('un deuxième vrai Projet est bien refusé par la limite', await fails(`select public.create_project('Deux')`, [], /Limite atteinte/));

  // ---- Studio : copie dans l'espace du studio
  await as(3);
  const r3 = await val(`select public.seed_my_demo_project(true)`);
  const P3 = r3.seeded ? (await q(`select * from public.projects where id = $1`, [r3.projectId]))[0] : null;
  check('studio : la copie est un Projet de studio', P3 && P3.owner_kind === 'studio' && P3.owner_profile_id === null && P3.owner_studio_id && P3.created_by === U(3));
  check('studio : le Projet est dans sa liste, en admin', (await val(`select public.list_my_projects()`)).some(p => p.id === r3.projectId && p.role === 'admin' && p.isDemo));

  // ---- Suppression en un clic
  await as(2);
  const rm = await val(`select public.remove_my_demo_project()`);
  check('suppression : la copie disparaît (et seulement elle)', rm.removed === 1
    && (await val(`select count(*)::int from public.projects where id = $1`, [copy])) === 0
    && (await val(`select count(*)::int from public.projects where id = $1`, [own])) === 1);
  check('suppression : tout son contenu part avec (objets, messages, vitrines, tâches)', (await val(`select (select count(*) from public.project_assets where project_id = '${copy}')
    + (select count(*) from public.project_messages where project_id = '${copy}') + (select count(*) from public.project_vitrines where project_id = '${copy}')
    + (select count(*) from public.project_tasks where project_id = '${copy}')`)) == 0);
  check('suppression : la source, son pack et ses fichiers sont intacts', (await srcCounts()) === before && (await val(`select public_demo from public.projects where id = $1`, [src])) === true);
  check('la copie du studio n\'est pas touchée par la suppression d\'un autre compte', (await val(`select count(*)::int from public.projects where id = $1`, [r3.projectId])) === 1);
  check('suppression : l\'ajout ne se refait pas ensuite', (await val(`select public.seed_my_demo_project()`)).skipped === 'done'
    && (await val(`select count(*)::int from public.projects where demo_source_id is not null and created_by = $1`, [U(2)])) === 0);
  check('supprimer quand il n\'y a plus rien ne plante pas', (await val(`select public.remove_my_demo_project()`)).removed === 0);

  // ---- Pas de source : rien, et le marqueur n'est pas posé (la démo pourra arriver plus tard)
  await as(1); await q(`select public.set_public_demo($1, false)`, [src]);
  await mk(6, 'tard@x.test');
  await as(6);
  check('sans Projet de démo en base : rien, sans marquer le compte', (await val(`select public.seed_my_demo_project()`)).skipped === 'no_source'
    && (await val(`select demo_project_seeded_at from public.profiles where id = $1`, [U(6)])) === null);

  // ---- Message natif modifiable
  await as(1);
  await q(`select public.admin_update_native_message('demo_project', '{"fr": "x"}'::jsonb)`);
  check('le message « demo_project » est modifiable par un admin', (await val(`select body->>'fr' from public.platform_message_templates where key = 'demo_project'`)) === 'x');

  // ---- Côté pages : branchements et textes (FR + EN)
  const fs = require('fs');
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const i18n = read('layerpitch-i18n.js');
  check('api/projects.js : ajout et suppression de la démo', /seed_my_demo_project/.test(read('api/projects.js')) && /remove_my_demo_project/.test(read('api/projects.js')));
  check('Backstage (compositeur) : ajout de la démo au chargement, après les exemples', /seedMyDemoProjectNow/.test(read('src/backstage/45-exemples.js')) && /seed_my_demo_project/.test(read('layerpitch-backstage.html')));
  check('accueil studio : ajout de la démo (en studio)', /seedDemoCopy\(true\)/.test(read('studio.html')));
  check('liste des Projets : bouton « Supprimer la démo » sur la copie', /data-remove-demo/.test(read('projets.html')) && /removeDemoCopy/.test(read('projets.html')));
  check('page Projet : bandeau et bouton « Supprimer la démo »', /demoCopyRemoveBtn/.test(read('projet.html')) && /removeDemoCopy/.test(read('projet.html')));
  check('textes FR et EN de la démo présents', ['demoCopyBadge', 'demoCopyBanner', 'demoCopyRemove', 'demoCopyConfirm', 'demoCopyRemoved'].every(k => (i18n.match(new RegExp(`\\b${k}:`, 'g')) || []).length === 2));

  console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
