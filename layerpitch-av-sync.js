// layerpitch-av-sync.js — LayerPitch, calage du son sur l'image (12/11/2026, revue du lecteur vidéo de l'atelier).
//
// Un seul moteur pour toutes les écoutes de l'atelier où une musique CALCULÉE (AudioBuffer, rendu par capture-render.js) se
// joue sur une vidéo muette : « Écouter le montage » (src/atelier/18-panneau-de-capture.js) et les écoutes du Versioning, seule
// ou multi-versions (capture-versioning.js). Avant ce fichier, chaque écoute lançait son propre son « à l'aveugle » :
//   - le son partait AVANT que l'image ne reparte (video.play() met de 0 à 300 ms à produire la première image, selon le
//     décodeur et la position) : un décalage différent à chaque écoute — le « parfois calé, parfois pas » ;
//   - aucun recalage après un saut dans la vidéo (clic sur la règle, sur un marqueur, sur une remarque client) dans le
//     Versioning : la musique continuait depuis l'ancien endroit ;
//   - rien quand la vidéo attend des données (waiting), change de vitesse (menu natif) ou dérive lentement (horloge du son
//     et horloge de l'image ne sont pas la même) ;
//   - la latence de sortie (casque Bluetooth : 150 à 250 ms) n'était pas compensée : le son arrivait en retard sur l'image.
//
// Principe : la VIDÉO est le maître. Le son ne démarre que lorsqu'elle joue vraiment (« playing »), à l'instant qu'elle
// affiche, compensé de la latence de sortie ; il se coupe dès qu'elle s'arrête, attend ou saute, et repart d'elle-même. Un
// chien de garde compare quatre fois par seconde la position du son à celle de l'image et recale si l'écart dépasse 80 ms
// deux fois de suite (une seule mesure isolée peut être fausse : currentTime est arrondi dans certains navigateurs).
// Plusieurs sons peuvent suivre la même image (écoute multi-versions) : un seul est audible, la bascule ne change que les
// volumes (fondu de 15 ms, sans clic), donc instantanée.
//
// follow(video, opts) -> contrôleur
//   opts.buffers : [AudioBuffer|null]  sons calés sur la vidéo (null = pas encore prêt, ajouté plus tard par setBuffer)
//   opts.active  : index audible (0 par défaut)
//   opts.onEnded : appelé quand la vidéo arrive à sa fin ou que le son audible est épuisé
//   opts.context : AudioContext (par défaut celui du lecteur, LayerPlayerCore.audioContext())
// contrôleur : setBuffer(i, buf), setActive(i), active, stop(), running (le son sonne en ce moment)
(function () {
  const LEAD = 0.03;            // le son est programmé un peu en avance : le temps que le graphe audio le prenne en compte
  const DRIFT_TOLERANCE = 0.08; // au-delà, on recale (en dessous, l'oreille ne fait pas la différence avec l'image)
  const WATCH_MS = 250;
  const FADE_TC = 0.005;        // constante de temps des fondus de volume (≈ 15 ms pour 95 %)

  // Latence de sortie (Bluetooth, interfaces audio) : le son programmé maintenant n'est entendu que plus tard. Safari ne la
  // donne pas (0). Bornée : une valeur absurde ne doit jamais décaler toute l'écoute.
  function outputLatency(ac) {
    const v = Number(ac.outputLatency) || Number(ac.baseLatency) || 0;
    return Math.min(0.5, Math.max(0, v));
  }

  function follow(video, opts) {
    opts = opts || {};
    const ac = opts.context || window.LayerPlayerCore.audioContext();
    const slots = (opts.buffers || []).map(b => ({ buffer: b || null, src: null, gain: null }));
    let active = Math.max(0, Math.min(slots.length - 1, opts.active || 0));
    let disposed = false;
    // Repère de la lecture en cours : à l'heure audio t0, le son jouait la position pos0 (secondes), à la vitesse rate.
    let anchor = null;
    let strikes = 0;

    function ensureGain(slot, i) {
      if (slot.gain) return slot.gain;
      slot.gain = ac.createGain();
      slot.gain.gain.value = i === active ? 1 : 0;
      slot.gain.connect(ac.destination);
      return slot.gain;
    }
    function stopSource(slot) {
      if (!slot.src) return;
      slot.src.onended = null;
      try { slot.src.stop(); } catch (e) { /* déjà arrêtée */ }
      try { slot.src.disconnect(); } catch (e) { /* déjà débranchée */ }
      slot.src = null;
    }
    function halt() {
      anchor = null;
      strikes = 0;
      slots.forEach(stopSource);
    }
    function startSlot(slot, i) {
      if (!slot.buffer || !anchor) return;
      const pos = anchor.pos0 + Math.max(0, ac.currentTime - anchor.t0) * anchor.rate;
      if (pos >= slot.buffer.duration) return;
      const src = ac.createBufferSource();
      src.buffer = slot.buffer;
      src.playbackRate.value = anchor.rate;
      src.connect(ensureGain(slot, i));
      src.start(Math.max(ac.currentTime, anchor.t0), Math.max(0, pos));
      src.onended = () => { if (slot.src === src && i === active && !disposed) finish(); };
      slot.src = src;
    }
    // (Re)part depuis la position affichée par la vidéo. Seulement si elle joue vraiment.
    function start() {
      if (disposed) return;
      halt();
      if (video.paused || video.ended || video.seeking || video.readyState < 3) return;
      const rate = video.playbackRate > 0 ? video.playbackRate : 1;
      const t0 = ac.currentTime + LEAD;
      // Ce qui sera ENTENDU à t0 + latence doit correspondre à l'image affichée à ce moment-là.
      anchor = { t0, rate, pos0: (video.currentTime || 0) + (LEAD + outputLatency(ac)) * rate };
      slots.forEach(startSlot);
    }
    function finish() {
      if (disposed) return;
      const cb = opts.onEnded;
      halt();
      if (cb) cb();
    }
    // Chien de garde : écart entre la position du son (horloge audio) et celle de l'image.
    const watch = setInterval(() => {
      if (disposed) return;
      if (!anchor) { if (!video.paused && !video.seeking && video.readyState >= 3) start(); return; } // repli si « playing » a été manqué
      if (ac.currentTime < anchor.t0) return;
      const heard = anchor.pos0 + (ac.currentTime - anchor.t0) * anchor.rate - outputLatency(ac) * anchor.rate;
      if (Math.abs(heard - (video.currentTime || 0)) > DRIFT_TOLERANCE) { if (++strikes >= 2) start(); }
      else strikes = 0;
    }, WATCH_MS);

    const on = {
      playing: start,
      seeked: start,
      ratechange: start,
      pause: halt,
      waiting: halt,
      seeking: halt,
      emptied: halt,
      ended: finish,
    };
    Object.keys(on).forEach(k => video.addEventListener(k, on[k]));
    start(); // la vidéo joue peut-être déjà

    return {
      get active() { return active; },
      get running() { return !!anchor; },
      // Son prêt plus tard (écoute multi-versions) : il rejoint la lecture en cours, calé sur le même repère.
      setBuffer(i, buffer) {
        if (disposed || !slots[i]) return;
        stopSource(slots[i]);
        slots[i].buffer = buffer;
        startSlot(slots[i], i);
      },
      setActive(i) {
        if (disposed || !slots[i] || !slots[i].buffer) return false;
        active = i;
        const now = ac.currentTime;
        slots.forEach((s, j) => { if (s.gain) { s.gain.gain.cancelScheduledValues(now); s.gain.gain.setTargetAtTime(j === i ? 1 : 0, now, FADE_TC); } });
        return true;
      },
      stop() {
        if (disposed) return;
        disposed = true;
        clearInterval(watch);
        Object.keys(on).forEach(k => video.removeEventListener(k, on[k]));
        halt();
        slots.forEach(s => { if (s.gain) { try { s.gain.disconnect(); } catch (e) { /* déjà débranché */ } } });
      },
    };
  }

  window.LayerPitchAVSync = { follow, outputLatency };
})();
