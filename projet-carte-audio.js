// projet-carte-audio.js — LayerPitch, lecture de la Carte de niveau (6 octobre).
// On se place sur un élément ou un parcours de la carte : son (ou ses alternatives) joue ; on passe à un autre : transition
// (fondu enchaîné, coupure, fondu sortant puis entrant), éventuellement attendue jusqu'à la prochaine mesure / temps du son qui joue,
// avec un son de transition ponctuel facultatif. Un fond d'ambiance (room tone) tourne en continu dessous. « Ennemi ! » bascule vers
// le son de combat de l'endroit.
//   window.LayerPitchLevelMapAudio.createPlayer(env)   : le « cerveau » -- AUCUNE dépendance au navigateur, testé avec de faux sons
//   window.LayerPitchLevelMapAudio.createVoiceFactory(env) : les vraies voix (morceaux du lecteur, fichiers décodés), pour projet.html
(function () {
  const M = () => window.LayerPitchLevelMap.model;

  // ---------------------------------------------------------------- Le cerveau
  // env : {
  //   voiceFactory(ref) -> Promise<voice>   voice = { start(level), setLevel(level, sec), stop(), isPlaying(), nextBoundary(sync) -> secondes d'horloge ou null }
  //   now() -> secondes (horloge audio), schedule(fn, atTime) -> cancel(), onChange(state)
  // }
  function createPlayer(env) {
    const model = M();
    let map = null;
    const st = { playing: false, position: null, combat: false, music: null, room: null, pendingAt: null, loading: 0, intensity: null /* choix manuel de couche (null = automatique) */, layerLevel: null };
    let musicVoice = null, roomVoice = null, stingerVoice = null, token = 0, cancelPending = null, lastMusicKey = null;
    const notify = () => { if (env.onChange) env.onChange(snapshot()); };
    const layersOf = () => (musicVoice && musicVoice.layerCount ? (safe(() => musicVoice.layerCount()) || 0) : 0);
    const snapshot = () => ({ playing: st.playing, position: st.position && { kind: st.position.kind, id: st.position.id }, combat: st.combat,
      music: st.music, room: st.room, pendingAt: st.pendingAt, loading: st.loading, sequences: sequencesOf(), layers: layersOf(), layerKind: (musicVoice && musicVoice.layerKind && safe(() => musicVoice.layerKind())) || 'layers', layerLabels: (musicVoice && musicVoice.layerLabels && safe(() => musicVoice.layerLabels())) || null, layerLevel: st.layerLevel, layerManual: st.intensity != null, fallback: !!st.fallback });
    // Séquences d'un morceau séquentiel qui joue : { labels, current, reachable, pending } (null si le morceau n'en a pas ou ne joue pas).
    const sequencesOf = () => {
      const v = musicVoice; if (!v || !v.sequenceCount) return null;
      const n = safe(() => v.sequenceCount()) || 0; if (n < 2) return null;
      return { labels: safe(() => v.sequenceLabels()) || [], current: safe(() => v.sequenceCurrent()), reachable: safe(() => v.sequenceReachable()) || [], pending: safe(() => v.sequencePending()) };
    };
    const itemAt = pos => (pos ? (pos.kind === 'edge' ? model.edgeById(map, pos.id) : model.nodeById(map, pos.id)) : null);
    // Chargement d'un son (récupération + décodage, parfois plusieurs secondes pour un morceau à couches) : compté pour que la page l'indique.
    const load = ref => {
      st.loading++; notify();
      const done = () => { st.loading = Math.max(0, st.loading - 1); notify(); };
      return env.voiceFactory(ref).then(v => { done(); return v; }, e => { done(); throw e; });
    };
    const safe = fn => { try { return fn(); } catch (e) { return undefined; } };

    // Son de musique voulu pour la position (et l'état combat) : une alternative tirée au hasard dans la liste.
    function wantedMusic() {
      const item = itemAt(st.position); if (!item) return null;
      // Un point de passage sans son à lui est transparent : la musique en cours continue (le son du parcours qu'on emprunte).
      if (item.type === 'junction' && !((item.sounds && item.sounds.main) || []).length && st.music) return { ref: st.music, transition: model.resolveTransition(map, item) };
      const useCombat = st.combat && model.hasAltMusic(map, st.position);
      let list = (item.sounds && (useCombat ? item.sounds.combat : item.sounds.main)) || [];
      // Exploration vide mais un morceau de combat posé : un compositeur peut se servir de la 1re couche d'un morceau à couches
      // comme musique d'exploration. On joue donc ce morceau, à la couche 1 (repli ; ignoré si ce n'est pas un morceau à couches).
      let fallback = false;
      if (!useCombat && !list.length) {
        const combat = ((item.sounds && item.sounds.combat) || []).filter(r => r && (r.kind === 'track' || r.kind === 'asset'));
        if (combat.length && model.hasAltMusic(map, st.position)) { list = combat; fallback = true; }
      }
      return { ref: model.pickVariant(list, lastMusicKey), transition: model.resolveTransition(map, item), fallback, role: useCombat ? 'combat' : 'explore' };
    }

    async function setRoom() {
      const item = itemAt(st.position);
      const ref = item ? model.resolveRoom(map, item) : (map && map.roomTone) || null;
      const key = model.refKey(ref);
      if (key === model.refKey(st.room)) { if (roomVoice) roomVoice.setLevel(model.dbToGain(map.roomToneDb), 0.3); return; }
      const my = ++roomSeq;
      const fade = 2;
      const old = roomVoice; st.room = ref;
      if (old) { old.setLevel(0, fade); const o = old; env.schedule(() => { if (roomVoice !== o) safe(() => o.stop()); }, env.now() + fade + 0.1); }
      roomVoice = null;
      if (!ref) return;
      const v = await load(ref);
      if (my !== roomSeq || !v) return;
      roomVoice = v; v.start(0); v.setLevel(model.dbToGain(map.roomToneDb), fade);
    }
    let roomSeq = 0;

    // Couche d'un morceau à couches : automatique (exploration = couche 1, combat = toutes) ou choisie à la main.
    function applyLayer(voice, role) {
      if (!voice || !voice.layerCount || !voice.setIntensity) { st.layerLevel = null; return; }
      const n = safe(() => voice.layerCount()) || 0;
      if (n < 2) { st.layerLevel = null; return; }
      const auto = voice.layerAuto ? (safe(() => voice.layerAuto(role === 'combat' ? 'combat' : 'explore')) || 0) : (role === 'combat' ? n - 1 : 0);
      const want = st.intensity != null ? Math.max(0, Math.min(n - 1, st.intensity)) : Math.max(0, Math.min(n - 1, auto));
      safe(() => voice.setIntensity(want)); st.layerLevel = want;
    }
    async function enter() {
      const my = ++token;
      if (cancelPending) { cancelPending(); cancelPending = null; st.pendingAt = null; }
      setRoom();
      const want = wantedMusic();
      const newKey = want && want.ref ? model.refKey(want.ref) : null;
      st.fallback = !!(want && want.fallback);
      if (newKey === lastMusicKey && musicVoice) { st.music = want.ref; applyLayer(musicVoice, want.role); notify(); return; } // même son : on le laisse jouer (la couche suit l'état exploration / combat)
      let tr = want ? want.transition : model.resolveTransition(map, null);
      // Bascule d'une musique à l'autre : le son de transition de l'élément (facultatif) est joué comme jingle de passage.
      if (st.switchStinger) { tr = Object.assign({}, tr, { stinger: st.switchStinger }); st.switchStinger = null; }
      const incomingPromise = want && want.ref ? load(want.ref) : Promise.resolve(null);
      const outgoing = musicVoice;
      // Quand ? Au prochain repère de la grille du son qui joue (mesure, temps…), sinon tout de suite.
      let at = env.now();
      if (outgoing && tr.sync !== 'immediate' && outgoing.nextBoundary) { const b = safe(() => outgoing.nextBoundary(tr.sync)); if (b != null && b > at) at = b; }
      const run = async () => {
        if (my !== token) return;
        cancelPending = null; st.pendingAt = null;
        let incoming = await incomingPromise;
        if (my !== token) return;
        // Repli d'exploration sur un morceau qui n'a pas de couches : ce n'est pas de la musique d'exploration, on reste sans son.
        if (want && want.fallback && incoming && !((incoming.layerCount && safe(() => incoming.layerCount())) > 1)) incoming = null;
        if (incoming) applyLayer(incoming, want && want.role); else st.layerLevel = null;
        const sec = Math.max(0, tr.sec || 0);
        if (stingerVoice) { const sv = stingerVoice; stingerVoice = null; safe(() => sv.stop()); }
        if (tr.stinger) load(tr.stinger).then(v => { if (v && my === token) { stingerVoice = v; v.start(1); } });
        const stopLater = (v, after) => { if (!v) return; env.schedule(() => { if (musicVoice !== v) safe(() => v.stop()); }, env.now() + after + 0.05); };
        musicVoice = incoming; lastMusicKey = incoming ? newKey : null; st.music = want && want.ref && incoming ? want.ref : null;
        if (tr.style === 'cut' || sec === 0) {
          if (outgoing && outgoing !== incoming) safe(() => outgoing.stop());
          if (incoming) incoming.start(1);
        } else if (tr.style === 'fadeout') {
          if (outgoing && outgoing !== incoming) { outgoing.setLevel(0, sec / 2); stopLater(outgoing, sec / 2); }
          if (incoming) env.schedule(() => { if (my === token || musicVoice === incoming) { incoming.start(0); incoming.setLevel(1, sec / 2); } }, env.now() + (outgoing ? sec / 2 : 0));
        } else {
          if (outgoing && outgoing !== incoming) { outgoing.setLevel(0, sec); stopLater(outgoing, sec); }
          if (incoming) { incoming.start(0); incoming.setLevel(1, outgoing ? sec : Math.min(sec, 1)); } // premier son : fondu d'entrée court
        }
        notify();
      };
      if (at - env.now() > 0.02) { st.pendingAt = at; cancelPending = env.schedule(run, at); notify(); } else await run();
    }

    return {
      setMap(m) { map = m; },
      get state() { return snapshot(); },
      // Se placer sur un élément ou un parcours : démarre la lecture si besoin.
      async goTo(target) {
        if (!map || !model.pointOf(map, target)) return false;
        if (!st.position || st.position.kind !== target.kind || st.position.id !== target.id) st.intensity = null; // nouveau lieu : la couche redevient automatique
        st.position = { kind: target.kind, id: target.id };
        if (!model.hasAltMusic(map, st.position)) st.combat = false;
        st.playing = true; await enter(); return true;
      },
      // Flèche : voisin dans la direction demandée.
      async step(dx, dy) {
        if (!map || !st.position) return null;
        const next = model.stepToward(map, st.position, dx, dy);
        if (next) await this.goTo(next);
        return next;
      },
      // Couche à entendre (morceau à couches) : i = 0 (couche 1 seule) ... n - 1 (toutes) ; null = automatique.
      setIntensity(i) {
        st.intensity = i == null ? null : Math.max(0, Math.round(+i) || 0);
        if (musicVoice) applyLayer(musicVoice, st.combat && model.hasAltMusic(map, st.position) ? 'combat' : 'explore');
        notify();
      },
      // Passer à une séquence du morceau séquentiel qui joue (par les embranchements que le morceau prévoit).
      goToSequence(i) { const ok = !!(musicVoice && musicVoice.goToSequence && safe(() => musicVoice.goToSequence(i))); notify(); return ok; },
      async setCombat(on) {
        if (!map || !st.position) return false;
        const want = !!on && model.hasAltMusic(map, st.position);
        if (want === st.combat) return want;
        st.combat = want; st.intensity = null; // le combat change la couche : retour à l'automatique
        const it = itemAt(st.position); st.switchStinger = (it && it.altTransition) || null;
        if (st.playing) await enter(); else notify();
        return want;
      },
      // Tout s'éteint en douceur ; la position est gardée pour reprendre.
      stop(fade) {
        const sec = fade == null ? 1 : fade;
        token++; roomSeq++;
        if (cancelPending) { cancelPending(); cancelPending = null; st.pendingAt = null; }
        [musicVoice, roomVoice, stingerVoice].forEach(v => { if (v) { v.setLevel(0, sec); const vv = v; env.schedule(() => safe(() => vv.stop()), env.now() + sec + 0.05); } });
        musicVoice = null; roomVoice = null; stingerVoice = null; lastMusicKey = null;
        st.playing = false; st.music = null; st.room = null; notify();
      },
      async resume() { if (st.position) { st.playing = true; await enter(); } },
      // Réglage fait pendant l'écoute (niveau du fond d'ambiance).
      refreshRoomLevel() { if (roomVoice && map) roomVoice.setLevel(model.dbToGain(map.roomToneDb), 0.2); },
    };
  }

  // ---------------------------------------------------------------- Les vraies voix
  // env : { audioContext(), resolve(ref) -> Promise<{ type:'track', track } | { type:'url', url, loop? } | null>, mountTrackControl(track) -> Promise<lpControl> ,
  //         fetchBytes(url) -> Promise<Uint8Array>, decode(bytes) -> Promise<AudioBuffer> }
  function createVoiceFactory(env) {
    const cache = new Map(); // morceaux : une voix par morceau, réutilisée (le lecteur du morceau est monté une seule fois)
    const buffers = new Map();
    async function bufferVoice(url, loop) {
      let buf = buffers.get(url);
      if (!buf) { buf = env.decode(await env.fetchBytes(url)); buffers.set(url, buf); }
      const audioBuf = await buf;
      const ctx = env.audioContext();
      let src = null, gain = null, playing = false;
      return {
        start(level) {
          if (playing) return;
          src = ctx.createBufferSource(); src.buffer = audioBuf; src.loop = !!loop;
          gain = ctx.createGain(); gain.gain.setValueAtTime(Math.max(0, level), ctx.currentTime);
          src.connect(gain); gain.connect(ctx.destination); src.start(); playing = true;
          src.onended = () => { playing = false; };
        },
        setLevel(level, sec) { if (!gain) return; const n = ctx.currentTime; gain.gain.cancelScheduledValues(n); gain.gain.setValueAtTime(gain.gain.value, n); gain.gain.linearRampToValueAtTime(Math.max(0, level), n + Math.max(0.01, sec || 0)); },
        stop() { try { if (src) src.stop(); } catch (e) {} playing = false; },
        isPlaying: () => playing,
        nextBoundary: () => null, // un fichier brut n'a pas de tempo connu : la transition part tout de suite
      };
    }
    return async function voiceFactory(ref) {
      const spec = await env.resolve(ref);
      if (!spec) return null;
      if (spec.type === 'track') {
        const key = spec.track.id;
        if (!cache.has(key)) cache.set(key, env.mountTrackControl(spec.track));
        return cache.get(key);
      }
      return bufferVoice(spec.url, spec.loop !== false);
    };
  }

  window.LayerPitchLevelMapAudio = { createPlayer, createVoiceFactory };
})();
