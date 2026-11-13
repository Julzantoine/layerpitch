// Frise d'édition -- cible finale d'après le schéma papier de Jules-Antoine (2026-09-14) : une piste par
// calque du morceau (dans l'ordre de leur niveau d'intensité) + une piste SFX au-dessus, blocs positionnés
// sur une frise temporelle commune, déplaçables/redimensionnables à la souris comme dans un DAW. Les
// changements d'intensité restent des points sous le capot (fidèle au moteur réel -- les calques tournent
// en permanence, on ne fait qu'un fondu à un instant précis, déjà réglé par le morceau lui-même) : chaque
// bloc de calque est juste la fenêtre entre deux points consécutifs, dérivée à l'affichage -- glisser le
// CORPS d'un bloc de calque déplace donc son point de départ (qui est aussi la fin du bloc précédent, sur
// N'IMPORTE QUELLE piste) ; il n'y a pas de poignée de redimensionnement sur ces blocs, leur fin appartient
// au bloc suivant. Les stingers, eux, ont un vrai IN + OUT/durée (façon cue sheet) : glisser le corps
// déplace le IN, une poignée sur le bord droit redimensionne la durée. En lecture seule pendant
// l'enregistrement (pas d'interaction), éditable une fois arrêté. `events` est mutée en place
// (splice/tri) pour que la référence déjà fermée par les autres gestionnaires (lastEvents) reste à jour.
// Positionne la tête de lecture (ligne verticale) sur la frise, à la position actuelle de la vidéo --
// appelée à chaque nouveau rendu ET en continu pendant la lecture (timeupdate, câblé une seule fois dans
// openCapturePanel plutôt qu'à chaque re-rendu, pour ne pas empiler les écouteurs). Calcule en pixels
// réels (pas en %) à partir de .vct-ruler, qui a toujours le même repère que les pistes (margin-left 96px
// aligné sur les étiquettes) -- fonctionne donc même à travers les groupes imbriqués.
function positionCapturePlayhead(container, videoEl) {
  if (!videoEl) return;
  const ph = container.querySelector('#vctPlayhead');
  const ruler = container.querySelector('.vct-ruler');
  if (!ph || !ruler) return;
  // Repère = le parent de la tête de lecture (.vct-body, qui défile avec le zoom) : les positions en px restent justes même défilé.
  const base = ph.parentElement.getBoundingClientRect();
  const rulerRect = ruler.getBoundingClientRect();
  const total = container.__vctTotal || videoEl.duration || 1;
  const t = videoEl.currentTime || 0;
  const leftPx = (rulerRect.left - base.left) + Math.min(1, Math.max(0, t / total)) * rulerRect.width;
  ph.style.left = leftPx + 'px';
  // Zoomé et en lecture : la vue suit la tête de lecture.
  const scroller = container.querySelector('.vct-scroll');
  if (scroller && !videoEl.paused) {
    const sr = scroller.getBoundingClientRect(), pr = ph.getBoundingClientRect();
    if (pr.left > sr.right - 20 || pr.left < sr.left + (container.__vctLabelW || 96)) scroller.scrollLeft += pr.left - (sr.left + (container.__vctLabelW || 96) + 24);
  }
  // Défilée sous la colonne des noms de pistes (collée à gauche, 96 px) : la tête n'y serait visible que par
  // petits tirets rouges dans les interstices entre pistes -> on la cache tant qu'elle est sous cette colonne.
  if (scroller) {
    const sr2 = scroller.getBoundingClientRect(), pr2 = ph.getBoundingClientRect();
    ph.style.display = (pr2.left < sr2.left + 95 || pr2.left > sr2.right) ? 'none' : '';
  }
}

