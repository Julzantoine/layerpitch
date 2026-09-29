// Protection d'un morceau dans le Backstage (29/09) : bloc « Fichiers du morceau » de l'onglet Infos, confirmation,
// appel de l'Edge Function (faux service), mise à jour de l'affichage. Vrai Backstage dans jsdom.
const { loadBackstage } = require('./scripts/test-harness.js');
(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window, doc = w.document;
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const tick = () => new Promise(r => setTimeout(r, 0));
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  const calls = { confirm: [], set: [], info: [], error: [] };
  w.LayerPitchNotify = { confirm: async (msg) => { calls.confirm.push(msg); return true; }, info: m => calls.info.push(m), error: m => calls.error.push(m) };
  let result = { ok: true };
  w.LayerPitchTracks = { setTrackProtected: async (id, on) => { calls.set.push([id, on]); return result; } };
  w.loadPostgresReadScripts = async () => {};

  click(doc.getElementById('btnAddLibraryTrack'));
  const track = w.eval('library[0]');
  const html = w.trackProtectionHtml(track, 0);
  check('morceau public : badge « Publics » et bouton « Protéger »', /Publics/.test(html) && /Protéger/.test(html) && /data-action="toggle-track-protection"/.test(html));
  track.protected = true;
  check('morceau protégé : badge 🔒 et bouton « Rendre publics »', /🔒/.test(w.trackProtectionHtml(track, 0)) && /Rendre publics/.test(w.trackProtectionHtml(track, 0)));
  track.protected = false;

  // Le bloc est bien dans la page fabriquée (onglet Infos des deux familles de modes)
  const page = require('fs').readFileSync(require('path').join(__dirname, 'layerpitch-backstage.html'), 'utf8');
  check('bloc présent dans les deux onglets Infos (couches et séquentiel)', (page.match(/\$\{trackProtectionHtml\(track, ti\)\}/g) || []).length === 2);

  const holder = doc.createElement('div');
  holder.innerHTML = '<button type="button" data-action="toggle-track-protection" data-ti="0">Protéger</button>';
  doc.getElementById('libraryContainer').appendChild(holder);
  click(holder.querySelector('button')); await tick(); await tick(); await tick();
  check('protéger : confirmation demandée puis appel avec (id du morceau, true)', calls.confirm.length === 1 && /Protéger/.test(calls.confirm[0]) && JSON.stringify(calls.set) === JSON.stringify([[track.id, true]]));
  check('protéger : le morceau est marqué protégé et l\'utilisateur est prévenu', track.protected === true && calls.info.length === 1);

  const holder2 = doc.createElement('div');
  holder2.innerHTML = '<button type="button" data-action="toggle-track-protection" data-ti="0">Rendre publics</button>';
  doc.getElementById('libraryContainer').appendChild(holder2);
  result = { ok: false, error: 'Copie interrompue' };
  click(holder2.querySelector('button')); await tick(); await tick(); await tick();
  check('rendre public en échec : erreur affichée, le morceau reste protégé', calls.error.length === 1 && /Copie interrompue/.test(calls.error[0]) && track.protected === true && JSON.stringify(calls.set[1]) === JSON.stringify([track.id, false]));

  // Effets sonores (packs) : même bloc et même appel, côté bibliothèque de Sfx
  const sfxHtml = w.sfxProtectionHtml({ id: 's1', protected: false }, 0);
  check('Sfx public : badge « Publics » et bouton « Protéger » (data-action toggle-sfx-protection)', /Publics/.test(sfxHtml) && /toggle-sfx-protection/.test(sfxHtml) && /Protéger/.test(sfxHtml));
  check('Sfx protégé : badge 🔒 et « Rendre publics »', /🔒/.test(w.sfxProtectionHtml({ id: 's1', protected: true }, 0)) && /Rendre publics/.test(w.sfxProtectionHtml({ id: 's1', protected: true }, 0)));
  check('bloc Sfx présent dans l\'onglet Identité de la bibliothèque de Sfx', /\$\{sfxProtectionHtml\(sfx, si\)\}/.test(page));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
