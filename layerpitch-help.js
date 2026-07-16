// LAYERPITCH_HELP — dictionnaire des bulles d'aide contextuelle du backstage.
// Séparé de layerpitch-i18n.js volontairement : ce fichier contient du contenu pédagogique
// (explique CE QUE FAIT un contrôle et POURQUOI), pas la traduction de l'interface.
//
// Édité via l'outil dédié (layerpitch-help-editor.html), jamais à la main directement.
// Chargé uniquement par layerpitch-backstage.html — jamais publié sur les pages publiques.
//
// Structure : une zone par section du backstage (une seule pour l'instant : "library", la
// bibliothèque/l'éditeur de morceaux). D'autres zones (packs, appearance, github...) viendront
// s'ajouter au fil des prochaines sessions. Chaque clé correspond à un attribut data-help="clé"
// posé sur un contrôle du backstage.
window.LAYERPITCH_HELP = {
  fr: {
    library: {
      trackMode: "Détermine comment ce morceau réagit à l'écoute : Statique pour une piste simple, Layering vertical pour des couches qui s'ajoutent selon l'intensité, Layering vertical randomisé pour une variation aléatoire à chaque écoute, Séquentiel pour un enchaînement intro / segments / outro.",
      loopableStatic: "Coche si ce morceau statique doit boucler en continu (ambiance). Décoché, il joue une fois puis s'arrête — adapté à un thème ou un générique.",
      bpmMeasuresVerticalRandom: "Le tempo et la mesure de ce morceau, utilisés pour caler la grille de la boucle. Nécessaires ici car ce mode tire des couches aléatoires qui doivent rester synchronisées au rythme.",
      loopPointsVerticalRandom: "Ces repères définissent où la boucle commence et se termine dans le fichier. Toutes les couches (fixe et alternatives) doivent avoir exactement la même durée pour rester synchronisées.",
      defaultLoopCount: "Nombre de fois que la boucle joue par défaut à l'ouverture de la page publique. Le visiteur pourra changer cette valeur lui-même — ce n'est qu'un point de départ.",
      bpmMeasuresSequential: "Le tempo et la mesure de ce morceau. Ils déterminent la durée programmée (en mesures) de l'intro et de chaque segment — voir plus bas.",
      avoidRepeatSequential: "Empêche le même segment d'être tiré deux fois de suite au hasard — évite une répétition trop proche et perceptible.",
      loopEngine: "Simple coupe et relance le fichier instantanément à chaque boucle (parfait pour une boucle déjà parfaitement calée). Quantifié permet une transition plus douce, calée sur le tempo, avec une queue sonore qui continue pendant que la boucle suivante démarre déjà.",
      bpmMeasuresQuantized: "Le tempo et la mesure de ce morceau, nécessaires pour caler la boucle quantifiée sur la grille rythmique plutôt que de couper au sample près.",
      loopPointsQuantized: "Ces repères définissent l'intro (jouée une fois), la boucle, et la queue de fin qui se superpose au redémarrage de la boucle suivante.",
      trackDescription: "Texte affiché sur la page publique sous ce morceau, visible quand le visiteur déplie la piste. Sélectionne du texte puis Cmd+K pour y insérer un lien.",
      normalizeVolume: "Corrige automatiquement les écarts de volume entre les fichiers de ce morceau à la conversion (mesure RMS). Utile si tes couches ou alternatives viennent de sessions différentes et sonnent à des niveaux inégaux.",
      fixedLayers: "Les couches qui jouent à chaque cycle de boucle, sans exception — c'est ici que vit l'intro et le cœur rythmique du morceau. Elles doivent toutes faire la même durée que les groupes aléatoires ci-dessous.",
      randomGroups: "Chaque groupe tire au hasard une de ses alternatives à chaque cycle de boucle — c'est ce qui donne l'impression que le morceau ne sonne jamais exactement pareil deux fois. Un groupe peut n'avoir qu'une seule alternative si tu veux juste réserver l'emplacement pour plus tard.",
      batchDropSequential: "Dépose plusieurs fichiers d'un coup : leur rôle (intro / segment / outro) est deviné depuis leur nom de fichier. Vérifie ensuite avec le sélecteur \"Rôle\" de chaque bloc, et corrige si besoin.",
      introSection: "Joue une seule fois, au tout début du morceau, avant que le tirage aléatoire des segments ne démarre.",
      segmentsSection: "Piochés au hasard en boucle entre l'intro et l'outro — c'est le cœur de la partie qui ne sonne jamais deux fois pareil. Il en faut au moins un pour que le morceau soit jouable.",
      outroSection: "Ne se déclenche que si le visiteur clique sur \"Aller vers la fin\" côté public. Sans outro définie, ce bouton laisse simplement le segment en cours filer jusqu'à sa fin naturelle.",
      layersVertical: "Les couches de ce morceau, de la plus calme à la plus intense — c'est cet ordre qui détermine ce qui s'ajoute quand le visiteur augmente l'intensité sur la page publique.",
      stingers: "Sons courts que le visiteur peut déclencher à la main pendant la lecture (ex. un impact, un sting d'alerte), en plus de la musique en cours — n'affectent pas la boucle principale.",
    },
  },
  en: {
    library: {
      trackMode: "Determines how this track behaves for the listener: Static for a single track, Vertical layering for layers that build up with intensity, Randomized vertical layering for variation on every listen, Sequential for an intro / segments / outro flow.",
      loopableStatic: "Check if this static track should loop continuously (ambience). Unchecked, it plays once and stops — suited to a theme or credits.",
      bpmMeasuresVerticalRandom: "This track's tempo and time signature, used to set the loop grid. Required here because this mode draws random layers that must stay synced to the beat.",
      loopPointsVerticalRandom: "These markers define where the loop starts and ends in the file. All layers (fixed and alternatives) must have exactly the same duration to stay in sync.",
      defaultLoopCount: "How many times the loop plays by default when the public page opens. Visitors can change this themselves — it's only a starting point.",
      bpmMeasuresSequential: "This track's tempo and time signature. They determine the planned length (in bars) of the intro and each segment — see below.",
      avoidRepeatSequential: "Prevents the same segment from being drawn twice in a row at random — avoids a repetition that would feel too close together.",
      loopEngine: "Simple cuts and restarts the file instantly on every loop (fine for a loop that's already perfectly seamless). Quantized allows a smoother, tempo-locked transition, with a sound tail that keeps ringing while the next loop has already started.",
      bpmMeasuresQuantized: "This track's tempo and time signature, needed to align the quantized loop to the rhythmic grid instead of cutting at an arbitrary sample.",
      loopPointsQuantized: "These markers define the intro (played once), the loop, and the tail that overlaps as the next loop starts.",
      trackDescription: "Text shown on the public page under this track, visible when the visitor expands it. Select text then Cmd+K to insert a link.",
      normalizeVolume: "Automatically corrects volume differences between this track's files at conversion time (RMS measurement). Useful if your layers or alternatives come from different sessions and play back at uneven levels.",
      fixedLayers: "The layers that play on every loop cycle, without exception — this is where the intro and rhythmic backbone of the track live. They must all have the same duration as the random groups below.",
      randomGroups: "Each group randomly draws one of its alternatives on every loop cycle — this is what makes the track never sound exactly the same twice. A group can have just one alternative if you simply want to reserve the slot for later.",
      batchDropSequential: "Drop several files at once: their role (intro / segment / outro) is guessed from the filename. Double-check with each block's \"Role\" selector afterwards, and fix it if needed.",
      introSection: "Plays once, right at the start of the track, before the random segment draw begins.",
      segmentsSection: "Randomly drawn in a loop between the intro and the outro — this is the part that never sounds the same twice. At least one is needed for the track to be playable.",
      outroSection: "Only triggers if the visitor clicks \"Go to ending\" on the public side. Without an outro set, this button simply lets the current segment run to its natural end.",
      layersVertical: "This track's layers, from calmest to most intense — this order determines what gets added as the visitor increases the intensity on the public page.",
      stingers: "Short sounds the visitor can trigger manually during playback (e.g. a hit, an alert sting), layered on top of the ongoing music — they don't affect the main loop.",
    },
  },
};
