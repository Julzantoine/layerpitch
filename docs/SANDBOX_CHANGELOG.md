# LayerPitch Sandbox — Changelog

## 2026-08-01 — Échafaudage initial

- Création de l'arborescence du projet (`src/main`, `src/preload`, `src/renderer`).
- `package.json` : dépendances Electron + electron-builder, JSZip en dépendance (utilisation prévue au
  chantier persistance), configuration de build Mac (dmg) et Windows (nsis).
- `src/main/main.js` : fenêtre principale unique, `contextIsolation: true` / `nodeIntegration: false`,
  chargement du preload.
- `src/main/menu.js` : menu applicatif (Fichier / Édition / Affichage), relaie les intentions au
  renderer via `webContents.send('menu-action', ...)` — ne déclenche aucune opération disque directement.
- `src/main/ipcHandlers.js` : canaux IPC enregistrés (dialogues de fichiers natifs opérationnels ;
  `project:load`, `project:save`, `project:import-audio-file` câblés vers `projectStore.js` mais non
  implémentés — lèvent une erreur explicite "pas encore implémenté").
- `src/main/projectStore.js` : signatures posées pour la persistance (`.lpsandbox`, dossier brouillon,
  autosave) — implémentation au prochain chantier.
- `src/preload/preload.js` : surface `window.layerpitchSandbox` exposée via `contextBridge`, restreinte
  aux actions validées (dialogues, projet, écoute des actions du menu).
- `src/renderer/vendor/` : copie telle quelle de `player.js` et `layerpitch-i18n.js` depuis le repo
  `layerpitch` — jamais modifiés ici.
- `src/renderer/index.html`, `styles.css`, `state.js`, `app.js` : squelette de mise en page (barre
  latérale repliable + zone principale), store pub/sub vanilla JS, bootstrap minimal. Liste des
  morceaux, éditeur par mode et lecteur de test non implémentés à ce stade.

**Hors scope confirmé pour ce chantier** : tout export `.layerpitch`, tout bouton de publication vers
le web, packs/AdReels/apparence/témoignages, conversion OGG.

**Prochain chantier** : implémentation de `projectStore.js` (structure de l'archive `.lpsandbox`,
dossier brouillon permanent, autosave à la Logic Pro), puis liste des morceaux dans la barre latérale et
formulaire d'ajout d'un premier morceau (glisser-déposer WAV/MP3).

## 2026-08-01 — Persistance : format .lpsandbox, dossier brouillon, autosave

