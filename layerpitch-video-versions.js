// layerpitch-video-versions.js — LayerPitch, versions vidéo dans les lecteurs publics (21/10, décidé par Jules-Antoine).
//
// Une vidéo issue d'un montage (outil de capture des packs) peut exister en plusieurs versions : la musique d'origine, puis des versions
// vidéo (autre musique, même scène). Là où l'auteur l'a placée (bloc vidéo d'un AdReel, puis espace Projet), le spectateur :
//   - choisit la version dans un menu sous le lecteur ; la vidéo reprend AU MÊME INSTANT (comparer deux musiques sur la même scène) ;
//   - voit une ÉTIQUETTE sur la vidéo qui dit ce qui joue (couche, boucle, section, stinger) ; elle suit la version choisie.
// Tout est lu en direct (get_public_video_montage, migration 20261021020000) : une version retouchée et réexportée dans l'outil de
// Versioning apparaît partout sans republier. Sans réseau ou sans montage, la vidéo d'origine reste simplement affichée, sans menu.
(function () {
  // Étiquette à l'instant t : les états actifs (couche, boucle, section…) sur une ligne, et le stinger en cours (flash) à part.
  function cueTextAt(cues, t) {
    const on = (cues || []).filter(c => t >= c.start && t < c.end);
    const state = on.filter(c => c.kind === 'state').sort((a, b) => (a.row || 0) - (b.row || 0)).map(c => c.text);
    const flash = on.filter(c => c.kind === 'stinger').map(c => c.text);
    const fx = on.filter(c => c.kind === 'fx').map(c => c.text);
    const credit = on.filter(c => c.kind === 'credit').map(c => c.text);
    return { state: [...new Set(state)].join(' · '), flash: flash.join(' · '), fx: fx.join(' · '), credit: credit.join(' · ') };
  }

  // Mise en forme : injectée une fois, pour que toutes les pages (AdReels, vitrines, espace Projet) aient la même sans dupliquer le CSS.
  function ensureStyle() {
    if (document.getElementById('lp-video-versions-style')) return;
    const st = document.createElement('style');
    st.id = 'lp-video-versions-style';
    st.textContent = '.lp-video-cues{position:absolute;right:12px;bottom:48px;max-width:calc(100% - 24px);display:flex;flex-direction:column;align-items:flex-end;gap:6px;pointer-events:none}'
      + '.lp-video-cue{padding:4px 9px;border-radius:6px;background:rgba(0,0,0,.62);color:#fff;font-size:13px;line-height:1.35;text-align:right}'
      + '.lp-video-cue small{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.65;line-height:1.2}'
      + '.lp-video-cue-flash{color:#ffbd7a;font-weight:600}.lp-video-cue-credit{position:absolute;right:12px;top:12px;font-size:12px}.lp-video-cue[hidden]{display:none}'
      + '.lp-video-versions{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px}.lp-video-versions select{font:inherit;padding:4px 8px;border-radius:6px;max-width:100%}.lp-video-ab{font:inherit;padding:4px 10px;border-radius:6px;cursor:pointer}.lp-video-ab:disabled{opacity:.45;cursor:default}';
    document.head.appendChild(st);
  }
  async function client() {
    if (typeof loadPostgresReadScripts === 'function') await loadPostgresReadScripts();
    return window.LayerPitchSupabaseClient ? window.LayerPitchSupabaseClient.getClient() : null;
  }
  async function loadMontage(montageId) {
    const c = await client();
    if (!c) return null;
    const { data, error } = await c.rpc('get_public_video_montage', { p_capture_id: montageId });
    return error ? null : data;
  }

  // Branche le menu et l'étiquette sur un <video> déjà affiché. opts : { montageId, defaultKey, hidden: [clé…], tr(clé), load? }.
  // `wrap` doit être un conteneur en position relative autour de la vidéo (l'étiquette s'y superpose).
  async function mount(video, wrap, opts) {
    const tr = opts.tr || (k => k);
    ensureStyle();
    const montage = await (opts.load || loadMontage)(opts.montageId);
    if (!montage || !Array.isArray(montage.versions) || !montage.versions.length) return null;
    const hidden = new Set(opts.hidden || []);
    const versions = montage.versions.filter(v => v.url && !hidden.has(v.key));
    if (!versions.length) return null;
    // Vidéo muette une fois + un son par version (migration 20261021040000) : une version 'audio' se joue sur l'image muette du
    // montage, son et image synchronisés ; une ancienne version 'video' (export complet) se lit telle quelle.
    const base = montage.baseUrl || null;
    const isSound = v => v.kind === 'audio' && !!base;
    // Deux pistes son : l'active, et une de rechange déjà chargée avec « l'autre » version (bascule A/B instantanée, sans attente de chargement).
    let audio = document.createElement('audio');
    audio.preload = 'auto';
    let spare = document.createElement('audio');
    spare.preload = 'auto';
    const safePlay = el => { const p = el.play(); if (p && p.catch) p.catch(() => {}); };
    let current = versions.find(v => v.key === opts.defaultKey) || versions[0];
    let previous = null; // la version écoutée juste avant : l'autre moitié de la bascule A/B
    const srcFor = v => (isSound(v) ? base : v.url);
    // La piste son reprend toujours le volume, la sourdine et la vitesse de l'image (12/11 : au départ, une vidéo muette en lecture
    // automatique laissait son son... audible ; une piste de rechange échangée gardait l'ancienne vitesse).
    const matchVideo = el => { el.volume = video.volume; el.muted = video.muted; el.playbackRate = video.playbackRate || 1; };
    matchVideo(audio); matchVideo(spare);
    if (video.getAttribute('src') !== srcFor(current)) video.src = srcFor(current);
    if (isSound(current)) audio.src = current.url;
    // Le son suit l'image : lecture, pause, déplacement, vitesse, volume.
    const follow = () => isSound(current);
    const videoRolling = () => !video.paused && !video.ended && !video.seeking && video.readyState >= 3;
    const startAudio = () => { if (follow() && videoRolling()) { audio.currentTime = video.currentTime; safePlay(audio); } };
    video.addEventListener('playing', startAudio);
    video.addEventListener('seeked', startAudio);
    ['pause', 'waiting', 'ended', 'seeking'].forEach(ev => video.addEventListener(ev, () => { if (follow()) audio.pause(); }));
    video.addEventListener('ratechange', () => { audio.playbackRate = video.playbackRate || 1; });
    // Le son coupé puis remis pendant la lecture (lecture automatique muette, puis clic sur le haut-parleur) : la piste son, que le navigateur
    // avait peut-être refusé de lancer sans geste, repart ici (12/11 : avant, elle restait muette jusqu'à la prochaine pause).
    video.addEventListener('volumechange', () => { audio.volume = video.volume; audio.muted = video.muted; if (!video.muted && audio.paused) startAudio(); });
    // Dérive son / image (deux horloges distinctes) : petit écart -> on presse ou on retient légèrement la piste son (vitesse ± 5 % au plus,
    // hauteur préservée par le navigateur), sans coupure ; grand écart -> on la replace, puis on la laisse se stabiliser une seconde et demie
    // (avant le 12/11 : replacée dès 120 ms d'écart, ce qui la faisait recharger, prendre du retard, être replacée… -- son haché).
    let settleUntil = 0;
    const resync = () => {
      if (!follow() || !videoRolling() || audio.paused) return;
      const rate = video.playbackRate || 1;
      const now = performance.now();
      if (now < settleUntil) return;
      const d = (audio.currentTime || 0) - (video.currentTime || 0);
      if (Math.abs(d) > 0.25) { audio.currentTime = video.currentTime; audio.playbackRate = rate; settleUntil = now + 1500; return; }
      const want = Math.abs(d) > 0.04 ? rate * (1 - Math.max(-0.05, Math.min(0.05, d * 0.5))) : rate;
      if (Math.abs(audio.playbackRate - want) > 0.001) audio.playbackRate = want;
    };

    // Musique et Sfx au même endroit (bas à droite), chacun sous un petit libellé.
    const stack = document.createElement('div');
    stack.className = 'lp-video-cues';
    const mkCue = (cls, caption) => {
      const box = document.createElement('div');
      box.className = 'lp-video-cue ' + cls;
      const cap = document.createElement('small'); cap.textContent = caption;
      const txt = document.createElement('span');
      box.appendChild(cap); box.appendChild(txt);
      stack.appendChild(box);
      return { box, txt };
    };
    const label = mkCue('lp-video-cue-music', tr('videoCueMusic') === 'videoCueMusic' ? 'Music' : tr('videoCueMusic'));
    const flash = mkCue('lp-video-cue-flash', 'SFX');
    const credit = document.createElement('div');
    credit.className = 'lp-video-cue lp-video-cue-credit';
    wrap.appendChild(stack); wrap.appendChild(credit);
    const refresh = () => {
      const txt = cueTextAt(current.cues, video.currentTime || 0);
      label.txt.textContent = txt.state; label.box.hidden = !txt.state;
      flash.txt.textContent = txt.flash; flash.box.hidden = !txt.flash;
      credit.textContent = txt.credit ? '\u266A ' + txt.credit : ''; credit.hidden = !txt.credit;
    };
    let raf = 0;
    const loop = () => { refresh(); resync(); raf = video.paused ? 0 : requestAnimationFrame(loop); };
    video.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(loop); });
    video.addEventListener('timeupdate', refresh);
    video.addEventListener('seeked', refresh);

    let select = null, abBtn = null;
    let switchSeq = 0; // deux changements rapprochés : seul le dernier termine (l'autre attendait encore sa vidéo)
    // Change de version : même instant, la lecture continue si elle était en cours. Renvoie false si la version est inconnue ou déjà active.
    function switchTo(key) {
      const next = versions.find(v => v.key === key);
      if (!next || next === current) return false;
      const seq = ++switchSeq;
      const t = video.currentTime || 0, playing = !video.paused;
      previous = current; current = next;
      if (select) select.value = next.key;
      const target0 = t;
      const finish = () => {
        if (seq !== switchSeq) return;
        const d = video.duration;
        const target = isFinite(d) && d > 0 ? Math.min(target0, d - 0.05) : target0; // durée inconnue : on garde l'instant tel quel
        if (Math.abs((video.currentTime || 0) - target) > 0.01) { try { video.currentTime = target; } catch (e) { /* ancien navigateur */ } }
        if (isSound(next)) audio.currentTime = target;
        if (playing) { safePlay(video); if (isSound(next)) safePlay(audio); }
        refresh();
      };
      if (isSound(next) && spare.getAttribute('src') === next.url) {
        // La piste de rechange est déjà chargée avec cette version : on l'échange avec l'active, sans attente.
        const old = audio; old.pause(); audio = spare; spare = old;
        spare.removeAttribute('src');
        matchVideo(audio);
      } else if (isSound(next)) { audio.pause(); audio.src = next.url; matchVideo(audio); }
      else { audio.pause(); audio.removeAttribute('src'); try { audio.load(); } catch (e) { /* rien à arrêter */ } }
      // Même image (deux sons sur la vidéo muette) : seul le son change, sans recharger la vidéo.
      if (video.getAttribute('src') === srcFor(next)) finish();
      else { video.src = srcFor(next); video.addEventListener('loadedmetadata', finish, { once: true }); }
      // On arme tout de suite la piste de rechange avec la version quittée : revenir en arrière (A/B) est alors immédiat.
      if (isSound(previous)) { spare.src = previous.url; try { spare.load(); } catch (e) { /* tant pis */ } }
      if (abBtn) abBtn.disabled = false;
      if (typeof opts.onVersionChange === 'function') { try { opts.onVersionChange(next, previous); } catch (e) { /* le rappel ne casse pas le lecteur */ } }
      return true;
    }
    const toggleAB = () => { if (previous) switchTo(previous.key); };
    if (versions.length > 1) {
      const bar = document.createElement('label');
      bar.className = 'lp-video-versions';
      bar.innerHTML = '<span></span><select></select>';
      bar.querySelector('span').textContent = tr('videoVersionMenuLabel');
      select = bar.querySelector('select');
      versions.forEach(v => {
        const o = document.createElement('option');
        o.value = v.key; o.textContent = v.key === 'original' ? tr('videoVersionOriginal') : (v.title || tr('videoVersionUntitled'));
        if (v === current) o.selected = true;
        select.appendChild(o);
      });
      select.addEventListener('change', () => switchTo(select.value));
      if (opts.ab === true) { // bascule A/B : seulement là où la page la demande (page de relecture) — pas sur les AdReels publics
        abBtn = document.createElement('button');
        abBtn.type = 'button'; abBtn.className = 'lp-video-ab'; abBtn.disabled = true;
        abBtn.textContent = '\u21C4 A/B';
        abBtn.title = tr('videoVersionABHint') === 'videoVersionABHint' ? 'Switch between the last two versions you listened to (key: B)' : tr('videoVersionABHint');
        abBtn.addEventListener('click', toggleAB);
        bar.appendChild(abBtn);
      }
      wrap.parentNode.insertBefore(bar, wrap.nextSibling);
    }
    refresh();
    return { versions, select, refresh, get audio() { return audio; }, current: () => current, switchTo, toggleAB, previous: () => previous };
  }

  window.LayerPitchVideoVersions = { cueTextAt, mount, loadMontage };
})();
