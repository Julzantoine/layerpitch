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
check('renderAdminOnlyPanels affiche le bouton seulement pour un admin', /albumsNavBtn\.hidden\s*=\s*!isAdmin/.test(html));

// Vraies traductions (mêmes que le navigateur)
const i18nSandbox = { window: {} };
vm.createContext(i18nSandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8'), i18nSandbox);
const I18N = i18nSandbox.window.LAYERPITCH_I18N;

async function scenario({ testEnabled, saveResult, claimResult }) {
  const dom = new JSDOM(`<div id="albumsContainer"></div><button id="btnAddAlbum"></button><div id="albumsLibraryContainer"></div>`, { runScripts: 'outside-only' });
  const w = dom.window;
  const calls = { upsert: [], claim: [] };
  let purchases = [];
  w.LayerPitchAuth = { getSession: async () => ({ session: { user: { id: 'user-1' } } }) };
  w.LayerPitchAlbums = {
    listAlbums: async ({ sellerId }) => ({ albums: [{ id: 'alb_old', title: 'Déjà là', presentationFr: '', presentationEn: '', priceUsdCents: 300, buyable: true, trackIds: ['t2'] }], error: null, _seller: sellerId }),
    listMyPurchases: async () => ({ purchases, error: null }),
    getPlatformFlags: async () => ({ flags: { testPurchasesEnabled: testEnabled }, error: null }),
    upsertAlbum: async p => { calls.upsert.push(p); return saveResult(p); },
    claimTestAlbum: async id => { calls.claim.push(id); const r = claimResult(id); if (r.ok) purchases = [{ albumId: id, title: 'Déjà là', isTest: true, purchasedAt: '2026-09-21T10:00:00Z' }]; return r; },
  };
  w.library = [{ id: 't1', title: 'Forêt' }, { id: 't2', title: 'Combat' }, { id: 't3', title: 'Crépuscule' }];
  w.loadPostgresReadScripts = async () => {};
  w.currentLang = () => 'fr';
  w.tr = (key, vars) => {
    let s = (I18N.fr.backstage[key]) || (I18N.fr.shared[key]) || key;
    if (vars) Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  };
  w.escapeHtml = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  w.escapeAttr = s => (s || '').replace(/"/g, '&quot;');
  // const/let de niveau supérieur ne deviennent pas des propriétés de window : on expose ce qu'il faut.
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
  check('l\'album existant est affiché', cards.length === 1 && s.doc.querySelector('[data-album-field="title"]').value === 'Déjà là');
  check('prix minimum affiché en dollars (300 cts -> 3.00)', s.doc.querySelector('[data-album-field="priceInput"]').value === '3.00');
  check('bouton « Obtenir (test) » visible (album enregistré, en vente, interrupteur actif)', !!s.doc.querySelector('[data-action="claim-test-album"]'));
  check('bibliothèque « albums obtenus » vide au départ', /Aucun album obtenu/.test(s.doc.getElementById('albumsLibraryContainer').textContent));

  click(s.doc.getElementById('btnAddAlbum'));
  cards = s.doc.querySelectorAll('#albumsContainer .list-block');
  check('« + Album » ajoute un brouillon « non enregistré »', cards.length === 2 && /non enregistré/.test(cards[1].textContent));
  check('pas de bouton test sur un brouillon non enregistré', cards[1].querySelector('[data-action="claim-test-album"]') === null);

  input(s.w, s.doc.querySelectorAll('[data-album-field="title"]')[1], 'Mon OST');
  input(s.w, s.doc.querySelectorAll('[data-album-field="priceInput"]')[1], '3,5');
  // Cocher Crépuscule (t3) puis Forêt (t1) : l'ordre suit l'ordre de cochage
  let boxes = () => s.doc.querySelectorAll('#albumsContainer .list-block')[1].querySelectorAll('[data-album-track]');
  let t3 = [...boxes()].find(b => b.dataset.albumTrack === 't3'); t3.checked = true; change(s.w, t3);
  let t1 = [...boxes()].find(b => b.dataset.albumTrack === 't1'); t1.checked = true; change(s.w, t1);
  const labelsText = [...s.doc.querySelectorAll('#albumsContainer .list-block')[1].querySelectorAll('label span')].map(x => x.textContent);
  check('numérotation selon l\'ordre de cochage (1. Crépuscule, 2. Forêt)', labelsText.includes('1. Crépuscule') && labelsText.includes('2. Forêt'));
  check('la saisie du titre survit au re-rendu (état conservé)', s.doc.querySelectorAll('[data-album-field="title"]')[1].value === 'Mon OST');

  // Refus côté client : en vente sans prix
  let buyable = s.doc.querySelectorAll('[data-album-field="buyable"]')[1]; buyable.checked = true; change(s.w, buyable);
  input(s.w, s.doc.querySelectorAll('[data-album-field="priceInput"]')[1], '');
  click(s.doc.querySelectorAll('[data-action="save-album"]')[1]); await tick();
  check('en vente sans prix : refusé côté client, aucun appel serveur', s.calls.upsert.length === 0 && /prix minimum/i.test(s.doc.getElementById('albumsContainer').textContent));
  input(s.w, s.doc.querySelectorAll('[data-album-field="priceInput"]')[1], '-2');
  click(s.doc.querySelectorAll('[data-action="save-album"]')[1]); await tick();
  check('prix négatif : refusé côté client', s.calls.upsert.length === 0 && /invalide/i.test(s.doc.getElementById('albumsContainer').textContent));

  input(s.w, s.doc.querySelectorAll('[data-album-field="priceInput"]')[1], '3,5');
  click(s.doc.querySelectorAll('[data-action="save-album"]')[1]); await tick(); await tick();
  const p = s.calls.upsert[0];
  check('enregistrement : prix converti en centimes (3,5 -> 350)', p && p.priceUsdCents === 350);
  check('enregistrement : pistes dans l\'ordre de cochage, en vente', p && p.trackIds.join() === 't3,t1' && p.buyable === true && p.title === 'Mon OST');
  check('enregistrement : id aléatoire préfixé alb_', p && /^alb_[a-z0-9]{8,}$/.test(p.id));
  check('après enregistrement : message « Album enregistré » et le badge disparaît', /Album enregistré/.test(s.doc.getElementById('albumsContainer').textContent) && !/non enregistré/.test(s.doc.getElementById('albumsContainer').textContent));
  check('après enregistrement : le bouton test apparaît sur le nouvel album', s.doc.querySelectorAll('[data-action="claim-test-album"]').length === 2);

  click(s.doc.querySelectorAll('[data-action="claim-test-album"]')[0]); await tick(); await tick();
  check('achat de test : appel serveur sur le bon album', s.calls.claim.join() === 'alb_old');
  check('achat de test : l\'album apparaît dans « albums obtenus » avec le badge test', /Déjà là/.test(s.doc.getElementById('albumsLibraryContainer').textContent) && /test/.test(s.doc.getElementById('albumsLibraryContainer').textContent));

  // ---- Scénario 2 : le serveur refuse pour cause de pistes non publiées ----
  s = await scenario({ testEnabled: true, saveResult: () => ({ ok: false, error: 'Non autorisé : une ou plusieurs pistes n\'appartiennent pas à ce compositeur' }), claimResult: () => ({ ok: true }) });
  await s.t.loadAlbums(); await tick();
  click(s.doc.querySelector('[data-action="save-album"]')); await tick(); await tick();
  const txt = s.doc.getElementById('albumsContainer').textContent;
  check('refus « pistes » : erreur + indice « Publie d\'abord ta bibliothèque »', /Échec de l'enregistrement/.test(txt) && /Publie d'abord/.test(txt));

  // ---- Scénario 3 : interrupteur bêta coupé ----
  s = await scenario({ testEnabled: false, saveResult: () => ({ ok: true }), claimResult: () => ({ ok: true }) });
  await s.t.loadAlbums(); await tick();
  check('interrupteur coupé : aucun bouton « Obtenir (test) »', s.doc.querySelector('[data-action="claim-test-album"]') === null);

  // ---- Échappement HTML ----
  s = await scenario({ testEnabled: true, saveResult: () => ({ ok: true }), claimResult: () => ({ ok: true }) });
  s.w.library = [{ id: 'x', title: '<img src=x onerror=alert(1)>' }];
  await s.t.loadAlbums(); await tick();
  check('titre de morceau malveillant : échappé, aucune balise injectée', s.doc.querySelector('#albumsContainer img') === null);

  console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
