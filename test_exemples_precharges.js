// Exemples préchargés + questions de profil (4/11, migration 20261104020000) : copie une seule fois, noms dans la langue
// du compte, fichiers partagés (base de la source), références internes redirigées, jamais public, interdits refusés,
// exclusions (annuaire, catalogue, sitemap, quota, statistiques), retrait sans toucher aux sources, questions de profil.
// Base jetable PGlite. Prérequis : npm install.
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
  const failsWith = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const asRole = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn(); } finally { await db.exec('reset role'); } };
  const mk = async (n, handle, lang) => {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), `c${n}@x.test`]);
    await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]);
    await q(`update public.profiles set lang = $2, onboarding_completed = true where id = $1`, [U(n), lang || null]);
    return (await q(`insert into public.composer_profiles (profile_id, handle) values ($1, $2) returning id`, [U(n), handle]))[0].id;
  };

  // Compte source (Jules-Antoine, admin) : les 6 morceaux du catalogue + les 3 Sfx.
  const src = await mk(1, 'jules');
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await q(`insert into public.track_folders (id, label, owner_id) values ('fsrc', 'Jazz +/-', $1)`, [src]);
  const SFX = ['bmvjel4krqhewx', 'bmvjelkpymwo8r', 'bmvjew5nmxel2r'];
  for (const [i, id] of SFX.entries())
    await q(`insert into public.sfx_library (id, owner_id, title, base, alternatives) values ($1, $2, $3, $4, '[{"file":"0-a.ogg"}]')`,
      [id, src, ['Glaçons', 'Se Remplir un Verre', 'Se balader dans le Bar'][i], `https://media.layerpitch.com/audio/sfx-${id}/`]);
  const TR = { bmvjfdonbsfnkd: 'static', bmvidp6unbjfkq: 'embranchement-vertical', bmvidtfhvfa5tt: 'vertical', bmvin15j2vxt4p: 'vertical-random', bmvi797lv98i68: 'sequential', bmvidx6a4320my: 'sequential' };
  for (const [id, mode] of Object.entries(TR))
    await q(`insert into public.tracks (id, owner_id, folder_id, title, mode, base, tags, layers, fx_triggers) values ($1, $2, 'fsrc', $3, $4, $5, '{jazz}', '[{"file":"0-l.ogg","label":"L"}]', $6)`,
      [id, src, 'Src ' + id, mode, `https://media.layerpitch.com/audio/${id}/`,
       id === 'bmvjfdonbsfnkd' ? JSON.stringify([{ id: 'trig1', label: 'Radio', target: { type: 'sfx', sfxId: SFX[0] } }]) : '[]']);
  for (const [i, s] of SFX.entries()) await q(`insert into public.track_sfx (track_id, sfx_id, position) values ('bmvjfdonbsfnkd', $1, $2)`, [s, i]);
  // Séquentiel à embranchement : 2 emplacements reliés dans les deux sens.
  await q(`insert into public.segment_slots (id, track_id, label, position, alternatives) values ('slotA', 'bmvidx6a4320my', 'Jazz City', 0, '[{"file":"a.ogg"}]'), ('slotB', 'bmvidx6a4320my', 'Rock City', 1, '[{"file":"b.ogg"}]')`);
  await q(`update public.segment_slots set references_slot_id = 'slotA' where id = 'slotB'`);
  await q(`insert into public.segment_slot_transitions (from_slot_id, target_slot_id, label, position) values ('slotA', 'slotB', 'vers Rock', 0), ('slotB', 'slotA', 'vers Jazz', 0)`);

  // Bêta-testeur (non admin, FR) avec son AdReel principal et un vrai morceau.
  const me = await mk(2, 'ana', 'fr');
  await q(`insert into public.ad_reels (id, owner_id, label, profile) values ('main', $1, 'Principal', '{"title":"Ana"}')`, [me]);
  await q(`insert into public.tracks (id, owner_id, title, mode) values ('mine', $1, 'Le mien', 'static')`, [me]);
  await q(`insert into public.ad_reel_tracks (owner_id, ad_reel_id, track_id, position) values ($1, 'main', 'mine', 0)`, [me]);
  await db.exec(`grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant select on public.ad_reels, public.ad_reel_tracks, public.tracks, public.sfx_library, public.packs, public.composer_profiles to anon, authenticated;`);
  await q(`update public.beta_program set full_access = false`);

  // ---- Feu vert fermé : rien pour un non-admin
  await as(U(2));
  check('feu vert fermé : rien n\'est ajouté pour un non-admin', (await val(`select public.seed_my_examples()`)).skipped === 'flag'
    && (await val(`select count(*)::int from public.tracks where owner_id = $1`, [me])) === 1);
  await q(`update public.feature_flags set released = true where key = 'example_content'`);

  // ---- Ajout
  const r = await val(`select public.seed_my_examples()`);
  check('feu vert ouvert : 6 morceaux et 3 Sfx ajoutés', r.seeded === true && r.tracks === 6 && r.sfx === 3);
  const tracks = await q(`select * from public.tracks where owner_id = $1 and example_source_id is not null order by title`, [me]);
  check('noms « Example N - EZ Jazz <mode> » en français, dans l\'ordre des leçons', tracks.map(t => t.title).join('|') ===
    ['Example 1 - EZ Jazz Statique', 'Example 2 - EZ Jazz Embranchement vertical', 'Example 3 - EZ Jazz Layering vertical additif',
     'Example 4 - EZ Jazz Layering vertical randomisé', 'Example 5 - EZ Jazz Séquentiel', 'Example 6 - EZ Jazz Séquentiel à embranchement'].join('|'));
  check('nouveaux ids, marquage = id de la source, mode conservé', tracks.every(t => !TR[t.id] && TR[t.example_source_id] === t.mode));
  check('fichiers PARTAGÉS : base = dossier de la source (aucune copie)', tracks.every(t => t.base === `https://media.layerpitch.com/audio/${t.example_source_id}/`));
  check('contenu copié (couches, tags)', tracks.every(t => t.layers[0].file === '0-l.ogg' && t.tags.join() === 'jazz'));
  const folder = await q(`select * from public.track_folders where owner_id = $1`, [me]);
  check('rangés dans un dossier « Exemples » marqué', folder.length === 1 && folder[0].label === 'Exemples' && folder[0].example_source_id === 'example-folder' && tracks.every(t => t.folder_id === folder[0].id));
  const sfx = await q(`select * from public.sfx_library where owner_id = $1 order by title`, [me]);
  const sfxFolder = await q(`select * from public.sfx_folders where owner_id = $1`, [me]);
  check('Sfx : copies marquées, titres gardés, base de la source, dossier « Exemples »', sfx.length === 3 && sfx.every(s => SFX.includes(s.example_source_id) && s.base.endsWith(`/sfx-${s.example_source_id}/`) && s.folder_id === sfxFolder[0].id) && sfx.some(s => s.title === 'Glaçons'));
  const st = tracks.find(t => t.example_source_id === 'bmvjfdonbsfnkd');
  const sfxIdOf = srcId => sfx.find(s => s.example_source_id === srcId).id;
  check('statique : ses 3 Sfx attachés sont les COPIES', (await q(`select sfx_id from public.track_sfx where track_id = $1 order by position`, [st.id])).map(x => x.sfx_id).join() === SFX.map(sfxIdOf).join());
  check('statique : un événement qui vise un Sfx vise la copie', st.fx_triggers[0].target.sfxId === sfxIdOf(SFX[0]));
  const br = tracks.find(t => t.example_source_id === 'bmvidx6a4320my');
  const slots = await q(`select * from public.segment_slots where track_id = $1 order by position`, [br.id]);
  const trans = await q(`select x.* from public.segment_slot_transitions x join public.segment_slots s on s.id = x.from_slot_id where s.track_id = $1 order by x.label`, [br.id]);
  check('séquentiel : emplacements recopiés avec de nouveaux ids', slots.length === 2 && slots.every(s => !['slotA', 'slotB'].includes(s.id)) && slots[0].label === 'Jazz City' && slots[1].alternatives[0].file === 'b.ogg');
  check('séquentiel : renvoi et branchements redirigés vers les copies', slots[1].references_slot_id === slots[0].id && trans.length === 2
    && trans[0].from_slot_id === slots[1].id && trans[0].target_slot_id === slots[0].id && trans[1].target_slot_id === slots[1].id);
  check('les sources n\'ont pas bougé', (await val(`select count(*)::int from public.segment_slots where track_id = 'bmvidx6a4320my'`)) === 2
    && (await val(`select count(*)::int from public.tracks where owner_id = $1`, [src])) === 6);
  const pack = (await q(`select * from public.packs where owner_id = $1`, [me]))[0];
  check('pack d\'exemple : 6 morceaux + 3 Sfx, hors catalogue', pack && pack.title === 'Pack d\'exemple' && pack.example_source_id === 'example-pack' && !pack.catalog_listed
    && (await val(`select count(*)::int from public.pack_tracks where pack_id = $1`, [pack.id])) === 6 && (await val(`select count(*)::int from public.pack_sfx where pack_id = $1`, [pack.id])) === 3);
  const demo = (await q(`select * from public.ad_reels where owner_id = $1 and id <> 'main'`, [me]))[0];
  check('AdReel « Démo » : privé (example), en-tête, bio, 6 morceaux, à côté du principal', demo && demo.access_mode === 'example' && demo.profile.title === 'Démo'
    && /photo et une bio/.test(demo.profile.bio) && !demo.allow_indexing && (await val(`select count(*)::int from public.ad_reel_tracks where owner_id = $1 and ad_reel_id = $2`, [me, demo.id])) === 6
    && (await val(`select label from public.ad_reels where owner_id = $1 and id = 'main'`, [me])) === 'Principal');
  const msg = await q(`select * from public.admin_messages where recipient_id = $1`, [U(2)]);
  check('message de la boîte de réception (personnel, sans e-mail, FR + EN)', msg.length === 1 && /Retirer les exemples/.test(msg[0].body.fr) && /Remove examples/.test(msg[0].body.en) && !msg[0].email_notify);

  // ---- Une seule fois
  check('deuxième appel : rien de plus', (await val(`select public.seed_my_examples()`)).skipped === 'done' && (await val(`select count(*)::int from public.tracks where owner_id = $1`, [me])) === 7);

  // ---- Jamais public
  const anon = async fn => { await as(null); try { return await asRole('anon', fn); } finally { await as(U(2)); } };
  check('visiteur : aucun morceau, Sfx, pack ni AdReel d\'exemple lisible', await anon(async () =>
    (await q(`select count(*)::int n from public.tracks where example_source_id is not null`))[0].n === 0
    && (await q(`select count(*)::int n from public.sfx_library where example_source_id is not null`))[0].n === 0
    && (await q(`select count(*)::int n from public.packs where example_source_id is not null`))[0].n === 0
    && (await q(`select count(*)::int n from public.ad_reels where example_source_id is not null`))[0].n === 0));
  check('visiteur : les vrais morceaux restent lisibles', await anon(async () => (await q(`select id from public.tracks where id in ('mine', 'bmvidtfhvfa5tt')`)).length === 2));
  check('la personne voit ses exemples', await asRole('authenticated', async () => (await q(`select count(*)::int n from public.tracks where example_source_id is not null`))[0].n === 6));
  await as(U(3)); const other = await mk(3, 'bob');
  await as(U(3));
  check('un autre compte ne les voit pas', await asRole('authenticated', async () => (await q(`select count(*)::int n from public.tracks where owner_id = $1 and example_source_id is not null`, [me]))[0].n === 0));
  await as(U(2));

  // ---- Interdits
  check('protéger un exemple : refusé', await failsWith(`update public.tracks set protected = true where id = $1`, [st.id], /protégé/));
  check('protéger un Sfx d\'exemple : refusé', await failsWith(`update public.sfx_library set protected = true where id = $1`, [sfx[0].id], /protégé/));
  await val(`select public.upsert_track($1::jsonb)`, [JSON.stringify({ id: st.id, title: 'Renommé', mode: 'static', base: `https://media.layerpitch.com/audio/${st.id}/`, folderId: folder[0].id, sfxIds: SFX.map(sfxIdOf) })]);
  const st2 = (await q(`select * from public.tracks where id = $1`, [st.id]))[0];
  check('sauvegarde d\'un exemple : modifiable, mais base figée sur la source et marquage gardé', st2.title === 'Renommé' && st2.base.endsWith('/bmvjfdonbsfnkd/') && st2.example_source_id === 'bmvjfdonbsfnkd');
  check('exemple dans l\'AdReel principal : refusé', await failsWith(`select public.upsert_ad_reel($1::jsonb)`, [JSON.stringify({ id: 'main', label: 'Principal', profile: { title: 'Ana' }, trackIds: ['mine', st.id] })], /propre musique/));
  check('… l\'AdReel principal reste intact', (await val(`select count(*)::int from public.ad_reel_tracks where owner_id = $1 and ad_reel_id = 'main'`, [me])) === 1);
  check('modifier l\'AdReel Démo (ordre, mes morceaux) : permis', !(await failsWith(`select public.upsert_ad_reel($1::jsonb)`, [JSON.stringify({ id: demo.id, label: 'Démo', profile: demo.profile, trackIds: ['mine', ...tracks.map(t => t.id)] })])));
  check('… et il reste privé', (await val(`select access_mode from public.ad_reels where owner_id = $1 and id = $2`, [me, demo.id])) === 'example');
  check('donner une page publique à l\'AdReel Démo : refusé', await failsWith(`select public.set_ad_reel_access($1, 'public')`, [demo.id]) && await failsWith(`update public.ad_reels set access_mode = 'public' where id = $1`, [demo.id]));
  check('exemple dans un pack ordinaire (page publique) : refusé', await failsWith(`select public.upsert_pack($1::jsonb)`, [JSON.stringify({ id: 'p2', title: 'Mon pack', trackIds: [st.id] })], /propre musique/));
  check('Sfx d\'exemple dans un pack ordinaire : refusé', await failsWith(`select public.upsert_pack($1::jsonb)`, [JSON.stringify({ id: 'p3', title: 'Mon pack', sfxIds: [sfx[0].id] })], /propre musique/));
  check('modifier le pack d\'exemple (placement) : permis', !(await failsWith(`select public.upsert_pack($1::jsonb)`, [JSON.stringify({ id: pack.id, title: 'Pack d\'exemple', trackIds: tracks.map(t => t.id).reverse(), sfxIds: sfx.map(s => s.id), catalogListed: true })])));
  check('… toujours hors catalogue même si la page l\'envoie', (await val(`select catalog_listed from public.packs where id = $1`, [pack.id])) === false);
  check('mettre le pack d\'exemple en vente : refusé', await failsWith(`update public.packs set buyable = true where id = $1`, [pack.id], /vente/) && await failsWith(`update public.packs set price_eur_cents = 500 where id = $1`, [pack.id], /vente/));
  await q(`insert into public.collections (id, owner_id, title) values ('col', $1, 'C')`, [me]);
  check('pack d\'exemple dans une collection : refusé', await failsWith(`insert into public.collection_packs (collection_id, pack_id) values ('col', $1)`, [pack.id], /propre musique/));
  await q(`insert into public.albums (id, title, seller_id, seller_role) values ('alb', 'A', $1, 'composer')`, [U(2)]);
  check('exemple dans un album : refusé', await failsWith(`insert into public.album_tracks (album_id, track_id) values ('alb', $1)`, [st.id], /propre musique/));
  check('« example » réservé à l\'AdReel Démo', await failsWith(`update public.ad_reels set access_mode = 'example' where owner_id = $1 and id = 'main'`, [me]));

  // ---- Exclusions
  await q(`update public.feature_flags set released = true where key in ('composer_directory', 'search_indexing')`);
  check('annuaire : la personne y est grâce à SON morceau (pas aux exemples)', (await q(`select handle from public.composer_directory()`)).some(x => x.handle === 'ana'));
  await q(`delete from public.ad_reel_tracks where owner_id = $1 and ad_reel_id = 'main'`, [me]);
  await db.exec(`alter table public.ad_reel_tracks disable trigger example_guard`);
  await q(`insert into public.ad_reel_tracks (owner_id, ad_reel_id, track_id, position) values ($1, 'main', $2, 0)`, [me, st.id]);
  await db.exec(`alter table public.ad_reel_tracks enable trigger example_guard`);
  check('annuaire : un AdReel principal avec seulement un exemple ne fait apparaître personne', (await val(`select public.directory_hidden_reason($1)`, [me])) === 'no_tracks');
  await q(`delete from public.ad_reel_tracks where owner_id = $1 and ad_reel_id = 'main'`, [me]);
  await q(`insert into public.ad_reel_tracks (owner_id, ad_reel_id, track_id, position) values ($1, 'main', 'mine', 0)`, [me]);
  check('catalogue audio : aucun pack d\'exemple', !(await q(`select id from public.catalog_packs()`)).some(x => x.id === pack.id));
  const seo = JSON.stringify(await val(`select public.list_seo_adreels()`));
  check('sitemap : l\'AdReel principal oui, la Démo non', seo.includes('ana') && !seo.includes(demo.id));
  check('quota de pages : la Démo ne compte pas', (await val(`select public.composer_public_pages_used($1)`, [U(2)])) === 1);
  await as(U(1));
  const stats = await val(`select public.admin_get_stats()`);
  check('statistiques admin : les exemples ne comptent pas', stats.content.tracks === 7 && stats.content.packs === 0 && stats.content.adReels === 1 && stats.content.sfx === 3);
  const growth = await val(`select public.admin_get_growth_series('day', 7)`).catch(() => null);
  check('courbes admin : les exemples ne comptent pas', !growth || growth.tracks.reduce((a, b) => a + b, 0) === 7);
  const rep = await val(`select public.admin_adreels_report()`);
  const anaRep = rep.find(x => x.handle === 'ana');
  check('rapport AdReels admin : ni la Démo ni les exemples', anaRep && anaRep.tracks === 1 && anaRep.packs === 0 && anaRep.adreels.length === 1);
  await as(U(2));

  // ---- Retrait
  const rm = await val(`select public.remove_my_examples()`);
  check('« Retirer les exemples » : tout part d\'un coup', rm.tracks === 6 && rm.sfx === 3 && rm.packs === 1 && rm.adReels === 1
    && (await val(`select count(*)::int from public.tracks where owner_id = $1`, [me])) === 1
    && (await val(`select count(*)::int from public.track_folders where owner_id = $1`, [me])) === 0
    && (await val(`select count(*)::int from public.sfx_folders where owner_id = $1`, [me])) === 0);
  check('… ses vrais morceaux et son AdReel principal restent', (await val(`select count(*)::int from public.ad_reel_tracks where owner_id = $1 and ad_reel_id = 'main'`, [me])) === 1);
  check('… les sources (et leurs fichiers) ne bougent pas', (await val(`select count(*)::int from public.tracks where owner_id = $1`, [src])) === 6 && (await val(`select count(*)::int from public.sfx_library where owner_id = $1`, [src])) === 3);
  check('… et ne reviennent pas au chargement suivant', (await val(`select public.seed_my_examples()`)).skipped === 'done' && (await val(`select count(*)::int from public.tracks where owner_id = $1`, [me])) === 1);

  // ---- Langue du compte
  const en = await mk(4, 'eva', 'en');
  await as(U(4));
  await val(`select public.seed_my_examples()`);
  const enTitles = (await q(`select title from public.tracks where owner_id = $1 order by title`, [en])).map(t => t.title);
  check('compte anglais : noms, dossier, pack, Démo en anglais', enTitles[0] === 'Example 1 - EZ Jazz Static' && enTitles[5] === 'Example 6 - EZ Jazz Sequential branching'
    && (await val(`select label from public.track_folders where owner_id = $1`, [en])) === 'Examples'
    && (await val(`select title from public.packs where owner_id = $1`, [en])) === 'Example pack'
    && (await val(`select profile->>'title' from public.ad_reels where owner_id = $1`, [en])) === 'Demo');
  await as(U(3));
  await val(`select public.seed_my_examples('de')`);
  check('langue sans texte (ex. allemand) : retombe sur l\'anglais', (await val(`select count(*)::int from public.tracks where owner_id = $1 and title like 'Example 1 - EZ Jazz Static'`, [other])) === 1);
  await q(`update public.tracks set retired_at = now() where id = 'bmvidtfhvfa5tt'`);
  await mk(5, 'zed'); await as(U(5));
  check('source retirée entre-temps : simplement sautée', (await val(`select public.seed_my_examples()`)).tracks === 5);

  // ---- Après l'accueil seulement (sinon le message des exemples empêcherait la bienvenue)
  await mk(6, 'neo'); await q(`update public.profiles set onboarding_completed = false where id = $1`, [U(6)]); await as(U(6));
  check('accueil pas terminé : rien encore (la bienvenue d\'abord)', (await val(`select public.seed_my_examples()`)).skipped === 'onboarding'
    && (await val(`select count(*)::int from public.admin_messages where recipient_id = $1`, [U(6)])) === 0);
  await q(`update public.profiles set onboarding_completed = true where id = $1`, [U(6)]);
  check('… accueil terminé : ajout au chargement suivant', (await val(`select public.seed_my_examples()`)).seeded === true);

  // ---- Questions de profil
  await as(U(2));
  check('questions : feu vert fermé, refusées', await failsWith(`select public.set_my_onboarding_profile('{"role":"composer"}')`));
  await q(`update public.feature_flags set released = true where key = 'onboarding_profile'`);
  const op = await val(`select public.set_my_onboarding_profile('{"role":"composer","career":"contracts","ost":"yes","junk":1}')`);
  check('réponses enregistrées (avec date, sans champ inconnu)', op.role === 'composer' && op.career === 'contracts' && op.ost === 'yes' && op.at && !('junk' in op));
  check('valeur inconnue refusée', await failsWith(`select public.set_my_onboarding_profile('{"role":"pirate"}')`));
  await as(U(4)); await val(`select public.set_my_onboarding_profile('{"skipped":true}')`);
  await as(U(3)); await val(`select public.set_my_onboarding_profile('{"role":"both","path":"studio"}')`);
  await as(U(2));
  check('répartition réservée aux admins', await failsWith(`select public.admin_onboarding_profile_stats()`));
  await as(U(1));
  const ops = await val(`select public.admin_onboarding_profile_stats()`);
  check('répartition admin : posées, passées, par profil', ops.asked === 3 && ops.skipped === 1 && ops.rows.length === 2 && ops.rows.some(x => x.role === 'both' && x.path === 'studio' && x.count === 1));

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
