// layerpitch-appearance.js (29/09) : apparence commune de l'interface (jour/nuit, couleur de fond, filigrane), réglages
// locaux dont les clés sont celles du Backstage d'avant. jsdom.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'layerpitch-appearance.js'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
function page(store) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="host"></div></body></html>', { url: 'http://localhost/x.html', runScripts: 'outside-only' });
  const w = dom.window;
  Object.keys(store || {}).forEach(k => w.localStorage.setItem(k, store[k]));
  w.eval(i18n); w.eval(src);
  return w;
}
let w = page({});
check('par défaut : thème jour, aucun filigrane', w.document.documentElement.dataset.theme === 'light' && w.document.getElementById('lpWatermarkLayer').style.backgroundImage === 'none');
w = page({ layerpitch_backstage_theme: 'dark', layerpitch_backstage_bg_color: '#ffeeee' });
check('réglage existant du Backstage conservé : nuit', w.document.documentElement.dataset.theme === 'dark');
check('nuit : la couleur perso n\'est pas appliquée', w.document.documentElement.style.getPropertyValue('--backstage-bg') === '');
w = page({ layerpitch_backstage_bg_color: '#ffeeee', layerpitch_backstage_watermark_image: 'data:image/png;base64,AAAA', layerpitch_backstage_watermark_opacity: '30', layerpitch_backstage_watermark_fixed: '0' });
check('jour : couleur perso appliquée', w.document.documentElement.style.getPropertyValue('--backstage-bg') === '#ffeeee');
const layer = w.document.getElementById('lpWatermarkLayer');
check('filigrane : image, opacité 0,3, défilant', /AAAA/.test(layer.style.backgroundImage) && layer.style.opacity === '0.3' && layer.classList.contains('scrolls-with-page'));
w.LayerPitchAppearance.mountPanel(w.document.getElementById('host'));
const host = w.document.getElementById('host');
check('panneau : boutons Jour/Nuit, retrait et opacité présents', host.querySelectorAll('[data-theme]').length === 2 && !!host.querySelector('#lpApClear') && !!host.querySelector('#lpApOp'));
host.querySelector('[data-theme="dark"]').click();
check('clic Nuit : thème appliqué, mémorisé, panneau redessiné (couleur grisée)', w.document.documentElement.dataset.theme === 'dark' && w.localStorage.getItem('layerpitch_backstage_theme') === 'dark' && host.querySelector('#lpApBg').disabled);
host.querySelector('#lpApClear').click();
check('retirer l\'image : filigrane vide et clé supprimée', layer.style.backgroundImage === 'none' && w.localStorage.getItem('layerpitch_backstage_watermark_image') === null && !host.querySelector('#lpApClear'));
console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
