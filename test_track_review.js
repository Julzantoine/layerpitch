// Relecture client d'un MORCEAU (23/11, migration 20261123010000) : des liens /relecture/<nom> par morceau, UN PAR CLIENT (même espace de noms que la vidéo ; un client ne voit que les commentaires de son lien),
// commentaires sans compte avec l'instant ET l'état du lecteur, écoute des morceaux protégés avec la preuve du lien, avis au propriétaire
// (cloche + e-mail récapitulatif). Admin seulement jusqu'au feu vert track_review. Base jetable PGlite.
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('PGlite indisponible, test ignoré : ' + e.message); return; }
  const db = await freshDb();
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch (e) { return true; } };
  const U = n => '00000000-0000-0000-0000-00000000000' + n;
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  await db.query(`insert into auth.users (id) values ($1), ($2), ($3)`, [U(1), U(2), U(3)]);
  await db.query(`insert into public.profiles (id) values ($1), ($2), ($3) on conflict do nothing`, [U(1), U(2), U(3)]);
  const owner = await val(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'danny') returning id`, [U(1)]);
  const other = await val(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'autre') returning id`, [U(2)]);
  const plain = await val(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'simple') returning id`, [U(3)]);
  await db.query(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await db.query(`update public.profiles set lang = 'en' where id = $1`, [U(1)]);
  await db.query(`insert into public.tracks (id, owner_id, title, mode, protected) values
    ('t1', $1, 'Combat', 'embranchement-vertical', true), ('t2', $1, 'Section B', 'vertical', true), ('t3', $1, 'Autre morceau', 'static', true),
    ('t9', $2, 'Pas à moi', 'static', false), ('t5', $3, 'Compositeur sans feu vert', 'static', false)`, [owner, other, plain]);
  await db.query(`insert into public.tracks (id, owner_id, title, mode, sections) values ('th', $1, 'Hybride', 'hybrid-sequential', '[{"id":"s1","trackId":"t2"}]'::jsonb)`, [owner]);
  await db.query(`insert into public.sfx_library (id, owner_id, title, protected) values ('fx1', $1, 'Alarme', true), ('fx2', $1, 'Ailleurs', true)`, [owner]);
  await db.query(`insert into public.track_sfx (track_id, sfx_id, position) values ('t2', 'fx1', 0), ('t3', 'fx2', 0)`);

  // --- Propriétaire : créer le lien ---
  const SET = `select public.set_track_review_link($1, null, $2, $3, $4, $5, $6, null) as l`; // nouveau lien
  const LINKS = id => q(`select public.list_track_review_links($1) as l`, [id]).then(r => r[0].l);
  check('feu vert track_review créé fermé', (await q(`select released from public.feature_flags where key = 'track_review'`))[0].released === false);
  await as(3);
  check('feu vert fermé : un compositeur non admin ne peut pas créer de lien', await fails(SET, ['t5', true, 'simple-test', 'magic', null, false]));
  await as(2);
  check('un autre compte ne peut pas créer le lien de mon morceau', await fails(SET, ['t1', true, 'combat', 'magic', null, false]));
  check('un autre compte ne voit pas mes liens', (await LINKS('t1')).length === 0);
  await as(1);
  const link = (await q(SET, ['t1', true, 'combat-v1', 'magic', null, false]))[0].l;
  check('lien magique créé : adresse, actif, clé longue montrée une fois', link.slug === 'combat-v1' && link.enabled && link.mode === 'magic' && link.secret && link.secret.length >= 64);
  const S = link.secret;
  const listed = await LINKS('t1');
  check('la liste des liens ne redonne jamais la clé', listed.length === 1 && listed[0].id === link.id && listed[0].secret === undefined && listed[0].comments === 0);
  // Même espace d'adresses que la vidéo : un montage ne peut pas prendre le nom d'un morceau (et inversement).
  await db.query(`insert into public.packs (id, owner_id, title) values ('p1', $1, 'Pack')`, [owner]);
  await db.query(`insert into public.video_captures (id, owner_id, pack_id, title) values ('cap1', $1, 'p1', 'Montage')`, [owner]);
  check('adresse déjà prise par un morceau : refusée pour un montage', await fails(`select public.set_video_review_link('cap1', true, 'combat-v1', 'magic', null, false, false)`));
  check('un lien vise un seul morceau ou un seul montage', await fails(`insert into public.review_links (capture_id, track_id, slug, salt, iterations, secret_hash) values ('cap1', 't3', 'les-deux', 'x', 1, 'x')`));

  // --- Client (sans compte) ---
  await as(0);
  const acc = (await q(`select public.get_review_access('combat-v1') as a`))[0].a;
  check('accès : mode et genre annoncés, rien d\'autre', acc.mode === 'magic' && acc.kind === 'track' && Object.keys(acc).length === 2);
  check('l\'ancien point d\'accès vidéo ignore les liens de morceau', (await q(`select public.get_video_review_access('combat-v1') as a`))[0].a === null);
  check('la page vidéo ne lit pas un lien de morceau', (await q(`select public.get_video_review('combat-v1', $1) as r`, [S]))[0].r === null);
  check('mauvaise clé : rien', (await q(`select public.get_track_review('combat-v1', 'faux') as r`))[0].r === null);
  const view = (await q(`select public.get_track_review('combat-v1', $1) as r`, [S]))[0].r;
  check('bonne clé : le morceau et une liste vide', view.kind === 'track' && view.trackId === 't1' && view.title === 'Combat' && view.comments.length === 0);
  const ADD = `select public.add_track_review_comment($1, $2, $3, $4::jsonb, $5, $6, $7) as r`;
  const state = { v: 1, mode: 'embranchement-vertical', embr: { loopIdx: 1, label: 'Combat', frac: 0.4 }, triggers: ['alarme'] };
  const c1 = (await q(ADD, ['combat-v1', S, 42.5, JSON.stringify(state), 'Camille', 'Ici c\'est trop chargé', null]))[0].r;
  check('commentaire du client enregistré', c1.ok === true && !!c1.id);
  check('mauvaise clé : commentaire refusé sans erreur', (await q(ADD, ['combat-v1', 'faux', 1, null, 'X', 'Y', null]))[0].r.ok === false);
  check('prénom ou texte vide : refusé', await fails(ADD, ['combat-v1', S, 1, null, '  ', 'Y', null]) && await fails(ADD, ['combat-v1', S, 1, null, 'X', ' ', null]));
  check('état qui n\'est pas un objet : refusé', await fails(ADD, ['combat-v1', S, 1, '[1,2]', 'X', 'Y', null]));
  check('état trop gros : refusé', await fails(ADD, ['combat-v1', S, 1, JSON.stringify({ big: 'x'.repeat(9000) }), 'X', 'Y', null]));
  const r1 = (await q(ADD, ['combat-v1', S, 0, JSON.stringify({ ignore: true }), 'Lou', 'D\'accord', c1.id]))[0].r;
  const after = (await q(`select public.get_track_review('combat-v1', $1) as r`, [S]))[0].r.comments;
  const top = after.find(c => c.id === c1.id), rep = after.find(c => c.id === r1.id);
  check('le commentaire garde son instant et l\'état du lecteur', Number(top.t) === 42.5 && top.state.embr.label === 'Combat' && top.state.triggers[0] === 'alarme');
  check('une réponse reprend l\'instant de son parent, sans état', rep.parentId === c1.id && Number(rep.t) === 42.5 && rep.state === null);

  // --- Écoute des morceaux protégés avec la preuve du lien ---
  const HEAR = `select public.can_hear_track_by_review($1, $2, $3) as ok`;
  check('morceau protégé sans preuve : non', (await q(`select public.can_hear_track('t1') as ok`))[0].ok === false);
  check('morceau relu + bonne clé : oui', (await q(HEAR, ['t1', 'combat-v1', S]))[0].ok === true);
  check('autre morceau protégé + même clé : non', (await q(HEAR, ['t3', 'combat-v1', S]))[0].ok === false);
  check('mauvaise clé : non', (await q(HEAR, ['t1', 'combat-v1', 'faux']))[0].ok === false);
  await as(1);
  const linkH = (await q(SET, ['th', true, 'hybride', 'magic', null, false]))[0].l;
  await as(0);
  check('hybride relu : le morceau d\'une de ses sections s\'écoute aussi', (await q(HEAR, ['t2', 'hybride', linkH.secret]))[0].ok === true);
  check('Sfx d\'une section de l\'hybride relu : oui ; Sfx d\'un autre morceau : non',
    (await q(`select public.can_hear_sfx_by_review('fx1', 'hybride', $1) as ok`, [linkH.secret]))[0].ok === true
    && (await q(`select public.can_hear_sfx_by_review('fx2', 'hybride', $1) as ok`, [linkH.secret]))[0].ok === false);
  await db.query(`delete from public.review_access_failures`);

  // --- Avis au propriétaire : cloche ---
  await as(2);
  check('un autre compte ne voit rien dans sa cloche', (await q(`select public.my_review_updates() as u`))[0].u.length === 0);
  await as(1);
  let upd = (await q(`select public.my_review_updates() as u`))[0].u;
  check('cloche du propriétaire : 2 commentaires sur « Combat », le dernier en tête', upd.length === 1 && upd[0].kind === 'track' && upd[0].targetId === 't1' && upd[0].comments === 2 && upd[0].lastAuthor === 'Lou');

  // --- E-mail récapitulatif ---
  const CLAIM = `select public.claim_review_notices($1, $2) as c`;
  const claim1 = (await q(CLAIM, ['combat-v1', false]))[0].c;
  check('premier e-mail : les 2 avis, la langue et le compte du propriétaire', claim1.notices.length === 2 && claim1.lang === 'en' && claim1.ownerProfileId === U(1) && claim1.title === 'Combat');
  check('rien de neuf : pas d\'e-mail', (await q(CLAIM, ['combat-v1', true]))[0].c === null);
  await as(0);
  await q(ADD, ['combat-v1', S, 10, null, 'Camille', 'Et là aussi', null]);
  check('nouveau commentaire moins de 10 min après un e-mail : il attend', (await q(CLAIM, ['combat-v1', false]))[0].c === null);
  const claim2 = (await q(CLAIM, ['combat-v1', true]))[0].c;
  check('le client quitte la page : le récapitulatif part tout de suite', claim2 && claim2.notices.length === 1);
  await db.query(`select public.release_review_notices($1::uuid[])`, [[claim2.notices[0].id]]);
  check('envoi raté : l\'avis est rendu pour le prochain e-mail', (await q(`select count(*)::int as n from public.review_notices where emailed_at is null`))[0].n === 1);

  // --- Un lien par client : le studio B a son propre lien sur le même morceau ---
  await as(1);
  const linkB = (await q(`select public.set_track_review_link('t1', null, true, 'combat-studio-b', 'magic', null, false, 'Studio B') as l`))[0].l;
  check('deuxième lien sur le même morceau, avec son étiquette', linkB.slug === 'combat-studio-b' && linkB.label === 'Studio B' && linkB.id !== link.id);
  await as(0);
  check('le studio B ne voit aucun commentaire du studio A', (await q(`select public.get_track_review('combat-studio-b', $1) as r`, [linkB.secret]))[0].r.comments.length === 0);
  const cB = (await q(ADD, ['combat-studio-b', linkB.secret, 5, null, 'Max', 'Avis du studio B', null]))[0].r;
  check('le studio A ne voit pas le commentaire du studio B', !(await q(`select public.get_track_review('combat-v1', $1) as r`, [S]))[0].r.comments.some(c => c.id === cB.id));
  check('le studio B ne peut pas répondre sous un commentaire du studio A', await fails(ADD, ['combat-studio-b', linkB.secret, 0, null, 'Max', 'x', c1.id]));
  await as(1);
  const both = await LINKS('t1');
  check('le propriétaire voit ses deux liens, chacun avec ses commentaires', both.length === 2 && both.find(l => l.id === link.id).comments === 2 && both.find(l => l.id === linkB.id).comments === 1);
  const bell = (await q(`select public.my_review_updates() as u`))[0].u;
  check('cloche : une ligne par lien (client), avec son étiquette', bell.length === 2 && bell.some(u => u.label === 'Studio B' && u.comments === 1));
  check('un autre compte ne peut pas régler ni supprimer mon lien', await (async () => { await as(2); const r = await fails(`select public.set_track_review_link('t1', $1, false, null, null, null, false, null)`, [linkB.id]) && await fails(`select public.delete_track_review_link($1)`, [linkB.id]); await as(1); return r; })());

  // --- Le propriétaire ouvre les commentaires : tout est lu ---
  await as(1);
  const mine = (await q(`select public.list_track_review_comments('t1') as l`))[0].l;
  check('le propriétaire lit tous les commentaires, de tous ses liens, rangés par lien', mine.length === 4 && mine.find(c => c.id === c1.id).state.embr.loopIdx === 1 && mine.find(c => c.id === cB.id).linkId === linkB.id);
  check('les avis sont lus : la cloche se vide', (await q(`select public.my_review_updates() as u`))[0].u.length === 0);
  check('et un avis déjà lu ne part plus par e-mail', (await q(CLAIM, ['combat-v1', true]))[0].c === null);
  await db.query(`select public.reply_review_comment($1, 'Je baisse les cuivres', 'Danny', false)`, [c1.id]);
  await db.query(`select public.resolve_review_comment($1, true, false)`, [c1.id]);
  const mine2 = (await q(`select public.list_track_review_comments('t1') as l`))[0].l;
  check('réponse du propriétaire et « traité » enregistrés', mine2.some(c => c.fromOwner && c.body === 'Je baisse les cuivres') && mine2.find(c => c.id === c1.id).resolved === true);
  check('une réponse du propriétaire ne le notifie pas lui-même', (await q(`select public.my_review_updates() as u`))[0].u.length === 0);
  await as(2);
  check('un autre compte ne peut ni répondre ni résoudre ni supprimer', await fails(`select public.reply_review_comment($1, 'x', 'x', false)`, [c1.id])
    && await fails(`select public.resolve_review_comment($1, true, false)`, [c1.id]) && await fails(`select public.delete_review_comment($1, false)`, [c1.id]));
  check('un autre compte ne lit pas mes commentaires', (await q(`select public.list_track_review_comments('t1') as l`))[0].l.length === 0);

  // --- Désactiver, puis supprimer le morceau ---
  await as(1);
  await q(`select public.set_track_review_link('t1', $1, false, null, null, null, false, null)`, [link.id]);
  check('renommer l\'étiquette d\'un lien existant', (await q(`select public.set_track_review_link('t1', $1, null, null, null, null, false, 'Studio A') as l`, [link.id]))[0].l.label === 'Studio A');
  await db.query(`select public.delete_track_review_link($1)`, [linkB.id]);
  check('supprimer le lien du studio B emporte ses commentaires, l\'adresse est libérée', (await q(`select count(*)::int as n from public.review_comments where id = $1`, [cB.id]))[0].n === 0
    && (await q(`select public.get_review_access('combat-studio-b') as a`))[0].a === null);
  await as(0);
  check('lien désactivé : plus d\'accès, plus d\'écoute protégée', (await q(`select public.get_review_access('combat-v1') as a`))[0].a === null && (await q(HEAR, ['t1', 'combat-v1', S]))[0].ok === false);
  await db.query(`delete from public.tracks where id = 't1'`);
  check('morceau supprimé : son lien, ses commentaires et ses avis partent avec lui',
    (await q(`select count(*)::int as n from public.review_links where track_id = 't1'`))[0].n === 0
    && (await q(`select count(*)::int as n from public.review_comments where track_id = 't1'`))[0].n === 0);

  // --- Feu vert ouvert : un compositeur ordinaire peut s'en servir ---
  await db.query(`update public.feature_flags set released = true where key = 'track_review'`);
  await as(3);
  check('feu vert ouvert : un compositeur crée le lien de son morceau', (await q(SET, ['t5', true, 'simple-test', 'magic', null, false]))[0].l.slug === 'simple-test');

  const anonGrants = await q(`select count(*)::int as n from information_schema.routine_privileges where grantee = 'anon' and routine_name in ('list_track_review_links','set_track_review_link','delete_track_review_link','list_track_review_comments','reply_review_comment','resolve_review_comment','delete_review_comment','my_review_updates','claim_review_notices','release_review_notices','track_review_track','review_link_open')`);
  check('les fonctions du propriétaire et internes ne sont pas ouvertes à anon', anonGrants[0].n === 0);

  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
  process.exit(failures ? 1 : 0);
})();
