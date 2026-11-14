// Accueil de l'Espace studio (14/11, feu vert « studio_home ») : le feu vert existe et reste fermé au départ, l'onglet n'est ajouté à la
// barre latérale que s'il est ouvert, la page l'ouvre par défaut (sauf ?tab=… ou retour de Stripe), textes FR et EN présents.
const fs = require('fs');
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };

  const { freshDb } = await import('./scripts/pglite-db.mjs');
  const db = await freshDb();
  const flag = await db.query(`select released from public.feature_flags where key = 'studio_home'`);
  check('base : feu vert « studio_home » créé', flag.rows.length === 1);
  check('base : fermé au départ (admin seulement)', flag.rows[0] && flag.rows[0].released === false);

  const studio = fs.readFileSync('studio.html', 'utf8');
  const shell = fs.readFileSync('layerpitch-shell.js', 'utf8');
  const i18n = fs.readFileSync('layerpitch-i18n.js', 'utf8');
  check('barre latérale : entrée « Accueil » en tête, derrière studio_space ET studio_home', /studioSpace && ctx\.flags\.studio_home\) studio\.unshift\(\{ id: 'studio\.home'/.test(shell));
  check('page : l\'onglet home est reconnu (adresse et barre)', /STUDIO_TABS = \['home'/.test(studio) && /\['home', 'library', 'custom', 'video'/.test(studio));
  check('page : Accueil par défaut seulement si le feu vert est ouvert et sans ?tab=', /state\.flags\.studio_home && !startTabAsked && !justSubscribed/.test(studio));
  check('page : feu vert fermé, ?tab=home retombe sur Mes achats', /!state\.flags\.studio_home && state\.tab === 'home'\) state\.tab = 'library'/.test(studio));
  check('page : l\'Accueil est dessiné par renderPanel', /state\.tab === 'home'\) return renderHome\(panel\)/.test(studio));
  for (const lang of ['fr', 'en']) {
    const start = i18n.indexOf(lang === 'fr' ? 'tab_home: "Accueil"' : 'tab_home: "Home"');
    check(lang + ' : textes de l\'Accueil studio présents', start > 0 && /sh_greeting/.test(i18n.slice(start, start + 400)));
  }
  check('textes : entrée de menu FR et EN', /"item_studio\.home": "Accueil"/.test(i18n) && /"item_studio\.home": "Home"/.test(i18n));
  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
