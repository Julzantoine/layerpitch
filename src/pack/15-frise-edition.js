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
  const containerRect = container.getBoundingClientRect();
  const rulerRect = ruler.getBoundingClientRect();
  const total = container.__vctTotal || videoEl.duration || 1;
  const t = videoEl.currentTime || 0;
  const leftPx = (rulerRect.left - containerRect.left) + Math.min(1, Math.max(0, t / total)) * rulerRect.width;
  ph.style.left = leftPx + 'px';
}

function renderCaptureTimeline(container, events, editable, onChange, laneOverrides, collapsedGroups, videoEl) {
  laneOverrides = laneOverrides || {};
  collapsedGroups = collapsedGroups || {};
  if (!events.length) {
    container.innerHTML = `<div class="vct-empty">${tr('captureTimelineEmpty')}</div>`;
    return;
  }
  const rerender = () => renderCaptureTimeline(container, events, editable, onChange, laneOverrides, collapsedGroups, videoEl);
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
  const total = Math.max(lastT + 1, 5); // au moins 5s de large à l'écran, + 1s de marge après le dernier événement
  const tickStep = total <= 20 ? 1 : (total <= 60 ? 5 : 10);
  const pct = (t) => Math.min(100, Math.max(0, t / total * 100));

  let ticksHtml = '';
  for (let t = 0; t <= total; t += tickStep) {
    ticksHtml += `<div class="vct-tick" style="left:${pct(t)}%">${t}s</div>`;
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
  function renderGroup(key, headerLabel, colorClass, nestedLanesHtml) {
    const collapsed = !!collapsedGroups[key];
    const members = groupMembers(key);
    let blockHtml = '';
    if (editable && members.length) {
      const isMusic = key.indexOf('track:') === 0;
      const start = isMusic ? 0 : Math.min(...members.map(m => m.t));
      const end = isMusic ? total : Math.max(...members.map(m => m.t + (m.name === 'head_turn' ? 0.5 : (m.detail.durationOverride || 1))));
      blockHtml = `<div class="vct-block vct-block-group" data-group-key="${window.LayerPlayerCore.escapeHtml(key)}" ` +
        `title="${tr('captureGroupDragHint')}" style="left:${pct(start)}%;width:${pct(end) - pct(start)}%"></div>`;
    }
    const headerRow = `<div class="vct-lane vct-group-summary">` +
      `<div class="vct-lane-label vct-track-group-header" data-group-key="${window.LayerPlayerCore.escapeHtml(key)}">` +
      `<span class="vct-group-chevron">${collapsed ? '▸' : '▾'}</span>${window.LayerPlayerCore.escapeHtml(headerLabel)}</div>` +
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
  let lanesHtml = '';
  Object.keys(sfxGroups).forEach(sid => {
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
      if (trackLayerEvents.length) {
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

  container.__vctTotal = total;
  container.innerHTML = `
    <div class="vct-ruler">${ticksHtml}</div>
    <div class="vct-lanes">${lanesHtml}</div>
    <div class="vct-playhead" id="vctPlayhead"></div>
    <div class="vct-detail" id="vctDetail"><span class="vct-detail-empty">${editable ? tr('captureTimelineHint') : ''}</span></div>
  `;
  positionCapturePlayhead(container, videoEl);
  container.querySelectorAll('.vct-track-group-header').forEach(headerEl => {
    headerEl.addEventListener('click', () => {
      const key = headerEl.dataset.groupKey;
      collapsedGroups[key] = !collapsedGroups[key];
      rerender();
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

  function selectBlock(idx, el) {
    container.querySelectorAll('.vct-block').forEach(b => b.classList.remove('vct-selected'));
    el.classList.add('vct-selected');
    const e = events[idx];
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
      e.t = isNaN(v) ? e.t : Math.max(0, v);
      events.sort((a, b) => a.t - b.t); // garde l'ordre chronologique après une retouche manuelle
      rerender();
      onChange && onChange();
    });
    const durationInput = detailEl.querySelector('.video-capture-event-duration');
    if (durationInput) {
      durationInput.addEventListener('change', (ev) => {
        const v = parseFloat(ev.target.value);
        setEventDuration(e, isNaN(v) ? null : v);
        rerender();
        onChange && onChange();
      });
    }
    const sliderValInput = detailEl.querySelector('.video-capture-event-slidervalue');
    if (sliderValInput) {
      sliderValInput.addEventListener('change', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!isNaN(v)) e.detail.value = Math.max(0, Math.min(1, v / 100));
        rerender();
        onChange && onChange();
      });
    }
    const yawInput = detailEl.querySelector('.video-capture-event-yaw');
    if (yawInput) {
      yawInput.addEventListener('change', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!isNaN(v)) e.detail.yaw = Math.max(-180, Math.min(180, v));
        rerender();
        onChange && onChange();
      });
    }
    const duckInput = detailEl.querySelector('.video-capture-event-duck');
    if (duckInput) {
      duckInput.addEventListener('change', (ev) => {
        e.detail.duck = ev.target.checked;
        onChange && onChange();
      });
    }
    detailEl.querySelector('.video-capture-event-del').addEventListener('click', () => {
      // Supprimer une bascule supprime aussi ce qu'elle a déclenché.
      window.LayerCapturePlan.linkedMarks(events, e).forEach(m => { const j = events.indexOf(m); if (j >= 0) events.splice(j, 1); });
      events.splice(events.indexOf(e), 1);
      rerender();
      onChange && onChange();
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
      const dt = dx / trackRect.width * total;
      if (kind === 'move') {
        e.t = isChainPoint ? Math.min(Math.max(startT + dt, minT), maxT) : Math.max(0, startT + dt);
        linked.forEach((m, i) => { m.t = Math.max(0, linkedStartTs[i] + (e.t - startT)); });
      } else {
        setEventDuration(e, startDuration + dt);
      }
      rerender();
    }
    function onUp() {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      if (!moved) {
        // Pas de vrai glisser : un simple clic, on rouvre juste le détail du bloc.
        const freshEl = container.querySelector(`.vct-block[data-idx="${idx}"]`);
        if (freshEl) selectBlock(idx, freshEl);
        return;
      }
      if (kind === 'move') events.sort((a, b) => a.t - b.t); // garde l'ordre chronologique après le glisser
      rerender();
      onChange && onChange();
    }
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
  }
  container.querySelectorAll('.vct-block:not(.vct-block-group)').forEach(el => {
    const idx = parseInt(el.dataset.idx, 10);
    if (idx < 0) return; // fenêtre implicite de départ (avant le premier vrai clic) -- pas interactive
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
    const members = groupMembers(key);
    if (!members.length) return;
    const startTs = members.map(m => m.t);
    const minStartT = Math.min(...startTs);
    let moved = false;
    function onMove(ev) {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      let dt = dx / trackRect.width * total;
      dt = Math.max(dt, -minStartT); // n'autorise jamais un membre à passer sous 0
      members.forEach((m, i) => { m.t = startTs[i] + dt; });
      rerender();
    }
    function onUp() {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      if (!moved) return;
      events.sort((a, b) => a.t - b.t);
      rerender();
      onChange && onChange();
    }
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
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
  container.querySelectorAll('.vct-lane-track[data-addable]').forEach(trackEl => {
    trackEl.addEventListener('click', (ev) => {
      if (ev.target !== trackEl) return;
      const rect = trackEl.getBoundingClientRect();
      const t = Math.max(0, (ev.clientX - rect.left) / rect.width * total);
      const kind = trackEl.dataset.addable;
      if (kind === 'layer') {
        events.push({ t, name: 'layer_segment', detail: { trackId: trackEl.dataset.addTrackId, layerIndex: parseInt(trackEl.dataset.addLevel, 10), duration: 3 } });
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
      rerender();
      onChange && onChange();
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
      function commit() {
        const v = input.value.trim();
        if (v && v !== realDefault) laneOverrides[key] = v;
        else delete laneOverrides[key];
        rerender();
      }
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); rerender(); }
      });
      input.addEventListener('blur', commit);
    });
  });
}

