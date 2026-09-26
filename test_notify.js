// LayerPitchNotify (26/09) : bandeaux de message et fenêtre de confirmation à la place des alert() / confirm() natifs,
// plus un garde-fou : aucune page ni aucun script servi ne doit réintroduire une boîte de dialogue native.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

(async () => {
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  const i18n = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
  const notify = fs.readFileSync(path.join(__dirname, 'layerpitch-notify.js'), 'utf-8');
  function makePage(lang) {
    const dom = new JSDOM(`<!DOCTYPE html><html lang="${lang}"><head></head><body><button id="origin">x</button></body></html>`,
      { runScripts: 'dangerously', pretendToBeVisual: true });
    dom.window.eval(i18n);
    dom.window.eval(notify);
    return dom.window;
  }

  // ---- Bandeaux ----
  let w = makePage('fr');
  const N = w.LayerPitchNotify;
  const ok = N.success('Invitation envoyée à a@b.fr.');
  check('succès : bandeau affiché, annoncé poliment', ok.isConnected && ok.classList.contains('success') && ok.getAttribute('role') === 'status');
  const err = N.error('Erreur : réseau\n\nLien à transmettre : https://x.test/lien');
  check('erreur : annoncée tout de suite', err.getAttribute('role') === 'alert');
  check('texte inséré tel quel (pas de HTML interprété)', (() => { const t = N.info('<img src=x onerror=boom()>'); return !t.querySelector('img') && t.textContent.includes('<img'); })());
  check('croix de fermeture libellée en français', err.querySelector('.lp-toast-close').getAttribute('aria-label') === 'Fermer');
  check('style injecté une seule fois', w.document.querySelectorAll('#lpNotifyStyle').length === 1);
  N.success('court', { duration: 30 });
  await wait(260);
  check('un bandeau de succès disparaît seul', ![...w.document.querySelectorAll('.lp-toast')].some(t => t.textContent.startsWith('court')));
  check('une erreur reste affichée (lien de secours à recopier)', err.isConnected);
  err.querySelector('.lp-toast-close').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(200);
  check('la croix ferme l\'erreur', !err.isConnected);
  for (let i = 0; i < 7; i++) N.error('e' + i);
  check('au plus 4 bandeaux empilés', w.document.querySelectorAll('.lp-toast').length === 4);

  // ---- Confirmation ----
  w = makePage('fr');
  const doc = w.document;
  doc.getElementById('origin').focus();
  let p = w.LayerPitchNotify.confirm('Supprimer ce morceau ?', { danger: true });
  await wait(0);
  const overlay = doc.getElementById('lpConfirmOverlay');
  check('fenêtre ouverte, id en "…Overlay" (raccourcis du Backstage suspendus)', !!overlay);
  check('boutons en français : Annuler / Confirmer', [...overlay.querySelectorAll('button')].map(b => b.textContent).join('|') === 'Annuler|Confirmer');
  check('bouton de confirmation en rouge pour une suppression', overlay.querySelector('.lp-confirm-ok').classList.contains('danger'));
  check('focus sur Confirmer (Entrée confirme, comme le confirm natif)', doc.activeElement === overlay.querySelector('.lp-confirm-ok'));
  overlay.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  check('Tab reste dans la fenêtre', doc.activeElement === overlay.querySelector('button:not(.lp-confirm-ok)'));
  overlay.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  check('Échap : réponse non', (await p) === false && !doc.getElementById('lpConfirmOverlay'));
  check('focus rendu à l\'élément d\'origine', doc.activeElement === doc.getElementById('origin'));

  p = w.LayerPitchNotify.confirm('Recharger ?');
  await wait(0);
  doc.querySelector('#lpConfirmOverlay .lp-confirm-ok').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('Confirmer : réponse oui', (await p) === true);

  p = w.LayerPitchNotify.confirm('Continuer ?');
  await wait(0);
  const bg = doc.getElementById('lpConfirmOverlay');
  bg.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
  check('clic à côté de la fenêtre : réponse non', (await p) === false);

  const p1 = w.LayerPitchNotify.confirm('Première ?');
  const p2 = w.LayerPitchNotify.confirm('Seconde ?');
  await wait(0);
  check('une seule fenêtre à la fois', doc.querySelectorAll('#lpConfirmOverlay').length === 1 && doc.querySelector('.lp-confirm-msg').textContent === 'Première ?');
  doc.querySelector('#lpConfirmOverlay .lp-confirm-ok').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await p1; await wait(0);
  check('la seconde s\'ouvre après la réponse à la première', doc.querySelector('.lp-confirm-msg').textContent === 'Seconde ?');
  doc.querySelector('#lpConfirmOverlay .lp-confirm-actions button:not(.lp-confirm-ok)').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('réponses indépendantes', (await p1) === true && (await p2) === false);

  // ---- Langue : suit <html lang>, aucune langue codée en dur dans le module ----
  w = makePage('en');
  p = w.LayerPitchNotify.confirm('Delete?');
  await wait(0);
  check('anglais : Cancel / Confirm', [...w.document.querySelectorAll('#lpConfirmOverlay button')].map(b => b.textContent).join('|') === 'Cancel|Confirm');
  w.document.querySelector('#lpConfirmOverlay .lp-confirm-ok').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await p;
  w = makePage('de');
  p = w.LayerPitchNotify.confirm('?');
  await wait(0);
  check('langue absente du dictionnaire : repli sur le français', w.document.querySelector('#lpConfirmOverlay .lp-confirm-ok').textContent === 'Confirmer');

  // ---- Garde-fou : plus aucune boîte de dialogue native dans le site ----
  const served = execSync('git ls-files "*.html" "*.js"', { cwd: __dirname }).toString().split('\n').filter(Boolean)
    .filter(f => !f.startsWith('vendor/') && !f.startsWith('video-engine-prototype/') && !/^test[_-]/.test(f) && !f.startsWith('scripts/'));
  const offenders = [];
  served.forEach(f => {
    const lines = fs.readFileSync(path.join(__dirname, f), 'utf-8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/(^|[^.\w$])(window\.)?(alert|confirm|prompt)\s*\(/.test(code)) offenders.push(`${f}:${i + 1}`);
    });
  });
  check('aucun alert()/confirm()/prompt() natif dans les pages et scripts servis' + (offenders.length ? ' -> ' + offenders.join(', ') : ''), offenders.length === 0);

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