- `src/main/projectStore.js` : implémentation complète (remplace les signatures posées à l'étape
  précédente).
  - `copyAudioFileIntoDraft` / `readAudioBytes` : chaque fichier audio déposé est copié une fois dans le
    dossier brouillon (`userData/draft/audio/<fileId>.<ext>`), sous un nom stable indépendant du nom
    d'origine ; lu à la demande, jamais chargé en bloc.
  - `saveProject` : construit le zip `.lpsandbox` (`project.json` + `audio/`) via JSZip, l'écrit sur
    disque, puis vide le dossier brouillon **et** l'autosave (les deux filets de sécurité n'ont plus
    lieu d'être une fois la sauvegarde réussie).
  - `loadProject` : extrait le zip, réinstalle son audio dans le dossier brouillon (qui redevient la
    copie de travail courante), retourne `{ name, tracks, version }`.
  - `writeAutosaveSnapshot` / `hasRecoverableAutosave` / `discardAutosave` : instantané JSON périodique
    dans `userData/autosave/snapshot.json`, référence les fileId déjà présents dans le dossier brouillon
    (aucune duplication d'audio).
- `src/main/ipcHandlers.js` : ajout des canaux `project:read-audio-bytes`, `project:write-autosave`,
  `project:discard-autosave`.
- `src/main/main.js` : au lancement, si une autosave récupérable est détectée, affiche une boîte de
  dialogue native ("Récupérer" / "Ignorer") avant d'afficher la fenêtre — jamais de récupération
  silencieuse, conformément au choix acté. La fenêtre reste cachée (`show: false`) le temps de cette
  vérification pour éviter un flash d'interface vide.
- `src/preload/preload.js` : ajout de `project.readAudioBytes` (convertit le Buffer reçu par IPC en
  ArrayBuffer, prêt pour le contrat `item.localFile.arrayBuffer()` de `player.js`),
  `project.writeAutosave`, `project.discardAutosave`, `recovery.onAutosaveRecovered`.
- `src/renderer/app.js` : câblage de bout en bout des actions "Ouvrir"/"Enregistrer"/"Enregistrer
  sous"/"Nouveau projet" du menu vers `project.load`/`project.save` ; autosave déclenché toutes les 2
  minutes (ignoré si le projet n'a aucun morceau) ; écoute de `recovery.onAutosaveRecovered` pour
  recharger un instantané récupéré dans le store.
- **Testé de bout en bout** (script Node avec un stub minimal du module `electron`, hors ce dépôt) :
  copie audio → sauvegarde → dossier brouillon vidé → rechargement → audio ré-extrait avec le contenu
  correct → écriture/détection/nettoyage de l'autosave. Tous les cas passent.

**Décision d'implémentation non explicitement validée en discussion, à confirmer** : le dossier
brouillon se vide à **chaque** sauvegarde manuelle réussie (pas seulement la toute première), pour rester
cohérent avec le principe déjà acté ("qui peut le plus peut le moins") — après une sauvegarde, le
`.lpsandbox` fait foi, plus besoin du filet de sécurité jusqu'à la prochaine modification.

**Prochain chantier** : liste des morceaux dans la barre latérale (lecture/affichage de
`project.tracks`), glisser-déposer d'un premier fichier audio, puis formulaire de configuration par mode
(`editor/modes/*.js`).

## 2026-08-01 — Éditeur de morceaux complet (liste, formulaires par mode, glisser-déposer, lecteur de test)

Le bac à sable est maintenant fonctionnel de bout en bout : créer un morceau, choisir son mode, le
configurer, glisser-déposer de l'audio, tester la lecture en direct.

- **`src/preload/preload.js`** : ajout de `files.getPathForFile` (via `webUtils`, nécessite Electron ≥
  32 — contrainte relevée dans `package.json`) pour retrouver le chemin disque d'un fichier glissé-déposé
  depuis le Finder/Explorateur.
- **`src/renderer/editor/uiHelpers.js`** : constructeurs DOM minimalistes (`el`, `field`, `textInput`,
  `numberInput`, `checkboxInput`, `selectInput`, `maxChainLoopsSelect`, `listEditor`). Les champs
  texte/nombre écoutent `change` (pas `input`) : l'éditeur se re-rend entièrement à chaque modification,
  écouter chaque frappe ferait perdre le focus.
- **`src/renderer/editor/dragDrop.js`** : glisser-déposer générique WAV/MP3 sur une zone, appelle
  `project.importAudioFile` pour chaque fichier accepté.
- **`src/renderer/editor/audioSlot.js`** : widget réutilisable "dépose un fichier audio ici", partagé par
  tous les modes pour chaque emplacement porteur de son (couche, alternative, boucle, intro/outro).
- **`src/renderer/editor/playback.js`** : `resolveTrackForPlayback` — parcours générique de l'arbre du
  morceau qui convertit chaque `audioRef` (fileId) en `localFile` (`{ arrayBuffer() }`), pour confier le
  résultat tel quel à `player.js`. Générique par construction : un nouveau champ porteur de son dans un
  mode existant, ou un nouveau mode, n'a rien à changer ici.
- **`src/renderer/editor/modes/*.js`** : un module par mode, chacun avec `createDefault(id)` et
  `render(track, notifyChange)`, auto-enregistré dans `window.LayerPitchSandboxModes` :
  - `static.js` : couches jouées ensemble, option `loopable`.
  - `vertical.js` : couches d'intensité, `loopEngine` classique ou quantifié (BPM + points de boucle en
    temps — **simplification assumée** : champs numériques, pas de timeline visuelle glissable comme
    dans le backstage web).
  - `verticalRandom.js` : sections (BPM/mesures/points de boucle/nombre de boucles max propres à chacune)
    contenant des pools de couches tirées aléatoirement, intro/outro optionnelles, `maxChainLoops`.
  - `sequential.js` : emplacements (`segmentSlots`) avec alternatives (durée en mesures), embranchements
    (`nextOptions`, ciblage par sélecteur vers un autre emplacement), intro/outro, BPM/mesures,
    `maxChainLoops`.
  - `embranchementVertical.js` : boucles nommées avec désignation de la boucle de référence (bouton
    radio, une seule à la fois), durée en mesures, BPM/mesures.
- **`src/renderer/editor/trackList.js`** : rendu de la barre latérale (sélection, duplication,
  suppression).
- **`src/renderer/editor/trackEditor.js`** : titre + sélecteur de mode (change de mode = nouveau squelette
  de champs via `createDefault`, titre préservé) + champs du mode + bouton "Tester ce morceau" qui
  résout l'audio et instancie `buildTrackRow`/`initTrackPlayer` en direct dans la zone principale.
- **`src/renderer/app.js`** : `renderApp` central (liste + éditeur), bouton "+ Nouveau morceau" (créé en
  mode statique par défaut, le mode se change ensuite dans l'éditeur), câblage complet
  Ouvrir/Enregistrer/Enregistrer sous/Nouveau projet, autosave, récupération.
- **`src/renderer/index.html`**, **`styles.css`** : ordre de chargement des scripts, styles pour la
  liste de morceaux, les formulaires (champs, listes éditables, emplacements optionnels), les zones de
  glisser-déposer et le lecteur de test.
- **Testé de bout en bout** (script de fumée jsdom avec mock du contextBridge, hors ce dépôt, supprimé
  après vérification) : les 5 modes s'enregistrent, ajout de morceau, changement de mode, ajout
  d'emplacement/alternative dans les listes, résolution `audioRef → localFile`, chargement réel du
  lecteur et démarrage effectif de la lecture via `player.js`. Tous les cas passent.

**Limitations connues, assumées pour cette étape** :
- Édition d'un champ texte/nombre = re-rendu complet du formulaire à la perte du focus (pas de
  perte de focus pendant la frappe elle-même, mais l'expérience reste un peu rustique sur de longues
  sessions d'édition).
- Mode vertical quantifié : points de boucle en valeur numérique de temps, pas de timeline visuelle.
- "Nouveau projet" remplace le projet en cours sans avertissement si des modifications sont en attente
  (pas de garde-fou "modifications non sauvegardées" pour l'instant).
- Pas de réordonnancement par glisser-déposer des couches/alternatives/emplacements (ordre = ordre
  d'ajout, suppression puis réajout possible en attendant).

**Prochain chantier suggéré** : garde-fou "modifications non sauvegardées" avant Nouveau
projet/Ouvrir/Quitter ; réordonnancement des listes ; timeline visuelle pour le mode vertical quantifié.

## 2026-08-01 — Débogage, optimisation, nettoyage

Revue systématique de tout le code (hors `vendor/`, jamais modifié). Six bugs réels identifiés et
corrigés, plus optimisations et nettoyage de duplication.

**Bugs corrigés :**

- **`editor/modes/verticalRandom.js`** : les listes "Sections" et "Pools" ignoraient le paramètre
  `removeBtn` fourni par `listEditor` — impossible de supprimer une section ou un pool une fois ajouté
  (seul le bouton "+" fonctionnait). Corrigé sur les deux listes.
- **`editor/trackEditor.js`** : le lecteur de test s'arrêtait à la moindre modification d'un champ
  (n'importe lequel, même sur un autre emplacement) — `renderTrackEditor` reconstruisait tout
  inconditionnellement à chaque rendu, y compris la zone du lecteur. Le lecteur ne se réinitialise
  maintenant que lorsque le morceau affiché change réellement (comparaison par identité d'objet, pas par
  id — un changement de mode remplace l'objet sous le même id et doit bien réinitialiser le lecteur,
  contrairement à une simple modification de champ qui mute l'objet en place).
- **`editor/trackEditor.js` + `app.js`** : supprimer le morceau actuellement en cours de test (sans
  qu'un autre morceau ne devienne sélectionné ensuite) laissait sa lecture Web Audio tourner
  indéfiniment en arrière-plan — le DOM était vidé directement dans `app.js` sans jamais appeler
  `stopActivePlayer()`. `stopActivePlayer` est maintenant exposé par `trackEditor.js` et appelé
  explicitement par `app.js` dans ce cas.
- **`src/main/projectStore.js`** (`saveProject`) : le fichier `.lpsandbox` exporté embarquait TOUS les
  fichiers du dossier brouillon, y compris l'audio orphelin (fichiers remplacés ou retirés d'un
  emplacement mais jamais supprimés du disque). Ne zippe désormais que l'audio réellement référencé par
  au moins un `audioRef` du projet (parcours récursif générique du JSON, comme `resolveTrackForPlayback`
  côté renderer).
- **`app.js`** : "Nouveau projet" ne vidait jamais le dossier brouillon — `projectStore.clearDraft`
  existait déjà mais n'était jamais exposé via IPC. Canal `project:clear-draft` ajouté
  (`ipcHandlers.js` + `preload.js`), appelé explicitement sur "Nouveau projet".
- **`app.js`** : "Nouveau projet" et "Ouvrir un projet" remplaçaient le projet en cours sans avertissement,
  même avec des modifications non sauvegardées (perte silencieuse). Un `window.confirm` bloque
  désormais ces deux actions si `project.dirty` est vrai.

**Optimisations :**

- **`src/main/projectStore.js`** (`findDraftAudioPath`) : utilisait `fs.readdirSync` (synchrone,
  bloquant) dans une fonction par ailleurs entièrement asynchrone — bloquait la boucle d'événements du
  processus principal à chaque lecture audio. Passé en asynchrone (`fsp.readdir`).
- **`editor/dragDrop.js`** : plusieurs fichiers glissés-déposés d'un coup étaient importés un par un
  (`for...of` + `await` séquentiel) — chaque import est un aller-retour IPC + copie disque indépendant
  des autres, désormais lancés en parallèle (`Promise.all`).

**Nettoyage :**

- Nouveau module **`editor/optionalAudioField.js`** : factorise le widget "emplacement audio optionnel"
  (bouton Ajouter / zone de dépôt / bouton Retirer), jusqu'ici dupliqué avec de légères incohérences
  entre `sequential.js` et `verticalRandom.js` (ce dernier avait sa propre fonction locale
  `renderOptionalSlot`, à la grammaire de libellé plus fragile). Les deux modes utilisent maintenant la
  même implémentation.
- `src/main/projectStore.js` (`saveProject`) : retrait d'une vérification `fs.existsSync` redondante
  juste après `ensureDir` (le dossier vient d'être créé, la vérification était toujours vraie).
- `editor/uiHelpers.js` (`textInput`) : retrait d'une réassignation de `input.value` redondante avec
  celle déjà faite par `el()`.
- `app.js` : la bascule de la barre latérale était dupliquée (une fois pour le clic du bouton, une fois
  pour l'action de menu) — factorisée en une seule fonction `toggleSidebar()`.

**Testé** : script de fumée dédié aux six bugs ci-dessus (suppression section/pool, persistance du
lecteur à travers une modification de champ, réinitialisation correcte du lecteur sur changement de
mode, arrêt du lecteur sur suppression du morceau testé) + test fonctionnel dédié à `projectStore.js`
(filtrage des fichiers orphelins à la sauvegarde, `findDraftAudioPath` asynchrone) + suite de
non-régression complète (5 modes, embranchement séquentiel). Tous les cas passent.

## 2026-08-05 — Corrections d'interface (retour terrain sur un test réel)

Trois problèmes remontés en testant l'appli réelle (pas seulement en simulation jsdom) : icônes du
lecteur de test énormes/cassées, libellés d'embranchement incompréhensibles, point de départ manquant en
mode vertical quantifié.

- **Cause racine des icônes cassées** : le bac à sable n'a jamais chargé la feuille de style qui habille
  la sortie de `buildTrackRow`/`initTrackPlayer` (classes `.loop-icon`, `.play-btn`, `.seq-block`,
  `.voice-graph`, etc.) — seuls les styles propres à l'éditeur du bac à sable étaient chargés. Sans
  dimensionnement CSS, les SVG (dont l'icône de boucle, un chemin en forme de flèche) s'affichaient à
  leur taille intrinsèque, énorme, et les icônes de chargement à leur taille par défaut ressemblaient à
  des glyphes cassés.
  - Nouveau fichier **`vendor/player.css`** : extrait tel quel du bloc `<style>` de
    `layerpitch-backstage.html` (la vraie feuille de style qui habille ces mêmes classes côté backstage
    web) — mêmes règles, mêmes couleurs. Variables scopées sous `.player-host` plutôt que `:root`, pour
    ne jamais interférer avec le thème sombre du reste de l'éditeur : le lecteur de test apparaît donc
    comme une carte claire fidèle au rendu backstage, dans un éditeur par ailleurs sombre.
  - **Deux classes sans équivalent identifié dans le backstage fourni** : `.seq-branch-btn` (boutons
    d'embranchement séquentiel) et `.embr-loop-btn` (boutons de boucle nommée) — habillées à la main,
    dans le même esprit que `.intensity-chip` déjà présent. À ajuster si le vrai backstage les traite
    autrement ; je n'ai pas trouvé de règle correspondante dans le fichier fourni.
  - Chargé dans `index.html` juste après `styles.css`.
- **`editor/modes/sequential.js`** : le menu déroulant "Vers" d'un embranchement affichait l'id technique
  du slot cible (`slot_wx9mf36`) au lieu d'un nom lisible quand aucun nom n'avait été saisi. Retombe
  maintenant sur "Emplacement N" (même convention que le placeholder du champ Nom), calculé sur la
  position réelle du slot dans `track.segmentSlots`.
- **`editor/modes/vertical.js`** : le point de départ (`startTrackBeat` — utilisé par le moteur pour
  sauter un silence en tête, distinct des points de boucle) n'était pas exposé dans le formulaire du mode
  quantifié, alors que le moteur le lit bel et bien. Ajouté comme troisième champ, à côté des points de
  boucle début/fin déjà présents — les trois se saisissent à la main (numériques), pas via une timeline
  visuelle, conformément à la préférence exprimée.

**Testé** : script de fumée dédié (libellé "Emplacement N" affiché dans le menu "Vers", présence des 3
champs de point de boucle en mode vertical quantifié, présence effective de `vendor/player.css` et de la
règle qui corrige spécifiquement l'icône de boucle géante). Tous les cas passent. Le rendu visuel réel
(couleurs, tailles à l'écran) reste à confirmer par Jules-Antoine en conditions réelles — un test jsdom
ne peut pas vérifier qu'une feuille de style "a l'air juste" visuellement, seulement qu'elle est bien
chargée et contient les bonnes règles.

## 2026-08-01 — Lanceurs double-clic (Mac + Windows)

- `Lancer LayerPitch Sandbox (Mac).command` : script bash exécutable (`chmod +x`), installe les
  dépendances au premier lancement si `node_modules` est absent, puis `npm start`. Double-clic depuis le
  Finder.
- `Lancer LayerPitch Sandbox (Windows).bat` : équivalent pour Windows, même logique.
- Pas d'empaquetage `electron-builder` (`.app`/`.exe` autonome) à ce stade — ces lanceurs supposent
  Node.js déjà installé sur la machine. Un vrai empaquetage (icône, `.dmg`/`.exe` installables sans
  dépendance externe) reste possible plus tard via `npm run dist`, déjà configuré dans `package.json`,
  si le besoin d'une distribution plus "finie" se fait sentir.
- **Mac uniquement** : au tout premier double-clic, macOS peut afficher un avertissement "développeur non
  identifié" (Gatekeeper, le script n'est pas signé). Clic droit → Ouvrir la première fois contourne ça
  définitivement pour ce fichier.

### Correctif — Node.js introuvable au double-clic

Retour terrain (1er août) : `npm: command not found` au premier lancement sur Mac, alors que la
correction sous-jacente pouvait être soit "Node.js pas installé du tout", soit "installé mais introuvable
depuis un double-clic" (un double-clic ne charge pas le même profil shell qu'une commande tapée à la
main dans le Terminal — Homebrew/nvm y ajoutent le chemin de Node, un `.command` lancé par double-clic ne
le voit pas forcément).

- Les deux lanceurs cherchent maintenant explicitement `npm` aux emplacements usuels (Homebrew, nvm côté
  Mac) avant d'abandonner, et affichent un message clair pointant vers https://nodejs.org si Node.js est
  réellement absent — au lieu du message technique `command not found`.
- La fenêtre reste maintenant ouverte après une erreur (ou après la fermeture normale de l'appli) via une
  invite "Appuie sur Entrée pour fermer" — jusqu'ici, les préférences de Terminal.app pouvaient fermer la
  fenêtre trop vite pour lire le message.

## 2026-08-01 — Mise à jour de vendor/player.js (embranchement séquentiel avec transitions)

- `src/renderer/vendor/player.js` remplacé par la version fournie par Jules-Antoine (moteur mis à jour
  côté repo `layerpitch` principal). Changement fonctionnel réel identifié par diff ligne à ligne (hors
  commentaires) : le système d'embranchement séquentiel (`nextOptions`) passe d'un avancement immédiat
  et non quantifié (`advanceFromSlot`, supprimée) à un système de coupure fine avec trois nouveaux
  réglages par embranchement — `quantization` ('immediate' / 'beat' / 'bar', défaut 'bar'), `cutStyle`
  sur l'emplacement source ('hard' / 'fade', défaut 'fade'), et `transition` (fichier audio optionnel
  joué entre la coupure et la cible). Nouvelles fonctions : `armNextSeqBranchBoundary`,
  `performSeqBranchCut`. Nouveau tableau chargé : `transitionBuffers[slotIdx][optionIdx]`.
- **Correctif appliqué en cours de route** : la première tentative de mise à jour (retranscription
  manuelle du fichier fourni) avait fait perdre par erreur l'essentiel des commentaires explicatifs du
  fichier (487 → 64 lignes de commentaires). Repris en partant de l'ancienne version intacte et en
  n'appliquant que le diff réel identifié — tous les commentaires d'origine préservés, seul le nouveau
  système d'embranchement ajouté.
- Le bac à sable n'expose pas encore `quantization`/`cutStyle`/`transition` dans le formulaire du mode
  séquentiel (`editor/modes/sequential.js`) — un embranchement créé dans le bac à sable retombe donc sur
  les valeurs par défaut du moteur (`bar`/`fade`, pas de transition). Testé explicitement : un morceau
  séquentiel avec `nextOptions` sans ces champs charge et joue sans planter, l'embranchement fonctionne
  au clic. Exposer ces réglages dans l'éditeur est un chantier séparé, non fait ici.
- Testé de bout en bout (script de fumée jsdom, supprimé après vérification) : les 5 modes, ajout de
  morceau, changement de mode, ajout d'emplacements, résolution audio, et spécifiquement un scénario
  d'embranchement séquentiel complet (déclenchement, transition vers la cible) avec le nouveau moteur.
  Tous les cas passent.

## 2026-08-01 — Exposition de quantization/cutStyle/transition dans l'éditeur séquentiel

- `src/renderer/editor/modes/sequential.js` :
  - `createSlot()` : nouveau champ `cutStyle` (défaut `'fade'`).
  - `createNextOption()` : nouveaux champs `quantization` (défaut `'bar'`) et `transition` (défaut `null`).
  - Nouveau champ "Style de coupure" par emplacement (fondu court / coupure nette).
  - Nouveau champ "Déclenchement" par embranchement (immédiat / prochain temps / prochaine mesure).
  - Nouvel emplacement audio optionnel "Fichier de transition" par embranchement, avec sa durée en
    mesures — même widget que l'intro/outro du morceau, généralisé (`renderOptionalAudioField`) pour
    fonctionner sur n'importe quel objet parent (le morceau pour intro/outro, un `nextOption` pour la
    transition) plutôt que dupliqué.
- Aucun changement requis côté `playback.js` : `resolveTrackForPlayback` parcourt déjà l'arbre du morceau
  de façon générique (tout `audioRef` devient un `localFile`, quel que soit l'endroit où il se trouve),
  donc `nextOptions[].transition.audioRef` se résout automatiquement sans code spécifique.
- Testé de bout en bout (script de fumée jsdom, supprimé après vérification) : les nouveaux champs
  s'affichent avec leurs valeurs par défaut correctes, les modifications s'écrivent bien dans le modèle
  de données, et un morceau avec `quantization: 'immediate'` + un fichier de transition charge et joue
  correctement (déclenchement de l'embranchement, passage par la transition, arrivée sur la cible). Tous
  les cas passent.

## 2026-08-05 — Bascule complète vers un port du backstage (remplace l'éditeur maison)

Chantier majeur, décidé en discussion (05/08) : plutôt que de faire converger progressivement mon
éditeur maison vers l'apparence et le comportement du backstage, reprise directe du code source du
backstage pour la partie bibliothèque de morceaux (`renderLibrary()` + sa délégation d'événements +
fonctions support), adapté uniquement là où la persistance diffère (local vs GitHub). Décision cadrée
ainsi par Jules-Antoine : *"le bac à sable est un backstage qui ne se connecterait pas à GitHub mais à
un JSON interne — ça fait tout pareil, sauf que ça ne permet pas (encore) de publier."*

**Ancienne architecture entièrement retirée** : `editor/modes/*.js`, `uiHelpers.js`, `dragDrop.js`,
`audioSlot.js`, `optionalAudioField.js`, `trackList.js`, `trackEditor.js`, `state.js`, `styles.css`,
`vendor/player.css`. Tout ce que ces fichiers faisaient est désormais couvert par le port du backstage
ci-dessous — aucune perte fonctionnelle, mais plus aucune ligne de ces fichiers ne survit.

**Nouveaux fichiers, extraits mécaniquement (`sed`, pas de retranscription manuelle — leçon retenue de
l'incident de fidélité sur `player.js` le 01/08) puis adaptés :**

- **`vendor/backstage.css`** : feuille de style globale du backstage, reprise telle quelle (lignes 9-312
  de `layerpitch-backstage.html`). S'applique désormais à tout l'éditeur, pas seulement au lecteur de
  test comme le faisait l'ancien `player.css` scopé — le bac à sable a maintenant visuellement
  l'apparence du vrai backstage (thème clair, cartes, typographie).
- **`sandbox-shell.css`** : le peu d'habillage propre au bac à sable par-dessus (barre de projet en
  haut, indicateur "modifications non sauvegardées") — jamais de redéfinition des styles de formulaire
  eux-mêmes, qui restent la propriété de `backstage.css`.
- **`editor/library.js`** : fonctions support portées telles quelles — `tr()`/`currentLang()` (zone i18n
  `backstage`, déjà présente dans `vendor/layerpitch-i18n.js`), `escapeAttr`, `genId`, `fileCtrlHtml`,
  `deleteIconBtnHtml`, `sectionEyebrow`, `collapseFooterHtml`, `titleFromFilename`,
  `guessSequentialRole`, `probeAudioDuration`, `buildLoopTimelineEl` (la timeline à 3 repères
  Départ/Entrée boucle/Sortie boucle), `altPoolToggleHtml`/`wireAltPoolToggle`.
- **`editor/libraryRender.js`** : `renderLibrary()` (le gabarit HTML complet par mode) + la délégation
  d'événements (`click`/`input`/`change` sur `#libraryContainer`) — reprises du backstage avec les
  adaptations décrites plus bas. Couvre les 5 modes, la duplication de section/emplacement
  (`referencesSectionId`/`referencesSlotId`), le réordonnancement (`move-*-up`/`move-*-down`), les
  embranchements séquentiels (`hasBranches`, `nextOptions`), tout comme le vrai backstage.

**Adaptations par rapport à la source (toutes documentées en commentaire dans le code) :**

- `remoteFile`/`pendingFile` (distinction backstage "en attente d'upload" / "déjà publié sur GitHub")
  remplacés partout par `audioRef`/`fileName` — un seul état possible dans le bac à sable ("déjà copié
  dans le dossier brouillon local"), l'import IPC étant immédiat au dépôt, sans étape de publication
  séparée.
- `wireFileControl`/`wireBatchDrop` : adaptées pour importer chaque fichier via
  `window.layerpitchSandbox.project.importAudioFile` dès sa sélection/son dépôt (au lieu de le garder en
  mémoire pour un futur "Publier"), en parallèle du sondage de durée (`probeAudioDuration`, décodage
  Web Audio direct sur l'objet `File` glissé-déposé — inchangé).
- `buildPreviewTrack` (mapping manuel par champ pour l'aperçu "Écouter") **non porté** : remplacé par
  `window.LayerPitchSandboxPlayback.resolveTrackForPlayback`, déjà existant côté bac à sable — parcours
  générique de l'arbre du morceau (tout `audioRef` devient un `localFile`), qui couvre nativement
  n'importe quelle forme de morceau sans mapping à maintenir champ par champ.
- Bibliothèque Sfx, Packs, Collections, AdReels, apparence, témoignages, certification "sans IA",
  publication, analytics (`trackBackstageEvent`) : hors scope, stubés en no-op ou simplement absents. Le
  champ `noAiOverride` du formulaire (backstage) n'a pas été porté — sans objet hors publication.
- Mise en page : plus de barre latérale "un morceau sélectionné à la fois" (l'ancienne architecture) —
  adopté le modèle du backstage, une seule page qui liste tous les morceaux du projet, chacun dans sa
  propre carte repliable indépendamment des autres.

**Nouveau champ exposé** : `startTrackBeat` (point de départ, distinct des points de boucle) était déjà
identifié comme manquant le 05/08 — la timeline à 3 repères portée ici le couvre nativement (repère
"Départ"), le résolvant du même coup.

**Testé de bout en bout** (script de fumée jsdom, supprimé après vérification) : ajout de morceau (mode
par défaut vertical, comme le backstage), changement de mode, dépôt en lot sur un morceau séquentiel
(devinette intro/segment par nom de fichier, import IPC effectif), ajout d'un embranchement entre deux
emplacements, lecture réelle via le bouton "Écouter", duplication (même fichier audio référencé, pas
dupliqué sur disque), suppression, et peuplement dynamique de la timeline de points de boucle une fois
la durée d'un fichier connue (les 3 repères apparaissent). Tous les cas passent.

**Non re-testé dans cette passe** (hérité du backstage, code porté à l'identique mais pas
spécifiquement exercé par le script de fumée) : réordonnancement de sections/emplacements/boucles
(`move-*-up`/`move-*-down`), duplication de section/emplacement via `referencesSectionId`/
`referencesSlotId`, repli/dépli des pools d'alternatives (`altPoolToggleHtml`). Logique reprise telle
quelle du backstage, donc a priori fiable, mais à garder à l'œil au premier usage réel.

**Prochain chantier suggéré** : vérifier en conditions réelles que `vendor/backstage.css` rend bien
(le script de fumée ne peut vérifier que la présence des règles, pas le rendu visuel) ; envisager de
porter aussi la bibliothèque Sfx si le besoin s'en fait sentir.

## 2026-08-05 — Réintroduction de la barre latérale (navigation rapide, pas édition isolée)

Demande de Jules-Antoine après la bascule vers le port du backstage : garder la barre latérale, mais pas
sous son ancienne forme ("un morceau sélectionné, édité seul") — plutôt une navigation rapide vers les
morceaux de la longue liste à une seule colonne.

- **`editor/sidebar.js`** (nouveau) : liste chaque morceau du projet (titre + repère de mode). Cliquer une
  entrée déplie la carte correspondante si elle était repliée (en redéclenchant le vrai bouton de
  dépli/repli déjà branché sur la délégation d'événements existante, plutôt qu'en dupliquant cette
  logique) puis fait défiler la page jusqu'à elle (`scrollIntoView`).
- Réutilise les classes de navigation déjà présentes dans `vendor/backstage.css`
  (`.backstage-layout`/`.backstage-sidebar`/`.backstage-content`/`.nav-item`/`.nav-item-label`/
  `.nav-badge`) — normalement destinées à la navigation entre onglets du backstage (Bibliothèque/Sfx/
  Packs/...), réemployées ici pour naviguer entre morceaux à la place. Aucune nouvelle règle CSS
  nécessaire.
- `index.html` : mise en page à deux colonnes restaurée (`.backstage-layout` > `.backstage-sidebar` +
  `.backstage-content`), la seconde colonne contenant `#libraryContainer` (inchangé).
- **Bug de timing trouvé et corrigé en cours de route** : synchroniser la barre latérale sur
  `notifyLibraryChanged()` (déclenché par `app.js` via `Lib.onDirty`) affichait un état obsolète après
  une suppression — cet événement se déclenche AVANT la mutation réelle des données dans plusieurs
  chemins de `libraryRender.js` (ex. `remove-track` : `notifyLibraryChanged()` puis `library.splice()`
  ensuite). Corrigé en synchronisant la barre latérale directement à la toute fin de `renderLibrary()`
  (après reconstruction complète du DOM et des données), pas sur l'événement "modification".
- Testé de bout en bout (script de fumée jsdom, supprimé après vérification) : la barre latérale reflète
  bien l'ajout, la suppression, et le dépli déclenché depuis un clic sur une entrée. Tous les cas passent.

## 2026-08-05 — Débogage, optimisation, nettoyage (passe sur le port du backstage)

**Bug réel trouvé et corrigé** — course entre le décodage de durée et l'import IPC :

`importDroppedFile` lance en parallèle le décodage de durée (`probeAudioDuration`, généralement rapide)
et la copie du fichier dans le dossier brouillon (`project.importAudioFile`, un aller-retour IPC). Le
code déclenchait jusqu'ici le rappel `onDurationKnown` — qui appelle presque partout `renderLibrary()` —
dès que le décodage finissait, **sans attendre la fin de l'import**. Quand l'import prenait ne serait-ce
qu'un peu plus de temps que le décodage (le cas courant), ce `renderLibrary()` prématuré reconstruisait
le contrôle de fichier avant que `item.audioRef` ne soit posé, remplaçant les éléments DOM sur lesquels
la confirmation d'import différée (`.then()`) comptait pointer — plus rien ne redéclenchait alors de
rendu une fois l'import réellement terminé. Résultat concret : un fichier pouvait s'importer avec succès
en arrière-plan tout en restant affiché indéfiniment comme "aucun fichier" à l'écran.

- **`editor/library.js`** (`importDroppedFile`) : `onDurationKnown` n'est désormais appelé qu'une fois
  les DEUX terminés (import et décodage), après que `item.audioRef`/`item.fileName` soient déjà posés —
  jamais depuis l'intérieur du décodage seul.
- **`editor/library.js`** (`wireFileControl`/`updateFileStatus`) : simplifiés en même temps (plus besoin
  de faire circuler une Promise pour l'état "en cours d'import", un simple booléen suffit désormais que
  la source de la course est éliminée).
- Testé spécifiquement : un scénario où l'import IPC est délibérément rendu plus lent que le décodage de
  durée (reproduit exactement la condition qui déclenchait le bug) — le statut affiché passe bien de
  "Import…" au nom du fichier une fois l'import réellement terminé, sans rester bloqué.

**Optimisation** — dépôts en lot : sur les 5 zones de dépôt groupé (alternatives de pool, dépôt global
séquentiel, alternatives d'emplacement, dépôt direct sur la liste d'emplacements, boucles
d'embranchement-vertical), chaque fichier importé déclenchait son propre `renderLibrary()` séparé
(N reconstructions complètes du DOM pour N fichiers déposés d'un coup). Regroupé avec `Promise.all(...)
.then(renderLibrary)` : un seul re-rendu une fois tous les imports du lot terminés.

**Nettoyage** — code mort retiré (jamais appelé ni référencé nulle part) :
- `trackBackstageEvent` (analytics, stub inutile car aucun appelant n'a été conservé)
- `blockTracksRefresh`/`packTracksRefreshers` (stubs pour des hooks AdReel/Pack jamais câblés)
- `noAiCertifiedGlobal` déclaré une seconde fois sans usage dans `libraryRender.js` (seul `library.js`
  s'en sert réellement, dans `togglePreview`)
- Gestionnaire de clic vestige sur la règle de la timeline de points de boucle (`buildLoopTimelineEl`) :
  ne faisait plus rien d'utile depuis que la synchronisation avec un aperçu ouvert ailleurs a été retirée
  (un seul aperçu actif à la fois dans le bac à sable) — retiré avec le commentaire qui le décrivait.

**Point identifié, non corrigé délibérément** : `renderLibrary()` arrête tout aperçu "Écouter" actif au
tout début de chaque appel (comportement repris tel quel du backstage) — donc n'importe quelle
modification ailleurs dans la bibliothèque (ajouter un morceau, replier une carte différente...) coupe un
test en cours sur un autre morceau. C'est exactement le type de bug corrigé sur l'ancienne architecture
maison le 05/08 (avant la bascule vers le port du backstage), mais ici le comportement vient directement
du code source repris à l'identique — je ne l'ai pas changé unilatéralement puisque diverger du backstage
irait à l'encontre du but de ce chantier. À trancher avec Jules-Antoine si ça gêne à l'usage réel.

**Testé** : script de fumée combinant le scénario du bug de course ci-dessus et une suite de
non-régression générale (mode par défaut, dépôt en lot séquentiel avec devinette de rôle, lecture réelle,
barre latérale). Tous les cas passent.

