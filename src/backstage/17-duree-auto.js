/* ---------------- Durée auto (probe) ---------------- */
// Décode juste assez pour connaître la durée réelle du fichier, sans faire l'encodage OGG complet
// (qui n'a lieu qu'à la publication). Permet à la timeline de s'afficher dès qu'un fichier est choisi,
// sans attendre un premier "Publier".
async function probeAudioDuration(file) {
  try {
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuf = await file.arrayBuffer();
    const audioBuf = await actx.decodeAudioData(arrayBuf);
    actx.close();
    return audioBuf.duration;
  } catch (e) {
    console.warn('Impossible de déterminer la durée du fichier :', e);
    return 0;
  }
}
// Recalcule track.duration à partir des couches réellement présentes aujourd'hui (mode Vertical/Statique
// uniquement -- 20/08, correctif). Avant ce correctif, track.duration ne faisait qu'augmenter
// (Math.max(track.duration, nouvelleDurée)) et n'était jamais recalculée à la suppression/au remplacement
// d'une couche -- une couche plus longue supprimée depuis laissait la règle "Entrée/Boucle/Sortie" bien
// plus longue que le morceau réel, avec une grande plage "Queue / outro" fantôme à la fin.
// Limite assumée, à documenter honnêtement : les couches déjà publiées AVANT ce correctif n'ont pas de
// `duration` stockée (champ nouveau) -- tant qu'aucune de leurs couches n'a été retouchée depuis, on ne
// dispose d'aucune valeur fiable à recalculer, et track.duration reste donc inchangée plutôt que d'être
// remise à zéro à tort (ce qui ferait disparaître la règle). Dès qu'au moins une couche a une duration
// connue, elle devient la nouvelle source de vérité, remplaçant l'ancienne valeur accumulée.
function recomputeTrackDuration(track) {
  if (!track.layers || !track.layers.length) return;
  const known = track.layers.map(l => l.duration || 0).filter(d => d > 0);
  if (!known.length) return; // aucune couche avec une durée connue -- on ne touche à rien, cf. commentaire ci-dessus
  track.duration = Math.max(...known);
}

