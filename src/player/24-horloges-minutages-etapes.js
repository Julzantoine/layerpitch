  // ---- État moteur embranchement-vertical (voir bloc dédié plus bas pour la logique) ----
  let embrLoopBuffers = []; // un buffer par boucle déclarée (même ordre que track.loops), null si manquante
  let embrTransitionBuffers = []; // idem, un buffer de transition optionnel par boucle (24/08), null si absente/pas de fichier
  let embrActiveTransitionSources = []; // sources de transition actuellement en train de sonner -- suivies pour pouvoir les couper sur Stop (voir stopEmbrVertical)
  let embrActiveGenSources = []; // {src, gain, loopIdx} des générations "pairs" (même longueur que la référence) en cours
  let embrActiveLoopIdx = -1; // index (dans track.loops) de la boucle actuellement AUDIBLE
  let embrSchedulerTimer = null;
  let embrNextStartCtxTime = 0;
  let embrDetourTimeout = null; // minuterie du retour auto à la référence après une boucle courte
  let embrDetourSource = null; // {src, gain} du détour en cours, si il y en a un
  let embrDetourBtn = null; // bouton désactivé le temps de ce détour, si il y en a un
  // ---- Ajouts 24/08 : timing de bascule quantifié, minuteur de retour pour les boucles paires, mode
  // "en boucle jusqu'à un bouton" pour les boucles détour (voir bloc moteur dédié plus bas) ----
  // Horloge de phase de l'embranchement-vertical (position dans le cycle, en temps NOMINAL du fichier) : morceaux de droite
  // { ctx, nominal, ratio }. Un changement de vitesse (27/09) ne s'entend qu'à la génération suivante : l'horloge
  // change de pente à cet instant-là, pas avant -- sinon la jauge sautait et les bascules quantifiées tombaient à côté
  // pendant la fin de la boucle en cours.
  let embrClock = [{ ctx: 0, nominal: 0, ratio: 1 }];
  function embrClockReset(ctxT, nominal) { embrClock = [{ ctx: ctxT, nominal: nominal || 0, ratio: trackPitchRatio }]; }
  function embrClockSegAt(t) { let seg = embrClock[0]; for (const x of embrClock) if (x.ctx <= t) seg = x; return seg; }
  function embrNominalAt(t) { const seg = embrClockSegAt(t); return seg.nominal + (t - seg.ctx) * seg.ratio; }
  // Une génération démarre à ctxT avec la vitesse en vigueur : nouveau morceau de droite si la vitesse change, et
  // l'animation des lignes riches reprend sa cadence à l'instant où la nouvelle vitesse devient audible.
  function embrClockAtGeneration(ctxT) {
    const last = embrClock[embrClock.length - 1];
    if (Math.abs(last.ratio - trackPitchRatio) < 1e-9) return;
    embrClock.push({ ctx: ctxT, nominal: embrNominalAt(ctxT), ratio: trackPitchRatio });
    const keepFrom = embrClock.findIndex(x => x.ctx > ctx.currentTime);
    if (keepFrom > 1) embrClock = embrClock.slice(keepFrom - 1);
    // Position et vitesse lues à l'instant du changement (pas à l'heure du minuteur, qui peut partir un peu avant).
    const ratioAt = trackPitchRatio;
    voiceGraphTimeouts.push(setTimeout(() => {
      if (!playing) return;
      const cycle = embrCycleLengthSec();
      const t = Math.max(ctx.currentTime, ctxT);
      const pos = cycle > 0 ? ((embrNominalAt(t) % cycle) + cycle) % cycle : 0;
      applyEmbrWaveAnimation(pos, ratioAt);
    }, Math.max(0, (ctxT - ctx.currentTime) * 1000)));
  }
  let embrPendingSwitchTimeout = null; // bascule quantifiée en attente (annulée/remplacée si un nouveau clic arrive avant qu'elle ne s'exécute)
  let embrAutoReturnTimeout = null; // minuterie de retour auto d'une boucle PAIRE (différent de embrDetourTimeout, qui concerne les boucles courtes)
  let embrEndLoopBtnEl = null; // bouton "Mettre fin à la boucle" inséré dynamiquement pendant un détour en mode "en boucle jusqu'à un bouton"
  let embrIntroLockTimeout = null; // verrouillage des boutons pendant le segment Départ→Entrée de la référence au tout premier lancement (29/08) -- voir playEmbrVertical()
  let embrPendingTransitionSwitchTimeout = null; // bascule réelle en attente le temps qu'un fichier de transition finisse de jouer (29/08, voir performEmbrSwitch) -- distinct de embrPendingSwitchTimeout (quantification), les deux peuvent s'enchaîner
  let currentGainNodes = []; // moteur quantifié : gains de la génération la plus récente, par couche (contrôle d'intensité en direct)
  let schedulerTimer = null;
  let voiceGraphTimeouts = [];
  let nextGenStartCtxTime = 0, nextGenBufferOffset = 0;
  // Historique des générations programmées : { ctxStartTime, bufferOffset }. Sert à retrouver la position
  // RÉELLEMENT audible à un instant donné (voir currentPlaybackOffset ci-dessous) — pas simplement "la dernière
  // programmée", qui à cause du lookahead scheduler (jusqu'à 1s d'avance) peut encore être dans le futur au
  // moment où on la lit, ce qui donnait une tête de lecture visuellement en avance sur le son.
  let scheduledGens = [];
  function currentPlaybackOffset() {
    let chosen = null;
    for (const g of scheduledGens) {
      if (g.ctxStartTime <= ctx.currentTime && (!chosen || g.ctxStartTime > chosen.ctxStartTime)) chosen = g;
    }
    if (!chosen) return 0;
    return Math.min(chosen.bufferOffset + (ctx.currentTime - chosen.ctxStartTime) * (chosen.ratio || trackPitchRatio), progressMaxSec());
  }
  // Nombre de boucles (moteur quantifié) : loopsPlayed compte les passages programmés par le scheduler
  // récurrent (pas le tout premier, déclenché directement par playQuantized). Une fois track.maxLoops
  // atteint (si non nul), on arrête de programmer de nouvelles générations et on laisse la dernière
  // en cours filer seule jusqu'à sa fin naturelle (l'outro = la queue déjà présente dans le fichier).
  let loopsPlayed = 0;
  let lastGenSources = [];
  let finalGenerationMarkerSrc = null;

  // Spécifique au mode vertical-random (fusionné avec l'ex-"vertical random séquentiel" le 30/07)
  // sectionBuffers[secIdx][poolIdx] = [buffer, buffer, ...] pour chaque alternative jouable de ce pool,
  // secIdx étant l'index DÉCLARÉ de la section (pas résolu) — une section qui duplique une autre
  // (referencesSectionId) pointe directement vers le MÊME tableau que sa source (pas une copie), exactement
  // comme les groupes/emplacements dupliqués des autres modes. L'anti-répétition par pool se garde donc par
  // identifiant canonique (l'id du pool réellement porteur du contenu), pas par index brut.
  let sectionBuffers = [];
  let lastPickedPoolIndex = {}; // lastPickedPoolIndex[canonicalPoolId] = index de la dernière alternative tirée pour ce pool
  // playableSectionOriginalIndex[i] = index RÉEL dans track.sections pour la i-ème section jouable — le
  // scheduler pur (createSectionPlaybackScheduler) ne connaît que des positions 0..N-1 parmi les sections
  // jouables, il faut donc toujours repasser par cette table pour retrouver la vraie section (et ses
  // buffers déjà chargés) à jouer.
  let playableSectionOriginalIndex = [];
  let sectionScheduler = null; // recréé à chaque vrai démarrage (pas une reprise), voir playVerticalRandom
  function canonicalPoolKey(secIdx, poolIdx) {
    const section = resolveVRSection(track, secIdx);
    const pool = (section && section.pools || [])[poolIdx];
    return (pool && pool.referencesPoolId) || (pool && pool.id) || ('s' + secIdx + 'p' + poolIdx);
  }
  function pickPoolAlternativeIndex(secIdx, poolIdx) {
    const section = resolveVRSection(track, secIdx);
    const pool = (section && section.pools || [])[poolIdx];
    const bufs = (sectionBuffers[secIdx] && sectionBuffers[secIdx][poolIdx]) || [];
    const n = bufs.length;
    if (n === 0) return -1;
    const key = canonicalPoolKey(secIdx, poolIdx);
    let idx = Math.floor(Math.random() * n);
    if (pool && pool.avoidImmediateRepeat && n > 1) {
      while (idx === lastPickedPoolIndex[key]) idx = Math.floor(Math.random() * n);
    }
    lastPickedPoolIndex[key] = idx;
    return idx;
  }
  // Minutage d'une section résolue (bpm/mesures/timeline propres à CETTE section — plus un tempo unique
  // partagé par tout le morceau, voir décision du 30/07). Calculé à la demande plutôt que figé une fois,
  // puisque la section "courante" change au fil de la lecture.
  function sectionTiming(section) { return vrSectionTiming(section); }

  // Buffers des Sfx attachés : un tableau de buffers (une entrée par variation round robin) par Sfx,
  // indexé par son id — remplace l'ancien tableau plat "un buffer par stinger".
  let sfxBuffersById = {};
  let sfxLastIndexById = {}; // dernier index tiré par Sfx (anti-répétition aléatoire / avance séquentielle)
  let activeStingerSources = [];

  // introBuffer/outroBuffer : partagés entre séquentiel et vertical-random (même forme de champs, fusion
  // du 30/07) — jamais utilisés par les deux modes à la fois, un morceau n'ayant qu'un seul mode.
  let introBuffer = null, outroBuffer = null;
  // slotBuffers[s] = [buffer, buffer, ...] pour chaque alternative jouable de l'emplacement s — même
  // principe que sectionBuffers du vertical-random (y compris la duplication/référence pour économiser la
  // mémoire, voir canonicalPoolKey plus bas), mais ici l'ORDRE des emplacements compte en plus : ils
  // s'enchaînent dans l'ordre défini par le compositeur (contrairement aux pools d'une même section, qui
  // jouent tous simultanément et n'ont pas de notion d'ordre entre eux).
  let slotBuffers = [];
  // transitionBuffers[s][o] = buffer du fichier de transition déclaré pour le o-ième embranchement sortant
  // de l'emplacement s (nextOptions[o].transition), ou null si aucun n'est défini pour cette paire précise
  // — chaque embranchement a le sien, contrairement à slotBuffers qui est par emplacement (voir schéma
  // "Embranchement séquentiel avec transitions" validé le 02/08).
  let transitionBuffers = [];
  const seqTransitionDefByBuffer = new Map(); // fichier de transition décodé -> sa définition (effets propres, 27/09)
  let lastPickedSlotAltIndex = {}; // lastPickedSlotAltIndex[canonicalSlotId] = index de la dernière alternative tirée pour ce pool — partagé entre tous les emplacements qui dupliquent le même pool (ex. structure AABA : les deux "A" évitent la même dernière alternative jouée)
  let currentSlotIndex = 0; // position dans le cycle d'emplacements ; boucle sur elle-même (0,1,...,N-1,0,1,...)
  let currentSlotRepeatsPlayed = 0; // combien de fois l'emplacement courant a déjà rejoué depuis qu'on y est arrivé, pour respecter repeatCount avant de passer au suivant
  // Embranchement séquentiel (optionnel, par emplacement — voir schéma `nextOptions` validé le 31/07,
  // étendu le 02/08 avec `quantization`/`cutStyle`/`transition` par embranchement) : id de l'emplacement
  // choisi par le visiteur, en attente d'être consommé par performSeqBranchCut(). Un nouveau clic écrase
  // la valeur précédente (dernier clic gagne) ; remis à null une fois consommé.
  let pendingNextSegmentId = null;
  // Carte globale des chemins (02/09) : historique des emplacements déjà devenus audibles depuis le
  // (re)démarrage -- rien de tel n'existait avant ce chantier (aucun état de ce genre à réutiliser), voir
  // activateSeqStage() pour l'alimentation. seqMapFullReveal (posé par buildPreviewTrack() côté Backstage
  // uniquement) affiche la carte en entier dès le chargement -- outil de vérification de sa propre
  // structure pendant qu'on la construit ; côté public, révélation progressive comme demandé.
  let seqVisitedSlotIds = new Set();
  // Dernier emplacement entendu : à l'arrêt (aucun emplacement « courant »), la carte des chemins garde ses options visibles depuis celui-ci
  // au lieu de se replier sur les seuls emplacements déjà joués (6/10, retour de Jules-Antoine : « quand j'appuie sur stop, la carte se replie »).
  let seqMapFrontierIdx = -1;
  // Ordre aléatoire : slots entendus pendant le tour en cours (coches de la carte), tenu à partir de ce qui
  // est réellement joué -- chainState.order a souvent un tour d'avance (le slot suivant est préparé à l'avance).
  let seqRoundPlayedIds = new Set(), seqRoundLastIdx = -1;
  const seqMapFullReveal = !!track.seqMapFullReveal;
  const seqMapRandom = track.mode === 'sequential' && !!track.randomizeSections; // voir seqMapForwardTargets/seqMapComputeLayout
  // Boule de transition "en train de jouer" (05/09, retour direct : "est-ce que la boule qui symbolise la
  // transition peut se colorer lorsqu'elle joue ?") -- currentTransitionEdge identifie l'arête source->cible
  // dont le fichier de transition est actuellement audible (posé/retiré par activateSeqStage(), voir plus
  // bas), null le reste du temps. seqMapLastCurrentIdx retient le dernier index passé à updateSeqMap() pour
  // pouvoir la redessiner à l'identique (même nœud "current") au moment où une transition démarre/se termine,
  // sans devoir faire remonter cet index jusqu'ici depuis performSeqBranchCut().
  let currentTransitionEdge = null;
  let seqMapLastCurrentIdx = -1;
  // Amorçage à chaud de la disposition "à ressorts" (mode 'roomy', 10/09) -- positions du dernier calcul,
  // par emplacement, réutilisées comme point de départ du suivant plutôt que recalculées de zéro à chaque
  // updateSeqMap() (révélation progressive publique : la carte s'étend en douceur au lieu de sauter à
  // chaque nouvel emplacement révélé). Voir seqMapForceLayout().
  let seqMapForcePositions = {};
  let chainState = { cyclesCompleted: 0, capReached: false }; // compteur de cycles complets pour maxChainLoops — voir advanceChainIndex(), remis à zéro à chaque vrai redémarrage (pas une reprise)
  let seqSchedulerTimer = null;
  let seqNextStartCtxTime = 0;
  let seqActiveSources = []; // {src, gain} toutes générations confondues (dont queues en train de finir)
  let seqLastGenSources = [];
  let seqFinalMarkerSrc = null;
  let seqTimeouts = [];
  let goToEndRequested = false;
  // ---- État pour la coupure fine des embranchements séquentiels (voir schéma "quantization"/"cutStyle"/
  // "transition" validé le 02/08) — voir armNextSeqBranchBoundary()/performSeqBranchCut() plus bas. ----
  let forcedNextBlock = null; // bloc à jouer en priorité au prochain decideNextSeqBlock() (la transition injectée par une coupure), consommé et vidé aussitôt lu
  let seqBranchEpoch = 0; // incrémenté à chaque nouveau passage sur un emplacement et à chaque coupure — invalide les chaînes de vérification de frontière héritées d'un passage précédent (voir armNextSeqBranchBoundary)
  // Tempo effectif d'un emplacement séquentiel — même principe que sectionTiming() pour le vertical-random
  // (une seule formule de repli, réutilisée partout plutôt que dupliquée) : slot.bpm/beatsPerBar si réglés
  // sur CET emplacement, sinon le tempo du morceau.
  function slotTiming(slot) { return seqSlotTiming(track, slot); }
  // slot fourni ET porteur d'un tempo propre (bpm ou beatsPerBar) : grille de CET emplacement. Sinon (pas de slot, ou
  // slot sans réglage propre) : grille du morceau, comportement historique inchangé (track.bpm || 120).
  function blockSeconds(bars, slot) { return seqBlockSeconds(track, bars, slot); }
  // Tempo effectif d'un fichier de transition (nextOptions[].transition) — même principe de repli que
  // slotTiming(), mais à un niveau de plus : tempo propre à la transition si réglé, sinon celui de
  // l'emplacement source qu'on quitte, sinon celui du morceau. Distinct de slotTiming() car une transition
  // peut délibérément changer de tempo par rapport à l'emplacement qu'elle quitte (impact, riser...), alors
  // qu'un emplacement hérite normalement du morceau.
  function transitionTiming(tr, sourceSlot) { return seqTransitionTiming(track, tr, sourceSlot); }
  // Durée nominale d'un fichier de transition avant que le crossfade-tail classique vers la cible ne prenne
  // le relais (voir schéma "durationUnit" validé le 14/08, complété le 29/08 avec l'unité "temps"). Quatre
  // cas :
  // - `durationUnit` absent (transitions déjà publiées avant ce chantier) : comportement historique
  //   strictement inchangé, blockSeconds() sur le tempo de l'emplacement source — rétrocompatibilité totale.
  // - `durationUnit: 'bars'` : mesures sur le tempo PROPRE de la transition (transitionTiming), pas
  //   forcément celui de l'emplacement source.
  // - `durationUnit: 'beats'` (29/08) : temps individuels sur ce même tempo propre -- pour un réglage plus
  //   fin qu'une mesure entière (ex. un stinger d'1.5 temps). Même `transitionTiming()` que 'bars', sans la
  //   multiplication par beatsPerBar puisqu'on compte déjà des temps, pas des mesures.
  // - `durationUnit: 'seconds'` : durée brute en secondes, aucune notion de tempo.
  function transitionDurationSecFor(opt, sourceSlot) { return seqTransitionDurationSec(track, opt, sourceSlot); }
  function canonicalSlotKey(s) {
    const slot = (track.segmentSlots || [])[s];
    return (slot && slot.referencesSlotId) || (slot && slot.id) || ('s' + s);
  }
  // Pour un emplacement qui duplique un autre, ses propres "alternatives" sont vides (le contenu vit chez
  // la source) — on va chercher le bon libellé là où sont réellement les fichiers, plutôt que d'afficher
  // seulement le nom générique de l'emplacement.
  function resolveSlotAlternative(slotIdx, altIdx) {
    const slot = (track.segmentSlots || [])[slotIdx];
    if (!slot) return null;
    if (slot.referencesSlotId) {
      const source = (track.segmentSlots || []).find(sl => sl.id === slot.referencesSlotId);
      return (source && source.alternatives || [])[altIdx] || null;
    }
    return (slot.alternatives || [])[altIdx] || null;
  }
  function pickSlotAlternativeIndex(slotIdx) {
    const bufs = slotBuffers[slotIdx] || [];
    const n = bufs.length;
    if (n === 0) return -1;
    // L'anti-répétition (case à cocher) est réglée sur l'emplacement "porteur" du contenu quand celui-ci
    // est dupliqué ailleurs — dupliquer un pool n'a pas sa propre notion d'anti-répétition indépendante,
    // puisque le pool (et son historique de tirage) est justement partagé.
    const key = canonicalSlotKey(slotIdx);
    const sourceSlot = (track.segmentSlots || []).find(sl => sl.id === key) || (track.segmentSlots || [])[slotIdx];
    let idx = Math.floor(Math.random() * n);
    if (sourceSlot && sourceSlot.avoidImmediateRepeat && n > 1) {
      while (idx === lastPickedSlotAltIndex[key]) idx = Math.floor(Math.random() * n);
    }
    lastPickedSlotAltIndex[key] = idx;
    return idx;
  }
  // Prochain emplacement jouable dans le cycle, en partant de la position courante — saute silencieusement
  // les emplacements sans aucune alternative chargée (ex. tous les fichiers manquants) plutôt que de casser
  // la chaîne. Reste sur le même emplacement jusqu'à épuiser son repeatCount (nombre de répétitions avant
  // de passer au suivant) avant d'avancer dans la chaîne. Renvoie null s'il n'y a strictement aucun
  // emplacement jouable.
  function pickNextSegmentSlot() {
    const slots = track.segmentSlots || [];
    if (!slots.length) return null;
    for (let i = 0; i < slots.length; i++) {
      const slotIdx = currentSlotIndex;
      const altIdx = pickSlotAlternativeIndex(slotIdx);
      if (altIdx < 0) {
        // emplacement totalement vide : on l'ignore, on passe au suivant sans consommer de répétition
        currentSlotIndex = advanceChainIndex(currentSlotIndex, slots.length, chainState, track.maxChainLoops, !!track.randomizeSections);
        currentSlotRepeatsPlayed = 0;
        continue;
      }
      // Un emplacement à embranchements ne quitte JAMAIS sa position tout seul, quel que soit repeatCount
      // (qui n'a plus de sens ici) — l'avancement automatique n'a plus lieu d'être dès lors que le visiteur
      // peut cliquer pour choisir (validé le 02/08). Seule une coupure fine (performSeqBranchCut(), voir
      // plus bas) peut faire avancer currentSlotIndex pour un tel emplacement.
      if (slots[slotIdx].nextOptions && slots[slotIdx].nextOptions.length) {
        return { slotIdx, altIdx };
      }
      currentSlotRepeatsPlayed++;
      const repeatCount = Math.max(1, slots[slotIdx].repeatCount || 1);
      if (currentSlotRepeatsPlayed >= repeatCount) {
        currentSlotIndex = advanceChainIndex(currentSlotIndex, slots.length, chainState, track.maxChainLoops, !!track.randomizeSections);
        currentSlotRepeatsPlayed = 0;
      }
      // Un cycle complet de la chaîne vient d'atteindre la limite maxChainLoops (toutes deux causes
      // d'avancement ci-dessus y mènent pareil) : même mécanisme que "Aller vers la fin" manuel, pris en
      // compte au prochain decideNextSeqBlock() — l'emplacement en cours de programmation ici va tout de
      // même jusqu'à son terme, seul ce qui vient après bascule vers l'outro (ou la fin naturelle).
      if (chainState.capReached) { chainState.capReached = false; goToEndRequested = true; }
      return { slotIdx, altIdx };
    }
    return null; // aucun emplacement n'a la moindre alternative chargée
  }
  // Visualisation en blocs (intro / segment en cours / outro), qui se remplissent au rythme de la lecture —
  // demande directe d'un retour compositeur : "montrer un bloc pour le cue de départ qui se remplit en jouant,
  // puis un bloc pour la boucle tirée au sort, puis un bloc pour le cue de fin".
  const seqBlockEls = {
    intro: wrapper.querySelector('[data-role="seqBlock-intro"]'),
    segment: wrapper.querySelector('[data-role="seqBlock-segment"]'),
    outro: wrapper.querySelector('[data-role="seqBlock-outro"]')
  };
  // Chaque bloc affiche la vraie waveform du fichier qui y joue (pas un simple aplat de couleur) — pour
  // l'intro/l'outro le buffer est fixe, pour "segment" il change à chaque tirage et est donc recalculé
  // à chaque nouvelle activation. Même principe fond/avant-plan que la waveform du mode statique.
  const seqWaveEls = {
    intro: { bg: wrapper.querySelector('[data-role="seqWaveBg-intro"]'), fg: wrapper.querySelector('[data-role="seqWaveFg-intro"]') },
    segment: { bg: wrapper.querySelector('[data-role="seqWaveBg-segment"]'), fg: wrapper.querySelector('[data-role="seqWaveFg-segment"]') },
    outro: { bg: wrapper.querySelector('[data-role="seqWaveBg-outro"]'), fg: wrapper.querySelector('[data-role="seqWaveFg-outro"]') }
  };
  // Contrairement au mode statique et vertical-random, ce bloc n'avait jusqu'ici AUCUN redessin au
  // redimensionnement — le canevas restait figé à la taille capturée lors de son tout premier dessin
  // (ex. juste avant qu'une transition de layout ne se termine), d'où une forme d'onde qui semblait
  // "correcte sur une partie, plate ensuite" alors que le son continuait bel et bien. Même principe que
  // waveformBg/waveformFg (mode statique) et voiceWave* (vertical-random) : on retient le dernier buffer
  // dessiné par bloc (+ sa durée de rognage éventuelle) et on redessine dès que le conteneur change de taille.
  const seqLastBuffers = { intro: null, segment: null, outro: null };
  const seqLastCropSec = { intro: null, segment: null, outro: null };
  const seqBlocksContainer = wrapper.querySelector('.seq-blocks');
  if (seqBlocksContainer && window.ResizeObserver) {
    new ResizeObserver(() => {
      Object.keys(seqLastBuffers).forEach(k => { if (seqLastBuffers[k]) drawSeqBlockWave(k, seqLastBuffers[k], seqLastCropSec[k]); });
    }).observe(seqBlocksContainer);
  }
  // maxDurationSec (optionnel) : pour Intro/Segment, dont le fichier réel déborde volontairement au-delà
  // de sa durée musicale nominale (queue de recouvrement crossfade), n'affiche que la portion nominale —
  // la queue technique ne fait pas partie de "la" forme d'onde du bloc du point de vue du visiteur.
  // Pour l'Outro (pas de notion de durée nominale, fin ouverte), ce paramètre vaut simplement la durée
  // réelle du fichier : aucun rognage effectif, comportement inchangé.
  function drawSeqBlockWave(kind, buffer, maxDurationSec) {
    seqLastBuffers[kind] = buffer || seqLastBuffers[kind]; // conservé pour le redessin au resize (voir plus bas)
    seqLastCropSec[kind] = (maxDurationSec != null) ? maxDurationSec : seqLastCropSec[kind];
    const els = seqWaveEls[kind];
    if (!els || !els.bg || !els.fg || !buffer) return;
    renderWaveformPair(els.bg, els.fg, buffer, waveBgColor, waveFgColor, seqLastCropSec[kind]);
  }
  // État du bloc actuellement en cours de lecture, retenu pour permettre le seek (glisser sur sa waveform) :
  // sans ça, impossible de savoir quel buffer/gain relancer, ni à quelle position on se trouve réellement
  // dedans (le curseur visuel seul ne suffit pas — il faut aussi la référence temporelle audio exacte).
  let currentSeqBlockInfo = null; // { kind, buffer, gain, totalSec, virtualZero, terminal, slotIdx }
  // startCtxTime : instant AUDIO où ce bloc a démarré (25/09) -- origine exacte de la grille des mesures/temps des
  // coupures (armNextSeqBranchBoundary). Avant, l'heure de ce rappel (un minuteur, quelques ms en retard) servait
  // d'origine : les coupures tombaient quelques ms après la vraie barre de mesure.
  function activateSeqStage(kind, remainingSec, totalSec, buffer, gainValue, terminal, slotIdx, gainNode, fromSlotIdx, toSlotIdx, startCtxTime) {
    // Boule de transition en train de jouer (05/09) : posée uniquement pendant le stade "transition" lui-même,
    // retirée dès que n'importe quel autre stade devient audible (le seul qui suit systématiquement une
    // transition est le "segment" cible, mais un stop/seek peut aussi couper court -- dans tous les cas, plus
    // de transition en cours dès qu'on n'est plus sur "transition").
    if (kind === 'transition') {
      currentTransitionEdge = (fromSlotIdx != null && toSlotIdx != null) ? { from: fromSlotIdx, to: toSlotIdx } : null;
      updateSeqMap(seqMapLastCurrentIdx);
    } else if (currentTransitionEdge) {
      currentTransitionEdge = null;
    }
    const order = ['intro', 'segment', 'outro'];
    const idx = order.indexOf(kind);
    // Tout ce qui précède ce stade (hors "segment", qui se remplit à nouveau à chaque tirage plutôt que
    // de passer "fait") est figé plein — reflète la lecture qui vient réellement de passer ce point.
    order.forEach((k, i) => {
      if (i >= idx || k === 'segment') return;
      const block = seqBlockEls[k], els = seqWaveEls[k];
      if (!block) return;
      block.classList.remove('active'); block.classList.add('done');
      if (els && els.fg) { els.fg.style.transition = 'none'; els.fg.style.clipPath = 'inset(0 0% 0 0)'; }
    });
    const block = seqBlockEls[kind], els = seqWaveEls[kind];
    const startFraction = totalSec > 0 ? Math.max(0, Math.min(1, 1 - (remainingSec / totalSec))) : 0;
    currentSeqBlockInfo = { kind, buffer, gain: gainValue, gainNode: gainNode || null, totalSec, virtualZero: (startCtxTime != null ? startCtxTime : ctx.currentTime) - (startFraction * totalSec), terminal: !!terminal, slotIdx: (slotIdx != null ? slotIdx : -1) };
    // L'indicateur "en attente" reste pertinent quelle que soit la façon dont le choix a été fait (bouton,
    // retiré le 05/09 -- ou nœud de la carte globale) -- rafraîchi à chaque nouveau stade audible.
    updateSeqPendingIndicator();
    // Carte globale (02/09) : un emplacement rejoint l'historique dès qu'il devient audible -- alimente
    // seqVisitedSlotIds (rien de tel n'existait avant ce chantier). Pas de forme d'onde/progression sur le
    // nœud lui-même (retiré le 03/09, voir updateSeqMap()) -- juste rafraîchir quel nœud porte "current".
    if (kind === 'segment' && slotIdx != null && slotIdx >= 0) {
      seqVisitedSlotIds.add(slotIdx);
      updateSeqMap(slotIdx);
    }
    // Chaque nouveau passage sur UN emplacement (y compris une simple répétition du même) a ses propres
    // frontières de temps/mesure à surveiller — l'epoch invalide toute chaîne héritée d'un passage
    // précédent (voir armNextSeqBranchBoundary), pour ne jamais laisser deux chaînes tourner en parallèle.
    if (kind === 'segment' && slotIdx != null && slotIdx >= 0) {
      seqBranchEpoch++;
      const slot = (track.segmentSlots || [])[slotIdx];
      // "immediate" n'a pas besoin de surveillance de frontière : géré directement au clic (voir
      // handleSeqBranchChoice). Seuls "beat"/"bar" ont une frontière à attendre.
      if (slot && slot.nextOptions && slot.nextOptions.length && (slot.quantization || 'bar') !== 'immediate') {
        armNextSeqBranchBoundary(seqBranchEpoch);
      }
    }
    if (block) {
      block.classList.remove('done'); block.classList.add('active');
      if (buffer) drawSeqBlockWave(kind, buffer, totalSec);
      if (els && els.fg) {
        els.fg.style.transition = 'none'; els.fg.style.clipPath = `inset(0 ${(1 - startFraction) * 100}% 0 0)`;
        void els.fg.offsetWidth; // force le reflow avant de relancer la transition, sinon le navigateur la fusionne avec le reset ci-dessus
        if (remainingSec > 0) { els.fg.style.transition = `clip-path ${remainingSec}s linear`; els.fg.style.clipPath = 'inset(0 0% 0 0)'; }
      }
    }
    // Le passage à l'outro clôt définitivement le stade "segment" (plus de nouveau tirage à suivre).
    if (kind === 'outro' && seqBlockEls.segment && seqWaveEls.segment.fg) {
      seqBlockEls.segment.classList.remove('active'); seqBlockEls.segment.classList.add('done');
      seqWaveEls.segment.fg.style.transition = 'none'; seqWaveEls.segment.fg.style.clipPath = 'inset(0 0% 0 0)';
    }
  }
  function resetSeqStages() {
    currentSeqBlockInfo = null;
    Object.keys(seqBlockEls).forEach(k => {
      const block = seqBlockEls[k], els = seqWaveEls[k];
      if (block) block.classList.remove('active', 'done');
      if (els && els.fg) { els.fg.style.transition = 'none'; els.fg.style.clipPath = 'inset(0 100% 0 0)'; }
    });
  }
  // Choix d'un embranchement : appelé depuis un clic sur un nœud cliquable de la carte globale (voir
  // updateSeqMap()) -- seule façon de choisir désormais (les boutons de destination .seq-branch-btn ont
  // été retirés le 05/09, retour direct : "plus besoin des boutons de destination non plus, la carte se
  // suffit également à elle-même" -- la carte couvrait déjà exactement les mêmes cibles).
  function handleSeqBranchChoice(targetId, currentSlot) {
    // Dernier clic gagne (validé le 31/07) : un second clic sur une autre option remplace simplement le
    // choix précédent, il n'y a jamais de verrou sur le premier clic.
    pendingNextSegmentId = targetId;
    if (seqMapNodesEl) seqMapNodesEl.querySelectorAll('.seq-map-node').forEach(n => n.classList.toggle('pending', n.dataset.slotId === targetId));
    updateSeqPendingIndicator();
    trackPublicEvent('seq_branch_select', { trackId: track.id, targetId });
    // "immediate" (validé le 02/08) : pas de frontière à attendre, la coupure se déclenche directement au
    // clic — pour "beat"/"bar", c'est armNextSeqBranchBoundary (armée dès le début de CET emplacement dans
    // activateSeqStage) qui surveille déjà la prochaine frontière et lira ce choix à son tour.
    if (currentSlot && (currentSlot.quantization || 'bar') === 'immediate') performSeqBranchCut();
  }
  function updateSeqPendingIndicator() {
    if (!seqPendingIndicatorEl) return;
    seqPendingIndicatorEl.style.display = pendingNextSegmentId ? '' : 'none';
  }
