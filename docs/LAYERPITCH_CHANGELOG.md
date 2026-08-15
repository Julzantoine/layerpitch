# LayerPitch — Changelog technique

Journal des modifications de code et sessions de débogage. Entrées classées de la plus récente à la plus ancienne. Chaque entrée liste les fichiers touchés, le contexte, le diagnostic (si débogage) et le changement effectué.

*Ce document a été reconstitué le 28 juillet 2026 à partir de cinq fichiers de changelog partiels retrouvés dans le projet (le fichier global ayant été accidentellement écrasé par une version antérieure) : `LAYERPITCH_CHANGELOG_25_JUILLET.md`, `LAYERPITCH_CHANGELOG_20_JUILLET.md`, `LAYERPITCH_CHANGELOG_SESSION_18_JUILLET.md`, `LAYERPITCH_CHANGELOG_CETTE_SESSION.md` (session du 16 juillet) et la version encore présente de `LAYERPITCH_CHANGELOG.md` (01 → 16 juillet). Les doublons entre fichiers ont été fusionnés (notamment l'entrée du 16 juillet sur la collision `t`, présente à l'identique dans deux sources).*

*Note du 30 juillet 2026 (obsolète) : ce fichier avait été déplacé à la racine du dépôt pour simplifier la publication. Remis dans `docs/` le 6 août 2026 — c'est son emplacement actuel.*

---

## [2026-08-15] — Message d'aide sur l'ordre des emplacements, nuancé en présence d'embranchements

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : Jules-Antoine signale que le message "L'ordre ci-dessous est celui de la chaîne de lecture [...] Une fois le dernier atteint, ça reboucle sur le premier" n'est vrai que pour un séquentiel SANS embranchement — dès qu'un embranchement existe, la lecture réelle peut dévier de cet ordre selon les choix du visiteur, et prétendre que "l'ordre" détermine la lecture devient trompeur.

