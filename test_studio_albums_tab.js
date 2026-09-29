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
const dyn = ['alb_status_pending', 'alb_status_accepted', 'alb_status_declined', 'alb_status_removed', 'alb_rstatus_pending', 'alb_rstatus_accepted', 'alb_rstatus_refused', 'alb_rstatus_self_pay'];
check('toutes les clés alb_* utilisées existent en FR et EN', used.concat(dyn).every(k => I18N.fr.studio[k] && I18N.en.studio[k]) && !!I18N.fr.studio.tab_albums && !!I18N.en.studio.tab_albums && !!I18N.fr.shell['item_studio.albums']);

function setup() {
  const dom = new JSDOM('<div id="panel"></div>', { runScripts: 'outside-only', url: 'http://localhost/studio.html' });
  const w = dom.window;
  const calls = { upsert: [], invites: [], rights: [], removed: [] };
  let albums = [{ id: 'a1', sellerId: 'u1', sellerRole: 'studio', title: 'OST Forêt', presentationFr: '', presentationEn: '', priceEurCents: 800, buyable: false, trackIds: ['s1', 'c9'], officialDurations: { s1: 60 } },
                { id: 'autre', sellerId: 'u1', sellerRole: 'composer', title: 'Pas un album de studio', trackIds: [], officialDurations: {} }];
  let contributors = [{ id: 'k1', email: 'coco@x.test', status: 'accepted', trackCount: 1 }, { id: 'k2', email: 'bob@x.test', status: 'pending', trackCount: 0 }];
  w.LayerPitchNotify = { confirm: async () => true };
  w.LayerPitchAuth = { getSession: async () => ({ session: { user: { id: 'u1' } } }), getMyStudioId: async () => ({ studioId: 'st1', isOwner: true, name: 'Studio Mousse' }) };
  w.LayerPitchAlbums = {
    listAlbums: async () => ({ albums: albums.map(a => Object.assign({}, a)), error: null }),
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
  check('éditeur : titre, prix (8.00) et pochette', d.getElementById('albTitle').value === 'OST Forêt' && d.getElementById('albPrice').value === '8.00' && !!d.getElementById('albCover'));
  check('éditeur : les morceaux du studio (packs) sont proposés, s1 coché', d.querySelectorAll('[data-track]').length === 2 && d.querySelector('[data-track="s1"]').checked && !d.querySelector('[data-track="s2"]').checked);
  check('éditeur : les morceaux d\'invités sont comptés, pas listés', /1 morceau\(x\) ajouté\(s\) par les compositeurs invités/.test(d.body.textContent) && !d.querySelector('[data-track="c9"]'));
  check('version officielle : s1 ✓ 1:00 avec Écouter et Refaire', /✓ 1:00/.test(d.body.textContent) && !!d.querySelector('[data-play="s1"]') && /Refaire/.test(d.querySelector('[data-record="s1"]').textContent));
  check('invités : deux lignes avec leur statut, retrait possible', /coco@x\.test/.test(d.body.textContent) && /a accepté/.test(d.body.textContent) && /invité/.test(d.body.textContent) && d.querySelectorAll('[data-remove-contrib]').length === 2);

  // Mise en vente : le message de confirmation des droits est obligatoire
  d.getElementById('albBuyable').checked = true; change(s.w, d.getElementById('albBuyable'));
  click(d.getElementById('albSave')); await flush();
  check('mise en vente sans confirmer les droits : refusée côté écran, rien envoyé', /Confirme que tu as les droits/.test(d.body.textContent) && !s.calls.upsert.length);
  d.getElementById('albConfirm').checked = true; change(s.w, d.getElementById('albConfirm'));
  const t2 = d.querySelector('[data-track="s2"]'); t2.checked = true; change(s.w, t2);
  d.getElementById('albBuyable').checked = true; change(s.w, d.getElementById('albBuyable'));
  d.getElementById('albConfirm').checked = true; change(s.w, d.getElementById('albConfirm'));
  click(d.getElementById('albSave')); await flush();
  check('enregistrer : seulement les morceaux du studio (s1, s2), jamais ceux des invités', s.calls.upsert.length === 1 && JSON.stringify(s.calls.upsert[0].trackIds) === '["s1","s2"]' && s.calls.upsert[0].buyable === true && s.calls.upsert[0].priceEurCents === 800);

  const some = s.doc.querySelector('input[name="albListen"][value="selected"]'); some.checked = true; change(s.w, some);
  const free = s.doc.querySelector('[data-free="s1"]'); free.checked = true; change(s.w, free);
  click(s.doc.getElementById('albSave')); await flush();
  check('écoute libre : « certains morceaux » (s1) enregistré avec l\'album', JSON.stringify(s.calls.listen) === '{"id":"a1","mode":"selected","ids":["s1"]}');

  // Invitation d'un compositeur
  input(s.w, s.doc.getElementById('albInvite'), 'nouveau@x.test'); click(s.doc.getElementById('albInviteBtn')); await flush();
  check('inviter : e-mail envoyé à l\'API et confirmation affichée', s.calls.invites[0] === 'nouveau@x.test' && /Invitation envoyée à nouveau@x\.test/.test(s.doc.body.textContent));
  click(s.doc.querySelector('[data-remove-contrib="k1"]')); await flush();
  check('retirer un invité : appel serveur, ligne disparue', s.calls.removed[0] === 'k1' && !/coco@x\.test/.test(s.doc.body.textContent));

  // Droits partagés
  const sharedRadio = s.doc.querySelector('input[name="albRights"][value="shared"]'); sharedRadio.checked = true; change(s.w, sharedRadio);
  click(s.doc.getElementById('albRAdd'));
  input(s.w, s.doc.querySelector('[data-rr="0"][data-col="email"]'), 'co@x.test'); input(s.w, s.doc.querySelector('[data-rr="0"][data-col="pct"]'), '30');
  const ack = s.doc.getElementById('albRAck'); ack.checked = true; change(s.w, ack);
  click(s.doc.getElementById('albRSave')); await flush();
  check('droits partagés : 30 % (3000 points de base) envoyés avec l\'avertissement reconnu', JSON.stringify(s.calls.rights) === '[{"decl":"shared","holders":[{"email":"co@x.test","shareBps":3000}],"ack":true}]');
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
