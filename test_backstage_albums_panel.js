// Onglet Albums du backstage (vente d'Adaptive OST, 21 septembre) : extrait le bloc de code de
// layerpitch-backstage.html et le fait tourner dans jsdom avec de faux services (aucune base réelle).
// Vérifie le vrai comportement : chargement, création, ordre des pistes, prix en centimes, refus
// côté client, indice « publie d'abord », achat de test, interrupteur bêta coupé.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const tick = () => new Promise(r => setTimeout(r, 0));

const html = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf-8');
const start = html.indexOf('/* ---------------- Onglet Albums');
const end = html.indexOf('async function loadAnalyticsIfNeeded()');
check('bloc Albums trouvé dans le backstage', start > 0 && end > start);
const block = html.slice(start, end);

// Verrou bêta (21 septembre) : l'onglet Albums est réservé aux admins. Le bouton part masqué, la règle
// CSS empêche `.nav-item { display:flex }` d'écraser l'attribut hidden, et seul renderAdminOnlyPanels()
// l'affiche (la vraie barrière reste côté serveur, voir les RPC).
check('bouton Albums masqué par défaut', /<button[^>]*id="navItemAlbums"[^>]*\bhidden\b/.test(html));
check('règle CSS .nav-item[hidden] présente (sinon hidden est ignoré)', /\.nav-item\[hidden\]\s*\{\s*display:\s*none/.test(html));
check('renderAdminOnlyPanels affiche le bouton selon la matrice (sell_albums : admin seulement tant que le feu vert est fermé)', /albumsNavBtn\.hidden\s*=\s*!can\('sell_albums'\)/.test(html));

// Vraies traductions (mêmes que le navigateur)
const i18nSandbox = { window: {} };
vm.createContext(i18nSandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8'), i18nSandbox);
const I18N = i18nSandbox.window.LAYERPITCH_I18N;

async function scenario({ testEnabled, saveResult, claimResult, contributions }) {
  const dom = new JSDOM(`<div id="albumsContainer"></div><button id="btnAddAlbum"></button><div id="albumsLibraryContainer"></div>`, { runScripts: 'outside-only' });
  const w = dom.window;
  const calls = { upsert: [], claim: [] };
  let purchases = [];
  const rights = { declaration: 'sole', holders: [] };
  const rightsState = () => ({ declaration: rights.declaration, ackAt: rights.declaration === 'shared' ? '2026-09-28' : null, settled: rights.holders.every(h => h.status !== 'pending'), sellerShareBps: 10000 - rights.holders.reduce((a, h) => a + h.shareBps, 0), holders: rights.holders.map(h => Object.assign({}, h)) });
  w.LayerPitchNotify = { confirm: async () => true };
  w.LayerPitchAuth = { getSession: async () => ({ session: { user: { id: 'user-1' } } }), ensureMyComposerProfile: async () => ({ composerId: 'comp-1', error: null }) };
  w.LayerPitchAlbums = {
    listAlbums: async ({ sellerId }) => ({ albums: [{ id: 'alb_old', title: 'Déjà là', presentationFr: '', presentationEn: '', priceEurCents: 300, buyable: true, trackIds: ['t2'], officialDurations: { t2: 30 } }], error: null, _seller: sellerId }),
    listMyPurchases: async () => ({ purchases, error: null }),
    getPlatformFlags: async () => ({ flags: { testPurchasesEnabled: testEnabled }, error: null }),
    upsertAlbum: async p => { calls.upsert.push(p); return saveResult(p); },
    getAlbumRights: async () => ({ rights: rightsState(), error: null }),
    setAlbumRights: async (id, decl, holders, ack) => { calls.setRights = { id, decl, holders, ack }; if (decl === 'shared' && !ack) return { rights: null, error: 'avertissement' };
      rights.declaration = decl; rights.holders = holders.map((h, i) => ({ id: 'h' + i, email: h.email, shareBps: h.shareBps, status: 'pending' }));
      return { rights: Object.assign(rightsState(), { toInvite: rights.holders.map(h => h.id), unlisted: true }), error: null }; },
    inviteRightsHolder: async (albumId, holderId) => { (calls.invites = calls.invites || []).push(holderId); return holderId === 'h1' ? { ok: false, error: 'Resend en panne', actionLink: 'https://lien' } : { ok: true }; },
    markRightsHolderSelfPay: async holderId => { rights.holders.find(h => h.id === holderId).status = 'self_pay'; return { rights: rightsState(), error: null }; },
    setAlbumShopListed: async (id, on) => { calls.shopListed = { id, on }; return { ok: true }; },
    setAlbumListening: async (id, mode, ids) => { calls.listen = { id, mode, ids }; return { ok: true }; },
    myAlbumContributions: async () => ({ contributions: contributions || [], error: null }),
    setAlbumContributorTracks: async (id, ids) => { (calls.contribSave = calls.contribSave || []).push({ id, ids }); return { ok: true, unpublished: ids.length === 0 }; },
    leaveAlbum: async id => { calls.left = id; return { ok: true }; },
    claimTestAlbum: async id => { calls.claim.push(id); const r = claimResult(id); if (r.ok) purchases = [{ albumId: id, title: 'Déjà là', isTest: true, purchasedAt: '2026-09-21T10:00:00Z' }]; return r; },
  };
  w.library = [{ id: 't1', title: 'Forêt' }, { id: 't2', title: 'Combat' }, { id: 't3', title: 'Crépuscule' }];
  w.loadPostgresReadScripts = async () => {};
  // Pochette (A.9) : sélecteur de fichier et envoi R2 simulés ; onSelect gardé par album pour « choisir » un fichier.
  calls.put = []; calls.coverSelect = {};
  w.fileCtrlHtml = () => '<span data-role="fileStatus"></span>';
  w.wireFileControl = (root, accept, getPending, getRemote, onSelect) => { calls.coverSelect[[...root.ownerDocument.querySelectorAll('.list-block')].indexOf(root.closest('.list-block'))] = onSelect; };
  w.MEDIA_BASE = 'https://media.layerpitch.com/';
  w.extOf = n => (/\.([a-z0-9]+)$/i.exec(n || '') || [0, 'jpg'])[1].toLowerCase();
  w.imageContentType = e => 'image/' + e;
  w.r2PutFile = async (key, bytes, type) => { calls.put.push({ key, type, n: bytes.length }); };
  w.URL.createObjectURL = () => 'blob:cover'; w.URL.revokeObjectURL = () => {};
  w.currentLang = () => 'fr';
  w.tr = (key, vars) => {
    let s = (I18N.fr.backstage[key]) || (I18N.fr.shared[key]) || key;
    if (vars) Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  };
  w.escapeHtml = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  w.escapeAttr = s => (s || '').replace(/"/g, '&quot;');
  // const/let de niveau supérieur ne deviennent pas des propriétés de window : on expose ce qu'il faut.
  // Briques communes (layerpitch-album-shared.js) : le vrai module, avec les vraies traductions.
  w.LAYERPITCH_I18N = I18N;
  w.eval(fs.readFileSync(path.join(__dirname, 'layerpitch-album-shared.js'), 'utf-8'));
  w.eval(fs.readFileSync(path.join(__dirname, 'layerpitch-album-editor.js'), 'utf-8'));
  w.activePreviewIds = new Set();
  dom.window.eval(block + '\nwindow.__t = { albumsState, loadAlbums, renderAlbums };');
  return { w, doc: w.document, calls, t: w.__t };
}
const change = (w, el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
const input = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const click = (el) => el.dispatchEvent(new (el.ownerDocument.defaultView.MouseEvent)('click', { bubbles: true }));

(async () => {
  // ---- Scénario 1 : parcours complet, achat de test actif ----
  let s = await scenario({ testEnabled: true, saveResult: () => ({ ok: true, data: {} }), claimResult: () => ({ ok: true, alreadyOwned: false }) });
  await s.t.loadAlbums(); await tick();
  let cards = s.doc.querySelectorAll('#albumsContainer .list-block');
  check('l\'album existant est affiché', cards.length === 1 && s.doc.querySelector('[data-ae-field="title"]').value === 'Déjà là');
  check('prix minimum affiché en euros (300 cts -> 3.00)', s.doc.querySelector('[data-ae-field="priceInput"]').value === '3.00');
  check('bouton « Obtenir (test) » visible (album enregistré, en vente, interrupteur actif)', !!s.doc.querySelector('[data-ae-extra]'));
  // Version du compositeur (A.7, 26/09) : t2 en a une (✓ 0:30, écoutable) ; bouton « Refaire »
  const firstCard = () => s.doc.querySelectorAll('#albumsContainer .list-block')[0];
  check('version du compositeur de t2 : ✓ 0:30, Écouter et Refaire', /✓ 0:30/.test(firstCard().textContent) && !!firstCard().querySelector('[data-ae-play="t2"]') && /Refaire/.test(firstCard().querySelector('[data-ae-record="t2"]').textContent));
  check('bibliothèque « albums obtenus » vide au départ', /Aucun album obtenu/.test(s.doc.getElementById('albumsLibraryContainer').textContent));

  click(s.doc.getElementById('btnAddAlbum'));
  cards = s.doc.querySelectorAll('#albumsContainer .list-block');
  check('« + Album » ajoute un brouillon « non enregistré »', cards.length === 2 && /non enregistré/.test(cards[1].textContent));
  check('pas de bouton test sur un brouillon non enregistré', cards[1].querySelector('[data-ae-extra]') === null);

  input(s.w, s.doc.querySelectorAll('[data-ae-field="title"]')[1], 'Mon OST');
  input(s.w, s.doc.querySelectorAll('[data-ae-field="priceInput"]')[1], '3,5');
  // Cocher Crépuscule (t3) puis Forêt (t1) : l'ordre suit l'ordre de cochage
  let boxes = () => s.doc.querySelectorAll('#albumsContainer .list-block')[1].querySelectorAll('[data-ae-track]');
  let t3 = [...boxes()].find(b => b.dataset.aeTrack === 't3'); t3.checked = true; change(s.w, t3);
  let t1 = [...boxes()].find(b => b.dataset.aeTrack === 't1'); t1.checked = true; change(s.w, t1);
  const labelsText = [...s.doc.querySelectorAll('#albumsContainer .list-block')[1].querySelectorAll('label span')].map(x => x.textContent);
  check('numérotation selon l\'ordre de cochage (1. Crépuscule, 2. Forêt)', labelsText.includes('1. Crépuscule') && labelsText.includes('2. Forêt'));
  check('la saisie du titre survit au re-rendu (état conservé)', s.doc.querySelectorAll('[data-ae-field="title"]')[1].value === 'Mon OST');

  // Refus côté client : en vente sans prix
  let buyable = s.doc.querySelectorAll('[data-ae-buyable]')[1]; buyable.checked = true; change(s.w, buyable);
  input(s.w, s.doc.querySelectorAll('[data-ae-field="priceInput"]')[1], '');
  click(s.doc.querySelectorAll('[data-ae-save]')[1]); await tick();
  check('en vente sans prix : refusé côté client, aucun appel serveur', s.calls.upsert.length === 0 && /prix minimum/i.test(s.doc.getElementById('albumsContainer').textContent));
  input(s.w, s.doc.querySelectorAll('[data-ae-field="priceInput"]')[1], '-2');
  click(s.doc.querySelectorAll('[data-ae-save]')[1]); await tick();
  check('prix négatif : refusé côté client', s.calls.upsert.length === 0 && /invalide/i.test(s.doc.getElementById('albumsContainer').textContent));

  input(s.w, s.doc.querySelectorAll('[data-ae-field="priceInput"]')[1], '3,5');
  // En vente sans version du compositeur (A.7, 26/09) : refusé côté client, morceaux manquants nommés
  click(s.doc.querySelectorAll('[data-ae-save]')[1]); await tick();
  check('en vente sans versions du compositeur : refusé, morceaux nommés, aucun appel serveur', s.calls.upsert.length === 0 && /Manquante : Crépuscule, Forêt/.test(s.doc.getElementById('albumsContainer').textContent));
  check('brouillon : les versions se préparent après l\'enregistrement', /Enregistre d’abord l’album/.test(s.doc.querySelectorAll('#albumsContainer .list-block')[1].textContent));
  buyable = s.doc.querySelectorAll('[data-ae-buyable]')[1]; buyable.checked = false; change(s.w, buyable);
  click(s.doc.querySelectorAll('[data-ae-save]')[1]); await tick(); await tick();
  const p = s.calls.upsert[0];
  check('enregistrement : prix converti en centimes (3,5 -> 350)', p && p.priceEurCents === 350);
  check('enregistrement : pistes dans l\'ordre de cochage, hors vente', p && p.trackIds.join() === 't3,t1' && p.buyable === false && p.title === 'Mon OST');
  check('enregistrement : id aléatoire préfixé alb_', p && /^alb_[a-z0-9]{8,}$/.test(p.id));
  check('après enregistrement : message « Album enregistré » et le badge disparaît', /Album enregistré/.test(s.doc.getElementById('albumsContainer').textContent) && !/non enregistré/.test(s.doc.getElementById('albumsContainer').textContent));
  const newCard = () => s.doc.querySelectorAll('#albumsContainer .list-block')[1];
  check('après enregistrement : chaque morceau « à enregistrer » avec « Enregistrer »', (newCard().textContent.match(/à enregistrer/g) || []).length === 2 && newCard().querySelectorAll('[data-ae-record]').length === 2 && !newCard().querySelector('[data-ae-play]'));
  // Versions enregistrées (état simulé, comme après l'enregistreur) : la mise en vente passe
  s.t.albumsState.albums[1].officialDurations = { t3: 61, t1: 42 };
  buyable = s.doc.querySelectorAll('[data-ae-buyable]')[1]; buyable.checked = true; change(s.w, buyable);
  click(s.doc.querySelectorAll('[data-ae-save]')[1]); await tick(); await tick();
  check('toutes les versions : mise en vente envoyée au serveur', s.calls.upsert.length === 2 && s.calls.upsert[1].buyable === true);
  check('après mise en vente : le bouton test apparaît sur le nouvel album', s.doc.querySelectorAll('[data-ae-extra]').length === 2);

  click(s.doc.querySelectorAll('[data-ae-extra]')[0]); await tick(); await tick();
  check('achat de test : appel serveur sur le bon album', s.calls.claim.join() === 'alb_old');
  check('achat de test : l\'album apparaît dans « albums obtenus » avec le badge test', /Déjà là/.test(s.doc.getElementById('albumsLibraryContainer').textContent) && /test/.test(s.doc.getElementById('albumsLibraryContainer').textContent));

  // ---- Scénario 2 : le serveur refuse pour cause de pistes non publiées ----
  s = await scenario({ testEnabled: true, saveResult: () => ({ ok: false, error: 'Non autorisé : une ou plusieurs pistes n\'appartiennent pas à ce compositeur' }), claimResult: () => ({ ok: true }) });
  await s.t.loadAlbums(); await tick();
  click(s.doc.querySelector('[data-ae-save]')); await tick(); await tick();
  const txt = s.doc.getElementById('albumsContainer').textContent;
  check('refus « pistes » : erreur + indice « Publie d\'abord ta bibliothèque »', /Échec de l'enregistrement/.test(txt) && /Publie d'abord/.test(txt));

  // ---- Scénario 2b : morceau décoché d'un album déjà obtenu -> gardé pour les acheteurs, message au compositeur ----
  s = await scenario({ testEnabled: true, saveResult: () => ({ ok: true, data: { ok: true, keptForBuyers: ['t2'] } }), claimResult: () => ({ ok: true }) });
  await s.t.loadAlbums(); await tick();
  const t2box = s.doc.querySelector('[data-ae-track="t2"]'); t2box.checked = false; change(s.w, t2box);
  const buy2 = s.doc.querySelector('[data-ae-buyable]'); buy2.checked = false; change(s.w, buy2);
  click(s.doc.querySelector('[data-ae-save]')); await tick(); await tick();
  const txt2 = s.doc.getElementById('albumsContainer').textContent;
  check('morceau décoché d\'un album obtenu : message « Retiré… ceux qui ont déjà l\'album le gardent »', /Album enregistré/.test(txt2) && /Retiré de l’album : Combat/.test(txt2) && /déjà l’album le gardent/.test(txt2));

  // ---- Pochette (A.9, 27/09) : aperçu local, envoi R2 à l'enregistrement, nom enregistré avec l'album ----
  s = await scenario({ testEnabled: true, saveResult: () => ({ ok: true, data: {} }), claimResult: () => ({ ok: true }) });
  await s.t.loadAlbums(); await tick();
  check('pochette : sélecteur présent, pas encore d\'image', !!s.calls.coverSelect['0'] && !s.doc.querySelector('#albumsContainer img'));
  const coverFile = new s.w.File([new Uint8Array([1, 2, 3])], 'Ma pochette.PNG', { type: 'image/png' });
  s.calls.coverSelect['0'](coverFile);
  check('pochette choisie : aperçu local affiché', s.doc.querySelector('#albumsContainer img').getAttribute('src') === 'blob:cover');
  click(s.doc.querySelector('[data-ae-save]')); await tick(); await tick(); await tick();
  const up = s.calls.upsert[s.calls.upsert.length - 1];
  check('pochette envoyée dans le dossier du compositeur, images/<id compositeur>/album-<id>.png', s.calls.put.length === 1 && s.calls.put[0].key === 'images/comp-1/album-alb_old.png' && s.calls.put[0].type === 'image/png' && s.calls.put[0].n === 3);
  check('pochette enregistrée avec l\'album (nom de fichier + nom d\'origine)', up.illustration === 'comp-1/album-alb_old.png' && up.illustrationOriginalName === 'Ma pochette.PNG');
  check('après enregistrement : image servie depuis le stockage', s.doc.querySelector('#albumsContainer img').getAttribute('src') === 'https://media.layerpitch.com/images/comp-1/album-alb_old.png');
  click(s.doc.querySelector('[data-ae-save]')); await tick(); await tick();
  check('enregistrement suivant : pas de nouvel envoi, pochette non écrasée', s.calls.put.length === 1 && !('illustration' in s.calls.upsert[s.calls.upsert.length - 1]));

  // ---- Scénario Droits : co-ayants droit (étape 4a) ----
  s = await scenario({ testEnabled: false, saveResult: () => ({ ok: true, data: {} }), claimResult: () => ({ ok: true }) });
  await s.t.loadAlbums(); await tick(); await tick(); await tick();
  const radios = s.doc.querySelectorAll('[data-ae-rights-decl]');
  check('droits : « seul propriétaire » coché par défaut', radios.length === 2 && radios[0].checked);
  radios[1].checked = true; change(s.w, radios[1]); await tick();
  input(s.w, s.doc.querySelector('[data-ae-rcol="email"]'), 'coco@x.test');
  input(s.w, s.doc.querySelector('[data-ae-rcol="pct"]'), '30');
  click(s.doc.querySelector('[data-ae-radd]')); await tick();
  input(s.w, s.doc.querySelectorAll('[data-ae-rcol="email"]')[1], 'absent@x.test');
  input(s.w, s.doc.querySelectorAll('[data-ae-rcol="pct"]')[1], '12,5');
  click(s.doc.querySelector('[data-ae-rsave]')); await tick(); await tick();
  check('droits : sans l\'avertissement coché, le serveur refuse et le message s\'affiche', s.calls.setRights.ack === false && /avertissement/.test(s.doc.getElementById('albumsContainer').textContent));
  const ack = s.doc.querySelector('[data-ae-rack]'); ack.checked = true; change(s.w, ack);
  click(s.doc.querySelector('[data-ae-rsave]')); for (let i = 0; i < 6; i++) await tick();
  check('droits : parts envoyées en points de base (30 % -> 3000, 12,5 % -> 1250)', s.calls.setRights.holders[0].shareBps === 3000 && s.calls.setRights.holders[1].shareBps === 1250 && s.calls.setRights.ack === true);
  check('droits : une invitation envoyée par co-ayant droit', (s.calls.invites || []).join(',') === 'h0,h1');
  const rtxt = s.doc.getElementById('albumsContainer').textContent;
  check('droits : échec d\'envoi signalé avec le lien à transmettre soi-même', /Resend en panne/.test(rtxt) && /https:\/\/lien/.test(rtxt));
  check('droits : album retiré de la vente côté écran', s.t.albumsState.albums[0].buyable === false);
  check('droits : statuts affichés + « Je reverse moi-même » proposé', s.doc.querySelectorAll('[data-ae-rselfpay]').length === 2 && /en attente/.test(rtxt));
  click(s.doc.querySelector('[data-ae-rselfpay]')); for (let i = 0; i < 4; i++) await tick();
  check('droits : injoignable réglé par le vendeur', /je reverse moi-même/.test(s.doc.getElementById('albumsContainer').textContent) && s.doc.querySelectorAll('[data-ae-rselfpay]').length === 1);

  // ---- Scénario 3 : interrupteur bêta coupé ----
  s = await scenario({ testEnabled: false, saveResult: () => ({ ok: true }), claimResult: () => ({ ok: true }) });
  await s.t.loadAlbums(); await tick();
  check('interrupteur coupé : aucun bouton « Obtenir (test) »', s.doc.querySelector('[data-ae-extra]') === null);

  // ---- Échappement HTML ----
  s = await scenario({ testEnabled: true, saveResult: () => ({ ok: true }), claimResult: () => ({ ok: true }) });
  s.w.library = [{ id: 'x', title: '<img src=x onerror=alert(1)>' }];
  await s.t.loadAlbums(); await tick();
  check('titre de morceau malveillant : échappé, aucune balise injectée', s.doc.querySelector('#albumsContainer img') === null);

  // ---- Écoute libre (29/09) : aucun / tout / certains morceaux, enregistré avec l'album ----
  s = await scenario({ testEnabled: true, saveResult: () => ({ ok: true, data: {} }), claimResult: () => ({ ok: true }) });
  await s.t.loadAlbums(); await tick();
  check('écoute libre : par défaut « rien » sur un album existant', s.doc.querySelector('input[data-ae-listen="none"]').checked);
  const some = s.doc.querySelector('input[data-ae-listen="selected"]'); some.checked = true; change(s.w, some);
  const free = s.doc.querySelector('input[data-ae-free="t2"]'); free.checked = true; change(s.w, free);
  click(s.doc.querySelector('[data-ae-save]')); await tick(); await tick(); await tick();
  check('écoute libre : « certains morceaux » (t2) envoyé après l\'enregistrement', JSON.stringify(s.calls.listen) === '{"id":"alb_old","mode":"selected","ids":["t2"]}');
  const shopBox = s.doc.querySelector('input[data-ae-shop]'); shopBox.checked = true; change(s.w, shopBox);
  click(s.doc.querySelector('[data-ae-save]')); await tick(); await tick(); await tick();
  check('Shop : « Afficher dans le Shop » coché puis enregistré avec l\'album', JSON.stringify(s.calls.shopListed) === '{"id":"alb_old","on":true}');
  const all = s.doc.querySelector('input[data-ae-listen="all"]'); all.checked = true; change(s.w, all);
  click(s.doc.querySelector('[data-ae-save]')); await tick(); await tick(); await tick();
  check('écoute libre : « tout l\'album »', s.calls.listen.mode === 'all');

  // ---- Compositeur invité sur l'album d'un studio (29/09) ----
  s = await scenario({ testEnabled: true, saveResult: () => ({ ok: true }), claimResult: () => ({ ok: true }),
    contributions: [{ albumId: 'alb_studio', title: 'OST du studio', buyable: true, studioEmail: 'studio@x.test', tracks: [{ trackId: 't2', title: 'Combat', hasOfficial: true, duration: 42 }] }] });
  await s.t.loadAlbums(); await tick();
  cards = s.doc.querySelectorAll('#albumsContainer .list-block');
  check('album de studio : carte réduite avec badge « invité », titre en lecture seule', cards.length === 2 && /Album de studio \(invité\)/.test(cards[0].textContent) && cards[0].querySelector('[data-ae-field="title"]') === null);
  check('album de studio : ni prix, ni mise en vente, ni présentation, ni pochette', !cards[0].querySelector('[data-ae-field]') && !cards[0].querySelector('[data-ae-cover-ctrl]') && !cards[0].querySelector('[data-ae-extra]'));
  check('album de studio : nom du studio et mes morceaux cochés (t2)', /studio@x\.test/.test(cards[0].textContent) && cards[0].querySelector('[data-ae-track="t2"]').checked && !cards[0].querySelector('[data-ae-track="t1"]').checked);
  check('album de studio : version officielle de t2 (✓ 0:42) et bouton pour l\'enregistrer', /✓ 0:42/.test(cards[0].textContent) && !!cards[0].querySelector('[data-ae-record="t2"]'));
  const cb = cards[0].querySelector('[data-ae-track="t1"]'); cb.checked = true; change(s.w, cb);
  click(s.doc.querySelector('#albumsContainer [data-ae-contrib-save]')); await tick(); await tick();
  check('enregistrer : seulement MES morceaux envoyés (t2 puis t1)', JSON.stringify(s.calls.contribSave) === JSON.stringify([{ id: 'alb_studio', ids: ['t2', 't1'] }]) && !s.calls.upsert.length);
  click(s.doc.querySelector('#albumsContainer [data-ae-contrib-leave]')); await tick(); await tick();
  check('quitter l\'album : l\'invité sort, la carte disparaît, l\'autre reste', s.calls.left === 'alb_studio' && s.doc.querySelectorAll('#albumsContainer .list-block').length === 1);

  console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
