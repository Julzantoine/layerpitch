// capture-versioning.js — LayerPitch, outil vidéo, section « Versioning » du panneau de capture (pack.html), 26/09/2026.
//
// Les « versions vidéo » d'un montage sauvegardé : chacune = une table de remplacement (morceau X -> morceau Y, Sfx A ->
// Sfx B), rejouée sur le montage par capture-retarget.js à l'écoute et au rendu (cadrage :
// layerpitch-docs/2026-09-26-cadrage-variantes-video.md). Rien n'est recopié du montage : retoucher la frise profite à
// toutes ses versions (Q5) ; « Détacher » en fait un montage indépendant. Une version = une combinaison, composée à la
// main (Q4) ; les Sfx se choisissent dans toute la bibliothèque, un dossier entier peut être proposé d'un coup, et tant
// qu'un Sfx n'a pas de remplaçant l'original joue, ligne signalée (Q3). Réservé à l'admin jusqu'au feu vert (pack.html
// ne monte la section que pour lui ; les fonctions serveur le vérifient aussi, voir
// supabase/migrations/20260926010000_video_capture_versions.sql).
//
// mount(host, ctx) -> { refresh() }. ctx, fourni par openCapturePanel :
//   tr(clé), getEvents(), getCaptureId(), getCaptureTitle(), library { library, sfxLibrary, sfxFolders },
//   findTrack(id), findSfx(id), videoEl, fetchBytes(url), fullExportLocked,
//   exportEvents(events, mode, onProgress) -> Blob, saveToLibrary(blob, title) -> id de vidéo, detach(events, title).
(function () {
  const RT = () => window.LayerCaptureRetarget;
  const P = () => window.LayerCapturePlan;
  const C = () => window.LayerPlayerCore;
  const esc = s => C().escapeHtml(String(s == null ? '' : s));
  const newId = () => ((window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)));
  const clone = o => JSON.parse(JSON.stringify(o || {}));

  const rpc = async (name, args) => {
    const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc(name, args);
    if (error) throw error;
    return data;
  };
  const api = {
    list: captureId => rpc('list_video_capture_versions', { p_capture_id: captureId }),
    save: (id, captureId, title, subs) => rpc('save_video_capture_version', { p_id: id, p_capture_id: captureId, p_title: title || '', p_substitutions: subs }),
    setExport: (id, videoId) => rpc('set_video_capture_version_export', { p_id: id, p_video_id: videoId }),
    remove: id => rpc('delete_video_capture_version', { p_id: id }),
  };
  // Fonctions serveur absentes : la migration n'a pas encore été appliquée.
  const isMissingBackend = e => /does not exist|could not find the function|PGRST202|42883|42P01/i.test((e && (e.message || e.code)) || '');

  function mount(host, ctx) {
    const tr = ctx.tr;
    let versions = [];
    let loadError = null;
    let editing = null; // { id, title, subs, isNew, titleTouched }
    let listening = null; // { key, stop() }
    let busy = false;
    let batchStatus = ''; // avancement du rendu en série (survit aux ré-affichages de la section)
    const setBatchStatus = m => { batchStatus = m; const el = host.querySelector('[data-role="batchStatus"]'); if (el) el.textContent = m; };
    const durationCache = new Map(); // "id|fichier" -> secondes (fichiers décodés à la demande)

    // ---- Ingrédients du montage ----
    const ingredients = () => {
      const events = ctx.getEvents() || [];
      const trackIds = [...new Set(events.filter(e => e.name !== 'stinger_play' && e.detail && e.detail.trackId).map(e => e.detail.trackId))].filter(id => ctx.findTrack(id));
      const sfxIds = [...new Set(events.filter(e => e.name === 'stinger_play').map(e => e.detail.sfxId))].filter(id => ctx.findSfx(id));
      return { trackIds, sfxIds };
    };
    const folderName = id => { const f = (ctx.library.sfxFolders || []).find(x => x.id === id); return f ? (f.name || f.title || '') : ''; };

    // ---- Durées de fichiers dont la traduction a besoin (transition d'embranchement sans durée réglée, Sfx remplacés) ----
    const fileUrl = (owner, file) => owner.base + encodeURIComponent(file) + (owner.publishedAt ? '?v=' + encodeURIComponent(owner.publishedAt) : '');
    async function ensureDurations(subs) {
      const wanted = [];
      Object.values((subs && subs.tracks) || {}).forEach(s => {
        const t = s && s.to && ctx.findTrack(s.to);
        if (t && t.mode === 'embranchement-vertical') (t.loops || []).forEach(l => { if (l.transition && l.transition.file && !l.transition.durationUnit) wanted.push([t, l.transition.file]); });
      });
      Object.values((subs && subs.sfx) || {}).forEach(id => {
        const s = id && ctx.findSfx(id);
        if (s) (s.alternatives || []).forEach(a => { if (a && a.file) wanted.push([s, a.file]); });
      });
      await Promise.all(wanted.map(async ([owner, file]) => {
        const key = owner.id + '|' + file;
        if (durationCache.has(key)) return;
        try {
          const bytes = await ctx.fetchBytes(fileUrl(owner, file));
          const buf = await C().decodeAudioCompat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
          durationCache.set(key, buf.duration);
        } catch (e) { durationCache.set(key, null); }
      }));
    }
    async function versionResult(subs) {
      await ensureDurations(subs);
      return RT().retarget(ctx.getEvents() || [], subs || {}, {
        findTrack: ctx.findTrack, findSfx: ctx.findSfx,
        fileDuration: (owner, file) => { const v = durationCache.get(owner.id + '|' + file); return v == null ? null : v; },
      });
    }

    // ---- Libellés ----
    const trackTitle = id => { const t = ctx.findTrack(id); return t ? (t.title || id) : id; };
    const sfxTitle = id => { const s = ctx.findSfx(id); return s ? (s.title || id) : id; };
    function noteText(n) {
      const txt = tr('versioningNote_' + n.code);
      const base = (txt === 'versioningNote_' + n.code) ? tr('versioningNote_generic').replace('{code}', n.code) : txt;
      return base
        .replace('{track}', n.trackId ? trackTitle(n.trackId) : '')
        .replace('{to}', n.to ? trackTitle(n.to) : '')
        .replace('{sfx}', n.sfxId ? sfxTitle(n.sfxId) : '')
        .replace('{t}', n.t != null ? n.t.toFixed(1) : '')
        .replace('{by}', n.by != null ? (n.by > 0 ? '+' : '') + n.by.toFixed(2) : '')
        .replace('{pos}', n.pos != null ? String(n.pos + 1) : '')
        .replace('{a}', n.a != null ? String(n.a) : '')
        .replace('{b}', n.b != null ? String(n.b) : '')
        + (n.count > 1 ? ' ' + tr('versioningNoteCount').replace('{n}', n.count) : '')
        + (n.issues ? ' — ' + n.issues.filter(i => i.severity === 'block').map(i => tr('versioningIssue_' + i.code)).join(', ') : '');
    }
    function summaryOf(subs) {
      const parts = [];
      Object.keys((subs && subs.tracks) || {}).forEach(id => { const s = subs.tracks[id]; if (s && s.to) parts.push(trackTitle(id) + ' → ' + trackTitle(s.to) + (s.snapToImage ? ' (' + tr('versioningSnapShort') + ')' : '')); });
      const sfx = Object.values((subs && subs.sfx) || {});
      const replaced = sfx.filter(Boolean).length, toChoose = sfx.filter(v => v === null).length;
      if (replaced) parts.push(tr('versioningSfxReplaced').replace('{n}', replaced));
      if (toChoose) parts.push(tr('versioningSfxToChoose').replace('{n}', toChoose));
      return parts.join(' · ') || tr('versioningNoChange');
    }
    function autoTitle(subs) {
      const tracks = Object.values((subs && subs.tracks) || {}).filter(s => s && s.to).map(s => trackTitle(s.to));
      const sfxTo = Object.values((subs && subs.sfx) || {}).filter(Boolean);
      const folders = [...new Set(sfxTo.map(id => (ctx.findSfx(id) || {}).folderId).filter(Boolean))].map(folderName).filter(Boolean);
      const bits = tracks.slice();
      if (sfxTo.length) bits.push(folders.length === 1 ? 'Sfx ' + folders[0] : tr('versioningSfxReplaced').replace('{n}', sfxTo.length));
      return bits.join(' + ') || tr('versioningNoChange');
    }

    // ---- Écoute en direct sur la vidéo : rendu du son (quelques secondes), puis lecture calée sur l'image ----
    function stopListening() {
      if (!listening) return;
      const l = listening;
      listening = null;
      try { l.stop(); } catch (e) {}
      render();
    }
    async function listen(key, subs, statusEl) {
      if (listening && listening.key === key) { stopListening(); return; }
      stopListening();
      statusEl.textContent = tr('versioningPreparingListen');
      try {
        const { events } = await versionResult(subs);
        const plan = P().buildPlan(events, { findTrack: ctx.findTrack, findSfx: ctx.findSfx }).plan;
        const buffer = await window.LayerCaptureRender.render(plan, { fetchBytes: ctx.fetchBytes, onProgress: (i, n) => { statusEl.textContent = tr('captureEngineProgress').replace('{i}', i).replace('{n}', n); } });
        await C().resumeAudio();
        const ac = C().audioContext();
        const video = ctx.videoEl;
        const from = video.currentTime || 0;
        const src = ac.createBufferSource();
        src.buffer = buffer;
        src.connect(ac.destination);
        const startAt = ac.currentTime + 0.05;
        src.start(startAt, Math.min(from, buffer.duration));
        video.muted = true;
        video.play().catch(() => {});
        const onPause = () => stopListening();
        video.addEventListener('pause', onPause);
        listening = { key, stop() { video.removeEventListener('pause', onPause); try { src.stop(); } catch (e) {} if (!video.paused) video.pause(); } };
        src.onended = () => { if (listening && listening.key === key) stopListening(); };
        statusEl.textContent = '';
        render();
      } catch (e) {
        console.error(e);
        statusEl.textContent = tr('versioningListenFailed').replace('{error}', e.message);
      }
    }

    // ---- Rendu d'une ou plusieurs versions (l'une après l'autre) ----
    const slug = s => String(s || 'version').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'version';
    async function renderVersions(list, mode, toLibrary) {
      busy = true; render();
      let done = 0;
      try {
        for (const v of list) {
          const label = (m) => setBatchStatus('« ' + (v.title || tr('captureUntitled')) + ' » (' + (done + 1) + '/' + list.length + ') — ' + m);
          const { events } = await versionResult(v.substitutions);
          const blob = await ctx.exportEvents(events, mode, label);
          const title = (ctx.getCaptureTitle() ? ctx.getCaptureTitle() + ' — ' : '') + (v.title || '');
          const a = document.createElement('a');
          const url = URL.createObjectURL(blob);
          a.href = url; a.download = slug(title) + (mode === 'audio' ? '.wav' : '.mp4');
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          if (toLibrary && mode !== 'audio') {
            label(tr('captureAddingToLibrary'));
            const videoId = await ctx.saveToLibrary(blob, title);
            await api.setExport(v.id, videoId);
            v.lastExportVideoId = videoId;
          }
          done++;
        }
        setBatchStatus(tr('versioningRenderDone').replace('{n}', done));
      } catch (e) {
        console.error(e);
        setBatchStatus(tr('versioningRenderFailed').replace('{n}', done).replace('{error}', e.message));
      } finally {
        busy = false; render();
      }
    }

    // ---- Chargement ----
    async function refresh() {
      stopListening();
      const captureId = ctx.getCaptureId();
      versions = []; loadError = null;
      if (editing && editing.captureId !== captureId) editing = null;
      if (captureId) {
        try { versions = await api.list(captureId); }
        catch (e) { console.error(e); loadError = isMissingBackend(e) ? tr('versioningNotReady') : tr('versioningLoadFailed').replace('{error}', e.message); }
      }
      render();
    }

    // ---- Affichage ----
    function render() {
      const captureId = ctx.getCaptureId();
      const { trackIds, sfxIds } = ingredients();
      let html = `<div class="vcv-head"><span class="vcv-title">${esc(tr('versioningTitle'))}</span><span class="vcv-hint">${esc(tr('versioningIntro'))}</span>`;
      if (captureId && !loadError && !editing) html += `<button type="button" class="video-capture-download-btn" data-act="new" ${busy ? 'disabled' : ''}>${esc(tr('versioningNewBtn'))}</button>`;
      html += `</div>`;
      if (!captureId) { host.innerHTML = html + `<div class="vcv-empty">${esc(tr('versioningNeedsSave'))}</div>`; return; }
      if (loadError) { host.innerHTML = html + `<div class="vcv-empty vcv-warn">${esc(loadError)}</div>`; return; }
      if (!trackIds.length && !sfxIds.length) { host.innerHTML = html + `<div class="vcv-empty">${esc(tr('versioningNothingToReplace'))}</div>`; return; }
      if (editing) { host.innerHTML = html + editorHtml(trackIds, sfxIds); bindEditor(trackIds, sfxIds); return; }
      if (!versions.length) html += `<div class="vcv-empty">${esc(tr('versioningNone'))}</div>`;
      versions.forEach(v => {
        const key = 'v:' + v.id;
        html += `<div class="vcv-version" data-id="${esc(v.id)}">
          <input type="checkbox" data-role="pick" ${busy ? 'disabled' : ''} title="${esc(tr('versioningPickHelp'))}">
          <span class="vcv-name">${esc(v.title || tr('captureUntitled'))}</span>
          <span class="vcv-summary">${esc(summaryOf(v.substitutions))}${v.lastExportVideoId ? ' · ' + esc(tr('versioningInLibrary')) : ''}</span>
          <button type="button" class="video-capture-download-btn" data-act="listen" ${busy ? 'disabled' : ''}>${esc(listening && listening.key === key ? tr('versioningStopListenBtn') : tr('versioningListenBtn'))}</button>
          <button type="button" class="video-capture-download-btn" data-act="edit" ${busy ? 'disabled' : ''}>${esc(tr('versioningEditBtn'))}</button>
          <button type="button" class="video-capture-download-btn" data-act="duplicate" ${busy ? 'disabled' : ''}>${esc(tr('versioningDuplicateBtn'))}</button>
          <button type="button" class="video-capture-download-btn" data-act="detach" ${busy ? 'disabled' : ''} title="${esc(tr('versioningDetachHelp'))}">${esc(tr('versioningDetachBtn'))}</button>
          <button type="button" class="video-capture-download-btn" data-act="delete" ${busy ? 'disabled' : ''}>${esc(tr('versioningDeleteBtn'))}</button>
          <span class="vcv-status" data-role="status"></span>
        </div>`;
      });
      if (versions.length) {
        html += `<div class="vcv-batch">
          <span>${esc(tr('versioningRenderPicked'))}</span>
          <button type="button" class="video-capture-download-btn" data-render="audio" ${busy ? 'disabled' : ''} title="${esc(tr('captureExportAudioHelp'))}">${esc(tr('captureExportAudioBtn'))}</button>
          <button type="button" class="video-capture-download-btn" data-render="copy" ${busy ? 'disabled' : ''} title="${esc(tr('captureExportCopyHelp'))}">${esc(tr('captureExportCopyBtn'))}</button>
          <button type="button" class="video-capture-download-btn" data-render="video" ${busy || ctx.fullExportLocked ? 'disabled' : ''}>${esc(tr('captureExportBtn'))}</button>
          <label class="video-capture-export-opt"><input type="checkbox" data-role="toLibrary"> ${esc(tr('versioningToLibrary'))}</label>
          <span class="vcv-status" data-role="batchStatus">${esc(batchStatus)}</span>
        </div>`;
      }
      host.innerHTML = html;
      bindList();
    }

    function editorHtml(trackIds, sfxIds) {
      const subs = editing.subs;
      let h = `<div class="vcv-editor">
        <div class="vcv-row"><span class="vcv-label">${esc(tr('versioningNameLabel'))}</span>
          <input type="text" class="video-capture-title-input vcv-name-input" data-role="title" value="${esc(editing.title)}" placeholder="${esc(autoTitle(subs))}"></div>`;
      if (trackIds.length) {
        h += `<div class="vcv-section">${esc(tr('versioningTracksLabel'))}</div>`;
        trackIds.forEach(id => {
          const src = ctx.findTrack(id);
          const cur = (subs.tracks || {})[id] || {};
          const others = (ctx.library.library || []).filter(t => t.id !== id);
          const ok = others.filter(t => RT().compareTracks(src, t).compatible);
          const sameModeBlocked = others.filter(t => t.mode === src.mode && !RT().compareTracks(src, t).compatible).length;
          h += `<div class="vcv-row">
            <span class="vcv-src">${esc(src.title || id)} <em>${esc(tr('versioningMode_' + src.mode))}</em></span><span class="vcv-arrow">→</span>
            <select class="video-capture-load-select" data-track="${esc(id)}">
              <option value="">${esc(tr('versioningKeepTrack'))}</option>
              ${ok.map(t => `<option value="${esc(t.id)}" ${cur.to === t.id ? 'selected' : ''}>${esc(t.title || t.id)}</option>`).join('')}
              ${!ok.length ? `<option disabled>${esc(tr('versioningNoCompatible'))}</option>` : ''}
              ${sameModeBlocked ? `<option disabled>${esc(tr('versioningOthersBlocked').replace('{n}', sameModeBlocked))}</option>` : ''}
            </select>
            <label class="video-capture-export-opt" title="${esc(tr('versioningSnapHelp'))}"><input type="checkbox" data-snap="${esc(id)}" ${cur.snapToImage ? 'checked' : ''} ${cur.to ? '' : 'disabled'}> ${esc(tr('versioningSnapLabel'))}</label>
          </div>`;
        });
      }
      if (sfxIds.length) {
        const folders = (ctx.library.sfxFolders || []).filter(f => (ctx.library.sfxLibrary || []).some(s => s.folderId === f.id));
        h += `<div class="vcv-section">${esc(tr('versioningSfxLabel'))}
          ${folders.length ? `<select class="video-capture-load-select" data-role="folder"><option value="">${esc(tr('versioningFolderPick'))}</option>${folders.map(f => `<option value="${esc(f.id)}">${esc(f.name || f.title || f.id)}</option>`).join('')}</select>` : ''}
        </div>`;
        const byFolder = {};
        (ctx.library.sfxLibrary || []).forEach(s => (byFolder[s.folderId || ''] = byFolder[s.folderId || ''] || []).push(s));
        sfxIds.forEach(id => {
          const src = ctx.findSfx(id);
          const has = subs.sfx && (id in subs.sfx);
          const cur = has ? subs.sfx[id] : undefined;
          const sugg = RT().suggestSfx(src, (ctx.library.sfxLibrary || []));
          const groups = Object.keys(byFolder).map(fid => `<optgroup label="${esc(fid ? folderName(fid) : tr('versioningNoFolder'))}">${byFolder[fid].filter(s => s.id !== id).map(s =>
            `<option value="${esc(s.id)}" ${cur === s.id ? 'selected' : ''}>${esc(s.title || s.id)}${s.tag ? ' — ' + esc(s.tag) : ''}</option>`).join('')}</optgroup>`).join('');
          h += `<div class="vcv-row ${cur === null ? 'vcv-orange' : ''}">
            <span class="vcv-src">${esc(src.title || id)}${src.tag ? ' <em>' + esc(src.tag) + '</em>' : ''}</span><span class="vcv-arrow">→</span>
            <select class="video-capture-load-select" data-sfx="${esc(id)}">
              <option value="" ${!has ? 'selected' : ''}>${esc(tr('versioningKeepSfx'))}</option>
              <option value="__choose" ${cur === null ? 'selected' : ''}>${esc(tr('versioningChooseSfx'))}</option>
              ${sugg ? `<option value="${esc(sugg.sfx.id)}" ${cur === sugg.sfx.id ? 'selected' : ''}>★ ${esc(sugg.sfx.title || sugg.sfx.id)} (${esc(tr('versioningSuggested_' + sugg.by))})</option>` : ''}
              ${groups}
            </select>
          </div>`;
        });
      }
      h += `<div class="vcv-notes" data-role="notes">${esc(tr('versioningComputing'))}</div>
        <div class="vcv-row">
          <button type="button" class="video-capture-download-btn" data-act="listenDraft">${esc(listening && listening.key === 'draft' ? tr('versioningStopListenBtn') : tr('versioningListenBtn'))}</button>
          <button type="button" class="video-capture-download-btn" data-act="saveDraft">${esc(tr('versioningSaveBtn'))}</button>
          <button type="button" class="video-capture-download-btn" data-act="cancelDraft">${esc(tr('versioningCancelBtn'))}</button>
          <span class="vcv-status" data-role="draftStatus"></span>
        </div>
      </div>`;
      return h;
    }

    let notesSeq = 0;
    async function refreshNotes() {
      const el = host.querySelector('[data-role="notes"]');
      if (!el || !editing) return;
      const seq = ++notesSeq;
      try {
        const { notes } = await versionResult(editing.subs);
        if (seq !== notesSeq) return;
        el.innerHTML = notes.length
          ? notes.map(n => `<div class="vcv-note vcv-note-${esc(n.severity)}">${esc(noteText(n))}</div>`).join('')
          : `<div class="vcv-note">${esc(tr('versioningNoNotes'))}</div>`;
      } catch (e) { if (seq === notesSeq) el.textContent = e.message; }
    }

    function bindEditor(trackIds, sfxIds) {
      const q = s => host.querySelector(s);
      const titleEl = q('[data-role="title"]');
      titleEl.addEventListener('input', () => { editing.title = titleEl.value; editing.titleTouched = true; });
      const changed = () => { stopListeningIfDraft(); titleEl.placeholder = autoTitle(editing.subs); refreshNotes(); };
      host.querySelectorAll('[data-track]').forEach(sel => sel.addEventListener('change', () => {
        const id = sel.dataset.track;
        editing.subs.tracks = editing.subs.tracks || {};
        const snap = host.querySelector(`[data-snap="${CSS.escape(id)}"]`);
        if (sel.value) editing.subs.tracks[id] = { to: sel.value, snapToImage: !!(snap && snap.checked) };
        else delete editing.subs.tracks[id];
        if (snap) snap.disabled = !sel.value;
        changed();
      }));
      host.querySelectorAll('[data-snap]').forEach(cb => cb.addEventListener('change', () => {
        const s = editing.subs.tracks && editing.subs.tracks[cb.dataset.snap];
        if (s) s.snapToImage = cb.checked;
        changed();
      }));
      const setSfx = (id, value) => {
        editing.subs.sfx = editing.subs.sfx || {};
        if (value === '') delete editing.subs.sfx[id];
        else editing.subs.sfx[id] = value === '__choose' ? null : value;
      };
      host.querySelectorAll('[data-sfx]').forEach(sel => sel.addEventListener('change', () => {
        setSfx(sel.dataset.sfx, sel.value);
        sel.closest('.vcv-row').classList.toggle('vcv-orange', sel.value === '__choose');
        changed();
      }));
      // Tout un dossier Sfx d'un coup : chaque Sfx du montage prend son équivalent le plus proche dans ce dossier, ou
      // passe « à choisir » (l'original joue) s'il n'y en a pas.
      const folderSel = q('[data-role="folder"]');
      if (folderSel) folderSel.addEventListener('change', () => {
        if (!folderSel.value) return;
        const pool = (ctx.library.sfxLibrary || []).filter(s => s.folderId === folderSel.value);
        sfxIds.forEach(id => {
          const m = RT().suggestSfx(ctx.findSfx(id), pool);
          const value = m ? m.sfx.id : '__choose';
          setSfx(id, value);
          const sel = host.querySelector(`[data-sfx="${CSS.escape(id)}"]`);
          if (sel) {
            if (m && ![...sel.options].some(o => o.value === value)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(value)}">${esc(m.sfx.title)}</option>`);
            sel.value = value;
            sel.closest('.vcv-row').classList.toggle('vcv-orange', value === '__choose');
          }
        });
        folderSel.value = '';
        changed();
      });
      q('[data-act="listenDraft"]').addEventListener('click', () => listen('draft', editing.subs, q('[data-role="draftStatus"]')));
      q('[data-act="cancelDraft"]').addEventListener('click', () => { stopListening(); editing = null; render(); });
      q('[data-act="saveDraft"]').addEventListener('click', async () => {
        const status = q('[data-role="draftStatus"]');
        status.textContent = tr('captureSaving');
        try {
          const title = (editing.title || '').trim() || autoTitle(editing.subs);
          await api.save(editing.id, ctx.getCaptureId(), title, editing.subs);
          editing = null;
          await refresh();
        } catch (e) {
          console.error(e);
          status.textContent = isMissingBackend(e) ? tr('versioningNotReady') : tr('captureSaveFailed').replace('{error}', e.message);
        }
      });
      refreshNotes();
    }
    function stopListeningIfDraft() { if (listening && listening.key === 'draft') stopListening(); }

    function bindList() {
      const newBtn = host.querySelector('[data-act="new"]');
      if (newBtn) newBtn.addEventListener('click', () => { stopListening(); editing = { id: newId(), captureId: ctx.getCaptureId(), title: '', subs: { tracks: {}, sfx: {} }, isNew: true }; render(); });
      host.querySelectorAll('.vcv-version').forEach(row => {
        const v = versions.find(x => x.id === row.dataset.id);
        const status = row.querySelector('[data-role="status"]');
        row.querySelector('[data-act="listen"]').addEventListener('click', () => listen('v:' + v.id, v.substitutions, status));
        row.querySelector('[data-act="edit"]').addEventListener('click', () => { stopListening(); editing = { id: v.id, captureId: ctx.getCaptureId(), title: v.title, subs: clone(v.substitutions), isNew: false, titleTouched: true }; render(); });
        row.querySelector('[data-act="duplicate"]').addEventListener('click', () => { stopListening(); editing = { id: newId(), captureId: ctx.getCaptureId(), title: tr('versioningCopyOf').replace('{name}', v.title || ''), subs: clone(v.substitutions), isNew: true, titleTouched: true }; render(); });
        row.querySelector('[data-act="detach"]').addEventListener('click', async () => {
          const ok = await window.LayerPitchNotify.confirm(tr('versioningDetachConfirm').replace('{name}', v.title || ''), { okLabel: tr('versioningDetachBtn') });
          if (!ok) return;
          status.textContent = tr('captureSaving');
          try {
            const { events } = await versionResult(v.substitutions);
            await ctx.detach(events, (ctx.getCaptureTitle() ? ctx.getCaptureTitle() + ' — ' : '') + (v.title || ''));
          } catch (e) { console.error(e); status.textContent = tr('captureSaveFailed').replace('{error}', e.message); }
        });
        row.querySelector('[data-act="delete"]').addEventListener('click', async () => {
          const ok = await window.LayerPitchNotify.confirm(tr('versioningDeleteConfirm').replace('{name}', v.title || ''), { okLabel: tr('versioningDeleteBtn'), danger: true });
          if (!ok) return;
          try { await api.remove(v.id); await refresh(); }
          catch (e) { console.error(e); status.textContent = tr('versioningDeleteFailed').replace('{error}', e.message); }
        });
      });
      host.querySelectorAll('[data-render]').forEach(btn => btn.addEventListener('click', () => {
        const picked = [...host.querySelectorAll('.vcv-version')].filter(r => r.querySelector('[data-role="pick"]').checked).map(r => versions.find(x => x.id === r.dataset.id));
        if (!picked.length) { setBatchStatus(tr('versioningPickNone')); return; }
        const mode = btn.dataset.render;
        if (mode === 'video' && ctx.fullExportLocked) return;
        const toLibrary = host.querySelector('[data-role="toLibrary"]').checked;
        stopListening();
        renderVersions(picked, mode, toLibrary);
      }));
    }

    refresh();
    return { refresh, stop: stopListening };
  }

  window.LayerCaptureVersioning = { mount };
})();
