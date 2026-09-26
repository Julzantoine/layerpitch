// LayerPitchNotify — messages et confirmations dans l'interface LayerPitch, à la place des alert() / confirm()
// natifs du navigateur (26/09, retour de Jules-Antoine : la fenêtre grise "beta.layerpitch.com" de Firefox, avec sa
// case "Autoriser les notifications de ce type…", fait bricolé et bloque toute la page).
//
//   LayerPitchNotify.success(msg)            bandeau vert, disparaît seul après quelques secondes
//   LayerPitchNotify.info(msg)               bandeau neutre, disparaît seul
//   LayerPitchNotify.error(msg)              bandeau rouge, reste affiché jusqu'à la croix (le texte peut contenir
//                                            un lien de secours à copier : il reste sélectionnable)
//   await LayerPitchNotify.confirm(msg, { okLabel, cancelLabel, danger })  -> true / false
//
// Chargé par toute page qui en a besoin via <script src="layerpitch-notify.js">, APRÈS layerpitch-i18n.js.
// Libellés (bouton Confirmer, croix de fermeture) lus dans LAYERPITCH_I18N[langue].shared, langue = celle que la
// page a posée sur <html lang> -- aucune liste de langues codée en dur ici : une nouvelle langue ajoutée au
// dictionnaire est prise en compte d'office, le français servant de repli pour une clé absente.
// Couleurs : variables CSS de la page (--bg-card, --text, --border, --accent), donc mode nuit et contraste renforcé
// suivent sans rien ajouter.
(function () {
  if (window.LayerPitchNotify) return;

  const FALLBACK = { cancel: 'Annuler', notifyConfirmOk: 'Confirmer', notifyClose: 'Fermer' };
  function label(key) {
    const dict = window.LAYERPITCH_I18N || {};
    const lang = (document.documentElement.lang || 'fr').slice(0, 2);
    const pick = d => d && d.shared && d.shared[key];
    return pick(dict[lang]) || pick(dict.fr) || FALLBACK[key] || key;
  }

  const CSS = `
  .lp-toast-stack { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 100000; display: flex; flex-direction: column; align-items: center; gap: 8px; width: max-content; max-width: min(560px, calc(100vw - 32px)); pointer-events: none; }
  .lp-toast { pointer-events: auto; display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px 10px 14px; border-radius: 8px; border: 1px solid var(--border, #e4e1da); border-left: 4px solid var(--lp-toast-tone, var(--accent, #2f80c0)); background: var(--bg-card, #fff); color: var(--text, #24262b); box-shadow: 0 6px 20px rgba(0,0,0,0.16); font-family: inherit; font-size: 13px; line-height: 1.45; max-width: 100%; box-sizing: border-box; animation: lp-toast-in .18s ease-out; }
  .lp-toast.success { --lp-toast-tone: #2e9d5b; }
  .lp-toast.error { --lp-toast-tone: #d0433a; }
  .lp-toast-msg { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
  .lp-toast-close { flex: none; border: none; background: none; color: inherit; opacity: .55; font-size: 16px; line-height: 1; padding: 0 2px; cursor: pointer; font-family: inherit; }
  .lp-toast-close:hover, .lp-toast-close:focus-visible { opacity: 1; }
  .lp-toast.leaving { opacity: 0; transform: translateY(6px); transition: opacity .15s, transform .15s; }
  @keyframes lp-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  #lpConfirmOverlay { position: fixed; inset: 0; z-index: 100001; background: rgba(0,0,0,0.38); display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
  .lp-confirm { background: var(--bg-card, #fff); color: var(--text, #24262b); border: 1px solid var(--border, #e4e1da); border-radius: 10px; padding: 20px; width: 420px; max-width: 100%; box-sizing: border-box; box-shadow: 0 12px 32px rgba(0,0,0,0.22); font-family: inherit; animation: lp-toast-in .15s ease-out; }
  .lp-confirm-msg { font-size: 13.5px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 18px; }
  .lp-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
  .lp-confirm-actions button { padding: 8px 16px; border-radius: 6px; font-size: 13px; font-family: inherit; cursor: pointer; border: 1px solid var(--border, #e4e1da); background: transparent; color: var(--text, #24262b); }
  .lp-confirm-actions button.lp-confirm-ok { border-color: var(--accent, #2f80c0); background: var(--accent, #2f80c0); color: #fff; }
  .lp-confirm-actions button.lp-confirm-ok.danger { border-color: #d0433a; background: #d0433a; }
  .lp-confirm-actions button:focus-visible { outline: 2px solid var(--accent, #2f80c0); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .lp-toast, .lp-confirm { animation: none; } .lp-toast.leaving { transition: none; } }
  `;
  function ensureStyle() {
    if (document.getElementById('lpNotifyStyle')) return;
    const style = document.createElement('style');
    style.id = 'lpNotifyStyle';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const MAX_TOASTS = 4;
  let stack = null;
  function getStack() {
    if (stack && stack.isConnected) return stack;
    ensureStyle();
    stack = document.createElement('div');
    stack.className = 'lp-toast-stack';
    document.body.appendChild(stack);
    return stack;
  }
  function dismiss(el) {
    if (!el.isConnected || el.classList.contains('leaving')) return;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 160);
  }
  function toast(message, opts) {
    opts = opts || {};
    const type = opts.type === 'success' || opts.type === 'error' ? opts.type : 'info';
    const host = getStack();
    const el = document.createElement('div');
    el.className = 'lp-toast ' + type;
    // Erreur annoncée tout de suite par les lecteurs d'écran, le reste poliment.
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const msg = document.createElement('div');
    msg.className = 'lp-toast-msg';
    msg.textContent = String(message == null ? '' : message);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'lp-toast-close';
    close.textContent = '×';
    close.setAttribute('aria-label', label('notifyClose'));
    close.title = label('notifyClose');
    close.addEventListener('click', () => dismiss(el));
    el.append(msg, close);
    host.appendChild(el);
    while (host.children.length > MAX_TOASTS) host.firstElementChild.remove();
    // Une erreur reste jusqu'à la croix (elle peut porter un lien de secours à recopier) ; le reste part seul,
    // en laissant le temps de lire un message long, et pas pendant que la souris est dessus.
    const duration = opts.duration != null ? opts.duration
      : type === 'error' ? 0 : Math.min(9000, 3500 + msg.textContent.length * 40);
    if (duration > 0) {
      let timer = setTimeout(() => dismiss(el), duration);
      el.addEventListener('mouseenter', () => clearTimeout(timer));
      el.addEventListener('mouseleave', () => { clearTimeout(timer); timer = setTimeout(() => dismiss(el), 2000); });
    }
    return el;
  }

  // Une seule confirmation à la fois : une seconde demande attend la réponse à la première.
  let pending = Promise.resolve();
  function confirmDialog(message, opts) {
    const run = () => new Promise(resolve => {
      opts = opts || {};
      ensureStyle();
      const previousFocus = document.activeElement;
      const overlay = document.createElement('div');
      // Id terminé par "Overlay" : le Backstage ignore déjà ses raccourcis clavier (touche Supprimer…) tant
      // qu'une fenêtre de ce nom est ouverte.
      overlay.id = 'lpConfirmOverlay';
      const box = document.createElement('div');
      box.className = 'lp-confirm';
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      const msg = document.createElement('p');
      msg.className = 'lp-confirm-msg';
      msg.id = 'lpConfirmMsg';
      msg.textContent = String(message == null ? '' : message);
      box.setAttribute('aria-describedby', msg.id);
      const actions = document.createElement('div');
      actions.className = 'lp-confirm-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = opts.cancelLabel || label('cancel');
      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'lp-confirm-ok' + (opts.danger ? ' danger' : '');
      okBtn.textContent = opts.okLabel || label('notifyConfirmOk');
      actions.append(cancelBtn, okBtn);
      box.append(msg, actions);
      overlay.appendChild(box);

      function finish(answer) {
        overlay.remove();
        if (previousFocus && typeof previousFocus.focus === 'function' && previousFocus.isConnected) previousFocus.focus();
        resolve(answer);
      }
      okBtn.addEventListener('click', () => finish(true));
      cancelBtn.addEventListener('click', () => finish(false));
      overlay.addEventListener('mousedown', e => { if (e.target === overlay) finish(false); });
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Tab') { // focus gardé entre les deux boutons
          e.preventDefault();
          (document.activeElement === okBtn ? cancelBtn : okBtn).focus();
        } else return;
        e.stopPropagation();
      });
      document.body.appendChild(overlay);
      okBtn.focus(); // comme le confirm() natif : Entrée confirme, Échap annule
    });
    const result = pending.then(run);
    pending = result.catch(() => {});
    return result;
  }

  window.LayerPitchNotify = {
    toast,
    success: (m, o) => toast(m, Object.assign({}, o, { type: 'success' })),
    info: (m, o) => toast(m, Object.assign({}, o, { type: 'info' })),
    error: (m, o) => toast(m, Object.assign({}, o, { type: 'error' })),
    confirm: confirmDialog,
  };
})();
