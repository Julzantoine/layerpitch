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
    return { state: [...new Set(state)].join(' · '), flash: flash.join(' · '), fx: fx.join(' · ') };
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
    const montage = await (opts.load || loadMontage)(opts.montageId);
    if (!montage || !Array.isArray(montage.versions) || !montage.versions.length) return null;
    const hidden = new Set(opts.hidden || []);
    const versions = montage.versions.filter(v => v.url && !hidden.has(v.key));
    if (!versions.length) return null;
    let current = versions.find(v => v.key === opts.defaultKey) || versions[0];
    if (video.getAttribute('src') !== current.url) video.src = current.url;

    const label = document.createElement('div');
    label.className = 'lp-video-cue';
    label.setAttribute('aria-live', 'off');
    const flash = document.createElement('div');
    flash.className = 'lp-video-cue lp-video-cue-flash';
    wrap.appendChild(label); wrap.appendChild(flash);
    const refresh = () => {
      const txt = cueTextAt(current.cues, video.currentTime || 0);
      label.textContent = txt.state; label.hidden = !txt.state;
      flash.textContent = txt.flash ? txt.flash.toUpperCase() + ' !' : ''; flash.hidden = !txt.flash;
    };
    let raf = 0;
    const loop = () => { refresh(); raf = video.paused ? 0 : requestAnimationFrame(loop); };
    video.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(loop); });
    video.addEventListener('timeupdate', refresh);
    video.addEventListener('seeked', refresh);

    let select = null;
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
      // Changer de version : même instant, et la lecture continue si elle était en cours.
      select.addEventListener('change', () => {
        const next = versions.find(v => v.key === select.value);
        if (!next || next === current) return;
        const t = video.currentTime || 0, playing = !video.paused;
        current = next;
        video.src = next.url;
        video.addEventListener('loadedmetadata', () => {
          try { video.currentTime = Math.min(t, (video.duration || t) - 0.05); } catch (e) { /* ancien navigateur */ }
          if (playing) video.play().catch(() => {});
          refresh();
        }, { once: true });
      });
      wrap.parentNode.insertBefore(bar, wrap.nextSibling);
    }
    refresh();
    return { versions, select, refresh, current: () => current };
  }

  window.LayerPitchVideoVersions = { cueTextAt, mount, loadMontage };
})();
