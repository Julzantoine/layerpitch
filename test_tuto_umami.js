// Suivi Umami du tutoriel (23/10) : Umami n'est chargé que sur les pages du mode tutoriel (?tuto), les événements portent le préfixe « tuto_ »,
// le lecteur et le Backstage n'envoient rien à Umami depuis le compte fictif, et le moteur de bulles note ouverture, étapes, fin et abandon.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

function page(url) {
  const dom = new JSDOM('<!doctype html><head></head><body><div id="zone" style="width:100px;height:40px">z</div></body>', { url, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.Element.prototype.getBoundingClientRect = function () { return { top: 10, left: 10, right: 110, bottom: 50, width: 100, height: 40 }; };
  dom.window.eval(read('layerpitch-tuto.js'));
  return dom.window;
}

(async () => {
  // Hors mode tutoriel : aucun script Umami, track() ne fait rien.
  const plain = page('https://layerpitch.com/layerpitch-backstage.html');
  check('hors tutoriel : Umami n’est pas chargé', !plain.document.querySelector('script[data-lp-tuto-umami]'));
  plain.LayerPitchTuto.track('step', { lesson: 'x' });

  // Mode tutoriel : script Umami du site LayerPitch, événements gardés jusqu'au chargement puis envoyés avec le préfixe.
  const w = page('https://layerpitch.com/layerpitch-backstage.html?tuto&lesson=static');
  const s = w.document.querySelector('script[data-lp-tuto-umami]');
  check('mode tutoriel : script Umami ajouté, avec l’identifiant du site', !!s && s.src === 'https://cloud.umami.is/script.js' && s.getAttribute('data-website-id') === '2dd3435c-f5c8-45c0-ab07-3b0e9fa09d2f');
  w.LayerPitchTuto.track('lesson_open', { lesson: 'static', steps: 12 });
  const sent = [];
  w.umami = { track: (n, d) => sent.push([n, d]) };
  s.onload();
  check('événement noté avant le chargement : envoyé ensuite, préfixé « tuto_ »', sent.length === 1 && sent[0][0] === 'tuto_lesson_open' && sent[0][1].lesson === 'static');
  check('window.umami retiré : ni lecteur ni Backstage n’envoient d’événements réels depuis le faux compte', w.umami === undefined);
  w.LayerPitchTuto.track('lesson_done', { lesson: 'static' });
  check('après chargement : envoi direct', sent.length === 2 && sent[1][0] === 'tuto_lesson_done');

  // Moteur de bulles : ouverture, étapes (une seule fois par étape atteinte), fin, abandon.
  w.eval(read('layerpitch-guide.js'));
  w.eval(`
    window.__ev = [];
    LayerPitchTuto.track = (n, d) => window.__ev.push([n, d]);
    window.G = LayerPitchGuide.create({ tr: k => k });
    window.steps = [{ titleKey: 'T1', textKey: 'X1' }, { titleKey: 'T2', textKey: 'X2' }, { titleKey: 'T3', textKey: 'X3', final: true }];
    G.open('lesson', steps, 'demo');
    G.go(1); G.go(-1); G.go(1); G.go(1);
  `);
  const names = () => w.__ev.map(e => e[0]).join(',');
  check('bulles : ouverture, puis chaque étape atteinte une seule fois (revenir en arrière ne compte pas)', names() === 'lesson_open,step,step', names());
  check('bulles : le détail porte la leçon, le numéro d’étape et le nombre d’étapes', w.__ev[1][1].lesson === 'demo' && w.__ev[1][1].step === 2 && w.__ev[2][1].step === 3 && w.__ev[2][1].steps === 3);
  w.eval(`G.go(1);`);
  check('bulles : aller au-delà de la dernière étape = leçon terminée, sans « abandon »', names().endsWith('lesson_done') && !names().includes('lesson_quit'), names());
  w.eval(`window.__ev.length = 0; G.open('lesson', steps, 'demo'); G.go(1); G.close();`);
  check('bulles : fermer avant la fin = abandon, avec l’étape la plus avancée', names() === 'lesson_open,step,lesson_quit' && w.__ev[2][1].step === 2);

  // Backstage : aucun événement « réel » (track_add…) envoyé depuis le compte fictif.
  const bk = read('src/backstage/14a-suivi-onglets-themes.js');
  check('Backstage : pas d’événement d’usage vers Umami en mode tutoriel', /entry\.context === 'test' \|\| isTutoMode\(\) \|\|/.test(bk));
  process.exit(failures ? 1 : 0);
})();
