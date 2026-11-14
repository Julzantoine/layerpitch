/* ---------------- Crédits et licences (09/11) ----------------
 * Entrée « Crédits et licences » du menu du compte (roue dentée) -> fenêtre qui liste les logiciels libres utilisés et leur licence.
 * Visible de tous les comptes (mention de licence : pas une fonctionnalité à griser avant feu vert). La liste est dans le HTML
 * (#creditsModalOverlay, src/backstage/03-ecran-et-scripts.html) ; la mettre à jour quand une bibliothèque est ajoutée ou retirée
 * (vendor/mediabunny, vendor/ffmpeg, scripts chargés par unpkg/jsdelivr). Textes dans layerpitch-i18n.js (clés credits*).
 */
(function initCreditsModal() {
  const overlay = document.getElementById('creditsModalOverlay');
  const openBtn = document.getElementById('btnAccountCredits');
  if (!overlay || !openBtn) return;
  const close = () => { overlay.style.display = 'none'; };
  openBtn.addEventListener('click', () => {
    // Le menu du compte ne se referme pas tout seul sur un clic à l'intérieur : on le ferme ici.
    const dropdown = document.getElementById('accountMenuDropdown');
    const menuBtn = document.getElementById('btnAccountMenu');
    if (dropdown) dropdown.hidden = true;
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
    overlay.style.display = 'flex';
    const closeBtn = document.getElementById('creditsClose');
    if (closeBtn) closeBtn.focus();
  });
  document.getElementById('creditsClose').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.style.display === 'flex') close(); });
})();
