// Carte « Mes ventes » de Mon compte (29/09) : fermée avant le feu vert, tableau, totaux, achats de test grisés, aucune identité
// d'acheteur. jsdom, faux service.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { JSDOM } = require('jsdom');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const html = fs.readFileSync(path.join(__dirname, 'mon-compte.html'), 'utf8');
const a = html.indexOf('async function salesCardHtml()'), b = html.indexOf('function reloadPage()');
check('bloc trouvé, carte branchée sur la rubrique Ventes', a > 0 && b > a && /sales: async \(\) => \(await salesCardHtml\(\)\)/.test(html));
const sb = { window: {} }; vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8'), sb);
const I = sb.window.LAYERPITCH_I18N;
check('textes FR et EN', ['salesTitle', 'salesTotals', 'salesColDate', 'salesColShare', 'salesKind_pack', 'salesKind_album', 'salesStatus_paid', 'salesStatus_transferred', 'salesEmpty'].every(k => I.fr.monCompte[k] && I.en.monCompte[k]));
async function card(sales) {
  const w = new JSDOM('<div id="c"></div>', { runScripts: 'outside-only' }).window;
  w.escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  w.currentLang = () => 'fr';
  w.tr = (k, v) => { let s = I.fr.monCompte[k] || k; if (v) Object.keys(v).forEach(x => { s = s.replace('{' + x + '}', v[x]); }); return s; };
  w.LayerPitchAuth = { getMySales: async () => ({ sales }) };
  w.eval(html.slice(a, b));
  return w.salesCardHtml();
}
(async () => {
  check('feu vert fermé : aucune carte', (await card({ open: false })) === '');
  const rows = [
    { kind: 'album', title: 'OST <b>x</b>', purchasedAt: '2026-09-20T10:00:00Z', grossCents: 500, shareCents: 350, status: 'transferred', isTest: false },
    { kind: 'pack', title: 'Pack Forêt', purchasedAt: '2026-09-19T10:00:00Z', grossCents: 1000, shareCents: null, status: 'paid', isTest: false },
    { kind: 'album', title: 'Essai', purchasedAt: '2026-09-18T10:00:00Z', grossCents: 0, shareCents: null, status: 'test', isTest: true }];
  const h = await card({ open: true, rows, totals: { count: 2, grossCents: 1500, shareCents: 350 } });
  check('totaux : 2 ventes, 15 € bruts, part connue 3,50 €', /2 vente\(s\)/.test(h) && /15,00[\s  ]€/.test(h) && /3,50[\s  ]€/.test(h));
  check('lignes : type, titre échappé, montants, part inconnue « sur la facture », statut', /Album/.test(h) && !/<b>x<\/b>/.test(h) && /&lt;b&gt;x/.test(h) && /sur la facture/.test(h) && /Versé/.test(h) && /Payé/.test(h));
  check('achat de test : grisé et marqué « test »', /opacity:\.6/.test(h) && /\(test\)/.test(h));
  check('vide : message « Aucune vente »', /Aucune vente/.test(await card({ open: true, rows: [], totals: { count: 0, grossCents: 0, shareCents: 0 } })));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
