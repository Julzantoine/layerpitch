// Rapport des AdReels du panneau admin (4/10) : base (PGlite) -- réservé aux admins, chiffres justes, aucune adresse e-mail ni
// contenu --, puis les fonctions d'affichage et d'export (layerpitch-admin-report.js).
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; };

(async () => {
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); } catch (e) { console.log('FAIL PGlite absent : ' + e.message); process.exit(1); }
  const db = await freshDb();
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const fails = async (sql, re) => { try { await db.query(sql); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  await db.query(`update public.beta_program set full_access = false`);
  const emails = { 1: 'admin@secret.test', 2: 'jean@secret.test', 3: 'lea@secret.test', 4: 'supprime@secret.test' };
  for (const n of [1, 2, 3, 4]) { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), emails[n]]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); }
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  const c2 = (await q(`insert into public.composer_profiles (profile_id, handle, plan) values ($1, 'jean', 'pro') returning id`, [U(2)]))[0].id;
  const c3 = (await q(`insert into public.composer_profiles (profile_id, handle, plan) values ($1, 'lea', 'free') returning id`, [U(3)]))[0].id;
  const c4 = (await q(`insert into public.composer_profiles (profile_id, handle, plan) values ($1, 'parti', 'free') returning id`, [U(4)]))[0].id;
  await q(`update public.profiles set deleted_at = now() where id = $1`, [U(4)]);
  await q(`insert into public.tracks (id, owner_id, title, mode) values ('t1', $1, 'Secret titre un', 'static'), ('t2', $1, 'Secret titre deux', 'static'), ('t3', $2, 'Autre', 'static')`, [c2, c3]);
  await q(`insert into public.ad_reels (id, owner_id, label, lang, profile, blocks, slug) values ('main', $1, 'Principal', 'fr', '{"bio":"Texte secret"}'::jsonb, '[]'::jsonb, null), ('r2', $1, 'Anglais', 'en', '{}'::jsonb, '[]'::jsonb, 'english'), ('main', $2, 'Principal', 'fr', '{}'::jsonb, '[]'::jsonb, null)`, [c2, c3]);
  await q(`insert into public.ad_reel_tracks (ad_reel_id, track_id, position, owner_id) values ('main', 't1', 0, $1), ('main', 't2', 1, $1), ('r2', 't1', 0, $1), ('main', 't3', 0, $2)`, [c2, c3]);
  await q(`insert into public.packs (id, owner_id, title) values ('p1', $1, 'Pack')`, [c2]);
  await q(`insert into public.settings (owner_id, published_at) values ($1, 1790000000000), ($2, 1780000000000) on conflict (owner_id) do update set published_at = excluded.published_at`, [c2, c3]);

  await as(2);
  check('un compositeur ordinaire est refusé', await fails(`select public.admin_adreels_report()`, /réservé aux admins/));
  await as(null);
  check('sans compte : refusé', await fails(`select public.admin_adreels_report()`, /réservé aux admins/));
  await as(1);
  const r = await val(`select public.admin_adreels_report()`);
  check('administrateur : un compositeur par ligne, compte supprimé exclu', Array.isArray(r) && r.map(x => x.handle).join() === 'jean,lea');
  const jean = r[0], lea = r[1];
  check('classement : dernière publication d\'abord', jean.publishedAt > lea.publishedAt);
  check('chiffres de jean : 2 morceaux, 1 pack, 0 collection, 0 album', jean.tracks == 2 && jean.packs == 1 && jean.collections == 0 && jean.albums == 0);
  check('AdReels de jean : principal (2 morceaux) et « english » (1 morceau, langue en)', jean.adreels.length === 2 && jean.adreels[0].id === 'main' && jean.adreels[0].tracks == 2 && jean.adreels[1].slug === 'english' && jean.adreels[1].lang === 'en' && jean.adreels[1].tracks == 1);
  check('un AdReel « main » d\'un autre compositeur ne se mélange pas (lea : 1 morceau)', lea.adreels.length === 1 && lea.adreels[0].tracks == 1);
  check('palier de chaque compositeur', jean.plan === 'pro' && lea.plan === 'free');
  const dump = JSON.stringify(r);
  check('aucune adresse e-mail dans le rapport', !/secret\.test|@/.test(dump));
  check('aucun contenu : ni titre de morceau, ni texte de bio', !/Secret titre|Texte secret|Autre/.test(dump));

  const R = require('./layerpitch-admin-report.js');
  const base = 'https://beta.layerpitch.com/';
  check('adresses : principal -> /<nom>/, par nom -> /<nom>/<adreel>, sans nom -> ?adreel=', R.adreelUrl('jean', { id: 'main', slug: null }) === base + 'jean/' && R.adreelUrl('jean', { id: 'r2', slug: 'english' }) === base + 'jean/english' && R.adreelUrl('jean', { id: 'r3', slug: null }) === base + 'jean/?adreel=r3');
  check('filtre par nom', R.filterRows(r, 'LE').map(x => x.handle).join() === 'lea' && R.filterRows(r, '').length === 2);
  const html = R.reportHtml(r, { tr: k => k, fmtDate: d => String(d).slice(0, 10), esc: s => String(s).replace(/</g, '&lt;') });
  check('tableau : une ligne par compositeur, lien vers chaque AdReel', (html.match(/<tr data-handle=/g) || []).length === 2 && html.includes(base + 'jean/english') && html.includes('data-handle="jean"'));
  const csv = R.reportCsv(r);
  const lines = csv.replace(/^﻿/, '').split('\n');
  check('CSV : en-tête + une ligne par compositeur, accents (BOM) pour Excel', lines.length === 3 && csv.charCodeAt(0) === 0xFEFF && /handle/.test(lines[0]));
  check('CSV : valeurs avec virgule ou guillemet protégées', R.csvCell('a,b') === '"a,b"' && R.csvCell('dit "oui"') === '"dit ""oui"""' && R.csvCell('simple') === 'simple' && R.csvCell(null) === '');
  check('le rapport ne laisse pas de HTML injecté (nom d\'adresse hostile)', !R.reportHtml([{ handle: '<img src=x onerror=1>', plan: 'free', tracks: 0, packs: 0, collections: 0, albums: 0, adreels: [] }], { tr: k => k, fmtDate: String, esc: s => String(s).replace(/</g, '&lt;') }).includes('<img'));

  // ---- Page admin ----
  const adminHtml = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
  check('page admin : carte du rapport, boutons Générer et Exporter, filtre', /id="adReelsReportBtn"/.test(adminHtml) && /id="adReelsReportCsvBtn"/.test(adminHtml) && /id="adReelsReportFilter"/.test(adminHtml) && /id="adReelsReportBody"/.test(adminHtml));
  check('page admin : le fichier de fonctions est chargé avant le script de la page', adminHtml.indexOf('layerpitch-admin-report.js') > 0 && adminHtml.indexOf('layerpitch-admin-report.js') < adminHtml.indexOf('window.LayerPitchAdminReport.filterRows'));
  const apiAdmin = fs.readFileSync(path.join(__dirname, 'api', 'admin.js'), 'utf8');
  check('API : getAdReelsReport appelle admin_adreels_report', /rpc\('admin_adreels_report'\)/.test(apiAdmin) && /getAdReelsReport,/.test(apiAdmin));
  const vm = require('vm'); const sb = { window: {} }; vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8'), sb);
  const I = sb.window.LAYERPITCH_I18N;
  const keys = [...adminHtml.matchAll(/tr\('(adReels[A-Za-z]+)'/g)].map(m => m[1]).concat(['adReelsColComposer', 'adReelsColPlan', 'adReelsColTracks', 'adReelsColPacks', 'adReelsColCollections', 'adReelsColAlbums', 'adReelsColPublished', 'adReelsColSignIn', 'adReelsColAdReels', 'adReelsReportTitle', 'adReelsReportHint']);
  check('textes du rapport : français et anglais', keys.every(k => I.fr.admin[k] && I.en.admin[k]));
  const scripts = [...adminHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let parses = true; try { scripts.forEach(sc => new Function(sc)); } catch (e) { parses = false; console.log(e.message); }
  check('page admin : le JavaScript de la page est valide', parses);
  console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
