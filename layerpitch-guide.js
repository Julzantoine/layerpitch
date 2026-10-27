/* layerpitch-guide.js — moteur partagé des bulles guidées (visite guidée et leçons), 20/10.
 *
 * Né du Backstage (08/10, src/backstage/43-visite-guidee.js) ; sorti dans un fichier à part pour servir AUSSI sur d'autres
 * pages (projet.html : leçons « Préproduction »). Ce fichier ne connaît ni les leçons, ni les textes, ni les données d'une
 * page : il dessine la bulle, la découpe lumineuse autour de la cible, fait avancer les étapes et gère le clavier, le
 * déplacement de la bulle et la flèche. Tout ce qui est propre à une page lui est fourni par la page (le « host ») :
 *
 *   const G = LayerPitchGuide.create({
 *     tr(key, vars),                      // textes (obligatoire)
 *     nextLesson(lessonId) -> { lesson: { id, titleKey }, n } | null,   // leçon proposée sur la bulle finale
 *     startLesson(id),                    // lance une leçon (bouton « leçon suivante »)
 *     onLessonDone(id), onTourDone(),     // mémorisation de ce qui a été fait
 *     onClose(),                          // après toute fermeture (ex. redessiner le menu)
 *     onOpen(),                           // à l'ouverture (ex. cacher les bulles d'aide au survol)
 *     cardExtras(step, st) -> html,       // bloc en plus dans la bulle (vignettes d'exemple…)
 *     wireCard(card, step, st),           // branche ce bloc (glisser, clavier…)
 *     textVars(step, st) -> {…},          // variables du texte de l'étape
 *     arrowPoint(bar) -> {x, y} | null,   // position écran de la flèche « mesure n »
 *     centerTarget(target) -> bool,       // cible à ramener au centre (passe sous une barre fixe)
 *     adminTools() -> bool,               // outils d'admin : « Passer l'étape », « Aller à l'étape n », « Auto jusqu'à l'étape n » (rejoue les gestes)
 *     autoSample(step) -> Promise,        // dépose le fichier d'exemple d'une étape (utilisé par « Auto »)
 *   });
 *   G.open('lesson', steps, 'static'); G.state(); G.close(); G.go(1); G.stepIsDone(step); …
 *
 * Vignettes de LIENS, de TEXTE et de FICHIERS (20/10) : une étape peut porter `drops: [{ kind: 'link' | 'text', label, value }]`
 * ou { kind: 'file', label, url, name } (fichier téléchargé puis déposé comme un vrai fichier glissé). Chaque
 * vignette se glisse (ou s'active au clavier / au clic) vers la zone en surbrillance : champ de saisie -> la valeur y est
 * écrite ; autre zone -> un vrai événement « drop » (text/plain + text/uri-list) lui est envoyé, que la page traite comme
 * un dépôt de lien ou de texte ordinaire. `host.onDrop(step, drop, target)` (facultatif) reprend la main à la place.
 * `selector` peut être une fonction qui renvoie l'élément visé (cible calculée à chaque instant).
 * Bulle à CHOIX (27/10) : une étape peut porter `choices: [{ labelKey, lesson }]` — un gros bouton par choix ; un clic termine la
 * bulle en cours puis lance la leçon `lesson` (host.startLesson). Sert à la fin de la visite guidée (host.startChoice(id) si la page le fournit, sinon host.startLesson).
 * Étapes : { selector, titleKey, textKey, done(ctx), clickDone, listen, listenTarget, enter(ctx), skip(ctx), final,
 *            keepTrack, arrow: {bar} } — voir les leçons du Backstage pour des exemples.
 * Mise en forme : layerpitch-guide.css. Gabarit de page attendu : variables --bg, --border, --accent, --text-dim.
 */
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function targetVisible(el) {
    if (!el || el.hidden || el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function create(host) {
    const tr = (k, v) => host.tr(k, v);
    // Suivi (23/10) : la page peut fournir host.onTrack(nom, détails) ; à défaut, le suivi Umami du tutoriel (layerpitch-tuto.js) s'il est chargé.
    // Jamais bloquant ; que des identifiants de leçon et d'étape.
    const track = (name, detail) => { try { const f = host.onTrack || (window.LayerPitchTuto && window.LayerPitchTuto.track); if (f) f(name, detail); } catch (e) { /* jamais bloquant */ } };
    let guide = null; // { root, kind, lessonId, steps, index, maxIndex, ctx, timer, advancing, clicked, cardKey, userMoved }


    // ---- Vignettes de liens et de texte ----
    const DROP_GLYPH = { link: '↗', text: '¶', file: '♪' };
    function dropsHtml(step) {
      if (!step.drops || !step.drops.length) return '';
      return step.drops.map((d, i) => `<div class="tour-chip tour-chip-${esc(d.kind)}" data-tour-drop="${i}" role="button" tabindex="0" aria-label="${esc(tr('lessonDropHint'))}"><span class="tour-chip-note">${DROP_GLYPH[d.kind] || '♪'}</span><span class="tour-chip-name">${esc(d.label || d.value)}</span></div>`).join('')
        + `<div class="tour-sample-hint">${esc(tr('lessonDropHint'))}</div>`;
    }
    // Fichier d'exemple : téléchargé (reprise possible, comme les leçons du Backstage), puis déposé sur la zone comme un vrai
    // fichier glissé depuis l'ordinateur (événement « drop » portant un File).
    function deliverFile(drop, target) {
      (async () => {
        try {
          const res = await fetch(drop.url);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const blob = await res.blob();
          const file = new File([blob], drop.name || 'exemple', { type: blob.type || 'audio/mpeg' });
          const dt = new DataTransfer();
          dt.items.add(file);
          const ev = new Event('drop', { bubbles: true, cancelable: true });
          Object.defineProperty(ev, 'dataTransfer', { value: dt });
          target.dispatchEvent(ev);
        } catch (e) { if (host.onError) host.onError(e); }
      })();
      return true;
    }
    // Remet la valeur de la vignette à la zone visée (champ de saisie, ou événement « drop » ordinaire).
    function deliverDrop(step, drop, target) {
      if (!target) return false;
      if (drop.kind === 'file') return deliverFile(drop, target);
      if (host.onDrop && host.onDrop(step, drop, target) === true) return true;
      const tag = target.tagName;
      const field = (tag === 'INPUT' || tag === 'TEXTAREA') ? target : target.querySelector && target.querySelector('input:not([type=file]):not([type=checkbox]):not([type=radio]), textarea');
      if (field && !field.disabled && !field.readOnly) {
        field.focus();
        field.value = drop.value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      if (target.isContentEditable) {
        target.focus();
        target.textContent = drop.value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      // Zone de dépôt : un vrai « drop » transportant le lien ou le texte, comme si l'apprenant l'y avait lâché.
      let dt = null;
      try {
        dt = new DataTransfer();
        dt.setData('text/plain', drop.value);
        if (drop.kind === 'link') dt.setData('text/uri-list', drop.value);
      } catch (e) { /* DataTransfer non constructible : repli ci-dessous */ }
      const ev = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt || { files: [], types: ['text/plain'], getData: t => (t === 'text/plain' || (t === 'text/uri-list' && drop.kind === 'link')) ? drop.value : '' } });
      target.dispatchEvent(ev);
      return true;
    }
    function pointInTarget(step, x, y) {
      const el = stepTarget(step);
      if (!el) return false;
      const r = el.getBoundingClientRect(), m = 6;
      return x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m;
    }
    function wireDrops(card, step) {
      card.querySelectorAll('[data-tour-drop]').forEach(chip => {
        const drop = step.drops[Number(chip.dataset.tourDrop)];
        const use = () => deliverDrop(step, drop, stepTarget(step));
        chip.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); use(); } });
        chip.addEventListener('pointerdown', ev => {
          if (ev.button !== undefined && ev.button !== 0) return;
          ev.preventDefault();
          const sx = ev.clientX, sy = ev.clientY; // un simple appui (sans déplacement) vaut « utiliser » : indispensable au doigt, où l'on ne glisse pas toujours
          const ghost = chip.cloneNode(true);
          ghost.classList.add('tour-chip-ghost');
          ghost.removeAttribute('data-tour-drop');
          (guide && guide.root.parentNode ? guide.root.parentNode : document.body).appendChild(ghost); // même couche que la bulle (fenêtre ouverte)
          const place = (x, y) => { ghost.style.left = (x + 12) + 'px'; ghost.style.top = (y + 12) + 'px'; };
          place(ev.clientX, ev.clientY);
          chip.classList.add('is-dragging');
          const spot = guide && guide.root.querySelector('.tour-spot');
          const target = stepTarget(step);
          const hot = on => { if (spot) spot.classList.toggle('tour-spot-hot', on); if (target) target.classList.toggle('drag-over', on); };
          const move = e => { place(e.clientX, e.clientY); hot(pointInTarget(step, e.clientX, e.clientY)); };
          const end = e => {
            document.removeEventListener('pointermove', move, true);
            document.removeEventListener('pointerup', end, true);
            document.removeEventListener('pointercancel', end, true);
            ghost.remove(); chip.classList.remove('is-dragging'); hot(false);
            if (e.type !== 'pointercancel' && (Math.hypot(e.clientX - sx, e.clientY - sy) < 6 || pointInTarget(step, e.clientX, e.clientY))) use();
          };
          document.addEventListener('pointermove', move, true);
          document.addEventListener('pointerup', end, true);
          document.addEventListener('pointercancel', end, true);
        });
      });
    }

    function close() {
      if (!guide) return;
      if (guide.timer) clearInterval(guide.timer);
      guide.root.remove();
      document.body.classList.remove('lp-guide-active');
      window.removeEventListener('resize', render);
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('click', onClickCapture, true);
      const kind = guide.kind;
      // Fermée avant la fin (Quitter, Échap, changement de leçon) : on note jusqu'où la personne est allée.
      if (!guide.finished) track(kind === 'lesson' ? 'lesson_quit' : 'tour_quit', { lesson: guide.lessonId || undefined, step: guide.maxIndex + 1, steps: guide.steps.length });
      guide = null;
      if (kind === 'tour' && host.onTourDone) host.onTourDone();
      if (host.onClose) host.onClose();
    }
    function onKeydown(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    function onClickCapture(e) {
      if (!guide) return;
      const step = guide.steps[guide.index];
      if (!step || !(step.clickDone || step.listen) || !step.selector || !e.target) return;
      if (typeof step.selector === 'function') { const el = step.selector(); if (el && el.contains && el.contains(e.target)) guide.clicked = true; }
      else if (e.target.closest && e.target.closest(step.selector)) guide.clicked = true;
    }
    function stepTarget(step) {
      // Étape d'écoute : une fois « Écouter » cliqué, la surbrillance passe au lecteur qui vient de s'ouvrir (listenTarget),
      // pour montrer qu'on peut s'en servir (pause, tête de lecture).
      if (step.listenTarget && guide && guide.clicked) {
        const el = document.querySelector(step.listenTarget);
        if (el && targetVisible(el)) return el;
      }
      if (typeof step.selector === 'function') return step.selector() || null; // cible calculée (ex. un nœud d'une carte, retrouvé par son nom)
      return step.selector ? document.querySelector(step.selector) : null;
    }
    function go(delta) {
      if (!guide) return;
      let next = guide.index + delta;
      // Saute les étapes sans objet (ex. curseur de paramètre quand son feu vert est fermé), dans les deux sens.
      while (next >= 0 && next < guide.steps.length && guide.steps[next].skip && guide.steps[next].skip(guide.ctx)) next += delta;
      if (next < 0) return;
      if (next >= guide.steps.length) { finish(); return; }
      const leaving = guide.steps[guide.index];
      if (delta < 0 && leaving && leaving.onBack) leaving.onBack(guide.ctx); // ex. fenêtre ouverte par l'étape quittée
      guide.index = next; guide.clicked = false; guide.advancing = false; guide.userMoved = false;
      if (next > guide.maxIndex) {
        guide.maxIndex = next; // étape la plus avancée atteinte : au-delà du « front », on ne fait que revoir
        track(guide.kind === 'lesson' ? 'step' : 'tour_step', { lesson: guide.lessonId || undefined, step: next + 1, steps: guide.steps.length, key: guide.steps[next].titleKey });
      }
      const step = guide.steps[next];
      if (step.enter) step.enter(guide.ctx);
      render();
    }
    // Invitation à la bêta (22/10) : fenêtre qui recueille une adresse mail et l'envoie à la même fonction que le formulaire de la
    // landing (submit-access-request : enregistre la demande, confirme à la personne, prévient Jules-Antoine).
    const BETA_FN_URL = 'https://ypygllyjfynrnvapufow.supabase.co/functions/v1/submit-access-request';
    const BETA_ANON_KEY = 'sb_publishable_bpjR1M-no9BaxD6QjwcNlQ_og_IgcRb';
    function openBetaPopup(lessonId) {
      if (document.querySelector('.tour-beta-overlay')) return;
      const overlay = document.createElement('div');
      overlay.className = 'tour-beta-overlay';
      overlay.innerHTML = `
        <div class="tour-beta-modal" role="dialog" aria-modal="true">
          <h3>${esc(tr('betaPopupTitle'))}</h3>
          <form novalidate>
            <p>${esc(tr('betaPopupText'))}</p>
            <input type="email" name="email" autocomplete="email" placeholder="${esc(tr('betaPopupPlaceholder'))}" required>
            <div class="tour-beta-msg" aria-live="polite"></div>
            <div class="tour-beta-actions">
              <button class="btn btn-small" type="button" data-beta="close">${esc(tr('betaPopupClose'))}</button>
              <button class="btn btn-small btn-primary" type="submit">${esc(tr('betaPopupSend'))}</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(overlay);
      const form = overlay.querySelector('form'), msg = overlay.querySelector('.tour-beta-msg'), input = overlay.querySelector('input[name="email"]');
      const closePopup = () => overlay.remove();
      overlay.addEventListener('click', e => { if (e.target === overlay || (e.target.closest && e.target.closest('[data-beta="close"]'))) closePopup(); });
      overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closePopup(); } });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const email = input.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = tr('betaPopupInvalid'); msg.className = 'tour-beta-msg err'; return; }
        msg.textContent = tr('betaPopupSending'); msg.className = 'tour-beta-msg';
        try {
          const res = await fetch(BETA_FN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: BETA_ANON_KEY, Authorization: 'Bearer ' + BETA_ANON_KEY },
            body: JSON.stringify({ email, source: 'landing', intent: 'beta', lang: tr('betaPopupLang'), message: 'Depuis le tutoriel (leçon : ' + (lessonId || '?') + ')' }),
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          form.innerHTML = `<p class="tour-beta-ok">${esc(tr('betaPopupThanks'))}</p><div class="tour-beta-actions"><button class="btn btn-small btn-primary" type="button" data-beta="close">${esc(tr('betaPopupClose'))}</button></div>`;
        } catch (err) { msg.textContent = tr('betaPopupError'); msg.className = 'tour-beta-msg err'; }
      });
      input.focus();
    }
    // ---- Outils d'admin (22/10) : rejouer une leçon jusqu'à l'étape voulue, pour vérifier une étape tardive sans refaire tout le début ----
    // « Auto » refait les gestes à la place de l'apprenant : dépôt du fichier d'exemple, clics, cases, listes (on essaie chaque option jusqu'à
    // ce que l'étape soit validée) ; pour une saisie, l'étape fournit `auto(ctx, cible)`. Si une étape ne se laisse pas automatiser, on s'arrête
    // dessus : on la fait à la main puis on relance « Auto ». Les étapes manuelles (« Suivant ») sont passées, l'écoute libre aussi.
    const wait = ms => new Promise(r => setTimeout(r, ms));
    function fire(el) { try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) { el.click(); } }
    function setAdminMsg(t) { if (!guide) return; guide.adminMsg = t; const m = guide.root.querySelector('[data-tour="adm-msg"]'); if (m) m.textContent = t; }
    async function autoPerform(step) {
      let target = null;
      for (let i = 0; i < 25; i++) { target = stepTarget(step); if (!step.selector || targetVisible(target)) break; await wait(120); }
      if (!step.done && !step.clickDone && !step.listen) return true; // manuelle : rien à faire
      if (step.auto) await step.auto(guide.ctx, target);
      else if (step.useSample && host.autoSample) await host.autoSample(step);
      else if ((step.clickDone || step.listen) && target) fire(target);
      else if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' && target.type === 'checkbox') { if (!target.checked) fire(target); }
        else if (tag === 'SELECT') {
          // La page peut redessiner la liste à chaque choix : on la retrouve avant chaque essai.
          const values = [...target.options].map(o => o.value).filter(v => v);
          for (const v of values) {
            if (stepIsDone(step)) break;
            const cur = stepTarget(step);
            if (!cur) break;
            cur.value = v; cur.dispatchEvent(new Event('input', { bubbles: true })); cur.dispatchEvent(new Event('change', { bubbles: true }));
            await wait(50);
          }
        } else fire(target);
      }
      if (step.listen) return true; // l'écoute n'a pas de geste vérifiable
      for (let i = 0; i < 40; i++) { if (stepIsDone(step)) return true; await wait(100); }
      return false;
    }
    async function autoTo(targetIndex) {
      if (!guide) return;
      if (guide.autoRunning) { guide.autoRunning = false; setAdminMsg(tr('tourAdminStopped')); return; }
      guide.autoRunning = true;
      const myGuide = guide;
      let stalled = false;
      try {
        while (guide === myGuide && guide.autoRunning && guide.index < targetIndex) {
          const step = guide.steps[guide.index];
          if (step.final) break;
          setAdminMsg(tr('tourAdminProgress', { n: guide.index + 1, total: targetIndex + 1 }));
          const ok = await autoPerform(step);
          if (guide !== myGuide || !guide.autoRunning) break;
          if (!ok) { stalled = true; guide.autoRunning = false; setAdminMsg(tr('tourAdminStalled', { n: guide.index + 1 })); break; }
          go(1);
          await wait(80);
        }
      } finally {
        if (guide === myGuide) { guide.autoRunning = false; if (!stalled) { guide.cardKey = ''; render(); } }
      }
    }
    function goToNextLesson() {
      if (!guide) return;
      const nx = host.nextLesson ? host.nextLesson(guide.lessonId) : null;
      finish();
      if (nx && host.startLesson) host.startLesson(nx.lesson.id);
    }
    function finish() {
      if (guide && guide.kind === 'lesson' && host.onLessonDone) host.onLessonDone(guide.lessonId);
      if (guide) { track(guide.kind === 'lesson' ? 'lesson_done' : 'tour_done', { lesson: guide.lessonId || undefined, steps: guide.steps.length }); guide.finished = true; }
      close();
    }
    function stepIsDone(step) {
      if (step.done) { try { return !!step.done(guide.ctx); } catch (e) { return false; } }
      if (step.clickDone) return guide.clicked;
      return false;
    }
    function tick() {
      if (!guide) return;
      const step = guide.steps[guide.index];
      if (guide.autoRunning) { render(true); return; } // « Auto » (admin) fait avancer lui-même
      // Étape déjà franchie, revue avec « Précédent » : pas d'avance automatique (sinon on ne pourrait jamais reculer).
      if (guide.kind === 'lesson' && !guide.advancing && guide.index >= guide.maxIndex && stepIsDone(step)) {
        guide.advancing = true;
        setTimeout(() => go(1), 450); // laisse voir le résultat du geste avant la bulle suivante
        return;
      }
      // Étape à clic revue avec « Précédent » : si la personne reclique vraiment sur la cible, on avance (sinon « +Pack » recliqué ne faisait rien).
      if (guide.kind === 'lesson' && !guide.advancing && guide.index < guide.maxIndex && step.clickDone && guide.clicked) {
        guide.advancing = true;
        setTimeout(() => go(1), 450);
        return;
      }
      render(true);
    }
    function render(positionOnly) {
      if (!guide) return;
      const step = guide.steps[guide.index];
      const target = stepTarget(step);
      // Cible dans une fenêtre modale ouverte (<dialog> : affichée au-dessus de tout le reste de la page) : la bulle s'y installe,
      // sinon elle resterait derrière la fenêtre, inaccessible (21/10, dialogue « Choisir la vidéo » de l'atelier vidéo).
      const layer = (target && target.closest && target.closest('dialog[open]')) || document.body;
      if (guide.root.parentNode !== layer) layer.appendChild(guide.root);
      const visible = targetVisible(target);
      const spot = guide.root.querySelector('.tour-spot');
      const card = guide.root.querySelector('.tour-card');
      const auto = guide.kind === 'lesson' && (step.done || step.clickDone);
      const listening = guide.kind === 'lesson' && !!step.listen; // clic sur « Écouter », puis écoute libre, puis « Suivant »
      const last = guide.index === guide.steps.length - 1;
      const revisiting = guide.index < guide.maxIndex;
      const nextLesson = guide.kind === 'lesson' && step.final && host.nextLesson ? host.nextLesson(guide.lessonId) : null;
      const key = guide.index + ':' + (visible ? 'v' : 'h') + (revisiting ? ':r' : '') + (listening && guide.clicked ? ':c' : '');
      if (!positionOnly || guide.cardKey !== key) {
        guide.cardKey = key;
        const extras = (host.cardExtras ? host.cardExtras(step, guide) : '') + dropsHtml(step);
        const vars = host.textVars ? host.textVars(step, guide) : {};
        const adminOn = guide.kind === 'lesson' && !!(host.adminTools && host.adminTools());
        if (guide.adminTarget == null) guide.adminTarget = guide.steps.length - 1;
        const adminHtml = adminOn ? `<div class="tour-admin"><span class="tour-admin-tag">${esc(tr('tourAdminTag'))}</span>
        <button class="btn btn-small" type="button" data-tour="adm-skip">${esc(tr('tourAdminSkip'))}</button>
        <select data-tour="adm-target" title="${esc(tr('tourAdminTargetTitle'))}">${guide.steps.map((st, k) => `<option value="${k}"${k === guide.adminTarget ? ' selected' : ''}>${k + 1} · ${esc(tr(st.titleKey || ''))}</option>`).join('')}</select>
        <button class="btn btn-small" type="button" data-tour="adm-jump" title="${esc(tr('tourAdminJumpTitle'))}">${esc(tr('tourAdminJump'))}</button>
        <button class="btn btn-small" type="button" data-tour="adm-auto" title="${esc(tr('tourAdminAutoTitle'))}">${esc(tr(guide.autoRunning ? 'tourAdminStop' : 'tourAdminAuto'))}</button>
        <span class="tour-admin-msg" data-tour="adm-msg">${esc(guide.adminMsg || '')}</span></div>` : '';
        card.innerHTML = `
      <div class="tour-count"><span>${guide.index + 1} / ${guide.steps.length}</span><span class="tour-grip" title="${esc(tr('lessonMoveHint'))}" aria-hidden="true">⠿</span></div>
      <div class="tour-title">${esc(tr(step.titleKey))}</div>
      <div class="tour-move-note">${esc(tr('lessonMoveNote'))}</div>
      <div class="tour-text">${esc(tr(step.textKey, vars).replace(/\n/g, '\n\n'))}</div>
      ${extras}
      ${guide.kind === 'lesson' && guide.index === 0 ? `<div class="tour-desktop">${esc(tr('lessonDesktopNote'))}</div>` : ''}
      ${guide.kind === 'lesson' && step.final ? `<div class="tour-free">${esc(tr('lessonFreePlay'))}</div>` : ''}
      ${guide.kind === 'lesson' && step.final ? `<div class="tour-ps">${esc(tr('lessonBetaPs'))} <a href="#" data-tour="beta">${esc(tr('lessonBetaLink'))}</a></div>` : ''}
      ${auto || (listening && !guide.clicked && !revisiting) ? `<div class="tour-waiting">${esc(tr('lessonDoIt'))}</div>` : ''}
      ${listening && guide.clicked ? `<div class="tour-waiting">${esc(tr('lessonListening'))}</div>` : ''}
      ${step.choices && step.choices.length ? `<div class="tour-choices">${step.choices.map(c => `<button class="btn btn-primary" type="button" data-tour="choice" data-lesson="${esc(c.lesson)}">${esc(tr(c.labelKey))}</button>`).join('')}</div>` : ''}
      ${adminHtml}
      <div class="tour-actions">
        <button class="btn btn-small" type="button" data-tour="skip">${esc(tr(last ? 'tourClose' : (guide.kind === 'lesson' ? 'lessonQuit' : 'tourSkip')))}</button>
        <span style="flex:1"></span>
        ${guide.index > 0 && !step.final ? `<button class="btn btn-small" type="button" data-tour="prev">${esc(tr('tourPrev'))}</button>` : ''}
        ${nextLesson ? `<button class="btn btn-small btn-primary" type="button" data-tour="nextlesson">${esc(tr('lessonNextBtn', { n: nextLesson.n, title: tr(nextLesson.lesson.titleKey).replace(/^\d+\s·\s/, '') }))}</button>` : ''}
        ${auto
          /* étape à geste : elle n'avance que lorsque le geste est fait ; « Passer l'étape » n'existe que pour une étape déjà
             franchie, revue avec « Précédent » */
          ? (revisiting ? `<button class="btn btn-small" type="button" data-tour="next">${esc(tr('lessonSkipStep'))}</button>`
              : (step.keepTrack ? `<button class="btn btn-small" type="button" data-tour="next">${esc(tr('lessonKeepTrack'))}</button>` : ''))
          : ((listening && !guide.clicked && !revisiting) || (step.choices && step.choices.length) ? ''
            : `<button class="btn btn-small btn-primary" type="button" data-tour="next">${esc(tr(last ? 'tourFinish' : 'tourNext'))}</button>`)}
      </div>`;
        card.querySelector('[data-tour="skip"]').onclick = close;
        const nextBtn = card.querySelector('[data-tour="next"]');
        if (nextBtn) nextBtn.onclick = () => go(1); // absent sur une étape obligatoire
        const prev = card.querySelector('[data-tour="prev"]');
        if (prev) prev.onclick = () => go(-1);
        const betaLink = card.querySelector('[data-tour="beta"]');
        if (betaLink) betaLink.onclick = e => { e.preventDefault(); openBetaPopup(guide.lessonId); };
        const admSkip = card.querySelector('[data-tour="adm-skip"]');
        if (admSkip) {
          const tsel = card.querySelector('[data-tour="adm-target"]');
          tsel.onchange = () => { guide.adminTarget = parseInt(tsel.value, 10); };
          admSkip.onclick = () => { guide.autoRunning = false; go(1); };
          card.querySelector('[data-tour="adm-jump"]').onclick = () => { guide.autoRunning = false; go(parseInt(tsel.value, 10) - guide.index); };
          card.querySelector('[data-tour="adm-auto"]').onclick = () => autoTo(parseInt(tsel.value, 10));
        }
        card.querySelectorAll('[data-tour="choice"]').forEach(b => { b.onclick = () => { const id = b.dataset.lesson; finish(); const go = host.startChoice || host.startLesson; if (go) go(id); }; });
        const nlBtn = card.querySelector('[data-tour="nextlesson"]');
        if (nlBtn) nlBtn.onclick = goToNextLesson;
        wireDrops(card, step);
        if (host.wireCard) host.wireCard(card, step, guide);
      }
      // Flèches indicatives (étapes avec `arrow`, une flèche ou une liste) : pointent les mesures à viser sur la timeline.
      const arrows = step.arrow && visible && host.arrowPoint ? [].concat(step.arrow) : [];
      const arrowEls = [...guide.root.querySelectorAll('.tour-arrow')];
      arrows.forEach((a, k) => {
        const ap = host.arrowPoint(a.bar);
        let arrowEl = arrowEls[k];
        if (!ap) { if (arrowEl) { arrowEl.remove(); arrowEls[k] = null; } return; }
        if (!arrowEl) {
          arrowEl = document.createElement('div');
          arrowEl.className = 'tour-arrow';
          arrowEl.innerHTML = '<span class="tour-arrow-label"></span><span class="tour-arrow-head">▼</span>';
          guide.root.appendChild(arrowEl);
          arrowEls[k] = arrowEl;
        }
        arrowEl.querySelector('.tour-arrow-label').textContent = a.labelKey ? tr(a.labelKey) : tr('lessonArrowLabel', { n: a.bar });
        arrowEl.style.left = ap.x + 'px';
        arrowEl.style.top = ap.y + 'px';
      });
      arrowEls.slice(arrows.length).forEach(el => el && el.remove());
      const margin = 12;
      if (visible) {
        // Cible hors de l'écran (page longue) : on la fait défiler dans la vue à l'arrivée sur l'étape, sinon la zone en
        // surbrillance reste invisible.
        if (!positionOnly) {
          const b = target.getBoundingClientRect();
          // (certains champs passent sous une barre fixe : la page peut demander de les ramener au centre)
          const underBar = !!(host.centerTarget && host.centerTarget(target, b));
          // Téléphone : la bulle est ancrée en bas de l'écran (guide.css) ; la cible doit rester dans la moitié haute.
          const phone = window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
          if (b.bottom > window.innerHeight - 8 || b.top < 8 || underBar || (phone && b.bottom > window.innerHeight * 0.55)) {
            try {
              if (phone) { target.style.scrollMarginTop = '84px'; target.scrollIntoView({ block: 'start' }); }
              else target.scrollIntoView({ block: b.height > window.innerHeight * 0.7 ? 'start' : 'center' });
            } catch (e) { /* ancien navigateur */ }
          }
        }
        const r = target.getBoundingClientRect();
        spot.style.display = 'block';
        spot.style.top = (r.top - 4) + 'px'; spot.style.left = (r.left - 4) + 'px';
        spot.style.width = (r.width + 8) + 'px'; spot.style.height = (r.height + 8) + 'px';
        // Pendant une leçon, la cible doit rester cliquable : le voile laisse passer les clics (pointer-events), la carte non.
        if (!guide.userMoved) {
          const cw = card.offsetWidth, ch = card.offsetHeight;
          let left = r.right + margin, top = r.top;
          if (left + cw > window.innerWidth - margin) { left = Math.min(r.left, window.innerWidth - cw - margin); top = r.bottom + margin; }
          if (top + ch > window.innerHeight - margin) top = Math.max(margin, r.top - ch - margin);
          card.style.left = Math.max(margin, left) + 'px'; card.style.top = Math.max(margin, top) + 'px';
          card.style.transform = 'none';
        }
      } else {
        spot.style.display = 'none';
        if (!guide.userMoved) { card.style.left = '50%'; card.style.top = '50%'; card.style.transform = 'translate(-50%, -50%)'; }
      }
    }
    // La bulle se saisit et se déplace (utile quand elle cache la zone à manipuler) ; le déplacement vaut pour l'étape en cours,
    // la bulle reprend sa place automatique à l'étape suivante.
    function enableCardDrag(card) {
      card.addEventListener('pointerdown', ev => {
        if (!guide || (ev.button !== undefined && ev.button !== 0)) return;
        if (ev.target.closest('button, a, input, select, textarea, .tour-chip')) return;
        ev.preventDefault();
        const r = card.getBoundingClientRect();
        const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
        guide.userMoved = true;
        card.style.transform = 'none';
        card.style.left = r.left + 'px'; card.style.top = r.top + 'px';
        card.classList.add('is-moving');
        const move = e => {
          const m = 8;
          const x = Math.max(m, Math.min(window.innerWidth - card.offsetWidth - m, e.clientX - dx));
          const y = Math.max(m, Math.min(window.innerHeight - card.offsetHeight - m, e.clientY - dy));
          card.style.left = x + 'px'; card.style.top = y + 'px';
        };
        const end = () => {
          card.classList.remove('is-moving');
          document.removeEventListener('pointermove', move, true);
          document.removeEventListener('pointerup', end, true);
          document.removeEventListener('pointercancel', end, true);
        };
        document.addEventListener('pointermove', move, true);
        document.addEventListener('pointerup', end, true);
        document.addEventListener('pointercancel', end, true);
      });
    }
    function open(kind, steps, lessonId) {
      if (guide) close();
      if (!steps.length) return;
      const root = document.createElement('div');
      root.className = 'tour-root' + (kind === 'lesson' ? ' tour-root-lesson' : '');
      root.setAttribute('role', 'dialog');
      root.innerHTML = '<div class="tour-spot"></div><div class="tour-card"></div>';
      document.body.appendChild(root);
      document.body.classList.add('lp-guide-active'); // masque les bulles d'aide au survol (voir 12-bulles-d-aide.js)
      if (host.onOpen) host.onOpen();
      track(kind === 'lesson' ? 'lesson_open' : 'tour_open', { lesson: lessonId || undefined, steps: steps.length });
      guide = { root, kind, lessonId, steps, index: 0, maxIndex: 0, ctx: {}, timer: null, advancing: false, clicked: false, cardKey: '', userMoved: false };
      enableCardDrag(root.querySelector('.tour-card'));
      if (steps[0].enter) steps[0].enter(guide.ctx);
      window.addEventListener('resize', render);
      document.addEventListener('keydown', onKeydown, true);
      document.addEventListener('click', onClickCapture, true);
      render();
      if (kind === 'lesson') guide.timer = setInterval(tick, 250);
      else guide.timer = setInterval(() => render(true), 400); // suit la cible si l'écran se redessine
    }

    return { open, close, go, finish, goToNextLesson, stepIsDone, stepTarget, render, tick, state: () => guide, targetVisible, deliverDrop };
  }

  window.LayerPitchGuide = { create, targetVisible, esc };
})();
