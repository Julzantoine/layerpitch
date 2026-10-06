// Effets audio par couche (chantier "effets dynamiques", 22/09) -- filtre/reverb/écho/bitcrusher,
// réglages fixes pour l'instant (pas d'automatisation/déclenchement -- prévu dans un second temps,
// cf. discussion produit). Un seul point de vérité pour ne pas dupliquer le markup entre le mode
// statique (une seule couche, li=null) et le mode vertical (une couche par li).
// fxBlockHtml : cœur générique, indépendant du mode de lecture -- extraAttrs porte les data-* qui disent
// à quel objet appliquer le réglage (couche, boucle, emplacement séquentiel, pool vertical-random). Les
// 4 fonctions fooFxHtml ci-dessous ne sont que des façades qui fixent extraAttrs pour chaque cas, pour
// ne jamais dupliquer le markup des 4 effets à chaque nouveau mode qui les gagne.
// Courbe de réponse d'un filtre (Butterworth : l'ordre vaut raideur / 6, soit 12 dB par octave = ordre 2). Axe horizontal logarithmique
// 20 Hz -> 20 kHz, axe vertical 0 -> -60 dB. Pure : renvoie le contenu du SVG, réutilisée pour la mise à jour en direct.
const FX_GRAPH = { w: 260, h: 96, padL: 26, padR: 8, padT: 6, padB: 16, minDb: -60 };
function fxFilterGain(kind, f, fc, slope) {
  const n = (+slope || 24) / 6;
  const ratio = kind === 'lowcut' ? fc / f : f / fc;
  return -10 * Math.log10(1 + Math.pow(ratio, 2 * n));
}
function fxFilterGraphInner(kind, freq, slope) {
  const g = FX_GRAPH, iw = g.w - g.padL - g.padR, ih = g.h - g.padT - g.padB;
  const lo = Math.log10(20), span = Math.log10(20000) - lo;
  const X = f => g.padL + (Math.log10(Math.min(20000, Math.max(20, f))) - lo) / span * iw;
  const Y = db => g.padT + Math.min(1, Math.max(0, -db / -g.minDb)) * ih;
  const fc = Math.min(20000, Math.max(20, +freq || (kind === 'lowcut' ? 150 : 3000)));
  const pts = [];
  for (let i = 0; i <= 120; i++) { const f = Math.pow(10, lo + span * i / 120); pts.push(X(f).toFixed(1) + ',' + Y(fxFilterGain(kind, f, fc, slope)).toFixed(1)); }
  const base = (g.padT + ih).toFixed(1);
  const grid = [100, 1000, 10000].map(f => `<line x1="${X(f).toFixed(1)}" x2="${X(f).toFixed(1)}" y1="${g.padT}" y2="${base}" stroke="var(--border,#ddd)" stroke-width="1"/><text x="${X(f).toFixed(1)}" y="${g.h - 3}" text-anchor="middle" font-size="9" fill="var(--text-dim,#888)">${f >= 1000 ? (f / 1000) + 'k' : f}</text>`).join('')
    + [0, -20, -40, -60].map(db => `<line x1="${g.padL}" x2="${g.w - g.padR}" y1="${Y(db).toFixed(1)}" y2="${Y(db).toFixed(1)}" stroke="var(--border,#ddd)" stroke-width="1"/><text x="${g.padL - 3}" y="${(Y(db) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-dim,#888)">${db}</text>`).join('');
  const fcLabel = (fc >= 1000 ? (Math.round(fc / 100) / 10) + ' kHz' : Math.round(fc) + ' Hz');
  const right = X(fc) > g.w / 2;
  return grid
    + `<polygon points="${g.padL},${base} ${pts.join(' ')} ${(g.w - g.padR)},${base}" fill="var(--accent,#2f80c0)" opacity="0.14"/>`
    + `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent,#2f80c0)" stroke-width="2" stroke-linejoin="round"/>`
    + `<line x1="${X(fc).toFixed(1)}" x2="${X(fc).toFixed(1)}" y1="${g.padT}" y2="${base}" stroke="var(--accent,#2f80c0)" stroke-width="1" stroke-dasharray="3 3"/>`
    + `<text x="${(X(fc) + (right ? -4 : 4)).toFixed(1)}" y="${g.padT + 9}" text-anchor="${right ? 'end' : 'start'}" font-size="10" font-weight="600" fill="var(--accent,#2f80c0)">${fcLabel}</text>`;
}
function fxFilterGraphHtml(kind, freq, slope) {
  return `<svg data-fx-graph="${kind}" viewBox="0 0 ${FX_GRAPH.w} ${FX_GRAPH.h}" width="100%" style="max-width:340px;display:block;margin-top:6px" role="img" aria-label="${escapeAttr(tr('fxGraphLabel'))}">${fxFilterGraphInner(kind, freq, slope)}</svg>`;
}
// Mise à jour en direct quand on change la fréquence ou la raideur.
document.addEventListener('input', e => {
  const t = e.target, k = t && t.dataset && t.dataset.fxEffect;
  if (!t.dataset || t.dataset.field !== 'fx' || (k !== 'lowcut' && k !== 'highcut')) return;
  const box = t.closest('[data-fx-box]'), svg = box && box.querySelector('svg[data-fx-graph]');
  if (!svg) return;
  const f = box.querySelector('[data-fx-param="frequency"]'), sl = box.querySelector('[data-fx-param="slope"]');
  svg.innerHTML = fxFilterGraphInner(k, f && f.value, sl && sl.value);
}, true);