function renderCaptureTimeline(container, events, editable, onChange, laneOverrides, collapsedGroups, videoEl, markers, laneLayout) {
  laneOverrides = laneOverrides || {};
  markers = markers || [];
  laneLayout = laneLayout || { hidden: [], extra: [] }; // pistes masquées / ajoutées de cette version (migration 20261110040000), modifié sur place comme `markers`
  laneLayout.hidden = laneLayout.hidden || []; laneLayout.extra = laneLayout.extra || [];
  collapsedGroups = collapsedGroups || {};
  // Montage à la souris (05/11, demande de Jules-Antoine) : sans prise, la frise propose déjà chaque morceau en couches ou statique
  // du pack, ses couches en pistes vides : un double-clic sur une couche la fait démarrer là (jusqu'à la fin de la vidéo), on n'est plus
  // obligé de capturer d'abord. Les autres modes (séquentiel, embranchement…) passent toujours par une prise.
  // Pistes proposées à la main : les morceaux du pack (sauf ceux que cette version a masqués) + ceux qu'elle a ajoutés depuis la bibliothèque.
  const handMode = t => t && (t.mode === 'vertical' || t.mode === 'static');
  const handTrackIds = editable ? (capturePackLibrary().library || []).filter(t => handMode(t) && laneLayout.hidden.indexOf(t.id) === -1).map(t => t.id)
    .concat(laneLayout.extra.filter(id => handMode(findCaptureTrack(id)))) : [];
  if (!events.length && !handTrackIds.length) {
    container.innerHTML = `<div class="vct-empty">${tr('captureTimelineEmpty')}</div>`;
    return;
  }
  // En-tête de piste à la Logic (13/11, admin) : colonne des noms redimensionnable (poignée au bord droit), commandes M / S / ⇄ / ✕ toujours visibles,
  // volume facultatif, clic droit pour choisir les commandes. Largeur et choix gardés dans ce navigateur. Hors admin : colonne de 96 px comme avant.
  const adminHdr = !!editable && !!window.__lpCaptureIsAdmin;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage refusé : tant pis */ } } };
  const labelW = adminHdr ? Math.min(420, Math.max(110, container.__vctLabelW || (container.__vctLabelW = store.get('lp.vct.labelW', 170)))) : 96;
  container.__vctLabelW = labelW;
  container.style.setProperty('--vct-label-w', labelW + 'px');
  const comps = Object.assign({ m: true, s: true, replace: true, remove: true, vol: false }, store.get('lp.vct.comps', {}));
  laneLayout.mix = laneLayout.mix || {};
  const mixMap = laneLayout.mix;
  const setMix = (id, patch) => {
    const m = Object.assign({}, mixMap[id], patch);
    if (!m.mute) delete m.mute; if (!m.solo) delete m.solo; if (m.vol == null || m.vol >= 1) delete m.vol;
    if (Object.keys(m).length) mixMap[id] = m; else delete mixMap[id];
  };
  const rerender = () => renderCaptureTimeline(container, events, editable, onChange, laneOverrides, collapsedGroups, videoEl, markers, laneLayout);
  // Toute retouche passe par ici : la frise est redessinée PUIS l'atelier est prévenu (enregistrement automatique, annuler / rétablir,
  // musique à recalculer). Avant le 12/11, les marqueurs (pose, glisser, nom, instant, effacement) et les noms de pistes ne prévenaient
  // pas l'atelier : rien n'était enregistré tant qu'une autre retouche ne passait pas derrière -- d'où des marqueurs « perdus » au hasard.
  // kind 'view' : simple affichage (groupe replié / déplié) -- enregistré avec le montage, mais pas une étape d'annulation.
  const changed = kind => { rerender(); if (onChange) onChange(kind); };
  // Fenêtre de la frise (elle peut être déplacée dans la fenêtre détachée, voir detachCapturePanel) : écouteurs et images y sont posés.
  const ownerDoc = container.ownerDocument || document;
  const ownerWin = ownerDoc.defaultView || window;
  // Calques d'un morceau dont l'intensité suit un curseur (26/09) : recalculés à partir des points du curseur à chaque
  // affichage -- donc après chaque retouche d'un point (glisser, valeur, ajout, suppression).
  if (editable) window.LayerCapturePlan.syncSliderIntensityLayers(events, findCaptureTrack);
  const intensityEvents = events.filter(e => e.name === 'intensity_change').sort((a, b) => a.t - b.t);
  const embrEvents = events.filter(e => e.name === 'embr_loop_select').sort((a, b) => a.t - b.t);
  const stingerEvents = events.filter(e => e.name === 'stinger_play');
  const layerSegmentEvents = events.filter(e => e.name === 'layer_segment');
  const fxSegmentEvents = events.filter(e => e.name === 'fx_segment');
  const lastT = Math.max(0, ...events.map(e => e.t),
    ...stingerEvents.map(e => e.t + (e.detail.durationOverride || 1)),
    ...layerSegmentEvents.map(e => e.t + e.detail.duration),
    ...fxSegmentEvents.map(e => e.t + e.detail.duration));
  const total = Math.max(lastT + 1, 5, ...markers.map(m => m.t + 1), ...(container.__vctReviewMarks || []).map(r => Number(r.t) + 1), (videoEl && Number.isFinite(videoEl.duration)) ? videoEl.duration : 0); // au moins 5s de large à l'écran, + 1s de marge après le dernier événement, et toute la vidéo (05/11 : la tête de lecture doit pouvoir aller partout)
  // Zoom (06/11, demande de Jules-Antoine : caler des départs à l'image près) : la frise est plus large que l'écran, on défile dedans.
  const fullW = Math.max(300, (container.clientWidth || 800) - 20);
  const maxZoom = Math.max(1, 4000 * total / Math.max(200, fullW - labelW));
  const zoom = Math.min(maxZoom, Math.max(1, container.__vctZoom || 1));
  container.__vctZoom = zoom;
  const pxPerSec = (fullW * zoom - labelW) / total;
  const TICK_STEPS = [1 / 30, 1 / 15, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120];
  const tickStep = TICK_STEPS.find(st => st * pxPerSec >= 60) || 120;
  const tickDec = tickStep >= 1 ? 0 : (tickStep < 0.05 ? 2 : (tickStep < 0.1 ? 2 : 1));
  const pct = (t) => Math.min(100, Math.max(0, t / total * 100));

  let ticksHtml = '';
  for (let i = 0; i * tickStep <= total + 1e-9; i++) {
    const t = i * tickStep;
    ticksHtml += `<div class="vct-tick" style="left:${pct(t)}%">${t.toFixed(tickDec)}s</div>`;
  }

  // Tous les événements qui appartiennent à un groupe donné (même morceau ou même Sfx) -- utilisé à la
  // fois pour calculer l'étendue du bloc-résumé ci-dessous et pour savoir quoi déplacer ensemble au
  // glisser-déposer du groupe entier (voir startGroupDrag plus bas).
  function groupMembers(key) {
    if (key.indexOf('track:') === 0) {
      const trackId = key.slice(6);
      // Repères de capture compris (générations, arrêts, bascules réelles) : ils suivent le morceau quand on le déplace.
      return events.filter(e => (e.name === 'intensity_change' || e.name === 'embr_loop_select' || e.name === 'layer_segment' || e.name === 'fx_segment' || e.name === 'fx_cut' || e.name === 'fx_slider' || SEQ_TIMELINE_EVENT_NAMES.indexOf(e.name) !== -1 || VR_TIMELINE_EVENT_NAMES.indexOf(e.name) !== -1 || CAPTURE_MARK_NAMES.indexOf(e.name) !== -1 || e.name === 'voice_mute_toggle' || e.name === 'voice_solo_toggle' || e.name === 'voice_volume_change') && e.detail.trackId === trackId);
    }
    if (key === 'head:') return events.filter(e => e.name === 'head_turn');
    if (key.indexOf('sfx:') === 0) {
      const sfxId = key.slice(4);
      return events.filter(e => e.name === 'stinger_play' && e.detail.sfxId === sfxId);
    }
    return [];
  }

  // Un groupe = un en-tête cliquable (repliable) + un bloc-résumé glissable (déplace TOUS les enfants
  // ensemble, en préservant leur espacement relatif -- demandé par Jules-Antoine 2026-09-15) + les pistes
  // enfants indentées en dessous, même gabarit pour les morceaux (calques ou boucles) et les Sfx
  // (variations round-robin) -- voir les usages ci-dessous.
  // Nom du groupe ET bloc-résumé glissable sur UNE SEULE ligne (2026-09-16, retour direct de
  // Jules-Antoine : "la section parente doit être sur la même ligne que le bloc général", même principe
  // que l'affichage d'un track stack dans Logic Pro X -- le nom + le résumé replié restent visibles sur
  // une seule rangée, jamais deux lignes empilées). L'étiquette (nom + chevron) occupe la même colonne
  // que .vct-lane-label des autres pistes (96px), le bloc-résumé la même colonne que .vct-lane-track --
  // cette ligne reste donc visible même repliée (c'est justement le principe d'un résumé replié),
  // seules les pistes enfants (nestedLanesHtml) disparaissent alors.
  // « ✕ » sur le nom d'un morceau (10/11) : retire la piste de CETTE version (ses blocs aussi, après confirmation).
  const escH = x => window.LayerPlayerCore.escapeHtml(x);
  const removeTrackBtn = key => {
    const isSfx = key.indexOf('sfx:') === 0;
    if (!(editable && (key.indexOf('track:') === 0 || (isSfx && adminHdr)))) return '';
    const id = isSfx ? key : key.slice(6); // un Sfx garde son préfixe « sfx: » : c'est sa clé de mix et de retrait (13/11)
    if (!adminHdr) return `<button type="button" class="vct-track-remove" data-remove-track="${escH(id)}" title="${escH(tr('captureTrackRemoveTitle'))}" aria-label="${escH(tr('captureTrackRemoveTitle'))}">✕</button>`;
    const m = mixMap[id] || {};
    const b = (cls, attr, label, title, on) => `<button type="button" class="vct-cbtn ${cls}${on ? ' on' : ''}" ${attr}="${escH(id)}" title="${escH(title)}" aria-label="${escH(title)}" aria-pressed="${on ? 'true' : 'false'}">${label}</button>`;
    return `<span class="vct-ctl">`
      + (comps.m ? b('vct-cm', 'data-mix-m', 'M', tr('captureMixMute'), !!m.mute) : '')
      + (comps.s ? b('vct-cs', 'data-mix-s', 'S', tr('captureMixSolo'), !!m.solo) : '')
      + (comps.vol ? `<input type="range" class="vct-vol" data-mix-v="${escH(id)}" min="0" max="100" value="${Math.round((m.vol == null ? 1 : m.vol) * 100)}" title="${escH(tr('captureMixVolume'))}" aria-label="${escH(tr('captureMixVolume'))}">` : '')
      + (comps.replace && window.LayerCaptureRetarget ? `<button type="button" class="vct-cbtn" data-replace-track="${escH(id)}" title="${escH(tr('captureTrackReplaceTitle'))}" aria-label="${escH(tr('captureTrackReplaceTitle'))}">⇄</button>` : '')
      + (comps.remove ? `<button type="button" class="vct-cbtn vct-cx" data-remove-track="${escH(id)}" title="${escH(tr('captureTrackRemoveTitle'))}" aria-label="${escH(tr('captureTrackRemoveTitle'))}">✕</button>` : '')
      + `</span>`;
  };
  const nameHtml = label => adminHdr ? `<span class="vct-lane-name">${escH(label)}</span>` : escH(label);
  function renderGroup(key, headerLabel, colorClass, nestedLanesHtml) {
    // Morceau sans couches (une seule piste, 06/11, demande de Jules-Antoine) : l'en-tête et la piste disaient la même chose sur deux lignes.
    // On ne garde que la piste, étiquetée du nom du morceau (plus de repli possible : il n'y a rien à replier).
    if (key.indexOf('track:') === 0 && (nestedLanesHtml.match(/vct-lane-nested/g) || []).length === 1) {
      const solo = nestedLanesHtml.replace(/<div class="vct-lane-label"[^>]*>[\s\S]*?<\/div>/, `<div class="vct-lane-label vct-lane-label-solo" data-hdr-key="${escH(key)}" title="${window.LayerPlayerCore.escapeHtml(headerLabel)}">${nameHtml(headerLabel)}${removeTrackBtn(key)}</div>`);
      return `<div class="vct-track-group ${colorClass}">` + solo + `</div>`;
    }
    const collapsed = !!collapsedGroups[key];
    const members = groupMembers(key);
    let blockHtml = '';
    // 12/11 (demande de Jules-Antoine) : dépliée, la ligne de titre n'affiche rien (elle ressemblait à une piste où déposer de la musique) ;
    // repliée, elle montre une barre qui reprend les placements des couches (lus dans les blocs des pistes enfants, à l'identique).
    if (editable && members.length && collapsed) {
      const segs = [];
      (nestedLanesHtml.match(/<div class="vct-block[^>]*>/g) || []).forEach(tag => {
        const l = /left:([\d.]+)%/.exec(tag), w = /width:([\d.]+)%/.exec(tag);
        if (l && w) segs.push([parseFloat(l[1]), parseFloat(w[1])]);
      });
      let start = Math.min(...members.map(m => m.t)), end = Math.max(...members.map(m => m.t + (m.name === 'head_turn' ? 0.5 : (m.detail.durationOverride || 1))));
      let left = pct(start), width = pct(end) - pct(start);
      let inner = '';
      if (segs.length) {
        left = Math.min(...segs.map(g => g[0]));
        width = Math.max(...segs.map(g => g[0] + g[1])) - left;
        inner = segs.map(g => `<span class="vct-group-seg" style="left:${width > 0 ? ((g[0] - left) / width * 100) : 0}%;width:${width > 0 ? (g[1] / width * 100) : 100}%"></span>`).join('');
      }
      blockHtml = `<div class="vct-block vct-block-group" data-group-key="${window.LayerPlayerCore.escapeHtml(key)}" ` +
        `title="${tr('captureGroupDragHint')}" style="left:${left}%;width:${width}%">${inner}</div>`;
    }
    const headerRow = `<div class="vct-lane vct-group-summary">` +
      `<div class="vct-lane-label vct-track-group-header" data-group-key="${window.LayerPlayerCore.escapeHtml(key)}">` +
      `<span class="vct-group-chevron">${collapsed ? '▸' : '▾'}</span>${nameHtml(headerLabel)}${removeTrackBtn(key)}</div>` +
      `<div class="vct-lane-track">${blockHtml}</div></div>`;
    return `<div class="vct-track-group ${colorClass}">` + headerRow + (collapsed ? '' : nestedLanesHtml) + `</div>`;
  }

  // SFX : un groupe par son déclenché, une piste enfant par variation round-robin réellement tirée dans
  // cette prise (pas toutes celles de la bibliothèque -- sinon un Sfx à 6 variations dont une seule sert
  // laisserait 5 pistes vides). Plusieurs sons différents déclenchés dans la même prise donnent donc
  // plusieurs groupes SFX côte à côte (2026-09-15).
  const sfxGroups = {}; // sfxId -> { variationIndex: [events] }
  stingerEvents.forEach(e => {
    const sid = e.detail.sfxId;
    const vi = e.detail.variationIndex;
    (sfxGroups[sid] = sfxGroups[sid] || {})[vi] = (sfxGroups[sid][vi] || []).concat(e);
  });
  // Sfx des morceaux de la prise jamais déclenchés pendant celle-ci (05/11, demande de Jules-Antoine : poser les gestes dans la frise
  // plutôt qu'en direct) : une piste vide « RR1 » par Sfx, pour pouvoir l'ajouter au double-clic.
  if (editable) {
    [...new Set(events.map(e => e.detail && e.detail.trackId).filter(Boolean).concat(handTrackIds))].forEach(tId => {
      const trk = findCaptureTrack(tId);
      ((trk && trk.sfxIds) || []).forEach(sid => { if (!sfxGroups[sid] && findCaptureSfx(sid)) sfxGroups[sid] = { 0: [] }; });
    });
    // Et les Sfx rattachés au pack lui-même (05/11, pack « Joris » : 3 Sfx au pack, aucun sur ses morceaux -> frise sans Sfx).
    (capturePackLibrary().sfxLibrary || []).forEach(s => { if (!sfxGroups[s.id]) sfxGroups[s.id] = { 0: [] }; });
    // Sfx retirés de cette version (✕ sur sa ligne, 13/11) : ils ne reviennent pas en piste vide.
    Object.keys(sfxGroups).forEach(sid => { if (laneLayout.hidden.indexOf('sfx:' + sid) >= 0 && !stingerEvents.some(e => e.detail.sfxId === sid)) delete sfxGroups[sid]; });
  }
  let lanesHtml = '';
  // Même ordre fixe pour les Sfx : celui de la bibliothèque du pack, qu'ils soient joués ou non.
  const sfxOrder = (capturePackLibrary().sfxLibrary || []).map(x => x.id);
  const sfxRank = id => { const i = sfxOrder.indexOf(id); return i < 0 ? 1e6 : i; };
  Object.keys(sfxGroups).sort((x, y) => sfxRank(x) - sfxRank(y)).forEach(sid => {
    const sfx = findCaptureSfx(sid);
    let groupLanesHtml = '';
    Object.keys(sfxGroups[sid]).map(Number).sort((a, b) => a - b).forEach(vi => {
      let blocksHtml = '';
      sfxGroups[sid][vi].forEach(e => {
        const dur = e.detail.durationOverride || 1;
        const idx = events.indexOf(e);
        blocksHtml += `<div class="vct-block vct-sfx" data-idx="${idx}" style="left:${pct(e.t)}%;width:${pct(e.t + dur) - pct(e.t)}%">` +
          (editable ? `<div class="vct-resize-handle" title="${tr('captureResizeHint')}"></div>` : '') + `</div>`;
      });
      const sfxAddAttrs = editable ? ` data-addable="sfx" data-add-sfx-id="${sid}" data-add-variation="${vi}"` : '';
      groupLanesHtml += `<div class="vct-lane vct-lane-nested"><div class="vct-lane-label">RR${vi + 1}</div><div class="vct-lane-track"${sfxAddAttrs} title="${editable ? tr('captureAddSfxHint') : ''}">${blocksHtml}</div></div>`;
    });
    lanesHtml += renderGroup('sfx:' + sid, (sfx && sfx.title) || sid, 'vct-track-group-sfx', groupLanesHtml);
  });

  // Musique : un groupe par morceau référencé (mode vertical -- calques cumulatifs -- ou
  // embranchement-vertical -- boucles exclusives), dans l'ordre de première apparition. Plusieurs
  // morceaux différents dans la même prise donnent plusieurs groupes "Musique" côte à côte (schéma
  // papier "Musique #1"/"Musique #2", 2026-09-14/15).
  const musicTrackIds = [];
  events.forEach(e => {
    if ((e.name === 'intensity_change' || e.name === 'embr_loop_select' || e.name === 'layer_segment' || e.name === 'fx_segment' || e.name === 'fx_cut' || e.name === 'fx_slider' || e.name === 'track_play' || SEQ_TIMELINE_EVENT_NAMES.indexOf(e.name) !== -1 || VR_TIMELINE_EVENT_NAMES.indexOf(e.name) !== -1) && musicTrackIds.indexOf(e.detail.trackId) === -1) {
      musicTrackIds.push(e.detail.trackId);
    }
  });
  handTrackIds.forEach(id => { if (musicTrackIds.indexOf(id) === -1) musicTrackIds.push(id); });
  // Ordre FIXE (10/11, retour de Jules-Antoine : « les pistes jouées remontent dans la frise, on ne distingue plus les différences à l'œil ») :
  // les morceaux gardent l'ordre du pack (celui de la colonne de droite), jouée ou pas, d'une version alternative à l'autre ; ceux qui n'y
  // figurent pas restent à la fin, dans leur ordre d'apparition.
  { const packOrder = (capturePackLibrary().library || []).map(t => t.id);
    const rank = id => { const i = packOrder.indexOf(id); return i < 0 ? 1e6 : i; };
    musicTrackIds.sort((x, y) => rank(x) - rank(y)); } // tri stable : à rang égal, l'ordre d'apparition est conservé
  musicTrackIds.forEach(trackId => {
    const track = findCaptureTrack(trackId);
    if (!track) return;
    let nestedLanesHtml = '';
    if (track.mode === 'embranchement-vertical') {
      // Une seule boucle audible à la fois (contrairement à l'empilage cumulatif du mode vertical) --
      // chaque bascule embr_loop_select ferme la fenêtre précédente et en ouvre une nouvelle. La toute
      // première fenêtre (la boucle de référence, avant le premier clic) n'a aucun événement associé --
      // rien n'est capturé pour l'état de départ implicite du moteur -- donc pas de point à éditer/glisser
      // pour elle (idx -1, bloc non interactif, distingué visuellement).
      // Fenêtres communes avec le rendu (capture-plan.js) : la référence joue depuis le démarrage du morceau.
      const windows = window.LayerCapturePlan.buildEmbrTimelineWindows(events, track, total).map(w => Object.assign(w, { idx: w.e ? events.indexOf(w.e) : -1 }));
      const usedLoopIds = [];
      windows.forEach(w => { if (usedLoopIds.indexOf(w.loopId) === -1) usedLoopIds.push(w.loopId); });
      usedLoopIds.forEach(loopId => {
        let blocksHtml = '';
        windows.forEach(w => {
          if (w.loopId !== loopId) return;
          const cls = 'vct-block vct-layer' + (w.idx < 0 ? ' vct-block-implicit' : '');
          blocksHtml += `<div class="${cls}" data-idx="${w.idx}" style="left:${pct(w.start)}%;width:${pct(w.end) - pct(w.start)}%"></div>`;
        });
        const laneLabel = captureLoopLaneLabel(track, loopId, laneOverrides);
        const loopAddAttrs = editable ? ` data-addable="loop" data-add-track-id="${trackId}" data-add-loop-id="${loopId}"` : '';
        nestedLanesHtml += `<div class="vct-lane vct-lane-nested"><div class="vct-lane-label" data-lane-kind="loop" data-track-id="${trackId}" data-loop-id="${loopId}" title="${editable ? tr('captureRenameHint') : ''}">${window.LayerPlayerCore.escapeHtml(laneLabel)}</div><div class="vct-lane-track"${loopAddAttrs} title="${editable ? tr('captureAddLoopHint') : ''}">${blocksHtml}</div></div>`;
      });
    } else if (track.mode === 'vertical-random') {
      // Une seule piste "Section" (2026-09-16), volontairement pas détaillée par pool (demande explicite de
      // Jules-Antoine : "dans l'éditeur, on ne détaille pas le contenu du pool") -- mais chaque bloc
      // correspond maintenant à un vrai cycle capturé (vr_intro_start/vr_section_start/vr_outro_start, voir
      // buildVRTimelineWindows), déplaçable comme les autres blocs chaînés, avec ses tirages de pool réels
      // conservés dans l'événement pour un export fidèle -- plus le simple repère "ce morceau jouait ici"
      // d'avant, qui ne portait aucune donnée exportable.
      const vrWindows = buildVRTimelineWindows(events, trackId, total);
      let blocksHtml = '';
      if (vrWindows.length) {
        vrWindows.forEach(w => {
          blocksHtml += `<div class="vct-block vct-layer" data-idx="${w.idx}" style="left:${pct(w.start)}%;width:${pct(w.end) - pct(w.start)}%"></div>`;
        });
      } else {
        // Repli (capture très courte, arrêtée avant le premier cycle réel) : simple repère non interactif,
        // comme le comportement d'origine.
        const trackPlayEvents = events.filter(e => e.name === 'track_play' && e.detail.trackId === trackId).sort((a, b) => a.t - b.t);
        trackPlayEvents.forEach((e, i) => {
          const end = i + 1 < trackPlayEvents.length ? trackPlayEvents[i + 1].t : total;
          blocksHtml += `<div class="vct-block vct-layer vct-block-implicit" data-idx="-1" style="left:${pct(e.t)}%;width:${pct(end) - pct(e.t)}%"></div>`;
        });
      }
      nestedLanesHtml += `<div class="vct-lane vct-lane-nested"><div class="vct-lane-label">Section</div><div class="vct-lane-track">${blocksHtml}</div></div>`;
    } else if (track.mode === 'sequential') {
      // Une seule variation audible à la fois -- chaque événement (emplacement, transition, intro, outro)
      // ferme la fenêtre précédente et en ouvre une nouvelle, exactement comme pour les boucles. Les
      // transitions ont leur propre piste (une par embranchement source->cible distinct, comme les
      // emplacements) ; intro/outro sont des pistes uniques puisqu'un morceau n'en a qu'une de chaque.
      // Seuls les emplacements restent renommables/ajoutables au clic (intro/outro/transitions sont des
      // fichiers "cachets" du morceau lui-même, pas des passages composés pour cette prise -- 2026-09-16).
      const windows = buildSeqTimelineWindows(events, trackId, total);
      const laneKeys = [];
      windows.forEach(w => { if (laneKeys.indexOf(w.laneKey) === -1) laneKeys.push(w.laneKey); });
      laneKeys.forEach(laneKey => {
        const first = windows.find(w => w.laneKey === laneKey);
        let blocksHtml = '';
        windows.forEach(w => {
          if (w.laneKey !== laneKey) return;
          blocksHtml += `<div class="vct-block vct-layer" data-idx="${w.idx}" style="left:${pct(w.start)}%;width:${pct(w.end) - pct(w.start)}%"></div>`;
        });
        const laneLabel = captureSeqWindowLabel(track, first, laneOverrides);
        const renameAttrs = first.kind === 'slot' ? ` data-lane-kind="slot" data-track-id="${trackId}" data-slot-id="${first.slotId}" title="${editable ? tr('captureRenameHint') : ''}"` : '';
        const addAttrs = first.kind === 'slot' && editable ? ` data-addable="slot" data-add-track-id="${trackId}" data-add-slot-id="${first.slotId}"` : '';
        nestedLanesHtml += `<div class="vct-lane vct-lane-nested"><div class="vct-lane-label"${renameAttrs}>${window.LayerPlayerCore.escapeHtml(laneLabel)}</div><div class="vct-lane-track"${addAttrs} title="${editable && first.kind === 'slot' ? tr('captureAddSlotHint') : ''}">${blocksHtml}</div></div>`;
      });
    } else {
      const trackLayerEvents = events.filter(e => e.name === 'layer_segment' && e.detail.trackId === trackId);
      const layers = track.layers || [];
      if (trackLayerEvents.length || handTrackIds.indexOf(trackId) !== -1) {
        // Calques indépendants (matérialisés une fois pour toutes à l'arrêt de la capture par
        // materializeLayerSegments -- voir ce commentaire pour le raisonnement) : chaque layer_segment a
        // son propre début + durée, comme un stinger, sans lien avec les autres calques ni avec un
        // quelconque "niveau". Se déplace/se redimensionne seul (voir startDrag), sans jamais bouger un
        // autre bloc.
        // Intensité pilotée par un curseur : blocs déduits de ses points (voir syncSliderIntensityLayers), donc non
        // déplaçables ici -- on retouche le curseur, pas les calques.
        const intensitySl = window.LayerCapturePlan.intensitySliderOf(track);
        const layerEditable = editable && !intensitySl;
        const lockedTitle = intensitySl ? tr('captureLayerFollowsSlider').replace('{label}', intensitySl.label || tr('fxSliderFallbackLabel').replace('{n}', 1)) : '';
        layers.forEach((layer, levelIdx) => {
          let blocksHtml = '';
          trackLayerEvents.filter(e => e.detail.layerIndex === levelIdx).forEach(e => {
            const idx = layerEditable ? events.indexOf(e) : -1;
            const end = e.t + e.detail.duration;
            blocksHtml += `<div class="vct-block vct-layer" data-idx="${idx}" style="left:${pct(e.t)}%;width:${pct(end) - pct(e.t)}%${intensitySl ? ';cursor:default' : ''}"${intensitySl ? ` title="${window.LayerPlayerCore.escapeHtml(lockedTitle)}"` : ''}>` +
              (layerEditable ? `<div class="vct-resize-handle" title="${tr('captureResizeHint')}"></div>` : '') + `</div>`;
          });
          const laneLabel = captureLaneLabel(track, levelIdx, laneOverrides);
          const addAttrs = layerEditable ? ` data-addable="layer" data-add-track-id="${trackId}" data-add-level="${levelIdx}"` : '';
          nestedLanesHtml += `<div class="vct-lane vct-lane-nested"><div class="vct-lane-label" data-lane-kind="layer" data-track-id="${trackId}" data-level="${levelIdx}" title="${editable ? tr('captureRenameHint') : ''}">${window.LayerPlayerCore.escapeHtml(laneLabel)}</div><div class="vct-lane-track"${addAttrs} title="${layerEditable ? tr('captureAddLayerHint') : lockedTitle}">${blocksHtml}</div></div>`;
        });
      } else {
        // Pas encore matérialisé : aperçu en direct pendant l'enregistrement (toujours en lecture seule,
        // `editable` est déjà à false à ce stade) -- calcul par empilage cumulatif à partir des points
        // intensity_change bruts, avant leur conversion en segments indépendants à l'arrêt.
        const trackIntensityEvents = intensityEvents.filter(e => e.detail.trackId === trackId);
        const cumulative = window.LayerPlayerCore.cumulativeProfiles(layers.length);
        layers.forEach((layer, levelIdx) => {
          let blocksHtml = '';
          trackIntensityEvents.forEach((e, i) => {
            const profile = cumulative[e.detail.level] || cumulative[0];
            if (!profile || !profile[levelIdx]) return;
            const end = i + 1 < trackIntensityEvents.length ? trackIntensityEvents[i + 1].t : total;
            const idx = events.indexOf(e);
            blocksHtml += `<div class="vct-block vct-layer" data-idx="${idx}" style="left:${pct(e.t)}%;width:${pct(end) - pct(e.t)}%"></div>`;
          });
          const laneLabel = captureLaneLabel(track, levelIdx, laneOverrides);
          nestedLanesHtml += `<div class="vct-lane vct-lane-nested"><div class="vct-lane-label" data-lane-kind="layer" data-track-id="${trackId}" data-level="${levelIdx}">${window.LayerPlayerCore.escapeHtml(laneLabel)}</div><div class="vct-lane-track">${blocksHtml}</div></div>`;
        });
      }
    }
    // Effets déclenchables par bouton (23/09) : une piste par trigger défini sur le morceau, blocs = les
    // moments où le bouton était enfoncé (fx_segment) -- déplaçables, redimensionnables, ajoutables au clic,
    // comme les segments de calque. Rejoués à l'export par le moteur du lecteur (capture-render.js).
    (track.fxTriggers || []).filter(d => d && d.id && d.fx).forEach((d, di) => {
      let blocksHtml = '';
      events.filter(e => e.name === 'fx_segment' && e.detail.trackId === trackId && e.detail.triggerId === d.id).forEach(e => {
        const idx = events.indexOf(e);
        blocksHtml += `<div class="vct-block vct-fx" data-idx="${idx}" style="left:${pct(e.t)}%;width:${pct(e.t + e.detail.duration) - pct(e.t)}%">` +
          (editable ? `<div class="vct-resize-handle" title="${tr('captureResizeHint')}"></div>` : '') + `</div>`;
      });
      // Coupures faites par le visiteur sur un trigger activé par cascade : simple repère déplaçable.
      events.filter(e => e.name === 'fx_cut' && e.detail.trackId === trackId && e.detail.triggerId === d.id).forEach(e => {
        const idx = events.indexOf(e);
        blocksHtml += `<div class="vct-block vct-fx vct-fx-cut" data-idx="${idx}" style="left:${pct(e.t)}%;width:${pct(e.t + 0.4) - pct(e.t)}%" title="${window.LayerPlayerCore.escapeHtml(describeCaptureEvent(e, laneOverrides))}"></div>`;
      });
      const addAttrs = editable ? ` data-addable="fxseg" data-add-track-id="${trackId}" data-add-trigger-id="${window.LayerPlayerCore.escapeHtml(d.id)}"` : '';
      nestedLanesHtml += `<div class="vct-lane vct-lane-nested"><div class="vct-lane-label" title="${window.LayerPlayerCore.escapeHtml(d.label || '')}">${window.LayerPlayerCore.escapeHtml(tr('captureFxLaneLabel').replace('{label}', d.label || tr('fxTriggerFallbackLabel').replace('{n}', di + 1)))}</div><div class="vct-lane-track"${addAttrs} title="${editable ? tr('captureAddFxHint') : ''}">${blocksHtml}</div></div>`;
    });
    // Curseurs de paramètre (24/09) : une piste par curseur, un point-clé par valeur enregistrée (déplaçable, valeur
    // éditable dans le détail, ajout d'un clic). Rejoués à l'export par le moteur du lecteur.
    window.LayerPlayerCore.fxSlidersValid(track).forEach((sl, sliderIdx) => {
      let blocksHtml = '';
      events.filter(e => e.name === 'fx_slider' && e.detail.trackId === trackId && e.detail.sliderId === sl.id).forEach(e => {
        const idx = events.indexOf(e);
        blocksHtml += `<div class="vct-block vct-slider" data-idx="${idx}" style="left:${pct(e.t)}%;width:${pct(e.t + 0.5) - pct(e.t)}%" title="${Math.round(e.detail.value * 100)}%"><span class="vct-block-label">${Math.round(e.detail.value * 100)}%</span></div>`;
      });
      const addAttrs = editable ? ` data-addable="fxslider" data-add-track-id="${trackId}" data-add-slider-id="${window.LayerPlayerCore.escapeHtml(sl.id)}"` : '';
      nestedLanesHtml += `<div class="vct-lane vct-lane-nested"><div class="vct-lane-label" title="${window.LayerPlayerCore.escapeHtml(sl.label || '')}">${window.LayerPlayerCore.escapeHtml(tr('captureSliderLaneLabel').replace('{label}', sl.label || tr('fxSliderFallbackLabel').replace('{n}', sliderIdx + 1)))}</div><div class="vct-lane-track"${addAttrs} title="${editable ? tr('captureAddSliderHint') : ''}">${blocksHtml}</div></div>`;
    });
    // Arrêts (05/11, fondu à l'arrêt) : chaque arrêt du morceau, avec son fondu dessiné en pente -- un clic ouvre le détail pour régler
    // la durée du fondu. Ni déplaçable ni supprimable ici : la fin des blocs, elle, se règle sur les blocs eux-mêmes.
    const trackStops = events.filter(e => e.name === 'voices_stop' && e.detail.trackId === trackId && !e.detail.scope);
    if (trackStops.length) {
      let blocksHtml = '';
      trackStops.forEach(e => {
        const fade = e.detail.fadeSec > 0 ? e.detail.fadeSec : 0;
        const label = fade ? tr('captureStopFadeShort').replace('{s}', String(Math.round(fade * 10) / 10)) : '';
        blocksHtml += `<div class="vct-block vct-stop${fade ? ' vct-stop-fade' : ''}" data-idx="${events.indexOf(e)}" style="left:${pct(e.t)}%;width:${pct(e.t + Math.max(fade, 0.3)) - pct(e.t)}%" title="${window.LayerPlayerCore.escapeHtml(tr('captureStopBlockTitle'))}">${label ? `<span class="vct-block-label">${label}</span>` : ''}${editable ? `<span class="vct-fade-handle" title="${window.LayerPlayerCore.escapeHtml(tr('captureFadeHandleTitle'))}"></span>` : ''}</div>`;
      });
      nestedLanesHtml += `<div class="vct-lane vct-lane-nested"><div class="vct-lane-label">${tr('captureStopLane')}</div><div class="vct-lane-track">${blocksHtml}</div></div>`;
    }
    // Regroupe les pistes sous le nom du morceau qui les possède (2026-09-15) -- le titre lui-même n'est
    // pas éditable ici, c'est le vrai nom du morceau, pas un libellé de prise.
    lanesHtml += renderGroup('track:' + trackId, track.title || 'Morceau', 'vct-track-group-music', nestedLanesHtml);
  });

  // Auditeur (23/09) : les gestes de "tourner la tête" enregistrés pendant la prise, en points-clés (chaque
  // point = l'orientation à cet instant, en degrés, éditable dans le détail) -- affiché dès qu'il y en a, ou
  // dès qu'un Sfx spatialisé joue (pour pouvoir en ajouter un au clic).
  const headEvents = events.filter(e => e.name === 'head_turn');
  const hasSpatialSfx = stingerEvents.some(e => { const sf = findCaptureSfx(e.detail.sfxId); return !!(sf && sf.spatial && sf.spatial.enabled); });
  if (headEvents.length || hasSpatialSfx) {
    let blocksHtml = '';
    headEvents.forEach(e => {
      const idx = events.indexOf(e);
      blocksHtml += `<div class="vct-block vct-head" data-idx="${idx}" style="left:${pct(e.t)}%;width:${pct(e.t + 0.5) - pct(e.t)}%" title="${Math.round(e.detail.yaw)}°"><span class="vct-block-label">${Math.round(e.detail.yaw)}°</span></div>`;
    });
    const addAttrs = editable ? ` data-addable="head"` : '';
    const headLane = `<div class="vct-lane vct-lane-nested"><div class="vct-lane-label">${tr('captureHeadLane')}</div><div class="vct-lane-track"${addAttrs} title="${editable ? tr('captureAddHeadHint') : ''}">${blocksHtml}</div></div>`;
    lanesHtml += renderGroup('head:', tr('captureHeadGroup'), 'vct-track-group-head', headLane);
  }

  // Marqueurs (05/11, demande de Jules-Antoine) : repères nommés posés sur la frise -- double-clic sur la règle des temps ou clic droit
  // n'importe où dans la frise. Une ligne verticale à travers toutes les pistes + un fanion avec le nom sur la règle. Ils ne jouent
  // rien et ne sortent pas dans la vidéo : `markers` est un tableau à part ({ id, t, label }, muté en place comme `events`),
  // enregistré avec le montage dans sa propre colonne (migration 20261105010000). Calque aligné sur la règle (.vct-markers, même
  // marge de 96px que .vct-ruler, dans le même .vct-body), donc positions en % comme les blocs.
  let markersHtml = '';
  markers.forEach((m, i) => {
    const label = window.LayerPlayerCore.escapeHtml(m.label || '');
    markersHtml += `<div class="vct-marker${container.__vctSelectedMarker === m.id ? ' vct-marker-selected' : ''}" style="left:${pct(m.t)}%">` +
      `<span class="vct-marker-flag" data-marker-idx="${i}" title="${label} — ${m.t.toFixed(2)} s${editable ? ' · ' + tr('captureMarkerFlagHint') : ''}">${label}</span></div>`;
  });

  // Remarques du client (9/11, lien de relecture) : un petit drapeau bleu en bas de la frise par commentaire, à son instant. Posés par
  // le panneau Versioning (container.__vctReviewMarks = [{ id, t, author, body, versionTitle, resolved }]), jamais enregistrés avec le
  // montage ni mêlés à `markers` ; cliquer saute la vidéo à l'instant et affiche la remarque dans la zone de détail.
  (container.__vctReviewMarks || []).forEach((r, i) => {
    const who = window.LayerPlayerCore.escapeHtml(r.author || '');
    markersHtml += `<div class="vct-review-marker${r.resolved ? ' vct-review-resolved' : ''}" style="left:${pct(Number(r.t))}%">` +
      `<span class="vct-review-flag" data-review-idx="${i}" title="${who} — ${Number(r.t).toFixed(2)} s">💬 ${who}</span></div>`;
  });

  container.__vctTotal = total;
  const prevScroller = container.querySelector('.vct-scroll');
  const keepScroll = prevScroller ? prevScroller.scrollLeft : 0;
  // La barre de zoom reste en place d'un affichage à l'autre (07/11) : le curseur peut ainsi être glissé pendant que la frise se redessine.
  const zoomLabel = '×' + (zoom < 10 ? zoom.toFixed(1).replace(/\.0$/, '') : Math.round(zoom));
  let zoomBar = container.querySelector(':scope > .vct-zoombar');
  if (!zoomBar) {
    container.innerHTML = `
    <div class="vct-zoombar">
      <button type="button" class="vct-zoom-btn" data-zoom="out" title="${tr('captureZoomOut')}" aria-label="${tr('captureZoomOut')}">−</button>
      <input type="range" class="vct-zoom-slider" min="0" max="100" step="0.5" value="0" title="${tr('captureZoomHint')}" aria-label="${tr('captureZoomHint')}">
      <button type="button" class="vct-zoom-btn" data-zoom="in" title="${tr('captureZoomIn')}" aria-label="${tr('captureZoomIn')}">+</button>
      <span class="vct-zoom-val"></span>
      <button type="button" class="vct-zoom-btn vct-zoom-fit" data-zoom="fit" title="${tr('captureZoomFit')}">${tr('captureZoomFit')}</button>
      <button type="button" class="vct-zoom-btn vct-add-track" data-add-track title="${tr('captureTrackAddTitle')}">${tr('captureTrackAddBtn')}</button>
    </div>`;
    zoomBar = container.querySelector(':scope > .vct-zoombar');
    zoomBar.querySelectorAll('.vct-zoom-btn[data-zoom]').forEach(btn => btn.addEventListener('click', () => container.__vctZoomCmd && container.__vctZoomCmd(btn.dataset.zoom)));
    zoomBar.querySelector('[data-add-track]').addEventListener('click', () => container.__vctAddTrack && container.__vctAddTrack());
    zoomBar.querySelector('.vct-zoom-slider').addEventListener('input', ev => container.__vctZoomCmd && container.__vctZoomCmd('slider', Number(ev.target.value)));
  }
  zoomBar.querySelector('.vct-zoom-val').textContent = zoomLabel;
  zoomBar.querySelector('[data-add-track]').hidden = !editable; // seulement hors prise en direct
  container.__vctAddTrack = () => openAddTrackDialog();
  zoomBar.querySelector('.vct-zoom-slider').value = maxZoom > 1 ? Math.round(Math.log(zoom) / Math.log(maxZoom) * 200) / 2 : 0;
  [...container.children].forEach(c => { if (c !== zoomBar) c.remove(); });
  container.insertAdjacentHTML('beforeend', `
    <div class="vct-scroll">
    <div class="vct-body" style="width:${(zoom * 100).toFixed(3)}%">
    <div class="vct-ruler-corner"></div>
    <div class="vct-ruler">${ticksHtml}</div>
    <div class="vct-lanes">${lanesHtml}</div>
    <div class="vct-markers">${markersHtml}</div>
    <div class="vct-snap-guide" id="vctSnapGuide"></div>
    <div class="vct-playhead" id="vctPlayhead"></div>
    </div>
    </div>
    <div class="vct-detail" id="vctDetail"><span class="vct-detail-empty">${editable ? tr('captureTimelineHint') : ''}</span></div>
  `);
  const scroller = container.querySelector('.vct-scroll');
  scroller.scrollLeft = keepScroll;
  positionCapturePlayhead(container, videoEl);
  scroller.addEventListener('scroll', () => positionCapturePlayhead(container, videoEl), { passive: true }); // cache/montre la tête quand on défile
  drawSnapGuide();
  // Zoom : boutons, Ctrl/Cmd + molette (et pincement du pavé tactile), ancré sous le curseur.
  const setZoom = (z, anchorX) => {
    const rr = container.querySelector('.vct-ruler').getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const ax = anchorX == null ? sr.left + labelW + (sr.width - labelW) / 2 : anchorX;
    const frac = (ax - rr.left) / rr.width;
    container.__vctZoom = Math.min(maxZoom, Math.max(1, z));
    rerender();
    const sc2 = container.querySelector('.vct-scroll');
    const rr2 = container.querySelector('.vct-ruler').getBoundingClientRect();
    sc2.scrollLeft += (rr2.left + frac * rr2.width) - ax;
    positionCapturePlayhead(container, videoEl);
  };
  // Commandes de la barre de zoom (câblée une fois) : boutons et curseur (échelle logarithmique : chaque cran multiplie le zoom du même facteur).
  container.__vctZoomCmd = (k, v) => {
    if (k === 'fit') { container.__vctZoom = 1; rerender(); }
    else if (k === 'slider') setZoom(Math.pow(maxZoom, v / 100));
    else setZoom(zoom * (k === 'in' ? 2 : 0.5));
  };
  // Retirer une piste : une piste vide disparaît de l'affichage de cette version ; avec des blocs, il faut confirmer (ils sont supprimés, annulable).
  async function removeSfxById(key) {
    if (videoCaptureState) return;
    const sid = key.slice(4);
    const mine = events.filter(e => e.name === 'stinger_play' && e.detail && e.detail.sfxId === sid);
    const name = (findCaptureSfx(sid) || {}).title || sid;
    if (mine.length && !await window.LayerPitchNotify.confirm(tr('captureTrackRemoveConfirm').replace('{n}', String(mine.length)).replace('{name}', name), { okLabel: tr('captureTrackRemoveOk'), danger: true })) return;
    mine.forEach(e => { const i = events.indexOf(e); if (i >= 0) events.splice(i, 1); });
    if (laneLayout.hidden.indexOf(key) === -1) laneLayout.hidden.push(key);
    delete mixMap[key];
    changed();
  }
  async function removeTrackById(id) {
    if (id.indexOf('sfx:') === 0) return removeSfxById(id);
    if (videoCaptureState) return;
    const mine = events.filter(e => e.detail && e.detail.trackId === id);
    if (mine.length && !await window.LayerPitchNotify.confirm(tr('captureTrackRemoveConfirm').replace('{n}', String(mine.length)).replace('{name}', (findCaptureTrack(id) || {}).title || id), { okLabel: tr('captureTrackRemoveOk'), danger: true })) return;
    mine.forEach(e => { const i = events.indexOf(e); if (i >= 0) events.splice(i, 1); });
    const x = laneLayout.extra.indexOf(id); if (x >= 0) laneLayout.extra.splice(x, 1);
    if (laneLayout.hidden.indexOf(id) === -1 && (capturePackLibrary().library || []).some(t => t.id === id)) laneLayout.hidden.push(id);
    delete mixMap[id];
    changed();
  }
  container.querySelectorAll('[data-remove-track]').forEach(btn => btn.addEventListener('click', ev => {
    ev.stopPropagation(); ev.preventDefault();
    removeTrackById(btn.dataset.removeTrack);
  }));
  // M / S / volume d'un morceau (13/11) : réglages du montage, rangés dans laneLayout.mix, joués à l'écoute et à l'export.
  container.querySelectorAll('[data-mix-m]').forEach(btn => btn.addEventListener('click', ev => {
    ev.stopPropagation(); ev.preventDefault();
    const id = btn.dataset.mixM; setMix(id, { mute: !(mixMap[id] && mixMap[id].mute) }); changed();
  }));
  container.querySelectorAll('[data-mix-s]').forEach(btn => btn.addEventListener('click', ev => {
    ev.stopPropagation(); ev.preventDefault();
    const id = btn.dataset.mixS; setMix(id, { solo: !(mixMap[id] && mixMap[id].solo) }); changed();
  }));
  container.querySelectorAll('[data-mix-v]').forEach(inp => {
    inp.addEventListener('click', ev => ev.stopPropagation());
    inp.addEventListener('input', () => { setMix(inp.dataset.mixV, { vol: Number(inp.value) / 100 }); inp.title = tr('captureMixVolume') + ' : ' + inp.value + ' %'; });
    inp.addEventListener('change', () => changed()); // pas de réaffichage pendant le glisser : le curseur serait perdu
  });
  // « ⇄ » sur un morceau (13/11, admin seulement) : le remplace par un autre en REJOUANT ses blocs sur le nouveau morceau (même moteur que le
  // Versioning : capture-retarget.js -- les gestes restent, ils suivent les règles du nouveau morceau). Refusé si la structure diffère.
  const replaceDurations = window.__lpReplaceDurations = window.__lpReplaceDurations || new Map();
  async function replaceEnsureDurations(dst) {
    if (!dst || dst.mode !== 'embranchement-vertical') return;
    await Promise.all((dst.loops || []).map(async l => {
      if (!(l.transition && l.transition.file && !l.transition.durationUnit)) return;
      const key = dst.id + '|' + l.transition.file;
      if (replaceDurations.has(key)) return;
      try {
        const bytes = await fetchAsUint8Array(dst.base + encodeURIComponent(l.transition.file) + (dst.publishedAt ? '?v=' + encodeURIComponent(dst.publishedAt) : ''));
        const buf = await window.LayerPlayerCore.decodeAudioCompat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        replaceDurations.set(key, buf.duration);
      } catch (e) { replaceDurations.set(key, null); }
    }));
  }
  const replaceNoteText = n => {
    const name = id => { const t = findCaptureTrack(id); return t ? (t.title || id) : String(id || ''); };
    const key = 'versioningNote_' + n.code;
    let txt = tr(key); if (txt === key) txt = tr('versioningNote_generic').replace('{code}', n.code);
    txt = txt.replace('{track}', name(n.trackId)).replace('{to}', name(n.to)).replace('{t}', n.t != null ? n.t.toFixed(1) : '')
      .replace('{by}', n.by != null ? (n.by > 0 ? '+' : '') + n.by.toFixed(2) : '').replace('{pos}', n.pos != null ? String(n.pos + 1) : '')
      .replace('{a}', n.a != null ? String(n.a) : '').replace('{b}', n.b != null ? String(n.b) : '');
    if (n.count > 1) txt += ' ' + tr('versioningNoteCount').replace('{n}', n.count);
    return txt;
  };
  async function replaceTrack(srcId, dstId) {
    const RT = window.LayerCaptureRetarget;
    const dst = findCaptureTrack(dstId);
    await replaceEnsureDurations(dst);
    const res = RT.retarget(events, { tracks: { [srcId]: { to: dstId } }, sfx: {} }, {
      findTrack: findCaptureTrack, findSfx: findCaptureSfx,
      fileDuration: (owner, file) => { const v = replaceDurations.get(owner.id + '|' + file); return v == null ? null : v; },
    });
    const blocking = res.notes.filter(n => n.severity === 'block');
    if (blocking.length) { window.LayerPitchNotify.error(blocking.map(replaceNoteText).join(' · ')); return; }
    events.splice(0, events.length, ...res.events);
    // Les pistes : l'ancien morceau disparaît de la frise, le nouveau s'affiche (même logique que « ✕ » et « + Piste »).
    const x = laneLayout.extra.indexOf(srcId); if (x >= 0) laneLayout.extra.splice(x, 1);
    if (laneLayout.hidden.indexOf(srcId) === -1 && (capturePackLibrary().library || []).some(t => t.id === srcId)) laneLayout.hidden.push(srcId);
    if (mixMap[srcId]) { mixMap[dstId] = mixMap[srcId]; delete mixMap[srcId]; } // M / S / volume suivent le nouveau morceau
    const h = laneLayout.hidden.indexOf(dstId);
    if (h >= 0) laneLayout.hidden.splice(h, 1);
    else if (laneLayout.extra.indexOf(dstId) === -1 && handTrackIds.indexOf(dstId) === -1) laneLayout.extra.push(dstId);
    changed();
    window.LayerPitchNotify.success(tr('captureTrackReplaced').replace('{from}', (findCaptureTrack(srcId) || {}).title || srcId).replace('{to}', (dst || {}).title || dstId)
      + (res.notes.length ? '\n' + res.notes.map(replaceNoteText).join('\n') : ''));
  }
  // « ⇄ » sur un Sfx : tous ses déclenchements passent au Sfx choisi (même moteur ; la variation suit la règle de tirage du nouveau Sfx).
  async function replaceSfx(srcKey, dstId) {
    const srcId = srcKey.slice(4);
    const res = window.LayerCaptureRetarget.retarget(events, { tracks: {}, sfx: { [srcId]: dstId } }, {
      findTrack: findCaptureTrack, findSfx: findCaptureSfx, fileDuration: () => null,
    });
    events.splice(0, events.length, ...res.events);
    const dk = 'sfx:' + dstId;
    if (laneLayout.hidden.indexOf(srcKey) === -1) laneLayout.hidden.push(srcKey);
    const h = laneLayout.hidden.indexOf(dk); if (h >= 0) laneLayout.hidden.splice(h, 1);
    if (mixMap[srcKey]) { mixMap[dk] = mixMap[srcKey]; delete mixMap[srcKey]; }
    changed();
    window.LayerPitchNotify.success(tr('captureTrackReplaced').replace('{from}', (findCaptureSfx(srcId) || {}).title || srcId).replace('{to}', (findCaptureSfx(dstId) || {}).title || dstId)
      + (res.notes.length ? '\n' + res.notes.map(replaceNoteText).join('\n') : ''));
  }
  function openReplaceDialog(srcId) {
    if (!editable || videoCaptureState || !window.LayerCaptureRetarget) return;
    const isSfx = srcId.indexOf('sfx:') === 0;
    const src = isSfx ? findCaptureSfx(srcId.slice(4)) : findCaptureTrack(srcId);
    const L = window.__lpCaptureLibrary || {};
    const esc = window.LayerPlayerCore.escapeHtml;
    const used = new Set(events.map(e => e.detail && (isSfx ? e.detail.sfxId : e.detail.trackId)).filter(Boolean));
    const rows = isSfx
      ? (L.sfxLibrary || []).filter(t => t.id !== srcId.slice(4) && !used.has(t.id) && (t.alternatives || []).some(a => a.file || a.localFile || a.localUrl)).map(t => ({ t: Object.assign({}, t, { mode: 'Sfx' }), ok: true, why: '' }))
      : (L.library || []).filter(t => t.id !== srcId && !used.has(t.id)).map(t => {
      const cmp = window.LayerCaptureRetarget.compareTracks(src, t);
      return { t, ok: cmp.compatible, why: cmp.issues.filter(i => i.severity === 'block').map(i => tr('versioningIssue_' + i.code)).join(', ') };
    });
    const dlg = document.createElement('dialog');
    dlg.className = 'video-test-dialog';
    const body = () => {
      const q = (dlg.querySelector('#vctRepQuery') || { value: '' }).value.trim().toLowerCase();
      const match = r => !q || String(r.t.title || r.t.id).toLowerCase().indexOf(q) >= 0;
      const item = r => r.ok
        ? `<button type="button" class="vct-add-item" data-rep-id="${esc(r.t.id)}">${esc(r.t.title || r.t.id)}<small>${esc(r.t.mode)}</small></button>`
        : `<div class="vct-add-item vct-add-item-off" style="opacity:.5;cursor:not-allowed">${esc(r.t.title || r.t.id)}<small>${esc(r.why)}</small></div>`;
      const ok = rows.filter(r => r.ok && match(r)), off = rows.filter(r => !r.ok && match(r));
      dlg.querySelector('#vctRepList').innerHTML =
        (ok.length ? `<div class="vct-add-group">${esc(tr('captureTrackReplaceOk'))}</div>` + ok.map(item).join('') : `<div class="vct-add-none">${esc(tr('captureTrackReplaceNone'))}</div>`)
        + (off.length ? `<div class="vct-add-group">${esc(tr('captureTrackReplaceOff'))}</div>` + off.map(item).join('') : '');
    };
    dlg.innerHTML = `<form method="dialog" class="video-test-form"><div class="video-test-dialog-title">${esc(tr('captureTrackReplaceDialog').replace('{name}', (src || {}).title || srcId.replace(/^sfx:/, '')))}</div>
      <input type="search" id="vctRepQuery" class="video-capture-title-input" placeholder="${esc(tr('captureTrackAddSearch'))}" style="width:100%">
      <div id="vctRepList" class="vct-add-list"></div>
      <div class="video-test-dialog-actions"><button type="button" class="video-test-btn-secondary" value="cancel">${esc(tr('cancel'))}</button></div></form>`;
    (container.closest('#videoTestPanel') || document.body).appendChild(dlg);
    body();
    dlg.querySelector('#vctRepQuery').addEventListener('input', body);
    dlg.querySelector('[value="cancel"]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', ev => {
      const it = ev.target.closest && ev.target.closest('[data-rep-id]');
      if (!it) return;
      const id = it.dataset.repId;
      dlg.close();
      if (isSfx) replaceSfx(srcId, id); else replaceTrack(srcId, id);
    });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
  }
  container.querySelectorAll('[data-replace-track]').forEach(btn => btn.addEventListener('click', ev => {
    ev.stopPropagation(); ev.preventDefault();
    openReplaceDialog(btn.dataset.replaceTrack);
  }));
  // Colonne des noms redimensionnable + menu clic droit (13/11, admin). Écouteurs posés UNE fois sur le conteneur (il survit aux réaffichages) :
  // ils lisent l'état courant par container.__vctRerender / __vctCtx, remis à jour à chaque affichage.
  container.__vctRerender = rerender;
  container.__vctCtx = (ev, key) => {
    const id = key.indexOf('track:') === 0 ? key.slice(6) : key;
    const doc = ownerDoc;
    doc.querySelectorAll('.vct-ctx').forEach(m => m.remove());
    const menu = doc.createElement('div');
    menu.className = 'vct-ctx';
    const item = (act, label, checked) => `<button type="button" class="vct-ctx-item" data-act="${act}">${checked == null ? '' : `<span class="vct-ctx-check">${checked ? '✓' : ''}</span>`}${escH(label)}</button>`;
    menu.innerHTML = (window.LayerCaptureRetarget ? item('replace', tr('captureCtxReplace')) : '') + item('remove', tr('captureCtxRemove'))
      + `<div class="vct-ctx-sep"></div><div class="vct-ctx-title">${escH(tr('captureCtxComponents'))}</div>`
      + item('c:m', tr('captureMixMute') + ' (M)', comps.m) + item('c:s', tr('captureMixSolo') + ' (S)', comps.s)
      + item('c:vol', tr('captureMixVolume'), comps.vol) + item('c:replace', tr('captureCtxReplaceBtn') + ' (⇄)', comps.replace) + item('c:remove', tr('captureCtxRemoveBtn') + ' (✕)', comps.remove);
    menu.style.left = Math.min(ev.clientX, (ownerWin.innerWidth || 800) - 230) + 'px';
    menu.style.top = Math.min(ev.clientY, (ownerWin.innerHeight || 600) - 260) + 'px';
    const close = () => { menu.remove(); doc.removeEventListener('pointerdown', away, true); doc.removeEventListener('keydown', esc, true); };
    const away = e => { if (!menu.contains(e.target)) close(); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    menu.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act.indexOf('c:') === 0) {
        const k = act.slice(2); comps[k] = !comps[k]; store.set('lp.vct.comps', comps); close(); rerender(); return;
      }
      close();
      if (act === 'replace') openReplaceDialog(id); else if (act === 'remove') removeTrackById(id);
    });
    doc.body.appendChild(menu);
    doc.addEventListener('pointerdown', away, true);
    doc.addEventListener('keydown', esc, true);
  };
  if (adminHdr && !container.__vctHdrBound) {
    container.__vctHdrBound = true;
    const onEdge = ev => {
      const l = ev.target.closest && ev.target.closest('.vct-lane-label, .vct-ruler-corner');
      if (!l) return false;
      const r = l.getBoundingClientRect();
      return ev.clientX >= r.right - 6 && ev.clientX <= r.right + 3;
    };
    container.addEventListener('pointermove', ev => { if (!container.__vctResizing) container.classList.toggle('vct-col-resize', onEdge(ev)); });
    container.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || !onEdge(ev)) return;
      ev.preventDefault(); ev.stopPropagation();
      const x0 = ev.clientX, w0 = container.__vctLabelW || 170, d = container.ownerDocument || document;
      container.__vctResizing = true;
      const move = e => {
        const w = Math.min(420, Math.max(110, Math.round(w0 + e.clientX - x0)));
        container.__vctLabelW = w; container.style.setProperty('--vct-label-w', w + 'px');
      };
      const up = () => {
        d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up);
        container.__vctResizing = false;
        store.set('lp.vct.labelW', container.__vctLabelW);
        container.__vctRerender && container.__vctRerender(); // zoom et marqueurs recalculés sur la nouvelle largeur
      };
      d.addEventListener('pointermove', move); d.addEventListener('pointerup', up);
    }, true);
    container.addEventListener('contextmenu', ev => {
      const h = ev.target.closest && ev.target.closest('.vct-lane-label[data-hdr-key], .vct-track-group-header[data-group-key^="track:"], .vct-track-group-header[data-group-key^="sfx:"]');
      if (!h || !container.__vctCtx) return;
      const key = h.dataset.hdrKey || h.dataset.groupKey;
      if (!key || key.indexOf('track:') !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      container.__vctCtx(ev, key);
    });
  }
  // « + Piste » : ajoute un morceau (vide, à poser au double-clic) -- ceux du pack masqués, puis les autres packs, puis le reste de la bibliothèque.
  function openAddTrackDialog() {
    if (!editable || videoCaptureState) return;
    const L = window.__lpCaptureLibrary || {};
    const shown = new Set(handTrackIds.concat(events.map(e => e.detail && e.detail.trackId).filter(Boolean)));
    const esc = window.LayerPlayerCore.escapeHtml;
    const all = (L.library || []).filter(t => handMode(t) && !shown.has(t.id));
    const inPack = new Set(L.packTrackIds || []);
    const groups = [{ label: tr('captureTrackAddPack'), tracks: all.filter(t => inPack.has(t.id)) }];
    const used = new Set(groups[0].tracks.map(t => t.id));
    (L.otherPacks || []).forEach(pk => {
      const ids = new Set(pk.trackIds || []);
      const tracks = all.filter(t => ids.has(t.id) && !used.has(t.id));
      tracks.forEach(t => used.add(t.id));
      if (tracks.length) groups.push({ label: pk.title, tracks });
    });
    const rest = all.filter(t => !used.has(t.id));
    if (rest.length) groups.push({ label: tr('captureTrackAddLibrary'), tracks: rest });
    const dlg = document.createElement('dialog');
    dlg.className = 'video-test-dialog';
    const body = () => {
      const q = (dlg.querySelector('#vctAddQuery') || { value: '' }).value.trim().toLowerCase();
      const html = groups.map(g => {
        const list = g.tracks.filter(t => !q || String(t.title || t.id).toLowerCase().indexOf(q) >= 0);
        return list.length ? `<div class="vct-add-group">${esc(g.label)}</div>` + list.map(t => `<button type="button" class="vct-add-item" data-add-id="${esc(t.id)}">${esc(t.title || t.id)}<small>${esc(t.mode)}</small></button>`).join('') : '';
      }).join('');
      dlg.querySelector('#vctAddList').innerHTML = html || `<div class="vct-add-none">${esc(tr('captureTrackAddNone'))}</div>`;
    };
    dlg.innerHTML = `<form method="dialog" class="video-test-form"><div class="video-test-dialog-title">${esc(tr('captureTrackAddTitle'))}</div>
      <input type="search" id="vctAddQuery" class="video-capture-title-input" placeholder="${esc(tr('captureTrackAddSearch'))}" style="width:100%">
      <div id="vctAddList" class="vct-add-list"></div>
      <div class="video-test-dialog-actions"><button type="button" class="video-test-btn-secondary" value="cancel">${esc(tr('cancel'))}</button></div></form>`;
    (container.closest('#videoTestPanel') || document.body).appendChild(dlg);
    body();
    dlg.querySelector('#vctAddQuery').addEventListener('input', body);
    dlg.querySelector('[value="cancel"]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', ev => {
      const it = ev.target.closest && ev.target.closest('[data-add-id]');
      if (!it) return;
      const id = it.dataset.addId;
      const h = laneLayout.hidden.indexOf(id); if (h >= 0) laneLayout.hidden.splice(h, 1);
      else if (laneLayout.extra.indexOf(id) === -1) laneLayout.extra.push(id);
      dlg.close();
      changed();
    });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
  }
  scroller.addEventListener('wheel', ev => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    setZoom(zoom * Math.exp(-ev.deltaY * 0.01), ev.clientX);
  }, { passive: false });
  // Tête de lecture déplaçable (05/11, demande de Jules-Antoine) : cliquer ou glisser sur la règle des temps place la vidéo à cet
  // instant (la ligne rouge suit). Pas pendant une prise : l'horloge de la capture est calée sur la vidéo qui défile.
  const scrubRuler = container.querySelector('.vct-ruler');
  if (scrubRuler && videoEl) {
    scrubRuler.classList.add('vct-scrub');
    scrubRuler.title = tr('captureScrubHint');
    scrubRuler.addEventListener('pointerdown', ev => {
      if (videoCaptureState) return;
      ev.preventDefault();
      const seek = e => {
        const r = scrubRuler.getBoundingClientRect();
        const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        let tt = f * total;
        tt += snapDelta([tt], snapTargets(null, null), e, r.width);
        videoEl.currentTime = Math.min(tt, Number.isFinite(videoEl.duration) ? videoEl.duration : tt);
        positionCapturePlayhead(container, videoEl);
        drawSnapGuide();
      };
      seek(ev);
      if (scrubRuler.setPointerCapture) scrubRuler.setPointerCapture(ev.pointerId);
      const up = () => { clearSnapGuide(); scrubRuler.removeEventListener('pointermove', seek); scrubRuler.removeEventListener('pointerup', up); scrubRuler.removeEventListener('pointercancel', up); };
      scrubRuler.addEventListener('pointermove', seek);
      scrubRuler.addEventListener('pointerup', up);
      scrubRuler.addEventListener('pointercancel', up);
    });
  }
  // Clic sur un fanion : la vidéo va à ce marqueur (pas pendant une prise) ; en édition, le glisser le déplace et le clic ouvre son
  // détail (nom, instant, suppression).
  const seekTo = t => {
    if (!videoEl || videoCaptureState) return;
    videoEl.currentTime = Math.min(t, Number.isFinite(videoEl.duration) ? videoEl.duration : t);
    positionCapturePlayhead(container, videoEl);
  };
  const timeAtX = clientX => {
    const r = container.querySelector('.vct-ruler').getBoundingClientRect();
    const f = (clientX - r.left) / r.width;
    return f < 0 || f > 1 ? null : f * total;
  };
  function selectMarker(m) {
    container.__vctSelectedMarker = m.id;
    container.querySelectorAll('.vct-block').forEach(b => b.classList.remove('vct-selected'));
    container.querySelectorAll('.vct-marker').forEach((el, i) => el.classList.toggle('vct-marker-selected', markers[i] === m));
    const detailEl = container.querySelector('#vctDetail');
    detailEl.innerHTML = `
      <span class="vct-detail-label">${tr('captureMarkerLabel')}</span>
      <input type="text" class="video-capture-marker-name" maxlength="60" value="${window.LayerPlayerCore.escapeHtml(m.label || '')}" title="${tr('captureMarkerNameTitle')}">
      <input type="number" step="0.1" min="0" value="${m.t.toFixed(2)}" class="video-capture-event-time" title="${tr('captureTimeInputTitle')}">
      <button type="button" class="video-capture-event-del" title="${tr('captureMarkerDelete')}" aria-label="${tr('captureMarkerDelete')}">✕</button>
    `;
    const nameInput = detailEl.querySelector('.video-capture-marker-name');
    nameInput.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); nameInput.blur(); } });
    nameInput.addEventListener('change', () => { m.label = nameInput.value.trim() || m.label; changed(); });
    detailEl.querySelector('.video-capture-event-time').addEventListener('change', ev => {
      const v = parseFloat(ev.target.value);
      if (!isNaN(v)) { m.t = Math.max(0, v); markers.sort((a, b) => a.t - b.t); }
      changed();
    });
    detailEl.querySelector('.video-capture-event-del').addEventListener('click', () => removeMarker(m));
  }
  // Effacer un marqueur (06/11, demande de Jules-Antoine : « la même manip que pour le créer ») : double-clic ou clic droit sur son
  // fanion, touche Suppr / Retour arrière quand il est sélectionné, ou ✕ dans son détail.
  function removeMarker(m) {
    const i = markers.indexOf(m);
    if (i !== -1) markers.splice(i, 1);
    container.__vctSelectedMarker = null;
    changed();
  }
  function addMarker(t) {
    if (t == null) return;
    // Premier « Marqueur N » libre, pour ne pas en avoir deux du même nom après une suppression.
    let n = 1;
    while (markers.some(o => o.label === tr('captureMarkerDefault').replace('{n}', n))) n++;
    const m = { id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)), t: Math.max(0, t), label: tr('captureMarkerDefault').replace('{n}', n) };
    markers.push(m);
    markers.sort((a, b) => a.t - b.t);
    container.__vctSelectedMarker = m.id;
    container.__vctSelectedEvent = null;
    changed(); // rouvre le détail du marqueur sélectionné (voir plus bas) : on peut taper son nom tout de suite
    const nameInput = container.querySelector('.video-capture-marker-name');
    if (nameInput) { nameInput.focus(); nameInput.select(); }
  }
  container.querySelectorAll('.vct-review-flag').forEach(flagEl => {
    const r = (container.__vctReviewMarks || [])[parseInt(flagEl.dataset.reviewIdx, 10)];
    if (!r) return;
    flagEl.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      seekTo(Number(r.t));
      const esc = window.LayerPlayerCore.escapeHtml;
      const d = container.querySelector('#vctDetail');
      if (d) d.innerHTML = `<span class="vct-detail-label">💬 ${esc(r.author || '')}${r.versionTitle ? ' · ' + esc(r.versionTitle) : ''} · ${Number(r.t).toFixed(2)} s — ${esc(r.body || '')}</span>`;
      if (container.__vctOnReviewMark) container.__vctOnReviewMark(r);
    });
  });
  container.querySelectorAll('.vct-marker-flag').forEach(flagEl => {
    const m = markers[parseInt(flagEl.dataset.markerIdx, 10)];
    if (!m) return;
    flagEl.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (!editable) { seekTo(m.t); return; }
      const startX = ev.clientX, startT = m.t;
      const markerEl = flagEl.parentElement;
      let moved = false;
      const onMove = e => {
        const r = container.querySelector('.vct-ruler').getBoundingClientRect();
        const dt = (e.clientX - startX) / r.width * total;
        if (!moved && Math.abs(e.clientX - startX) < 3) return;
        moved = true;
        const raw = startT + dt;
        m.t = Math.min(total, Math.max(0, raw + snapDelta([raw], snapTargets(null, m), e, r.width)));
        markerEl.style.left = pct(m.t) + '%';
        drawSnapGuide();
      };
      const onUp = () => {
        clearSnapGuide();
        ownerDoc.removeEventListener('pointermove', onMove);
        ownerDoc.removeEventListener('pointerup', onUp);
        ownerDoc.removeEventListener('pointercancel', onUp);
        container.__vctSelectedMarker = m.id;
        if (moved) { markers.sort((a, b) => a.t - b.t); changed(); }
        else { seekTo(m.t); selectMarker(m); }
      };
      ownerDoc.addEventListener('pointermove', onMove);
      ownerDoc.addEventListener('pointerup', onUp);
      ownerDoc.addEventListener('pointercancel', onUp);
    });
    if (editable) flagEl.addEventListener('dblclick', ev => { ev.preventDefault(); ev.stopPropagation(); if (!videoCaptureState) removeMarker(m); });
  });
  // Touche Suppr : un seul écouteur par frise (posé au premier affichage), qui appelle l'effaceur du DERNIER affichage -- le tableau
  // des marqueurs change à chaque montage chargé. Jamais pendant qu'on tape dans un champ (nom du marqueur, nom de la prise…).
  container.__vctDeleteSelectedMarker = editable ? () => {
    const m = markers.find(o => o.id === container.__vctSelectedMarker);
    if (!m || videoCaptureState || !container.isConnected) return false;
    removeMarker(m);
    return true;
  } : null;
  // Suppr sur un BLOC sélectionné (13/11, accepté par Jules-Antoine ; admin seulement jusqu'au feu vert) : même effet que le bouton « Supprimer »
  // de la ligne de détail (bascules liées retirées avec, annulable), qu'on déclenche tel quel plutôt que de copier sa logique. Jamais pendant une prise.
  container.__vctDeleteSelectedBlock = editable ? () => {
    if (!window.__lpCaptureIsAdmin || videoCaptureState || !container.isConnected || !container.__vctSelectedEvent) return false;
    const del = container.querySelector('#vctDetail .video-capture-event-del');
    if (!del) return false; // un bloc « arrêt » n'a pas de bouton Supprimer : rien à faire
    del.click();
    return true;
  } : null;
  if (container.__vctMarkerKeys !== ownerDoc) {
    container.__vctMarkerKeys = ownerDoc;
    const keyDoc = ownerDoc;
    keyDoc.addEventListener('keydown', function onDel(ev) {
      if (!container.isConnected || container.ownerDocument !== keyDoc) { keyDoc.removeEventListener('keydown', onDel); if (container.__vctMarkerKeys === keyDoc) container.__vctMarkerKeys = null; return; }
      if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
      const a = keyDoc.activeElement;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      if (container.__vctDeleteSelectedMarker && container.__vctDeleteSelectedMarker()) ev.preventDefault();
      else if (container.__vctDeleteSelectedBlock && container.__vctDeleteSelectedBlock()) ev.preventDefault();
    });
  }
  if (editable) {
    // Pose d'un marqueur : double-clic sur la règle des temps (et partout où le double-clic n'ajoute pas déjà un bloc : interlignes,
    // lignes de titre des morceaux (retiré le 12/11 : elles ressemblent à une piste de musique) -- la règle seule, 16 px de haut, se ratait facilement), ou clic droit n'importe où dans la frise
    // (règle ou pistes), à l'endroit cliqué. Double-clic ou clic droit sur un fanion = l'effacer (voir removeMarker).
    const bodyEl = container.querySelector('.vct-body');
    // 12/11 : pas de marqueur sur la ligne de titre d'un morceau (.vct-group-summary) : elle ressemblait à une piste où déposer de la musique.
    bodyEl.addEventListener('dblclick', ev => {
      if (videoCaptureState || !ev.target.closest) return;
      if (ev.target.closest('.vct-lane-track[data-addable], .vct-block, .vct-lane-label, .vct-marker-flag, .vct-group-summary, input')) return;
      addMarker(timeAtX(ev.clientX));
    });
    bodyEl.addEventListener('contextmenu', ev => {
      if (videoCaptureState) return;
      const flag = ev.target.closest && ev.target.closest('.vct-marker-flag');
      if (flag) { ev.preventDefault(); const m = markers[parseInt(flag.dataset.markerIdx, 10)]; if (m) removeMarker(m); return; }
      const t = timeAtX(ev.clientX);
      if (t == null) return; // clic droit sur un nom de piste : menu habituel du navigateur
      ev.preventDefault();
      addMarker(t);
    });
    // Marqueur sélectionné : son détail reste ouvert d'un affichage à l'autre (renommage, déplacement…).
    const selectedMarker = markers.find(m => m.id === container.__vctSelectedMarker);
    if (selectedMarker) selectMarker(selectedMarker);
  }
  container.querySelectorAll('.vct-track-group-header').forEach(headerEl => {
    headerEl.addEventListener('click', () => {
      const key = headerEl.dataset.groupKey;
      collapsedGroups[key] = !collapsedGroups[key];
      changed('view');
    });
  });
  if (!editable) return;

  // Les stingers ET les segments de calque ont chacun un vrai IN + OUT/durée, indépendant de tout autre
  // bloc (façon cue sheet) -- seul le nom du champ diffère (durationOverride vs duration, ce dernier
  // toujours défini puisque matérialisé, jamais "d'origine" à retrouver). Ces deux petits accesseurs
  // évitent de dupliquer la logique d'édition/glisser pour les deux types.
  function hasIndependentDuration(e) { return e.name === 'stinger_play' || e.name === 'layer_segment' || e.name === 'fx_segment'; }
  function getEventDuration(e) { return (e.name === 'layer_segment' || e.name === 'fx_segment') ? e.detail.duration : (e.detail.durationOverride || 1); }
  function setEventDuration(e, v) {
    if (e.name === 'layer_segment' || e.name === 'fx_segment') e.detail.duration = Math.max(0.1, v);
    else e.detail.durationOverride = (v == null || v <= 0) ? null : v;
  }

  // Aimantation (09/11, demande de Jules-Antoine, façon Logic X) : en glissant la tête de lecture, un marqueur ou un bloc,
  // le point tenu s'accroche aux repères proches (début/fin de la vidéo, autres marqueurs, bords des autres blocs, tête de
  // lecture) quand il passe à moins de 8 px ; un trait bleu montre l'accroche. Maj ou Cmd maintenu = glisser libre.
  const SNAP_PX = 8;
  function snapTargets(skipEvents, skipMarker) {
    const ts = [0];
    if (videoEl && Number.isFinite(videoEl.duration)) ts.push(videoEl.duration);
    if (videoEl && !videoCaptureState) ts.push(videoEl.currentTime || 0);
    markers.forEach(m => { if (m !== skipMarker) ts.push(m.t); });
    events.forEach(o => {
      if (skipEvents && skipEvents.indexOf(o) !== -1) return;
      ts.push(o.t);
      if (hasIndependentDuration(o)) ts.push(o.t + getEventDuration(o));
    });
    return ts;
  }
  // refs : les instants que porte l'objet glissé (son début, sa fin). Renvoie le décalage à ajouter pour que le plus proche
  // s'accroche à un repère, ou 0 s'il n'y en a pas à portée / si l'aimantation est coupée.
  function snapDelta(refs, targets, ev, widthPx) {
    container.__vctSnapT = null;
    if (ev.shiftKey || ev.metaKey || !(widthPx > 0)) return 0;
    const maxD = SNAP_PX / widthPx * total;
    let best = null;
    refs.forEach(r => targets.forEach(t => {
      const d = t - r;
      if (Math.abs(d) <= maxD && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
    }));
    if (!best) return 0;
    container.__vctSnapT = best.at;
    return best.d;
  }
  function clearSnapGuide() { container.__vctSnapT = null; drawSnapGuide(); }
  function drawSnapGuide() {
    const g = container.querySelector('#vctSnapGuide');
    const ruler = container.querySelector('.vct-ruler');
    if (!g || !ruler) return;
    const t = container.__vctSnapT;
    if (t == null) { g.style.display = 'none'; return; }
    const base = g.parentElement.getBoundingClientRect();
    const rr = ruler.getBoundingClientRect();
    g.style.left = ((rr.left - base.left) + Math.min(1, Math.max(0, t / total)) * rr.width) + 'px';
    g.style.display = 'block';
  }

  function selectBlock(idx, el) {
    container.querySelectorAll('.vct-block').forEach(b => b.classList.remove('vct-selected'));
    el.classList.add('vct-selected');
    container.__vctSelectedMarker = null;
    container.querySelectorAll('.vct-marker').forEach(m => m.classList.remove('vct-marker-selected'));
    const e = events[idx];
    container.__vctSelectedEvent = e; // retrouvé après chaque nouvel affichage (voir la fin de renderCaptureTimeline)
    const detailEl0 = container.querySelector('#vctDetail');
    if (e.name === 'voices_stop') {
      // Arrêt (05/11) : seule la durée du fondu se règle ici (0 = arrêt net).
      detailEl0.innerHTML = `
        <span class="vct-detail-label">${tr('captureStopDetail').replace('{t}', e.t.toFixed(2))}</span>
        <label class="video-capture-export-opt" title="${tr('captureStopFadeHelp')}">${tr('captureStopFadeLabel')}
          <input type="number" step="0.1" min="0" max="10" value="${e.detail.fadeSec > 0 ? e.detail.fadeSec : 0}" class="video-capture-event-stopfade"> s</label>`;
      detailEl0.querySelector('.video-capture-event-stopfade').addEventListener('change', ev => {
        const v = parseFloat(ev.target.value);
        if (!(v > 0)) delete e.detail.fadeSec; else e.detail.fadeSec = Math.min(10, v);
        changed();
      });
      return;
    }
    const editableDuration = hasIndependentDuration(e);
    const isSfx = e.name === 'stinger_play';
    // Duck (2026-09-15) : baisse le volume de la musique pendant que le stinger joue, comme le fait déjà
    // le vrai moteur pour les Sfx marqués duckMainTrack -- pré-coché selon ce réglage d'origine du son,
    // mais modifiable pour cette prise (e.detail.duck, undefined tant qu'intact = suit le réglage du son).
    const sfxForDuck = isSfx ? findCaptureSfx(e.detail.sfxId) : null;
    const duckChecked = isSfx && (e.detail.duck !== undefined ? e.detail.duck : !!(sfxForDuck && sfxForDuck.duckMainTrack));
    const detailEl = container.querySelector('#vctDetail');
    detailEl.innerHTML = `
      <span class="vct-detail-label">${window.LayerPlayerCore.escapeHtml(describeCaptureEvent(e, laneOverrides))}</span>
      <input type="number" step="0.1" min="0" value="${e.t.toFixed(2)}" class="video-capture-event-time" title="${tr('captureTimeInputTitle')}">
      ${editableDuration ? `<input type="number" step="0.1" min="0" placeholder="${isSfx ? tr('captureDurationPlaceholder') : ''}" value="${isSfx ? (e.detail.durationOverride ? e.detail.durationOverride.toFixed(2) : '') : e.detail.duration.toFixed(2)}" class="video-capture-event-duration" title="${tr('captureDurationInputTitle')}">` : ''}
      ${e.name === 'head_turn' ? `<input type="number" step="1" min="-180" max="180" value="${Math.round(e.detail.yaw)}" class="video-capture-event-yaw" title="${tr('captureYawInputTitle')}">` : ''}
      ${e.name === 'fx_slider' ? `<input type="number" step="1" min="0" max="100" value="${Math.round(e.detail.value * 100)}" class="video-capture-event-slidervalue" title="${tr('captureSliderValueTitle')}">` : ''}
      ${isSfx ? `<label class="video-capture-duck-label" title="${tr('captureDuckHint')}"><input type="checkbox" class="video-capture-event-duck" ${duckChecked ? 'checked' : ''}> Duck</label>` : ''}
      <button type="button" class="video-capture-event-del" title="${tr('captureDeleteBtn')}" aria-label="${tr('captureDeleteBtn')}">✕</button>
    `;
    detailEl.querySelector('.video-capture-event-time').addEventListener('change', (ev) => {
      const v = parseFloat(ev.target.value);
      const oldT = e.t;
      const linkedByTime = window.LayerCapturePlan.linkedMarks(events, e); // repères liés : ils suivent le bloc
      e.t = isNaN(v) ? e.t : Math.max(0, v);
      linkedByTime.forEach(m => { m.t = Math.max(0, m.t + (e.t - oldT)); });
      events.sort((a, b) => a.t - b.t); // garde l'ordre chronologique après une retouche manuelle
      changed();
    });
    const durationInput = detailEl.querySelector('.video-capture-event-duration');
    if (durationInput) {
      durationInput.addEventListener('change', (ev) => {
        const v = parseFloat(ev.target.value);
        setEventDuration(e, isNaN(v) ? null : v);
        changed();
      });
    }
    const sliderValInput = detailEl.querySelector('.video-capture-event-slidervalue');
    if (sliderValInput) {
      sliderValInput.addEventListener('change', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!isNaN(v)) e.detail.value = Math.max(0, Math.min(1, v / 100));
        changed();
      });
    }
    const yawInput = detailEl.querySelector('.video-capture-event-yaw');
    if (yawInput) {
      yawInput.addEventListener('change', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!isNaN(v)) e.detail.yaw = Math.max(-180, Math.min(180, v));
        changed();
      });
    }
    const duckInput = detailEl.querySelector('.video-capture-event-duck');
    if (duckInput) {
      duckInput.addEventListener('change', (ev) => {
        e.detail.duck = ev.target.checked;
        if (onChange) onChange();
      });
    }
    detailEl.querySelector('.video-capture-event-del').addEventListener('click', () => {
      // Supprimer une bascule supprime aussi ce qu'elle a déclenché.
      window.LayerCapturePlan.linkedMarks(events, e).forEach(m => { const j = events.indexOf(m); if (j >= 0) events.splice(j, 1); });
      events.splice(events.indexOf(e), 1);
      container.__vctSelectedEvent = null;
      changed();
    });
  }

  // Glisser-déposer façon DAW : écouteurs posés sur `document` (pas sur le bloc lui-même) pour survivre
  // au réaffichage complet de la frise à chaque mouvement -- un bloc recréé en plein geste perdrait sinon
  // la capture du pointeur. `kind` distingue déplacer (IN) de redimensionner (durée, uniquement depuis la
  // poignée -- stingers et segments de calque seulement, jamais les boucles). Un mouvement sous 3px au
  // relâché est traité comme un simple clic (ouvre le détail).
  //
  // Bornes de glisser (signalé par Jules-Antoine 2026-09-15) : SEULES les boucles (embr_loop_select)
  // partagent encore un point avec leur voisine -- on ne doit jamais les faire se croiser (fenêtres
  // inversées, rendu incohérent), calculé une fois au début du geste à partir des voisines ORIGINALES
  // pour un comportement stable pendant tout le glisser. Les segments de calque et les stingers, eux,
  // sont indépendants (matérialisés/toujours-été autonomes) : aucune borne de voisinage, on ne fait que
  // les déplacer comme un bloc entier -- jamais "rogner" leur début, exactement ce que demandait
  // Jules-Antoine (le bloc entier glisse, sa durée propre ne change jamais au déplacement).
  function startDrag(pointerDownEvent, idx, kind) {
    pointerDownEvent.preventDefault();
    pointerDownEvent.stopPropagation();
    const el = pointerDownEvent.currentTarget.closest('.vct-block');
    const trackEl = el.closest('.vct-lane-track');
    const trackRect = trackEl.getBoundingClientRect();
    const startX = pointerDownEvent.clientX;
    // Document COURANT de l'élément, pas le `document` global figé à l'ouverture du script (2026-09-16,
    // nécessaire pour la fenêtre détachée -- voir detachCapturePanel) : une fois le panneau déplacé dans
    // une autre fenêtre via appendChild, ses éléments changent réellement d'ownerDocument, mais les
    // mouvements de souris dans CETTE fenêtre-là ne sont jamais reçus par l'ancien document.
    const doc = pointerDownEvent.currentTarget.ownerDocument || document;
    const frame = dragFrame(doc);
    const e = events[idx];
    const startT = e.t;
    const startDuration = hasIndependentDuration(e) ? getEventDuration(e) : 1;
    const EPS = 0.05;
    // Boucles (embranchement-vertical), les 4 types d'événements du séquentiel (emplacement, transition,
    // intro, outro -- une seule chronologie partagée, voir buildSeqTimelineWindows) ET les 3 types du
    // vertical-random (intro, section, outro -- voir buildVRTimelineWindows) gardent encore un point avec
    // leur voisin (une seule variation audible à la fois, la fenêtre suivante démarre pile où celle-ci
    // finit) -- jamais les laisser se croiser. Un emplacement séquentiel doit donc être borné par SES
    // voisins immédiats quel que soit LEUR type précis (ex. une transition qui le suit), pas seulement par
    // d'autres emplacements -- pareil pour une section vertical-random face à l'intro/outro -- d'où un
    // groupe de chaînage par famille plutôt qu'une simple égalité de nom. Calques et stingers, eux, sont
    // totalement indépendants (voir hasIndependentDuration).
    const isChainPoint = e.name === 'embr_loop_select' || SEQ_TIMELINE_EVENT_NAMES.indexOf(e.name) !== -1 || VR_TIMELINE_EVENT_NAMES.indexOf(e.name) !== -1;
    const chainGroupNames = SEQ_TIMELINE_EVENT_NAMES.indexOf(e.name) !== -1 ? SEQ_TIMELINE_EVENT_NAMES
      : VR_TIMELINE_EVENT_NAMES.indexOf(e.name) !== -1 ? VR_TIMELINE_EVENT_NAMES : null;
    let minT = 0, maxT = total;
    if (kind === 'move' && isChainPoint) {
      let minNeighbor = 0, maxNeighbor = total;
      events.forEach(o => {
        if (o === e || o.detail.trackId !== e.detail.trackId) return;
        const sameChain = chainGroupNames ? chainGroupNames.indexOf(o.name) !== -1 : o.name === e.name;
        if (!sameChain) return;
        if (o.t < startT && o.t > minNeighbor) minNeighbor = o.t;
        if (o.t > startT && o.t < maxNeighbor) maxNeighbor = o.t;
      });
      minT = minNeighbor + EPS; maxT = maxNeighbor - EPS;
    }
    let moved = false;
    // Une bascule d'embranchement emporte avec elle ce qu'elle a déclenché (transition, baisse de la boucle quittée,
    // retour automatique...) -- voir LayerCapturePlan.linkedMarks.
    const linked = kind === 'move' ? window.LayerCapturePlan.linkedMarks(events, e) : [];
    const linkedStartTs = linked.map(m => m.t);
    function onMove(ev) {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      let dt = dx / trackRect.width * total;
      if (kind === 'move') {
        const dur = hasIndependentDuration(e) ? getEventDuration(e) : 0;
        dt += snapDelta(dur ? [startT + dt, startT + dt + dur] : [startT + dt], snapTargets([e].concat(linked), null), ev, trackRect.width);
        e.t = isChainPoint ? Math.min(Math.max(startT + dt, minT), maxT) : Math.max(0, startT + dt);
        linked.forEach((m, i) => { m.t = Math.max(0, linkedStartTs[i] + (e.t - startT)); });
      } else {
        const endT = startT + startDuration + dt;
        dt += snapDelta([endT], snapTargets([e], null), ev, trackRect.width);
        setEventDuration(e, startDuration + dt);
      }
      frame.schedule();
    }
    function onUp() {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onUp);
      frame.cancel();
      clearSnapGuide();
      if (!moved) {
        // Un frémissement de souris (moins de 3 px) ne change rien : on remet le bloc exactement où il était (sinon la frise et
        // le son calculé divergent en silence, aucune retouche n'étant signalée).
        if (kind === 'move') { e.t = startT; linked.forEach((m, i) => { m.t = linkedStartTs[i]; }); }
        // Pas de vrai glisser : un simple clic, on rouvre juste le détail du bloc.
        const freshEl = container.querySelector(`.vct-block[data-idx="${idx}"]`);
        if (freshEl) selectBlock(idx, freshEl);
        return;
      }
      if (kind === 'move') events.sort((a, b) => a.t - b.t); // garde l'ordre chronologique après le glisser
      changed();
    }
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('pointercancel', onUp);
  }
  container.querySelectorAll('.vct-block:not(.vct-block-group)').forEach(el => {
    const idx = parseInt(el.dataset.idx, 10);
    if (idx < 0) return; // fenêtre implicite de départ (avant le premier vrai clic) -- pas interactive
    if (el.classList.contains('vct-stop')) {
      el.addEventListener('click', () => selectBlock(idx, el)); // arrêt : réglage du fondu seulement
      // Fondu à la main (10/11, demande de Jules-Antoine, comme la poignée de fondu d'une région dans Logic) : on tire le bord droit de l'arrêt.
      const fh = el.querySelector('.vct-fade-handle');
      if (fh && events[idx]) fh.addEventListener('pointerdown', ev => {
        if (ev.button !== 0 || videoCaptureState) return;
        ev.preventDefault(); ev.stopPropagation();
        const e0 = events[idx];
        const r = container.querySelector('.vct-ruler').getBoundingClientRect();
        const onMove = m => {
          const sec = Math.max(0, Math.min(10, Math.round(((m.clientX - r.left) / r.width * total - e0.t) * 10) / 10));
          if (sec > 0) e0.detail.fadeSec = sec; else delete e0.detail.fadeSec;
          el.style.width = (pct(e0.t + Math.max(sec, 0.3)) - pct(e0.t)) + '%';
          el.classList.toggle('vct-stop-fade', sec > 0);
        };
        const onUp = () => {
          ownerDoc.removeEventListener('pointermove', onMove);
          ownerDoc.removeEventListener('pointerup', onUp);
          ownerDoc.removeEventListener('pointercancel', onUp);
          changed();
        };
        ownerDoc.addEventListener('pointermove', onMove);
        ownerDoc.addEventListener('pointerup', onUp);
        ownerDoc.addEventListener('pointercancel', onUp);
      });
      return;
    }
    el.addEventListener('pointerdown', (ev) => startDrag(ev, idx, 'move'));
    const handle = el.querySelector('.vct-resize-handle');
    if (handle) handle.addEventListener('pointerdown', (ev) => startDrag(ev, idx, 'resize'));
  });

  // Glisser le bloc-résumé d'un groupe entier : décale TOUS ses membres (mêmes trackId/sfxId) du même
  // delta, ce qui préserve automatiquement leur espacement relatif -- pas besoin de borner contre des
  // voisins internes (l'ordre entre membres du même groupe ne change jamais), seulement d'empêcher le
  // membre le plus tôt de passer sous 0.
  function startGroupDrag(pointerDownEvent, key) {
    pointerDownEvent.preventDefault();
    pointerDownEvent.stopPropagation();
    const trackRect = pointerDownEvent.currentTarget.closest('.vct-lane-track').getBoundingClientRect();
    const startX = pointerDownEvent.clientX;
    const doc = pointerDownEvent.currentTarget.ownerDocument || document; // voir startDrag ci-dessus
    const frame = dragFrame(doc);
    const members = groupMembers(key);
    if (!members.length) return;
    const startTs = members.map(m => m.t);
    const minStartT = Math.min(...startTs);
    let moved = false;
    function onMove(ev) {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      let dt = dx / trackRect.width * total;
      dt += snapDelta([minStartT + dt], snapTargets(members, null), ev, trackRect.width);
      dt = Math.max(dt, -minStartT); // n'autorise jamais un membre à passer sous 0
      members.forEach((m, i) => { m.t = startTs[i] + dt; });
      frame.schedule();
    }
    function onUp() {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onUp);
      frame.cancel();
      clearSnapGuide();
      if (!moved) { members.forEach((m, i) => { m.t = startTs[i]; }); rerender(); return; } // frémissement < 3 px : rien n'a bougé
      events.sort((a, b) => a.t - b.t);
      changed();
    }
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('pointercancel', onUp);
  }
  container.querySelectorAll('.vct-block-group').forEach(el => {
    el.addEventListener('pointerdown', (ev) => startGroupDrag(ev, el.dataset.groupKey));
  });

  // Clic sur une zone vide d'une piste = crée un nouveau bloc à cet endroit (calque, boucle ou stinger --
  // même geste partout, seul le type d'événement créé change selon la piste) -- pour les cas où rien n'a
  // été cliqué pendant la prise (silence réel au début, par exemple) mais où quelque chose doit en fait
  // se jouer là (2026-09-15, à la demande de Jules-Antoine : le silence par défaut reste correct, mais il
  // doit pouvoir ajouter du son là où il en veut plutôt que subir une hypothèse automatique). Durée de
  // départ 3s pour les calques/boucles (ajustable ensuite) ; les stingers gardent leur longueur d'origine
  // tant qu'on ne retouche pas leur durée. `ev.target !== trackEl` exclut les clics qui viennent en fait
  // d'un bloc existant (déjà géré par startDrag/selectBlock).
  // Double-clic (05/11, demande de Jules-Antoine) : un simple clic dans une zone vide ajoutait un bloc par mégarde.
  container.querySelectorAll('.vct-lane-track[data-addable]').forEach(trackEl => {
    trackEl.addEventListener('dblclick', (ev) => {
      if (ev.target !== trackEl) return;
      const rect = trackEl.getBoundingClientRect();
      const t = Math.max(0, (ev.clientX - rect.left) / rect.width * total);
      const kind = trackEl.dataset.addable;
      if (kind === 'layer') {
        // Départ d'une couche : elle joue jusqu'à la fin de la musique de ce morceau dans la prise (ou 3 s s'il n'y a rien après).
        const tId = trackEl.dataset.addTrackId;
        const musicEnd = Math.max(0, ...events.filter(o => o.detail && o.detail.trackId === tId).map(o => o.t + ((o.name === 'layer_segment' || o.name === 'fx_segment') ? o.detail.duration : 0)));
        // Rien après (montage à la souris, première couche posée) : jusqu'à la fin de la vidéo.
        const videoEnd = (videoEl && Number.isFinite(videoEl.duration)) ? videoEl.duration : 0;
        // Morceau quantifié qui joue déjà : la couche entre à la mesure suivante (05/11, demande de Jules-Antoine), sur la grille du morceau,
        // comptée depuis son premier bloc.
        let at = t;
        const trk = findCaptureTrack(tId);
        const starts = events.filter(o => o.name === 'layer_segment' && o.detail.trackId === tId).map(o => o.t);
        if (trk && trk.loopEngine === 'quantized' && starts.length) {
          const anchor = Math.min(...starts);
          const bar = (Number(trk.beatsPerBar) || 4) * 60 / (Number(trk.bpm) || 120);
          if (at > anchor && bar > 0) at = anchor + Math.ceil((at - anchor) / bar - 1e-3) * bar;
        }
        const end = musicEnd > at + 0.5 ? musicEnd : (videoEnd > at + 0.5 ? videoEnd : at + 3);
        events.push({ t: at, name: 'layer_segment', detail: { trackId: tId, layerIndex: parseInt(trackEl.dataset.addLevel, 10), duration: end - at } });
      } else if (kind === 'loop') {
        events.push({ t, name: 'embr_loop_select', detail: { trackId: trackEl.dataset.addTrackId, loopId: trackEl.dataset.addLoopId } });
      } else if (kind === 'sfx') {
        events.push({ t, name: 'stinger_play', detail: { sfxId: trackEl.dataset.addSfxId, variationIndex: parseInt(trackEl.dataset.addVariation, 10) } });
      } else if (kind === 'slot') {
        events.push({ t, name: 'seq_slot_start', detail: { trackId: trackEl.dataset.addTrackId, slotId: trackEl.dataset.addSlotId, altIndex: 0 } });
      } else if (kind === 'fxseg') {
        events.push({ t, name: 'fx_segment', detail: { trackId: trackEl.dataset.addTrackId, triggerId: trackEl.dataset.addTriggerId, duration: 3 } });
      } else if (kind === 'fxslider') {
        // Nouveau point-clé : reprend la valeur du point précédent de ce curseur (ou sa position de départ).
        const tId = trackEl.dataset.addTrackId, sId = trackEl.dataset.addSliderId;
        const prev = events.filter(o => o.name === 'fx_slider' && o.detail.trackId === tId && o.detail.sliderId === sId && o.t <= t).sort((a, b) => b.t - a.t)[0];
        const trk = findCaptureTrack(tId);
        const def = trk ? window.LayerPlayerCore.fxSlidersValid(trk).find(x => x.id === sId) : null;
        events.push({ t, name: 'fx_slider', detail: { trackId: tId, sliderId: sId, value: prev ? prev.detail.value : (def ? def.def : 0) } });
      } else if (kind === 'head') {
        events.push({ t, name: 'head_turn', detail: { yaw: 0 } });
      } else {
        return;
      }
      events.sort((a, b) => a.t - b.t);
      changed();
    });
  });

  // Renommage d'une piste pour cette prise -- calques (vertical), boucles (embranchement-vertical) ou
  // emplacements (séquentiel), même mécanique : clic sur le nom, remplacé par un champ texte, validé par
  // Entrée ou en cliquant ailleurs. Le morceau concerné est résolu via data-track-id porté par
  // l'étiquette (plusieurs morceaux possibles dans la même prise, voir ci-dessus).
  container.querySelectorAll('.vct-lane-label[data-lane-kind="layer"], .vct-lane-label[data-lane-kind="loop"], .vct-lane-label[data-lane-kind="slot"]').forEach(labelEl => {
    labelEl.addEventListener('click', () => {
      const kind = labelEl.dataset.laneKind;
      const trk = findCaptureTrack(labelEl.dataset.trackId);
      if (!trk) return;
      const levelIdx = kind === 'layer' ? parseInt(labelEl.dataset.level, 10) : null;
      const loopId = kind === 'loop' ? labelEl.dataset.loopId : null;
      const slotId = kind === 'slot' ? labelEl.dataset.slotId : null;
      const key = kind === 'loop' ? (trk.id + ':loop:' + loopId) : kind === 'slot' ? (trk.id + ':slot:' + slotId) : (trk.id + ':' + levelIdx);
      const current = kind === 'loop' ? captureLoopLaneLabel(trk, loopId, laneOverrides)
        : kind === 'slot' ? captureSlotLaneLabel(trk, slotId, laneOverrides)
        : captureLaneLabel(trk, levelIdx, laneOverrides);
      const realDefault = kind === 'loop' ? (((trk.loops || []).find(l => l.id === loopId) || {}).label || '')
        : kind === 'slot' ? (((trk.segmentSlots || []).find(s => s.id === slotId) || {}).label || '')
        : ((trk.layers[levelIdx] || {}).label || '');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'vct-lane-rename-input';
      input.value = current;
      labelEl.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      function commit() {
        if (done) return;
        done = true;
        const v = input.value.trim();
        const before = laneOverrides[key];
        if (v && v !== realDefault) laneOverrides[key] = v;
        else delete laneOverrides[key];
        if (laneOverrides[key] !== before) changed(); else rerender();
      }
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); done = true; rerender(); } // annuler : le « blur » qui suit ne valide rien
      });
      input.addEventListener('blur', commit);
    });
  });

  // Bloc sélectionné avant ce nouvel affichage : son détail reste ouvert (avant le 12/11, il se refermait dès que la frise se redessinait
  // d'elle-même -- enregistrement automatique, remarques client -- et l'on perdait la retouche en cours de saisie).
  const selEvent = container.__vctSelectedEvent;
  if (selEvent && !container.__vctSelectedMarker) {
    const selIdx = events.indexOf(selEvent);
    const selEl = selIdx >= 0 ? container.querySelector(`.vct-block[data-idx="${selIdx}"]`) : null;
    if (selEl) selectBlock(selIdx, selEl);
    else if (selIdx < 0) container.__vctSelectedEvent = null;
  }

  // Glisser : au plus un réaffichage complet par image de l'écran (le navigateur envoie souvent plusieurs mouvements de souris par image ;
  // chacun redessinait toute la frise). cancel() au relâché : le dernier affichage est fait tout de suite, sans attendre l'image suivante.
  function dragFrame(doc) {
    const win = doc.defaultView || ownerWin;
    let id = 0;
    return {
      schedule() { if (!id) id = win.requestAnimationFrame(() => { id = 0; rerender(); }); },
      cancel() { if (id) { win.cancelAnimationFrame(id); id = 0; } },
    };
  }
}

