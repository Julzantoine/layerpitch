// Onglet « Albums » de l'espace studio (layerpitch-studio-albums.js, 29/09) : liste, éditeur, morceaux du studio seulement,
// message de confirmation des droits, invités, droits partagés. jsdom avec de faux services (aucune base réelle).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const tick = () => new Promise(r => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 6; i++) await tick(); };

const sb = { window: {} }; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8'), sb);
const I18N = sb.window.LAYERPITCH_I18N;
const tr = (k, v) => { let s = (I18N.fr.studio[k]) || (I18N.fr.shared[k]) || k; if (v) Object.keys(v).forEach(x => { s = s.split('{' + x + '}').join(v[x]); }); return s; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Chaque clé alb_* existe en français ET en anglais (sinon l'écran afficherait le nom de la clé).
const src = fs.readFileSync(path.join(__dirname, 'layerpitch-studio-albums.js'), 'utf8');
const used = [...new Set([...src.matchAll(/tr\('(alb_[A-Za-z_]+)'/g)].map(m => m[1]).filter(k => !k.endsWith('_')))];
// Les textes de l'éditeur (namespace albumEditor) sont vérifiés par test_album_editor.js.
check('toutes les clés alb_* utilisées existent en FR et EN', used.every(k => I18N.fr.studio[k] && I18N.en.studio[k]) && !!I18N.fr.studio.tab_albums && !!I18N.en.studio.tab_albums && !!I18N.fr.shell['item_studio.albums']);

function setup() {
  const dom = new JSDOM('<div id="panel"></div>', { runScripts: 'outside-only', url: 'http://localhost/studio.html' });
  const w = dom.window;
  const calls = { upsert: [], invites: [], rights: [], removed: [] };
  let albums = [{ id: 'a1', sellerId: 'u1', sellerRole: 'studio', title: 'OST Forêt', presentationFr: '', presentationEn: '', priceEurCents: 800, buyable: false, trackIds: ['s1', 'c9'], officialDurations: { s1: 60, s2: 30 } },
                { id: 'autre', sellerId: 'u1', sellerRole: 'composer', title: 'Pas un album de studio', trackIds: [], officialDurations: {} }];
  let contributors = [{ id: 'k1', email: 'coco@x.test', status: 'accepted', trackCount: 1 }, { id: 'k2', email: 'bob@x.test', status: 'pending', trackCount: 0 }];
  w.LayerPitchNotify = { confirm: async () => true };
  w.LayerPitchAuth = { getSession: async () => ({ session: { user: { id: 'u1' } } }), getMyStudioId: async () => ({ studioId: 'st1', isOwner: true, name: 'Studio Mousse' }) };
  w.LayerPitchAlbums = {
    listAlbums: async () => ({ albums: albums.map(a => Object.assign({}, a)), error: null }),
    setAlbumShopListed: async (id, on) => { calls.shop = { id, on }; return { ok: true }; },
    setAlbumListening: async (id, mode, ids) => { calls.listen = { id, mode, ids }; return { ok: true }; },
    upsertStudioAlbum: async p => { calls.upsert.push(p); return { ok: true, data: {} }; },
    listAlbumContributors: async () => ({ contributors: contributors.map(c => Object.assign({}, c)), error: null }),
    inviteAlbumContributor: async (id, email) => { calls.invites.push(email); return { ok: true }; },
    removeAlbumContributor: async id => { calls.removed.push(id); contributors = contributors.filter(c => c.id !== id); return { ok: true, unpublished: false }; },
    getAlbumRights: async () => ({ rights: { declaration: 'sole', ackAt: null, settled: true, sellerShareBps: 10000, holders: [] }, error: null }),
    setAlbumRights: async (id, decl, holders, ack) => { calls.rights.push({ decl, holders, ack }); return { rights: { declaration: decl, ackAt: ack ? 'x' : null, settled: false, sellerShareBps: 7000, holders: holders.map((h, i) => ({ id: 'h' + i, email: h.email, shareBps: h.shareBps, status: 'pending' })), toInvite: [], unlisted: false }, error: null }; },
    inviteRightsHolder: async () => ({ ok: true }), markRightsHolderSelfPay: async () => ({ rights: null, error: null }),
  };
  w.LayerPitchStudio = { setMyStudioName: async n => { calls.name = n; return { ok: true, name: n.trim() }; } };
  w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
  w.CSS = { escape: s => String(s) };
  w.LAYERPITCH_I18N = I18N;
  w.eval(fs.readFileSync(path.join(__dirname, 'layerpitch-album-shared.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, 'layerpitch-album-editor.js'), 'utf8'));
  w.eval(src);
  const ownedTracks = [{ id: 's1', title: 'Lisière', packTitle: 'Pack A' }, { id: 's2', title: 'Clairière', packTitle: 'Pack A' }];
  return { w, doc: w.document, calls, ownedTracks, mount: () => w.LayerPitchStudioAlbums.mount(w.document.getElementById('panel'), { tr, esc, lang: 'fr', ownedTracks, notify: w.LayerPitchNotify }) };
}
const click = el => el.dispatchEvent(new (el.ownerDocument.defaultView.MouseEvent)('click', { bubbles: true }));
const change = (w, el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
const input = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };

(async () => {
  let s = setup();
  await s.mount(); await flush();
  check('nom du studio affiché en tête de l\'onglet', s.doc.getElementById('albStudioName').value === 'Studio Mousse');
  input(s.w, s.doc.getElementById('albStudioName'), 'Autre Nom'); click(s.doc.getElementById('albStudioNameSave')); await flush();
  check('enregistrer le nom : appel API et confirmation', s.calls.name === 'Autre Nom' && /Nom du studio enregistré/.test(s.doc.body.textContent));
  const rows = () => s.doc.querySelectorAll('.row[data-i]');
  check('liste : seulement les albums de STUDIO (pas celui de compositeur)', rows().length === 1 && /OST Forêt/.test(rows()[0].textContent) && /Brouillon/.test(rows()[0].textContent));
  check('liste : « Nouvel album » actif', !s.doc.getElementById('albNew').disabled);

  click(rows()[0].querySelector('[data-act="edit"]')); await flush();
  const d = s.doc;
  check('éditeur : titre, prix (8.00) et pochette', d.querySelector('[data-ae-field="title"]').value === 'OST Forêt' && d.querySelector('[data-ae-field="priceInput"]').value === '8.00' && !!d.querySelector('[data-ae-cover]'));
  check('éditeur : les morceaux du studio (packs) sont proposés, s1 coché', d.querySelectorAll("[data-ae-track]").length === 2 && d.querySelector('[data-ae-track="s1"]').checked && !d.querySelector('[data-ae-track="s2"]').checked);
  check('éditeur : les morceaux d\'invités sont comptés, pas listés', /1 morceau\(x\) ajouté\(s\) par les compositeurs invités/.test(d.body.textContent) && !d.querySelector('[data-ae-track="c9"]'));
  check('version officielle : s1 ✓ 1:00 avec Écouter et Refaire', /✓ 1:00/.test(d.body.textContent) && !!d.querySelector('[data-ae-play="s1"]') && /Refaire/.test(d.querySelector('[data-ae-record="s1"]').textContent));
  check('invités : deux lignes avec leur statut, retrait possible', /coco@x\.test/.test(d.body.textContent) && /a accepté/.test(d.body.textContent) && /invité/.test(d.body.textContent) && d.querySelectorAll('[data-ae-remove-contrib]').length === 2);

  // Mise en vente : le message de confirmation des droits est obligatoire
  d.querySelector('[data-ae-buyable]').checked = true; change(s.w, d.querySelector('[data-ae-buyable]'));
  click(d.querySelector('[data-ae-save]')); await flush();
  check('mise en vente sans confirmer les droits : refusée côté écran, rien envoyé', /Confirme que tu as les droits/.test(d.body.textContent) && !s.calls.upsert.length);
  d.querySelector('[data-ae-confirm]').checked = true; change(s.w, d.querySelector('[data-ae-confirm]'));
  const t2 = d.querySelector('[data-ae-track="s2"]'); t2.checked = true; change(s.w, t2);
  d.querySelector('[data-ae-buyable]').checked = true; change(s.w, d.querySelector('[data-ae-buyable]'));
  d.querySelector('[data-ae-confirm]').checked = true; change(s.w, d.querySelector('[data-ae-confirm]'));
  click(d.querySelector('[data-ae-save]')); await flush();
  check('enregistrer : seulement les morceaux du studio (s1, s2), jamais ceux des invités', s.calls.upsert.length === 1 && JSON.stringify(s.calls.upsert[0].trackIds) === '["s1","s2"]' && s.calls.upsert[0].buyable === true && s.calls.upsert[0].priceEurCents === 800);

  const some = s.doc.querySelector('input[data-ae-listen="selected"]'); some.checked = true; change(s.w, some);
  const free = s.doc.querySelector('[data-ae-free="s1"]'); free.checked = true; change(s.w, free);
  click(s.doc.querySelector('[data-ae-save]')); await flush();
  check('écoute libre : « certains morceaux » (s1) enregistré avec l\'album', JSON.stringify(s.calls.listen) === '{"id":"a1","mode":"selected","ids":["s1"]}');

  const shopBox = s.doc.querySelector('[data-ae-shop]'); shopBox.checked = true; change(s.w, shopBox);
  click(s.doc.querySelector('[data-ae-save]')); await flush();
  check('Shop : « Afficher dans le Shop » enregistré avec l\'album', JSON.stringify(s.calls.shop) === '{"id":"a1","on":true}');

  // Invitation d'un compositeur
  input(s.w, s.doc.querySelector('[data-ae-invite-email]'), 'nouveau@x.test'); click(s.doc.querySelector('[data-ae-invite]')); await flush();
  check('inviter : e-mail envoyé à l\'API et confirmation affichée', s.calls.invites[0] === 'nouveau@x.test' && /Invitation envoyée à nouveau@x\.test/.test(s.doc.body.textContent));
  click(s.doc.querySelector('[data-ae-remove-contrib="k1"]')); await flush();
  check('retirer un invité : appel serveur, ligne disparue', s.calls.removed[0] === 'k1' && !/coco@x\.test/.test(s.doc.body.textContent));

  // Droits partagés
  const sharedRadio = s.doc.querySelector('input[data-ae-rights-decl][value="shared"]'); sharedRadio.checked = true; change(s.w, sharedRadio);
  click(s.doc.querySelector('[data-ae-radd]'));
  input(s.w, s.doc.querySelector('[data-ae-rrow="0"][data-ae-rcol="email"]'), 'co@x.test'); input(s.w, s.doc.querySelector('[data-ae-rrow="0"][data-ae-rcol="pct"]'), '30');
  const ack = s.doc.querySelector('[data-ae-rack]'); ack.checked = true; change(s.w, ack);
  click(s.doc.querySelector('[data-ae-rsave]')); await flush();
  check('droits partagés : 30 % (3000 points de base) envoyés avec l\'avertissement reconnu', JSON.stringify(s.calls.rights) === '[{"decl":"shared","holders":[{"email":"co@x.test","shareBps":3000}],"ack":true}]');
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
