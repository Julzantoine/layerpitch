// layerpitch-album-editor.js — LayerPitch, ÉDITEUR D'ALBUM UNIQUE (30/09, remboursement de la dette signalée le 29/09 :
// l'onglet Albums du Backstage compositeur et celui de l'espace studio avaient chacun leurs écrans, leur enregistrement,
// leurs co-ayants droit et leurs textes). Les deux pages utilisent maintenant ce module ; chacune fournit seulement ce qui la
// distingue (d'où viennent les morceaux, comment l'album est enregistré, où va la pochette).
//
//   const ed = LayerPitchAlbumEditor.create({ host, album, cfg })   un éditeur = UN album, dessiné dans `host`
//   ed.render()   ed.destroy()   ed.album
//   LayerPitchAlbumEditor.newAlbum() / fromApi(a) / fromContribution(c)   la forme de l'état d'un album
//
// cfg :
//   tracks()               morceaux cochables : [{ id, title, group? }]
//   trackTitle(id)         titre d'un morceau (défaut : l'identifiant)
//   ownIds()               (studio) ensemble des morceaux du vendeur ; les autres ont été ajoutés par un compositeur invité.
//                          Absent = tous les morceaux de l'album sont ceux du vendeur.
//   mediaBase              préfixe des images de pochette
//   save(payload)          enregistre l'album (upsert_album / upsert_studio_album) -> { ok, error, data }
//   uploadCover(al)        envoie la nouvelle pochette -> { illustration, illustrationOriginalName }
//   reload(id)             (optionnel) relit l'album après enregistrement -> objet renvoyé par listAlbums, ou null
//   checkBeforeSale(al)    (optionnel) texte d'erreur qui bloque l'enregistrement d'un album en vente
//   saveErrorHint(error)   (optionnel) indice ajouté à une erreur d'enregistrement
//   features               { contributors, rights, confirmRights }  (tout à faux par défaut)
//   actions(al)            boutons en plus d'« Enregistrer » : [{ id, label, primary?, onClick(al) }]
//   contribution           { save(al), leave(al) } pour l'album d'un studio où je suis compositeur invité (état fromContribution)
//   beforeAudio()          arrête ce qui joue ailleurs dans la page
//   renderCover(el, al, done)   (optionnel) commande de choix de pochette propre à la page ; done() redessine
//   confirm(text, opts)    boîte de confirmation (LayerPitchNotify.confirm)
//   onChange()             appelé après un enregistrement réussi
//
// Une seule écoute de version officielle et un seul enregistreur dans toute la page, quel que soit le nombre d'éditeurs
// affichés (Backstage : un par album). Textes : namespace « albumEditor » de layerpitch-i18n.js.
(function () {
  const lang = () => {
    const q = new URLSearchParams(location.search).get('lang');
    let stored = null;
    try { stored = localStorage.getItem('layerpitch_lang'); } catch (e) { /* stockage indisponible */ }
    return (q || stored || 'fr') === 'en' ? 'en' : 'fr';
  };
  function tr(key, vars) {
    const I = window.LAYERPITCH_I18N || { fr: {}, en: {} };
    let s = ((I[lang()] || {}).albumEditor || {})[key] || ((I.fr || {}).albumEditor || {})[key] || key;
    if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const A = () => window.LayerPitchAlbums;
  const shared = () => window.LayerPitchAlbumShared;
  const pctToBps = s => Math.round(Number(String(s || '').trim().replace(',', '.')) * 100);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const inviteUrl = () => location.origin + '/invitation.html' + (lang() === 'en' ? '?lang=en' : '');

  // ---- État d'un album ----
  const blank = () => ({
    id: null, title: '', presentationFr: '', presentationEn: '', priceInput: '', buyable: false, shopListed: false, listenMode: 'none', allowRandom: false,
    freeTrackIds: [], trackIds: [], saved: false, savedBuyable: false, savedTrackIds: [], officialDurations: {},
    illustration: null, illustrationOriginalName: null, pendingCover: null, pendingCoverUrl: null,
    confirmedRights: false, contributors: [], rights: null, msg: null,
  });
  function newAlbum() {
    // Identifiant aléatoire : albums.id est unique sur TOUTE la base (pas par vendeur), un titre slugifié risquerait de collisionner.
    const rand = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 12);
    return Object.assign(blank(), { id: 'alb_' + rand });
  }
  function fromApi(a) {
    return Object.assign(blank(), {
      id: a.id, title: a.title || '', presentationFr: a.presentationFr || '', presentationEn: a.presentationEn || '',
      priceInput: a.priceEurCents == null ? '' : (a.priceEurCents / 100).toFixed(2),
      buyable: !!a.buyable, shopListed: !!a.shopListed, listenMode: a.listenMode || 'none', allowRandom: !!a.allowRandom, freeTrackIds: (a.freeTrackIds || []).slice(),
      trackIds: (a.trackIds || []).slice(), saved: true, savedBuyable: !!a.buyable,
      // Morceaux enregistrés en base (seuls eux peuvent recevoir une version) et durée de leur version.
      savedTrackIds: (a.trackIds || []).slice(), officialDurations: Object.assign({}, a.officialDurations || {}),
      illustration: a.illustration || null, illustrationOriginalName: a.illustrationOriginalName || null, confirmedRights: !!a.buyable,
    });
  }
  // Album d'un studio où je suis compositeur invité : je n'y vois et n'y règle que MES morceaux.
  function fromContribution(c) {
    const mine = c.tracks || [], durations = {};
    mine.forEach(t => { if (t.hasOfficial) durations[t.trackId] = Number(t.duration) || 0; });
    return Object.assign(blank(), {
      id: c.albumId, title: c.title || '', contribution: true, studioName: c.studioName || c.studioEmail || '', buyable: !!c.buyable,
      trackIds: mine.map(t => t.trackId), saved: true, savedBuyable: !!c.buyable, savedTrackIds: mine.map(t => t.trackId),
      officialDurations: durations, illustration: c.illustration || null,
    });
  }

  // ---- Une seule écoute, un seul enregistreur pour toute la page ----
  const instances = new Set();
  const renderAll = () => instances.forEach(i => i.render());
  let playback = null, recorder = null; // recorder : { rec, owner }
  const getPlayback = () => playback || (playback = shared().createPlayback({
    onChange: renderAll,
    onError: text => { const o = playback && playback.owner; if (o) o.say(text, 'error'); },
  }));
  function closeRecorder() {
    const r = recorder; if (!r) return;
    recorder = null;
    r.rec.close();
  }
  // Le lecteur de l'enregistreur démarre : une version en écoute s'arrête.
  document.addEventListener('layerpitch-capture-mark', e => {
    if (e.detail && e.detail.name === 'track_play' && playback && playback.key()) { playback.stop(); renderAll(); }
  });

  let styled = false;
  function injectStyle() {
    if (styled) return; styled = true;
    const st = document.createElement('style');
    st.textContent = `.lpae-l{display:block;margin-top:16px;font-weight:600}
.lpae-hint{font-size:12px;color:var(--text-dim);margin:4px 0}
.lpae-row{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:var(--text-dim);font-weight:normal}
.lpae-row.wrap{flex-wrap:wrap}.lpae-row input[type=checkbox],.lpae-row input[type=radio]{width:auto;margin:0}
.lpae-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.lpae-msg{margin-top:8px;font-size:12px;color:#2e8b57}.lpae-msg.err{color:#c0392b}
.lpae-badge{font-size:11px;letter-spacing:.04em;color:var(--accent);background:var(--accent-soft);padding:3px 9px;border-radius:999px;white-space:nowrap}
.lpae-badge.bad{color:#c0392b;background:none;border:1px solid #c0392b}
.lpae-cover{width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border)}
.lpae-cover.empty{border-style:dashed}`;
    document.head.appendChild(st);
  }

  function create({ host, album, cfg }) {
    injectStyle();
    const al = album;
    const feat = cfg.features || {};
    const title = id => (cfg.trackTitle ? cfg.trackTitle(id) : id) || id;
    const ownSet = () => (cfg.ownIds ? cfg.ownIds() : null);
    const isOwn = id => { const o = ownSet(); return !o || o.has(id); };
    const inst = { album: al, render, destroy, say };

    function say(text, kind) { al.msg = text ? { text, kind: kind || 'ok' } : null; render(); }
    const msgHtml = () => al.msg ? `<div class="lpae-msg ${al.msg.kind === 'error' ? 'err' : ''}">${esc(al.msg.text)}</div>` : '';
    const btn = (attrs, label, cls) => `<button class="btn btn-small ${cls || ''}" type="button" ${attrs}>${esc(label)}</button>`;
    const PRIMARY = 'btn-primary primary', DANGER = 'btn-danger danger';

    // ---- Rendu ----
    function trackRows() {
      const list = cfg.tracks ? cfg.tracks() : [], own = ownSet();
      const listed = new Set(list.map(t => t.id));
      const row = (id, label) => {
        const pos = al.trackIds.indexOf(id);
        return `<label class="lpae-row"><input type="checkbox" data-ae-track="${esc(id)}"${pos >= 0 ? ' checked' : ''}><span>${pos >= 0 ? (pos + 1) + '. ' : ''}${esc(label)}</span></label>`;
      };
      let html = '', last;
      list.forEach(t => {
        if (t.group !== undefined && t.group !== last) { last = t.group; html += `<div class="lpae-hint"><strong>${esc(t.group)}</strong></div>`; }
        html += row(t.id, t.title || t.id);
      });
      // Morceau de l'album absent de la liste (ex. supprimé de la bibliothèque) : montré quand même, décochable, plutôt que perdu en silence.
      const orphans = al.trackIds.filter(id => !listed.has(id));
      if (!own) orphans.forEach(id => { html += row(id, id); });
      else if (orphans.length) html += `<div class="lpae-hint">${esc(tr('foreignTracks', { n: orphans.length }))}</div>`;
      return html || `<div class="lpae-hint">${esc(tr('noTracks'))}</div>`;
    }

    function officialRows() {
      const head = `<label class="lpae-l">${esc(tr('official'))}</label><div class="lpae-hint">${esc(tr('officialHint'))}</div>`;
      const mine = al.savedTrackIds.filter(isOwn);
      if (!al.saved || !mine.length) return head + `<div class="lpae-hint">${esc(tr('officialSaveFirst'))}</div>`;
      const pending = al.trackIds.join('|') !== al.savedTrackIds.join('|');
      const pb = getPlayback();
      return head + mine.map(id => {
        const done = has(al.officialDurations, id), key = al.id + '|' + id, playing = pb.key() === key;
        return `<div class="lpae-row wrap"><span style="min-width:0;flex:1 1 160px;color:var(--text)">${esc(title(id))}</span>
          ${done ? `<span>✓ ${esc(shared().fmtDuration(al.officialDurations[id]))}</span>` : `<span class="lpae-badge bad">${esc(tr('officialMissing'))}</span>`}
          ${done ? btn(`data-ae-play="${esc(id)}"`, tr(playing ? 'officialStop' : 'officialListen')) : ''}
          ${btn(`data-ae-record="${esc(id)}"`, tr(done ? 'officialRedo' : 'officialRecord'), done ? '' : PRIMARY)}
        </div><div data-ae-rec-host="${esc(key)}"></div>`;
      }).join('') + (pending ? `<div class="lpae-hint">${esc(tr('officialSaveFirst'))}</div>` : '');
    }

    function listeningRows() {
      const radio = (mode, key) => `<label class="lpae-row"><input type="radio" name="listen-${esc(al.id)}" data-ae-listen="${mode}"${al.listenMode === mode ? ' checked' : ''}><span>${esc(tr(key))}</span></label>`;
      const some = al.listenMode !== 'selected' ? '' : (al.trackIds.length
        ? al.trackIds.map(id => `<label class="lpae-row" style="margin-left:22px"><input type="checkbox" data-ae-free="${esc(id)}"${al.freeTrackIds.includes(id) ? ' checked' : ''}><span>${esc(title(id))}</span></label>`).join('')
        : `<div class="lpae-hint" style="margin-left:22px">${esc(tr('listenNoTracks'))}</div>`);
      return `<label class="lpae-l">${esc(tr('listenTitle'))}</label><div class="lpae-hint">${esc(tr('listenHint'))}</div>`
        + radio('none', 'listenNone') + radio('all', 'listenAll') + radio('selected', 'listenSome') + some
        // Le dé (6/10) : le fan peut écouter chaque morceau « vivant », tiré différemment à chaque écoute, à la place de la version figée.
        + `<label class="lpae-l">${esc(tr('randomTitle'))}</label><div class="lpae-hint">${esc(tr('randomHint'))}</div>`
        + `<label class="lpae-row"><input type="checkbox" data-ae-random${al.allowRandom ? ' checked' : ''}><span>${esc(tr('randomAllow'))}</span></label>`;
    }

    function contributorsRows() {
      if (!feat.contributors) return '';
      const head = `<label class="lpae-l">${esc(tr('contributors'))}</label>`;
      if (!al.saved) return head + `<div class="lpae-hint">${esc(tr('contributorsSaveFirst'))}</div>`;
      return head + `<div class="lpae-hint">${esc(tr('contributorsHint'))}</div>`
        + al.contributors.map(c => `<div class="lpae-row wrap"><span style="flex:1 1 160px;color:var(--text)">${esc(c.email)}</span>
            <span class="lpae-badge">${esc(tr('cstatus_' + c.status))}${c.status === 'accepted' ? ' · ' + esc(tr('trackCount', { n: c.trackCount })) : ''}</span>
            ${btn(`data-ae-remove-contrib="${esc(c.id)}"`, tr('remove'), DANGER)}</div>`).join('')
        + `<div class="lpae-row wrap"><input type="email" data-ae-invite-email placeholder="${esc(tr('emailPlaceholder'))}" style="flex:1 1 220px;min-width:0">${btn('data-ae-invite', tr('invite'))}</div>`;
    }

    function rightsRows() {
      if (!feat.rights) return '';
      const head = `<label class="lpae-l">${esc(tr('rights'))}</label>`;
      if (!al.saved) return head + `<div class="lpae-hint">${esc(tr('rightsSaveFirst'))}</div>`;
      const st = al.rights;
      if (!st || !st.loaded) { if (!st || !st.loading) setTimeout(loadRights, 0); return head + `<div class="lpae-hint">${esc(tr('loading'))}</div>`; }
      const radio = (v, key) => `<label class="lpae-row"><input type="radio" name="rights-${esc(al.id)}" data-ae-rights-decl value="${v}"${st.declaration === v ? ' checked' : ''}><span>${esc(tr(key))}</span></label>`;
      let html = head + `<div class="lpae-hint">${esc(tr('rightsHint'))}</div>` + radio('sole', 'rightsSole') + radio('shared', 'rightsShared');
      if (st.declaration === 'shared') {
        const others = st.rows.reduce((s, r) => s + (pctToBps(r.pct) || 0), 0);
        html += `<div style="margin:8px 0 0 22px">${st.rows.map((r, i) => `<div class="lpae-row wrap">
            <input type="email" data-ae-rrow="${i}" data-ae-rcol="email" value="${esc(r.email)}" placeholder="${esc(tr('emailPlaceholder'))}" style="flex:1 1 200px;min-width:0">
            <input type="text" inputmode="decimal" data-ae-rrow="${i}" data-ae-rcol="pct" value="${esc(r.pct)}" placeholder="30" style="width:70px"> %
            ${r.status ? `<span class="lpae-badge">${esc(tr('rstatus_' + r.status))}</span>` : ''}
            ${r.id && (r.status === 'pending' || r.status === 'self_pay') ? btn(`data-ae-rinvite="${esc(r.id)}"`, tr('rightsReinvite')) : ''}
            ${r.id && r.status === 'pending' ? btn(`data-ae-rselfpay="${esc(r.id)}" title="${esc(tr('rightsSelfPayHelp'))}"`, tr('rightsSelfPay')) : ''}
            ${btn(`data-ae-rremove="${i}"`, tr('remove'), DANGER)}</div>`).join('')}
          ${btn('data-ae-radd', tr('rightsAdd'))}
          <div class="lpae-hint">${esc(tr('rightsSellerShare', { pct: ((10000 - others) / 100).toLocaleString(lang()) }))}</div>
          <label class="lpae-row" style="align-items:flex-start"><input type="checkbox" data-ae-rack style="margin-top:3px"${st.ack ? ' checked' : ''}><span>${esc(tr('rightsDisclaimer'))}</span></label>
        </div>`;
      }
      html += `<div class="lpae-actions" style="margin-top:8px">${btn('data-ae-rsave', tr('rightsSave'))}</div>`;
      if (st.declaration === 'shared' && st.rows.some(r => r.status)) html += `<div class="lpae-hint">${esc(tr(st.settled ? 'rightsSettled' : 'rightsNotSettled'))}</div>`;
      if (st.msg) html += `<div class="lpae-msg ${st.msg.kind === 'error' ? 'err' : ''}">${esc(st.msg.text)}</div>`;
      return html;
    }

    function coverBlock() {
      const src = al.pendingCoverUrl || (al.illustration ? (cfg.mediaBase || '') + al.illustration : '');
      return `<label class="lpae-l">${esc(tr('cover'))}</label>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          ${src ? `<img class="lpae-cover" src="${esc(src)}" alt="">` : '<div class="lpae-cover empty"></div>'}
          <div data-ae-cover-ctrl>${cfg.renderCover ? '' : '<input type="file" data-ae-cover accept="image/png,image/jpeg,image/webp">'}</div>
        </div><div class="lpae-hint">${esc(tr('coverHint'))}</div>`;
    }

    function render() {
      if (al.contribution) { renderContribution(); return; }
      const extra = (cfg.actions ? cfg.actions(al) : []) || [];
      host.innerHTML = `<div class="lpae">
        <div class="lpae-row" style="margin-top:0"><input type="text" data-ae-field="title" maxlength="200" value="${esc(al.title)}" placeholder="${esc(tr('titlePlaceholder'))}" style="flex:1 1 240px;min-width:0;width:auto">
          ${al.saved ? '' : `<span class="lpae-badge">${esc(tr('unsavedBadge'))}</span>`}</div>
        <label class="lpae-l">${esc(tr('presFr'))}</label><textarea data-ae-field="presentationFr" rows="3">${esc(al.presentationFr)}</textarea>
        <label class="lpae-l">${esc(tr('presEn'))}</label><textarea data-ae-field="presentationEn" rows="3">${esc(al.presentationEn)}</textarea>
        ${coverBlock()}
        <label class="lpae-l">${esc(tr('price'))}</label>
        <input type="text" inputmode="decimal" data-ae-field="priceInput" placeholder="3.00" value="${esc(al.priceInput)}" style="max-width:140px">
        <div class="lpae-hint">${esc(tr('priceHint'))}</div>
        <label class="lpae-l">${esc(tr('tracks'))}</label>
        ${trackRows()}
        ${officialRows()}
        ${listeningRows()}
        ${contributorsRows()}
        ${rightsRows()}
        <label class="lpae-row" style="margin-top:16px"><input type="checkbox" data-ae-buyable${al.buyable ? ' checked' : ''}><span>${esc(tr('buyable'))}</span></label>
        <label class="lpae-row"><input type="checkbox" data-ae-shop${al.shopListed ? ' checked' : ''}><span>${esc(tr('shopListed'))}</span></label>
        <div class="lpae-hint">${esc(tr('shopListedHint'))}</div>
        ${feat.confirmRights ? `<label class="lpae-row" style="align-items:flex-start"><input type="checkbox" data-ae-confirm style="margin-top:3px"${al.confirmedRights ? ' checked' : ''}><span>${esc(tr('confirmRights'))}</span></label>` : ''}
        <div class="lpae-actions">
          ${btn('data-ae-save', tr('save'), PRIMARY)}
          ${extra.map((a, i) => btn(`data-ae-extra="${i}"`, a.label, a.primary ? PRIMARY : '')).join('')}
        </div>
        ${msgHtml()}
      </div>`;
      afterRender();
    }

    function renderContribution() {
      host.innerHTML = `<div class="lpae">
        <div><strong>${esc(al.title || tr('fallback'))}</strong> <span class="lpae-badge">${esc(tr('contribBadge'))}</span></div>
        <div class="lpae-hint">${esc(tr('contribFrom', { studio: al.studioName }))} ${esc(tr('contribHint'))}</div>
        <label class="lpae-l">${esc(tr('contribTracks'))}</label>
        ${trackRows()}
        ${officialRows()}
        <div class="lpae-actions">
          ${btn('data-ae-contrib-save', tr('contribSave'), PRIMARY)}
          ${btn('data-ae-contrib-leave', tr('contribLeave'), DANGER)}
        </div>
        ${msgHtml()}
      </div>`;
      afterRender();
    }

    function afterRender() {
      if (cfg.renderCover && !al.contribution) {
        const ctrl = host.querySelector('[data-ae-cover-ctrl]');
        if (ctrl) cfg.renderCover(ctrl, al, render);
      }
      // L'enregistreur ouvert (lecteur vivant) survit aux re-rendus : on replace son nœud, sans le reconstruire.
      if (recorder && recorder.owner === inst) {
        const h = [...host.querySelectorAll('[data-ae-rec-host]')].find(x => x.dataset.aeRecHost === recorder.rec.albumId + '|' + recorder.rec.trackId);
        if (h) h.appendChild(recorder.rec.el); else closeRecorder();
      }
    }

    // ---- Extras : invités et droits (chargés à la demande) ----
    async function loadContributors() {
      if (!feat.contributors || !al.saved) return;
      const c = await A().listAlbumContributors(al.id);
      al.contributors = c.contributors || [];
    }
    const rightsFromServer = (st, d) => {
      st.declaration = d.declaration || 'sole'; st.ack = !!d.ackAt; st.settled = !!d.settled; st.sellerShareBps = d.sellerShareBps;
      st.rows = (d.holders || []).map(h => ({ id: h.id, email: h.email, pct: String(h.shareBps / 100).replace('.', ','), status: h.status }));
    };
    async function loadRights(force) {
      if (!feat.rights || !al.saved) return;
      const st = al.rights = (force || !al.rights) ? { loaded: false, loading: false, declaration: 'sole', ack: false, rows: [], msg: null } : al.rights;
      if (st.loading || st.loaded) return;
      st.loading = true;
      const { rights, error } = await A().getAlbumRights(al.id);
      st.loading = false;
      if (error) { st.loaded = true; st.msg = { kind: 'error', text: tr('rightsLoadError', { error }) }; } else { rightsFromServer(st, rights); st.loaded = true; }
      render();
    }
    async function inviteHolders(ids) {
      const failures = [];
      for (const id of ids) {
        const r = await A().inviteRightsHolder(al.id, id, inviteUrl());
        if (!r.ok) failures.push(r.actionLink ? tr('rightsInviteFailedWithLink', { error: r.error, link: r.actionLink }) : r.error);
      }
      return failures;
    }
    async function saveRights() {
      const st = al.rights;
      const holders = st.declaration === 'shared' ? st.rows.filter(r => r.email.trim()).map(r => ({ email: r.email.trim(), shareBps: pctToBps(r.pct) })) : [];
      st.msg = { kind: 'ok', text: tr('saving') }; render();
      const { rights, error } = await A().setAlbumRights(al.id, st.declaration, holders, st.ack);
      if (error) { st.msg = { kind: 'error', text: tr('rightsSaveError', { error }) }; render(); return; }
      rightsFromServer(st, rights);
      if (rights.unlisted) { al.buyable = false; al.savedBuyable = false; }
      const n = (rights.toInvite || []).length;
      const failures = n ? await inviteHolders(rights.toInvite) : [];
      st.msg = failures.length ? { kind: 'error', text: tr('rightsInviteFailed', { errors: failures.join(' / ') }) }
        : { kind: 'ok', text: tr(n ? 'rightsSavedInvited' : 'rightsSaved', { n }) + (rights.unlisted ? ' ' + tr('rightsUnlisted') : '') };
      render();
    }

    // ---- Enregistrer ----
    async function save() {
      const raw = al.priceInput.trim().replace(',', '.');
      let cents = null;
      if (raw !== '') {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return say(tr('priceInvalid'), 'error');
        cents = Math.round(n * 100);
      }
      if (al.buyable) {
        if (cents === null) return say(tr('needsPrice'), 'error');
        if (!al.trackIds.length) return say(tr('needsTracks'), 'error');
        // Mise en vente : chaque morceau du vendeur doit avoir sa version officielle (même règle côté serveur).
        const missing = al.trackIds.filter(id => isOwn(id) && !has(al.officialDurations, id));
        if (missing.length) return say(tr('needsVersions', { tracks: missing.map(title).join(', ') }), 'error');
        const blocked = cfg.checkBeforeSale && cfg.checkBeforeSale(al);
        if (blocked) return say(blocked, 'error');
        if (feat.confirmRights && !al.confirmedRights) return say(tr('needsConfirm'), 'error');
      }
      say(tr('saving'), 'ok');
      try {
        const cover = al.pendingCover ? await cfg.uploadCover(al) : null;
        const payload = {
          id: al.id, title: al.title, presentationFr: al.presentationFr, presentationEn: al.presentationEn,
          priceEurCents: cents, buyable: al.buyable, trackIds: al.trackIds.filter(isOwn), ...(cover || {}),
        };
        const { ok, error, data } = await cfg.save(payload);
        if (!ok) { say(tr('saveError', { error }) + (cfg.saveErrorHint ? cfg.saveErrorHint(error) : ''), 'error'); return; }
        const shop = await A().setAlbumShopListed(al.id, al.shopListed);
        if (!shop.ok) return say(tr('saveError', { error: shop.error }), 'error');
        const listen = await A().setAlbumListening(al.id, al.listenMode, al.freeTrackIds.filter(id => al.trackIds.includes(id)));
        if (!listen.ok) return say(tr('listenError', { error: listen.error }), 'error');
        const rnd = await A().setAlbumRandom(al.id, al.allowRandom);
        if (!rnd.ok) return say(tr('randomError', { error: rnd.error }), 'error');
        const wasSaved = al.saved;
        al.saved = true; al.savedBuyable = al.buyable;
        if (cover) {
          Object.assign(al, cover);
          if (al.pendingCoverUrl) URL.revokeObjectURL(al.pendingCoverUrl);
          al.pendingCover = null; al.pendingCoverUrl = null;
        }
        // Morceaux décochés d'un album déjà obtenu : gardés pour ceux qui l'ont -- on le dit au vendeur.
        const kept = (data && data.keptForBuyers) || [];
        al.savedTrackIds = al.trackIds.slice();
        // Un morceau retiré de l'album perd sa version (la ligne album_tracks est supprimée côté serveur).
        Object.keys(al.officialDurations).forEach(id => { if (!al.trackIds.includes(id)) delete al.officialDurations[id]; });
        if (cfg.reload) {
          const fresh = await cfg.reload(al.id);
          if (fresh) { const f = fromApi(fresh); ['trackIds', 'savedTrackIds', 'officialDurations', 'illustration', 'illustrationOriginalName', 'buyable', 'savedBuyable'].forEach(k => { al[k] = f[k]; }); }
        }
        await loadContributors();
        if (feat.rights) await loadRights(true);
        const base = tr(wasSaved ? 'saved' : 'savedNew');
        say(kept.length ? base + ' ' + tr('tracksKeptForBuyers', { tracks: kept.map(title).join(', ') }) : base, 'ok');
        if (cfg.onChange) cfg.onChange(al);
      } catch (e) {
        say(tr('saveError', { error: e.message }), 'error');
      }
    }

    // ---- Version officielle : écouter et enregistrer ----
    function togglePlay(trackId) {
      const pb = getPlayback(); pb.owner = inst;
      return pb.toggle(al.id, trackId, { beforeStart: () => { closeRecorder(); if (cfg.beforeAudio) cfg.beforeAudio(); } });
    }
    async function openRecorder(trackId) {
      closeRecorder();
      if (playback) playback.stop();
      const rec = shared().openRecorder({
        albumId: al.id, trackId,
        beforeStart: () => { if (cfg.beforeAudio) cfg.beforeAudio(); },
        onSaved: take => { al.officialDurations[trackId] = take.duration; render(); },
      });
      recorder = { rec, owner: inst };
      renderAll();
    }

    // ---- Événements (délégation sur l'hôte) ----
    const onInput = e => {
      const t = e.target, d = t.dataset;
      if (d.aeField) al[d.aeField] = t.value;
      else if (d.aeRrow != null && al.rights) al.rights.rows[Number(d.aeRrow)][d.aeRcol] = t.value;
    };
    const onChange = e => {
      const t = e.target, d = t.dataset;
      if (d.aeBuyable != null) al.buyable = t.checked;
      else if (d.aeShop != null) al.shopListed = t.checked;
      else if (d.aeRandom != null) al.allowRandom = t.checked;
      else if (d.aeConfirm != null) al.confirmedRights = t.checked;
      else if (d.aeRack != null) al.rights.ack = t.checked;
      else if (d.aeRightsDecl != null) {
        al.rights.declaration = t.value;
        if (t.value === 'shared' && !al.rights.rows.length) al.rights.rows.push({ email: '', pct: '' });
        render();
      } else if (d.aeListen) { al.listenMode = d.aeListen; render(); }
      else if (d.aeFree) al.freeTrackIds = t.checked ? al.freeTrackIds.concat(d.aeFree) : al.freeTrackIds.filter(x => x !== d.aeFree);
      else if (d.aeTrack) { al.trackIds = t.checked ? al.trackIds.concat(d.aeTrack) : al.trackIds.filter(x => x !== d.aeTrack); render(); } // les numéros suivent l'ordre de cochage
      else if (d.aeCover != null) {
        const f = t.files && t.files[0]; if (!f) return;
        if (al.pendingCoverUrl) URL.revokeObjectURL(al.pendingCoverUrl);
        al.pendingCover = f; al.pendingCoverUrl = URL.createObjectURL(f); render();
      }
    };
    const onClick = async e => {
      const b = e.target.closest('button');
      if (!b || !host.contains(b)) return;
      const d = b.dataset;
      if (d.aeSave != null) save();
      else if (d.aeExtra != null) { const a = (cfg.actions(al) || [])[Number(d.aeExtra)]; if (a) a.onClick(al); }
      else if (d.aePlay) togglePlay(d.aePlay);
      else if (d.aeRecord) openRecorder(d.aeRecord);
      else if (d.aeContribSave != null) cfg.contribution.save(al);
      else if (d.aeContribLeave != null) cfg.contribution.leave(al);
      else if (d.aeInvite != null) {
        const email = host.querySelector('[data-ae-invite-email]').value.trim();
        if (!email) return;
        const r = await A().inviteAlbumContributor(al.id, email, inviteUrl());
        if (r.ok) say(tr('invited', { email }));
        else if (r.invited) say(tr('inviteMailFailed', { error: r.error }) + (r.actionLink ? ' ' + r.actionLink : ''), 'error');
        else say(tr('error', { error: r.error }), 'error');
        await loadContributors(); render();
      } else if (d.aeRemoveContrib) {
        const c = al.contributors.find(x => x.id === d.aeRemoveContrib);
        if (!await cfg.confirm(tr('removeConfirm', { email: c.email }), { okLabel: tr('remove'), danger: true })) return;
        const r = await A().removeAlbumContributor(c.id);
        say(r.ok ? tr(r.unpublished ? 'removedUnpublished' : 'removed') : tr('error', { error: r.error }), r.ok ? 'ok' : 'error');
        if (r.ok) {
          if (r.unpublished) al.buyable = false;
          if (cfg.reload) { const fresh = await cfg.reload(al.id); if (fresh) al.trackIds = fromApi(fresh).trackIds; }
          await loadContributors(); render();
        }
      } else if (d.aeRadd != null) { al.rights.rows.push({ email: '', pct: '' }); render(); }
      else if (d.aeRremove != null) { al.rights.rows.splice(Number(d.aeRremove), 1); render(); }
      else if (d.aeRsave != null) saveRights();
      else if (d.aeRinvite) {
        b.disabled = true;
        const f = await inviteHolders([d.aeRinvite]);
        al.rights.msg = f.length ? { kind: 'error', text: tr('rightsInviteFailed', { errors: f.join(' / ') }) } : { kind: 'ok', text: tr('rightsInviteSent') };
        render();
      } else if (d.aeRselfpay) {
        if (!await cfg.confirm(tr('rightsSelfPayConfirm'), { okLabel: tr('rightsSelfPay') })) return;
        const { rights, error } = await A().markRightsHolderSelfPay(d.aeRselfpay);
        al.rights.msg = error ? { kind: 'error', text: tr('rightsSaveError', { error }) } : { kind: 'ok', text: tr('rightsSelfPayDone') };
        if (rights) rightsFromServer(al.rights, rights);
        render();
      }
    };
    host.addEventListener('input', onInput);
    host.addEventListener('change', onChange);
    host.addEventListener('click', onClick);

    function destroy() {
      instances.delete(inst);
      host.removeEventListener('input', onInput); host.removeEventListener('change', onChange); host.removeEventListener('click', onClick);
      if (recorder && recorder.owner === inst) closeRecorder();
      if (playback && playback.owner === inst) playback.stop();
      host.innerHTML = '';
    }

    instances.add(inst);
    inst.loadExtras = async () => { await loadContributors(); if (feat.rights && al.saved) await loadRights(true); render(); };
    return inst;
  }

  // Arrêt général (changement d'onglet, retour à la liste) : plus d'écoute ni d'enregistreur.
  function stopAll() { closeRecorder(); if (playback) playback.stop(); }

  window.LayerPitchAlbumEditor = { create, newAlbum, fromApi, fromContribution, stopAll };
})();
