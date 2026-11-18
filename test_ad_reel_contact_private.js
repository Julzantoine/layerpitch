// Sécurité (audit du 16/11, I1 ; décision du 17/11 : cacher l'adresse) : l'e-mail de contact d'un AdReel n'est plus
// public. Base jetable PGlite (migration 20261118030000) + contrôles de texte des pages et de la fonction d'envoi.
const fs = require('fs'), path = require('path');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
(async () => {
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); } catch (e) { console.log('FAIL - PGlite absent : npm install (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  const asRole = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn(); } finally { await db.exec('reset role'); } };
  for (const n of [1, 2]) { await q(`insert into auth.users (id) values ($1)`, [U(n)]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); }
  const c1 = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'jean') returning id`, [U(1)]))[0].id;
  const c2 = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'ana') returning id`, [U(2)]))[0].id;
  await db.exec(`grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant select on public.ad_reels to anon, authenticated;`);
  const prof = async (owner, id) => (await q(`select profile from public.ad_reels where owner_id = $1 and id = $2`, [owner, id]))[0].profile;
  const contact = async (owner, id) => ((await q(`select email from public.ad_reel_contacts where owner_id = $1 and ad_reel_id = $2`, [owner, id]))[0] || {}).email;

  // Enregistrement (même chemin que le Backstage : le profil porte contactEmail)
  await q(`insert into public.ad_reels (id, owner_id, label, profile) values ('main', $1, 'P', $2)`, [c1, JSON.stringify({ title: 'Jean', contactEmail: ' jean@exemple.fr ' })]);
  await q(`insert into public.ad_reels (id, owner_id, label, profile) values ('main', $1, 'P', $2)`, [c2, JSON.stringify({ title: 'Ana', contactEmail: '' })]);
  let p = await prof(c1, 'main');
  check('l\'adresse sort du profil public', !('contactEmail' in p) && p.title === 'Jean');
  check('drapeau public hasContact posé', p.hasContact === true && (await prof(c2, 'main')).hasContact === false);
  check('adresse rangée dans la table privée (espaces retirés)', await contact(c1, 'main') === 'jean@exemple.fr');

  // Qui peut lire
  await as(0);
  check('visiteur : table privée fermée', await asRole('anon', async () => { try { await q(`select * from public.ad_reel_contacts`); return false; } catch (e) { return true; } }));
  check('visiteur : aucune adresse dans les AdReels lisibles', JSON.stringify(await asRole('anon', () => q(`select profile from public.ad_reels`))).indexOf('@') < 0);
  await as(2);
  check('autre compositeur : ne voit pas l\'adresse de Jean', (await asRole('authenticated', () => q(`select * from public.ad_reel_contacts`))).length === 0);
  await as(1);
  const mine = await asRole('authenticated', () => q(`select ad_reel_id, email from public.ad_reel_contacts`));
  check('le propriétaire relit son adresse (Backstage)', mine.length === 1 && mine[0].email === 'jean@exemple.fr');
  check('le propriétaire ne peut pas écrire directement', await asRole('authenticated', async () => { try { await q(`insert into public.ad_reel_contacts (owner_id, ad_reel_id, email) values ($1, 'x', 'a@b.c')`, [c1]); return false; } catch (e) { return true; } }));
  await as(0);

  // Modifications
  await q(`update public.ad_reels set profile = $1 where owner_id = $2 and id = 'main'`, [JSON.stringify({ title: 'Jean 2', hasContact: true }), c1]);
  check('profil sans la clé contactEmail : adresse conservée', await contact(c1, 'main') === 'jean@exemple.fr' && (await prof(c1, 'main')).hasContact === true);
  await q(`update public.ad_reels set profile = $1 where owner_id = $2 and id = 'main'`, [JSON.stringify({ title: 'Jean', contactEmail: 'nouveau@exemple.fr' }), c1]);
  check('nouvelle adresse enregistrée', await contact(c1, 'main') === 'nouveau@exemple.fr');
  await q(`update public.ad_reels set profile = $1 where owner_id = $2 and id = 'main'`, [JSON.stringify({ title: 'Jean', contactEmail: '' }), c1]);
  check('adresse vidée : supprimée, hasContact faux', await contact(c1, 'main') === undefined && (await prof(c1, 'main')).hasContact === false);
  await q(`update public.ad_reels set profile = $1 where owner_id = $2 and id = 'main'`, [JSON.stringify({ title: 'Jean', contactEmail: 'jean@exemple.fr' }), c1]);
  await q(`insert into public.ad_reels (id, owner_id, label, profile) values ('copie', $1, 'C', $2)`, [c1, JSON.stringify({ title: 'Copie', hasContact: true })]);
  check('copie sans adresse : hasContact recalculé (faux), pas de formulaire mort', (await prof(c1, 'copie')).hasContact === false);
  await q(`delete from public.ad_reels where owner_id = $1 and id = 'main'`, [c1]);
  check('AdReel supprimé : son adresse aussi', await contact(c1, 'main') === undefined);

  // Reprise de l'existant : une adresse restée dans un profil avant la migration est déplacée.
  await db.exec(`alter table public.ad_reels disable trigger ad_reels_contact_private`);
  await q(`insert into public.ad_reels (id, owner_id, label, profile) values ('ancien', $1, 'A', $2)`, [c2, JSON.stringify({ title: 'Ancien', contactEmail: 'ana@exemple.fr' })]);
  await db.exec(`alter table public.ad_reels enable trigger ad_reels_contact_private`);
  await db.exec(fs.readFileSync(path.join(__dirname, 'supabase/migrations/20261118030000_ad_reel_contact_private.sql'), 'utf-8'));
  p = await prof(c2, 'ancien');
  check('reprise : adresse déplacée, profil nettoyé', !('contactEmail' in p) && p.hasContact === true && await contact(c2, 'ancien') === 'ana@exemple.fr');

  // Pages et fonction (contrôles de texte)
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf-8');
  const idx = read('index.html'), blk = read('src/reel/35-blocs-contact-video.js'), fn = read('supabase/functions/submit-contact-message/index.ts');
  check('pied de page des AdReels : plus d\'e-mail affiché', !/mailto:/.test(idx));
  check('bloc Contact : s\'affiche d\'après hasContact', /profile\.hasContact === true/.test(blk));
  check('bloc Contact : envoie le compositeur (même id « main » chez chacun)', /ownerId,\n\s*name: formData/.test(blk));
  check('fonction d\'envoi : adresse lue dans la table privée, plus dans le profil', /from\('ad_reel_contacts'\)/.test(fn) && !/profile\.contactEmail/.test(fn));
  check('fonction d\'envoi : AdReel identifié par compositeur + id, jamais ambigu', /\.eq\('owner_id', ownerId\)/.test(fn) && /adReelRows\.length === 1/.test(fn));
  check('Backstage : relit les adresses privées', /loadSiteDataFromPostgres\(composerId, \{ withContacts: true \}\)/.test(read('src/backstage/13-suivi-d-usage.js')));
  check('pages publiques : ne demandent jamais les adresses', !/withContacts/.test(idx + read('collection.html') + read('src/pack/10-donnees-et-achat.js')));

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
