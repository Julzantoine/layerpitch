// layerpitch-album-shared.js — LayerPitch, briques COMMUNES aux deux éditeurs d'album (29/09, dette signalée : l'onglet Albums
// du Backstage compositeur et l'onglet Albums de l'espace studio faisaient chacun leur propre copie de l'enregistrement et de
// l'écoute de la « version officielle » d'un morceau).
//
//   LayerPitchAlbumShared.fmtDuration(secondes)                  '1:05'
//   LayerPitchAlbumShared.createPlayback({ onChange, onError })   une seule écoute de version officielle à la fois
//        .toggle(albumId, trackId, { beforeStart })  démarre / arrête ; .stop() ; .key() -> 'album|morceau' ou null
//   LayerPitchAlbumShared.openGenerator({ albumId, trackId, onSaved, beforeStart })   idem, mais la prise est FABRIQUÉE puis retouchée sur une
//        timeline (admin ; layerpitch-album-autotake.js + layerpitch-album-timeline.js)
//   LayerPitchAlbumShared.openRecorder({ albumId, trackId, onSaved, beforeStart })
//        -> { el, albumId, trackId, close() } : boîte (à placer par l'appelant) avec le lecteur habituel du morceau, journal de
//        prise actif et « Enregistrer comme version de l'album » ; onSaved(take) après enregistrement réussi.
//
// La version officielle est une PRISE (journal du lecteur, capture-render.js) rangée dans album_tracks.default_settings par
// set_album_track_default_settings : le vendeur pour les siens, le compositeur invité pour les siens (migration 20260929020000).
// Textes : namespace « albumShared » de layerpitch-i18n.js.
(function () {
  const lang = () => {
    const q = new URLSearchParams(location.search).get('lang');
    let stored = null;
    try { stored = localStorage.getItem('layerpitch_lang'); } catch (e) { /* stockage indisponible */ }
    return (q || stored || 'fr') === 'en' ? 'en' : 'fr';
  };
  function tr(key, vars) {
    const I = window.LAYERPITCH_I18N || { fr: {}, en: {} };
    let s = ((I[lang()] || {}).albumShared || {})[key] || ((I.fr || {}).albumShared || {})[key] || key;
    if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtDuration = sec => { sec = Math.max(0, Math.round(sec || 0)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

  // capture-render.js (lecture d'une prise) n'est chargé qu'à la première écoute, avec le numéro de version de la page ; de même
  // capture-plan.js et layerpitch-album-autotake.js (version automatique), à la première génération.
  const scriptLoads = {};
  function loadScript(file, globalName) {
    if (window[globalName]) return Promise.resolve();
    if (scriptLoads[file]) return scriptLoads[file];
    const v = (document.querySelector('script[src*="layerpitch-i18n.js?v="]') || {}).src;
    const version = v ? new URL(v).searchParams.get('v') : '';
    scriptLoads[file] = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = './' + file + (version ? '?v=' + version : '');
      sc.onload = resolve;
      sc.onerror = () => { delete scriptLoads[file]; reject(new Error('Échec du chargement de ' + sc.src)); };
      document.head.appendChild(sc);
    });
    return scriptLoads[file];
  }
  const loadCaptureRender = () => loadScript('capture-render.js', 'LayerCaptureRender');
  const loadAutoTake = () => Promise.all([loadCaptureRender(), loadScript('capture-plan.js', 'LayerCapturePlan'), loadScript('capture-retarget.js', 'LayerCaptureRetarget')])
    .then(() => loadScript('layerpitch-album-autotake.js', 'LayerPitchAutoTake'));

  // ---- Écoute de la version officielle ----
  function createPlayback({ onChange, onError }) {
    let current = null; // { key, ctrl }
    const notify = () => { if (onChange) onChange(); };
    function stop() {
      const pb = current;
      current = null;
      if (pb && pb.ctrl) pb.ctrl.stop();
    }
    async function toggle(albumId, trackId, opts) {
      const key = albumId + '|' + trackId;
      const wasThis = current && current.key === key;
      stop();
      if (wasThis) { notify(); return; }
      if (opts && opts.beforeStart) opts.beforeStart(); // une seule chose joue à la fois : l'appelant arrête ce qui joue ailleurs
      const pb = { key, ctrl: null };
      current = pb;
      notify();
      try {
        await loadCaptureRender();
        const { take, error } = await window.LayerPitchAlbums.getAlbumTrackOfficialTake(albumId, trackId);
        if (error || !take) throw new Error(error || tr('playMissing'));
        const fetchBytes = url => window.LayerPlayerCore.fetchAudioBytes(url); // audio protégé : lien signé
        const ctrl = await window.LayerCaptureRender.playTake(take, { fetchBytes, onEnd: () => { if (current === pb) { current = null; notify(); } } });
        if (current !== pb) { ctrl.stop(); return; }
        pb.ctrl = ctrl;
      } catch (e) {
        if (current === pb) current = null;
        if (onError) onError(tr('playError', { error: e.message }));
      }
    }
    return { toggle, stop, key: () => (current ? current.key : null) };
  }

  // ---- Enregistrement de la version officielle ----
  // La version PUBLIÉE du morceau (celle que le fan recevra), jouée dans le lecteur habituel, journal de prise actif ;
  // « Enregistrer comme version de l'album » garde tout ce qui a été joué depuis le lancement.
  function openRecorder({ albumId, trackId, onSaved, beforeStart }) {
    const P = window.LayerPlayerCore;
    const el = document.createElement('div');
    el.style.cssText = 'margin:8px 0 12px;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg)';
    el.innerHTML = `<div class="hint">${esc(tr('recLoading'))}</div>`;
    const rec = {
      el, albumId, trackId, closed: false,
      close() {
        if (rec.closed) return;
        rec.closed = true;
        document.dispatchEvent(new CustomEvent('stop-track', { detail: trackId }));
        el.remove();
      },
    };
    (async () => {
      try {
        const r = await window.LayerPitchTracks.getTrack(trackId);
        if (!r || !r.track) throw new Error(tr('recUnpublished'));
        const track = r.track, sfxById = {};
        for (const sid of (track.sfxIds || [])) { const x = await window.LayerPitchSfx.getSfx(sid); if (x && x.sfx) sfxById[sid] = x.sfx; }
        if (rec.closed) return;
        if (beforeStart) beforeStart();
        P.setSfxLibrary(sfxById);
        P.setTakeRecording(true);
        el.innerHTML = `<div class="hint" style="margin-bottom:8px">${esc(tr('recHint'))}</div><div data-role="recPlayer"></div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn-small btn-primary" type="button" data-role="recSave">${esc(tr('recSave'))}</button>
            <button class="btn btn-small" type="button" data-role="recClose">${esc(tr('recClose'))}</button>
          </div>
          <div class="hint" data-role="recMsg" style="margin-top:6px"></div>`;
        const row = P.buildTrackRow(track, null, false);
        el.querySelector('[data-role="recPlayer"]').appendChild(row);
        P.initTrackPlayer(track, row);
        const titleToggle = row.querySelector('[data-role="titleToggle"]');
        if (titleToggle) titleToggle.click();
        const say = text => { el.querySelector('[data-role="recMsg"]').textContent = text; };
        el.querySelector('[data-role="recClose"]').onclick = () => rec.close();
        el.querySelector('[data-role="recSave"]').onclick = async e => {
          const take = P.getTrackTake(trackId);
          if (!take || !take.voices.length) { say(tr('recNothing')); return; }
          if (take.missing) { say(tr('recUnpublished')); return; }
          e.target.disabled = true;
          try {
            const res = await window.LayerPitchAlbums.setAlbumTrackOfficialTake(albumId, trackId, take);
            if (!res.ok) throw new Error(res.error);
            say(tr('recSaved', { duration: fmtDuration(take.duration) }));
            if (onSaved) onSaved(take);
          } catch (err) { say(tr('recError', { error: err.message })); }
          finally { e.target.disabled = false; }
        };
      } catch (e) {
        el.innerHTML = `<div class="hint" style="color:#c0392b">${esc(tr('recError', { error: e.message }))}</div>`;
      }
    })();
    return rec;
  }

  // ---- Version officielle automatique (26/10, admin, les cinq modes) ----
  // Au lieu de jouer le morceau à la main : une PARTITION est fabriquée à partir de sa config (bascules de couches,
  // d'emplacements, de sections ou de boucles, un stinger, une fin), affichée sur une timeline où on la retouche
  // (layerpitch-album-timeline.js), traduite en prise (layerpitch-album-autotake.js), écoutée depuis n'importe quel point,
  // puis « Valider » la range comme la prise enregistrée à la main. Même forme de retour que openRecorder.
  function openGenerator({ albumId, trackId, onSaved, beforeStart }) {
    const P = window.LayerPlayerCore;
    const el = document.createElement('div');
    el.style.cssText = 'margin:8px 0 12px;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg)';
    el.innerHTML = `<div class="hint">${esc(tr('recLoading'))}</div>`;
    let playing = null, take = null, seed = 1 + Math.floor(Math.random() * 1e6), busy = false, score = null, tl = null, raf = 0;
    let compileSeq = 0, compileTimer = 0;
    const rec = {
      el, albumId, trackId, closed: false,
      close() { if (rec.closed) return; rec.closed = true; stopListen(); clearTimeout(compileTimer); el.remove(); },
    };
    const q = role => el.querySelector('[data-role="' + role + '"]');
    const say = (text, err) => { const m = q('autoMsg'); if (m) { m.textContent = text; m.style.color = err ? '#c0392b' : ''; } };
    function refreshButtons() {
      const l = q('autoListen'), v = q('autoSave'), gbtn = q('autoGen');
      if (l) { l.disabled = !take || busy; l.textContent = tr(playing ? 'autoStop' : 'autoListen'); }
      if (v) v.disabled = !take || busy;
      if (gbtn) gbtn.textContent = tr(score ? 'autoRegenerate' : 'autoGenerate');
    }
    function stopListen() {
      const c = playing; playing = null;
      cancelAnimationFrame(raf);
      if (c && c.stop) { if (tl && c.position) tl.setCursor(c.position()); c.stop(); }
      if (tl) tl.setPlayhead(null);
      refreshButtons();
    }
    async function listen(from) {
      if (!take) return;
      stopListen();
      if (beforeStart) beforeStart();
      const mine = {};
      playing = mine;
      refreshButtons();
      try {
        await P.resumeAudio();
        const start = from != null ? from : (tl ? tl.cursor() : 0);
        const ctrl = await window.LayerCaptureRender.playTake(take, { from: start >= take.duration - 0.05 ? 0 : start, fetchBytes: url => P.fetchAudioBytes(url), onEnd: () => { if (playing === ctrl) { playing = null; cancelAnimationFrame(raf); if (tl) { tl.setCursor(0); tl.setPlayhead(null); } refreshButtons(); } } });
        if (playing !== mine) { ctrl.stop(); return; }
        playing = ctrl;
        const tick = () => { if (playing !== ctrl) return; if (tl) tl.setPlayhead(ctrl.position()); raf = requestAnimationFrame(tick); };
        tick();
      } catch (e) { if (playing === mine) playing = null; say(tr('playError', { error: e.message }), true); }
      refreshButtons();
    }
    (async () => {
      try {
        await loadAutoTake();
        await loadScript('layerpitch-album-timeline.js', 'LayerPitchVersionTimeline');
        const A = window.LayerPitchAutoTake;
        const r = await window.LayerPitchTracks.getTrack(trackId);
        if (!r || !r.track) throw new Error(tr('recUnpublished'));
        const track = r.track, sfxById = {}, sfxList = [];
        if (!A.supports(track)) throw new Error(tr('autoUnsupported'));
        for (const sid of (track.sfxIds || [])) { const x = await window.LayerPitchSfx.getSfx(sid); if (x && x.sfx) { sfxById[sid] = x.sfx; sfxList.push(x.sfx); } }
        if (rec.closed) return;
        const d = A.describe(track), def = A.defaults(track, sfxList);
        const sfxTitle = s => s.title || s.name || s.id;
        const num = (role, label, value, extra) => `<label style="display:flex;align-items:center;gap:6px;font-size:12px">${esc(label)} <input type="number" data-role="${role}" value="${esc(value)}" min="1" step="any" style="width:84px"${extra || ''}></label>`;
        const shown = x => Math.round(x * 10) / 10;
        const intervalLabels = { layers: 'autoIntervalLayers', loops: 'autoIntervalLoops', slots: 'autoIntervalSlots', sections: 'autoIntervalSections' };
        el.innerHTML = `<div class="hint" style="margin-bottom:8px">${esc(tr('autoHint'))}</div>
          <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
            ${num('autoDuration', tr('autoDuration'), shown(def.duration), d.fixedDuration ? ' disabled' : '')}
            ${d.intervalKind && (d.intervalKind !== 'layers' || d.layers > 1) ? num('autoInterval', tr(intervalLabels[d.intervalKind]), shown(def.intervalSec)) : ''}
            ${d.fade && !d.fixedDuration ? num('autoFade', tr('autoFade'), def.fadeSec, ' min="0"') : ''}
            ${sfxList.length ? `<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" data-role="autoStinger"${def.stinger ? ' checked' : ''}> ${esc(tr('autoStinger'))}
              <select data-role="autoSfx">${sfxList.map(s => `<option value="${esc(s.id)}"${s.id === def.sfxId ? ' selected' : ''}>${esc(sfxTitle(s))}</option>`).join('')}</select></label>` : `<span class="hint">${esc(tr('autoNoSfx'))}</span>`}
          </div>
          ${d.fixedDuration ? `<div class="hint">${esc(tr('autoFixed'))}</div>` : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button class="btn btn-small btn-primary" type="button" data-role="autoGen">${esc(tr('autoGenerate'))}</button>
            <button class="btn btn-small" type="button" data-role="autoListen" disabled>${esc(tr('autoListen'))}</button>
            <button class="btn btn-small btn-primary" type="button" data-role="autoSave" disabled>${esc(tr('autoSave'))}</button>
            <button class="btn btn-small" type="button" data-role="autoClose">${esc(tr('recClose'))}</button>
          </div>
          <div data-role="autoAsk"></div>
          <div class="hint" data-role="autoMsg" style="margin-top:6px"></div>
          <div data-role="autoTimeline"></div>`;
        const measureCache = {};
        const measure = async url => {
          if (!measureCache[url]) measureCache[url] = (async () => { const bytes = await P.fetchAudioBytes(url); return (await P.decodeAudioCompat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).duration; })();
          return measureCache[url];
        };
        const read = (role, fallback) => { const n = q(role); const v = n ? Number(n.value) : NaN; return isFinite(v) ? v : fallback; };
        const settingsNow = () => { const stingerBox = q('autoStinger'); return { duration: read('autoDuration', def.duration), intervalSec: read('autoInterval', def.intervalSec), fadeSec: read('autoFade', def.fadeSec), stinger: !!(stingerBox && stingerBox.checked), sfxId: q('autoSfx') ? q('autoSfx').value : null, seed }; };

        // Partition -> prise ; la timeline affiche les instants réellement joués. Une écoute en cours repart du même endroit.
        async function recompile() {
          const my = ++compileSeq;
          const wasPlaying = playing && playing.position ? playing.position() : null;
          busy = true; refreshButtons();
          try {
            const res = await A.compile(track, sfxById, score, { measure, settings: settingsNow() });
            if (my !== compileSeq || rec.closed) return;
            take = res.take;
            tl.setResult(res);
            say(tr('autoReady', { duration: fmtDuration(take.duration), stinger: res.info.stingerAt != null ? tr('autoStingerAt', { at: fmtDuration(res.info.stingerAt) }) : tr('autoNoStinger') }));
            busy = false; refreshButtons();
            if (wasPlaying != null) await listen(wasPlaying);
          } catch (e) { if (my === compileSeq) { busy = false; take = null; say(tr('recError', { error: e.message }), true); refreshButtons(); } }
        }
        function showTimeline() {
          if (!tl) {
            tl = window.LayerPitchVersionTimeline.create({
              track, sfxList, tr, esc,
              onChange: () => { clearTimeout(compileTimer); compileTimer = setTimeout(recompile, 120); },
              onSeek: t => { if (playing) listen(t); }
            });
            q('autoTimeline').appendChild(tl.el);
          }
          tl.setScore(score);
        }
        // « Générer » : nouvelle partition. Si des marqueurs ont été retouchés, on demande d'abord (Jules-Antoine, 26/10).
        async function generate(mode) {
          let fresh;
          try { fresh = A.draft(track, sfxById, settingsNow()); } catch (e) { say(tr('recError', { error: e.message }), true); return; }
          if (mode === 'keep' && score) {
            const bar = A.grid(track).barSec;
            const kept = score.markers.filter(m => m.edited);
            const keptStart = kept.find(m => m.fixed);
            const keptSw = kept.filter(m => m.kind !== 'stinger');
            const keptSting = kept.some(m => m.kind === 'stinger');
            // Zones retouchées : les plages des commandes (bascules régulières, rester) et une mesure autour de chaque
            // marqueur retouché ; les nouvelles bascules n'y entrent pas.
            const locks = (score.locks || []).concat(keptSw.filter(m => !m.fixed).map(m => ({ a: m.t - bar + 1e-6, b: m.t + bar - 1e-6 })));
            const extra = fresh.markers.filter(m => {
              if (m.fixed) return !keptStart;
              if (m.kind === 'stinger') return !keptSting;
              return !locks.some(l => m.t >= l.a - 1e-6 && m.t <= l.b + 1e-6);
            });
            if (tl.endEdited()) fresh.end = score.end;
            fresh.markers = kept.concat(extra);
            fresh.locks = score.locks || [];
          }
          score = fresh;
          showTimeline();
          await recompile();
          if (!playing) await listen(0);
        }
        q('autoClose').onclick = () => rec.close();
        q('autoListen').onclick = () => (playing ? stopListen() : listen());
        q('autoGen').onclick = () => {
          if (busy) return;
          stopListen();
          const ask = q('autoAsk');
          if (score && tl && tl.edited()) {
            ask.innerHTML = `<div style="margin-top:8px;padding:10px;border:1px solid var(--border);border-radius:6px">
              <div style="margin-bottom:6px">${esc(tr('autoAskRegen'))}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn btn-small" type="button" data-ask="all">${esc(tr('autoAskAll'))}</button>
                <button class="btn btn-small btn-primary" type="button" data-ask="keep">${esc(tr('autoAskKeep'))}</button>
                <button class="btn btn-small" type="button" data-ask="cancel">${esc(tr('autoAskCancel'))}</button>
              </div></div>`;
            ask.querySelectorAll('[data-ask]').forEach(b => {
              b.onclick = () => {
                ask.innerHTML = '';
                if (b.dataset.ask === 'cancel') return;
                seed++;
                generate(b.dataset.ask);
              };
            });
            return;
          }
          if (score) seed++;
          generate('all');
        };
        q('autoSave').onclick = async () => {
          if (!take || busy) return;
          busy = true; refreshButtons();
          try {
            const res = await window.LayerPitchAlbums.setAlbumTrackOfficialTake(albumId, trackId, take);
            if (!res.ok) throw new Error(res.error);
            say(tr('recSaved', { duration: fmtDuration(take.duration) }));
            if (onSaved) onSaved(take);
          } catch (err) { say(tr('recError', { error: err.message }), true); }
          finally { busy = false; refreshButtons(); }
        };
      } catch (e) {
        el.innerHTML = `<div class="hint" style="color:#c0392b">${esc(tr('recError', { error: e.message }))}</div>`;
      }
    })();
    return rec;
  }

  window.LayerPitchAlbumShared = { fmtDuration, createPlayback, openRecorder, openGenerator, loadCaptureRender };
})();
