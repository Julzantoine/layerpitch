// Éditeur d'album unique (layerpitch-album-editor.js, 30/09) : textes complets en FR et EN, forme de l'état d'un album,
// échappement HTML, une seule écoute / un seul enregistreur pour plusieurs éditeurs. Le parcours complet (enregistrement,
// droits, invités…) est joué sur les deux pages qui l'utilisent : test_backstage_albums_panel.js et test_studio_albums_tab.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };

const sb = { window: {} }; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8'), sb);
const I18N = sb.window.LAYERPITCH_I18N;
const src = fs.readFileSync(path.join(__dirname, 'layerpitch-album-editor.js'), 'utf8');

// Textes : chaque clé utilisée existe en français ET en anglais, et les deux langues ont exactement les mêmes clés.
const used = new Set([...src.matchAll(/\btr\('([A-Za-z_]+)'/g)].map(m => m[1]));
const dyn = ['cstatus_pending', 'cstatus_accepted', 'cstatus_declined', 'cstatus_removed', 'rstatus_pending', 'rstatus_accepted', 'rstatus_refused', 'rstatus_self_pay'];
const tk = k => (k === 'saved' ? ['saved', 'savedNew'] : [k]);
const need = [...used].filter(k => !k.endsWith('_')).concat(dyn, ['savedNew']).flatMap(tk);
const fr = I18N.fr.albumEditor, en = I18N.en.albumEditor;
check('clés utilisées par l\'éditeur : présentes en FR et EN', need.every(k => fr[k] && en[k]));
check('FR et EN ont les mêmes clés', JSON.stringify(Object.keys(fr).sort()) === JSON.stringify(Object.keys(en).sort()));
check('les clés dynamiques des messages d\'enregistrement existent', ['saved', 'savedNew', 'saveError', 'listenError', 'randomTitle', 'randomHint', 'randomAllow', 'randomError'].every(k => fr[k] && en[k]));

// État d'un album
const dom = new JSDOM('<div id="a"></div><div id="b"></div>', { runScripts: 'outside-only', url: 'http://localhost/x.html' });
const w = dom.window;
w.LAYERPITCH_I18N = I18N;
w.eval(fs.readFileSync(path.join(__dirname, 'layerpitch-album-shared.js'), 'utf8'));
w.eval(src);
const E = w.LayerPitchAlbumEditor;
const n = E.newAlbum();
check('nouvel album : id alb_ aléatoire, brouillon vide, écoute « rien »', /^alb_[a-z0-9]{8,}$/.test(n.id) && n.saved === false && n.listenMode === 'none' && n.trackIds.length === 0 && E.newAlbum().id !== n.id);
const f = E.fromApi({ id: 'x', title: 'T', priceEurCents: 350, buyable: true, trackIds: ['a', 'b'], officialDurations: { a: 10 }, listenMode: 'selected', freeTrackIds: ['a'] });
check('album de l\'API : prix en euros, morceaux enregistrés, écoute libre', f.priceInput === '3.50' && f.savedTrackIds.join() === 'a,b' && f.listenMode === 'selected' && f.freeTrackIds[0] === 'a' && f.saved);
check('le dé : désactivé par défaut pour un nouvel album, repris de l\'API sinon', n.allowRandom === false && E.fromApi({ id: 'y', allowRandom: true }).allowRandom === true && E.fromApi({ id: 'z' }).allowRandom === false);
const c = E.fromContribution({ albumId: 'y', title: 'Studio', studioName: 'S', buyable: true, tracks: [{ trackId: 't', hasOfficial: true, duration: 42 }, { trackId: 'u', hasOfficial: false }] });
check('album d\'un studio (invité) : mes morceaux et la durée de mes versions', c.contribution && c.trackIds.join() === 't,u' && c.officialDurations.t === 42 && !('u' in c.officialDurations));

// Échappement et deux éditeurs côte à côte
const cfg = () => ({ tracks: () => [{ id: 'x1', title: '<img src=x onerror=alert(1)>' }], trackTitle: id => id, confirm: async () => true, features: {} });
const a1 = E.fromApi({ id: 'a1', title: '"><script>1</script>', trackIds: ['x1', 'gone'] }), a2 = E.fromApi({ id: 'a2', title: 'Deux', trackIds: [] });
const e1 = E.create({ host: w.document.getElementById('a'), album: a1, cfg: cfg() });
const e2 = E.create({ host: w.document.getElementById('b'), album: a2, cfg: cfg() });
e1.render(); e2.render();
check('titre et morceau malveillants : échappés, aucune balise injectée', !w.document.querySelector('img') && !w.document.querySelector('#a script'));
check('deux éditeurs indépendants : chacun son titre', w.document.querySelector('#a [data-ae-field="title"]').value === '"><script>1</script>' && w.document.querySelector('#b [data-ae-field="title"]').value === 'Deux');
check('un morceau absent de la liste reste visible (décochable) plutôt que perdu', !!w.document.querySelector('#a [data-ae-track="gone"]'));
e1.destroy(); e2.destroy();
check('détruire un éditeur vide son hôte', w.document.getElementById('a').innerHTML === '' && w.document.getElementById('b').innerHTML === '');

console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
