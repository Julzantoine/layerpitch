// --- Mode Capture (admin, prototype moteur vidéo) --------------------------------------------
// Enregistre l'horodatage (vs. la vidéo importée) de chaque interaction du lecteur adaptatif pendant
// une "prise" -- calques (intensity_change), stingers (stinger_play), embranchements (seq_branch_select,
// embr_loop_select), etc. Plutôt que de raccorder ces déclencheurs un par un (5 modes de lecture,
// logique interne à player.js), on intercepte le point de passage déjà unique par lequel TOUTE
// interaction transite : trackPublicEvent() y appelle systématiquement window.umami.track(name, detail)
// (voir player.js). On substitue temporairement window.umami par un objet qui journalise avant de
// relayer au vrai umami s'il existe déjà -- aucune modification de player.js nécessaire.
let videoCaptureState = null; // { events, videoEl, markHandler, headHandler, sliderHandler }

// Piste armée pour la capture (2026-09-15) -- réglée depuis un bouton ⏺ posé à côté du lecteur de CHAQUE
// morceau (voir setupCaptureTrigger), exclusif (armer une piste désarme l'ancienne). Persiste tant que la
// page reste ouverte, indépendamment du panneau de capture -- on arme d'abord dans le lecteur du pack,
// avant même d'ouvrir "Capturer une prise" (confirmé par Jules-Antoine 2026-09-15 : "on va d'abord
// s'intéresser au lecteur du pack, avant d'aller dans l'éditeur vidéo").
let armedTrackId = null;