// Paliers « léger / moyen / dur » : un clic remplit les champs du réglage (mêmes événements que la frappe : rien d'autre à câbler).
// Filtres : seule la fréquence change (la raideur reste celle choisie).
const FX_PRESETS = {
  lowcut:   [{ frequency: 80 }, { frequency: 200 }, { frequency: 500 }],
  highcut:  [{ frequency: 12000 }, { frequency: 5000 }, { frequency: 1500 }],
  reverb:   [{ decay: 0.8, wet: 0.2 }, { decay: 2, wet: 0.3 }, { decay: 5, wet: 0.45 }],
  delay:    [{ time: 0.12, feedback: 0.2, wet: 0.2 }, { time: 0.3, feedback: 0.35, wet: 0.25 }, { time: 0.6, feedback: 0.5, wet: 0.3 }],
  bitcrush: [{ bits: 10, reduction: 2 }, { bits: 6, reduction: 6 }, { bits: 3, reduction: 12 }]
};
const FX_PRESET_KEYS = ['fxPresetLight', 'fxPresetMedium', 'fxPresetHard'];
function fxPresetMatches(effect, level, cur) {
  const p = FX_PRESETS[effect][level];
  return !!cur && Object.keys(p).every(k => +cur[k] === p[k]);
}
function fxPresetsHtml(effect, cur, disabled) {
  return `<div style="margin-top:6px;display:flex;align-items:center;gap:4px;flex-wrap:wrap" data-fx-presets="${effect}">
    <span class="hint-inline" style="margin:0 4px 0 0">${tr('fxPresetsLabel')}</span>
    ${FX_PRESET_KEYS.map((k, i) => `<button type="button" class="btn btn-small${fxPresetMatches(effect, i, cur) ? ' primary' : ''}" data-fx-preset="${effect}" data-fx-level="${i}" ${disabled ? 'disabled' : ''}>${tr(k)}</button>`).join('')}
  </div>`;
}
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-fx-preset]');
  if (!btn || btn.disabled) return;
  const effect = btn.dataset.fxPreset, preset = FX_PRESETS[effect] && FX_PRESETS[effect][+btn.dataset.fxLevel];
  const box = btn.closest('[data-fx-box]');
  if (!preset || !box) return;
  Object.keys(preset).forEach(param => {
    const input = box.querySelector(`[data-fx-param="${param}"]`);
    if (!input) return;
    input.value = String(preset[param]);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  btn.closest('[data-fx-presets]').querySelectorAll('[data-fx-preset]').forEach(b => b.classList.toggle('primary', b === btn));
});
function fxBlockHtml(fx, extraAttrs) {
  fx = fx || {};
  const lc = fx.lowcut, hc = fx.highcut, r = fx.reverb, d = fx.delay, b = fx.bitcrush;
  // Pitch grisé pour tout compte non-admin (22/09, demande de Jules-Antoine) tant que la synchro
  // "vitesse" avec le planificateur n'a pas été testée en conditions réelles -- même patron que la
  // bibliothèque vidéo (currentUserIsAdmin, confort d'affichage client, cf. renderAdminOnlyPanels()).
  // Pas de barrière serveur pour l'instant (à durcir dans upsert_track si un jour nécessaire) : un
  // réglage qualité propre au compositeur, pas un enjeu de sécurité/business comme "pack en vente".
  // 23/09 (demande de Jules-Antoine) : TOUS les effets (volume, filtre, reverb, écho, bitcrusher, pitch) sont
  // désormais grisés pour tout compte non-admin, en attendant son feu vert -- pas seulement le pitch.
  // 28/09 : grisage lu dans les feux verts (feature_flags : pitch, fx_per_voice ; 'audio_fx' ouvre tout).
  const pitchDisabled = !fxOpen('pitch');
  const gated = !fxOpen('fx_per_voice');
  // Dans la carte d'un TRIGGER, le fondu se règle par les deux champs « entrée / sortie » du trigger lui-même : les champs de
  // fondu propres au filtre (utiles à l'apparition d'une voix, pas à l'appui d'un bouton) sont masqués pour éviter la confusion.
  const isTriggerBlock = /data-fx-target="(trigger|trstep)"/.test(extraAttrs || '');
  function num(effect, param, value, labelKey, step, min, max, disabled) {
    if (disabled === undefined) disabled = gated;
    return `<div style="margin-top:4px"><label style="font-size:0.85em">${tr(labelKey)}</label>
      <input type="number" step="${step}" min="${min}" max="${max}" ${disabled ? 'disabled' : ''}
        data-field="fx" data-fx-effect="${effect}" data-fx-param="${param}" ${extraAttrs} value="${value}"></div>`;
  }
  // Champ de fondu optionnel (filtre/pitch) : vide par défaut (= pas de fondu), pas de min/max forcé --
  // une case vidée par le compositeur redevient "pas de fondu" (voir le handler, qui stocke null plutôt
  // que NaN dans ce cas), pas une valeur à zéro.
  function numOptional(effect, param, value, labelKey, step, disabled) {
    if (disabled === undefined) disabled = gated;
    return `<div style="margin-top:4px"><label style="font-size:0.85em">${tr(labelKey)}</label>
      <input type="number" step="${step}" ${disabled ? 'disabled' : ''}
        data-field="fx" data-fx-effect="${effect}" data-fx-param="${param}" ${extraAttrs} value="${value != null ? value : ''}"></div>`;
  }
  function toggle(effect, enabled, labelKey, extraFields, disabled) {
    if (disabled === undefined) disabled = gated;
    return `
      <div style="margin-top:8px;padding:8px;border:1px solid var(--border);border-radius:6px${disabled ? ';opacity:0.55' : ''}">
        <label style="display:flex;align-items:center;gap:6px;margin:0">
          <input type="checkbox" data-field="fx" data-fx-effect="${effect}" data-fx-param="enabled" ${extraAttrs} ${enabled ? 'checked' : ''} ${disabled ? 'disabled' : ''} style="width:auto;margin:0">
          ${tr(labelKey)}${disabled ? `<span class="hint-inline" style="margin:0 0 0 6px">${tr('fxAdminOnlyHint')}</span>` : ''}
        </label>
        ${enabled ? `<div style="margin-top:6px">${extraFields}</div>` : ''}
      </div>
    `;
  }
  // Panneau repliable (25/09, demande de Jules-Antoine : la liste des 7 effets allonge beaucoup chaque
  // couche/pool/boucle) -- replié par défaut, le nombre d'effets actifs reste visible sur le bouton.
  // L'état ouvert est mémorisé dans expandedAltPoolKeys (clé dérivée de extraAttrs, qui identifie
  // l'objet porteur) pour survivre aux re-rendus. Pas de repli dans la carte d'un trigger, où les
  // effets sont le contenu même de la carte.
  const fxKey = 'fx:' + (extraAttrs || '').replace(/\s+/g, ' ').trim();
  const expanded = isTriggerBlock || expandedAltPoolKeys.has(fxKey);
  const activeCount = ['volume', 'lowcut', 'highcut', 'pitch', 'reverb', 'delay', 'bitcrush'].filter(k => fx[k]).length;
  return `
    <div style="margin-top:10px">
      ${isTriggerBlock ? '' : `<button type="button" class="btn btn-small alt-pool-toggle" data-role="fxBlockToggle" data-fx-key="${escapeAttr(fxKey)}"><span data-role="caret">${expanded ? '▾' : '▸'}</span> ${tr('fxSectionTitle')}${activeCount ? ` <span class="hint-inline" style="margin:0">(${tr('fxActiveCount', { n: activeCount })})</span>` : ''}</button>`}
      <div class="list-block-body${expanded ? '' : ' collapsed'}" data-role="fxBlockBody">
      ${toggle('volume', !!fx.volume, 'fxVolumeLabel', `
        ${num('volume', 'db', fx.volume ? fx.volume.db : 0, 'fxVolumeDbLabel', 0.5, -60, 12)}
        <div class="hint-inline">${tr('fxVolumeHint')}</div>
      `)}
      ${['lowcut', 'highcut'].map(k => {
        const c = k === 'lowcut' ? lc : hc;
        const slopeVal = c && (+c.slope === 12 || +c.slope === 48) ? +c.slope : 24;
        return toggle(k, !!c, k === 'lowcut' ? 'fxLowcutLabel' : 'fxHighcutLabel', `
        <div data-fx-box="${k}">
        <div class="hint-inline">${tr(k === 'lowcut' ? 'fxLowcutHint' : 'fxHighcutHint')}</div>
        ${num(k, 'frequency', c ? c.frequency : (k === 'lowcut' ? 150 : 3000), 'fxFrequencyLabel', 10, 20, 20000)}
        <div style="margin-top:4px"><label style="font-size:0.85em">${tr('fxSlopeLabel')}</label>
          <select data-field="fx" data-fx-effect="${k}" data-fx-param="slope" ${extraAttrs} ${gated ? 'disabled' : ''}>
            ${[12, 24, 48].map(v => `<option value="${v}" ${slopeVal === v ? 'selected' : ''}>${tr('fxSlopeOption', { db: v })}</option>`).join('')}
          </select></div>
        ${fxFilterGraphHtml(k, c ? c.frequency : (k === 'lowcut' ? 150 : 3000), slopeVal)}
        ${fxPresetsHtml(k, c, gated)}
        ${isTriggerBlock ? '' : numOptional(k, 'fadeFromFrequency', c ? c.fadeFromFrequency : null, 'fxFadeFromFreqLabel', 10)}
        ${isTriggerBlock ? '' : numOptional(k, 'fadeDurationSec', c ? c.fadeDurationSec : null, 'fxFadeDurationLabel', 0.1)}
        </div>
      `);
      }).join('')}
      ${toggle('pitch', !!fx.pitch, 'fxPitchLabel', `
        ${isTriggerBlock ? `
        <div style="margin-top:4px"><label style="font-size:0.85em">${tr('fxPitchModeLabel')}</label>
          <select data-field="fx" data-fx-effect="pitch" data-fx-param="mode" ${extraAttrs} ${pitchDisabled ? 'disabled' : ''}>
            <option value="shift" ${!fx.pitch || fx.pitch.mode !== 'rate' ? 'selected' : ''}>${tr('fxPitchModeShift')}</option>
            <option value="rate" ${fx.pitch && fx.pitch.mode === 'rate' ? 'selected' : ''}>${tr('fxPitchModeRate')}</option>
          </select></div>
        <div class="hint-inline">${tr(fx.pitch && fx.pitch.mode === 'rate' ? 'fxPitchModeRateTriggerHint' : 'fxPitchModeShiftHint')}</div>` : `<div class="hint-inline">${tr('fxPitchModeShiftHint')}</div>`}
        ${num('pitch', 'semitones', fx.pitch ? fx.pitch.semitones : 0, 'fxSemitonesLabel', 1, -24, 24, pitchDisabled)}
      `, pitchDisabled)}
      ${toggle('reverb', !!r, 'fxReverbLabel', `<div data-fx-box="reverb">
        ${fxPresetsHtml('reverb', r, gated)}
        ${num('reverb', 'decay', r ? r.decay : 2, 'fxDecayLabel', 0.1, 0.1, 10)}
        ${num('reverb', 'wet', r ? r.wet : 0.3, 'fxWetLabel', 0.05, 0, 1)}
      </div>`)}
      ${toggle('delay', !!d, 'fxDelayLabel', `<div data-fx-box="delay">
        ${fxPresetsHtml('delay', d, gated)}
        ${num('delay', 'time', d ? d.time : 0.3, 'fxDelayTimeLabel', 0.01, 0.01, 2)}
        ${num('delay', 'feedback', d ? d.feedback : 0.35, 'fxFeedbackLabel', 0.05, 0, 0.9)}
        ${num('delay', 'wet', d ? d.wet : 0.25, 'fxWetLabel', 0.05, 0, 1)}
      </div>`)}
      ${toggle('bitcrush', !!b, 'fxBitcrushLabel', `<div data-fx-box="bitcrush">
        ${fxPresetsHtml('bitcrush', b, gated)}
        ${num('bitcrush', 'bits', b ? b.bits : 8, 'fxBitsLabel', 1, 1, 16)}
        ${num('bitcrush', 'reduction', b ? b.reduction : 1, 'fxReductionLabel', 1, 1, 50)}
      </div>`)}
      </div>
    </div>
  `;
}
// Bouton de repli du panneau d'effets (fxBlockHtml) -- délégation unique plutôt qu'un câblage par
// appelant, le markup étant produit à 4 endroits (couche, boucle, emplacement, pool).
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-role="fxBlockToggle"]');
  if (!btn) return;
  const body = btn.parentElement.querySelector(':scope > [data-role="fxBlockBody"]');
  if (!body) return;
  const collapsed = body.classList.toggle('collapsed');
  btn.querySelector('[data-role="caret"]').textContent = collapsed ? '▸' : '▾';
  if (collapsed) expandedAltPoolKeys.delete(btn.dataset.fxKey); else expandedAltPoolKeys.add(btn.dataset.fxKey);
});
// Couche (mode vertical) ou l'unique couche du mode statique (li=null).
function layerFxHtml(layer, ti, li) {
  const liAttr = li != null ? `data-li="${li}"` : '';
  return fxBlockHtml(layer.fx, `data-fx-target="layer" data-ti="${ti}" ${liAttr}`);
}
// Boucle nommée (mode embranchement-vertical) -- fx par boucle, exact équivalent d'une couche.
function loopFxHtml(loop, ti, li) {
  return fxBlockHtml(loop.fx, `data-fx-target="loop" data-ti="${ti}" data-li="${li}"`);
}
// Emplacement séquentiel (mode séquentiel) -- fx porté par l'EMPLACEMENT, pas par chaque alternative :
// un emplacement est une position fixe de la timeline, l'effet doit s'appliquer quel que soit le tirage
// qui le remplit (anti-répétition), pas être reconfiguré alternative par alternative.
function slotFxHtml(slot, ti, si) {
  return fxBlockHtml(slot.fx, `data-fx-target="slot" data-ti="${ti}" data-si="${si}"`);
}
// Pool (mode vertical-random) -- même raisonnement que l'emplacement séquentiel : le pool est la "voix"
// fixe (façon Wwise Voice Graph), l'effet lui appartient plutôt qu'à l'alternative tirée au sort.
function poolFxHtml(pool, ti, si, pi) {
  return fxBlockHtml(pool.fx, `data-fx-target="pool" data-ti="${ti}" data-si="${si}" data-pi="${pi}"`);
}
// Intro, outro et transitions (27/09, proposition d'Antoine B.2) : leurs propres effets, comme une couche ou une
// boucle ; les triggers du morceau entier s'y appliquent aussi (lecteur et export vidéo).
function stageFxHtml(stageFx, target, attrs) {
  return fxBlockHtml(stageFx, `data-fx-target="${target}" ${attrs}`);
}
// Pitch "vitesse" de morceau ENTIER (22/09) -- distinct de fxBlockHtml/layerFxHtml & co, volontairement
// pas un simple appel à fxBlockHtml : un seul effet ici (pas de filtre/reverb/écho/bitcrush au niveau
// morceau), pas de champ mode (toujours "rate", implicite -- voir buildLayerFxChain/applyTrackPitchRate
// dans player.js). Rendu une fois dans le panneau "Infos du morceau", commun à tous les modes.
function trackPitchFxHtml(track, ti) {
  const pitchDisabled = !fxOpen('pitch');
  const p = (track.fx && track.fx.pitch) || null;
  const attrs = `data-fx-target="track" data-ti="${ti}"`;
  // Fondu de pitch : seulement avec le moteur simple (statique/vertical sans boucle quantifiée), voir
  // applyTrackPitchRate() dans player.js.
  const fadeSupported = (track.mode === 'static' || track.mode === 'vertical') && track.loopEngine !== 'quantized';
  return `
    <div style="margin-top:14px">
      <div style="font-weight:600;font-size:0.9em;margin-bottom:2px">${tr('fxPitchLabel')}</div>
      <div style="padding:8px;border:1px solid var(--border);border-radius:6px${pitchDisabled ? ';opacity:0.55' : ''}">
        <label style="display:flex;align-items:center;gap:6px;margin:0">
          <input type="checkbox" data-field="fx" data-fx-effect="pitch" data-fx-param="enabled" ${attrs} ${p ? 'checked' : ''} ${pitchDisabled ? 'disabled' : ''} style="width:auto;margin:0">
          ${tr('fxPitchModeRate')}${pitchDisabled ? `<span class="hint-inline" style="margin:0 0 0 6px">${tr('fxAdminOnlyHint')}</span>` : ''}
        </label>
        <div class="hint-inline">${tr('fxTrackPitchHint')}</div>
        ${p ? `
          <div style="margin-top:4px"><label style="font-size:0.85em">${tr('fxSemitonesLabel')}</label>
            <input type="number" step="1" min="-24" max="24" ${pitchDisabled ? 'disabled' : ''} data-field="fx" data-fx-effect="pitch" data-fx-param="semitones" ${attrs} value="${p.semitones || 0}"></div>
          ${fadeSupported ? `
          <div style="margin-top:4px"><label style="font-size:0.85em">${tr('fxFadeFromSemitonesLabel')}</label>
            <input type="number" step="1" ${pitchDisabled ? 'disabled' : ''} data-field="fx" data-fx-effect="pitch" data-fx-param="fadeFromSemitones" ${attrs} value="${p.fadeFromSemitones != null ? p.fadeFromSemitones : ''}"></div>
          <div style="margin-top:4px"><label style="font-size:0.85em">${tr('fxFadeDurationLabel')}</label>
            <input type="number" step="0.1" ${pitchDisabled ? 'disabled' : ''} data-field="fx" data-fx-effect="pitch" data-fx-param="fadeDurationSec" ${attrs} value="${p.fadeDurationSec != null ? p.fadeDurationSec : ''}"></div>
          ` : `<div class="hint-inline">${tr('fxTrackPitchNoFadeHint')}</div>`}
        ` : ''}
      </div>
    </div>
  `;
}
// ---- Triggers d'effets (23/09) -- réservés à l'admin pour l'instant, comme le pitch ----
// Un trigger = { id, label, target:{type,li|si|pi}, fx:{...}, visible, fadeSec } : un jeu d'effets qui se
// fusionne par-dessus ceux de sa cible tant qu'il est actif (voir initTrackPlayer() dans player.js). Actionné
// par un bouton public (visible) ou par des embranchements (fxActions sur une option de bascule séquentielle
// ou sur une boucle d'embranchement-vertical).
function fxTriggerTargetChoices(track) {
  const out = [];
  if (track.mode === 'static') out.push({ value: 'layer:0', label: tr('fxTargetStaticTrack') });
  else if (track.mode === 'vertical') (track.layers || []).forEach((l, i) => out.push({ value: 'layer:' + i, label: l.label || tr('layerFallback', { n: i + 1 }) }));
  else if (track.mode === 'embranchement-vertical') (track.loops || []).forEach((l, i) => out.push({ value: 'loop:' + i, label: l.label || tr('embrLoopFallback', { n: i + 1 }) }));
  else if (track.mode === 'sequential') (track.segmentSlots || []).forEach((sl, i) => out.push({ value: 'slot:' + i, label: '#' + (i + 1) + ' ' + (sl.label || tr('slotFallback', { n: i + 1 })) }));
  else if (track.mode === 'vertical-random') (track.sections || []).forEach((sec, si) => (sec.pools || []).forEach((p, pi) => out.push({ value: 'pool:' + si + ':' + pi, label: (sec.label || ('S' + (si + 1))) + ' / ' + (p.label || ('P' + (pi + 1))) })));
  return out;
}
function fxTriggerTargetToValue(t) {
  if (!t) return '';
  if (t.type === 'track') return 'track';
  if (t.type === 'sfx') return 'sfx:' + t.id;
  if (t.type === 'layer') return 'layer:' + (t.li || 0);
  if (t.type === 'loop') return 'loop:' + t.li;
  if (t.type === 'slot') return 'slot:' + t.si;
  if (t.type === 'pool') return 'pool:' + t.si + ':' + t.pi;
  return '';
}
function parseFxTriggerTarget(v) {
  if (v === 'track') return { type: 'track' };
  const p = String(v || '').split(':');
  if (p[0] === 'sfx') return { type: 'sfx', id: p.slice(1).join(':') };
  if (p[0] === 'layer') return { type: 'layer', li: parseInt(p[1], 10) || 0 };
  if (p[0] === 'loop') return { type: 'loop', li: parseInt(p[1], 10) || 0 };
  if (p[0] === 'slot') return { type: 'slot', si: parseInt(p[1], 10) || 0 };
  if (p[0] === 'pool') return { type: 'pool', si: parseInt(p[1], 10) || 0, pi: parseInt(p[2], 10) || 0 };
  return null;
}
// Relations entre triggers (24/09) : { activates:[{triggerId, delaySec}], cuts:[id], requires:[id], autoOffSec } --
// nettoyées à la sérialisation (rien d'inutile n'est publié). Règles décrites dans createTriggerRuleEngine (player.js).
// Étapes de cascade d'un trigger : [{ id, label, delaySec, fx }] ; absent (undefined) quand il n'y en a pas.
function fxStepsClean(steps) {
  const out = (Array.isArray(steps) ? steps : []).filter(s => s && s.id).map(s => ({ id: s.id, label: s.label || '', delaySec: +s.delaySec > 0 ? +s.delaySec : 0, fx: s.fx || {} }));
  return out.length ? out : undefined;
}
function fxRelationsClean(rel) {
  if (!rel) return null;
  const out = {};
  if (rel.activates && rel.activates.length) out.activates = rel.activates.map(a => ({ triggerId: a.triggerId, delaySec: +a.delaySec > 0 ? +a.delaySec : 0 }));
  if (rel.cuts && rel.cuts.length) out.cuts = rel.cuts.slice();
  if (rel.requires && rel.requires.length) out.requires = rel.requires.slice();
  if (+rel.autoOffSec > 0) out.autoOffSec = +rel.autoOffSec;
  return Object.keys(out).length ? out : null;
}
// Cascade (6/10) : les étapes d'un trigger, présentées en escalier sous ses propres effets.
// Niveau d'indentation d'une étape : plus elle démarre tard, plus elle est décalée (les étapes de même délai partagent un niveau).
// Les étapes sont affichées dans l'ordre de leur départ ; l'indice d'origine (si) reste celui du modèle.
function fxStepLevels(steps) {
  const delays = [...new Set((steps || []).map(st => +st.delaySec > 0 ? +st.delaySec : 0))].sort((a, b) => a - b);
  return (steps || []).map((st, si) => ({ si, st, level: 1 + delays.indexOf(+st.delaySec > 0 ? +st.delaySec : 0) }))
    .sort((a, b) => ((+a.st.delaySec || 0) - (+b.st.delaySec || 0)) || (a.si - b.si));
}
function fxCascadeHtml(trg, attrs) {
  const steps = trg.steps || [];
  const rows = fxStepLevels(steps).map(({ st, si, level }) => {
    const sAttrs = `data-ti="${/data-ti="(\d+)"/.exec(attrs)[1]}" data-tri="${/data-tri="(\d+)"/.exec(attrs)[1]}" data-sti="${si}"`;
    const when = +st.delaySec > 0 ? tr('fxStepAfter', { n: st.delaySec }) : tr('fxStepSimul');
    return `
      <details class="list-block" data-fxt-section-key="${escapeAttr('s:' + trg.id + ':' + st.id)}" ${fxTriggersSectionOpen.has('s:' + trg.id + ':' + st.id) ? 'open' : ''} data-fx-step-level="${level}" style="margin:6px 0 0 ${level * 18}px;border-left:3px solid var(--accent,#2f80c0)">
        <summary style="cursor:pointer;font-weight:600">&#8627; ${escapeAttr(st.label) || tr('fxStepTitle', { n: si + 1 })}<span class="hint-inline" style="margin:0 0 0 8px;font-weight:400">${when} ${tr('fxTriggerEffectsCount', { n: Object.keys(st.fx || {}).length })}</span></summary>
        <div class="row" style="margin-top:8px">
          <div><label style="font-size:0.85em">${tr('fxStepLabelLabel')}</label>
            <input type="text" placeholder="${escapeAttr(tr('fxStepTitle', { n: si + 1 }))}" data-field="fxStep" data-fxs-prop="label" ${sAttrs} value="${escapeAttr(st.label)}"></div>
          <div><label style="font-size:0.85em">${tr('fxStepDelayLabel')}</label>
            <input type="number" step="0.1" min="0" data-field="fxStep" data-fxs-prop="delaySec" ${sAttrs} value="${+st.delaySec || 0}" style="width:100%"></div>
          <button class="btn btn-icon btn-danger" type="button" data-action="remove-fx-step" ${sAttrs} title="${escapeAttr(tr('removeFxStepBtn'))}" style="align-self:flex-end">×</button>
        </div>
        <div class="hint-inline">${tr('fxStepDelayHint')}</div>
        ${fxBlockHtml(st.fx, `data-fx-target="trstep" ${sAttrs}`)}
      </details>`;
  }).join('');
  const taAttrs = attrs;
  return `
    <div style="margin-top:12px">
      <div style="font-weight:600;font-size:0.9em">${tr('fxCascadeTitle')}</div>
      <div class="hint-inline">${tr('fxCascadeHint')}</div>
      ${rows}
      <div class="actions" style="margin-top:6px;margin-left:18px"><button class="btn btn-small" type="button" data-action="add-fx-step" ${taAttrs}>${tr('addFxStepBtn')}</button></div>
    </div>`;
}
function fxRelationsEditorHtml(triggers, i, trg, attrs) {
  const rel = trg.relations || {};
  const others = triggers.filter((o, j) => j !== i && o && o.id);
  const numberOf = o => triggers.indexOf(o) + 1;
  const rows = others.map(o => {
    const rAttrs = `data-field="fxRel" ${attrs} data-rel-other="${escapeAttr(o.id)}"`;
    const act = (rel.activates || []).find(a => a.triggerId === o.id);
    return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:4px;font-size:12px">
      <span style="min-width:110px;font-weight:600">${escapeAttr(o.label) || tr('fxTriggerUnnamed', { n: numberOf(o) })}</span>
      <label style="display:flex;align-items:center;gap:4px;margin:0"><input type="checkbox" ${rAttrs} data-rel-kind="activates" ${act ? 'checked' : ''} style="width:auto;margin:0"> ${tr('fxRelActivates')}</label>
      ${act ? `<label style="display:flex;align-items:center;gap:4px;margin:0">${tr('fxRelDelay')} <input type="number" step="0.1" min="0" ${rAttrs} data-rel-kind="delay" value="${act.delaySec || 0}" style="width:64px"> s</label>` : ''}
      <label style="display:flex;align-items:center;gap:4px;margin:0"><input type="checkbox" ${rAttrs} data-rel-kind="cuts" ${(rel.cuts || []).indexOf(o.id) >= 0 ? 'checked' : ''} style="width:auto;margin:0"> ${tr('fxRelCuts')}</label>
      <label style="display:flex;align-items:center;gap:4px;margin:0"><input type="checkbox" ${rAttrs} data-rel-kind="requires" ${(rel.requires || []).indexOf(o.id) >= 0 ? 'checked' : ''} style="width:auto;margin:0"> ${tr('fxRelRequires')}</label>
    </div>`;
  }).join('');
  return `
    <div style="margin-top:10px;padding:8px;border:1px solid var(--border);border-radius:6px">
      <div style="font-weight:600;font-size:0.85em">${tr('fxRelTitle')}</div>
      <div class="hint-inline">${tr('fxRelHint')}</div>
      ${rows || `<div class="hint-inline">${tr('fxRelNoOthers')}</div>`}
    </div>`;
}
// Volet « Effets » d'un trigger : ouvert par défaut, repliable ; l'état (par identifiant de trigger) survit aux
// reconstructions de la liste, le temps que la page reste ouverte.
// Bornes proposées (curseur à 0 % -> 100 %) quand on choisit un paramètre pour une liaison de curseur.
const FX_SLIDER_DEFAULT_RANGE = {
  'lowcut.frequency': [20, 400], 'highcut.frequency': [400, 20000], 'volume.db': [-30, 0], 'reverb.wet': [0, 0.6],
  'delay.wet': [0, 0.5], 'delay.feedback': [0.2, 0.7], 'bitcrush.bits': [16, 4], 'bitcrush.reduction': [1, 20],
  'pitch.semitones': [0, 7], 'pitch.speed': [0, -12],
  'spatial.x': [-5, 5], 'spatial.y': [0, 10], 'spatial.distance': [2, 20], 'spatial.angle': [-90, 90], 'spatial.reverbDb': [-12, 0],
  'spatial.pathPos': [0, 1]
};
const fxTriggerEffectsCollapsed = new Set();
document.addEventListener('toggle', e => {
  const d = e.target, k = d && d.dataset && d.dataset.fxtEffectsKey;
  if (!k) return;
  if (d.open) fxTriggerEffectsCollapsed.delete(k); else fxTriggerEffectsCollapsed.add(k);
}, true);
// Section « Triggers » : fermée par défaut, et ce qu'on ouvre est retenu d'une visite à l'autre (par morceau).
const FX_TRIGGERS_OPEN_STORAGE = 'lp_fx_triggers_open';
const fxTriggersSectionOpen = new Set((() => {
  try { const v = JSON.parse(localStorage.getItem(FX_TRIGGERS_OPEN_STORAGE) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
})());
document.addEventListener('toggle', e => {
  const d = e.target, k = d && d.dataset && d.dataset.fxtSectionKey;
  if (!k) return;
  if (d.open) fxTriggersSectionOpen.add(k); else fxTriggersSectionOpen.delete(k);
  fxTriggersPersistOpen();
}, true);
function fxTriggersPersistOpen() {
  try { localStorage.setItem(FX_TRIGGERS_OPEN_STORAGE, JSON.stringify([...fxTriggersSectionOpen].slice(-300))); } catch (err) { /* stockage indisponible : on garde l'état en mémoire */ }
}
function fxTriggersEditorHtml(track, ti) {
  const triggers = track.fxTriggers || [];
  if (!fxOpen('triggers')) {
    return `
      <div style="margin-top:14px;opacity:0.55">
        <div style="font-weight:600;font-size:0.9em;margin-bottom:2px">${tr('fxTriggersTitle')}</div>
        <div class="hint-inline">${tr('fxTriggersAdminOnly')}${triggers.length ? ' (' + triggers.length + ')' : ''}</div>
      </div>`;
  }
  const choices = fxTriggerTargetChoices(track);
  const cards = triggers.map((trg, i) => {
    const curValue = fxTriggerTargetToValue(trg.target);
    const opts = choices.map(c => `<option value="${escapeAttr(c.value)}" ${c.value === curValue ? 'selected' : ''}>${escapeAttr(c.label)}</option>`).join('');
    const attrs = `data-ti="${ti}" data-tri="${i}"`;
    const cardKey = 'c:' + trg.id;
    // Chaque trigger se replie séparément (demande du 6/10) : fermé par défaut, état retenu comme la section.
    return `
      <details class="list-block" data-fxt-section-key="${escapeAttr(cardKey)}" ${fxTriggersSectionOpen.has(cardKey) ? 'open' : ''} style="margin-top:8px">
        <summary style="cursor:pointer;font-weight:600">${escapeAttr(trg.label) || tr('fxTriggerUnnamed', { n: i + 1 })}<span class="hint-inline" style="margin:0 0 0 8px;font-weight:400">${tr('fxTriggerEffectsCount', { n: Object.keys(trg.fx || {}).length })}</span></summary>
        <div class="row" style="margin-top:8px">
          <div><label>${tr('labelFieldLabel')}</label><input type="text" placeholder="${tr('fxTriggerLabelPlaceholder')}" data-field="fxTrigger" data-fxt-prop="label" ${attrs} value="${escapeAttr(trg.label)}"></div>
          <button class="btn btn-icon btn-danger" data-action="remove-fx-trigger" ${attrs} title="${tr('removeFxTriggerBtn')}" style="align-self:flex-end">×</button>
        </div>
        ${trg.target && trg.target.type !== 'track' ? `
          <div class="hint-inline" style="margin-top:6px">${tr('fxTriggerLegacyTarget', { name: escapeAttr((choices.find(c => c.value === curValue) || {}).label || curValue) })}
            <button class="btn btn-small" type="button" data-action="fx-trigger-to-track" ${attrs}>${tr('fxTriggerToWholeTrackBtn')}</button></div>
        ` : `<div class="hint-inline" style="margin-top:6px">${tr('fxTriggerWholeTrackNote')}</div>`}
        <details data-fxt-effects-key="${escapeAttr(trg.id)}" ${fxTriggerEffectsCollapsed.has(trg.id) ? '' : 'open'} style="margin-top:10px">
          <summary style="cursor:pointer;font-weight:600;font-size:0.9em">${tr('fxSectionTitle')} <span class="hint-inline" style="margin:0 0 0 6px;font-weight:400">${tr('fxTriggerEffectsCount', { n: Object.keys(trg.fx || {}).length })}</span></summary>
  ${fxBlockHtml(trg.fx, `data-fx-target="trigger" ${attrs}`)}
        </details>
        ${fxCascadeHtml(trg, attrs)}
        <label class="switch-row" style="margin-top:8px">
          <input type="checkbox" data-field="fxTrigger" data-fxt-prop="visible" ${attrs} ${trg.visible ? 'checked' : ''}>
          <span class="switch-row-label">${tr('fxTriggerVisibleLabel')}</span>
        </label>
        <div class="hint-inline">${tr('fxTriggerVisibleHint')}</div>
        <div class="row" style="margin-top:6px">
          <div><label style="font-size:0.85em">${tr('fxTriggerFadeLabel')}</label>
            <input type="number" step="0.05" min="0" max="10" data-field="fxTrigger" data-fxt-prop="fadeSec" style="width:100%" ${attrs} value="${trg.fadeSec != null ? trg.fadeSec : ''}"></div>
          <div><label style="font-size:0.85em">${tr('fxTriggerFadeOutLabel')}</label>
            <input type="number" step="0.05" min="0" max="10" placeholder="${tr('fxTriggerFadeOutPlaceholder')}" data-field="fxTrigger" data-fxt-prop="fadeOutSec" style="width:100%" ${attrs} value="${trg.fadeOutSec != null ? trg.fadeOutSec : ''}"></div>
        </div>
        <div style="margin-top:8px"><label style="font-size:0.85em">${tr('fxAutoOffLabel')}</label>
          <input type="number" step="0.5" min="0" placeholder="${tr('fxAutoOffPlaceholder')}" data-field="fxTrigger" data-fxt-prop="autoOffSec" style="width:100%" ${attrs} value="${trg.relations && trg.relations.autoOffSec != null ? trg.relations.autoOffSec : ''}"></div>
        <div class="hint-inline">${tr('fxAutoOffHint')}</div>
        ${fxRelationsEditorHtml(triggers, i, trg, attrs)}
      </details>`;
  }).join('');
  // Toute la section se replie (demande du 30/09) ; l'état est gardé par morceau à travers les re-rendus.
  const secKey = String(track.id || ti);
  return `
    <details data-fxt-section-key="${escapeAttr(secKey)}" ${fxTriggersSectionOpen.has(secKey) ? 'open' : ''} style="margin-top:14px">
      <summary style="cursor:pointer;font-weight:600;font-size:0.9em;margin-bottom:2px">${tr('fxTriggersTitle')}<span class="hint-inline" style="margin:0 0 0 6px;font-weight:400">${tr('fxTriggersCount', { n: triggers.length })}</span></summary>
      <div class="hint-inline">${tr('fxTriggersHint')}</div>
      ${cards}
      <div class="actions" style="margin-top:8px"><button class="btn btn-small" data-action="add-fx-trigger" data-ti="${ti}">${tr('addFxTriggerBtn')}</button></div>
    </details>`;
}
// ---- Curseurs de paramètre (24/09) -- réservés à l'admin, comme les triggers ----
// track.fxSliders = [{ id, label, defaultValue (0..1), smoothSec, visible, bindings:[{target, param, from, to}],
// thresholds:[{at (0..1), mode, triggerId}] }] : un curseur public dont la valeur règle des paramètres d'effets sur des
// cibles (courbe de `from` à `to`) et active/coupe des triggers selon des seuils. Voir fxSlidersValid dans player.js.
function fxSliderParamKey(param) { return 'fxSliderParam_' + String(param).replace('.', '_'); }
// Éditeur de courbe d'une liaison (24/09) : points {x, y} de 0 à 1 (x = position du curseur, y = de la valeur « à 0 % »
// en bas à la valeur « à 100 % » en haut). Extrémités calées aux bords (seul leur y bouge), points intermédiaires libres.
const FX_CURVE_W = 220, FX_CURVE_H = 130, FX_CURVE_PAD = 14;
const fxCurveSelected = {}; // "ti:sri:bi" -> index du point sélectionné
function fxCurveKey(ti, sri, bi) { return ti + ':' + sri + ':' + bi; }
// smooth : la courbe lissée est dessinée telle que le lecteur la calcule (mêmes points, même fonction).
function fxCurveInnerSvg(curve, selIdx, smooth) {
  const pts = curve && curve.length >= 2 ? curve : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const X = v => FX_CURVE_PAD + v * (FX_CURVE_W - 2 * FX_CURVE_PAD), Y = v => FX_CURVE_H - FX_CURVE_PAD - v * (FX_CURVE_H - 2 * FX_CURVE_PAD);
  const line = smooth && pts.length >= 3
    ? Array.from({ length: 65 }, (_, k) => { const x = k / 64; return X(x) + ',' + Y(window.LayerPlayerCore.fxCurveEval(pts, x, true)); })
    : pts.map(q => X(q.x) + ',' + Y(q.y));
  return `<rect x="${X(0)}" y="${Y(1)}" width="${X(1) - X(0)}" height="${Y(0) - Y(1)}" fill="none" stroke="var(--border)" stroke-width="1"/>
    <line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="var(--border)" stroke-width="0.7" stroke-dasharray="3 3"/>
    <polyline points="${line.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2"/>` +
    pts.map((q, i) => `<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="${i === selIdx ? 6 : 4.5}" fill="${i === selIdx ? 'var(--accent)' : 'var(--bg, #fff)'}" stroke="var(--accent)" stroke-width="2"/>`).join('');
}
// La case « Courbe lissée » n'a de sens qu'à partir de 3 points : suivie en direct quand on ajoute/retire un point.
function fxCurveSyncSmoothBox(svg, binding) {
  const box = svg.parentElement && svg.parentElement.querySelector('[data-action="fxsb-curve-smooth"]');
  if (box) box.disabled = !(binding.curve && binding.curve.length >= 3);
}
function fxCurveEditorHtml(b, ti, sri, bi) {
  const key = fxCurveKey(ti, sri, bi);
  const sel = fxCurveSelected[key] != null ? fxCurveSelected[key] : -1;
  return `
    <details style="margin-top:6px;width:100%">
      <summary style="cursor:pointer;font-size:0.85em">${tr('fxSliderCurveTitle')}${b.curve ? ' ✓' : ''}</summary>
      <div class="hint-inline">${tr('fxSliderCurveHint')}</div>
      <svg data-curve-editor="1" data-ti="${ti}" data-sri="${sri}" data-bi="${bi}" viewBox="0 0 ${FX_CURVE_W} ${FX_CURVE_H}" width="${FX_CURVE_W}" height="${FX_CURVE_H}" style="touch-action:none;cursor:crosshair;border:1px solid var(--border);border-radius:6px;display:block;margin-top:4px">${fxCurveInnerSvg(b.curve, sel, b.curveSmooth)}</svg>
      <div class="actions" style="margin-top:4px">
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.85em;margin:0"><input type="checkbox" style="width:auto;margin:0" data-action="fxsb-curve-smooth" data-ti="${ti}" data-sri="${sri}" data-bi="${bi}"${b.curveSmooth ? ' checked' : ''}${b.curve && b.curve.length >= 3 ? '' : ' disabled'}>${tr('fxSliderCurveSmooth')}</label>
        <button class="btn btn-small" type="button" data-action="fxsb-curve-remove" data-ti="${ti}" data-sri="${sri}" data-bi="${bi}">${tr('fxSliderCurveRemovePoint')}</button>
        <button class="btn btn-small" type="button" data-action="fxsb-curve-reset" data-ti="${ti}" data-sri="${sri}" data-bi="${bi}">${tr('fxSliderCurveReset')}</button>
      </div>
    </details>`;
}
function fxSlidersClean(list) {
  return (list || []).filter(x => x && x.id).map(x => ({
    id: x.id, label: x.label || '', visible: !!x.visible,
    defaultValue: Number.isFinite(+x.defaultValue) ? Math.max(0, Math.min(1, +x.defaultValue)) : 0,
    smoothSec: Number.isFinite(+x.smoothSec) && +x.smoothSec >= 0 ? +x.smoothSec : 0.15,
    bindings: (x.bindings || []).filter(b => b && b.target && b.param).map(b => { const cv = window.LayerPlayerCore.fxCurveSanitize(b.curve); return Object.assign({ target: b.target, param: b.param, from: Number.isFinite(+b.from) ? +b.from : 0, to: Number.isFinite(+b.to) ? +b.to : 1 }, cv ? { curve: cv } : {}, cv && b.curveSmooth ? { curveSmooth: true } : {}); }),
    thresholds: (x.thresholds || []).filter(t => t && t.triggerId).map(t => ({ at: Number.isFinite(+t.at) ? Math.max(0, Math.min(1, +t.at)) : 0.5, mode: t.mode === 'above' ? 'above' : 'below', triggerId: t.triggerId })),
    ...(x.intensity ? { intensity: { bounds: (x.intensity.bounds || []).filter(v => Number.isFinite(+v)).map(v => Math.max(0, Math.min(1, +v))) } } : {})
  }));
}
function fxSlidersEditorHtml(track, ti) {
  const sliders = track.fxSliders || [];
  if (!fxOpen('rtpc')) {
    return `
      <div style="margin-top:14px;opacity:0.55">
        <div style="font-weight:600;font-size:0.9em;margin-bottom:2px">${tr('fxSlidersTitle')}</div>
        <div class="hint-inline">${tr('fxSlidersAdminOnly')}${sliders.length ? ' (' + sliders.length + ')' : ''}</div>
      </div>`;
  }
  // Décision du 24/09 : plus de cible par section -- une liaison agit sur TOUT le morceau, ou sur un Sfx attaché. Une
  // ancienne cible précise (déjà enregistrée) reste listée pour ne rien perdre.
  const voiceChoices = [{ value: 'track', label: tr('fxTargetWholeTrack') }];
  const legacyChoices = fxTriggerTargetChoices(track);
  // Sfx attachés au morceau (boutons Sfx) : cibles possibles pour les paramètres de spatialisation.
  const sfxChoices = (track.sfxIds || []).map(id => (typeof sfxLibrary !== 'undefined' ? sfxLibrary : []).find(x => x.id === id)).filter(Boolean)
    .map(x => ({ value: 'sfx:' + x.id, label: tr('fxSliderTargetSfx', { title: x.title || x.id }) }));
  const choices = voiceChoices.concat(sfxChoices);
  const paramsAll = window.LayerPlayerCore.FX_SLIDER_PARAMS;
  const paramsFor = b => Object.keys(paramsAll).filter(pk => (paramsAll[pk].kind === 'sfx') === !!(b.target && b.target.type === 'sfx'));
  const triggers = (track.fxTriggers || []).filter(d => d && d.id);
  // Zones de structure (26/09 vertical, 30/09 embranchement-vertical) : un curseur peut remplacer les boutons du visiteur
  // (couches 1/2/3, boucles nommées) ; chaque zone a sa limite de départ, réglable.
  const zoneNames = window.LayerPlayerCore.fxStructureZones(track);
  const cards = sliders.map((sl, i) => {
    const a = `data-ti="${ti}" data-sri="${i}"`;
    const bounds = sl.intensity ? window.LayerPlayerCore.fxIntensityBounds(sl.intensity.bounds, zoneNames.length) : null;
    const structureHtml = zoneNames.length < 2 ? '' : `
        <label class="switch-row" style="margin-top:8px">
          <input type="checkbox" data-field="fxSlider" data-fxs-prop="intensity" ${a} ${sl.intensity ? 'checked' : ''}>
          <span class="switch-row-label">${tr('fxSliderIntensityLabel')}</span>
        </label>
        <div class="hint-inline">${tr('fxSliderIntensityHint')}</div>
        ${bounds ? bounds.map((b, bi) => `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:6px;font-size:12px">
          <span>${tr('fxSliderIntensityZone', { n: bi + 2, name: zoneNames[bi + 1] ? ' (' + escapeAttr(zoneNames[bi + 1]) + ')' : '' })}</span>
          <input type="number" min="0" max="100" step="1" data-field="fxSliderIntensityBound" ${a} data-ib="${bi}" value="${Math.round(b * 100)}" style="width:64px"> %
        </div>`).join('') : ''}`;
    const bindRows = (sl.bindings || []).map((b, bi) => {
      const cur = fxTriggerTargetToValue(b.target);
      const rowChoices = choices.some(c => c.value === cur) ? choices : choices.concat([{ value: cur, label: tr('fxSliderLegacyTargetOption', { name: (legacyChoices.find(c => c.value === cur) || {}).label || cur }) }]);
      const bAttrs = `data-field="fxSliderBinding" ${a} data-bi="${bi}"`;
      return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:6px;font-size:12px">
        <select ${bAttrs} data-fxsb-prop="target" style="width:auto">${rowChoices.map(c => `<option value="${escapeAttr(c.value)}" ${c.value === cur ? 'selected' : ''}>${escapeAttr(c.label)}</option>`).join('')}</select>
        <select ${bAttrs} data-fxsb-prop="param" style="width:auto">${paramsFor(b).map(pk => `<option value="${pk}" ${b.param === pk ? 'selected' : ''}>${tr(fxSliderParamKey(pk))}</option>`).join('')}</select>
        <label style="display:flex;align-items:center;gap:4px;margin:0">${tr('fxSliderFrom')} <input type="number" step="any" ${bAttrs} data-fxsb-prop="from" value="${b.from}" style="width:80px"></label>
        <label style="display:flex;align-items:center;gap:4px;margin:0">${tr('fxSliderTo')} <input type="number" step="any" ${bAttrs} data-fxsb-prop="to" value="${b.to}" style="width:80px"></label>
        <button class="btn btn-icon btn-danger" data-action="remove-fxs-binding" ${a} data-bi="${bi}" title="${tr('deleteBtn')}">×</button>
        ${fxCurveEditorHtml(b, ti, i, bi)}
      </div>`;
    }).join('');
    const thrRows = (sl.thresholds || []).map((t, thi) => {
      const tAttrs = `data-field="fxSliderThreshold" ${a} data-thi="${thi}"`;
      return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:6px;font-size:12px">
        <span>${tr('fxSliderThresholdWhen')}</span>
        <select ${tAttrs} data-fxst-prop="mode" style="width:auto"><option value="below" ${t.mode !== 'above' ? 'selected' : ''}>${tr('fxSliderBelow')}</option><option value="above" ${t.mode === 'above' ? 'selected' : ''}>${tr('fxSliderAbove')}</option></select>
        <input type="number" min="0" max="100" step="1" ${tAttrs} data-fxst-prop="at" value="${Math.round((t.at || 0) * 100)}" style="width:64px"> %
        <span>${tr('fxSliderThresholdThen')}</span>
        <select ${tAttrs} data-fxst-prop="triggerId" style="width:auto">${triggers.map(d => `<option value="${escapeAttr(d.id)}" ${d.id === t.triggerId ? 'selected' : ''}>${escapeAttr(d.label) || tr('fxTriggerLabelPlaceholder')}</option>`).join('')}</select>
        <button class="btn btn-icon btn-danger" data-action="remove-fxs-threshold" ${a} data-thi="${thi}" title="${tr('deleteBtn')}">×</button>
      </div>`;
    }).join('');
    return `
      <div class="list-block" style="margin-top:8px">
        <div class="row">
          <div><label>${tr('labelFieldLabel')}</label><input type="text" data-field="fxSlider" data-fxs-prop="label" ${a} placeholder="${tr('fxSliderLabelPlaceholder')}" value="${escapeAttr(sl.label)}"></div>
          <button class="btn btn-icon btn-danger" data-action="remove-fx-slider" ${a} title="${tr('removeFxSliderBtn')}" style="align-self:flex-end">×</button>
        </div>
        <div class="row" style="margin-top:6px">
          <div><label style="font-size:0.85em">${tr('fxSliderDefaultLabel')}</label><input type="number" min="0" max="100" step="1" data-field="fxSlider" data-fxs-prop="defaultValue" ${a} value="${Math.round((sl.defaultValue || 0) * 100)}"></div>
          <div><label style="font-size:0.85em">${tr('fxSliderSmoothLabel')}</label><input type="number" min="0" max="5" step="0.05" data-field="fxSlider" data-fxs-prop="smoothSec" ${a} value="${sl.smoothSec != null ? sl.smoothSec : 0.15}"></div>
        </div>
        <label class="switch-row" style="margin-top:8px">
          <input type="checkbox" data-field="fxSlider" data-fxs-prop="visible" ${a} ${sl.visible ? 'checked' : ''}>
          <span class="switch-row-label">${tr('fxSliderVisibleLabel')}</span>
        </label>
        ${structureHtml}
        <div style="margin-top:8px;font-weight:600;font-size:0.85em">${tr('fxSliderBindingsTitle')}</div>
        <div class="hint-inline">${tr('fxSliderBindingsHint')}</div>
        ${bindRows}
        <div class="actions" style="margin-top:6px"><button class="btn btn-small" data-action="add-fxs-binding" ${a}>${tr('addFxSliderBindingBtn')}</button></div>
        <div style="margin-top:10px;font-weight:600;font-size:0.85em">${tr('fxSliderThresholdsTitle')}</div>
        <div class="hint-inline">${tr('fxSliderThresholdsHint')}</div>
        ${thrRows}
        <div class="actions" style="margin-top:6px"><button class="btn btn-small" data-action="add-fxs-threshold" ${a} ${triggers.length ? '' : 'disabled'}>${tr('addFxSliderThresholdBtn')}</button></div>
      </div>`;
  }).join('');
  return `
    <div style="margin-top:14px">
      <div style="font-weight:600;font-size:0.9em;margin-bottom:2px">${tr('fxSlidersTitle')}</div>
      <div class="hint-inline">${tr('fxSlidersHint')}</div>
      ${cards}
      <div class="actions" style="margin-top:8px"><button class="btn btn-small" data-action="add-fx-slider" data-ti="${ti}">${tr('addFxSliderBtn')}</button></div>
    </div>`;
}
// Interaction de l'éditeur de courbe (délégation sur le document : le HTML de l'éditeur est régénéré à chaque rendu).
// Clic sur un point = le sélectionner et le déplacer ; clic dans le vide = nouveau point ; les extrémités ne bougent
// qu'en hauteur. Repeint le SVG sur place, sans redessiner toute la bibliothèque.
document.addEventListener('pointerdown', ev => {
  const svg = ev.target.closest && ev.target.closest('svg[data-curve-editor]');
  if (!svg) return;
  const ti = parseInt(svg.dataset.ti, 10), sri = parseInt(svg.dataset.sri, 10), bi = parseInt(svg.dataset.bi, 10);
  const b = (((library[ti] || {}).fxSliders || [])[sri] || {}).bindings;
  const binding = b && b[bi];
  if (!binding) return;
  if (!binding.curve) binding.curve = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const key = fxCurveKey(ti, sri, bi);
  const rect = svg.getBoundingClientRect();
  const k = FX_CURVE_W / rect.width;
  const toData = e => {
    const px = (e.clientX - rect.left) * k, py = (e.clientY - rect.top) * k;
    return { px, py, x: Math.max(0, Math.min(1, (px - FX_CURVE_PAD) / (FX_CURVE_W - 2 * FX_CURVE_PAD))), y: Math.max(0, Math.min(1, (FX_CURVE_H - FX_CURVE_PAD - py) / (FX_CURVE_H - 2 * FX_CURVE_PAD))) };
  };
  const scr = q => ({ px: FX_CURVE_PAD + q.x * (FX_CURVE_W - 2 * FX_CURVE_PAD), py: FX_CURVE_H - FX_CURVE_PAD - q.y * (FX_CURVE_H - 2 * FX_CURVE_PAD) });
  const d0 = toData(ev);
  let hit = -1, best = 12;
  binding.curve.forEach((q, i) => { const s2 = scr(q); const d = Math.hypot(s2.px - d0.px, s2.py - d0.py); if (d < best) { best = d; hit = i; } });
  if (hit < 0) {
    if (binding.curve.length >= 16) return;
    // Nouveau point à l'endroit du clic (x trié) : la courbe existante n'est pas modifiée ailleurs.
    let at = binding.curve.findIndex(q => q.x > d0.x); if (at < 0) at = binding.curve.length - 1;
    binding.curve.splice(at, 0, { x: d0.x, y: d0.y });
    hit = at;
  }
  fxCurveSelected[key] = hit;
  hasUnsavedEdits = true;
  const repaint = () => { svg.innerHTML = fxCurveInnerSvg(binding.curve, hit, binding.curveSmooth); fxCurveSyncSmoothBox(svg, binding); };
  repaint();
  try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
  const move = e => {
    const d = toData(e), last = binding.curve.length - 1;
    const lo = hit > 0 ? binding.curve[hit - 1].x + 0.005 : 0, hi = hit < last ? binding.curve[hit + 1].x - 0.005 : 1;
    binding.curve[hit] = { x: (hit === 0 || hit === last) ? binding.curve[hit].x : Math.max(lo, Math.min(hi, d.x)), y: d.y };
    hasUnsavedEdits = true;
    repaint();
  };
  const up = () => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up); };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
});
// Double-clic sur un point INTERMÉDIAIRE de la courbe = le supprimer (les deux extrémités restent).
document.addEventListener('dblclick', ev => {
  const svg = ev.target.closest && ev.target.closest('svg[data-curve-editor]');
  if (!svg) return;
  const ti = parseInt(svg.dataset.ti, 10), sri = parseInt(svg.dataset.sri, 10), bi = parseInt(svg.dataset.bi, 10);
  const binding = ((((library[ti] || {}).fxSliders || [])[sri] || {}).bindings || [])[bi];
  if (!binding || !binding.curve) return;
  const rect = svg.getBoundingClientRect(), k = FX_CURVE_W / rect.width;
  const px = (ev.clientX - rect.left) * k, py = (ev.clientY - rect.top) * k;
  let hit = -1, best = 12;
  binding.curve.forEach((q, i) => {
    const d = Math.hypot(FX_CURVE_PAD + q.x * (FX_CURVE_W - 2 * FX_CURVE_PAD) - px, FX_CURVE_H - FX_CURVE_PAD - q.y * (FX_CURVE_H - 2 * FX_CURVE_PAD) - py);
    if (d < best) { best = d; hit = i; }
  });
  if (hit <= 0 || hit >= binding.curve.length - 1) return;
  binding.curve.splice(hit, 1);
  delete fxCurveSelected[fxCurveKey(ti, sri, bi)];
  hasUnsavedEdits = true;
  svg.innerHTML = fxCurveInnerSvg(binding.curve, -1, binding.curveSmooth);
  fxCurveSyncSmoothBox(svg, binding);
});
// Actions liées à un embranchement : pour chaque trigger défini sur le morceau, "activer" / "couper" /
// "ne rien faire" quand CETTE option de bascule (séquentiel) ou CETTE boucle (embranchement-vertical) est prise.
function fxActionsHtml(actions, track, ownerAttrs) {
  const triggers = (track.fxTriggers || []).filter(x => x && x.id);
  if (!fxOpen('triggers') || !triggers.length) return '';
  const rows = triggers.map(trg => {
    const a = (actions || []).find(x => x.triggerId === trg.id);
    const v = a ? (a.active === false ? 'off' : 'on') : '';
    return `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
      <span style="flex:1;font-size:12px">${escapeAttr(trg.label) || tr('fxTriggerLabelPlaceholder')}</span>
      <select data-field="fxAction" data-fx-trigger-id="${escapeAttr(trg.id)}" ${ownerAttrs} style="width:auto">
        <option value="" ${v === '' ? 'selected' : ''}>${tr('fxActionNone')}</option>
        <option value="on" ${v === 'on' ? 'selected' : ''}>${tr('fxActionOn')}</option>
        <option value="off" ${v === 'off' ? 'selected' : ''}>${tr('fxActionOff')}</option>
      </select></div>`;
  }).join('');
  return `<div style="margin-top:10px"><div style="font-weight:600;font-size:0.85em">${tr('fxActionsTitle')}</div>${rows}</div>`;
}
// Bouton "+" inséré directement à la fin d'une liste maître de morceau (20/08, relecture de nettoyage) --
// factorise les 4 boutons d'ajout (+ Emplacement, + Section, + Boucle, + Couche) qui n'étaient que des
// copies quasi identiques les unes des autres. Vit désormais à la suite de la Structure plutôt que sous
// toute la colonne maître (retour visuel du 20/08 : il apparaissait à tort après "Contenu additionnel" /
// "Infos additionnelles").
function appendMasterAddButton(masterHost, action, ti, labelKey) {
  const btn = document.createElement('button');
  btn.className = 'btn btn-small';
  btn.type = 'button';
  btn.dataset.action = action;
  btn.dataset.ti = ti;
  btn.textContent = tr(labelKey);
  btn.style.marginTop = '4px';
  masterHost.appendChild(btn);
}
