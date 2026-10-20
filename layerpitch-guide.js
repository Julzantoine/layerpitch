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
 *   });
 *   G.open('lesson', steps, 'static'); G.state(); G.close(); G.go(1); G.stepIsDone(step); …
 *
 * Vignettes de LIENS et de TEXTE (20/10) : une étape peut porter `drops: [{ kind: 'link' | 'text', label, value }]`. Chaque
 * vignette se glisse (ou s'active au clavier / au clic) vers la zone en surbrillance : champ de saisie -> la valeur y est
 * écrite ; autre zone -> un vrai événement « drop » (text/plain + text/uri-list) lui est envoyé, que la page traite comme
 * un dépôt de lien ou de texte ordinaire. `host.onDrop(step, drop, target)` (facultatif) reprend la main à la place.
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
    let guide = null; // { root, kind, lessonId, steps, index, maxIndex, ctx, timer, advancing, clicked, cardKey, userMoved }


    // ---- Vignettes de liens et de texte ----
    const DROP_GLYPH = { link: '↗', text: '¶' };
    function dropsHtml(step) {
      if (!step.drops || !step.drops.length) return '';
      return step.drops.map((d, i) => `<div class="tour-chip tour-chip-${esc(d.kind)}" data-tour-drop="${i}" role="button" tabindex="0" aria-label="${esc(tr('lessonDropHint'))}"><span class="tour-chip-note">${DROP_GLYPH[d.kind] || '♪'}</span><span class="tour-chip-name">${esc(d.label || d.value)}</span></div>`).join('')
        + `<div class="tour-sample-hint">${esc(tr('lessonDropHint'))}</div>`;
    }
    // Remet la valeur de la vignette à la zone visée (champ de saisie, ou événement « drop » ordinaire).
    function deliverDrop(step, drop, target) {
      if (!target) return false;
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
          const ghost = chip.cloneNode(true);
          ghost.classList.add('tour-chip-ghost');
          ghost.removeAttribute('data-tour-drop');
          document.body.appendChild(ghost);
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
            if (e.type !== 'pointercancel' && pointInTarget(step, e.clientX, e.clientY)) use();
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
      guide = null;
      if (kind === 'tour' && host.onTourDone) host.onTourDone();
      if (host.onClose) host.onClose();
    }
    function onKeydown(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    function onClickCapture(e) {
      if (!guide) return;
      const step = guide.steps[guide.index];
      if (step && (step.clickDone || step.listen) && step.selector && e.target.closest && e.target.closest(step.selector)) guide.clicked = true;
    }
    function stepTarget(step) {
      // Étape d'écoute : une fois « Écouter » cliqué, la surbrillance passe au lecteur qui vient de s'ouvrir (listenTarget),
      // pour montrer qu'on peut s'en servir (pause, tête de lecture).
      if (step.listenTarget && guide && guide.clicked) {
        const el = document.querySelector(step.listenTarget);
        if (el && targetVisible(el)) return el;
      }
      return step.selector ? document.querySelector(step.selector) : null;
    }
    function go(delta) {
      if (!guide) return;
      let next = guide.index + delta;
      // Saute les étapes sans objet (ex. curseur de paramètre quand son feu vert est fermé), dans les deux sens.
      while (next >= 0 && next < guide.steps.length && guide.steps[next].skip && guide.steps[next].skip(guide.ctx)) next += delta;
      if (next < 0) return;
      if (next >= guide.steps.length) { finish(); return; }
      guide.index = next; guide.clicked = false; guide.advancing = false; guide.userMoved = false;
      if (next > guide.maxIndex) guide.maxIndex = next; // étape la plus avancée atteinte : au-delà du « front », on ne fait que revoir
      const step = guide.steps[next];
      if (step.enter) step.enter(guide.ctx);
      render();
    }
    function goToNextLesson() {
      if (!guide) return;
      const nx = host.nextLesson ? host.nextLesson(guide.lessonId) : null;
      finish();
      if (nx && host.startLesson) host.startLesson(nx.lesson.id);
    }
    function finish() {
      if (guide && guide.kind === 'lesson' && host.onLessonDone) host.onLessonDone(guide.lessonId);
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
      // Étape déjà franchie, revue avec « Précédent » : pas d'avance automatique (sinon on ne pourrait jamais reculer).
      if (guide.kind === 'lesson' && !guide.advancing && guide.index >= guide.maxIndex && stepIsDone(step)) {
        guide.advancing = true;
        setTimeout(() => go(1), 450); // laisse voir le résultat du geste avant la bulle suivante
        return;
      }
      render(true);
    }
    function render(positionOnly) {
      if (!guide) return;
      const step = guide.steps[guide.index];
      const target = stepTarget(step);
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
        card.innerHTML = `
      <div class="tour-count"><span>${guide.index + 1} / ${guide.steps.length}</span><span class="tour-grip" title="${esc(tr('lessonMoveHint'))}" aria-hidden="true">⠿</span></div>
      <div class="tour-title">${esc(tr(step.titleKey))}</div>
      <div class="tour-text">${esc(tr(step.textKey, vars))}</div>
      ${extras}
      ${auto || (listening && !guide.clicked && !revisiting) ? `<div class="tour-waiting">${esc(tr('lessonDoIt'))}</div>` : ''}
      ${listening && guide.clicked ? `<div class="tour-waiting">${esc(tr('lessonListening'))}</div>` : ''}
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
          : (listening && !guide.clicked && !revisiting ? ''
            : `<button class="btn btn-small btn-primary" type="button" data-tour="next">${esc(tr(last ? 'tourFinish' : 'tourNext'))}</button>`)}
      </div>`;
        card.querySelector('[data-tour="skip"]').onclick = close;
        const nextBtn = card.querySelector('[data-tour="next"]');
        if (nextBtn) nextBtn.onclick = () => go(1); // absent sur une étape obligatoire
        const prev = card.querySelector('[data-tour="prev"]');
        if (prev) prev.onclick = () => go(-1);
        const nlBtn = card.querySelector('[data-tour="nextlesson"]');
        if (nlBtn) nlBtn.onclick = goToNextLesson;
        wireDrops(card, step);
        if (host.wireCard) host.wireCard(card, step, guide);
      }
      // Flèche indicative (étapes avec `arrow`) : pointe la mesure à viser sur la timeline.
      let arrowEl = guide.root.querySelector('.tour-arrow');
      const ap = step.arrow && visible && host.arrowPoint ? host.arrowPoint(step.arrow.bar) : null;
      if (ap) {
        if (!arrowEl) {
          arrowEl = document.createElement('div');
          arrowEl.className = 'tour-arrow';
          arrowEl.innerHTML = '<span class="tour-arrow-label"></span><span class="tour-arrow-head">▼</span>';
          guide.root.appendChild(arrowEl);
        }
        arrowEl.querySelector('.tour-arrow-label').textContent = tr('lessonArrowLabel', { n: step.arrow.bar });
        arrowEl.style.left = ap.x + 'px';
        arrowEl.style.top = ap.y + 'px';
      } else if (arrowEl) {
        arrowEl.remove();
      }
      const margin = 12;
      if (visible) {
        // Cible hors de l'écran (page longue) : on la fait défiler dans la vue à l'arrivée sur l'étape, sinon la zone en
        // surbrillance reste invisible.
        if (!positionOnly) {
          const b = target.getBoundingClientRect();
          // (certains champs passent sous une barre fixe : la page peut demander de les ramener au centre)
          const underBar = !!(host.centerTarget && host.centerTarget(target, b));
          if (b.bottom > window.innerHeight - 8 || b.top < 8 || underBar) { try { target.scrollIntoView({ block: b.height > window.innerHeight * 0.7 ? 'start' : 'center' }); } catch (e) { /* ancien navigateur */ } }
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
