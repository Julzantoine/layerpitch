# LAYERPITCH — MOTEUR AUDIO / MODES DE LECTURE
*Extrait de `MASTER.md` le 28 juillet 2026 lors de la restructuration en fichiers spécialisés. Contenu inchangé sur le fond, réorganisé uniquement.*

## Modes de lecture — état

- **Static** ✅ — fichier unique, bouclable ou non, stingers déclenchables.
- **Vertical** ✅ — couches empilées, curseur d'intensité manipulable, compteurs de mesure live. Curseur visible uniquement en vue dépliée.
- **Vertical-random (V2)** ✅ — variantes piochées aléatoirement par couche à chaque itération, `avoidImmediateRepeat`, slots silencieux possibles, visualisation façon Wwise Voice Graph.
- **Séquentiel (V3)** ✅ — intro/segment/outro, scheduler quantifié au BPM avec chevauchement crossfade-tail, anti-répétition, bouton "Aller vers la fin".
  **Retour bêta (27 juillet, contact ThinkSpace)** : l'intro de la démo est trop longue avant que l'interactivité ne devienne perceptible — retour jugé fondé, à corriger (raccourcir l'intro du mode séquentiel dans l'AdReel de démo).
- **Embranchement-vertical** 🟡 (livré 31 juillet, non publié) — nouveau mode : N boucles nommées et autonomes, calées sur le même BPM/mesures, jouant simultanément en arrière-plan (silencieuses sauf celle active). Le visiteur bascule entre elles par clic sur un bouton nommé — rampe de gain courte (0.15s), réutilise exactement le mécanisme du solo/muet existant, pas d'attente de quantification. La boucle marquée `isInitial` sert de référence : les boucles de même longueur qu'elle tournent en continu en arrière-plan et peuvent être gardées indéfiniment ; une boucle plus courte est un détour ponctuel (lecture unique, bouton désactivé le temps du détour, retour automatique à la référence). Réutilise `blockSeconds()` du scheduler séquentiel, aucun moteur parallèle dupliqué.
- **`nextOptions` sur le mode séquentiel** 🟡 (livré 31 juillet, étendu le 02 août, non publié) — pas un mode à part : une option facultative par emplacement (`segmentSlots[].nextOptions`) du mode `sequential` existant, rétrocompatible (absence du champ = comportement strictement inchangé). Quand elle est définie, l'emplacement affiche des boutons nommés et attend un choix explicite du visiteur — plus aucun avancement automatique pour un tel emplacement, `repeatCount` n'a plus de sens ici (il se rejoue à l'identique tant qu'aucun choix n'est fait). Dernier clic gagne, indicateur "en attente de bascule" affiché.
  **Coupure fine (02 août, à la manière de Wwise)** : deux réglages par emplacement pilotent la bascule choisie — `quantization` (`immediate`/`beat`/`bar`, défaut `bar`) détermine QUAND elle prend effet, y compris en coupant l'emplacement source EN PLEIN MILIEU de sa lecture plutôt que d'attendre sa fin nominale (le scheduler surveille en continu la prochaine frontière temps/mesure tant qu'aucun choix n'a été fait, se réarme frontière après frontière) ; `cutStyle` (`hard`/`fade` 0.15s, défaut `fade`) détermine COMMENT l'emplacement source se termine à cet instant (coupure nette façon Wwise, ou fondu court pour éviter un clic numérique). Une répétition déjà programmée à l'avance par le scheduler (fenêtre de 1s) mais pas encore audible est annulée si la coupure survient avant.
  **Fichier de transition (02 août)** : optionnel, propre à CHAQUE embranchement précis (paire source→cible, pas à l'emplacement dans son ensemble — un même emplacement peut avoir un fichier de transition différent par destination, comme autant de Transition Objects Wwise). Joué juste après la coupure, puis enchaînement normal vers la cible par chevauchement crossfade-tail classique (même mécanisme que le reste du mode séquentiel, aucun moteur dupliqué). Sans fichier déclaré pour l'embranchement choisi : bascule directe vers la cible, au même point de quantification.
  Objectif produit explicite : que le compositeur n'ait pas à retoucher ses fichiers entre LayerPitch et Wwise — le modèle (transition par paire précise, quantification par emplacement) suit celui de Wwise plutôt que d'en inventer un autre.
  *Envisagé un temps comme un mode `embranchement-séquentiel` séparé, abandonné en cours de route au profit de cette option — plus cohérent avec la discipline de réutilisation maximale, la différence n'étant qu'un comportement local sur certains emplacements, pas un moteur différent.*
  Testé automatiquement (9 suites, dont 2 nouvelles dédiées à ces deux chantiers) ; pas encore validé à l'oreille ni publié — voir `LAYERPITCH_CHANGELOG.md`.

## Éditeur de points de boucle

Timeline avec grille beat/mesure, trois poignées glissables (StartTrackPoint, StartLoopPoint, ExitLoopPoint) — chantier volontairement reporté, voir "Prochaine étape" dans `MASTER.md`.

## Extensions de nomenclature envisagées (non codées)

Voir `extensions-roadmap.md`, section 0 — *vertical additif randomisé* et *vertical additif séquentiel* comme extensions hybrides de la famille "vertical", renommage cosmétique du V1 en "vertical additif" pour libérer le terme "vertical" pour toute une famille de modes.
