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
// Versions « de la séance » (28/09, palier Warrior, matrice des droits) : ctx.sessionOnly = true -> les versions vivent
// en mémoire le temps de la séance (écoute, comparaison, rendu en série), rien n'est enregistré côté serveur, et
// « Détacher » (qui enregistre un nouveau montage) n'est pas proposé. Boss : versions enregistrées, comme avant.
//
// mount(host, ctx) -> { refresh() }. ctx, fourni par openCapturePanel :
//   tr(clé), getEvents(), getCaptureId(), getCaptureTitle(), library { library, sfxLibrary, sfxFolders },
//   findTrack(id), findSfx(id), videoEl, fetchBytes(url), fullExportLocked (hérité : l'export MP4 complet a été retiré le 09/11),
//   exportEvents(events, mode, onProgress) -> Blob, saveToLibrary(blob, title) -> id de vidéo, detach(events, title).
//   Publication automatique (09/11) : publishVersion(events, title) -> id du son, getSoundKey() (état du montage), cuesOf(events), keepOld(), afterExport(res), onProgress(msg).
(function () {
  const RT = () => window.LayerCaptureRetarget;
  const P = () => window.LayerCapturePlan;
  const C = () => window.LayerPlayerCore;
  const esc = s => C().escapeHtml(String(s == null ? '' : s));
  const newId = () => ((window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)));
  const clone = o => JSON.parse(JSON.stringify(o || {}));
  const clone2 = o => (o == null ? null : JSON.parse(JSON.stringify(o))); // comme clone, mais garde « absent » (null)

  // Compte studio (21/10) : versions enregistrées au nom du studio (p_studio), comme ses montages.
  const rpc = async (name, args) => {
    const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc(name, window.__lpStudioBuyer ? Object.assign({}, args, { p_studio: true }) : args);
    if (error) throw error;
    return data;
  };
  const api = {
    list: captureId => rpc('list_video_capture_versions', { p_capture_id: captureId }),
    // alt (10/11, migration 20261110010000) : frise propre à la version { events, laneOverrides, collapsedGroups, markers } ; absent = on garde ce qui est en base.
    save: (id, captureId, title, subs, alt) => rpc('save_video_capture_version', Object.assign({ p_id: id, p_capture_id: captureId, p_title: title || '', p_substitutions: subs },
      alt ? { p_events: alt.events || null, p_lane_overrides: alt.laneOverrides || null, p_collapsed_groups: alt.collapsedGroups || null, p_markers: alt.markers || null, p_lane_layout: alt.laneLayout || null } : {})),
    setExport: (id, videoId, cues, keepOld) => rpc('set_video_capture_version_export', { p_id: id, p_video_id: videoId, p_cues: cues || null, p_keep_old: keepOld !== false }),
    remove: id => rpc('delete_video_capture_version', { p_id: id }),
    setStatus: (id, status) => rpc('set_video_capture_version_status', { p_id: id, p_status: status }),
    freezeOriginal: captureId => rpc('freeze_video_review_original', { p_capture_id: captureId }), // révision de la version n° 1 (migration 20261110030000)
    // Lien de relecture client et remarques (9/11, migrations 20261109020000 puis 20261109030000 : adresse lisible + clé magique ou mot de passe).
    getLink: captureId => rpc('get_video_review_link', { p_capture_id: captureId }),
    // o : { enabled, slug, mode: 'magic'|'password', password, rotate } — tout est facultatif sauf à la création (adresse).
    setLink: (captureId, o) => rpc('set_video_review_link', { p_capture_id: captureId, p_enabled: o.enabled == null ? null : o.enabled, p_slug: o.slug || null, p_mode: o.mode || null, p_password: o.password || null, p_rotate: !!o.rotate }),
    listComments: captureId => rpc('list_video_review_comments', { p_capture_id: captureId }),
    reply: (parentId, body, author) => rpc('reply_video_review_comment', { p_parent_id: parentId, p_body: body, p_author: author }),
    resolve: (id, resolved) => rpc('resolve_video_review_comment', { p_id: id, p_resolved: resolved }),
    removeComment: id => rpc('delete_video_review_comment', { p_id: id }),
  };
  // Statuts de relecture d'une version vidéo (9/11, idée Pibox) : même liste que la contrainte de la migration 20261109010000.
  const STATUSES = ['draft', 'sent', 'changes_requested', 'approved'];
  const statusOf = v => (v && STATUSES.indexOf(v.status) >= 0 ? v.status : 'draft');
  // Fonctions serveur absentes : la migration n'a pas encore été appliquée.
  const isMissingBackend = e => /does not exist|could not find the function|PGRST202|42883|42P01/i.test((e && (e.message || e.code)) || '');

  // Même interface que `api`, en mémoire (versions de la séance, perdues à la fermeture du panneau).
  function memoryApi() {
    const rows = new Map(); // id -> version
    return {
      list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt).map(clone),
      save: async (id, captureId, title, subs, alt) => {
        const prev = rows.get(id);
        const a = alt ? { events: alt.events || null, laneOverrides: alt.laneOverrides || null, collapsedGroups: alt.collapsedGroups || null, markers: alt.markers || null, laneLayout: alt.laneLayout || null } : { events: prev ? prev.events : null, laneOverrides: prev ? prev.laneOverrides : null, collapsedGroups: prev ? prev.collapsedGroups : null, markers: prev ? prev.markers : null, laneLayout: prev ? prev.laneLayout : null };
        rows.set(id, { id, captureId, title: title || '', substitutions: clone(subs), events: clone2(a.events), laneOverrides: clone2(a.laneOverrides), collapsedGroups: clone2(a.collapsedGroups), markers: clone2(a.markers), laneLayout: clone2(a.laneLayout), lastExportVideoId: prev ? prev.lastExportVideoId : null, createdAt: prev ? prev.createdAt : Date.now(), status: prev ? prev.status : 'draft', statusAt: prev ? prev.statusAt : null });
      },
      setExport: async (id, videoId) => { const v = rows.get(id); if (v) v.lastExportVideoId = videoId; }, // (session : pas d'étiquettes rangées)
      remove: async id => { rows.delete(id); },
      setStatus: async (id, status) => { const v = rows.get(id); if (v) { v.status = status; v.statusAt = new Date().toISOString(); } },
    };
  }

  function mount(host, ctx) {
    const tr = ctx.tr;
    const store = ctx.sessionOnly ? memoryApi() : api;
    let versions = [];
    let loadError = null;
    let editing = null; // { id, title, subs, isNew, titleTouched }
    let listening = null; // { key, stop() }
    let busy = false;
    // Relecture client : le lien secret du montage et les remarques reçues (rien en versions de séance : il faut un montage enregistré).
    const review = { link: null, comments: [], available: true, replying: null, drafts: {}, reveal: null, editing: null, form: { slug: '', mode: 'magic', password: '' } };
    let diffView = null; // { ids: [id] } -> tableau de différences sous la liste (1 version contre l'original, ou 2 versions entre elles)
    const pickedIds = new Set(); // versions cochées, gardées d'un affichage à l'autre
    let batchStatus = ''; // avancement du rendu en série (survit aux ré-affichages de la section)
    const setBatchStatus = m => { batchStatus = m; const el = host.querySelector('[data-role="batchStatus"]'); if (el) el.textContent = m; };
    const durationCache = new Map(); // "id|fichier" -> secondes (fichiers décodés à la demande)
    // Publication automatique des versions (09/11) : « Sauvegarder / publier » du Backstage (ou « Publier le montage » dans le studio) publie aussi
    // les versions enregistrées qui ont changé depuis leur dernière publication. Clé d'une version = ses remplacements + l'état du montage
    // (la retouche du montage change toutes ses versions, Q5) ; published = clé au moment où la version a été publiée ou vue pour la première fois.
    const published = new Map();
    const baseKey = () => (ctx.getSoundKey ? ctx.getSoundKey() : '');
    // Une version sans nom s'appelle « Version alternative #n » (n = rang de création, la version n° 1 étant le montage), plus jamais « Sans titre ».
    function verName(v) { if (v && v.title) return v.title; const i = versions.findIndex(x => x.id === (v && v.id)); return tr('altDefaultName').replace('{n}', String((i < 0 ? versions.length : i) + 2)); }
    const keyOf = v => JSON.stringify({ s: v.substitutions, b: baseKey(), o: v.events ? [v.events, v.laneOverrides] : null }); // frise propre (alternative) : elle seule compte, le montage n'y change rien
    // Version avec sa propre frise (alternative retouchée) : elle ne dépend plus du montage.
    const needsPublish = v => !v.lastExportVideoId || (published.has(v.id) && published.get(v.id) !== keyOf(v));
    const canPublish = () => !ctx.sessionOnly && !!ctx.publishVersion && ctx.getCaptureId() && ctx.getCaptureId() !== 'session';

    // ---- Ingrédients du montage ----
    const ingredients = () => {
      const events = ctx.getEvents() || [];
      const trackIds = [...new Set(events.filter(e => e.name !== 'stinger_play' && e.detail && e.detail.trackId).map(e => e.detail.trackId))].filter(id => ctx.findTrack(id));
      const sfxIds = [...new Set(events.filter(e => e.name === 'stinger_play').map(e => e.detail.sfxId))].filter(id => ctx.findSfx(id));
      return { trackIds, sfxIds };
    };
    // Autres packs du compositeur ajoutés au choix du Versioning (06/11, demande de Jules-Antoine) : leurs morceaux et Sfx s'ajoutent à ceux
    // du pack ouvert. Choix de séance seulement (pas enregistré) : une version enregistrée cite déjà les morceaux par identifiant.
    const extraPackIds = [];
    const extraOf = pid => (ctx.extraPackContent ? ctx.extraPackContent(pid) : null) || { tracks: [], sfx: [] };
    const lib = () => {
      const base = ctx.library;
      if (!extraPackIds.length) return base;
      const seenT = new Set((base.library || []).map(t => t.id)), seenS = new Set((base.sfxLibrary || []).map(x => x.id));
      const tracks = (base.library || []).slice(), sfx = (base.sfxLibrary || []).slice();
      extraPackIds.forEach(pid => { const c = extraOf(pid); c.tracks.forEach(t => { if (!seenT.has(t.id)) { seenT.add(t.id); tracks.push(t); } }); c.sfx.forEach(x => { if (!seenS.has(x.id)) { seenS.add(x.id); sfx.push(x); } }); });
      return Object.assign({}, base, { library: tracks, sfxLibrary: sfx });
    };
    // Les dossiers Sfx portent leur nom dans `label` (06/11 : on lisait name/title et l'on affichait l'identifiant brut) ; sans nom, « Dossier n ».
    const folderLabel = (f, i) => f.label || f.name || f.title || tr('defaultOrgFolderLabel').replace('{n}', String(i + 1));
    const folderName = id => { const all = ctx.library.sfxFolders || []; const i = all.findIndex(x => x.id === id); return i < 0 ? '' : folderLabel(all[i], i); };

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
    async function versionResult(subs, own) {
      await ensureDurations(subs);
      return RT().retarget(own || ctx.getEvents() || [], subs || {}, {
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

    // ---- Différences (9/11, idée Pibox) : ce que chaque version change par rapport à l'original, ou l'une par rapport à l'autre ----
    // Colonnes = l'original puis 1 ou 2 versions. Lignes = chaque morceau / Sfx touché par au moins une des versions affichées.
    function diffModel(list) {
      const rows = [];
      const cellOf = (subs, kind, id) => {
        if (kind === 'track') {
          const s = subs && subs.tracks && subs.tracks[id];
          return s && s.to ? { key: 'to:' + s.to + (s.snapToImage ? '*' : ''), text: trackTitle(s.to) + (s.snapToImage ? ' (' + tr('versioningSnapShort') + ')' : '') } : { key: '', text: null };
        }
        const has = subs && subs.sfx && Object.prototype.hasOwnProperty.call(subs.sfx, id);
        if (!has) return { key: '', text: null };
        const to = subs.sfx[id];
        return to ? { key: 'to:' + to, text: sfxTitle(to) } : { key: 'choose', text: null, toChoose: true };
      };
      ['track', 'sfx'].forEach(kind => {
        const ids = new Set();
        list.forEach(v => Object.keys(((v.substitutions || {})[kind === 'track' ? 'tracks' : 'sfx']) || {}).forEach(id => ids.add(id)));
        ids.forEach(id => {
          const cells = list.map(v => cellOf(v.substitutions, kind, id));
          if (cells.every(c => !c.key)) return; // aucune version ne touche cet élément
          rows.push({ kind, id, label: kind === 'track' ? trackTitle(id) : sfxTitle(id), cells, differ: cells.length === 2 && cells[0].key !== cells[1].key });
        });
      });
      return rows;
    }
    function diffHtml() {
      const list = (diffView ? diffView.ids : []).map(id => versions.find(x => x.id === id)).filter(Boolean);
      if (!list.length) return '';
      const rows = diffModel(list);
      const name = v => verName(v);
      const cell = (c, differ) => {
        if (c.toChoose) return `<td class="vcv-diff-choose">${esc(tr('versioningDiffToChoose'))}</td>`;
        if (!c.key) return `<td class="vcv-diff-same">${esc(tr('versioningDiffSame'))}</td>`;
        return `<td class="${differ ? 'vcv-diff-changed' : ''}">${esc(c.text)}</td>`;
      };
      let html = `<div class="vcv-diff"><div class="vcv-diff-head"><span class="vcv-title">${esc(list.length === 2 ? tr('versioningDiffCompareTitle') : tr('versioningDiffTitle'))}</span>`
        + `<button type="button" class="video-capture-download-btn" data-act="closeDiff">${esc(tr('versioningDiffClose'))}</button></div>`;
      if (!rows.length) return html + `<div class="vcv-empty">${esc(tr('versioningNoChange'))}</div></div>`;
      html += `<table class="vcv-diff-table"><thead><tr><th></th><th>${esc(tr('versioningDiffOriginal'))}</th>${list.map(v => `<th>${esc(name(v))}</th>`).join('')}</tr></thead><tbody>`;
      rows.forEach(r => {
        html += `<tr><td class="vcv-diff-label"><span class="vcv-diff-kind">${esc(r.kind === 'track' ? tr('versioningDiffKindTrack') : 'Sfx')}</span> ${esc(r.label)}</td><td>${esc(r.label)}</td>${r.cells.map(c => cell(c, r.differ)).join('')}</tr>`;
      });
      return html + `</tbody></table></div>`;
    }

    // ---- Écoute en direct sur la vidéo : rendu du son (quelques secondes), puis lecture calée sur l'image ----
    // Le calage lui-même (départ quand l'image joue vraiment, recalage après un saut, une attente, un changement de vitesse ou une
    // dérive, latence de sortie) est celui de layerpitch-av-sync.js, commun à toutes les écoutes de l'atelier (12/11).
    // listenSeq : chaque nouvelle écoute (ou arrêt) périme celle qui se préparait encore -- deux clics rapprochés ne superposent plus
    // deux musiques, et une écoute arrêtée pendant son calcul ne repart pas toute seule à la fin du calcul.
    let listenSeq = 0;
    function stopListening() {
      listenSeq++;
      if (abPending) { abPending = ''; renderAbDock(); }
      if (!listening) return;
      const l = listening;
      listening = null;
      try { l.stop(); } catch (e) { console.error(e); }
      render();
    }
    async function renderSound(subs, own, onProgress) {
      const { events } = await versionResult(subs, own);
      const plan = P().buildPlan(events, { findTrack: ctx.findTrack, findSfx: ctx.findSfx }).plan;
      return window.LayerCaptureRender.render(plan, { fetchBytes: ctx.fetchBytes, onProgress });
    }
    // L'image d'abord (le son la suit dès qu'elle joue vraiment). Renvoie false si l'écoute est périmée ou si le navigateur refuse.
    async function startVideo(seq) {
      const video = ctx.videoEl;
      video.muted = true;
      await video.play().catch(() => {});
      return seq === listenSeq && !video.paused;
    }
    // État d'une écoute : le son suit la vidéo ; une pause de la vidéo (ou sa fin) termine l'écoute.
    function followVideo(key, buffers, active) {
      const video = ctx.videoEl;
      const state = { key };
      const end = () => { if (listening === state) stopListening(); };
      const sync = window.LayerPitchAVSync.follow(video, { buffers, active, onEnded: end });
      video.addEventListener('pause', end);
      state.sync = sync;
      state.stop = () => { video.removeEventListener('pause', end); sync.stop(); if (!video.paused) video.pause(); };
      return state;
    }
    async function listen(key, subs, statusEl, own) {
      if (listening && listening.key === key) { stopListening(); return; }
      stopListening();
      const seq = ++listenSeq;
      C().resumeAudio(); // pendant le geste : Safari refuse de réveiller le son plus tard
      statusEl.textContent = tr('versioningPreparingListen');
      try {
        const buffer = await renderSound(subs, own, (i, n) => { if (seq === listenSeq) statusEl.textContent = tr('captureEngineProgress').replace('{i}', i).replace('{n}', n); });
        if (seq !== listenSeq) return;
        await C().resumeAudio();
        if (!await startVideo(seq)) { if (seq === listenSeq) statusEl.textContent = ''; return; }
        listening = followVideo(key, [buffer], 0);
        statusEl.textContent = '';
        render();
      } catch (e) {
        console.error(e);
        if (seq === listenSeq) statusEl.textContent = tr('versioningListenFailed').replace('{error}', e.message);
      }
    }

    // ---- Écoute multi-versions (9/11, idée Pibox « bascule A/B », étendue) : la musique d'origine + TOUTES les versions, dans un menu déroulant ----
    // On commence par la version choisie ; les autres se préparent (rendu du son) en tâche de fond puis s'ajoutent au menu. Tous les sons sont
    // calés sur la vidéo et jouent ensemble, un seul audible : changer de version ne fait que changer le volume (immédiat, sans couper la vidéo).
    let abSeq = 0;
    let abPending = ''; // message du dock tant que la première version n'est pas prête (le menu n'existe pas encore)
    async function listenAB(list, statusEl, startIdx) {
      if (listening && listening.key === 'ab') { stopListening(); return; }
      stopListening();
      const seq = ++listenSeq;
      C().resumeAudio();
      startIdx = Math.min(Math.max(startIdx || 0, 0), list.length - 1);
      statusEl.textContent = tr('versioningPreparingListen');
      abPending = tr('versioningLoadingFirst'); renderAbDock();
      const live = () => seq === listenSeq;
      const renderOne = (i, progress) => renderSound(list[i].subs, list[i].own, (n, tot) => progress(list[i].label + ' — ' + tr('captureEngineProgress').replace('{i}', n).replace('{n}', tot)));
      try {
        const first = await renderOne(startIdx, m => { if (!live()) return; statusEl.textContent = m; abPending = tr('versioningLoadingFirst') + ' ' + m; renderAbDock(); });
        if (!live()) return;
        await C().resumeAudio();
        if (!await startVideo(seq)) { if (live()) { statusEl.textContent = ''; abPending = ''; renderAbDock(); } return; }
        const state = followVideo('ab', list.map((x, i) => (i === startIdx ? first : null)), startIdx);
        state.ab = { id: ++abSeq, labels: list.map(x => x.label), ids: list.map(x => x.id || ''), active: startIdx, ready: list.map((x, i) => i === startIdx), failed: list.map(() => false), note: '' };
        state.setActive = i => { if (state.sync.setActive(i)) { state.ab.active = i; render(); } };
        // Touches 1, 2, 3… : bascule au clavier, sans quitter la vidéo (pas dans un champ de saisie).
        const doc = ctx.videoEl.ownerDocument || document;
        const onKey = ev => {
          if (ev.metaKey || ev.ctrlKey || ev.altKey || !/^[1-9]$/.test(ev.key)) return;
          if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
          const i = Number(ev.key) - 1;
          if (state.ab.ready[i]) { ev.preventDefault(); state.setActive(i); }
        };
        doc.addEventListener('keydown', onKey);
        const stopFollow = state.stop;
        state.stop = () => { doc.removeEventListener('keydown', onKey); stopFollow(); };
        listening = state;
        abPending = '';
        statusEl.textContent = '';
        render();
        // Les autres versions : préparées l'une après l'autre pendant que la première joue ; chacune rejoint la lecture en cours.
        for (let i = 0; i < list.length && live(); i++) {
          if (i === startIdx) continue;
          try {
            const buf = await renderOne(i, m => { if (!live()) return; state.ab.note = m; renderAbDock(); });
            if (!live()) break;
            state.sync.setBuffer(i, buf);
            state.ab.ready[i] = true;
          } catch (e) { console.error(e); state.ab.failed[i] = true; }
          if (!live()) break;
          state.ab.note = '';
          renderAbDock();
        }
      } catch (e) {
        console.error(e);
        if (!live()) return;
        abPending = ''; renderAbDock();
        statusEl.textContent = tr('versioningListenFailed').replace('{error}', e.message);
      }
    }
    // Sélecteur d'écoute : rangé sous la vidéo, dans le « dock » qui reste en haut quand on défile -- on peut donc toujours changer de version
    // pendant l'écoute, où qu'on soit dans la page. Construit une fois par écoute, ensuite mis à jour sur place (le menu ouvert ne se referme pas).
    function abDock() {
      const dock = ctx.videoEl && ctx.videoEl.closest && ctx.videoEl.closest('.video-capture-dock');
      if (!dock) return null;
      let el = dock.querySelector('.vcv-ab-dock');
      if (!el) { el = dock.ownerDocument.createElement('div'); el.className = 'vcv-ab-dock'; el.hidden = true; dock.appendChild(el); }
      return el;
    }
    function renderAbDock() {
      const el = abDock();
      if (!el) return;
      if (!listening || !listening.ab) {
        if (abPending) { el.hidden = false; el.dataset.sid = 'pending'; el.innerHTML = `<span class="vcv-ab-note vcv-ab-loading">${esc(abPending)}</span>`; return; }
        el.innerHTML = ''; el.hidden = true; el.dataset.sid = ''; return;
      }
      const ab = listening.ab;
      el.hidden = false;
      if (el.dataset.sid !== String(ab.id)) {
        el.dataset.sid = String(ab.id);
        el.innerHTML = `<span class="vcv-ab-lbl">${esc(tr('versioningABListening'))}</span><select class="video-capture-load-select vcv-ab-select" aria-label="${esc(tr('versioningABListening'))}"></select>`
          + `<span class="vcv-ab-note" data-role="abNote"></span><button type="button" class="video-capture-download-btn" data-stop="1">${esc(tr('versioningStopListenBtn'))}</button>`;
        const sel = el.querySelector('select');
        sel.addEventListener('change', () => { if (listening && listening.setActive) listening.setActive(Number(sel.value)); });
        el.querySelector('[data-stop]').addEventListener('click', () => stopListening());
      }
      const sel = el.querySelector('select');
      const opts = ab.labels.map((l, i) => `${i < 9 ? i + 1 + ' · ' : ''}${l}${ab.failed[i] ? ' ✗' : ab.ready[i] ? '' : ' …'}`);
      if (sel.options.length !== ab.labels.length) sel.innerHTML = ab.labels.map((l, i) => `<option value="${i}"></option>`).join('');
      [...sel.options].forEach((o, i) => { o.textContent = opts[i]; o.disabled = !ab.ready[i]; });
      sel.value = String(ab.active);
      // Tant qu'une version n'est pas prête : message bien visible (n/total) ; ensuite, « toutes prêtes ».
      const done = ab.ready.filter(Boolean).length, failed = ab.failed.filter(Boolean).length;
      const noteEl = el.querySelector('[data-role="abNote"]');
      noteEl.classList.toggle('vcv-ab-loading', done + failed < ab.labels.length);
      noteEl.textContent = done + failed < ab.labels.length
        ? tr('versioningLoadingAll').replace('{i}', done).replace('{n}', ab.labels.length) + (ab.note ? ' — ' + ab.note : '')
        : tr('versioningAllReady');
    }
    function render() { renderList(); renderAbDock(); }

    // ---- Rendu d'une ou plusieurs versions (l'une après l'autre) ----
    const slug = s => String(s || 'version').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'version';
    async function renderVersions(list, mode, toLibrary) {
      busy = true; render();
      let done = 0;
      try {
        for (const v of list) {
          const label = (m) => setBatchStatus('« ' + (verName(v)) + ' » (' + (done + 1) + '/' + list.length + ') — ' + m);
          const { events } = await versionResult(v.substitutions, v.events);
          const blob = await ctx.exportEvents(events, mode, label, v.laneOverrides);
          const title = (ctx.getCaptureTitle() ? ctx.getCaptureTitle() + ' — ' : '') + (v.title || '');
          const a = document.createElement('a');
          const url = URL.createObjectURL(blob);
          a.href = url; a.download = slug(title) + (mode === 'audio' ? '.wav' : '.mp4');
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          if (toLibrary && mode !== 'audio') {
            label(tr('captureAddingToLibrary'));
            // Pages LayerPitch : la version publiée n'est qu'un son, joué sur la vidéo muette du montage (21/10) ; sans cette fonction (ancien
            // appelant), la vidéo complète comme avant.
            const videoId = ctx.publishVersion && ctx.getCaptureId() !== 'session' ? await ctx.publishVersion(events, title) : await ctx.saveToLibrary(blob, title);
            const res = await store.setExport(v.id, videoId, ctx.cuesOf ? ctx.cuesOf(events, v.laneOverrides) : null, ctx.keepOld ? ctx.keepOld() : true); // vidéo + étiquettes : tous les endroits qui montrent ce montage suivent
            if (ctx.afterExport) ctx.afterExport(res && res.data); // historique (3 derniers) et fichiers à effacer
            v.lastExportVideoId = videoId; published.set(v.id, keyOf(v));
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
    // Plusieurs rechargements peuvent se croiser (enregistrement automatique, montage ouvert, publication) : seul le DERNIER compte. Avant le
    // 12/11, une réponse lente d'un ancien montage pouvait arriver après celle du nouveau et l'écraser (versions d'un autre montage affichées).
    // La liste n'est plus vidée pendant le chargement d'un même montage : une version alternative en cours d'enregistrement y reste trouvable.
    let refreshSeq = 0, refreshing = null, versionsOf = null;
    function refresh() { const p = doRefresh(++refreshSeq); refreshing = p; return p; }
    async function doRefresh(seq) {
      stopListening();
      const captureId = ctx.getCaptureId();
      if (editing && editing.captureId !== captureId) editing = null;
      if (versionsOf !== captureId) { versions = []; versionsOf = captureId; }
      let next = [], err = null;
      if (captureId) {
        try { next = (await store.list(captureId)) || []; }
        catch (e) { console.error(e); err = isMissingBackend(e) ? tr('versioningNotReady') : tr('versioningLoadFailed').replace('{error}', e.message); }
      }
      if (seq !== refreshSeq) return refreshing; // un rechargement plus récent a pris le relais : on attend le sien
      versions = next; loadError = err;
      versions.forEach(v => { if (v.lastExportVideoId && !published.has(v.id)) published.set(v.id, keyOf(v)); }); // déjà publiée : rien à refaire tant qu'on n'y touche pas
      await refreshReview();
      if (seq !== refreshSeq) return refreshing;
      render();
      if (ctx.onVersionsChanged) ctx.onVersionsChanged();
    }
    // Lien et remarques : lus avec les versions ; la migration absente masque simplement ce panneau.
    async function refreshReview() {
      review.link = null; review.comments = []; review.available = !ctx.sessionOnly;
      const revealFor = review.reveal && review.reveal.captureId === ctx.getCaptureId() ? review.reveal : null; review.reveal = revealFor; // la clé neuve reste affichée tant qu'on est sur ce montage
      // Tutoriel (faux serveur local) : pas de vrai lien à donner à un client, le panneau n'est pas proposé.
      try { if (window.LayerPitchDemoClient && window.LayerPitchSupabaseClient.getClient() === window.LayerPitchDemoClient) review.available = false; } catch (e) { /* client absent */ }
      const captureId = ctx.getCaptureId();
      if (!review.available || !captureId || loadError) { publishReviewMarks(); return; }
      try {
        review.link = await api.getLink(captureId);
        review.comments = review.link ? (await api.listComments(captureId)) || [] : [];
      } catch (e) { if (isMissingBackend(e)) review.available = false; else console.error(e); }
      publishReviewMarks();
    }
    const reviewVersionTitle = key => {
      if (key === 'original') return tr('versioningReviewOriginal');
      const v = versions.find(x => x.id === key);
      return v ? (verName(v)) : tr('captureUntitled');
    };
    // Les remarques du client deviennent des drapeaux sur la frise de l'atelier (ctx.onReviewComments, s'il est fourni).
    function publishReviewMarks() {
      if (!ctx.onReviewComments) return;
      const marks = review.comments.filter(c => !c.parentId).map(c => ({ id: c.id, t: Number(c.t), author: c.author, body: c.body, versionTitle: reviewVersionTitle(c.versionKey), resolved: !!c.resolved }));
      try { ctx.onReviewComments(marks); } catch (e) { /* la frise n'est pas prête : prochaine mise à jour */ }
    }
    const fmtT = t => { t = Math.max(0, Number(t) || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
    // Adresse lisible, sans la clé : /relecture/<nom>. La clé (lien magique) n'est montrée qu'une fois, à la création : voir review.reveal.
    const reviewAddress = slug => new URL('/relecture/' + slug, document.baseURI).href;
    const slugify = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    const reviewErr = e => {
      const m = String((e && (e.hint || '')) + ' ' + (e && e.message || ''));
      if (/taken|déjà prise/i.test(m)) return tr('versioningReviewSlugTaken');
      if (/slug|adresse/i.test(m)) return tr('versioningReviewSlugInvalid');
      if (/short|trop court/i.test(m)) return tr('versioningReviewPasswordShort');
      return tr('versioningReviewFailed').replace('{error}', (e && e.message) || '');
    };
    function reviewFormHtml(withSlug, withMode, withPassword) {
      const f = review.form;
      return `${withSlug ? `<div class="vcv-row"><label>${esc(tr('versioningReviewSlugLabel'))}</label><input type="text" class="vcv-link-input" data-role="rvSlug" maxlength="60" value="${esc(f.slug)}"></div><div class="vcv-hint">${esc(tr('versioningReviewSlugHint'))}</div>` : ''}
        ${withMode ? `<div class="vcv-row"><label><input type="radio" name="rvMode" data-role="rvMode" value="magic" ${f.mode === 'magic' ? 'checked' : ''}> ${esc(tr('versioningReviewModeMagic'))}</label>
          <label><input type="radio" name="rvMode" data-role="rvMode" value="password" ${f.mode === 'password' ? 'checked' : ''}> ${esc(tr('versioningReviewModePassword'))}</label></div>` : ''}
        ${withPassword && f.mode === 'password' ? `<div class="vcv-row"><label>${esc(tr('versioningReviewPasswordLabel'))}</label><input type="text" class="vcv-link-input" data-role="rvPassword" autocomplete="off" value="${esc(f.password)}"></div>` : ''}`;
    }
    function reviewHtml() {
      if (!review.available) return '';
      let html = `<div class="vcv-review-box"><div class="vcv-head"><span class="vcv-hint">${esc(tr('versioningReviewIntro'))}</span></div>`;
      if (!review.link) {
        if (!review.form.slug) review.form.slug = slugify(ctx.getCaptureTitle ? ctx.getCaptureTitle() : '');
        return html + reviewFormHtml(true, true, true) + `<div class="vcv-row"><button type="button" class="video-capture-download-btn" data-act="rvCreate" ${busy ? 'disabled' : ''}>${esc(tr('versioningReviewCreate'))}</button><span class="vcv-status" data-role="rvStatus"></span></div></div>`;
      }
      const L = review.link, on = L.enabled;
      const revealUrl = review.reveal && review.reveal.url ? review.reveal.url : '';
      if (revealUrl) html += `<div class="vcv-note-warn">${esc(tr('versioningReviewShowOnce'))}</div>
        <div class="vcv-row"><input type="text" readonly class="vcv-link-input" data-role="rvUrl" value="${esc(revealUrl)}" ${on ? '' : 'disabled'}>
        <button type="button" class="video-capture-download-btn" data-act="rvCopy" ${on ? '' : 'disabled'}>${esc(tr('versioningReviewCopy'))}</button></div>`;
      else html += `<div class="vcv-row"><input type="text" readonly class="vcv-link-input" data-role="rvUrl" value="${esc(reviewAddress(L.slug))}" ${on ? '' : 'disabled'}>
        <button type="button" class="video-capture-download-btn" data-act="rvCopy" ${on ? '' : 'disabled'}>${esc(tr('versioningReviewCopy'))}</button></div>`;
      html += `<div class="vcv-hint">${esc(tr(L.mode === 'password' ? 'versioningReviewPasswordMode' : 'versioningReviewMagicMode'))}</div>
        <div class="vcv-row"><button type="button" class="video-capture-download-btn" data-act="rvSendClient" ${on ? '' : 'disabled'} title="${esc(tr('versioningSendClientHelp'))}">${esc(tr('versioningSendClientBtn'))}</button></div>
        <div class="vcv-row"><button type="button" class="video-capture-download-btn" data-act="rvToggle">${esc(tr(on ? 'versioningReviewDisable' : 'versioningReviewEnable'))}</button>
        <button type="button" class="video-capture-download-btn" data-act="rvRename">${esc(tr('versioningReviewRename'))}</button>
        ${L.mode === 'password'
          ? `<button type="button" class="video-capture-download-btn" data-act="rvPassword">${esc(tr('versioningReviewChangePassword'))}</button>`
          : `<button type="button" class="video-capture-download-btn" data-act="rvRotate" title="${esc(tr('versioningReviewRotateHelp'))}">${esc(tr('versioningReviewNewKey'))}</button>`}
        <button type="button" class="video-capture-download-btn" data-act="rvMode">${esc(tr('versioningReviewChangeMode'))}</button>
        <span class="vcv-status" data-role="rvStatus"></span></div>`;
      if (review.editing) {
        html += `<div class="vcv-review-edit">${review.editing === 'rename' ? reviewFormHtml(true, false, false) : review.editing === 'password' ? reviewFormHtml(false, false, true) : reviewFormHtml(false, true, true)}
          <div class="vcv-row"><button type="button" class="video-capture-download-btn" data-act="rvSave">${esc(tr('versioningReviewSave'))}</button></div></div>`;
      }
      if (!review.link.enabled) html += `<div class="vcv-note-warn">${esc(tr('versioningReviewOff'))}</div>`;
      const top = review.comments.filter(c => !c.parentId).sort((a, b) => (a.versionKey === b.versionKey ? Number(a.t) - Number(b.t) : String(a.versionKey).localeCompare(String(b.versionKey))));
      const open = top.filter(c => !c.resolved).length;
      html += `<div class="vcv-section"><span>${esc(tr('versioningReviewComments'))} ${top.length ? '(' + esc(tr('versioningReviewOpen').replace('{n}', open)) + ')' : ''}</span>
        <button type="button" class="video-capture-download-btn" data-act="rvRefresh">${esc(tr('versioningReviewRefresh'))}</button></div>`;
      if (!top.length) html += `<div class="vcv-empty">${esc(tr('versioningReviewNone'))}</div>`;
      top.forEach(c => {
        const replies = review.comments.filter(r => r.parentId === c.id);
        html += `<div class="vcv-rcm${c.resolved ? ' vcv-rcm-done' : ''}" data-cid="${esc(c.id)}">
          <div class="vcv-rcm-meta"><button type="button" class="vcv-rcm-t" data-act="rvSeek" title="${esc(tr('versioningReviewSeek'))}">${esc(fmtT(c.t))}</button>
            <span class="vcv-rcm-who">${esc(c.author)}</span><span class="vcv-rcm-ver">${esc(reviewVersionTitle(c.versionKey))}</span>${c.resolved ? `<span>✓ ${esc(tr('versioningReviewDone'))}</span>` : ''}</div>
          <div class="vcv-rcm-body">${esc(c.body)}</div>
          ${replies.map(r => `<div class="vcv-rcm-reply"><span class="vcv-rcm-who">${esc(r.author)}${r.fromOwner ? ' ✎' : ''}</span> ${esc(r.body)}</div>`).join('')}
          <div class="vcv-row"><button type="button" class="video-capture-download-btn" data-act="rvReply">${esc(tr('versioningReviewReply'))}</button>
            <button type="button" class="video-capture-download-btn" data-act="rvResolve">${esc(tr(c.resolved ? 'versioningReviewReopen' : 'versioningReviewResolve'))}</button>
            <button type="button" class="video-capture-download-btn" data-act="rvDelete">${esc(tr('versioningDeleteBtn'))}</button></div>
          ${review.replying === c.id ? `<div class="vcv-row"><textarea class="vcv-rcm-input" data-role="rvReplyText" rows="2" maxlength="2000" placeholder="${esc(tr('versioningReviewReplyPlaceholder'))}">${esc(review.drafts[c.id] || '')}</textarea>
            <button type="button" class="video-capture-download-btn" data-act="rvSend">${esc(tr('versioningReviewSend'))}</button></div>` : ''}
        </div>`;
      });
      return html + `</div>`;
    }
    async function reviewAction(fn, statusEl) {
      try { await fn(); await refreshReview(); render(); }
      catch (e) { if (e && e.handled) return; console.error(e); const el = statusEl || host.querySelector('[data-role="rvStatus"]'); if (el) el.textContent = tr('versioningReviewFailed').replace('{error}', e.message); }
    }
    // « Envoyer au client » (10/11) : on coche les versions alternatives à montrer ; la version n° 1 (le montage) est toujours envoyée. Cocher = « envoyée »
    // (une révision #n.m est figée), décocher = « brouillon » (le client ne la voit plus). Une version déjà approuvée reste approuvée.
    function openSendDialog() {
      const statusEl = host.querySelector('[data-role="rvStatus"]');
      const dlg = host.ownerDocument.createElement('dialog');
      dlg.className = 'video-test-dialog';
      const row = (id, label, checked, disabled) => `<label class="atelier-export-opt"><input type="checkbox" data-send="${esc(id)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}> ${esc(label)}</label>`;
      dlg.innerHTML = `<form method="dialog" class="video-test-form"><div class="video-test-dialog-title">${esc(tr('versioningSendClientTitle'))}</div>`
        + row('', tr('altOriginal'), true, true)
        + versions.map((v, i) => row(v.id, v.title || tr('altDefaultName').replace('{n}', String(i + 2)), statusOf(v) !== 'draft', false)).join('')
        + `<div class="video-test-dialog-actions"><button type="button" class="video-test-btn-secondary" value="cancel">${esc(tr('cancel'))}</button><button type="submit" class="video-test-btn-primary" value="go">${esc(tr('versioningSendClientGo'))}</button></div></form>`;
      host.appendChild(dlg);
      dlg.querySelector('[value="cancel"]').addEventListener('click', () => dlg.close('cancel'));
      dlg.addEventListener('close', async () => {
        const go = dlg.returnValue === 'go';
        const ticked = new Set([...dlg.querySelectorAll('[data-send]')].filter(c => c.checked && c.dataset.send).map(c => c.dataset.send));
        dlg.remove();
        if (!go) return;
        busy = true; render();
        try {
          if (ctx.publishMontage) await ctx.publishMontage(); // ce que le client verra est ce qui est publié
          if (canPublish()) await publishPending();
          for (const v of versions) {
            const cur = statusOf(v);
            const target = ticked.has(v.id) ? (cur === 'approved' ? cur : 'sent') : 'draft';
            if (target !== cur || target === 'sent') { await store.setStatus(v.id, target); v.status = target; v.statusAt = new Date().toISOString(); }
          }
          if (!ticked.size) await api.freezeOriginal(ctx.getCaptureId());
          setBatchStatus(tr('versioningSendClientDone'));
        } catch (e) { console.error(e); setBatchStatus(tr('versioningReviewFailed').replace('{error}', e.message)); }
        busy = false; render();
      });
      dlg.showModal();
    }
    function bindReview() {
      const captureId = ctx.getCaptureId();
      const on = (sel, fn) => host.querySelectorAll(sel).forEach(b => b.addEventListener('click', e => fn(e, b)));
      const readForm = () => {
        const g = r => host.querySelector('[data-role="' + r + '"]');
        if (g('rvSlug')) review.form.slug = g('rvSlug').value;
        host.querySelectorAll('[data-role="rvMode"]').forEach(r => { if (r.checked) review.form.mode = r.value; });
        if (g('rvPassword')) review.form.password = g('rvPassword').value;
      };
      host.querySelectorAll('[data-role="rvSlug"],[data-role="rvPassword"]').forEach(i => i.addEventListener('input', readForm));
      host.querySelectorAll('[data-role="rvMode"]').forEach(r => r.addEventListener('change', () => { readForm(); render(); })); // le champ mot de passe apparaît ou disparaît
      // Montre la clé neuve une fois : l'adresse + #k=<clé> (la clé reste après le #, elle ne part jamais vers un serveur).
      const revealIfKey = res => { review.reveal = res && res.secret ? { captureId, url: reviewAddress(res.slug) + '#k=' + encodeURIComponent(res.secret) } : null; };
      const send = (fn, after) => reviewAction(async () => {
        readForm();
        let res;
        try { res = await fn(); } catch (e) { const st = host.querySelector('[data-role="rvStatus"]'); if (st) st.textContent = reviewErr(e); throw Object.assign(new Error(reviewErr(e)), { handled: true }); }
        revealIfKey(res); review.editing = null; review.form.password = '';
        if (after) after();
      });
      on('[data-act="rvCreate"]', () => send(() => api.setLink(captureId, { enabled: true, slug: review.form.slug, mode: review.form.mode, password: review.form.password })));
      on('[data-act="rvSendClient"]', () => openSendDialog());
      on('[data-act="rvToggle"]', () => reviewAction(() => api.setLink(captureId, { enabled: !review.link.enabled })));
      on('[data-act="rvRename"]', () => { review.form.slug = review.link.slug; review.editing = review.editing === 'rename' ? null : 'rename'; render(); });
      on('[data-act="rvPassword"]', () => { review.form.mode = 'password'; review.form.password = ''; review.editing = review.editing === 'password' ? null : 'password'; render(); });
      on('[data-act="rvMode"]', () => { review.form.mode = review.link.mode === 'password' ? 'magic' : 'password'; review.form.password = ''; review.editing = review.editing === 'mode' ? null : 'mode'; render(); });
      on('[data-act="rvSave"]', () => {
        const ed = review.editing, f = review.form;
        if (ed === 'rename') send(() => api.setLink(captureId, { slug: f.slug }));
        else if (ed === 'password') send(() => api.setLink(captureId, { mode: 'password', password: f.password }));
        else send(() => api.setLink(captureId, { mode: f.mode, password: f.password }));
      });
      on('[data-act="rvRotate"]', async () => {
        const ok = await window.LayerPitchNotify.confirm(tr('versioningReviewNewKeyConfirm'), { okLabel: tr('versioningReviewNewKey'), danger: true });
        if (ok) send(() => api.setLink(captureId, { rotate: true }));
      });
      on('[data-act="rvCopy"]', async () => {
        const st = host.querySelector('[data-role="rvStatus"]'), input = host.querySelector('[data-role="rvUrl"]');
        try { await navigator.clipboard.writeText(input.value); st.textContent = tr('versioningReviewCopied'); }
        catch (e) { input.select(); st.textContent = tr('versioningReviewCopyManual'); }
      });
      on('[data-act="rvRefresh"]', () => reviewAction(async () => {}));
      host.querySelectorAll('[data-role="rvUrl"]').forEach(i => i.addEventListener('focus', () => i.select()));
      const cidOf = b => b.closest('.vcv-rcm').dataset.cid;
      on('[data-act="rvSeek"]', (e, b) => { const c = review.comments.find(x => x.id === cidOf(b)); if (c && ctx.videoEl) { try { ctx.videoEl.currentTime = Number(c.t); } catch (err) { /* vidéo pas prête */ } } });
      on('[data-act="rvResolve"]', (e, b) => { const c = review.comments.find(x => x.id === cidOf(b)); reviewAction(() => api.resolve(c.id, !c.resolved)); });
      on('[data-act="rvDelete"]', async (e, b) => {
        const id = cidOf(b);
        const ok = await window.LayerPitchNotify.confirm(tr('versioningReviewDeleteConfirm'), { okLabel: tr('versioningDeleteBtn'), danger: true });
        if (ok) reviewAction(() => api.removeComment(id));
      });
      on('[data-act="rvReply"]', (e, b) => { review.replying = review.replying === cidOf(b) ? null : cidOf(b); render(); const t = host.querySelector('[data-role="rvReplyText"]'); if (t) t.focus(); });
      host.querySelectorAll('[data-role="rvReplyText"]').forEach(t => t.addEventListener('input', () => { review.drafts[review.replying] = t.value; }));
      on('[data-act="rvSend"]', (e, b) => {
        const id = cidOf(b), text = (review.drafts[id] || '').trim();
        if (!text) return;
        reviewAction(async () => { await api.reply(id, text, ctx.authorName ? ctx.authorName() : tr('versioningReviewOwnerName')); review.drafts[id] = ''; review.replying = null; });
      });
    }

    // Publie les versions enregistrées qui n'ont jamais été publiées ou ont changé (force : toutes). Renvoie le nombre publié.
    async function publishPending(opts) {
      if (!canPublish()) return 0;
      await refresh();
      if (loadError) return 0;
      const todo = versions.filter(v => (opts && opts.force) || needsPublish(v));
      if (!todo.length) return 0;
      let n = 0;
      busy = true; render();
      try {
        for (const v of todo) {
          if (ctx.onProgress) ctx.onProgress(tr('versioningPublishing').replace('{name}', verName(v)).replace('{i}', n + 1).replace('{n}', todo.length));
          const key = keyOf(v);
          const { events } = await versionResult(v.substitutions, v.events);
          const title = (ctx.getCaptureTitle() ? ctx.getCaptureTitle() + ' — ' : '') + (v.title || '');
          const videoId = await ctx.publishVersion(events, title); // un son sur la vidéo muette du montage
          const res = await store.setExport(v.id, videoId, ctx.cuesOf ? ctx.cuesOf(events, v.laneOverrides) : null, ctx.keepOld ? ctx.keepOld() : true);
          if (ctx.afterExport) ctx.afterExport(res && res.data);
          v.lastExportVideoId = videoId; published.set(v.id, key); n++;
        }
      } finally { busy = false; render(); }
      return n;
    }

    // ---- Affichage ----
    // Une ligne « écoute » si c'est sa version qui sonne, seule ou dans le sélecteur multi-versions.
    function rowListening(v) {
      if (!listening) return false;
      if (listening.key === 'v:' + v.id) return true;
      return !!(listening.ab && listening.ab.ids[listening.ab.active] === v.id);
    }
    function renderList() {
      const captureId = ctx.getCaptureId();
      const { trackIds, sfxIds } = ingredients();
      let html = `<div class="vcv-head"><span class="vcv-title">${esc(tr('versioningTitle'))}</span><span class="vcv-hint">${esc(tr('versioningIntro'))}${ctx.sessionOnly ? ' ' + esc(tr('versioningSessionNote')) : ''}</span>`;
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
          <span class="vcv-name">${esc(verName(v))}</span>
          <select data-role="reviewStatus" class="vcv-review vcv-review-${statusOf(v)}" ${busy ? 'disabled' : ''} title="${esc(v.statusAt ? tr('versioningStatusSince').replace('{date}', new Date(v.statusAt).toLocaleDateString()) : tr('versioningStatusHelp'))}">${STATUSES.map(st => `<option value="${st}" ${statusOf(v) === st ? 'selected' : ''}>${esc(tr('versioningStatus_' + st))}</option>`).join('')}</select>
          ${v.statusBy ? `<span class="vcv-by">${esc(tr('versioningStatusBy').replace('{name}', v.statusBy))}</span>` : ''}
          <span class="vcv-summary">${esc(summaryOf(v.substitutions))}${v.lastExportVideoId ? ' · ' + esc(tr('versioningInLibrary')) : ''}</span>
          <button type="button" class="video-capture-download-btn" data-act="listen" ${busy ? 'disabled' : ''}>${esc(rowListening(v) ? tr('versioningStopListenBtn') : tr('versioningListenBtn'))}</button>
          <button type="button" class="video-capture-download-btn" data-act="edit" ${busy ? 'disabled' : ''}>${esc(tr('versioningEditBtn'))}</button>
          <details class="vcv-more"><summary class="video-capture-download-btn" title="${esc(tr('versioningMoreBtn'))}" aria-label="${esc(tr('versioningMoreBtn'))}">\u22EF</summary><div class="vcv-more-menu">
            <button type="button" class="video-capture-download-btn" data-act="diff" ${busy ? 'disabled' : ''} title="${esc(tr('versioningDiffHelp'))}">${esc(tr('versioningDiffBtn'))}</button>
            <button type="button" class="video-capture-download-btn" data-act="duplicate" ${busy ? 'disabled' : ''}>${esc(tr('versioningDuplicateBtn'))}</button>
            ${ctx.sessionOnly ? '' : `<button type="button" class="video-capture-download-btn" data-act="detach" ${busy ? 'disabled' : ''} title="${esc(tr('versioningDetachHelp'))}">${esc(tr('versioningDetachBtn'))}</button>`}
            <button type="button" class="video-capture-download-btn" data-act="delete" ${busy ? 'disabled' : ''}>${esc(tr('versioningDeleteBtn'))}</button>
          </div></details>
          <span class="vcv-status" data-role="status"></span>
        </div>`;
      });
      const rvHtml = reviewHtml();
      if (rvHtml) html += `<details class="vcv-review-fold" data-role="rvFold" ${review.open || (host.ownerDocument.body && host.ownerDocument.body.classList.contains('atelier-view-review')) ? 'open' : ''}><summary>${esc(tr('versioningReviewTitle'))}${review.link ? ` <span class="vcv-rv-state">${esc(tr(review.link.enabled ? 'versioningReviewStateOn' : 'versioningReviewStateOff'))}</span>` : ''}</summary>${rvHtml}</details>`;
      if (diffView) html += diffHtml();
      if (versions.length) {
        html += `<div class="vcv-picked-bar" data-role="pickedBar" ${pickedIds.size ? '' : 'hidden'}>
          <span class="vcv-picked-count" data-role="pickedCount">${esc(tr('versioningPickedCount').replace('{n}', pickedIds.size))}</span>
          <button type="button" class="video-capture-download-btn" data-act="compare" ${busy ? 'disabled' : ''} title="${esc(tr('versioningCompareHelp'))}">${esc(tr('versioningCompareBtn'))}</button>
          <button type="button" class="video-capture-download-btn" data-act="exportOpen" ${busy ? 'disabled' : ''}>${esc(tr('versioningExportBtn'))}</button>
          <span class="vcv-status" data-role="batchStatus">${esc(batchStatus)}</span>
        </div>
        <dialog class="video-test-dialog" data-role="exportDlg"><form method="dialog" class="video-test-form">
          <div class="video-test-dialog-title">${esc(tr('versioningExportDlgTitle'))}</div>
          <label class="atelier-export-opt"><input type="radio" name="vcvExportMode" value="audio" checked> ${esc(tr('captureExportAudioBtn'))}</label>
          <label class="atelier-export-opt"><input type="radio" name="vcvExportMode" value="copy"> ${esc(tr('captureExportCopyBtn'))}</label>
          <label class="atelier-export-opt"><input type="checkbox" data-role="toLibrary"> ${esc(tr('versioningToLibrary'))}</label>
          <div class="video-test-dialog-actions">
            <button type="button" class="video-test-btn-secondary" data-role="exportCancel">${esc(tr('cancel'))}</button>
            <button type="submit" class="video-test-btn-primary" value="go">${esc(tr('versioningExportGo'))}</button>
          </div>
        </form></dialog>`;
      }
      host.innerHTML = html;
      bindReview();
      const rvFold = host.querySelector('[data-role="rvFold"]');
      if (rvFold) rvFold.addEventListener('toggle', () => { review.open = rvFold.open; });
      host.querySelectorAll('.vcv-version').forEach(row => { if (pickedIds.has(row.dataset.id)) row.querySelector('[data-role="pick"]').checked = true; });
      bindList();
    }

    function editorHtml(trackIds, sfxIds) {
      const subs = editing.subs;
      let h = `<div class="vcv-editor">
        <div class="vcv-row"><span class="vcv-label">${esc(tr('versioningNameLabel'))}</span>
          <input type="text" class="video-capture-title-input vcv-name-input" data-role="title" value="${esc(editing.title)}" placeholder="${esc(autoTitle(subs))}"></div>`;
      const addable = (ctx.otherPacks || []).filter(x => extraPackIds.indexOf(x.id) < 0);
      if ((ctx.otherPacks || []).length) {
        h += `<div class="vcv-section">${esc(tr('versioningExtraPacksLabel'))}
          ${extraPackIds.map(pid => { const pk = (ctx.otherPacks || []).find(x => x.id === pid); return `<button type="button" class="video-capture-download-btn" data-role="removePack" data-pack="${esc(pid)}" title="${esc(tr('versioningRemovePack'))}">${esc(pk ? pk.title : pid)} ✕</button>`; }).join(' ')}
          ${addable.length ? `<select class="video-capture-load-select" data-role="addPack"><option value="">${esc(tr('versioningAddPack'))}</option>${addable.map(x => `<option value="${esc(x.id)}">${esc(x.title || x.id)}</option>`).join('')}</select>` : ''}
        </div>`;
      }
      if (trackIds.length) {
        h += `<div class="vcv-section">${esc(tr('versioningTracksLabel'))}</div>`;
        trackIds.forEach(id => {
          const src = ctx.findTrack(id);
          const cur = (subs.tracks || {})[id] || {};
          const baseIds = new Set((ctx.library.library || []).map(t => t.id));
          const others = (lib().library || []).filter(t => t.id !== id);
          const okAll = others.filter(t => RT().compareTracks(src, t).compatible);
          const ok = okAll.filter(t => baseIds.has(t.id));
          const optOf = t => `<option value="${esc(t.id)}" ${cur.to === t.id ? 'selected' : ''}>${esc(t.title || t.id)}</option>`;
          const extraGroups = extraPackIds.map(pid => {
            const pk = (ctx.otherPacks || []).find(x => x.id === pid);
            const ids = new Set(extraOf(pid).tracks.map(t => t.id));
            const list = okAll.filter(t => !baseIds.has(t.id) && ids.has(t.id));
            return list.length ? `<optgroup label="${esc(pk ? pk.title : pid)}">${list.map(optOf).join('')}</optgroup>` : '';
          }).join('');
          const sameModeBlocked = others.filter(t => t.mode === src.mode && !RT().compareTracks(src, t).compatible).length;
          h += `<div class="vcv-row">
            <span class="vcv-src">${esc(src.title || id)} <em>${esc(tr('versioningMode_' + src.mode))}</em></span><span class="vcv-arrow">→</span>
            <select class="video-capture-load-select" data-track="${esc(id)}">
              <option value="">${esc(tr('versioningKeepTrack'))}</option>
              ${ok.map(optOf).join('')}${extraGroups}
              ${!okAll.length ? `<option disabled>${esc(tr('versioningNoCompatible'))}</option>` : ''}
              ${sameModeBlocked ? `<option disabled>${esc(tr('versioningOthersBlocked').replace('{n}', sameModeBlocked))}</option>` : ''}
            </select>
            <label class="video-capture-export-opt" title="${esc(tr('versioningSnapHelp'))}"><input type="checkbox" data-snap="${esc(id)}" ${cur.snapToImage ? 'checked' : ''} ${cur.to ? '' : 'disabled'}> ${esc(tr('versioningSnapLabel'))}</label>
          </div>`;
        });
      }
      if (sfxIds.length) {
        const folders = (ctx.library.sfxFolders || []).filter(f => (lib().sfxLibrary || []).some(s => s.folderId === f.id)).map(f => ({ id: f.id, label: folderName(f.id) }));
        h += `<div class="vcv-section">${esc(tr('versioningSfxLabel'))}
          ${folders.length ? `<select class="video-capture-load-select" data-role="folder"><option value="">${esc(tr('versioningFolderPick'))}</option>${folders.map(f => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('')}</select>` : ''}
        </div>`;
        const byFolder = {};
        (lib().sfxLibrary || []).forEach(s => (byFolder[s.folderId || ''] = byFolder[s.folderId || ''] || []).push(s));
        sfxIds.forEach(id => {
          const src = ctx.findSfx(id);
          const has = subs.sfx && (id in subs.sfx);
          const cur = has ? subs.sfx[id] : undefined;
          const sugg = RT().suggestSfx(src, (lib().sfxLibrary || []));
          const groups = Object.keys(byFolder).filter(fid => byFolder[fid].some(s => s.id !== id)).map(fid => `<optgroup label="${esc(fid ? folderName(fid) : tr('versioningNoFolder'))}">${byFolder[fid].filter(s => s.id !== id).map(s =>
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
        const { notes } = await versionResult(editing.subs, editing.own);
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
      const addPackSel = q('[data-role="addPack"]');
      if (addPackSel) addPackSel.addEventListener('change', () => { if (addPackSel.value) { extraPackIds.push(addPackSel.value); render(); } });
      host.querySelectorAll('[data-role="removePack"]').forEach(b => b.addEventListener('click', () => { const i = extraPackIds.indexOf(b.dataset.pack); if (i >= 0) { extraPackIds.splice(i, 1); render(); } }));
      const folderSel = q('[data-role="folder"]');
      if (folderSel) folderSel.addEventListener('change', () => {
        if (!folderSel.value) return;
        const pool = (lib().sfxLibrary || []).filter(s => s.folderId === folderSel.value);
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
      q('[data-act="listenDraft"]').addEventListener('click', () => listen('draft', editing.subs, q('[data-role="draftStatus"]'), editing.own));
      q('[data-act="cancelDraft"]').addEventListener('click', () => { stopListening(); editing = null; render(); });
      q('[data-act="saveDraft"]').addEventListener('click', async () => {
        const status = q('[data-role="draftStatus"]');
        status.textContent = tr('captureSaving');
        try {
          const title = (editing.title || '').trim() || autoTitle(editing.subs);
          await store.save(editing.id, ctx.getCaptureId(), title, editing.subs, editing.alt || null);
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
        row.querySelector('[data-act="listen"]').addEventListener('click', () => {
          // Écoute en cours : « Écouter » sur une ligne bascule sur cette version (ou arrête, si c'est déjà elle qui sonne).
          if (listening && listening.ab) {
            const i = listening.ab.ids.indexOf(v.id);
            if (i >= 0 && listening.ab.active === i) stopListening();
            else if (i >= 0) listening.setActive(i);
            return;
          }
          // Sinon : on démarre sur cette version ; la musique d'origine et toutes les autres versions sont dans le menu du dock.
          const list = [{ id: '', label: tr('versioningABOriginal'), subs: { tracks: {}, sfx: {} } }]
            .concat(versions.map(x => ({ id: x.id, label: verName(x), subs: x.substitutions, own: x.events })));
          listenAB(list, status, 1 + versions.indexOf(v));
        });
        row.querySelector('[data-act="edit"]').addEventListener('click', () => { stopListening(); editing = { id: v.id, captureId: ctx.getCaptureId(), title: v.title, subs: clone(v.substitutions), own: v.events || null, isNew: false, titleTouched: true }; render(); });
        row.querySelector('[data-act="duplicate"]').addEventListener('click', () => { stopListening(); editing = { id: newId(), captureId: ctx.getCaptureId(), title: tr('versioningCopyOf').replace('{name}', v.title || ''), subs: clone(v.substitutions), own: v.events || null, alt: v.events ? { events: clone2(v.events), laneOverrides: clone2(v.laneOverrides), collapsedGroups: clone2(v.collapsedGroups), markers: clone2(v.markers), laneLayout: clone2(v.laneLayout) } : null, isNew: true, titleTouched: true }; render(); });
        row.querySelector('[data-role="pick"]').addEventListener('change', e => {
          if (e.target.checked) pickedIds.add(v.id); else pickedIds.delete(v.id);
          const bar = host.querySelector('[data-role="pickedBar"]');
          if (bar) { bar.hidden = pickedIds.size === 0; bar.querySelector('[data-role="pickedCount"]').textContent = tr('versioningPickedCount').replace('{n}', pickedIds.size); }
        });
        row.querySelector('[data-role="reviewStatus"]').addEventListener('change', async e => {
          const next = e.target.value;
          try { await store.setStatus(v.id, next); v.status = next; v.statusAt = new Date().toISOString(); render(); }
          catch (err) { console.error(err); status.textContent = tr('versioningStatusFailed').replace('{error}', err.message); e.target.value = statusOf(v); }
        });
        row.querySelector('[data-act="diff"]').addEventListener('click', () => { diffView = { ids: [v.id] }; render(); });
        const detachBtn = row.querySelector('[data-act="detach"]');
        if (detachBtn) detachBtn.addEventListener('click', async () => {
          const ok = await window.LayerPitchNotify.confirm(tr('versioningDetachConfirm').replace('{name}', v.title || ''), { okLabel: tr('versioningDetachBtn') });
          if (!ok) return;
          status.textContent = tr('captureSaving');
          try {
            const { events } = await versionResult(v.substitutions, v.events);
            await ctx.detach(events, (ctx.getCaptureTitle() ? ctx.getCaptureTitle() + ' — ' : '') + (v.title || ''));
          } catch (e) { console.error(e); status.textContent = tr('captureSaveFailed').replace('{error}', e.message); }
        });
        row.querySelector('[data-act="delete"]').addEventListener('click', async () => {
          const ok = await window.LayerPitchNotify.confirm(tr('versioningDeleteConfirm').replace('{name}', v.title || ''), { okLabel: tr('versioningDeleteBtn'), danger: true });
          if (!ok) return;
          try { await store.remove(v.id); pickedIds.delete(v.id); if (diffView && diffView.ids.indexOf(v.id) >= 0) diffView = null; await refresh(); }
          catch (e) { console.error(e); status.textContent = tr('versioningDeleteFailed').replace('{error}', e.message); }
        });
      });
      const closeDiff = host.querySelector('[data-act="closeDiff"]');
      if (closeDiff) closeDiff.addEventListener('click', () => { diffView = null; render(); });
      const compareBtn = host.querySelector('[data-act="compare"]');
      if (compareBtn) compareBtn.addEventListener('click', () => {
        const ids = versions.filter(x => pickedIds.has(x.id)).map(x => x.id);
        if (ids.length !== 2) { setBatchStatus(tr('versioningComparePickTwo')); return; }
        diffView = { ids }; render();
      });
      // Exporter… (09/11) : un seul bouton ; format et publication se choisissent dans ce dialogue, au moment de l'export.
      const exportOpen = host.querySelector('[data-act="exportOpen"]');
      const dlg = host.querySelector('[data-role="exportDlg"]');
      if (exportOpen && dlg) {
        exportOpen.addEventListener('click', () => { if (!pickedIds.size) { setBatchStatus(tr('versioningPickNone')); return; } dlg.showModal(); });
        dlg.querySelector('[data-role="exportCancel"]').addEventListener('click', () => dlg.close('cancel'));
        dlg.addEventListener('close', () => {
          if (dlg.returnValue !== 'go') return;
          const picked = versions.filter(x => pickedIds.has(x.id));
          if (!picked.length) { setBatchStatus(tr('versioningPickNone')); return; }
          const mode = dlg.querySelector('input[name="vcvExportMode"]:checked').value;
          const toLibrary = dlg.querySelector('[data-role="toLibrary"]').checked;
          stopListening();
          renderVersions(picked, mode, toLibrary);
        });
      }
    }

    // Menus « ⋯ » : un clic ailleurs les referme. Écouteur retiré avec le panneau (sinon il s'en empilait un par ouverture de vidéo).
    const menuDoc = host.ownerDocument;
    const closeMenus = e => {
      if (!host.isConnected) { menuDoc.removeEventListener('click', closeMenus); return; }
      host.querySelectorAll('.vcv-more[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
    };
    menuDoc.addEventListener('click', closeMenus);
    refresh();
    // Versions alternatives (10/11) : l'atelier lit et écrit les versions comme des montages complets (frise propre).
    const alternatives = {
      list: () => versions.slice(),
      // Une version « à l'ancienne » (remplacements de morceaux) devient une frise complète : le montage + ses remplacements.
      materialize: async v => (v.events ? { events: clone2(v.events) } : { events: clone2((await versionResult(v.substitutions)).events) }),
      // Crée (ou met à jour) une alternative avec sa propre frise ; les remplacements sont déjà intégrés à la frise, donc vides.
      createAlt: async (id, title, alt) => {
        const subs = { tracks: {}, sfx: {} };
        await store.save(id, ctx.getCaptureId(), title, subs, alt);
        versions.push({ id, captureId: ctx.getCaptureId(), title, substitutions: subs, events: alt.events, laneOverrides: alt.laneOverrides, collapsedGroups: alt.collapsedGroups, markers: alt.markers, laneLayout: alt.laneLayout, lastExportVideoId: null, status: 'draft', statusAt: null });
        render(); if (ctx.onVersionsChanged) ctx.onVersionsChanged();
      },
      // Retouche de la frise d'une alternative : les remplacements de morceaux sont déjà intégrés à sa frise (vidés), le nom ne change pas.
      saveAlt: async (id, alt) => {
        const v = versions.find(x => x.id === id);
        if (!v) throw new Error(tr('versioningLoadFailed').replace('{error}', id)); // jamais « enregistré » en silence (l'atelier croirait la frise à l'abri)
        const subs = { tracks: {}, sfx: {} };
        await store.save(id, ctx.getCaptureId(), v.title, subs, alt);
        Object.assign(v, { substitutions: subs, events: clone2(alt.events), laneOverrides: clone2(alt.laneOverrides), collapsedGroups: clone2(alt.collapsedGroups), markers: clone2(alt.markers), laneLayout: clone2(alt.laneLayout) });
      },
      rename: async (id, title) => {
        const v = versions.find(x => x.id === id); if (!v) return;
        await store.save(id, ctx.getCaptureId(), title, v.substitutions, null);
        v.title = title; render();
      },
      remove: async id => { await store.remove(id); versions = versions.filter(x => x.id !== id); published.delete(id); render(); if (ctx.onVersionsChanged) ctx.onVersionsChanged(); },
      reload: refresh,
      newId,
    };
    return { alternatives, refresh, render, stop: stopListening, isListening: () => !!listening, publishPending, hasPending: () => !!canPublish() && !loadError && versions.some(needsPublish) };
  }

  window.LayerCaptureVersioning = { mount };
})();
