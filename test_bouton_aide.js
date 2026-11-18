// Bouton « ? » (18/11, feu vert help_toggle) : posé à côté du bouton de repli de la barre (seulement si le feu vert est ouvert), il allume /
// éteint l'aide au survol (même réglage que l'Accueil : help_off), prévient les autres cadres, et le moteur de bulles des pages hors Backstage
// (layerpitch-help-engine.js) respecte l'interrupteur. Les éléments data-help de Projet et de l'Atelier ont tous un texte FR et EN.
const fs = require('fs');
const { JSDOM } = require('jsdom');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const wait = ms => new Promise(r => setTimeout(r, ms || 30));

(async () => {
  const rpcCalls = [];
  const mk = (allowed) => {
    const dom = new JSDOM('<!doctype html><body><nav id="nav"><a class="nav-item">x</a></nav><div id="t" data-help="projet_tab_board" title="natif">Moodboard</div></body>',
      { url: 'https://example.test/projet.html', runScripts: 'outside-only' });
    const w = dom.window;
    w.LayerPitchSupabaseClient = { getClient: () => ({
      rpc: (name, args) => { rpcCalls.push([name, args]); return Promise.resolve({ data: name === 'my_feature_flags' ? [{ key: 'help_toggle', allowed }] : {} }); },
      from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { home_prefs: {} } }) }) }),
    }) };
    for (const f of ['layerpitch-i18n.js', 'layerpitch-help.js', 'layerpitch-shell.js', 'layerpitch-help-engine.js']) w.eval(fs.readFileSync(f, 'utf8'));
    return w;
  };

  // Feu vert fermé : pas de bouton.
  let w = mk(false);
  w.LayerPitchShell.collapsible(w.document.getElementById('nav'), {});
  await wait(60);
  check('feu vert fermé : aucun « ? »', !w.document.querySelector('.lp-help-btn'));

  // Feu vert ouvert : le bouton est là, allumé par défaut.
  w = mk(true);
  w.LayerPitchShell.collapsible(w.document.getElementById('nav'), {});
  await wait(60);
  const b = w.document.querySelector('.lp-help-btn');
  check('feu vert ouvert : le « ? » existe et est visible', !!b && !b.hidden);
  check('allumé par défaut (aria-pressed)', b.getAttribute('aria-pressed') === 'true');
  check('placé juste après le bouton de repli', b.previousElementSibling && b.previousElementSibling.classList.contains('lp-collapse-btn'));

  // Clic : coupe l'aide, écrit le réglage commun, écrit dans le compte, prévient la page.
  let evt = null; w.addEventListener('lp-help-change', e => { evt = e.detail; });
  b.click(); await wait();
  const prefs = JSON.parse(w.localStorage.getItem('lp_home_prefs_v1') || '{}');
  check('clic : help_off écrit dans le réglage commun', prefs.help_off === true);
  check('clic : bouton éteint', b.getAttribute('aria-pressed') === 'false');
  check('clic : événement lp-help-change', evt && evt.off === true);
  check('clic : écrit dans le compte (set_my_home_prefs help_off)', rpcCalls.some(c => c[0] === 'set_my_home_prefs' && c[1].p.help_off === true));
  check('le moteur de bulles passe en lp-help-off', w.document.body.classList.contains('lp-help-off'));

  // Moteur : aide coupée = pas de bulle ; allumée = bulle avec le texte, et le title natif est mis de côté.
  const t = w.document.getElementById('t');
  w.document.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true })); // sans effet
  t.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
  await wait(600);
  check('aide coupée : aucune bulle', !w.document.getElementById('lpHelpTip') || !w.document.getElementById('lpHelpTip').classList.contains('visible'));
  b.click(); await wait();
  t.dispatchEvent(new w.MouseEvent('mouseout', { bubbles: true }));
  t.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
  await wait(600);
  const tip = w.document.getElementById('lpHelpTip');
  check('aide allumée : la bulle montre le texte de l\'onglet', tip && tip.classList.contains('visible') && /Moodboard/.test(tip.textContent));
  check('le title natif est mis de côté pendant la bulle', !t.hasAttribute('title'));
  t.dispatchEvent(new w.MouseEvent('mouseout', { bubbles: true }));
  check('le title natif revient ensuite', t.getAttribute('title') === 'natif');

  // Un message du Backstage (autre cadre) met le réglage à jour.
  w.dispatchEvent(new w.MessageEvent('message', { data: { source: 'lp-shell', type: 'help', off: true } }));
  check('message d\'un autre cadre : aide coupée', w.document.body.classList.contains('lp-help-off'));

  // Textes : chaque data-help posé dans Projet et l'Atelier a un texte FR et EN.
  const H = {}; new Function('window', fs.readFileSync('layerpitch-help.js', 'utf8'))(H.window = {});
  const dict = H.window.LAYERPITCH_HELP;
  const has = (lang, key) => Object.values(dict[lang]).some(z => z && z[key]);
  const keys = new Set();
  for (const f of ['projet.html', 'src/atelier/18-panneau-de-capture.js']) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/data-help="([a-zA-Z_]+(?:\$\{t\})?)"/g)) keys.add(m[1]);
  }
  const expanded = [];
  for (const k of keys) {
    if (k.includes('${t}')) ['board', 'tasks', 'map', 'videos', 'images', 'music', 'showcase', 'activity', 'members'].forEach(x => expanded.push(k.replace('${t}', x)));
    else expanded.push(k);
  }
  check('au moins 25 éléments d\'aide posés', expanded.length >= 25);
  const missing = expanded.filter(k => !has('fr', k) || !has('en', k));
  check('chaque clé a un texte FR et EN' + (missing.length ? ' (manque : ' + missing.join(', ') + ')' : ''), missing.length === 0);

  // Fichiers : l'Atelier et Projet chargent le moteur ; le Backstage écoute l'événement.
  check('projet.html charge le moteur', /layerpitch-help-engine\.js/.test(fs.readFileSync('projet.html', 'utf8')));
  check('atelier : source charge le moteur', /layerpitch-help-engine\.js/.test(fs.readFileSync('src/atelier/03-ecran-et-scripts.html', 'utf8')));
  check('Backstage écoute lp-help-change', /addEventListener\('lp-help-change'/.test(fs.readFileSync('src/backstage/48-accueil.js', 'utf8')));
  console.log(failures ? failures + ' échec(s)' : 'Tous les tests passent.');
  process.exit(failures ? 1 : 0);
})();
