// Carte « Supprimer mon compte » de Mon compte (29/09) : cachée tant que le feu vert est fermé, saisie de SUPPRIMER, appel
// de la demande, état « suppression prévue » avec annulation, messages de blocage. jsdom, faux services.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const tick = () => new Promise(r => setTimeout(r, 0));
const html = fs.readFileSync(path.join(__dirname, 'mon-compte.html'), 'utf8');
const a = html.indexOf('function reloadPage()'), b = html.indexOf('function identifiantsCardHtml(session)');
const block = html.slice(a, b);
check('bloc trouvé dans la page', a > 0 && b > a);
check('carte ajoutée à la rubrique Profil', /deletionCardHtml\(\)\),\n/.test(html) || /directoryCardHtml\(\) \+ \(await deletionCardHtml\(\)\)/.test(html));

const sb = { window: {} }; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8'), sb);
const I = sb.window.LAYERPITCH_I18N;
const keys = ['delTitle', 'delErases', 'delKept', 'delDelay', 'delTypeLabel', 'delTypeError', 'delRequestBtn', 'delFinalConfirm', 'delPending', 'delCancelBtn', 'delBlocker_last_admin', 'delBlocker_studio_team', 'delBlocker_already_deleted'];
check('tous les textes existent en FR et EN (mon compte)', keys.every(k => I.fr.monCompte[k] && I.en.monCompte[k]) && !!I.fr.shell.deletionBanner && !!I.en.shell.deletionBanner && !!I.fr.shell.deletionCancel && !!I.fr.shell.deletionCancelError && !!I.en.shell.deletionCancelError);

function page(status) {
  const dom = new JSDOM('<div id="c"></div>', { runScripts: 'outside-only', url: 'http://localhost/mon-compte.html' });
  const w = dom.window, calls = { request: [], cancel: 0, reload: 0, confirm: 0 };
  w.escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  w.currentLang = () => 'fr';
  w.tr = (k, v) => { let s = I.fr.monCompte[k] || k; if (v) Object.keys(v).forEach(x => { s = s.replace('{' + x + '}', v[x]); }); return s; };
  w.LayerPitchNotify = { confirm: async () => { calls.confirm++; return true; } };
  w.LayerPitchAuth = {
    getAccountDeletion: async () => ({ status, error: null }),
    requestAccountDeletion: async c => { calls.request.push(c); return { ok: true, scheduledFor: '2026-10-29T00:00:00Z' }; },
    cancelAccountDeletion: async () => { calls.cancel++; return { ok: true }; },
  };
  w.eval(block);
  w.reloadPage = () => { calls.reload++; };
  return { w, d: w.document, calls, render: async () => { w.document.getElementById('c').innerHTML = await w.deletionCardHtml(); w.wireDeletionCard(); } };
}

(async () => {
  let s = page({ open: false, blockers: [], scheduledFor: null });
  await s.render();
  check('feu vert fermé : aucune carte', s.d.getElementById('c').innerHTML.trim() === '');

  s = page({ open: true, blockers: [], scheduledFor: null });
  await s.render();
  check('feu vert ouvert : carte avec ce qui est effacé / gardé / le délai', /Supprimer mon compte/.test(s.d.body.textContent) && /Effacé/.test(s.d.body.textContent) && /Conservé/.test(s.d.body.textContent) && /30 jours/.test(s.d.body.textContent));
  s.d.getElementById('delConfirm').value = 'supprimer';
  s.d.getElementById('btnRequestDeletion').click(); await tick();
  check('mauvaise saisie : refusée, aucun appel', /Tape exactement SUPPRIMER/.test(s.d.getElementById('delMsg').textContent) && !s.calls.request.length);
  s.d.getElementById('delConfirm').value = 'SUPPRIMER';
  s.d.getElementById('btnRequestDeletion').click(); await tick(); await tick(); await tick();
  check('bonne saisie : confirmation, demande envoyée avec SUPPRIMER, page rechargée', s.calls.confirm === 1 && s.calls.request[0] === 'SUPPRIMER' && s.calls.reload === 1);

  s = page({ open: true, blockers: [], scheduledFor: '2026-10-29T00:00:00Z' });
  await s.render();
  check('suppression prévue : date affichée, bouton d\'annulation, plus de champ de saisie', /Suppression prévue le/.test(s.d.body.textContent) && !!s.d.getElementById('btnCancelDeletion') && !s.d.getElementById('delConfirm'));
  s.d.getElementById('btnCancelDeletion').click(); await tick(); await tick();
  check('annuler : appel serveur puis page rechargée', s.calls.cancel === 1 && s.calls.reload === 1);

  s = page({ open: true, blockers: ['last_admin', 'studio_team'], scheduledFor: null });
  await s.render();
  check('blocages : messages clairs, pas de bouton de suppression', /dernier administrateur/.test(s.d.body.textContent) && /membres d'équipe/.test(s.d.body.textContent) && !s.d.getElementById('btnRequestDeletion'));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
