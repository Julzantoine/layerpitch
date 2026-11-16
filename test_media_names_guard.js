// Sécurité (audit du 16/11, B1) : un nom d'image piégé ne doit jamais faire tourner de code sur une page publique.
// 1. Affichage : un AdReel dont TOUS les noms d'images contiennent `"` + du code est dessiné avec le vrai code de la
//    page (même banc que test_reel_snapshots.js) : aucun attribut ni élément ajouté.
// 2. Garde : aucune adresse d'image collée sans échappement dans les sources des pages publiques.
// 3. Base (migration 20261116020000, PGlite jetable) : noms du Backstage acceptés, noms piégés refusés, par tous les
//    chemins d'écriture. Prérequis : npm install.
const fs = require('fs');
const path = require('path');
const { render } = require('./test_reel_snapshots.js');

let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };

(async () => {
  // --- 1. Affichage d'un AdReel piégé ---
  const EVIL = 'x" onerror="window.__pwned=1" data-x="';
  const EVIL_CSS = "x') ; background:url('https://evil.example/leak";
  const adReel = {
    id: 'a', label: 'A', lang: 'fr', trackIds: [], trackOverrides: {},
    testimonials: [{ text: 'Super', author: 'Ana', avatar: EVIL }],
    profile: { title: 'Piège', logo: EVIL, photo: EVIL, bio: 'Bio', effectivePlan: 'pro', theme: { bgColor: '#101820', bgImage: EVIL_CSS } },
    blocks: [
      { id: 'h', type: 'header' }, { id: 'b', type: 'bio' }, { id: 'te', type: 'testimonials' },
      { id: 'p1', type: 'photo', images: [{ file: EVIL }] },
      { id: 'p2', type: 'photo', images: [{ file: EVIL }, { file: EVIL }] },
      { id: 'v', type: 'video', videos: [{ title: 'V', url: 'https://exemple.fr/v.mp4', thumbnail: EVIL_CSS }], appearance: { bgImage: EVIL_CSS } },
      { id: 'pk', type: 'packs', packIds: ['pk1'] },
      { id: 'co', type: 'collections', collectionIds: ['col1'] },
    ],
  };
  const extra = { packs: [{ id: 'pk1', title: 'Pack', illustration: EVIL, trackIds: [] }], collections: [{ id: 'col1', title: 'Coll', illustration: EVIL, packIds: ['pk1'] }] };
  const out = await render(adReel, extra);
  // Lecture comme le ferait le navigateur : un nom piégé qui serait sorti de son attribut créerait de vrais attributs.
  const { JSDOM } = require('jsdom');
  const doc = new JSDOM(`<body>${out.blocks}${out.bodyLayers}</body>`).window.document;
  const els = [...doc.querySelectorAll('*')];
  check('aucun attribut onerror ajouté par un nom d\'image', !els.some(e => e.hasAttribute('onerror')));
  check('aucun attribut data-x ajouté par un nom d\'image', !els.some(e => e.hasAttribute('data-x')));
  const imgs = [...doc.querySelectorAll('img')];
  check('chaque image pointe vers les médias LayerPitch, nom piégé compris tel quel',
    imgs.length > 0 && imgs.every(i => i.getAttribute('src') === 'https://media.layerpitch.com/images/' + EVIL));
  const styled = els.filter(e => e.style && e.style.backgroundImage);
  check('fonds (thème, bloc, vignette vidéo) : le nom reste dans url(…), aucune déclaration ajoutée',
    styled.length >= 3 && styled.every(e => e.style.backgroundImage.startsWith('url("https://media.layerpitch.com/images/x\') ; background:url(\'https://evil.example/leak")') && !e.style.background));
  check('les images sont toujours affichées (logo, photo, avatar, blocs photo, packs, collections)',
    (out.blocks.match(/<img /g) || []).length >= 8);

  // --- 2. Garde sur les sources ---
  const files = ['src/reel/20-blocs.js', 'src/reel/30-themes-et-apparence.js', 'src/reel/35-blocs-contact-video.js', 'src/reel/40-moteur.js',
    'src/pack/20-demarrage-de-la-page.js', 'collection.html', 'library.html', 'album.html', 'mes-albums.html', 'shop.html', 'studio.html', 'annuaire.html'];
  for (const f of files) {
    const s = fs.readFileSync(path.join(__dirname, f), 'utf-8');
    const bad = [
      ...s.matchAll(/src="\$\{(?!esc\(|escapeHtml\(|IMAGES_BASE\})[^}]*(resolveImageUrl|IMAGES_BASE|illustration|\.file|avatar|logo|photo)/g),
      ...s.matchAll(/src="\$\{IMAGES_BASE\}\$\{(?!esc\(|escapeHtml\()/g),
      ...s.matchAll(/url\('\$\{/g),
    ];
    check(`${f} : aucune adresse d'image collée sans échappement`, bad.length === 0);
  }

  // --- 3. Verrou en base ---
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch (e) { return true; } };
  await db.query(`insert into auth.users (id) values ($1)`, [U(1)]);
  await db.query(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(1)]);
  const owner = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'compo') returning id`, [U(1)]))[0].id;
  const good = `${owner}/logo-abc123.png`;
  const okProfile = JSON.stringify({ logo: good, photo: 'photo-main.jpg', theme: { bgImage: `${owner}/theme-bg-a.webp` } });
  const okBlocks = JSON.stringify([{ id: 'p', type: 'photo', images: [{ file: `${owner}/a-photo-0.jpg` }] }, { id: 'v', type: 'video', videos: [{ thumbnail: null }], appearance: {} }, { id: 't', type: 'text' }]);
  check('AdReel aux noms du Backstage accepté', !(await fails(`insert into public.ad_reels (id, owner_id, label, profile, testimonials, blocks) values ('ok', $1, 'OK', $2, $3, $4)`,
    [owner, okProfile, JSON.stringify([{ text: 'x', avatar: `${owner}/ok-testimonial-avatar-0.png` }, { text: 'sans avatar' }]), okBlocks])));
  check('AdReel sans aucune image accepté', !(await fails(`insert into public.ad_reels (id, owner_id, label) values ('vide', $1, 'Vide')`, [owner])));
  const evilAr = (col, val) => fails(`update public.ad_reels set ${col} = $1 where id = 'ok'`, [val]);
  check('logo piégé refusé', await evilAr('profile', JSON.stringify({ logo: EVIL })));
  check('photo piégée refusée', await evilAr('profile', JSON.stringify({ photo: 'a"b.png' })));
  check('logo d\'un autre type que texte refusé', await evilAr('profile', JSON.stringify({ logo: ['a"><img>'] })));
  check('fond de thème piégé refusé', await evilAr('profile', JSON.stringify({ theme: { bgImage: EVIL_CSS } })));
  check('adresse externe refusée (javascript:, https:)', await evilAr('profile', JSON.stringify({ logo: 'javascript:alert(1)' })) && await evilAr('profile', JSON.stringify({ logo: 'https://evil.example/x.png' })));
  check('remontée de dossier refusée', await evilAr('profile', JSON.stringify({ logo: 'a/../../x.png' })));
  check('avatar de témoignage piégé refusé', await evilAr('testimonials', JSON.stringify([{ avatar: EVIL }])));
  check('image de bloc photo piégée refusée', await evilAr('blocks', JSON.stringify([{ type: 'photo', images: [{ file: EVIL }] }])));
  check('fond de bloc piégé refusé', await evilAr('blocks', JSON.stringify([{ type: 'text', appearance: { bgImage: EVIL_CSS } }])));
  check('vignette de vidéo piégée refusée', await evilAr('blocks', JSON.stringify([{ type: 'video', videos: [{ thumbnail: EVIL }] }])));
  check('le libellé seul se modifie toujours', !(await fails(`update public.ad_reels set label = 'Nouveau' where id = 'ok'`)));

  check('pack aux noms du Backstage accepté', !(await fails(`insert into public.packs (id, owner_id, title, illustration, watermark) values ('p1', $1, 'P', $2, $3)`, [owner, `${owner}/pack-p1.png`, `${owner}/wm-p1.png`])));
  check('illustration de pack piégée refusée', await fails(`update public.packs set illustration = $1 where id = 'p1'`, [EVIL]));
  check('filigrane de pack piégé refusé', await fails(`update public.packs set watermark = $1 where id = 'p1'`, [EVIL_CSS]));
  check('collection aux noms du Backstage acceptée', !(await fails(`insert into public.collections (id, owner_id, title, illustration) values ('c1', $1, 'C', $2)`, [owner, `${owner}/coll-c1.jpg`])));
  check('illustration de collection piégée refusée', await fails(`update public.collections set illustration = $1 where id = 'c1'`, [EVIL]));

  // Même verrou quand c'est le compositeur connecté (rôle du navigateur) qui enregistre par le Backstage (upsert_ad_reel).
  await db.exec(`grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.query(`select set_config('test.uid', $1, false)`, [U(1)]);
  const asBrowser = async (payload) => { await db.exec('set role authenticated'); try { await db.query(`select public.upsert_ad_reel($1::jsonb)`, [JSON.stringify(payload)]); return null; } catch (e) { return e.message; } finally { await db.exec('reset role'); } };
  const errOk = await asBrowser({ id: 'ok', label: 'OK', profile: JSON.parse(okProfile), blocks: JSON.parse(okBlocks), trackIds: [] });
  check('compositeur connecté : enregistrement normal accepté' + (errOk ? ' (' + errOk + ')' : ''), errOk === null);
  const errEvil = await asBrowser({ id: 'ok', label: 'OK', profile: { logo: EVIL }, trackIds: [] });
  check('compositeur connecté : nom piégé refusé avec un message clair', /Nom d'image refusé/.test(errEvil || ''));

  // Contrôle de l'existant : un nom fautif glissé en base avant le verrou bloque la migration, sans rien changer.
  await db.exec(`alter table public.packs disable trigger packs_media_names_guard`);
  await db.query(`update public.packs set illustration = 'ancien nom.png' where id = 'p1'`);
  await db.exec(`alter table public.packs enable trigger packs_media_names_guard`);
  let migErr = '';
  try { await db.exec(fs.readFileSync(path.join(__dirname, 'supabase/migrations/20261116020000_media_names_guard.sql'), 'utf-8')); } catch (e) { migErr = e.message; }
  check('nom déjà en base non conforme : la migration s\'arrête et le nomme', /pack p1/.test(migErr));

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
