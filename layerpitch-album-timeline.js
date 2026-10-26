// layerpitch-album-timeline.js — LayerPitch, timeline de la version automatique d'un morceau d'album (26/10/2026).
// Cadrage avec Jules-Antoine (26/10) : la version se lit comme un morceau linéaire (écoute, clic pour se placer), les bascules
// sont des marqueurs annotés qu'on déplace à la main (un marqueur déplacé ne pousse pas les autres ; Alt+clic pour en
// sélectionner plusieurs et les bouger ensemble ; aimant sur la mesure / le temps), et un menu « + Ajouter une commande »
// façon « insérer une fonction » d'Excel pose des marqueurs sans rien écrire. Vertical (couches) comme horizontal
// (emplacements, sections, boucles), transitions comprises (elles sont jouées par le moteur, montrées en blocs gris).
//
//   LayerPitchVersionTimeline.create({ track, sfxList, tr, esc, onChange(score), onSeek(t) })
//     -> { el, setScore(score), setResult({ resolved, info, events }), setPlayhead(t|null), cursor(), edited(), close() }
// La partition (score) est celle de layerpitch-album-autotake.js : la timeline la modifie en place puis appelle onChange ;
// l'appelant recompile et rend le résultat avec setResult (instants réellement joués, fin, blocs).
(function () {
  const A = () => window.LayerPitchAutoTake;
  const round3 = x => Math.round(x * 1000) / 1000;
  const byT = (a, b) => a.t - b.t;
  const hasFile = x => !!(x && x.file);
  const BLUES = ['#2f80c0', '#5b9bd5', '#1f5f91', '#86b8e2', '#3f6f96', '#a9cbe9'];
  const GREY = '#9aa5b1', STING = '#7d5ba6';

  // « 1:30 », « 90 », « 90,5 » -> secondes
  function parseTime(s) {
    s = String(s == null ? '' : s).trim().replace(',', '.');
    if (!s) return NaN;
    if (s.indexOf(':') >= 0) { const p = s.split(':'); return Number(p[0]) * 60 + Number(p[1]); }
    return Number(s);
  }
  function fmtT(sec) {
    const tenths = Math.max(0, Math.round((sec || 0) * 10)), m = Math.floor(tenths / 600), rest = tenths - m * 600;
    const s = rest % 10 ? (rest / 10).toFixed(1) : String(rest / 10);
    return m + ':' + (rest < 100 ? '0' : '') + s;
  }

  function injectStyle() {
    if (document.getElementById('lpvt-style')) return;
    const st = document.createElement('style');
    st.id = 'lpvt-style';
    st.textContent = `
.lpvt{margin-top:12px;font-size:12px;color:var(--text)}
.lpvt-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px}
.lpvt-bar select{font-size:12px}
.lpvt-time{font-variant-numeric:tabular-nums;color:var(--text-dim);margin-left:auto}
.lpvt-area{position:relative;height:144px;border:1px solid var(--border);border-radius:6px;background:var(--bg);overflow:hidden;user-select:none;touch-action:none;outline:none;cursor:pointer}
.lpvt-area:focus-visible{box-shadow:0 0 0 2px var(--accent,#2f80c0)}
.lpvt-ruler{position:absolute;left:0;right:0;top:0;height:18px;border-bottom:1px solid var(--border)}
.lpvt-tick{position:absolute;top:0;height:18px;border-left:1px solid var(--border);padding-left:3px;font-size:10px;line-height:18px;color:var(--text-dim);white-space:nowrap}
.lpvt-blk{position:absolute;top:24px;height:30px;border-radius:4px;color:#fff;font-size:11px;line-height:30px;padding:0 6px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;box-sizing:border-box;border-right:1px solid var(--bg)}
.lpvt-blk.tr{background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.25) 0 4px,transparent 4px 8px)}
.lpvt-line{position:absolute;top:18px;bottom:0;width:0;border-left:1px dashed var(--text-dim);pointer-events:none;opacity:.6}
.lpvt-chip{position:absolute;height:20px;line-height:18px;padding:0 6px;border-radius:10px;font-size:11px;white-space:nowrap;border:1px solid var(--accent,#2f80c0);background:var(--bg);color:var(--text);cursor:grab;box-sizing:border-box;max-width:220px;overflow:hidden;text-overflow:ellipsis}
.lpvt-chip.sw{top:60px}
.lpvt-chip.sw.r1{top:84px}
.lpvt-chip.st{top:112px;border-color:${STING}}
.lpvt-chip.end{top:112px;border-color:var(--text-dim);transform:translateX(-100%)}
.lpvt-chip.fixed{cursor:pointer;border-style:dotted}
.lpvt-chip.sel{background:var(--accent,#2f80c0);color:#fff}
.lpvt-chip.st.sel{background:${STING}}
.lpvt-chip.off{opacity:.4;text-decoration:line-through}
.lpvt-head{position:absolute;top:0;bottom:0;width:0;border-left:2px solid #c0392b;pointer-events:none}
.lpvt-panel{margin-top:8px;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg)}
.lpvt-panel .row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:6px 0}
.lpvt-panel label{display:inline-flex;align-items:center;gap:5px}
.lpvt-panel input[type=text]{width:70px}
.lpvt-cmds{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px}
.lpvt-cmd{text-align:left;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);cursor:pointer;font:inherit}
.lpvt-cmd:hover{border-color:var(--accent,#2f80c0)}
.lpvt-cmd b{display:block;margin-bottom:2px}
.lpvt-cmd span{color:var(--text-dim)}
.lpvt-dim{color:var(--text-dim)}`;
    document.head.appendChild(st);
  }

  function create({ track, sfxList, tr, esc, onChange, onSeek }) {
    injectStyle();
    const kind = A().SWITCH_KIND_OF[track.mode];
    const d = A().describe(track), g = A().grid(track);
    const sfxs = (sfxList || []).filter(s => (s.alternatives || []).some(a => a.file || a.localFile || a.localUrl));
    let score = null, resolved = {}, info = {}, events = [];
    let selected = new Set(), snap = 'bar', cursor = 0, head = null, openId = null, cmd = null, endEdited = false;
    const el = document.createElement('div');
    el.className = 'lpvt';

    // ---- Cibles d'une bascule ----
    const targets = (() => {
      if (kind === 'layers') return A().fileLayers(track).map(i => ({ value: i, label: ((track.layers || [])[i] || {}).label || tr('tlLayerN', { n: i + 1 }) }));
      if (kind === 'slot') return (track.segmentSlots || []).map((sl, i) => {
        const src = sl.referencesSlotId ? (track.segmentSlots || []).find(x => x.id === sl.referencesSlotId) : sl;
        return ((src && src.alternatives) || []).some(hasFile) ? { value: sl.id, label: sl.label || tr('tlSlotN', { n: i + 1 }) } : null;
      }).filter(Boolean);
      if (kind === 'section') return (track.sections || []).map((sec, i) => {
        const r = window.LayerCapturePlan.resolveVRSection(track, i);
        return r && (r.pools || []).some(pl => (pl.alternatives || []).some(hasFile)) ? { value: i, label: sec.label || tr('tlSectionN', { n: i + 1 }) } : null;
      }).filter(Boolean);
      return (track.loops || []).filter(hasFile).map(l => ({ value: l.id, label: (l.label || l.id) + (l.isDetour ? ' (' + tr('tlDetour') + ')' : '') }));
    })();
    const FIELD = { layers: 'on', slot: 'slotId', section: 'sectionIndex', loop: 'loopId' }[kind];
    const getTarget = m => m[FIELD];
    const setTarget = (m, v) => { m[FIELD] = v; };
    const labelOf = v => {
      if (kind === 'layers') { const on = (v || []).slice().sort((a, b) => a - b); return on.length ? on.map(i => (targets.find(x => x.value === i) || {}).label || '?').join(' + ') : tr('tlSilence'); }
      const t = targets.find(x => x.value === v); return t ? t.label : '?';
    };
    const colorOf = v => {
      if (kind === 'layers') return BLUES[Math.min(BLUES.length - 1, Math.max(0, (v || []).length - 1))];
      const i = targets.findIndex(x => x.value === v); return i < 0 ? GREY : BLUES[i % BLUES.length];
    };
    const sameTarget = (a, b) => (kind === 'layers' ? JSON.stringify((a || []).slice().sort()) === JSON.stringify((b || []).slice().sort()) : a === b);

    // ---- Partition ----
    const switches = () => {
      const list = score.markers.filter(m => m.kind === kind).sort(byT);
      const start = list.find(m => m.fixed) || list[0];
      return start ? [start].concat(list.filter(m => m !== start)) : [];
    };
    const stingers = () => score.markers.filter(m => m.kind === 'stinger').sort(byT);
    const find = id => score.markers.find(m => m.id === id);
    const startT = () => { const s = switches()[0]; return s ? (resolved[s.id] != null ? resolved[s.id] : s.t) : 0; };
    const musicEnd = () => (info.musicEnd != null ? info.musicEnd : score.end);
    const total = () => Math.max(10, info.duration || 0, musicEnd() || 0, score.end || 0) * 1.02;
    const canMoveEnd = () => !d.fixedDuration;
    const hasFade = () => d.fade && !d.fixedDuration;
    const snapT = t => {
      const step = snap === 'bar' ? g.barSec : snap === 'beat' ? g.beatSec : 0;
      return round3(step > 0 ? Math.round(t / step) * step : t);
    };
    const stateAt = t => { let cur = null; switches().forEach(m => { if (m.t <= t + 1e-6) cur = getTarget(m); }); return cur; };
    const newMarker = o => Object.assign({ id: 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), edited: true }, o);
    // Repères lus par la leçon « Créer un album » du tutoriel (data-edited, data-seeked, data-selected, data-last-cmd).
    const emit = () => { el.dataset.edited = '1'; render(); if (onChange) onChange(score); };

    // ---- Blocs (ce qui joue) ----
    function blocks() {
      const out = [], end = musicEnd();
      if (kind === 'layers' || kind === 'loop') {
        const sw = switches().filter(m => resolved[m.id] != null).sort((a, b) => resolved[a.id] - resolved[b.id]);
        sw.forEach((m, k) => {
          const a = resolved[m.id], b = k + 1 < sw.length ? resolved[sw[k + 1].id] : end;
          if (b > a) out.push({ a, b, label: labelOf(getTarget(m)), color: colorOf(getTarget(m)) });
        });
        return out;
      }
      const pre = kind === 'slot' ? 'seq_' : 'vr_';
      const list = events.filter(e => e.name.indexOf(pre) === 0).sort(byT);
      list.forEach((e, i) => {
        const b = i + 1 < list.length ? list[i + 1].t : Math.max(end, info.duration || end);
        let o;
        if (e.name === pre + 'intro_start') o = { key: 'intro', label: (track.intro && track.intro.label) || tr('tlIntro'), color: GREY };
        else if (e.name === pre + 'outro_start') o = { key: 'outro', label: (track.outro && track.outro.label) || tr('tlOutro'), color: GREY };
        else if (e.name === 'seq_transition_start') o = { key: 'tr' + i, label: tr('tlTransition'), color: GREY, tr: true };
        else { const v = kind === 'slot' ? e.detail.slotId : e.detail.sectionIndex; o = { key: 'v:' + v, label: labelOf(v), color: colorOf(v) }; }
        const last = out[out.length - 1];
        if (last && last.key === o.key && Math.abs(last.b - e.t) < 1e-3) last.b = b;
        else out.push(Object.assign(o, { a: e.t, b }));
      });
      return out;
    }

    // ---- Rendu ----
    const pct = t => (Math.max(0, t) / total() * 100) + '%';
    function chipText(m, k) {
      if (m.kind === 'stinger') { const s = sfxs.find(x => x.id === m.sfxId); return '✦ ' + (s ? (s.title || s.name || s.id) : '?'); }
      return k === 0 ? tr('tlStart', { target: labelOf(getTarget(m)) }) : tr('tlSwitchChip', { n: k, target: labelOf(getTarget(m)) });
    }
    function render() {
      if (!score) { el.innerHTML = ''; return; }
      el.dataset.selected = String(selected.size);
      const T = total(), step = [1, 2, 5, 10, 15, 30, 60, 120].find(s => T / s <= 12) || 300;
      let ticks = '';
      for (let t = 0; t < T; t += step) ticks += `<div class="lpvt-tick" style="left:${pct(t)}">${esc(fmtT(t))}</div>`;
      const blk = blocks().map(b => `<div class="lpvt-blk${b.tr ? ' tr' : ''}" style="left:${pct(b.a)};width:${(b.b - b.a) / T * 100}%;background:${b.color}" title="${esc(b.label + ' · ' + fmtT(b.a) + ' → ' + fmtT(b.b))}">${esc(b.label)}</div>`).join('');
      const sw = switches(), lines = [], chips = [];
      // Étiquettes proches : sur deux lignes, pour qu'elles ne se chevauchent pas (largeur estimée d'après le texte).
      const areaW = (el.querySelector('[data-tl="area"]') || el).clientWidth || 800;
      const rowEnd = [-Infinity, -Infinity];
      sw.forEach((m, k) => {
        const at = resolved[m.id] != null ? resolved[m.id] : m.t;
        const x = at / T * areaW, w = Math.min(220, chipText(m, k).length * 6.2 + 16);
        const row = x >= rowEnd[0] + 2 ? 0 : x >= rowEnd[1] + 2 ? 1 : (rowEnd[0] <= rowEnd[1] ? 0 : 1);
        rowEnd[row] = x + w;
        const off = resolved[m.id] === null;
        const from = k > 0 ? labelOf(getTarget(sw[k - 1])) : '';
        const title = k === 0 ? chipText(m, 0) : tr('tlSwitchTitle', { n: k, from, to: labelOf(getTarget(m)), at: fmtT(at) }) + (off ? ' — ' + tr('tlIgnored') : '');
        lines.push(`<div class="lpvt-line" style="left:${pct(at)}"></div>`);
        chips.push(`<div class="lpvt-chip sw${row ? ' r1' : ''}${m.fixed || k === 0 ? ' fixed' : ''}${selected.has(m.id) ? ' sel' : ''}${off ? ' off' : ''}" data-mid="${esc(m.id)}" style="left:${pct(at)}" title="${esc(title)}">${esc(chipText(m, k))}</div>`);
      });
      stingers().forEach(m => {
        const off = resolved[m.id] === null;
        chips.push(`<div class="lpvt-chip st${selected.has(m.id) ? ' sel' : ''}${off ? ' off' : ''}" data-mid="${esc(m.id)}" style="left:${pct(m.t)}" title="${esc(tr('tlStingerTitle', { at: fmtT(m.t) }) + (off ? ' — ' + tr('tlIgnored') : ''))}">${esc(chipText(m))}</div>`);
      });
      const endAt = musicEnd();
      lines.push(`<div class="lpvt-line" style="left:${pct(endAt)};border-left-style:solid"></div>`);
      chips.push(`<div class="lpvt-chip end${canMoveEnd() ? '' : ' fixed'}${selected.has('end') ? ' sel' : ''}" data-mid="end" style="left:${pct(endAt)}" title="${esc(tr('tlEndTitle'))}">${esc(tr('tlEnd', { at: fmtT(endAt) }))}</div>`);
      const selCount = [...selected].filter(id => id !== 'end' && find(id) && !find(id).fixed).length;
      el.innerHTML = `<div class="lpvt-bar">
          <button class="btn btn-small" type="button" data-tl="cmd">${esc(tr('tlAddCommand'))}</button>
          <label>${esc(tr('tlSnap'))} <select data-tl="snap">
            <option value="bar"${snap === 'bar' ? ' selected' : ''}>${esc(tr('tlSnapBar'))}</option>
            <option value="beat"${snap === 'beat' ? ' selected' : ''}>${esc(tr('tlSnapBeat'))}</option>
            <option value="free"${snap === 'free' ? ' selected' : ''}>${esc(tr('tlSnapFree'))}</option></select></label>
          ${selCount ? `<span>${esc(tr('tlSelected', { n: selCount }))}</span><button class="btn btn-small" type="button" data-tl="delSel">${esc(tr('tlDelete'))}</button>` : ''}
          <span class="lpvt-time" data-tl="time">${esc(fmtT(head != null ? head : cursor))} / ${esc(fmtT(info.duration || endAt))}</span>
        </div>
        <div class="lpvt-area" tabindex="0" data-tl="area">
          <div class="lpvt-ruler">${ticks}</div>${blk}${lines.join('')}${chips.join('')}
          <div class="lpvt-head" data-tl="head" style="left:${pct(head != null ? head : cursor)}"></div>
        </div>
        <div class="hint lpvt-dim" style="margin-top:4px">${esc(tr('tlHelp'))}</div>
        ${openId ? editorHtml() : ''}${cmd ? cmdHtml() : ''}`;
      wire();
    }

    // ---- Panneau d'un marqueur ----
    function targetField(name, value, disabled) {
      if (kind === 'layers') return targets.map(o => `<label><input type="checkbox" data-tf="${name}" value="${o.value}"${(value || []).indexOf(o.value) >= 0 ? ' checked' : ''}${disabled ? ' disabled' : ''}> ${esc(o.label)}</label>`).join('');
      return `<select data-tf="${name}"${disabled ? ' disabled' : ''}>${targets.map(o => `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    }
    function readTarget(root, name) {
      if (kind === 'layers') return [...root.querySelectorAll(`[data-tf="${name}"]`)].filter(x => x.checked).map(x => Number(x.value));
      const s = root.querySelector(`[data-tf="${name}"]`); if (!s) return null;
      return kind === 'section' ? Number(s.value) : s.value;
    }
    const sfxSelect = (name, value) => `<select data-tf="${name}">${sfxs.map(s => `<option value="${esc(s.id)}"${s.id === value ? ' selected' : ''}>${esc(s.title || s.name || s.id)}</option>`).join('')}</select>`;
    function editorHtml() {
      if (openId === 'end') {
        return `<div class="lpvt-panel" data-tl="editor"><b>${esc(tr('tlEndTitle'))}</b>
          <div class="row"><label>${esc(tr('tlAt'))} <input type="text" data-ed="at" value="${esc(fmtT(score.end))}"${canMoveEnd() ? '' : ' disabled'}></label>
          ${hasFade() ? `<label>${esc(tr('tlFade'))} <input type="text" data-ed="fade" value="${esc(score.fadeSec)}"> s</label>` : ''}
          <span class="lpvt-dim">${esc(tr('tlEndPlayed', { at: fmtT(musicEnd()) }))}</span></div>
          <div class="row"><button class="btn btn-small" type="button" data-ed="close">${esc(tr('tlClose'))}</button></div></div>`;
      }
      const m = find(openId);
      if (!m) return '';
      if (m.kind === 'stinger') {
        const s = sfxs.find(x => x.id === m.sfxId), nv = s ? (s.alternatives || []).filter(a => a.file || a.localFile || a.localUrl).length : 1;
        return `<div class="lpvt-panel" data-tl="editor"><b>${esc(tr('tlStingerTitle', { at: fmtT(m.t) }))}</b>
          <div class="row"><label>${esc(tr('tlSfx'))} ${sfxSelect('sfx', m.sfxId)}</label>
          <label>${esc(tr('tlVariation'))} <select data-ed="var">${Array.from({ length: Math.max(1, nv) }, (_, i) => `<option value="${i}"${i === (m.variationIndex | 0) ? ' selected' : ''}>${i + 1}</option>`).join('')}</select></label>
          <label>${esc(tr('tlAt'))} <input type="text" data-ed="at" value="${esc(fmtT(m.t))}"></label></div>
          <div class="row"><button class="btn btn-small" type="button" data-ed="del">${esc(tr('tlDelete'))}</button><button class="btn btn-small" type="button" data-ed="close">${esc(tr('tlClose'))}</button></div></div>`;
      }
      const sw = switches(), k = sw.indexOf(m), first = k === 0;
      const at = resolved[m.id] != null ? resolved[m.id] : m.t;
      const lockTarget = first && kind === 'loop'; // l'embranchement part toujours de sa boucle de référence
      return `<div class="lpvt-panel" data-tl="editor"><b>${esc(first ? tr('tlStartTitle') : tr('tlSwitchN', { n: k }))}</b>
        ${first ? '' : `<div class="row lpvt-dim">${esc(tr('tlFrom', { from: labelOf(getTarget(sw[k - 1])) }))}</div>`}
        <div class="row">${esc(tr('tlTo'))} ${targetField('to', getTarget(m), lockTarget)}</div>
        ${lockTarget ? `<div class="row lpvt-dim">${esc(tr('tlEmbrStart'))}</div>` : ''}
        <div class="row"><label>${esc(tr('tlAt'))} <input type="text" data-ed="at" value="${esc(fmtT(at))}"${first ? ' disabled' : ''}></label>
        ${resolved[m.id] === null ? `<span class="lpvt-dim">${esc(tr('tlIgnored'))}</span>` : ''}</div>
        <div class="row">${first ? '' : `<button class="btn btn-small" type="button" data-ed="del">${esc(tr('tlDelete'))}</button>`}<button class="btn btn-small" type="button" data-ed="close">${esc(tr('tlClose'))}</button></div></div>`;
    }

    // ---- Menu de commandes ----
    const CMDS = ['switch', 'every', 'stay', 'stinger', 'end'];
    function cmdHtml() {
      const top = `<div class="row" style="justify-content:space-between"><b>${esc(cmd === 'menu' ? tr('tlCmdMenu') : tr('tlCmd_' + cmd))}</b><span>
        ${cmd !== 'menu' ? `<button class="btn btn-small" type="button" data-cmd="back">${esc(tr('tlBack'))}</button>` : ''}
        <button class="btn btn-small" type="button" data-cmd="close">${esc(tr('tlClose'))}</button></span></div>`;
      if (cmd === 'menu') {
        return `<div class="lpvt-panel" data-tl="cmdpanel">${top}<div class="lpvt-cmds">${CMDS.filter(c => c !== 'stinger' || sfxs.length).filter(c => c !== 'end' || canMoveEnd())
          .filter(c => !((c === 'every' || c === 'stay' || c === 'switch') && targets.length < 2 && kind !== 'layers'))
          .map(c => `<button type="button" class="lpvt-cmd" data-pick="${c}"><b>${esc(tr('tlCmd_' + c))}</b><span>${esc(tr('tlCmdDesc_' + c))}</span></button>`).join('')}</div></div>`;
      }
      const now = round3(head != null ? head : cursor), end = musicEnd();
      const time = (name, v) => `<input type="text" data-cf="${name}" value="${esc(fmtT(v))}">`;
      let body = '';
      if (cmd === 'switch') {
        const at = snapT(Math.max(now, startT() + g.barSec));
        body = `<div class="row lpvt-dim" data-cf="fromText">${esc(tr('tlFrom', { from: labelOf(stateAt(at)) }))}</div>
          <div class="row">${esc(tr('tlTo'))} ${targetField('to', kind === 'layers' ? [] : (targets[0] || {}).value)}</div>
          <div class="row"><label>${esc(tr('tlAt'))} ${time('at', at)}</label></div>`;
      } else if (cmd === 'every') {
        const orderOpts = kind === 'layers' ? ['up', 'down', 'random'] : ['list', 'random'];
        body = `<div class="row"><label>${esc(tr('tlEveryMin'))} <input type="text" data-cf="min" value="30"></label><label>${esc(tr('tlEveryMax'))} <input type="text" data-cf="max" value="45"> s</label></div>
          <div class="row"><label>${esc(tr('tlFromTime'))} ${time('from', startT())}</label><label>${esc(tr('tlToTime'))} ${time('to', end)}</label></div>
          <div class="row"><label>${esc(tr('tlOrder'))} <select data-cf="order">${orderOpts.map(o => `<option value="${o}">${esc(tr('tlOrder_' + o))}</option>`).join('')}</select></label></div>
          <div class="row lpvt-dim">${esc(tr('tlEveryNote'))}</div>`;
      } else if (cmd === 'stay') {
        body = `<div class="row">${esc(tr('tlStayOn'))} ${targetField('to', kind === 'layers' ? (stateAt(now) || []) : (targets[0] || {}).value)}</div>
          <div class="row"><label>${esc(tr('tlFromTime'))} ${time('at', snapT(Math.max(now, startT())))}</label><label>${esc(tr('tlDuring'))} <input type="text" data-cf="dur" value="30"> s</label></div>
          <div class="row lpvt-dim">${esc(tr('tlStayNote'))}</div>`;
      } else if (cmd === 'stinger') {
        body = `<div class="row"><label>${esc(tr('tlSfx'))} ${sfxSelect('sfx', sfxs[0] && sfxs[0].id)}</label><label>${esc(tr('tlAt'))} ${time('at', snapT(now))}</label></div>`;
      } else if (cmd === 'end') {
        body = `<div class="row"><label>${esc(tr('tlAt'))} ${time('at', score.end)}</label>${hasFade() ? `<label>${esc(tr('tlFade'))} <input type="text" data-cf="fade" value="${esc(score.fadeSec)}"> s</label>` : ''}</div>`;
      }
      return `<div class="lpvt-panel" data-tl="cmdpanel">${top}<div class="hint lpvt-dim">${esc(tr('tlCmdDesc_' + cmd))}</div>${body}
        <div class="row"><button class="btn btn-small btn-primary" type="button" data-cmd="apply">${esc(tr('tlInsert'))}</button><span class="lpvt-dim" data-cmd="msg"></span></div></div>`;
    }
    // Plage retouchée par une commande : « Garder mes retouches » n'y remettra pas de bascule tirée au hasard.
    const lock = (a, b) => { score.locks = (score.locks || []).concat([{ a: round3(a), b: round3(b) }]); };
    const nonFixedSwitches = () => switches().slice(1);
    const removeSwitchesIn = (a, b) => { const kill = new Set(nonFixedSwitches().filter(m => m.t > a + 1e-6 && m.t <= b + 1e-6).map(m => m.id)); score.markers = score.markers.filter(m => !kill.has(m.id)); };
    const addSwitch = (t, v) => {
      const s = switches()[0];
      if (s && t <= startT() + 1e-3) { if (!(kind === 'loop')) { setTarget(s, v); s.edited = true; } return; }
      const m = newMarker({ kind, t: round3(t) }); setTarget(m, v); score.markers.push(m);
    };
    function nextTarget(cur, order) {
      if (kind === 'layers') {
        const all = targets.map(o => o.value), on = (cur || []).slice();
        if (order === 'up') { const nx = all.find(i => on.indexOf(i) < 0); return nx == null ? on : on.concat([nx]); }
        if (order === 'down') return on.length > 1 ? on.slice(0, -1) : on;
        let pick; let guard = 0;
        do { pick = all.filter(() => Math.random() < 0.5); if (!pick.length) pick = [all[Math.floor(Math.random() * all.length)]]; } while (sameTarget(pick, cur) && guard++ < 20 && all.length > 1);
        return pick;
      }
      const vals = targets.map(o => o.value), i = vals.indexOf(cur);
      if (order === 'list') return vals[(i + 1) % vals.length];
      const others = vals.filter(v => v !== cur);
      return others.length ? others[Math.floor(Math.random() * others.length)] : cur;
    }
    function applyCmd(root) {
      const val = n => { const x = root.querySelector(`[data-cf="${n}"]`); return x ? x.value : ''; };
      const t = n => parseTime(val(n));
      const fail = msg => { const m = root.querySelector('[data-cmd="msg"]'); if (m) m.textContent = msg; return false; };
      const end = musicEnd();
      if (cmd === 'switch') {
        const at = t('at'); if (!(at >= 0)) return fail(tr('tlBadTime'));
        addSwitch(snapT(at), readTarget(root, 'to'));
      } else if (cmd === 'every') {
        const lo = Number(val('min').replace(',', '.')), hi = Math.max(lo, Number(val('max').replace(',', '.'))), a = t('from'), b = t('to');
        if (!(lo > 0) || !(a >= 0) || !(b > a)) return fail(tr('tlBadTime'));
        removeSwitchesIn(a, b);
        lock(a, b);
        let cur = stateAt(a), x = a, guard = 0;
        const minGap = Math.max(g.beatSec, 0.5);
        while (guard++ < 200) {
          x = snapT(x + lo + Math.random() * (hi - lo));
          if (x >= Math.min(b, end) - minGap) break;
          cur = nextTarget(cur, val('order'));
          addSwitch(x, cur);
        }
      } else if (cmd === 'stay') {
        const at = snapT(t('at')), dur = Number(val('dur').replace(',', '.'));
        if (!(at >= 0) || !(dur > 0)) return fail(tr('tlBadTime'));
        const back = stateAt(at), until = snapT(at + dur);
        removeSwitchesIn(at - 1e-3, until);
        lock(at, until);
        addSwitch(at, readTarget(root, 'to'));
        if (until < end - 1e-3 && back != null) addSwitch(until, back);
      } else if (cmd === 'stinger') {
        const at = t('at'), sfxId = val('sfx') || (root.querySelector('[data-tf="sfx"]') || {}).value;
        if (!(at >= 0)) return fail(tr('tlBadTime'));
        const s = sfxs.find(x => x.id === sfxId); const nv = s ? (s.alternatives || []).filter(a2 => a2.file || a2.localFile || a2.localUrl).length : 1;
        score.markers.push(newMarker({ kind: 'stinger', t: snapT(at), sfxId, variationIndex: Math.floor(Math.random() * Math.max(1, nv)) }));
      } else if (cmd === 'end') {
        const at = t('at'); if (!(at > 0)) return fail(tr('tlBadTime'));
        score.end = round3(at); endEdited = true;
        if (hasFade()) { const f = Number(val('fade').replace(',', '.')); if (f >= 0) score.fadeSec = f; }
      }
      return true;
    }

    // ---- Interactions ----
    function xToT(clientX) { const a = el.querySelector('[data-tl="area"]').getBoundingClientRect(); return Math.max(0, Math.min(total(), (clientX - a.left) / a.width * total())); }
    function wire() {
      const area = el.querySelector('[data-tl="area"]');
      el.querySelector('[data-tl="snap"]').onchange = e => { snap = e.target.value; };
      el.querySelector('[data-tl="cmd"]').onclick = () => { cmd = cmd ? null : 'menu'; openId = null; render(); };
      const delSel = el.querySelector('[data-tl="delSel"]');
      if (delSel) delSel.onclick = deleteSelected;
      area.addEventListener('keydown', e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); } });
      area.addEventListener('pointerdown', ev => {
        const chip = ev.target.closest('[data-mid]');
        if (chip) { dragMarker(ev, chip.dataset.mid, area); return; }
        // clic dans la timeline : on se place là (la lecture repart de cet endroit)
        cursor = round3(xToT(ev.clientX));
        el.dataset.seeked = '1';
        if (!ev.altKey) selected.clear();
        render();
        if (onSeek) onSeek(cursor);
      });
      const ed = el.querySelector('[data-tl="editor"]');
      if (ed) wireEditor(ed);
      const cp = el.querySelector('[data-tl="cmdpanel"]');
      if (cp) {
        cp.querySelectorAll('[data-pick]').forEach(b => { b.onclick = () => { cmd = b.dataset.pick; render(); }; });
        const on = (sel, f) => { const n = cp.querySelector(sel); if (n) n.onclick = f; };
        on('[data-cmd="back"]', () => { cmd = 'menu'; render(); });
        on('[data-cmd="close"]', () => { cmd = null; render(); });
        on('[data-cmd="apply"]', () => { if (applyCmd(cp)) { el.dataset.lastCmd = cmd; cmd = null; emit(); } });
        const atIn = cp.querySelector('[data-cf="at"]'), fromText = cp.querySelector('[data-cf="fromText"]');
        if (atIn && fromText) atIn.oninput = () => { const x = parseTime(atIn.value); if (x >= 0) fromText.textContent = tr('tlFrom', { from: labelOf(stateAt(x)) }); };
      }
    }
    function deleteSelected() {
      const kill = new Set([...selected].filter(id => { const m = find(id); return m && !(m.fixed || switches()[0] === m); }));
      if (!kill.size) return;
      score.markers = score.markers.filter(m => !kill.has(m.id));
      selected.clear(); openId = null;
      emit();
    }
    function wireEditor(ed) {
      const on = (sel, ev, f) => { const n = ed.querySelector(sel); if (n) n[ev] = f; };
      on('[data-ed="close"]', 'onclick', () => { openId = null; render(); });
      on('[data-ed="del"]', 'onclick', () => { score.markers = score.markers.filter(m => m.id !== openId); selected.delete(openId); openId = null; emit(); });
      if (openId === 'end') {
        on('[data-ed="at"]', 'onchange', e => { const x = parseTime(e.target.value); if (x > 0) { score.end = round3(x); endEdited = true; emit(); } });
        on('[data-ed="fade"]', 'onchange', e => { const x = Number(String(e.target.value).replace(',', '.')); if (x >= 0) { score.fadeSec = x; endEdited = true; emit(); } });
        return;
      }
      const m = find(openId);
      if (!m) return;
      on('[data-ed="at"]', 'onchange', e => { const x = parseTime(e.target.value); if (x >= 0) { m.t = round3(x); m.edited = true; emit(); } });
      on('[data-ed="var"]', 'onchange', e => { m.variationIndex = Number(e.target.value); m.edited = true; emit(); });
      ed.querySelectorAll('[data-tf="sfx"]').forEach(s => { s.onchange = () => { m.sfxId = s.value; m.variationIndex = 0; m.edited = true; emit(); }; });
      ed.querySelectorAll('[data-tf="to"]').forEach(s => { s.onchange = () => { setTarget(m, readTarget(ed, 'to')); m.edited = true; emit(); }; });
    }
    function dragMarker(ev, id, area) {
      ev.preventDefault();
      area.focus();
      if (ev.altKey) { if (selected.has(id)) selected.delete(id); else selected.add(id); render(); return; } // Alt+clic : ajoute / retire de la sélection
      if (!selected.has(id)) selected = new Set([id]);
      const movable = sid => (sid === 'end' ? canMoveEnd() : (() => { const m = find(sid); return m && !(m.fixed || switches()[0] === m); })());
      const tOf = sid => (sid === 'end' ? musicEnd() : (() => { const m = find(sid); return resolved[sid] != null && m.kind !== 'stinger' ? resolved[sid] : m.t; })());
      const ids = [...selected].filter(movable), orig = {};
      ids.forEach(sid => { orig[sid] = tOf(sid); });
      const x0 = ev.clientX, width = area.getBoundingClientRect().width, T = total();
      let moved = false;
      try { area.setPointerCapture(ev.pointerId); } catch (e) { /* ancien navigateur */ }
      const primary = orig[id] != null ? orig[id] : null;
      const move = e => {
        if (!moved && Math.abs(e.clientX - x0) < 4) return;
        moved = true;
        if (primary == null || !ids.length) return;
        const dt = (e.clientX - x0) / width * T;
        const delta = snapT(primary + dt) - primary;
        ids.forEach(sid => {
          const lo = sid === 'end' ? 1 : (find(sid).kind === 'stinger' ? 0 : startT() + 0.01);
          const nt = round3(Math.max(lo, orig[sid] + delta));
          if (sid === 'end') score.end = nt; else find(sid).t = nt;
          const chip = [...area.querySelectorAll('[data-mid]')].find(c => c.dataset.mid === sid);
          if (chip) chip.style.left = pct(nt);
        });
      };
      const up = () => {
        area.removeEventListener('pointermove', move);
        area.removeEventListener('pointerup', up);
        area.removeEventListener('pointercancel', up);
        if (moved && ids.length && primary != null) {
          ids.forEach(sid => { if (sid === 'end') endEdited = true; else { const m = find(sid); m.edited = true; delete resolved[sid]; } });
          emit();
        } else if (!moved) { openId = id; cmd = null; render(); }
      };
      area.addEventListener('pointermove', move);
      area.addEventListener('pointerup', up);
      area.addEventListener('pointercancel', up);
    }

    return {
      el,
      setScore(s) { score = s; resolved = {}; info = {}; events = []; selected.clear(); openId = null; endEdited = false; cursor = 0; render(); },
      setResult(r) {
        resolved = r.resolved || {}; info = r.info || {}; events = r.events || [];
        // Bascules horizontales : le marqueur prend la place réellement jouée (fin de bloc / de cycle la plus proche).
        if (kind === 'slot' || kind === 'section') switches().forEach(m => { if (resolved[m.id] != null) m.t = resolved[m.id]; });
        render();
      },
      setPlayhead(t) {
        head = t;
        const h = el.querySelector('[data-tl="head"]'), tm = el.querySelector('[data-tl="time"]');
        if (h) h.style.left = pct(t != null ? t : cursor);
        if (tm) tm.textContent = fmtT(t != null ? t : cursor) + ' / ' + fmtT(info.duration || musicEnd());
        if (t == null) return;
      },
      cursor: () => cursor,
      setCursor(t) { cursor = Math.max(0, t || 0); },
      edited: () => endEdited || !!(score && score.markers.some(m => m.edited)),
      endEdited: () => endEdited,
      close() { el.remove(); }
    };
  }

  window.LayerPitchVersionTimeline = { create, parseTime, fmtT };
})();
