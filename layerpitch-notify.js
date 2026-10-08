// LayerPitchNotify — messages et confirmations dans l'interface LayerPitch, à la place des alert() / confirm()
// natifs du navigateur (26/09, retour de Jules-Antoine : la fenêtre grise "beta.layerpitch.com" de Firefox, avec sa
// case "Autoriser les notifications de ce type…", fait bricolé et bloque toute la page).
//
//   LayerPitchNotify.success(msg)            bandeau vert, disparaît seul après quelques secondes
//   LayerPitchNotify.info(msg)               bandeau neutre, disparaît seul
//   LayerPitchNotify.inbox({ title, text, anchor, onClick })   carte sous la cloche (8/10) : une notification arrivée, avec titre et début du texte ; un clic dessus appelle onClick ; disparaît seule
//   LayerPitchNotify.error(msg)              bandeau rouge, reste affiché jusqu'à la croix (le texte peut contenir
//                                            un lien de secours à copier : il reste sélectionnable)
//   await LayerPitchNotify.confirm(msg, { okLabel, cancelLabel, extraLabel, danger, checkboxLabel, onFinish })  -> true / false
//   extraLabel : ajoute un 3e bouton, entre « Annuler » et le bouton principal ; la réponse est alors 'extra' (6/10, « continuer sans protéger »).
//   checkboxLabel : ajoute une case à cocher (« Ne plus m'avertir… ») ; onFinish(réponse, cochée) est appelée à la fermeture.
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
  .lp-toast { pointer-events: auto; display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px 10px 14px; border-radius: 8px; border: 1px solid var(--border, #e2e2e6); border-left: 4px solid var(--lp-toast-tone, var(--accent, #2f80c0)); background: var(--bg-card, #fff); color: var(--text, #24262b); box-shadow: 0 6px 20px rgba(0,0,0,0.16); font-family: inherit; font-size: 13px; line-height: 1.45; max-width: 100%; box-sizing: border-box; animation: lp-toast-in .18s ease-out; }
  .lp-toast.success { --lp-toast-tone: #2e9d5b; }
  .lp-toast.error { --lp-toast-tone: #d0433a; }
  .lp-toast-msg { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; max-height: 60vh; overflow-y: auto; }
  .lp-toast-close { flex: none; border: none; background: none; color: inherit; opacity: .55; font-size: 16px; line-height: 1; padding: 0 2px; cursor: pointer; font-family: inherit; }
  .lp-toast-close:hover, .lp-toast-close:focus-visible { opacity: 1; }
  .lp-inbox-card { position: fixed; z-index: 100001; width: min(340px, calc(100vw - 32px)); box-sizing: border-box; display: flex; align-items: flex-start; gap: 10px; padding: 12px 10px 12px 12px; border-radius: 10px; border: 1px solid var(--accent, #2f80c0); background: var(--bg-card, #fff); color: var(--text, #24262b); box-shadow: 0 10px 28px rgba(0,0,0,0.22); font-family: inherit; font-size: 13px; line-height: 1.45; cursor: pointer; animation: lp-toast-in .18s ease-out; }
  .lp-inbox-card.leaving { opacity: 0; transform: translateY(-6px); transition: opacity .15s, transform .15s; }
  .lp-inbox-card-icon { flex: none; width: 28px; height: 28px; border-radius: 50%; background: var(--accent, #2f80c0); color: #fff; display: flex; align-items: center; justify-content: center; }
  .lp-inbox-card-icon svg { width: 16px; height: 16px; }
  .lp-inbox-card-body { flex: 1; min-width: 0; }
  .lp-inbox-card-title { font-weight: 700; overflow-wrap: anywhere; }
  .lp-inbox-card-text { color: var(--text-dim, #5f636b); margin-top: 2px; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .lp-inbox-card-close { flex: none; border: none; background: none; color: inherit; opacity: .55; font-size: 16px; line-height: 1; padding: 0 2px; cursor: pointer; font-family: inherit; }
  .lp-inbox-card-close:hover, .lp-inbox-card-close:focus-visible { opacity: 1; }
  .lp-toast.leaving { opacity: 0; transform: translateY(6px); transition: opacity .15s, transform .15s; }
  @keyframes lp-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  #lpConfirmOverlay { position: fixed; inset: 0; z-index: 100001; background: rgba(0,0,0,0.38); display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
  .lp-confirm { background: var(--bg-card, #fff); color: var(--text, #24262b); border: 1px solid var(--border, #e2e2e6); border-radius: 10px; padding: 20px; width: 420px; max-width: 100%; box-sizing: border-box; box-shadow: 0 12px 32px rgba(0,0,0,0.22); font-family: inherit; animation: lp-toast-in .15s ease-out; }
  .lp-confirm-msg { font-size: 13.5px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 18px; }
  .lp-confirm-check { display: flex; align-items: center; gap: 8px; font-size: 13px; margin: -6px 0 16px; cursor: pointer; }
  .lp-confirm-check input { margin: 0; }
  .lp-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
  .lp-confirm-actions button { padding: 8px 16px; border-radius: 6px; font-size: 13px; font-family: inherit; cursor: pointer; border: 1px solid var(--border, #e2e2e6); background: transparent; color: var(--text, #24262b); }
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
      let extraBtn = null;
      if (opts.extraLabel) { extraBtn = document.createElement('button'); extraBtn.type = 'button'; extraBtn.textContent = opts.extraLabel; actions.append(cancelBtn, extraBtn, okBtn); }
      else actions.append(cancelBtn, okBtn);
      let checkEl = null;
      if (opts.checkboxLabel) {
        const row = document.createElement('label');
        row.className = 'lp-confirm-check';
        checkEl = document.createElement('input');
        checkEl.type = 'checkbox';
        const txt = document.createElement('span');
        txt.textContent = opts.checkboxLabel;
        row.append(checkEl, txt);
        box.append(msg, row, actions);
      } else box.append(msg, actions);
      overlay.appendChild(box);

      function finish(answer) {
        if (typeof opts.onFinish === 'function') { try { opts.onFinish(answer, !!(checkEl && checkEl.checked)); } catch (e) { /* un réglage qui échoue ne bloque pas la fenêtre */ } }
        overlay.remove();
        if (previousFocus && typeof previousFocus.focus === 'function' && previousFocus.isConnected) previousFocus.focus();
        resolve(answer);
      }
      okBtn.addEventListener('click', () => finish(true));
      cancelBtn.addEventListener('click', () => finish(false));
      if (extraBtn) extraBtn.addEventListener('click', () => finish('extra'));
      overlay.addEventListener('mousedown', e => { if (e.target === overlay) finish(false); });
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Tab') { // focus gardé dans la fenêtre : case (si présente), puis les deux boutons
          e.preventDefault();
          const order = (checkEl ? [checkEl] : []).concat(extraBtn ? [cancelBtn, extraBtn, okBtn] : [cancelBtn, okBtn]);
          const i = order.indexOf(document.activeElement);
          order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length].focus();
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


  // Carte « nouvelle notification » (8/10) : posée sous la cloche (en haut à droite) plutôt qu'en bas au milieu de la page,
  // plus visible qu'un petit bandeau, et un clic dessus ouvre la cloche. Une seule à la fois ; disparaît seule, sauf pendant
  // que la souris est dessus.
  const BELL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  let inboxCard = null;
  function inboxNotice(opts) {
    opts = opts || {};
    ensureStyle();
    if (inboxCard && inboxCard.isConnected) inboxCard.remove();
    const el = document.createElement('div');
    el.className = 'lp-inbox-card';
    el.setAttribute('role', 'status');
    const icon = document.createElement('div'); icon.className = 'lp-inbox-card-icon'; icon.innerHTML = BELL_SVG;
    const body = document.createElement('div'); body.className = 'lp-inbox-card-body';
    const title = document.createElement('div'); title.className = 'lp-inbox-card-title'; title.textContent = String(opts.title || '');
    body.appendChild(title);
    if (opts.text) { const text = document.createElement('div'); text.className = 'lp-inbox-card-text'; text.textContent = String(opts.text); body.appendChild(text); }
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'lp-inbox-card-close'; close.textContent = '×';
    close.setAttribute('aria-label', label('notifyClose')); close.title = label('notifyClose');
    el.append(icon, body, close);
    // Sous la cloche si on la trouve, sinon en haut à droite de la fenêtre.
    const anchor = opts.anchor && document.querySelector(opts.anchor);
    const r = anchor && anchor.getBoundingClientRect();
    el.style.top = (r && r.height ? Math.round(r.bottom + 10) : 16) + 'px';
    el.style.right = (r && r.width ? Math.max(16, Math.round(window.innerWidth - r.right)) : 16) + 'px';
    document.body.appendChild(el);
    inboxCard = el;
    const dismissCard = () => { if (!el.isConnected || el.classList.contains('leaving')) return; el.classList.add('leaving'); setTimeout(() => el.remove(), 160); };
    close.addEventListener('click', e => { e.stopPropagation(); dismissCard(); });
    el.addEventListener('click', () => { dismissCard(); if (typeof opts.onClick === 'function') opts.onClick(); });
    let timer = setTimeout(dismissCard, opts.duration != null ? opts.duration : 10000);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => { clearTimeout(timer); timer = setTimeout(dismissCard, 2500); });
    return el;
  }

  window.LayerPitchNotify = {
    toast,
    inbox: inboxNotice,
    success: (m, o) => toast(m, Object.assign({}, o, { type: 'success' })),
    info: (m, o) => toast(m, Object.assign({}, o, { type: 'info' })),
    error: (m, o) => toast(m, Object.assign({}, o, { type: 'error' })),
    confirm: confirmDialog,
  };
})();
