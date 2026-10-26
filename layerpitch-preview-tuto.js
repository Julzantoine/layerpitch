// layerpitch-preview-tuto.js — LayerPitch, bulle de l'APERÇU en mode tutoriel (26/10).
//
// Quand une leçon du Backstage (?tuto) ouvre « Prévisualiser », la page d'aperçu (AdReel, pack) reçoit « &tuto » dans son adresse. Ce petit
// script y affiche alors une bulle : elle rappelle ce qu'on regarde et ramène au Backstage (onglet resté ouvert, tutoriel et compte fictif
// intacts) pour laisser la personne expérimenter ou continuer la leçon. Aucune dépendance : textes FR/EN inclus ici.
(function () {
  const q = new URLSearchParams(window.location.search);
  if (!q.has('tuto') || !q.has('preview')) return;
  const en = (q.get('lang') || localStorage.getItem('layerpitch_lang') || 'fr') === 'en';
  const T = en
    ? { title: 'Here is the page, as a visitor sees it', text: 'You can play the tracks and scroll the page. It is a local preview: nothing is published. When you are done, go back to the Backstage to keep experimenting or to continue the lesson.', btn: 'Back to the Backstage', hint: 'Close this tab to go back to the Backstage.' }
    : { title: 'Voici la page, vue par un visiteur', text: 'Tu peux jouer les morceaux et faire défiler la page. C’est un aperçu local : rien n’est publié. Quand tu as fini, retourne au Backstage pour continuer à expérimenter ou poursuivre la leçon.', btn: 'Retourner au Backstage', hint: 'Ferme cet onglet pour revenir au Backstage.' };
  function show() {
    if (document.getElementById('lpPreviewTuto')) return;
    const css = document.createElement('style');
    css.textContent = '#lpPreviewTuto{position:fixed;right:16px;bottom:16px;z-index:100000;width:340px;max-width:calc(100vw - 32px);background:#fff;color:#24262b;border:1px solid #e2e2e6;border-radius:12px;padding:16px 18px;box-shadow:0 12px 32px rgba(20,22,28,.28);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
      + '#lpPreviewTuto b{display:block;font-size:15px;margin-bottom:6px}#lpPreviewTuto p{margin:0 0 12px;color:#5f636b;font-size:13px}'
      + '#lpPreviewTuto button{padding:8px 14px;border-radius:6px;border:1px solid #2f80c0;background:#fff;color:#2f80c0;font-size:13px;cursor:pointer}#lpPreviewTuto small{display:block;margin-top:8px;color:#9a9ea6}#lpPreviewTuto small[hidden]{display:none}'
      + '@media (max-width:720px){#lpPreviewTuto{left:8px;right:8px;bottom:8px;width:auto;max-width:none}}';
    document.head.appendChild(css);
    const box = document.createElement('div');
    box.id = 'lpPreviewTuto';
    box.setAttribute('role', 'dialog');
    const b = document.createElement('b'); b.textContent = T.title;
    const p = document.createElement('p'); p.textContent = T.text;
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = T.btn;
    const hint = document.createElement('small'); hint.hidden = true; hint.textContent = T.hint;
    btn.addEventListener('click', () => { try { window.close(); } catch (e) { /* fenêtre non fermable */ } setTimeout(() => { hint.hidden = false; }, 250); });
    box.append(b, p, btn, hint);
    document.body.appendChild(box);
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
