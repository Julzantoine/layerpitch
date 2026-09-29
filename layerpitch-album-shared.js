// layerpitch-album-shared.js — LayerPitch, briques COMMUNES aux deux éditeurs d'album (29/09, dette signalée : l'onglet Albums
// du Backstage compositeur et l'onglet Albums de l'espace studio faisaient chacun leur propre copie de l'enregistrement et de
// l'écoute de la « version officielle » d'un morceau).
//
//   LayerPitchAlbumShared.fmtDuration(secondes)                  '1:05'
//   LayerPitchAlbumShared.createPlayback({ onChange, onError })   une seule écoute de version officielle à la fois
//        .toggle(albumId, trackId, { beforeStart })  démarre / arrête ; .stop() ; .key() -> 'album|morceau' ou null
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

  // capture-render.js (lecture d'une prise) n'est chargé qu'à la première écoute, avec le numéro de version de la page.
  let captureRenderLoaded = null;
  function loadCaptureRender() {
    if (window.LayerCaptureRender) return Promise.resolve();
    if (captureRenderLoaded) return captureRenderLoaded;
    const v = (document.querySelector('script[src*="layerpitch-i18n.js?v="]') || {}).src;
    const version = v ? new URL(v).searchParams.get('v') : '';
    captureRenderLoaded = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = './capture-render.js' + (version ? '?v=' + version : '');
      sc.onload = resolve;
      sc.onerror = () => { captureRenderLoaded = null; reject(new Error('Échec du chargement de ' + sc.src)); };
      document.head.appendChild(sc);
    });
    return captureRenderLoaded;
  }

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

  window.LayerPitchAlbumShared = { fmtDuration, createPlayback, openRecorder, loadCaptureRender };
})();
