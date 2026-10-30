// Annuaire orienté studios (30/10, migration 20261030010000) : tags communs, dédoublonnage, alias, plafond, reprise des mots-clés,
// pré-cochage des logiciels, fiches cachées (AdReel privé, sans morceau), ordre aléatoire, actions admin. Base jetable PGlite.
const picker = require('./layerpitch-tag-picker.js');
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  const { freshDb } = await import('./scripts/pglite-db.mjs');
  // D'abord l'état juste avant la migration, pour tester la reprise des mots-clés existants.
  const fs = require('fs'), path = require('path');
  const db = await freshDb({ upTo: '20261029999999' });
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const as = uid => db.query(`select set_config('test.uid', $1, false)`, [uid || '']);
  const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch (e) { return true; } };
  const mk = async (n, handle, opts = {}) => {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), `c${n}@x.test`]);
    await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]);
    const id = (await q(`insert into public.composer_profiles (profile_id, handle) values ($1, $2) returning id`, [U(n), handle]))[0].id;
    if (!opts.noMain) await q(`insert into public.ad_reels (id, owner_id, label, profile, access_mode) values ('main', $1, 'P', $2::jsonb, $3)`, [id, JSON.stringify({ title: 'Nom ' + n }), opts.access || 'public']);
    if (!opts.noMain && !opts.noTrack) {
      await q(`insert into public.tracks (id, owner_id, title, mode) values ($1, $2, 'T', 'static')`, ['t' + n, id]);
      await q(`insert into public.ad_reel_tracks (ad_reel_id, owner_id, track_id, position) values ('main', $1, $2, 0)`, [id, 't' + n]);
    }
    return id;
  };
  const ana = await mk(1, 'ana');
  await q(`update public.composer_profiles set directory_keywords = array['orchestral','SF','8bit','Urban','URBAN'] where id = $1`, [ana]);
  await q(`insert into public.settings (owner_id, implementation_skills) values ($1, '{"wwise":true,"unity":false}'::jsonb)
           on conflict (owner_id) do update set implementation_skills = excluded.implementation_skills`, [ana]);
  await mk(2, 'bob'); await mk(3, 'privee', { access: 'password' }); await mk(4, 'vide', { noTrack: true }); await mk(5, 'sansreel', { noMain: true });
  await mk(6, 'cachee'); await q(`update public.composer_profiles set directory_opt_in = false where handle = 'cachee'`);
  await mk(9, 'sansbloc'); await q(`update public.ad_reels r set blocks = '[{"id":"x","type":"bio"}]'::jsonb from public.composer_profiles c where c.id = r.owner_id and c.handle = 'sansbloc'`);
  await db.exec(fs.readFileSync(path.join(__dirname, 'supabase/migrations/20261030010000_directory_tags_for_studios.sql'), 'utf8'));

  // ---- Clé : même résultat en base et dans le navigateur ----
  const SAMPLES = ['RPG', 'rpg', 'R.P.G', 'r p g', 'Électronique', 'electronique', 'Hip-Hop', 'hip hop', 'Sci-Fi', "L'Œuvre", 'C++', 'C#', 'Chœurs', 'Lo‑Fi', '« Épique »', '音楽', '...', 'Émile_Zola'];
  let same = true;
  for (const s of SAMPLES) { const k = await val(`select public.directory_tag_key($1)`, [s]); if (k !== picker.key(s)) { same = false; console.log('  diffère :', s, k, picker.key(s)); } }
  check('clé : identique en base et dans le navigateur', same);
  check('clé : RPG = rpg = R.P.G', picker.key('RPG') === picker.key('rpg') && picker.key('rpg') === picker.key('R.P.G'));
  check('clé : accents ignorés ; C++ et C# distincts', picker.key('Électronique') === picker.key('electronique') && picker.key('C++') !== picker.key('C#'));

  // ---- Liste de départ et reprise ----
  await q(`update public.feature_flags set released = true where key = 'composer_directory'`);
  await as(null);
  const list = await q(`select * from public.directory_tag_list()`);
  const seeds = await val(`select count(*)::int from public.directory_tags where seed`);
  check('liste de départ : environ 40 tags', seeds >= 35 && seeds <= 45);
  check('moteurs : tags ordinaires', ['Wwise', 'FMOD', 'Unity', 'Unreal'].every(l => list.some(t => t.label === l)));
  check('alias : fournis pour les suggestions, pas comme tags séparés', list.find(t => t.label === 'Electronic').aliases.includes('Électronique') && !list.some(t => t.label === 'Électronique'));
  const kw = async h => (await q(`select keywords from public.composer_directory() where handle = $1`, [h]))[0].keywords;
  const anaTags = await kw('ana');
  check('reprise : mots-clés rangés sur les tags (SF → Sci-Fi, 8bit → Chiptune), doublons fondus', ['Orchestral', 'Sci-Fi', 'Chiptune', 'Urban'].every(t => anaTags.includes(t)) && anaTags.filter(t => t.toLowerCase() === 'urban').length === 1);
  check('reprise : logiciel coché ajouté (Wwise oui, Unity non)', anaTags.includes('Wwise') && !anaTags.includes('Unity'));
  check('ancienne colonne de mots-clés supprimée', (await val(`select count(*)::int from information_schema.columns where table_name = 'composer_profiles' and column_name = 'directory_keywords'`)) === 0);
  check('tag repris avec un compositeur : proposé à tous', list.some(t => t.label === 'Urban' && t.uses === 1));

  // ---- Qui apparaît ----
  const handles = (await q(`select handle from public.composer_directory()`)).map(r => r.handle).sort();
  check('visibles : seulement AdReel public avec morceau (privé, vide, sans AdReel, décoché, sans bloc Morceaux : absents)', handles.join() === 'ana,bob');
  const reason = async n => { await as(U(n)); const r = await val(`select public.get_my_directory()`); await as(null); return r.hiddenReason; };
  check('raison lue dans Mon compte : visible / privé / sans morceau / sans AdReel / décoché', (await reason(1)) === null && (await reason(3)) === 'private' && (await reason(4)) === 'no_tracks' && (await reason(5)) === 'no_adreel' && (await reason(6)) === 'opted_out' && (await reason(9)) === 'no_tracks');

  // ---- Ordre aléatoire ----
  for (let i = 10; i < 22; i++) await mk(i, 'c' + i);
  const orders = new Set();
  for (let i = 0; i < 12; i++) orders.add((await q(`select handle from public.composer_directory()`)).map(r => r.handle).join());
  check('ordre : change d\'un chargement à l\'autre', orders.size > 1);
  await q(`update public.composer_profiles set plan = 'pro' where handle = 'bob'`);
  await q(`update public.beta_program set full_access = false`);
  let bobFirst = 0; const N = 40;
  for (let i = 0; i < N; i++) if ((await q(`select handle from public.composer_directory()`))[0].handle === 'bob') bobFirst++;
  check('ordre : un palier payant n\'est pas placé en tête', bobFirst < N / 2);

  // ---- Saisie du compositeur ----
  await as(U(2));
  let r = await val(`select public.set_my_directory(true, array['rpg', 'R.P.G', 'RPG', 'Électronique', '  Tag   Neuf  ', '', '...']::text[])`);
  check('saisie : dédoublonnée, alias suivi, tag inconnu créé', r.keywords.slice().sort().join() === 'Electronic,RPG,Tag Neuf');
  await as(null);
  check('tag créé : disponible pour tous', (await q(`select * from public.directory_tag_list()`)).some(t => t.label === 'Tag Neuf'));
  await as(U(10));
  r = await val(`select public.set_my_directory(true, array['tag-neuf']::text[])`);
  check('tag créé par un autre : même tag, écrit comme le premier', r.keywords.join() === 'Tag Neuf');
  const many = Array.from({ length: 130 }, (_, i) => 'zz' + i);
  r = await val(`select public.set_my_directory(true, $1::text[])`, [many]);
  check('plus de limite à 12 : plafond à 100', r.keywords.length === 100);
  check('nom limité à 30 caractères', (await val(`select public.set_my_directory(true, array[repeat('a', 50)]::text[])`)).keywords[0].length === 30);
  check('null : tags inchangés', (await val(`select public.set_my_directory(true, null)`)).keywords[0].length === 30);
  check('ordre de saisie gardé', (await val(`select public.set_my_directory(true, array['Rock','Action','Jazz']::text[])`)).keywords.join() === 'Rock,Action,Jazz');
  await val(`select public.set_my_directory(true, '{}'::text[])`);
  await as(null);
  check('tag sans plus personne : plus proposé (sauf la liste de départ)', !(await q(`select * from public.directory_tag_list()`)).some(t => t.label === 'zz1') && (await q(`select * from public.directory_tag_list()`)).some(t => t.label === 'Rock'));

  // ---- Pré-cochage ----
  await q(`update public.settings set implementation_skills = '{"fmod":true}'::jsonb where owner_id = $1`, [ana]);
  await as(U(1));
  check('logiciels pré-cochés tant que rien n\'est enregistré', (await val(`select public.get_my_directory()`)).skillTags.join() === 'FMOD');
  await val(`select public.set_my_directory(true, array['Jazz']::text[])`);
  check('après enregistrement : plus de pré-cochage', (await val(`select public.get_my_directory()`)).skillTags.length === 0);

  // ---- Feu vert fermé ----
  await as(null);
  await q(`update public.feature_flags set released = false where key = 'composer_directory'`);
  check('fermé : ni liste, ni suggestions pour un visiteur', (await q(`select * from public.composer_directory()`)).length === 0 && (await q(`select * from public.directory_tag_list()`)).length === 0);
  await as(U(1));
  check('fermé : un compositeur ne peut pas changer ses tags ni en créer', (await val(`select public.set_my_directory(true, array['Spam fermé']::text[])`)).keywords.join() === 'Jazz' && (await val(`select count(*)::int from public.directory_tags where label = 'Spam fermé'`)) === 0);
  await q(`insert into public.admins (profile_id) values ($1)`, [U(20)]);
  await as(U(20));
  check('fermé : un admin voit tout', (await q(`select * from public.composer_directory()`)).length > 0 && (await q(`select * from public.directory_tag_list()`)).length > 0);
  await q(`update public.feature_flags set released = true where key = 'composer_directory'`);

  // ---- Administration ----
  const idOf = async l => val(`select id from public.directory_tags where label = $1`, [l]);
  await as(U(21));
  check('un non-admin ne peut ni lister, ni retirer, ni fusionner', (await fails(`select public.admin_directory_tags()`)) && (await fails(`select public.admin_retire_directory_tag(1)`)) && (await fails(`select public.admin_merge_directory_tags(1, 2)`)));
  check('accès direct aux tables refusé', (await val(`select has_table_privilege('anon', 'public.directory_tags', 'select')`)) === false && (await val(`select has_table_privilege('authenticated', 'public.composer_directory_tags', 'select')`)) === false);
  await as(U(11)); await val(`select public.set_my_directory(true, array['Mot Abusif', 'Jazz', 'Variante']::text[])`);
  await as(U(12)); await val(`select public.set_my_directory(true, array['Rock', 'Variante']::text[])`);
  await as(U(20));
  await val(`select public.admin_retire_directory_tag($1::bigint)`, [await idOf('Mot Abusif')]);
  check('retirer : disparaît des fiches et des suggestions', !(await kw('c11')).includes('Mot Abusif') && !(await q(`select * from public.directory_tag_list()`)).some(t => t.label === 'Mot Abusif'));
  await as(U(13));
  check('retirer : ne peut pas être recréé à la saisie', (await val(`select public.set_my_directory(true, array['mot abusif']::text[])`)).keywords.length === 0);
  await as(U(20));
  await val(`select public.admin_restore_directory_tag($1::bigint)`, [await idOf('Mot Abusif')]);
  await as(U(13));
  check('rétablir : de nouveau utilisable', (await val(`select public.set_my_directory(true, array['mot abusif']::text[])`)).keywords.join() === 'Mot Abusif');
  await as(U(20));
  await val(`select public.admin_merge_directory_tags($1::bigint, $2::bigint)`, [await idOf('Variante'), await idOf('Jazz')]);
  check('fusionner : les fiches passent sur le tag gardé, sans doublon', (await kw('c11')).filter(k => k === 'Jazz').length === 1 && (await kw('c12')).includes('Jazz') && !(await kw('c12')).includes('Variante'));
  await as(U(14));
  check('fusionner : l\'ancien nom mène au tag gardé', (await val(`select public.set_my_directory(true, array['variante']::text[])`)).keywords.join() === 'Jazz');
  await as(U(20));
  check('fusionner avec soi-même : refusé', await fails(`select public.admin_merge_directory_tags(1, 1)`));

  // ---- Compte anonymisé ----
  await as(null);
  await q(`update public.profiles set deleted_at = now() where id = $1`, [U(11)]);
  check('compte anonymisé : ses tags ne comptent plus', (await val(`select count(*)::int from public.composer_directory_tags l join public.composer_profiles c on c.id = l.composer_id where c.profile_id = $1`, [U(11)])) === 0);

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