**Changement** : message conditionnel selon `(track.segmentSlots || []).some(sl => sl.nextOptions && sl.nextOptions.length)`. Sans embranchement : texte original inchangé. Avec au moins un embranchement configuré : nouveau texte (`segmentSlotsOrderHintWithBranches`, FR/EN) précisant que l'ordre affiché est l'ordre PAR DÉFAUT (utilisé quand aucun embranchement n'est déclenché), que la lecture réelle peut en dévier, et que le rebouclage s'applique au dernier emplacement de la chaîne "par défaut ou par embranchement".

**Vérifications** : symétrie FR/EN vérifiée programmatiquement (0 écart). Suites Backstage concernées relancées — toutes vertes.

---

## [2026-08-15] — Repli/dépli individuel de chaque emplacement séquentiel

**Fichiers touchés** : `layerpitch-backstage.html`, `test_backstage_slot_collapse.js` (nouveau)

**Contexte** : demande de Jules-Antoine — l'éditeur d'un morceau séquentiel avec plusieurs emplacements (`segmentSlots`) devenait très long à faire défiler ; chaque emplacement doit pouvoir se replier pour ne laisser voir que son titre (comme Intro/Outro depuis le 13/08, ou un morceau entier dans la bibliothèque).

**Changement** : bouton de repli (▾/▸) ajouté dans l'en-tête de chaque emplacement, avant les flèches ↑/↓ — même position/style que celui de la carte morceau. Le corps de l'emplacement (tout sauf l'en-tête : répétitions, source du contenu, tempo propre, texte de présentation, embranchements, alternatives) enveloppé dans un `data-role="slotBody"`, replié via la même classe `list-block-body.collapsed` que partout ailleurs. Contrairement à Intro/Outro, un emplacement fraîchement créé est DÉPLIÉ par défaut (rien ne change pour l'existant tant qu'on n'a pas cliqué) — la demande portait sur la capacité à replier, pas sur un repli automatique.

**État suivi par id, pas par position** : `collapsedSlotIds` (nouveau `Set`, id de l'emplacement) plutôt qu'une clé positionnelle `ti:si` — un emplacement garde son état replié/déplié même après un réordonnancement ↑/↓, puisque sa position (`si`) change à chaque déplacement alors que son identité (`slot.id`) reste stable. Testé explicitement : après avoir replié le premier emplacement puis l'avoir déplacé en seconde position, c'est bien LUI qui reste replié (pas "la seconde position", qui elle affiche l'autre emplacement, désormais en premier, toujours déplié).

**Tests** : nouveau `test_backstage_slot_collapse.js` — création, repli/dépli, persistance du champ titre visible même replié, persistance après réordonnancement (le point ci-dessus) et après un re-rendu complet. `test_backstage_seq_transitions.js`, `test_backstage_intro_outro_collapse_and_reorder.js`, `test_backstage_maxchainloops.js`, `test_backstage_custom_cut_fade_roundtrip.js` relancées — toutes vertes, aucune régression.

---

## [2026-08-15] — Bug de repli visuel (panneau des embranchements) + libellés de section noircis/soulignés

**Fichiers touchés** : `layerpitch-backstage.html`

**Diagnostic** : Jules-Antoine signale que le panneau des embranchements ne se replie plus visuellement. Investigation : bug **préexistant**, confirmé identique sur le fichier d'origine non modifié (avant toute intervention de cette session) — donc pas une régression introduite par le chantier "texte de présentation" de plus tôt dans la journée. La règle CSS qui masque réellement un panneau replié est `.list-block-body.collapsed { display: none; }` — elle exige la classe `list-block-body` EN PLUS de `collapsed`. Le panneau des embranchements (`data-role="branchesBody"`) n'avait que la classe `collapsed` seule : le bouton et le chevron ▸/▾ réagissaient bien au clic (la classe changeait), mais rien ne se masquait jamais puisque la règle CSS ne matchait pas. Les 4 nouveaux blocs "Texte de présentation" ajoutés plus tôt dans la journée (intro/outro/emplacement/transition) reproduisaient exactement le même bug, copié depuis ce même pattern.

**Correctif** : classe `list-block-body` ajoutée aux 5 panneaux concernés (`branchesBody`, `introDescBody`, `outroDescBody`, `slotDescBody`, `transDescBody`).

**Second changement (demande directe, plusieurs itérations)** : les libellés de section ("IDENTITÉ", "TEMPO", "CONTENU", "STRUCTURE"...) passent de gris (`#999`) à noir (`#24262b`). Premier essai — un liseré (`border-bottom`) sous le texte — jugé peu concluant par Jules-Antoine ("ça fait plein de barres, on comprend encore moins", en plus du `border-top` déjà existant entre sections qui produisait un doublon visuel). Remplacé par un badge encadré (`border` + `border-radius:4px` + fond `#f4f4f5`, `display:inline-block`) à la suggestion de Jules-Antoine. Deux ajustements suite à retour visuel : texte recentré horizontalement (le `letter-spacing` ajoute de l'espace après la DERNIÈRE lettre aussi, décalant visuellement le texte vers la gauche dans un cadre — compensé par un `padding-right` réduit d'autant) ; centrage vertical fiabilisé via `display:inline-flex; align-items:center; line-height:1` plutôt qu'un simple padding symétrique (sensible aux métriques de la police). Marge au-dessus du tout premier badge d'une carte morceau ("IDENTITÉ") : une tentative intermédiaire ratée avait ANNULÉ la marge au lieu de l'augmenter (bug de ma part, corrigé) — la valeur finale retenue est la marge standard de 20px, comme tous les autres badges, sauf dans la barre latérale (`.backstage-sidebar > .nav-section-label:first-child`) où elle reste à 0, le badge y étant vraiment tout en haut sans rien au-dessus. Cette classe (`.nav-section-label`) est partagée avec les libellés de section de la barre latérale gauche ("COMPTE", "SITE (ADREEL)"), qui en bénéficient donc aussi — confirmé explicitement avec Jules-Antoine avant modification, puisque ça touchait plus large que la demande initiale.

**Troisième changement (omis du changelog sur le moment, rattrapé ici)** : `.page { max-width: 760px; margin: 0 auto; }` → `max-width: min(1400px, 92vw)`. Jules-Antoine signale un espace vide important sur un grand écran (largeur fixe à 760px, très étroite face à une fenêtre >1900px). Le contenu occupe désormais jusqu'à 92% de la largeur de la fenêtre, plafonné à 1400px pour éviter des lignes de texte/formulaire démesurément longues sur un très grand écran. `.row` (disposition en colonnes flexibles) s'adapte sans effet de bord à ce surcroît d'espace.

**Vérifications menées** : `test_backstage_branch_collapse_and_header_order.js` — le check "le panneau est réellement masqué visuellement" passe désormais (échouait avant, y compris sur le fichier d'origine). Un second échec dans cette même suite (ordre des boutons de l'en-tête de carte morceau) reste préexistant et sans rapport avec ce correctif — non traité, pas signalé par Jules-Antoine. `test_backstage_seq_transitions.js`, `test_backstage_intro_outro_collapse_and_reorder.js`, `test_backstage_maxchainloops.js`, `test_backstage_custom_cut_fade_roundtrip.js` relancées — toutes vertes, aucune régression.

**Note pour plus tard** : le même piège (`collapsed` seul, sans `list-block-body`) pourrait exister ailleurs dans le fichier — pas d'audit systématique fait sur ce point précis, seulement les 5 panneaux directement concernés cette session.

---

## [2026-08-15] — Texte de présentation optionnel par emplacement/intro/outro/transition (séquentiel)

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`, `test_seq_stage_description.js` (nouveau), `test_backstage_custom_cut_fade_roundtrip.js`

**Contexte** : demande de Jules-Antoine — chaque élément qui devient audible en mode séquentiel (un emplacement, l'intro, l'outro, un fichier de transition) peut porter un texte de présentation optionnel, affiché à la place de la description du morceau pendant qu'il joue. Architecture discutée en profondeur avant tout code : bilingue dès maintenant (`descriptionFr`/`descriptionEn`, pattern classique de l'existant) plutôt qu'un système de langues généralisé anticipé — jugé prématuré tant qu'aucune demande concrète au-delà de FR/EN ne s'est manifestée (piste notée dans `extensions-roadmap.md` pour plus tard). Portée précisée par un exemple concret de Jules-Antoine (Intro → WetDarkCave → transition "Secret Lever" → Corridor → Battle) : le texte suit les étapes RÉELLEMENT audibles (pas le clic du visiteur), et un champ vide ne doit JAMAIS écraser le texte précédemment affiché (attention explicite portée au cas d'une intro sans texte propre, qui doit laisser voir la description du morceau jusqu'au premier élément qui en a un — obtenu gratuitement par cette règle, sans cas particulier à coder).

**Schéma retenu** : `descriptionFr`/`descriptionEn` (chaînes optionnelles, `''`/absent = ne redéfinit rien) sur `segmentSlots[]`, `track.intro`, `track.outro`, et `nextOptions[].transition`.

**Incrément 1 — `player.js` (moteur)** : `pickStageDescription(obj)` (résolution bilingue, même pattern que `pickSfxDescription`, mais sans repli sur un ancien champ unique — nouveau champ, aucune migration à gérer). Un champ `desc` transite désormais dans toute la chaîne de programmation séquentielle (`decideNextSeqBlock()` → `forcedNextBlock` → `scheduleSeqGeneration()` → `scheduleSeqLabelUpdate()`), mis à jour au même instant que le libellé affiché (`seqCurrentEl`). Nouvel élément `data-role="trackDesc"` sur le conteneur de description (`.track-desc`), référencé une fois par lecteur (`trackDescEl`). Un texte vide ne touche jamais à `trackDescEl` — c'est cette règle, et non un repli explicite vers `track.description`, qui gère le cas "intro sans texte" demandé. Un vrai arrêt (`stopSequential()`) réinitialise vers `track.description` ; un `seek` (qui appelle `stopSequential()` en interne) capture et restaure le texte affiché avant/après — exactement le même piège que celui déjà rencontré et corrigé pour le libellé le 13/08, corrigé ici de la même manière.

**Incrément 2 — `layerpitch-backstage.html`** : bloc "Texte de présentation (facultatif)" repliable (réutilise le pattern générique existant `collapsibleBlockToggleHtml`/`wireCollapsibleBlockToggle`, replié par défaut — consigne explicite de Jules-Antoine de ne jamais surcharger l'UI en ajoutant une fonctionnalité) sur les 4 emplacements concernés : éditeur d'emplacement (`segmentSlots`), intro, outro, et éditeur de transition (imbriqué dans le panneau déjà repliable des embranchements). Les 3 points de sérialisation (aperçu, chargement, publication) mis à jour ensemble : `mapBlockWithBars()` porte maintenant `descriptionFr`/`descriptionEn` (partagé par l'intro et, via `mapTransition()`, par la transition), l'outro (qui n'utilise pas `mapBlockWithBars`, pas de notion de `bars`) et les `segmentSlots` mis à jour séparément aux 3 points.

**Piège rencontré en cours de route** : première version des nouveaux `<textarea>` utilisant `escapeHtml()`, qui n'existe QUE dans `player.js` (fonction interne à son IIFE, non exposée globalement) — `layerpitch-backstage.html` n'a que `escapeAttr()` (échappement de guillemets pour les attributs `value="..."`, pas pour du contenu de `<textarea>`). Corrigé en s'alignant sur le pattern déjà utilisé partout ailleurs pour les `<textarea>` de ce fichier (`description`, `presentationFr`/`presentationEn` des packs/collections) : interpolation directe, sans échappement — détecté immédiatement par la suite de tests (4 suites Backstage en échec dès le premier lancement après cet incrément), corrigé avant livraison.

**i18n/aide** : nouvelles clés `stageDescriptionToggleLabel`, `stageDescriptionHint`, `stageDescriptionFrLabel`, `stageDescriptionEnLabel` (FR/EN, symétrie vérifiée programmatiquement : 0 écart). Bulle d'aide `stageDescription` ajoutée (FR/EN).

**Tests** : nouveau `test_seq_stage_description.js`, qui reproduit exactement l'exemple donné par Jules-Antoine (Intro sans texte → WetDarkCave → Secret Lever → Corridor → Battle sans texte, plus une vérification de la résolution EN). `test_backstage_custom_cut_fade_roundtrip.js` mis à jour (ses ancres de texte littéral sur la ligne `outro:` ne correspondaient plus après l'ajout des nouveaux champs) et étendu avec des vérifications dédiées au nouveau texte de présentation, dans le même esprit que ce qu'il vérifiait déjà pour `customCutFadeSec`/`bpm`/`beatsPerBar`.

**Vérifications menées** : `node --check` sur tous les fichiers touchés — OK. Symétrie FR/EN vérifiée programmatiquement (0 écart dans les deux sens). 17 suites de tests concernées relancées ensemble après correction du piège `escapeHtml` — toutes vertes, aucune régression restante.

**Pas encore fait** : aucun test d'écoute réel (comme toujours, à valider par Jules-Antoine avant publication).

---

## [2026-08-14] — Durée explicite du fichier de transition avant bascule vers la cible (`durationUnit`)

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`, `test_seq_transitions.js`, `test_backstage_seq_transitions.js`

**Contexte** : demande de Jules-Antoine — pour un fichier de transition (`nextOptions[].transition`), pouvoir contrôler explicitement l'instant où la cible démarre, plutôt que de dépendre du seul champ `bars` existant (découverte en cours de discussion : ce champ existait déjà, câblé, mais utilisait systématiquement le tempo de l'emplacement SOURCE — aucune option n'existait pour un tempo propre à la transition, ni pour une durée en secondes indépendante de tout tempo). Architecture discutée et validée avant tout code (schéma, sémantique de repli, rétrocompatibilité).

**Schéma retenu** sur `nextOptions[].transition` :
- `durationUnit` (`'bars'` | `'seconds'`, absent = comportement historique inchangé : `blockSeconds(bars, sourceSlot)`, tempo de l'emplacement source).
- `durationUnit: 'bars'` : mesures sur le tempo **propre** à la transition (`bpm`/`beatsPerBar`), avec repli sur le tempo de l'emplacement source puis celui du morceau si non renseignés — utile pour un impact/riser à un tempo différent de l'emplacement qu'on quitte.
- `durationUnit: 'seconds'` : `durationSeconds`, durée brute sans notion de tempo — pour un fichier non quantifié musicalement. Exclusif du mode mesures (sélecteur, pas de repli entre les deux).

**Incrément 1 — `player.js` (moteur)** : `transitionTiming(tr, sourceSlot)` et `transitionDurationSecFor(opt, sourceSlot)` ajoutées, remplacent l'appel direct à `blockSeconds()` dans `performSeqBranchCut()`. Bascule vers le nouveau calcul uniquement si `durationUnit` est explicitement renseigné ; sinon appelle `blockSeconds()` exactement comme avant — zéro risque de régression sur les transitions déjà publiées.

**Incrément 2 — `layerpitch-backstage.html`** : sélecteur d'unité (mesures/secondes) sur chaque embranchement ayant une transition, affiché avec repli visuel `'bars'` par défaut sans rien écrire tant que l'utilisateur ne touche à rien (même convention que `cutStyle`). En mode mesures : champs BPM/temps-par-mesure propres à la transition (placeholder = ce qu'ils hériteraient, càd le tempo de l'emplacement source). En mode secondes : champ durée unique (défaut 1s). Les 3 points de sérialisation (aperçu, chargement, publication) mis à jour ensemble via une nouvelle fonction dédiée `mapTransition()` (distincte de `mapBlockWithBars`, réutilisée par l'intro, qui n'a pas cette notion de durée explicite).

**i18n/aide** : nouvelles clés `transitionDurationUnitLabel/Bars/Seconds`, `transitionDurationSecondsLabel`, `transitionBarsTempoHint` (FR/EN, symétrie vérifiée programmatiquement : 0 écart) ; `bpmLabel`/`beatsPerBarLabel` génériques réutilisés tels quels. Bulle d'aide `transitionDurationUnit` ajoutée (FR/EN) ; `slotBpmOverride` mise à jour pour ne plus affirmer que le fichier de transition suit systématiquement le tempo de l'emplacement source (ce n'est plus vrai en mode mesures avec tempo propre).

**Tests** : 2 nouveaux scénarios dans `test_seq_transitions.js` (mode `seconds`, durée indépendante du tempo source à 300 BPM ; mode `bars` avec tempo propre à 60 BPM très différent du tempo source, confirmant que le calcul utilise bien le tempo de la transition et non celui de l'emplacement quitté) — non-régression du scénario existant (transition sans `durationUnit`) confirmée. 6 nouveaux checks dans `test_backstage_seq_transitions.js` (apparition/disparition conditionnelle des champs selon l'unité choisie, valeurs par défaut, persistance après re-rendu y compris un aller-retour par le mode secondes).

**Vérifications menées** : `node --check` sur tous les fichiers touchés — OK. Symétrie FR/EN vérifiée programmatiquement (0 écart dans les deux sens). Les 5 suites de tests concernées (`test_seq_transitions.js`, `test_seq_branching.js`, `test_embr_vertical_engine.js`, `test_backstage_seq_transitions.js`, `test_seq_custom_cut_fade.js`) toutes vertes ensemble, aucune régression.

**Pas encore fait** : aucun test d'écoute réel (comme toujours, à valider par Jules-Antoine avant publication).

---

## [2026-08-13] — Passe de relecture/nettoyage sur tout le code de la session

**Fichiers touchés** : `player.js`, `test_seq_custom_cut_fade.js`, `backstage.css`

**Contexte** : demande explicite de Jules-Antoine de repasser sur tout le code produit cette session (vérifier, nettoyer, corriger, optimiser) avant de clore. Vérifications systématiques menées :
- Cohérence des 3 points fonctionnels de sérialisation `segmentSlots` (aperçu/publication/chargement) — comparaison automatisée des champs `bpm`/`beatsPerBar`/`customCutFadeSec`/`quantization`/`cutStyle`/`referencesSlotId`/`repeatCount` entre les trois : tous alignés, aucun oubli.
- Symétrie FR/EN complète de `layerpitch-i18n.js` et `layerpitch-help.js` (pas seulement les clés ajoutées cette session) : 0 clé orpheline dans les deux sens.
- Toutes les clés `tr()`/`t()` utilisées dans `player.js`/`layerpitch-backstage.html` existent bien dans le dictionnaire (1 faux positif du script de vérification, une clé construite dynamiquement, préexistante).
- Tous les blocs repliables (`.collapsed`) du backstage vérifiés un par un : aucun autre n'a le bug de classe CSS incomplète découvert plus tôt sur les embranchements (Intro/Outro/branches/pools/sfx/etc. — tous corrects).
- Cohérence des 4 fichiers portant le CSS du slider de volume (`index.html`, `pack.html`, `layerpitch-backstage.html`, `backstage.css`) — identiques.
- Absence de `console.log`/`debugger` oubliés.

**Deux bugs réels trouvés et corrigés** :
1. **`player.js`** — dans `performSeqBranchCut`, `sourceSlot.customCutFadeSec || 0.15` traitait un fondu personnalisé explicitement réglé à **0 seconde** (coupure instantanée voulue) comme une valeur absente, et retombait sur 0.15s au lieu de respecter le 0 — piège classique du `||` avec une valeur JS falsy légitime. Corrigé en `!= null`, comme c'était déjà fait partout ailleurs (formulaire backstage, publication, chargement) sauf ici. Nouveau scénario de test dédié (`test_seq_custom_cut_fade.js`) qui aurait détecté ce bug.
2. **`backstage.css`** — la couleur des repères de section (`IDENTITÉ`/`TEMPO`/`CONTENU`/`STRUCTURE`, assombris plus tôt dans la session) n'avait été mise à jour que côté `layerpitch-backstage.html`, pas dans `backstage.css` (le bac à sable local serait resté sur l'ancienne couleur claire). Synchronisé.

**Un vrai reliquat trouvé, non traité (hors scope de cette session)** : `backstage.css` contient des règles CSS orphelines (`.track-section-head`, `.track-section-caret`, `.track-section-body.collapsed`) commentées "demandé par Jules-Antoine le 10/08" pour rendre repliables les sections IDENTITÉ/TEMPO/CONTENU/STRUCTURE d'une carte de morceau — mais **aucun JS ni HTML correspondant n'existe nulle part**, ni dans `layerpitch-backstage.html` ni dans `backstage.css` lui-même : du CSS mort, une fonctionnalité apparemment jamais terminée ou perdue en route. Ni implémenté ni supprimé pour l'instant (implémenter serait une nouvelle fonctionnalité hors du cadre "nettoyer l'existant" de cette passe ; supprimer serait présomptueux si le besoin est toujours d'actualité) — signalé ici pour une prochaine session si le besoin est confirmé.

**Vérification** : `node --check` sur les trois fichiers JS — OK. Comparaison automatisée ligne à ligne de `backstage.css` contre le bloc `<style>` de `layerpitch-backstage.html` (hors le reliquat mentionné ci-dessus, plus aucune divergence). Les 20 suites de tests existantes relancées intégralement après chaque correctif — toutes vertes.

---

## [2026-08-13] — Détection du BPM et des mesures dans le nom de fichier au dépôt

**Fichiers touchés** : `layerpitch-backstage.html`, `test_backstage_slot_autolabel.js`, `test_backstage_filename_bpm_bars_detection.js` (nouveau)

**Contexte** : Jules-Antoine utilise une nomenclature de fichiers systématique (`#3_RobotAdventure_BattleFinal_160bpm_40M.wav`) et demande que le dépôt groupé en tienne compte pour pré-remplir le tempo et le nombre de mesures, plutôt que de tout ressaisir à la main. Ceci explique probablement le bug "l'embranchement ne boucle pas au nombre de mesures indiqué" signalé juste avant dans la session : le tempo par emplacement (fonctionnalité plus tôt le 13/08) doit être saisi manuellement, sans détection automatique — un emplacement dont le BPM n'a jamais été renseigné retombe silencieusement sur le tempo du morceau, ce qui expliquerait un écart si la valeur du nom de fichier n'a jamais été reportée dans le champ.

**Changement** :
- Nouvelle fonction `parseAudioFilenameHints(filename)` : détecte un BPM (`\d+bpm`) et un nombre de mesures (`\d+M`), chacun bordé par un séparateur (espace/underscore) ou une extrémité de nom, pour éviter un faux positif du genre "Room40Meters" (pas de séparateur entre "40M" et "eters" → pas de détection).
- `titleFromFilename()` retire désormais ces jetons du libellé généré automatiquement (redondants avec les champs structurés qu'ils viennent remplir) — ex. `#3_RobotAdventure_BattleFinal_160bpm_40M.wav` → libellé "`#3 RobotAdventure BattleFinal`", BPM et mesures dans leurs champs respectifs.
- Branché sur les créations de contenu par dépôt : nouvel emplacement (BPM sur l'emplacement + mesures sur son alternative) dans les deux points de création par lot (dépôt direct sur "Emplacements", dépôt global avec devinette de rôle) ; mesures seules (le BPM d'un emplacement déjà existant n'est jamais réécrit par un dépôt d'alternative supplémentaire) sur l'ajout d'alternatives à un emplacement existant ; mesures sur l'intro si détectées dans le dépôt global.
- `test_backstage_slot_autolabel.js` : assertion mise à jour (le libellé ne garde plus "120bpm", volontairement retiré désormais).

**Vérification** : `test_backstage_filename_bpm_bars_detection.js` (nouveau) — reprend l'exemple exact de sa capture d'écran (3 segments + 1 fichier de transition sans jeton) : `parseAudioFilenameHints` testée isolément (extraction correcte + deux cas de non-faux-positif), puis dépôt réel sur la zone "Emplacements" vérifiant que les 3 champs BPM, les 3 champs mesures et les 3 libellés nettoyés sont tous corrects. Les 19 autres suites relancées intégralement — toutes vertes.

---

## [2026-08-13] — Bug : la musique redémarre de zéro en revenant sur l'onglet (séquentiel + vertical-random)

**Fichiers touchés** : `player.js`, `test_visibility_resume.js` (nouveau)

**Contexte** : Jules-Antoine signale qu'en changeant d'onglet (musique en cours) puis en revenant sur celui de l'AdReel, la musique repart de zéro — en séquentiel et en vertical-random, mais pas en vertical classique. Diagnostic : le gestionnaire `visibilitychange` générique arrêtait tout puis relançait la chaîne via `playThisTrack(false, true)` — `isContinuation=true` préserve bien la position dans la CHAÎNE (`currentSlotIndex`/le cycle de sections en cours), mais ni `playSequential` ni `playVerticalRandom` ne tiennent compte d'un `offsetAt` : le bloc ou la section qui ÉTAIT en train de jouer au moment du passage en arrière-plan est purement abandonné, remplacé par un tout nouveau tirage qui, lui, repart de SA propre position 0 — perçu comme "ça repart de zéro". Le vertical classique n'est pas concerné : `playQuantized`/`playSimple` respectent déjà `offsetAt` correctement.

**Changement** : le gestionnaire `visibilitychange` réutilise maintenant, pour ces deux modes, les mêmes primitives de recherche (seek) déjà éprouvées pour le glissement manuel sur la waveform — `seekSequential(ctx.currentTime - currentSeqBlockInfo.virtualZero)` et `seekVerticalRandom(fraction calculée comme dans tick())` — qui rejouent précisément le bloc/section EN COURS à sa position réelle plutôt que d'en tirer un nouveau. Les autres modes (vertical classique, embranchement-vertical) ne sont pas touchés, leur chemin de reprise générique existant fonctionnait déjà correctement.

**Bug additionnel trouvé au passage** (préexistant, pas introduit par cette session) : dans `seekSequential`, le libellé du segment affiché était capturé *après* l'arrêt interne (`stopSequential()`), qui l'avait déjà remis à "—" — l'audio rejouait bien le bon segment à la bonne position, mais l'étiquette affichée retombait à "—" au lieu de son nom. Concernait donc aussi tout seek manuel sur la waveform, pas seulement la nouvelle reprise après changement d'onglet. Capture du libellé déplacée avant l'arrêt.

**Vérification** : `test_visibility_resume.js` (nouveau) simule un passage en arrière-plan puis un retour (`document.visibilityState` + événement `visibilitychange`) pendant la lecture d'un segment séquentiel et d'une section vertical-random longs — confirme que le même segment/section reste affiché après le retour (pas de nouveau tirage) et que la lecture continue. A d'abord détecté le bug du libellé "—" avant que je le corrige. Les 17 suites existantes relancées intégralement — toutes vertes.

---

## [2026-08-13] — Repères de section (IDENTITÉ, TEMPO, CONTENU, STRUCTURE…) assombris

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : Jules-Antoine trouve les libellés de section dans l'éditeur de morceau (IDENTITÉ, TEMPO, CONTENU, STRUCTURE) trop clairs (#999) pour bien se repérer visuellement.

**Changement** : couleur de `.nav-section-label` passée de `#999` à `#222`, déjà utilisé ailleurs dans le backstage comme couleur de texte principale (titres de modales) — réutilisation plutôt qu'une nouvelle teinte inventée. Cette classe est partagée par `sectionEyebrow()` (IDENTITÉ/TEMPO/CONTENU/STRUCTURE dans les cartes de morceau) et par la navigation latérale, donc les deux en bénéficient.

**Vérification** : changement CSS pur, pas de logique touchée. `node --check` sur `player.js` — OK. Quelques suites backstage relancées à titre de contrôle de non-régression général — toutes vertes.

---

## [2026-08-13] — Bug : repli des embranchements sans effet visuel (classe CSS incomplète)

**Fichiers touchés** : `layerpitch-backstage.html`, `test_backstage_branch_collapse_and_header_order.js`

**Contexte** : Jules-Antoine signale que le bouton de repli des embranchements (ajouté plus tôt dans la session) ne fonctionne pas — la flèche change d'état au clic, mais rien ne se replie visuellement. Diagnostic : la règle CSS qui masque un bloc replié est un sélecteur composé, `.list-block-body.collapsed { display: none; }` (jamais `.collapsed` seule) — Intro/Outro avaient bien la classe de base `list-block-body` en plus de `collapsed`, mais le corps du panneau d'embranchements (`branchesBody`, ajouté juste après) ne portait QUE `collapsed`, sans `list-block-body`. Le JS posait donc la classe correctement (`classList.toggle('collapsed')` fonctionnait, d'où la flèche qui changeait), mais aucune règle CSS ne matchait une classe `collapsed` isolée : rien ne se masquait. Mon test précédent ne l'avait pas attrapé car il vérifiait la présence de la classe, pas le rendu visuel réel.

**Changement** : classe de base `list-block-body` ajoutée au corps repliable du panneau d'embranchements, même schéma exact qu'Intro/Outro.

**Vérification** : `test_backstage_branch_collapse_and_header_order.js` renforcé pour vérifier le **rendu réel** (`getComputedStyle(...).display === 'none'`) plutôt que la seule présence de la classe CSS — jsdom résout correctement les sélecteurs composés simples (`.a.b`) via `getComputedStyle`, vérifié séparément avant de fiabiliser le test dessus. Contre-preuve : le test réintroduit temporairement le bug d'origine dans une copie et confirme qu'il est bien détecté (échec), puis repasse entièrement au vert sur le fichier corrigé. Les 17 autres suites relancées intégralement — toutes vertes.

---

## [2026-08-13] — "Aller vers la fin" masqué sans outro, repli des embranchements, ordre de l'en-tête

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `test_seq_no_outro_goto_end.js` (nouveau), `test_backstage_branch_collapse_and_header_order.js` (nouveau)

**Contexte** : trois demandes de Jules-Antoine.
1. En séquentiel (lecteur public), le bouton "Aller vers la fin" restait affiché même sans outro déclarée (avec un texte de repli "fin après le segment en cours") — jugé inutile/déroutant sans véritable outro.
2. Le panneau de réglages des embranchements (quantification, style de coupure, durée personnalisée, liste des options) n'était pas repliable, contrairement à Intro/Outro (13/08, plus tôt dans la session).
3. Dans l'en-tête de carte de morceau, l'ordre voulu est : bouton replier/déplier, puis le titre, puis Écouter, puis Supprimer, puis les flèches de réorganisation — deux tentatives précédentes incorrectes avant d'arriver au bon ordre.

**Changement** :
- `player.js` : le bouton `goToEndBtn` du mode séquentiel (`seqGraphHtml`) est maintenant masqué (`style="display:none"`) quand `layerHasSource(track.outro)` est faux — reste dans le DOM (pas retiré) pour que tout le code existant qui le référence (`goToEndBtn.disabled = ...`, `.textContent = ...`) continue de fonctionner sans risque de référence nulle. Le `goToEndBtn` du vertical-random (bloc séparé, `voiceGraphHtml`) n'est pas concerné — demande limitée au séquentiel.
- `layerpitch-backstage.html` : panneau "embranchements" enveloppé dans le même mécanisme générique que Intro/Outro (`collapsibleBlockToggleHtml`/`wireCollapsibleBlockToggle`, clé `branches:${ti}:${si}`) — mais avec un dépli automatique dès l'activation de la case "Prévoir des embranchements" (sinon le panneau disparaîtrait juste après l'avoir coché, déroutant), replié par défaut aux rendus suivants.
- `layerpitch-backstage.html` : en-tête de carte de morceau réordonné en un seul groupe linéaire (les deux `<div>` séparés — actions à gauche, Écouter/Supprimer à droite — fusionnés en un seul) — `[toggle▾][titre][Écouter][Supprimer][↑][↓]`.
- `layerpitch-i18n.js` (zone `backstage`, fr/en) : nouvelle clé `branchOptionsToggleLabel`.

**Vérification** : `test_seq_no_outro_goto_end.js` (nouveau) — bouton masqué sans outro, visible avec (non-régression). `test_backstage_branch_collapse_and_header_order.js` (nouveau) — panneau absent avant activation, déplié juste après, repli au clic, état persistant après re-rendu, champs toujours fonctionnels une fois redéplié, et ordre exact des boutons d'en-tête. Les 16 suites existantes relancées intégralement — toutes vertes.

---

## [2026-08-13] — Bug : durées de fondu personnalisées perdues à la publication

**Fichiers touchés** : `layerpitch-backstage.html`, `test_backstage_custom_cut_fade_roundtrip.js` (nouveau)

**Contexte** : Jules-Antoine signale que les durées de fondu personnalisées (`cutStyle: 'custom'`, ajouté plus tôt dans la session) ne fonctionnent pas. Diagnostic : `customCutFadeSec` avait bien été ajouté au formulaire et à l'aperçu local (`buildPreviewTrack`), mais **pas** aux deux autres endroits où `segmentSlots` est sérialisé — la vraie fonction de publication (`data.json`, autour de la ligne 5619) et la fonction de chargement d'un morceau déjà publié dans l'éditeur (autour de la ligne 5050). `cutStyle: 'custom'` partait bien en publication, mais `customCutFadeSec` lui-même se perdait en route : le site publié retombait silencieusement sur le fondu par défaut de 0.15s, sans erreur visible. Même trou exact pour le tempo par emplacement (`bpm`/`beatsPerBar`, fonctionnalité antérieure de cette même session) — présent nulle part ailleurs que dans l'aperçu local non plus, donc lui aussi cassé en publication sans que ça ait été signalé.

**Changement** : `customCutFadeSec`, `bpm`, `beatsPerBar` ajoutés aux deux mappings `segmentSlots` manquants (publication et chargement), en plus de celui de l'aperçu déjà corrigé. Trois points de sérialisation au total pour ces champs, désormais tous alignés. `describeSequential()` (texte descriptif généré, ex. pour les notes d'implémentation) corrigé au passage pour ne plus afficher "fondu de 0.15s" sur un emplacement en durée personnalisée.

**Vérification** : `test_backstage_custom_cut_fade_roundtrip.js` (nouveau) extrait directement les deux mappings corrigés du code source (même principe que `test-section-scheduler.js`/`test-slot-chain-advancer.js` pour `player.js` — aucune dépendance réseau/DOM nécessaire) et vérifie que `customCutFadeSec`/`bpm`/`beatsPerBar` survivent à un aller-retour publication et chargement. Les 14 suites existantes relancées intégralement — toutes vertes.

---

## [2026-08-13] — Intro/Outro repliés par défaut (séquentiel) + réorganisation de la bibliothèque

**Fichiers touchés** : `layerpitch-backstage.html`, `test_backstage_intro_outro_collapse_and_reorder.js` (nouveau)

**Contexte** : deux demandes indépendantes de Jules-Antoine.
1. Dans l'éditeur d'un morceau séquentiel, les blocs Intro et Outro étaient toujours entièrement dépliés (label, mesures, sélecteur de rôle, contrôle de fichier) — occupaient de la place même une fois configurés et plus besoin d'y toucher.
2. Aucun moyen de changer l'ordre des morceaux dans la bibliothèque — possible à tous les niveaux inférieurs (sections, emplacements, boucles nommées) mais pas au niveau de la bibliothèque elle-même.

**Changement** :
- Nouveau mécanisme générique `collapsibleBlockToggleHtml()`/`wireCollapsibleBlockToggle()` pour replier un bloc isolé (par opposition à `altPoolToggleHtml`/`wireAltPoolToggle`, déjà existant, qui replie une liste de *variations*) — réutilise la même Map `expandedAltPoolKeys` (clés `intro:${ti}`/`outro:${ti}`, distinctes des clés de pools existantes) plutôt que d'introduire un second Set redondant. Appliqué aux blocs Intro et Outro du mode séquentiel uniquement (pas touché au vertical-random, qui a son propre rendu intro/outro, non concerné par la demande). Repliés par défaut ; l'icône d'aide contextuelle (`data-help`) déplacée du `<label>` d'origine vers le bouton de repli, pour rester accessible même replié.
- Boutons ↑/↓ (`move-track-up`/`move-track-down`) ajoutés dans l'en-tête de chaque carte de morceau, même principe exact que `move-section-up`/`move-slot-up`/`move-embr-loop-up` déjà en place (échange de deux éléments adjacents du tableau `library`, désactivés en butée). Aucun impact sur les AdReels/Packs existants : ils référencent les morceaux par `id`, pas par position dans `library`.

**Vérification** : `test_backstage_intro_outro_collapse_and_reorder.js` (nouveau) — repli par défaut d'Intro et Outro, dépli/repli au clic, champs toujours fonctionnels une fois dépliés (non-régression), et réorganisation de trois morceaux (monter/descendre, boutons désactivés en butée). Les 13 suites existantes relancées intégralement — toutes vertes.

---

## [2026-08-13] — Troisième style de coupure : durée de fondu personnalisée

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`, `test_seq_custom_cut_fade.js` (nouveau)

**Contexte** : Jules-Antoine signale que le fondu de sortie (0.15s fixe) est trop court quand un fichier de transition est utilisé. Premier essai proposé (fondu automatiquement porté à la moitié de la durée de la transition) — revenu dessus après discussion : préférence pour un contrôle explicite plutôt qu'un auto-calcul. Décision finale : `cutStyle` passe de deux à trois valeurs — `hard` (coupure nette, inchangé), `fade` (fondu court fixe 0.15s, comportement historique inchangé, **pas** d'auto-calcul basé sur une transition), `custom` (nouveau — durée choisie par le compositeur en secondes réelles, via un curseur).

**Changement** :
- `player.js` (`performSeqBranchCut`) : `fadeOutSec = cutStyle === 'custom' ? (sourceSlot.customCutFadeSec || 0.15) : 0.15` — calcul de `opt`/`oi`/`transitionBuf`/`transitionDurationSec` remonté avant le fondu (nécessaire pour construire `forcedNextBlock` un peu plus loin, réutilisé tel quel, aucune duplication).
- `layerpitch-backstage.html` : troisième `<option value="custom">` sur le select `cutStyle` ; nouveau curseur (`<input type="range" min="0" max="8" step="0.05">`, `data-slot-field="customCutFadeSec"`) affiché uniquement quand `custom` est sélectionné, avec la valeur courante affichée à côté (`data-role="customCutFadeValue"`). Handler d'input : le changement de `cutStyle` déclenche un `renderLibrary()` (fait apparaître/disparaître le curseur) ; le curseur lui-même NE déclenche PAS de `renderLibrary()` sur chaque `input` (mise à jour directe du texte à côté à la place) — un re-rendu complet à chaque tick de glissement aurait recréé l'élément et interrompu le drag en cours.
- `layerpitch-backstage.html` (`buildPreviewTrack`) : au passage, deux oublis corrigés dans le mapping `segmentSlots` de l'aperçu "Écouter" — `bpm`/`beatsPerBar` par emplacement (fonctionnalité du 13/08, jamais transmise à l'aperçu jusqu'ici) et `customCutFadeSec` (nouveau). Sans ce correctif, l'aperçu local aurait fonctionné différemment de la version publiée pour ces deux réglages.
- `layerpitch-i18n.js` (zone `backstage`, fr/en) : `cutStyleCustom`, `customCutFadeLabel`.
- `layerpitch-help.js` (zone `library`, fr/en) : `slotCutStyle` mis à jour (mentionne le 3e choix), nouvelle clé `slotCustomCutFade`.

**Vérification** : `node --check` sur les trois fichiers JS — OK. `test_seq_custom_cut_fade.js` (nouveau) instrumente `createGain` pour capturer les appels `linearRampToValueAtTime(0, ...)` et mesure le délai réel : confirme qu'un emplacement `cutStyle: 'custom', customCutFadeSec: 1.5` produit un fondu d'environ 1.5s, et qu'un emplacement `cutStyle: 'fade'` (par défaut) reste à ~0.15s même avec une transition longue (0.8s) déclarée — non-régression explicite de la décision "pas d'auto-calcul". Les 12 suites existantes relancées intégralement — toutes vertes.

---

## [2026-08-13] — Nom d'emplacement séquentiel repris automatiquement du fichier déposé

**Fichiers touchés** : `layerpitch-backstage.html`, `test_backstage_slot_autolabel.js` (nouveau)

**Contexte** : Jules-Antoine signale (capture d'écran à l'appui) que quand un dépôt de fichier crée un nouvel emplacement séquentiel, le champ nom de l'emplacement lui-même (`#1 WetDarkCave` dans son exemple) reste vide — seule l'alternative à l'intérieur héritait du nom du fichier via `titleFromFilename()`. Obligeait à ouvrir "Voir les variations" à chaque fois pour savoir quel fichier avait atterri dans quel emplacement, alors que le texte d'aide (`segmentsDropHint`) promet déjà "le nom repris automatiquement".

**Changement** : trois points de création d'un `segmentSlot` identifiés, tous corrigés (`label: ''` → `label: titleFromFilename(f.name)`, ou `payload.label` quand un nom était déjà connu) :
- Dépôt direct sur la zone "Emplacements" (chaque fichier crée son propre emplacement).
- Dépôt groupé au niveau du morceau, avec devinette intro/segment/outro par nom de fichier (`guessSequentialRole`) — la branche "segment" ne remplissait pas le label de l'emplacement.
- Reclassification de rôle après un tel dépôt (sélecteur intro/segment/outro) — le label déjà connu (`payload.label`) n'était pas repris pour le nouvel emplacement créé.

Le nom reste évidemment modifiable ensuite (aucun champ verrouillé), exactement comme demandé.

**Vérification** : `test_backstage_slot_autolabel.js` (nouveau) simule un dépôt sur la zone "Emplacements" et vérifie que le champ `label` de l'emplacement créé est bien pré-rempli avec le nom du fichier (pas vide). Les 12 suites existantes relancées intégralement — toutes vertes, aucune régression.

---

## [2026-08-13] — Cache-busting : trou trouvé sur layerpitch-i18n.js/layerpitch-help.js, docs/infrastructure.md corrigé

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`, `docs/infrastructure.md`

**Contexte** : Jules-Antoine signale, d'après `docs/infrastructure.md`, un problème de cache non résolu — après publication, les visiteurs peuvent voir une version périmée du site sans vidage manuel du cache, cause probable étant l'absence de cache-busting sur `data.json`. Investigation menée sur les fichiers réellement livrés cette session (le repo GitHub étant en retard sur ces sessions, jamais utilisé comme source de vérité ici) :
- `data.json` : déjà cache-busté avec `?v=' + Date.now()` dans `index.html`/`pack.html`/`collection.html` (`video-test.html` n'en a pas besoin, ne charge pas `data.json`) — donc DÉJÀ résolu, contrairement à ce que dit encore le doc. Cette approche (timestamp de chargement, pas `publishedAt`) évite au passage le problème d'œuf-et-poule que Jules-Antoine anticipait (`publishedAt` ne vivant que dans `data.json` lui-même) : pas besoin d'un `version.json` séparé.
- `player.js` : déjà versionné à chaque publication (`updatePlayerScriptVersion()`, balise `<script>` réécrite avec `?v=<buildVersion>`, même timestamp que `publishedAt`).
- **Trou réel trouvé, jamais traité** : `layerpitch-i18n.js` (chargé par les 5 fichiers publics) et `layerpitch-help.js` (chargé par `collection.html` et le backstage) n'avaient aucun cache-busting — `updatePlayerScriptVersion()` ne touchait que `player.js`. Un visiteur pouvait voir des traductions ou une aide contextuelle périmées jusqu'à 10 min après une publication (TTL GitHub Pages, non configurable, non contournable côté navigateur puisque l'URL ne changeait jamais).

**Changement** :
- `layerpitch-backstage.html` : `updatePlayerScriptVersion()` remplacée par `updateScriptVersions()`, généralisée à une liste `VERSIONED_SCRIPTS = ['player.js', 'layerpitch-i18n.js', 'layerpitch-help.js']` — un seul fetch + une seule écriture par fichier HTML, quel que soit le nombre de balises concernées réellement présentes dans ce fichier (ex. `video-test.html` n'a que `layerpitch-i18n.js`). `video-test.html` ajouté à la liste des fichiers mis à jour dans `publishAll()` (chargeait déjà `layerpitch-i18n.js` sans jamais être touché par la version précédente de la fonction).
- `layerpitch-i18n.js` (zone `backstage`, fr/en) : clés `fileNotFoundVersionUpdate`, `scriptTagNotFound`, `versionUpdatedLog`, `updatingPlayerVersion` reformulées pour ne plus mentionner que `player.js` spécifiquement.
- `docs/infrastructure.md` : paragraphe cache corrigé pour refléter l'état réel (résolu, avec le détail de ce qui est déjà en place et le seul résiduel restant : le TTL de 10 min de GitHub Pages sur l'URL canonique de la page HTML elle-même, sans conséquence sur le contenu affiché puisque piloté par `data.json` toujours frais, auto-résolutif). Entrée ajoutée au journal des décisions d'infrastructure.

**Vérification** : `node --check` sur `layerpitch-i18n.js` — OK. Logique de `updateScriptVersions()` testée hors-ligne (regex extraite et rejouée sur 4 cas : première publication d'`index.html`, republication — pas de doublon de `?v=` —, `video-test.html` avec un seul script, `collection.html` avec les trois) — comportement correct dans les 4 cas. Les 11 suites de tests existantes + `test_seq_slot_tempo.js` relancées intégralement (aucune ne couvre `publishAll`/la publication GitHub, mais confirment l'absence de régression sur le reste du backstage et du moteur) — toutes vertes.

---

## [2026-08-13] — Slider de volume par voix (vertical classique + vertical-random)

**Fichiers touchés** : `player.js`, `layerpitch-i18n.js`, `index.html`, `pack.html`, `layerpitch-backstage.html`

**Contexte** : demande de Jules-Antoine — ajouter un réglage de volume continu par couche sur la page publique, en plus du Solo/Muet déjà existant dans le mixer (`vertGraph` pour le vertical classique, `voiceGraph` pour le vertical-random). Portée et comportement validés avec lui avant codage : les deux modes sont concernés ; en vertical-random, une position de pool peut tirer un slot vide (silence) à un cycle donné — le nœud correspondant (déjà masqué entièrement dans ce cas via `display:none`) embarque désormais le slider, qui se cache/réapparaît avec lui sans logique supplémentaire, la valeur réglée restant en mémoire pour le prochain tirage audible de cette position. Réglage volontairement non persisté (comme Solo/Muet), et démarrant à 100% (= volume du fichier source, rien d'atténué par défaut).

**Changement** :
- `player.js` : nouvelle `Map` `layerVolumes` (clé `layer-i` / `pool-i` → 0–1.5, défaut 1) à côté de `mutedVoices`/`soloedVoices`, même durée de vie (en mémoire, jamais persisté). `voiceGain(key)` multiplie désormais son résultat solo/muet par `getLayerVolume(key)` — un seul point de changement, tous les usages existants du gain (`refreshVoiceGains`, moteur simple, `playSimple`, `scheduleGeneration` quantifié, `scheduleSectionGeneration` vertical-random, ramp d'intensité sur clic des puces) en héritent automatiquement sans modification.
- `player.js` : nouveau `<input type="range">` (`voice-volume-slider`, min 0 / max 1.5 / step 0.01 / défaut 1) + valeur en % affichée à côté, ajouté dans `vertGraphHtml` (une ligne par couche, sous la ligne label/vumètre/S/M existante) et dans les `poolNodes` de `voiceGraphHtml` (sous la ligne du haut, au-dessus de la forme d'onde). Écouteurs `input` (retour audio + visuel immédiat, appelle `refreshVoiceGains()`) et `change` (tracking Umami `voice_volume_change` une seule fois à la valeur finale relâchée, pas à chaque pas du curseur) posés juste après ceux des boutons Solo/Muet.
- `layerpitch-i18n.js` : nouvelle clé `volumeTitle` (« Volume » / « Volume ») dans la zone `player`, fr et en, pour le `title`/`aria-label` du slider.
- `index.html`, `pack.html`, `layerpitch-backstage.html` : nouvelles règles CSS `.voice-row-wrap`, `.voice-volume-row` et `.voice-volume-value` (slider fin, thumb rond, couleur `--accent`, cohérent avec le reste du mixer), ajoutées à l'identique dans les trois fichiers juste après `.voice-ctrl-btn[data-voice-action="mute"].active`. Le slider s'aligne sous le vumètre en vertical classique (`padding-left: 138px`, largeur du label + l'espacement) ; en vertical-random, il occupe toute la largeur de la carte de pool (`padding-left: 0`).

**⚠️ Rappel de synchronisation** : `backstage.css` (feuille partagée du bac à sable local, non uploadée cette session) doit recevoir le même bloc CSS que `layerpitch-backstage.html` ci-dessus, sans quoi l'aperçu "Écouter" du bac à sable divergerait visuellement de la production.

**Vérification** : `node --check` sur `player.js` et `layerpitch-i18n.js` — OK. Symétrie FR/EN de la nouvelle clé `volumeTitle` vérifiée programmatiquement. Les 4 suites de tests jsdom existantes (`test_seq_transitions.js`, `test_seq_branching.js`, `test_embr_vertical_engine.js`, `test_backstage_seq_transitions.js`) n'ont pas été relancées cette session — fichiers de test non fournis dans les uploads ; aucune n'inspecte le mixer de voix (solo/muet/volume) donc risque de régression faible, mais à relancer côté Jules-Antoine avant publication.

---

## [2026-08-06] — Renommage "embranchement vertical" → "vertical à embranchement" + libellé dynamique pour le mode séquentiel

**Fichiers touchés** : `player.js`, `layerpitch-i18n.js`

**Contexte** : demande de Jules-Antoine — renommer le mode `embranchement-vertical` en "vertical à embranchement" (s'insère naturellement dans la même famille de libellés que "vertical additif" et "vertical randomisé"), et faire apparaître la possibilité d'embranchement dans le nom du mode séquentiel. Question ouverte tranchée avec lui : le mode séquentiel n'a l'embranchement que comme fonctionnalité optionnelle par emplacement (`nextOptions`), contrairement à l'embranchement-vertical où la bascule entre boucles nommées est la nature même du mode — un renommage statique aurait donc été trompeur pour un morceau séquentiel purement linéaire. Approche dynamique retenue : le badge affiché n'inclut "à embranchement" que pour les morceaux qui en ont réellement au moins un configuré.

**Changement** :
- `player.js` : `getModeLabel(mode)` devient `getModeLabel(mode, track)`. Pour `sequential`, vérifie si au moins un `segmentSlots[].nextOptions` est configuré (non vide) ; retourne alors `t('modeSequentialBranching')` au lieu de `t('modeSequential')`. Seul appelant existant (`buildTrackRow`, badge `.mode-tag` sur la page publique) mis à jour pour passer `track`.
- `layerpitch-i18n.js` (zones `player`, fr/en) : nouvelle clé `modeSequentialBranching` (« séquentiel à embranchement » / « branching sequential »). `modeEmbranchementVertical` fr renommé « embranchement vertical » → « vertical à embranchement » (l'anglais « vertical branching » restait déjà cohérent avec le nouvel ordre, inchangé).
- `layerpitch-i18n.js` (zone `backstage`, fr) : `modeOptionEmbranchementVertical` renommé en cohérence dans le sélecteur de mode du Backstage (« Embranchement vertical » → « Vertical à embranchement »). Le sélecteur `Séquentiel` reste volontairement statique — il précède la configuration du contenu, donc aucune information sur d'éventuels embranchements n'est disponible à ce stade.

**Vérification** : `node --check` sur les deux fichiers ; les 4 suites de tests existantes relancées sans modification (`test_seq_transitions.js`, `test_seq_branching.js`, `test_embr_vertical_engine.js`, `test_backstage_seq_transitions.js`) — 39/39 assertions passées, aucune régression (aucune n'inspecte le texte du badge de mode). Test manuel ad hoc confirmant les trois cas : séquentiel sans embranchement → "séquentiel", séquentiel avec au moins un embranchement → "séquentiel à embranchement", embranchement-vertical → "vertical à embranchement".

---

## [2026-08-06] — Backstage : panneaux visuels pour embranchements et pools d'alternatives

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : retour visuel de Jules-Antoine — dans l'éditeur d'un emplacement séquentiel ou d'un pool (vertical-random, alternatives séquentielles, variations Sfx), la section embranchements et la liste d'alternatives se fondaient visuellement dans la carte `.list-block` parente, sans repère pour les distinguer du reste du formulaire. Repris depuis la feuille de style partagée du bac à sable local (extraite du `<style>` de ce même fichier, qui avait déjà reçu ce correctif) — le principe du projet étant que ce fichier partagé fait foi et que le backstage en ligne doit suivre, jamais l'inverse.

**Changement** :
- Deux nouvelles règles CSS ajoutées au `<style>` de `layerpitch-backstage.html`, juste après `.list-block-head` (même emplacement que dans la feuille partagée) :
  - `.branch-options-panel` — liseré bleu (`var(--accent)`, la même couleur déjà associée au choix/à l'interactif via le retour visuel du glisser-déposer), fond `#f1f8fd`. Pour les embranchements, qui sont un choix laissé au visiteur.
  - `.alt-pool-panel` — liseré neutre (`#d8d8dc`), fond blanc. Pour les pools d'alternatives, qui ne sont pas un choix du visiteur mais du contenu (variations tirées au sort par le moteur).
- Markup : la classe `branch-options-panel` posée sur le conteneur des réglages `quantization`/`cutStyle` + liste d'embranchements d'un emplacement séquentiel (`hasBranches` coché). La classe `alt-pool-panel` ajoutée aux trois corps de pool existants (`data-role="altPoolBody"`) : alternatives d'un pool vertical-random, alternatives d'un emplacement séquentiel, variations round-robin d'un Sfx.
- Aucun changement de structure ni de logique — uniquement l'ajout de classes CSS sur des conteneurs déjà en place.

**Vérification** : `test_backstage_seq_transitions.js` relancé sans modification — 9/9 assertions passées, aucune régression sur la logique des embranchements séquentiels (case à cocher, sélecteurs quantization/cutStyle, fichier de transition).

---

## [2026-08-06] — Fix chevauchement audio à la coupure fine d'un embranchement séquentiel + repli de libellé cassé

**Fichiers touchés** : `player.js`, `layerpitch-i18n.js`

**Contexte** : bug signalé par Jules-Antoine — chevauchement audible entre l'ancien et le nouvel emplacement lors d'une coupure fine d'embranchement séquentiel (`performSeqBranchCut`, voir entrée du 04/08). Repéré en comparant la version corrigée dans le bac à sable local contre la version encore en ligne, qui n'avait pas reçu le fix.

**Diagnostic** : `performSeqBranchCut` n'annulait que la DERNIÈRE génération programmée (`seqNextScheduled`, référence unique). Le scheduler séquentiel programme jusqu'à 1s à l'avance (`seqSchedulerTick`) — un emplacement court pouvait donc empiler plusieurs générations futures (`source.start()` déjà appelé côté Web Audio, pas encore audibles) avant qu'une coupure ne survienne. Seule la plus récente était stoppée ; les autres continuaient de sonner par-dessus la nouvelle destination, Web Audio n'ayant aucun moyen de savoir qu'elles étaient devenues obsolètes tant qu'on ne les arrêtait pas explicitement une par une.

**Changement** :
- `player.js` : `seqNextScheduled` supprimé. Chaque entrée de `seqActiveSources` porte désormais son propre `ctxStartTime` (ajouté dans `scheduleSeqGeneration`). `performSeqBranchCut` filtre et stoppe maintenant TOUTES les générations dont `ctxStartTime > now` (pas encore audibles), pas seulement la dernière — la génération actuellement audible (`ctxStartTime <= now`) n'est jamais concernée, elle s'éteint séparément via son `gainNode`.
- `player.js` : `renderSeqBranchOptions` — un bouton d'embranchement sans `label` explicite ni `targetSlot.label` retombait sur l'id technique brut (`genId()`, illisible). Aligné sur le repli déjà utilisé côté éditeur Backstage : `t('slotFallback', {n})` → "Emplacement N" / "Slot N".
- `layerpitch-i18n.js` : `slotFallback` n'existait que dans la zone `backstage`, jamais consultée par `player.js` (qui ne lit que les zones `player`/`shared`) — sans ce déplacement, le repli ci-dessus aurait affiché la clé brute "slotFallback" au visiteur. Ajoutée à `fr.shared` et `en.shared`.

**Vérification** : `node --check` sur les deux fichiers ; suites Node/jsdom existantes relancées sans modification (`test_seq_transitions.js`, `test_seq_branching.js`, `test_embr_vertical_engine.js`, `test_backstage_seq_transitions.js`) — 39/39 assertions passées, aucune régression. `layerpitch-backstage.html` vérifié non affecté (n'expose ni ne consomme l'état interne modifié).

---

## [2026-08-04] — Embranchement séquentiel : coupure fine à la Wwise (`quantization`/`cutStyle`) + fichiers de transition par paire (`nextOptions[].transition`)

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`, `architecture.md`, `audio-engine.md`, `test_seq_transitions.js` (nouveau), `test_backstage_seq_transitions.js` (nouveau).

**Contexte** : objectif produit explicite du compositeur — que le passage de Wwise à LayerPitch ne demande aucune retouche de ses fichiers. Le modèle suit donc celui de Wwise : un fichier de transition est propre à une paire précise (source → cible), pas à l'emplacement dans son ensemble, exactement comme un Transition Object. Schéma discuté sur plusieurs allers-retours avant tout code (portée du réglage de quantification, granularité des transitions, comportement par défaut sans fichier, style de coupure) — voir décisions ci-dessous.

**Schéma** — deux nouveaux champs optionnels sur `segmentSlots[]` (`quantization`, `cutStyle`) et un troisième sur chaque entrée de `nextOptions[]` (`transition`) :
- `quantization` (`immediate` / `beat` / `bar`, défaut `bar`) : QUAND la bascule choisie prend effet — s'applique à tous les embranchements sortants de l'emplacement.
- `cutStyle` (`hard` / `fade`, défaut `fade` = 0.15s) : COMMENT l'emplacement source se termine à ce moment-là — même durée de fondu que les autres coupures courtes du morceau (solo/muet, embranchement-vertical).
- `nextOptions[].transition` (optionnel, `{label, bars, file}`) : fichier propre à CET embranchement précis. Absent : bascule directe. Présent : joué juste après la coupure, puis enchaînement classique vers la cible (chevauchement crossfade-tail existant, aucun mécanisme dupliqué).

**Le vrai chantier technique** : le scheduler séquentiel ne réévaluait jusqu'ici le bloc suivant qu'à la fin nominale du bloc en cours — rien ne pouvait l'interrompre en route. Ajout d'une surveillance de frontière fine (`armNextSeqBranchBoundary`) qui, tant qu'aucun choix n'est fait, se réarme frontière après frontière (temps ou mesure) sur l'emplacement actuellement audible ; dès qu'un choix est en attente à une frontière surveillée, `performSeqBranchCut()` coupe (net ou fondu), annule une répétition déjà programmée par le scheduler normal mais pas encore audible (fenêtre de programmation à l'avance d'1s), injecte la transition si elle existe (`forcedNextBlock`, consommée une seule fois par `decideNextSeqBlock`) puis rebascule sur le mécanisme normal pour la suite. `quantization: "immediate"` court-circuite entièrement cette surveillance : la coupure est déclenchée directement au clic. Protection par epoch (`seqBranchEpoch`) contre les chaînes de surveillance héritées d'un passage précédent tournant en double.

**Simplification en cours de route** : `pickNextSegmentSlot()`/`advanceFromSlot()` s'appuyaient sur un avancement automatique à la fin nominale du segment pour les emplacements à embranchements — devenu incohérent avec la coupure fine (qui doit pouvoir intervenir bien avant cette fin). Tranché avec le compositeur : l'avancement automatique n'a plus lieu d'être dès lors que le visiteur peut cliquer pour choisir — un tel emplacement ne quitte donc plus jamais sa position tout seul, `advanceFromSlot()` supprimé (mort), `pickNextSegmentSlot()` simplifié en conséquence.

**Décisions prises en cours de route** (schéma discuté avant code, conformément au protocole) :
- Granularité de `quantization`/`cutStyle` : par emplacement (pas par morceau, pas par embranchement individuel).
- Granularité de `transition` : par embranchement individuel (paire précise), pas par emplacement — c'est le point qui distingue ce chantier d'un simple "fichier de transition partagé".
- Enchaînement transition → cible : chevauchement crossfade-tail classique (comme un enchaînement normal), jamais de coupure nette à cette jonction précise (seulement à la sortie du segment source).
- Sans fichier de transition défini pour un embranchement donné : la quantification (`quantization`) s'applique quand même, juste sans fichier intermédiaire.
- Valeurs par défaut pour les emplacements existants sans ces champs (déjà publiés avant ce chantier) : `quantization: "bar"`, `cutStyle: "fade"` — rétrocompatibilité totale, comportement pratiquement inchangé pour eux (un segment d'une seule mesure, cas le plus courant, voit sa frontière de mesure coïncider avec sa fin naturelle).

**Bug réel trouvé et corrigé en cours de route** : `currentSeqBlockInfo.gain` contenait la valeur numérique du gain (utilisée pour l'affichage), pas le `GainNode` lui-même — `performSeqBranchCut()` plantait en tentant d'y appeler `cancelScheduledValues`. Corrigé en faisant remonter le vrai `GainNode` à travers toute la chaîne (`scheduleSeqGeneration` → `scheduleSeqLabelUpdate` → `activateSeqStage`, nouveau champ dédié `gainNode` dans `currentSeqBlockInfo`, distinct de `gain`).

**Backstage** : sélecteurs `quantization`/`cutStyle` affichés dès que "prévoir un ou plusieurs embranchements" est coché. Case à cocher + éditeur de fichier par embranchement (réutilise `fileCtrlHtml`/`wireFileControl`, même convention que partout ailleurs). Sérialisation complète (aperçu, import/export data.json, upload à la publication, fiche d'implémentation enrichie avec le détail quantification/coupure/transition par embranchement).

**Vérifications menées** : `node --check` sur tous les fichiers touchés — tout passe. Symétrie FR/EN vérifiée programmatiquement sur `layerpitch-i18n.js` (player 48→48, backstage 482→482, shared 8→8) et `layerpitch-help.js` (37→37) — aucun écart. Deux nouveaux tests : `test_seq_transitions.js` (coupure "bar" mi-segment avec transition, confirmée à ~85ms — bien avant les 800ms de fin naturelle du segment de test ; coupure "immediate" quasi instantanée à ~22ms, distincte de "bar") et `test_backstage_seq_transitions.js` (apparition conditionnelle des sélecteurs et du contrôle de fichier, valeurs par défaut, persistance après re-rendu). **Les 11 suites de tests (9 existantes + 2 nouvelles) toutes vertes ensemble, aucune régression.**

**Pas encore fait** : aucun test d'écoute réel (comme toujours, à valider par Jules-Antoine avant publication). Les commentaires de code de cette session référencent parfois "02/08" (date de la discussion de schéma) alors que le code a été livré le 04/08 — sans conséquence fonctionnelle, mentionné ici par souci d'exactitude.

**Passe de nettoyage/débogage supplémentaire (même jour)** — demande explicite de repasser sur le nouveau code avant de considérer le chantier refermé :
- **Bug réel n°1** : une demande "aller vers la fin" déjà en attente (bouton cliqué en premier) écrasait silencieusement un choix d'embranchement précis fait juste après — `decideNextSeqBlock()` routait vers l'outro au lieu de la cible choisie, sans que rien ne prévienne le visiteur que son clic avait été ignoré. Corrigé : un choix de cible précis (plus spécifique) annule maintenant la demande de fin en attente, plutôt que l'inverse.
- **Bug réel n°2, introduit par la correction du bug n°1** : le correctif remettait `goToEndBtn.disabled` à `true` au lieu de `false` (motif "désactiver" copié depuis un autre endroit du fichier sans être adapté au sens inverse voulu ici) — le bouton restait bloqué sur "en cours de fin" alors que la demande venait d'être annulée. Trouvé par le test de non-régression écrit pour le bug n°1 lui-même, corrigé dans la foulée.
- Micro-optimisation : suppression d'un appel `setValueAtTime` redondant dans la coupure nette (`cutStyle: "hard"`) — l'ancienne valeur du gain était ancrée puis immédiatement écrasée par la valeur cible, sans jamais être utilisée entretemps.
- Recherche exhaustive de références résiduelles à l'ancien `advanceFromSlot` (supprimé) : aucune trouvée. Fonctions dupliquées et cohérence `data-role` revérifiées : rien de nouveau par rapport aux passes précédentes.
- Un troisième scénario ajouté à `test_seq_transitions.js` pour figer le bug n°1 (et par ricochet le n°2, trouvé en écrivant ce test) en non-régression : demande "aller vers la fin" suivie d'un choix d'embranchement précis, doit atterrir sur la cible choisie et réinitialiser proprement le bouton.

**Les 11 suites de tests (dont le nouveau scénario) toutes vertes ensemble après ces deux correctifs.**

---



**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `index.html`, `pack.html`, `layerpitch-i18n.js`, `layerpitch-help.js`, `test_embr_vertical_engine.js` (nouveau), `test_seq_branching.js` (nouveau). `collection.html` relu, non modifié (voir plus bas).

**Contexte** : schéma discuté et validé avant tout code (architecture puis relecture de `player.js`/`layerpitch-backstage.html` avant implémentation, conformément au protocole habituel). Décision en cours de route : `embranchement-séquentiel`, envisagé un temps comme un mode à part entière, a été abandonné au profit d'une option (`nextOptions`) directement sur le mode `sequential` existant — plus cohérent avec la discipline de réutilisation maximale, la différence n'étant qu'un comportement local sur certains emplacements, pas un moteur différent.

**1. Mode `embranchement-vertical` (nouveau, entièrement inédit)** :
- N boucles nommées et autonomes, calées sur un même BPM/mesures au niveau du morceau. La boucle marquée `isInitial` sert de référence de cycle. Les boucles de même longueur (`bars` égal à la référence) tournent en continu en arrière-plan (silencieuses sauf celle active), verrouillées en phase — bascule entre elles par pure rampe de gain (0.15s, réutilise exactement le mécanisme du solo/muet existant, `refreshVoiceGains`), sans redémarrage audio donc sans décalage.
- Une boucle plus courte que la référence n'est PAS jouée en arrière-plan (pas de verrouillage de phase naturel) : au clic, lecture fraîche en fondu d'entrée, lecture unique, puis retour automatique à la boucle de référence une fois sa durée nominale (en mesures) écoulée. Bouton désactivé pendant ce détour (validé le 31/07 — pas de retrigger possible).
- Nouvelles fonctions dans `player.js` : `scheduleEmbrGeneration`, `embrSchedulerTick`, `refreshEmbrGains`, `playEmbrVertical`, `stopEmbrVertical`, `selectEmbrLoop`. Réutilise `blockSeconds()` du moteur séquentiel (une seule notion de "durée en mesures" dans tout le fichier), pas de moteur parallèle dupliqué.
- Backstage : nouvel éditeur de boucles nommées (label, mesures, radio "boucle de référence", contrôle de fichier, réordonnancement) dans la section Structure, bloc BPM/mesures dédié (sans le choix "simple vs quantifié", sans notion de chaîne — non pertinents ici). Sérialisation complète : aperçu (`buildPreviewTrackObject`), import/export data.json, upload des fichiers à la publication, fiche d'implémentation (`describeEmbrVert`).
- CSS : `.embr-loop-btn` (classe dédiée, volontairement distincte de `.intensity-chip` pour ne pas hériter du sélecteur de niveau d'intensité vertical classique).

**2. `nextOptions` sur `sequential` (option, rétrocompatible)** :
- Nouveau champ optionnel `nextOptions` sur `segmentSlots[]` : liste de `{ targetId, label }`. Absence du champ = comportement strictement inchangé pour tous les morceaux existants (avancement automatique par `advanceChainIndex`).
- Présence du champ : au lieu d'avancer automatiquement, le moteur affiche des boutons nommés (les cibles possibles) et attend un choix explicite du visiteur. Tant qu'aucun choix n'est fait, l'emplacement se rejoue à l'identique (`repeatCount` ignoré — n'a plus de sens dans ce cas, validé le 31/07). Un clic met en file le choix (`pendingNextSegmentId`) ; un second clic sur une autre option écrase le premier (dernier clic gagne, validé le 31/07) ; la bascule effective attend le prochain point de quantification du scheduler séquentiel existant (aucune modification du timing lui-même).
- Nouvelle fonction pure `advanceFromSlot()` dans `player.js`, remplace les deux appels directs à `advanceChainIndex()` dans `pickNextSegmentSlot()`. `slotIdx` propagé à travers toute la chaîne de scheduling (`decideNextSeqBlock` → `scheduleSeqGeneration` → `scheduleSeqLabelUpdate` → `activateSeqStage`) pour que les boutons affichés correspondent toujours à l'emplacement réellement audible. Choix en attente préservé à travers un `seek` (même principe que `goToEndRequested`), réinitialisé à un vrai arrêt.
- Backstage : case à cocher "prévoir un ou plusieurs embranchements" par emplacement, révélant un éditeur de cibles (sélecteur d'emplacement + libellé optionnel, ajout/suppression). Sérialisation complète (aperçu, import/export data.json, fiche d'implémentation avec note explicite sur les embranchements). L'option `branching` (placeholder grisé "à venir" dans le sélecteur de mode) est retirée — devenue obsolète, remplacée par ces deux chantiers concrets.
- CSS : `.seq-branch-options` / `.seq-branch-btn` / `.seq-branch-btn.pending` / `.seq-pending-indicator` ("en attente de bascule").

**Vérifications menées** : syntaxe (`node --check` sur `player.js`, `layerpitch-i18n.js`, `layerpitch-help.js`, et sur le bloc `<script>` extrait de `layerpitch-backstage.html`) — tout passe. Symétrie FR/EN vérifiée programmatiquement sur `layerpitch-i18n.js` (namespaces `player` 47→47, `backstage` 470→470, `shared` 8→8, aucun écart) et sur `layerpitch-help.js` (34→34, aucun écart). Recoupement automatique clés utilisées (`t()`/`tr()` dans `player.js`/`layerpitch-backstage.html`) vs clés définies : aucune clé manquante. Recoupement attributs `data-help` vs clés `layerpitch-help.js` : les 4 nouvelles clés (`bpmMeasuresEmbrVert`, `embrLoopsSection`, `slotHasBranches`, `embrLoopInitial`) correctement appariées (les autres écarts détectés par le script sont préexistants, hors périmètre de cette session). `collection.html` vérifié : ne restitue aucun lecteur de morceau (juste une liste de packs), donc aucun CSS à y ajouter — dossier refermé sans modification.

**Deux nouveaux tests écrits, même infrastructure que les suites existantes (horloge fictive temps réel, pas de faux "tick manuel")** :
- `test_embr_vertical_engine.js` : boutons nommés présents, boucle de référence active par défaut, bascule immédiate entre boucles de même longueur (pas d'attente de quantification), boucle courte désactivée pendant son détour puis retour automatique à la référence.
- `test_seq_branching.js` : aucun avancement automatique tant qu'aucun choix n'est fait (repeatCount ignoré), libellé personnalisé vs repli sur le nom de l'emplacement cible, indicateur "en attente" affiché/masqué au bon moment, dernier clic gagne (B puis C avant bascule → atterrit bien sur C).

**Bug réel trouvé et corrigé par `test_embr_vertical_engine.js`** : le retour automatique à la boucle de référence après un détour (boucle courte) remettait bien le gain audio à 1, mais oubliait d'appeler `updateEmbrButtonsUI()` — le bouton affiché comme "actif" restait figé sur l'ancien état alors que l'audio était déjà revenu à la référence. Corrigé dans `player.js` (callback du `setTimeout` de fin de détour).

**Les 9 suites de tests (7 existantes + 2 nouvelles) toutes vertes, exécutées ensemble sans régression.**

**Passe de nettoyage/débogage supplémentaire (même jour)** — demande explicite de repasser sur le code produit avant de considérer le chantier refermé, même discipline que la passe du 30/07 :
- **Second bug réel trouvé et corrigé** dans le moteur `embranchement-vertical` : interrompre un détour (boucle courte) avant sa fin naturelle — en cliquant sur une autre boucle, ou en arrêtant la lecture — laissait la source audio du détour orpheline (jamais coupée) et son bouton bloqué en désactivé. Cause : la source du détour n'était référencée que dans une fermeture locale, invisible pour `stopEmbrVertical()` ou un second appel à `selectEmbrLoop()`. Corrigé par une fonction dédiée `fadeOutCurrentDetour()`, réutilisée à la fois pour le retour naturel à la référence, l'interruption volontaire par un nouveau choix, et l'arrêt global — un seul chemin de nettoyage au lieu de plusieurs copies partielles.
- Variable morte retirée (`currentBranchSlotIdx`, assignée mais jamais lue).
- Recherche exhaustive de références résiduelles à l'ancien placeholder `branching` : aucune (les 3 occurrences du mot restantes sont des textes anglais légitimes, pas des vestiges).
- Fonctions dupliquées (`decodeAudioDataCompat`, `getVorbisDecoder`, `fractionFromEvent`, `render`, `renderList`) : toutes préexistantes à cette session (confirmé par comparaison avec les fichiers uploadés d'origine), fermetures indépendantes légitimes — aucune introduite ni aggravée ici.
- Cohérence `data-role` (déclarés dans les gabarits vs lus par `querySelector`/`querySelectorAll`) sur `player.js` : aucun écart, y compris pour les nouveaux rôles (`embrLoopPicker`, `seqBranchOptions`, `seqPendingIndicator`).
- Trois nouveaux scénarios ajoutés à `test_embr_vertical_engine.js` pour figer le bug corrigé en non-régression : interruption d'un détour avant sa fin naturelle (bouton réactivé immédiatement, bascule directe vers le nouveau choix), ré-déclenchement de la même boucle après une interruption (état bien nettoyé, pas de blocage permanent), arrêt complet pendant un détour en cours (aucune erreur, tous les boutons réactivés).

**Pas encore fait** : aucun test d'écoute réel (comme toujours, à valider par Jules-Antoine avant publication).

---



## [2026-07-31] — Nombre de boucles généralisé : `maxChainLoops` (chaîne entière), séquentiel + vertical-random

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`, `test-section-scheduler.js`, `test-slot-chain-advancer.js` (nouveau), `test_backstage_maxchainloops.js` (nouveau), `test_max_chain_loops_e2e.js` (nouveau)

**Contexte** : chantier discuté en fin de session le 30/07, pas encore codé — généraliser l'affichage/réglage du "nombre de boucles" à tous les modes qui peuvent en bénéficier. Nouveau champ partagé `track.maxChainLoops` (nullable, null = illimité) : combien de fois la **chaîne entière** se répète avant transition automatique vers l'outro (ou fin naturelle sans outro) — réglable compositeur (backstage) et visiteur (page publique), indépendant de `section.maxLoops` (par section, vertical-random) et de `track.maxLoops` (moteur quantifié classique, inchangé).

**Incrément 1 — logique pure, testée sans son réel** :
- Vertical-random (`createSectionPlaybackScheduler`) : `advanceOrder()` compte les cycles complets (retour à `orderPos = 0`) et déclenche `goToEndRequested` au seuil — réutilise le mécanisme "aller vers la fin" existant. `options.maxChainLoops` relu à chaque cycle (pas figé à la création) pour supporter un getter live côté appelant. 4 nouveaux scénarios dans `test-section-scheduler.js` (9 à 12), les 8 scénarios existants inchangés.
- Séquentiel : nouvelle fonction pure `advanceChainIndex` (aucune closure, aucune dépendance audio), factorise les deux avancements jusque-là dupliqués dans `pickNextSegmentSlot` (emplacement vide sauté / `repeatCount` épuisé — les deux avancent la chaîne pour la même raison). Compte les cycles, expose `capReached`, consommé par `pickNextSegmentSlot` pour déclencher `goToEndRequested`. Nouveau fichier `test-slot-chain-advancer.js`, 5 scénarios.
- `chainState` (séquentiel) remis à zéro à un vrai redémarrage (pas une reprise), même convention que `currentSlotIndex`.

**Incrément 2 — backstage** :
- **Bug trouvé et corrigé en route** (hors périmètre initial, corrigé sur confirmation) : le bloc "Tempo" affichait encore un sélecteur "moteur de bouclage" (+ BPM/mesures/points de boucle/nombre de boucles par défaut au niveau morceau) pour le **vertical-random** — mort depuis la fusion du 30/07, chaque section ayant désormais son propre tempo. `hasTempoSection` et le ternaire associé excluent maintenant `isVerticalRandom`.
- Nouveau sélecteur `maxChainLoops` : dans le bloc Tempo pour le séquentiel, dans le bloc Structure (à côté de "randomiser l'ordre") pour le vertical-random. Sérialisé partout où `maxLoops` l'était déjà au niveau morceau (aperçu, création par défaut, fiche technique texte + JSON, lecture/écriture `data.json`).
- Nouvelles clés `maxChainLoopsLabel`, `maxChainLoopsHint`, `maxChainLoopsHintVerticalRandom` (i18n) et `maxChainLoops`/`maxChainLoopsVerticalRandom` (help.js, édité directement sur confirmation malgré l'avertissement "jamais à la main" de l'en-tête du fichier — ajout simple, même format que l'existant). Symétrie FR/EN vérifiée programmatiquement (555→557 clés i18n, 77 clés help, 0 écart).
- Nouveau test `test_backstage_maxchainloops.js` : champ mort disparu pour le vertical-random, nouveau champ présent et persistant après re-rendu pour les deux modes, BPM/mesures séquentiel non cassés par le fix.

**Incrément 3 — page publique (`player.js`)** :
- `useQuantizedLoopForUI` restreint au moteur quantifié classique (retrait de `isVerticalRandom`, qui écrivait sans effet dans `track.maxLoops` — mort côté moteur depuis la fusion, confirmé via `useQuantizedLoop` qui l'exclut déjà explicitement).
- Nouveau sélecteur "nombre de cycles avant la fin" (séquentiel + vertical-random), lié à `track.maxChainLoops`, appliqué au vol (mutation directe de `track.maxChainLoops`, lu en direct par `pickNextSegmentSlot` et par un getter passé à `createSectionPlaybackScheduler`).
- Vertical-random : une ligne de petits sélecteurs sous les blocs de section (un par section, affichés en permanence — décision du 31/07), liés à `section.maxLoops`, mutant en place `vrPlayableSectionRefs[j]` (le même objet réellement lu par le scheduler) — aucun effet si la section n'est pas jouable (no-op silencieux).
- Nouveau test de bout en bout `test_max_chain_loops_e2e.js` : arrêt automatique réel sans clic manuel (VR et séquentiel), changement du sélecteur en cours de lecture, mutation live du nombre de boucles par section. Note : un changement en direct ne prend effet qu'après la fenêtre de lookahead du scheduler (jusqu'à ~1s de générations déjà programmées) — comportement préexistant, pas introduit ici, juste rendu visible par ce nouveau test.

**Vérifications menées** : syntaxe (`node --check` + extraction des blocs `<script>` du backstage), symétrie FR/EN programmatique (i18n + help), 7 suites de tests indépendantes toutes vertes (`test-slot-chain-advancer`, `test-section-scheduler`, `test_quantized_loop_engine`, `test_vr_engine`, `test_player_regression`, `test_backstage_maxchainloops`, `test_max_chain_loops_e2e`).

**Pas encore fait** : aucun test d'écoute réel (comme toujours, à valider par Jules-Antoine avant publication).

---

## [2026-07-30] — Passe de relecture/nettoyage sur l'ensemble du chantier du jour

**Fichiers touchés** : `player.js`, `layerpitch-i18n.js`, `test_quantized_loop_engine.js` (nouveau)

**Contexte** : demande explicite de repasser sur tout le code produit dans la journée (fusion des modes, moteur de lecture, barre de progression par section) avant de considérer le chantier refermé — même discipline de vérification exhaustive qu'après tout changement majeur (syntaxe, symétrie FR/EN, clés orphelines, fonctions dupliquées, cohérence des références DOM).

**Vérifications menées** :
- Symétrie FR/EN complète sur les ~540 clés de `layerpitch-i18n.js` : aucun écart.
- Recoupement clés définies / clés réellement utilisées sur `player.js`, `layerpitch-backstage.html`, `index.html`, `pack.html` (`collection.html`/`video-test.html` non touchés aujourd'hui, exclus du recoupement) : une seule clé orpheline trouvée et supprimée (`loadErrorNoFixedLayers`, FR+EN — reliquat de l'ancien éditeur couches fixes/groupes, remplacée depuis par `loadErrorNoSections`).
- Recherche exhaustive de toute référence résiduelle à l'ancien schéma (`fixedLayers`, `randomGroups`, `referencesGroupId`, `fixedBuffers`, `groupBuffers`, `vertical-random-sequential`) dans tous les fichiers touchés aujourd'hui : aucune, hors code de migration légitime et deux commentaires devenus obsolètes (corrigés — ils citaient encore `canonicalGroupKey`, remplacée par `canonicalPoolKey`).
- Vérification des noms de fonctions dupliqués dans `player.js` et `layerpitch-backstage.html` : les doublons trouvés (`getVorbisDecoder`, `fractionFromEvent`, `render`, `renderList`) sont tous des fermetures indépendantes dans des portées distinctes (une par piste, un widget par type de bloc) — légitimes, pré-existants pour la plupart, pas de conflit réel.
- Cohérence des références `data-role` (dynamiques et statiques) entre déclaration dans les gabarits et lecture par le code JS, pour tous les rôles liés au vertical-random : aucun écart.
- **Bug réel trouvé et corrigé** : `stopAllSources` calculait encore `offsetAt` pour le vertical-random à l'arrêt — un calcul devenu mort depuis la fusion (le moteur reprend désormais via l'état conservé de `sectionScheduler`, jamais via `offsetAt`, comme le séquentiel). Retiré, avec le même commentaire explicatif que pour le séquentiel.
- Commentaires obsolètes corrigés : `introBuffer`/`outroBuffer` étaient encore documentés comme "spécifique au séquentiel" alors qu'ils sont désormais partagés avec le vertical-random depuis la fusion.
- Nouveau test ciblé (`test_quantized_loop_engine.js`) : confirme que le moteur de boucle quantifiée classique (vertical/statique avec `loopEngine: 'quantized'`) fonctionne toujours après la généralisation de `buildLoopTimelineEl` pour un usage par section — n'avait pas été vérifié explicitement dans les passes précédentes.
- Les quatre suites de tests (`test-section-scheduler.js`, `test_vr_engine.js`, `test_player_regression.js`, `test_quantized_loop_engine.js`) rendues indépendantes et exécutables isolément (aucune ne dépend plus d'un fichier de montage généré séparément).

**Conclusion** : aucun autre problème trouvé. Le code du jour est cohérent, sans référence résiduelle à l'ancien schéma, sans clé i18n orpheline, et les quatre suites de tests passent de façon indépendante.

---

## [2026-07-30] — Barre de progression par section (vertical-random), cliquable

**Fichiers touchés** : `player.js`, `index.html`, `pack.html`, `layerpitch-backstage.html`, `test_vr_engine.js`

**Contexte** : suite de l'incrément 2 (moteur vertical-random) — demande explicite de remplacer la barre de progression unique (rendue non interactive lors de la fusion, faute de position temporelle cohérente sur plusieurs sections) par une barre **par section**, qui reste cliquable.

**Changement** :
- Un bloc de progression par section déclarée (réutilise le style `.seq-block` déjà existant du mode séquentiel — mêmes blocs visuels, principe déjà connu), affiché dans le graphe de voix.
- Seul le bloc de la section **actuellement audible** est cliquable/glissable (`.seq-block.active`) — chercher une position n'a de sens que dans la section qui joue réellement ; les autres restent de simples repères visuels.
- Nouvelle fonction `seekVerticalRandom(fraction)` : recherche à l'intérieur du cycle de la section en cours sans faire avancer la chaîne (même esprit que `rerollPool`, déjà existant).
- CSS ajoutée dans les trois pages qui affichent des morceaux (`index.html`, `pack.html`, `layerpitch-backstage.html` — `collection.html` n'affiche pas de lecteur de morceau directement, pas concernée).

**Bug réel découvert et corrigé grâce à cette extension** : le libellé "section en cours" et la mise en valeur du bloc actif se mettaient à jour **au moment où la lecture est programmée à l'avance** (jusqu'à 1 seconde avant qu'elle ne s'entende réellement), pas au moment où elle devient audible. Avec la fenêtre de programmation anticipée du scheduler, une section à très peu de boucles pouvait être décidée puis aussitôt dépassée en une seule fois — l'affichage risquait de sauter directement à la section suivante sans jamais montrer la précédente, ou de refléter une section jamais réellement entendue par le visiteur. Corrigé en alignant sur le mécanisme déjà utilisé ailleurs (le libellé de la section séquentielle, lui, était déjà correctement différé) : la mise à jour de l'affichage attend maintenant le moment réel où le son se fait entendre, via le même délai que l'indicateur des pools.

**Vérification** : suite de tests étendue (`test_vr_engine.js`, 14 vérifications au total désormais) — un bloc par section, mise en valeur correcte du bloc actif, clic sans effet sur un bloc inactif, recherche fonctionnelle sur le bloc actif sans faire avancer la chaîne, et non-régression complète sur le reste du moteur (avancement automatique, "section suivante", "aller vers la fin"). Le bug de timing ci-dessus n'a été repéré QUE grâce à ce test — sans lui, il serait passé inaperçu jusqu'à un usage réel.

**Points ouverts** : inchangés depuis l'entrée précédente (duplication de pool sans interface, bulles d'aide, finition visuelle du graphe) — plus un vrai test d'écoute qui reste nécessaire avant validation définitive.

---

## [2026-07-30] — Moteur de lecture vertical-random (incréments 1 et 2)

**Fichiers touchés** : `player.js`, `layerpitch-i18n.js`, `test-section-scheduler.js` (nouveau), `test_vr_engine.js` (nouveau), `test_player_regression.js` (nouveau)

**Contexte** : suite directe de la fusion "Vertical random séquentiel" → "Vertical random" (entrée précédente) — le schéma de données et l'éditeur backstage étaient prêts, restait le moteur de lecture réel dans `player.js`. Vu la nature différente de ce chantier (un moteur audio temps réel ne se vérifie pas par de simples tests structurels — il faut l'entendre pour juger du calage), découpage en deux incréments distincts plutôt qu'un bloc monolithique, décision actée explicitement avec Jules-Antoine.

**Incrément 1 — logique pure d'enchaînement** : `createSectionPlaybackScheduler`, une fonction sans aucune dépendance à Web Audio ni au DOM, qui décide uniquement *quoi jouer ensuite* (intro / quelle section / outro), jamais *comment*. Comportements couverts et testés indépendamment (`test-section-scheduler.js`, 8 scénarios, 13 vérifications) : boucle infinie à une seule section (rétrocompatibilité avec l'ancien vertical-random), avancement automatique par nombre de boucles, "Aller vers la section suivante" sans répétition superflue, "Départ" appliqué uniquement au tout premier passage de chaque section, "Aller vers la fin" avec et sans outro, brassage complet équitable (y compris avec des sections dupliquées type AABA, vérifié sur 100 cycles).

**Incrément 2 — branchement Web Audio** : traduction des décisions du scheduler pur en programmation réelle de sources sonores.
- Nouveau modèle de buffers `sectionBuffers[section][pool][alternative]`, remplaçant l'ancien `fixedBuffers`/`groupBuffers` — chargement en deux passes (contenu réel, puis alias pour les sections dupliquées), même principe que les autres duplications du projet.
- Chaque section garde son propre tempo/timeline au moment de jouer (`sectionTiming()`), plus de constantes figées au niveau du morceau pour ce mode.
- Graphe de voix (Wwise Voice Graph) généralisé en "emplacements de pool" génériques plutôt que couches fixes/groupes distincts — dimensionné au plus grand nombre de pools parmi toutes les sections, les emplacements excédentaires étant masqués section par section (même mécanisme que les tirages silencieux déjà existants).
- Moteur quantifié classique (vertical/statique en boucle quantifiée) et moteur vertical-random maintenant clairement séparés — le premier ne connaît plus du tout la logique de sections.
- `rerollPool` réécrit : rejoue la section en cours avec de nouveaux tirages sans faire avancer la chaîne d'un cran (ne consomme pas de budget de boucles).
- **Simplification assumée** : la barre de progression de ce mode n'est plus interactive (pas de recherche par glissement) — avec plusieurs sections potentiellement enchaînées dans un ordre mélangé, "une position dans le temps" n'a plus de cible de recherche unique et cohérente vers laquelle glisser. Elle reste un indicateur visuel de progression dans la section en cours. À confirmer avec Jules-Antoine si ce compromis lui convient, ou s'il préfère une autre approche.
- Zip de téléchargement gratuit (`collectTrackAudioFiles`) mis à jour pour inclure les fichiers du nouveau format sections/pools.

**Vérification** : `test_vr_engine.js` — test de bout en bout avec un faux `AudioContext` qui simule fidèlement le comportement réel (horloge basée sur le temps réel écoulé, `onended` déclenché après la durée du buffer ou un `stop()` explicite, exactement comme un vrai navigateur) : chargement, intro, avancement automatique par nombre de boucles, "section suivante" manuelle, "aller vers la fin" menant à l'outro puis à l'arrêt naturel — 9 vérifications, toutes passées. `test_player_regression.js` : non-régression confirmée sur les modes statique, vertical classique et séquentiel après le refactor (chacun charge, joue, et réagit à ses contrôles propres sans erreur).

**Limite assumée de cette vérification** : aucun son réel n'a été entendu — la suite de tests valide la logique de programmation (quoi se déclenche, quand, dans quel ordre) mais pas la qualité perçue du calage à l'oreille. Un vrai test d'écoute par Jules-Antoine reste nécessaire avant de considérer ce moteur définitivement validé.

**Points ouverts** :
- Barre de progression non interactive pour ce mode (voir simplification assumée ci-dessus) — à valider ou à revoir.
- Duplication de pool à l'intérieur d'une section (`referencesPoolId`) : toujours pas d'interface, cf. entrée précédente.
- Bulles d'aide contextuelles toujours pas ajoutées (étape 3, inchangé).
- Graphe de voix : plus de connecteurs SVG individualisés par couche fixe/groupe comme avant la fusion — désormais générique par emplacement de pool. Fonctionnellement équivalent, esthétiquement simplifié ; à revoir si Jules-Antoine souhaite plus de finition visuelle une fois le calage audio confirmé à l'oreille.

---

## [2026-07-30] — Fusion de "Vertical random séquentiel" dans "Vertical random" (bilan de la session)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : après l'étape 1 du nouveau mode "Vertical random séquentiel" (entrée précédente), constat avec Jules-Antoine que ce mode et le vertical-random existant se recouvrent largement — le vertical-random n'est jamais qu'un cas particulier à une seule section, qui rejoue en boucle sur elle-même. Décision de les fusionner sous l'identifiant `vertical-random` existant plutôt que de maintenir deux modes proches.

**Recherche menée avant l'architecture** : comportement du modèle de segments Wwise (Entry Cue/Exit Cue, pre-entry/post-exit, dovetailing) et de son ancêtre DirectMusic — confirme qu'un point de départ ne s'applique qu'à la toute première lecture d'un segment, jamais aux passages suivants même en boucle, ce qui valide directement le comportement voulu pour le repère "Départ" dans une chaîne à plusieurs sections.

**Décision d'architecture retenue** : chaque section porte désormais son **propre** tempo/timeline (BPM, mesures, repères Départ/Entrée/Sortie, nombre de boucles par défaut) — comme un vrai segment Wwise indépendant — plutôt qu'un tempo unique partagé par tout le morceau. Le cas à une seule section (l'ancien vertical-random) garde un comportement strictement identique à avant.

**Changement** :
- Mode `vertical-random-sequential` retiré du menu déroulant — entièrement fusionné dans `vertical-random`.
- Chaque section a maintenant son propre BPM/mesures/timeline (réutilise le composant `buildLoopTimelineEl`, généralisé pour accepter n'importe quel objet porteur de tempo — le morceau ou une section) et son propre nombre de boucles par défaut.
- L'éditeur "couches fixes + groupes aléatoires" au niveau du morceau est supprimé — tout vit désormais dans `sections[].pools[]`. Une couche fixe devient un pool à un seul fichier ; un groupe aléatoire devient un pool à plusieurs fichiers — même distinction que celle déjà actée pour ne garder qu'un seul concept de pool.
- **Migration douce automatique** au chargement : un morceau déjà publié dans l'ancien format vertical-random (tempo/timeline unique, couches fixes + groupes aléatoires au niveau du morceau) devient une unique section qui reprend tout à l'identique — mêmes fichiers, même timeline, mêmes probabilités, comportement de lecture strictement inchangé. Vérifiée directement sur le morceau réel publié ("Victory !", 1 couche fixe + 6 groupes) : migration correcte vers 1 section à 7 pools.
- `describeVerticalRandom`/`describeVerticalRandomSequential` fusionnés en une seule fonction pour la fiche d'implémentation, avec description du tempo par section.
- `publishAll`/`loadData`/`buildPreviewTrack`/`togglePreview` mis à jour pour le nouveau schéma ; ancien format `fixedLayers`/`randomGroups` retiré de la sortie publiée (toujours lu en entrée pour la migration).
- 15 clés i18n orphelines retirées (FR+EN, 30 lignes) : `fixedLayersLabel`, `randomGroupsLabel`, `noFixedFileWarning`, `fixedLayersDropHint`, `addFixedLayerBtn`, `addGroupBtn`, `groupNamePlaceholder`, `removeGroupBtn`, `namePlaceholderFixed`, `removeFixedLayerBtn`, `groupDuplicateHint`, `fixedLayerFallback`, `fixedLayerFallbackShort`, `groupAltLabel`, `modeOptionVerticalRandomSequential`.
- CSS de zone de dépôt vide (bordure pointillée + texte d'invite) recalée sur les data-role réellement utilisés aujourd'hui (`poolAlternatives`, `slotAlternatives`) — pointait vers des data-role obsolètes depuis un moment déjà, avant même cette session.

**Bug rencontré et corrigé en cours de route** : lors de la fusion, une étape de découpage/re-collage de blocs de code a supprimé par erreur le `} else {` séparant la branche séquentielle de la branche par défaut (vertical/statique) — les deux blocs se retrouvaient accolés sans séparateur. Conséquence : passer une piste de vertical-random vers séquentiel faisait planter le rendu (tentative d'insertion dans un conteneur DOM inexistant en mode séquentiel). Repéré uniquement grâce à la suite de tests de non-régression (le rendu plantait au changement de mode, pas à l'affichage initial) — sans cette suite, le bug serait passé inaperçu jusqu'à un usage réel. Un premier réflexe de déboguer via les numéros de ligne des traces d'erreur s'est avéré trompeur (la présence de plusieurs balises `<script>` distinctes dans le montage de test brouille la numérotation rapportée par le moteur JS) ; la localisation exacte a nécessité de poser des marqueurs de log directement dans le code, un par un, jusqu'à isoler la ligne fautive.

**Vérification** : suite de tests Node/jsdom étendue — mode vertical-random fusionné (timeline par section, duplication de section, aucune trace de l'ancien éditeur couches fixes/groupes), non-régression complète sur séquentiel/vertical/statique, **et** un test dédié rejouant le chargement du `data.json` réellement publié (12 morceaux, tous modes confondus) pour confirmer que la migration automatique fonctionne sur les vraies données de production, pas seulement des données de test fabriquées.

**Points ouverts** :
- Duplication de pool à l'intérieur d'une même section (l'équivalent de l'ancien `referencesGroupId`) : le champ `referencesPoolId` existe dans le schéma pour la fidélité d'aller-retour des données, mais aucune interface ne permet encore de le régler (aucun groupe du morceau réel migré ne l'utilisait, donc pas de perte constatée en pratique — mais fonctionnalité non reconstruite si un jour nécessaire).
- La surcharge de libellé de couche par AdReel (`trackOverrides`) ne couvre plus le vertical-random (elle ne couvrait déjà que les couches fixes avant, jamais les groupes) — dégradation mineure déjà partielle avant cette session, pas aggravée mais pas non plus corrigée.
- Bulles d'aide contextuelles toujours pas ajoutées (étape 3, inchangé depuis l'entrée précédente).
- Moteur de lecture (`player.js`) toujours pas mis à jour pour interpréter cette structure (étape 2, prochaine session).

---

## [2026-07-30] — Nouveau mode "Vertical random séquentiel" (étape 1 : schéma + éditeur backstage)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : besoin identifié d'un mode hybride distinct du vertical-random existant et du futur "vertical additif randomisé" (celui-ci porte sur un contrôle d'intensité par le visiteur, absent ici) — des sections chaînées dans le temps comme le séquentiel, mais chacune contenant plusieurs pools simultanés randomisés comme le vertical-random. Cas d'usage explicite : motifs de structure du type ABC ou AABA, chaque section ayant ses propres parties de basse/guitare/etc. tirées aléatoirement à chaque passage.

Architecture discutée et validée avant tout code (plusieurs allers-retours) :
- Distinction couches fixes/groupes aléatoires jugée obsolète par Jules-Antoine : un pool à un seul fichier est de fait non randomisé — donc un seul concept de "pool" par couche, pas deux.
- Pattern AABA obtenu en dupliquant/réordonnant des sections dans la liste, pas via un compteur de répétitions.
- "Aller vers la fin" et un nouveau "Aller vers la section suivante" (renvoie à la section 0 si on est déjà sur la dernière) attendent tous deux la fin de la section en cours, comme le séquentiel — prévu pour l'étape 2 (moteur de lecture).
- Case "Randomiser les séquences" : brassage complet retenu (chaque section joue exactement une fois par cycle, ordre mélangé) plutôt qu'une pioche libre pondérée — garantit qu'aucune section n'est jamais "perdue" sur un cycle donné, essentiel pour un outil de pitch.
- Queue de chevauchement de l'intro : aucun réglage séparé nécessaire, le mécanisme déjà utilisé par le séquentiel (fichier plus long que sa durée nominale en mesures = chevauchement automatique sur le début de la section suivante) suffit tel quel.

**Changement** (étape 1 uniquement — schéma de données et éditeur, le moteur de lecture dans `player.js` reste à faire) :
- Nouveau mode `vertical-random-sequential` ajouté au menu déroulant du format (actif, plus grisé), libellé "Vertical random séquentiel".
- Nouvelle structure `track.sections[]` : liste ordonnée, réorganisable (↑/↓) et duplicable (`referencesSectionId`, même principe de référence que les groupes vertical-random et les emplacements séquentiels — un pool dupliqué ne recharge jamais les fichiers, anti-répétition partagée). Chaque section contient `pools[]` (nom, anti-répétition immédiate, pool de variations pliable/dépliable via le bouton partagé existant).
- `track.intro` (nom + mesures) et `track.outro` (sans mesures) réutilisent tels quels les mêmes objets que le mode séquentiel.
- Nouvelle case à cocher `track.randomizeSections`.
- Tous les gestionnaires nécessaires ajoutés : ajout/suppression/réordonnancement de section, ajout/suppression de pool, ajout/suppression de variation, saisie de tous les champs.
- `loadData()`/`publishAll()` étendus pour lire/publier la nouvelle structure, y compris la conversion OGG des fichiers de chaque pool.
- `buildPreviewTrack()` transmet déjà la structure complète, en prévision du moteur de lecture à venir.
- Fiche d'implémentation : nouvelle fonction `describeVerticalRandomSequential`, prise en compte dans `describeTimingBlock`.

**Bug latent corrigé au passage** : le bouton "Écouter" (`togglePreview`) ne vérifiait la présence d'au moins un fichier que sur `track.layers` en dehors du vertical-random — ce qui ne correspond à aucun contenu réel en mode séquentiel (dont le contenu vit dans `segmentSlots`/`intro`/`outro`, jamais dans `layers`). Corrigé pour brancher correctement sur les trois modes non-classiques (vertical-random, séquentiel, vertical random séquentiel).

**Vérification** : suite de tests Node/jsdom dédiée (~25 assertions, vrais clics DOM) — ajout/suppression/réordonnancement de section, duplication via `referencesSectionId` avec repli correct du bouton "+ Pool" sur une section dupliquée, ajout/suppression de pool et de variation, persistance des champs après re-rendu. Non-régression vérifiée sur les modes séquentiel et vertical-random existants (hosts DOM toujours présents, `add-segment-slot`/`add-group` toujours fonctionnels après la restructuration des chaînes ternaires du gabarit).

**Points ouverts** :
- Bulles d'aide contextuelles (`data-help`) pour les nouveaux champs : prévues à l'étape 3, pas encore ajoutées (les `data-help` posés dans le HTML n'ont pas encore d'entrée dans `layerpitch-help.js` — sans effet néfaste, juste pas de bulle affichée).
- `player.js` ne sait toujours pas jouer ce mode (étape 2, prochaine session).

---

## [2026-07-29] — Bouton de repli en bas à droite des blocs, en plus de celui du haut

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : retour sur une capture d'écran — après avoir lu tout le contenu d'un bloc long (ex. la liste de packs sélectionnés), il fallait remonter tout en haut pour le replier. Demande explicite de garder aussi la commande du haut pour qui la préfère.

**Changement** : nouveau générateur partagé `collapseFooterHtml(action, dataAttrs)` — un bouton "▴ Replier" (jamais juste un triangle nu, plus explicite en bas de contenu) inséré en pied de bloc, aligné à droite, avec un filet de séparation au-dessus. Réutilise le **même** `data-action`/attributs `data-*` que le bouton du haut : pris en charge par le gestionnaire délégué déjà existant, sans mécanisme séparé. Appliqué aux 5 endroits ayant ce pattern replié/déplié :
- Blocs de contenu d'un AdReel (Header, Bio, Témoignages, Morceaux, Texte, Photo, Vidéo, Packs, Collections, Sfx, Contact) — point de passage unique `buildCardForBlock`.
- Éditeur de morceau, éditeur de pack, éditeur de collection, entrée de la Bibliothèque Sfx.

**Bug évité en cours de route** : les gestionnaires existants ne mettaient à jour que le glyphe du bouton **cliqué** (`btn.textContent = ...`) — correct tant qu'un seul bouton existait, mais aurait laissé le bouton du haut affiché dans le mauvais état après un clic sur celui du bas. Corrigé pour cibler explicitement le bouton du haut (`.list-block-head [data-action="..."]` / `.block-editor-head [data-action="toggle-collapse"]`), sans jamais écraser le libellé "Replier" du bouton du bas avec un simple triangle. La Bibliothèque Sfx échappe à ce problème par construction (repli déjà géré par un re-rendu complet de la liste).

**Vérification** : suite de tests Node/jsdom dédiée (17 assertions) — bouton présent aux 5 endroits, clic depuis le bas replie bien le bloc, le bouton du haut se resynchronise correctement, réouverture depuis le haut toujours fonctionnelle. Intégralité de la suite de tests de la session rejouée sans régression.

---

## [2026-07-28] — Passe de nettoyage et d'audit sur l'ensemble du projet

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : demande explicite de repasser sur tout le code pour le nettoyer/l'optimiser. Audit systématique plutôt qu'un nettoyage à l'aveugle : déclarations de fonctions dupliquées (dans un même fichier), sélecteurs CSS dupliqués/conflictuels, clés i18n orphelines, clés de bulles d'aide orphelines, classes CSS définies mais jamais utilisées, `console.log`/`TODO`/`FIXME` résiduels — sur les 11 fichiers du projet.

**Un vrai bug trouvé et corrigé** : `.nav-feedback-btn` était défini deux fois avec des propriétés contradictoires — la règle ajoutée pendant la refonte de la sidebar (filet de séparation `border-top` uni) et l'ancienne règle pré-existante (encadré pointillé). À cause de la cascade CSS, le `border` en raccourci de la seconde écrasait silencieusement le `border-top` de la première : **le filet de séparation ajouté lors de la refonte de la sidebar n'a en réalité jamais été visible**, le bouton a gardé son style pointillé d'origine tout du long. Corrigé en retirant la règle en doublon — l'encadré pointillé (déjà là avant cette session, assure déjà une séparation visuelle suffisante) fait foi.

**12 clés i18n orphelines retirées** (confirmées à 0 occurrence hors `layerpitch-i18n.js`, FR+EN, 26 lignes) :
- 3 restes de la Phase 1 de hiérarchisation (`verticalRandomBpmHint`, `sequentialBpmHint`, `normalizeVolumeHint`) — jamais nettoyées au moment où leur paragraphe a été retiré du formulaire.
- 1 reste du passage en pool unique de variations (`alternativeFallback` — l'ancien texte de repli des en-têtes individuels, supprimés depuis).
- 7 restes de l'ancien système "stinger" d'avant la migration vers la Bibliothèque Sfx (18-25 juillet) : `addStingerBtn`, `stingerLabelText`, `removeStingerBtn`, `stingerFallback`, `segmentFallbackShort`, `convertingStinger`, `stingerFallbackShort`.
- 1 clé plus ancienne, `buyBtn` (2 variantes, pack et collection) — supplantée depuis par `buyableLabel`/`packBuyable`.

**Ce qui n'a rien trouvé d'anormal** (audit fait, pas seulement supposé) : aucune fonction dupliquée au sein d'un même fichier, aucune bulle d'aide orpheline, aucune classe CSS définie sans jamais être utilisée, aucun `console.log`/`debugger`/`TODO`/`FIXME` résiduel. Les quelques "sélecteurs dupliqués" détectés dans `index.html`/`pack.html` (`.lightbox-close`, `.video-test-btn-secondary`) sont en réalité un pattern volontaire (règle de base groupée par virgule + réglage spécifique en plus) — vérifiés, pas de problème.

**Vérification** : syntaxe validée sur les 11 fichiers (JS purs + scripts inline de chaque page HTML), intégralité de la suite de tests de la session rejouée sans régression après le nettoyage.

---

## [2026-07-28] — Hiérarchisation par sections : Header, Sfx Library, Apparence générale de l'AdReel

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : passe finale sur "l'ensemble des blocs qui pourraient en tirer parti" — après sidebar, morceau, pack et collection, revue de tous les autres formulaires du backstage (Bio, Témoignages, Contact, Texte, Photo, Vidéo, blocs Packs/Collections/Sfx d'un AdReel, Réseaux sociaux, dépôt GitHub) : la plupart sont déjà assez courts (2-3 champs) ou déjà structurés en `<fieldset>` avec légende (GitHub) pour ne pas avoir besoin de repères supplémentaires. Trois endroits en revanche suivaient le même flux plat que les précédents :

- **Header** (3 sections) : Identité (titre, sous-titre, logo) → Contact (email, site) → Formulaire (endpoint Formspree).
- **Bibliothèque Sfx**, entrée d'un Sfx (2 sections) : Identité (titre, descriptions FR/EN) → Comportement (mode round robin, ducking) — le pool "Voir les variations" juste après sert déjà de troisième repère naturel.
- **Apparence — AdReel en cours d'édition** (HTML statique, 2 sections) : Langue → Thème (couleurs, police, image de fond). Les "Polices personnalisées", déjà dans leur propre `<fieldset><legend>`, laissées telles quelles.

Nouvelles clés i18n génériques (FR/EN) : `sectionContact`, `sectionForm`, `sectionBehavior`, `sectionLanguage`, `sectionTheme`.

**Vérification** : suite de tests Node/jsdom dédiée (flux "data.json introuvable" simulé via un mock de `ghGetContent` pour obtenir l'AdReel par défaut avec ses blocs, sans dépendre du réseau) + l'intégralité de la suite de tests de la session rejouée sans régression.

---

## [2026-07-28] — Hiérarchisation par sections étendue aux éditeurs de pack et de collection

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : suite de la Phase 2 (sidebar → éditeur de morceau → ici) — l'éditeur de pack et celui de collection avaient exactement le même défaut de formulaire plat que le morceau, avant la refonte.

**Changement** : réutilisation telle quelle de `sectionEyebrow()` (aucune nouvelle mécanique).
- **Pack** (5 sections) : Identité (titre, illustration, watermark) → Présentation (FR/EN) → Diffusion (téléchargement gratuit, vente, mode test gameplay, renvoi AdReel, lien direct, partage, réseaux sociaux) → Apparence (couleurs) → Contenu (sélecteur de morceaux, sélecteur de Sfx).
- **Collection** (4 sections) : Identité (titre, illustration) → Présentation (FR/EN) → Contenu (sélecteur de packs) → Diffusion (téléchargement gratuit, vente, lien direct, partage, réseaux sociaux).
- Nouvelles clés i18n génériques `sectionPresentation`/`sectionDistribution`/`sectionAppearance` (FR/EN) ; `trackSectionIdentity`/`trackSectionContent` réutilisées telles quelles (même libellé "Identité"/"Contenu" que dans l'éditeur de morceau, malgré le nom de clé).

**Vérification** : suite de tests Node/jsdom dédiée (ordre des sections, IDENTITÉ toujours en tête, aucun champ perdu) + l'intégralité de la suite de tests de la session rejouée sans régression.

---

## [2026-07-28] — Bulles d'aide enrichies avec le détail retiré des paragraphes permanents

**Fichiers touchés** : `layerpitch-help.js`

**Contexte** : retour après la Phase 1 — les bulles d'aide (`data-help`) qui remplaçaient les paragraphes permanents étaient globalement moins précises que ce qui avait été retiré, malgré le recoupement de contenu vérifié avant suppression.

**Changement** : fusion du détail manquant dans 3 bulles (FR/EN) :
- `bpmMeasuresSequential` — ajout de la précision sur le fondu de fin ("le fichier peut être plus long que ces mesures : la fin sonne en fondu pendant que le bloc suivant démarre déjà").
- `bpmMeasuresVerticalRandom` — mention explicite de la couche fixe (pas seulement les tirages aléatoires) parmi ce qui doit rester synchronisé.
- `normalizeVolume` — ajout de la précision sur le comportement par défaut ("décoché par défaut : sans ça, tes fichiers sonnent exactement à leur volume d'origine").

`trackDescription` non touchée : déjà complète (la phrase "Cmd+K" retirée en Phase 1 y figurait déjà mot pour mot).

**Vérification** : contenu des 3 bulles relu et confirmé présent après modification.

---

## [2026-07-28] — Éditeur de morceau : retrait des paragraphes redondants avec une bulle d'aide (Phase 1)

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : Phase 1 initialement mise de côté ("les explications doivent rester au moins jusqu'à la bêta multi"), validée après coup une fois la Phase 2 (sections) vue en pratique.

**Changement** : retrait des 4 paragraphes permanents identifiés comme strictement redondants avec une bulle d'aide déjà présente sur le même champ (contenu quasi identique, confirmé texte à texte avant suppression) :
- BPM/mesures (vertical-random) — doublon de la bulle `bpmMeasuresVerticalRandom`
- BPM/mesures (séquentiel) — doublon de la bulle `bpmMeasuresSequential`
- Description — le paragraphe "Sélectionne du texte puis Cmd+K..." était déjà la dernière phrase de la bulle `trackDescription`
- Harmoniser les volumes — doublon de la bulle `normalizeVolume`

Seuls ces 4 cas du formulaire de morceau ont été touchés — les usages de `linkHint` ailleurs dans le backstage (packs, collections, bio...) n'ont pas été vérifiés un par un et restent inchangés. Les avertissements orange, le texte des zones de dépôt et les instructions de la timeline de boucle (interaction non standard) restent également inchangés, comme prévu.

**Vérification** : suite de tests Node/jsdom mise à jour — confirme la disparition des 4 paragraphes tout en vérifiant que leur bulle d'aide respective (`data-help`) reste bien en place ; l'ensemble de la suite de tests de la session (sidebar, Sfx, pools de variations, panneau Apparence) rejoué sans régression.

---

## [2026-07-28] — Éditeur de morceau : hiérarchisation par sections (Phase 2)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : suite du travail de hiérarchisation visuelle entamé sur la sidebar — appliqué maintenant à l'éditeur de morceau, dont le formulaire déplié s'enchaînait jusqu'ici en un long flux plat (titre, format, tempo, description, structure, Sfx, note d'implémentation, certification, tout au même niveau visuel). **Phase 1 (retirer les paragraphes redondants avec les bulles d'aide) explicitement mise de côté par Jules-Antoine** — les explications restent visibles telles quelles, au moins jusqu'à la bêta multi.

**Changement** : 5 repères de section ajoutés (même langage visuel que les eyebrows de la sidebar — `.nav-section-label`, réutilisée telle quelle — avec un filet de séparation en plus, `.track-section-label`) :
- **Identité** — titre, format, case "bouclable" (mode statique)
- **Tempo** — BPM/mesures, points de boucle, nombre de boucles par défaut ; **absent si sans objet** (mode statique non bouclable) plutôt que de montrer un repère vide — calculé via un nouveau booléen `hasTempoSection`
- **Contenu** — description, harmonisation des volumes
- **Structure** — couches fixes/groupes aléatoires, ou intro/emplacements/outro, ou couches classiques/fichier statique selon le mode
- **Réglages avancés** — Sfx attachés, note d'implémentation, certification sans IA

Nouveau générateur partagé `sectionEyebrow(label)`. Aucun champ, aucune bulle d'aide, aucun texte explicatif existant déplacé ou supprimé — uniquement des repères insérés autour du contenu déjà en place.

**Vérification** : suite de tests Node/jsdom couvrant les 4 modes (statique non bouclable, statique bouclable, vertical-random, séquentiel) — les 5 sections apparaissent dans le bon ordre, Tempo disparaît proprement quand non pertinent, et tous les textes d'aide existants sont confirmés intacts.

---

## [2026-07-28] — Un seul bouton "Voir les variations" pour les pools de variations (Sfx, groupes, segments)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : retour en deux temps sur le repli individuel par variation ajouté un peu plus tôt dans la session — Jules-Antoine ne voulait pas un repli par ligne (un clic par variation), mais un seul bouton qui déplie **tout le pool d'un coup**. Clarifié à l'aide d'une seconde capture d'écran montrant un groupe vertical-random ("Alt Perc") : les réglages du groupe lui-même (nom, source du contenu, case "interdire la répétition") doivent rester toujours visibles ; seule la liste de ses variations (Vide, AltPerc#1, AltPerc#1.5...) doit se cacher derrière un unique repli.

**Changement** :
- Nouveau générateur partagé `altPoolToggleHtml(key, count)` — un seul bouton "Voir les variations (N)" avec un caret, replié par défaut (nouveau registre `expandedAltPoolKeys`, clé par pool). Câblé directement au clic (`wireAltPoolToggle`), sans passer par les gestionnaires délégués existants.
- Appliqué aux **3 pools de variations interchangeables** : variations d'un Sfx, alternatives d'un groupe aléatoire (vertical-random), alternatives d'un emplacement séquentiel — chacun n'affiche plus qu'un seul bouton, et les lignes individuelles (revenues à leur forme simple : label + fichier + suppression, sans en-tête propre) apparaissent toutes ensemble une fois déplié.
- **Couches fixes et couches classiques (vertical) laissées inchangées**, avec leur repli individuel par ligne existant : ce sont des éléments distincts qu'on veut pouvoir retrouver un par un (chaque couche fixe est un son différent, chaque couche classique un niveau d'intensité différent), pas un pool de variations interchangeables — distinction actée avec Jules-Antoine.
- Nettoyage du premier essai (repli individuel Sfx replié par défaut, `expandedSfxAltKeys`) : registre et gestionnaire retirés, remplacés par le pool unique.

**Vérification** : suite de tests Node/jsdom, entièrement pilotée en clics UI réels (création d'un morceau vertical-random avec un groupe, d'un morceau séquentiel avec un segment, ajout de variations) — un seul bouton par pool, replié par défaut, toutes les lignes apparaissent d'un coup au clic, et les couches fixes gardent bien leur comportement d'origine.

---

## [2026-07-28] — Panneau "Apparence de ce bloc" repliable, replié par défaut

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : retour sur une capture d'écran — la section "Apparence de ce bloc" (couleur de fond, couleur des titres, couleur du contenu, police, image de fond, opacité) s'affichait toujours en entier dans chaque bloc, alors que la plupart des blocs héritent simplement du réglage général et n'ont besoin de rien y toucher.

**Changement** : `appendBlockAppearanceSection()` enveloppe désormais les champs dans le même mécanisme de repli que le reste du backstage (`.list-block-head`/`.list-block-body.collapsed`, glyphe ▸/▾) — replié par défaut, un clic sur l'en-tête suffit à dérouler. L'état de repli est suivi par bloc (`expandedBlockAppearanceIds`, clé = `block.id`) et survit aux re-rendus des champs eux-mêmes (cocher une case ne referme pas le panneau, puisque `renderBlockAppearanceFields` ne touche qu'à son propre sous-conteneur, jamais à l'en-tête). Nouvelle clé i18n `blockAppearanceTitle` (FR/EN) pour le titre court de l'en-tête, distinct du texte d'explication complet qui reste dans le corps déplié.

**Vérification** : suite de tests Node/jsdom — replié par défaut, dépli/repli au clic, aucune duplication d'en-tête après re-rendu des champs, et deux blocs différents gardent chacun leur propre état de repli indépendant.

---

## [2026-07-28] — Boutons icône pour upload/suppression dans les listes de variations

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : retour sur une capture d'écran d'une variation Sfx — trop de texte pour ce que ça fait ("Choisir un fichier audio" / "Supprimer cette variation" en boutons pleine largeur, sur deux lignes séparées).

**Changement** : `fileCtrlHtml()` (fonction partagée, utilisée partout où on choisit un fichier) affiche désormais une icône seule (upload) au lieu d'un bouton texte — `title`/`aria-label` conservés pour l'accessibilité. Nouvelle fonction `deleteIconBtnHtml(action, dataAttrs, label)` : bouton de suppression icône (corbeille), injectable dans la même ligne que le contrôle de fichier plutôt que dans une rangée d'actions séparée en dessous. Appliqué aux 5 listes de variations qui suivaient ce pattern répétitif : variations Sfx, alternatives de groupe (vertical-random), alternatives de segment (séquentiel), couches fixes (vertical-random) et couches classiques (vertical). Les uploads "un seul exemplaire" sans suppression associée (logo, photo de bio, illustration de pack/collection, image de fond, police, vignette) gardent leur bouton d'upload en icône (cohérence visuelle) mais n'ont pas de bouton de suppression à déplacer, puisqu'ils n'en avaient pas.

**Vérification** : suite de tests Node/jsdom — icône présente sans texte résiduel, `aria-label`/`title` corrects, attributs `data-*` du bouton de suppression corrects, et test de bout en bout en pilotage UI pur (ajout d'un Sfx, ajout de 2 variations, clic sur le bouton de suppression icône, vérification qu'une seule variation reste — la bonne).

---

## [2026-07-28] — Refonte de la sidebar : icônes sur mesure, hiérarchie renforcée

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : retour sur la lisibilité globale du backstage, comparée à un concurrent (ReelCrafter) — la sidebar était du texte nu sans aucune icône, sans hiérarchie entre les items "Compte" et le groupe spécifique à l'AdReel sélectionné.

- 10 icônes ligne dessinées sur mesure (pas de librairie générique, pas d'emoji) — chacune conceptuellement liée à la fonction plutôt que décorative : trois barres ascendantes pour la Bibliothèque musicale (le motif même du layering vertical, déjà présent dans les puces d'intensité du site public), un éclat pour la Bibliothèque Sfx (one-shot, par opposition aux barres continues), une boîte pour les Packs, deux boîtes superposées pour les Collections, trois nœuds reliés pour les Réseaux sociaux, une grille de cartes pour "Gérer les AdReels", un cadenas pour Projet(s) (cohérent avec son état verrouillé), des lignes de blocs pour Contenu, un cercle mi-plein pour Apparence (rappel du toggle "Contraste renforcé" déjà présent côté public), une bulle de dialogue pour le retour sur version.
- `.nav-item` passe en flex (icône + libellé), `justify-content: space-between` conservé pour le badge "bientôt" de Projet(s).
- Séparation visuelle renforcée entre le groupe "Compte" (ressources globales) et le groupe "Site (AdReel)" (marge augmentée), et un séparateur (filet + marge) ajouté avant le bouton de retour, qui flottait seul auparavant.
- **Point de vigilance corrigé en cours de route** : les icônes avaient d'abord été ajoutées en gardant `data-i18n` sur le `<button>` lui-même en plus du nouveau `<span>` interne — `applyI18n()` fait `el.textContent = v`, ce qui aurait effacé les icônes SVG à chaque application des traductions. Corrigé en ne laissant `data-i18n` que sur le `<span>` du libellé.

**Vérification** : suite de tests Node/jsdom dédiée — icône présente sur chaque item, badge et attributs (`data-help`, `data-tab`) intacts, structure survivant à une application simulée de `applyI18n()`.

---

## [2026-07-28] — Sfx : le bouton Play déplie sa ligne et replie les autres, comme un morceau

**Fichiers touchés** : `player.js`

**Contexte** : retour explicite — le lecteur Sfx venait d'être aligné visuellement sur le morceau, mais le bouton Play ne participait pas encore au même comportement de dépli/repli collectif.

**Changement** : le Sfx rejoint le même registre partagé que les morceaux (`trackCollapsers`/`activeTrackId`, déjà utilisé par `playThisTrack()`). Cliquer sur le bouton Play rond d'un Sfx déplie désormais sa propre ligne et replie tout le reste de la page — morceaux et autres Sfx confondus —, arrête un morceau en cours de lecture s'il y en avait un (même mécanisme d'événement `stop-track`), et efface son statut d'élément actif à la fin naturelle du son. Seul le bouton Play déclenche ce comportement ; cliquer directement sur une variation RR reste une simple audition locale, sans repli des autres lignes.

**Vérification** : suite de tests étendue — jouer un second Sfx replie bien le premier resté déplié.

---

## [2026-07-28] — Ducking : plafond de baisse et remontée progressive

**Fichiers touchés** : `player.js`

**Contexte** : retour d'écoute — la baisse actuelle (65 %) était trop marquée, et la remontée, collée à la toute fin du Sfx, semblait abrupte.

- `DUCK_LEVEL` : 0.35 → **0.7** (baisse plafonnée à 30 % au lieu de 65 %).
- La remontée démarre désormais à **la moitié de la durée du Sfx** (`sfxDurationSec / 2`) au lieu de `sfxDurationSec - DUCK_RELEASE_SEC` (collée à la fin).
- `DUCK_RELEASE_SEC` : 0.35s → **1.2s** — remontée nettement plus progressive, quitte à se terminer après la fin du Sfx lui-même plutôt qu'exactement dessus.
- L'attaque (`DUCK_ATTACK_SEC = 0.08`) reste inchangée, jugée satisfaisante.

---

## [2026-07-28] — Bug persistant de chargement de `collection.html` : cause trouvée et corrigée

**Fichiers touchés** : `collection.html`

**Diagnostic** : contrairement à `pack.html`/`index.html`, `collection.html` n'a jamais déstructuré `escapeHtml`/`linkify`/`setupContrastToggle` depuis `window.LayerPlayerCore` — ces fonctions vivent dans la fermeture (IIFE) de `player.js` et ne sont pas des globales. Chaque appel nu (`escapeHtml(collection.title)`, etc.) déclenchait un `ReferenceError` dès le premier rendu dans `init()`, catché silencieusement par le `try/catch` → page systématiquement affichée en `loadError`, quel que soit l'état réel des données.

**Changement** : ajout de `const { escapeHtml, linkify, setupContrastToggle } = window.LayerPlayerCore;` en tête du script, comme dans `pack.html`.

**Vérification** : reproduit puis corrigé en conditions réelles (Node/jsdom, `fetch` mocké, vrai `player.js`) — la page charge sans erreur, affiche le titre de la collection et la liste des packs inclus.

---

## [2026-07-28] — Refonte du lecteur Sfx : architecture alignée sur le lecteur de morceau

**Fichiers touchés** : `player.js`, `index.html`, `pack.html`, `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : le lecteur Sfx (`buildSfxPlayer`) affichait jusqu'ici toutes les variations round robin côte à côte en permanence, chacune avec sa propre forme d'onde toujours visible, sans aucune vue repliée/dépliée — incohérent avec le reste du site.

**Changement** :
- `player.js` : `buildSfxPlayer` réécrit pour réutiliser telles quelles les classes `.track-row-wrapper`/`.track-row`/`.track-row-details`/`.track-row-details-inner`/`.track-desc` du lecteur de morceau — ligne compacte (bouton Play + titre + tag "Sfx"), **un seul repli** au clic sur le titre (pas de second niveau imbriqué, conformément à la demande explicite).
- Le repli affiche désormais **une seule forme d'onde principale**, qui reflète uniquement la variation RR effectivement en train de jouer (mise à jour à chaque tirage/clic), et non plus les N formes d'onde simultanément. Les blocs RR individuels (mini-forme d'onde + label, cliquables pour forcer une variation précise) restent visibles juste en dessous, dans ce même repli.
- **Animation de progression** ajoutée sur la forme d'onde principale (initialement oubliée dans la première passe, ajoutée après retour explicite) : remplissage via transition CSS `clip-path` sur la durée réelle du buffer joué — même mécanisme que celui déjà utilisé pour le mode séquentiel (`activateSeqStage`), plutôt qu'une boucle `requestAnimationFrame` (superflue pour un one-shot sans pause/seek).
- **Glisser-déposer groupé des variations RR** : `wireBatchDrop` (déjà utilisé pour les groupes vertical-random et les emplacements séquentiels) branché sur la liste d'alternatives Sfx du backstage — déposer plusieurs fichiers d'un coup crée une variation par fichier, avec le nom repris automatiquement du fichier.
- **Description bilingue** : `sfx.description` (champ unique) remplacé par `descriptionFr`/`descriptionEn` (même pattern que `presentationFr`/`presentationEn` des packs/collections). Repli automatique sur l'ancien champ unique pour tout Sfx publié avant ce changement (lu une fois au chargement, jamais réécrit dans l'ancien champ). Résolution de la langue faite directement dans `player.js` (nouvelle fonction `pickSfxDescription`, utilise `currentLang()`), pas dans chaque page hôte.
- `layerpitch-backstage.html` : éditeur Sfx mis à jour (deux textarea FR/EN au lieu d'un champ unique, indice de glisser-déposer groupé), migration au chargement et sérialisation à la publication adaptées aux nouveaux champs.
- `layerpitch-i18n.js` : nouvelles clés `sfxModeTag`/`sfxNoFilesYet` (zone `player`, FR/EN) et `descriptionLabelFr`/`descriptionLabelEn` (zone `backstage`, FR/EN).
- CSS : ancien bloc `.sfx-player`/`.sfx-player-title`/`.sfx-player-desc`/`.sfx-play-btn` retiré de `index.html` et `pack.html` (remplacé par la réutilisation des classes du morceau) ; `.sfx-rr-row`/`.sfx-rr-block` conservées à l'identique pour la liste RR en dessous.

**Vérification** : suite de tests Node/jsdom dédiée (`AudioContext` et `fetch` simulés) — structure DOM (repli/dépli à un seul niveau, forme d'onde principale unique, variations RR en dessous), résolution bilingue de la description (FR, EN avec repli sur FR si vide, repli sur l'ancien champ non migré), état désactivé du bouton Play si aucune variation, et — après correction suite au retour explicite sur l'oubli initial — l'animation de progression réelle (clip-path final `inset(0 0% 0 0)`, durée de transition correspondant exactement à la durée du buffer joué). 20 assertions, toutes passantes.

---

**Fichiers touchés** : `LAYERPITCH_MASTER.md`, ce changelog

- `LAYERPITCH_MASTER.md` : ajout de l'idée "AdReels temporaires" (réglage de temporalité + option "rendre permanent"), section 12 — avec le point technique honnête que sur l'architecture statique actuelle, une vraie expiration ne peut être qu'un garde-fou visuel côté visiteur, pas une restriction d'accès réelle (même limite déjà documentée pour "liens protégés/expirants", auquel l'idée est reliée sans être confondue avec elle).
- Compilation du changelog de toute la session du 25 juillet, à la demande explicite de Jules-Antoine.

---

## [2026-07-25] — Téléchargement gratuit pour les Collections + code de téléchargement partagé avec les Packs

**Fichiers touchés** : `player.js`, `collection.html`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`

- `player.js` : `ensureJSZipLoaded`, `collectTrackAudioFiles`, `downloadTracksAsZip` déplacées depuis `pack.html` (où elles avaient été écrites quelques échanges plus tôt) vers `player.js`, pour être réellement partagées entre `pack.html` et `collection.html` plutôt que dupliquées une seconde fois.
- **Erreur de manipulation repérée et corrigée en cours de route** : le déplacement a d'abord effacé accidentellement `setSfxLibrary` (`str_replace` mal ciblé) — repéré par la vérification syntaxique immédiate, restauré, revérifié.
- `collection.html` : même traitement que les packs — case "Téléchargement gratuit" générant un zip de tous les morceaux de **tous les packs inclus** dans la collection, dédupliqués (un même morceau peut apparaître dans plusieurs packs) ; vente toujours affichée grisée pendant la bêta, quel que soit `buyUrl`.
- `layerpitch-backstage.html` : champ `freeDownloadEnabled` ajouté à l'éditeur de collection (chargement, sauvegarde, publication), même principe que pour les packs.
- Nouvelles clés i18n (zone `collection`) et tooltip d'aide `collectionFreeDownload` — FR/EN.

---

## [2026-07-25] — Téléchargement gratuit pour les Packs, vente toujours grisée pendant la bêta

**Fichiers touchés** : `pack.html`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`

**Contexte** : remplace le mécanisme précédent (case "Achetable" + lien externe `buyUrl`, à moitié fonctionnel) par un système à deux options distinctes, à la demande de Jules-Antoine.

- `pack.html` : nouveau bouton "Télécharger gratuitement", réel dès aujourd'hui — génère un zip côté navigateur (JSZip chargé au clic seulement, jamais au chargement de la page) avec tous les fichiers audio publiés des morceaux du pack, quel que soit leur mode (couches, variations, intro/segment/outro, tout est inclus plutôt qu'un seul fichier choisi arbitrairement par morceau).
- La vente s'affiche désormais **toujours** grisée ("Bientôt disponible") sur la page publique, même si `buyable`/`buyUrl` sont renseignés côté backstage — pour ne jamais laisser croire aux bêta-testeurs à un système de paiement qui n'existe pas encore. Le champ reste éditable en backstage, prêt pour le jour où la vente sera réellement construite.
- `layerpitch-backstage.html` : case "Téléchargement gratuit" ajoutée à l'éditeur de pack, note explicite ajoutée sous le champ `buyUrl` pour clarifier qu'il n'est pas encore exploité publiquement.
- Nouvelles clés i18n (`freeDownloadLabel`, `freeDownloadBtn`, `downloadPreparing`, `downloadError`, `buyUrlNotLiveHint`) et tooltip d'aide `packFreeDownload` — FR/EN. Tooltip `packBuyable` existant mis à jour (son texte précédent était devenu inexact).

---

## [2026-07-25] — Master : mise à jour complète intégrant toute la session

**Fichiers touchés** : `LAYERPITCH_MASTER.md`

- Réécrit en partant de la version du 18 juillet fournie par Jules-Antoine (collée depuis un autre appareil, faute de pouvoir pousser un document depuis son téléphone) — intègre l'intégralité des chantiers de la session du 25 juillet (voir entrées ci-dessous et ci-dessus).
- Confirme, en vérifiant l'état réel des fichiers plutôt qu'en recopiant l'ancien statut, que la restructuration du backstage en onglets — listée "pas encore codée" le 18 juillet — était en réalité déjà terminée avant même le début de cette session (vérifié tout au début, avant toute autre tâche).
- Schéma de données mis à jour : trois nouvelles bibliothèques globales (`sfxLibrary[]`, `customFonts[]`, `socials[]`), nouveaux champs sur les packs (`sfxIds`, `linkedAdReelId`), nouveau modèle de thème par AdReel (`profile.theme` remplace `bgColor`/`textColor`), nouveaux types de bloc de contenu (`collections`, `sfx`).
- Redemandé à Jules-Antoine s'il voulait une intégration complète ou seulement la note ponctuelle demandée — a choisi l'intégration complète.

---

## [2026-07-25] — Réseaux sociaux : bibliothèque de comptes + boutons "Publier" pré-remplis sur Packs et Collections

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-beta-sync.js`, `admin-beta-console.html`

- Écart clarifié avant tout code : Jules-Antoine voulait initialement une "publication directe" sur les réseaux — impossible sans backend (OAuth, secrets), et impossible tout court pour Instagram/TikTok (pas d'API de publication ouverte) et pour X (API désormais payante pour cet usage). Version réaliste retenue après clarification : partage pré-rempli, un clic pour ouvrir la fenêtre de publication du réseau, pas de publication automatique.
- `layerpitch-backstage.html` : nouvel onglet "Réseaux sociaux" (section Compte), gestion de `socials[]` (plateforme + lien de référence) — 10 plateformes possibles, dont 5 "publiables" (X, Facebook, LinkedIn, WhatsApp, Telegram) qui font apparaître un vrai bouton "Publier" sur chaque pack et chaque collection ; les 5 autres (Instagram, TikTok, YouTube, SoundCloud, site web) gardées en simple aide-mémoire de lien, sans bouton (aucun mécanisme de partage pré-rempli de leur côté).
- Nettoyage automatique : supprimer ou changer la plateforme d'un réseau réactualise les boutons "Publier" affichés partout où c'est pertinent.
- Deux oublis trouvés et corrigés en préparant cette fonctionnalité, sans lien direct avec elle : `sfxLibrary` manquait au squelette de démarrage d'un nouveau testeur bêta depuis la Phase 1 du chantier Sfx (jamais rattrapé) ; ajouté en même temps que `socials`, dans `layerpitch-beta-sync.js` et `admin-beta-console.html`.
- Nouvelles clés i18n (FR/EN) et tooltip d'aide `publishToSocial`.

---

## [2026-07-25] — Bouton "Partager" sur les pages publiques + boutons "Partager" dans le backstage

**Fichiers touchés** : `player.js`, `index.html`, `pack.html`, `collection.html`, `layerpitch-backstage.html`

- `player.js` : nouvelle fonction partagée `shareOrCopy(url, title)` — utilise la Web Share API du navigateur si disponible (ouvre le menu natif : WhatsApp, Messages, Discord... surtout sur mobile), sinon copie le lien dans le presse-papier avec retour visuel. Exportée via `LayerPlayerCore`, réutilisée partout (pages publiques et backstage).
- `index.html`, `pack.html`, `collection.html` : bouton rond fixe en haut à droite (icône carré + flèche, glyphe de partage iOS) sur chaque page publique.
- `layerpitch-backstage.html` : bouton "Partager" ajouté à côté du bouton "Copier le lien" déjà existant pour l'AdReel en cours, et pour chaque pack et chaque collection (qui n'avaient jusqu'ici aucun lien direct affiché du tout — ajouté au passage).

---

## [2026-07-25] — Renvoi Pack → AdReel (partage d'un pack seul, hors Marketplace)

**Fichiers touchés** : `layerpitch-backstage.html`, `pack.html`

**Contexte** : répond à une question de Jules-Antoine sur l'intérêt d'envoyer un pack directement à un studio, sans passer par un AdReel complet — déjà techniquement possible (`pack.html?id=...` est déjà une page publique autonome) mais avec un vrai trou repéré en vérifiant : la page pack ne montrait ni nom, ni bio, ni contact, juste une ligne de crédit générique.

- `layerpitch-backstage.html` : nouveau champ `pack.linkedAdReelId` — sélecteur "Renvoi vers un AdReel" par pack, dans son propre onglet Contenu. Un pack supprimé ou un AdReel supprimé nettoie proprement les références qui pointaient dessus.
- `pack.html` : si un renvoi est configuré, lien visible "Voir le travail complet de {nom}" — le nom est lu directement depuis le titre renseigné dans le Header de l'AdReel visé (champ ajouté un peu plus tôt dans la session, voir Apparence Phase 4).
- Concrétise directement le principe produit déjà noté dans le master ("Les Packs restent des objets autonomes").

---

## [2026-07-25] — Passe d'éco-conception (audit RGESN 2024 / GR491)

**Fichiers touchés** : `index.html`, `pack.html`, `collection.html`

- Audit demandé par Jules-Antoine avec une grille de critères fournie (stratégie, architecture, UX/UI, contenus, frontend, backend, algorithmie/IA), classés par impact.
- Corrections appliquées après vérification précise du code réel, pas à l'aveugle :
  - `loading="lazy"` ajouté sur les images qui ne sont pas visibles au premier écran (photo bio, blocs photo, vignettes de packs/collections) — laissé de côté sur le logo du Header et les illustrations hero de pack/collection, déjà visibles au chargement.
  - Graisse 600 de Space Grotesk ajoutée à l'import Google Fonts (`index.html`, `pack.html`) : en vérifiant les graisses réellement utilisées avant toute réduction, un vrai bug de rendu a été repéré — deux titres s'affichaient en gras synthétique faute d'avoir la vraie graisse chargée.
- **Faux positif corrigé dans l'audit lui-même** : l'autoplay vidéo initialement signalé "Élevé" ne l'est pas — la vidéo ne se charge qu'au clic explicite du visiteur, jamais au chargement de la page (déjà commenté ainsi dans le code).
- Laissés en l'état, décision assumée et expliquée à Jules-Antoine : chargement d'Umami sans attendre d'interaction (compromis produit, pas juste technique) ; pipeline de compression/conversion WebP à l'upload d'image (chantier réel, mis de côté pour une session dédiée).

---

## [2026-07-25] — Passe d'audit complet du code (demandée explicitement) — plusieurs oublis trouvés et corrigés

**Fichiers touchés** : `player.js`, `index.html`, `pack.html`, `layerpitch-backstage.html`, `layerpitch-i18n.js`

- Vérification systématique sur tous les fichiers touchés dans la session : déclarations de fonctions/variables dupliquées (aucune), id HTML dupliqués (aucun), couverture i18n et tooltips d'aide (100 % après correction), classes CSS orphelines (aucune).
- **Régression trouvée et corrigée** : un `cp` accidentel plus tôt dans la session (au début de la Phase 2 du chantier Apparence) avait écrasé tout le travail i18n du bloc de contenu Collections fait en tout début de session — repéré en cherchant les clés Collections pour construire le bloc Sfx par analogie, entièrement restauré, revérifié par recoupement avec d'autres clés d'autres phases pour s'assurer qu'aucun autre écrasement du même genre n'était passé inaperçu.
- Clé i18n `trackSfxHint` manquante — trouvée et corrigée.
- Filtre de type de fichier incohérent sur l'upload d'une variation Sfx (`audio/*` au lieu de `.wav,audio/wav,.mp3,audio/mp3,audio/mpeg` utilisé partout ailleurs) — harmonisé.
- Classe CSS interne `.stingers` renommée en `.track-sfx-row` (`player.js`, `index.html`, `pack.html`) — cohérence terminologique avec le renommage stingers→Sfx fait plus tôt dans la session. Attribut `data-role="stingers"` jamais interrogé par le JS — retiré.
- Deux commentaires de code obsolètes mis à jour : le vocabulaire fermé des événements analytics (incomplet, manquait plusieurs événements ajoutés en cours de session), une référence à `admin-analytics.html` devenu obsolète.

---

## [2026-07-25] — Chantier Sfx — Phase 5 : Packs music/sfx/hybride

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`

- Sélecteur de Sfx ajouté à l'éditeur de pack, en plus du sélecteur de morceaux déjà existant. Badge de genre ("Musique"/"Sfx"/"Hybride") affiché à côté du titre de chaque pack — calculé automatiquement à chaque rendu depuis son contenu réel, jamais stocké.
- **Dette trouvée et corrigée au passage** : supprimer un Sfx de la bibliothèque ne nettoyait ses références nulle part (morceaux, packs, blocs de contenu) — corrigé, comme c'était déjà fait pour les morceaux et les polices personnalisées.
- Nouvelles clés i18n (`packSfxLabel`, `packKindMusic/Sfx/Hybrid`) et tooltip d'aide `packSfx` — FR/EN.

---

## [2026-07-25] — Chantier Sfx — Phase 4 : Ducking

**Fichiers touchés** : `player.js`

- Introduction d'un gain maître par morceau (`trackMasterGain`) — jusqu'ici, chaque mode de lecture (statique, vertical, vertical-random, séquentiel) connectait ses couches/générations directement à la sortie audio, sans point commun pour agir sur "tout le morceau en cours" en une fois. Les 5 points de connexion directe à la destination audio, à l'intérieur du lecteur de piste, routent désormais par ce gain unique.
- Au clic sur un bouton Sfx dont `duckMainTrack` est coché : rampe descendante rapide (0,08s) vers 35 % du volume, maintenue, puis rampe remontante plus douce (0,35s), calée pour que le morceau ait retrouvé son plein volume à peu près au moment où le Sfx s'éteint. Constantes regroupées à un seul endroit pour un réglage rapide.
- Réinitialisation systématique du gain maître à l'arrêt du morceau (manuel ou en fin naturelle), pour qu'un ducking en cours ne laisse jamais un morceau bloqué à volume réduit.
- **Niveaux non calés sur du contenu réel** : choix par défaut raisonnables, pas testés à l'oreille — Jules-Antoine informé explicitement que ce sont des valeurs de départ, à ajuster après écoute.

---

## [2026-07-25] — Chantier Sfx — Phase 3 : migration automatique, bouton Sfx d'un morceau, ducking préparé

**Fichiers touchés** : `layerpitch-backstage.html`, `player.js`, `pack.html`

- Migration automatique des anciens stingers déjà publiés (upload direct par morceau, jamais de round robin) vers la Sfx Library — une variation chacun au départ, enrichissable ensuite. Se déclenche une seule fois à l'ouverture d'un ancien `data.json`, avec message d'avertissement invitant à publier pour valider la migration (sinon elle se referait à la prochaine ouverture). Fichiers audio copiés vers leur nouveau dossier à la publication suivante — copie directe du contenu existant, sans décodage/réencodage.
- `layerpitch-backstage.html` : l'ancien bouton "Stingers" de l'éditeur de morceau (upload direct de fichier) remplacé par un sélecteur vers la Sfx Library — un morceau référence désormais des Sfx par id (`track.sfxIds`).
- `player.js` : le bouton Sfx d'un morceau tire désormais une variation round robin (aléatoire anti-répétition ou séquentielle, selon le réglage du Sfx) au lieu de jouer un fichier unique — nouvelle variable partagée `SFX_LIBRARY_BY_ID` + `setSfxLibrary()` pour que le rendu des morceaux résolve `track.sfxIds` sans threader ce paramètre dans toute la chaîne d'appel.
- Système de surcharge par AdReel adapté : le renommage du libellé d'un Sfx pour un morceau donné fonctionne désormais par id de Sfx plutôt que par index (nécessaire puisque les Sfx sont des entrées de bibliothèque partagées, pas des fichiers propres au morceau).
- `pack.html` : même branchement (`setSfxLibrary`) que `index.html`, pour que les boutons Sfx fonctionnent aussi sur les pages de pack.
- Fiche d'implémentation (texte et JSON) mise à jour pour décrire les Sfx attachés (nombre de variations, mode de lecture) au lieu des anciens stingers.
- Une erreur de syntaxe (apostrophe mal échappée dans une chaîne) trouvée et corrigée par la vérification systématique avant livraison.

---

## [2026-07-25] — Chantier Sfx — Phase 2 : bloc de contenu "Sfx"

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `index.html`

- `player.js` : 5 fonctions de calcul/dessin de waveform (jusqu'ici enfermées dans le lecteur de piste, mais ne dépendant d'aucune donnée de piste) hissées au niveau module — nécessaire pour les réutiliser sans dupliquer cette logique une troisième fois. Nouvelle fonction `buildSfxPlayer()` : lecteur autonome par Sfx — titre, description, une case cliquable par variation round robin (chacune avec sa propre forme d'onde), bouton "Play" principal qui tire une variation selon le réglage aléatoire/séquentiel et l'allume visuellement pendant qu'elle joue. Chargement dès l'affichage du bloc (les Sfx sont de courts one-shots, contrairement aux morceaux complets qui restent chargés à la demande).
- `layerpitch-backstage.html` : nouveau type de bloc de contenu "Sfx" (bouton "+ Bloc Sfx", sélecteur miroir de celui des Collections), publication.
- `index.html` : rendu du bloc, CSS dédié.

---

## [2026-07-25] — Chantier Sfx — Phase 1 : renommage stingers→Sfx, Sfx Library

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : chantier engagé après clarification d'architecture avec Jules-Antoine : les stingers existants étaient des fichiers uploadés directement sur chaque morceau (aucune bibliothèque partagée, aucun round robin) — ce qui était demandé est une vraie bibliothèque indépendante avec variations, référencée depuis les morceaux et un nouveau bloc de contenu.

- Renommage des libellés "Stinger(s)" → "Sfx" partout où affiché (FR/EN), "Bibliothèque" → "Bibliothèque musicale" dans la navigation.
- Nouvelle "Bibliothèque Sfx" (onglet + panneau dédié) — titre, description, mode de lecture des variations (aléatoire anti-répétition ou séquentiel), ducking à cocher, variations round robin avec upload de fichier chacune.
- **Décision prise en cours de route, signalée explicitement** : migration automatique des anciens stingers différée à la Phase 3 (quand le mécanisme du bouton change réellement de mécanisme), plutôt que faite immédiatement comme initialement prévu dans le découpage annoncé — migrer les données sans encore rebrancher la lecture publique dessus aurait fait disparaître les stingers déjà publiés le temps que les deux phases se rejoignent.
- Bug de manipulation trouvé et corrigé par la vérification syntaxique : une insertion de code avait supprimé par erreur la ligne d'ouverture du bouton "+ Morceau".

---

## [2026-07-25] — Chantier Apparence — Phase 4 : Header enrichi

**Fichiers touchés** : `index.html`, `layerpitch-backstage.html`

- `profile.title`/`profile.subtitle` remplacent l'ancien champ `tagline` unique — titre + sous-titre, avec repli automatique sur l'ancien contenu pour les AdReels déjà publiés (lu une fois, jamais réécrit).
- Logo et image de fond (générique par bloc, héritée de la Phase 3) peuvent désormais coexister — décision de Jules-Antoine après clarification (les deux options plutôt qu'un choix exclusif).
- Nouvelles classes `.header-title`/`.header-subtitle` remplacent `.logo-fallback`/`.logo-tag`.

---

## [2026-07-25] — Chantier Apparence — Phase 3 : image de fond + opacité

**Fichiers touchés** : `layerpitch-backstage.html`, `index.html`

- Général (thème de l'AdReel) et par bloc — calque de rendu séparé du contenu, pour que l'opacité de l'image n'affecte jamais la lisibilité du texte par-dessus.
- Upload d'image de fond avec le même principe de fichier en attente que le logo/la photo (mirroré au changement d'AdReel, uploadé à la publication).
- Point technique repéré et corrigé en cours de route : la première tentative pour l'opacité par bloc recopiait le contenu via `innerHTML`, ce qui aurait détruit silencieusement les gestionnaires d'événements déjà attachés (formulaire de contact, lecteur de morceaux) — corrigé pour déplacer les vrais nœuds DOM plutôt que les recopier.

---

## [2026-07-25] — Chantier Apparence — Phase 2 : polices

**Fichiers touchés** : `layerpitch-backstage.html`, `index.html`

- 12 Google Fonts pré-intégrées (mélange sans-serif/serif/display) + upload de polices personnalisées, réutilisables depuis n'importe quel AdReel ou bloc.
- La page publique n'injecte que les polices réellement utilisées par l'AdReel affiché, jamais toute la bibliothèque du compositeur — chargement Google Fonts ou `@font-face` dynamique selon le cas.
- Gestion des polices personnalisées (upload, renommage, suppression, avec repli propre sur "Par défaut" si une police utilisée quelque part est supprimée).

---

## [2026-07-25] — Chantier Apparence — Phase 1 : thème général + réglages par bloc

**Fichiers touchés** : `layerpitch-backstage.html`, `index.html`

- Remplace les deux anciens champs `profile.bgColor`/`textColor` par un thème complet : couleur de fond, couleur des titres, couleur du contenu — réglable au niveau de l'AdReel entier, et individuellement pour chaque bloc de contenu (bascule "Personnaliser" par champ, tous les types de blocs sans exception, y compris Header/Bio/Témoignages/Morceaux, décision actée avec Jules-Antoine avant de coder).
- Boîte de dialogue de conflit : si un réglage général est modifié alors qu'un ou plusieurs blocs l'ont déjà personnalisé, propose de garder les réglages par bloc ou de tout aligner.
- Repli automatique sur l'ancien schéma pour les AdReels déjà publiés avant ce changement.
- Architecture discutée et validée avec Jules-Antoine avant tout code, découpée en 4 phases dès le départ vu l'ampleur du chantier.

---

## [2026-07-25] — Fusion de la console admin et des analytics bêta-testeurs

**Fichiers touchés** : `admin-beta-console.html`, `layerpitch-beta-sync.js`

- `admin-beta-console.html` absorbe `admin-analytics.html` (devenu obsolète, à supprimer du dossier d'outils) — même connexion (organisation + token), vue générale (agrégée) + vue par testeur (panneau dédié sur chaque carte).
- `createTester()` initialise désormais `events.json` avec le nom choisi (`testerId`) dès la création du repo — un testeur apparaît par son nom dans les analytics dès la création, plus besoin d'attendre une première activité. Fait à la fois dans `admin-beta-console.html` et `layerpitch-beta-sync.js` (équivalent CLI), gardés synchronisés.
- Token GitHub du backstage compositeur (`layerpitch-backstage.html`) désormais retenu en `localStorage` plutôt qu'à recoller à chaque session — justifié par le fait qu'il s'agit d'un fichier ouvert en local, jamais servi ni publié.
- **Vrai bug trouvé en creusant** : le squelette de démarrage d'un nouveau testeur bêta copiait en réalité les blocs de contenu de l'AdReel **personnel** de Jules-Antoine (donc potentiellement des blocs texte/photo/packs propres à son portfolio), avec les 4 blocs vides (Header/Bio/Témoignages/Morceaux) seulement en repli si aucun AdReel personnel n'était trouvé. Simplifié pour toujours partir des 4 blocs vierges canoniques, peu importe le contenu de l'AdReel personnel — corrigé aux deux mêmes endroits (console + CLI).

---

## [2026-07-25] — Corrections initiales de session : seek séquentiel, bloc Collections public, waveform

**Fichiers touchés** : `player.js`, `index.html`, `layerpitch-backstage.html`

- `seekSequential` : la demande "Aller vers la fin" se perdait si le visiteur avançait la tête de lecture pendant le segment en cours (`stopSequential()` l'effaçait silencieusement) — corrigé en sauvegardant/restaurant l'état autour de l'appel.
- Le curseur visuel du bloc Outro se recalait à tort au début après un seek dans ce bloc précis, alors que l'audio jouait déjà correctement depuis la bonne position (durée restante après seek jetée à `null` pour les blocs terminaux) — corrigé.
- Nouveau bloc de contenu "Collections" sur la page publique d'un AdReel, en miroir exact du bloc "Packs" déjà existant.
- Waveform "plate sur la deuxième moitié" en mode séquentiel : diagnostiquée comme non-bug de calcul (la forme montrait bien le fichier réel dans son intégralité, queue de recouvrement crossfade comprise) mais comportement indésirable une fois confirmé par Jules-Antoine — rognage de l'affichage à la durée nominale pour les blocs Intro/Segment ajouté, Outro laissé intact (pas de notion de durée nominale, fin ouverte).

---

## [2026-07-20] — Mise en place réelle de l'organisation GitHub bêta (première fois en conditions réelles)

**Fichiers touchés** : organisation GitHub `layerpitch-beta` (infrastructure, hors code)

- Organisation `layerpitch-beta` créée (compte perso, plan gratuit), skip de l'ajout de membres (les bêta-testeurs n'ont jamais besoin d'être membres de l'organisation — accès uniquement via token scopé à leur repo).
- Repo `layerpitch-beta-template` créé en public, case "Template repository" cochée.
- Token d'administration fine-grained généré (`Resource owner` = organisation, `Repository access` = All repositories, permissions Contents + Administration en Read/write).
- Confirmation que `Julzantoine/layerpitch` (repo perso) reste inchangé : aucune modification nécessaire pour accueillir la bêta, tout se passe côté organisation séparée.

---

## [2026-07-20] — Correction de `admin-beta-console.html` : bug de synchronisation de `layerpitch-backstage.html` (bug réel, pas une question de configuration)

**Fichiers touchés** : `admin-beta-console.html`

- Symptôme rencontré lors du premier `promote` réel : `layerpitch-backstage.html` systématiquement ignoré ("introuvable dans le repo perso"). Cause confirmée en session : ce fichier n'est jamais publié sur GitHub par conception (outil local uniquement) — la console tentait de le lire via l'API GitHub sur le repo perso, où il ne peut structurellement pas se trouver.
- Correctif : ajout d'un champ d'upload local (`<input type="file">` + `FileReader`) dans le bloc "Promouvoir le template" — le fichier est fourni à la main à chaque promotion plutôt que lu depuis GitHub, gardé en mémoire pour la session uniquement.
- Vérifié en conditions réelles après correctif : `rollout` sur le premier repo testeur (« Bêta test #1 ») confirmé fonctionnel, backstage bien présent et ouvrable.
- Point non traité dans cette session, à corriger côté nommage : le nom "Bêta test #1" contient un espace et un accent, transformé par GitHub en `layerpitch-beta-B-ta-test-1` — recommandation de renommer en `test1` si ce repo est gardé comme avant-poste de test permanent.

---

## [2026-07-20] — Fausse alerte clarifiée : `collection.html`

**Fichiers touchés** : aucun (clarification uniquement)

- Signalé comme "introuvable" lors du premier `promote`, initialement suspecté comme un reliquat du renommage UI "pack" → "collection" (18 juillet, textes uniquement, notait explicitement que `pack.html` restait le nom de fichier réel). Clarifié en session : `collection.html` est en réalité un vrai fichier distinct, correspondant à une entité "Collection" (regroupement de plusieurs Packs) — sans lien avec ce renommage UI. La liste `ENGINE_FILES` de la console était déjà correcte (contenait bien les deux fichiers) ; aucune correction de code nécessaire sur ce point, seulement un doute levé.

---

## [2026-07-20] — Décision confirmée en session : repos testeurs publics, pas privés

- Recherche effectuée sur les tarifs GitHub actuels : GitHub Pages sur repo privé nécessite un plan payant (Team, ~4$/mois par utilisateur facturé — les bêta-testeurs eux-mêmes ne comptant pas comme utilisateurs facturés puisqu'ils n'ont jamais de compte GitHub propre). Décision confirmée par Jules-Antoine : rester sur repos publics (gratuit), le code n'ayant aucun secret en dur et les compositeurs étant censés déposer leurs morceaux avant de les exposer publiquement. Risque assumé, pas vérifiable côté outil (chaque testeur reste responsable d'avoir fait son propre dépôt).

---

## [2026-07-20] — Nouvelle fonctionnalité dans `admin-beta-console.html` : téléchargement d'un kit testeur prêt à l'emploi

**Fichiers touchés** : `admin-beta-console.html`

- Ajout du bouton "Télécharger le kit" par testeur dans la liste, utilisant JSZip (CDN) pour générer un `.zip` contenant `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js` (les trois fichiers dont le backstage a besoin en local pour fonctionner en `file://`, hypothèse posée puis confirmée fonctionnelle en test réel) et un fichier `LISEZMOI.txt`.
- Le token n'est volontairement jamais inclus dans ce zip — à transmettre séparément, par un canal distinct.
- `LISEZMOI.txt` mis à jour en session pour être bilingue (français puis anglais), avec un repère `TUTORIAL_PLAYLIST_URL` (actuellement vide) à remplir dès que la playlist de tutos vidéo existera — n'affiche la ligne correspondante que si l'URL est renseignée.

---

## [2026-07-20] — Contenus rédactionnels de lancement bêta (pas du code)

- Relecture d'une lettre de présentation aux bêta-testeurs : quelques coquilles identifiées (accords, une formule de fin ambiguë), suggestion d'ajouter une mention explicite du caractère public des repos avant l'upload de morceaux, nuance proposée sur la formulation du tracking (accès futur du testeur à ses propres stats, distinct du tracking Umami déjà actif côté Jules-Antoine), prudence suggérée sur l'engagement de date "courant 2027".
- Scénario rédigé pour une vidéo de présentation courte (~85 secondes, format screencast + voix off façon Wwise, sans apparition à l'écran) : problème → démo live (vertical-classic puis séquentiel) → aperçu du Backstage → appel à retours honnêtes. Traduction anglaise non faite dans cette session (délégée en externe, comme le reste des traductions du projet).

---

## [2026-07-18] — Session complète : Test Gameplay, aide à l'implémentation, mode séquentiel avancé, retour "pack", console admin bêta

**Fichiers créés durant cette session** : `collection.html`, `admin-beta-console.html`.
**Fichiers modifiés en profondeur** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`, `pack.html`, `index.html`, `layerpitch-beta-sync.js`, `layerpitch-i18n-editor.html`.
**Documents projet mis à jour** : `LAYERPITCH_MASTER.md`, `LAYERPITCH_CHANGELOG.md`, `LAYERPITCH_EXTENSIONS_ENVISAGEES.md` (sections 1.5/1.6 ajoutées en tout début de session).

**1. Mode Test Gameplay — écran intégré ou détachable, bouton son**
- `video-test.html` : bouton flottant (🔇/🔊) pour réactiver/couper le son de la vidéo elle-même (utile si elle embarque déjà ses propres fx/musique). Muet par défaut au premier affichage.
- `pack.html` : détection `window.screen.isExtended` — écran unique → vidéo intégrée dans un panneau sur la page ; multi-écrans détecté → fenêtre séparée comme avant, avec tentative de positionnement sur le second écran. Disposition adaptative (empilée sous 1280px, côte à côte au-delà).

**2. Aide à l'implémentation — réglage global + message public**
- `layerpitch-backstage.html` : section avec quatre cases à cocher (Wwise, FMOD, Unity, Unreal) — réglage global pour tout le site, pas par pack.
- `pack.html` : si au moins une case cochée, message public listant uniquement les logiciels cochés.

**3. Traduction du lien "fait partie du pack"**
- `player.js` : passait par du texte français en dur, jamais traduit en anglais — corrigé, passe par `t()` avec une vraie clé i18n FR/EN.

**4. Fiche d'implémentation générée par pack (texte + JSON)**
- `layerpitch-backstage.html` : bouton "Voir la fiche d'implémentation" par pack, ouvrant une fenêtre avec deux onglets (Texte/JSON), Copier/Télécharger. Générateur structuré mode par mode (statique, vertical, vertical-random, séquentiel), description neutre/trans-middleware.
- Nouveau champ "Note d'implémentation" libre par morceau (jargon spécifique à un moteur autorisé, contrairement au reste de la fiche).

**5. Gros chantier de fond (backlog compilé en une fois)**
- Renommage complet de l'UI "pack" → "collection" (première passe, **annulée plus tard dans la session**, voir point 14).
- Présentation bilingue FR/EN des packs, avec repli sur l'autre langue si l'une est vide.
- Vignette d'illustration des packs dans le bloc "Packs" d'un AdReel.
- Redesign du message "Aide à l'implémentation" en badge discret.
- Correctif waveform du mode séquentiel figée après un changement de taille (`ResizeObserver` manquant).
- Recherche Wwise (format des tutos vidéo — épisodes courts, chaîne Audiokinetic) pour préparer une future série de tutos.

**6. Relecture complète #1 (demandée explicitement)**
- **Bug trouvé** : deux fonctions `buildPackSelectorWidget` déclarées (une préexistante pour le bloc Packs d'un AdReel, une recréée par erreur pour les Collections) — la plus tardive écrasait l'autre silencieusement. Doublon supprimé, clés i18n orphelines retirées.
- Vérifications systématiques (symétrie FR/EN, clés orphelines, `ZONE_ORDER` des éditeurs, `getElementById`) — tout confirmé propre après correctif.

**7. Waveforms affinées**
- `player.js` : résolution calculée dynamiquement selon la largeur réelle affichée (au lieu d'un nombre de barres fixe), barres arrondies et aérées, léger lissage — les trois usages (statique, vertical-random, séquentiel) partagent maintenant le même code de rendu (`renderWaveformPair`).

**8. Compilation des changelogs partiels + dates reconstruites**
- Recherche dans le project knowledge de plusieurs changelogs partiels non visibles depuis l'explorateur de fichiers — historique complet du 1er au 18 juillet reconstitué dans `LAYERPITCH_CHANGELOG.md`.
- Date du fix iOS/Safari corrigée : le 11 juillet (date exacte retrouvée), pas le 12 approximatif retenu au départ.

**9. Sauvegarde / restauration / notification pour la bêta GitHub**
- Discussion d'architecture avant code (limite du nombre de sauvegardes, permissions du token, canal de notification au testeur).
- `layerpitch-beta-sync.js` : `rollout` crée automatiquement une branche de sauvegarde (`backup-AAAA-MM-JJ[-HHhMM]`) avant toute modification, jamais de purge automatique. Nouvelles commandes `restore <nom> [branche] [--notify]`, `list-backups <nom>`, `notify <nom|--all> --fr "…" --en "…"` (bandeau d'alerte dans le Backstage du testeur, fusion ciblée d'un seul champ `data.backstageNotice`, jamais un remplacement de contenu).
- `layerpitch-backstage.html` : bandeau d'alerte affiché si `data.backstageNotice` présent, bouton "J'ai vu" qui republie le `data.json` du testeur pour l'effacer.

**10. Console admin bêta (nouveau fichier)**
- `admin-beta-console.html` : interface web reprenant toute la logique de `layerpitch-beta-sync.js` (mêmes fonctions), pour piloter promote/create/rollout/restore/notify sans taper de commandes dans un terminal. Liste des testeurs, panneau "Sauvegardes" dépliable par testeur.

**11. Réharmonisation avec du code généré dans un autre canal (plusieurs fois)**
- **Repos testeurs passés en public** (`private: false`) — décision confirmée après avoir expliqué l'implication (contenu visible publiquement), appliquée dans `layerpitch-beta-sync.js` et `admin-beta-console.html`.
- **Bug préexistant trouvé** : `layerpitch-backstage.html` n'est jamais poussé sur le repo perso GitHub (outil local, jamais publié) — `promote()` essayait de le lire via l'API GitHub et échouait silencieusement depuis le début. Corrigé (lecture locale sur disque côté script Node, upload manuel côté console web).
- **Kit testeur téléchargeable** adopté (bouton par testeur, `.zip` via JSZip) — `player.js` ajouté à la liste des fichiers empaquetés (oublié dans la version reçue, aurait cassé l'aperçu local du testeur).
- README du kit rendu bilingue (langue du testeur) + ligne vers une playlist de tutos vidéo, uniquement si son URL est renseignée (vide tant qu'elle n'existe pas).

**12. Corrections du master (à la demande, en vérifiant)**
- "Structure à trois concepts" → **quatre concepts**, `collections[]` manquant ajouté (+ liste des onglets sidebar backstage, qui n'incluait pas non plus Collections).
- Modes de lecture hybrides (décidés dans une autre conversation) ajoutés au master, avec pointeur vers `LAYERPITCH_EXTENSIONS_ENVISAGEES.md` section 0 — signalé mais **pas fusionné** : une section stratégie de communication (Guy Michelmore, ThinkSpace, cible bêta) mise à jour dans cette même autre conversation, restée en attente d'une décision explicite sur la méthode de fusion. *(Point resté en suspens à la fin de cette session.)*

**13. Renommage "layering vertical" → "layering vertical additif" + modes grisés**
- Vérification exhaustive de toute occurrence avant renommage (aucune collision trouvée, contrairement au précédent connu du projet). Renommage du texte affiché uniquement, identifiant interne `mode: 'vertical'` inchangé.
- Trois nouveaux modes hybrides ajoutés en grisé dans le menu déroulant du mode (Backstage), aux côtés de "Embranchement (à venir)" — signal visible que d'autres modes sont envisagés.

**14. Retour en arrière complet "collection" → "pack" + nouvelle entité Collection**
- Le vocabulaire UI redevient "pack" partout (annule le point 5) ; "Collection" désigne désormais un **regroupement de packs**, un niveau au-dessus.
- Nouveau fichier `collection.html` (page publique dédiée), nouvel onglet "Collections" dans le Backstage (titre, illustration, présentation bilingue, sélecteur de packs à inclure).
- Mention "Fait partie de la collection : X" sur `pack.html`. Vignette d'illustration des packs listés. Redesign du message "Aide à l'implémentation" en badge discret (repris tel quel après le retour en arrière).

**15. Mode séquentiel — emplacements multiples chaînés, duplication, répétitions**
- `track.segments[]` (pool plat) remplacé par `track.segmentSlots[]` — emplacements chaînés dans un ordre défini et réordonnable, chacun avec son propre pool d'alternatives. Structure confirmée : Intro → Séquence A → B → C → ... → reboucle sur A, jusqu'à "Aller vers la fin" → Outro.
- **Duplication de pool** (économie mémoire), pour les emplacements séquentiels *et* les groupes vertical-random : un emplacement/groupe peut référencer le contenu d'un autre déjà défini plutôt que de recharger deux fois les mêmes fichiers — anti-répétition partagée entre les occurrences d'un même pool dupliqué.
- **Répétitions par emplacement** (`repeatCount`) — combien de fois un emplacement rejoue avant de passer au suivant, pour une structure type AABA sans dupliquer l'emplacement lui-même.
- Garde-fou ajouté : un emplacement qui sert déjà de source à d'autres ne peut pas à son tour devenir un duplicata (empêche une chaîne de références à deux niveaux, non gérée par le lecteur).

**16. Relecture complète #2 (trois bugs réels trouvés)**
- Plantage en exécution (`rerollPool()` appelait `.map()` sur un objet, hérité d'avant la conversion en clé canonique).
- Anti-répétition cassée pour tous les groupes vertical-random (lecture d'une clé au mauvais format).
- Gain de correction et libellé ignorés pour les emplacements/groupes dupliqués (résolution du mauvais objet source) — corrigé via `resolveSlotAlternative()`.

**17. Correctifs beta-sync découverts en compilant le changelog**
- `layerpitch-i18n-editor.html` : `ZONE_ORDER` ne listait pas la nouvelle zone `collection` — une sauvegarde depuis cet outil aurait silencieusement supprimé toute la zone.
- `layerpitch-beta-sync.js` : `collection.html` (nouveau fichier) manquait dans `ENGINE_FILES` — lien mort pour un testeur.

**18. Certification "sans IA"**
- Réglage global (case à cocher + texte légal complet affiché en clair dans le Backstage), exception possible par morceau (suivre le réglage global / toujours certifier / ne jamais certifier).
- Badge public à côté du titre du morceau — d'abord en texte encadré, puis **rendu plus discret** sur demande : petite icône graphique (bouclier + coche), tooltip au survol. Si **tout** un bloc rendu est certifié, un seul badge apparaît une fois à côté de "Musique" plutôt que de répéter l'icône sur chaque ligne.
- Bloc "Je certifie…" du Backstage également allégé (plus de cadre, texte discret).

**19. Relecture complète #3 (un oubli trouvé)**
- L'aperçu local "▶ Écouter" du Backstage appelait la fonction de rendu sans les nouveaux paramètres — le badge sans IA n'aurait jamais reflété le réglage global dans l'aperçu. Corrigé.

**20. Option d'achat pour les collections**
- Mêmes champs `buyable`/`buyUrl` que pour un pack, même UI Backstage, même bouton d'achat sur `collection.html` — indépendant du bouton d'achat de chaque pack qui compose la collection.

**21. Diagnostic d'une erreur de chargement sur `collection.html`**
- Logique de chargement comparée ligne à ligne à `pack.html`/`index.html` — identique, aucun bug de fond trouvé.
- Erreur avalée silencieusement dans les trois pages publiques (aucune trace en console) — corrigé, `console.error()` ajouté avant le message affiché au visiteur.
- Trou séparé trouvé en vérifiant : `collection.html` charge `player.js` mais n'était pas inclus dans la réécriture automatique de version à la publication (`updatePlayerScriptVersion`) — corrigé.
- Cause exacte de l'erreur d'hier non confirmée avec certitude (fichier pas encore re-uploadé au moment du test, ou propagation du cache GitHub Pages) — à reproduire avec la console ouverte pour trancher définitivement si ça se reproduit.

**22. Note de sécurité ajoutée au master**
- Principe "ne jamais faire confiance au client" (retour d'expérience externe sur un cas de triche de leaderboard déjoué par Row Level Security + RPC côté serveur) noté dans la section Bascule backend — à appliquer le jour où LayerPitch aura de vrais comptes/paiements.

---

## [2026-07-16] — (Ré)implémentation du tracking d'usage interne du backstage

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`

**Contexte** : suite du chantier "bêta multi-github" — le master mentionnait ce système comme "implémenté, non testé en conditions réelles", mais un audit exhaustif (fait dans le cadre de la revue de `admin-analytics.html`) a confirmé son absence totale du backstage actuel. Reconstruit entièrement, avec le format exact déjà attendu par `admin-analytics.html` (jamais modifié) : `{ testerId, events: [{ type, name, ts, context, detail }] }`.

**Architecture** :
- Vocabulaire fermé : `tab_switch`, `track_add`, `track_delete`, `pack_add`, `pack_delete`, `adreel_add`, `adreel_delete`, `block_add`, `preview_play`, `publish_click`, `publish_success`. Erreurs capturées automatiquement (`window.onerror` + `unhandledrejection`), sans action du testeur.
- Tamponné en `localStorage` (`layerpitch_backstage_events_buffer`) — jamais son propre appel réseau, aucune latence perçue, aucune dépendance à un service tiers.
- Case **"Mode test"** dans le fieldset Dépôt GitHub, persistée en `localStorage`, distingue `context: "real"` de `context: "test"` — permet à Jules-Antoine de tester l'outil sans polluer les vraies statistiques d'usage des testeurs.
- À la publication : le tampon est fusionné avec l'`events.json` existant du repo (jamais un écrasement — plusieurs sessions/navigateurs pourraient sinon se marcher dessus), publié, puis le tampon local est vidé. Échec silencieux si la fusion échoue (le tampon reste intact, retenté à la prochaine publication) — ne doit jamais faire capoter une publication réelle.
- FR/EN comme le reste du backstage (nouvelle clé `modeTestLabel`) ; bulle d'aide ajoutée (`modeTestToggle`, zone `misc`).

**Vérification** : syntaxe validée sur les 3 fichiers, cycle complet testé en conditions réelles (Node/jsdom, GitHub simulé en mémoire) — changement d'onglet, ajout de morceau, ajout de bloc capturés dans le tampon ; publication déclenchée ; `publish_click`/`publish_success` ajoutés ; tampon fusionné et publié dans `events.json` avec la structure exacte attendue par `admin-analytics.html` ; tampon local vidé après succès.

---

## [2026-07-16] — Tracking Umami : interactions d'adaptativité (intensité, solo/mute, stingers, rafraîchissement)

**Fichiers touchés** : `player.js`

**Contexte** : suite du chantier "tracking Umami par AdReel/Pack" (voir entrée précédente, menée dans une autre session le même jour) — celle-ci couvrait déjà `track_play`, `track_loop_change`, `go_to_end_click`, `contact_submit`, `video_test_open`/`invalid_url`, tous enrichis automatiquement du contexte `adreel`/`pack` via `window.__lpTrackContext`. Il manquait les interactions propres à l'adaptativité elle-même.

**⚠️ Note de synchronisation** : au moment de reprendre ce chantier, les copies de travail locales n'avaient pas cette avancée (menée ailleurs). Resynchronisé depuis les fichiers du projet avant toute modification pour ne rien écraser — `layerpitch-backstage.html` avait également reçu une fonctionnalité de couleur de fond locale au même moment, préservée intacte.

**Changement** : quatre nouveaux événements, tous bénéficiant automatiquement du même enrichissement de contexte (`adreel`/`pack`) que les événements existants, aucune modification du mécanisme lui-même nécessaire :
- `intensity_change` — clic sur une puce d'intensité (mode vertical layering), `{ trackId, level }`.
- `voice_solo_toggle` / `voice_mute_toggle` — bascule solo ou muet sur une voix individuelle (couche fixe, groupe aléatoire, ou couche classique selon le mode), `{ trackId, voice, active }`.
- `stinger_play` — déclenchement manuel d'un stinger, `{ trackId, stingerIndex }`.
- `pool_refresh` — clic sur "Rafraîchir le pool" (mode vertical-random), `{ trackId }`.

**Vérification** : testé en conditions réelles (Node/jsdom, `window.umami.track` intercepté) sur `index.html` avec le vrai `data.json` — clic simulé sur une puce d'intensité et un bouton solo, événements `intensity_change` et `voice_solo_toggle` confirmés reçus avec `adreel: "main"` correctement attaché.

---

## [2026-07-16] — `layerpitch-beta-sync.js` : audit complet + deux correctifs (ENGINE_FILES obsolète, rollout non résilient)

**Fichiers touchés** : `layerpitch-beta-sync.js`

**Contexte** : reprise du chantier "bêta multi-testeurs" resté en pause depuis le 14 juillet. Le script n'était pas dans le projet (jamais uploadé après sa rédaction initiale) — récupéré auprès de Jules-Antoine puis audité en détail contre l'état réel actuel des fichiers moteur et du schéma `data.json`.

**Bug 1 — `ENGINE_FILES` obsolète** : ne listait que `index.html`, `pack.html`, `player.js`, `layerpitch-backstage.html`. Or `layerpitch-i18n.js` (chargé par ces quatre fichiers **et** `video-test.html`) et `layerpitch-help.js` (chargé par le backstage) ont été créés après ce script et n'y avaient jamais été ajoutés. Sans correctif, chaque repo testeur créé via `create` se serait retrouvé avec des clés de traduction brutes affichées à l'écran, aucune bulle d'aide, et une page "Mode Test Gameplay" cassée (404 sur `video-test.html`, jamais copié). `ENGINE_FILES` étendue à 7 fichiers. `layerpitch-i18n-editor.html`/`layerpitch-help-editor.html` restent volontairement exclus (outils locaux, jamais destinés aux repos testeurs).

**Bug 2 — `rollout` non résilient à l'échec d'un repo** : aucun `try/catch` autour du traitement par repo — un seul testeur en échec (repo supprimé, accès token, erreur réseau ponctuelle) interrompait tout le processus, y compris en `rollout --all` sur l'ensemble des testeurs. Corrigé : chaque repo est maintenant traité indépendamment, un échec est journalisé et reporté en fin d'exécution (nouvelle catégorie "en échec", distincte des repos ignorés pour incompatibilité de schéma), sans jamais bloquer le traitement des suivants.

**Vérifications effectuées** (au-delà des deux bugs) : schéma de `buildStarterDataJson` comparé champ par champ au vrai `data.json` de production (clés de `profile`, types de blocs `text`/`photo`/`video`/`packs`/`contact`/singletons) — cohérent, aucun écart. Substitution owner/repo dans le backstage du template — un seul `value="Julzantoine"`/`value="layerpitch"` dans le fichier actuel, pas de risque de remplacement partiel.

**Vérification (Node, GitHub simulé en mémoire avec les vrais fichiers du projet)** : `promote` → les 7 fichiers moteur + `data.json` (squelette) correctement copiés et régénérés, ordre des blocs et champs vidés conformes à l'AdReel "main" réel ; `create` → repo testeur simulé, placeholder `__TESTER_REPO__` correctement remplacé par le vrai nom de repo ; `rollout` ciblé → mise à jour correcte ; `rollout` avec un repo inexistant au milieu du lot → échec isolé et journalisé, les autres repos traités normalement, script non interrompu.

**Reste à faire côté Jules-Antoine avant la première utilisation réelle** (inchangé depuis le 14 juillet, toujours valable) : créer l'organisation GitHub dédiée à la bêta, renseigner son nom dans `CONFIG.BETA_ORG`, créer le repo `layerpitch-beta-template` dans cette organisation et cocher "Template repository" dans ses paramètres GitHub, générer un token fine-grained avec accès au repo perso et à l'organisation bêta.

---

## [2026-07-16] — Bug : l'ordre des blocs n'était pas conservé à l'import d'un AdReel source

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : signalé par Jules-Antoine — en créant un nouvel AdReel en important le contenu d'un autre, la Bio se retrouvait toujours en 2ᵉ position même si elle avait été déplacée tout en bas dans l'AdReel source.

**Diagnostic** : `freshBlocks()` (ordre figé `header → bio → testimonials → tracks`) servait de base à **tout** nouvel AdReel, y compris ceux créés par import ; les blocs "extra" (texte/photo/vidéo/packs/contact) de la source étaient ensuite collés à la fin via `cloneExtraBlocks()`. La position réelle des blocs dans la source n'était donc jamais lue.

**Changement** : `cloneExtraBlocks()` remplacée par `buildBlocksForNewAdReel(source, importExtraBlocks)`, qui reconstruit la liste de blocs dans l'**ordre exact** de `source.blocks` quand une source est utilisée (les cases à cocher du formulaire d'import ne contrôlent que le **contenu** copié — profil, témoignages, morceaux — jamais la position des blocs). `freshBlocks()` reste utilisée telle quelle pour un AdReel vraiment vierge (aucune case cochée, ou aucune source choisie).

**Vérification** : logique testée isolément (Node) sur le cas signalé (bio déplacée en dernier dans la source) — l'ordre du nouvel AdReel reproduit exactement celui de la source.

---

## [2026-07-16] — Sidebar backstage : regroupement visuel de la section AdReel

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : retour direct de Jules-Antoine sur une capture — la hiérarchie de la sidebar (Bibliothèque/Packs vs sélecteur d'AdReel vs Contenu/Apparence) n'était pas assez lisible visuellement, contrairement au bouton de retour bêta (encadré en pointillés) qui, lui, se distinguait bien.

**Changement** : le sélecteur d'AdReel (menu déroulant, +Nouveau/Suppr., lien public) et les boutons "Contenu"/"Apparence" sont désormais regroupés dans un même cadre visuel (fond légèrement grisé, bordure arrondie) — rend explicite que ces trois éléments concernent tous l'AdReel actuellement sélectionné, par opposition à "Bibliothèque"/"Packs" au-dessus (globaux, partagés entre tous les AdReels). Un doublon du bouton "Apparence" introduit lors d'une édition précédente a été supprimé au passage.

---

## [2026-07-16] — Formulaire de retour bêta dans le backstage

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`

**Contexte** : jusqu'ici, le retour des bêta testeurs passait uniquement par un contact manuel (mail/message, voir `LAYERPITCH_TUTO_BETA_TESTEURS.md`). Objectif : un moyen direct depuis le backstage, sans en sortir.

**Décisions actées avant codage** : endpoint Formspree fixe appartenant à Jules-Antoine (pas celui du testeur — sinon chaque testeur recevrait ses propres retours au lieu de les envoyer) ; contexte du repo testeur (`owner/repo`) inclus automatiquement dans l'envoi ; bouton discret et permanent dans la sidebar plutôt qu'un nouvel onglet ; fait partie des fichiers "moteur" à promouvoir vers le template bêta (`layerpitch-beta-sync.js` → `promote`), comme `index.html`/`pack.html`/`player.js`/`layerpitch-backstage.html`.

**Changement** : bouton "Faire un retour sur la version" en bas de la sidebar, ouvrant une modale (même pattern visuel que les modales existantes — lien, nouvel AdReel) avec un simple champ message. À l'envoi : POST vers Formspree avec le message, le repo (`owner/repo`) et un sujet auto-généré. FR/EN comme le reste du backstage (nouvelles clés dans `layerpitch-i18n.js`, zone `backstage`) ; bulle d'aide contextuelle ajoutée (nouvelle zone `misc` dans `layerpitch-help.js`).

**Endpoint** : réutilise le même Formspree que le formulaire de contact public (`https://formspree.io/f/mojognrj`, compte Jules-Antoine) — décision prise pour éviter de créer un second formulaire ; les deux flux se distinguent dans la boîte mail via le sujet auto-généré (repo/testeur).

**Vérification** : syntaxe validée, testé en conditions réelles (Node/jsdom) — ouverture de la modale, saisie, envoi intercepté et inspecté (contenu du `FormData` confirmé correct : message, repo, sujet), message de confirmation affiché.

---

## [2026-07-16] — Bulles d'aide contextuelle : moteur + première section (Bibliothèque)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-help.js` (nouveau), `layerpitch-help-editor.html` (nouveau)

**Contexte** : chantier identifié depuis plusieurs sessions ("aide contextuelle dans le backstage"), deux décisions bloquantes tranchées cette session : portée = tous les contrôles, rédaction = Claude écrit les textes (éditables ensuite par Jules-Antoine), langue = FR/EN suivant la langue du backstage (même mécanisme que `tr()`).

**Architecture** (même principe que l'i18n) :
- Attribut `data-help="clé"` posé sur les libellés/contrôles concernés — aucune modification des contrôles existants.
- `layerpitch-help.js` : nouveau fichier séparé de `layerpitch-i18n.js` (contenu pédagogique, pas de la traduction d'interface), structure `{ fr: { zone: {...} }, en: { zone: {...} } }`. Une seule zone au départ : `library`.
- Moteur générique dans `layerpitch-backstage.html` : un seul listener délégué sur `document` (`mouseover`/`mouseout`, pas `mouseenter`/`mouseleave` qui ne remontent pas — indispensable puisque le contenu se reconstruit en permanence via `innerHTML`), délai d'affichage ~500ms, positionnement automatique au-dessus ou en dessous selon la place disponible.
- `layerpitch-help-editor.html` : nouvel éditeur, sur le modèle de celui de l'i18n, mais les deux langues sont éditables directement (pas un flux de traduction depuis un français figé, puisque c'est du contenu rédigé, pas traduit) — inclut suppression de clé.

**Portée finale (toutes sections couvertes)** : 47 bulles au total. `library` (20), `packs` (7), `appearance` (3), `github` (4), `content` (12 — endpoint Formspree, alignement de bloc, tagline/logo/email/site du Header, photo/texte du Bio, sélecteur de morceaux du bloc Tracks, surcharges de texte par AdReel, lien/vignette vidéo), `misc` (1 — bouton de retour bêta). Champs simples et auto-explicites (titre, nom d'une couche/segment, auteur d'un témoignage) restent volontairement sans bulle — à réévaluer au cas par cas si besoin.

**Vérification** : syntaxe validée sur les 3 fichiers, moteur testé en conditions réelles (Node/jsdom) — affichage après délai, texte correct, disparition au survol sorti, bascule FR→EN confirmée par un changement direct de `tHelp()`.

**Statut** : chantier considéré complet pour la portée "tous les contrôles non-triviaux" validée en début de session — reste ouvert si Jules-Antoine identifie des champs "simples" qui mériteraient quand même une bulle à l'usage.

---

## [2026-07-16] — Traduction complète du dictionnaire i18n (FR → EN)

**Fichiers touchés** : `layerpitch-i18n.js`

**Contexte** : Toutes les valeurs anglaises du dictionnaire (zones `shared`, `index`, `pack`, `player`, `backstage`, `videoTest`) étaient vides depuis la mise en place du système i18n — seul le français était rempli.

**Changement** : les 347 clés anglaises vides ont été traduites à partir de leur équivalent français, zone par zone. Le vocabulaire technique standard du game audio (Wwise, layering, stinger, BPM, AdReel, etc.) a été conservé tel quel plutôt que traduit littéralement. Les placeholders (`{n}`, `{label}`, `{path}`, `{title}`, etc.) ont été préservés à l'identique, position vérifiée par script pour chaque paire FR/EN. Le bloc `fr` n'a pas été touché (diff vérifié identique à l'original).

**Vérification** : syntaxe validée, aucune valeur anglaise vide restante, rendu réel testé en environnement Node/jsdom avec `lang: 'en'` sur un AdReel réel (`index.html` + `player.js` + le nouveau dictionnaire) — libellés d'interface bien en anglais, contenu du compositeur (témoignages, titres) resté intact dans sa langue d'origine.

**Point de vigilance pour la suite** : ces traductions sont une première passe automatisée, pas une relecture par un locuteur natif — à faire relire si le AdReel anglais est destiné à un studio/éditeur important.

---

## [2026-07-16] — Bug critique : collision globale `t` avec le décodeur Ogg Vorbis (site public + backstage vides)

**Fichiers touchés** : `index.html`, `pack.html`, `layerpitch-backstage.html`

**Contexte** : Après la mise en place du système i18n FR/EN, le backstage local s'affichait vide (sidebar et boutons visibles, mais aucun contenu — bibliothèque, packs, AdReel — ne se chargeait). Une fois republié sur GitHub, le site public (`index.html`) présentait le même symptôme : page quasi blanche.

**Diagnostic** :
- Premier correctif tenté (insuffisant) : `currentLang()` dans le backstage utilisait `localStorage.getItem(...)` sans `try/catch`, contrairement à `player.js` qui protège déjà cet accès. Corrigé par précaution, mais ce n'était pas la cause racine (l'erreur réelle survenait ailleurs).
- Pistes écartées après tests : extension de navigateur (persistant en navigation privée), cache/déploiement GitHub Pages stale (le code livré via Cmd+U était identique au code source), fichier `layerpitch-i18n.js` corrompu ou désynchronisé (identique en MD5 à la version testée), bug de logique dans le code métier (aucune reproduction obtenue via un environnement Node/jsdom exécutant le vrai code avec le vrai `data.json`, sur les 3 AdReels réels).
- Instrumentation du `catch` de `init()` avec un `console.error` a révélé l'erreur réelle, jusque-là masquée : `TypeError: t is not a function`, survenant dès le tout premier appel à `applyI18n()`.
- **Cause racine trouvée** : le fichier tiers `ogg-vorbis-decoder.min.js` (chargé via `<script defer src="https://unpkg.com/@wasm-audio-decoders/ogg-vorbis/...">`) déclare, à la racine de son bundle minifié (hors de toute IIFE), `var t, s; t = this; ...`. Chargé comme script classique (pas de module, pas isolé), cette déclaration devient `window.t` et écrase silencieusement la fonction de traduction globale `t()` définie dans `index.html`, `pack.html` et `layerpitch-backstage.html` — juste avant l'événement `load`, donc juste avant que `init()` ne s'exécute.
- `player.js` n'était pas affecté : sa propre fonction `t()` interne vit dans une IIFE, isolée de cette collision globale.
- Confirmation par reproduction fidèle : un faux script simulant exactement ce `var t; t = this;` a reproduit l'erreur exacte sur la version non corrigée, et a tourné sans erreur sur la version corrigée.

**Changement** : renommage de la fonction de traduction globale `t()` → `tr()` dans les trois fichiers concernés (déclaration + tous les appels, ~335 occurrences au total). Les usages locaux non liés (`.forEach(t => ...)`, `t.id`, `t.title`, etc., où `t` désigne un morceau/testimonial et non la traduction) n'ont pas été touchés — ils ne posent aucun problème, la collision ne concernait que la fonction globale. `player.js`, `layerpitch-i18n.js` et `video-test.html` inchangés.

**Point de vigilance pour la suite** : éviter les noms de fonctions globales trop génériques (`t`, `s`, `e`, etc.) dans tout fichier chargé comme script classique (non-IIFE, non-module) — ce type de collision avec des bundles tiers minifiés est difficile à diagnostiquer (l'erreur apparaît loin de sa cause réelle) et silencieux tant qu'on ne regarde pas l'erreur brute (elle était masquée par le `catch` qui affichait un message générique).

---

## [2026-07-06] — Fenêtres dépliables du backstage, convertisseur multi-format, consolidation

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : Le formulaire du backstage s'allongeait à mesure que blocs/morceaux/packs s'accumulaient. Deux améliorations notées comme faisables immédiatement (sans dépendance à un système de comptes), extraites des pistes "petites améliorations" du document d'extensions.

**Changement** :
- Ajout d'une flèche ▾/▸ de repli/dépli sur chaque carte de bloc (Header, Bio, Témoignages, Musique, Packs, Texte, Photo, Vidéo), sur chaque morceau individuel et sur chaque pack individuel, sans toucher aux données ni à l'ordre. *Retour utilisateur : la flèche est jugée trop discrète visuellement — amélioration à prévoir.*
- Convertisseur audio étendu au MP3 en entrée (en plus du WAV) : le décodage `decodeAudioData` du navigateur gère nativement les deux formats, aucune librairie de décodage supplémentaire n'a été nécessaire. Changement limité aux attributs `accept` des sélecteurs de fichier et au renommage de la fonction `wavFileToOgg` → `audioFileToOgg` (purement cosmétique/clarté).
- Basculement du thème visuel du backstage vers un fond blanc (demande esthétique, aucun changement fonctionnel).
- Ajout du champ HTML d'un sélecteur de couleur pour le fond du backstage lui-même (`#backstageBgColor`) — **câblage JavaScript non terminé** (pas de persistance ni d'application effective à ce stade). À reprendre via `localStorage` (légitime ici, fichier ouvert localement hors du cadre des artifacts Claude).
- Correction de couleurs résiduelles du thème sombre oubliées lors du passage au thème clair (`color:#ccc` illisible sur fond blanc → `#444`).
- Rédaction d'un master consolidé complet (architecture, schéma de données, comportement du lecteur, bugs, roadmap, extensions envisagées, modèle économique) à repousser dans le Project.

---

## [2026-07-05] — Apparence personnalisable, page publique élargie, corrections visuelles

**Fichiers touchés** : `index.html`, `pack.html`, `layerpitch-backstage.html`

**Contexte** : Retour sur l'esthétique après plusieurs jours centrés sur le fonctionnel. Demande de personnalisation de couleurs (page publique et pages de pack), et deux défauts visuels remontés par capture d'écran (vignette vidéo custom assombrie inutilement, images de grille ne remplissant pas la largeur, logo trop petit).

**Changement** :
- Nouvelle section "Apparence" dans le backstage : deux sélecteurs de couleur (fond, texte) appliqués à `index.html` via `profile.bgColor`/`profile.textColor`, injectés en JS sur les custom properties CSS `--bg`/`--text` au chargement.
- Chaque pack gagne ses propres `bgColor`/`textColor`, indépendants de la page principale, appliqués sur `pack.html` de la même façon.
- Page publique élargie de 760px à 1100px (demande explicite de se rapprocher de la largeur utilisée par ReelCrafter).
- Grilles photo (`.photo-grid`) et vidéo multi-items (`.video-grid-multi`) passées d'un nombre de colonnes fixe (3, ou calculé par racine carrée) à `grid-template-columns: repeat(auto-fit, minmax(...))` : remplissage automatique de toute la largeur disponible en une seule ligne quand la place le permet, sans reste isolé.
- Suppression du dégradé sombre systématique plaqué sur les vignettes vidéo avec image (pensé pour la lisibilité du titre superposé) : assombrissait des vignettes ayant déjà leur propre design/texte intégré sans qu'aucun titre n'ait besoin d'être protégé. Remplacé par un `text-shadow` porté uniquement par le texte du titre, l'image reste intacte quand elle est utilisée seule.
- Correction taille du logo : le CSS ne faisait que plafonner une taille maximale (`max-width`/`max-height`) sans jamais forcer l'agrandissement d'une image source de faible résolution, qui s'affichait donc à sa taille native (petite). Remplacé par un `width` en `clamp()` qui force la mise à l'échelle.
- Décision de design actée (non codée) : sortir le curseur d'intensité et l'en-tête commun "Intensité" de la vue compacte de la playlist, pour ne les afficher que dans la vue dépliée d'un morceau — motivé par le fait que les futurs modes (séquentiel, embranchement) auront leur propre zone de contrôle, pas une réutilisation forcée du curseur à crans (spécifique au layering vertical et vertical randomisé).
- Idée notée (non codée) : visualisation façon vue "Voice/Signal Graph" de Wwise pour le futur mode vertical randomisé (une ligne par instrument, mise en évidence de la variante piochée à chaque itération) — dépend du développement du mode lui-même, non commencé.

---

## [2026-07-04] — Packs (regroupement de morceaux, page dédiée)

**Fichiers touchés** : `index.html`, `layerpitch-backstage.html`, nouveau fichier `pack.html`

**Contexte** : Besoin de regrouper plusieurs morceaux liés (ex. les 3 pistes "Robotic Adventure Game") sous une page dédiée plutôt que de toutes les afficher dans la playlist principale, avec un bouton d'achat (fictif à ce stade).

**Changement** :
- Nouvelle entité `packs` dans `data.json` (id, title, illustration, presentation, buyable, buyUrl), gérée dans une nouvelle section "Packs" du backstage (liste, création rapide "+ Nouveau pack..." directement depuis le sélecteur de pack d'un morceau).
- Chaque morceau gagne `packId` (rattachement optionnel) et `showInMainPlaylist` (bool, permet de le retirer de la playlist principale tout en le gardant accessible via la page de son pack).
- Nouveau fichier `pack.html`, autonome, lit `data.json`, filtré par paramètre d'URL `?id=...` : illustration, texte de présentation, morceaux du pack (même moteur de lecture que la page principale), bouton d'achat en bas (actif seulement si achetable + lien renseigné, sinon "Bientôt disponible" grisé).
- Lien "Fait partie du pack : [titre]" ajouté dans la vue dépliée d'un morceau rattaché à un pack, renvoyant vers `pack.html?id=...`.

**Diagnostic (bug de test)** : le lien "Fait partie du pack" n'apparaissait pas après publication malgré des données correctes des deux côtés (`data.json` et formulaire). Cause : le fichier `index.html` en ligne sur GitHub n'était pas encore la version incluant la fonctionnalité — confirmé en comparant le code source réellement servi (`Cmd+U`) à la recherche d'une chaîne de caractères unique au nouveau code. Un deuxième épisode du même type a révélé un vrai échec de déploiement GitHub Pages ("Deployment failed, try again later", visible dans l'onglet Actions du repo) — résolu par un simple "Re-run jobs", sans changement de code nécessaire.

**Diagnostic (bug de données)** : deux morceaux ("Attack Of The Robots_The Corridor" et "_The Final Battle") partageaient le même `id`, donc le même dossier audio — l'un des deux fichiers avait probablement écrasé l'autre sur GitHub. Cause : l'`id` n'était généré qu'une fois, au moment de la première publication, à partir du titre — deux morceaux créés avec un titre par défaut identique (ou jamais renommés avant publication) produisaient le même `id`. Corrigé manuellement dans `data.json` (nouvel `id` + `base` cohérents), puis fichier audio manquant reuploadé via le backstage.

---

## [2026-07-03] — Modes statique/vertical, stingers, coordination inter-pistes

**Fichiers touchés** : `index.html`, `layerpitch-backstage.html`

**Contexte** : Le prototype V1 (layering vertical uniquement) fonctionnait mais ne couvrait pas les morceaux à piste unique (thèmes, ambiances). Ajout d'un second mode de lecture et d'un mécanisme de clips déclenchables à la main (stingers), avec une refonte de la présentation de la playlist pour rester lisible à mesure que le nombre de morceaux augmente.

**Changement** :
- Ajout du champ `mode` par morceau : `static` (une seule piste) en plus de `vertical` (couches). Les futurs modes (`vertical-random`, `sequential`, `branching`) réservés dans le schéma et le sélecteur du backstage (grisés, non sélectionnables) pour anticiper sans construire.
- Ajout du champ `loopable` (bool) pour les morceaux statiques : détermine si la piste boucle en continu (ambiance) ou joue une fois puis s'arrête (thème/générique, remise à zéro automatique en fin de lecture).
- Ajout des **stingers** : clips courts déclenchables à la main pendant la lecture, d'abord réservés au mode statique puis étendus à tous les modes sur demande. Superposables librement entre eux. Disponibles dès que la piste est dépliée et chargée (pas seulement quand elle joue).
- Refonte de la présentation de la playlist : ligne compacte par défaut (bouton play/pause unique, titre, étiquette de format), dépliable au clic pour voir description/barre de progression/stingers. Curseur d'intensité à crans (chiffres seulement, pas de libellés adjectifs), en-tête commun "Intensité" affiché une fois en haut du bloc Musique.
- Un seul morceau actif à la fois : lancer la lecture d'un morceau stoppe la musique et les stingers d'un autre morceau, et replie sa vue.

**Diagnostic (bugs de coordination inter-pistes, deux corrections successives)** :
1. Cliquer sur play d'une autre piste ne coupait pas la précédente : le mécanisme de coordination n'existait pas encore lors du premier test — ajouté (événement `stop-track` diffusé + registre de fonctions de repli/arrêt de stingers par piste).
2. Une piste dépliée manuellement (sans avoir été jouée) ne se repliait pas quand une autre démarrait : le repli ne ciblait que la dernière piste *active*, pas l'ensemble des pistes ouvertes. Corrigé en repliant systématiquement toutes les pistes du registre sauf celle qui démarre.

---

## [2026-07-02] — Corrections de lecture, portfolio à blocs réordonnables

**Fichiers touchés** : `index.html`, `layerpitch-backstage.html`

**Contexte** : Premiers tests réels du prototype V1 (Battle Loop, 3 couches) après la mise en ligne initiale, puis élargissement de la page publique vers une structure complète façon ReelCrafter (bio, témoignages, vidéos), demandée éditable sans toucher au code.

**Changement / diagnostic** :
- Bug : zone cliquable de la barre de progression trop fine (3px, alignée sur la barre visuelle) → hitbox invisible élargie à 24px de hauteur.
- Bug : retours à la ligne non affichés dans les descriptions (le CSS ne préservait pas les `\n`) → `white-space: pre-wrap` ajouté.
- Bug : clic sur la barre de progression pendant la lecture n'avait aucun effet → la position cliquée était calculée puis immédiatement écrasée par le recalcul de position fait par la fonction d'arrêt (`stopAllSources`), appelée juste après. Corrigé en réordonnant les opérations (arrêt, puis application de la position cliquée, puis relance).
- Ajout d'un bouton "Visualiser le résultat" dans le backstage, ouvrant directement la page publique dans un nouvel onglet à partir des champs owner/repo.
- Reconstruction de la page publique sur le modèle de la page ReelCrafter existante de l'utilisateur (logo, tagline, témoignages, grille vidéo, section bio, playlist), avec un système de **blocs génériques réordonnables** (flèches ↑/↓ sur chaque bloc) : blocs uniques non supprimables (Header, Bio, Témoignages, Musique) et blocs dupliables à volonté (Texte avec alignement, Photo — seul ou en grille —, Vidéo — seule ou en grille, avec vignette optionnelle).
- Migration automatique intégrée pour toute ancienne structure de données (anciens formats de blocs, anciennes listes "galerie"/"vidéos" groupées) vers le nouveau schéma, sans perte de contenu déjà publié.

---

## [2026-07-01 / 2026-07-02] — Prototype V1 : premier lecteur adaptatif fonctionnel

**Fichiers touchés** : création initiale de `index.html`, `data.json`, `layerpitch-backstage.html` (repo GitHub `layerpitch`)

**Contexte** : Point de départ du projet. Recherche préalable (voir master) confirmant qu'aucune plateforme de pitch existante ne permet à un destinataire d'expérimenter lui-même un changement d'intensité musicale en temps réel. Décision de construire un prototype personnel plutôt qu'un produit généralisable, en architecture statique (aucun backend) pour rester dans les moyens d'un usage solo.

**Changement** :
- Architecture à trois fichiers, hébergement GitHub Pages, sans serveur : `index.html` (lecteur, lit `data.json` au runtime), `data.json` (contenu), `layerpitch-backstage.html` (formulaire d'édition local, jamais publié).
- Moteur de layering vertical : plusieurs couches audio jouées en boucle simultanée, volume de chaque couche piloté par un profil cumulatif selon le niveau d'intensité sélectionné (niveau *i* active les couches 0 à *i*).
- Pipeline de conversion audio côté navigateur : upload WAV → décodage (`AudioContext.decodeAudioData`) → encodage Ogg Vorbis (`wasm-media-encoders`, sans dépendance serveur) → upload direct dans le repo GitHub via l'API REST (authentification par token d'accès personnel fine-grained, restreint au seul repo, permission `Contents: Read/write`).
- `data.json` chargé côté backstage pour permettre l'édition/l'ajout de morceaux sans réécrire le fichier à la main.
- Premier test réel de bout en bout réussi : morceau "Battle Loop" (3 couches d'intensité), conversion, publication, lecture, et bouclage sans coupure confirmés à l'oreille.

---

**Fin du changelog reconstitué au 25 juillet 2026.**
