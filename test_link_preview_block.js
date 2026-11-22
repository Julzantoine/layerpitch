// Bloc invisible « Aperçu du lien » des AdReels (22/11) : 1) la base — get_share_preview lit le bloc de CET AdReel avant le réglage du
// compte puis le profil ; 2) le Backstage — ajout (un seul), champs, résumé, instantané publié, copie d'un AdReel ; 3) la page publique
// n'affiche rien pour ce type de bloc.
const fs = require('fs');
const { loadBackstage } = require('./scripts/test-harness.js');

let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; };

(async () => {
  // ---- 1) Base ----
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); } catch (e) { console.log('FAIL PGlite absent : ' + e.message); process.exit(1); }
  const db = await freshDb();
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  await q(`insert into auth.users (id, email) values ($1, 'a@x.test')`, [U(1)]);
  await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(1)]);
  const c1 = (await q(`insert into public.composer_profiles (profile_id, handle) values ($1, 'jean') returning id`, [U(1)]))[0].id;
  const blk = (extra) => JSON.stringify([{ id: 'b1', type: 'text', title: 'Salut', content: 'x' }, Object.assign({ id: 'lp1', type: 'linkpreview' }, extra)]);
  await q(`insert into public.ad_reels (id, owner_id, label, lang, profile, blocks) values ('main', $1, 'Principal', 'fr', $2::jsonb, $3::jsonb)`,
    [c1, JSON.stringify({ title: 'Duo Svatistana', subtitle: '27 novembre Hirson', photo: c1 + '/photo.jpg' }), blk({ title: 'Ma musique, jouée comme dans votre jeu', description: 'Testez les embranchements', image: c1 + '/lp1-share.png' })]);
  await q(`insert into public.ad_reels (id, owner_id, label, lang, profile, blocks, slug) values ('r2', $1, 'Concerts', 'fr', $2::jsonb, '[]'::jsonb, 'concerts')`,
    [c1, JSON.stringify({ title: 'Concerts de Poche', subtitle: 'Hirson' })]);
  const P = (alt) => val(`select public.get_share_preview('adreel', 'jean', '', $1)`, [alt || '']);
  let r = await P();
  check('AdReel avec bloc : titre, description et image du bloc (avant le profil)', r.title === 'Ma musique, jouée comme dans votre jeu' && r.descriptionFr === 'Testez les embranchements' && r.image === c1 + '/lp1-share.png');
  r = await P('r2');
  check('AdReel sans bloc : profil inchangé', r.title === 'Concerts de Poche' && r.descriptionFr === 'Hirson');
  await db.query(`select set_config('test.uid', $1, false)`, [U(1)]);
  await q(`select public.upsert_settings($1::jsonb)`, [JSON.stringify({ publishedAt: 1, sharePreview: { title: 'Titre du compte', description: 'Desc du compte', image: c1 + '/share-preview.png' } })]);
  r = await P('r2');
  check('AdReel sans bloc : le réglage du compte reste en repli (liens actuels inchangés)', r.title === 'Titre du compte' && r.descriptionFr === 'Desc du compte' && r.image === c1 + '/share-preview.png');
  r = await P();
  check('AdReel avec bloc : le bloc passe avant le réglage du compte', r.title === 'Ma musique, jouée comme dans votre jeu' && r.image === c1 + '/lp1-share.png');
  await q(`update public.ad_reels set blocks = $2::jsonb where id = 'main' and owner_id = $1`, [c1, blk({ title: '', description: '', image: null })]);
  r = await P();
  check('bloc vide : champ par champ, retour au réglage du compte', r.title === 'Titre du compte' && r.descriptionFr === 'Desc du compte' && r.image === c1 + '/share-preview.png');
  await q(`update public.ad_reels set blocks = $2::jsonb where id = 'main' and owner_id = $1`, [c1, blk({ title: 'T', image: 'autre-compositeur/vol.png' })]);
  r = await P();
  check('image hors du dossier du compositeur : ignorée (repli sur le réglage du compte)', r.title === 'T' && r.image === c1 + '/share-preview.png');
  await q(`update public.ad_reels set blocks = $2::jsonb where id = 'main' and owner_id = $1`, [c1, blk({ title: 'T', image: c1 + '/../x.png' })]);
  check('image avec « .. » : ignorée', (await P()).image === c1 + '/share-preview.png');
  await q(`update public.ad_reels set blocks = $2::jsonb, access_mode = 'magic' where id = 'main' and owner_id = $1`, [c1, blk({ title: 'Secret', description: 'Secret', image: c1 + '/lp1-share.png' })]);
  r = await P();
  check('AdReel privé : rien du bloc n\'est révélé', r.title === 'jean' && r.descriptionFr === null && r.image === null);

  // ---- 2) Backstage ----
  const dom = await loadBackstage();
  const w = dom.window, doc = w.document, run = code => w.eval(code);
  run('flagOpen = () => true');
  run("blocks = []; blockCards = {}; hasUnsavedEdits = false; layoutBlocks()");
  const addBtn = doc.getElementById('btnAddLinkPreviewBlock');
  check('bouton « + Bloc aperçu du lien » présent', !!addBtn);
  addBtn.hidden = false;
  addBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('clic : un bloc linkpreview est ajouté, avec sa carte', run('blocks.length') === 1 && run("blocks[0].type") === 'linkpreview' && !!doc.querySelector('.block-editor-card[data-type="linkpreview"]'));
  check('un seul par AdReel : le bouton disparaît', addBtn.style.display === 'none');
  addBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('un second clic n\'ajoute rien', run('blocks.length') === 1);
  const card = doc.querySelector('.block-editor-card[data-type="linkpreview"]');
  check('résumé : « non affiché sur la page »', /non affiché sur la page/.test(card.querySelector('.block-summary').textContent));
  check('aucune section d\'apparence sur ce bloc invisible', !card.querySelector('.block-appearance, [data-role="appearanceSection"]') && !/Apparence du bloc/i.test(card.textContent));
  const typeIn = (sel, v) => { const el = card.querySelector(sel); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  typeIn('[data-role="lpTitle"]', 'Ma musique <jouée>'); typeIn('[data-role="lpDesc"]', 'Une description');
  check('saisie : état du bloc, modifications non publiées', run('blocks[0].title') === 'Ma musique <jouée>' && run('blocks[0].description') === 'Une description' && run('hasUnsavedEdits') === true);
  check('maquette redessinée, texte échappé', /Une description/.test(card.querySelector('[data-role="lpMock"]').textContent) && !card.querySelector('[data-role="lpMock"] jouée'));
  check('résumé : titre puis « non affiché »', /Ma musique/.test(card.querySelector('.block-summary').textContent) && /non affiché/.test(card.querySelector('.block-summary').textContent));
  run("adReels = [{ id: 'main', label: 'Principal', lang: 'fr', blocks: blocks, profile: Object.assign({}, profile), testimonials: [], trackIds: [], trackOverrides: {} }]; currentAdReelId = 'main'");
  const snap = run("buildDataSnapshot('pro', 1)");
  const sb = snap.adReels.flatMap(a => a.blocks).find(b => b.type === 'linkpreview');
  check('instantané publié : titre, description, ajustage', !!sb && sb.title === 'Ma musique <jouée>' && sb.description === 'Une description' && sb.autoFit === true && sb.fitMode === 'fill' && sb.image === null);
  run("blocks[0].image = 'cmp1/lp-share.png'; blocks[0].imageOriginalName = 'a.png'");
  const rm = card.querySelector('[data-role="lpRemoveImage"]');
  rm.hidden = false; rm.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('retrait de l\'image : état vidé, fichier publié en file d\'effacement', run('blocks[0].image') === null && run("pendingOrphanR2Keys.has('images/cmp1/lp-share.png')") === true);
  // Copie d'un AdReel : texte gardé, image non partagée
  run("blocks[0].image = 'cmp1/lp-share.png'");
  const copy = run("buildBlocksForNewAdReel({ blocks: blocks, profile: {} }, true).find(b => b.type === 'linkpreview')");
  check('copie d\'un AdReel : texte gardé, image non partagée avec l\'original', !!copy && copy.title === 'Ma musique <jouée>' && copy.image === null && copy.pendingFile === null);
  // Page publique : le moteur d'affichage ignore le type
  const reelSrc = fs.readFileSync(__dirname + '/reel.js', 'utf-8');
  check('page publique : aucun rendu pour le type linkpreview', !/case 'linkpreview'/.test(reelSrc));
  // Remplacer l'image : le retrait met l'ancien fichier en file d'effacement ; un nom d'envoi identique effaçait aussi le nouveau
  // fichier (et le navigateur gardait l'ancienne image). Garde sur le code : chaque envoi reçoit un nom neuf.
  const pub = fs.readFileSync(__dirname + '/src/backstage/42-publication.js', 'utf-8');
  check('envoi d\'image du bloc : nom neuf à chaque publication', /-share-\$\{Date\.now\(\)\.toString\(36\)\}/.test(pub));
  check('envoi de l\'image du réglage du compte : nom neuf à chaque publication', /share-preview-\$\{Date\.now\(\)\.toString\(36\)\}/.test(pub));
  console.log(failures ? failures + ' échec(s)' : 'Tous les tests passent');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
