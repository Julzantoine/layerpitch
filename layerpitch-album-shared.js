// layerpitch-album-shared.js — LayerPitch, briques COMMUNES aux deux éditeurs d'album (29/09, dette signalée : l'onglet Albums
// du Backstage compositeur et l'onglet Albums de l'espace studio faisaient chacun leur propre copie de l'enregistrement et de
// l'écoute de la « version officielle » d'un morceau).
//
//   LayerPitchAlbumShared.fmtDuration(secondes)                  '1:05'
//   LayerPitchAlbumShared.createPlayback({ onChange, onError })   une seule écoute de version officielle à la fois
//        .toggle(albumId, trackId, { beforeStart })  démarre / arrête ; .stop() ; .key() -> 'album|morceau' ou null
//   LayerPitchAlbumShared.openGenerator({ albumId, trackId, onSaved, beforeStart })   idem, mais la prise est FABRIQUÉE (admin ; layerpitch-album-autotake.js)
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

  // ---- Version officielle automatique (26/10, admin, morceaux statiques et verticaux) ----
  // Au lieu de jouer le morceau à la main : une frise est fabriquée à partir de sa config (couches qui entrent à intervalles
  // réguliers, un stinger, une fin), traduite en prise (layerpitch-album-autotake.js), écoutée, réglable, puis « Valider » la
  // range comme la prise enregistrée à la main. Même forme de retour que openRecorder (boîte à placer par l'appelant).
  function openGenerator({ albumId, trackId, onSaved, beforeStart }) {
    const P = window.LayerPlayerCore;
    const el = document.createElement('div');
    el.style.cssText = 'margin:8px 0 12px;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg)';
    el.innerHTML = `<div class="hint">${esc(tr('recLoading'))}</div>`;
    let playing = null, take = null, seed = 1 + Math.floor(Math.random() * 1e6), busy = false;
    const rec = {
      el, albumId, trackId, closed: false,
      close() { if (rec.closed) return; rec.closed = true; stopListen(); el.remove(); },
    };
    function stopListen() { const c = playing; playing = null; if (c) c.stop(); refreshButtons(); }
    const q = role => el.querySelector('[data-role="' + role + '"]');
    const say = (text, err) => { const m = q('autoMsg'); if (m) { m.textContent = text; m.style.color = err ? '#c0392b' : ''; } };
    function refreshButtons() {
      const l = q('autoListen'), v = q('autoSave');
      if (l) { l.disabled = !take || busy; l.textContent = tr(playing ? 'autoStop' : 'autoListen'); }
      if (v) v.disabled = !take || busy;
    }
    async function listen() {
      if (!take) return;
      stopListen();
      if (beforeStart) beforeStart();
      const mine = {};
      playing = mine;
      try {
        await P.resumeAudio();
        const ctrl = await window.LayerCaptureRender.playTake(take, { fetchBytes: url => P.fetchAudioBytes(url), onEnd: () => { if (playing === mine) { playing = null; refreshButtons(); } } });
        if (playing !== mine) { ctrl.stop(); return; }
        playing = ctrl;
      } catch (e) { if (playing === mine) playing = null; say(tr('playError', { error: e.message }), true); }
      refreshButtons();
    }
    (async () => {
      try {
        await loadAutoTake();
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
          <div class="hint" data-role="autoMsg" style="margin-top:6px"></div>`;
        const measureCache = {};
        const measure = async url => {
          if (!measureCache[url]) measureCache[url] = (async () => { const bytes = await P.fetchAudioBytes(url); return (await P.decodeAudioCompat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).duration; })();
          return measureCache[url];
        };
        const read = (role, fallback) => { const n = q(role); const v = n ? Number(n.value) : NaN; return isFinite(v) ? v : fallback; };
        let first = true;
        q('autoClose').onclick = () => rec.close();
        q('autoListen').onclick = () => (playing ? stopListen() : listen());
        q('autoGen').onclick = async () => {
          if (busy) return;
          stopListen();
          busy = true; take = null; refreshButtons();
          say(tr('autoWorking'));
          if (!first) seed++;
          try {
            const stingerBox = q('autoStinger');
            const settings = { duration: read('autoDuration', def.duration), intervalSec: read('autoInterval', def.intervalSec), fadeSec: read('autoFade', def.fadeSec),
              stinger: !!(stingerBox && stingerBox.checked), sfxId: q('autoSfx') ? q('autoSfx').value : null, seed };
            const res = await A.generate(track, sfxById, settings, { measure });
            take = res.take; first = false;
            say(tr('autoReady', { duration: fmtDuration(take.duration), stinger: res.info.stingerAt != null ? tr('autoStingerAt', { at: fmtDuration(res.info.stingerAt) }) : tr('autoNoStinger') }));
            busy = false; refreshButtons();
            await listen();
          } catch (e) { busy = false; take = null; say(tr('recError', { error: e.message }), true); refreshButtons(); }
        };
        q('autoSave').onclick = async () => {
          if (!take) return;
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
