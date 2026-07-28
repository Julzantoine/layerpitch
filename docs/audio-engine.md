# LAYERPITCH — MOTEUR AUDIO / MODES DE LECTURE
*Extrait de `MASTER.md` le 28 juillet 2026 lors de la restructuration en fichiers spécialisés. Contenu inchangé sur le fond, réorganisé uniquement.*

## Modes de lecture — état

- **Static** ✅ — fichier unique, bouclable ou non, stingers déclenchables.
- **Vertical** ✅ — couches empilées, curseur d'intensité manipulable, compteurs de mesure live. Curseur visible uniquement en vue dépliée.
- **Vertical-random (V2)** ✅ — variantes piochées aléatoirement par couche à chaque itération, `avoidImmediateRepeat`, slots silencieux possibles, visualisation façon Wwise Voice Graph.
- **Séquentiel (V3)** ✅ — intro/segment/outro, scheduler quantifié au BPM avec chevauchement crossfade-tail, anti-répétition, bouton "Aller vers la fin".
  **Retour bêta (27 juillet, contact ThinkSpace)** : l'intro de la démo est trop longue avant que l'interactivité ne devienne perceptible — retour jugé fondé, à corriger (raccourcir l'intro du mode séquentiel dans l'AdReel de démo).
- **Branchement quantifié (V4)** — idée gardée au chaud, non commencé, bénéficie du socle BPM/signature déjà posé.

## Éditeur de points de boucle

Timeline avec grille beat/mesure, trois poignées glissables (StartTrackPoint, StartLoopPoint, ExitLoopPoint) — chantier volontairement reporté, voir "Prochaine étape" dans `MASTER.md`.

## Extensions de nomenclature envisagées (non codées)

Voir `extensions-roadmap.md`, section 0 — *vertical additif randomisé* et *vertical additif séquentiel* comme extensions hybrides de la famille "vertical", renommage cosmétique du V1 en "vertical additif" pour libérer le terme "vertical" pour toute une famille de modes.
